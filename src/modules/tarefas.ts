import { focusCorrection } from '../ui/field-guidance'
import { localPreferences, persistDisclosures } from '../ui/local-preferences'
import { substitutionDialog } from '../ui/substitution-dialog'
import { confirmAdvisoryWarnings } from '../ui/advisory-confirmation'
import { closeRecordEditor, mountRecordEditor } from '../ui/record-editor'
import { taskSubstitutes } from './substitution-domain'
import { canonicalTaskPerson } from './central-person'
import { fortalezaToday, fortalezaCurrentMonth, isValidCivilDate, nextCivilMonth } from './civil-date'
import { tasksPersonMessage, tasksDayMessage } from './tarefas-messages'
import { copyMessageText, openMessageWhatsApp } from '../ui/message-actions'
import { editorBusy, editorError } from '../ui/editor-feedback'
import { lockPublicationUi } from '../ui/publication-busy'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import type { AppContext } from '../types'
import {
  get,
  compareAndUpdate,
  update,
  tarefasRef,
  agendaConfigRef, child,
  tarefasDiscursosRef,
  tarefasPeopleRef,
  tarefasPlanejamentoRef,
  tarefasScaleRef,
  configCongregacaoRef,
  pessoasRef,
} from '../firebase'
import { renderMenuCards, type ItemMenu } from '../ui/menu-cards'
import { moduleBackButton } from '../ui/module-header'
import {
  TASK_ROLES,
  TASK_ROLE_LABELS,
  DEFAULT_TASK_GENERATION_RULES,
  TASK_GROUPS,
  TASK_GROUP_LABELS,
  assignmentForRole,
  canonicalMeetingType,
  computeGeneration,
  manualConflictReason,
  meetingEntries,
  periodKeyForDate,
  personIsActive,
  personName,
  personPhone,
  roleApplies,
  normalizeTaskGenerationRules,
  normalizeTaskGroupTargets,
  summarizeTaskGroups,
  validTaskGroupTargets,
  withCanonicalPeriod,
  type TaskDomainContext,
  type TaskEvent,
  type TaskGenerationRules,
  type TaskGroupTargets,
  type TaskGroupSummary,
  type TaskMeeting,
  type TaskPeriod,
  type TaskPerson,
  type TaskRole,
} from './tarefas-domain'
import { formatTaskDate } from './tarefas-output'
import { publishModulePeriod, renderPublicationStatus } from './module-publication'
import { defaultModuleMessageSettings, mountModuleMessageSettings, type ModuleMessageSettings } from './module-message-settings'
import { ApiError } from '../secure-api'

type TarefasTab = 'indice' | 'escala' | 'participantes' | 'config'

const PRINT_FONT_KEY = 'noroeste_tarefas_print_font_pt'
const PRINT_MIN_PT = 8
const PRINT_MAX_PT = 22
const PRINT_DEFAULT_PT = 14

type TarefasPessoa = TaskPerson
type TarefasMeeting = TaskMeeting
type TarefasPeriod = TaskPeriod

interface TarefasPlanning {
  scaleStartDate?: string
  generatedAt?: string
  periodMode?: 'month' | 'bimester'
  editingPeriod?: string
  meetingDays?: { midweekDow?: number; weekendDow?: number; weekendS1Dow?: number }
  midweekDow?: number
  weekendDow?: number
  weekendS1Dow?: number
  enableSection1?: boolean
  excludedDates?: string[] | Record<string, string>
  engineRules?: Partial<TaskGenerationRules>
  groupTargets?: Partial<TaskGroupTargets>
  availabilityReviewedMonth?: string
}

interface PendingTarget {
  periodId?: string
  meetingId?: string
  role?: TaskRole
  personId?: string
}

let activeTab: TarefasTab = 'indice'
let pessoas: Record<string, TarefasPessoa> = {}
let periods: Record<string, TarefasPeriod> = {}
let planning: TarefasPlanning = {}
let events: Record<string, TaskEvent> = {}
let discursos: TaskDomainContext['discursos'] = {}
let taskMessageSettings=defaultModuleMessageSettings('tarefas')
let congregationName = 'Noroeste'
let masterPeople: Record<string, { name?: string; whatsapp?: string; active?: boolean; role?: string | null }> = {}
let context: AppContext
let stopDisclosures: (() => void) | undefined
const TAREFAS_PERIOD_KEY = 'noroeste:tarefas:period'
const TAREFAS_PERIOD_MODE_KEY = 'noroeste:tarefas:period-mode'
const TAREFAS_ROLE_KEY = 'noroeste:tarefas:generate-role'

let selectedPeriodMonth = monthNow()
let selectedPeriodMode: 'month' | 'bimester' = 'month'
let selectedGenerateRole = localStorage.getItem(TAREFAS_ROLE_KEY) ?? ''
let participantSearch = ''
let participantMeetingRule = ''
let participantRoleFilter = ''
let pendingTarget: PendingTarget | null = null
let downloadingPdf = false
let changingPublication = false
let generatingTaskScale = false
let loadPromise: Promise<boolean> | null = null


function monthNow(): string {
  return fortalezaCurrentMonth()
}

function toast(msg: string, ms = 2600): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), ms)
}

function escapeHtml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function todayStr(): string {
  return fortalezaToday()
}

function pessoaNome(p: TarefasPessoa, fallback: string): string {
  return personName(p, fallback)
}

function isActive(p: TarefasPessoa): boolean {
  return personIsActive(p)
}

function assignmentCount(meeting: TarefasMeeting): number {
  return TASK_ROLES.filter(role => assignmentForRole(meeting, role)).length
}

const GENERATED_ROLES: readonly TaskRole[] = TASK_ROLES

function meetingAllowsRole(meeting: TarefasMeeting, role: string): boolean {
  return TASK_ROLES.includes(role as TaskRole) && roleApplies(role as TaskRole, meeting)
}

function scaleMeetingEntries(): Array<{ periodId: string; meetingId: string; meeting: TarefasMeeting }> {
  return Object.entries(periods).flatMap(([periodId, period]) =>
    Object.entries(period.meetings ?? {}).map(([meetingId, meeting]) => ({ periodId, meetingId, meeting })),
  )
}

function meetingRefFor(meeting: TarefasMeeting): { periodId: string; meetingId: string } | null {
  const found = scaleMeetingEntries().find(entry => entry.meeting === meeting)
  return found ? { periodId: found.periodId, meetingId: found.meetingId } : null
}

function domainContext(): TaskDomainContext {
  return { people: pessoas, periods, events, discursos, engineRules:planning.engineRules, groupTargets:planning.groupTargets, masterPeople }
}

function formatDate(value: string | undefined): string {
  return formatTaskDate(value)
}

function printFont(): number {
  const saved = Number(localStorage.getItem(PRINT_FONT_KEY))
  if (Number.isFinite(saved)) return Math.min(PRINT_MAX_PT, Math.max(PRINT_MIN_PT, saved))
  return PRINT_DEFAULT_PT
}

function roleLabel(key: string): string {
  if (TASK_ROLES.includes(key as TaskRole)) return TASK_ROLE_LABELS[key as TaskRole]
  const labels: Record<string, string> = {
    operador1: 'Operador',
    operador2: 'Operador',
    mic1: 'Microfone',
    mic2: 'Microfone',
    microfone1: 'Microfone',
    microfone2: 'Microfone',
    presidente: 'Presidente',
    leitor: 'Leitor',
    entrada: 'Entrada',
    auditorio: 'Auditório',
  }
  return labels[key] ?? key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase())
}

function meetingLabel(meeting: TarefasMeeting, compact = false): string {
  const type = canonicalMeetingType(meeting.type)
  if (type === 'midweek') return compact ? 'Meio' : 'Meio de semana'
  if (type === 'weekend_s1') return compact ? '1ª seção' : 'Fim de semana · 1ª seção'
  return compact ? '2ª seção' : 'Fim de semana · 2ª seção'
}

export default function mount(ctx: AppContext): void {
  context = ctx
  activeTab = 'indice'
  loadPromise = null
  pessoas = {}; periods = {}; planning = {}; events = {}; masterPeople = {}
  const el = document.getElementById('appContent')
  if (!el) return

  el.innerHTML = `
    <div id="tarefasRoot">
      <div id="tarefasNav"></div><div id="tarefasContent"></div>
    </div>`
  stopDisclosures?.()
  stopDisclosures=persistDisclosures(document.getElementById('tarefasContent')!,localPreferences(ctx.uid,'tarefas'))
  void openTarefasTab('escala')
}

function ensureLoaded(): Promise<boolean> {
  loadPromise ??= loadTarefas()
  return loadPromise
}

async function loadTarefas(): Promise<boolean> {
  try {
    const [tarefasSnap, congregacaoSnap, masterPeopleSnap, messagesSnap] = await Promise.all([
      get(tarefasRef),
      get(configCongregacaoRef),
      get(pessoasRef),
      get<ModuleMessageSettings>(child(agendaConfigRef,'moduleWhatsApp/tarefas')),
    ])

    const tarefas = tarefasSnap.exists() ? tarefasSnap.val() as {
      people?: Record<string, TarefasPessoa>
      scale?: { periods?: Record<string, TarefasPeriod> }
      planning?: TarefasPlanning
      discursos?: TaskDomainContext['discursos']
      events?: Record<string, TaskEvent>
    } : {}
    taskMessageSettings={...defaultModuleMessageSettings('tarefas'),...(messagesSnap.val()??{})}
    pessoas = tarefas.people ?? {}
    periods = tarefas.scale?.periods ?? {}
    planning = tarefas.planning ?? {}
    const savedPeriod = context.overview?.month ?? localStorage.getItem(TAREFAS_PERIOD_KEY) ?? planning.editingPeriod ?? planning.scaleStartDate?.slice(0, 7)
    delete context.overview
    selectedPeriodMonth = /^\d{4}-\d{2}$/.test(savedPeriod ?? '') ? savedPeriod! : monthNow()
    // Bimonthly records remain in the database for history, but new work is monthly.
    selectedPeriodMode = 'month'
    events = tarefas.events ?? {}
    discursos = tarefas.discursos ?? {}
    const congregacao = congregacaoSnap.exists() ? (congregacaoSnap.val() as { nome?: string }) : {}
    congregationName = congregacao.nome?.trim() || 'Noroeste'
    masterPeople = masterPeopleSnap.exists() ? (masterPeopleSnap.val() as Record<string, { name?: string; whatsapp?: string; active?: boolean; role?: string | null }>) : {}
    pessoas = Object.fromEntries(Object.entries(pessoas).map(([id, person]) => [id, canonicalTaskPerson(id, person, masterPeople)]))
  } catch {
    toast('Erro ao carregar Tarefas')
    return false
  }
  return true
}

async function openTarefasTab(next: TarefasTab): Promise<void> {
  const content = document.getElementById('tarefasContent')
  if (!content) return
  activeTab = next
  renderNavigation()
  content.innerHTML = `${sectionTitle('Tarefas', '')}<p class="empty-state">Carregando dados...</p>`
  const loaded = await ensureLoaded()
  if (!content.isConnected || activeTab !== next) return
  if (!loaded) {
    loadPromise = null
    content.innerHTML = `${sectionTitle('Tarefas', '')}<p class="empty-state">Não foi possível carregar os dados.</p><button id="retryTasks" class="btn btn-primary">Tentar novamente</button>`
    document.getElementById('retryTasks')?.addEventListener('click', () => void openTarefasTab(next))
    return
  }
  activeTab = next
  renderContent()
}

function renderContent(): void {
  renderNavigation()
  if (activeTab === 'indice') {
    renderIndex()
    return
  }
  if (activeTab === 'escala') renderEscala()
  else if (activeTab === 'participantes') renderParticipantes()
  else renderTaskConfig()
}

function renderNavigation(): void {
  const host = document.getElementById('tarefasNav')
  if (host) renderWorkspaceNav(host, 'Tarefas', 'escala', activeTab, [
    { id:'escala', label:'Escala' }, { id:'participantes', label:'Pessoas' },
    { id:'config', label:'Mais opções' },
  ], id => { void openTarefasTab(id as TarefasTab) })
}

function renderIndex(): void {
  const content = document.getElementById('tarefasContent')
  if (!content) return
  content.innerHTML = `<div style="margin-bottom:14px"><h2 style="font-size:1.05rem;color:var(--blue-deep);margin-bottom:2px">Tarefas</h2></div><div id="tarefasMenu"></div>`
  const items: ItemMenu[] = [
    { id: 'escala', titulo: 'Escala', subtitulo: 'Escolha o mês, gere e revise a escala', icone: '▣', corFundo: '#5B3C88' },
    { id: 'participantes', titulo: 'Pessoas', subtitulo: 'Participantes e vínculos com Admin', icone: '♙', corFundo: '#2A6B77' },
    { id: 'config', titulo: 'Mais opções', subtitulo: 'Regras, datas e mensagens', icone: '⚙', corFundo: '#5C6062' },
  ]
  renderMenuCards(content.querySelector<HTMLElement>('#tarefasMenu')!, items, id => { void openTarefasTab(id as TarefasTab) })
}

function renderEscala(): void {
  queueMicrotask(()=>void renderPublicationStatus(document.getElementById('tarefasContent'),'tarefas',selectedPeriodId))
  const content = document.getElementById('tarefasContent')
  if (!content) return

  const periodMode = selectedPeriodMode
  const selectedPeriodId = periodKeyForDate(`${selectedPeriodMonth}-01`, periodMode)
  const locked = periods[selectedPeriodId]?.locked === true
  const allPeriodMeetings = Object.values(periods[selectedPeriodId]?.meetings ?? {})
    .filter(meeting => canonicalMeetingType(meeting.type))
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  const font = printFont()
  const activeRules = Object.values(normalizeTaskGenerationRules(planning.engineRules)).filter(Boolean).length
  const preservedMeetings = scaleMeetingEntries().filter(entry => entry.periodId !== selectedPeriodId && assignmentCount(entry.meeting) > 0).sort((a, b) => String(b.meeting.date).localeCompare(String(a.meeting.date))).slice(0, 12)

  content.innerHTML = `
    ${sectionTitle('Escala de tarefas', '')}
    ${locked ? '<div class="notice">Esta escala está publicada no Quadro de Anúncios e bloqueada para edição.</div>' : '<div class="notice warning">Rascunho administrativo: publique para aparecer no Quadro de Anúncios.</div>'}
    <div class="task-period-toolbar">
      <div class="module-form-grid">
        <div class="form-group" style="margin:0"><label class="form-label" for="tarefasPeriodMonth">Mês(es)</label><input id="tarefasPeriodMonth" class="form-input" type="month" value="${escapeHtml(selectedPeriodMonth)}"></div>
      </div>
      <div class="scale-actions" style="margin-top:8px">
        <button id="btnGenerateScale" class="btn ${allPeriodMeetings.length ? 'btn-ghost' : 'btn-primary'}" type="button" ${locked ? 'disabled' : ''}>Gerar escala · ${activeRules} regras${normalizeTaskGroupTargets(planning.groupTargets).enabled?' · grupos':''}</button>
        <button id="btnTarefasPdf" class="btn btn-ghost" type="button" ${allPeriodMeetings.length ? '' : 'disabled'}>Baixar PDF</button>
        <button id="btnTarefasXlsx" class="btn btn-ghost" type="button" ${allPeriodMeetings.length ? '' : 'disabled'}>Baixar XLSX</button>
        <button id="btnToggleTaskLock" class="btn ${locked ? 'btn-ghost' : 'btn-primary'}" type="button" ${allPeriodMeetings.length ? '' : 'disabled'}>${locked ? 'Reabrir para edição' : 'Publicar no Quadro'}</button>
        <details data-ui-preference="scale-actions"><summary>Mais opções</summary><button id="btnClearTaskScale" class="btn btn-danger" type="button" ${locked || !allPeriodMeetings.length ? 'disabled' : ''}>Limpar escala</button></details>
      </div>
      <details data-ui-preference="generation-print-options" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <summary style="cursor:pointer;font-size:.86rem;font-weight:700;color:var(--ink-2)">Refazer uma função ou ajustar a impressão</summary>
        <div class="module-form-grid" style="margin-top:10px">
          <div class="form-group" style="margin:0"><label class="form-label" for="tarefasGenerateRole">Função</label><select id="tarefasGenerateRole" class="form-select"><option value="">Escolha a função</option>${TASK_ROLES.map(role => `<option value="${role}" ${role === selectedGenerateRole ? 'selected' : ''}>${escapeHtml(TASK_ROLE_LABELS[role])}</option>`).join('')}</select></div>
          <div class="scale-actions" style="align-items:end"><button id="btnGenerateTaskRole" class="btn btn-ghost" type="button" ${locked ? 'disabled' : ''}>Gerar função</button><button id="btnClearTaskRole" class="btn btn-danger" type="button" ${locked ? 'disabled' : ''}>Limpar função</button></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px"><label class="form-label" for="tarefasPrintFont" style="margin:0;white-space:nowrap">Letra do PDF</label><input id="tarefasPrintFont" class="form-input" type="range" min="${PRINT_MIN_PT}" max="${PRINT_MAX_PT}" step="1" value="${font}" style="padding:0;flex:1"><span id="tarefasPrintFontValue" style="min-width:42px;text-align:right;font-size:.82rem;font-weight:700;color:var(--ink-2)">${font} pt</span></div>
      </details>
    </div>
    <details class="form-panel" data-ui-preference="day-message"><summary>Mensagem das designações do dia</summary><label class="form-field"><span>Data</span><select id="taskMessageDate">${[...new Set(allPeriodMeetings.map(meeting=>meeting.date).filter(Boolean))].map(date=>`<option value="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</option>`).join('')}</select></label><div class="service-actions"><button id="taskSendDay" class="btn btn-primary" type="button" ${allPeriodMeetings.length?'':'disabled'}>WhatsApp</button><button id="taskCopyDay" class="btn btn-ghost" type="button" ${allPeriodMeetings.length?'':'disabled'}>Copiar texto</button></div></details>
    <div class="task-desktop-scale">${taskDesktopTable(allPeriodMeetings)}</div>
    <div class="task-mobile-scale" style="display:flex;flex-direction:column;gap:8px">
      ${allPeriodMeetings.length
        ? allPeriodMeetings.map(meeting => meetingCard(meeting)).join('')
        : emptyState('Nenhuma reunião cadastrada neste período.')}
    </div>
    ${preservedMeetings.length ? `<details class="form-panel" data-ui-preference="preserved-records" style="margin-top:12px"><summary>Registros preservados fora do período atual (${preservedMeetings.length})</summary><div class="module-option-list" style="margin-top:10px">${preservedMeetings.map(entry => `<div class="module-list-row"><div><strong>${escapeHtml(formatDate(entry.meeting.date))}</strong><small>${canonicalMeetingType(entry.meeting.type) === 'midweek' ? 'Meio de semana' : 'Fim de semana'} · ${assignmentCount(entry.meeting)} função(ões)</small></div></div>`).join('')}</div></details>` : ''}`

  const dayMessage=()=>tasksDayMessage((document.getElementById('taskMessageDate') as HTMLSelectElement).value,pessoas,allPeriodMeetings,'',taskMessageSettings.meetingText)
  document.getElementById('taskSendDay')?.addEventListener('click',()=>openMessageWhatsApp(dayMessage(),toast))
  document.getElementById('taskCopyDay')?.addEventListener('click',()=>{void copyMessageText(dayMessage(),toast)})
  document.getElementById('tarefasPrintFont')?.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value)
    localStorage.setItem(PRINT_FONT_KEY, String(value))
    const out = document.getElementById('tarefasPrintFontValue')
    if (out) out.textContent = `${value} pt`
  })

  document.getElementById('btnTarefasPdf')?.addEventListener('click', () => {
    const value = Number((document.getElementById('tarefasPrintFont') as HTMLInputElement | null)?.value)
    gerarPdfTarefas(Number.isFinite(value) ? value : PRINT_DEFAULT_PT)
  })
  document.getElementById('btnTarefasXlsx')?.addEventListener('click',()=>void gerarXlsxTarefas())

  document.getElementById('btnGenerateScale')?.addEventListener('click', () => {
    const monthInput = document.getElementById('tarefasPeriodMonth') as HTMLInputElement | null
    if (!monthInput || !/^\d{4}-\d{2}$/.test(monthInput.value)) { toast('Selecione um mês válido'); return }
    selectedPeriodMonth = monthInput.value
    localStorage.setItem(TAREFAS_PERIOD_KEY, selectedPeriodMonth)
    void generateScale(`${selectedPeriodMonth}-01`, 'month', null)
  })
  document.getElementById('btnGenerateTaskRole')?.addEventListener('click', () => {
    const role = (document.getElementById('tarefasGenerateRole') as HTMLSelectElement).value as TaskRole
    if (!role) { toast('Escolha a função que deseja gerar'); return }
    void generateScale(`${selectedPeriodMonth}-01`, periodMode, role)
  })
  document.getElementById('btnClearTaskRole')?.addEventListener('click', () => {
    const role = (document.getElementById('tarefasGenerateRole') as HTMLSelectElement).value as TaskRole
    if (!role) { toast('Escolha a função que deseja limpar'); return }
    void clearTaskRole(selectedPeriodId, role)
  })
  document.getElementById('btnToggleTaskLock')?.addEventListener('click', () => void toggleTaskLock(selectedPeriodId))
  document.getElementById('btnClearTaskScale')?.addEventListener('click', () => void clearTaskScale(selectedPeriodId))
  document.getElementById('tarefasGenerateRole')?.addEventListener('change', event => {
    selectedGenerateRole = (event.target as HTMLSelectElement).value
    localStorage.setItem(TAREFAS_ROLE_KEY, selectedGenerateRole)
  })
  document.getElementById('tarefasPeriodMonth')?.addEventListener('change', event => {
    const value = (event.target as HTMLInputElement).value
    if (/^\d{4}-\d{2}$/.test(value)) {
      selectedPeriodMonth = value
      localStorage.setItem(TAREFAS_PERIOD_KEY, selectedPeriodMonth)
    }
    renderEscala()
  })
  localStorage.setItem(TAREFAS_PERIOD_MODE_KEY, 'month')
  content.querySelectorAll<HTMLDetailsElement>('[data-meeting-key]').forEach(card=>card.addEventListener('toggle',()=>{const key=card.dataset.meetingKey!;if(card.open)expandedTaskMeetings.add(key);else expandedTaskMeetings.delete(key)}))
  bindAssignmentEditors()
  content.querySelectorAll<HTMLButtonElement>('[data-edit-meeting]').forEach(button=>button.addEventListener('click',()=>{
    const periodId=button.dataset.period!, meetingId=button.dataset.editMeeting!
    const meeting=periods[periodId]?.meetings?.[meetingId]
    if(meeting)openMeetingEditor(periodId,meetingId,meeting)
  }))
  content.querySelectorAll<HTMLButtonElement>('[data-whatsapp-meeting],[data-copy-meeting]').forEach(button=>button.addEventListener('click',()=>{
    const periodId=button.dataset.period??'',meetingId=button.dataset.whatsappMeeting??button.dataset.copyMeeting??''
    const meeting=periods[periodId]?.meetings?.[meetingId]
    if(!meeting?.date)return
    const message=tasksDayMessage(meeting.date,pessoas,[meeting],'',taskMessageSettings.meetingText)
    if(button.dataset.copyMeeting!==undefined)void copyMessageText(message,toast)
    else openMessageWhatsApp(message,toast)
  }))
  if (pendingTarget?.meetingId) {
    const target=pendingTarget, meetingId=target.meetingId!
    const controls=[...content.querySelectorAll<HTMLButtonElement>('[data-edit-meeting]')].filter(control=>control.dataset.editMeeting===target.meetingId)
    if(periods[target.periodId??'']?.locked)focusCorrection(document.getElementById('btnToggleTaskLock'))
    else{
      const periodId=target.periodId??selectedPeriodId
      const meeting=periods[periodId]?.meetings?.[meetingId]
      if(meeting){openMeetingEditor(periodId,meetingId,meeting);focusCorrection(target.role?content.querySelector<HTMLElement>(`#taskMeetingForm [data-meeting-role="${target.role}"]`):content.querySelector<HTMLElement>('#taskMeetingForm'))}
      else focusCorrection(controls.find(control=>control.getClientRects().length>0)??null)
    }
    pendingTarget=null
  }

}

async function toggleTaskLock(periodId: string): Promise<void> {
  if (changingPublication) return
  if (periods[periodId]?.locked && !confirm('Reabrir para edição? O PDF será retirado do Quadro até publicar novamente.')) return
  changingPublication = true
  const releaseUi = lockPublicationUi()
  const locked = periods[periodId]?.locked === true
  try {
    const period = periods[periodId]
    const meetings = Object.values(period?.meetings ?? {}).filter(meeting => canonicalMeetingType(meeting.type)).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
    if (!locked && !meetings.length) { toast('Gere e revise a escala antes de publicar'); return }
    await publishModulePeriod('tarefas', periodId, period, printFont(), locked)
    periods[periodId] ??= {}
    periods[periodId].locked = !locked
    toast(locked ? 'Escala reaberta para edição' : 'Escala publicada no Quadro de Anúncios')
    renderEscala()
  } catch (error) { toast(error instanceof Error?error.message:'Não foi possível alterar a publicação. Confira o período e tente novamente.') }
  finally { changingPublication = false; releaseUi() }
}

async function clearTaskScale(periodId: string): Promise<void> {
  if (periods[periodId]?.locked) { toast('Destrave a escala antes de limpar'); return }
  if (!confirm('Limpar todas as designações deste período?')) return
  const period = periods[periodId]
  if (!period) return
  const patch: Record<string, unknown> = {}
  Object.keys(period.meetings ?? {}).forEach(meetingId => {
    patch[`${periodId}/meetings/${meetingId}/assignments`] = null
    patch[`${periodId}/meetings/${meetingId}/manualEdits`] = null
    patch[`${periodId}/meetings/${meetingId}/avisados`] = null
  })
  try {
    await update(tarefasScaleRef, patch)
    Object.values(period.meetings ?? {}).forEach(meeting => { meeting.assignments = {}; meeting.manualEdits = {}; delete meeting.avisados })
    toast('Escala do período limpa')
    renderEscala()
  } catch { toast('Não foi possível limpar a escala') }
}

async function clearTaskRole(periodId: string, role: TaskRole): Promise<void> {
  if (periods[periodId]?.locked) { toast('Destrave a escala antes de limpar'); return }
  if (!confirm(`Limpar ${TASK_ROLE_LABELS[role]} em todo o período?`)) return
  const period = periods[periodId]
  if (!period) return
  const patch: Record<string, unknown> = {}
  Object.entries(period.meetings ?? {}).forEach(([meetingId, meeting]) => {
    if (!meetingAllowsRole(meeting, role)) return
    patch[`${periodId}/meetings/${meetingId}/assignments/${role}`] = null
    patch[`${periodId}/meetings/${meetingId}/manualEdits/${role}`] = null
    patch[`${periodId}/meetings/${meetingId}/avisados/${role}`] = null
  })
  try {
    await update(tarefasScaleRef, patch)
    Object.values(period.meetings ?? {}).forEach(meeting => {
      if (!meetingAllowsRole(meeting, role)) return
      delete meeting.assignments?.[role]
      delete meeting.manualEdits?.[role]
      delete meeting.avisados?.[role]
    })
    toast(`${TASK_ROLE_LABELS[role]} limpa`)
    renderEscala()
  } catch { toast('Não foi possível limpar a função') }
}

async function generateScale(startDate: string, mode: 'month' | 'bimester', role: TaskRole | null): Promise<void> {
  if(generatingTaskScale)return
  generatingTaskScale=true
  const button = document.getElementById('btnGenerateScale') as HTMLButtonElement | null
  if (button) button.disabled = true
  try {
    if (normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores) {
      const snapshot = await get(tarefasDiscursosRef)
      discursos = snapshot.exists() ? snapshot.val() as TaskDomainContext['discursos'] : {}
    }
    const generatedAt = new Date().toISOString()
    const nextPlanning = { ...planning, periodMode: mode }
    const canonical = withCanonicalPeriod(periods, nextPlanning, startDate)
    if (!canonical) {
      showGenerationErrors(['Os dias das reuniões não estão configurados no planejamento.'])
      return
    }
    const context = { ...domainContext(), periods: canonical.periods }
    const result = computeGeneration(context, startDate, role, generatedAt, canonical.periodId, planning.engineRules)
    if (result.aborted) {
      showGenerationErrors(result.errors)
      return
    }
    const groupTargetsEnabled=normalizeTaskGroupTargets(planning.groupTargets).enabled
    if(groupTargetsEnabled){
      const summary=summarizeTaskGroups(context,canonical.periodId,result.patch)
      if(!await confirmTaskGroupPreview(summary))return
    }
    const patch: Record<string, unknown> = {
      'planning/periodMode': mode,
      'planning/editingPeriod': selectedPeriodMonth,
      'planning/scaleStartDate': null,
      'planning/generatedAt': generatedAt,
    }
    Object.entries(result.patch).forEach(([path, value]) => {
      patch[`scale/periods/${path}`] = value
    })
    if(groupTargetsEnabled){
      const baseline={planning,scale:{periods}}
      const expected=Object.fromEntries(Object.keys(patch).map(path=>[
        path,path.split('/').reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Record<string,unknown>)[key]:null,baseline)??null,
      ]))
      try{await compareAndUpdate(tarefasRef,expected,patch)}catch(error){
        if(error instanceof ApiError&&error.status===409){toast('A escala mudou enquanto você conferia. Recarregamos os dados; gere novamente.');await loadTarefas();renderEscala();return}
        throw error
      }
    }else await update(tarefasRef, patch)
    planning = { ...nextPlanning, editingPeriod: selectedPeriodMonth, scaleStartDate: undefined, generatedAt }
    toast(result.generated ? `${result.generated} designações geradas; vagas sem candidato ficaram vazias` : 'Escala preparada; vagas sem candidato ficaram vazias')
    await loadTarefas()
  } catch {
    toast('Não foi possível gerar a escala')
  } finally {
    generatingTaskScale=false
    if (button?.isConnected) button.disabled = false
  }
}

function confirmTaskGroupPreview(summary: TaskGroupSummary): Promise<boolean> {
  return new Promise(resolve=>{
    const overlay=document.createElement('div')
    overlay.className='modal-overlay'
    overlay.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="taskGroupPreviewTitle"><h2 id="taskGroupPreviewTitle">Conferir distribuição</h2><p class="form-help">${summary.total} participação(ões) no período. A mesma pessoa conta uma vez por reunião. Metas são flexíveis; função habilitada, folga e indisponibilidade têm prioridade.</p><div class="module-option-list">${TASK_GROUPS.map(group=>{const item=summary.groups[group];return`<div class="module-list-row"><strong>${TASK_GROUP_LABELS[group]}</strong><span>Meta ${item.targetPercent}% (${item.target}) · Obtido ${item.actual}</span></div>`}).join('')}</div><p class="form-help">Designações manuais e já preservadas entram no total. Confira as diferenças antes de gravar.</p><div class="service-actions"><button id="confirmTaskGroups" class="btn btn-primary" type="button">Gravar escala</button><button id="cancelTaskGroups" class="btn btn-ghost" type="button">Cancelar</button></div></div>`
    document.body.appendChild(overlay)
    const close=(confirmed:boolean)=>{document.removeEventListener('keydown',onKeyDown);overlay.remove();resolve(confirmed)}
    const onKeyDown=(event:KeyboardEvent)=>{if(event.key==='Escape')close(false)}
    document.addEventListener('keydown',onKeyDown)
    overlay.querySelector('#confirmTaskGroups')?.addEventListener('click',()=>close(true))
    overlay.querySelector('#cancelTaskGroups')?.addEventListener('click',()=>close(false))
    overlay.addEventListener('click',event=>{if(event.target===overlay)close(false)})
    overlay.querySelector<HTMLButtonElement>('#confirmTaskGroups')?.focus()
  })
}

function showGenerationErrors(errors: string[]): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal"><h2>Escala não gerada</h2><div style="display:flex;flex-direction:column;gap:8px">${errors.slice(0, 20).map(error => `<div style="font-size:.8rem;padding:8px 10px;border-left:3px solid var(--danger);background:var(--surface-2)">${escapeHtml(error)}</div>`).join('')}</div>${errors.length > 20 ? `<p class="form-help">Mais ${errors.length - 20} conflito(s).</p>` : ''}<button id="closeGenerationErrors" class="btn btn-primary btn-full" type="button" style="margin-top:14px">Voltar para a escala</button></div>`
  document.body.appendChild(overlay)
  document.getElementById('closeGenerationErrors')?.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove() })
}

function renderParticipantes(): void {
  const content = document.getElementById('tarefasContent')
  if (!content) return

  const usageSince = new Date()
  usageSince.setMonth(usageSince.getMonth() - 6)
  const usageFloor = usageSince.toISOString().slice(0, 10)
  const usage = Object.fromEntries(Object.keys(pessoas).map(id => [id, 0])) as Record<string, number>
  const lastUse = Object.fromEntries(Object.keys(pessoas).map(id => [id, ''])) as Record<string, string>
  scaleMeetingEntries().forEach(({ meeting }) => {
    if (!meeting.date || meeting.date < usageFloor) return
    GENERATED_ROLES.forEach(role => {
      const id = assignmentForRole(meeting, role)
      if (id && id in usage) { usage[id] += 1; if (meeting.date && meeting.date > lastUse[id]) lastUse[id] = meeting.date }
    })
  })
  const targetPersonId = pendingTarget?.personId
  const query = participantSearch.trim().toLocaleLowerCase('pt-BR')
  const rows = Object.entries(pessoas)
    .filter(([id, person]) => !query || pessoaNome(person, id).toLocaleLowerCase('pt-BR').includes(query))
    .filter(([, person]) => {
      const rule = person.rule ?? 'both'
      return !participantMeetingRule || rule === participantMeetingRule || (participantMeetingRule !== 'both' && rule === 'both')
    })
    .filter(([, person]) => !participantRoleFilter || person.roles?.[participantRoleFilter as TaskRole] === true)
    .sort(([, a], [, b]) => pessoaNome(a, '').localeCompare(pessoaNome(b, ''), 'pt-BR'))
  const preparationMonth = nextCivilMonth(todayStr())
  content.innerHTML = `
    ${sectionTitle('Participantes', 'Nome, telefone e vínculo vêm do Admin. O responsável de Tarefas atualiza funções, folgas e indisponibilidades.')}
    ${context.usuario.apps.mestre ? '<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button id="btnAddTaskPerson" class="btn btn-primary" type="button">Vincular pessoa</button></div>' : ''}
    <div class="notice"><strong>Disponibilidade para ${escapeHtml(preparationMonth.slice(5, 7) + '/' + preparationMonth.slice(0, 4))}:</strong> ${planning.availabilityReviewedMonth === preparationMonth ? 'revisada' : 'aguardando revisão'} <button id="taskReviewAvailability" class="btn btn-ghost" type="button">Marcar como revisada</button></div>
    <div class="module-form-grid" style="margin-bottom:10px">
      <div class="form-group" style="margin:0"><label class="form-label" for="taskPersonSearch">Buscar</label><input id="taskPersonSearch" class="form-input" value="${escapeHtml(participantSearch)}" placeholder="Nome da pessoa"></div>
      <div class="form-group" style="margin:0"><label class="form-label" for="taskPersonMeetingFilter">Reuniões</label><select id="taskPersonMeetingFilter" class="form-select"><option value="">Todas</option><option value="midweek" ${participantMeetingRule === 'midweek' ? 'selected' : ''}>Meio de semana</option><option value="weekend" ${participantMeetingRule === 'weekend' ? 'selected' : ''}>Fim de semana</option><option value="both" ${participantMeetingRule === 'both' ? 'selected' : ''}>Todas as reuniões</option></select></div>
      <div class="form-group" style="margin:0"><label class="form-label" for="taskPersonRoleFilter">Função</label><select id="taskPersonRoleFilter" class="form-select"><option value="">Todas</option>${TASK_ROLES.map(role => `<option value="${role}" ${participantRoleFilter === role ? 'selected' : ''}>${escapeHtml(TASK_ROLE_LABELS[role])}</option>`).join('')}</select></div>
      <div style="display:flex;align-items:end"><button id="taskClearPersonFilters" class="btn btn-ghost" type="button" style="width:100%">Limpar filtros</button></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${rows.length
        ? rows.map(([id, p]) => pessoaRow(id, p, usage[id] ?? 0, lastUse[id] ?? '', id === targetPersonId)).join('')
        : emptyState('Nenhum participante. Adicione pelo módulo Admin.')}
    </div>`
  content.querySelectorAll<HTMLButtonElement>('[data-whatsapp-task-person],[data-copy-task-person]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.whatsappTaskPerson??button.dataset.copyTaskPerson??'',message=tasksPersonMessage(id,pessoas,scaleMeetingEntries().map(entry=>entry.meeting),todayStr(),taskMessageSettings.meetingText);if(button.dataset.copyTaskPerson!==undefined)void copyMessageText(message,toast);else openMessageWhatsApp(message,toast,personPhone(pessoas[id])??'')}))
  document.getElementById('btnAddTaskPerson')?.addEventListener('click', () => openTaskPersonModal(null))
  document.getElementById('taskReviewAvailability')?.addEventListener('click', async () => {
    try { await update(tarefasPlanejamentoRef, { availabilityReviewedMonth:preparationMonth }); planning.availabilityReviewedMonth=preparationMonth; toast('Disponibilidades revisadas'); renderParticipantes() }
    catch { toast('Não foi possível registrar a revisão') }
  })
  content.querySelectorAll<HTMLButtonElement>('[data-edit-task-person]').forEach(button => {
    button.addEventListener('click', () => openTaskPersonModal(button.dataset['editTaskPerson'] ?? null))
  })
  document.getElementById('taskPersonSearch')?.addEventListener('input', event => { participantSearch = (event.target as HTMLInputElement).value; renderParticipantes() })
  document.getElementById('taskPersonMeetingFilter')?.addEventListener('change', event => { participantMeetingRule = (event.target as HTMLSelectElement).value; renderParticipantes() })
  document.getElementById('taskPersonRoleFilter')?.addEventListener('change', event => { participantRoleFilter = (event.target as HTMLSelectElement).value; renderParticipantes() })
  document.getElementById('taskClearPersonFilters')?.addEventListener('click', () => { participantSearch = ''; participantMeetingRule = ''; participantRoleFilter = ''; renderParticipantes() })
  if(targetPersonId){if(pessoas[targetPersonId]&&(context.usuario.apps.mestre||context.usuario.apps.tarefas)){openTaskPersonModal(targetPersonId);focusCorrection(document.getElementById('taskPersonUnavailable'))}else focusCorrection([...content.querySelectorAll<HTMLElement>('[data-task-person-id]')].find(row=>row.dataset.taskPersonId===targetPersonId)??null);pendingTarget=null}
}

function planningExcludedDates(): string[] {
  return Array.isArray(planning.excludedDates)
    ? planning.excludedDates
    : Object.entries(planning.excludedDates ?? {}).filter(([, enabled]) => Boolean(enabled)).map(([date]) => date)
}

function renderTaskConfig(): void {
  const content = document.getElementById('tarefasContent')
  if (!content) return
  const dates = planningExcludedDates().sort()
  const rules = normalizeTaskGenerationRules(planning.engineRules)
  const groups = normalizeTaskGroupTargets(planning.groupTargets)
  const canEditRules = context.usuario.apps.mestre === true || context.usuario.apps.tarefas === true
  content.innerHTML = `${sectionTitle('Configuração', 'Preferências próprias de Tarefas. O formato e a letra do PDF são ajustados diretamente na Escala.')}
    <div class="form-panel" data-editor-scope><h3 style="margin-top:0">Regras do motor</h3><p class="form-help">Estas opções valem apenas para as próximas gerações. Regras de integridade continuam obrigatórias.</p><div class="engine-rule-list"><label><input id="taskRuleSpeakers" type="checkbox" ${rules.evitarConflitosOradores ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Evitar designar quem tem discurso ou saída de Oradores na mesma data (S2)</label><label><input id="taskRulePresident" type="checkbox" ${rules.presidenteSegundaTarefa ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Aproveitar o presidente em uma segunda tarefa mecânica</label><label><input id="taskRuleBalance" type="checkbox" ${rules.equilibrarDesignacoes ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Equilibrar o total de designações</label><label><input id="taskRuleRepeat" type="checkbox" ${rules.evitarRepetirFuncao ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Evitar repetir a mesma função</label></div>${canEditRules ? '<div class="scale-actions" style="margin-top:12px"><button id="saveTaskRules" class="btn btn-primary" type="button">Salvar regras</button><button id="restoreTaskRules" class="btn btn-ghost" type="button">Restaurar padrões</button></div>' : '<div class="notice">Somente o Admin pode alterar estas regras.</div>'}</div>
    <div class="form-panel" data-editor-scope><h3 style="margin-top:0">Distribuição por grupo</h3><p class="form-help">Defina a participação total desejada de cada grupo na escala. A meta é flexível: aptidão, folga e disponibilidade continuam valendo. Cada pessoa conta uma vez por reunião, mesmo fazendo duas tarefas. Os percentuais iniciais são apenas uma sugestão; nada muda até ativar e salvar.</p><label class="oradores-check"><input id="taskGroupEnabled" type="checkbox" ${groups.enabled?'checked':''} ${canEditRules?'':'disabled'}> Usar metas por grupo nas próximas gerações</label><div class="module-form-grid" style="margin-top:12px">${(['anciaos','servos','jovens'] as const).map(group=>`<label class="form-field"><span>${TASK_GROUP_LABELS[group]} (%)</span><input class="form-input task-group-percent" data-task-group="${group}" type="number" min="0" max="100" step="1" value="${groups[group]}" ${canEditRules?'':'disabled'}></label>`).join('')}<div class="form-field"><span>Demais</span><strong id="taskGroupRemaining">${groups.demais}% (restante automático)</strong></div></div><p id="taskGroupValidation" class="form-help" aria-live="polite">Jovem é a marcação do participante em Tarefas, não uma idade calculada. Sem cargo de ancião ou servo no Admin, a pessoa entra em Demais.</p>${canEditRules?'<button id="saveTaskGroups" class="btn btn-primary" type="button">Salvar distribuição</button>':'<div class="notice">Somente o Admin ou responsável por Tarefas pode alterar esta distribuição.</div>'}</div>
    <div class="form-panel"><h3 style="margin-top:0">Datas sem reunião</h3><div style="display:flex;gap:8px"><input id="taskExcludedDate" class="form-input" type="date"><button id="addTaskExcludedDate" class="btn btn-ghost" type="button">Adicionar</button></div><div class="module-option-list" style="margin-top:10px">${dates.map(date => `<div class="module-list-row"><strong>${escapeHtml(formatDate(date))}</strong><button class="btn btn-danger" data-remove-task-date="${escapeHtml(date)}" type="button">Remover</button></div>`).join('') || '<p class="empty-state">Nenhuma data excluída.</p>'}</div></div><div id="taskMessageSettings"></div>`
  document.getElementById('taskRuleSpeakers')?.closest('.form-panel')?.insertAdjacentHTML('beforeend', '<details class="workspace-disclosure" data-ui-preference="fixed-rules"><summary>Regras fixas sem liga/desliga</summary><p class="form-help">O motor sempre respeita pessoa ativa, função habilitada, tipo de reunião, folga e indisponibilidade cadastradas, reunião bloqueada e incompatibilidade entre funções. Também mantém as restrições de participação dos jovens. Essas proteções não são preferências de distribuição.</p></details>')
  content.querySelectorAll<HTMLElement>(':scope > .form-panel').forEach((panel, index) => {
    const details = document.createElement('details')
    details.dataset.uiPreference = ['engine-rules','group-targets','excluded-dates'][index]!
    details.className = 'workspace-disclosure'
    const summary = document.createElement('summary')
    const heading = panel.querySelector('h3')
    summary.textContent = heading?.textContent ?? 'Mês(es) e impressão'
    heading?.remove()
    details.open = false
    panel.replaceWith(details)
    details.append(summary, panel)
  })
  document.getElementById('saveTaskRules')?.addEventListener('click', () => void saveTaskRules())
  document.getElementById('restoreTaskRules')?.addEventListener('click', () => void saveTaskRules(DEFAULT_TASK_GENERATION_RULES))
  document.querySelectorAll<HTMLInputElement>('.task-group-percent').forEach(input=>input.addEventListener('input', updateTaskGroupRemaining))
  document.getElementById('taskGroupEnabled')?.addEventListener('change', updateTaskGroupRemaining)
  document.getElementById('saveTaskGroups')?.addEventListener('click', ()=>void saveTaskGroups())
  updateTaskGroupRemaining()
  document.getElementById('addTaskExcludedDate')?.addEventListener('click', async () => {
    const date = (document.getElementById('taskExcludedDate') as HTMLInputElement).value
    if (!isValidCivilDate(date)) { toast('Escolha uma data válida'); return }
    const next = [...new Set([...dates, date])].sort()
    try { await update(tarefasPlanejamentoRef, { excludedDates:next }); planning.excludedDates = next; toast('Data excluída'); renderTaskConfig() } catch { toast('Não foi possível excluir a data') }
  })
  content.querySelectorAll<HTMLButtonElement>('[data-remove-task-date]').forEach(button => button.addEventListener('click', async () => {
    const next = dates.filter(date => date !== button.dataset['removeTaskDate'])
    try { await update(tarefasPlanejamentoRef, { excludedDates:next.length ? next : null }); planning.excludedDates = next; renderTaskConfig() } catch { toast('Não foi possível remover a data') }
  }))
  void mountModuleMessageSettings('taskMessageSettings', 'tarefas', toast,settings=>{taskMessageSettings=settings})
}

async function saveTaskRules(value?: TaskGenerationRules): Promise<void> {
  if (!context.usuario.apps.mestre && !context.usuario.apps.tarefas) { toast('Sem permissão para configurar Tarefas'); return }
  const next = value ?? {
    evitarConflitosOradores:(document.getElementById('taskRuleSpeakers') as HTMLInputElement).checked,
    presidenteSegundaTarefa:(document.getElementById('taskRulePresident') as HTMLInputElement).checked,
    equilibrarDesignacoes:(document.getElementById('taskRuleBalance') as HTMLInputElement).checked,
    evitarRepetirFuncao:(document.getElementById('taskRuleRepeat') as HTMLInputElement).checked,
  }
  const scope=document.getElementById('saveTaskRules')!.closest<HTMLElement>('[data-editor-scope]')!,release=editorBusy(scope)
  try { await update(tarefasPlanejamentoRef, { engineRules:{ ...next, version:1 } }); planning.engineRules = next; toast(value ? 'Padrões restaurados' : 'Regras salvas'); renderTaskConfig() }
  catch {editorError(scope); toast('Não foi possível salvar as regras') } finally {release()}
}

function readTaskGroupTargets(): TaskGroupTargets | null {
  const values = (['anciaos','servos','jovens'] as const).map(group => {
    const input = document.querySelector<HTMLInputElement>(`[data-task-group="${group}"]`)
    return input?.value.trim() ? Number(input.value) : NaN
  })
  const [anciaos,servos,jovens] = values as [number,number,number]
  const next: TaskGroupTargets = {
    enabled:(document.getElementById('taskGroupEnabled') as HTMLInputElement | null)?.checked === true,
    anciaos, servos, jovens, demais:100-anciaos-servos-jovens,
  }
  return validTaskGroupTargets(next) ? next : null
}

function updateTaskGroupRemaining(): void {
  const next = readTaskGroupTargets()
  const remaining = document.getElementById('taskGroupRemaining')
  const validation = document.getElementById('taskGroupValidation')
  const button = document.getElementById('saveTaskGroups') as HTMLButtonElement | null
  if(remaining)remaining.textContent=next?`${next.demais}% (restante automático)`:'Revise os percentuais'
  if(validation)validation.textContent=next
    ? 'Jovem é a marcação do participante em Tarefas, não uma idade calculada. Sem cargo de ancião ou servo no Admin, a pessoa entra em Demais.'
    : 'Use números inteiros de 0 a 100. A soma de anciãos, servos e jovens não pode passar de 100%.'
  if(button)button.disabled=!next
}

async function saveTaskGroups(): Promise<void> {
  if(!context.usuario.apps.mestre&&!context.usuario.apps.tarefas){toast('Sem permissão para configurar Tarefas');return}
  const next=readTaskGroupTargets()
  if(!next){toast('Revise os percentuais dos grupos');return}
  const scope=document.getElementById('saveTaskGroups')!.closest<HTMLElement>('[data-editor-scope]')!,release=editorBusy(scope)
  try{
    await update(tarefasPlanejamentoRef,{groupTargets:next})
    planning.groupTargets=next
    toast(next.enabled?'Distribuição por grupo ativada':'Distribuição por grupo desativada')
    renderTaskConfig()
  }catch{editorError(scope);toast('Não foi possível salvar a distribuição')}finally{release()}
}

function sectionTitle(title: string, desc: string): string {
  return `
    <div style="margin-bottom:14px">
      ${moduleBackButton()}
      <h2 style="font-size:1.05rem;color:var(--blue-deep);margin-bottom:2px">${escapeHtml(title)}</h2>
      <p style="font-size:.8rem;color:var(--ink-3)">${escapeHtml(desc)}</p>
    </div>`
}

function taskDesktopTable(meetings: TarefasMeeting[]): string {
  if (!meetings.length) return emptyState('Nenhuma reunião cadastrada neste período.')
  return `<div class="task-scale-table-wrap"><table class="task-scale-table"><thead><tr><th>Reunião</th>${TASK_ROLES.map(role => `<th>${escapeHtml(TASK_ROLE_LABELS[role])}</th>`).join('')}</tr></thead><tbody>${meetings.map(meeting => { const ref = meetingRefFor(meeting), locked = ref ? periods[ref.periodId]?.locked === true : false; return `<tr data-task-meeting-id="${escapeHtml(ref?.meetingId)}"><th><strong>${escapeHtml(formatDate(meeting.date))}</strong><small>${meetingLabel(meeting, true)}</small>${ref?`<div class="service-actions">${!locked?`<button class="btn btn-ghost" type="button" data-edit-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Editar</button>`:''}<button class="btn btn-ghost" type="button" data-whatsapp-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">WhatsApp</button><button class="btn btn-ghost" type="button" data-copy-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Copiar texto</button></div>`:''}</th>${TASK_ROLES.map(role => `<td>${meetingAllowsRole(meeting, role) && ref ? assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked) : '<span class="task-not-applicable">—</span>'}</td>`).join('')}</tr>` }).join('')}</tbody></table></div>`
}

const expandedTaskMeetings=new Set<string>()
function meetingCard(meeting: TarefasMeeting): string {
  const count = assignmentCount(meeting)
  const type = meetingLabel(meeting)
  const ref = meetingRefFor(meeting)
  const locked = ref ? periods[ref.periodId]?.locked === true : false
  const roles = ref ? GENERATED_ROLES.filter(role => meetingAllowsRole(meeting, role)) : []
  const assignedRoles = roles.filter(role => Boolean(assignmentForRole(meeting, role)))
  const vacantRoles = roles.filter(role => !assignmentForRole(meeting, role))
  const editors = ref ? `${assignedRoles.map(role => assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked)).join('')}${vacantRoles.length ? `<details class="task-vacant-roles" ${pendingTarget?.meetingId === ref.meetingId && pendingTarget.role && vacantRoles.includes(pendingTarget.role) ? 'open' : ''}><summary>${vacantRoles.length} ${vacantRoles.length === 1 ? 'função' : 'funções'} sem pessoa</summary>${vacantRoles.map(role => assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked)).join('')}</details>` : ''}` : ''

  return `
    <details data-meeting-key="${escapeHtml(ref?.periodId+'/'+ref?.meetingId)}" ${pendingTarget?.meetingId === ref?.meetingId || expandedTaskMeetings.has(ref?.periodId+'/'+ref?.meetingId) ? 'open' : ''} data-task-meeting-id="${escapeHtml(ref?.meetingId)}" style="background:var(--surface);border:1px solid ${pendingTarget?.meetingId === ref?.meetingId ? 'var(--blue-deep)' : 'var(--border)'};box-shadow:${pendingTarget?.meetingId === ref?.meetingId ? '0 0 0 3px #EEE8F5' : 'none'};border-radius:8px;padding:10px 12px">
      <summary class="task-meeting-summary">
        <div style="min-width:0">
          <div style="font-size:.9rem;font-weight:700;color:var(--ink)">${formatDate(meeting.date)}</div>
          <div style="font-size:.76rem;color:var(--ink-3)">${escapeHtml(type)}</div>
        </div>
        <span style="font-size:.75rem;font-weight:700;color:${locked ? 'var(--danger)' : 'var(--blue-deep)'}">
          ${locked ? 'Publicado' : `${count} função${count === 1 ? '' : 'ões'}`}
        </span>
      </summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${editors}
        ${ref?`<div class="service-actions">${!locked?`<button class="btn btn-ghost" type="button" data-edit-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Editar</button>`:''}<button class="btn btn-ghost" type="button" data-whatsapp-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">WhatsApp</button><button class="btn btn-ghost" type="button" data-copy-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Copiar texto</button></div>`:''}
      </div>
    </details>`
}

function assignmentEditor(periodId: string, meetingId: string, meeting: TarefasMeeting, role: TaskRole, locked: boolean): string {
  const selected = assignmentForRole(meeting, role) ?? ''
  return `<div class="task-assignment-row"><span>${escapeHtml(roleLabel(role))}</span><strong>${escapeHtml(selected?pessoaNome(pessoas[selected]??{},selected):'Vago')}</strong>${locked?'':`<button type="button" class="btn btn-ghost" data-task-substitute data-period="${escapeHtml(periodId)}" data-meeting="${escapeHtml(meetingId)}" data-role="${role}">${selected?'Buscar substituto':'Sugerir candidato'}</button>`}</div>`
}

function bindAssignmentEditors(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-task-substitute]').forEach(button=>button.addEventListener('click',async()=>{
    const periodId=button.dataset.period!,meetingId=button.dataset.meeting!,role=button.dataset.role as TaskRole
    const entry=meetingEntries(periods).find(item=>item.periodId===periodId&&item.meetingId===meetingId)
    if(!entry||periods[periodId]?.locked)return
    button.disabled=true
    try {
      if(normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores)discursos=(await get(tarefasDiscursosRef)).val() as TaskDomainContext['discursos']??{}
      const original=assignmentForRole(entry.meeting,role)
      substitutionDialog({title:`${TASK_ROLE_LABELS[role]} · ${formatDate(entry.meeting.date)}`,current:original?pessoaNome(pessoas[original]??{},original):'Vago',candidates:taskSubstitutes(domainContext(),entry,role),allowWarnings:true,confirmSelection:async(id,host)=>{
        if(normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores)discursos=(await get(tarefasDiscursosRef)).val() as TaskDomainContext['discursos']??{}
        const reason=manualConflictReason(domainContext(),entry,role,id)
        return !reason||confirmAdvisoryWarnings(host,'Aviso sobre esta escolha',[`${TASK_ROLE_LABELS[role]}: ${reason}`])
      },save:async id=>saveAssignment(periodId,meetingId,role,id)})
    }catch{toast('Não foi possível consultar candidatos. Tente novamente.')}
    finally{button.disabled=false}
  }))
}

function openMeetingEditor(periodId: string, meetingId: string, meeting: TarefasMeeting): void {
  if (periods[periodId]?.locked) return
  const host = document.getElementById('tarefasContent')
  if (!host || host.querySelector('#taskMeetingForm')) return
  const roles = GENERATED_ROLES.filter(role => meetingAllowsRole(meeting, role))
  const options = (role: TaskRole): string => {
    const selected = assignmentForRole(meeting, role) ?? ''
    return `<option value="">Deixar vaga</option>${Object.entries(pessoas).sort((a,b)=>pessoaNome(a[1],a[0]).localeCompare(pessoaNome(b[1],b[0]),'pt-BR')).map(([id,person])=>{
      const reason = manualConflictReason(domainContext(), { periodId,meetingId,meeting }, role, id)
      return `<option value="${escapeHtml(id)}" ${id===selected?'selected':''}>${escapeHtml(pessoaNome(person,id))}${reason?` · ${escapeHtml(reason)}`:''}</option>`
    }).join('')}`
  }
  const form = document.createElement('form')
  form.id = 'taskMeetingForm'
  form.className = 'form-panel'
  form.innerHTML = `<h3>Editar reunião</h3><p class="form-help">${escapeHtml(formatDate(meeting.date))} · ${meetingLabel(meeting)}</p><div class="task-meeting-fields">${roles.map(role=>`<label class="form-field"><span>${escapeHtml(TASK_ROLE_LABELS[role])}</span><select class="form-select" data-meeting-role="${role}">${options(role)}</select></label>`).join('')}</div><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar reunião</button><button id="cancelTaskMeeting" class="btn btn-ghost" type="button">Cancelar</button></div>`
  host.append(form)
  mountRecordEditor(host, form.id)
  form.querySelector('#cancelTaskMeeting')?.addEventListener('click',()=>closeRecordEditor(form))
  form.addEventListener('submit',async event=>{
    event.preventDefault()
    if(periods[periodId]?.locked){editorError(form,'Esta escala foi publicada. Reabra antes de editar.');return}
    const baseline=periods[periodId]?.meetings?.[meetingId]
    if(!baseline){editorError(form,'A reunião não está mais disponível.');return}
    const next=structuredClone(baseline), changedRoles:TaskRole[]=[]
    for(const select of form.querySelectorAll<HTMLSelectElement>('[data-meeting-role]')){
      const role=select.dataset.meetingRole as TaskRole
      if(select.value===(assignmentForRole(baseline,role)??''))continue
      changedRoles.push(role)
      next.assignments??={};next.manualEdits??={}
      if(select.value){next.assignments[role]=select.value;next.manualEdits[role]=true}
      else{delete next.assignments[role];delete next.manualEdits[role]}
    }
    if(!changedRoles.length){closeRecordEditor(form);return}
    try {
      if(normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores){const snapshot=await get(tarefasDiscursosRef);discursos=snapshot.exists()?snapshot.val() as TaskDomainContext['discursos']: {}}
      const conflicts=changedRoles.flatMap(role=>{const id=String(next.assignments?.[role]??'');const reason=id?manualConflictReason(domainContext(),{periodId,meetingId,meeting:next},role,id):null;return reason?[`${TASK_ROLE_LABELS[role]}: ${reason}`]:[]})
      if (conflicts.some(reason => reason.includes('outra sessão'))) { editorError(form, conflicts.join('. ')); return }
      if(conflicts.length&&!await confirmAdvisoryWarnings(form,'Avisos sobre esta reunião',conflicts))return
      const release=editorBusy(form)
      try {
        await compareAndUpdate(tarefasScaleRef,{[`${periodId}/meetings/${meetingId}`]:baseline},{[`${periodId}/meetings/${meetingId}`]:next})
        periods[periodId]!.meetings![meetingId]=next
        toast('Reunião atualizada')
        renderEscala()
      } finally {release()}
    } catch {editorError(form,'Não foi possível salvar a reunião. Seu preenchimento foi mantido.')}
  })
}

async function saveAssignment(periodId: string, meetingId: string, role: string, personId: string): Promise<boolean> {
  if (!periodId || !meetingId || !role) return false
  if (periods[periodId]?.locked) { toast('Esta escala está travada'); return false }
  const path = `${periodId}/meetings/${meetingId}`
  try {
    const baseline=periods[periodId]?.meetings?.[meetingId]
    if(!baseline)return false
    if (personId) {
      const reason = manualConflictReason(domainContext(), { periodId, meetingId, meeting:baseline }, role as TaskRole, personId)
      if (reason?.includes('outra sessão')) { toast(reason); return false }
    }
    const next=structuredClone(baseline);next.assignments??={};next.manualEdits??={}
    if(personId){next.assignments[role]=personId;next.manualEdits[role]=true}
    else {delete next.assignments[role];delete next.manualEdits[role]}
    await compareAndUpdate(tarefasScaleRef,{[path]:baseline},{[path]:next})
    const meeting = periods[periodId]?.meetings?.[meetingId]
    if (meeting) {
      meeting.assignments = { ...(meeting.assignments ?? {}) }
      meeting.manualEdits = { ...(meeting.manualEdits ?? {}) }
      if (personId) meeting.assignments[role] = personId
      else delete meeting.assignments[role]
      if (personId) meeting.manualEdits[role] = true
      else delete meeting.manualEdits[role]
    }
    toast('Designação atualizada')
    renderEscala()
    return true
  } catch {
    toast('Não foi possível salvar a designação')
    return false
  }
}

function pessoaRow(id: string, p: TarefasPessoa, recentUsage: number, lastUse: string, focused = false): string {
  const linked = Boolean(p.masterId)
  const active = isActive(p)
  const meetings = p.rule === 'midweek' ? 'Meio de semana' : p.rule === 'weekend' ? 'Fim de semana' : p.rule === 'none' ? 'Fora da escala' : 'Todas as reuniões'
  const roles = TASK_ROLES.filter(role => p.roles?.[role] === true).map(role => TASK_ROLE_LABELS[role]).join(', ') || 'Nenhuma função'

  return `
    <div data-task-person-id="${escapeHtml(id)}" style="background:var(--surface);border:1px solid ${focused ? 'var(--blue-deep)' : 'var(--border)'};box-shadow:${focused ? '0 0 0 3px #EEE8F5' : 'none'};border-radius:8px;
      padding:9px 12px;display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHtml(pessoaNome(p, id))}
        </div>
        <div style="font-size:.72rem;color:var(--ink-3)">
          ${active ? 'Ativo' : 'Inativo'} · ${meetings}${p.weekendSection ? ` · ${p.weekendSection === 's1' ? '1ª seção' : '2ª seção'}` : ''} · ${recentUsage} função${recentUsage === 1 ? '' : 'ões'} em 6 meses${lastUse ? ` · Última ${formatDate(lastUse)}` : ''}
        </div>
        <div style="font-size:.72rem;color:var(--ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(roles)}</div>
      </div>
      <button class="btn btn-ghost" type="button" data-whatsapp-task-person="${escapeHtml(id)}" style="padding:4px 9px;font-size:.76rem">WhatsApp</button><button class="btn btn-ghost" type="button" data-copy-task-person="${escapeHtml(id)}" style="padding:4px 9px;font-size:.76rem">Copiar texto</button>
      <span style="width:9px;height:9px;border-radius:50%;background:${linked ? '#1A6B3C' : 'var(--danger)'}"></span>
      ${context.usuario.apps.mestre || context.usuario.apps.tarefas ? `<button class="btn btn-ghost" type="button" data-edit-task-person="${escapeHtml(id)}" style="padding:4px 9px;font-size:.76rem">Editar</button>` : ''}
    </div>`
}

function taskRoleCheck(role: keyof NonNullable<TarefasPessoa['roles']>, label: string, checked: boolean): string {
  return `<label style="display:flex;align-items:center;gap:6px;font-size:.8rem"><input class="task-person-role" type="checkbox" value="${escapeHtml(role)}" ${checked ? 'checked' : ''}>${escapeHtml(label)}</label>`
}

function openTaskPersonModal(id: string | null): void {
  if (!context.usuario.apps.mestre && (!context.usuario.apps.tarefas || !id)) { toast('Sem permissão para configurar este participante'); return }
  const person = id ? pessoas[id] : undefined
  const unavailable = Array.isArray(person?.unavailableDates)
    ? person.unavailableDates
    : Object.entries(person?.unavailableDates ?? {}).filter(([, blocked]) => blocked).map(([date]) => date)
  const masterOptions = Object.entries(masterPeople)
    .filter(([mid, item]) => item.active !== false && (person?.masterId === mid || !Object.values(pessoas).some(candidate => candidate.masterId === mid)))
    .sort(([, a], [, b]) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'pt-BR'))
    .map(([mid, item]) => `<option value="${escapeHtml(mid)}" ${person?.masterId === mid ? 'selected' : ''}>${escapeHtml(item.name || mid)}${Object.values(masterPeople).filter(other=>other.name===item.name).length>1?' · ID '+escapeHtml(mid):''}</option>`)
    .join('')
  const roles = person?.roles ?? {}
  // Nome canônico vem do Admin — exibir somente leitura
  const displayName = person?.masterId
    ? (masterPeople[person.masterId]?.name ?? personName(person, id ?? ''))
    : ''
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal">
    <h2>${id ? 'Editar participante' : 'Vincular pessoa'}</h2>
    ${id ? `<div class="form-group">
      <label class="form-label">Nome (gerenciado pelo Admin)</label>
      <div style="padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius);
        background:var(--surface2);color:var(--ink-2);font-size:.92rem">
        ${escapeHtml(displayName)}
      </div>
      <div class="form-help">WhatsApp: ${escapeHtml(personPhone(person) || 'não informado')}. Edite os dados pessoais no Admin.</div>
    </div>` : ''}
    <div class="form-group"><label class="form-label" for="taskPersonMaster">Pessoa do cadastro Admin</label><select id="taskPersonMaster" class="form-select" ${!context.usuario.apps.mestre || id && person?.masterId ? 'disabled' : ''}><option value="">Selecionar pelo nome ou ID...</option>${masterOptions}</select></div>
    <div class="module-form-grid">
      <div class="form-group"><label class="form-label" for="taskPersonRule">Reuniões</label><select id="taskPersonRule" class="form-select"><option value="both" ${(person?.rule ?? 'both') === 'both' ? 'selected' : ''}>Todas</option><option value="midweek" ${person?.rule === 'midweek' ? 'selected' : ''}>Meio de semana</option><option value="weekend" ${person?.rule === 'weekend' ? 'selected' : ''}>Fim de semana</option><option value="none" ${person?.rule === 'none' ? 'selected' : ''}>Fora da escala</option></select></div>
      <div class="form-group"><label class="form-label" for="taskPersonSection">Seção de fim de semana</label><select id="taskPersonSection" class="form-select"><option value="s1" ${person?.weekendSection === 's1' ? 'selected' : ''}>1ª seção</option><option value="s2" ${person?.weekendSection !== 's1' ? 'selected' : ''}>2ª seção</option></select></div>
      <div class="form-group"><label class="form-label" for="taskPersonRest">Referência da folga</label><input id="taskPersonRest" class="form-input" type="date" value="${escapeHtml(person?.refFolgaDate)}"></div>
    </div>
    <div class="form-group"><span class="form-label" style="display:block;margin-bottom:6px">Funções</span><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${taskRoleCheck('presidente', 'Presidente', roles.presidente === true)}${taskRoleCheck('operador', 'Operador', roles.operador === true)}${taskRoleCheck('leitor', 'Leitor', roles.leitor === true)}${taskRoleCheck('entrada', 'Entrada', roles.entrada === true)}${taskRoleCheck('auditorio', 'Auditório', roles.auditorio === true)}${taskRoleCheck('microfone', 'Microfone', roles.microfone === true)}</div></div>
    <div class="form-group"><label class="form-label" for="taskPersonUnavailable">Datas indisponíveis</label><textarea id="taskPersonUnavailable" class="form-input" rows="3" placeholder="AAAA-MM-DD, uma por linha">${escapeHtml(unavailable.join('\n'))}</textarea></div>
    <div style="display:flex;gap:14px;margin-bottom:14px"><label style="display:flex;align-items:center;gap:6px;font-size:.82rem"><input id="taskPersonActive" type="checkbox" ${personIsActive(person ?? {}) ? 'checked' : ''}>Ativo</label><label style="display:flex;align-items:center;gap:6px;font-size:.82rem"><input id="taskPersonYoung" type="checkbox" ${person?.jovem ? 'checked' : ''}>Jovem</label></div>
    <div style="display:flex;gap:8px"><button id="cancelTaskPerson" class="btn btn-ghost" type="button" style="flex:1">Cancelar</button><button id="saveTaskPerson" class="btn btn-primary" type="button" style="flex:1">Salvar</button></div>
  </div>`
  document.body.appendChild(overlay)
  document.getElementById('cancelTaskPerson')?.addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', event => { if (event.target === overlay) overlay.remove() })
  document.getElementById('saveTaskPerson')?.addEventListener('click', () => void saveTaskPerson(id, overlay))
}

async function saveTaskPerson(id: string | null, overlay: HTMLElement): Promise<void> {
  if (!context.usuario.apps.mestre && (!context.usuario.apps.tarefas || !id)) { toast('Sem permissão para configurar este participante'); return }
  const person = id ? pessoas[id] : undefined
  const input = (elementId: string) => (document.getElementById(elementId) as HTMLInputElement).value.trim()
  const unavailableDates = input('taskPersonUnavailable').split(/[\s,;]+/).filter(Boolean)
  if (unavailableDates.some(date => !isValidCivilDate(date))) { toast('Revise as datas indisponíveis'); return }
  const roles: Record<string, boolean> = {}
  document.querySelectorAll<HTMLInputElement>('.task-person-role').forEach(checkbox => { roles[checkbox.value] = checkbox.checked })
  const selectedMasterId = (document.getElementById('taskPersonMaster') as HTMLSelectElement).value || person?.masterId || ''
  const central = masterPeople[selectedMasterId]
  if (!selectedMasterId || !central) { toast('Selecione uma pessoa do cadastro Admin'); return }
  const duplicate = Object.entries(pessoas).some(([personId, candidate]) => personId !== id && candidate.masterId === selectedMasterId)
  if (duplicate) { toast('Esta pessoa já está vinculada em Tarefas'); return }
  const finalId = id ?? `tar_${selectedMasterId}`
  const patch: Record<string, unknown> = {
    [`${finalId}/masterId`]: selectedMasterId,
    [`${finalId}/rule`]: input('taskPersonRule'),
    [`${finalId}/weekendSection`]: input('taskPersonSection'),
    [`${finalId}/refFolgaDate`]: input('taskPersonRest'),
    [`${finalId}/unavailableDates`]: unavailableDates.length ? unavailableDates : null,
    [`${finalId}/active`]: (document.getElementById('taskPersonActive') as HTMLInputElement).checked,
    [`${finalId}/jovem`]: (document.getElementById('taskPersonYoung') as HTMLInputElement).checked,
  }
  Object.entries(roles).forEach(([role, enabled]) => { patch[`${finalId}/roles/${role}`] = enabled })
  const release=editorBusy(overlay)
  try {
    await update(tarefasPeopleRef, patch)
    overlay.remove()
    toast('Participante atualizado')
    await loadTarefas()
  } catch {
    editorError(overlay)
    toast('Não foi possível salvar o participante')
  } finally { release() }
}

function emptyState(text: string): string {
  return `
    <div class="module-placeholder" style="padding:34px 18px">
      <p>${escapeHtml(text)}</p>
    </div>`
}

async function gerarPdfTarefas(preferredFontPt: number): Promise<void> {
  if (changingPublication || downloadingPdf) return
  const periodId = periodKeyForDate(`${selectedPeriodMonth}-01`, selectedPeriodMode)
  const meetings = Object.values(periods[periodId]?.meetings ?? {}).filter(meeting => canonicalMeetingType(meeting.type)).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  if (meetings.length === 0) {
    toast('Nenhuma reunião para gerar PDF')
    return
  }
  downloadingPdf = true
  const button = document.getElementById('btnTarefasPdf') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.textContent = 'Preparando PDF...' }
  try { const { downloadTaskSchedulePdf } = await import('./tarefas-documents'); await downloadTaskSchedulePdf(meetings, congregationName, pessoas, preferredFontPt, periodId); toast('Download do PDF iniciado') }
  catch { toast('Não foi possível gerar o PDF') }
  finally { downloadingPdf = false; if (button) { button.disabled = false; button.textContent = 'Baixar PDF' } }
}

async function gerarXlsxTarefas(): Promise<void> {
  const month = selectedPeriodMonth
  const meetings = Object.values(periods[month]?.meetings ?? {}).filter(meeting => canonicalMeetingType(meeting.type))
  if (!meetings.length) { toast('Nenhuma reunião para gerar XLSX'); return }
  const button = document.getElementById('btnTarefasXlsx') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.textContent = 'Preparando XLSX...' }
  try {
    const { downloadTaskScheduleXlsx } = await import('./tarefas-documents')
    await downloadTaskScheduleXlsx(meetings, congregationName, pessoas, month)
    toast('Download do XLSX iniciado')
  } catch { toast('Não foi possível gerar o XLSX') }
  finally { if (button) { button.disabled = false; button.textContent = 'Baixar XLSX' } }
}
