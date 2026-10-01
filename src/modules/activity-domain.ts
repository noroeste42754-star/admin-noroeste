import type { AppPermissions, ModuleName } from '../types.ts'

export const ACTIVITY_MODULES: ModuleName[] = ['mestre','tarefas','oradores','escala']
export interface ActivityEntry {
  id:string; at:string; actorId:string; actorName:string; module:ModuleName
  action:'alterar'|'remover'|'publicar'|'reabrir'; paths:string[]
}
export function activityAllowed(apps:AppPermissions,module:string):boolean {
  return ACTIVITY_MODULES.includes(module as ModuleName) && (apps.mestre || apps[module as keyof AppPermissions] === true || module==='oradores' && apps.oradoresS1===true)
}
export function pathModule(path:string):ModuleName {
  const messaging=path.match(/^agenda\/config\/moduleWhatsApp\/(tarefas|oradores|limpeza|escala|servicoCampo)(\/|$)/)?.[1]
  if(messaging)return messaging as ModuleName
  if (/^tarefas\/(discursos|events)(\/|$)/.test(path)) return 'oradores'
  if (/^master\/config\/limpeza(\/|$)/.test(path)) return 'limpeza'
  const root=path.split('/')[0]
  return ACTIVITY_MODULES.includes(root as ModuleName) ? root as ModuleName : 'mestre'
}
