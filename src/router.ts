import type { AppContext, ModuleName } from './types'
import { renderMenuCards, type ItemMenu } from './ui/menu-cards'

// ─── Mapa de módulos ────────────────────────────────────────────────────────

export const MODULE_META: Record<
  ModuleName,
  { label: string; desc: string; icon: string; color: string }
> = {
  mestre:      { label: 'Admin',        desc: 'Pessoas, config e usuários',   icon: '⚙️',  color: '#003F72' },
  tarefas:     { label: 'Tarefas',      desc: 'Funções da reunião',           icon: '📋', color: '#7E3AF2' },
  limpeza:     { label: 'Limpeza',      desc: 'Grupos, rodízio e PDF',        icon: '🧹', color: '#006EB6' },
  escala:      { label: 'Escala TPL',   desc: 'Escala de campo TPL',          icon: '🌿', color: '#1A6B3C' },
  oradores:    { label: 'Oradores',      desc: 'Discursos, saídas e intercâmbios', icon: '🎙️', color: '#72520A' },
  servicoCampo:{ label: 'Serviço de Campo', desc: 'Saídas, dirigentes e locais', icon: '⌖', color: '#8A5A00' },
  individual:  { label: 'Minha agenda',  desc: 'Suas designações e compromissos', icon: '✓', color: '#006EB6' },
}

const MODULES_ORDER: ModuleName[] = [
  'mestre', 'servicoCampo', 'tarefas', 'oradores', 'limpeza', 'escala', 'individual',
]

export const INSTALLABLE_MODULES: ModuleName[] = MODULES_ORDER.filter(module => module !== 'individual')

export function moduleFromPath(pathname: string): ModuleName | null {
  const match=pathname.match(/^\/modulos\/(mestre|tarefas|oradores|limpeza|escala|servicoCampo)\/?$/)
  return match ? match[1] as ModuleName : null
}

export function accessibleModules(usuario: import('./types').Usuario): ModuleName[] {
  return usuario.apps.mestre
    ? MODULES_ORDER
    : MODULES_ORDER.filter(module => usuario.apps[module] === true || (module === 'individual' && Boolean(usuario.masterId)))
}

// ─── Lazy loaders ───────────────────────────────────────────────────────────

async function loadModule(
  name: ModuleName,
  ctx:  AppContext,
  current: () => boolean,
): Promise<void> {
  const loaders: Record<ModuleName, () => Promise<{ default: (ctx: AppContext) => void }>> = {
    mestre:      () => import('./modules/mestre'),
    tarefas:     () => import('./modules/tarefas'),
    limpeza:     () => import('./modules/limpeza'),
    escala:      () => import('./modules/escala'),
    oradores:    () => import('./modules/oradores'),
    servicoCampo:() => import('./modules/servico-campo'),
    individual:  () => import('./modules/individual'),
  }
  const mod = await loaders[name]()
  if (current()) mod.default(ctx)
}

// ─── Módulo activo ──────────────────────────────────────────────────────────

let _ctx: AppContext | null = null
let _accessList: ModuleName[] = []
let _currentModule: ModuleName | null = null
let navigationId = 0

function animateRoute(content: HTMLElement): void {
  content.classList.remove('screen-enter')
  void content.offsetWidth
  content.classList.add('screen-enter')
}

function emitRouteState(): void {
  window.dispatchEvent(new CustomEvent('app-route-change', {
    detail: { canBack: _currentModule !== null && _accessList.length > 1 },
  }))
}

export async function navigateTo(modulo: ModuleName, overview?:AppContext['overview']): Promise<void> {
  if (!_ctx) return
  if (!_accessList.includes(modulo)) return
  const requestId = ++navigationId
  _currentModule = modulo
  emitRouteState()
  const content = document.getElementById('appContent')!
  content.innerHTML = '<p style="padding:24px;color:var(--ink-3)">Carregando…</p>'
  try {
    await loadModule(modulo, { ..._ctx,overview }, () => requestId === navigationId)
    if (requestId === navigationId) {
      animateRoute(content)
    }
  } catch {
    if (requestId !== navigationId) return
    content.innerHTML = '<p class="empty-state">Não foi possível abrir o módulo.</p><button id="retryModule" class="btn btn-primary">Tentar novamente</button>'
    document.getElementById('retryModule')?.addEventListener('click', () => void navigateTo(modulo))
  }
}

export function navigateBack(): void {
  if (_currentModule && _accessList.length > 1) {
    renderMenu(_accessList)
    return
  }
}

export function navigateModuleIndex(): void {
  if (_currentModule) void navigateTo(_currentModule)
}

export function routeState(): { moduleOpen: boolean; canReturnToModules: boolean } {
  return { moduleOpen:_currentModule !== null, canReturnToModules:_currentModule !== null && _accessList.length > 1 }
}

// ─── Init ───────────────────────────────────────────────────────────────────

export function initRouter(uid: string, usuario: import('./types').Usuario): void {
  _ctx = { uid, usuario }

  const accessList = accessibleModules(usuario)
  _accessList = accessList

  const directModule=moduleFromPath(location.pathname)
  if(directModule) {
    if(accessList.includes(directModule)) void navigateTo(directModule)
    else document.getElementById('appContent')!.innerHTML = '<div class="module-placeholder"><h2>Sem acesso</h2><p>Este módulo não está habilitado para você.</p></div>'
    return
  }

  if (accessList.length === 0) {
    document.getElementById('appContent')!.innerHTML = `
      <div class="module-placeholder">
        <h2>Sem acesso</h2>
        <p>Nenhum módulo habilitado para este usuário.</p>
      </div>`
    return
  }

  if (accessList.length === 1) {
    void navigateTo(accessList[0])
    return
  }

  renderMenu(accessList)
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderMenu(list: ModuleName[]): void {
  navigationId++
  _currentModule = null
  emitRouteState()
  const content = document.getElementById('appContent')!
  const items: ItemMenu[] = list.map((m) => {
    const meta = MODULE_META[m]
    return { id: m, titulo: meta.label, subtitulo: meta.desc, icone: meta.icon, corFundo: meta.color }
  })
  renderMenuCards(content, items, id => void navigateTo(id as ModuleName))
  animateRoute(content)
}
