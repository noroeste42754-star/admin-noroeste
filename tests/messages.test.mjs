import test from 'node:test'
import assert from 'node:assert/strict'
import { whatsappPhone, contextualMessage, SPEAKER_FOOTER, SPEAKER_TEMPLATE } from '../src/modules/message-domain.ts'
import { assignmentsMessage, assignmentEntries, confirmationMessage, exchangesMessage, availableMessage } from '../src/modules/oradores-messages.ts'
import { availableDates } from '../src/modules/oradores-available.ts'
import { tasksPersonMessage, tasksDayMessage } from '../src/modules/tarefas-messages.ts'
const root={
  oradores:{a:{nome:'Ana',ativo:true,tipo:'local',sentinelaDirigente:true},b:{nome:'Beto',ativo:true,tipo:'local',sentinelaSubstituto:true}},
  temas:{t:{numero:70,titulo:'Confiança'}},
  congregacoes:{local:{nome:'Noroeste',tipo:'local',horario:'09:30',localizacao:'Rua Um, 10',mapa:'4W3V+74G'},dest:{nome:'Central',tipo:'visitante',contato:'José',horario:'18:00',diaReuniao:'Sábado',telefone:'79999999999',localizacao:'Rua Dois, 20'}},
  programacao:{local:{data:'2026-10-04',tipo:'discurso_local',oradorId:'a',temaId:'t'},second:{data:'2026-10-11',tipo:'discurso_local',oradorId:'a',oradorSecundarioId:'b',temaId:'t'},out:{data:'2026-10-18',tipo:'saida_orador',oradorId:'b',temaId:'t',congregacaoDestinoId:'dest'},visit:{data:'2026-10-25',tipo:'discurso_visitante',oradorNome:'Visitante',temaId:'t',congregacaoOrigemId:'dest'}},
}
test('telefones brasileiros com DDD aceitam 10/11 dígitos e não duplicam 55',()=>{
  assert.equal(whatsappPhone('(79) 99999-9999'),'5579999999999')
  assert.equal(whatsappPhone('79 3333-4444'),'557933334444')
  assert.equal(whatsappPhone('55 79 99999-9999'),'5579999999999')
  assert.equal(whatsappPhone('55 99999-9999'),'5555999999999')
  for(const value of ['','123','123456789012345','447999999999'])assert.equal(whatsappPhone(value),null)
})
test('designações unem segundo orador e Sentinela em ordem; só discurso recebe rodapé',()=>{
  const msg=assignmentsMessage(root,'b','2026-10-01')
  assert.match(msg,/Olá, segue suas próximas designações/)
  assert.match(msg,/🎙️ \*Segundo orador\*/)
  assert.match(msg,/🔔 Substituição/)
  assert.match(msg,/📖 \*Tema 70:\* Confiança/)
  assert.match(msg,/📞 Telefone da congregação: 79 99999-9999/)
  assert.ok(msg.indexOf('04/10/2026')<msg.indexOf('18/10/2026'))
  assert.ok(msg.includes(SPEAKER_FOOTER))
  const only={...root,programacao:{local:root.programacao.local}}
  assert.ok(!assignmentsMessage(only,'b','2026-10-01').includes(SPEAKER_FOOTER))
  assert.equal(assignmentEntries({...only,oradores:{...root.oradores,c:{...root.oradores.a}}},'b','2026-10-01').length,0)
  assert.equal(assignmentEntries({...only,programacao:{local:{...only.programacao.local,secao:'s1'}}},'b','2026-10-01').length,0)
  assert.equal(assignmentEntries(root,'b','2027-01-01').length,0)
})
test('confirmação tem pergunta, horário correto e endereço sem mapa',()=>{
  const msg=confirmationMessage(root.programacao.out,root)
  for(const value of ['Olá, Beto!','18:00','Tema 70','Endereço: Rua Dois, 20','Pode confirmar?'])assert.ok(msg.includes(value))
  const local=confirmationMessage(root.programacao.local,root,undefined,'10:00')
  assert.ok(local.includes('10:00'));assert.ok(local.includes('Rua Um, 10'));assert.ok(!local.includes('4W3V'))
})
test('intercâmbios separam grupos e usam horário de quem recebe',()=>{
  const msg=exchangesMessage(root,'dest','2026-10-01',undefined,'09:45')
  for(const value of ['Olá, José!','🎙️ *Convites*','🚗 *Saídas*','👤 Visitante','👤 Beto','09:45','18:00','Tema 70'])assert.ok(msg.includes(value))
  assert.ok(!exchangesMessage(root,'dest','2026-10-20').includes('🚗'))
  const finalized=exchangesMessage({...root,programacao:{...root.programacao,out:{...root.programacao.out,status:'confirmado'},incoming:{...root.programacao.incoming,status:'por_confirmar'}}},'dest','2026-10-01',undefined,'09:45',true)
  assert.match(finalized,/🚗 \*Saídas\*/)
  assert.ok(!finalized.includes('🎙️ *Convites*'))
})
test('datas livres respeitam dia, exclusões, eventos, S2 e não confundem saída com ocupação local',()=>{
  const dates=availableDates(root,{e:{data:'2026-11-01',tipo:'celebracao'}},{meetingDays:{weekendDow:0},excludedDates:['2026-11-08']},'2026-10-01',40)
  assert.deepEqual(dates,['2026-10-18'])
  const msg=availableMessage(root,'dest',dates,'09:30')
  assert.match(msg,/Olá, José!/);assert.match(msg,/Noroeste/);assert.match(msg,/18\/10\/2026 — 09:30/);assert.match(msg,/Endereço: Rua Um, 10/);assert.ok(!msg.includes('4W3V'))
  assert.deepEqual(availableDates(root,{}, {},'2026-10-01',90),[])
})
test('padrão anterior migra só em memória; personalizações permanecem intactas',()=>{
  const legacy='Olá. Segue a programação de oradores:\n\n{dados_da_reuniao}\n\nAgradecemos pela atenção.'
  for(const template of [undefined,legacy,SPEAKER_TEMPLATE])assert.equal(contextualMessage('oradores',template,'Padrão','Dados'),'Padrão')
  assert.equal(contextualMessage('oradores','Oi {nome}\n{dados_da_reuniao}\nMeu rodapé','Padrão','Dados','Beto'),'Oi Beto\nDados\nMeu rodapé')
})
test('Tarefas por pessoa usa vínculo explícito, funções e somente datas futuras; dia inclui limpeza',()=>{
  const people={p:{name:'Ana',masterId:'m'},other:{name:'Ana',masterId:'outro'}}
  const meetings=[{date:'2026-10-04',type:'weekend',assignments:{presidente:'m',leitor:'p',mic1:'other'}},{date:'2026-09-01',type:'midweek',assignments:{entrada:'p'}},{date:'2026-10-04',type:'weekend_s1',assignments:{entrada:'p'}}]
  const msg=tasksPersonMessage('p',people,meetings,'2026-10-01')
  assert.match(msg,/Olá, Ana!/);assert.match(msg,/🪑 Presidente/);assert.match(msg,/📖 Leitor/);assert.ok(!msg.includes('Microfone'));assert.match(msg,/1ª seção/);assert.match(msg,/🚪 Entrada/)
  const day=tasksDayMessage('2026-10-04',people,meetings,'Grupo 2')
  assert.match(day,/🪑 Presidente: Ana/);assert.match(day,/🧹 Limpeza: Grupo 2/);assert.match(day,/🚪 Entrada: Ana/)
  assert.equal(tasksPersonMessage('p',people,meetings,'2027-01-01'),'')
})
