import { focusCorrection, fieldHelp } from '../ui/field-guidance'
import { substitutionDialog } from '../ui/substitution-dialog'
import { closeRecordEditor, mountRecordEditor } from '../ui/record-editor'
import { taskSubstitutes } from './substitution-domain'
import { canonicalTaskPerson } from './central-person'
import { fortalezaToday, fortalezaCurrentMonth, isValidCivilDate, nextCivilMonth } from './civil-date'
import { tasksPersonMessage, tasksDayMessage } from './tarefas-messages'
import { showMessagePreview } from '../ui/message-preview'
import type { LimpezaPeriodoGerado } from '../types'
import { editorBusy, editorError } from '../ui/editor-feedback'
import { lockPublicationUi } from '../ui/publication-busy'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import type { AppContext } from '../types'
import {
  get,
  compareAndUpdate,
  update,
  tarefasRef,
  agendaConfigRef, child, limpezaPeriodosRef,
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
  assignmentForRole,
  canonicalMeetingType,
  computeGeneration,
  manualConflictReason,
  meetingIsBlocked,
  meetingEntries,
  periodKeyForDate,
  personIsActive,
  personName,
  personPhone,
  roleApplies,
  normalizeTaskGenerationRules,
  withCanonicalPeriod,
  type TaskDomainContext,
  type TaskEvent,
  type TaskGenerationRules,
  type TaskMeeting,
  type TaskPeriod,
  type TaskPerson,
  type TaskRole,
} from './tarefas-domain'
import { formatTaskDate } from './tarefas-output'
import { publishModulePeriod, renderPublicationStatus } from './module-publication'
import { defaultModuleMessageSettings, mountModuleMessageSettings, type ModuleMessageSettings } from './module-message-settings'

type TarefasTab = 'indice' | 'escala' | 'participantes' | 'pendencias' | 'config'

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
  meetingDays?: { midweekDow?: number; weekendDow?: number }
  midweekDow?: number
  weekendDow?: number
  excludedDates?: string[] | Record<string, string>
  engineRules?: Partial<TaskGenerationRules>
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
let cleaningPeriods:Record<string,LimpezaPeriodoGerado>={}
let congregationName = 'Noroeste'
let masterPeople: Record<string, { name?: string; whatsapp?: string; active?: boolean }> = {}
let context: AppContext
const TAREFAS_PERIOD_KEY = 'noroeste:tarefas:period'
const TAREFAS_PERIOD_MODE_KEY = 'noroeste:tarefas:period-mode'
const TAREFAS_PENDING_DATES_KEY = 'noroeste:tarefas:pending-dates'
const TAREFAS_ROLE_KEY = 'noroeste:tarefas:generate-role'

let selectedPeriodMonth = monthNow()
let selectedPeriodMode: 'month' | 'bimester' = 'bimester'
let onlyPendingMeetings = localStorage.getItem(TAREFAS_PENDING_DATES_KEY) === 'true'
let selectedGenerateRole = localStorage.getItem(TAREFAS_ROLE_KEY) ?? ''
let participantSearch = ''
let participantMeetingRule = ''
let participantRoleFilter = ''
let pendingTarget: PendingTarget | null = null
let downloadingPdf = false
let changingPublication = false
let loadPromise: Promise<boolean> | null = null


function showTaskMessage(message:string,phone?:string):void {
  showMessagePreview({id:'taskMessagePreview',title:'Mensagem de Tarefas',message,phone,allowNoPhone:phone===undefined,toast})
}

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
  return { people: pessoas, periods, events, discursos, engineRules:planning.engineRules }
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
  void openTarefasTab(ctx.overview?.pending?'pendencias':'escala')
}

function ensureLoaded(): Promise<boolean> {
  loadPromise ??= loadTarefas()
  return loadPromise
}

async function loadTarefas(): Promise<boolean> {
  try {
    const [tarefasSnap, congregacaoSnap, masterPeopleSnap, messagesSnap, cleaningSnap] = await Promise.all([
      get(tarefasRef),
      get(configCongregacaoRef),
      get(pessoasRef),
      get<ModuleMessageSettings>(child(agendaConfigRef,'moduleWhatsApp/tarefas')),
      context.usuario.apps.limpeza||context.usuario.apps.mestre?get<Record<string,LimpezaPeriodoGerado>>(limpezaPeriodosRef):Promise.resolve(null),
    ])

    const tarefas = tarefasSnap.exists() ? tarefasSnap.val() as {
      people?: Record<string, TarefasPessoa>
      scale?: { periods?: Record<string, TarefasPeriod> }
      planning?: TarefasPlanning
      discursos?: TaskDomainContext['discursos']
      events?: Record<string, TaskEvent>
    } : {}
    taskMessageSettings={...defaultModuleMessageSettings('tarefas'),...(messagesSnap.val()??{})}
    cleaningPeriods=cleaningSnap?.val()??{}
    pessoas = tarefas.people ?? {}
    periods = tarefas.scale?.periods ?? {}
    planning = tarefas.planning ?? {}
    const savedPeriod = context.overview?.month ?? localStorage.getItem(TAREFAS_PERIOD_KEY) ?? planning.editingPeriod ?? planning.scaleStartDate?.slice(0, 7)
    delete context.overview
    selectedPeriodMonth = /^\d{4}-\d{2}$/.test(savedPeriod ?? '') ? savedPeriod! : monthNow()
    const savedPeriodMode = localStorage.getItem(TAREFAS_PERIOD_MODE_KEY)
    selectedPeriodMode = savedPeriodMode === 'month' || savedPeriodMode === 'bimester'
      ? savedPeriodMode
      : planning.periodMode === 'month' ? 'month' : 'bimester'
    events = tarefas.events ?? {}
    discursos = tarefas.discursos ?? {}
    const congregacao = congregacaoSnap.exists() ? (congregacaoSnap.val() as { nome?: string }) : {}
    congregationName = congregacao.nome?.trim() || 'Noroeste'
    masterPeople = masterPeopleSnap.exists() ? (masterPeopleSnap.val() as Record<string, { name?: string; whatsapp?: string; active?: boolean }>) : {}
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
  else if (activeTab === 'pendencias') renderPendencias()
  else renderTaskConfig()
}

function renderNavigation(): void {
  const host = document.getElementById('tarefasNav')
  if (host) renderWorkspaceNav(host, 'Tarefas', 'escala', activeTab, [
    { id:'escala', label:'Escala' }, { id:'participantes', label:'Pessoas' },
    { id:'pendencias', label:'Pendências' }, { id:'config', label:'Configurações' },
  ], id => { void openTarefasTab(id as TarefasTab) })
}

function renderIndex(): void {
  const content = document.getElementById('tarefasContent')
  if (!content) return
  content.innerHTML = `<div style="margin-bottom:14px"><h2 style="font-size:1.05rem;color:#7E3AF2;margin-bottom:2px">Tarefas</h2></div><div id="tarefasMenu"></div>`
  const items: ItemMenu[] = [
    { id: 'escala', titulo: 'Escala', subtitulo: 'Escolha o período, gere e revise a escala', icone: '▣', corFundo: '#003F72' },
    { id: 'participantes', titulo: 'Pessoas', subtitulo: 'Participantes e vínculos com Admin', icone: '♙', corFundo: '#006EB6' },
    { id: 'pendencias', titulo: 'Pendências', subtitulo: 'Disponibilidade e preparação do próximo período', icone: '!', corFundo: '#B3261E' },
    { id: 'config', titulo: 'Configuração', subtitulo: 'Período, regras, datas e mensagens', icone: '⚙', corFundo: '#5C6062' },
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
    ${locked ? '<div class="notice">Esta escala está publicada no Minha Agenda e bloqueada para edição.</div>' : '<div class="notice warning">Rascunho administrativo: publique para aparecer no Minha Agenda.</div>'}
    <div class="task-period-toolbar">
      <div class="module-form-grid">
        <div class="form-group" style="margin:0"><label class="form-label" for="tarefasPeriodMode">Formato</label><select id="tarefasPeriodMode" class="form-select"><option value="month" ${periodMode === 'month' ? 'selected' : ''}>Mensal</option><option value="bimester" ${periodMode === 'bimester' ? 'selected' : ''}>Bimestral</option></select></div>
        <div class="form-group" style="margin:0"><label class="form-label" for="tarefasPeriodMonth">Período</label><input id="tarefasPeriodMonth" class="form-input" type="month" value="${escapeHtml(selectedPeriodMonth)}"></div>
      </div>
      <div class="scale-actions" style="margin-top:8px">
        <button id="btnGenerateScale" class="btn ${allPeriodMeetings.length ? 'btn-ghost' : 'btn-primary'}" type="button" ${locked ? 'disabled' : ''}>Gerar escala · ${activeRules} regras</button>
        <button id="btnTarefasPdf" class="btn btn-ghost" type="button" ${allPeriodMeetings.length ? '' : 'disabled'}>Baixar PDF</button>
        <button id="btnToggleTaskLock" class="btn ${locked ? 'btn-ghost' : 'btn-primary'}" type="button" ${allPeriodMeetings.length ? '' : 'disabled'}>${locked ? 'Reabrir para edição' : 'Publicar no Quadro'}</button>
        <details><summary>Mais opções</summary><button id="btnClearTaskScale" class="btn btn-danger" type="button" ${locked || !allPeriodMeetings.length ? 'disabled' : ''}>Limpar escala</button></details>
      </div>
      <details style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <summary style="cursor:pointer;font-size:.86rem;font-weight:700;color:var(--ink-2)">Refazer uma função ou ajustar a impressão</summary>
        <div class="module-form-grid" style="margin-top:10px">
          <div class="form-group" style="margin:0"><label class="form-label" for="tarefasGenerateRole">Função</label><select id="tarefasGenerateRole" class="form-select"><option value="">Escolha a função</option>${TASK_ROLES.map(role => `<option value="${role}" ${role === selectedGenerateRole ? 'selected' : ''}>${escapeHtml(TASK_ROLE_LABELS[role])}</option>`).join('')}</select></div>
          <div class="scale-actions" style="align-items:end"><button id="btnGenerateTaskRole" class="btn btn-ghost" type="button" ${locked ? 'disabled' : ''}>Gerar função</button><button id="btnClearTaskRole" class="btn btn-danger" type="button" ${locked ? 'disabled' : ''}>Limpar função</button></div>
        </div>
        <label style="display:flex;align-items:center;gap:7px;margin-top:12px;font-size:.84rem;color:var(--ink-2)"><input id="tarefasOnlyPending" type="checkbox" ${onlyPendingMeetings ? 'checked' : ''}> Apenas datas pendentes</label>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px"><label class="form-label" for="tarefasPrintFont" style="margin:0;white-space:nowrap">Letra do PDF</label><input id="tarefasPrintFont" class="form-input" type="range" min="${PRINT_MIN_PT}" max="${PRINT_MAX_PT}" step="1" value="${font}" style="padding:0;flex:1"><span id="tarefasPrintFontValue" style="min-width:42px;text-align:right;font-size:.82rem;font-weight:700;color:var(--ink-2)">${font} pt</span></div>
      </details>
    </div>
    <details class="form-panel"><summary>Mensagem das designações do dia</summary><label class="form-field"><span>Data</span><select id="taskMessageDate">${[...new Set(allPeriodMeetings.map(meeting=>meeting.date).filter(Boolean))].map(date=>`<option value="${escapeHtml(date)}">${escapeHtml(formatDate(date))}</option>`).join('')}</select></label><button id="taskSendDay" class="btn btn-ghost" type="button" ${allPeriodMeetings.length?'':'disabled'}>Ver mensagem do dia</button></details>
    <div class="task-desktop-scale">${taskDesktopTable(allPeriodMeetings)}</div>
    <div class="task-mobile-scale" style="display:flex;flex-direction:column;gap:8px">
      ${allPeriodMeetings.length
        ? allPeriodMeetings.map(meeting => meetingCard(meeting)).join('')
        : emptyState('Nenhuma reunião cadastrada neste período.')}
    </div>
    ${preservedMeetings.length ? `<details class="form-panel" style="margin-top:12px"><summary>Registros preservados fora do período atual (${preservedMeetings.length})</summary><div class="module-option-list" style="margin-top:10px">${preservedMeetings.map(entry => `<div class="module-list-row"><div><strong>${escapeHtml(formatDate(entry.meeting.date))}</strong><small>${canonicalMeetingType(entry.meeting.type) === 'midweek' ? 'Meio de semana' : 'Fim de semana'} · ${assignmentCount(entry.meeting)} função(ões)</small></div></div>`).join('')}</div></details>` : ''}`

  document.getElementById('taskSendDay')?.addEventListener('click',()=>{const date=(document.getElementById('taskMessageDate') as HTMLSelectElement).value;const cleaning=Object.values(cleaningPeriods).flatMap(period=>Object.values(period.semanas??{})).find(week=>week.dataMeioSemana===date||week.dataFimSemana===date)?.grupoNome||'';showTaskMessage(tasksDayMessage(date,pessoas,allPeriodMeetings,cleaning,taskMessageSettings.meetingText))})
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

  document.getElementById('btnGenerateScale')?.addEventListener('click', () => {
    const monthInput = document.getElementById('tarefasPeriodMonth') as HTMLInputElement | null
    const modeInput = document.getElementById('tarefasPeriodMode') as HTMLSelectElement | null
    if (!monthInput || !/^\d{4}-\d{2}$/.test(monthInput.value)) { toast('Selecione um período válido'); return }
    selectedPeriodMonth = monthInput.value
    localStorage.setItem(TAREFAS_PERIOD_KEY, selectedPeriodMonth)
    const mode = modeInput?.value === 'month' ? 'month' : 'bimester'
    void generateScale(`${selectedPeriodMonth}-01`, mode, null, onlyPendingMeetings)
  })
  document.getElementById('btnGenerateTaskRole')?.addEventListener('click', () => {
    const role = (document.getElementById('tarefasGenerateRole') as HTMLSelectElement).value as TaskRole
    if (!role) { toast('Escolha a função que deseja gerar'); return }
    void generateScale(`${selectedPeriodMonth}-01`, periodMode, role, onlyPendingMeetings)
  })
  document.getElementById('btnClearTaskRole')?.addEventListener('click', () => {
    const role = (document.getElementById('tarefasGenerateRole') as HTMLSelectElement).value as TaskRole
    if (!role) { toast('Escolha a função que deseja limpar'); return }
    void clearTaskRole(selectedPeriodId, role)
  })
  document.getElementById('btnToggleTaskLock')?.addEventListener('click', () => void toggleTaskLock(selectedPeriodId))
  document.getElementById('btnClearTaskScale')?.addEventListener('click', () => void clearTaskScale(selectedPeriodId))
  document.getElementById('tarefasOnlyPending')?.addEventListener('change', event => {
    onlyPendingMeetings = (event.target as HTMLInputElement).checked
    localStorage.setItem(TAREFAS_PENDING_DATES_KEY, String(onlyPendingMeetings))
  })
  document.getElementById('tarefasGenerateRole')?.addEventListener('change', event => {
    selectedGenerateRole = (event.target as HTMLSelectElement).value
    localStorage.setItem(TAREFAS_ROLE_KEY, selectedGenerateRole)
  })
  document.getElementById('tarefasPeriodMonth')?.addEventListener('change', event => {
    const value = (event.target as HTMLInputElement).value
    const mode = (document.getElementById('tarefasPeriodMode') as HTMLSelectElement | null)?.value === 'month' ? 'month' : 'bimester'
    if (/^\d{4}-\d{2}$/.test(value)) {
      selectedPeriodMonth = periodKeyForDate(`${value}-01`, mode)
      localStorage.setItem(TAREFAS_PERIOD_KEY, selectedPeriodMonth)
    }
    renderEscala()
  })
  document.getElementById('tarefasPeriodMode')?.addEventListener('change', event => {
    const mode = (event.target as HTMLSelectElement).value === 'month' ? 'month' : 'bimester'
    selectedPeriodMode = mode
    planning.periodMode = mode
    localStorage.setItem(TAREFAS_PERIOD_MODE_KEY, mode)
    selectedPeriodMonth = periodKeyForDate(`${selectedPeriodMonth}-01`, mode)
    localStorage.setItem(TAREFAS_PERIOD_KEY, selectedPeriodMonth)
    void update(tarefasPlanejamentoRef, { periodMode:mode }).catch(()=>toast('O formato foi aplicado neste aparelho, mas não foi possível salvar o padrão.'))
    renderEscala()
  })
  fieldHelp(content,'#tarefasPeriodMode','Mensal mostra um mês; bimestral reúne dois meses. A troca não apaga escalas.')
  content.querySelectorAll<HTMLDetailsElement>('[data-meeting-key]').forEach(card=>card.addEventListener('toggle',()=>{const key=card.dataset.meetingKey!;if(card.open)expandedTaskMeetings.add(key);else expandedTaskMeetings.delete(key)}))
  bindAssignmentEditors()
  content.querySelectorAll<HTMLButtonElement>('[data-edit-meeting]').forEach(button=>button.addEventListener('click',()=>{
    const periodId=button.dataset.period!, meetingId=button.dataset.editMeeting!
    const meeting=periods[periodId]?.meetings?.[meetingId]
    if(meeting)openMeetingEditor(periodId,meetingId,meeting)
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
    toast(locked ? 'Escala reaberta para edição' : 'Escala publicada no Minha Agenda')
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

async function generateScale(startDate: string, mode: 'month' | 'bimester', role: TaskRole | null, onlyPending: boolean): Promise<void> {
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
    const result = computeGeneration(context, startDate, role, generatedAt, canonical.periodId, onlyPending, todayStr(), planning.engineRules)
    if (result.aborted) {
      showGenerationErrors(result.errors)
      return
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
    await update(tarefasRef, patch)
    planning = { ...nextPlanning, editingPeriod: selectedPeriodMonth, scaleStartDate: undefined, generatedAt }
    toast(result.generated ? `${result.generated} designações geradas; vagas sem candidato ficaram vazias` : 'Escala preparada; vagas sem candidato ficaram vazias')
    await loadTarefas()
  } catch {
    toast('Não foi possível gerar a escala')
  } finally {
    if (button?.isConnected) button.disabled = false
  }
}

function showGenerationErrors(errors: string[]): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal"><h2>Escala não gerada</h2><div style="display:flex;flex-direction:column;gap:8px">${errors.slice(0, 20).map(error => `<div style="font-size:.8rem;padding:8px 10px;border-left:3px solid #B3261E;background:var(--surface-2)">${escapeHtml(error)}</div>`).join('')}</div>${errors.length > 20 ? `<p class="form-help">Mais ${errors.length - 20} conflito(s).</p>` : ''}<button id="closeGenerationErrors" class="btn btn-primary btn-full" type="button" style="margin-top:14px">Voltar para a escala</button></div>`
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
  content.querySelectorAll<HTMLButtonElement>('[data-message-task-person]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.messageTaskPerson!;showTaskMessage(tasksPersonMessage(id,pessoas,scaleMeetingEntries().map(entry=>entry.meeting),todayStr(),taskMessageSettings.meetingText),personPhone(pessoas[id]))}))
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
  const canEditRules = context.usuario.apps.mestre === true || context.usuario.apps.tarefas === true
  content.innerHTML = `${sectionTitle('Configuração', 'Preferências próprias de Tarefas. O formato e a letra do PDF são ajustados diretamente na Escala.')}
    <div class="form-panel" data-editor-scope><h3 style="margin-top:0">Regras do motor</h3><p class="form-help">Estas opções valem apenas para as próximas gerações. Regras de integridade continuam obrigatórias.</p><div class="engine-rule-list"><label><input id="taskRuleSpeakers" type="checkbox" ${rules.evitarConflitosOradores ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Evitar designar quem tem discurso ou saída de Oradores na mesma data (S2)</label><label><input id="taskRulePresident" type="checkbox" ${rules.presidenteSegundaTarefa ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Aproveitar o presidente em uma segunda tarefa mecânica</label><label><input id="taskRuleBalance" type="checkbox" ${rules.equilibrarDesignacoes ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Equilibrar o total de designações</label><label><input id="taskRuleRepeat" type="checkbox" ${rules.evitarRepetirFuncao ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Evitar repetir a mesma função</label></div>${canEditRules ? '<div class="scale-actions" style="margin-top:12px"><button id="saveTaskRules" class="btn btn-primary" type="button">Salvar regras</button><button id="restoreTaskRules" class="btn btn-ghost" type="button">Restaurar padrões</button></div>' : '<div class="notice">Somente o Admin pode alterar estas regras.</div>'}</div>
    <div class="form-panel"><h3 style="margin-top:0">Datas sem reunião</h3><div style="display:flex;gap:8px"><input id="taskExcludedDate" class="form-input" type="date"><button id="addTaskExcludedDate" class="btn btn-ghost" type="button">Adicionar</button></div><div class="module-option-list" style="margin-top:10px">${dates.map(date => `<div class="module-list-row"><strong>${escapeHtml(formatDate(date))}</strong><button class="btn btn-danger" data-remove-task-date="${escapeHtml(date)}" type="button">Remover</button></div>`).join('') || '<p class="empty-state">Nenhuma data excluída.</p>'}</div></div><div id="taskMessageSettings"></div>`
  document.getElementById('taskRuleSpeakers')?.closest('.form-panel')?.insertAdjacentHTML('beforeend', '<details class="workspace-disclosure"><summary>Regras fixas sem liga/desliga</summary><p class="form-help">O motor sempre respeita pessoa ativa, função habilitada, tipo de reunião, folga e indisponibilidade cadastradas, reunião bloqueada e incompatibilidade entre funções. Também mantém as restrições de participação dos jovens. Essas proteções não são preferências de distribuição.</p></details>')
  content.querySelectorAll<HTMLElement>(':scope > .form-panel').forEach((panel, index) => {
    const details = document.createElement('details')
    details.className = 'workspace-disclosure'
    const summary = document.createElement('summary')
    const heading = panel.querySelector('h3')
    summary.textContent = heading?.textContent ?? 'Período e impressão'
    heading?.remove()
    details.open = index === 0
    panel.replaceWith(details)
    details.append(summary, panel)
  })
  document.getElementById('saveTaskRules')?.addEventListener('click', () => void saveTaskRules())
  document.getElementById('restoreTaskRules')?.addEventListener('click', () => void saveTaskRules(DEFAULT_TASK_GENERATION_RULES))
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

type PendingLevel = 'alta' | 'media' | 'baixa'

const pendingLevelLabel: Record<PendingLevel, string> = { alta: 'Alta', media: 'Media', baixa: 'Baixa' }
const pendingLevelColor: Record<PendingLevel, string> = { alta: '#B3261E', media: '#8A5B00', baixa: '#006EB6' }

function renderPendencias(): void {
  const content = document.getElementById('tarefasContent')
  if (!content) return

  const items: Array<{ level: PendingLevel; title: string; detail: string; tab: TarefasTab; target?: PendingTarget }> = []
  const preparationMonth = nextCivilMonth(todayStr())
  const nextPeriodId = periodKeyForDate(`${preparationMonth}-01`, planning.periodMode === 'month' ? 'month' : 'bimester')
  if (planning.availabilityReviewedMonth !== preparationMonth) {
    items.push({
      level: 'media',
      title: 'Revisar disponibilidades para ' + preparationMonth.slice(5, 7) + '/' + preparationMonth.slice(0, 4),
      detail: 'Confira funções, folgas e datas indisponíveis; depois marque a revisão em Participantes.',
      tab: 'participantes',
    })
  }
  if (!periods[nextPeriodId]?.generatedAt) {
    items.push({
      level: 'alta',
      title: 'Gerar a escala antes de 01/' + preparationMonth.slice(5, 7),
      detail: 'Prepare o próximo período, mesmo que algumas funções fiquem vagas.',
      tab: 'escala',
      target: { periodId: nextPeriodId },
    })
  }
  const futureEntries = scaleMeetingEntries()
    .filter(entry => entry.meeting.date && entry.meeting.date >= todayStr() && canonicalMeetingType(entry.meeting.type) && !meetingIsBlocked(domainContext(), entry.meeting))
  futureEntries.forEach(entry => {
    const { meeting } = entry
    GENERATED_ROLES.forEach(role => {
      const personId = assignmentForRole(meeting, role)
      if (!personId) return
      const person = pessoas[personId]
      if (!person) {
        items.push({
          level: 'alta',
          title: `${roleLabel(role)} aponta para pessoa inexistente`,
          detail: `${formatDate(meeting.date)} · ID ${personId}.`,
          tab: 'escala',
          target: { periodId:entry.periodId, meetingId:entry.meetingId, role },
        })
        return
      }
      if (!isActive(person)) {
        items.push({
          level: 'media',
          title: `${roleLabel(role)} aponta para participante inativo`,
          detail: `${formatDate(meeting.date)} · ${pessoaNome(person, personId)} está inativo em Tarefas.`,
          tab: 'escala',
          target: { periodId:entry.periodId, meetingId:entry.meetingId, role },
        })
      }
      const conflict = manualConflictReason(domainContext(), entry, role, personId)
      if (conflict) {
        items.push({
          level: 'media',
          title: `${roleLabel(role)} com conflito`,
          detail: `${formatDate(meeting.date)} · ${pessoaNome(person, personId)}: ${conflict}.`,
          tab: 'escala',
          target: { periodId: entry.periodId, meetingId: entry.meetingId, role },
        })
      }
    })
  })

  Object.entries(pessoas).filter(([,person])=>isActive(person)&&!person.masterId).forEach(([personId,person])=>{
    items.push({level:'baixa',title:personName(person,personId)+' sem vínculo com Admin',detail:context.usuario.apps.mestre?'Abra o participante e selecione a pessoa do cadastro central.':'Solicite ao Admin o vínculo desta pessoa. Você pode consultar o cadastro.',tab:'participantes',target:{personId}})
  })
  const counts = items.reduce<Record<PendingLevel, number>>((acc, item) => {
    acc[item.level] += 1
    return acc
  }, { alta: 0, media: 0, baixa: 0 })

  content.innerHTML = `
    ${sectionTitle('Pendências', items.length ? 'Pendências de revisão e avisos cadastrais. Toque para abrir a correção; escalas publicadas precisam ser reabertas.' : 'A escala atual não tem pendências identificadas.')}
    ${items.length ? `<div class="pending-summary"><span style="background:#B3261E">Alta: ${counts.alta}</span><span style="background:#8A5B00">Media: ${counts.media}</span><span style="background:#006EB6">Baixa: ${counts.baixa}</span></div>` : ''}
    ${items.length
      ? `<div style="display:flex;flex-direction:column;gap:8px">${items.map((item, index) => `<button class="module-menu-btn" type="button" data-pending-index="${index}" style="border-radius:8px;padding:12px 14px;border-left:4px solid ${pendingLevelColor[item.level]}"><div style="flex:1;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="pending-badge" style="background:${pendingLevelColor[item.level]}">${pendingLevelLabel[item.level]}</span><div class="mod-label">${escapeHtml(item.title)}</div></div><div class="mod-desc">${escapeHtml(item.detail)}</div></div><span style="font-size:1.1rem;color:${pendingLevelColor[item.level]}">›</span></button>`).join('')}</div>`
      : '<div style="padding:18px;border:1px solid #B7DEC7;background:#F1FAF4;border-radius:8px;color:#1A6B3C;font-size:.84rem">Tudo certo por enquanto.</div>'}`

  content.querySelectorAll<HTMLButtonElement>('[data-pending-index]').forEach(button => {
    button.addEventListener('click', () => {
      const item = items[Number(button.dataset['pendingIndex'])]
      if (!item) return
      pendingTarget = item.target ?? null
      if (item.target?.periodId) { selectedPeriodMonth = item.target.periodId.slice(0,7); selectedPeriodMode=planning.periodMode === 'month' ? 'month' : 'bimester' }
      if(item.tab==='participantes'){participantSearch='';participantMeetingRule='';participantRoleFilter=''}
      activeTab = item.tab
      renderContent()
      if(item.tab==='escala'&&!item.target)focusCorrection(document.getElementById('tarefasPeriodMonth'))
    })
  })
}

function sectionTitle(title: string, desc: string): string {
  return `
    <div style="margin-bottom:14px">
      ${moduleBackButton()}
      <h2 style="font-size:1.05rem;color:#7E3AF2;margin-bottom:2px">${escapeHtml(title)}</h2>
      <p style="font-size:.8rem;color:var(--ink-3)">${escapeHtml(desc)}</p>
    </div>`
}

function taskDesktopTable(meetings: TarefasMeeting[]): string {
  if (!meetings.length) return emptyState('Nenhuma reunião cadastrada neste período.')
  return `<div class="task-scale-table-wrap"><table class="task-scale-table"><thead><tr><th>Reunião</th>${TASK_ROLES.map(role => `<th>${escapeHtml(TASK_ROLE_LABELS[role])}</th>`).join('')}</tr></thead><tbody>${meetings.map(meeting => { const ref = meetingRefFor(meeting), locked = ref ? periods[ref.periodId]?.locked === true : false; return `<tr data-task-meeting-id="${escapeHtml(ref?.meetingId)}"><th><strong>${escapeHtml(formatDate(meeting.date))}</strong><small>${canonicalMeetingType(meeting.type) === 'midweek' ? 'Meio' : 'Fim'}</small>${ref&&!locked?`<button class="btn btn-ghost" type="button" data-edit-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Editar</button>`:''}</th>${TASK_ROLES.map(role => `<td>${meetingAllowsRole(meeting, role) && ref ? assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked) : '<span class="task-not-applicable">—</span>'}</td>`).join('')}</tr>` }).join('')}</tbody></table></div>`
}

const expandedTaskMeetings=new Set<string>()
function meetingCard(meeting: TarefasMeeting): string {
  const count = assignmentCount(meeting)
  const type = canonicalMeetingType(meeting.type) === 'midweek' ? 'Meio de semana' : 'Fim de semana'
  const ref = meetingRefFor(meeting)
  const locked = ref ? periods[ref.periodId]?.locked === true : false
  const roles = ref ? GENERATED_ROLES.filter(role => meetingAllowsRole(meeting, role)) : []
  const assignedRoles = roles.filter(role => Boolean(assignmentForRole(meeting, role)))
  const vacantRoles = roles.filter(role => !assignmentForRole(meeting, role))
  const editors = ref ? `${assignedRoles.map(role => assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked)).join('')}${vacantRoles.length ? `<details class="task-vacant-roles" ${pendingTarget?.meetingId === ref.meetingId && pendingTarget.role && vacantRoles.includes(pendingTarget.role) ? 'open' : ''}><summary>${vacantRoles.length} ${vacantRoles.length === 1 ? 'função' : 'funções'} sem pessoa</summary>${vacantRoles.map(role => assignmentEditor(ref.periodId, ref.meetingId, meeting, role, locked)).join('')}</details>` : ''}` : ''

  return `
    <details data-meeting-key="${escapeHtml(ref?.periodId+'/'+ref?.meetingId)}" ${pendingTarget?.meetingId === ref?.meetingId || expandedTaskMeetings.has(ref?.periodId+'/'+ref?.meetingId) ? 'open' : ''} data-task-meeting-id="${escapeHtml(ref?.meetingId)}" style="background:var(--surface);border:1px solid ${pendingTarget?.meetingId === ref?.meetingId ? '#7E3AF2' : 'var(--border)'};box-shadow:${pendingTarget?.meetingId === ref?.meetingId ? '0 0 0 3px #EAE1FA' : 'none'};border-radius:8px;padding:10px 12px">
      <summary class="task-meeting-summary">
        <div style="min-width:0">
          <div style="font-size:.9rem;font-weight:700;color:var(--ink)">${formatDate(meeting.date)}</div>
          <div style="font-size:.76rem;color:var(--ink-3)">${escapeHtml(type)}</div>
        </div>
        <span style="font-size:.75rem;font-weight:700;color:${locked ? '#B3261E' : '#7E3AF2'}">
          ${locked ? 'Publicado' : `${count} função${count === 1 ? '' : 'ões'}`}
        </span>
      </summary>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">
        ${editors}
        ${ref&&!locked?`<button class="btn btn-ghost" type="button" data-edit-meeting="${escapeHtml(ref.meetingId)}" data-period="${escapeHtml(ref.periodId)}">Editar reunião</button>`:''}
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
      substitutionDialog({title:`${TASK_ROLE_LABELS[role]} · ${formatDate(entry.meeting.date)}`,current:original?pessoaNome(pessoas[original]??{},original):'Vago',candidates:taskSubstitutes(domainContext(),entry,role),save:async id=>{
        if(normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores)discursos=(await get(tarefasDiscursosRef)).val() as TaskDomainContext['discursos']??{}
        const reason=manualConflictReason(domainContext(),entry,role,id)
        if(reason)throw new Error(reason)
        return saveAssignment(periodId,meetingId,role,id)
      }})
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
  form.innerHTML = `<h3>Editar reunião</h3><p class="form-help">${escapeHtml(formatDate(meeting.date))} · ${canonicalMeetingType(meeting.type)==='midweek'?'Meio de semana':'Fim de semana'}</p><div class="task-meeting-fields">${roles.map(role=>`<label class="form-field"><span>${escapeHtml(TASK_ROLE_LABELS[role])}</span><select class="form-select" data-meeting-role="${role}">${options(role)}</select></label>`).join('')}</div><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar reunião</button><button id="cancelTaskMeeting" class="btn btn-ghost" type="button">Cancelar</button></div>`
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
    const release=editorBusy(form)
    try {
      if(normalizeTaskGenerationRules(planning.engineRules).evitarConflitosOradores){const snapshot=await get(tarefasDiscursosRef);discursos=snapshot.exists()?snapshot.val() as TaskDomainContext['discursos']: {}}
      const conflicts=changedRoles.flatMap(role=>{const id=String(next.assignments?.[role]??'');const reason=id?manualConflictReason(domainContext(),{periodId,meetingId,meeting:next},role,id):null;return reason?[`${TASK_ROLE_LABELS[role]}: ${reason}`]:[]})
      if(conflicts.length&&!confirm(`Há conflitos nesta escolha:\n${conflicts.join('\n')}\nManter mesmo assim?`))return
      await compareAndUpdate(tarefasScaleRef,{[`${periodId}/meetings/${meetingId}`]:baseline},{[`${periodId}/meetings/${meetingId}`]:next})
      periods[periodId]!.meetings![meetingId]=next
      toast('Reunião atualizada')
      renderEscala()
    } catch {editorError(form,'Não foi possível salvar a reunião. Seu preenchimento foi mantido.')}
    finally{release()}
  })
}

async function saveAssignment(periodId: string, meetingId: string, role: string, personId: string): Promise<boolean> {
  if (!periodId || !meetingId || !role) return false
  if (periods[periodId]?.locked) { toast('Esta escala está travada'); return false }
  const path = `${periodId}/meetings/${meetingId}`
  try {
    const baseline=periods[periodId]?.meetings?.[meetingId]
    if(!baseline)return false
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
    <div data-task-person-id="${escapeHtml(id)}" style="background:var(--surface);border:1px solid ${focused ? '#7E3AF2' : 'var(--border)'};box-shadow:${focused ? '0 0 0 3px #EAE1FA' : 'none'};border-radius:8px;
      padding:9px 12px;display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:.88rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escapeHtml(pessoaNome(p, id))}
        </div>
        <div style="font-size:.72rem;color:var(--ink-3)">
          ${active ? 'Ativo' : 'Inativo'} · ${meetings} · ${recentUsage} função${recentUsage === 1 ? '' : 'ões'} em 6 meses${lastUse ? ` · Última ${formatDate(lastUse)}` : ''}
        </div>
        <div style="font-size:.72rem;color:var(--ink-3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(roles)}</div>
      </div>
      <button class="btn btn-ghost" type="button" data-message-task-person="${escapeHtml(id)}" style="padding:4px 9px;font-size:.76rem">Mensagem</button>
      <span style="width:9px;height:9px;border-radius:50%;background:${linked ? '#1A6B3C' : '#B3261E'}"></span>
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
