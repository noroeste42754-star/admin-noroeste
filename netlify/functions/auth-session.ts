import { appSession, clearAppCookie, clearLoginFailures, createAppSession, destroyAppSession, json, loginAttemptAllowed, objectBody, recordLoginFailure, renewAppCookie, verifyPassword } from '../lib/secure-session.ts'

export default async (request: Request): Promise<Response> => {
  if (request.method === 'GET') {
    try {
      const session = await appSession(request)
      return session ? json(200, { uid:session.uid, usuario:session.usuario, csrf:session.csrf, installationToken:session.token }, { 'set-cookie':renewAppCookie(session) }) : json(200, { authenticated:false }, { 'set-cookie':clearAppCookie() })
    } catch { return json(503, { error:'Não foi possível validar a sessão.' }) }
  }
  if (request.method === 'POST') {
    const body = await objectBody(request)
    try {
      const uid = String(body['uid'] ?? ''), password = String(body['senha'] ?? '')
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(uid) || !password || password.length > 200) return json(401, { error:'Usuário ou senha inválidos.' })
      const scope = `app:${uid}`
      if (!await loginAttemptAllowed(request, scope)) return json(429, { error:'Muitas tentativas. Aguarde 30 segundos.' })
      const authenticated = await verifyPassword(uid, password)
      if (!authenticated) { await recordLoginFailure(request, scope); return json(401, { error:'Usuário ou senha inválidos.' }) }
      await clearLoginFailures(request, scope)
      const created = await createAppSession(authenticated.uid, authenticated.usuario)
      return json(200, { uid:authenticated.uid, usuario:authenticated.usuario, csrf:created.session.csrf, installationToken:created.session.token }, { 'set-cookie':created.cookie })
    } catch { return json(503, { error:'Não foi possível iniciar a sessão.' }) }
  }
  if (request.method === 'DELETE') {
    try { await destroyAppSession(request) } catch { /* O cookie local ainda deve ser removido. */ }
    return json(200, { ok:true }, { 'set-cookie':clearAppCookie() })
  }
  return json(405, { error:'Método não permitido.' })
}
