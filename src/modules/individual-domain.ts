import { agendaLocation, cleanAddress } from './agenda-location.ts'
import { isValidCivilDate } from './civil-date.ts'
import { assignmentId } from './tarefas-domain.ts'
import { resolveCentralPerson, type CentralIdentity } from './central-person.ts'
import type { MasterPessoa } from '../types'

export type AgendaSource = 'tarefas' | 'oradores' | 'limpeza' | 'escala' | 'servicoCampo'
export type AgendaStatus = 'futuro' | 'confirmacao-pendente' | 'alterado' | 'realizado'

export interface AgendaEvent {
  id: string; source: AgendaSource; date: string; time?: string; title: string
  detail: string; location?: string; mapLocation?:string; note?: string; status: AgendaStatus
}

export interface AnnouncementEvent extends AgendaEvent { people: string[] }
export interface AgendaCalendarEvent extends Omit<AgendaEvent, 'source'> { source: AgendaSource | 'geral' }

type BoardMeetingKind = 'midweek' | 'weekend'
export interface BoardMeetingDate { date: string; kind: BoardMeetingKind }

export interface AgendaIcsOptions {
  reminders?: Partial<Record<AgendaSource | 'geral', string[]>>
  namespace?: string
  calendarName?: string
}

export function normalizeAgendaPeople(source: unknown): Record<string, MasterPessoa> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {}
  return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, MasterPessoa] => {
    const [id, person] = entry
    return Boolean(id && person && typeof person === 'object' && typeof (person as MasterPessoa).name === 'string' && (person as MasterPessoa).name.trim())
  }))
}

export function sanitizeAgendaPeople(source: Record<string, MasterPessoa>): Record<string, MasterPessoa> {
  return Object.fromEntries(Object.entries(normalizeAgendaPeople(source)).map(([id, person]) => [id, {
    name:person.name,
    active:person.active,
    sex:person.sex,
    role:person.role,
    whatsapp:'',
    limpeza:{ grupo:null },
  } satisfies MasterPessoa]))
}

export function upcomingAgendaEvents(events: AgendaEvent[], today: string): AgendaEvent[] {
  return events.filter(event => event.date >= today && event.status !== 'realizado')
}

type Row = Record<string, unknown>
const rows = (value: unknown): Row => value && typeof value === 'object' ? value as Row : {}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const values = (value: unknown): unknown[] => Array.isArray(value) ? value : Object.values(rows(value))
export function validAgendaDate(value: string): boolean {
  return isValidCivilDate(value)
}

export function validAgendaTime(value: string | undefined): boolean {
  return value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
const TASK_LABELS: Record<string, string> = { presidente:'Presidente', operador1:'Operador', operador2:'Operador 2', leitor:'Leitor', entrada:'Entrada', auditorio:'Auditório', mic1:'Microfone 1', mic2:'Microfone 2', microfone1:'Microfone 1', microfone2:'Microfone 2' }

export function collectAgendaEvents(rootValue: unknown, masterId: string, allowed: Partial<Record<AgendaSource, boolean>> = {}): AgendaEvent[] {
  if (!masterId) return []
  const root = rows(rootValue), tarefas = rows(root['tarefas']), taskPeople = rows(tarefas['people'])
  const taskIds = new Set(Object.entries(taskPeople).filter(([id, person]) => (text(rows(person)['masterId']) || id) === masterId).map(([id]) => id))
  const result: AgendaEvent[] = []
  const add = (event: AgendaEvent): void => { if (validAgendaDate(event.date) && validAgendaTime(event.time)) result.push({ ...event, note: text(event.note).slice(0, 250) || undefined }) }

  if (allowed.tarefas !== false) Object.entries(rows(rows(rows(tarefas['scale'])['periods']))).forEach(([periodId, periodValue]) => {
    const period = rows(periodValue)
    if (period['locked'] !== true) return
    Object.entries(rows(period['meetings'])).forEach(([meetingId, meetingValue]) => {
    const meeting = rows(meetingValue), date = text(meeting['date']) || meetingId.split('__')[0]
    Object.entries(rows(meeting['assignments'])).forEach(([role, assignment]) => {
      const personId = assignmentId(assignment) ?? ''
      if (taskIds.has(personId)) add({ id:`tarefas:${periodId}:${meetingId}:${role}`, source:'tarefas', date, title:TASK_LABELS[role] || role, detail:text(meeting['type']) === 'midweek' ? 'Reunião do meio de semana' : 'Reunião do fim de semana', status:'futuro' })
    })
    })
  })

  if (allowed.limpeza !== false) Object.entries(rows(rows(root['limpeza'])['periodos'])).forEach(([periodId, periodValue]) => {
    if (rows(periodValue)['publicado'] !== true) return
    values(rows(periodValue)['semanas']).forEach((weekValue, index) => {
    const week = rows(weekValue), ids = [text(week['superintendenteMid']), ...values(week['ajudantesMid']).map(text), ...values(week['membrosMid']).map(text)]
    if (!ids.includes(masterId)) return
    const title = `Limpeza - ${text(week['grupoNome']) || `Grupo ${Number(week['grupo'])}`}`
    add({ id:`limpeza:${periodId}:${index}:midweek`, source:'limpeza', date:text(week['dataMeioSemana']) || text(week['referencia']), title, detail:'Limpeza após a reunião do meio de semana', status:'futuro' })
    if (text(week['dataFimSemana'])) add({ id:`limpeza:${periodId}:${index}:weekend`, source:'limpeza', date:text(week['dataFimSemana']), title, detail:'Limpeza semanal do Salão do Reino', status:'futuro' })
    })
  })

  if (allowed.escala !== false) {
    const escala = rows(root['escala']), centralPeople = rows(rows(root['master'])['pessoas']) as Record<string,CentralIdentity>
    const participantIds = new Set(Object.entries(rows(escala['participants'])).filter(([id, person]) => resolveCentralPerson(id, text(rows(person)['masterId']), centralPeople).masterId === masterId).map(([id]) => id))
    const publishedMonths = rows(escala['publishedMonths']), currentPublished = text(escala['publishedMonth'])
    const participantName = (id: string): string => {
      const participant = rows(rows(escala['participants'])[id]), participantMasterId = resolveCentralPerson(id, text(participant['masterId']), centralPeople).masterId
      return text(rows(rows(rows(root['master'])['pessoas'])[participantMasterId])['name']) || text(participant['name'])
    }
    Object.entries(rows(escala['tables'])).forEach(([localId, monthsValue]) => {
      const local = rows(escala['scales'])[localId] ?? rows(rows(escala['settings'])['locals'])[localId], location = text(rows(local)['name']) || localId
      Object.entries(rows(monthsValue)).forEach(([month, tableValue]) => {
        if (currentPublished !== month && publishedMonths[month] !== true) return
        Object.entries(rows(rows(tableValue)['rows'])).forEach(([date, rowValue]) => Object.entries(rows(rows(rowValue)['slots'])).forEach(([time, cellValue]) => {
        const cell = rows(cellValue)
        const ids = [text(cell['p1']), text(cell['p2'])]
        if (ids.some(id => participantIds.has(id))) {
          const partner = ids.find(id => id && !participantIds.has(id))
          add({ id:`escala:${localId}:${month}:${date}:${time}`, source:'escala', date, time, title:'Escala TPL', detail:partner ? `Carrinho com ${participantName(partner) || 'parceiro definido'}` : 'Carrinho de testemunho público', location, status:'futuro' })
        }
      }))
      })
    })
  }

  if (allowed.servicoCampo !== false) {
    const service = rows(root['servicoCampo'])
    Object.entries(rows(service['periods'])).forEach(([periodId, periodValue]) => {
      const period = rows(periodValue)
      if (period['published'] !== true) return
      Object.entries(rows(period['assignments'])).forEach(([assignmentId, assignmentValue]) => {
        const assignment = rows(assignmentValue)
        if (text(assignment['leaderId']) !== masterId) return
        add({ id:`servicoCampo:${periodId}:${assignmentId}`, source:'servicoCampo', date:text(assignment['date']), time:text(assignment['time']) || undefined, title:`Dirigente - ${text(assignment['label']) || 'Saída de campo'}`, detail:'Dirigente da saída de campo', location:text(assignment['location']) || undefined, status:'futuro' })
      })
    })
  }

  if (allowed.oradores !== false) speakerAgendaEvents(root).forEach(({ event, masterIds }) => {
    if (masterIds.includes(masterId)) add(event)
  })
  const seen = new Set<string>()
  return result.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title, 'pt-BR')).filter(event => {
    const key = `${event.source}|${event.id}|${event.date}|${event.time || ''}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

function speakerAgendaEvents(root: Row): { event: AgendaEvent; masterIds: string[]; names: string[] }[] {
  const tasks = rows(root['tarefas']), talks = rows(tasks['discursos']), speakers = rows(talks['oradores'])
  return Object.entries(rows(talks['programacao'])).flatMap(([id, raw]) => {
    const item = rows(raw)
    if (!text(item['oradorId']) && !text(item['oradorNome']) && !text(item['oradorSecundarioId'])) return []
    if (!text(item['temaId']) && !text(item['temaTitulo']) && !Number(item['temaNumero'])) return []
    if (item['tipo'] && item['tipo'] !== 'discurso_local' && !text(item[item['tipo'] === 'saida_orador' ? 'congregacaoDestinoId' : 'congregacaoOrigemId']) && !text(item[item['tipo'] === 'saida_orador' ? 'congregacaoDestinoNome' : 'congregacaoOrigemNome'])) return []
    const date = text(item['data'])
    if (!validAgendaDate(date)) return []
    const ids = [text(item['oradorId']), text(item['oradorSecundarioId'])]
    const masterIds = ids.map(id => {
      const directId = text(rows(speakers[id])['masterId'])
      if (directId) return directId
      const personId = text(rows(speakers[id])['pessoaId'])
      return text(rows(rows(tasks['people'])[personId])['masterId']) || personId
    }).filter(Boolean)
    const names = ids.map((id, index) => {
      const speaker=rows(speakers[id]), legacy=text(speaker['pessoaId'])
      const masterId=text(speaker['masterId']) || text(rows(rows(tasks['people'])[legacy])['masterId']) || legacy
      return text(rows(rows(rows(root['master'])['pessoas'])[masterId])['name']) || text(speaker['nome']) || text(item[index ? 'oradorSecundarioNome' : 'oradorNome'])
    }).filter(Boolean)
    const theme = rows(rows(talks['temas'])[text(item['temaId'])])
    const title = text(theme['titulo']) || text(item['temaTitulo'])
    const outgoing = item['tipo'] === 'saida_orador'
    const congregations=rows(talks['congregacoes']), localId=text(item['localCongregacaoId'])
    const locals=Object.values(congregations).map(rows).filter(c=>c['tipo']==='local')
    const congregation = outgoing ? rows(congregations[text(item['congregacaoDestinoId'])]) : localId ? rows(congregations[localId]) : locals.find(c=>c['secao']===(item['secao']??'s2')) ?? locals[0] ?? {}
    const time=text(item['horarioLocal']) || text(congregation['horario']) || undefined
    if(!validAgendaTime(time))return []
    const location = cleanAddress(text(congregation['localizacao'])) || text(item[outgoing ? 'congregacaoDestinoNome' : 'localCongregacaoNome']) || text(congregation['nome'])
    const event: AgendaEvent = { id:`oradores:${id}`, source:'oradores', date, ...(time ? { time } : {}), title:outgoing ? 'Saída de orador' : 'Discurso público', detail:[outgoing ? 'Discurso em outra congregação' : `Reunião do fim de semana · ${item['secao']==='s1'?'1ª seção':'2ª seção'}`, title].filter(Boolean).join(' · '), ...(location ? { location } : {}), ...(text(congregation['mapa']) ? {mapLocation:text(congregation['mapa'])} : {}), status:'futuro' }
    return [{ event, masterIds, names }]
  })
}

export function collectAnnouncementEvents(rootValue: unknown, allowed: Partial<Record<AgendaSource, boolean>> = {}): AnnouncementEvent[] {
  const root = rows(rootValue), people = rows(rows(root['master'])['pessoas'])
  const grouped = new Map<string, AnnouncementEvent>()
  const add = (event: AgendaEvent, name: string): void => {
    if (!name || !validAgendaDate(event.date) || !validAgendaTime(event.time)) return
    const key = `${event.source}|${event.id}|${event.date}|${event.time || ''}`
    const current = grouped.get(key)
    if (current) { if (!current.people.includes(name)) current.people.push(name); return }
    grouped.set(key, { ...event, note: undefined, people: [name] })
  }
  Object.entries(people).forEach(([masterId, personValue]) => {
    const person = rows(personValue), name = text(person['name'])
    if (!name || person['active'] === false) return
    collectAgendaEvents(rootValue, masterId, allowed).forEach(event => {
      if (event.source !== 'oradores') add(event, name)
    })
  })
  if (allowed.oradores !== false) speakerAgendaEvents(root).forEach(({ event, names }) => {
    names.forEach(name => add(event, name))
  })
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title, 'pt-BR'))
}

const icsEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
const utcStamp = (value: string): string => value.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const validReminder = (value: string): boolean => /^P(?:\d+D)?(?:T\d+[HM])?$/.test(value) && value !== 'P'
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder()
  let result = '', length = 0
  for (const character of line) {
    const size = encoder.encode(character).length
    if (length + size > 75) { result += '\r\n '; length = 1 }
    result += character
    length += size
  }
  return result
}
function nextCivilDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}
export function agendaToIcs(events: AgendaCalendarEvent[], generatedAt: string, options: AgendaIcsOptions = {}): string {
  const namespace = options.namespace?.replace(/[^a-zA-Z0-9_-]/g, '') || 'noroeste'
  const body = events.filter(event => validAgendaDate(event.date) && validAgendaTime(event.time)).map(event => {
    const place = agendaLocation(event.location ?? '', event.mapLocation)
    const date = event.date.replace(/-/g, ''), start = event.time ? `DTSTART;TZID=America/Fortaleza:${date}T${event.time.replace(':', '')}00` : `DTSTART;VALUE=DATE:${date}`, details = [event.detail, event.note, place.url ? `Mapa: ${place.url}` : '', `Origem: ${event.source}`, `Status: ${event.status}`].filter(Boolean).join('\n')
    const end = event.time ? 'DURATION:PT1H' : `DTEND;VALUE=DATE:${nextCivilDate(event.date)}`
    const alarms = [...new Set(options.reminders?.[event.source] ?? [])].filter(validReminder).slice(0, 2).flatMap(offset => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`Lembrete: ${event.title}`)}`, `TRIGGER:-${offset}`, 'END:VALARM'])
    return ['BEGIN:VEVENT', `UID:${icsEscape(event.id)}@${namespace}`, `DTSTAMP:${utcStamp(generatedAt)}`, start, end, `SUMMARY:${icsEscape(event.title)}`, `DESCRIPTION:${icsEscape(details)}`, ...(place.address ? [`LOCATION:${icsEscape(place.address)}`] : []), ...(place.url ? [`URL:${place.url}`] : []), ...(place.geo ? [`GEO:${place.geo}`] : []), ...alarms, 'END:VEVENT'].join('\r\n')
  }).join('\r\n')
  const timezone = ['BEGIN:VTIMEZONE', 'TZID:America/Fortaleza', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:BRT', 'END:STANDARD', 'END:VTIMEZONE']
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'PRODID:-//Noroeste//Minha agenda//PT-BR', `X-WR-CALNAME:${icsEscape(options.calendarName || 'Minha agenda Noroeste')}`, 'X-WR-TIMEZONE:America/Fortaleza', ...timezone, ...(body ? body.split('\r\n') : []), 'END:VCALENDAR'].map(foldIcsLine).join('\r\n') + '\r\n'
}

export function eventsInFeedWindow<T extends AgendaEvent>(events: T[], today: string): T[] {
  if (!validAgendaDate(today)) return []
  const anchor = new Date(`${today}T12:00:00Z`)
  const start = new Date(anchor); start.setUTCMonth(start.getUTCMonth() - 2)
  const end = new Date(anchor); end.setUTCMonth(end.getUTCMonth() + 12)
  const startDate = start.toISOString().slice(0, 10), endDate = end.toISOString().slice(0, 10)
  return events.filter(event => validAgendaDate(event.date) && validAgendaTime(event.time) && event.date >= startDate && event.date <= endDate).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
}

export function agendaMessage(events: AgendaEvent[]): string {
  if (!events.length) return 'Minha agenda Noroeste: nenhuma designação registrada neste período.'
  return `Minha agenda Noroeste:\n${events.map(event => `${event.date.split('-').reverse().join('/')} ${event.time || ''} - ${event.title}${event.location ? ` (${event.location})` : ''}`.replace('  ', ' ')).join('\n')}`
}

export function announcementMessage(events: AnnouncementEvent[]): string {
  if (!events.length) return 'Quadro de anúncios Noroeste: nenhuma designação registrada neste período.'
  return `Quadro de anúncios Noroeste:\n${events.map(event => `${event.date.split('-').reverse().join('/')} ${event.time || ''} - ${event.title}\n${event.detail}${event.location ? ` · ${event.location}` : ''}\n${event.people.join(', ')}`.replace('  ', ' ')).join('\n\n')}`
}

function eventMeetingKind(event: AnnouncementEvent): BoardMeetingKind | null {
  if (event.source === 'tarefas') return /meio de semana/i.test(event.detail) ? 'midweek' : /fim de semana/i.test(event.detail) ? 'weekend' : null
  if (/meio de semana/i.test(event.detail)) return 'midweek'
  if (/fim de semana|limpeza semanal/i.test(event.detail)) return 'weekend'
  return null
}

export function boardMeetingDates(events: AnnouncementEvent[], today: string): BoardMeetingDate[] {
  const dates = new Map<string, BoardMeetingKind>()
  events.forEach(event => {
    if (event.date < today) return
    const kind = eventMeetingKind(event)
    if (!kind || dates.has(event.date)) return
    dates.set(event.date, kind)
  })
  return [...dates].map(([date, kind]) => ({ date, kind })).sort((a, b) => a.date.localeCompare(b.date))
}

export function boardMeetingEvents(events: AnnouncementEvent[], selected: BoardMeetingDate | undefined): AnnouncementEvent[] {
  if (!selected) return []
  const sources = selected.kind === 'midweek'
    ? new Set<AgendaSource>(['tarefas', 'limpeza'])
    : new Set<AgendaSource>(['tarefas', 'oradores', 'limpeza'])
  return events.filter(event => event.date === selected.date && sources.has(event.source) && !(event.source === 'oradores' && event.title === 'Saída de orador'))
}

function boardMeetingText(events: AnnouncementEvent[], selected: BoardMeetingDate | undefined, includeCleaning: boolean): string {
  if (!selected) return 'Quadro de anúncios Noroeste: nenhuma reunião futura selecionada.'
  const groups: Array<[string, AgendaSource]> = selected.kind === 'midweek'
    ? [['TAREFAS', 'tarefas']]
    : [['TAREFAS', 'tarefas'], ['ORADORES', 'oradores']]
  if (includeCleaning) groups.push(['LIMPEZA', 'limpeza'])
  return groups.map(([title, source]) => {
    const rows = events.filter(event => event.source === source)
    return `${title}\n${rows.length ? rows.map(eventText).join('\n') : '- Nenhuma designação publicada.'}`
  }).join('\n\n')
}

function eventText(event: AnnouncementEvent): string {
  if (event.source === 'limpeza') return `Limpeza: ${event.title.replace(/^Limpeza\s*[-:]\s*/i, '')}`
  const line = `${event.time ? `${event.time} · ` : ''}${event.title}`
  const detail = [event.detail, event.location].filter(Boolean).join(' · ')
  return `- ${line}${detail ? `\n  ${detail}` : ''}${event.people.length ? `\n  ${event.people.join(', ')}` : ''}`
}

export function boardMeetingMessage(events: AnnouncementEvent[], selected: BoardMeetingDate | undefined): string {
  return boardMeetingText(events, selected, true)
}

export function boardMeetingWhatsappMessage(events: AnnouncementEvent[], selected: BoardMeetingDate | undefined): string {
  return boardMeetingText(events, selected, false)
}

export function boardCleaningMessage(events: AnnouncementEvent[]): string {
  const cleaning = events.filter(event => event.source === 'limpeza')
  if (!cleaning.length) return 'Limpeza: nenhuma designação publicada para esta reunião.'
  return cleaning.map(eventText).join('\n')
}
