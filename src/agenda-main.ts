import './style.css'
import { installDialogAccessibility } from './ui/dialog-accessibility'
installDialogAccessibility()
import { installMonthNavigation } from './ui/month-navigation'
installMonthNavigation()
import type { MasterPessoa, Usuario } from './types'
import mountAgenda from './modules/individual'
import { normalizeAgendaPeople, sanitizeAgendaPeople } from './modules/individual-domain'
import { refreshServiceWorkerWeekly } from './pwa-sync'
import { apiJson, ApiError, clearAgendaDeviceToken, saveAgendaDeviceToken } from './secure-api.ts'

const PERSON_KEY = 'noroeste_agenda_person'
const PEOPLE_KEY = 'noroeste_agenda_people_v2'
const PEOPLE_SYNC_KEY = 'noroeste_agenda_people_sync_v2'
const INSTALLATION_KEY = 'noroeste_agenda_installation_v1'
const identity = document.getElementById('agendaIdentity')!
const shell = document.getElementById('agendaShell')!
const select = document.getElementById('agendaPerson') as HTMLSelectElement
const continueButton = document.getElementById('agendaContinue') as HTMLButtonElement
const error = document.getElementById('agendaError')!
const bottomUser = document.getElementById('bottomUser')!
let people: Record<string, MasterPessoa> = {}
let syncingPeople = false
let installPrompt: BeforeInstallPromptEvent | null = null

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

function showInstallSuggestion(): void {
  document.getElementById('agendaInstallSuggestion')?.remove()
  if (isInstalled()) return
  const suggestion = document.createElement('aside')
  suggestion.id = 'agendaInstallSuggestion'
  suggestion.className = 'agenda-install-suggestion'
  suggestion.innerHTML = '<span>Instale a Minha Agenda para abrir mais rápido e usar offline.</span><button id="agendaInstall" class="btn btn-primary" type="button">Instalar</button>'
  const host=shell.classList.contains('hidden') ? identity.querySelector('.login-box')! : shell
  host.prepend(suggestion)
  document.getElementById('agendaInstall')?.addEventListener('click', async () => {
    const prompt = installPrompt
    if (!prompt) {
      alert('Abra o menu do navegador e procure “Instalar aplicativo” ou “Adicionar à tela inicial”. Se essa opção não estiver disponível, abra este endereço no navegador principal do aparelho. No iPhone ou iPad, procure “Adicionar à Tela de Início” no menu de compartilhamento.')
      return
    }
    const button=document.getElementById('agendaInstall') as HTMLButtonElement
    button.disabled=true
    try { await prompt.prompt(); await prompt.userChoice }
    catch { alert('Não foi possível abrir a instalação. Tente pelo menu do navegador.') }
    finally { installPrompt=null; showInstallSuggestion() }
  })
}

function activePeople(): Array<[string, MasterPessoa]> {
  return Object.entries(people).filter(([, person]) => person.active !== false).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR'))
}

function renderPeople(): void {
  const active = activePeople()
  select.innerHTML = active.map(([id, person]) => `<option value="${id}">${person.name.replace(/[&<>"']/g, '')}</option>`).join('')
  select.disabled = active.length === 0
  continueButton.disabled = active.length === 0
}

function cachedPeople(): Record<string, MasterPessoa> {
  try { return normalizeAgendaPeople(JSON.parse(localStorage.getItem(PEOPLE_KEY) ?? '{}')) }
  catch { return {} }
}

function installationId(): string {
  const current = localStorage.getItem(INSTALLATION_KEY) ?? ''
  if (/^[a-f0-9]{32,64}$/.test(current)) return current
  const bytes = new Uint8Array(24); crypto.getRandomValues(bytes)
  const created = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  localStorage.setItem(INSTALLATION_KEY, created)
  return created
}

function clearIdentityCache(): void {
  clearAgendaDeviceToken()
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    const identityData = key?.startsWith('noroeste_agenda_offline_v3:') || (key?.startsWith('noroeste_agenda_ui_v1:') && key.endsWith(':standalone'))
    if (key && identityData) localStorage.removeItem(key)
  }
}

function showRevokedAgenda(): void {
  let notice = document.getElementById('agendaRevoked')
  if (!notice) {
    notice = document.createElement('p')
    notice.id = 'agendaRevoked'
    notice.className = 'notice warning'
    shell.insertBefore(notice, document.getElementById('appContent'))
  }
  notice.textContent = 'Esta agenda não recebe mais atualizações. Você pode consultar somente os dados já salvos neste aparelho.'
  if (shell.classList.contains('hidden')) error.textContent = notice.textContent
}

function openAgenda(masterId: string): void {
  const person = people[masterId]
  if (!person || person.active === false) return
  localStorage.setItem(PERSON_KEY, masterId)
  identity.classList.add('hidden')
  shell.classList.remove('hidden')
  bottomUser.textContent = person.name
  const usuario: Usuario = {
    nome: person.name,
    senha: '',
    ativo: true,
    masterId,
    apps: { mestre:false, tarefas:false, escala:false, individual:true },
  }
  mountAgenda({ uid:`agenda-${masterId}`, usuario })
  showInstallSuggestion()
}

async function init(): Promise<void> {
  people = cachedPeople()
  const saved = localStorage.getItem(PERSON_KEY) ?? ''
  if (Object.keys(people).length) {
    renderPeople()
    if (saved && people[saved] && people[saved].active !== false && shell.classList.contains('hidden')) openAgenda(saved)
  }
  if (syncingPeople) return
  syncingPeople = true
  try {
    const response = await apiJson<{ people: Record<string, Pick<MasterPessoa, 'name' | 'active'>>; masterId: string; deviceToken?: string }>('agenda-device')
    if (response.deviceToken) saveAgendaDeviceToken(response.deviceToken)
    document.getElementById('agendaRevoked')?.remove()
    people = normalizeAgendaPeople(response.people)
    localStorage.setItem(PEOPLE_KEY, JSON.stringify(sanitizeAgendaPeople(people)))
    localStorage.setItem(PEOPLE_SYNC_KEY, String(Date.now()))
    renderPeople()
    const selected = saved && people[saved]?.active !== false ? saved : response.masterId
    if (selected && people[selected] && people[selected].active !== false && shell.classList.contains('hidden')) openAgenda(selected)
  } catch (reason) {
    if (reason instanceof ApiError && reason.status === 410) { showRevokedAgenda(); return }
    if (!Object.keys(people).length) error.textContent = 'Nao foi possivel carregar as pessoas. Verifique a conexao.'
  } finally {
    syncingPeople = false
  }
}

continueButton.addEventListener('click', () => void saveSelectedPerson())
bottomUser.addEventListener('click', openIdentityUnlock)

function openIdentityUnlock(): void {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<form class="modal" id="agendaUnlockForm"><h2>Trocar pessoa</h2><p class="form-help">Informe a senha de um Admin para voltar à seleção de nomes.</p><label class="form-field"><span>Senha Admin</span><input id="agendaAdminPassword" class="form-input" type="password" autocomplete="current-password" required></label><p id="agendaUnlockError" class="login-error" role="alert"></p><div class="module-row-actions"><button id="agendaUnlockCancel" class="btn btn-ghost" type="button">Cancelar</button><button id="agendaUnlockConfirm" class="btn btn-primary" type="submit">Continuar</button></div></form>`
  document.body.appendChild(overlay)
  const form = document.getElementById('agendaUnlockForm') as HTMLFormElement
  const password = document.getElementById('agendaAdminPassword') as HTMLInputElement
  const message = document.getElementById('agendaUnlockError')!
  const button = document.getElementById('agendaUnlockConfirm') as HTMLButtonElement
  const close = (): void => overlay.remove()
  document.getElementById('agendaUnlockCancel')?.addEventListener('click', close)
  overlay.addEventListener('click', event => { if (event.target === overlay) close() })
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; button.textContent = 'Verificando...'; message.textContent = ''
    try {
      await apiJson('agenda-device', { method:'DELETE', body:JSON.stringify({ adminPassword:password.value }) })
      clearIdentityCache(); localStorage.removeItem(PERSON_KEY); close()
      shell.classList.add('hidden'); identity.classList.remove('hidden'); renderPeople(); showInstallSuggestion()
    } catch (reason) { message.textContent = reason instanceof Error ? reason.message : 'Senha Admin inválida ou conexão indisponível.' }
    finally { button.disabled = false; button.textContent = 'Continuar' }
  })
  password.focus()
}

async function saveSelectedPerson(): Promise<void> {
  const masterId = select.value
  if (!masterId || !people[masterId] || people[masterId].active === false) { error.textContent='Selecione uma pessoa ativa.'; return }
  continueButton.disabled = true
  continueButton.textContent = 'Abrindo...'
  error.textContent = ''
  try {
    const paired=await apiJson<{masterId:string;deviceToken?:string}>('agenda-device', { method:'POST', body:JSON.stringify({ masterId, installationId:installationId() }) })
    if(paired.deviceToken)saveAgendaDeviceToken(paired.deviceToken)
    localStorage.setItem(PEOPLE_SYNC_KEY,String(Date.now()))
    openAgenda(masterId)
  } catch (reason) {
    error.textContent = reason instanceof Error ? reason.message : 'Não foi possível salvar esta pessoa.'
  } finally {
    continueButton.disabled = false
    continueButton.textContent = 'Continuar'
  }
}

void init()
showInstallSuggestion()
window.matchMedia('(display-mode: standalone)').addEventListener('change', showInstallSuggestion)

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  installPrompt = event as BeforeInstallPromptEvent
  showInstallSuggestion()
})

window.addEventListener('appinstalled', () => {
  installPrompt = null
  showInstallSuggestion()
})

window.addEventListener('online', () => void init())
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void init() })

if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') {
  void navigator.serviceWorker.getRegistration('/agenda/').then(existing => existing ?? navigator.serviceWorker.register('/agenda/sw.js', { scope:'/agenda/', updateViaCache:'all' })).then(registration => refreshServiceWorkerWeekly(registration, 'noroeste_agenda_shell_sync'))
}
