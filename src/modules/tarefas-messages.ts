import { TASK_ROLES, TASK_ROLE_LABELS, assignmentForRole, canonicalMeetingType, personName, type TaskMeeting, type TaskPerson } from './tarefas-domain.ts'
import { contextualMessage } from './message-domain.ts'
const EMOJI={presidente:'🪑',operador1:'🎛️',operador2:'🎛️',leitor:'📖',entrada:'🚪',auditorio:'🏛️',mic1:'🎤',mic2:'🎤'}
function heading(meeting:TaskMeeting):string {
  const [year,month,day]=(meeting.date??'').split('-')
  const type=canonicalMeetingType(meeting.type)
  return `📅 *${day}/${month}/${year}* — Reunião de ${type==='midweek'?'meio de semana':type==='weekend_s1'?'fim de semana · 1ª seção':'fim de semana · 2ª seção'}`
}
// Resolve only explicit IDs, including canonical master IDs; never match names.
function taskRecipientIds(id:string,people:Record<string,TaskPerson>):Set<string> {
  const master=people[id]?.masterId||id
  return new Set([id,master,...Object.keys(people).filter(key=>people[key]?.masterId===master)])
}
export function tasksPersonMessage(id:string,people:Record<string,TaskPerson>,meetings:TaskMeeting[],today:string,template?:string):string {
  const ids=taskRecipientIds(id,people),name=personName(people[id],id)
  const blocks=meetings.filter(meeting=>meeting.date&&meeting.date>=today&&canonicalMeetingType(meeting.type)).sort((a,b)=>a.date!.localeCompare(b.date!)).flatMap(meeting=>{
    const roles=TASK_ROLES.filter(role=>ids.has(assignmentForRole(meeting,role)??''))
    return roles.length?[[heading(meeting),...roles.map(role=>`${EMOJI[role]} ${TASK_ROLE_LABELS[role]}`)].join('\n')]:[]
  })
  if(!blocks.length)return ''
  const details=blocks.join('\n\n')
  return contextualMessage('tarefas',template,`Olá, ${name}! Segue suas próximas designações:\n\n${details}`,details,name)
}
export function tasksDayMessage(date:string,people:Record<string,TaskPerson>,meetings:TaskMeeting[],cleaning='',template?:string):string {
  const nameFor=(id:string)=>personName(people[id]??Object.values(people).find(person=>person.masterId===id),'Pessoa não encontrada')
  const blocks=meetings.filter(meeting=>meeting.date===date&&canonicalMeetingType(meeting.type)).map(meeting=>[
    heading(meeting),'',...TASK_ROLES.flatMap(role=>{const id=assignmentForRole(meeting,role);return id?[`${EMOJI[role]} ${TASK_ROLE_LABELS[role]}: ${nameFor(id)}`]:[]}),...(cleaning?[`🧹 Limpeza: ${cleaning}`]:[]),
  ].join('\n'))
  if(!blocks.length)return ''
  const details=blocks.join('\n\n')
  return contextualMessage('tarefas',template,`Olá, segue as designações do dia:\n\n${details}`,details)
}
