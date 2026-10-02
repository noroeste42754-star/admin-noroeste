import { conditionalPatch, conditionalValue } from './conditional-write.ts'
import { guardedModulePath, guardedModuleWrite } from './published-write.ts'
import { deleteUnreferencedMasterPerson } from './master-person-delete.ts'
import { activeData,preserveArchivedTasks } from './retired-data.ts'
import { appendActivity } from './activity.ts'
import { preservesSpeakerCongregations } from '../../src/modules/oradores-congregations.ts'
import { pathModule, type ActivityEntry } from '../../src/modules/activity-domain.ts'
import type { PublicationRoot } from '../../src/modules/publication-contract.ts'

const read=(root:PublicationRoot,path:string):any=>path?path.split('/').reduce((item,key)=>item?.[key]??null,root):root

/** Data and audit metadata commit together; callbacks are pure and retry-safe. */
export function auditedWrite(current:PublicationRoot,path:string,method:string,value:unknown,hasExpected:boolean,expected:unknown,entry:ActivityEntry):PublicationRoot|undefined {
  let next:PublicationRoot|undefined
  if(guardedModulePath(path))next=guardedModuleWrite(current,path,method,value,hasExpected,expected)
  else if(method==='DELETE'&&/^master\/pessoas\/[^/]+$/.test(path))next=deleteUnreferencedMasterPerson(current,path.split('/')[2]) as PublicationRoot|undefined
  else if(!path&&method==='PATCH') {
    if(!value||typeof value!=='object'||Array.isArray(value))return undefined
    const patch=value as Record<string,unknown>
    const baseline=Object.fromEntries(Object.keys(patch).map(key=>[key,read(current,key)]))
    // Admin backup restoration intentionally replaces operational areas, but never private roots.
    const restored=Object.prototype.hasOwnProperty.call(patch,'tarefas')?{...patch,tarefas:preserveArchivedTasks(current.tarefas,patch.tarefas)}:patch
    next=conditionalPatch(current,baseline,restored) as PublicationRoot|undefined
    return appendActivity(current,next,{...entry,module:'mestre',paths:Object.keys(patch).slice(0,30)})
  } else {
    const before=read(current,path)
    let proposed:unknown
    if(method==='DELETE')proposed=null
    else if(method==='PATCH') {
      if(!value||typeof value!=='object'||Array.isArray(value))return undefined
      const patch=value as Record<string,unknown>
      const baseline=hasExpected?expected:Object.fromEntries(Object.keys(patch).map(key=>[key,read(before,key)]))
      proposed=conditionalPatch(before,baseline as Record<string,unknown>,patch)
    } else proposed=hasExpected?conditionalValue(before,expected,value??null):value??null
    if(proposed===undefined)return undefined
    next=structuredClone(current)
    const keys=path.split('/'),leaf=keys.pop()!
    let parent=next
    for(const key of keys)parent=(parent[key]??={})
    if(proposed===null)delete parent[leaf];else parent[leaf]=proposed
  }
  if(!next)return undefined
  if(!preservesSpeakerCongregations(current.tarefas?.discursos??{},next.tarefas?.discursos??{}))return undefined
  // Use changed leaf paths (not values) to split mixed Tarefas/Oradores writes.
  const paths=method==='PATCH'&&value&&typeof value==='object'
    ? Object.keys(value).map(key=>[path,key].filter(Boolean).join('/')) : [path]
  const groups=new Map<string,string[]>()
  for(const changed of paths) {
    if(JSON.stringify(activeData(changed,read(current,changed)))===JSON.stringify(activeData(changed,read(next,changed))))continue
    const module=entry.module!==pathModule(path)?entry.module:pathModule(changed)
    groups.set(module,[...(groups.get(module)??[]),changed])
  }
  for(const [module,changed] of groups)next=appendActivity(current,next,{...entry,module:module as ActivityEntry['module'],paths:changed.slice(0,30)})!
  return next
}
