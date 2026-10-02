export const TASK_ROLES = [
  'presidente', 'operador1', 'operador2', 'leitor',
  'entrada', 'auditorio', 'mic1', 'mic2',
] as const

export type TaskRole = typeof TASK_ROLES[number]
type TaskBaseRole = 'presidente' | 'operador' | 'leitor' | 'entrada' | 'auditorio' | 'microfone'
export type TaskMeetingType = 'midweek' | 'weekend' | 'weekend_s1'

const TASK_ROLE_BASE: Record<TaskRole, TaskBaseRole> = {
  presidente: 'presidente', operador1: 'operador', operador2: 'operador',
  leitor: 'leitor', entrada: 'entrada', auditorio: 'auditorio',
  mic1: 'microfone', mic2: 'microfone',
}

export const TASK_ROLE_LABELS: Record<TaskRole, string> = {
  presidente: 'Presidente', operador1: 'Operador 1', operador2: 'Operador 2',
  leitor: 'Leitor', entrada: 'Entrada', auditorio: 'Auditório',
  mic1: 'Microfone 1', mic2: 'Microfone 2',
}

const PRESIDENT_SECONDARY: TaskRole[] = ['operador1', 'operador2', 'entrada', 'auditorio', 'mic1', 'mic2']
const PRESIDENT_SECONDARY_SET = new Set<TaskRole>(PRESIDENT_SECONDARY)

export interface TaskPerson {
  name?: string
  nome?: string
  phone?: string
  whatsapp?: string
  telefone?: string
  active?: boolean
  ativo?: boolean
  masterId?: string
  weekendSection?: 's1' | 's2'
  roles?: Partial<Record<TaskBaseRole | TaskRole, boolean>>
  rule?: 'both' | 'midweek' | 'weekend' | 'none' | string
  refFolgaDate?: string
  jovem?: boolean
  unavailableDates?: string[] | Record<string, boolean>
  availabilityUpdatedAt?: string
}

export interface TaskMeeting {
  date?: string
  type?: string
  assignments?: Record<string, unknown>
  manualEdits?: Record<string, boolean>
  avisados?: Record<string, string>
}

export interface TaskPeriod {
  locked?: boolean
  meetings?: Record<string, TaskMeeting>
  generatedAt?: string
  generatedCols?: Record<string, boolean>
  appliedRules?: TaskGenerationRules & { version: number; groupTargets?: TaskGroupTargets }
}

export const TASK_GROUPS = ['anciaos', 'servos', 'jovens', 'demais'] as const
export type TaskGroup = typeof TASK_GROUPS[number]
export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  anciaos:'Anciãos', servos:'Servos ministeriais', jovens:'Jovens', demais:'Demais',
}
export interface TaskGroupTargets {
  enabled: boolean
  anciaos: number
  servos: number
  jovens: number
  demais: number
}

export function validTaskGroupTargets(value: TaskGroupTargets): boolean {
  return TASK_GROUPS.every(group => Number.isInteger(value[group]) && value[group] >= 0 && value[group] <= 100) &&
    TASK_GROUPS.reduce((sum, group) => sum + value[group], 0) === 100
}

export function normalizeTaskGroupTargets(value?: Partial<TaskGroupTargets>): TaskGroupTargets {
  const anciaos = Number(value?.anciaos), servos = Number(value?.servos), jovens = Number(value?.jovens)
  const normalized = { enabled:value?.enabled === true, anciaos, servos, jovens, demais:100 - anciaos - servos - jovens }
  return validTaskGroupTargets(normalized) ? normalized : { enabled:false, anciaos:25, servos:25, jovens:10, demais:40 }
}

export interface TaskGenerationRules {
  evitarConflitosOradores: boolean
  presidenteSegundaTarefa: boolean
  equilibrarDesignacoes: boolean
  evitarRepetirFuncao: boolean
}

export const DEFAULT_TASK_GENERATION_RULES: TaskGenerationRules = {
  evitarConflitosOradores:true,
  presidenteSegundaTarefa:true,
  equilibrarDesignacoes:true,
  evitarRepetirFuncao:true,
}

export function normalizeTaskGenerationRules(value?: Partial<TaskGenerationRules>): TaskGenerationRules {
  return {
    presidenteSegundaTarefa:value?.presidenteSegundaTarefa !== false,
    evitarConflitosOradores:value?.evitarConflitosOradores !== false,
    equilibrarDesignacoes:value?.equilibrarDesignacoes !== false,
    evitarRepetirFuncao:value?.evitarRepetirFuncao !== false,
  }
}

export interface TaskMeetingEntry {
  periodId: string
  meetingId: string
  meeting: TaskMeeting
}

export interface TaskEvent {
  data?: string
  impactoTarefas?: { bloqueiaReuniao?: boolean; tiposReuniao?: string[] }
}

export interface TaskDomainContext {
  discursos?: {
    oradores?: Record<string, { pessoaId?: string; masterId?: string }>
    programacao?: Record<string, { data?: string; secao?: string; oradorId?: string; oradorSecundarioId?: string }>
  }
  engineRules?: Partial<TaskGenerationRules>
  groupTargets?: Partial<TaskGroupTargets>
  masterPeople?: Record<string, { role?: string | null }>
  people: Record<string, TaskPerson>
  periods: Record<string, TaskPeriod>
  events: Record<string, TaskEvent>
}

export interface TaskPlanning {
  periodMode?: 'month' | 'bimester'
  meetingDays?: { midweekDow?: number; weekendDow?: number; weekendS1Dow?: number }
  midweekDow?: number
  weekendDow?: number
  weekendS1Dow?: number
  enableSection1?: boolean
  excludedDates?: string[] | Record<string, string>
}

type IneligibilityReason =
  | 'Pessoa não encontrada'
  | 'Pessoa inativa'
  | 'Função não aplicável nesta reunião'
  | 'Pessoa não habilitada nesta função'
  | 'Jovem recebe somente microfone'
  | 'Tipo de reunião incompatível'
  | 'Folga nesta data'
  | 'Indisponível nesta data'
  | 'Evento bloqueia a reunião'
  | 'Discurso na mesma data'
  | 'Pessoa designada na outra sessão neste dia'
  | 'Pessoa cadastrada para outra sessão'
  | 'Dois jovens nos microfones'
  | 'Outra função incompatível na reunião'

export interface Eligibility {
  eligible: boolean
  reason: IneligibilityReason | null
}

export interface GenerationResult {
  aborted: boolean
  patch: Record<string, unknown>
  generated: number
  errors: string[]
}

export interface TaskGroupSummary {
  total: number
  groups: Record<TaskGroup, { targetPercent: number; target: number; actual: number }>
}

export function taskGroupForPerson(personId: string, context: Pick<TaskDomainContext, 'people' | 'masterPeople'>): TaskGroup {
  const person = context.people[personId]
  if (person?.jovem === true) return 'jovens'
  const role = context.masterPeople?.[person?.masterId || personId]?.role
  if (role === 'anciao') return 'anciaos'
  if (role === 'servo-ministerial') return 'servos'
  return 'demais'
}

function groupCounts(): Record<TaskGroup, number> {
  return { anciaos:0, servos:0, jovens:0, demais:0 }
}

export function summarizeTaskGroups(context: TaskDomainContext, periodId: string, patch: Record<string, unknown> = {}): TaskGroupSummary {
  const targets = normalizeTaskGroupTargets(context.groupTargets)
  const actual = groupCounts()
  for (const [meetingId, meeting] of Object.entries(context.periods[periodId]?.meetings ?? {})) {
    if (!canonicalMeetingType(meeting.type)) continue
    const people = new Set<string>()
    for (const role of TASK_ROLES) {
      const path = `${periodId}/meetings/${meetingId}/assignments/${role}`
      const id = Object.prototype.hasOwnProperty.call(patch, path) ? assignmentId(patch[path]) : assignmentForRole(meeting, role)
      if (id && context.people[id]) people.add(id)
    }
    for (const id of people) actual[taskGroupForPerson(id, context)] += 1
  }
  const total = TASK_GROUPS.reduce((sum, group) => sum + actual[group], 0)
  const exact = TASK_GROUPS.map(group => ({ group, exact:total * targets[group] / 100 }))
  const planned = Object.fromEntries(exact.map(item => [item.group, Math.floor(item.exact)])) as Record<TaskGroup, number>
  let remaining = total - TASK_GROUPS.reduce((sum, group) => sum + planned[group], 0)
  exact.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || TASK_GROUPS.indexOf(a.group) - TASK_GROUPS.indexOf(b.group))
  for (const item of exact) { if (remaining <= 0) break; planned[item.group] += 1; remaining -= 1 }
  return { total, groups:Object.fromEntries(TASK_GROUPS.map(group => [group, { targetPercent:targets[group], target:planned[group], actual:actual[group] }])) as TaskGroupSummary['groups'] }
}

export function canonicalMeetingType(raw: unknown): TaskMeetingType | null {
  const value = String(raw ?? '').toLowerCase()
  if (value === 'weekend_s1') return 'weekend_s1'
  if (value === 'midweek' || /meio|mid|ministerio/.test(value)) return 'midweek'
  if (value === 'weekend' || value === 'weekend_s2' || value === 'weekend_merged' || /fim|weekend/.test(value)) return 'weekend'
  return null
}

export function personName(person: TaskPerson | undefined, fallback: string): string {
  return person?.name?.trim() || person?.nome?.trim() || fallback
}

export function personPhone(person: TaskPerson | undefined): string {
  return String(person?.phone ?? person?.whatsapp ?? person?.telefone ?? '').replace(/\D/g, '')
}

export function personIsActive(person: TaskPerson | undefined): boolean {
  return Boolean(person) && person?.active !== false && person?.ativo !== false
}

export function assignmentId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = item['personId'] ?? item['pessoaId'] ?? item['peopleId'] ?? item['id']
  return typeof id === 'string' && id ? id : null
}

export function assignmentForRole(meeting: TaskMeeting, role: TaskRole): string | null {
  const value = meeting.assignments?.[role]
  if (value !== undefined) return assignmentId(value)
  if (role === 'mic1') return assignmentId(meeting.assignments?.['microfone1'])
  if (role === 'mic2') return assignmentId(meeting.assignments?.['microfone2'])
  return null
}

export function roleApplies(role: TaskRole, meeting: TaskMeeting): boolean {
  const type = canonicalMeetingType(meeting.type)
  if (!type) return false
  if (String(meeting.type).toLowerCase() === 'weekend_merged') return role !== 'leitor'
  return type !== 'midweek' || (role !== 'presidente' && role !== 'leitor')
}

function personHasRole(person: TaskPerson, role: TaskRole): boolean {
  return person.roles?.[TASK_ROLE_BASE[role]] === true || person.roles?.[role] === true
}

function ruleAllows(person: TaskPerson, meeting: TaskMeeting): boolean {
  const type = canonicalMeetingType(meeting.type)
  const rule = person.rule ?? 'both'
  if (!type || rule === 'none') return false
  if (type === 'midweek') return rule === 'both' || rule === 'midweek'
  if (meeting.type !== 'weekend_merged' && person.weekendSection && person.weekendSection !== (type === 'weekend_s1' ? 's1' : 's2')) return false
  return rule === 'both' || rule === 'weekend'
}

function assignedInOtherSection(personId: string, meeting: TaskMeeting, context: TaskDomainContext): boolean {
  const type = canonicalMeetingType(meeting.type)
  if (meeting.type === 'weekend_merged') return false
  if (!meeting.date || (type !== 'weekend' && type !== 'weekend_s1')) return false
  const other = type === 'weekend_s1' ? 'weekend' : 'weekend_s1'
  const masterId = context.people[personId]?.masterId || personId
  return meetingEntries(context.periods).some(({ meeting: candidate }) => candidate.date === meeting.date && canonicalMeetingType(candidate.type) === other &&
    TASK_ROLES.some(role => {
      const id = assignmentForRole(candidate, role)
      return id && (context.people[id]?.masterId || id) === masterId
    }))
}

function dayParity(date: string | undefined): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const day = Number(date.slice(8, 10))
  return Number.isInteger(day) ? day % 2 : null
}

export function isFolga(person: TaskPerson, date: string | undefined): boolean {
  const reference = dayParity(person.refFolgaDate)
  const current = dayParity(date)
  return reference !== null && current !== null && reference === current
}

function isUnavailable(person: TaskPerson, date: string | undefined): boolean {
  if (!date || !person.unavailableDates) return false
  if (Array.isArray(person.unavailableDates)) return person.unavailableDates.includes(date)
  return person.unavailableDates[date] === true
}

export function eventBlocksMeeting(event: TaskEvent, meeting: TaskMeeting): boolean {
  if (!meeting.date || event.data !== meeting.date || event.impactoTarefas?.bloqueiaReuniao !== true) return false
  const types = event.impactoTarefas.tiposReuniao ?? []
  if (types.length === 0) return false
  const meetingType = canonicalMeetingType(meeting.type)
  return types.some(type => canonicalMeetingType(type) === meetingType)
}

export function meetingIsBlocked(context: Pick<TaskDomainContext, 'events'>, meeting: TaskMeeting): boolean {
  return Object.values(context.events).some(event => eventBlocksMeeting(event, meeting))
}

function assignmentsWithout(meeting: TaskMeeting, ignoredRole?: TaskRole): Partial<Record<TaskRole, string>> {
  const result: Partial<Record<TaskRole, string>> = {}
  TASK_ROLES.forEach(role => {
    if (role === ignoredRole) return
    const id = assignmentForRole(meeting, role)
    if (id) result[role] = id
  })
  return result
}

export function canShareMeeting(personId: string, role: TaskRole, assignments: Partial<Record<TaskRole, string>>): boolean {
  const occupied = TASK_ROLES.filter(current => assignments[current] === personId)
  if (occupied.length === 0) return true
  if (occupied.length > 1) return false
  const existing = occupied[0]!
  return (existing === 'presidente' && PRESIDENT_SECONDARY_SET.has(role)) ||
    (role === 'presidente' && PRESIDENT_SECONDARY_SET.has(existing))
}

export function hasSpeakerAssignment(personId:string, date:string|undefined, context:TaskDomainContext, section?:'s1'|'s2'):boolean {
  if (!date) return false
  const person=context.people[personId]
  return Object.values(context.discursos?.programacao ?? {}).some(item => item.data === date && (!section || (item.secao ?? 's2') === section) &&
    [item.oradorId,item.oradorSecundarioId].some(id => {
      const speaker=id ? context.discursos?.oradores?.[id] : undefined
      if (speaker?.masterId) return speaker.masterId === (person?.masterId || personId)
      const linked=speaker?.pessoaId
      if (!linked) return false
      return linked === personId || Boolean(person?.masterId && (linked === person.masterId || context.people[linked]?.masterId === person.masterId))
    }))
}

export function eligibility(
  personId: string,
  role: TaskRole,
  meeting: TaskMeeting,
  assignments: Partial<Record<TaskRole, string>>,
  context: TaskDomainContext,
): Eligibility {
  const person = context.people[personId]
  if (!person) return { eligible: false, reason: 'Pessoa não encontrada' }
  if (!personIsActive(person)) return { eligible: false, reason: 'Pessoa inativa' }
  if (!roleApplies(role, meeting)) return { eligible: false, reason: 'Função não aplicável nesta reunião' }
  if (!personHasRole(person, role)) return { eligible: false, reason: 'Pessoa não habilitada nesta função' }
  if (person.jovem === true && role !== 'mic1' && role !== 'mic2') return { eligible: false, reason: 'Jovem recebe somente microfone' }
  if (!ruleAllows(person, meeting)) return { eligible: false, reason: person.weekendSection && canonicalMeetingType(meeting.type) !== 'midweek' ? 'Pessoa cadastrada para outra sessão' : 'Tipo de reunião incompatível' }
  if (assignedInOtherSection(personId, meeting, context)) return { eligible: false, reason: 'Pessoa designada na outra sessão neste dia' }
  const meetingType = canonicalMeetingType(meeting.type)
  if (meeting.type !== 'weekend_merged' && (meetingType === 'weekend' || meetingType === 'weekend_s1') && hasSpeakerAssignment(personId, meeting.date, context, meetingType === 'weekend_s1' ? 's2' : 's1')) return { eligible:false, reason:'Pessoa designada na outra sessão neste dia' }
  if (isFolga(person, meeting.date)) return { eligible: false, reason: 'Folga nesta data' }
  if (isUnavailable(person, meeting.date)) return { eligible: false, reason: 'Indisponível nesta data' }
  if (meetingIsBlocked(context, meeting)) return { eligible: false, reason: 'Evento bloqueia a reunião' }
  if (normalizeTaskGenerationRules(context.engineRules).evitarConflitosOradores && hasSpeakerAssignment(personId, meeting.date, context)) return { eligible:false, reason:'Discurso na mesma data' }
  if ((role === 'mic1' || role === 'mic2') && person.jovem === true) {
    const other = role === 'mic1' ? 'mic2' : 'mic1'
    const otherId = assignments[other]
    if (otherId && context.people[otherId]?.jovem === true) return { eligible: false, reason: 'Dois jovens nos microfones' }
  }
  if (!canShareMeeting(personId, role, assignments)) return { eligible: false, reason: 'Outra função incompatível na reunião' }
  return { eligible: true, reason: null }
}

interface PersonStats {
  total: number
  byRole: Record<TaskBaseRole, number>
}

function emptyStats(): PersonStats {
  return { total: 0, byRole: { presidente: 0, operador: 0, leitor: 0, entrada: 0, auditorio: 0, microfone: 0 } }
}

function rankCandidates(ids: string[], role: TaskRole, stats: Record<string, PersonStats>, context: TaskDomainContext, rules: TaskGenerationRules, groupTotals: Record<TaskGroup, number>): string[] {
  const base = TASK_ROLE_BASE[role]
  const targets = normalizeTaskGroupTargets(context.groupTargets)
  const total = TASK_GROUPS.reduce((sum, group) => sum + groupTotals[group], 0)
  return [...ids].sort((a, b) => {
    const sa = stats[a] ?? emptyStats()
    const sb = stats[b] ?? emptyStats()
    if (targets.enabled) {
      const groupA = taskGroupForPerson(a, context), groupB = taskGroupForPerson(b, context)
      const needA = targets[groupA] * (total + 1) / 100 - groupTotals[groupA]
      const needB = targets[groupB] * (total + 1) / 100 - groupTotals[groupB]
      if (needA !== needB) return needB - needA
    }
    return (rules.equilibrarDesignacoes ? Number(sa.total > 0) - Number(sb.total > 0) || sa.total - sb.total : 0) ||
      (rules.evitarRepetirFuncao ? Number(sa.byRole[base] > 0) - Number(sb.byRole[base] > 0) || sa.byRole[base] - sb.byRole[base] : 0) ||
      personName(context.people[a], a).localeCompare(personName(context.people[b], b), 'pt-BR') || a.localeCompare(b)
  })
}

function validateMeeting(
  entry: TaskMeetingEntry,
  finalAssignments: Partial<Record<TaskRole, string>>,
  context: TaskDomainContext,
  generatedRoles: Set<TaskRole>,
): string[] {
  const errors: string[] = []
  generatedRoles.forEach(role => {
    const id = finalAssignments[role]
    if (!id) return
    const without = { ...finalAssignments }
    delete without[role]
    const result = eligibility(id, role, entry.meeting, without, context)
    if (!result.eligible) errors.push(`${entry.meeting.date} - ${TASK_ROLE_LABELS[role]}: ${personName(context.people[id], id)} (${result.reason}).`)
  })
  return errors
}

export function meetingEntries(periods: Record<string, TaskPeriod>): TaskMeetingEntry[] {
  return Object.entries(periods).flatMap(([periodId, period]) =>
    Object.entries(period.meetings ?? {}).map(([meetingId, meeting]) => ({ periodId, meetingId, meeting })),
  )
}

function localDateToIso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function localIsoDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export function periodKeyForDate(date: string, mode: 'month' | 'bimester'): string {
  const parsed = localIsoDate(date)
  const monthIndex = parsed.getMonth()
  const anchor = mode === 'bimester' ? monthIndex - (monthIndex % 2) : monthIndex
  return `${parsed.getFullYear()}-${String(anchor + 1).padStart(2, '0')}`
}

export function withCanonicalPeriod(
  periods: Record<string, TaskPeriod>,
  planning: TaskPlanning,
  date: string,
): { periodId: string; periods: Record<string, TaskPeriod> } | null {
  const midweekDow = planning.meetingDays?.midweekDow ?? planning.midweekDow
  const weekendDow = planning.meetingDays?.weekendDow ?? planning.weekendDow
  const weekendS1Dow = planning.meetingDays?.weekendS1Dow ?? planning.weekendS1Dow ?? weekendDow
  if (!Number.isInteger(midweekDow) || !Number.isInteger(weekendDow)) return null
  const mode = planning.periodMode === 'month' ? 'month' : 'bimester'
  const periodId = periodKeyForDate(date, mode)
  const [year, month] = periodId.split('-').map(Number)
  const start = new Date(year, month - 1, 1, 12)
  const end = new Date(year, month - 1 + (mode === 'bimester' ? 2 : 1), 0, 12)
  const current = periods[periodId] ?? {}
  const meetings = { ...(current.meetings ?? {}) }
  const existing = new Set(Object.values(meetings).flatMap(meeting => {
    const type = canonicalMeetingType(meeting.type)
    if (meeting.date && meeting.type === 'weekend_merged') return [`${meeting.date}:weekend`,`${meeting.date}:weekend_s1`]
    return meeting.date && type ? [`${meeting.date}:${type}`] : []
  }))
  const excluded = new Set(Array.isArray(planning.excludedDates) ? planning.excludedDates : Object.values(planning.excludedDates ?? {}))
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const iso = localDateToIso(cursor)
    if (excluded.has(iso)) continue
    const types: TaskMeetingType[] = []
    if (cursor.getDay() === midweekDow) types.push('midweek')
    if (cursor.getDay() === weekendDow) types.push('weekend')
    if (planning.enableSection1 && cursor.getDay() === weekendS1Dow) types.push('weekend_s1')
    for (const type of types) {
      if (existing.has(`${iso}:${type}`)) continue
      meetings[`${iso}__${type}`] = { date: iso, type, assignments: {}, manualEdits: {} }
    }
  }
  return { periodId, periods: { ...periods, [periodId]: { ...current, meetings } } }
}

export function computeGeneration(
  context: TaskDomainContext,
  startDate: string,
  roleFilter: TaskRole | null,
  generatedAt: string,
  targetPeriodId?: string,
  options?: Partial<TaskGenerationRules>,
): GenerationResult {
  const rules = normalizeTaskGenerationRules(options ?? context.engineRules)
  context = { ...context, engineRules:rules }
  const targets = meetingEntries(context.periods)
    .filter(entry => (!targetPeriodId || entry.periodId === targetPeriodId) && entry.meeting.date && entry.meeting.date >= startDate && canonicalMeetingType(entry.meeting.type) && !meetingIsBlocked(context, entry.meeting))
    .sort((a, b) => String(a.meeting.date).localeCompare(String(b.meeting.date)) || a.meetingId.localeCompare(b.meetingId))
  if (!targets.length) return { aborted: true, patch: {}, generated: 0, errors: ['Nenhuma reunião válida encontrada a partir da data informada.'] }
  const locked = [...new Set(targets.filter(entry => context.periods[entry.periodId]?.locked).map(entry => entry.periodId))]
  if (locked.length) return { aborted: true, patch: {}, generated: 0, errors: [`Período travado: ${locked.join(', ')}.`] }

  // A geração consulta as designações já escolhidas no próprio lote. Assim, S1 e S2
  // não podem reservar a mesma pessoa (inclusive por IDs locais com o mesmo masterId).
  const workingPeriods = structuredClone(context.periods)
  for (const entry of targets) {
    const working = workingPeriods[entry.periodId]?.meetings?.[entry.meetingId]
    if (!working) continue
    for (const role of TASK_ROLES) if ((roleFilter === null || roleFilter === role) && entry.meeting.manualEdits?.[role] !== true) {
      delete working.assignments?.[role]
    }
  }
  context = { ...context, periods:workingPeriods }

  const targetKeys = new Set(targets.map(entry => `${entry.periodId}/${entry.meetingId}`))
  const stats: Record<string, PersonStats> = {}
  const groupTotals = groupCounts()
  const countedParticipations = new Set<string>()
  const scopePeriods = new Set(targets.map(entry => entry.periodId))
  const addParticipation = (entry: TaskMeetingEntry, id: string) => {
    if (!scopePeriods.has(entry.periodId)) return
    const key = `${entry.periodId}/${entry.meetingId}/${id}`
    if (countedParticipations.has(key)) return
    countedParticipations.add(key)
    groupTotals[taskGroupForPerson(id, context)] += 1
  }
  const addStat = (id: string, role: TaskRole) => {
    const stat = (stats[id] ??= emptyStats())
    stat.total += 1
    stat.byRole[TASK_ROLE_BASE[role]] += 1
  }
  meetingEntries(context.periods).forEach(entry => TASK_ROLES.forEach(role => {
    const regenerates = targetKeys.has(`${entry.periodId}/${entry.meetingId}`) &&
      (roleFilter === null || roleFilter === role) && entry.meeting.manualEdits?.[role] !== true
    const id = assignmentForRole(entry.meeting, role)
    if (id && !regenerates) { addStat(id, role); addParticipation(entry, id) }
  }))

  const patch: Record<string, unknown> = {}
  const errors: string[] = []
  let generated = 0
  targets.forEach(entry => {
    const finalAssignments = assignmentsWithout(entry.meeting)
    const inScope = (role: TaskRole) =>
      (roleFilter === null || roleFilter === role) &&
      entry.meeting.manualEdits?.[role] !== true
    TASK_ROLES.forEach(role => { if (inScope(role)) delete finalAssignments[role] })
    TASK_ROLES.forEach(role => {
      if (inScope(role) && !roleApplies(role, entry.meeting) && assignmentForRole(entry.meeting, role)) {
        patch[`${entry.periodId}/meetings/${entry.meetingId}/assignments/${role}`] = null
      }
    })
    let reservedSecondary: TaskRole | null = null
    patch[`${entry.periodId}/meetings/${entry.meetingId}/date`] = entry.meeting.date
    patch[`${entry.periodId}/meetings/${entry.meetingId}/type`] = String(entry.meeting.type).toLowerCase() === 'weekend_merged'
      ? 'weekend_merged'
      : canonicalMeetingType(entry.meeting.type)

    TASK_ROLES.forEach(role => {
      if (!inScope(role) || !roleApplies(role, entry.meeting)) return
      if (reservedSecondary === role && finalAssignments[role]) {
        const id = finalAssignments[role]!
        patch[`${entry.periodId}/meetings/${entry.meetingId}/assignments/${role}`] = id
        const working = workingPeriods[entry.periodId]?.meetings?.[entry.meetingId]
        if (working) (working.assignments ??= {})[role] = id
        addStat(id, role)
        addParticipation(entry, id)
        generated += 1
        return
      }
      let candidates = Object.keys(context.people).filter(id => eligibility(id, role, entry.meeting, finalAssignments, context).eligible)
      if (!rules.presidenteSegundaTarefa) candidates = candidates.filter(id => !Object.values(finalAssignments).includes(id))
      if (role === 'presidente' && roleFilter === 'presidente') {
        candidates = candidates.filter(id => PRESIDENT_SECONDARY.some(secondary => finalAssignments[secondary] === id))
      }
      const chosen = rankCandidates(candidates, role, stats, context, rules, groupTotals)[0]
      if (!chosen) {
        patch[`${entry.periodId}/meetings/${entry.meetingId}/assignments/${role}`] = null
        return
      }
      finalAssignments[role] = chosen
      const working = workingPeriods[entry.periodId]?.meetings?.[entry.meetingId]
      if (working) (working.assignments ??= {})[role] = chosen
      patch[`${entry.periodId}/meetings/${entry.meetingId}/assignments/${role}`] = chosen
      addStat(chosen, role)
      addParticipation(entry, chosen)
      generated += 1

      if (rules.presidenteSegundaTarefa && role === 'presidente' && roleFilter === null) {
        reservedSecondary = PRESIDENT_SECONDARY.find(secondary =>
          inScope(secondary) && roleApplies(secondary, entry.meeting) &&
          eligibility(chosen, secondary, entry.meeting, finalAssignments, context).eligible,
        ) ?? null
        if (reservedSecondary) finalAssignments[reservedSecondary] = chosen
      }
    })
    errors.push(...validateMeeting(entry, finalAssignments, context, new Set(TASK_ROLES.filter(inScope))))
  })

  if (errors.length) return { aborted: true, patch: {}, generated: 0, errors: [...new Set(errors)] }
  targets.forEach(entry => { patch[`${entry.periodId}/generatedAt`] = generatedAt })
  const generatedRoles = roleFilter ? [roleFilter] : TASK_ROLES
  ;[...new Set(targets.map(entry => entry.periodId))].forEach(periodId => {
    generatedRoles.forEach(role => { patch[`${periodId}/generatedCols/${role}`] = true })
    const groupTargets = normalizeTaskGroupTargets(context.groupTargets)
    patch[`${periodId}/appliedRules`] = groupTargets.enabled ? { ...rules, groupTargets, version:2 } : { ...rules, version:1 }
  })
  return { aborted: false, patch, generated, errors: [] }
}

export function manualConflictReason(context: TaskDomainContext, entry: TaskMeetingEntry, role: TaskRole, personId: string): string | null {
  if (!personId) return null
  return eligibility(personId, role, entry.meeting, assignmentsWithout(entry.meeting, role), context).reason
}
