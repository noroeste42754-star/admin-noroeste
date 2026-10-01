import { adminDatabase } from './subscription-store.ts'

const AGENDA_SOURCE_PATHS:Record<string,string[]>={
  tarefas:['tarefas/people','tarefas/scale/periods','tarefas/discursos/congregacoes'],
  oradores:['tarefas/people','tarefas/discursos'],
  escala:['escala/participants','escala/scales','escala/tables','escala/publishedMonth','escala/publishedMonths','escala/settings'],
  geral:['tarefas/events'],
  quadro:['agenda/config','agenda/documentos'],
}
export async function loadPartialAgendaRoot(sources=Object.keys(AGENDA_SOURCE_PATHS),read:(path:string)=>Promise<unknown>=async path=>(await adminDatabase().ref(path).get()).val()) {
  const root:Record<string,any>={master:{}}
  const completedSources:string[]=[],failedSources:string[]=[],reads=new Map<string,Promise<unknown>>()
  await Promise.all(sources.filter(source=>Object.prototype.hasOwnProperty.call(AGENDA_SOURCE_PATHS,source)).map(async source=>{
    try {
      const paths=[...AGENDA_SOURCE_PATHS[source],...(['tarefas','oradores','escala'].includes(source)?['master/pessoas']:[]),...(source==='tarefas'?['master/config']:[])]
      const values=await Promise.all(paths.map(path=>{if(!reads.has(path))reads.set(path,read(path));return reads.get(path)!}))
      paths.forEach((path,index)=>{const keys=path.split('/');let parent=root;for(const key of keys.slice(0,-1))parent=(parent[key]??={});parent[keys[keys.length-1]]=values[index]??null})
      completedSources.push(source)
    }catch{failedSources.push(source)}
  }))
  return {root,completedSources,failedSources}
}

const PATHS = [
  'master/pessoas', 'master/config', 'tarefas/people', 'tarefas/scale/periods', 'tarefas/discursos',
  'tarefas/planning', 'tarefas/events', 'escala/participants', 'escala/scales', 'escala/tables',
  'escala/settings', 'escala/publishedMonth', 'escala/publishedMonths',
  'escala/publishedSnapshots', 'agenda/config', 'agenda/documentos',
] as const

export async function loadAgendaRoot(
  read: (path: string) => Promise<unknown> = async path => {
    const snapshot = await adminDatabase().ref(path).get()
    return snapshot.exists() ? snapshot.val() as unknown : undefined
  },
): Promise<Record<string, unknown>> {
  const values = await Promise.all(PATHS.map(read))
  const root: Record<string, unknown> = {}
  PATHS.forEach((path, index) => {
    const keys = path.split('/')
    let parent = root
    for (const key of keys.slice(0, -1)) parent = (parent[key] ??= {}) as Record<string, unknown>
    parent[keys[keys.length - 1]] = values[index]
  })
  return root
}
