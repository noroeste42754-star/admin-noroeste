import { cleanAddress } from './agenda-location.ts'
import { contextualMessage, displayPhone, messageDate, SPEAKER_FOOTER } from './message-domain.ts'
import { exchangeReady, scheduleCongregationId, scheduleCongregationName, type SpeakersRoot, type TalkSchedule } from './oradores-domain.ts'

export function messageAddress(value=''):string {
  const address=cleanAddress(value)
  // Legacy location values are not street addresses. Never substitute the mapa field.
  if(/(?:https?:\/\/|www\.)/i.test(address)||/^[a-z][a-z0-9+.-]*:/i.test(address)||/^[23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s|$)/i.test(address)||/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(address))return ''
  return address
}

export function speakerAssignmentMessage(item:TalkSchedule,root:SpeakersRoot,second=false,localTime=''):string {
  const congregations=root.congregacoes??{},theme=root.temas?.[item.temaId??'']
  const local=congregations[item.localCongregacaoId??'']??Object.values(congregations).find(c=>c.tipo==='local'&&(c.secao??'s2')===(item.secao??'s2'))
  const destination=item.tipo==='saida_orador'?congregations[scheduleCongregationId(item)]:local
  const name=destination?.nome || (item.tipo==='saida_orador'?scheduleCongregationName(item):item.localCongregacaoNome) || 'A definir'
  const date=new Intl.DateTimeFormat('pt-BR',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(`${item.data}T12:00:00Z`))
  const number=theme?.numero??item.temaNumero,title=theme?.titulo||item.temaTitulo||'A definir'
  const time=item.tipo==='saida_orador'?destination?.horario:item.horarioLocal||localTime||destination?.horario
  const meeting=[destination?.diaReuniao,time].filter(Boolean).join(', ')
  if(item.tipo!=='saida_orador')return [messageDate(item.data,time),`🏛️ ${item.secao==='s1'?'1ª seção':'2ª seção'}`,second?'🎙️ *Segundo orador*':'🎙️ *Discurso local*',themeLine(item,root)].join('\n')
  return [`📅 *${date}*`,second?'🎙️ *Segundo orador*':'🚗 *Saída para discurso*',
    `📖 *Tema${number?' '+number:''}:* ${title}`,`🏛️ Congregação: ${name}`,
    destination?.cidade?`📍 Cidade: ${destination.cidade}`:'',meeting?`🕒 Reunião: ${meeting}`:'',
    destination?.contato?`👤 Contato: ${destination.contato}`:'',destination?.telefone?`📞 Telefone da congregação: ${displayPhone(destination.telefone)}`:'',
    messageAddress(destination?.localizacao)?`📍 Endereço: ${messageAddress(destination?.localizacao)}`:''].filter(Boolean).join('\n')
}

function localCongregation(root:SpeakersRoot,item?:TalkSchedule) {
  return root.congregacoes?.[item?.localCongregacaoId??'']??Object.values(root.congregacoes??{}).find(c=>c.tipo==='local'&&(c.secao??'s2')===(item?.secao??'s2'))
}
function themeLine(item:TalkSchedule,root:SpeakersRoot):string {
  const theme=root.temas?.[item.temaId??''],number=theme?.numero??item.temaNumero,title=theme?.titulo||item.temaTitulo||'A definir'
  return number?`📖 *Tema ${number}:* ${title}`:`📖 Tema: ${title}`
}
export function assignmentEntries(root:SpeakersRoot,id:string,today:string,localTime=''):{date:string;text:string;talk:boolean}[] {
  const rows=Object.values(root.programacao??{}).filter(item=>item.data>=today)
  const entries=rows.filter(item=>item.oradorId===id||item.oradorSecundarioId===id).map(item=>({date:item.data,text:speakerAssignmentMessage(item,root,item.oradorSecundarioId===id&&item.oradorId!==id,localTime),talk:true}))
  const selectedSection=root.oradores?.[id]?.secao??'s2'
  const eligible=Object.entries(root.oradores??{}).filter(([,speaker])=>speaker.ativo&&speaker.tipo==='local'&&(speaker.secao??'s2')===selectedSection)
  const leaders=eligible.filter(([,s])=>s.sentinelaDirigente),substitutes=eligible.filter(([,s])=>s.sentinelaSubstituto)
  if(leaders.length===1&&substitutes.length===1&&substitutes[0]![0]===id&&leaders[0]![0]!==id){
    const leader=leaders[0]![0],seen=new Set<string>()
    rows.filter(item=>item.tipo==='discurso_local'&&(item.secao??'s2')===selectedSection&&(item.oradorId===leader||item.oradorSecundarioId===leader)).forEach(item=>{
      if(seen.has(item.data))return
      seen.add(item.data)
      entries.push({date:item.data,text:`${messageDate(item.data,item.horarioLocal||localTime||localCongregation(root,item)?.horario)}\n🔔 Substituição do estudo de 'A Sentinela'`,talk:false})
    })
  }
  return entries.sort((a,b)=>a.date.localeCompare(b.date)||a.text.localeCompare(b.text))
}
export function assignmentsMessage(root:SpeakersRoot,id:string,today:string,template?:string,localTime=''):string {
  const entries=assignmentEntries(root,id,today,localTime),name=root.oradores?.[id]?.nome||'irmão'
  const details=`*${name}*\n\n${entries.map(e=>e.text).join('\n\n')}`
  return contextualMessage('oradores',template,`Olá, segue suas próximas designações:\n\n${details}${entries.some(e=>e.talk)?'\n\n'+SPEAKER_FOOTER:''}`,details,name)
}
export function exchangesMessage(root:SpeakersRoot,id:string,today:string,template?:string,localTime='',section:'s1'|'s2'='s2'):string {
  const congregation=root.congregacoes?.[id],name=congregation?.contato||''
  const rows=Object.values(root.programacao??{}).filter(item=>(item.secao??'s2')===section&&item.data>=today&&item.tipo!=='discurso_local'&&scheduleCongregationId(item)===id&&exchangeReady(item)).sort((a,b)=>a.data.localeCompare(b.data))
  const groups=[['discurso_visitante','🎙️ *Convites*'],['saida_orador','🚗 *Saídas*']].map(([kind,label])=>{
    const matches=rows.filter(item=>item.tipo===kind)
    return matches.length?`${label}\n\n${matches.map(item=>[messageDate(item.data,kind==='saida_orador'?congregation?.horario:item.horarioLocal||localTime||localCongregation(root,item)?.horario),`👤 ${root.oradores?.[item.oradorId??'']?.nome||item.oradorNome||'A definir'}`,themeLine(item,root)].join('\n')).join('\n\n')}`:''
  }).filter(Boolean).join('\n\n')
  return contextualMessage('oradores',template,`Olá${name?', '+name:''}! Segue nosso intercâmbio com a ${congregation?.nome||'congregação'}:\n\n${groups}`,groups,name||'irmãos')
}
export function availableMessage(root:SpeakersRoot,id:string,dates:string[],localTime='',template?:string,section:'s1'|'s2'='s2'):string {
  const destination=root.congregacoes?.[id],local=localCongregation(root,{secao:section} as TalkSchedule),address=messageAddress(local?.localizacao),name=destination?.contato||''
  const details=[dates.map(date=>messageDate(date,localTime||local?.horario)).join('\n'),address?`📍 Endereço: ${address}`:''].filter(Boolean).join('\n\n')
  return contextualMessage('oradores',template,`Olá${name?', '+name:''}! Temos estas datas disponíveis na ${local?.nome||'nossa congregação'}:\n\n${details}`,details,name||'irmãos')
}
