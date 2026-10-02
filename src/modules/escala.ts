import { focusCorrection, fieldHelp, requestMasterCorrection } from '../ui/field-guidance'
import { substitutionDialog } from '../ui/substitution-dialog'
import { navigateTo } from '../router'
import { editorBusy, editorError, editorSaved } from '../ui/editor-feedback'
import { lockPublicationUi } from '../ui/publication-busy'
import type { AppContext, RawPessoas } from '../types'
import { apiJson } from '../secure-api.ts'
import { child, compareAndUpdate, escalaRef, get, pessoasRef, update } from '../firebase'
import { renderMenuCards, type ItemMenu } from '../ui/menu-cards'
import { moduleBackButton } from '../ui/module-header'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import {
  DEFAULT_ESCALA_GENERATION_RULES, ESCALA_RULE_LABELS, activeDates, analyzeCell, availabilityKey, generateAll,
  isBlocked, isPublishedMonth, isValidMonth, localSlots, normalizeEscalaGenerationRules, participantName, validatePair,
  participantDirectoryForHistory,
  type EscalaAvailability, type EscalaBlocks, type EscalaGenerationInput, type EscalaGenerationRules,
  type EscalaLocal, type EscalaParticipant, type EscalaPublishedSnapshot, type EscalaTable, type EscalaTables,
} from './escala-domain'
import {
  confirmationMessage, dayLabel, monthLabel,
} from './escala-output'
import type { createScaleSchedulePdf } from './escala-documents'
import { publishModulePeriod, renderPublicationStatus } from './module-publication'
import { addCivilDays, fortalezaToday, fortalezaCurrentMonth, isValidCivilDate, nextCivilMonth } from './civil-date'
import { publicationPeriod } from './publication-contract'

type Tab = 'indice' | 'locais' | 'participantes' | 'disponibilidade' | 'escalaAtual' | 'mensagens' | 'pendencias' | 'config'
type Participants = Record<string, EscalaParticipant>
type Locals = Record<string, EscalaLocal>
interface Settings { groupWhatsAppLink?: string; printFontPt?: number; engineRules?: Partial<EscalaGenerationRules> }
interface Greetings { date?: string; participant?: string; confirm?: string }
interface Data {
  participants?: Participants; scales?: Locals; availability?: EscalaAvailability
  tables?: EscalaTables; monthSlotBlocks?: EscalaBlocks; monthExclusions?: Record<string, string[]>
  settings?: Settings; greetings?: Greetings; publishedMonth?: string; editingMonth?: string
  publishedMonths?: Record<string, boolean>
  publishedSnapshots?: Record<string, EscalaPublishedSnapshot>
  notified?: Record<string, Record<string, string>>
}

let context: AppContext
let participants: Participants = {}, pessoas: RawPessoas = {}, locals: Locals = {}
let rawParticipants: Participants = {}
const participantBaselines = new WeakMap<HTMLElement, Participants>()
let historicalSnapshots: Record<string, EscalaPublishedSnapshot> = {}
let availability: EscalaAvailability = {}, tables: EscalaTables = {}, blocks: EscalaBlocks = {}
let exclusions: Record<string, string[]> = {}, settings: Settings = {}, greetings: Greetings = {}
let publishedMonth = '', selectedMonth = monthNow(), selectedLocalId = '', selectedParticipantId = ''
let publishedMonths: Record<string, boolean> = {}
let publishedMonthBaseline: string | null = null
let tab: Tab = 'indice'
let pendingParticipantId = ''
let downloadingPdf = false
let changingPublication = false
let loadPromise: Promise<boolean> | null = null
const monthLocked = (month = selectedMonth) => isPublishedMonth(month, publishedMonth, publishedMonths)

function scalePdfInput(): Parameters<typeof createScaleSchedulePdf>[0] {
  return { month:selectedMonth, locals, tables, participants:participantDirectory(), exclusions:exclusions[selectedMonth] ?? [], requestedFontPt:Number(settings.printFontPt ?? 12) }
}

const ESCALA_MONTH_KEY = 'noroeste:escala:month'
const ESCALA_LOCAL_KEY = 'noroeste:escala:local'

const root = () => document.getElementById('escalaContent')!
const orderedLocals = (includeInactive = false) => Object.entries(locals).filter(([, local]) => includeInactive || local.active !== false).sort((a, b) => Number(a[1].sortOrder ?? 0) - Number(b[1].sortOrder ?? 0))
const orderedPeople = (active = false) => Object.entries(participants).filter(([, p]) => !active || p.active !== false).sort((a, b) => name(a[0]).localeCompare(name(b[0]), 'pt-BR'))
const centralId = (id: string) => participants[id]?.masterId ?? (pessoas[id] ? id : '')
const participantDirectory = () => participantDirectoryForHistory(participants, historicalSnapshots)
const name = (id: string) => pessoas[centralId(id)]?.name ?? participantName(participantDirectory()[id], id)
const phoneOf = (id: string) => pessoas[centralId(id)]?.whatsapp ?? participants[id]?.phone ?? ''
const now = () => new Date().toISOString()
const isAdmin = () => context.usuario.apps.mestre === true
const canConfigureRules = () => isAdmin() || context.usuario.apps.escala === true

function monthNow(): string {
  return fortalezaCurrentMonth()
}
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]!)
}
function toast(message: string): void {
  const element = document.getElementById('toast'); if (!element) return
  element.textContent = message; element.classList.add('show')
  setTimeout(() => element.classList.remove('show'), 3200)
}
function input(localId = selectedLocalId): EscalaGenerationInput {
  return { month:selectedMonth, localId, local:locals[localId], participants, availability, tables, blocks, exclusions:exclusions[selectedMonth] ?? [], rules:settings.engineRules }
}

export default function mount(ctx: AppContext): void {
  context = ctx; tab = 'indice'; selectedLocalId = ''; selectedParticipantId = ''; loadPromise = null
  participants = {}; pessoas = {}; locals = {}; historicalSnapshots = {}; availability = {}; tables = {}; blocks = {}; exclusions = {}; settings = {}; greetings = {}; publishedMonth = ''; publishedMonths = {}
  document.getElementById('appContent')!.innerHTML = '<div id="escalaRoot"><div id="escalaNav"></div><div id="escalaContent"></div></div>'
  void go(ctx.overview?.pending?'pendencias':'escalaAtual')
}
function ensureLoaded(): Promise<boolean> {
  loadPromise ??= load()
  return loadPromise
}
async function load(): Promise<boolean> {
  try {
    const [snap, peopleSnap] = await Promise.all([get(escalaRef), get(pessoasRef)])
    const data = snap.exists() ? snap.val() as Data : {}
    locals = data.scales ?? {}; availability = data.availability ?? {}
    tables = data.tables ?? {}; blocks = data.monthSlotBlocks ?? {}; exclusions = data.monthExclusions ?? {}
    settings = data.settings ?? {}; greetings = data.greetings ?? {}; publishedMonth = data.publishedMonth ?? ''; publishedMonthBaseline = data.publishedMonth ?? null
    publishedMonths = data.publishedMonths ?? {}
    const savedMonth = context.overview?.month ?? localStorage.getItem(ESCALA_MONTH_KEY) ?? data.editingMonth
    delete context.overview
    selectedMonth = isValidMonth(savedMonth ?? '') ? savedMonth! : monthNow()
    pessoas = peopleSnap.exists() ? peopleSnap.val() as RawPessoas : {}
    const rawProfiles = data.participants ?? {}
    rawParticipants = structuredClone(rawProfiles)
    participants = Object.fromEntries(Object.entries(rawProfiles).map(([id, profile]) => {
      const mid = profile.masterId ?? (pessoas[id] ? id : '')
      const central = pessoas[mid]
      return [id, central ? { ...profile, masterId:mid, active:profile.active !== false && central.active !== false, name: central.name, sex: central.sex ?? profile.sex, phone: central.whatsapp ?? profile.phone } : { ...profile, active:false }]
    }))
    historicalSnapshots = data.publishedSnapshots ?? {}
    const savedLocal = localStorage.getItem(ESCALA_LOCAL_KEY) ?? ''
    selectedLocalId = locals[savedLocal] ? savedLocal : orderedLocals()[0]?.[0] ?? ''
    selectedParticipantId = orderedPeople(true)[0]?.[0] ?? ''
  } catch (error) { console.error(error); toast('Não foi possível carregar a Escala TPL'); return false }
  return true
}
async function go(next: Tab): Promise<void> {
  const host = root()
  tab = next
  renderNavigation()
  host.innerHTML = `${moduleBackButton()}<p class="empty-state">Carregando dados...</p>`
  const loaded = await ensureLoaded()
  if (!host.isConnected || tab !== next) return
  if (!loaded) {
    loadPromise = null
    host.innerHTML = `${moduleBackButton()}<p class="empty-state">Não foi possível carregar a Escala TPL.</p><button id="retryScale" class="btn btn-primary">Tentar novamente</button>`
    document.getElementById('retryScale')?.addEventListener('click', () => void go(next))
    return
  }
  tab = next; render()
}
function render(): void {
  renderNavigation()
  if (tab === 'indice') renderIndex()
  else if (tab === 'locais') renderLocais()
  else if (tab === 'participantes') renderParticipants()
  else if (tab === 'disponibilidade') renderAvailability()
  else if (tab === 'escalaAtual') renderScale()
  else if (tab === 'mensagens') renderMessages()
  else if (tab === 'pendencias') renderPending()
  else renderConfig()
  if (tab !== 'indice' && !root().querySelector('[data-module-index-marker]')) root().insertAdjacentHTML('afterbegin', moduleBackButton())
}
function renderNavigation(): void {
  const host = document.getElementById('escalaNav')
  if (host) renderWorkspaceNav(host, 'Escala TPL', 'escalaAtual', ['disponibilidade','mensagens'].includes(tab)?'participantes':tab, [
    { id:'escalaAtual', label:'Escala' },
    { id:'participantes', label:'Pessoas' },
    { id:'config', label:'Mais opções', children:[{ id:'config', label:'Regras e mensagens' }, { id:'locais', label:'Locais e horários' }, { id:'pendencias', label:'Conferência' }] },
  ], id => { void go(id as Tab) })
}
function renderIndex(): void {
  root().innerHTML = '<div style="margin-bottom:14px"><h2 style="font-size:1.05rem;color:#1A6B3C">Escala TPL</h2></div><div id="escalaMenu"></div>'
  const items: ItemMenu[] = [
    { id: 'escalaAtual', titulo: 'Escala do mês', subtitulo: 'Gerar, revisar, editar e publicar', icone: '▣', corFundo: '#003F72' },
    { id: 'participantes', titulo: 'Pessoas', subtitulo: 'Cadastro, disponibilidade e mensagens', icone: '♙', corFundo: '#1A6B3C' },
    { id: 'config', titulo: 'Mais opções', subtitulo: 'Locais, regras, impressão e conferência', icone: '⚙', corFundo: '#5C6062' },
  ]
  renderMenuCards(root().querySelector<HTMLElement>('#escalaMenu')!, items, id => { void go(id as Tab) })
}

function periodControls(local = true): string {
  return `<div class="module-form-grid" style="margin-bottom:12px"><div class="form-group"><label class="form-label">Período</label><input id="eMonth" class="form-input" type="month" value="${selectedMonth}"></div>${local ? `<div class="form-group"><label class="form-label">Local</label><select id="eLocal" class="form-select">${orderedLocals().map(([id, l]) => `<option value="${esc(id)}" ${id === selectedLocalId ? 'selected' : ''}>${esc(l.name ?? id)}</option>`).join('')}</select></div>` : ''}</div>`
}
function bindPeriod(rerender: () => void): void {
  if (!root().querySelector('[data-module-index-marker]')) root().insertAdjacentHTML('afterbegin', moduleBackButton())
  document.getElementById('eMonth')?.addEventListener('change', event => {
    const value = (event.target as HTMLInputElement).value
    if (isValidMonth(value)) { selectedMonth = value; localStorage.setItem(ESCALA_MONTH_KEY, value); rerender() }
  })
  document.getElementById('eLocal')?.addEventListener('change', event => { selectedLocalId = (event.target as HTMLSelectElement).value; localStorage.setItem(ESCALA_LOCAL_KEY, selectedLocalId); rerender() })
}

const DOW_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function renderLocais(): void {
  root().innerHTML = `<div style="display:flex;gap:8px;margin-bottom:12px"><span style="flex:1"></span>${isAdmin() ? '<button id="lNew" class="btn btn-primary" type="button">Novo local</button>' : ''}</div><div id="lList" class="module-option-list">${orderedLocals(true).map(([id, l]) => {
    const dias = (l.daysActive ?? []).map(d => DOW_LABELS[d]).join(', ') || 'nenhum dia ativo'
    const horarios = localSlots(l)
    return `<button class="module-menu-btn" type="button" data-local="${esc(id)}"><div class="mod-icon" style="background:#8A5B0020;color:#8A5B00">⌖</div><div><div class="mod-label">${esc(l.name ?? id)}${l.active === false ? ' · Inativo' : ''}</div><div class="mod-desc">${esc(dias)} · ${horarios.length} horário(s)/dia</div></div></button>`
  }).join('') || '<p class="empty-state">Nenhum local cadastrado ainda.</p>'}</div>`
  document.querySelectorAll<HTMLButtonElement>('[data-local]').forEach(button => button.addEventListener('click', () => { if (!isAdmin()) { toast('Somente o Admin pode editar locais'); return } localModal(button.dataset['local']!) }))
  document.getElementById('lNew')?.addEventListener('click', () => localModal(''))
}
function localModal(id: string): void {
  const l = locals[id] ?? {}
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal"><h2>${id ? 'Editar local' : 'Novo local'}</h2><div class="form-group"><label class="form-label">Nome</label><input id="lmName" class="form-input" value="${esc(l.name ?? '')}"></div><label style="display:flex;gap:8px;margin-bottom:12px"><input id="lmActive" type="checkbox" ${l.active !== false ? 'checked' : ''}> Local ativo</label><div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">${DOW_LABELS.map((label, dow) => `<label><input type="checkbox" data-lmday="${dow}" ${(l.daysActive ?? []).includes(dow) ? 'checked' : ''}> ${label}</label>`).join('')}</div><div class="module-form-grid"><div class="form-group"><label class="form-label">Início</label><input id="lmStart" class="form-input" type="time" value="${esc(l.startTime ?? l.start ?? '08:00')}"></div><div class="form-group"><label class="form-label">Fim</label><input id="lmEnd" class="form-input" type="time" value="${esc(l.endTime ?? l.end ?? '18:00')}"></div><div class="form-group"><label class="form-label">Intervalo (min)</label><input id="lmStep" class="form-input" type="number" min="15" step="15" value="${Number(l.stepMinutes ?? l.intervalMin ?? 120)}"></div><div class="form-group"><label class="form-label">Ordem de exibição</label><input id="lmOrder" class="form-input" type="number" value="${Number(l.sortOrder ?? Object.keys(locals).length)}"></div></div><p class="form-help">Pré-visualização dos horários:</p><p id="lmPreview" class="form-help" style="font-weight:600"></p><div style="display:flex;gap:8px">${id ? '<button id="lmDelete" class="btn btn-danger" type="button">Remover local</button>' : ''}<span style="flex:1"></span><button id="lmCancel" class="btn btn-ghost">Cancelar</button><button id="lmSave" class="btn btn-primary">Salvar</button></div></div>`
  document.body.appendChild(overlay)
  const preview = () => {
    const start = (document.getElementById('lmStart') as HTMLInputElement).value, end = (document.getElementById('lmEnd') as HTMLInputElement).value, step = Number((document.getElementById('lmStep') as HTMLInputElement).value) || 120
    const slots = localSlots({ startTime: start, endTime: end, stepMinutes: step })
    document.getElementById('lmPreview')!.textContent = slots.length ? slots.join(' · ') : 'Nenhum horário — confira início/fim/intervalo'
  }
  ;['lmStart', 'lmEnd', 'lmStep'].forEach(fieldId => document.getElementById(fieldId)!.addEventListener('input', preview))
  preview()
  document.getElementById('lmCancel')!.addEventListener('click', () => overlay.remove())
  document.getElementById('lmSave')!.addEventListener('click', () => void saveLocal(id, overlay))
  document.getElementById('lmDelete')?.addEventListener('click', () => void deleteLocal(id, overlay))
}
async function saveLocal(id: string, overlay: HTMLElement): Promise<void> {
  const nome = (document.getElementById('lmName') as HTMLInputElement).value.trim()
  if (!nome) { toast('Dê um nome ao local'); return }
  const daysActive = [...document.querySelectorAll<HTMLInputElement>('[data-lmday]')].filter(box => box.checked).map(box => Number(box.dataset['lmday']))
  if (!daysActive.length) { toast('Marque ao menos um dia ativo'); return }
  const startTime = (document.getElementById('lmStart') as HTMLInputElement).value
  const endTime = (document.getElementById('lmEnd') as HTMLInputElement).value
  const stepMinutes = Number((document.getElementById('lmStep') as HTMLInputElement).value)
  if (!startTime || !endTime || !Number.isFinite(stepMinutes) || stepMinutes < 15 || !localSlots({ startTime, endTime, stepMinutes }).length) { toast('Confira início, fim e intervalo dos horários'); return }
  const local: EscalaLocal = {
    name: nome, daysActive,
    startTime, endTime, stepMinutes,
    slots:localSlots({ startTime, endTime, stepMinutes }),
    sortOrder: Number((document.getElementById('lmOrder') as HTMLInputElement).value) || 0,
    active: (document.getElementById('lmActive') as HTMLInputElement).checked,
  }
  const target = id || `loc_${Date.now()}`
  const release=editorBusy(overlay)
  try { await update(child(escalaRef, `scales/${target}`), local); locals[target] = local; overlay.remove(); toast('Local salvo'); renderLocais() } catch { editorError(overlay);toast('Não foi possível salvar o local') } finally { release() }
}
async function deleteLocal(id: string, overlay: HTMLElement): Promise<void> {
  const used = Boolean(tables[id] && Object.keys(tables[id]).length)
  if (used) {
    if (!confirm(`Este local possui histórico. Inativar "${locals[id]?.name ?? id}" sem apagar as escalas?`)) return
    try { await update(escalaRef, { [`scales/${id}/active`]: false }); locals[id]!.active = false; overlay.remove(); toast('Local inativado; histórico preservado'); renderLocais() } catch { toast('Não foi possível inativar o local') }
    return
  }
  if (!confirm(`Remover "${locals[id]?.name ?? id}"? O local ainda não possui escala registrada.`)) return
  try {
    const patch: Record<string, unknown> = { [`scales/${id}`]: null, [`tables/${id}`]: null, [`availability/${id}`]: null, [`manualEdits/${id}`]: null }
    Object.keys(blocks).forEach(scope => { patch[`monthSlotBlocks/${scope}/${id}`] = null })
    await update(escalaRef, patch)
    delete locals[id]; delete tables[id]; delete availability[id]
    Object.values(blocks).forEach(scope => { delete scope[id] })
    overlay.remove(); toast('Local removido'); renderLocais()
  } catch { toast('Não foi possível apagar o local') }
}

function renderParticipants(): void {
  const unlinked = orderedPeople().filter(([id]) => !centralId(id)).length
  root().innerHTML = `${unlinked ? `<div class="notice warning">${unlinked} participante(s) legado(s) sem vínculo com o cadastro do Admin.</div>` : ''}<div style="display:flex;gap:8px;margin-bottom:12px"><input id="pSearch" class="form-input" type="search" placeholder="Buscar participante" aria-label="Buscar participante" style="flex:1">${isAdmin() ? '<button id="pNew" class="btn btn-primary" type="button">Vincular pessoa</button>' : ''}</div><div id="pList" class="module-option-list"></div>`
  const list = () => {
    const term = (document.getElementById('pSearch') as HTMLInputElement).value.trim().toLocaleLowerCase('pt-BR')
    const rows=orderedPeople().filter(([id]) => name(id).toLocaleLowerCase('pt-BR').includes(term))
    if(!rows.some(([id])=>id===selectedParticipantId))selectedParticipantId=rows[0]?.[0]??''
    document.getElementById('pList')!.innerHTML = rows.map(([id, p]) => {
      const count = Object.values(availability).reduce((sum, byPerson) => sum + Object.values(byPerson[id] ?? {}).filter(Boolean).length, 0)
      const details = [p.active === false ? 'Inativo' : 'Ativo', p.pioneer ? 'Pioneiro' : '', p.capPerMonth ? `Máx. ${p.capPerMonth}/mês` : 'Sem limite mensal', p.startFromDate ? `A partir de ${p.startFromDate}` : '', p.onlyWithId ? `Só com ${name(p.onlyWithId)}` : '', `${count} horários`].filter(Boolean).join(' · ')
      return `<article class="entity-card"><div class="entity-card-head"><div><strong>${esc(name(id))}</strong><small>${esc(details)}</small></div><span class="status-pill">${p.active===false?'Inativo':'Ativo'}</span></div><div class="service-actions">${isAdmin()?`<button class="btn btn-ghost" type="button" data-person="${esc(id)}">Editar</button>`:''}<button class="btn btn-ghost" type="button" data-person-availability="${esc(id)}">Disponibilidade</button><button class="btn btn-primary" type="button" data-person-confirmation="${esc(id)}">Preparar confirmação</button></div></article>`
    }).join('') || '<p class="empty-state">Nenhum participante encontrado.</p>'
    document.querySelectorAll<HTMLButtonElement>('[data-person]').forEach(button => button.addEventListener('click', () => {
      if (!isAdmin()) { toast('Somente o Admin pode editar participantes'); return }
      participantModal(button.dataset['person']!)
    }))
    document.querySelectorAll<HTMLButtonElement>('[data-person-availability]').forEach(button=>button.addEventListener('click',()=>openPersonAvailability(button.dataset.personAvailability!)))
    document.querySelectorAll<HTMLButtonElement>('[data-person-confirmation]').forEach(button=>button.addEventListener('click',()=>{selectedParticipantId=button.dataset.personConfirmation!;void go('mensagens')}))
  }
  list(); document.getElementById('pSearch')!.addEventListener('input', list); document.getElementById('pNew')?.addEventListener('click', () => participantModal(''))
  if (pendingParticipantId && participants[pendingParticipantId] && isAdmin()) participantModal(pendingParticipantId)
}
function participantModal(id: string): void {
  if (!isAdmin()) { toast('Somente o Admin pode editar participantes'); return }
  const isNew = !id
  const p = isNew ? { active: true } as EscalaParticipant : participants[id]!
  const currentMid = id ? centralId(id) : ''
  const availablePeople = Object.entries(pessoas)
    .filter(([mid, person]) => person.active && (mid === currentMid || !Object.keys(participants).some(profileId => centralId(profileId) === mid)))
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
  const masterOptions = availablePeople.map(([mid, person]) => `<option value="${esc(mid)}" ${mid === currentMid ? 'selected' : ''}>${esc(person.name)} · ID ${esc(mid)}</option>`).join('')
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal"><h2>${isNew ? 'Adicionar participante' : esc(name(id))}</h2>${isNew ? `<div class="form-group"><label class="form-label">Pessoa do cadastro Admin</label><select id="pmMaster" class="form-select"><option value="">Selecionar pelo nome ou ID...</option>${masterOptions}</select></div>` : `<div class="form-help" style="margin-bottom:12px">Nome e WhatsApp vêm do cadastro Admin (${esc(phoneOf(id) || 'sem WhatsApp')}) — edite lá se precisar mudar.</div>`}<div class="module-form-grid"><div class="form-group"><label class="form-label">Máximo/mês (0 sem limite)</label><input id="pmCap" class="form-input" type="number" min="0" max="99" value="${Number(p.capPerMonth ?? 0)}"></div><div class="form-group"><label class="form-label">Participa a partir de</label><input id="pmStart" class="form-input" type="date" value="${esc(p.startFromDate ?? '')}"></div><div class="form-group"><label class="form-label">Referência da folga</label><input id="pmFolga" class="form-input" type="date" value="${esc(p.refFolgaDate ?? '')}"></div><div class="form-group"><label class="form-label">Só participa com</label><select id="pmOnly" class="form-select"><option value="">Sem restrição</option>${orderedPeople(true).filter(([other]) => other !== id).map(([other]) => `<option value="${esc(other)}" ${p.onlyWithId === other ? 'selected' : ''}>${esc(name(other))}</option>`).join('')}</select></div></div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px"><label><input id="pmActive" type="checkbox" ${p.active !== false ? 'checked' : ''}> Ativo na Escala</label><label><input id="pmPioneer" type="checkbox" ${p.pioneer ? 'checked' : ''}> Pioneiro</label><label><input id="pmChild" type="checkbox" ${p.withChild ? 'checked' : ''}> Acompanha criança</label><label><input id="pmSame" type="checkbox" ${p.sameSexOnly ? 'checked' : ''}> Mesmo sexo</label></div><div class="form-group"><label class="form-label">Observação da Escala</label><textarea id="pmObs" class="form-input">${esc(p.obs ?? '')}</textarea></div><div style="display:flex;gap:8px">${isNew ? '' : '<button id="pmRemove" class="btn btn-danger" type="button">Remover da Escala</button>'}<span style="flex:1"></span><button id="pmCancel" class="btn btn-ghost">Cancelar</button><button id="pmSave" class="btn btn-primary">Salvar</button></div></div>`
  document.body.appendChild(overlay)
  fieldHelp(overlay,'#pmCap','Ex.: 2 limita a duas participações no mês. Use 0 para não limitar.')
  fieldHelp(overlay,'#pmFolga','Informe uma data conhecida de folga para a alternância usada na escala.')
  participantBaselines.set(overlay, structuredClone(rawParticipants))
  document.getElementById('pmCancel')!.addEventListener('click', () => overlay.remove())
  document.getElementById('pmSave')!.addEventListener('click', () => void saveParticipant(id, overlay))
  document.getElementById('pmRemove')?.addEventListener('click', () => void removeParticipant(id, overlay))
}
async function saveParticipant(id: string, overlay: HTMLElement): Promise<void> {
  const button = overlay.querySelector<HTMLButtonElement>('#pmSave')!
  const removeButton = overlay.querySelector<HTMLButtonElement>('#pmRemove')
  if (button.disabled) return
  if (!isAdmin()) { toast('Somente o Admin pode editar participantes'); return }
  const value = (target: string) => (overlay.querySelector(`#${target}`) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
  const mid = id ? centralId(id) : (document.getElementById('pmMaster') as HTMLSelectElement).value
  if (!mid || !pessoas[mid]) { toast('Selecione uma pessoa do cadastro Admin'); return }
  if ([value('pmStart'),value('pmFolga')].some(date=>date&&!isValidCivilDate(date))) { toast('Informe datas válidas'); return }
  const target = id || mid
  const activeNow = (document.getElementById('pmActive') as HTMLInputElement).checked
  const onlyWithId = value('pmOnly') || undefined
  const profile = { ...(target === mid ? {} : { masterId: mid }), capPerMonth: Math.min(99, Math.max(0, Number(value('pmCap')) || 0)), startFromDate: value('pmStart'), refFolgaDate: value('pmFolga'), onlyWithId: onlyWithId ?? null, active: activeNow, pioneer: (document.getElementById('pmPioneer') as HTMLInputElement).checked, withChild: (document.getElementById('pmChild') as HTMLInputElement).checked, sameSexOnly: (document.getElementById('pmSame') as HTMLInputElement).checked, obs: value('pmObs').trim(), updatedAt: now() }
  const release=editorBusy(overlay)
  button.disabled = true
  if (removeButton) removeButton.disabled = true
  try {
    const dependentIds = activeNow ? [] : participantReferencesTo(target)
    const patch = Object.fromEntries(Object.entries(profile).map(([key, field]) => [`participants/${target}/${key}`, field]))
    dependentIds.forEach(otherId => { patch[`participants/${otherId}/onlyWithId`] = null })
    const baseline = participantBaselines.get(overlay) ?? {}
    const expected = Object.fromEntries(Object.keys(patch).map(path => {
      const [, participantId, field] = path.split('/')
      return [path, (baseline[participantId!] as unknown as Record<string, unknown> | undefined)?.[field!] ?? null]
    }))
    await compareAndUpdate(escalaRef, expected, patch)
    rawParticipants[target] = { ...rawParticipants[target], ...profile, onlyWithId }
    participants[target] = { ...participants[target], ...profile, onlyWithId, name: pessoas[mid].name, sex: pessoas[mid].sex ?? '', phone: pessoas[mid].whatsapp ?? '' }
    dependentIds.forEach(otherId => { participants[otherId]!.onlyWithId = undefined; if (rawParticipants[otherId]) rawParticipants[otherId]!.onlyWithId = undefined })
    const stillOpen = overlay.isConnected
    overlay.remove(); toast('Participante salvo'); if (stillOpen && tab === 'participantes') renderParticipants()
  } catch (error) { editorError(overlay);toast(error instanceof Error ? error.message : 'Não foi possível salvar') }
  finally { release();button.disabled = false; if (removeButton) removeButton.disabled = false }
}
async function removeParticipant(id: string, overlay: HTMLElement): Promise<void> {
  const removeButton = overlay.querySelector<HTMLButtonElement>('#pmRemove')!
  const saveButton = overlay.querySelector<HTMLButtonElement>('#pmSave')!
  if (removeButton.disabled || saveButton.disabled) return
  const uses = Object.values(tables).reduce((sum, byMonth) => sum + Object.values(byMonth).reduce((s, table) => s + Object.values(table.rows ?? {}).reduce((n, row) => n + Object.values(row.slots ?? {}).filter(cell => cell.p1 === id || cell.p2 === id).length, 0), 0), 0)
  if (uses) { toast(`${name(id)} aparece em ${uses} horário(s). Inative o participante antes de removê-lo.`); return }
  if (!confirm(`Remover ${name(id)} da Escala?`)) return
  removeButton.disabled = true; saveButton.disabled = true
  try {
    const dependentIds = participantReferencesTo(id)
    await apiJson('workflow-transition', { method:'POST', body:JSON.stringify({ action:'remove-participant', key:id, expected:participantBaselines.get(overlay)?.[id] ?? null }) })
    delete participants[id]; delete rawParticipants[id]; Object.keys(availability).forEach(localId => { delete availability[localId]?.[id] })
    dependentIds.forEach(otherId => { participants[otherId]!.onlyWithId = undefined; if (rawParticipants[otherId]) rawParticipants[otherId]!.onlyWithId = undefined })
    const stillOpen = overlay.isConnected
    overlay.remove(); toast('Participante removido da Escala'); if (stillOpen && tab === 'participantes') renderParticipants()
  } catch (error) { toast(error instanceof Error ? error.message : 'Não foi possível remover') }
  finally { removeButton.disabled = false; saveButton.disabled = false }
}
function participantReferencesTo(id: string): string[] {
  return Object.entries(participants)
    .filter(([otherId, participant]) => otherId !== id && participant.onlyWithId === id)
    .map(([otherId]) => otherId)
}
function openPersonAvailability(id:string):void {
  if(!participants[id]||participants[id]?.active===false){toast('Ative o participante para editar a disponibilidade.');return}
  selectedParticipantId=id
  document.getElementById('scaleAvailabilityDialog')?.remove()
  const overlay=document.createElement('div');overlay.id='scaleAvailabilityDialog';overlay.className='modal-overlay'
  overlay.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="personAvailabilityTitle"><h2 id="personAvailabilityTitle">Disponibilidade de ${esc(name(id))}</h2><div id="participantAvailability"></div><button id="closePersonAvailability" class="btn btn-primary" type="button">Concluir</button></div>`
  document.body.appendChild(overlay)
  document.getElementById('closePersonAvailability')!.addEventListener('click',()=>{overlay.remove();renderParticipants()})
  renderAvailability()
}
function renderAvailability(): void {
  const host=document.getElementById('participantAvailability')??root()
  const people = orderedPeople(true), local = locals[selectedLocalId]
  if (!selectedParticipantId || participants[selectedParticipantId]?.active === false) selectedParticipantId = people[0]?.[0] ?? ''
  if (!local || !selectedParticipantId) { host.innerHTML = '<p class="empty-state">Cadastre um local e participantes ativos primeiro.</p>'; return }
  const marked = availability[selectedLocalId]?.[selectedParticipantId] ?? {}, days = local.daysActive ?? [], slots = localSlots(local), labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  host.innerHTML = `<div class="module-form-grid" style="margin-bottom:12px"><div class="form-group"><label class="form-label">Local</label><select id="aLocal" class="form-select">${orderedLocals().map(([id, item]) => `<option value="${esc(id)}" ${id === selectedLocalId ? 'selected' : ''}>${esc(item.name ?? id)}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Participante</label><select id="aPerson" class="form-select">${people.map(([id]) => `<option value="${esc(id)}" ${id === selectedParticipantId ? 'selected' : ''}>${esc(name(id))}</option>`).join('')}</select></div></div><p class="form-help" style="margin-bottom:10px">Toque no dia para marcar todos os seus horários. Cada alteração é salva automaticamente.</p><p id="availabilitySaveStatus" role="status" aria-live="polite"></p><div class="availability-wrap"><table class="availability-table"><thead><tr><th>Dia</th>${slots.map(time => `<th><button class="table-toggle" data-atime="${time}">${time}</button></th>`).join('')}</tr></thead><tbody>${days.map(dow => `<tr><th><button class="table-toggle" data-aday="${dow}">${labels[dow]}</button></th>${slots.map(time => { const key = availabilityKey(dow, time); return `<td data-time="${esc(time)}"><input aria-label="${labels[dow]} às ${esc(time)}" type="checkbox" data-avail="${key}" ${marked[key] ? 'checked' : ''}></td>` }).join('')}</tr>`).join('')}</tbody></table></div>`
  fieldHelp(host,'#aPerson','A disponibilidade vale para o local selecionado. Marcar ou desmarcar salva imediatamente.')
  if(host.id==='participantAvailability')host.querySelector<HTMLElement>('#aPerson')!.closest<HTMLElement>('.form-group')!.hidden=true
  document.getElementById('aLocal')!.addEventListener('change', event => { selectedLocalId=(event.target as HTMLSelectElement).value;localStorage.setItem(ESCALA_LOCAL_KEY,selectedLocalId);renderAvailability() })
  document.getElementById('aPerson')!.addEventListener('change', e => { selectedParticipantId = (e.target as HTMLSelectElement).value; renderAvailability() })
  document.querySelectorAll<HTMLInputElement>('[data-avail]').forEach(box => box.addEventListener('change', () => void saveAvailability([box.dataset['avail']!], box.checked)))
  document.querySelectorAll<HTMLButtonElement>('[data-aday]').forEach(button => button.addEventListener('click', () => void toggleGroup(slots.map(time => availabilityKey(Number(button.dataset['aday']), time)))))
  document.querySelectorAll<HTMLButtonElement>('[data-atime]').forEach(button => button.addEventListener('click', () => void toggleGroup(days.map(dow => availabilityKey(dow, button.dataset['atime']!)))))
}
async function toggleGroup(keys: string[]): Promise<void> {
  const current = availability[selectedLocalId]?.[selectedParticipantId] ?? {}
  await saveAvailability(keys, keys.some(key => !current[key]), true)
}
async function saveAvailability(keys: string[], on: boolean, rerender = false): Promise<void> {
  const participantId=selectedParticipantId,localId=selectedLocalId
  const release=editorBusy(document.getElementById('participantAvailability')?.closest<HTMLElement>('.modal')??root())
  const status=document.getElementById('availabilitySaveStatus')
  if(status)status.textContent='Salvando disponibilidade…'
  const stamp = now(), patch: Record<string, unknown> = { [`participants/${participantId}/availabilityUpdatedAt`]: stamp }
  keys.forEach(key => { patch[`availability/${localId}/${participantId}/${key}`] = on ? true : null })
  try {
    await update(escalaRef, patch); availability[localId] ??= {}; availability[localId][participantId] ??= {}
    keys.forEach(key => { if (on) availability[localId][participantId][key] = true; else delete availability[localId][participantId][key] })
    participants[participantId].availabilityUpdatedAt = stamp; if (rerender) renderAvailability()
    const feedback=document.getElementById('availabilitySaveStatus');if(feedback)feedback.textContent='Disponibilidade salva. Confirmar revisão apenas registra que você conferiu os horários.'
  } catch { renderAvailability(); const feedback=document.getElementById('availabilitySaveStatus');if(feedback){feedback.setAttribute('role','alert');feedback.textContent='Não foi possível salvar. A seleção anterior foi restaurada. Tente novamente.'} }
  finally {release()}
}
async function confirmAvailability(participantId = selectedParticipantId): Promise<void> {
  if (!participantId || !participants[participantId]) return
  try {
    const stamp = now()
    await update(child(escalaRef, `participants/${participantId}`), { availabilityUpdatedAt: stamp })
    participants[participantId].availabilityUpdatedAt = stamp
    toast('Disponibilidade revisada hoje')
    if (tab === 'mensagens') renderMessages()
  } catch { toast('Não foi possível confirmar') }
}

function hasData(month: string): boolean {
  return Object.values(tables).some(byMonth => Object.values(byMonth[month]?.rows ?? {}).some(row => Object.values(row.slots ?? {}).some(cell => cell.p1 || cell.p2)))
}
function renderScale(): void {
  queueMicrotask(()=>void renderPublicationStatus(root(),'escala',selectedMonth))
  const local = locals[selectedLocalId]
  if (!local) { root().innerHTML = '<p class="empty-state">Nenhum local cadastrado.</p>'; return }
  const table = tables[selectedLocalId]?.[selectedMonth], published = monthLocked()
  const dates = table ? Object.keys(table.rows ?? {}).sort() : activeDates(selectedMonth, local.daysActive ?? [], exclusions[selectedMonth] ?? [])
  const slots = table?.slots ?? localSlots(local)
  const weeks=new Map<string,string[]>()
  for(const date of dates){const dow=new Date(date+'T12:00:00Z').getUTCDay();const start=addCivilDays(date,-((dow+6)%7));weeks.set(start,[...(weeks.get(start)??[]),date])}
  const current=fortalezaToday(),initialWeek=[...weeks.keys()].find(start=>addCivilDays(start,6)>=current)??[...weeks.keys()][0]
  const dayHtml=(date:string)=>'<section class="scale-day" data-scale-date="'+date+'"><h3>'+esc(dayLabel(date))+'</h3>'+slots.map(time=>slotHtml(date,time,table)).join('')+'</section>'
  const weeksHtml=[...weeks].map(([start,days])=>'<details class="scale-week" '+(start===initialWeek?'open':'')+'><summary>'+esc(dayLabel(days[0]))+' — '+esc(dayLabel(days[days.length-1]))+' · '+days.length+' dia(s)</summary>'+days.map(dayHtml).join('')+'</details>').join('')
  const activeRules = Object.values(normalizeEscalaGenerationRules(settings.engineRules)).filter(Boolean).length
  root().innerHTML = `${periodControls()}<span class="admin-badge">${published ? 'Publicado' : 'Rascunho'}</span>${published ? '<div class="notice warning">Este mês está publicado e bloqueado para edição.</div>' : ''}<div class="scale-actions"><button id="sGenerateAll" class="btn ${hasData(selectedMonth) ? 'btn-ghost' : 'btn-primary'}" ${published ? 'disabled' : ''}>${hasData(selectedMonth) ? 'Completar mês' : 'Gerar mês'} · ${activeRules} regras</button><button id="sPdf" class="btn btn-ghost" ${hasData(selectedMonth) ? '' : 'disabled'}>Baixar PDF</button>${!published ? `<button id="sPublish" class="btn btn-primary" ${hasData(selectedMonth) ? '' : 'disabled'}>Publicar no Quadro</button>` : ''}${published ? '<button id="sUnpublish" class="btn btn-ghost">Reabrir para edição</button>' : `${hasData(selectedMonth) ? '<details><summary>Mais opções</summary><button id="sDelete" class="btn btn-danger">Apagar mês</button></details>' : ''}`}</div><button type="button" id="scaleToday" class="btn btn-ghost">Ir para hoje ou próximo dia</button><div class="scale-days">${weeksHtml || '<p class="empty-state">Este local não tem dias ativos neste mês.</p>'}</div>`
  bindPeriod(renderScale)
  document.getElementById('scaleToday')?.addEventListener('click',()=>{const target=[...root().querySelectorAll<HTMLElement>('[data-scale-date]')].find(day=>day.dataset.scaleDate!>=fortalezaToday());if(target)focusCorrection(target);else toast('Não há dias futuros neste período.')})
  document.getElementById('sGenerateAll')!.addEventListener('click', () => void generate())
  document.getElementById('sPdf')!.addEventListener('click', () => void printPdf())
  document.getElementById('sPublish')?.addEventListener('click', () => void publish())
  document.getElementById('sUnpublish')?.addEventListener('click', () => void unpublish())
  document.getElementById('sDelete')?.addEventListener('click', () => void deleteMonth())
  document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(button => button.addEventListener('click', () => pairModal(button.dataset['date']!, button.dataset['time']!)))
}
function slotHtml(date: string, time: string, table?: EscalaTable): string {
  const cell = table?.rows?.[date]?.slots?.[time]
  const names = [cell?.p1, cell?.p2].filter((id): id is string => Boolean(id)).map(name)
  let status = isBlocked(blocks, selectedMonth, selectedLocalId, new Date(`${date}T12:00:00`).getDay(), time) ? 'Sem carrinho' : 'Vago'
  if (!names.length && status === 'Vago') {
    const eligible = analyzeCell(input(), date, time).eligible
    status = eligible.length === 0 ? 'Ninguém disponível' : eligible.length === 1 ? `Só ${name(eligible[0])} disponível` : `${eligible.length} disponíveis, sem dupla válida`
  }
  return `<button class="scale-slot" data-slot data-date="${date}" data-time="${time}" ${monthLocked() ? 'disabled' : ''}><strong>${time}</strong><span>${esc(names.length ? names.join(' + ') : status)}</span></button>`
}
async function generate(): Promise<void> {
  if (monthLocked() || changingPublication) { toast('Despublique o mês antes de gerar'); return }
  const generated = generateAll({ month:selectedMonth, locals, participants, availability, tables, blocks, exclusions:exclusions[selectedMonth] ?? [], rules:settings.engineRules })
  if (generated.errors.length) { toast(generated.errors.join('. ')); return }
  try {
    const [editing,last]=await Promise.all([get(child(escalaRef,'editingMonth')),get(child(escalaRef,'lastGeneratedAt'))])
    const expected={tables, publishedMonth:publishedMonthBaseline, publishedMonths,editingMonth:editing.val(),lastGeneratedAt:last.val()}
    await compareAndUpdate(escalaRef, expected, {tables:generated.tables,publishedMonth:publishedMonthBaseline,publishedMonths,editingMonth:selectedMonth,lastGeneratedAt:now()})
    tables = generated.tables
    const total = Object.values(generated.results).reduce((sum, result) => ({ filled: sum.filled + result.summary.filled, kept: sum.kept + result.summary.preserved, empty: sum.empty + result.summary.empty }), { filled: 0, kept: 0, empty: 0 })
    toast(`${total.filled} preenchidos, ${total.kept} mantidos${total.empty ? ` e ${total.empty} sem dupla` : ''}`); renderScale()
  } catch (error) { toast(error instanceof Error?error.message:'Não foi possível salvar a geração') }
}
function pairModal(date: string, time: string): void {
  if (monthLocked() || changingPublication) return
  const analysis = analyzeCell(input(), date, time), cell = tables[selectedLocalId]?.[selectedMonth]?.rows?.[date]?.slots?.[time] ?? { p1: '', p2: '' }
  const ids = [...analysis.eligible, ...analysis.blocked.map(item => item.id)]
  const options = ids.map(id => { const item = analysis.blocked.find(candidate => candidate.id === id); return `<option value="${esc(id)}">${esc(name(id))}${item ? ` — ${esc(ESCALA_RULE_LABELS[item.rule])}` : ''}</option>` }).join('')
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay'; overlay.innerHTML = `<div class="modal"><h2>${esc(dayLabel(date))} · ${time}</h2><p class="form-help">Disponíveis primeiro; conflitos continuam selecionáveis com confirmação.</p><div class="form-group"><label class="form-label">Primeira pessoa</label><select id="pair1" class="form-select"><option value="">Vago</option>${options}</select></div><div class="form-group"><label class="form-label">Segunda pessoa</label><select id="pair2" class="form-select"><option value="">Vago</option>${options}</select></div><div style="display:flex;gap:8px;justify-content:flex-end"><button id="pairCancel" class="btn btn-ghost">Cancelar</button><button id="pairSave" class="btn btn-primary">Salvar</button></div></div>`
  document.body.appendChild(overlay); (document.getElementById('pair1') as HTMLSelectElement).value = cell.p1; (document.getElementById('pair2') as HTMLSelectElement).value = cell.p2
  for(const slot of ['p1','p2'] as const) {
    const select=overlay.querySelector<HTMLSelectElement>(slot==='p1'?'#pair1':'#pair2')!
    const button=document.createElement('button');button.type='button';button.className='btn btn-ghost';button.textContent='Buscar substituto';button.dataset.pairSubstitute=slot;select.after(button)
    button.addEventListener('click',()=>{
      const other=overlay.querySelector<HTMLSelectElement>(slot==='p1'?'#pair2':'#pair1')!.value
      substitutionDialog({title:`Substituição · ${dayLabel(date)} · ${time}`,current:select.value?name(select.value):'Vago',note:'A escolha será aplicada ao editor da dupla. Confira as duas pessoas e toque em Salvar para gravar.',candidates:Object.keys(participants).filter(id=>id!==select.value).map(id=>({id,name:name(id),count:Object.values(tables).reduce((sum,months)=>sum+Object.values(months[selectedMonth]?.rows??{}).reduce((n,row)=>n+Object.values(row.slots??{}).filter(c=>c.p1===id||c.p2===id).length,0),0),reason:validatePair(input(),date,time,slot==='p1'?id:other,slot==='p2'?id:other).join(' · ')})),save:async id=>{select.value=id;select.dispatchEvent(new Event('change',{bubbles:true}));return true}})
    })
  }
  const preview=document.createElement('p');preview.className='notice';preview.setAttribute('aria-live','polite');overlay.querySelector('.modal')!.append(preview)
  const refresh=()=>{
    const p1=overlay.querySelector<HTMLSelectElement>('#pair1')!.value,p2=overlay.querySelector<HTMLSelectElement>('#pair2')!.value
    const issues=validatePair(input(),date,time,p1,p2)
    preview.textContent=`Dupla: ${p1?name(p1):'Vago'} e ${p2?name(p2):'Vago'}. ${issues.length?issues.join(' · '):'Sem conflito identificado.'}`
  }
  overlay.querySelectorAll('select').forEach(select=>select.addEventListener('change',refresh));refresh()
  document.getElementById('pairCancel')!.addEventListener('click', () => overlay.remove()); document.getElementById('pairSave')!.addEventListener('click', () => void savePair(date, time, overlay))
}
async function savePair(date: string, time: string, overlay: HTMLElement): Promise<void> {
  if (monthLocked() || changingPublication) { toast('Reabra o mês para edição antes de alterar'); return }
  const p1 = (document.getElementById('pair1') as HTMLSelectElement).value, p2 = (document.getElementById('pair2') as HTMLSelectElement).value
  const errors = validatePair(input(), date, time, p1, p2)
  if (errors.length && !confirm(`Esta escolha tem conflito:\n\n${errors.join('\n')}\n\nSalvar assim mesmo?`)) return
  const dow = new Date(`${date}T12:00:00`).getDay()
  const release=editorBusy(overlay)
  try {
    const nextTables=structuredClone(tables)
    nextTables[selectedLocalId]??={}
    nextTables[selectedLocalId][selectedMonth]??={slots:localSlots(locals[selectedLocalId]),rows:{}}
    nextTables[selectedLocalId][selectedMonth].rows[date]??={dow,slots:{}}
    nextTables[selectedLocalId][selectedMonth].rows[date].slots[time]={p1,p2}
    const auditPath=`manualEdits/${selectedLocalId}/${selectedMonth}/${date}/${time.replace(':','-')}`
    const audit=await get(child(escalaRef,auditPath))
    await compareAndUpdate(escalaRef,{tables,publishedMonth:publishedMonthBaseline,publishedMonths,[auditPath]:audit.val()},{tables:nextTables,publishedMonth:publishedMonthBaseline,publishedMonths,[auditPath]:{p1,p2,editedAt:now(),editedBy:context.uid,conflicts:errors}})
    tables[selectedLocalId] ??= {}; tables[selectedLocalId][selectedMonth] ??= { slots: localSlots(locals[selectedLocalId]), rows: {} }; tables[selectedLocalId][selectedMonth].rows[date] ??= { dow, slots: {} }; tables[selectedLocalId][selectedMonth].rows[date].slots[time] = { p1, p2 }
    overlay.remove(); toast('Dupla atualizada'); renderScale()
  } catch (error) { editorError(overlay);toast(error instanceof Error?error.message:'Não foi possível salvar a dupla') } finally { release() }
}
async function publish(): Promise<void> {
  if (monthLocked() || changingPublication) return
  if (!hasData(selectedMonth)) { toast('Gere e revise a escala antes de publicar'); return }

  const month=selectedMonth
  changingPublication=true
  const releaseUi=lockPublicationUi()
  try {
    await publishModulePeriod('escala',month,publicationPeriod({escala:{tables}},'escala',month),Number(settings.printFontPt??12))
    await load();toast('Mês publicado e bloqueado');renderScale()
  } catch(error) {toast(error instanceof Error?error.message:'Não foi possível publicar')}
  finally {changingPublication=false;releaseUi()}
}
async function unpublish():Promise<void> {
  if(!monthLocked()||changingPublication||!confirm('Reabrir para edição? O PDF será retirado do Quadro.'))return
  const month=selectedMonth
  changingPublication=true
  const releaseUi=lockPublicationUi()
  try {
    await publishModulePeriod('escala',month,publicationPeriod({escala:{tables}},'escala',month),12,true)
    await load();toast('Mês aberto para edição');renderScale()
  } catch(error) {toast(error instanceof Error?error.message:'Não foi possível reabrir')}
  finally {changingPublication=false;releaseUi()}
}

async function deleteMonth(): Promise<void> {
  if (monthLocked() || changingPublication) { toast('Despublique o mês antes de apagar'); return }
  if (!hasData(selectedMonth) || !confirm(`Apagar a escala inteira de ${monthLabel(selectedMonth)} em todos os locais?`)) return
  const patch: Record<string, unknown> = {}
  Object.keys(locals).forEach(id => {
    patch[`tables/${id}/${selectedMonth}`] = null
    patch[`manualEdits/${id}/${selectedMonth}`] = null
  })
  try {
    await update(escalaRef, patch)
    Object.keys(tables).forEach(id => { delete tables[id]?.[selectedMonth] })
    toast('Escala do mês apagada em todos os locais')
    renderScale()
  } catch { toast('Não foi possível apagar a escala do mês') }
}

function renderMessages(): void {
  const confirmationPeople = orderedPeople(true).map(([id, person]) => ({ id, person, updated: person.availabilityUpdatedAt ? new Date(person.availabilityUpdatedAt).getTime() : 0 }))
    .sort((a, b) => a.updated - b.updated || name(a.id).localeCompare(name(b.id), 'pt-BR'))
  root().innerHTML = `<div class="notice">Avisos de designação ficam no Quadro de Anúncios. Aqui permanece somente a confirmação administrativa de disponibilidade.</div><div class="form-group"><label class="form-label">Pessoa</label><select id="mTarget" class="form-select">${confirmationPeople.map(({ id, person }) => `<option value="${esc(id)}">${esc(name(id))} · ${person.availabilityUpdatedAt ? `revisada em ${esc(String(person.availabilityUpdatedAt).slice(0, 10))}` : 'nunca revisada'}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Texto</label><textarea id="mText" class="form-input" rows="10"></textarea></div><div class="scale-actions"><button id="mConfirmDone" class="btn btn-ghost" type="button">Registrar confirmação da disponibilidade</button><button id="mCopy" class="btn btn-ghost">Copiar</button><button id="mWhats" class="btn btn-primary">Abrir WhatsApp</button></div>`
  const target = document.getElementById('mTarget') as HTMLSelectElement
  if(confirmationPeople.some(({id})=>id===selectedParticipantId))target.value=selectedParticipantId
  const enabled = confirmationPeople.length > 0
  ;(document.getElementById('mCopy') as HTMLButtonElement).disabled = !enabled
  ;(document.getElementById('mWhats') as HTMLButtonElement).disabled = !enabled
  ;(document.getElementById('mConfirmDone') as HTMLButtonElement).disabled = !enabled
  target.addEventListener('change',()=>{selectedParticipantId=target.value;fillMessage()}); fillMessage()
  document.getElementById('mConfirmDone')!.addEventListener('click', () => void confirmAvailability(target.value))
  document.getElementById('mCopy')!.addEventListener('click', () => void copyMessage())
  document.getElementById('mWhats')!.addEventListener('click', () => void openWhatsApp())
}
function fillMessage(): void {
  const target = (document.getElementById('mTarget') as HTMLSelectElement)?.value ?? ''
  const text = target ? confirmationMessage(greetings.confirm ?? '', target, participants[target], locals, availability) : ''
  ;(document.getElementById('mText') as HTMLTextAreaElement).value = text
}
async function copyMessage(): Promise<void> {
  try { await navigator.clipboard.writeText((document.getElementById('mText') as HTMLTextAreaElement).value); toast('Mensagem copiada') } catch { toast('Não foi possível copiar automaticamente') }
}
function digits(value: unknown): string { const result = String(value ?? '').replace(/\D/g, ''); return result.length === 11 ? `55${result}` : result }
async function openWhatsApp(): Promise<void> {
  const target = (document.getElementById('mTarget') as HTMLSelectElement)?.value ?? ''
  const phone = digits(phoneOf(target))
  if (!phone) { toast('Este destino não tem WhatsApp cadastrado'); return }
  const popup = window.open(`https://wa.me/${phone}?text=${encodeURIComponent((document.getElementById('mText') as HTMLTextAreaElement).value)}`, '_blank', 'noopener')
  if (popup) toast('WhatsApp aberto para revisão')
}

function renderPending(): void {
  const pending: { level: string; title: string; detail: string; target: Tab; personId?: string; localId?: string; month?:string; date?:string; time?:string; field?:string }[] = [], active = orderedPeople(true)
  const preparationMonth = nextCivilMonth(fortalezaToday())
  const stuck = active.filter(([, p]) => p.onlyWithId && (!participants[p.onlyWithId] || participants[p.onlyWithId]?.active === false))
  stuck.forEach(([id])=>pending.push({level:'high',title:name(id)+' vinculado a uma pessoa inativa',detail:'Revise a restrição Só participa com.',target:'participantes',personId:id,field:'pmOnly'}))
  const noPhone = active.filter(([id]) => !digits(phoneOf(id)))
  noPhone.forEach(([id])=>pending.push({level:'medium',title:name(id)+' sem WhatsApp',detail:isAdmin()?'Abra o telefone no cadastro Admin.':'Solicite ao Admin o telefone desta pessoa.',target:'participantes',personId:id,field:'masterPhone'}))
  const noAvailability = active.filter(([id]) => !Object.values(availability).some(byPerson => Object.values(byPerson[id] ?? {}).some(Boolean)))
  noAvailability.forEach(([id])=>pending.push({level:'high',title:name(id)+' sem disponibilidade',detail:'Marque os dias e horários em que pode participar.',target:'disponibilidade',personId:id,field:'aPerson'}))
  const stale = active.filter(([id, p]) => Object.values(availability).some(byPerson => Object.values(byPerson[id] ?? {}).some(Boolean)) && (!p.availabilityUpdatedAt || Date.now() - new Date(p.availabilityUpdatedAt).getTime() > 30 * 86_400_000))
  stale.forEach(([id])=>pending.push({level:'low',title:name(id)+' precisa revisar disponibilidade',detail:'Última revisão há mais de 30 dias ou ainda não registrada.',target:'mensagens',personId:id,field:'mText'}))
  for (const [localId, local] of orderedLocals()) {
    const dates = activeDates(preparationMonth, local.daysActive ?? [], exclusions[preparationMonth] ?? [])
    if (dates.length && dates.some(date => !tables[localId]?.[preparationMonth]?.rows?.[date])) pending.push({ level:'medium', title:`Gerar ${local.name ?? localId} antes de 01/${preparationMonth.slice(5, 7)}`, detail:`Prepare ${monthLabel(preparationMonth)}; horários sem dupla podem permanecer vagos.`, target:'escalaAtual', localId, month:preparationMonth })
  }
  for (const [localId, local] of orderedLocals()) {
    const table = tables[localId]?.[selectedMonth]
    Object.entries(table?.rows??{}).forEach(([date,row])=>Object.entries(row.slots??{}).forEach(([time,cell])=>{
      if(Boolean(cell.p1)!==Boolean(cell.p2))pending.push({level:'high',title:(local.name??localId)+' · '+dayLabel(date)+' · '+time,detail:'Dupla incompleta. Abra este horário para corrigir.',target:'escalaAtual',localId,date,time})
    }))
  }
  const counts = { high:pending.filter(item => item.level === 'high').length, medium:pending.filter(item => item.level === 'medium').length, low:pending.filter(item => item.level === 'low').length }
  const labels: Record<string, string> = { high:'Revisar escala', medium:'Atenção', low:'Aviso' }
  const colors: Record<string, string> = { high:'#B3261E', medium:'#8A5B00', low:'#006EB6' }
  root().innerHTML = `${periodControls(false)}${pending.length ? `<div class="pending-summary"><span style="background:${colors.high}">Urgentes: ${counts.high}</span><span style="background:${colors.medium}">Atenção: ${counts.medium}</span><span style="background:${colors.low}">Quando puder: ${counts.low}</span></div>` : ''}<div class="module-option-list">${pending.map(item => `<button class="module-menu-btn" data-pending="${item.target}" style="border-left:4px solid ${colors[item.level]}"><div class="mod-icon" style="background:${colors[item.level]}20;color:${colors[item.level]}">!</div><div><div class="mod-label">${esc(item.title)} · ${labels[item.level]}</div><div class="mod-desc">${esc(item.detail)}</div></div></button>`).join('') || '<p class="empty-state">Nenhuma pendência identificada.</p>'}</div>`
  bindPeriod(renderPending); document.querySelectorAll<HTMLButtonElement>('[data-pending]').forEach((button, index) => button.addEventListener('click', () => {
    const item = pending[index]; if (!item) return
    if(item.field==='masterPhone'&&isAdmin()){requestMasterCorrection(centralId(item.personId!));void navigateTo('mestre');return}
    pendingParticipantId = item.target==='participantes'?(item.personId??''):''
    if (item.personId) selectedParticipantId = item.personId
    if (item.localId) selectedLocalId = item.localId
    if (item.month) selectedMonth = item.month
    void go(item.target).then(()=>{
      if(tab!==item.target)return
      if(item.date&&item.time){if(monthLocked())focusCorrection(document.getElementById('sUnpublish'));else{pairModal(item.date,item.time);focusCorrection(document.getElementById(tables[selectedLocalId]?.[selectedMonth]?.rows?.[item.date]?.slots?.[item.time]?.p1?'pair2':'pair1'))}}
      else if(item.target==='mensagens'&&item.personId){const select=document.getElementById('mTarget') as HTMLSelectElement;select.value=item.personId;fillMessage();focusCorrection(document.getElementById('mText'))}
      else focusCorrection(document.getElementById(item.field==='masterPhone'?'pSearch':item.field||'sGenerateAll'))
      pendingParticipantId=''
    })
  }))
}

function renderConfig(): void {
  const font = Math.min(18, Math.max(8, Number(settings.printFontPt ?? 12)))
  const hasLocals = orderedLocals().length > 0
  const scope = '__persist__'
  root().innerHTML = `${periodControls()}<div data-editor-scope id="scalePrintSettings"><div class="form-group"><label class="form-label">Tamanho máximo no PDF: <strong id="cFontValue">${font}pt</strong></label><input id="cFont" type="range" min="8" max="18" value="${font}" style="width:100%"><p class="form-help">O app reduz a partir deste teto até encontrar a maior letra que caiba sem quebrar nomes.</p></div><div class="form-group"><label class="form-label">Confirmação de disponibilidade</label><textarea id="cConfirm" class="form-input">${esc(greetings.confirm ?? '')}</textarea></div><button id="cSave" class="btn btn-primary">Salvar confirmação e impressão</button></div><hr style="border:0;border-top:1px solid var(--border);margin:18px 0"><h3 style="font-size:.9rem;margin-bottom:8px">Exceções de ${esc(monthLabel(selectedMonth))}</h3><div style="display:flex;gap:8px;margin-bottom:8px"><input id="cExclusion" class="form-input" type="date" min="${selectedMonth}-01" max="${selectedMonth}-31"><button id="cAddExclusion" class="btn btn-ghost">Adicionar</button></div><div class="module-option-list">${(exclusions[selectedMonth] ?? []).map(date => `<div class="module-menu-btn" style="cursor:default"><div><div class="mod-label">${esc(dayLabel(date))}</div><div class="mod-desc">Sem carrinho em todos os locais</div></div><button class="btn btn-danger" data-remove-exclusion="${date}">Remover</button></div>`).join('') || '<p class="empty-state">Nenhuma data excluída neste mês.</p>'}</div>${hasLocals ? `<hr style="border:0;border-top:1px solid var(--border);margin:18px 0"><div class="module-form-grid" style="margin-bottom:8px"><div class="form-group"><label class="form-label">Bloqueios</label><select id="cBlockScope" class="form-select"><option value="__persist__">Todos os meses</option><option value="${selectedMonth}">Somente este mês</option></select></div><div class="form-group"><label class="form-label">Vale para</label><select id="cBlockTarget" class="form-select"><option value="__all__">Todos os locais</option>${orderedLocals().map(([id, local]) => `<option value="${esc(id)}" ${id === selectedLocalId ? 'selected' : ''}>${esc(local.name ?? id)}</option>`).join('')}</select></div></div><div id="cBlocks">${blockGrid(selectedLocalId, scope)}</div>` : ''}`
  const rules = normalizeEscalaGenerationRules(settings.engineRules), canEditRules = canConfigureRules()
  root().querySelector('hr')?.insertAdjacentHTML('beforebegin', `<div class="form-panel" data-editor-scope style="margin-top:16px"><h3 style="margin-top:0">Regras do motor</h3><p class="form-help">As mudanças valem para a próxima geração. Disponibilidade, vínculos e regras de dupla continuam obrigatórios.</p><div class="engine-rule-list"><label><input id="scaleRulePioneer" type="checkbox" ${rules.prioridadePioneiroRegular ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Dar prioridade ao pioneiro regular na formação da dupla</label><label><input id="scaleRuleBalance" type="checkbox" ${rules.equilibrarDesignacoes ? 'checked' : ''} ${canEditRules ? '' : 'disabled'}> Equilibrar o total de designações</label></div>${canEditRules ? '<div class="scale-actions" style="margin-top:12px"><button id="saveScaleRules" class="btn btn-primary">Salvar regras</button><button id="restoreScaleRules" class="btn btn-ghost">Restaurar padrões</button></div>' : '<div class="notice">Somente o Admin pode alterar estas regras.</div>'}</div>`)
  document.getElementById('scaleRulePioneer')?.closest('.form-panel')?.insertAdjacentHTML('beforeend', '<details class="workspace-disclosure"><summary>Regras fixas sem liga/desliga</summary><p class="form-help">O motor sempre respeita pessoa ativa, início e limite mensal, folga e disponibilidade configurados, evita a mesma pessoa em dois locais ou horários próximos e preserva as restrições individuais de dupla. Essas proteções não são preferências de distribuição.</p></details>')
  bindPeriod(renderConfig)
  document.getElementById('cFont')!.addEventListener('input', e => { document.getElementById('cFontValue')!.textContent = `${(e.target as HTMLInputElement).value}pt` })
  document.getElementById('cSave')!.addEventListener('click', () => void saveConfig())
  document.getElementById('saveScaleRules')?.addEventListener('click', () => void saveScaleRules())
  document.getElementById('restoreScaleRules')?.addEventListener('click', () => void saveScaleRules(DEFAULT_ESCALA_GENERATION_RULES))
  document.getElementById('cAddExclusion')!.addEventListener('click', () => void addExclusion())
  document.querySelectorAll<HTMLButtonElement>('[data-remove-exclusion]').forEach(button => button.addEventListener('click', () => void removeExclusion(button.dataset['removeExclusion']!)))
  const refreshBlocks = () => {
    const target = (document.getElementById('cBlockTarget') as HTMLSelectElement).value
    const selectedScope = (document.getElementById('cBlockScope') as HTMLSelectElement).value
    document.getElementById('cBlocks')!.innerHTML = blockGrid(target, selectedScope)
    bindBlockInputs()
  }
  document.getElementById('cBlockScope')?.addEventListener('change', refreshBlocks)
  document.getElementById('cBlockTarget')?.addEventListener('change', refreshBlocks)
  bindBlockInputs()
}
async function saveScaleRules(value?: EscalaGenerationRules): Promise<void> {
  if (!canConfigureRules()) { toast('Sem permissão para configurar a Escala TPL'); return }
  const next = value ?? { prioridadePioneiroRegular:(document.getElementById('scaleRulePioneer') as HTMLInputElement).checked, equilibrarDesignacoes:(document.getElementById('scaleRuleBalance') as HTMLInputElement).checked }
  const scope=document.getElementById('saveScaleRules')!.closest<HTMLElement>('[data-editor-scope]')!,release=editorBusy(scope)
  try { await update(escalaRef, { 'settings/engineRules':{ ...next, version:1 } }); settings.engineRules = next; toast(value ? 'Padrões restaurados' : 'Regras salvas'); renderConfig() }
  catch { editorError(scope);toast('Não foi possível salvar as regras') } finally {release()}
}
function blockGrid(target: string, scope: string): string {
  const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const targets = target === '__all__' ? orderedLocals().map(([, local]) => local) : [locals[target]].filter(Boolean) as EscalaLocal[]
  const days = [...new Set(targets.flatMap(local => local.daysActive ?? []))].sort((a, b) => a - b)
  const slots = [...new Set(targets.flatMap(local => localSlots(local)))].sort()
  const selected = blocks[scope]?.[target] ?? []
  return `<p class="form-help" style="margin-bottom:8px">Marque horários em que não deve haver carrinho.</p><div class="availability-wrap"><table class="availability-table"><thead><tr><th>Dia</th>${slots.map(time => `<th>${time}</th>`).join('')}</tr></thead><tbody>${days.map(dow => `<tr><th>${labels[dow]}</th>${slots.map(time => { const key = availabilityKey(dow, time); return `<td><input type="checkbox" data-block="${key}" data-block-target="${target}" data-scope="${scope}" ${selected.includes(key) ? 'checked' : ''}></td>` }).join('')}</tr>`).join('')}</tbody></table></div>`
}
function bindBlockInputs(): void {
  document.querySelectorAll<HTMLInputElement>('[data-block]').forEach(box => box.addEventListener('change', () => void toggleBlock(box.dataset['scope']!, box.dataset['blockTarget']!, box.dataset['block']!, box.checked)))
}
async function toggleBlock(scope: string, target: string, key: string, enabled: boolean): Promise<void> {
  const current = blocks[scope]?.[target] ?? []
  const next = enabled ? [...new Set([...current, key])] : current.filter(item => item !== key)
  try { await update(escalaRef, { [`monthSlotBlocks/${scope}/${target}`]: next.length ? next : null }); blocks[scope] ??= {}; blocks[scope][target] = next; toast('Bloqueio atualizado') } catch { toast('Não foi possível atualizar o bloqueio'); renderConfig() }
}
async function addExclusion(): Promise<void> {
  if (monthLocked()) { toast('Despublique o mês antes de alterar as exceções'); return }
  const date = (document.getElementById('cExclusion') as HTMLInputElement).value
  if (!date.startsWith(`${selectedMonth}-`)) { toast('Escolha uma data deste período'); return }
  const next = [...new Set([...(exclusions[selectedMonth] ?? []), date])].sort()
  try { await update(escalaRef, { [`monthExclusions/${selectedMonth}`]: next }); exclusions[selectedMonth] = next; toast('Exceção adicionada'); renderConfig() } catch { toast('Não foi possível adicionar') }
}
async function removeExclusion(date: string): Promise<void> {
  if (monthLocked()) { toast('Despublique o mês antes de alterar as exceções'); return }
  const next = (exclusions[selectedMonth] ?? []).filter(item => item !== date)
  try { await update(escalaRef, { [`monthExclusions/${selectedMonth}`]: next.length ? next : null }); exclusions[selectedMonth] = next; toast('Exceção removida'); renderConfig() } catch { toast('Não foi possível remover') }
}
async function saveConfig(): Promise<void> {
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement).value.trim()
  const nextSettings = { ...settings, printFontPt: Number(value('cFont')) }, nextGreetings = { ...greetings, confirm: value('cConfirm') }
  const scope=document.getElementById('scalePrintSettings')!,release=editorBusy(scope)
  try { await update(escalaRef, { settings: nextSettings, greetings: nextGreetings }); settings = nextSettings; greetings = nextGreetings; editorSaved(scope);toast('Configurações salvas') } catch { editorError(scope);toast('Não foi possível salvar') } finally {release()}
}

async function printPdf(): Promise<void> {
  if (changingPublication || downloadingPdf || !hasData(selectedMonth)) return
  const input = structuredClone(scalePdfInput())
  downloadingPdf = true
  const button = document.getElementById('sPdf') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.textContent = 'Preparando PDF...' }
  try {
    const { downloadScaleSchedulePdf } = await import('./escala-documents')
    await downloadScaleSchedulePdf(input)
    toast('Download do PDF iniciado')
  } catch { toast('Não foi possível gerar o PDF') }
  finally { downloadingPdf = false; if (button) { button.disabled = false; button.textContent = 'Baixar PDF' } }
}
