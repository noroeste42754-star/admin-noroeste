import type { AppContext, RawRoot } from '../types'
import { parseAgendaHistory, updateAgendaHistory, type AgendaHistory } from './agenda-changes'
import { addCivilDays, fortalezaToday, fortalezaCurrentMonth } from './civil-date'
import { AGENDA_SOURCES, mergeAgendaSources } from './agenda-sync'
import { get, pessoasRef } from '../firebase'
import { apiJson } from '../secure-api.ts'
import { moduleTitle } from '../ui/module-header'
import { agendaMessage, agendaToIcs, boardCleaningMessage, boardMeetingDates, boardMeetingEvents, boardMeetingMessage, collectAgendaEvents, collectAnnouncementEvents, upcomingAgendaEvents, type AgendaEvent, type AgendaSource, type AgendaStatus, type AnnouncementEvent } from './individual-domain'
import type { AgendaConfig, AgendaPublicDocument, MasterPessoa } from '../types'
import { agendaCacheNeedsSync, agendaUiStorageKey, defaultAgendaUiPreferences, parseAgendaUiPreferences, type AgendaScreen, type BoardPanel, type PersonalPanel } from './individual-preferences.ts'
import { groupPublicDocuments, publicDocumentMonths, PUBLIC_PDF_MODULES, type PublicPdfModule } from './agenda-documents-domain.ts'

let ctx: AppContext | null = null
let data: RawRoot = {}
let month = fortalezaCurrentMonth()
let failedSources:string[]=[]
let syncGeneration=0
let screen: 'agenda' | 'geral' | 'quadro' = 'agenda'
let generalSelectedDate = ''
let personalWeekDate = fortalezaToday()
let personalSelectedDate = fortalezaToday()
let boardDocumentPeriod = month
let boardMeetingDate = ''
let uiPreferences = defaultAgendaUiPreferences(month)
let uiPreferencesKey = ''
let selectedPersonId = ''
let lastSuccessfulSync:number|null=null
let loadingAssignments = true
let offlinePersonalEvents: AgendaEvent[] | null = null
let offlineAnnouncementEvents: AnnouncementEvent[] | null = null
let personalDatesOpen = false

const OFFLINE_CACHE_KEY = 'noroeste_agenda_offline_v3'
const ADMIN_PERSON_KEY = 'noroeste_agenda_admin_person_v1'
const DAILY_SYNC_MS = 24 * 60 * 60 * 1000

interface OfflineAgendaCache {
  masterId: string
  savedAt: number
  person?: MasterPessoa
  events: AgendaEvent[]
  announcements: AnnouncementEvent[]
  agenda: Record<string, unknown>
}

interface AgendaDataResponse {
  completedSources?:string[]
  failedSources?:string[]
  masterId: string
  person?: Pick<MasterPessoa, 'name' | 'active'>
  events: AgendaEvent[]
  announcements: AnnouncementEvent[]
  agenda: Record<string, unknown>
}

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] ?? char))
const labelDate = (date: string): string => date.split('-').reverse().join('/')
const sourceLabels: Record<AgendaSource, string> = { tarefas:'Tarefas', oradores:'Oradores', limpeza:'Limpeza', escala:'Escala TPL', servicoCampo:'Serviço de Campo' }
const documentSourceLabels: Record<PublicPdfModule, string> = { tarefas:'Tarefas', oradores:'Oradores', limpeza:'Limpeza', escala:'Escala TPL', servicoCampo:'Serviço de Campo' }
const fortalezaDate = fortalezaToday

export default function mount(context: AppContext): void {
  ctx = context
  syncGeneration++
  lastSuccessfulSync=null
  failedSources=[]
  data={}
  uiPreferencesKey = ''
  uiPreferences = defaultAgendaUiPreferences(fortalezaDate().slice(0, 7))
  loadingAssignments = true
  offlinePersonalEvents = null
  offlineAnnouncementEvents = null
  personalDatesOpen = false
  const root = document.getElementById('appContent')
  if (!root) return
  root.innerHTML = '<div id="individualRoot"><p class="empty-state">Carregando sua agenda...</p></div>'
  const cached = standaloneAgenda() ? readOfflineCache(context.usuario.masterId ?? '') : null
  if (cached) {
    lastSuccessfulSync=cached.savedAt
    offlinePersonalEvents = cached.events
    offlineAnnouncementEvents = cached.announcements
    data = { master:{ pessoas:cached.person ? { [cached.masterId]:cached.person } : {} }, agenda:cached.agenda } as RawRoot
    loadingAssignments = agendaCacheNeedsSync(cached.savedAt, Date.now(), DAILY_SYNC_MS)
    render()
    if (!loadingAssignments) return
  }
  void load()
}

function standaloneAgenda(): boolean { return ctx?.uid.startsWith('agenda-') === true }
function offlineCacheKey(masterId: string): string { return `${OFFLINE_CACHE_KEY}:${masterId}` }

function historyKey(masterId:string):string { return `noroeste_agenda_history_v1:${masterId}` }
function readAgendaHistory(masterId:string):AgendaHistory | null {
  try {
    return parseAgendaHistory(localStorage.getItem(historyKey(masterId)))
  } catch { return null }
}
function recordAgendaHistory(masterId:string, events:AgendaEvent[]):void {
  if (!masterId) return
  try { localStorage.setItem(historyKey(masterId), JSON.stringify(updateAgendaHistory(readAgendaHistory(masterId), events, new Date().toISOString(), fortalezaDate()))) } catch { /* Histórico local indisponível não bloqueia a agenda. */ }
}
function historyPanel():string {
  const changes = readAgendaHistory(selectedMasterId())?.changes ?? []
  if (!changes.length) return ''
  return `<details class="form-panel"><summary>Alterações e retiradas (${changes.length})</summary><p class="notice">Histórico deste aparelho, desde a primeira sincronização. Retirado significa que o compromisso deixou de constar na sua agenda; pode ter sido cancelado ou reatribuído. O ICS já importado não é atualizado automaticamente.</p>${changes.map(change => {
    const event = change.after ?? change.before
    if (!event) return ''
    const label = change.kind === 'retirado' ? 'Retirado da sua agenda' : change.kind === 'alterado' ? 'Alterado' : 'Adicionado'
    return `<article class="agenda-event"><time>${esc(labelDate(event.date))}</time><div><strong>${esc(label)} · ${esc(event.title)}</strong><small>${esc(event.detail)}${event.time ? ` · ${esc(event.time)}` : ''}${event.location ? ` · ${esc(event.location)}` : ''}</small>${change.kind === 'alterado' && change.before ? `<p>Antes: ${esc(labelDate(change.before.date))} ${esc(change.before.time ?? '')} · ${esc(change.before.detail)} · ${esc(change.before.location ?? '')}</p>` : ''}<small>Detectado em ${esc(labelDate(change.detectedAt.slice(0,10)))}</small></div></article>`
  }).join('') || '<p>Nenhuma alteração detectada neste aparelho.</p>'}</details>`
}

function captureUiPreferences(): void {
  uiPreferences.screen = screen
  if (screen === 'agenda') Object.assign(uiPreferences.personal, { month, weekDate:personalWeekDate, selectedDate:personalSelectedDate })
  if (screen === 'geral') Object.assign(uiPreferences.general, { month, selectedDate:generalSelectedDate })
  Object.assign(uiPreferences.board, { meetingDate:boardMeetingDate, documentPeriod:boardDocumentPeriod })
}

function applyScreenPreferences(nextScreen: AgendaScreen): void {
  screen = nextScreen
  if (screen === 'agenda') { month = uiPreferences.personal.month; personalWeekDate = uiPreferences.personal.weekDate || fortalezaDate(); personalSelectedDate = uiPreferences.personal.selectedDate || fortalezaDate() }
  if (screen === 'geral') { month = uiPreferences.general.month; generalSelectedDate = uiPreferences.general.selectedDate }
}

function ensureUiPreferences(): void {
  const masterId = selectedMasterId()
  if (!masterId) return
  const nextKey = agendaUiStorageKey(masterId, standaloneAgenda() ? 'standalone' : 'admin')
  if (nextKey === uiPreferencesKey) return
  uiPreferencesKey = nextKey
  uiPreferences = parseAgendaUiPreferences(localStorage.getItem(nextKey), fortalezaDate().slice(0, 7))
  boardMeetingDate = uiPreferences.board.meetingDate
  boardDocumentPeriod = uiPreferences.board.documentPeriod
  // Abrir sempre nas próximas designações, mesmo se a última visita foi ao Quadro.
  applyScreenPreferences('agenda')
}

function persistUiPreferences(): void {
  if (!uiPreferencesKey) return
  captureUiPreferences()
  uiPreferences.updatedAt = Date.now()
  try { localStorage.setItem(uiPreferencesKey, JSON.stringify(uiPreferences)) } catch { /* Preferências locais não impedem o uso online. */ }
}

function setPanelOpen(panel: PersonalPanel | BoardPanel, open: boolean): void {
  const panels = panel === 'calendar' || panel === 'sharing' ? uiPreferences.personal.openPanels : uiPreferences.board.openPanels
  const next = new Set<string>(panels)
  open ? next.add(panel) : next.delete(panel)
  if (panel === 'calendar' || panel === 'sharing') uiPreferences.personal.openPanels = [...next] as PersonalPanel[]
  else uiPreferences.board.openPanels = [...next] as BoardPanel[]
  persistUiPreferences()
}

function bindPersistentPanels(): void {
  document.querySelectorAll<HTMLDetailsElement>('details[data-agenda-panel]').forEach(details => details.addEventListener('toggle', () => setPanelOpen(details.dataset['agendaPanel'] as PersonalPanel | BoardPanel, details.open)))
}

function readOfflineCache(masterId: string): OfflineAgendaCache | null {
  try {
    const cached = JSON.parse(localStorage.getItem(offlineCacheKey(masterId)) ?? 'null') as OfflineAgendaCache | null
    return cached?.masterId === masterId && Array.isArray(cached.events) && Array.isArray(cached.announcements) ? cached : null
  } catch { return null }
}

function saveOfflineCache(): void {
  const masterId = selectedMasterId()
  if (!standaloneAgenda() || !masterId) return
  const agenda = agendaRoot()
  const publicAgenda = { config:agenda['config'] ?? {}, documentos:agenda['documentos'] ?? {} }
  const person = people()[masterId]
  const safePerson = person ? { name:person.name, active:person.active, sex:person.sex, role:person.role, whatsapp:'', limpeza:{ grupo:null } } satisfies MasterPessoa : undefined
  const snapshot: OfflineAgendaCache = {
    masterId, savedAt:Date.now(), person:safePerson,
    events:offlinePersonalEvents ?? collectAgendaEvents(data, masterId),
    announcements:offlineAnnouncementEvents ?? collectAnnouncementEvents(data),
    agenda:publicAgenda,
  }
  try { localStorage.setItem(offlineCacheKey(masterId), JSON.stringify(snapshot)); offlinePersonalEvents = snapshot.events; offlineAnnouncementEvents = snapshot.announcements }
  catch { /* O app continua online-first se o dispositivo não aceitar o cache. */ }
}

async function load(retrySources?:string[]):Promise<void> {
  const generation=++syncGeneration
  loadingAssignments=true
  try {
    if(isAdmin()&&!Object.keys(people()).length) {
      const snapshot=await get< Record<string,MasterPessoa> >(pessoasRef)
      if(generation!==syncGeneration)return
      data={master:{pessoas:snapshot.val()??{}}} as RawRoot
      ensureSelectedPerson()
    }
    const masterId=selectedMasterId()
    if(!masterId)throw new Error('Pessoa não vinculada')
    const query=new URLSearchParams({masterId,...(standaloneAgenda()?{device:'true'}:{}),...(retrySources?{sources:retrySources.join(',')}:{})})
    const response=await apiJson<AgendaDataResponse>('agenda-data?'+query)
    if(generation!==syncGeneration||masterId!==selectedMasterId())return
    if(response.masterId!==masterId||!Array.isArray(response.events)||!Array.isArray(response.announcements))throw new Error('Agenda inválida')
    const completed=response.completedSources??[...AGENDA_SOURCES]
    failedSources=[...new Set([...failedSources.filter(source=>!completed.includes(source)),...(response.failedSources??[])])]
    offlinePersonalEvents=mergeAgendaSources(offlinePersonalEvents??[],response.events,completed)
    offlineAnnouncementEvents=mergeAgendaSources(offlineAnnouncementEvents??[],response.announcements,completed)
    const person=response.person?{name:response.person.name,active:response.person.active,whatsapp:'',sex:null,role:null,limpeza:{grupo:null}} satisfies MasterPessoa:undefined
    data={...data,master:{pessoas:isAdmin()?people():person?{[masterId]:person}:{}},...(completed.includes('quadro')?{agenda:response.agenda}:{})} as RawRoot
    if(!failedSources.length) {
      lastSuccessfulSync=Date.now()
      recordAgendaHistory(masterId,offlinePersonalEvents)
      saveOfflineCache()
    }
  }catch(error){console.warn('Falha ao sincronizar a agenda:',error instanceof Error?error.message:'erro desconhecido');if(generation===syncGeneration)failedSources=[...new Set([...failedSources,...(retrySources??AGENDA_SOURCES)])]}
  finally {if(generation===syncGeneration){loadingAssignments=false;render()}}
}

function renderSyncNotice():void {
  const host=document.getElementById('individualRoot')
  if(!host||!failedSources.length)return
  host.querySelector('[data-sync-failure]')?.remove()
  const notice=document.createElement('div');notice.className='notice warning';notice.dataset.syncFailure=''
  const labels:Record<string,string>={...sourceLabels,quadro:'Quadro e documentos'}
  const message=document.createElement('p');message.textContent='Agenda parcial. Não foi possível atualizar: '+failedSources.map(source=>labels[source]??source).join(', ')+'. Os últimos dados disponíveis foram preservados.'
  const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent=loadingAssignments?'Tentando novamente…':'Tentar novamente';button.disabled=loadingAssignments
  button.addEventListener('click',()=>{button.disabled=true;void load([...failedSources])})
  notice.append(message,button);host.prepend(notice)
}

function isAdmin(): boolean { return ctx?.usuario.apps.mestre === true }
function selectedMasterId(): string { return isAdmin() ? selectedPersonId || ctx?.usuario.masterId || '' : ctx?.usuario.masterId || '' }
function personalEvents(): AgendaEvent[] { const masterId = selectedMasterId(); return offlinePersonalEvents ?? (masterId ? collectAgendaEvents(data, masterId) : []) }
function announcementEvents(): AnnouncementEvent[] { return offlineAnnouncementEvents ?? collectAnnouncementEvents(data) }
function monthEvents(): AgendaEvent[] { return personalEvents().filter(event => event.date.startsWith(month)) }
function agendaRoot(): Record<string, unknown> { return (data.agenda ?? {}) as Record<string, unknown> }
function agendaConfig(): AgendaConfig { return (agendaRoot()['config'] ?? {}) as AgendaConfig }
function documents(): AgendaPublicDocument[] { return Object.values((agendaRoot()['documentos'] ?? {}) as Record<string, AgendaPublicDocument>) }
function people(): Record<string, MasterPessoa> { return data.master?.pessoas ?? {} }
function ensureSelectedPerson(): void {
  if (!isAdmin() && ctx?.usuario.masterId) { selectedPersonId = ctx.usuario.masterId; return }
  const savedAdminPerson = localStorage.getItem(ADMIN_PERSON_KEY) ?? '', savedPerson = people()[savedAdminPerson]
  if (!selectedPersonId && isAdmin() && savedPerson && savedPerson.active !== false) selectedPersonId = savedAdminPerson
  const selectedPerson = people()[selectedPersonId]
  if (!isAdmin() || (selectedPersonId && selectedPerson && selectedPerson.active !== false)) return
  selectedPersonId = Object.entries(people()).filter(([, person]) => person.active !== false).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR'))[0]?.[0] ?? ''
}
function adminPersonPicker(): string {
  if (!isAdmin()) return ''
  const options = Object.entries(people()).filter(([, person]) => person.active !== false).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR')).map(([id, person]) => `<option value="${esc(id)}" ${selectedPersonId === id ? 'selected' : ''}>${esc(person.name)}</option>`).join('')
  return `<div class="form-panel agenda-admin-person"><label class="form-field"><span>Agenda de</span><select id="adminAgendaPerson">${options}</select></label></div>`
}
function bindAdminPersonPicker(): void {
  const select=document.getElementById('adminAgendaPerson') as HTMLSelectElement|null
  select?.addEventListener('change', event => { persistUiPreferences(); selectedPersonId = (event.target as HTMLSelectElement).value; localStorage.setItem(ADMIN_PERSON_KEY, selectedPersonId); uiPreferencesKey = ''; offlinePersonalEvents=null; offlineAnnouncementEvents=null; failedSources=[]; void load(); render() })
}
function screenTabs(): string {
  if (screen !== 'agenda') return `<button class="btn btn-ghost agenda-return" type="button" data-agenda-screen="agenda">← Minhas designações</button>`
  return `<nav class="agenda-quick-links" aria-label="Outras consultas"><button class="btn btn-ghost" type="button" data-agenda-screen="geral">Programação geral</button><button class="btn btn-ghost" type="button" data-agenda-screen="quadro">Anúncios e PDFs</button></nav>`
}
function bindScreenTabs(): void { document.querySelectorAll<HTMLButtonElement>('[data-agenda-screen]').forEach(button => button.addEventListener('click', () => { captureUiPreferences(); uiPreferences.screen = button.dataset['agendaScreen'] as AgendaScreen; applyScreenPreferences(uiPreferences.screen); persistUiPreferences(); render(); document.getElementById('individualRoot')?.scrollIntoView({ block:'start' }) })) }

function statusLabel(status: AgendaStatus): string {
  return ({ futuro:'Futuro', 'confirmacao-pendente':'Confirmação pendente', alterado:'Alterado', realizado:'Realizado' })[status]
}

function friendlyDate(date:string):string {
  const weekday=new Intl.DateTimeFormat('pt-BR',{weekday:'long',timeZone:'UTC'}).format(new Date(`${date}T12:00:00Z`))
  return `${weekday.charAt(0).toUpperCase()+weekday.slice(1)}, ${labelDate(date)}`
}

function eventRows(events: AgendaEvent[], showDate = true): string {
  return events.map(event => {
    const redundantDetail = event.source === 'servicoCampo' && event.detail === 'Dirigente da saída de campo'
    return `<article class="agenda-event agenda-personal-event"><time>${showDate ? esc(friendlyDate(event.date)) : ''}${event.time ? `${showDate ? ' · ' : ''}${esc(event.time)}` : !showDate ? 'Dia inteiro' : ''}</time><div><strong>${esc(event.title)}</strong>${redundantDetail ? '' : `<small>${esc(event.detail)}</small>`}${event.location ? `<span class="agenda-event-location">${esc(event.location)}</span>` : ''}${event.note ? `<p>${esc(event.note)}</p>` : ''}</div>${event.status === 'futuro' ? '' : `<span class="agenda-status ${event.status}">${esc(statusLabel(event.status))}</span>`}</article>`
  }).join('')
}

function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return addCivilDays(date, -day)
}
function weekDates(date: string): string[] { const first = weekStart(date); return Array.from({length:7}, (_, index) => addCivilDays(first, index)) }
function weekNavigation(date: string, scope: 'personal' | 'general'): string {
  const days = weekDates(date)
  return `<div class="agenda-week-nav"><button class="btn btn-ghost" type="button" data-week-move="-7" aria-label="Semana anterior">‹</button><strong>${esc(labelDate(days[0]!))} – ${esc(labelDate(days[6]!))}</strong><button class="btn btn-ghost" type="button" data-week-move="7" aria-label="Próxima semana">›</button><button class="btn btn-ghost" type="button" data-week-today="${scope}">Hoje</button></div>`
}

function render(): void {
  queueMicrotask(renderSyncNotice)
  const root = document.getElementById('individualRoot')
  if (!root || !ctx) return
  ensureSelectedPerson()
  if (!selectedMasterId()) { root.innerHTML = `${moduleTitle('Minha agenda')}<div class="notice ${loadingAssignments ? '' : 'warning'}">${loadingAssignments ? 'Carregando pessoas e vínculos...' : 'Seu usuário ainda não está vinculado ao cadastro do Admin.'}</div>`; return }
  ensureUiPreferences()
  if (screen === 'geral') { renderGeneralAgenda(root); return }
  if (screen === 'quadro') { renderBoard(root); return }
  const events = monthEvents()
  const future = upcomingAgendaEvents(personalEvents(), fortalezaDate()).sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)), [year, monthNumber] = month.split('-').map(Number)
  const firstDow = new Date(year, monthNumber - 1, 1).getDay(), totalDays = new Date(year, monthNumber, 0).getDate()
  const byDay = new Map<number, AgendaEvent[]>(); events.forEach(event => { const day = Number(event.date.slice(-2)); byDay.set(day, [...(byDay.get(day) ?? []), event]) })
  const calendar = [...Array(firstDow).fill(''), ...Array.from({ length:totalDays }, (_, index) => String(index + 1))]
  const week = weekDates(personalWeekDate)
  if (uiPreferences.personal.view === 'month' && !personalSelectedDate.startsWith(month)) personalSelectedDate = `${month}-01`
  const listEvents = (uiPreferences.personal.view === 'week' ? personalEvents().filter(event => week.includes(event.date)) : events.filter(event => event.date === personalSelectedDate)).sort((a,b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`))
  const lastSync = lastSuccessfulSync ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(lastSuccessfulSync) : ''
  const syncStale = !loadingAssignments && (!lastSuccessfulSync || Date.now()-lastSuccessfulSync > DAILY_SYNC_MS)
  root.innerHTML = `${moduleTitle('Minha agenda')}${loadingAssignments ? '<div class="notice">Atualizando designações dos módulos...</div>' : ''}${adminPersonPicker()}
    ${syncStale ? `<div class="notice warning">Dados possivelmente desatualizados. ${lastSync ? `Última sincronização: ${esc(lastSync)}.` : 'Sincronização ainda não concluída.'}</div>` : ''}
    <h2 class="agenda-section-title">Próximas designações</h2>
    <div class="agenda-list">${eventRows(future.slice(0, 5)) || '<p class="empty-state">Você não tem designações futuras no momento.</p>'}</div>
    ${future.length > 5 ? `<details class="agenda-more-events"><summary>Ver mais ${future.length - 5} designação(ões)</summary><div class="agenda-list">${eventRows(future.slice(5))}</div></details>` : ''}
    ${screenTabs()}
    <details id="agendaOtherDates" class="form-panel agenda-personal-panel" ${personalDatesOpen ? 'open' : ''}><summary><strong>${personalDatesOpen ? 'Voltar às próximas designações' : 'Ver outras datas'}</strong></summary>
    <div class="program-period-modes agenda-view-modes" role="tablist" aria-label="Visualização dos compromissos"><button class="program-period-mode" role="tab" type="button" data-personal-view="week" aria-selected="${uiPreferences.personal.view === 'week'}">Semana</button><button class="program-period-mode" role="tab" type="button" data-personal-view="month" aria-selected="${uiPreferences.personal.view === 'month'}">Mês</button></div>
    ${uiPreferences.personal.view === 'week' ? weekNavigation(personalWeekDate, 'personal') : ''}
    ${uiPreferences.personal.view === 'month' ? `<div class="agenda-toolbar"><button class="btn btn-ghost" id="agendaPrev" type="button" aria-label="Mês anterior">‹</button><label class="sr-only" for="agendaMonth">Mês do calendário pessoal</label><input class="form-input" id="agendaMonth" type="month" value="${month}"><button class="btn btn-ghost" id="agendaNext" type="button" aria-label="Próximo mês">›</button></div><div class="agenda-actions"><button class="btn btn-ghost" id="agendaToday" type="button">Hoje</button></div><div class="agenda-calendar"><div class="agenda-weekdays">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day => `<strong>${day}</strong>`).join('')}</div><div class="agenda-days">${calendar.map(day => {if(!day)return '<div class="agenda-day empty"></div>';const date=`${month}-${day.padStart(2,'0')}`,dayEvents=byDay.get(Number(day))??[];return `<button class="agenda-day agenda-day-button ${dayEvents.length?'has-events':''} ${personalSelectedDate===date?'selected':''}" type="button" data-personal-date="${date}" aria-pressed="${personalSelectedDate===date}" aria-label="${esc(`${friendlyDate(date)}: ${dayEvents.length} compromisso(s)`)}"><span>${day}</span><span class="agenda-day-markers" aria-hidden="true">${dayEvents.slice(0,3).map(event=>`<i class="${event.source}"></i>`).join('')}</span></button>`}).join('')}</div></div>` : ''}
    ${uiPreferences.personal.view === 'month' ? `<div class="agenda-selected-day"><strong>${esc(friendlyDate(personalSelectedDate))}</strong><span>${listEvents.length} item(ns)</span></div>` : ''}
    <div class="agenda-list">${eventRows(listEvents) || `<p class="empty-state">${uiPreferences.personal.view === 'week' ? 'Nenhuma designação nesta semana.' : 'Nenhuma designação nesta data.'}</p>`}</div></details>
    <p class="agenda-sync-meta">${loadingAssignments ? 'Sincronizando…' : lastSync ? `Atualizada em ${esc(lastSync)}` : 'Ainda não sincronizada'}</p>
    ${calendarExportPanel()}${historyPanel()}`
  root.classList.toggle('agenda-browsing-dates', personalDatesOpen)
  bind()
}

function moveMonth(delta: number): void { const [year, value] = month.split('-').map(Number), date = new Date(Date.UTC(year, value - 1 + delta, 1)); month = date.toISOString().slice(0, 7); persistUiPreferences(); render() }
function bindWeekNavigation(scope: 'personal' | 'general'): void {
  document.querySelectorAll<HTMLButtonElement>('[data-week-move]').forEach(button => button.addEventListener('click', () => {
    const delta = Number(button.dataset['weekMove'])
    if (scope === 'personal') personalWeekDate = addCivilDays(personalWeekDate, delta)
    else { generalSelectedDate = addCivilDays(generalSelectedDate || fortalezaDate(), delta); month=generalSelectedDate.slice(0,7) }
    persistUiPreferences(); render()
  }))
  document.querySelector('[data-week-today]')?.addEventListener('click', () => {
    if (scope === 'personal') personalWeekDate = fortalezaDate()
    else { generalSelectedDate = fortalezaDate(); month=generalSelectedDate.slice(0,7) }
    persistUiPreferences(); render()
  })
}
function bind(): void {
  bindScreenTabs()
  bindAdminPersonPicker()
  document.getElementById('agendaOtherDates')?.addEventListener('toggle', event => {
    personalDatesOpen = (event.currentTarget as HTMLDetailsElement).open
    document.getElementById('individualRoot')?.classList.toggle('agenda-browsing-dates', personalDatesOpen)
    const label = (event.currentTarget as HTMLDetailsElement).querySelector('summary strong')
    if (label) label.textContent = personalDatesOpen ? 'Voltar às próximas designações' : 'Ver outras datas'
  })
  document.getElementById('agendaPrev')?.addEventListener('click', () => moveMonth(-1))
  document.getElementById('agendaNext')?.addEventListener('click', () => moveMonth(1))
  document.getElementById('agendaToday')?.addEventListener('click',()=>{month=fortalezaDate().slice(0,7);personalSelectedDate=fortalezaDate();persistUiPreferences();render()})
  document.getElementById('agendaMonth')?.addEventListener('change', event => { month = (event.target as HTMLInputElement).value || month; persistUiPreferences(); render() })
  document.querySelectorAll<HTMLButtonElement>('[data-personal-date]').forEach(button=>button.addEventListener('click',()=>{personalSelectedDate=button.dataset['personalDate']??personalSelectedDate;persistUiPreferences();render()}))
  document.querySelectorAll<HTMLButtonElement>('[data-personal-view]').forEach(button => button.addEventListener('click', () => { uiPreferences.personal.view = button.dataset['personalView'] === 'month' ? 'month' : 'week'; persistUiPreferences(); render() }))
  bindWeekNavigation('personal')
  document.getElementById('agendaIcsMonth')?.addEventListener('click', () => downloadIcs(monthEvents(), `minha-agenda-${month}.ics`, 'Nenhuma designação disponível neste mês.'))
  document.getElementById('agendaIcsUpcoming')?.addEventListener('click', () => downloadIcs(upcomingAgendaEvents(personalEvents(), fortalezaDate()), 'minha-agenda-proximos-compromissos.ics', 'Nenhum compromisso futuro disponível.'))
  document.getElementById('agendaShare')?.addEventListener('click', openShare)
  bindPersistentPanels()
}

function renderGeneralAgenda(root: HTMLElement): void {
  const today = fortalezaDate()
  const events = announcementEvents().filter(event => event.date.startsWith(month))
  const [year, monthNumber] = month.split('-').map(Number), firstDow = new Date(year, monthNumber - 1, 1).getDay(), totalDays = new Date(year, monthNumber, 0).getDate()
  const byDay = new Map<number, AnnouncementEvent[]>(); events.forEach(event => { const day = Number(event.date.slice(-2)); byDay.set(day, [...(byDay.get(day) ?? []), event]) })
  const calendar = [...Array(firstDow).fill(''), ...Array.from({ length:totalDays }, (_, index) => String(index + 1))]
  if (!generalSelectedDate) { generalSelectedDate = today; persistUiPreferences() }
  if (uiPreferences.general.view === 'month' && !generalSelectedDate.startsWith(month)) { generalSelectedDate = events.find(event => event.date >= today)?.date ?? events[0]?.date ?? `${month}-01`; persistUiPreferences() }
  const selectedEvents = events.filter(event => event.date === generalSelectedDate)
  const visibleSources = [...new Set(events.map(event => event.source))]
  const week = weekDates(generalSelectedDate)
  const weekEvents = announcementEvents().filter(event => week.includes(event.date)).sort((a,b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`))
  root.innerHTML = `${moduleTitle('Programação geral')}${screenTabs()}${loadingAssignments ? '<div class="notice">Atualizando designações dos módulos...</div>' : ''}
    <div class="program-period-modes agenda-view-modes" role="tablist" aria-label="Visualização da agenda geral"><button class="program-period-mode" role="tab" type="button" data-general-view="week" aria-selected="${uiPreferences.general.view === 'week'}">Semana</button><button class="program-period-mode" role="tab" type="button" data-general-view="month" aria-selected="${uiPreferences.general.view === 'month'}">Mês</button></div>
    ${uiPreferences.general.view === 'week' ? weekNavigation(generalSelectedDate, 'general') : ''}
    ${uiPreferences.general.view === 'week' ? `<div class="agenda-list">${weekEvents.map(event => `<article class="agenda-event"><time>${esc(labelDate(event.date))}${event.time ? ` · ${esc(event.time)}` : ''}</time><div><strong>${esc(event.title)}</strong><small><span class="agenda-source ${event.source}">${esc(sourceLabels[event.source])}</span> · ${esc(event.detail)}${event.location ? ` · ${esc(event.location)}` : ''}</small><p>${esc(event.people.join(', '))}</p></div><span class="agenda-status ${event.status}">${esc(statusLabel(event.status))}</span></article>`).join('') || '<p class="empty-state">Nenhum compromisso nesta semana.</p>'}</div>` : ''}
    ${uiPreferences.general.view === 'month' ? `
    <div class="agenda-toolbar"><button class="btn btn-ghost" id="generalPrev" type="button" aria-label="Mês anterior">‹</button><label class="sr-only" for="generalMonth">Mês da agenda geral</label><input class="form-input" id="generalMonth" type="month" value="${month}"><button class="btn btn-ghost" id="generalNext" type="button" aria-label="Próximo mês">›</button></div>
    <div class="agenda-actions"><button class="btn btn-ghost" id="generalToday" type="button">Hoje</button><button class="btn btn-ghost" id="generalIcsMonth" type="button">Baixar calendário</button></div>
    <div class="agenda-source-legend" aria-label="Cores dos módulos">${visibleSources.map(source => `<span><i class="${source}" aria-hidden="true"></i>${esc(sourceLabels[source])}</span>`).join('')}</div>
    <div class="agenda-calendar"><div class="agenda-weekdays">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(day => `<strong>${day}</strong>`).join('')}</div><div class="agenda-days">${calendar.map(day => { if (!day) return '<div class="agenda-day empty"></div>'; const date = `${month}-${day.padStart(2, '0')}`, dayEvents = byDay.get(Number(day)) ?? [], sources = [...new Set(dayEvents.map(event => event.source))], accessible = dayEvents.length ? `${day}/${monthNumber}, ${dayEvents.length} ${dayEvents.length === 1 ? 'item' : 'itens'}: ${sources.map(source => sourceLabels[source]).join(', ')}` : `${day}/${monthNumber}, sem itens`; return `<button class="agenda-day agenda-day-button ${dayEvents.length ? 'has-events' : ''} ${generalSelectedDate === date ? 'selected' : ''}" type="button" data-general-date="${date}" aria-label="${esc(accessible)}"><span>${day}</span><span class="agenda-day-markers" aria-hidden="true">${dayEvents.slice(0, 3).map(event => `<i class="${event.source}"></i>`).join('')}${dayEvents.length > 3 ? `<b>+${dayEvents.length - 3}</b>` : ''}</span></button>` }).join('')}</div></div>
    <div class="agenda-selected-day"><strong>${esc(labelDate(generalSelectedDate))}</strong><span>${selectedEvents.length} item(ns)</span></div>
    <div class="agenda-list">${selectedEvents.map(event => `<article class="agenda-event"><time>${event.time ? esc(event.time) : 'Dia inteiro'}</time><div><strong>${esc(event.title)}</strong><small><span class="agenda-source ${event.source}">${esc(sourceLabels[event.source])}</span> · ${esc(event.detail)}${event.location ? ` · ${esc(event.location)}` : ''}</small><p>${esc(event.people.join(', '))}</p></div><span class="agenda-status ${event.status}">${esc(statusLabel(event.status))}</span></article>`).join('') || '<p class="empty-state">Nenhuma designação nesta data.</p>'}</div>` : ''}`
  bindScreenTabs()
  document.querySelectorAll<HTMLButtonElement>('[data-general-view]').forEach(button => button.addEventListener('click', () => { uiPreferences.general.view = button.dataset['generalView'] === 'month' ? 'month' : 'week'; if(uiPreferences.general.view==='month')month=generalSelectedDate.slice(0,7);persistUiPreferences(); render() }))
  bindWeekNavigation('general')
  document.getElementById('generalPrev')?.addEventListener('click', () => moveMonth(-1))
  document.getElementById('generalNext')?.addEventListener('click', () => moveMonth(1))
  document.getElementById('generalToday')?.addEventListener('click',()=>{generalSelectedDate=fortalezaDate();month=generalSelectedDate.slice(0,7);persistUiPreferences();render()})
  document.getElementById('generalMonth')?.addEventListener('change', event => { month = (event.target as HTMLInputElement).value || month; persistUiPreferences(); render() })
  document.getElementById('generalIcsMonth')?.addEventListener('click', () => downloadBoardIcs(events))
  document.querySelectorAll<HTMLButtonElement>('[data-general-date]').forEach(button => button.addEventListener('click', () => { generalSelectedDate = button.dataset['generalDate'] ?? generalSelectedDate; persistUiPreferences(); render() }))
}

function calendarExportPanel(): string {
  return `<details class="form-panel agenda-board-card agenda-personal-panel" data-agenda-panel="sharing" ${uiPreferences.personal.openPanels.includes('sharing') ? 'open' : ''}><summary><strong>Exportar ou compartilhar</strong></summary><div class="agenda-board-body"><div class="agenda-actions agenda-sharing-actions"><button class="btn btn-primary" id="agendaIcsMonth" type="button">Baixar mês</button><button class="btn btn-ghost" id="agendaIcsUpcoming" type="button">Baixar próximos</button><button class="btn btn-ghost" id="agendaShare" type="button">Compartilhar</button></div></div></details>`
}

function renderBoard(root: HTMLElement): void {
  const allEvents = announcementEvents()
  const meetingDates = boardMeetingDates(allEvents, fortalezaDate())
  if (!meetingDates.some(item => item.date === boardMeetingDate)) { boardMeetingDate = meetingDates[0]?.date ?? ''; persistUiPreferences() }
  const selectedMeeting = meetingDates.find(item => item.date === boardMeetingDate)
  const meetingEvents = boardMeetingEvents(allEvents, selectedMeeting)
  const hasCleaning = meetingEvents.some(event => event.source === 'limpeza')
  const boardSettings=agendaConfig().moduleWhatsApp?.quadro
  const meetingData=boardMeetingMessage(meetingEvents,selectedMeeting)
  const boardText=(boardSettings?.meetingText?.trim()||'{dados_da_reuniao}').replace('{dados_da_reuniao}',meetingData)
  const boardGroupLink=boardSettings?.groupLink?.trim()||agendaConfig().quadroWhatsAppLink?.trim()||''
  const allDocuments = documents().sort((a, b) => b.criadoEm.localeCompare(a.criadoEm)), periods = publicDocumentMonths(allDocuments)
  if (!periods.includes(boardDocumentPeriod)) { boardDocumentPeriod = periods[0] ?? fortalezaDate().slice(0, 7); persistUiPreferences() }
  const visibleDocuments = groupPublicDocuments(allDocuments, boardDocumentPeriod)
  const otherAnnouncementsUrl = agendaConfig().outrosAnunciosDriveUrl?.trim() ?? ''
  const meetingSummary = selectedMeeting ? `${labelDate(selectedMeeting.date)} · ${selectedMeeting.kind === 'midweek' ? 'Meio de semana' : 'Fim de semana'}` : 'Nenhuma reunião futura'
  root.innerHTML = `${moduleTitle('Anúncios e PDFs')}${screenTabs()}${loadingAssignments ? '<div class="notice">Atualizando designações dos módulos...</div>' : ''}
    <div class="agenda-board-sections">
      <details class="form-panel agenda-board-card" data-agenda-panel="meetings" ${uiPreferences.board.openPanels.includes('meetings') ? 'open' : ''}><summary><strong>Texto da reunião</strong><span>${esc(meetingSummary)}</span></summary><div class="agenda-board-body"><label class="form-field"><span>Reunião</span><select id="boardMeetingDate">${meetingDates.map(item => `<option value="${esc(item.date)}" ${item.date === boardMeetingDate ? 'selected' : ''}>${esc(labelDate(item.date))} · ${item.kind === 'midweek' ? 'Meio de semana' : 'Fim de semana'}</option>`).join('') || '<option value="">Nenhuma reunião futura</option>'}</select></label><textarea id="boardInlineDraft" class="form-input" rows="8" maxlength="4000" aria-label="Texto da reunião para copiar">${esc(boardText)}</textarea><div class="agenda-actions"><button class="btn btn-ghost" id="boardInlineCopy" type="button">Copiar texto</button>${hasCleaning ? '<button class="btn btn-ghost" id="boardCleaningCopy" type="button">Copiar limpeza</button>' : ''}${boardGroupLink?'<button class="btn btn-primary" id="boardWhatsOpen" type="button">Copiar e abrir grupo</button>':''}</div></div></details>
      <details class="form-panel agenda-board-card" data-agenda-panel="moduleDocuments" ${uiPreferences.board.openPanels.includes('moduleDocuments') ? 'open' : ''}><summary><strong>PDFs dos módulos</strong><span>${Object.keys(visibleDocuments.modules).length} publicado(s)</span></summary><div class="agenda-board-body"><label class="form-field"><span>Período</span><select id="boardDocumentPeriod">${periods.map(period => `<option value="${esc(period)}" ${period === boardDocumentPeriod ? 'selected' : ''}>${esc(formatDocumentMonth(period))}</option>`).join('') || `<option value="${esc(boardDocumentPeriod)}">${esc(formatDocumentMonth(boardDocumentPeriod))}</option>`}</select></label><div class="agenda-module-downloads">${PUBLIC_PDF_MODULES.filter(module=>visibleDocuments.modules[module]).map(module => moduleDownloadRow(module, visibleDocuments.modules[module])).join('') || '<p class="empty-state">Nenhum PDF publicado neste período.</p>'}</div></div></details>
      ${otherAnnouncementsUrl ? `<a class="btn btn-primary agenda-other-announcements" href="${esc(otherAnnouncementsUrl)}" target="_blank" rel="noopener noreferrer">Abrir outros anúncios</a>` : '<p class="empty-state">A pasta de outros anúncios ainda não foi configurada.</p>'}
    </div>`
  const sections = root.querySelector('.agenda-board-sections')!
  const moduleDocuments = sections.querySelector('[data-agenda-panel="moduleDocuments"]')!
  sections.prepend(moduleDocuments)
  bindScreenTabs()
  document.getElementById('boardMeetingDate')?.addEventListener('change', event => { boardMeetingDate = (event.target as HTMLSelectElement).value; persistUiPreferences(); render() })
  document.getElementById('boardDocumentPeriod')?.addEventListener('change', event => { boardDocumentPeriod = (event.target as HTMLSelectElement).value; persistUiPreferences(); render() })
  const copyFeedback=async(button:HTMLButtonElement,text:string):Promise<void>=>{const original=button.textContent;try{await navigator.clipboard.writeText(text);button.textContent='Copiado'}catch{button.textContent='Selecione e copie o texto'}setTimeout(()=>{if(button.isConnected)button.textContent=original},1800)}
  document.getElementById('boardInlineCopy')?.addEventListener('click', event => void copyFeedback(event.currentTarget as HTMLButtonElement,(document.getElementById('boardInlineDraft') as HTMLTextAreaElement).value))
  document.getElementById('boardCleaningCopy')?.addEventListener('click', event => void copyFeedback(event.currentTarget as HTMLButtonElement,boardCleaningMessage(meetingEvents)))
  document.getElementById('boardWhatsOpen')?.addEventListener('click',event=>{void copyFeedback(event.currentTarget as HTMLButtonElement,(document.getElementById('boardInlineDraft') as HTMLTextAreaElement).value);window.open(boardGroupLink,'_blank','noopener')})
  bindPersistentPanels()
}

function formatDocumentMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value
  const label = new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${value}-15T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function moduleDownloadRow(module: PublicPdfModule, item?: AgendaPublicDocument): string {
  const label = documentSourceLabels[module]
  const actions = item
    ? `<div class="agenda-module-download-actions"><a class="btn btn-primary" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer" download="${esc(item.nome)}">Baixar PDF</a></div>`
    : '<button class="btn btn-primary" type="button" disabled>Baixar PDF</button>'
  return `<div class="agenda-module-download"><span><strong>${esc(label)}</strong><small>${item ? esc(item.periodo) : 'Ainda não publicado'}</small></span>${actions}</div>`
}


function boardReminderOptions(): Partial<Record<AgendaSource, string[]>> {
  const values = agendaConfig().icsReminders?.quadro ?? []
  return Object.fromEntries(Object.keys(sourceLabels).map(source => [source, source === 'servicoCampo' ? [] : values])) as Partial<Record<AgendaSource, string[]>>
}

function downloadBoardIcs(events: AgendaEvent[]): void {
  if (!events.length) { alert('Nenhuma designação disponível neste mês.'); return }
  const blob = new Blob([agendaToIcs(events, new Date().toISOString(), { reminders:boardReminderOptions(), calendarName:'Quadro de anúncios Noroeste', namespace:'noroeste-quadro' })], { type:'text/calendar;charset=utf-8' }), link = document.createElement('a')
  link.href = URL.createObjectURL(blob); link.download = `quadro-anuncios-${month}.ics`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}


function downloadIcs(events: AgendaEvent[], filename: string, emptyMessage: string): void {
  if (!events.length) { alert(emptyMessage); return }
  const blob = new Blob([agendaToIcs(events, new Date().toISOString(), { reminders:agendaConfig().icsReminders, calendarName:'Minha agenda Noroeste' })], { type:'text/calendar;charset=utf-8' }), link = document.createElement('a')
  link.href = URL.createObjectURL(blob); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

function openShare(): void {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal"><h2>Compartilhar agenda</h2><textarea id="agendaDraft" class="form-input" rows="10" maxlength="2000">${esc(agendaMessage(monthEvents()))}</textarea><div class="module-row-actions"><button class="btn btn-ghost" id="agendaCopy">Copiar</button><button class="btn btn-ghost" id="agendaClose">Fechar</button></div></div>`
  document.body.appendChild(overlay)
  document.getElementById('agendaClose')?.addEventListener('click', () => overlay.remove())
  document.getElementById('agendaCopy')?.addEventListener('click', () => void navigator.clipboard.writeText((document.getElementById('agendaDraft') as HTMLTextAreaElement).value))
}
