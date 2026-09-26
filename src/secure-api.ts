let csrfToken = ''
const APP_INSTALLATION_KEY = 'noroeste_module_installation_v1'
const AGENDA_DEVICE_KEY = 'noroeste_agenda_device_token_v1'

export function saveAppInstallationToken(value: string): void {
  if (/^[a-f0-9]{64}$/.test(value)) try { localStorage.setItem(APP_INSTALLATION_KEY, value) } catch { /* O cookie continua disponível. */ }
}

export function saveAgendaDeviceToken(value: string): void {
  if (/^[a-f0-9]{64}$/.test(value)) try { localStorage.setItem(AGENDA_DEVICE_KEY, value) } catch { /* O cookie continua disponível. */ }
}

export function clearAppInstallationToken(): void { try { localStorage.removeItem(APP_INSTALLATION_KEY) } catch { /* Sem armazenamento local. */ } }
export function clearAgendaDeviceToken(): void { try { localStorage.removeItem(AGENDA_DEVICE_KEY) } catch { /* Sem armazenamento local. */ } }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export function setCsrfToken(value: string): void {
  csrfToken = value
}

export function clearCsrfToken(): void {
  csrfToken = ''
}

export async function apiJson<T>(name: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (typeof localStorage !== 'undefined') {
    try {
      const installation = localStorage.getItem(APP_INSTALLATION_KEY)
      const agendaDevice = localStorage.getItem(AGENDA_DEVICE_KEY)
      if (installation && /^[a-f0-9]{64}$/.test(installation)) headers.set('x-noroeste-installation', installation)
      if (agendaDevice && /^[a-f0-9]{64}$/.test(agendaDevice)) headers.set('x-noroeste-device', agendaDevice)
    } catch { /* A API ainda pode usar o cookie. */ }
  }
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (init.method && init.method !== 'GET' && csrfToken) headers.set('x-noroeste-csrf', csrfToken)
  const controller = new AbortController()
  const abort = (): void => controller.abort(init.signal?.reason)
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once:true })
  // Limite apenas leituras: uma escrita lenta pode ter sido aplicada no servidor.
  let timedOut = false
  const timer = (!init.method || init.method.toUpperCase() === 'GET')
    ? setTimeout(() => { timedOut = true; controller.abort() }, 15_000)
    : undefined
  try {
    const response = await fetch(`/.netlify/functions/${name}`, { ...init, signal:controller.signal, headers, credentials:'include' })
    const value = await response.json().catch(error => {
      if (controller.signal.aborted) throw error
      return {}
    }) as Record<string, unknown>
    if (!response.ok) throw new ApiError(String(value['error'] ?? 'Operacao indisponivel.'), response.status)
    return value as T
  } catch (error) {
    if (timedOut) throw new ApiError('A conexão demorou demais. Tente novamente.', 408)
    throw error
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32_768
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export async function uploadPdf(path: string, bytes: Uint8Array): Promise<string> {
  const response = await apiJson<{ url: string }>('storage-file', { method:'POST', body:JSON.stringify({ path, base64:bytesToBase64(bytes) }) })
  return response.url
}

export async function deleteStoredFile(path: string): Promise<void> {
  await apiJson('storage-file', { method:'DELETE', body:JSON.stringify({ path }) })
}
