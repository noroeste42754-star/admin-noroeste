import type { AppPermissions, Usuario } from '../../src/types.ts'
import { adminDatabase } from './subscription-store.ts'

const APP_COOKIE = 'noroeste_session'
const DEVICE_COOKIE = 'noroeste_device'
// Browsers cap persistent cookies; the server-side installation has no deadline.
const INSTALLATION_COOKIE_MS = 400 * 24 * 60 * 60 * 1000
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const ATTEMPT_BLOCK_MS = 30 * 1000
const MAX_ATTEMPTS = 5

interface SafeUser extends Omit<Usuario, 'senha'> { senha: '' }
export interface AppSession { token: string; csrf: string; uid: string; expiresAt?: number; usuario: SafeUser }
export interface DeviceSession { token: string; masterId: string; installationId: string; expiresAt?: number; revoked?: boolean }
interface LoginAttempt { count: number; firstAt: number; blockedUntil: number; expiresAt: number }

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return Array.from(value, item => item.toString(16).padStart(2, '0')).join('')
}

function cookieValue(request: Request, name: string): string {
  const cookies = request.headers.get('cookie') ?? ''
  for (const item of cookies.split(';')) {
    const [key, ...parts] = item.trim().split('=')
    if (key === name) return decodeURIComponent(parts.join('='))
  }
  return ''
}

async function secureEquals(left: string, right: string): Promise<boolean> {
  const encode = (value: string): ArrayBuffer => new TextEncoder().encode(value).buffer as ArrayBuffer
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(left)),
    crypto.subtle.digest('SHA-256', encode(right)),
  ])
  const first = new Uint8Array(leftHash), second = new Uint8Array(rightHash)
  let difference = first.length ^ second.length
  for (let index = 0; index < first.length; index += 1) difference |= first[index]! ^ second[index]!
  return difference === 0
}

async function attemptKey(request: Request, scope: string): Promise<string> {
  const address = (request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 80)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}|${address}`).buffer as ArrayBuffer)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function loginAttemptAllowed(request: Request, scope: string): Promise<boolean> {
  const key = await attemptKey(request, scope), snapshot = await adminDatabase().ref(`autenticacaoTentativasPrivadas/${key}`).get()
  if (!snapshot.exists()) return true
  const attempt = snapshot.val() as LoginAttempt
  return !attempt.blockedUntil || attempt.blockedUntil <= Date.now()
}

export async function recordLoginFailure(request: Request, scope: string): Promise<void> {
  const key = await attemptKey(request, scope), now = Date.now()
  await adminDatabase().ref(`autenticacaoTentativasPrivadas/${key}`).transaction(current => {
    const previous = (current ?? {}) as Partial<LoginAttempt>
    const firstAt = Number(previous.firstAt) > now - ATTEMPT_WINDOW_MS ? Number(previous.firstAt) : now
    const count = firstAt === now ? 1 : Math.max(0, Number(previous.count) || 0) + 1
    return { count, firstAt, blockedUntil:count >= MAX_ATTEMPTS ? now + ATTEMPT_BLOCK_MS : 0, expiresAt:now + ATTEMPT_WINDOW_MS }
  }, undefined, false)
}

export async function clearLoginFailures(request: Request, scope: string): Promise<void> {
  const key = await attemptKey(request, scope)
  await adminDatabase().ref(`autenticacaoTentativasPrivadas/${key}`).remove()
}

export function renewDeviceCookie(session:DeviceSession):string {
  return secureCookie(DEVICE_COOKIE,session.token,INSTALLATION_COOKIE_MS)
}

export function renewAppCookie(session:AppSession):string {
  return secureCookie(APP_COOKIE,session.token,INSTALLATION_COOKIE_MS)
}

function safeUser(user: Usuario): SafeUser {
  return {
    nome:String(user.nome ?? ''), senha:'', ativo:user.ativo === true,
    apps:Object.fromEntries(['mestre', 'tarefas', 'oradores', 'limpeza', 'escala', 'servicoCampo', 'individual'].map(key => [key, user.apps?.[key as keyof AppPermissions] === true])) as unknown as AppPermissions,
    ...(user.masterId ? { masterId:user.masterId } : {}),
  }
}

function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge / 1000))}; HttpOnly; Secure; SameSite=Lax`
}

export const clearAppCookie = (): string => secureCookie(APP_COOKIE, '', 0)
export const clearDeviceCookie = (): string => secureCookie(DEVICE_COOKIE, '', 0)

export async function verifyPassword(uid: string, password: string): Promise<{ uid: string; usuario: SafeUser } | null> {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(uid) || !password || password.length > 200) return null
  const snapshot = await adminDatabase().ref(`usuarios/${uid}`).get()
  if (!snapshot.exists()) return null
  const user = snapshot.val() as Usuario
  if (!user.ativo || typeof user.senha !== 'string' || !await secureEquals(user.senha, password)) return null
  return { uid, usuario:safeUser(user) }
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  if (!password || password.length > 200) return false
  const snapshot = await adminDatabase().ref('usuarios').get()
  if (!snapshot.exists()) return false
  const administrators = Object.values(snapshot.val() as Record<string, Usuario>).filter(user => user.ativo && user.apps?.mestre === true && typeof user.senha === 'string')
  return (await Promise.all(administrators.map(user => secureEquals(user.senha, password)))).some(Boolean)
}

export async function createAppSession(uid: string, usuario: SafeUser): Promise<{ session: AppSession; cookie: string }> {
  const token = randomHex(32)
  const session: AppSession = { token, csrf:randomHex(24), uid, usuario }
  await adminDatabase().ref(`appSessoesPrivadas/${token}`).set(session)
  return { session, cookie:renewAppCookie(session) }
}

export async function appSession(request: Request): Promise<AppSession | null> {
  const candidates=[...new Set([request.headers.get('x-noroeste-installation'),cookieValue(request, APP_COOKIE)].filter((token):token is string=>Boolean(token)))]
  for(const token of candidates) {
    if (!/^[a-f0-9]{64}$/.test(token)) continue
    const snapshot = await adminDatabase().ref(`appSessoesPrivadas/${token}`).get()
    if (!snapshot.exists()) continue
    const session = snapshot.val() as AppSession
    if (session.token !== token) continue
    const userSnapshot = await adminDatabase().ref(`usuarios/${session.uid}`).get()
    if (!userSnapshot.exists()) continue
    const user = userSnapshot.val() as Usuario
    if (!user.ativo) continue
    return { ...session, usuario:safeUser(user) }
  }
  return null
}

export async function destroyAppSession(request: Request): Promise<void> {
  const candidates=[...new Set([request.headers.get('x-noroeste-installation'),cookieValue(request, APP_COOKIE)])]
  await Promise.all(candidates.filter((token):token is string=>Boolean(token && /^[a-f0-9]{64}$/.test(token))).map(token=>adminDatabase().ref(`appSessoesPrivadas/${token}`).remove()))
}

export function validCsrf(request: Request, session: AppSession): boolean {
  return request.headers.get('x-noroeste-csrf') === session.csrf
}

export async function createDeviceSession(masterId: string, installationId: string): Promise<{ session: DeviceSession; cookie: string }> {
  const token = randomHex(32)
  const session: DeviceSession = { token, masterId, installationId }
  await adminDatabase().ref(`agendaDispositivosPrivados/${token}`).set(session)
  return { session, cookie:renewDeviceCookie(session) }
}

export async function deviceSession(request: Request): Promise<DeviceSession | null> {
  const session = await deviceSessionRecord(request)
  return session && !session.revoked ? session : null
}

export async function deviceSessionRecord(request: Request): Promise<DeviceSession | null> {
  const candidates=[...new Set([request.headers.get('x-noroeste-device'),cookieValue(request, DEVICE_COOKIE)].filter((token):token is string=>Boolean(token)))]
  for(const token of candidates) {
    if (!/^[a-f0-9]{64}$/.test(token)) continue
    const snapshot = await adminDatabase().ref(`agendaDispositivosPrivados/${token}`).get()
    if (!snapshot.exists()) continue
    const session = snapshot.val() as DeviceSession
    if (session.token === token) return session
  }
  return null
}

export async function destroyDeviceSession(request: Request): Promise<void> {
  const candidates=[...new Set([request.headers.get('x-noroeste-device'),cookieValue(request, DEVICE_COOKIE)])]
  await Promise.all(candidates.filter((token):token is string=>Boolean(token && /^[a-f0-9]{64}$/.test(token))).map(token=>adminDatabase().ref(`agendaDispositivosPrivados/${token}`).remove()))
}

export const json = (status: number, value: unknown, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(value), {
  status,
  headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers },
})

export async function objectBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json() as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch { return {} }
}
