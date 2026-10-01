import { activeData, isRetiredPath } from './retired-data.ts'
import type { AppPermissions } from '../../src/types.ts'

const PRIVATE_ROOTS = new Set(['historicoOperacionalPrivado', 'appSessoesPrivadas', 'agendaDispositivosPrivados', 'agendaPareamentosPrivados', 'agendaAssinaturasPrivadas', 'autenticacaoTentativasPrivadas', 'pendenciasMigracao'])

export function normalizeDataPath(value: string): string | null {
  const path = value.trim().replace(/^\/+|\/+$/g, '')
  if (!path) return ''
  if (path.length > 240 || path.split('/').some(part => !part || part === '.' || part === '..' || ['__proto__','prototype','constructor'].includes(part) || /[.#$\[\]]/.test(part))) return null
  return path
}

export function canAccessData(path: string, apps: AppPermissions, write: boolean): boolean {
  const [root, second, third, fourth] = path.split('/')
  if (isRetiredPath(path) || PRIVATE_ROOTS.has(root ?? '')) return false
  if (apps.mestre) return true
  if (!root) return false
  if (root === 'master') return !write && (second === 'pessoas' || second === 'config') && Boolean(apps.tarefas || apps.escala || apps.oradores || apps.oradoresS1)
  if (root === 'usuarios') return false
  if (root === 'tarefas') {
    if (second === 'events') return apps.oradores === true || apps.oradoresS1 === true || (!write && apps.tarefas === true)
    if (second === 'discursos') return apps.oradores === true || apps.oradoresS1 === true || (!write && apps.tarefas === true)
    if (second === 'planning' || second === 'people') return apps.tarefas === true || (!write && (apps.oradores === true || apps.oradoresS1 === true))
    if (!write && (apps.oradores === true || apps.oradoresS1 === true) && second === 'scale' && third === 'periods') return true
    if (apps.tarefas === true) return true
    return false
  }
  if (root === 'escala') return apps.escala === true
  if (root === 'agenda') {
    if (!apps.tarefas && !apps.oradores && !apps.oradoresS1 && !apps.escala) return false
    if (second === 'config') {
      if (!write) return true
      const messagePermissions: Record<string, keyof AppPermissions> = {
        tarefas:'tarefas', escala:'escala',
        oradores:'oradores',
        oradoresS1:'oradoresS1',
      }
      const permission = fourth ? messagePermissions[fourth] : undefined
      return third === 'moduleWhatsApp' && Boolean(permission && apps[permission])
    }
    if (second === 'documentos') return !write || Boolean(apps.tarefas || apps.oradores || apps.oradoresS1 || apps.escala)
  }
  return false
}

const DOCUMENT_PERMISSIONS: Record<string, keyof AppPermissions> = {
  tarefas:'tarefas', oradores:'oradores', escala:'escala',
}

function documentModule(id: string, value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const module = (value as Record<string, unknown>)['modulo']
    if (typeof module === 'string') return module
  }
  return id.match(/^modulo-(tarefas|oradores|limpeza|escala|servicoCampo)-/)?.[1] ?? (id.startsWith('admin-') ? 'admin' : '')
}

export function canMutateData(path: string, method: string, value: unknown, apps: AppPermissions): boolean {
  if (isRetiredPath(path) || (path === 'tarefas' && method === 'DELETE')) return false
  if (!path && method !== 'PATCH') return false
  if (method === 'PATCH' && value && typeof value === 'object' && Object.keys(value).some(key => isRetiredPath([path, key].filter(Boolean).join('/')))) return false
  if (path === 'tarefas' && !apps.mestre) {
    if (method !== 'PATCH' || !value || typeof value !== 'object' || Array.isArray(value)) return false
    return Object.keys(value as Record<string, unknown>).every(key => {
      const area = key.split('/')[0]
      return area === 'discursos' || area === 'events' ? apps.oradores === true || apps.oradoresS1 === true : apps.tarefas === true
    })
  }
  if (apps.mestre) return true
  if (path.startsWith('agenda/documentos/')) return false
  if (path !== 'agenda/documentos') return true
  if (method !== 'PATCH' || !value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value as Record<string, unknown>).every(([id, item]) => {
    const module = documentModule(id, item)
    const permission = DOCUMENT_PERMISSIONS[module]
    if (!permission || (apps[permission] !== true && !(module === 'oradores' && apps.oradoresS1 === true))) return false
    if (item === null) return id.startsWith(`modulo-${module}-`)
    const record = item as Record<string, unknown>
    return id.startsWith(`modulo-${module}-`) && record['tipo'] === 'modulo'
      && typeof record['storagePath'] === 'string'
      && record['storagePath'].startsWith(`agenda/documentos/modulos/${module}/`)
  })
}

export function withoutPrivateRoots(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return activeData('', Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !PRIVATE_ROOTS.has(key))))
}

export function containsPrivateRoot(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as Record<string, unknown>).some(key => PRIVATE_ROOTS.has(key.split('/')[0] ?? '')))
}
