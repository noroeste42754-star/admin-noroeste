import { canonicalTaskPerson, resolveCentralPerson } from './central-person.ts'
import { assignmentId, assignmentForRole, canonicalMeetingType, TASK_ROLES, roleApplies, personName } from './tarefas-domain.ts'
import { hasScaleAssignments, printRowsForLocal } from './escala-output.ts'
import { localSlots } from './escala-domain.ts'
import { canonicalSpeaker } from './oradores-editor-domain.ts'
import { normalizeSpeakersRoot } from './oradores-domain.ts'
import { publicationSource as speakerPublicationSource } from './oradores-publication.ts'
import { fieldServiceConflicts } from './servico-campo-domain.ts'
import type { PublicPdfModule } from './agenda-documents-domain.ts'

// The same projection is used by the publisher, transaction and Admin audit.
export type PublicationRoot = Record<string, any>
export function stableValue(value:unknown):string {
  const canonical=(item:any):any=>{
    if(item==null)return null
    if(typeof item!=='object')return item
    const entries=Object.entries(item).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]).filter(([,v])=>v!==null)
    return entries.length?Object.fromEntries(entries):null
  }
  return JSON.stringify(canonical(value))
}
export function publicationPeriod(root:PublicationRoot,module:PublicPdfModule,id:string):any {
  if(module==='tarefas')return root.tarefas?.scale?.periods?.[id] ?? null
  if(module==='limpeza')return root.limpeza?.periodos?.[id] ?? null
  if(module==='servicoCampo')return root.servicoCampo?.periods?.[id] ?? null
  if(module==='escala')return Object.fromEntries(Object.entries(root.escala?.tables??{}).filter(([,months]:any)=>months[id]).map(([local,months]:any)=>[local,{[id]:months[id]}]))
  return root.tarefas?.discursos?.programacao ?? null
}
export function publicationInput(root:PublicationRoot,module:PublicPdfModule,id:string):any {
  const people=root.master?.pessoas??{}, congregation=root.master?.config?.congregacao?.nome?.trim()||'Noroeste'
  const period=publicationPeriod(root,module,id)
  if(module==='tarefas')return {meetings:Object.values(period?.meetings??{}).filter((m:any)=>canonicalMeetingType(m.type)).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date))),people:Object.fromEntries(Object.entries(root.tarefas?.people??{}).map(([key,p]:any)=>[key,canonicalTaskPerson(key,p,people)])),congregation}
  if(module==='limpeza') {
    const {publicado,publicadoEm,...printPeriod}=period??{}
    return {...printPeriod,semanas:(printPeriod.semanas??[]).map(({manualGroup,...week}:any)=>{void manualGroup;return week})}
  }
  if(module==='servicoCampo')return {month:id,assignments:Object.values(period?.assignments??{}),people,congregation}
  if(module==='escala')return {month:id,locals:root.escala?.scales??{},tables:period,participants:Object.fromEntries(Object.entries(root.escala?.participants??{}).map(([key,p]:any)=>{
    const c=resolveCentralPerson(key,p.masterId,people)
    return [key,{...p,masterId:c.masterId,name:c.name||p.name,active:c.active&&p.active!==false}]
  })),exclusions:root.escala?.monthExclusions?.[id]??[]}
  const talks=normalizeSpeakersRoot(root.tarefas?.discursos??{})
  return {month:id,schedule:Object.values(talks.programacao??{}),speakers:Object.fromEntries(Object.entries(talks.oradores??{}).map(([key,p])=>[key,canonicalSpeaker(p,people,root.tarefas?.people??{})])),themes:talks.temas??{},congregations:talks.congregacoes??{}}
}
export function publicationIssues(root:PublicationRoot,module:PublicPdfModule,id:string):string[] {
  const input=publicationInput(root,module,id), people=root.master?.pessoas??{}, issues:string[]=[]
  const requirePerson=(mid:string,label:string)=>{if(!mid||!people[mid]||people[mid].active===false)issues.push(`${label}: pessoa inativa ou sem vínculo com Admin.`)}
  if(module==='tarefas') for(const meeting of input.meetings)for(const value of Object.values(meeting.assignments??{})) {
    const pid=assignmentId(value), person=input.people[pid??'']
    if(pid&&(!person||person.active===false))issues.push(`${meeting.date}: participante inativo ou sem vínculo com Admin.`)
  }
  if(module==='escala') {
    const tables=Object.values(input.tables) as any[]
    if(!tables.some(months=>hasScaleAssignments(months[id])))issues.push('TPL: nenhuma designação neste período.')
    for(const months of tables)for(const row of Object.values(months[id]?.rows??{}) as any[])for(const cell of Object.values(row.slots??{}) as any[])for(const pid of [cell.p1,cell.p2].filter(Boolean)) {
      const person=input.participants[pid]
      if(!person?.active||!person.name||String(person.name).trim()===pid)issues.push('TPL: participante inativo ou sem nome/vínculo com Admin.')
    }
  }
  if(module==='servicoCampo') {
    for(const item of input.assignments) {
      requirePerson(item.leaderId,item.date)
      if(!root.servicoCampo?.leaders?.[item.leaderId]||people[item.leaderId]?.sex!=='M')issues.push(`${item.date}: dirigente não aprovado.`)
    }
    if(fieldServiceConflicts(input.assignments).length)issues.push('Há dirigentes em saídas simultâneas.')
  }
  if(module==='oradores')for(const item of input.schedule) {
    if(item.data<id+'-01'||(item.tipo!=='saida_orador'&&!item.data.startsWith(id)))continue
    for(const pid of [item.oradorId,item.oradorSecundarioId].filter(Boolean))if(!input.speakers[pid]?.ativo)issues.push(item.data+': orador inativo, inexistente ou sem vínculo central.')
  }
  if(module==='limpeza')for(const week of input.semanas??[])for(const mid of [week.superintendenteMid,...Object.values(week.ajudantesMid??{}),...Object.values(week.membrosMid??{})].filter(Boolean))requirePerson(String(mid),week.referencia)
  return [...new Set(issues)]
}
export function publicationSourceValue(root:PublicationRoot,module:PublicPdfModule,id:string):string {
  const input=publicationInput(root,module,id)
  if(module==='oradores')return speakerPublicationSource({programacao:Object.fromEntries(input.schedule.map((item:any,index:number)=>[String(index),item])),oradores:input.speakers,temas:input.themes,congregacoes:input.congregations},id)
  if(module==='tarefas')return stableValue([input.congregation,input.meetings.map((meeting:any)=>[meeting.date,meeting.type,TASK_ROLES.filter(role=>roleApplies(role,meeting)).map(role=>{const pid=assignmentForRole(meeting,role);return [role,pid?personName(input.people[pid],pid):'']})])])
  if(module==='servicoCampo')return stableValue([id,input.congregation,[...input.assignments].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.location.localeCompare(b.location,'pt-BR')).map(item=>[item.date,item.time,item.location,input.people[item.leaderId]?.name??'A definir'])])
  if(module==='limpeza')return stableValue([input.inicio,input.fim,input.congregacao,(input.semanas??[]).map((week:any)=>[week.grupo,week.grupoNome,week.dataMeioSemana,week.dataFimSemana])])
  return stableValue([id,Object.entries(input.locals).filter(([key]:any)=>hasScaleAssignments(input.tables[key]?.[id])).sort((a:any,b:any)=>Number(a[1].sortOrder??0)-Number(b[1].sortOrder??0)).map(([key,local]:any)=>[local.name??key,input.tables[key]?.[id]?.slots??localSlots(local),printRowsForLocal(key,id,local,input.tables,input.participants,input.exclusions)])])
}
export function periodIsPublished(root:PublicationRoot,module:PublicPdfModule,id:string):boolean {
  const p=publicationPeriod(root,module,id)
  return module==='tarefas'?p?.locked===true:module==='limpeza'?p?.publicado===true:module==='servicoCampo'?p?.published===true:module==='escala'?(root.escala?.publishedMonth===id||root.escala?.publishedMonths?.[id]===true):false
}
