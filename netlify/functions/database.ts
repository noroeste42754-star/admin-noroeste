import { activeData } from '../lib/retired-data.ts'
import { activityEntry } from '../lib/activity.ts'
import { auditedWrite } from '../lib/audited-write.ts'
import { appSession, json, objectBody, validCsrf } from '../lib/secure-session.ts'
import { adminDatabase } from '../lib/subscription-store.ts'
import { readBatch } from '../lib/database-reads.ts'
import { validConditionalPatch } from '../lib/conditional-write.ts'
import { canAccessData, canMutateData, containsPrivateRoot, normalizeDataPath, withoutPrivateRoots } from '../lib/data-authorization.ts'
import { canMutateSpeakerSection } from '../lib/speaker-section-authorization.ts'
import { introducesSecondSectionConflict } from '../lib/second-section-conflicts.ts'

export async function databaseResponse(request:Request,database=adminDatabase,sessionFor=appSession):Promise<Response> {
  if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return json(405, { error:'Método não permitido.' })
  let session
  try { session = await sessionFor(request) } catch { return json(503, { error:'Sessão indisponível.' }) }
  if (!session) return json(401, { error:'Sessão expirada.' })
  const batchPaths = new URL(request.url).searchParams.get('paths')
  if (request.method === 'GET' && batchPaths !== null) {
    const results = await readBatch(batchPaths, session.usuario.apps, async path => {
      const snapshot = await database().ref(path || '/').get()
      return snapshot.exists() ? snapshot.val() as unknown : null
    })
    return results ? json(200, { results }) : json(400, { error:'Lote de leituras invalido.' })
  }
  const rawPath = new URL(request.url).searchParams.get('path') ?? ''
  const path = normalizeDataPath(rawPath)
  if (path === null) return json(400, { error:'Caminho inválido.' })
  const write = request.method !== 'GET'
  if (!canAccessData(path, session.usuario.apps, write)) return json(403, { error:'Acesso negado.' })
  if (write && !validCsrf(request, session)) return json(403, { error:'Validação da sessão ausente.' })

  try {
    const reference = database().ref(path || '/')
    if (request.method === 'GET') {
      const snapshot = await reference.get()
      const value = snapshot.exists() ? snapshot.val() as unknown : null
      return json(200, { value:path ? activeData(path, value) : withoutPrivateRoots(value) })
    }
    const body=request.method==='DELETE'?{}:await objectBody(request),value=body['value']
    if(!canMutateData(path,request.method,value,session.usuario.apps))return json(403,{error:'Alteração não autorizada.'})
    if(containsPrivateRoot(value))return json(400,{error:'Atualização contém caminhos privados.'})
    const hasExpected=Object.prototype.hasOwnProperty.call(body,'expected')
    if(hasExpected&&!path)return json(400,{error:'Selecione um registro para salvar.'})
    if(request.method==='PATCH'&&hasExpected&&!validConditionalPatch(body['expected'],value))return json(400,{error:'Alterações condicionais inválidas.'})
    const entry=activityEntry(session,request.method==='DELETE'?'remover':'alterar',path)
    let applied=false,deniedSection=false,deniedConflict=false
    const result=await database().ref('/').transaction(current=>{
      deniedSection=false;deniedConflict=false
      if(current===null){applied=false;return null}
      if(!canMutateSpeakerSection(current,path,request.method,value,session.usuario.apps)){deniedSection=true;applied=false;return undefined}
      const next=auditedWrite(current,path,request.method,value,hasExpected,body['expected'],entry)
      if(next!==undefined&&introducesSecondSectionConflict(current,next)){deniedConflict=true;applied=false;return undefined}
      applied=next!==undefined
      return next
    },undefined,false)
    return deniedConflict?json(409,{error:'A mesma pessoa não pode trabalhar nas duas seções.'}):deniedSection?json(403,{error:'Este registro pertence à outra seção.'}):result.committed&&applied?json(200,{ok:true}):json(409,{error:'O registro mudou, possui vínculos ou o período está publicado. Recarregue e confira antes de editar.'})
  } catch { return json(503, { error:'Operação de dados indisponível.' }) }
}
export default (request:Request)=>databaseResponse(request)
