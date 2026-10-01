import { collectAnnouncementEvents, eventsInFeedWindow, type AnnouncementEvent } from './individual-domain.ts'
import { isValidCivilDate, fortalezaToday } from './civil-date.ts'
import type { AgendaConfig, AgendaPublicDocument } from '../types.ts'

export const QUADRO_SOURCES = ['tarefas','oradores','escala','geral','quadro'] as const
export type QuadroSource = typeof QUADRO_SOURCES[number]
export interface GeneralNotice { id:string; date:string; title:string; description:string }
export interface QuadroData {
  events:AnnouncementEvent[]; notices:GeneralNotice[];
  agenda:{config:AgendaConfig;documentos:Record<string,AgendaPublicDocument>};
  completedSources:string[]; failedSources:string[];
}
const row=(v:any):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v:{}
const text=(v:unknown,max=300):string=>typeof v==='string'?v.trim().slice(0,max):''
export function safePublicLink(value:unknown):string {
  const candidate=text(value,2000)
  try{const u=new URL(candidate);return u.protocol==='https:'&&!u.username&&!u.password?candidate:''}catch{return''}
}

/** Projection of published general information, never a person-specific feed. */
export function quadroEvents(root:Record<string,any>,completed:string[]= [...QUADRO_SOURCES],today=fortalezaToday()):AnnouncementEvent[] {
  const allowed={tarefas:completed.includes('tarefas'),oradores:completed.includes('oradores'),escala:completed.includes('escala'),limpeza:false,servicoCampo:false}
  const tasks=row(root.tarefas),config=row(row(root.master).config),meetings=row(config.reunioes),congregations=Object.values(row(row(tasks.discursos).congregacoes))
  const talks=row(tasks.discursos),speakers=row(talks.oradores),master=row(row(root.master).pessoas)
  const events=collectAnnouncementEvents(root,allowed).filter(event=>{
    if(event.source!=='oradores')return true
    const talk=row(talks.programacao)[event.id.slice('oradores:'.length)]??{}
    return [talk.oradorId,talk.oradorSecundarioId].filter(Boolean).every(id=>{
      const speaker=speakers[id]
      if(!speaker||speaker.ativo===false)return false
      return speaker.tipo!=='local'||Boolean(master[speaker.masterId]&&master[speaker.masterId].active!==false)
    })
  }).map(event=>{
    if(event.source==='tarefas') {
      const [,period,id]=event.id.split(':'),meeting=row(row(row(row(tasks.scale).periods)[period!]).meetings)[id!]??{}
      const kind=meeting.type
      const detail=kind==='midweek'?'Reunião do meio de semana':kind==='weekend_merged'?'Reunião única':`Reunião do fim de semana · ${kind==='weekend_s1'?'1ª':'2ª'} seção`
      const section=kind==='weekend_s1'?'s1':'s2',local=congregations.find(c=>c.tipo==='local'&&(c.secao??'s2')===section)
      const time=kind==='midweek'?meetings.meiaDeSemana?.horario:local?.horario??(section==='s2'?meetings.fimDeSemana?.horario:undefined)
      return {...event,detail,...(typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time)?{time}:{})}
    }
    if(event.source==='oradores') {
      const talk=row(row(tasks.discursos).programacao)[event.id.slice('oradores:'.length)]??{}
      const speaker=row(row(tasks.discursos).oradores)[talk.oradorId]??{}
      const section=talk.tipo==='saida_orador'?(speaker.secao??talk.secao):talk.secao
      const label=section==='s1'?'1ª seção':'2ª seção'
      return {...event,detail:event.detail.includes(label)?event.detail:`${event.detail} · ${label}`}
    }
    // The two participants already appear in people; do not repeat their identity in detail.
    return {...event,detail:'Carrinho de testemunho público'}
  })
  return eventsInFeedWindow(events,today)
}
export function quadroNotices(root:Record<string,any>,today=fortalezaToday()):GeneralNotice[] {
  const limit=new Date(`${today}T12:00:00Z`);limit.setUTCMonth(limit.getUTCMonth()+12)
  return Object.entries(row(row(root.tarefas).events)).flatMap(([id,v])=>{
    const value=row(v),date=text(value.data,10),title=text(value.titulo,160)
    return isValidCivilDate(date)&&date>=today&&date<=limit.toISOString().slice(0,10)&&title?[{id:text(id,240),date,title,description:text(value.descricao,2000)}]:[]
  }).sort((a,b)=>a.date.localeCompare(b.date))
}
export function mergeQuadroData(previous:QuadroData,incoming:QuadroData):QuadroData {
  const completed=incoming.completedSources
  return {
    events:[...previous.events.filter(e=>!completed.includes(e.source)),...incoming.events.filter(e=>completed.includes(e.source))].filter(e=>['tarefas','oradores','escala'].includes(e.source)).sort((a,b)=>a.date.localeCompare(b.date)||(a.time??'').localeCompare(b.time??'')),
    notices:completed.includes('geral')?incoming.notices:previous.notices,
    agenda:completed.includes('quadro')?incoming.agenda:previous.agenda,
    completedSources:[...new Set([...previous.completedSources,...completed])],
    failedSources:[...new Set([...previous.failedSources.filter(s=>!completed.includes(s)),...incoming.failedSources])],
  }
}
export function isQuadroData(v:any):v is QuadroData {
  const record=(value:any)=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))
  const optionalText=(value:any)=>value===undefined||typeof value==='string'
  const config=v?.agenda?.config
  const validConfig=record(config)&&['quadroWhatsAppLink','outrosAnunciosDriveUrl'].every(key=>optionalText(config[key]))&&
    (config.moduleWhatsApp===undefined||record(config.moduleWhatsApp)&&Object.values(config.moduleWhatsApp).every((settings:any)=>record(settings)&&['groupLink','meetingText','documentText'].every(key=>optionalText(settings[key]))))&&
    (config.icsReminders===undefined||record(config.icsReminders)&&Object.values(config.icsReminders).every(offsets=>Array.isArray(offsets)&&offsets.every(offset=>typeof offset==='string')))
  return Boolean(v&&Array.isArray(v.events)&&Array.isArray(v.notices)&&Array.isArray(v.completedSources)&&Array.isArray(v.failedSources)&&record(v.agenda)&&validConfig&&record(v.agenda.documentos)&&
    [...v.completedSources,...v.failedSources].every(s=>QUADRO_SOURCES.some(source=>source===s))&&
    v.events.every((e:any)=>e&&typeof e.id==='string'&&['tarefas','oradores','escala'].includes(e.source)&&isValidCivilDate(e.date)&&(e.time===undefined||/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time))&&typeof e.title==='string'&&typeof e.detail==='string'&&optionalText(e.location)&&optionalText(e.mapLocation)&&Array.isArray(e.people)&&e.people.every((p:any)=>typeof p==='string'))&&
    v.notices.every((e:any)=>e&&typeof e.id==='string'&&isValidCivilDate(e.date)&&typeof e.title==='string'&&typeof e.description==='string')&&
    Object.values(v.agenda.documentos).every((d:any)=>record(d)&&['tarefas','oradores','escala','admin'].includes(d.modulo)&&typeof d.id==='string'&&typeof d.nome==='string'&&typeof d.periodo==='string'&&typeof d.criadoEm==='string'&&optionalText(d.inicio)&&optionalText(d.fim)&&safePublicLink(d.url)))
}
