import { renderPublicationStatus } from './module-publication'
import { substitutionDialog } from '../ui/substitution-dialog'
import { focusCorrection, fieldHelp } from '../ui/field-guidance'
import { fortalezaToday, isValidCivilDate, nextCivilMonth } from './civil-date'
import { editorBusy, editorError, editorSaved } from '../ui/editor-feedback'
import { lockPublicationUi } from '../ui/publication-busy'
import type {
  AppContext,
  ConfigLimpeza,
  ConfigLimpezaGrupo,
  ConfigCongregacao,
  ConfigReunioes,
  LimpezaPeriodoGerado,
  MasterPessoa,
  RawPessoas,
} from '../types'
import {
  get,
  compareAndUpdate,
  update,
  pessoasRef,
  configRef,
  configLimpezaRef,
  limpezaPeriodosRef,
  limpezaRef,
} from '../firebase'
import {
  assertCleaningPeriodEditable,
  replaceCleaningGroup,
  generateCleaningPeriod,
  monthLabel,
  periodBounds,
  type CleaningPeriodMode,
} from './limpeza-domain'
import { apiJson } from '../secure-api.ts'

let pessoas: RawPessoas = {}
let limpeza: Partial<ConfigLimpeza> = {}
let changingPublication = false
let downloadingPdf = false
let configDirty = false
let limpezaChanges = new Map<string, number | null>()
let periodos: Record<string, LimpezaPeriodoGerado> = {}
let periodMode: CleaningPeriodMode = 'bimester'
let periodAnchor = todayStr()
let selectedPeriodId = ''
let overviewMonth = ''
let congregationName = 'Noroeste'
let reunioes: Partial<ConfigReunioes> = {}
const CLEANING_PERIOD_MODE_KEY = 'noroeste_limpeza_period_mode'


function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function toast(msg: string, ms = 2600): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), ms)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function todayStr(): string {
  return fortalezaToday()
}

function toStringArray(val: string[] | Record<string, string> | undefined | null): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val
  return Object.values(val)
}

function setLoading(btnId: string, loading: boolean, label: string): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = loading
  btn.textContent = loading ? 'Salvando...' : label
}

function activePeople(): [string, MasterPessoa][] {
  return Object.entries(pessoas)
    .filter(([, p]) => p.active)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
}

function groupCount(): number {
  return Math.max(1, Math.min(12, Number(limpeza.grupos ?? 4)))
}

function candidateOptions(selectedMid = '', candidates = activePeople()): string {
  return candidates
    .map(([mid, p]) =>
      `<option value="${mid}" ${selectedMid === mid ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    )
    .join('')
}

function renderSectionTitle(title: string, desc: string): string {
  return `
    <div class="workspace-heading">
      <h1>${title}</h1>
      ${desc ? `<p style="font-size:.8rem;color:var(--ink-3)">${desc}</p>` : ''}
    </div>`
}

export default function mount(_ctx: AppContext): void {
  overviewMonth=_ctx.overview?.month??''
  if(overviewMonth)periodAnchor=overviewMonth+'-01'
  limpezaChanges = new Map()
  configDirty = false

  const root = document.getElementById('appContent')
  if (!root) return
  root.innerHTML = `
    <div id="limpezaRoot">
      <div id="limpezaContent"></div>
    </div>`

  void loadAll()
}

async function loadAll(): Promise<void> {
  const content = document.getElementById('limpezaContent')
  if (content) {
    content.innerHTML =
      '<p style="padding:24px;color:var(--ink-3);text-align:center">Carregando...</p>'
  }

  try {
    const [peopleSnap, configSnap, limpezaSnap] = await Promise.all([
      get(pessoasRef),
      get(configRef),
      get(limpezaRef),
    ])
    const config = configSnap.exists() ? configSnap.val() as {
      limpeza?: ConfigLimpeza; congregacao?: ConfigCongregacao; reunioes?: ConfigReunioes
    } : {}
    const limpezaRoot = limpezaSnap.exists() ? limpezaSnap.val() as {
      periodos?: Record<string, LimpezaPeriodoGerado>
    } : {}
    pessoas = peopleSnap.exists() ? peopleSnap.val() as RawPessoas : {}
    limpeza = config.limpeza ?? {}
    periodos = limpezaRoot.periodos ?? {}
    const congregacao = config.congregacao
    congregationName = congregacao?.nome?.trim() || 'Noroeste'
    reunioes = config.reunioes ?? {}
    const savedMode = localStorage.getItem(CLEANING_PERIOD_MODE_KEY)
    periodMode = savedMode === 'month' || savedMode === 'bimester'
      ? savedMode
      : limpeza.periodMode === 'month' ? 'month' : 'bimester'
    const ids = Object.keys(periodos).sort()
    selectedPeriodId = overviewMonth ? ids.find(id=>periodos[id].inicio<=overviewMonth+'-01'&&periodos[id].fim>=overviewMonth+'-01')??'' : ids[ids.length - 1] ?? ''
    overviewMonth=''
  } catch {
    toast('Erro ao carregar dados de limpeza')
    if (content?.isConnected) {
      content.innerHTML = '<p class="empty-state">Não foi possível carregar a Limpeza.</p><button id="retryCleaning" class="btn btn-primary">Tentar novamente</button>'
      document.getElementById('retryCleaning')?.addEventListener('click', () => void loadAll())
    }
    return
  }

  if (!content?.isConnected) return
  renderContent()
}

function renderContent(): void {
  const content = document.getElementById('limpezaContent')
  if (!content) return
  content.innerHTML = `${renderSectionTitle('Limpeza', '')}
    <div id="cleaningGuidance"></div>
    <nav class="workspace-tabs" aria-label="Limpeza" data-workspace-home="escala" data-workspace-active="escala"><button type="button" data-cleaning-tab="escala" data-workspace-tab="escala" aria-current="page">Escala</button><button type="button" data-cleaning-tab="grupos" data-workspace-tab="grupos" aria-current="false">Grupos</button><button type="button" data-cleaning-tab="config" data-workspace-tab="config" aria-current="false">Configurações</button></nav>
    <section data-cleaning-panel="escala"><div id="cleaningPdf"></div>
    <div id="cleaningSchedule"></div>
    <details ${selectedPeriodId ? '' : 'open'}><summary>Gerar escala</summary><div id="cleaningGenerate"></div></details>
    </section><section data-cleaning-panel="grupos" hidden><h3>Grupos e participantes</h3><div id="cleaningGroups"></div></section>
    <section data-cleaning-panel="config" hidden><h3>Configurações de Limpeza</h3><p class="form-help">Cadastros e regras. Alterar configurações não substitui a escala já gerada.</p>
    <details><summary>Rotação e responsáveis</summary><div id="cleaningConfig"></div></details></section>`
  const selectPanel=(id:string):void=>{
    content.querySelector<HTMLElement>('[data-workspace-home]')!.dataset.workspaceActive=id
    content.querySelectorAll<HTMLElement>('[data-cleaning-panel]').forEach(panel=>panel.hidden=panel.dataset.cleaningPanel!==id)
    content.querySelectorAll<HTMLElement>('[data-cleaning-tab]').forEach(button=>button.setAttribute('aria-current',button.dataset.cleaningTab===id?'page':'false'))
  }
  content.querySelectorAll<HTMLButtonElement>('[data-cleaning-tab]').forEach(button=>button.addEventListener('click',()=>selectPanel(button.dataset.cleaningTab!)))
  content.querySelectorAll<HTMLElement>('[data-cleaning-panel]').forEach(panel=>panel.addEventListener('reveal-correction',()=>selectPanel(panel.dataset.cleaningPanel!)))
  renderEscala()
  renderPdf()
  renderGrupos()
  renderConfig()
  renderCleaningGuidance()
}

function renderCleaningGuidance():void {
  const issues:{selector:string;label:string}[]=[]
  const nextMonth=nextCivilMonth(fortalezaToday())
  if(!limpeza.ativa)issues.push({selector:'#lAtiva',label:'Rotação desativada — ative para gerar a escala.'})
  if(!limpeza.inicioRotacao)issues.push({selector:'#lInicio',label:'Informe a data inicial da rotação.'})
  if(!Object.values(periodos).some(period=>period.inicio<=`${nextMonth}-01`&&period.fim>=`${nextMonth}-01`))issues.push({selector:'#limpezaPeriodAnchor',label:`Prepare a escala de ${nextMonth.slice(5,7)}/${nextMonth.slice(0,4)} antes do dia 1º.`})
  const content=document.getElementById('limpezaContent');if(!content)return
  const guidance=document.getElementById('cleaningGuidance');if(!guidance)return
  guidance.innerHTML=issues.map((item,index)=>`<button type="button" class="oradores-pending" data-cleaning-pending="${index}"><span>${escapeHtml(item.label)}</span><span aria-hidden="true">›</span></button>`).join('')
  guidance.querySelectorAll<HTMLButtonElement>('[data-cleaning-pending]').forEach(button=>button.addEventListener('click',()=>focusCorrection(document.querySelector(issues[Number(button.dataset.cleaningPending)]!.selector))))
  fieldHelp(content,'#lInicio','Informe a data de início do Grupo 1. Ela é a referência do rodízio semanal.')
  fieldHelp(content,'#limpezaPeriodAnchor','Escolha o mês que deseja gerar. Alterar cadastros não atualiza uma escala já gerada.')
}

function formatGeneratedDate(value: string): string {
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year.slice(-2)}` : value
}

function generatedPeriod(): LimpezaPeriodoGerado | null {
  return selectedPeriodId ? periodos[selectedPeriodId] ?? null : null
}

function generatedPeriodOptions(): string {
  return Object.values(periodos)
    .sort((a, b) => b.inicio.localeCompare(a.inicio))
    .map(period => `<option value="${period.id}" ${period.id === selectedPeriodId ? 'selected' : ''}>${escapeHtml(monthLabel(period.inicio))}${period.modo === 'bimester' ? ` / ${escapeHtml(monthLabel(period.fim))}` : ''} ${period.inicio.slice(0, 4)}</option>`)
    .join('')
}

function renderPeriodRows(period: LimpezaPeriodoGerado): string {
  return period.semanas.map((week,index) => `
    <div class="cleaning-period-row" style="padding:10px 12px;border-bottom:1px solid var(--border)">
      <strong style="color:var(--blue-deep)">Grupo ${week.grupo}</strong>
      <span style="font-size:.82rem;font-weight:600;overflow-wrap:anywhere">${escapeHtml(week.grupoNome)}</span>
      <span class="cleaning-period-dates" style="font-size:.78rem;color:var(--ink-3)">${formatGeneratedDate(week.dataMeioSemana)} e ${formatGeneratedDate(week.dataFimSemana)}</span>
      ${period.publicado?'':`<button type="button" class="btn btn-ghost" data-cleaning-substitute="${index}">Substituir grupo</button>`}${week.manualGroup?'<small>Grupo ajustado nesta semana</small>':''}
    </div>`).join('')
}

function renderEscala(): void {
  const content = document.getElementById('cleaningGenerate')
  if (!content) return
  content.innerHTML = `
    <div class="module-form-grid">
      <div class="form-group"><label class="form-label">Período</label><select id="limpezaPeriodMode" class="form-select"><option value="month" ${periodMode === 'month' ? 'selected' : ''}>Mensal</option><option value="bimester" ${periodMode === 'bimester' ? 'selected' : ''}>Bimestral</option></select></div>
      <div class="form-group"><label class="form-label">Mês inicial</label><input id="limpezaPeriodAnchor" class="form-input" type="month" value="${periodAnchor.slice(0, 7)}"></div>
    </div>
    <button id="btnGerarEscalaLimpeza" class="btn btn-primary btn-full" type="button">${periodos[periodBounds(`${periodAnchor.slice(0,7)}-01`,periodMode).id]?'Gerar novamente':'Gerar escala'}</button>`
  document.getElementById('limpezaPeriodMode')?.addEventListener('change', event => {
    periodMode = (event.target as HTMLSelectElement).value as CleaningPeriodMode
    localStorage.setItem(CLEANING_PERIOD_MODE_KEY, periodMode)
    renderEscala()
  })
  document.getElementById('limpezaPeriodAnchor')?.addEventListener('change', event => {
    periodAnchor = `${(event.target as HTMLInputElement).value}-01`
    renderEscala()
  })
  document.getElementById('btnGerarEscalaLimpeza')?.addEventListener('click', () => void saveGeneratedPeriod())
}

async function saveGeneratedPeriod(): Promise<void> {
  const button = document.getElementById('btnGerarEscalaLimpeza') as HTMLButtonElement | null
  try {
    const effective = ({ config:limpeza as ConfigLimpeza, people:pessoas })
    if (!limpeza.ativa || !limpeza.inicioRotacao || !effective.config.grupos || !reunioes.meiaDeSemana || !reunioes.fimDeSemana) {
      throw new Error('Complete a configuração da rotação e dos dias de reunião antes de gerar.')
    }
    const periodId = periodBounds(`${periodAnchor.slice(0, 7)}-01`, periodMode).id
    assertCleaningPeriodEditable(periodos[periodId])
    if(periodos[periodId]&&!confirm('Gerar novamente este período? Ajustes manuais de grupo serão preservados, mas a escala será recalculada com os cadastros atuais.'))return
    button?.setAttribute('disabled', '')
    if (button) button.textContent = 'Gerando...'
    const generated = generateCleaningPeriod(
      `${periodAnchor.slice(0, 7)}-01`, periodMode, effective.config,
      reunioes as ConfigReunioes, effective.people, congregationName, new Date().toISOString(),
    )
    generated.semanas=generated.semanas.map(week=>periodos[generated.id]?.semanas.find(previous=>previous.referencia===week.referencia&&previous.manualGroup)??week)
    await compareAndUpdate(limpezaPeriodosRef, { [generated.id]:periodos[generated.id] ?? null }, { [generated.id]: generated })
    try {
      await update(configLimpezaRef, { periodMode })
      limpeza.periodMode = periodMode
    } catch {
      console.warn('A escala foi salva, mas não foi possível guardar o formato preferido de Limpeza')
    }
    periodos[generated.id] = generated
    renderCleaningGuidance()
    selectedPeriodId = generated.id
    toast(`Escala gerada com ${generated.semanas.length} semanas`)
    renderEscala()
    renderPdf()
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Erro ao gerar a escala')
  } finally {
    button?.removeAttribute('disabled')
    if (button) button.textContent = 'Gerar escala'
  }
}

function renderGrupos(): void {
  const content = document.getElementById('cleaningGroups')
  if (!content) return
  limpezaChanges.clear()

  const ativos = activePeople()
  content.innerHTML = `
    <div id="limpezaCounters" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px"></div>
    <div style="font-size:.78rem;color:var(--ink-3);margin-bottom:8px">
      ${ativos.length} pessoa${ativos.length !== 1 ? 's' : ''} ativa${ativos.length !== 1 ? 's' : ''}
    </div>
    <div id="limpezaList">
      ${[...Array.from({ length: groupCount() }, (_, i) => i + 1), null].map(group => {
        const members = ativos.filter(([, person]) => (person.limpeza?.grupo ?? null) === group || (group === null && Number(person.limpeza?.grupo) > groupCount()))
        return `<details><summary>${group === null ? 'Sem grupo' : `Grupo ${group}`} · ${members.length} participantes</summary>${members.map(([mid, p]) => `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
          padding:9px 12px;margin-bottom:5px;display:flex;align-items:center;gap:10px">
          <span style="flex:1;font-size:.88rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${escapeHtml(p.name)}
          </span>
          <select class="form-select limpeza-sel" data-mid="${mid}"
            style="width:126px;font-size:.82rem;padding:5px 8px">
            <option value="">Sem grupo</option>
            ${Array.from({ length: groupCount() }, (_, i) => i + 1).map(g => `
              <option value="${g}" ${(p.limpeza?.grupo ?? null) === g ? 'selected' : ''}>
                Grupo ${g}
              </option>`).join('')}
          </select>
        </div>`).join('')}</details>`
      }).join('')}
    </div>
    <div style="position:sticky;bottom:8px;margin-top:14px">
      <button id="btnSalvarLimpezaGrupos" class="btn btn-primary btn-full" disabled>
        Salvar Grupos
      </button>
    </div>`

  updateLimpezaCounters(ativos)

  document.querySelectorAll<HTMLSelectElement>('.limpeza-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      const mid = sel.dataset['mid']!
      const val = sel.value ? parseInt(sel.value, 10) : null
      limpezaChanges.set(mid, val)
      updateLimpezaCounters(ativos)
      ;(document.getElementById('btnSalvarLimpezaGrupos') as HTMLButtonElement).disabled=limpezaChanges.size===0
    })
  })

  document.getElementById('btnSalvarLimpezaGrupos')!
    .addEventListener('click', () => void saveGrupos())
}

function updateLimpezaCounters(ativos: [string, MasterPessoa][]): void {
  const counts: Record<string, number> = { sem: 0 }
  for (let i = 1; i <= groupCount(); i++) counts[String(i)] = 0

  for (const [mid, p] of ativos) {
    const grupo = limpezaChanges.has(mid)
      ? (limpezaChanges.get(mid) ?? null)
      : (p.limpeza?.grupo ?? null)
    const key = grupo != null ? String(grupo) : 'sem'
    counts[key] = (counts[key] ?? 0) + 1
  }

  const el = document.getElementById('limpezaCounters')
  if (!el) return
  el.innerHTML = Array.from({ length: groupCount() }, (_, i) => i + 1).map(g => `
    <span style="background:var(--surface);border:1px solid var(--border);
      border-radius:8px;padding:5px 12px;font-size:.8rem;font-weight:600">
      Grupo ${g}: <strong>${counts[String(g)] ?? 0}</strong>
    </span>`
  ).join('') + `
    <span style="background:var(--surface);border:1px solid var(--border);
      border-radius:8px;padding:5px 12px;font-size:.8rem;color:var(--ink-3)">
      Sem grupo: ${counts['sem'] ?? 0}
    </span>`
}

async function saveGrupos(): Promise<void> {
  if (limpezaChanges.size === 0) { toast('Nenhuma alteração'); return }

  const scope=document.getElementById('cleaningGroups')!
  const release=editorBusy(scope)
  setLoading('btnSalvarLimpezaGrupos', true, 'Salvar Grupos')
  const groups = Object.fromEntries(limpezaChanges)

  try {
    await apiJson('cleaning-groups', { method:'PATCH', body:JSON.stringify({ groups }) })
    for (const [mid, grupo] of limpezaChanges) {
      const p = pessoas[mid]
      if (p) p.limpeza = { grupo }
    }
    const n = limpezaChanges.size
    toast(`${n} alteraç${n === 1 ? 'ão salva' : 'ões salvas'} ✓`)
    editorSaved(scope)
    limpezaChanges.clear()
    renderGrupos()
    if (!configDirty) renderConfig()
  } catch {
    editorError(scope)
    toast('Erro ao salvar grupos')
  } finally {
    release()
    setLoading('btnSalvarLimpezaGrupos', false, 'Salvar Grupos')
  }
}

function renderConfig(): void {
  const content = document.getElementById('cleaningConfig')
  if (!content) return

  const ativa = limpeza.ativa ?? false
  const grupos = groupCount()
  const inicioRotacao = limpeza.inicioRotacao ?? ''

  const grupoCards = Array.from({ length: grupos }, (_, i) => {
    const gid = String(i + 1)
    const sourceId = gid
    const item: Partial<ConfigLimpezaGrupo> = limpeza.gruposConfig?.[sourceId] ?? {}
    const nome = item.nome ?? ''
    const superintendenteMid = item.superintendenteMid ?? ''
    const ajudantesMid = toStringArray(item.ajudantesMid as string[] | Record<string, string> | undefined)
    const groupPeople = activePeople().filter(([, person]) => person.limpeza?.grupo === Number(gid))

    return `
      <details data-cleaning-group="${escapeHtml(sourceId)}" style="background:var(--surface);border-bottom:1px solid var(--border);
        padding:12px;margin-bottom:10px">
        <summary style="font-size:.9rem;font-weight:700;color:var(--blue-deep);margin-bottom:10px">
          ${escapeHtml(nome || `Grupo ${gid}`)}
        </summary>
        <div class="form-group">
          <label class="form-label">Nome do grupo</label>
          <input id="gNome_${escapeHtml(sourceId)}" class="form-input" maxlength="40" value="${escapeHtml(nome)}" placeholder="Ex.: Salão do Reino">
        </div>
        <div class="form-group">
          <label class="form-label">Responsável pela limpeza</label>
          <select id="gSuper_${escapeHtml(sourceId)}" class="form-select">
            <option value="">Selecionar...</option>
            ${candidateOptions(superintendenteMid, groupPeople)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ajudantes</label>
          <div class="cleaning-helper-grid">
            ${groupPeople.map(([mid, p]) => `
              <label title="${escapeHtml(p.name)}">
                <input type="checkbox" data-group-helper="${escapeHtml(sourceId)}" value="${mid}" ${ajudantesMid.includes(mid) ? 'checked' : ''}>
                <span>${escapeHtml(p.name)}</span>
              </label>`).join('')}
          </div>
        </div>
      </details>`
  }).join('')

  content.innerHTML = `
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="lAtiva" ${ativa ? 'checked' : ''}>
        <span class="form-label" style="margin:0">Rotação ativa</span>
      </label>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" >
        <label class="form-label">Número de grupos</label>
        <select id="lGrupos" class="form-select">
          ${Array.from({ length:12 }, (_, i) => i + 1).map(n => `<option value="${n}" ${grupos === n ? 'selected' : ''}>${n} grupos</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Início da rotação</label>
        <input id="lInicio" class="form-input" type="date" value="${inicioRotacao}">
      </div>
    </div>
    <div style="font-size:.8rem;font-weight:600;color:var(--ink-2);margin:16px 0 10px;
      text-transform:uppercase;letter-spacing:.05em">Por grupo</div>
    ${grupoCards}
    <div style="position:sticky;bottom:8px;margin-top:4px">
      <button id="btnSalvarLimpezaConfig" class="btn btn-primary btn-full">Salvar Configuração</button>
    </div>`

  document.getElementById('btnSalvarLimpezaConfig')!
    .addEventListener('click', () => void saveConfig())
  content.oninput = () => { configDirty = true }
}

async function saveConfig(): Promise<void> {
  const button = document.getElementById('btnSalvarLimpezaConfig') as HTMLButtonElement
  if (button.disabled) return
  const checked = (id: string) => (document.getElementById(id) as HTMLInputElement).checked
  const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value.trim() ?? ''
  const grupos = Number((document.getElementById('lGrupos') as HTMLSelectElement).value)
  const editedConfigs: Record<string, ConfigLimpezaGrupo> = {}

  for (let i = 1; i <= grupos; i++) {
    const gid = String(i)
    const ajudantesMid = Array.from(
      document.querySelectorAll<HTMLInputElement>('[data-group-helper]:checked')
    ).filter(cb => cb.dataset['groupHelper'] === gid).map(cb => cb.value)

    editedConfigs[gid] = {
      nome: value(`gNome_${gid}`),
      superintendenteMid: value(`gSuper_${gid}`),
      ajudantesMid,
    }
  }

  const nextConfig: ConfigLimpeza = {
    ativa: checked('lAtiva'),

    periodMode,
    grupos,
    inicioRotacao: value('lInicio'),
    gruposConfig: editedConfigs,
  }
  if (!isValidCivilDate(nextConfig.inicioRotacao)) { toast('Informe uma data válida para o início da rotação'); return }

  const patch: Record<string, unknown> = {}, expected: Record<string, unknown> = {}
  const changed = (path: string, before: unknown, after: unknown): void => {
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return
    patch[path] = after ?? null; expected[path] = before ?? null
  }
  for (const key of ['ativa', 'periodMode', 'grupos', 'inicioRotacao'] as const) changed(key, limpeza[key], nextConfig[key])
  const collection = 'gruposConfig'
  for (const [gid, config] of Object.entries(editedConfigs)) {
    for (const [field, after] of Object.entries(config)) changed(`${collection}/${gid}/${field}`, (limpeza[collection]?.[gid] as unknown as Record<string, unknown> | undefined)?.[field], after)
  }
  if (!Object.keys(patch).length) { toast('Nenhuma alteração'); return }
  const scope=document.getElementById('cleaningConfig')!
  const release=editorBusy(scope)
  setLoading('btnSalvarLimpezaConfig', true, 'Salvar Configuração')
  try {
    await compareAndUpdate(configLimpezaRef, expected, patch)
    limpeza = nextConfig
    editorSaved(scope)
    configDirty = false
    toast('Configuração salva ✓')
    if (button.isConnected) { renderConfig(); renderCleaningGuidance(); if (!limpezaChanges.size) renderGrupos() }
  } catch (error) {
    editorError(scope, failureMessage(error, 'Erro ao salvar configuração. Seu preenchimento foi mantido.'))
    toast(failureMessage(error, 'Erro ao salvar configuração'))
  } finally {
    release()
    button.disabled = false; button.textContent = 'Salvar Configuração'
  }
}

function renderPdf(): void {
  queueMicrotask(()=>{const period=generatedPeriod();if(period)void renderPublicationStatus(document.getElementById('cleaningPdf'),'limpeza',period.id)})
  const content = document.getElementById('cleaningPdf')
  if (!content) return
  const period = generatedPeriod()
  const fontSize = Number(localStorage.getItem('noroeste_limpeza_pdf_font') ?? 15)
  content.innerHTML = `
    ${period ? `<div class="form-panel">
      <label class="form-field"><span>Escala gerada</span><select id="pdfLimpezaPeriodo" class="form-select">${generatedPeriodOptions()}</select></label>
      <details><summary>Ajustar PDF</summary><label class="form-field"><span>Fonte base: <strong id="pdfLimpezaFonteValor">${fontSize} pt</strong></span><input id="pdfLimpezaFonte" type="range" min="8" max="22" value="${fontSize}"></label></details>
      <span class="admin-badge">${period.publicado ? 'Publicado' : 'Rascunho'}</span>
      <button id="btnGerarPdfLimpeza" class="btn btn-ghost btn-full" type="button">Baixar PDF</button>
      <button id="btnPublicarPdfLimpeza" class="btn ${period.publicado ? 'btn-ghost' : 'btn-primary'} btn-full" style="margin-top:8px" type="button">${period.publicado ? 'Reabrir para edição' : 'Publicar no Quadro'}</button>
    </div>` : '<p class="empty-state">Nenhuma escala gerada. Escolha o período em “Gerar escala” para começar.</p>'}`
  const schedule = document.getElementById('cleaningSchedule')
  if (schedule) schedule.innerHTML = period ? renderPeriodRows(period) : ''
  schedule?.querySelectorAll<HTMLButtonElement>('[data-cleaning-substitute]').forEach(button=>button.addEventListener('click',()=>{
    if(!period||period.publicado)return
    const index=Number(button.dataset.cleaningSubstitute),week=period.semanas[index]
    substitutionDialog({title:`Grupo · semana de ${formatGeneratedDate(week.referencia)}`,current:week.grupoNome,candidates:Array.from({length:groupCount()},(_,i)=>i+1).filter(group=>group!==week.grupo).map(group=>{
      let reason='';try{replaceCleaningGroup(period,index,group,limpeza as ConfigLimpeza,pessoas)}catch(error){reason=error instanceof Error?error.message:'Grupo indisponível'}
      return {id:String(group),name:limpeza.gruposConfig?.[String(group)]?.nome||`Grupo ${group}`,count:period.semanas.filter(w=>w.grupo===group&&w.referencia.slice(0,7)===week.referencia.slice(0,7)).length,reason}
    }),note:'Troca somente esta semana, incluindo as duas reuniões. A rotação das demais semanas e o cadastro dos grupos permanecem iguais. A troca será preservada ao gerar novamente este período.',save:async id=>{
      const next=replaceCleaningGroup(period,index,Number(id),limpeza as ConfigLimpeza,pessoas)
      await compareAndUpdate(limpezaPeriodosRef,{[period.id]:period},{[period.id]:next});periodos[period.id]=next;renderPdf();toast('Grupo substituído nesta semana');return true
    }})
  }))
  document.getElementById('pdfLimpezaPeriodo')?.addEventListener('change', event => {
    selectedPeriodId = (event.target as HTMLSelectElement).value
    renderPdf()
  })
  document.getElementById('pdfLimpezaFonte')?.addEventListener('input', event => {
    const value = (event.target as HTMLInputElement).value
    localStorage.setItem('noroeste_limpeza_pdf_font', value)
    const label = document.getElementById('pdfLimpezaFonteValor')
    if (label) label.textContent = `${value} pt`
  })
  document.getElementById('btnGerarPdfLimpeza')?.addEventListener('click', () => void exportCleaningPdf())
  document.getElementById('btnPublicarPdfLimpeza')?.addEventListener('click', () => void toggleCleaningPublication())
}

async function toggleCleaningPublication(): Promise<void> {
  if (changingPublication) return
  const period = generatedPeriod()
  if (!period) return
  if (period.publicado && !confirm('Reabrir para edição? O PDF será retirado do Quadro até publicar novamente.')) return
  changingPublication = true
  const releaseUi = lockPublicationUi()
  try {
    const { publishModulePeriod } = await import('./module-publication')
    const reopening = period.publicado === true
    await publishModulePeriod('limpeza', period.id, period, Number(localStorage.getItem('noroeste_limpeza_pdf_font') ?? 15), reopening)
    await loadAll()
    toast(reopening ? 'Período reaberto e retirado do Quadro' : 'Período publicado no Quadro')
    renderPdf()
  } catch (error) { toast(failureMessage(error, 'Não foi possível alterar a publicação')) }
  finally { changingPublication = false; releaseUi() }
}

async function exportCleaningPdf(): Promise<void> {
  if (changingPublication || downloadingPdf) return
  const period = generatedPeriod()
  if (!period) { toast('Gere a escala antes de baixar o PDF'); return }
  const button = document.getElementById('btnGerarPdfLimpeza') as HTMLButtonElement | null
  const fontSize = Number((document.getElementById('pdfLimpezaFonte') as HTMLInputElement).value)
  downloadingPdf = true
  try {
    if (button) { button.disabled = true; button.textContent = 'Preparando PDF...' }
    const { downloadCleaningPdf } = await import('./limpeza-documents')
    const result = await downloadCleaningPdf(period, { requestedFontSize: fontSize })

    toast(result.effectiveFontSize < fontSize ? `PDF ajustado para ${result.effectiveFontSize} pt sem quebrar texto` : 'Download do PDF iniciado')
  } catch (error) {
    toast(failureMessage(error, 'Erro ao gerar o PDF'))
  } finally {
    downloadingPdf = false
    if (button) { button.disabled = false; button.textContent = 'Baixar PDF' }
  }
}
