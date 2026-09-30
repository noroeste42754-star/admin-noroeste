import type { Speaker, SpeakersRoot, TalkTheme } from './oradores-domain.ts'
import { assignmentId } from './tarefas-domain.ts'

export type CentralPerson = { name:string; whatsapp?:string; active?:boolean; role?:string|null }
export type LinkedPerson = { masterId?:string; unavailableDates?:string[]|Record<string,boolean> }

export function resolveSpeakerMasterId(speaker: Pick<Speaker,'masterId'|'pessoaId'>, people:Record<string,CentralPerson>, tasks:Record<string,LinkedPerson>):string {
  // Never infer identity from a name. An explicit master link takes precedence.
  if (speaker.masterId) return speaker.masterId
  const legacy=speaker.pessoaId ?? ''
  return tasks[legacy]?.masterId || (people[legacy] ? legacy : '')
}

export function canonicalSpeaker(speaker:Speaker, people:Record<string,CentralPerson>, tasks:Record<string,LinkedPerson>):Speaker {
  const masterId=resolveSpeakerMasterId(speaker,people,tasks), person=people[masterId]
  if (speaker.tipo!=='local') return speaker
  return { ...speaker, ...(masterId?{masterId}:{}), ativo:speaker.ativo && Boolean(person && person.active!==false),
    ...(person ? {nome:person.name,telefone:person.whatsapp??'',funcao:person.role==='anciao'?'anciao':person.role==='servo-ministerial'?'servo_ministerial':'publicador'} : {}) }
}

export function repertoireNumbers(ids:string[], themes:Record<string,TalkTheme>):string {
  return [...new Set(ids.flatMap(id=>themes[id]?[themes[id].numero]:[]))].sort((a,b)=>a-b).join(', ')
}

export function parseRepertoire(value:string, themes:Record<string,TalkTheme>, previous:string[]=[]):{ids:string[]; formatted:string; error:string} {
  if (!value.trim()) return {ids:[],formatted:'',error:''}
  if (!/^\s*\d+\s*(,\s*\d+\s*)*$/.test(value)) return {ids:[],formatted:value,error:'Use apenas números separados por vírgulas. Exemplo: 1, 25, 38, 45.'}
  const numbers=[...new Set(value.split(',').map(Number))].sort((a,b)=>a-b), ids:string[]=[], errors:string[]=[]
  for (const number of numbers) {
    const matches=Object.entries(themes).filter(([,theme])=>theme.numero===number)
    if (matches.length!==1) { errors.push(matches.length ? `${number}: número duplicado no catálogo` : `${number}: tema não cadastrado`); continue }
    const [id,theme]=matches[0]!
    if (!theme.ativo && !previous.includes(id)) errors.push(`${number}: tema inativo`)
    ids.push(id)
  }
  return {ids,formatted:numbers.join(', '),error:errors.join('; ')}
}

export function matchesSpeaker(speaker:Speaker, query:string, themes:Record<string,TalkTheme>):boolean {
  const term=query.trim().toLocaleLowerCase('pt-BR')
  return !term || (/^\d+$/.test(term) ? speaker.temaIds.some(id=>themes[id]?.numero===Number(term)) : speaker.nome.toLocaleLowerCase('pt-BR').includes(term))
}

export function speakerConflicts(speakerId:string,date:string,root:SpeakersRoot,people:Record<string,CentralPerson>,tasks:Record<string,LinkedPerson>,periods:Record<string,unknown>,excludedSchedule=''):string[] {
  const speaker=root.oradores?.[speakerId]
  if (!speaker || !date) return []
  const master=resolveSpeakerMasterId(speaker,people,tasks)
  const samePerson=(id:string)=>id===speakerId || Boolean(master && root.oradores?.[id] && resolveSpeakerMasterId(root.oradores[id]!,people,tasks)===master)
  const reasons:string[]=[]
  if (Object.entries(root.programacao??{}).some(([id,item])=>id!==excludedSchedule && item.data===date && [item.oradorId,item.oradorSecundarioId].some(id=>id && samePerson(id)))) reasons.push('Outro discurso ou saída nesta data')
  const taskIds=Object.entries(tasks).filter(([id,p])=>master ? p.masterId===master || id===master : id===speaker.pessoaId).map(([id])=>id)
  if (taskIds.some(id=>{const dates=tasks[id]?.unavailableDates; return Array.isArray(dates)?dates.includes(date):dates?.[date]===true})) reasons.push('Indisponível nesta data em Tarefas')
  for (const period of Object.values(periods)) {
    const meetings=(period as {meetings?:Record<string,{date?:string;assignments?:Record<string,unknown>}>})?.meetings??{}
    if (Object.values(meetings).some(meeting=>meeting.date===date && Object.values(meeting.assignments??{}).some(value=>taskIds.includes(assignmentId(value) ?? '')))) { reasons.push('Designação em Tarefas nesta data'); break }
  }
  if (speaker.tipo==='local' && !master) reasons.push('Sem vínculo com Admin; confira a disponibilidade')
  return reasons
}
