export type SpeakerSection = 's1' | 's2'
export type SpeakerKind = 'local' | 'visitante'
export type SpeakerRole = 'anciao' | 'servo_ministerial' | 'publicador'
export type TalkStatus = 'por_definir' | 'por_confirmar' | 'confirmado'
export type TalkKind = 'discurso_local' | 'discurso_visitante' | 'saida_orador'
export type SpeakerEventKind = 'informativo' | 'congresso_assembleia' | 'visita_superintendente' | 'reuniao_especial' | 'celebracao'

export interface Speaker {
  nome: string
  tipo: SpeakerKind
  funcao: SpeakerRole
  telefone: string
  ativo: boolean
  temaIds: string[]
  pessoaId?: string
  masterId?: string
  congregacaoId?: string
  origemNome?: string
  aprovadoParaSaida?: boolean
  podePresidir?: boolean
  sentinelaDirigente?: boolean
  sentinelaSubstituto?: boolean
  secao?: SpeakerSection
}

export interface TalkTheme { numero:number; titulo:string; ativo:boolean }

export interface SpeakerCongregation {
  nome: string
  cidade: string
  tipo: 'local' | 'visitante'
  ativa: boolean
  contato: string
  telefone: string
  diaReuniao: string
  horario: string
  mapa?: string
  localizacao: string
  observacoes: string
  horizonteDatas?: 90 | 180 | 365
  secao?: SpeakerSection
}

export interface TalkSchedule {
  data: string
  tipo: TalkKind
  status?: TalkStatus // Mantido apenas para leitura dos registros históricos.
  oradorId?: string
  oradorNome?: string
  oradorSecundarioId?: string
  oradorSecundarioNome?: string
  oradorSecundarioTipo?: string
  temaId?: string
  temaNumero?: number
  temaTitulo?: string
  congregacaoOrigemId?: string
  congregacaoOrigemNome?: string
  congregacaoDestinoId?: string
  congregacaoDestinoNome?: string
  localCongregacaoId?: string
  localCongregacaoNome?: string
  horarioLocal?: string
  confirmacao?: { status:boolean; confirmadoEm:string }
  reconfirmacao?: { status:boolean; confirmadoEm:string }
  avisadoEm?: string
  historicoCompartilhado?: boolean
  sentinelaAvisado?: boolean
  local?: string
  observacoes?: string
  updatedAt?: string
  secao?: SpeakerSection
}

export interface ThemeHistory { temaId:string; data:string; oradorId?:string; secao?:string; historicoCompartilhado?:boolean }
export function scheduleBaseForEdit(previous?:TalkSchedule):Partial<TalkSchedule> {
  const result={...previous}
  for(const key of ['oradorId','oradorNome','temaId','temaNumero','temaTitulo','oradorSecundarioId','oradorSecundarioNome','oradorSecundarioTipo','congregacaoDestinoId','congregacaoDestinoNome','congregacaoOrigemId','congregacaoOrigemNome','horarioLocal','observacoes'] as const) delete result[key]
  return result
}

export function isDuplicateSchedule(item:TalkSchedule, date:string, kind:TalkKind, speakerId:string, congregationId:string, section:SpeakerSection='s2'):boolean {
  if(item.data!==date || (item.secao??'s2')!==section) return false
  if(kind==='saida_orador') return item.tipo===kind && item.oradorId===speakerId && scheduleCongregationId(item)===congregationId
  return item.tipo!=='saida_orador'
}

export function speakerLinkOptions(people:Record<string,{name?:string;active?:boolean;masterId?:string}>,selected:string):{value:string;label:string}[] {
  const options=Object.entries(people).filter(([id,p])=>p.active!==false||id===selected||p.masterId===selected).map(([id,p])=>({value:id,label:p.name||id}))
  if(selected&&!options.some(o=>o.value===selected)) options.unshift({value:selected,label:Object.values(people).find(p=>p.masterId===selected)?.name||'Vínculo atual (preservado)'})
  return options.sort((a,b)=>a.label.localeCompare(b.label,'pt-BR'))
}
export interface SpeakerEvent { data:string; titulo:string; descricao?:string; tipo:SpeakerEventKind; impactoTarefas?:{ bloqueiaReuniao?:boolean; tiposReuniao?:string[] } }

export function scheduleSpeakerNames(item:TalkSchedule,speakers:Record<string,Speaker>):string {
  const primary=speakers[item.oradorId??'']?.nome?.trim()||item.oradorNome?.trim()||'A definir'
  const secondary=speakers[item.oradorSecundarioId??'']?.nome?.trim()||item.oradorSecundarioNome?.trim()
  return secondary&&secondary!==primary?`${primary} / ${secondary}`:primary
}

export interface SpeakersRoot {
  oradores?: Record<string, Speaker>
  temas?: Record<string, TalkTheme>
  congregacoes?: Record<string, SpeakerCongregation>
  programacao?: Record<string, TalkSchedule>
  historicoTemas?: Record<string, ThemeHistory>
}

export const TALK_KIND_LABEL: Record<TalkKind, string> = {
  discurso_local:'Discurso local', discurso_visitante:'Discurso visitante', saida_orador:'Saída de orador',
}
export const SPEAKER_ROLE_LABEL: Record<SpeakerRole, string> = {
  anciao:'Ancião', servo_ministerial:'Servo ministerial', publicador:'Publicador',
}
export const EVENT_KIND_LABEL: Record<SpeakerEventKind, string> = {
  informativo:'Informativo', congresso_assembleia:'Congresso / Assembleia', visita_superintendente:'Visita do superintendente', reuniao_especial:'Reunião especial', celebracao:'Celebração',
}

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const bool = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter(item => typeof item === 'string') : Object.entries(row(value)).filter(([, enabled]) => enabled === true).map(([id]) => id)
const section = (value: unknown): SpeakerSection | undefined => value === 's1' || value === 's2' ? value : undefined

export function normalizeSpeakersRoot(value: unknown): SpeakersRoot {
  const source = row(value)
  const speakers = Object.fromEntries(Object.entries(row(source['oradores'])).map(([id, raw]) => {
    const item = row(raw), tipo = item['tipo'] === 'visitante' ? 'visitante' : 'local'
    const funcao = ['anciao','servo_ministerial','publicador'].includes(text(item['funcao'])) ? text(item['funcao']) as SpeakerRole : 'publicador'
    return [id, {
      nome:text(item['nome']), tipo, funcao, telefone:text(item['telefone']), ativo:bool(item['ativo'], true), temaIds:stringArray(item['temaIds']),
      ...(text(item['masterId']) ? { masterId:text(item['masterId']) } : {}),
      ...(text(item['pessoaId']) ? { pessoaId:text(item['pessoaId']) } : {}), ...(text(item['congregacaoId']) ? { congregacaoId:text(item['congregacaoId']) } : {}),
      ...(text(item['origemNome']) ? { origemNome:text(item['origemNome']) } : {}), aprovadoParaSaida:bool(item['aprovadoParaSaida']), podePresidir:bool(item['podePresidir']),
      sentinelaDirigente:bool(item['sentinelaDirigente']), sentinelaSubstituto:bool(item['sentinelaSubstituto']), ...(section(item['secao']) ? { secao:section(item['secao']) } : {}),
    } satisfies Speaker]
  }))
  const themes = Object.fromEntries(Object.entries(row(source['temas'])).map(([id, raw]) => { const item=row(raw); return [id, { numero:Number(item['numero']) || 0, titulo:text(item['titulo']), ativo:bool(item['ativo'], true) } satisfies TalkTheme] }))
  const congregations = Object.fromEntries(Object.entries(row(source['congregacoes'])).map(([id, raw]) => { const item=row(raw); return [id, {
    nome:text(item['nome']), cidade:text(item['cidade']), tipo:item['tipo'] === 'local' ? 'local' : 'visitante', ativa:bool(item['ativa'], true), contato:text(item['contato']), telefone:text(item['telefone']), diaReuniao:text(item['diaReuniao']), horario:text(item['horario']), localizacao:text(item['localizacao']), mapa:text(item['mapa']), observacoes:text(item['observacoes']), ...([90,180,365].includes(Number(item['horizonteDatas'])) ? { horizonteDatas:Number(item['horizonteDatas']) as 90|180|365 } : {}), ...(section(item['secao']) ? { secao:section(item['secao']) } : {}),
  } satisfies SpeakerCongregation] }))
  const schedule = Object.fromEntries(Object.entries(row(source['programacao'])).map(([id, raw]) => { const item=row(raw), confirmation=row(item['confirmacao']), reconfirmation=row(item['reconfirmacao']); const kind = ['discurso_local','discurso_visitante','saida_orador'].includes(text(item['tipo'])) ? text(item['tipo']) as TalkKind : 'discurso_local'; const explicit = text(item['status']); const confirmed = confirmation['status'] === true || explicit === 'confirmado'; const status:TalkStatus = confirmed ? 'confirmado' : explicit === 'por_confirmar' ? 'por_confirmar' : 'por_definir'; return [id, {
    ...item, data:text(item['data']), tipo:kind, ...(explicit || Object.keys(confirmation).length ? { status } : {}), ...(section(item['secao']) ? { secao:section(item['secao']) } : {}),
    ...(Object.keys(confirmation).length ? { confirmacao:{ status:confirmation['status'] === true, confirmadoEm:text(confirmation['confirmadoEm']) } } : {}),
    ...(Object.keys(reconfirmation).length ? { reconfirmacao:{ status:reconfirmation['status'] === true, confirmadoEm:text(reconfirmation['confirmadoEm']) } } : {}),
  } as TalkSchedule] }))
  const history = Object.fromEntries(Object.entries(row(source['historicoTemas'])).map(([id, raw]) => { const item=row(raw); return [id, { temaId:text(item['temaId']), data:text(item['data']), ...(text(item['oradorId']) ? { oradorId:text(item['oradorId']) } : {}), ...(text(item['secao']) ? { secao:text(item['secao']) } : {}), historicoCompartilhado:bool(item['historicoCompartilhado']) } satisfies ThemeHistory] }))
  return { oradores:speakers, temas:themes, congregacoes:congregations, programacao:schedule, historicoTemas:history }
}

// Legacy compatibility for callers that explicitly request only S2.
export function selectSecondSection(root: SpeakersRoot): SpeakersRoot {
  return {
    ...root,
    programacao:Object.fromEntries(Object.entries(root.programacao ?? {}).filter(([, item]) => item.secao !== 's1')),
  }
}

export function normalizeSpeakerEvents(value: unknown): Record<string, SpeakerEvent> {
  return Object.fromEntries(Object.entries(row(value)).map(([id, raw]) => { const item=row(raw), impact=row(item['impactoTarefas']); const kind = Object.prototype.hasOwnProperty.call(EVENT_KIND_LABEL, text(item['tipo'])) ? text(item['tipo']) as SpeakerEventKind : 'informativo'; return [id, { data:text(item['data']), titulo:text(item['titulo']), descricao:text(item['descricao']), tipo:kind, impactoTarefas:{ bloqueiaReuniao:bool(impact['bloqueiaReuniao']), tiposReuniao:stringArray(impact['tiposReuniao']) } } satisfies SpeakerEvent] }))
}

export function scheduleCongregationId(item: TalkSchedule): string { return item.tipo === 'saida_orador' ? item.congregacaoDestinoId ?? '' : item.congregacaoOrigemId ?? '' }
export function scheduleCongregationName(item: TalkSchedule): string { return item.tipo === 'saida_orador' ? item.congregacaoDestinoNome ?? '' : item.congregacaoOrigemNome ?? '' }
export function exchangeReady(item: TalkSchedule): boolean {
  return Boolean((item.oradorId || item.oradorNome) && (item.temaId || item.temaTitulo || item.temaNumero) && (scheduleCongregationId(item) || scheduleCongregationName(item)))
}
import { isValidCivilDate as validIsoDate } from './civil-date.ts'
export { validIsoDate }
export function phoneDigits(value: string): string { return value.replace(/\D/g, '').slice(0, 13) }
export function newSpeakerId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}` }
export function monthBounds(month: string): { start:string; end:string } { const [year, number]=month.split('-').map(Number); return { start:`${month}-01`, end:new Date(Date.UTC(year!, number!, 0)).toISOString().slice(0,10) } }
export function formatSpeakerDate(value: string): string { if (!validIsoDate(value)) return value || 'Sem data'; return new Intl.DateTimeFormat('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC' }).format(new Date(`${value}T12:00:00Z`)).replace('.', '') }
export function sameMonth(value: string, month: string): boolean { return value.startsWith(`${month}-`) }
