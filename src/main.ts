import './style.css'
import { installDialogAccessibility } from './ui/dialog-accessibility'
installDialogAccessibility()
import { installPersonSearch } from './ui/person-search'
import { installEditorFeedback } from './ui/editor-feedback'
installPersonSearch()
installEditorFeedback()
import { installMonthNavigation } from './ui/month-navigation'
installMonthNavigation()
import {
  authenticate,
  logout,
  loadUsuarios,
  loadCachedUserChoices,
  restoreSession,
} from './auth'
import { initRouter, navigateBack, navigateModuleIndex, routeState } from './router'
import type { Usuario } from './types'
import type { CachedUserChoices } from './auth-domain'
import { animateKpis } from './ui/animations'
import { refreshServiceWorkerWeekly } from './pwa-sync'

// ─── Elementos ──────────────────────────────────────────────────────────────

const loginOverlay  = document.getElementById('loginOverlay')!
const loginForm     = document.getElementById('loginBox') as HTMLFormElement
const appShell      = document.getElementById('appShell')!
const selectUsuario = document.getElementById('selectUsuario') as HTMLSelectElement
const inputSenha    = document.getElementById('inputSenha')    as HTMLInputElement
const btnSair       = document.getElementById('btnSair')       as HTMLButtonElement
const btnBack       = document.getElementById('btnBack')       as HTMLButtonElement
const bottomUser    = document.getElementById('bottomUser')!
const loginError    = document.getElementById('loginError')!
const statusBar     = document.getElementById('statusBar')!
const toast         = document.getElementById('toast')!

let usuariosDisponiveis: CachedUserChoices = {}
let carregandoUsuarios = true

// ─── Toast ──────────────────────────────────────────────────────────────────

let _toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(msg: string, ms = 2800): void {
  toast.textContent = msg
  toast.classList.add('show')
  if (_toastTimer) clearTimeout(_toastTimer)
  _toastTimer = setTimeout(() => toast.classList.remove('show'), ms)
}

// ─── Status Firebase ────────────────────────────────────────────────────────

function setStatus(text: string): void {
  statusBar.textContent = text
}

// ─── Exibir app shell ────────────────────────────────────────────────────────

function showApp(usuario: Usuario): void {
  loginOverlay.classList.add('hidden')
  appShell.classList.remove('hidden')
  bottomUser.textContent = usuario.nome
}

// ─── Select de usuário ───────────────────────────────────────────────────────

/** Popula o <select> com usuários ativos ordenados por nome.
 *  Se não houver nenhum usuário ativo, mostra mensagem no lugar do select. */
function populateUsuarioSelect(usuarios: CachedUserChoices): void {
  const ativos = Object.entries(usuarios)
    .filter(([, u]) => u.ativo)
    .sort(([, a], [, b]) => a.nome.localeCompare(b.nome, 'pt-BR'))

  if (ativos.length === 0) {
    selectUsuario.innerHTML = '<option value="">Nenhum usuário disponível</option>'
    selectUsuario.disabled = true
    return
  }

  selectUsuario.innerHTML = ativos
    .map(([uid, u]) => `<option value="${uid.replace(/[&<>"']/g, '')}">${u.nome.replace(/[&<>"']/g, '')}</option>`)
    .join('')
  selectUsuario.disabled = false
}

// ─── Sessão restaurada ───────────────────────────────────────────────────────

async function tryRestoreSession(): Promise<boolean> {
  const session = await restoreSession()
  if (!session) return false
  showApp(session.usuario)
  initRouter(session.uid, session.usuario)
  return true
}

// ─── Login ──────────────────────────────────────────────────────────────────

async function handleLogin(): Promise<void> {
  const uid   = selectUsuario.value
  const senha = inputSenha.value

  if (!uid || !senha) {
    loginError.textContent = 'Selecione o usuário e digite a senha.'
    inputSenha.classList.add('field-error')
    setTimeout(() => inputSenha.classList.remove('field-error'), 1000)
    return
  }

  if (carregandoUsuarios) {
    loginError.textContent = 'Carregando os dados do usuário. Tente novamente em instantes.'
    return
  }

  try {
    const session = await authenticate(uid, senha)
    loginError.textContent = ''
    inputSenha.value = ''
    showApp(session.usuario)
    initRouter(session.uid, session.usuario)
    showToast(`Bem-vindo, ${session.usuario.nome}!`)
  } catch {
    loginError.textContent = 'Usuário ou senha inválidos.'
    inputSenha.classList.add('field-error')
    setTimeout(() => inputSenha.classList.remove('field-error'), 1000)
    inputSenha.value = ''
    inputSenha.focus()
  }
}

// ─── Botão Sair ──────────────────────────────────────────────────────────────

async function handleSair(): Promise<void> {
  await logout()
  location.reload()
}

// ─── Botão Voltar ────────────────────────────────────────────────────────────

function handleBack(): void {
  const workspace = document.querySelector<HTMLElement>('[data-workspace-home]')
  if (workspace) {
    if (workspace.dataset.workspaceActive !== workspace.dataset.workspaceHome) {
      workspace.querySelector<HTMLButtonElement>(`[data-workspace-tab="${workspace.dataset.workspaceHome}"]`)?.click()
    } else navigateBack()
    return
  }
  if (document.querySelector('[data-module-index-marker]')) navigateModuleIndex()
  else navigateBack()
}

document.addEventListener('click', event => {
  const target = event.target as HTMLElement
  if (target.closest('[data-module-index]')) navigateModuleIndex()
})

function syncBottomNavigation(): void {
  const state = routeState()
  const workspace = document.querySelector<HTMLElement>('[data-workspace-home]')
  const insideModuleScreen = workspace
    ? workspace.dataset.workspaceActive !== workspace.dataset.workspaceHome
    : Boolean(document.querySelector('[data-module-index-marker]'))
  const canBack = insideModuleScreen || state.canReturnToModules
  btnBack.textContent = '← Voltar'
  btnBack.title = insideModuleScreen ? 'Voltar ao início do módulo' : 'Voltar aos módulos'
  btnBack.classList.toggle('hidden', !canBack)
  btnSair.classList.toggle('hidden', canBack)
}

const kpiObserver = new MutationObserver(() => { animateKpis(document); syncBottomNavigation() })
kpiObserver.observe(document.getElementById('appContent')!, { childList: true, subtree: true })

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  setStatus('Carregando dados…')

  const cachedChoices = loadCachedUserChoices()
  if (Object.keys(cachedChoices).length > 0) populateUsuarioSelect(cachedChoices)

  // Os campos ficam utilizáveis antes da resposta do Firebase chegar.
  loginForm.addEventListener('submit', event => {
    event.preventDefault()
    void handleLogin()
  })
  selectUsuario.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inputSenha.focus()
  })
  selectUsuario.addEventListener('change', () => {
    loginError.textContent = ''
  })

  // A sessao existente nao depende da lista usada no formulario de login.
  carregandoUsuarios = Object.keys(cachedChoices).length === 0
  void loadUsuarios().then(usuarios => {
    usuariosDisponiveis = usuarios
    const previous = selectUsuario.value
    populateUsuarioSelect(usuarios)
    if (usuarios[previous]?.ativo) selectUsuario.value = previous
    carregandoUsuarios = false
    loginError.textContent = ''
    setStatus('Lista de usuários atualizada')
  }).catch(() => {
    carregandoUsuarios = false
    setStatus('Não foi possível atualizar a lista de usuários')
    if (Object.keys(cachedChoices).length === 0) {
      loginError.textContent = 'Não foi possível carregar os usuários. Verifique a conexão e recarregue a página.'
    }
  })

  // Tenta restaurar sessão
  const restored = await tryRestoreSession()
  if (restored) return

  // Exibe login
  loginOverlay.classList.remove('hidden')
  if (Object.keys(cachedChoices).length === 0 && Object.keys(usuariosDisponiveis).length === 0) populateUsuarioSelect(usuariosDisponiveis)
  selectUsuario.focus()
}

// ─── Eventos globais ─────────────────────────────────────────────────────────

btnSair.addEventListener('click', () => void handleSair())
btnBack.addEventListener('click', handleBack)

window.addEventListener('app-route-change', (event) => {
  const detail = (event as CustomEvent<{ canBack: boolean }>).detail
  const canBack = detail?.canBack === true
  btnBack.classList.toggle('hidden', !canBack)
  btnSair.classList.toggle('hidden', canBack)
  queueMicrotask(syncBottomNavigation)
})

// ─── Start ───────────────────────────────────────────────────────────────────

void init()

// ─── Service Worker (PWA) ─────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  const isLocalDevelopment = location.hostname === '127.0.0.1' || location.hostname === 'localhost'
  if (!isLocalDevelopment) {
    void navigator.serviceWorker.register('/sw.js').then(registration => refreshServiceWorkerWeekly(registration, 'noroeste_admin_shell_sync'))
  } else {
    // Evita que o shell PWA publicado interfira no desenvolvimento local.
    void navigator.serviceWorker.getRegistrations()
      .then(registrations => Promise.all(registrations.map(registration => registration.unregister())))
    if ('caches' in window) {
      void caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('noroeste-admin-')).map(key => caches.delete(key)),
      ))
    }
  }
}
