import type { Usuario } from './types'
import { sanitizeCachedUserChoices, type CachedUserChoices } from './auth-domain'
import { apiJson, clearAppInstallationToken, clearCsrfToken, saveAppInstallationToken, setCsrfToken } from './secure-api.ts'

const USER_CHOICES_KEY = 'noroeste_user_choices'

export interface AuthenticatedSession { uid: string; usuario: Usuario; csrf: string; installationToken?: string }

function validSession(value: AuthenticatedSession): boolean {
  return Boolean(value && typeof value.uid === 'string' && /^[a-f0-9]{48}$/.test(value.csrf) && value.usuario && value.usuario.ativo === true && typeof value.usuario.nome === 'string' && value.usuario.apps && typeof value.usuario.apps === 'object')
}

export async function loadUsuarios(): Promise<CachedUserChoices> {
  const choices = sanitizeCachedUserChoices(await apiJson<CachedUserChoices>('auth-users'))
  localStorage.setItem(USER_CHOICES_KEY, JSON.stringify(choices))
  return choices
}

export function loadCachedUserChoices(): CachedUserChoices {
  try {
    const choices = sanitizeCachedUserChoices(JSON.parse(localStorage.getItem(USER_CHOICES_KEY) ?? '{}'))
    localStorage.setItem(USER_CHOICES_KEY, JSON.stringify(choices))
    return choices
  } catch {
    localStorage.removeItem(USER_CHOICES_KEY)
    return {}
  }
}

function acceptSession(session: AuthenticatedSession): AuthenticatedSession {
  if (!validSession(session)) throw new Error('Resposta de sessão inválida.')
  setCsrfToken(session.csrf)
  if (session.installationToken) saveAppInstallationToken(session.installationToken)
  return session
}

export async function authenticate(uid: string, senha: string): Promise<AuthenticatedSession> {
  return acceptSession(await apiJson<AuthenticatedSession>('auth-session', { method:'POST', body:JSON.stringify({ uid, senha }) }))
}

export async function restoreSession(): Promise<AuthenticatedSession | null> {
  try {
    const result=await apiJson<AuthenticatedSession>('auth-session')
    if(validSession(result))return acceptSession(result)
    clearAppInstallationToken()
    const fallback=await apiJson<AuthenticatedSession>('auth-session')
    return validSession(fallback)?acceptSession(fallback):null
  } catch { clearCsrfToken(); return null }
}

export async function logout(): Promise<void> {
  try { await apiJson('auth-session', { method:'DELETE' }) }
  catch { /* A tela ainda deve encerrar localmente quando a rede cair. */ }
  finally { clearCsrfToken(); clearAppInstallationToken() }
}
