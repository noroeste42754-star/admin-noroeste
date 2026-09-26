import { renderPublicationStatus } from './module-publication'
import { closeRecordEditor, mountRecordEditor } from '../ui/record-editor'
import { fieldSubstitutes } from './substitution-domain'
import { focusCorrection, fieldHelp } from '../ui/field-guidance'
import { fortalezaCurrentMonth, fortalezaToday, isValidCivilDate, nextCivilMonth } from './civil-date'
import { editorBusy, editorError } from '../ui/editor-feedback'
import { lockPublicationUi } from '../ui/publication-busy'
import type { AppContext, ConfigCongregacao, MasterPessoa, RawPessoas } from '../types'
import { child, compareAndSet, configCongregacaoRef, get, pessoasRef, servicoCampoRef, update } from '../firebase'
import { moduleBackButton, moduleTitle } from '../ui/module-header'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import { fieldServiceConflicts, generateFieldServicePeriod, validFieldServiceMonth, validFieldServiceTime, type FieldServiceAssignment, type FieldServicePeriod, type FieldServiceTemplate } from './servico-campo-domain'

interface ServiceRoot {
  templates?: Record<string, FieldServiceTemplate>
  leaders?: Record<string, boolean>
  periods?: Record<string, FieldServicePeriod>
}

type Screen = 'programacao' | 'configuracao'
const DAYS = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']
const MONTH_KEY = 'noroeste_servico_campo_month'
let screen: Screen = 'programacao'
let data: ServiceRoot = {}
let people: RawPessoas = {}
let congregation: ConfigCongregacao = { nome:'Noroeste', cidade:'', circuito:'', idioma:'pt-BR' }
let selectedMonth = localStorage.getItem(MONTH_KEY) ?? fortalezaCurrentMonth()
let editingTemplateId = ''
let creatingTemplate = false
let manualEditorOpen = false
let changingPublication = false
let downloadingPdf = false
let generatingPeriod = false
let loadPromise: Promise<boolean> | null = null

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function fieldServicePdfInput(assignments = Object.values(currentPeriod()?.assignments ?? {})): Parameters<typeof import('./servico-campo-documents').createFieldServicePdf>[0] {
  return { month:selectedMonth, assignments, people, congregation:congregation.nome }
}

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] ?? char))
const id = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const templates = (): Record<string, FieldServiceTemplate> => data.templates ?? {}
const periods = (): Record<string, FieldServicePeriod> => data.periods ?? {}
const currentPeriod = (): FieldServicePeriod | undefined => periods()[selectedMonth]
const leaderIds = (): string[] => Object.keys(data.leaders ?? {}).filter(masterId => data.leaders?.[masterId] && people[masterId]?.active !== false && people[masterId]?.sex === 'M').sort((a, b) => people[a]!.name.localeCompare(people[b]!.name, 'pt-BR'))
const personName = (masterId: string): string => people[masterId]?.name ?? 'Cadastro não encontrado'
const ROLE_LABELS: Record<string, string> = { anciao:'Ancião', 'servo-ministerial':'Servo ministerial', pioneiro:'Pioneiro', batizado:'Batizado', publicador:'Publicador' }
const roleLabel = (person: MasterPessoa): string => ROLE_LABELS[person.role ?? ''] ?? 'Sem função'
const dateLabel = (date: string): string => new Intl.DateTimeFormat('pt-BR', { weekday:'long', day:'2-digit', month:'2-digit', timeZone:'UTC' }).format(new Date(`${date}T12:00:00Z`))


function toast(message: string): void { const element = document.getElementById('toast'); if (!element) return; element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2800) }
function root(): HTMLElement { return document.getElementById('servicoCampoRoot')! }
function sectionTitle(title: string): string { return `<div class="module-section-title">${screen === 'configuracao' ? moduleBackButton() : ''}<h2>${esc(title)}</h2></div>` }

export default function mount(appContext: AppContext): void {
  if(appContext.overview)selectedMonth=appContext.overview.month
  screen = 'programacao'; editingTemplateId = ''; creatingTemplate = false; manualEditorOpen = false; loadPromise = null; data = {}; people = {}
  const host = document.getElementById('appContent'); if (!host) return
  host.innerHTML = '<div id="serviceNav"></div><div id="servicoCampoRoot"></div>'
  void openScreen('programacao')
}

function ensureLoaded(): Promise<boolean> {
  loadPromise ??= load()
  return loadPromise
}

async function load(): Promise<boolean> {
  try {
    const [serviceSnapshot, peopleSnapshot, congregationSnapshot] = await Promise.all([get(servicoCampoRef), get(pessoasRef), get(configCongregacaoRef)])
    data = serviceSnapshot.exists() ? serviceSnapshot.val() as ServiceRoot : {}
    people = peopleSnapshot.exists() ? peopleSnapshot.val() as RawPessoas : {}
    if (congregationSnapshot.exists()) congregation = { ...congregation, ...congregationSnapshot.val() as ConfigCongregacao }
  } catch { toast('Não foi possível carregar Serviço de Campo'); return false }
  return true
}

async function openScreen(next: Screen): Promise<void> {
  const host = root()
  manualEditorOpen = false; creatingTemplate = false; editingTemplateId = ''
  screen = next
  renderNavigation()
  host.innerHTML = `${moduleTitle('Serviço de Campo')}<p class="empty-state">Carregando dados...</p>`
  const loaded = await ensureLoaded()
  if (!host.isConnected || screen !== next) return
  if (!loaded) {
    loadPromise = null
    host.innerHTML = `${moduleTitle('Serviço de Campo')}<p class="empty-state">Não foi possível carregar os dados.</p><button id="retryService" class="btn btn-primary">Tentar novamente</button>`
    document.getElementById('retryService')?.addEventListener('click', () => void openScreen(next))
    return
  }
  screen = next; render()
}

function render(): void {
  if(screen==='programacao')queueMicrotask(()=>void renderPublicationStatus(root(),'servicoCampo',selectedMonth))
  renderNavigation()
  if (screen === 'configuracao') renderConfiguration()
  else renderSchedule()
}
function renderNavigation(): void {
  const host = document.getElementById('serviceNav')
  if (host) renderWorkspaceNav(host, 'Serviço de Campo', 'programacao', screen, [
    { id:'programacao', label:'Programação' }, { id:'configuracao', label:'Configurações' },
  ], id => { void openScreen(id as Screen) })
}

function periodControl(): string {
  return `<div class="agenda-toolbar service-period"><button class="btn btn-ghost" id="servicePrev" type="button" aria-label="Mês anterior">‹</button><input id="serviceMonth" class="form-input" type="month" value="${selectedMonth}"><button class="btn btn-ghost" id="serviceNext" type="button" aria-label="Próximo mês">›</button></div>`
}

function bindPeriod(): void {
  const move = (delta: number): void => { const [year, month] = selectedMonth.split('-').map(Number), date = new Date(Date.UTC(year, month - 1 + delta, 1)); selectedMonth = date.toISOString().slice(0, 7); localStorage.setItem(MONTH_KEY, selectedMonth); render() }
  document.getElementById('servicePrev')?.addEventListener('click', () => move(-1))
  document.getElementById('serviceNext')?.addEventListener('click', () => move(1))
  document.getElementById('serviceMonth')?.addEventListener('change', event => { const value = (event.currentTarget as HTMLInputElement).value; if (validFieldServiceMonth(value)) { selectedMonth = value; localStorage.setItem(MONTH_KEY, value); render() } })
}

function leaderOptions(selected = ''): string {
  const ids=leaderIds()
  const retained=selected&&!ids.includes(selected)?`<option value="${esc(selected)}" selected>${esc(personName(selected))} (fora do rodízio atual)</option>`:''
  return `<option value="">A definir</option>${retained}${ids.map(masterId => `<option value="${esc(masterId)}" ${selected === masterId ? 'selected' : ''}>${esc(personName(masterId))}</option>`).join('')}`
}

function assignmentRow(assignment: FieldServiceAssignment, locked: boolean): string {
  return `<article class="service-assignment"><div class="service-assignment-date"><strong>${esc(dateLabel(assignment.date))}</strong><span>${esc(assignment.time)}</span></div><div><strong>${esc(assignment.location)}</strong><small>${esc(assignment.label)}${assignment.manual ? ' · Adicionada manualmente' : ''}</small><small>Dirigente: ${esc(personName(assignment.leaderId))}</small></div>${locked ? '' : `<div class="service-actions"><button class="btn btn-ghost" type="button" data-service-edit-leader="${esc(assignment.id)}">Editar dirigente</button><button class="btn btn-danger" type="button" data-service-delete="${esc(assignment.id)}" title="Remover saída">Remover saída</button></div>`}</article>`
}

function openLeaderEditor(assignment: FieldServiceAssignment): void {
  if (currentPeriod()?.published) return
  const host = root()
  const candidates = fieldSubstitutes(assignment, Object.values(currentPeriod()?.assignments ?? {}), data.leaders ?? {}, people)
  const options = `<option value="">A definir</option>${assignment.leaderId ? `<option value="${esc(assignment.leaderId)}" selected>${esc(personName(assignment.leaderId))} · atual</option>` : ''}${candidates.map(item=>`<option value="${esc(item.id)}" ${item.reason?'disabled':''}>${esc(item.name)} · ${item.count} saída(s)${item.reason?` · ${esc(item.reason)}`:''}</option>`).join('')}`
  const form = document.createElement('form')
  form.id = 'serviceLeaderForm'
  form.className = 'form-panel'
  form.innerHTML = `<h3>Editar dirigente</h3><p class="form-help">${esc(dateLabel(assignment.date))} · ${esc(assignment.time)} · ${esc(assignment.location)}</p><label class="form-field"><span>Dirigente</span><select name="leaderId" class="form-select">${options}</select></label><p class="form-help">Candidatos com menos saídas aparecem primeiro. Conflitos não podem ser escolhidos.</p><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar</button><button id="cancelServiceLeader" class="btn btn-ghost" type="button">Cancelar</button></div>`
  host.append(form)
  mountRecordEditor(host, form.id)
  form.querySelector('#cancelServiceLeader')?.addEventListener('click', () => closeRecordEditor(form))
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const selected = (form.elements.namedItem('leaderId') as HTMLSelectElement).value
    if (selected === assignment.leaderId) { closeRecordEditor(form); return }
    const release = editorBusy(form)
    try { if (!await changeLeader(assignment.id, selected)) editorError(form, 'Não foi possível salvar o dirigente. Sua escolha foi mantida.') }
    finally { release() }
  })
}

function renderSchedule(): void {
  const period = currentPeriod(), assignments = Object.values(period?.assignments ?? {}).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.location.localeCompare(b.location, 'pt-BR')), locked = period?.published === true
  const eligible = new Set(leaderIds()), blank = assignments.filter(item => !item.leaderId || !eligible.has(item.leaderId)).length
  const nextMonth = nextCivilMonth(fortalezaToday())
  const prepareNext = !periods()[nextMonth] && Object.values(templates()).some(item => item.active !== false)
  root().innerHTML = `${sectionTitle('Programação de Serviço de Campo')}${periodControl()}<span class="admin-badge">${locked ? 'Publicado' : 'Rascunho'}</span>${locked ? '<div class="notice">Este mês está publicado no Quadro e bloqueado para edição.</div>' : ''}<div class="service-summary"><div><strong>${assignments.length}</strong><span>Saídas</span></div><div><strong>${blank}</strong><span>Sem dirigente</span></div></div><div class="service-actions"><button id="serviceGenerate" class="btn ${assignments.length ? 'btn-ghost' : 'btn-primary'}" type="button" ${locked ? 'disabled' : ''}>${assignments.length ? 'Completar mês' : 'Gerar rodízio'}</button><button id="servicePdf" class="btn btn-ghost" type="button" ${assignments.length ? '' : 'disabled'}>Baixar PDF</button>${!locked ? `<button id="servicePublish" class="btn btn-primary" type="button" ${assignments.length ? '' : 'disabled'}>Publicar no Quadro</button>` : ''}${locked ? '<button id="serviceReopen" class="btn btn-ghost" type="button">Reabrir para edição</button>' : ''}</div>${locked ? '' : manualAssignmentForm()}<div class="service-assignment-list">${assignments.map(item => assignmentRow(item, locked)).join('') || '<p class="empty-state">Configure as saídas e gere o rodízio deste mês.</p>'}</div>`
  if (manualEditorOpen && !locked) mountRecordEditor(root(), 'manualServiceForm')
  if (prepareNext) root().querySelector('.service-summary')?.insertAdjacentHTML('beforebegin', `<div class="notice">Prepare o rodízio de ${nextMonth.slice(5,7)}/${nextMonth.slice(0,4)} antes do dia 1º. <button id="servicePrepareNext" class="btn btn-ghost" type="button">Abrir próximo mês</button></div>`)
  document.getElementById('servicePrepareNext')?.addEventListener('click', () => { selectedMonth=nextMonth; localStorage.setItem(MONTH_KEY,nextMonth); render() })
  const problems=assignments.filter(item=>!item.leaderId||!eligible.has(item.leaderId)||fieldServiceConflicts(assignments).some(conflict=>conflict.id===item.id))
  const notices=document.createElement('div');notices.className='module-option-list'
  notices.innerHTML=problems.map(item=>`<button type="button" class="oradores-pending" data-field-pending="${esc(item.id)}"><span><strong>Impede publicar · ${esc(dateLabel(item.date))} · ${esc(item.time)}</strong><small>${item.leaderId&&eligible.has(item.leaderId)?'Dirigente com saídas simultâneas':'Defina um dirigente ativo'} — toque para corrigir.</small></span><span aria-hidden="true">›</span></button>`).join('')
  root().querySelector('.service-assignment-list')?.before(notices)
  notices.querySelectorAll<HTMLButtonElement>('[data-field-pending]').forEach(button=>button.addEventListener('click',()=>{
    if(locked){focusCorrection(document.getElementById('serviceReopen'));return}
    const item=period?.assignments[button.dataset.fieldPending!]
    if(item){openLeaderEditor(item);focusCorrection(root().querySelector<HTMLElement>('#serviceLeaderForm select[name="leaderId"]'))}
  }))
  fieldHelp(root(),'#manualServiceForm [name="location"]','Ex.: Salão do Reino ou Rua das Flores, 25. Use um local fácil de reconhecer.')
  fieldHelp(root(),'#manualServiceForm [name="leaderId"]','Selecione um dirigente aprovado. Não é criado um novo cadastro aqui.')
  bindPeriod()
  document.getElementById('servicePublish')?.addEventListener('click', () => void publishPeriod())
  document.getElementById('serviceGenerate')?.addEventListener('click', () => void generatePeriod())
  document.getElementById('servicePdf')?.addEventListener('click', () => void openPdf())
  document.getElementById('serviceReopen')?.addEventListener('click', () => void reopenPeriod())
  document.getElementById('manualServiceForm')?.addEventListener('submit', event => { event.preventDefault(); void addManualAssignment(event.currentTarget as HTMLFormElement) })
  document.getElementById('newManualService')?.addEventListener('click', () => { manualEditorOpen = true; renderSchedule() })
  document.getElementById('cancelManualService')?.addEventListener('click', () => { manualEditorOpen = false; renderSchedule() })
  document.querySelectorAll<HTMLButtonElement>('[data-service-edit-leader]').forEach(button=>button.addEventListener('click',()=>{
    const item=period?.assignments[button.dataset.serviceEditLeader!];if(item)openLeaderEditor(item)
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-service-delete]').forEach(button => button.addEventListener('click', () => void deleteAssignment(button.dataset.serviceDelete!)))
}

function manualAssignmentForm(): string {
  return `<button id="newManualService" class="btn btn-ghost" type="button">Adicionar saída</button><div hidden><form id="manualServiceForm" class="form-panel"><h3>Adicionar saída</h3><div class="module-form-grid"><label class="form-field"><span>Data</span><input name="date" type="date" value="${selectedMonth}-01" required></label><label class="form-field"><span>Hora</span><input name="time" type="time" value="08:30" required></label><label class="form-field"><span>Local</span><input name="location" maxlength="80" required></label><label class="form-field"><span>Descrição</span><input name="label" maxlength="60" value="Saída de campo"></label><label class="form-field"><span>Dirigente</span><select name="leaderId">${leaderOptions()}</select></label></div><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar saída</button><button id="cancelManualService" class="btn btn-ghost" type="button">Cancelar</button></div></form></div>`
}

async function generatePeriod(): Promise<void> {
  if (generatingPeriod || currentPeriod()?.published) return
  if (!Object.values(templates()).some(item => item.active !== false)) { toast('Cadastre ao menos uma saída recorrente'); return }
  if (!leaderIds().length) { toast('Selecione ao menos um dirigente para o rodízio'); return }
  if (Object.values(templates()).some(item => item.active !== false && (!item.date || item.date.startsWith(`${selectedMonth}-`)) && !item.leaderIds?.some(mid => leaderIds().includes(mid)))) { toast('Configure os dirigentes aprovados de cada arranjo antes de gerar'); return }
  const month = selectedMonth, expected = structuredClone(currentPeriod() ?? null)
  const period = generateFieldServicePeriod({ month, templates:templates(), leaderIds:leaderIds(), periods:periods(), existing:currentPeriod() })
  generatingPeriod = true
  try { await compareAndSet(child(servicoCampoRef, `periods/${month}`), expected, period); data.periods = { ...periods(), [month]:period }; toast('Rodízio gerado e pronto para revisão'); render() } catch (error) { toast(failureMessage(error, 'Não foi possível gerar o rodízio')) }
  finally { generatingPeriod = false }
}

async function changeLeader(assignmentId: string, leaderId: string): Promise<boolean> {
  const period = currentPeriod(), assignment = period?.assignments?.[assignmentId]; if (!period || !assignment || period.published) return false
  if (leaderId && !leaderIds().includes(leaderId)) { toast('Selecione um dirigente aprovado'); return false }
  if(fieldServiceConflicts(Object.values(period.assignments).map(item=>item.id===assignmentId?{...item,leaderId}:item)).length){toast('O dirigente já tem uma saída na mesma data e horário');return false}
  try { await compareAndSet(child(servicoCampoRef, `periods/${selectedMonth}`), period, { ...period, assignments:{ ...period.assignments, [assignmentId]:{ ...assignment, leaderId } } }); assignment.leaderId = leaderId; toast('Dirigente atualizado'); render();return true } catch (error) { toast(failureMessage(error, 'Não foi possível atualizar o dirigente'));return false }
}

async function addManualAssignment(form: HTMLFormElement): Promise<void> {
  if(currentPeriod()?.published) { toast('Reabra o mês antes de editar'); return }
  const values = new FormData(form), date = String(values.get('date') ?? ''), time = String(values.get('time') ?? ''), location = String(values.get('location') ?? '').trim(), assignmentId = id('saida')
  if (!isValidCivilDate(date) || !date.startsWith(`${selectedMonth}-`) || !location || !validFieldServiceTime(time)) { toast('Preencha uma saída válida dentro do mês selecionado'); return }
  if (Object.values(currentPeriod()?.assignments ?? {}).some(item => item.date === date && item.time === time && item.location.trim().localeCompare(location, 'pt-BR', { sensitivity:'base' }) === 0)) { toast('Esta saída já existe na programação'); return }
  const assignment: FieldServiceAssignment = { id:assignmentId, templateId:'', date, time, location, label:String(values.get('label') ?? '').trim() || 'Saída de campo', leaderId:String(values.get('leaderId') ?? ''), manual:true }
  const current = currentPeriod() ?? { month:selectedMonth, assignments:{}, published:false }
  if(fieldServiceConflicts([...Object.values(current.assignments),assignment]).length){toast('O dirigente já tem uma saída na mesma data e horário');return}
  const release=editorBusy(form)
  try { await compareAndSet(child(servicoCampoRef, `periods/${selectedMonth}`), currentPeriod() ?? null, { ...current, assignments:{ ...current.assignments, [assignmentId]:assignment } }); current.assignments[assignmentId] = assignment; data.periods = { ...periods(), [selectedMonth]:current }; manualEditorOpen = false; toast('Saída adicionada'); render() } catch (error) { editorError(form, failureMessage(error, 'Não foi possível adicionar a saída. Seu preenchimento foi mantido.'));toast(failureMessage(error, 'Não foi possível adicionar a saída')) } finally { release() }
}

async function deleteAssignment(assignmentId: string): Promise<void> {
  const period = currentPeriod(); if (!period || period.published || !period.assignments[assignmentId]) return
  if (!confirm('Remover esta saída da programação?')) return
  try { await compareAndSet(child(servicoCampoRef, `periods/${selectedMonth}`), period, { ...period, assignments:Object.fromEntries(Object.entries(period.assignments).filter(([id]) => id !== assignmentId)) }); delete period.assignments[assignmentId]; toast('Saída removida'); render() } catch (error) { toast(failureMessage(error, 'Não foi possível remover a saída')) }
}

async function publishPeriod(): Promise<void> {
  if (changingPublication) return
  const period = currentPeriod(), assignments = Object.values(period?.assignments ?? {})
  const eligible = new Set(leaderIds())
  if (!period || !assignments.length || assignments.some(item => !item.leaderId || !eligible.has(item.leaderId))) { toast('Defina um dirigente ativo para todas as saídas'); return }
  if(fieldServiceConflicts(assignments).length){toast('Há dirigentes em saídas simultâneas. Corrija antes de publicar.');return}

  const month = selectedMonth
  changingPublication = true
  const releaseUi = lockPublicationUi()
  try {
    const { publishModulePeriod } = await import('./module-publication')
    await publishModulePeriod('servicoCampo',month,period)
    await load()
    toast('Mês publicado na Minha Agenda e no Quadro'); render()
  } catch (error) { toast(failureMessage(error,'Não foi possível publicar')) }
  finally { changingPublication=false;releaseUi() }
}

async function reopenPeriod():Promise<void> {
  const period=currentPeriod()
  if(!period||changingPublication||!confirm('Reabrir para edição? O PDF será retirado do Quadro.'))return
  const month=selectedMonth
  changingPublication=true
  const releaseUi=lockPublicationUi()
  try {
    const { publishModulePeriod }=await import('./module-publication')
    await publishModulePeriod('servicoCampo',month,period,12,true)
    await load();toast('Mês reaberto');render()
  } catch(error) {toast(failureMessage(error,'Não foi possível reabrir o mês'))}
  finally {changingPublication=false;releaseUi()}
}

async function openPdf(): Promise<void> {
  if (changingPublication || downloadingPdf) return
  const assignments = Object.values(currentPeriod()?.assignments ?? {}); if (!assignments.length) return
  const input = fieldServicePdfInput(assignments)
  downloadingPdf = true
  const button = document.getElementById('servicePdf') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.textContent = 'Preparando PDF...' }
  try { const docs = await import('./servico-campo-documents'); await docs.downloadFieldServicePdf(input); toast('Download do PDF iniciado') } catch (error) { toast(failureMessage(error, 'Não foi possível gerar o PDF')) }
  finally { downloadingPdf = false; if (button) { button.disabled = false; button.textContent = 'Baixar PDF' } }
}

function renderConfiguration(): void {
  const current = templates()[editingTemplateId]
  const templateRows = Object.values(templates()).sort((a, b) => a.sortOrder - b.sortOrder || a.dow - b.dow || a.time.localeCompare(b.time)).map(item => `<details class="service-template"><summary><strong>${item.date ? esc(dateLabel(item.date)) : DAYS[item.dow]} · ${esc(item.time)}</strong><small>${esc(item.location)} · ${esc(item.label)} · ${item.active ? 'Ativa' : 'Inativa'} · ${item.leaderIds?.length ? `${item.leaderIds.length} dirigente(s)` : 'rodízio pendente'}</small></summary><div class="service-actions"><button class="btn btn-ghost" data-edit-service-template="${esc(item.id)}">Editar</button><button class="btn btn-danger" data-delete-service-template="${esc(item.id)}">Remover</button></div></details>`).join('')
  const leaderRows = Object.entries(people).filter(([, person]) => person.active !== false && person.sex === 'M').sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR')).map(([masterId, person]) => `<label class="service-leader-option"><input type="checkbox" data-service-eligible="${esc(masterId)}" ${data.leaders?.[masterId] ? 'checked' : ''}><span><strong>${esc(person.name)}</strong><small>${esc(roleLabel(person))}</small></span></label>`).join('')
  const ownLeaderRows = leaderIds().map(masterId => `<label class="service-leader-option"><input name="templateLeader" type="checkbox" value="${esc(masterId)}" ${current?.leaderIds?.includes(masterId) ? 'checked' : ''}><span><strong>${esc(personName(masterId))}</strong><small>${esc(roleLabel(people[masterId]!))}</small></span></label>`).join('')
  root().innerHTML = `${sectionTitle('Configuração do Serviço de Campo')}
    <button id="newServiceTemplate" class="btn btn-primary" type="button">Nova saída recorrente</button><details hidden><summary>${current ? 'Editar saída' : 'Nova saída'}</summary><form id="serviceTemplateForm" class="form-panel"><h3>${current ? 'Editar saída' : 'Nova saída'}</h3>
      <input name="templateId" type="hidden" value="${esc(current?.id)}">
      <div class="module-form-grid">
        <label class="form-field"><span>Programação</span><select name="mode"><option value="weekly" ${!current?.date ? 'selected' : ''}>Dia da semana</option><option value="date" ${current?.date ? 'selected' : ''}>Data específica</option></select></label>
        <label class="form-field" data-service-weekday><span>Dia</span><select name="dow">${DAYS.map((day, dow) => `<option value="${dow}" ${current?.dow === dow ? 'selected' : ''}>${day}</option>`).join('')}</select></label>
        <label class="form-field" data-service-date><span>Data</span><input name="date" type="date" value="${esc(current?.date ?? `${selectedMonth}-01`)}"></label>
        <label class="form-field"><span>Hora</span><input name="time" type="time" value="${esc(current?.time ?? '08:30')}" required></label>
        <label class="form-field"><span>Local</span><input name="location" maxlength="80" value="${esc(current?.location)}" required></label>
        <label class="form-field"><span>Descrição</span><input name="label" maxlength="60" value="${esc(current?.label ?? 'Saída de campo')}"></label>
        <label><input name="active" type="checkbox" ${current?.active !== false ? 'checked' : ''}> Saída ativa</label>
      </div>
      <details><summary>Mais opções</summary><label class="form-field"><span>Ordem de exibição</span><input name="sortOrder" type="number" min="0" value="${current?.sortOrder ?? Object.keys(templates()).length}"></label></details>
      <details ${!current?.leaderIds?.length?'open':''}><summary>Dirigentes deste arranjo</summary><div class="service-leader-grid">${ownLeaderRows || '<p class="empty-state">Nenhum dirigente aprovado.</p>'}</div></details>
      <div class="service-actions"><button class="btn btn-primary" type="submit">Salvar saída</button><button id="cancelServiceTemplate" class="btn btn-ghost" type="button">Cancelar</button></div>
    </form></details>
    <details open><summary>Saídas recorrentes · ${Object.keys(templates()).length}</summary><div class="module-option-list">${templateRows || '<p class="empty-state">Nenhuma saída cadastrada.</p>'}</div></details>
    <details class="form-panel" data-editor-scope><summary>Dirigentes aprovados · ${leaderIds().length}</summary><div class="service-leader-grid">${leaderRows || '<p class="empty-state">Nenhum irmão ativo disponível no cadastro Admin.</p>'}</div><button id="saveServiceLeaders" class="btn btn-primary" type="button">Salvar dirigentes</button></details>
    `
  if (current || creatingTemplate) mountRecordEditor(root(), 'serviceTemplateForm')
  const form = document.getElementById('serviceTemplateForm') as HTMLFormElement
  const syncMode = (): void => {
    const byDate = (form.elements.namedItem('mode') as HTMLSelectElement).value === 'date'
    form.querySelector<HTMLElement>('[data-service-weekday]')!.hidden = byDate
    form.querySelector<HTMLElement>('[data-service-date]')!.hidden = !byDate
    ;(form.elements.namedItem('date') as HTMLInputElement).required = byDate
  }
  form.querySelector('[name="mode"]')!.addEventListener('change', syncMode)
  syncMode()
  document.getElementById('serviceTemplateForm')?.addEventListener('submit', event => { event.preventDefault(); void saveTemplate(event.currentTarget as HTMLFormElement) })
  document.getElementById('cancelServiceTemplate')?.addEventListener('click', () => { editingTemplateId = ''; creatingTemplate = false; render() })
  document.getElementById('newServiceTemplate')?.addEventListener('click', () => { editingTemplateId = ''; creatingTemplate = true; render() })
  document.querySelectorAll<HTMLButtonElement>('[data-edit-service-template]').forEach(button => button.addEventListener('click', () => { editingTemplateId = button.dataset.editServiceTemplate!; creatingTemplate = false; render() }))
  document.querySelectorAll<HTMLButtonElement>('[data-delete-service-template]').forEach(button => button.addEventListener('click', () => void deleteTemplate(button.dataset.deleteServiceTemplate!)))
  document.getElementById('saveServiceLeaders')?.addEventListener('click', () => void saveLeaders())
}

async function saveTemplate(form: HTMLFormElement): Promise<void> {
  const values = new FormData(form), templateId = String(values.get('templateId') ?? '') || id('modelo'), time = String(values.get('time') ?? ''), location = String(values.get('location') ?? '').trim()
  if (!validFieldServiceTime(time) || !location) { toast('Preencha horário e local'); return }
  const item: FieldServiceTemplate = { id:templateId, label:String(values.get('label') ?? '').trim() || 'Saída de campo', dow:Number(values.get('dow')), time, location, active:values.get('active') === 'on', sortOrder:Number(values.get('sortOrder')) || 0, leaderIds:values.getAll('templateLeader').map(String).filter(Boolean) }
  if (item.leaderIds?.some(masterId => !leaderIds().includes(masterId))) { toast('Selecione somente dirigentes aprovados'); return }
  if (!item.leaderIds?.length) { toast('Selecione os dirigentes deste arranjo'); return }
  if (values.get('mode') === 'date') {
    const date = String(values.get('date') ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) { toast('Informe uma data válida'); return }
    item.date = date
  }
  const release=editorBusy(form)
  try { await update(servicoCampoRef, { [`templates/${templateId}`]:item }); data.templates = { ...templates(), [templateId]:item }; editingTemplateId = ''; creatingTemplate = false; toast('Saída recorrente salva'); render() } catch { editorError(form);toast('Não foi possível salvar a saída') } finally { release() }
}

async function deleteTemplate(templateId: string): Promise<void> {
  const used = Object.values(periods()).some(period => Object.values(period.assignments ?? {}).some(item => item.templateId === templateId))
  if (!confirm(used ? 'Esta saída já possui histórico. Ela será apenas inativada.' : 'Remover esta saída recorrente?')) return
  try {
    if (used) { await update(servicoCampoRef, { [`templates/${templateId}/active`]:false }); templates()[templateId]!.active = false }
    else { await update(servicoCampoRef, { [`templates/${templateId}`]:null }); delete templates()[templateId] }
    editingTemplateId = ''; toast(used ? 'Saída inativada; histórico preservado' : 'Saída removida'); render()
  } catch { toast('Não foi possível alterar a saída') }
}

async function saveLeaders(): Promise<void> {
  const selected = Object.fromEntries([...document.querySelectorAll<HTMLInputElement>('[data-service-eligible]')].filter(input => input.checked).map(input => [input.dataset.serviceEligible!, true]))
  const patch = Object.fromEntries([...new Set([...Object.keys(data.leaders ?? {}), ...Object.keys(selected)])].filter(mid => Boolean(data.leaders?.[mid]) !== Boolean(selected[mid])).map(mid => [`leaders/${mid}`, selected[mid] ?? null]))
  if (!Object.keys(patch).length) { toast('Nenhuma alteração'); return }
  const scope=document.getElementById('saveServiceLeaders')!.closest<HTMLElement>('[data-editor-scope]')!,release=editorBusy(scope)
  try { await update(servicoCampoRef, patch); data.leaders = selected; toast('Dirigentes aprovados salvos'); renderConfiguration() } catch { editorError(scope);toast('Não foi possível salvar os dirigentes') } finally {release()}
}
