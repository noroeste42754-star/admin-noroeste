import { getStore } from '@netlify/blobs'
import { activityEntry,appendActivity } from '../lib/activity.ts'
import { appSession,json,objectBody,validCsrf } from '../lib/secure-session.ts'
import { adminDatabase } from '../lib/subscription-store.ts'
import { sourceHash,publicationVersion,transitionPublication } from '../lib/publication-transition.ts'
import { publicationPeriod,periodIsPublished,publicationIssues,stableValue } from '../../src/modules/publication-contract.ts'
import { PUBLIC_PDF_MODULES,officialDocumentId,type PublicPdfModule } from '../../src/modules/agenda-documents-domain.ts'
import { validStoragePath } from './storage-file.ts'
import { pdfHasExpired } from '../../src/modules/pdf-expiry.ts'

export default async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return json(405,{error:'Método não permitido.'})
  try {
    const session=await appSession(request)
    if(!session||!validCsrf(request,session))return json(403,{error:'Sessão inválida.'})
    const body=await objectBody(request), module=body['module'] as PublicPdfModule,id=String(body['periodId']??''),action=body['action']
    if(!PUBLIC_PDF_MODULES.includes(module)||!/^\d{4}-(0[1-9]|1[0-2])(?:-bimester)?$/.test(id))return json(400,{error:'Período inválido.'})
    if(!session.usuario.apps.mestre&&!session.usuario.apps[module]&&!(module==='oradores'&&session.usuario.apps.oradoresS1))return json(403,{error:'Acesso negado.'})
    const database=adminDatabase(),key=officialDocumentId(module,id)
    if(action==='prepare'||action==='status') {
      const root:Record<string,any>={master:{}}
      const paths=['master/pessoas','master/config',module==='oradores'||module==='tarefas'?'tarefas':module,'agenda/documentos']
      await Promise.all(paths.map(async path=>{
        const value=(await database.ref(path).get()).val(),parts=path.split('/')
        if(parts.length===1)root[path]=value??{}
        else {root[parts[0]]??={};root[parts[0]][parts[1]]=value??{}}
      }))
      if(module==='tarefas')root.tarefas={people:root.tarefas?.people??{},scale:root.tarefas?.scale??{}}
      if(module==='oradores')root.tarefas={people:root.tarefas?.people??{},discursos:root.tarefas?.discursos??{}}
      if(action==='status'){
        const current=root.agenda?.documentos?.[key]
        return json(200,{hash:sourceHash(root,module,id),document:current&&!pdfHasExpired(current.criadoEm)?current:null,published:periodIsPublished(root,module,id)})
      }
      if(stableValue(publicationPeriod(root,module,id))!==stableValue(body['expectedPeriod']))return json(409,{error:'O período mudou. Reabra o módulo e confira os dados antes de publicar.'})
      const issues=body['reopen']?[]:publicationIssues(root,module,id)
      if(issues.length)return json(409,{error:issues.join(' ')})
      return json(200,{root,hash:sourceHash(root,module,id),version:publicationVersion(root,module,id),previous:root.agenda?.documentos?.[key]??null})
    }
    if(action!=='commit')return json(400,{error:'Operação inválida.'})
    if(typeof body['version']!=='string'||!body['version'])return json(400,{error:'Versão ausente.'})
    const document=body['document'] as Record<string,unknown>|null
    if(document) {
      const path=String(document['storagePath']??'')
      if(!validStoragePath(path)||!path.startsWith(`agenda/documentos/modulos/${module}/`)||document['id']!==key||document['modulo']!==module||document['origemPeriodoId']!==id||document['sourceHash']!==body['hash'])return json(400,{error:'Documento inválido.'})
      const file=await getStore('admin-noroeste-pdfs',{consistency:'strong'}).get(path,{type:'arrayBuffer'})
      if(!file)return json(409,{error:'O arquivo ainda não está disponível. Tente novamente.'})
      document['url']=`${new URL(request.url).origin}/.netlify/functions/storage-file?path=${encodeURIComponent(path)}`
      document['tipo']='modulo'
    }
    const entry=activityEntry(session,document?'publicar':'reabrir',`${module}/${id}`,module)
    let applied=false
    const result=await database.ref('/').transaction(current=>{
      // A cold Firebase transaction can initially see null; let the server retry.
      if(current===null){applied=false;return null}
      const next=transitionPublication(current,module,id,String(body['hash']??''),body['previous'],document,String(body['version']??''))
      applied=next!==undefined
      return appendActivity(current,next,entry)
    },undefined,false)
    if(!result.committed||!applied)return json(409,{error:'Os dados ou a publicação mudaram. A versão anterior foi preservada. Reabra o módulo e confira.'})
    return json(200,{ok:true,document})
  } catch {return json(503,{error:'Não foi possível concluir a publicação. Reabra o módulo para conferir o resultado antes de tentar novamente.'})}
}
