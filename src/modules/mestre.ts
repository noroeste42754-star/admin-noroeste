import { auditIntegrations } from './integration-audit'
import { auditMasterQuality } from './master-quality'
import { focusCorrection, fieldHelp, takeMasterCorrection } from '../ui/field-guidance'
import { editorBusy, editorError, editorSaved } from '../ui/editor-feedback'
import type {
  AppContext,
  AgendaConfig,
  AgendaReminderModule,
  MasterConfig,
  MasterPessoa,
  RawPessoas,
  RawUsuarios,
  Role,
  Sex,
  Usuario,
  ModuleName,
} from '../types'
import {
  get, set, update, remove,
  pessoaRef, pessoasRef,
  usuarioRef, usuariosRef,
  configRef,
  configCongregacaoRef,
  configReunioesRef,
  agendaConfigRef,
  agendaDocumentsRef,
  rootRef,
  masterRef,
  tarefasRef,
  limpezaRef,
  escalaRef,
  servicoCampoRef,
} from '../firebase'
import { renderMenuCards, type ItemMenu } from '../ui/menu-cards'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import { moduleBackButton } from '../ui/module-header'
import { validateBackup } from './mestre-backup-domain'
import {
  createMasterId,
  linkIssueSource,
  masterIdReferencePaths,
  normalizeWhatsapp,
  personalUserConflict,
  sanitizeFailureReportValue,
  sharedWhatsappPeople,
  stableUserMasterId,
} from './mestre-domain'
import { navigateTo } from '../router'
import { apiJson } from '../secure-api'

// ─── Estado do módulo ────────────────────────────────────────────────────────

let pessoas:   RawPessoas  = {}
let usuarios:  RawUsuarios = {}
let config:    MasterConfig = {}
let agendaConfig: AgendaConfig = {}
let rootData:  Record<string, unknown> | null = null
let rootLoading = false
let rootLoadError = ''
let restoreCandidate: Record<string, unknown> | null = null
let restoreFileName = ''
let baseLoadPromise: Promise<boolean> | null = null

type AdminTab = 'indice' | 'pessoas' | 'usuarios' | 'config' | 'vinculos' | 'dados' | 'saude'
let activeTab: AdminTab = 'indice'
interface PdfInventoryFile { path:string; etag:string; createdAt:string|null; bytes:number|null; status:'ativo'|'retido'|'elegivel'|'desconhecido' }
interface PdfInventory { checkedAt:string; retentionDays:number; files:PdfInventoryFile[]; health:{database:string;storage:string;version:string} }
let pdfInventory:PdfInventory|null=null
let pdfInventoryError=''
let pdfInventoryLoading=false
const BACKUP_CHECK_KEY='noroeste_backup_check_v1'
let activeConfigSection: 'congregacao' | 'agenda' = 'congregacao'

let pessoaFilter = { nome: '', role: '', ativo: 'true', sex: '' }
let selectedMasterPersonId = ''
let usuarioFilter = { nome:'', ativo:'' }

// ─── Constantes ──────────────────────────────────────────────────────────────

const DIAS_SEMANA = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado']

// ─── Utilitários gerais ───────────────────────────────────────────────────────

function toast(msg: string, ms = 2600): void {
  const el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.classList.add('show')
  setTimeout(() => el.classList.remove('show'), ms)
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function records(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item)),
  ) as Record<string, Record<string, unknown>>
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function roleLabel(role: Role | null): string {
  const map: Record<string, string> = {
    'anciao': 'Ancião', 'servo-ministerial': 'Servo min.',
    'pioneiro': 'Pioneiro', 'batizado': 'Batizado', 'publicador': 'Publicador',
  }
  return role ? (map[role] ?? role) : '—'
}

function sexLabel(sex: Sex | null): string {
  return sex === 'M' ? 'M' : sex === 'F' ? 'F' : '—'
}

function appsList(apps: Usuario['apps']): string {
  const labels: Record<string, string> = {
    mestre:'Admin', tarefas:'Tarefas', oradores:'Oradores', limpeza:'Limpeza', escala:'Escala TPL',
    servicoCampo:'Serviço de Campo',
  }
  return (Object.keys(apps) as Array<keyof typeof apps>)
    .filter(k => k !== 'individual' && apps[k]).map(k => labels[k]).join(', ') || '—'
}

function appCheck(id: string, label: string, checked: boolean): string {
  return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0">
    <input type="checkbox" id="uApp_${id}" ${checked ? 'checked' : ''}>
    <span style="font-size:.88rem">${label}</span>
  </label>`
}

function setLoading(btnId: string, loading: boolean, label = 'Salvar'): void {
  const btn = document.getElementById(btnId) as HTMLButtonElement | null
  if (!btn) return
  btn.disabled = loading
  btn.textContent = loading ? 'Salvando…' : label
}

// ─── Mount ───────────────────────────────────────────────────────────────────

export default function mount(_ctx: AppContext): void {
  activeTab = 'indice'
  activeConfigSection = 'congregacao'
  pessoaFilter = { nome: '', role: '', ativo: 'true', sex: '' }
  rootData = null
  rootLoadError = ''
  restoreCandidate = null
  restoreFileName = ''
  baseLoadPromise = null
  pessoas = {}; usuarios = {}; config = {}; agendaConfig = {}

  const root = document.getElementById('appContent')!
  root.innerHTML = `
    <div id="mestreRoot">
      <div id="mestreNav"></div><div id="mestreBack"></div>
      <div id="mestreContent"></div>
    </div>`

  const correction=takeMasterCorrection()
  void switchTab('pessoas').then(()=>{if(correction&&pessoas[correction]&&document.getElementById('mestreRoot')){openPessoaModal(correction);focusCorrection(document.getElementById('pWpp'))}})
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

async function switchTab(t: typeof activeTab): Promise<void> {
  const content = document.getElementById('mestreContent')
  if (!content) return
  activeTab = t
  renderNavigation()
  content.innerHTML = `${moduleBackButton()}<p class="empty-state">Carregando dados...</p>`
  const loaded = await ensureBaseLoaded()
  if (!content.isConnected || activeTab !== t) return
  if (!loaded) { baseLoadPromise = null; content.innerHTML = '<p class="empty-state">Não foi possível carregar os dados do Admin.</p><button id="retryAdmin" class="btn btn-primary">Tentar novamente</button>'; document.getElementById('retryAdmin')?.addEventListener('click', () => void switchTab(t)); return }
  activeTab = t
  if ((t === 'vinculos' || t === 'dados') && !rootData) {
    void loadRootData()
    return
  }
  renderContent()
}

async function loadRootData(force = false): Promise<void> {
  if (rootLoading || (rootData && !force)) return
  rootLoading = true
  rootLoadError = ''
  renderContent()
  try {
    rootData = await loadPublicRoot()
  } catch {
    rootLoadError = 'Não foi possível carregar os dados completos.'
    toast('Erro ao carregar dados para auditoria')
  } finally {
    rootLoading = false
    renderContent()
  }
}

function ensureBaseLoaded(): Promise<boolean> {
  baseLoadPromise ??= loadAll()
  return baseLoadPromise
}

async function loadAll(): Promise<boolean> {
  try {
    const [pSnap, uSnap, cSnap, aSnap] = await Promise.all([
      get(pessoasRef), get(usuariosRef), get(configRef), get(agendaConfigRef),
    ])
    pessoas  = pSnap.exists()  ? (pSnap.val()  as RawPessoas)  : {}
    usuarios = uSnap.exists()  ? (uSnap.val()  as RawUsuarios) : {}
    config   = cSnap.exists()  ? (cSnap.val()  as MasterConfig): {}
    agendaConfig = aSnap.exists() ? (aSnap.val() as AgendaConfig) : {}
  } catch {
    toast('Erro ao carregar dados do Firebase')
    return false
  }
  return true
}

function renderContent(): void {
  renderNavigation()
  const back = document.getElementById('mestreBack')
  if (back) back.innerHTML = activeTab === 'indice' ? '' : moduleBackButton()

  if      (activeTab === 'indice')   renderIndex()
  else if (activeTab === 'pessoas')  renderPessoas()
  else if (activeTab === 'usuarios') renderUsuarios()
  else if (activeTab === 'config')   renderConfig()
  else if (activeTab === 'vinculos') renderVinculos()
  else if (activeTab === 'dados')     renderDados()
  else                               renderSaude()

}
function renderNavigation(): void {
  const host = document.getElementById('mestreNav')
  if (host) renderWorkspaceNav(host, 'Admin', 'pessoas', activeTab, [
    { id:'pessoas', label:'Pessoas' }, { id:'usuarios', label:'Acessos' },
    { id:'config', label:'Administração', children:[
      { id:'config', label:'Configurações' }, { id:'vinculos', label:'Vínculos' }, { id:'dados', label:'Backup' }, { id:'saude', label:'Saúde e PDFs' },
    ] },
  ], id => { void switchTab(id as typeof activeTab) })
}
async function loadPublicRoot(): Promise<Record<string, unknown>> {
  const entries = await Promise.all([
    ['master', masterRef], ['usuarios', usuariosRef], ['tarefas', tarefasRef],
    ['limpeza', limpezaRef], ['escala', escalaRef],
    ['servicoCampo', servicoCampoRef],
    ['agendaConfig', agendaConfigRef], ['agendaDocuments', agendaDocumentsRef],
  ].map(async ([key, reference]) => {
    const snapshot = await get(reference as typeof rootRef)
    return [key, snapshot.exists() ? snapshot.val() as unknown : null] as const
  }))
  const values = Object.fromEntries(entries)
  return {
    master:values['master'], usuarios:values['usuarios'], tarefas:values['tarefas'],
    limpeza:values['limpeza'], escala:values['escala'],
    servicoCampo:values['servicoCampo'],
    agenda:{ config:values['agendaConfig'], documentos:values['agendaDocuments'] },
  }
}

function renderIndex(): void {
  const content = document.getElementById('mestreContent')
  if (!content) return
  content.innerHTML = '<div style="margin-bottom:14px"><h2 style="font-size:1.05rem;color:var(--blue-deep);margin-bottom:2px">Admin</h2></div><div id="mestreMenu"></div>'
  const items: ItemMenu[] = [
    { id: 'pessoas', titulo: 'Pessoas', subtitulo: 'Cadastros e dados da congregação', icone: '♙', corFundo: '#003F72' },
    { id: 'usuarios', titulo: 'Usuários', subtitulo: 'Acessos e módulos disponíveis', icone: '⚿', corFundo: '#006EB6' },
    { id: 'config', titulo: 'Configuração', subtitulo: 'Congregação, agenda e PDFs', icone: '⚙', corFundo: '#5C6062' },
    { id: 'vinculos', titulo: 'Vínculos', subtitulo: 'IDs compartilhados entre os módulos', icone: '⌁', corFundo: '#1A6B3C' },
    { id: 'dados', titulo: 'Dados', subtitulo: 'Backup completo e restauração', icone: '▤', corFundo: '#B3261E' },
    { id: 'saude', titulo: 'Saúde e PDFs', subtitulo: 'Estado dos serviços e limpeza protegida', icone: '◉', corFundo: '#376A8C' },
  ]
  renderMenuCards(content.querySelector<HTMLElement>('#mestreMenu')!, items, id => { void switchTab(id as typeof activeTab) })
}

interface LinkIssue {
  module: string
  id: string
  kind: 'sem_vinculo' | 'orfao' | 'duplicado'
  detail: string
}

interface LinkReportItem {
  issue: LinkIssue
  path: string
  record: unknown
}

function linkCollections(data: Record<string, unknown>) {
  const tarefas = objectValue(data['tarefas'])
  const escala = objectValue(data['escala'])
  const servicoCampo = objectValue(data['servicoCampo'])

  return {
    tarefas: records(tarefas['people']),
    escala: records(escala['participants']),
    servicoCampo: Object.fromEntries(
      Object.entries(objectValue(servicoCampo['leaders'])).map(([masterId, active]) => [masterId, { masterId, active }]),
    ),
    usuarios: records(data['usuarios']),
  }
}

function collectDirectLinkIssues(
  module: string,
  collection: Record<string, Record<string, unknown>>,
  required: (item: Record<string, unknown>) => boolean = () => true,
): LinkIssue[] {
  const issues: LinkIssue[] = []
  const byMaster = new Map<string, string[]>()

  Object.entries(collection).forEach(([id, item]) => {
    if (!required(item)) return
    const masterId = typeof item['masterId'] === 'string' ? item['masterId'].trim() : ''
    if (!masterId) {
      issues.push({ module, id, kind: 'sem_vinculo', detail: 'Sem masterId' })
      return
    }
    if (!pessoas[masterId]) {
      issues.push({ module, id, kind: 'orfao', detail: `masterId inexistente: ${masterId}` })
      return
    }
    const ids = byMaster.get(masterId) ?? []
    ids.push(id)
    byMaster.set(masterId, ids)
  })

  byMaster.forEach((ids, masterId) => {
    if (ids.length < 2) return
    ids.forEach(id => issues.push({
      module,
      id,
      kind: 'duplicado',
      detail: `${masterId} também está ligado a ${ids.filter(other => other !== id).join(', ')}`,
    }))
  })
  return issues
}

function collectLinkIssues(data: Record<string, unknown>): LinkIssue[] {
  const collections = linkCollections(data)
  const issues = [
    ...collectDirectLinkIssues('Tarefas', collections.tarefas, item => item['active'] !== false),
    ...collectDirectLinkIssues('Escala', collections.escala, item => item['active'] !== false),
    ...collectDirectLinkIssues('Serviço de Campo', collections.servicoCampo, item => item['active'] === true),
    ...collectDirectLinkIssues('Usuários', collections.usuarios, item => item['ativo'] === true),
  ]

  const servicoCampo = objectValue(data['servicoCampo'])
  Object.entries(records(servicoCampo['periods'])).forEach(([periodId, period]) => {
    Object.entries(records(period['assignments'])).forEach(([assignmentId, assignment]) => {
      const leaderId = typeof assignment['leaderId'] === 'string' ? assignment['leaderId'].trim() : ''
      if (leaderId && !pessoas[leaderId]) {
        issues.push({
          module: 'Serviço de Campo',
          id: `${periodId}/${assignmentId}`,
          kind: 'orfao',
          detail: `Dirigente inexistente no cadastro mestre: ${leaderId}`,
        })
      }
    })
  })

  return issues.sort((a, b) => a.module.localeCompare(b.module, 'pt-BR') || a.id.localeCompare(b.id))
}

function linkIssueRecord(data: Record<string, unknown>, issue: LinkIssue): LinkReportItem {
  return { issue, ...linkIssueSource(data, issue.module, issue.id) }
}

function linkFailureReport(data: Record<string, unknown>, issues: LinkIssue[], configIssues: GlobalConfigIssue[]): string {
  const generatedAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Fortaleza' }).format(new Date())
  const entries = issues.map(issue => linkIssueRecord(data, issue))
  const rows = entries.length ? entries.flatMap((entry, index) => [`### ${index + 1}. ${entry.issue.module} - ${entry.issue.kind.replace(/_/g, ' ')}`, `- Caminho: \`${entry.path}\``, `- ID do registro: \`${entry.issue.id}\``, `- Detalhe: ${entry.issue.detail}`, '- Registro atual:', '```json', JSON.stringify(sanitizeFailureReportValue(entry.record), null, 2), '```', '']) : ['Nenhuma falha de vínculo encontrada.', '']
  const configRows = configIssues.length ? configIssues.flatMap((item, index) => [`### ${index + 1}. ${item.title}`, `- Detalhe: ${item.detail}`, '- Área para revisão: `agenda/config`', '']) : ['Nenhuma falha de configuração encontrada.', '']
  return ['# Relatório de falhas de vínculos', '', `Gerado em: ${generatedAt} (America/Fortaleza)`, `Total de falhas de vínculo: ${entries.length}`, `Falhas de configuração: ${configIssues.length}`, '', 'Este relatório omite senha, telefone e WhatsApp. Revise toda sugestão antes de alterar dados no Firebase.', '', '## Falhas de vínculo', '', ...rows, '## Falhas de configuração', '', ...configRows].join('\n')
}

function openLinkFailureReport(data: Record<string, unknown>, issues: LinkIssue[], configIssues: GlobalConfigIssue[]): void {
  const report = linkFailureReport(data, issues, configIssues), overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal" style="max-width:720px"><h2>Relatório de falhas</h2><textarea id="linkFailureReport" class="form-input" rows="18" readonly style="font-family:monospace;font-size:.76rem">${escapeHtml(report)}</textarea><div class="admin-report-actions"><button id="copyLinkFailureReport" class="btn btn-ghost" type="button">Copiar</button><button id="downloadLinkFailureReport" class="btn btn-primary" type="button">Baixar .md</button><button id="closeLinkFailureReport" class="btn btn-ghost" type="button">Fechar</button></div></div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  document.getElementById('closeLinkFailureReport')?.addEventListener('click', close)
  document.getElementById('copyLinkFailureReport')?.addEventListener('click', () => void navigator.clipboard.writeText(report).then(() => toast('Relatório copiado')).catch(() => toast('Não foi possível copiar o relatório')))
  document.getElementById('downloadLinkFailureReport')?.addEventListener('click', () => {
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' }), url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = `falhas-vinculos-${new Date().toISOString().slice(0, 10)}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}

function renderVinculos(): void {
  const mc = document.getElementById('mestreContent')!
  if (rootLoadError) {
    mc.innerHTML = `<div style="padding:18px;border:1px solid #E6B8B5;background:#FFF4F3;border-radius:8px;color:#B3261E;font-size:.84rem">${escapeHtml(rootLoadError)}<br><button id="btnRetryRoot" class="btn btn-ghost" type="button" style="margin-top:10px">Tentar novamente</button></div>`
    document.getElementById('btnRetryRoot')?.addEventListener('click', () => void loadRootData(true))
    return
  }
  if (rootLoading || !rootData) {
    mc.innerHTML = '<p style="padding:24px;color:var(--ink-3);text-align:center">Verificando vínculos...</p>'
    return
  }

  const auditRoot=rootData
  queueMicrotask(async()=>{
    const panel=document.createElement('section');panel.className='form-panel';panel.dataset.integrationAudit=''
    mc.prepend(panel);panel.textContent='Conferindo integração dos módulos…'
    try {
      const rows=await auditIntegrations(auditRoot)
      if(!panel.isConnected)return
      panel.innerHTML='<h3>Integração dos módulos</h3><p>'+rows.length+' ponto(s) para conferir</p>'+[...new Set(rows.map(item=>item.module))].map(module=>'<details><summary>'+escapeHtml(module)+' · '+rows.filter(item=>item.module===module).length+' ponto(s)</summary>'+rows.filter(item=>item.module===module).map(item=>'<article class="notice"><strong>'+escapeHtml(item.id)+'</strong><p>'+escapeHtml(item.detail)+'</p></article>').join('')+'<button type="button" class="btn btn-ghost" data-audit-module="'+module+'">Abrir módulo</button></details>').join('')
      panel.querySelectorAll<HTMLButtonElement>('[data-audit-module]').forEach(button=>button.addEventListener('click',()=>void navigateTo(button.dataset.auditModule as ModuleName)))
    }catch{panel.textContent='Não foi possível concluir a auditoria. Use Atualizar para tentar novamente.'}
  })
  const issues = collectLinkIssues(rootData)
  const qualityIssues = auditMasterQuality(pessoas, usuarios)
  const configIssues = collectAgendaConfigIssues()
  const orphanCount = issues.filter(item => item.kind === 'orfao').length
  const missingCount = issues.filter(item => item.kind === 'sem_vinculo').length
  const duplicateCount = issues.filter(item => item.kind === 'duplicado').length
  const labels: Record<LinkIssue['kind'], string> = {
    sem_vinculo: 'Sem vínculo',
    orfao: 'ID órfão',
    duplicado: 'Vínculo duplicado',
  }

  mc.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:12px">
      <div style="font-size:.8rem;color:var(--ink-3)">${issues.length ? `${issues.length} ${issues.length === 1 ? 'item' : 'itens'} para revisar` : 'Todos os vínculos estão consistentes'}</div>
      <div style="display:flex;gap:8px"><button id="btnExportLinkFailures" class="btn btn-primary" type="button">Relatório</button><button id="btnRefreshLinks" class="btn btn-ghost" type="button">Atualizar</button></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      ${linkMetric('Sem vínculo', missingCount, '#C8922A')}
      ${linkMetric('IDs órfãos', orphanCount, '#B3261E')}
      ${linkMetric('Duplicados', duplicateCount, '#7E3AF2')}
    </div>
    <details class="form-panel" style="margin-bottom:14px"><summary><strong>Qualidade dos cadastros</strong> · ${qualityIssues.length} ponto(s) para revisar</summary><div class="agenda-board-body">${qualityIssues.map(item => `<article class="notice"><strong>${escapeHtml(item.id)} · ${escapeHtml(item.kind)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join('') || '<p class="notice">Nenhum problema de cadastro detectado.</p>'}<p class="notice">A auditoria é somente leitura. Confirme cada caso antes de editar.</p></div></details>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${configIssues.map(item => `
        <div style="border:1px solid #C8922A;border-left:4px solid #C8922A;border-radius:8px;padding:10px 12px;background:#FFF9E8">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <strong style="font-size:.84rem">${escapeHtml(item.title)}</strong>
            <span style="font-size:.7rem;font-weight:700;color:#8A6200">Configuração</span>
          </div>
          <div style="font-size:.76rem;color:var(--ink-3);margin-top:3px">${escapeHtml(item.detail)}</div>
          <div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-ghost" type="button" data-open-agenda-config="${item.id}" style="font-size:.76rem;padding:4px 9px">Abrir Agenda</button></div>
        </div>`).join('')}
      ${issues.length ? issues.map(item => {
        const target = moduleForLinkIssue(item.module)
        const label = item.module === 'Usuários' ? 'Abrir usuários' : target ? `Abrir ${item.module}` : ''
        return `
        <div style="border:1px solid var(--border);border-left:4px solid ${item.kind === 'orfao' ? '#B3261E' : item.kind === 'duplicado' ? '#7E3AF2' : '#C8922A'};border-radius:8px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <strong style="font-size:.84rem">${escapeHtml(item.module)}</strong>
            <span style="font-size:.7rem;font-weight:700;color:var(--ink-3)">${labels[item.kind]}</span>
          </div>
          <div style="font-family:monospace;font-size:.72rem;margin-top:4px;overflow-wrap:anywhere">${escapeHtml(item.id)}</div>
          <div style="font-size:.76rem;color:var(--ink-3);margin-top:3px">${escapeHtml(item.detail)}</div>
          ${label ? `<div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn btn-ghost" type="button" data-resolve-link-module="${escapeHtml(item.module)}" data-resolve-link-id="${escapeHtml(item.id)}" style="font-size:.76rem;padding:4px 9px">${escapeHtml(label)}</button></div>` : ''}
        </div>`
      }).join('') : configIssues.length ? '' : '<div style="padding:18px;border:1px solid #B7DEC7;background:#F1FAF4;border-radius:8px;color:#1A6B3C;font-size:.84rem">Nenhum vínculo ausente, órfão ou duplicado.</div>'}
    </div>`

  document.getElementById('btnRefreshLinks')?.addEventListener('click', () => void loadRootData(true))
  document.getElementById('btnExportLinkFailures')?.addEventListener('click', () => openLinkFailureReport(rootData!, issues, configIssues))
  document.querySelectorAll<HTMLButtonElement>('[data-open-agenda-config]').forEach(button => button.addEventListener('click', resolveAgendaConfigIssue))
  document.querySelectorAll<HTMLButtonElement>('[data-resolve-link-module]').forEach(button => {
    button.addEventListener('click', () => {
      const module = button.dataset['resolveLinkModule'] ?? ''
      const id = button.dataset['resolveLinkId'] ?? ''
      const item = issues.find(candidate => candidate.module === module && candidate.id === id)
      if (item) resolveLinkIssue(item)
    })
  })
}

function linkMetric(label: string, value: number, color: string): string {
  return `<div style="border:1px solid var(--border);border-radius:8px;padding:10px;background:var(--surface)"><div style="font-size:1.1rem;font-weight:800;color:${color}">${value}</div><div style="font-size:.68rem;color:var(--ink-3);margin-top:3px">${label}</div></div>`
}

function hasActiveAdmin(candidate: RawUsuarios): boolean {
  return Object.values(candidate).some(user => user.ativo && user.apps?.mestre === true)
}

function backupFileName(prefix = 'noroeste-backup'): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
}

function downloadBackup(data: Record<string, unknown>, prefix?: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = backupFileName(prefix)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function loadPdfInventory():Promise<void> {
  if(pdfInventoryLoading)return
  pdfInventoryLoading=true;pdfInventoryError='';renderSaude()
  try {pdfInventory=await apiJson<PdfInventory>('pdf-maintenance')}
  catch(error){pdfInventory=null;pdfInventoryError=error instanceof Error?error.message:'Não foi possível verificar os serviços.'}
  finally {pdfInventoryLoading=false;if(activeTab==='saude')renderSaude()}
}
function backupCheckLabel():string {
  try {
    const item=JSON.parse(localStorage.getItem(BACKUP_CHECK_KEY)??'null') as {at?:string;bytes?:number;hash?:string}|null
    return item?.at&&item.hash?`Última conferência neste aparelho: ${new Date(item.at).toLocaleString('pt-BR')} · ${item.bytes} bytes · SHA-256 ${item.hash.slice(0,12)}…`:'Nenhum backup conferido neste aparelho.'
  }catch{return 'Nenhum backup conferido neste aparelho.'}
}
async function verifyBackupFile(file:File):Promise<void> {
  if(file.size>20*1024*1024){toast('Arquivo maior que 20 MB.');return}
  try {
    const bytes=await file.arrayBuffer()
    const validation=validateBackup(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
    if(!validation.ok){toast(validation.error,5000);return}
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('')
    localStorage.setItem(BACKUP_CHECK_KEY,JSON.stringify({at:new Date().toISOString(),bytes:file.size,hash}))
    toast('Backup conferido; nenhum dado foi restaurado.');renderSaude()
  }catch{toast('Não foi possível conferir o arquivo JSON.',5000)}
}
function renderSaude():void {
  const mc=document.getElementById('mestreContent');if(!mc)return
  if(!pdfInventory&&!pdfInventoryLoading&&!pdfInventoryError){void loadPdfInventory();return}
  const eligible=pdfInventory?.files.filter(item=>item.status==='elegivel')??[]
  const count=(status:PdfInventoryFile['status'])=>pdfInventory?.files.filter(item=>item.status===status).length??0
  mc.innerHTML=`<section class="form-panel"><h3>Saúde do sistema</h3><p class="notice">${pdfInventoryLoading?'Conferindo serviços…':pdfInventoryError?escapeHtml(pdfInventoryError):`Banco: ${escapeHtml(pdfInventory?.health.database)} · PDFs: ${escapeHtml(pdfInventory?.health.storage)} · Versão: ${escapeHtml(pdfInventory?.health.version)} · conferido em ${escapeHtml(new Date(pdfInventory!.checkedAt).toLocaleString('pt-BR'))}`}</p><button id="refreshPdfInventory" class="btn btn-ghost" type="button">Conferir novamente</button></section>
    <section class="form-panel"><h3>Verificação de backup</h3><p class="notice">${escapeHtml(backupCheckLabel())}</p><p>Selecione um backup para validar estrutura e SHA-256 sem restaurar dados. A informação fica somente neste aparelho.</p><input id="verifyBackupFile" class="form-input" type="file" accept="application/json,.json" aria-label="Selecionar backup para conferência"></section>
    <section class="form-panel"><h3>Inventário de PDFs</h3><p class="notice">${count('ativo')} ativos · ${count('retido')} em retenção · ${count('elegivel')} elegíveis · ${count('desconhecido')} com idade desconhecida. Prazo padrão: ${pdfInventory?.retentionDays ?? 60} dias. Arquivos ativos ou de idade desconhecida não entram na limpeza manual.</p>
    ${pdfInventory?.files.map(item=>`<label class="pdf-inventory-row"><span>${item.status==='elegivel'?`<input type="checkbox" data-pdf-clean="${escapeHtml(item.path)}">`:''}<strong>${escapeHtml(item.status)}</strong> ${escapeHtml(item.path)}<small>${item.createdAt?escapeHtml(new Date(item.createdAt).toLocaleDateString('pt-BR')):'Data desconhecida'}${item.bytes?` · ${item.bytes} bytes`:''}</small></span><a class="btn btn-ghost" target="_blank" rel="noopener" href="/.netlify/functions/storage-file?path=${encodeURIComponent(item.path)}">Visualizar</a></label>`).join('')??''}
    ${eligible.length?'<p>Selecione até 20 PDFs elegíveis, visualize-os e digite EXCLUIR PDFs para confirmar. O servidor confere as referências e a idade novamente.</p><input id="pdfDeletePhrase" class="form-input" placeholder="EXCLUIR PDFs" autocomplete="off"><button id="deleteSelectedPdfs" class="btn btn-danger" type="button">Excluir PDFs selecionados</button>':''}</section>`
  document.getElementById('refreshPdfInventory')?.addEventListener('click',()=>void loadPdfInventory())
  document.getElementById('verifyBackupFile')?.addEventListener('change',event=>{const file=(event.currentTarget as HTMLInputElement).files?.[0];if(file)void verifyBackupFile(file)})
  document.getElementById('deleteSelectedPdfs')?.addEventListener('click',()=>void cleanupSelectedPdfs())
}
async function cleanupSelectedPdfs():Promise<void> {
  const paths=[...document.querySelectorAll<HTMLInputElement>('[data-pdf-clean]:checked')].map(input=>input.dataset['pdfClean']??'').filter(Boolean)
  const phrase=(document.getElementById('pdfDeletePhrase') as HTMLInputElement|null)?.value
  if(!paths.length||paths.length>20||phrase!=='EXCLUIR PDFs'){toast('Selecione até 20 arquivos e digite EXCLUIR PDFs.');return}
  if(!confirm(`Excluir permanentemente ${paths.length} PDF(s) elegível(is)?`))return
  const button=document.getElementById('deleteSelectedPdfs') as HTMLButtonElement|null
  if(button)button.disabled=true
  try {
    const result=await apiJson<{deleted:string[];skipped:{path:string;reason:string}[]}>('pdf-maintenance',{method:'POST',body:JSON.stringify({paths,confirm:phrase})})
    toast(`${result.deleted.length} excluído(s); ${result.skipped.length} preservado(s).`,5000)
    await loadPdfInventory()
  }catch(error){toast(error instanceof Error?error.message:'Não foi possível concluir a limpeza.',5000);if(button)button.disabled=false}
}

function renderDados(): void {
  const mc = document.getElementById('mestreContent')!
  if (rootLoadError) {
    mc.innerHTML = `<div style="padding:18px;border:1px solid #E6B8B5;background:#FFF4F3;border-radius:8px;color:#B3261E;font-size:.84rem">${escapeHtml(rootLoadError)}<br><button id="btnRetryRoot" class="btn btn-ghost" type="button" style="margin-top:10px">Tentar novamente</button></div>`
    document.getElementById('btnRetryRoot')?.addEventListener('click', () => void loadRootData(true))
    return
  }
  if (rootLoading || !rootData) {
    mc.innerHTML = '<p style="padding:24px;color:var(--ink-3);text-align:center">Carregando dados...</p>'
    return
  }

  const validated = restoreCandidate ? validateBackup(restoreCandidate) : null
  mc.innerHTML = `
    <section style="padding-bottom:18px;border-bottom:1px solid var(--border);margin-bottom:18px">
      <h3 style="font-size:.95rem;margin:0 0 6px;color:var(--blue-deep)">Backup completo</h3>
      <p style="font-size:.8rem;color:var(--ink-3);margin:0 0 12px">Baixa uma cópia de todos os módulos e configurações.</p>
      <button id="btnDownloadBackup" class="btn btn-primary" type="button">Baixar backup</button>
    </section>
    <section>
      <h3 style="font-size:.95rem;margin:0 0 6px;color:var(--blue-deep)">Restaurar backup</h3>
      <p style="font-size:.8rem;color:var(--ink-3);margin:0 0 12px">A restauração substitui todos os dados atuais. Um backup de segurança será baixado antes da troca.</p>
      <label class="form-label" for="restoreFile">Arquivo JSON</label>
      <input id="restoreFile" class="form-input" type="file" accept="application/json,.json">
      ${validated?.ok ? `
        <div style="margin-top:10px;padding:10px 12px;border:1px solid #B7DEC7;background:#F1FAF4;border-radius:8px;font-size:.78rem;color:#1A6B3C">
          <strong>${escapeHtml(restoreFileName)}</strong><br>
          ${validated.summary.pessoas} pessoas, ${validated.summary.usuarios} usuários e ${validated.summary.modulos} áreas na raiz.
        </div>
        <div class="form-group" style="margin-top:12px">
          <label class="form-label" for="restorePhrase">Digite RESTAURAR para confirmar</label>
          <input id="restorePhrase" class="form-input" autocomplete="off" placeholder="RESTAURAR">
        </div>
        <button id="btnRestoreBackup" class="btn btn-danger" type="button" disabled>Restaurar todos os dados</button>` : ''}
    </section>`

  document.getElementById('btnDownloadBackup')?.addEventListener('click', () => downloadBackup(rootData!))
  document.getElementById('restoreFile')?.addEventListener('change', event => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0]
    if (file) void readRestoreFile(file)
  })
  const phrase = document.getElementById('restorePhrase') as HTMLInputElement | null
  const restoreButton = document.getElementById('btnRestoreBackup') as HTMLButtonElement | null
  phrase?.addEventListener('input', () => { if (restoreButton) restoreButton.disabled = phrase.value !== 'RESTAURAR' })
  restoreButton?.addEventListener('click', () => void restoreBackup())
}

async function readRestoreFile(file: File): Promise<void> {
  if (file.size > 20 * 1024 * 1024) {
    restoreCandidate = null
    restoreFileName = ''
    toast('O arquivo ultrapassa o limite de 20 MB')
    renderDados()
    return
  }
  try {
    const parsed = JSON.parse(await file.text()) as unknown
    const validation = validateBackup(parsed)
    if (!validation.ok) {
      restoreCandidate = null
      restoreFileName = ''
      toast(validation.error, 5000)
      renderDados()
      return
    }
    restoreCandidate = validation.data
    restoreFileName = file.name
    renderDados()
  } catch {
    restoreCandidate = null
    restoreFileName = ''
    toast('Não foi possível ler este arquivo JSON')
    renderDados()
  }
}

async function restoreBackup(): Promise<void> {
  if (!restoreCandidate || !rootData) return
  const phrase = document.getElementById('restorePhrase') as HTMLInputElement | null
  if (phrase?.value !== 'RESTAURAR') return
  if (!confirm('Restaurar este backup e substituir todos os dados atuais?')) return

  const button = document.getElementById('btnRestoreBackup') as HTMLButtonElement | null
  if (button) { button.disabled = true; button.textContent = 'Restaurando...' }
  try {
    downloadBackup(rootData, 'noroeste-antes-da-restauracao')
    const agenda = objectValue(restoreCandidate['agenda'])
    await update(rootRef, {
      master:restoreCandidate['master'] ?? null,
      usuarios:restoreCandidate['usuarios'] ?? null,
      tarefas:restoreCandidate['tarefas'] ?? null,
      limpeza:restoreCandidate['limpeza'] ?? null,
      escala:restoreCandidate['escala'] ?? null,
      servicoCampo:restoreCandidate['servicoCampo'] ?? null,
      'agenda/config':agenda['config'] ?? null,
      'agenda/documentos':agenda['documentos'] ?? null,
      'agenda/assinaturas':null,
    })
    restoreCandidate = null
    restoreFileName = ''
    rootData = null
    await loadAll()
    activeTab = 'dados'
    await loadRootData(true)
    toast('Backup restaurado com sucesso')
  } catch {
    toast('A restauração falhou; os dados atuais foram preservados', 5000)
    if (button) { button.disabled = false; button.textContent = 'Restaurar todos os dados' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA: PESSOAS
// ─────────────────────────────────────────────────────────────────────────────

function renderPessoas(): void {
  const mc = document.getElementById('mestreContent')!

  const filtered = Object.entries(pessoas).filter(([, p]) => {
    if (pessoaFilter.ativo === 'true'  && !p.active) return false
    if (pessoaFilter.ativo === 'false' &&  p.active) return false
    if (pessoaFilter.role  && p.role !== pessoaFilter.role) return false
    if (pessoaFilter.sex   && p.sex  !== pessoaFilter.sex)  return false
    if (pessoaFilter.nome  && !p.name.toLowerCase().includes(pessoaFilter.nome.toLowerCase())) return false
    return true
  }).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pt-BR'))
  if(!filtered.some(([id])=>id===selectedMasterPersonId))selectedMasterPersonId=filtered[0]?.[0]??''

  mc.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
      <input id="pFiltroNome" aria-label="Buscar pessoa pelo nome" class="form-input" placeholder="Buscar nome…"
        value="${escapeHtml(pessoaFilter.nome)}" style="flex:2;min-width:120px">
      <details class="people-filters" ${pessoaFilter.role || pessoaFilter.sex || pessoaFilter.ativo !== 'true' ? 'open' : ''}><summary>Filtros de pessoas</summary><div class="people-filter-fields"><select id="pFiltroRole" aria-label="Função" class="form-select" style="flex:2;min-width:120px">
        <option value="">Todas funções</option>
        <option value="anciao">Ancião</option>
        <option value="servo-ministerial">Servo ministerial</option>
        <option value="pioneiro">Pioneiro</option>
        <option value="batizado">Batizado</option>
        <option value="publicador">Publicador</option>
      </select>
      <select id="pFiltroSex" aria-label="Sexo" class="form-select" style="flex:1;min-width:90px">
        <option value="">M + F</option>
        <option value="M">Irmãos</option>
        <option value="F">Irmãs</option>
      </select>
      <select id="pFiltroAtivo" aria-label="Situação da pessoa" class="form-select" style="flex:1;min-width:90px">
        <option value="true">Ativos</option>
        <option value="false">Inativos</option>
        <option value="">Todos</option>
      </select>${pessoaFilter.nome||pessoaFilter.role||pessoaFilter.sex||pessoaFilter.ativo!=='true'?'<button id="clearPersonFilters" class="btn btn-ghost" type="button">Limpar filtros</button>':''}</div></details>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:.8rem;color:var(--ink-3)">
        ${filtered.length} pessoa${filtered.length !== 1 ? 's' : ''}
        · Total: ${Object.keys(pessoas).length}
      </span>
      <button id="btnAddPessoa" class="btn btn-primary" style="padding:5px 12px;font-size:.82rem">
        + Adicionar
      </button>
    </div>
    <div id="pessoaList">
      ${filtered.length
        ? filtered.map(([mid, p]) => pessoaCard(mid, p)).join('')
        : '<p style="color:var(--ink-3);text-align:center;padding:24px 0">Nenhuma pessoa encontrada.</p>'}
    </div>`

  ;(document.getElementById('pFiltroRole')  as HTMLSelectElement).value = pessoaFilter.role
  ;(document.getElementById('pFiltroSex')   as HTMLSelectElement).value = pessoaFilter.sex
  ;(document.getElementById('pFiltroAtivo') as HTMLSelectElement).value = pessoaFilter.ativo

  document.getElementById('pFiltroNome')!.addEventListener('input', e => {
    pessoaFilter.nome = (e.target as HTMLInputElement).value
    renderPessoas()
  })
  document.getElementById('pFiltroRole')!.addEventListener('change', e => {
    pessoaFilter.role = (e.target as HTMLSelectElement).value
    renderPessoas()
  })
  document.getElementById('pFiltroSex')!.addEventListener('change', e => {
    pessoaFilter.sex = (e.target as HTMLSelectElement).value
    renderPessoas()
  })
  document.getElementById('pFiltroAtivo')!.addEventListener('change', e => {
    pessoaFilter.ativo = (e.target as HTMLSelectElement).value
    renderPessoas()
  })
  document.getElementById('clearPersonFilters')?.addEventListener('click',()=>{pessoaFilter={nome:'',role:'',ativo:'true',sex:''};renderPessoas()})
  document.getElementById('btnAddPessoa')!
    .addEventListener('click', () => openPessoaModal(null))

  document.querySelectorAll<HTMLButtonElement>('[data-edit-pessoa]').forEach(btn => {
    btn.addEventListener('click', () => openPessoaModal(btn.dataset['editPessoa']!))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-del-pessoa]').forEach(btn => {
    btn.addEventListener('click', () => void deletePessoa(btn.dataset['delPessoa']!))
  })
}

function pessoaCard(mid: string, p: MasterPessoa): string {
  const badge = p.active
    ? `<span style="background:#E3F5EB;color:#1A6B3C;padding:1px 7px;border-radius:10px;font-size:.7rem;font-weight:600">Ativo</span>`
    : `<span style="background:#FEE;color:#B3261E;padding:1px 7px;border-radius:10px;font-size:.7rem;font-weight:600">Inativo</span>`
  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
      padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--blue-light);
        display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;
        color:var(--blue-deep);flex-shrink:0">
        ${escapeHtml(p.name.charAt(0).toUpperCase())}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          ${escapeHtml(p.name)}
        </div>
        <div style="font-size:.75rem;color:var(--ink-3);display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:1px">
          <span>${roleLabel(p.role)}</span>
          <span>${sexLabel(p.sex)}</span>
          ${badge}
          ${p.limpeza?.grupo ? `<span>G${p.limpeza.grupo}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-ghost" data-edit-pessoa="${escapeHtml(mid)}"
        style="padding:4px 10px;font-size:.78rem;flex-shrink:0">Editar</button>
      <button class="btn btn-danger" data-del-pessoa="${escapeHtml(mid)}" aria-label="Remover ${escapeHtml(p.name)}"
        style="padding:4px 8px;font-size:.78rem;flex-shrink:0">Remover</button>
    </div>`
}

function openPessoaModal(mid: string | null): void {
  const p = mid ? pessoas[mid] : null

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal">
      <h2>${mid ? 'Editar Pessoa' : 'Nova Pessoa'}</h2>
      <div class="form-group">
        <label class="form-label">Nome *</label>
        <input id="pNome" class="form-input" value="${escapeHtml(p?.name)}" placeholder="Nome">
      </div>
      <div class="form-group">
        <label class="form-label">WhatsApp
          <span style="color:var(--ink-3);font-weight:400;text-transform:none"> — 55 + DDD + número</span>
        </label>
        <input id="pWpp" class="form-input" value="${escapeHtml(p?.whatsapp)}"
          placeholder="5579999999999" inputmode="numeric">
        <p id="pSharedWhatsapp" class="form-help" style="margin:6px 0 0"></p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Sexo</label>
          <select id="pSex" class="form-select">
            <option value="">—</option>
            <option value="M" ${p?.sex === 'M' ? 'selected' : ''}>Masculino</option>
            <option value="F" ${p?.sex === 'F' ? 'selected' : ''}>Feminino</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Função</label>
          <select id="pRole" class="form-select">
            <option value="">—</option>
            <option value="anciao"            ${p?.role === 'anciao'            ? 'selected' : ''}>Ancião</option>
            <option value="servo-ministerial" ${p?.role === 'servo-ministerial' ? 'selected' : ''}>Servo ministerial</option>
            <option value="pioneiro"          ${p?.role === 'pioneiro'          ? 'selected' : ''}>Pioneiro</option>
            <option value="batizado"          ${p?.role === 'batizado'          ? 'selected' : ''}>Batizado</option>
            <option value="publicador"        ${p?.role === 'publicador'        ? 'selected' : ''}>Publicador</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="pAtivo" ${(p?.active ?? true) ? 'checked' : ''}>
          <span class="form-label" style="margin:0">Ativo</span>
        </label>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button id="btnCancelPessoa" class="btn btn-ghost" style="flex:1">Cancelar</button>
        <button id="btnSalvarPessoa" class="btn btn-primary" style="flex:1">Salvar</button>
      </div>
    </div>`

  document.body.appendChild(overlay)
  fieldHelp(document,'#pWpp','Informe DDD e número, por exemplo 79 99999-9999. Este telefone é usado pelos módulos vinculados.')
  ;(document.getElementById('pNome') as HTMLInputElement).focus()

  const updateSharedWhatsapp = () => {
    const input = document.getElementById('pWpp') as HTMLInputElement
    const number = input.value.trim() ? normalizeWhatsapp(input.value) : ''
    const shared = sharedWhatsappPeople(pessoas, number, mid)
    const hint = document.getElementById('pSharedWhatsapp')!
    hint.textContent = shared.length ? `Contato compartilhado com: ${shared.map(([, person]) => person.name).join(', ')}. Isto é permitido.` : 'O WhatsApp é apenas um contato e pode ser compartilhado por familiares.'
  }
  document.getElementById('pWpp')?.addEventListener('input', updateSharedWhatsapp)
  updateSharedWhatsapp()

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  document.getElementById('btnCancelPessoa')!.addEventListener('click', () => overlay.remove())
  document.getElementById('btnSalvarPessoa')!
    .addEventListener('click', () => void savePessoa(mid, overlay))
}

async function savePessoa(mid: string | null, overlay: HTMLElement): Promise<void> {
  const name    = (document.getElementById('pNome')  as HTMLInputElement).value.trim()
  const wppRaw  = (document.getElementById('pWpp')   as HTMLInputElement).value.trim()
  const sexVal  = (document.getElementById('pSex')   as HTMLSelectElement).value
  const roleVal = (document.getElementById('pRole')  as HTMLSelectElement).value
  const ativo   = (document.getElementById('pAtivo') as HTMLInputElement).checked

  if (!name) { toast('Preencha o nome'); return }

  const wpp = wppRaw ? normalizeWhatsapp(wppRaw) : ''
  if (wpp && wpp.length < 12) { toast('WhatsApp inválido — mínimo 12 dígitos'); return }

  // A identidade é permanente e independente do telefone, que pode ser compartilhado.
  const finalMid = mid ?? createMasterId()
  const existing = mid ? pessoas[mid] : undefined

  const pessoa: MasterPessoa = {
    name,
    whatsapp: wpp,
    sex:     (sexVal  as Sex  | '') ? (sexVal  as Sex)  : null,
    role:    (roleVal as Role | '') ? (roleVal as Role) : null,
    active:  ativo,
    limpeza: existing?.limpeza ?? { grupo: null },
  }

  const release=editorBusy(overlay)
  setLoading('btnSalvarPessoa', true)
  try {
    if (existing) {
      const patch: Record<string, unknown> = {
        [`master/pessoas/${finalMid}/name`]:pessoa.name,
        [`master/pessoas/${finalMid}/whatsapp`]:pessoa.whatsapp,
        [`master/pessoas/${finalMid}/sex`]:pessoa.sex,
        [`master/pessoas/${finalMid}/role`]:pessoa.role,
        [`master/pessoas/${finalMid}/active`]:pessoa.active,
        [`master/pessoas/${finalMid}/limpeza`]:pessoa.limpeza,
      }
      Object.entries(usuarios).forEach(([uid, user]) => {
        if (user.masterId === finalMid) patch[`usuarios/${uid}/nome`] = pessoa.name
      })
      await update(rootRef, patch)
      Object.values(usuarios).forEach(user => { if (user.masterId === finalMid) user.nome = pessoa.name })
    } else await set(pessoaRef(finalMid), pessoa)
    pessoas[finalMid] = existing ? { ...existing, ...pessoa } : pessoa
    selectedMasterPersonId=finalMid
    rootData = null
    overlay.remove()
    toast(mid ? 'Pessoa atualizada ✓' : 'Pessoa adicionada ✓')
    renderPessoas()
  } catch {
    editorError(overlay)
    toast('Erro ao salvar — verifique a conexão')
    setLoading('btnSalvarPessoa', false)
  } finally { release() }
}

async function deletePessoa(mid: string): Promise<void> {
  const p = pessoas[mid]
  if (!p) return
  try {
    const freshRoot = await loadPublicRoot()
    const references = findMasterReferences(freshRoot, mid)
    if (references.length) {
      rootData = freshRoot
      activeTab = 'vinculos'
      renderContent()
      toast(`Não é possível remover: ${references.join(', ')}`, 5000)
      return
    }
  } catch {
    toast('Não foi possível verificar os vínculos. A pessoa não foi removida.', 5000)
    return
  }
  if (!confirm(`Remover "${p.name}" permanentemente? Esta ação não pode ser desfeita.`)) return
  try {
    await remove(pessoaRef(mid))
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete pessoas[mid]
    rootData = null
    toast('Pessoa removida')
    renderPessoas()
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Erro ao remover')
  }
}

function findMasterReferences(data: Record<string, unknown>, mid: string): string[] {
  const collections = linkCollections(data)
  const found = new Set<string>()
  const labels: Record<string, string> = {
    tarefas: 'Tarefas', escala: 'Escala TPL',
    servicoCampo: 'Serviço de Campo',
  }
  Object.entries(collections).forEach(([module, collection]) => {
    Object.values(collection).forEach(item => {
      if (item['masterId'] === mid) found.add(labels[module] ?? module)

    })
  })
  Object.values(records(data['usuarios'])).forEach(user => {
    if (user['masterId'] === mid) found.add('Usuários')
  })
  const servicoCampo = objectValue(data['servicoCampo'])
  Object.values(records(servicoCampo['periods'])).forEach(period => {
    Object.values(records(period['assignments'])).forEach(assignment => {
      if (assignment['leaderId'] === mid) found.add('Serviço de Campo')
    })
  })
  const limpeza = objectValue(objectValue(objectValue(data['master'])['config'])['limpeza'])
  Object.values(records(limpeza['gruposConfig'])).forEach(group => {
    if (group['superintendenteMid'] === mid || (Array.isArray(group['ajudantesMid']) && group['ajudantesMid'].includes(mid))) {
      found.add('Grupos de limpeza')
    }
  })
  masterIdReferencePaths(data, mid).forEach(path => {
    if (path.startsWith('usuarios/')) found.add('Usuários')
    else if (path.startsWith('tarefas/')) found.add('Tarefas')
    else if (path.startsWith('limpeza/')) found.add('Limpeza')
    else if (path.startsWith('escala/')) found.add('Escala TPL')
    else if (path.startsWith('servicoCampo/')) found.add('Serviço de Campo')
    else if (path.startsWith('agenda/')) found.add('Minha Agenda')
    else if (path.startsWith('master/config/limpeza/')) found.add('Grupos de limpeza')
    else if (!path.startsWith(`master/pessoas/${mid}/`)) found.add('Históricos ou configurações')
  })
  return [...found]
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA: USUÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

function renderUsuarios(): void {
  const mc = document.getElementById('mestreContent')!
  const list = Object.entries(usuarios)
    .filter(([,user])=>!usuarioFilter.nome||(user.nome+' '+(user.masterId??'')).toLocaleLowerCase('pt-BR').includes(usuarioFilter.nome.toLocaleLowerCase('pt-BR')))
    .filter(([,user])=>usuarioFilter.ativo===''||String(user.ativo)===usuarioFilter.ativo)
    .sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'))

  mc.innerHTML = `
    <div class="module-form-grid" style="margin-bottom:10px"><label class="form-field"><span>Buscar acesso</span><input id="usuarioSearch" class="form-input" type="search" value="${escapeHtml(usuarioFilter.nome)}" placeholder="Nome ou ID"></label><label class="form-field"><span>Situação</span><select id="usuarioStatus" class="form-select"><option value="" ${usuarioFilter.ativo===''?'selected':''}>Todos</option><option value="true" ${usuarioFilter.ativo==='true'?'selected':''}>Ativos</option><option value="false" ${usuarioFilter.ativo==='false'?'selected':''}>Inativos</option></select></label></div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:.8rem;color:var(--ink-3)">${list.length} acesso(s)</span>
      <button id="btnAddUsuario" class="btn btn-primary" style="padding:5px 12px;font-size:.82rem">
        + Adicionar
      </button>
    </div>
    <div id="usuarioList">
      ${list.length
        ? list.map(([uid, u]) => usuarioCard(uid, u)).join('')
        : '<p style="color:var(--ink-3);text-align:center;padding:24px 0">Nenhum usuário.</p>'}
    </div>`

  document.getElementById('btnAddUsuario')!
    .addEventListener('click', () => openUsuarioModal(null))
  document.getElementById('usuarioSearch')?.addEventListener('input',event=>{usuarioFilter.nome=(event.target as HTMLInputElement).value;renderUsuarios()})
  document.getElementById('usuarioStatus')?.addEventListener('change',event=>{usuarioFilter.ativo=(event.target as HTMLSelectElement).value;renderUsuarios()})
  document.querySelectorAll<HTMLButtonElement>('[data-edit-usuario]').forEach(btn => {
    btn.addEventListener('click', () => openUsuarioModal(btn.dataset['editUsuario']!))
  })
  document.querySelectorAll<HTMLButtonElement>('[data-del-usuario]').forEach(btn => {
    btn.addEventListener('click', () => void deleteUsuario(btn.dataset['delUsuario']!))
  })
}

function usuarioCard(uid: string, u: Usuario): string {
  const linkedName = u.masterId ? pessoas[u.masterId]?.name : ''
  const badge = u.ativo
    ? `<span style="background:#E3F5EB;color:#1A6B3C;padding:1px 7px;border-radius:10px;font-size:.7rem;font-weight:600">Ativo</span>`
    : `<span style="background:#FEE;color:#B3261E;padding:1px 7px;border-radius:10px;font-size:.7rem;font-weight:600">Inativo</span>`
  return `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;
      padding:10px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.9rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${escapeHtml(linkedName || u.nome)} ${badge}
        </div>
        <div style="font-size:.75rem;color:var(--ink-3);margin-top:2px">Pessoa: ${escapeHtml(u.masterId ? pessoas[u.masterId]?.name ?? 'Vínculo inválido' : 'Sem vínculo')}</div>
        <div style="font-size:.75rem;color:var(--ink-3);margin-top:2px">Apps: ${escapeHtml(appsList(u.apps))}</div>
        <div style="font-size:.7rem;color:var(--ink-3);margin-top:1px;font-family:monospace">${escapeHtml(uid)}</div>
      </div>
      <button class="btn btn-ghost" data-edit-usuario="${escapeHtml(uid)}"
        style="padding:4px 10px;font-size:.78rem;flex-shrink:0">Editar</button>
      <button class="btn btn-danger" data-del-usuario="${escapeHtml(uid)}" aria-label="Remover acesso de ${escapeHtml(linkedName || u.nome)}"
        style="padding:4px 8px;font-size:.78rem;flex-shrink:0">Remover</button>
    </div>`
}

function openUsuarioModal(uid: string | null): void {
  const u    = uid ? usuarios[uid] : undefined
  const identityLocked = Boolean(u?.masterId && pessoas[u.masterId])
  const apps = u?.apps ?? {
    mestre:false, tarefas:false, oradores:false, limpeza:false, escala:false,
    servicoCampo:false,
  }
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const personOptions = Object.entries(pessoas)
    .filter(([masterId, person]) => person.active !== false || masterId === u?.masterId)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR'))
    .map(([masterId, person]) => `<option value="${escapeHtml(masterId)}" ${u?.masterId === masterId ? 'selected' : ''}>${escapeHtml(person.name)}${person.active === false ? ' (inativa)' : ''}</option>`)
    .join('')
  overlay.innerHTML = `
    <div class="modal">
      <h2>${uid ? 'Editar Usuário' : 'Novo Usuário'}</h2>
      <div class="form-group">
        <label class="form-label" for="uMasterId">Pessoa vinculada *</label>
        <select id="uMasterId" class="form-select" ${identityLocked ? 'disabled' : ''}><option value="">Selecione uma pessoa</option>${personOptions}</select>
        <p class="form-help">${identityLocked ? 'A pessoa vinculada não pode ser trocada. Nome e telefone continuam vindo do cadastro Admin.' : 'Nome, telefone e identidade vêm do cadastro central de pessoas.'}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Senha *</label>
        <input id="uSenha" class="form-input" type="password"
          value="${escapeHtml(u?.senha)}" placeholder="Senha" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
          <input type="checkbox" id="uAtivo" ${(u?.ativo ?? true) ? 'checked' : ''}>
          <span class="form-label" style="margin:0">Ativo</span>
        </label>
      </div>
      <div class="form-group">
        <span class="form-label" style="display:block;margin-bottom:6px">Módulos</span>
        <div id="uAdminPermission">${appCheck('mestre', 'Admin', apps.mestre)}</div>
        ${appCheck('tarefas',     'Tarefas',      apps.tarefas)}
        ${appCheck('oradores',    'Oradores',     apps.oradores ?? false)}
        ${appCheck('limpeza',     'Limpeza',      apps.limpeza ?? false)}
        ${appCheck('escala',      'Escala TPL',   apps.escala)}
        ${appCheck('servicoCampo','Serviço de Campo', apps.servicoCampo ?? false)}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button id="btnCancelUsuario" class="btn btn-ghost" style="flex:1">Cancelar</button>
        <button id="btnSalvarUsuario" class="btn btn-primary" style="flex:1">Salvar</button>
      </div>
    </div>`

  document.body.appendChild(overlay)

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  document.getElementById('btnCancelUsuario')!.addEventListener('click', () => overlay.remove())
  document.getElementById('btnSalvarUsuario')!
    .addEventListener('click', () => void saveUsuario(uid, overlay))
}

async function saveUsuario(uid: string | null, overlay: HTMLElement): Promise<void> {
  const senha    = (document.getElementById('uSenha')    as HTMLInputElement).value
  const requestedMasterId = (document.getElementById('uMasterId') as HTMLSelectElement).value
  const masterId = stableUserMasterId(uid ? usuarios[uid] : undefined, requestedMasterId, pessoas)
  const ativo    = (document.getElementById('uAtivo')    as HTMLInputElement).checked
  if (!senha) { toast('Preencha a senha'); return }
  if (!masterId || !pessoas[masterId]) { toast('Selecione uma pessoa válida'); return }
  const nome = pessoas[masterId].name.trim()
  if (ativo && personalUserConflict(usuarios, masterId, uid)) { toast('Esta pessoa já possui outra conta ativa', 4000); return }

  const checkApp = (id: string) =>
    (document.getElementById(`uApp_${id}`) as HTMLInputElement).checked

  const selectedApps = {
    mestre: checkApp('mestre'), tarefas: checkApp('tarefas'), oradores:checkApp('oradores'), limpeza: checkApp('limpeza'),
    escala: checkApp('escala'),
    servicoCampo:checkApp('servicoCampo'), individual:true,
  }
  const apps = selectedApps
  const usuario: Usuario = {
    ...(uid && usuarios[uid] ? usuarios[uid] : {}),
    nome, senha, ativo, masterId,
    apps,
  }
  const finalUid = uid ?? masterId
  const proposedUsuarios: RawUsuarios = { ...usuarios, [finalUid]: usuario }
  if (!hasActiveAdmin(proposedUsuarios)) {
    toast('Mantenha ao menos um usuário Admin ativo', 4000)
    return
  }
  const release=editorBusy(overlay)
  setLoading('btnSalvarUsuario', true)

  try {
    await set(usuarioRef(finalUid), usuario)
    usuarios[finalUid] = usuario
    rootData = null
    overlay.remove()
    toast(uid ? 'Usuário atualizado ✓' : 'Usuário adicionado ✓')
    renderUsuarios()
  } catch {
    toast('Erro ao salvar')
    editorError(overlay)
    setLoading('btnSalvarUsuario', false)
  } finally { release() }
}

async function deleteUsuario(uid: string): Promise<void> {
  const u = usuarios[uid]
  if (!u) return
  const remainingUsuarios = Object.fromEntries(Object.entries(usuarios).filter(([id]) => id !== uid)) as RawUsuarios
  if (!hasActiveAdmin(remainingUsuarios)) {
    toast('Não é possível remover o último Admin ativo', 4000)
    return
  }
  if (!confirm(`Remover usuário "${u.nome}" permanentemente?`)) return
  try {
    await remove(usuarioRef(uid))
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete usuarios[uid]
    rootData = null
    toast('Usuário removido')
    renderUsuarios()
  } catch {
    toast('Erro ao remover')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ABA: CONFIG
// ─────────────────────────────────────────────────────────────────────────────

function renderConfig(): void {
  const mc = document.getElementById('mestreContent')!

  const secs: Array<{ id: typeof activeConfigSection; label: string }> = [
    { id: 'congregacao', label: 'Congregação' },
    { id: 'agenda', label: 'Agenda' },
  ]

  mc.innerHTML = `
    <div style="display:flex;gap:4px;margin-bottom:16px;background:var(--surface-2);
      border-radius:8px;padding:3px;border:1px solid var(--border)">
      ${secs.map(s => `
        <button class="btn ${activeConfigSection === s.id ? 'btn-primary' : 'btn-ghost'}"
          data-cfg-sec="${s.id}" style="flex:1;font-size:.78rem">${s.label}</button>`
      ).join('')}
    </div>
    <div id="configContent"></div>`

  mc.querySelectorAll<HTMLButtonElement>('[data-cfg-sec]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeConfigSection = btn.dataset['cfgSec'] as typeof activeConfigSection
      renderConfig()
    })
  })

  if (activeConfigSection === 'congregacao') renderConfigCongregacao()
  else renderConfigAgenda()
}

interface GlobalConfigIssue {
  id: 'quadro-link' | 'ics-reminders'
  title: string
  detail: string
}

function collectAgendaConfigIssues(): GlobalConfigIssue[] {
  const issues: GlobalConfigIssue[] = []
  if (!agendaConfig.quadroWhatsAppLink?.trim()) {
    issues.push({ id: 'quadro-link', title: 'Link do Quadro ausente', detail: 'Cadastre o link do grupo de WhatsApp que o Quadro de anúncios deve usar.' })
  }
  const configured = agendaConfig.icsReminders ?? {}
  const missing = AGENDA_REMINDER_MODULES
    .filter(module => !Array.isArray(configured[module.id]))
    .map(module => module.label)
  if (missing.length) {
    issues.push({ id: 'ics-reminders', title: 'Lembretes ICS incompletos', detail: `Sem configuração salva para: ${missing.join(', ')}.` })
  }
  return issues
}

function moduleForLinkIssue(module: LinkIssue['module']): ModuleName | null {
  const modules: Record<string, ModuleName> = {
    Tarefas: 'tarefas',
    Escala: 'escala',
    'Serviço de Campo': 'servicoCampo',
  }
  return modules[module] ?? null
}

function resolveLinkIssue(item: LinkIssue): void {
  if (item.module === 'Usuários') {
    activeTab = 'usuarios'
    renderContent()
    return
  }
  const module = moduleForLinkIssue(item.module)
  if (module) void navigateTo(module)
}

function resolveAgendaConfigIssue(): void {
  activeTab = 'config'
  activeConfigSection = 'agenda'
  renderContent()
}

const AGENDA_REMINDER_MODULES: Array<{ id: AgendaReminderModule; label: string; defaults: string[] }> = [
  { id: 'tarefas', label: 'Tarefas', defaults: ['P7D', 'P1D'] },
  { id: 'limpeza', label: 'Limpeza', defaults: ['P1D'] },
  { id: 'escala', label: 'Escala TPL', defaults: ['P1D'] },
  { id: 'servicoCampo', label: 'Serviço de Campo', defaults: ['P1D'] },
  { id: 'quadro', label: 'Quadro de anúncios', defaults: [] },
]

const REMINDER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Sem lembrete' },
  { value: 'P1D', label: '1 dia antes' },
  { value: 'P2D', label: '2 dias antes' },
  { value: 'P3D', label: '3 dias antes' },
  { value: 'P7D', label: '1 semana antes' },
  { value: 'P14D', label: '2 semanas antes' },
]

function reminderSelect(id: string, selected: string): string {
  return `<select id="${id}" class="form-select" style="font-size:.8rem">${REMINDER_OPTIONS.map(option =>
    `<option value="${option.value}" ${option.value === selected ? 'selected' : ''}>${option.label}</option>`,
  ).join('')}</select>`
}

function renderConfigAgenda(): void {
  const el = document.getElementById('configContent')!
  editorSaved(el);el.dataset.editorScope='true'
  const reminders = agendaConfig.icsReminders ?? {}
  const moduleWhatsApp = agendaConfig.moduleWhatsApp ?? {}
  const rows = AGENDA_REMINDER_MODULES.map(module => {
    const values = reminders[module.id] ?? module.defaults
    return `<div class="admin-reminder-grid admin-reminder-row">
      <strong style="font-size:.82rem">${module.label}</strong>
      ${reminderSelect(`agendaReminder1_${module.id}`, values[0] ?? '')}
      ${reminderSelect(`agendaReminder2_${module.id}`, values[1] ?? '')}
    </div>`
  }).join('')
  const quadroWhatsApp = moduleWhatsApp.quadro ?? {}
  const quadroLink = quadroWhatsApp.groupLink ?? agendaConfig.quadroWhatsAppLink ?? ''

  el.innerHTML = `
    <div><h3 style="margin-top:0">WhatsApp do Quadro</h3><p class="form-help">As mensagens dos módulos são configuradas dentro de cada módulo. Aqui fica somente o grupo usado pelo Quadro de anúncios.</p><div class="form-group"><label class="form-label" for="agendaWhatsLink_quadro">Link do grupo</label><input id="agendaWhatsLink_quadro" class="form-input" type="url" value="${escapeHtml(quadroLink)}" placeholder="https://chat.whatsapp.com/..."></div><div class="form-group"><label class="form-label" for="agendaWhatsMeeting_quadro">Mensagem do Quadro</label><textarea id="agendaWhatsMeeting_quadro" class="form-input" rows="5">${escapeHtml(quadroWhatsApp.meetingText?.trim() || 'Olá. Seguem as informações da nossa reunião:\n\n{dados_da_reuniao}\n\nAgradecemos pela atenção.')}</textarea></div></div>
    <div class="form-panel admin-agenda-documents">
      <h3 style="margin-top:0">Outros anúncios</h3>
      <label class="form-field"><span>Link da pasta no Google Drive</span><input id="agendaOtherAnnouncementsUrl" class="form-input" type="url" value="${escapeHtml(agendaConfig.outrosAnunciosDriveUrl ?? '')}" placeholder="https://drive.google.com/drive/folders/..."></label>
      <p class="form-help">Adicione e remova os PDFs diretamente nessa pasta. Para acesso simples, compartilhe-a como “Qualquer pessoa com o link — Leitor”.</p>
    </div>
    <div style="margin-top:18px">
      <div style="font-size:.8rem;font-weight:600;color:var(--ink-2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em">Lembretes do calendário</div>
      <p class="form-help" style="margin-top:0">Cada coluna adiciona um lembrete ao arquivo .ics. Deixe uma ou ambas como “Sem lembrete” quando aquele módulo não precisar avisar.</p>
      <div class="admin-reminder-grid admin-reminder-heading">
        <span>Módulo</span><span>1º lembrete</span><span>2º lembrete</span>
      </div>
      ${rows}
    </div>
    <button id="btnSalvarAgendaConfig" class="btn btn-primary btn-full" style="margin-top:16px">Salvar configurações da Agenda</button>`

  document.getElementById('btnSalvarAgendaConfig')?.addEventListener('click', () => void saveConfigAgenda())
}

function normalizedReminderValues(values: string[]): string[] {
  return [...new Set(values.filter(value => REMINDER_OPTIONS.some(option => option.value === value && value)))].sort((a, b) => b.localeCompare(a))
}

async function saveConfigAgenda(): Promise<void> {
  const moduleWhatsApp: NonNullable<AgendaConfig['moduleWhatsApp']> = { ...(agendaConfig.moduleWhatsApp ?? {}) }
  const groupLink = (document.getElementById('agendaWhatsLink_quadro') as HTMLInputElement).value.trim()
  if (groupLink && !/^https:\/\/(chat\.)?whatsapp\.com\//i.test(groupLink)) { toast('Use um link válido do WhatsApp no Quadro'); return }
  const outrosAnunciosDriveUrl = (document.getElementById('agendaOtherAnnouncementsUrl') as HTMLInputElement).value.trim()
  if (outrosAnunciosDriveUrl && !/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/[^/?#]+/i.test(outrosAnunciosDriveUrl)) { toast('Use o link de uma pasta do Google Drive'); return }
  moduleWhatsApp.quadro = {
    ...(moduleWhatsApp.quadro ?? {}),
    groupLink,
    meetingText:(document.getElementById('agendaWhatsMeeting_quadro') as HTMLTextAreaElement).value.trim() || 'Olá. Seguem as informações da nossa reunião:\n\n{dados_da_reuniao}\n\nAgradecemos pela atenção.',
  }
  const icsReminders: AgendaConfig['icsReminders'] = {}
  AGENDA_REMINDER_MODULES.forEach(module => {
    const values = [
      (document.getElementById(`agendaReminder1_${module.id}`) as HTMLSelectElement).value,
      (document.getElementById(`agendaReminder2_${module.id}`) as HTMLSelectElement).value,
    ]
    icsReminders[module.id] = normalizedReminderValues(values)
  })
  const quadroSettings = moduleWhatsApp.quadro ?? {}
  const scope=document.getElementById('configContent')!,release=editorBusy(scope)
  setLoading('btnSalvarAgendaConfig', true)
  try {
    await update(agendaConfigRef, {
      quadroWhatsAppLink:groupLink,
      outrosAnunciosDriveUrl:outrosAnunciosDriveUrl || null,
      'moduleWhatsApp/quadro':quadroSettings,
      icsReminders,
    })
    agendaConfig = {
      ...agendaConfig,
      quadroWhatsAppLink:groupLink,
      outrosAnunciosDriveUrl:outrosAnunciosDriveUrl || undefined,
      moduleWhatsApp:{ ...(agendaConfig.moduleWhatsApp ?? {}), quadro:quadroSettings },
      icsReminders,
    }
    editorSaved(scope)
    toast('Configurações da Agenda salvas ✓')
  } catch {
    editorError(scope)
    toast('Erro ao salvar configurações da Agenda')
  } finally {
    release()
    setLoading('btnSalvarAgendaConfig', false, 'Salvar configurações da Agenda')
  }
}

// ── Congregação ───────────────────────────────────────────────────────────────

function renderConfigCongregacao(): void {
  const el = document.getElementById('configContent')!
  editorSaved(el);el.dataset.editorScope='true'
  const c  = config.congregacao ?? { nome:'', cidade:'', circuito:'', idioma:'pt-BR' }
  const r  = config.reunioes

  const diaOpts = (sel?: number) => DIAS_SEMANA
    .map((d, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${d}</option>`)
    .join('')

  const reuniaoCard = (id: string, label: string, dia?: number, hora?: string) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font-size:.82rem;font-weight:600;color:var(--ink-2);margin-bottom:10px">${label}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="form-group" style="margin:0">
          <label class="form-label">Dia</label>
          <select id="${id}Dia" class="form-select">${diaOpts(dia)}</select>
        </div>
        <div class="form-group" style="margin:0">
          <label class="form-label">Horário</label>
          <input id="${id}Hora" class="form-input" type="time" value="${escapeHtml(hora)}">
        </div>
      </div>
    </div>`

  el.innerHTML = `
    <div class="form-group">
      <label class="form-label">Nome da congregação</label>
      <input id="cNome" class="form-input" value="${escapeHtml(c.nome)}" placeholder="Congregação Noroeste">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">Cidade</label>
        <input id="cCidade" class="form-input" value="${escapeHtml(c.cidade)}" placeholder="Aracaju">
      </div>
      <div class="form-group">
        <label class="form-label">Circuito</label>
        <input id="cCircuito" class="form-input" value="${escapeHtml(c.circuito)}" placeholder="SE-01">
      </div>
    </div>

    <div style="font-size:.8rem;font-weight:600;color:var(--ink-2);margin:16px 0 10px;
      text-transform:uppercase;letter-spacing:.05em">Reuniões</div>

    ${reuniaoCard('ms',  'Meio de semana',      r?.meiaDeSemana?.diaSemana,  r?.meiaDeSemana?.horario)}
    ${reuniaoCard('fs',  'Fim de semana',       r?.fimDeSemana?.diaSemana,   r?.fimDeSemana?.horario)}

    <button id="btnSalvarCong" class="btn btn-primary btn-full" style="margin-top:8px">
      Salvar Congregação
    </button>`

  document.getElementById('btnSalvarCong')!
    .addEventListener('click', () => void saveConfigCongregacao())
}

async function saveConfigCongregacao(): Promise<void> {
  const v  = (id: string) => (document.getElementById(id) as HTMLInputElement).value.trim()
  const vi = (id: string) => parseInt((document.getElementById(id) as HTMLSelectElement).value, 10)

  const congregacao = { nome: v('cNome'), cidade: v('cCidade'), circuito: v('cCircuito'), idioma: 'pt-BR' }
  const reunioes = {
    meiaDeSemana:  { diaSemana: vi('msDia'),  horario: v('msHora')  },
    fimDeSemana:   { diaSemana: vi('fsDia'),  horario: v('fsHora')  },
  }

  const scope=document.getElementById('configContent')!,release=editorBusy(scope)
  setLoading('btnSalvarCong', true)
  try {
    await Promise.all([
      set(configCongregacaoRef, congregacao),
      set(configReunioesRef, reunioes),
    ])
    config.congregacao = congregacao
    config.reunioes    = reunioes
    editorSaved(scope)
    toast('Congregação salva ✓')
  } catch {
    toast('Erro ao salvar')
    editorError(scope)
  } finally {
    release()
    setLoading('btnSalvarCong', false, 'Salvar Congregação')
  }
}
