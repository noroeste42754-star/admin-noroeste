import { json } from '../lib/secure-session.ts'
import { loadPartialAgendaRoot } from '../lib/agenda-root.ts'
import { publicAgendaConfig,publicAgendaDocuments,publicAnnouncementEvent } from '../lib/agenda-public.ts'
import { QUADRO_SOURCES,quadroEvents,quadroNotices } from '../../src/modules/quadro-domain.ts'

export async function quadroDataResponse(request:Request,load=loadPartialAgendaRoot):Promise<Response> {
  if(request.method!=='GET')return json(405,{error:'Método não permitido.'})
  try {
    const requested=new URL(request.url).searchParams.get('sources')?.split(',')
    if(requested&&(!requested.length||requested.some(s=>!QUADRO_SOURCES.some(active=>active===s))))return json(400,{error:'Fonte inválida.'})
    const {root,completedSources,failedSources}=await load(requested??[...QUADRO_SOURCES])
    const config=publicAgendaConfig(root.agenda?.config)
    // Only the public board's group/template is shared, not each manager's settings.
    const boardConfig={...config,moduleWhatsApp:config.moduleWhatsApp?.quadro?{quadro:config.moduleWhatsApp.quadro}:{},icsReminders:Object.fromEntries(Object.entries(config.icsReminders??{}).filter(([source])=>['tarefas','oradores','escala','quadro'].includes(source)))}
    const response=json(200,{
      events:quadroEvents(root,completedSources).map(publicAnnouncementEvent).filter(Boolean),
      notices:completedSources.includes('geral')?quadroNotices(root):[],
      agenda:{config:boardConfig,documentos:publicAgendaDocuments(root.agenda?.documentos)},completedSources,failedSources,
    })
    response.headers.set('Cache-Control','no-store')
    return response
  }catch{return json(503,{error:'Não foi possível atualizar o Quadro. Os dados salvos no aparelho podem ser consultados.'})}
}
export default(request:Request)=>quadroDataResponse(request)
