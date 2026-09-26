import type { MasterPessoa } from '../../src/types.ts'
import { adminDatabase } from '../lib/subscription-store.ts'
import { clearDeviceCookie, clearLoginFailures, createDeviceSession, destroyDeviceSession, deviceSessionRecord, json, loginAttemptAllowed, objectBody, recordLoginFailure, renewDeviceCookie, verifyAdminPassword, type DeviceSession } from '../lib/secure-session.ts'

type PeopleLoader = () => Promise<Record<string, MasterPessoa>>
type SessionCreator = (masterId:string, installationId:string) => Promise<{session:DeviceSession;cookie:string}>
type PublicPerson = Pick<MasterPessoa,'name'|'active'>
const loadPeople:PeopleLoader = async () => (await adminDatabase().ref('master/pessoas').get()).val() ?? {}
const publicPeople = (people:Record<string,MasterPessoa>):Record<string,PublicPerson> => Object.fromEntries(Object.entries(people).filter(([,person])=>person?.active!==false&&typeof person?.name==='string'&&person.name.trim()).map(([id,person])=>[id,{name:person.name.trim(),active:true}]))

export async function agendaDeviceResponse(request: Request, resolveSession = deviceSessionRecord, readPeople:PeopleLoader = loadPeople, createSession:SessionCreator = createDeviceSession, destroySession = destroyDeviceSession): Promise<Response> {
  if (request.method === 'GET') {
    try {
      const paired = await resolveSession(request)
      if(paired?.revoked)return json(410,{error:'Esta agenda não recebe mais atualizações.'})
      const people=publicPeople(await readPeople())
      if (paired && !people[paired.masterId]) return json(410,{error:'Esta agenda não recebe mais atualizações.'})
      if (!paired) return json(200,{people,masterId:''})
      return json(200, { people, masterId:paired.masterId, deviceToken:paired.token }, {'set-cookie':renewDeviceCookie(paired)})
    } catch { return json(503, { error:'Não foi possível carregar as pessoas.' }) }
  }
  if (request.method === 'POST') {
    const body = await objectBody(request)
    const masterId = String(body['masterId'] ?? ''), installationId = String(body['installationId'] ?? '')
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(masterId) || !/^[a-f0-9]{32,64}$/.test(installationId)) return json(400, { error:'Pessoa ou instalação inválida.' })
    try {
      const previous = await resolveSession(request)
      if(previous?.revoked)return json(410,{error:'Esta agenda não recebe mais atualizações.'})
      if (previous?.masterId === masterId && previous.installationId === installationId) return json(200, { masterId, deviceToken:previous.token })
      if (previous) return json(403,{error:'Para trocar de pessoa, informe a senha Admin no aplicativo.'})
      const people=publicPeople(await readPeople())
      if (!people[masterId]) return json(400,{error:'Selecione uma pessoa ativa.'})
      const created=await createSession(masterId,installationId)
      return json(200,{masterId,deviceToken:created.session.token},{'set-cookie':created.cookie})
    } catch (error) { console.error('Agenda person selection failed:', error instanceof Error ? error.message : 'Unknown error'); return json(503, { error:'Não foi possível abrir esta agenda.' }) }
  }
  if (request.method === 'DELETE') {
    const body=await objectBody(request),scope='agenda-admin'
    try {
      if(!await loginAttemptAllowed(request,scope))return json(429,{error:'Muitas tentativas. Aguarde 30 segundos.'})
      if(!await verifyAdminPassword(String(body['adminPassword']??''))){await recordLoginFailure(request,scope);return json(401,{error:'Senha Admin inválida.'})}
      await clearLoginFailures(request,scope);await destroySession(request)
      return json(200,{ok:true},{'set-cookie':clearDeviceCookie()})
    }catch{return json(503,{error:'Não foi possível liberar a troca de pessoa.'})}
  }
  return json(405, { error:'Método não permitido.' })
}

export default (request: Request): Promise<Response> => agendaDeviceResponse(request)
