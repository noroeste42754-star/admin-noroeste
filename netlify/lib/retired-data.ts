// Archived data is kept until the separate deletion proposal is approved.
const RETIRED_ROOTS = new Set(['programacao', 'secretario', 'oradores', 'limpeza', 'servicoCampo'])
const RETIRED_TASK_KEYS = new Set<string>()
const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function isRetiredPath(path: string): boolean {
  const [root, child] = path.split('/')
  return RETIRED_ROOTS.has(root) || (root === 'tarefas' && RETIRED_TASK_KEYS.has(child))
}

export function activeData(path: string, value: unknown): unknown {
  if (isRetiredPath(path)) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!path) return Object.fromEntries(Object.entries(row(value)).filter(([key]) => !RETIRED_ROOTS.has(key)).map(([key, item]) => [key, activeData(key, item)]))
  if (path === 'tarefas') return Object.fromEntries(Object.entries(row(value)).filter(([key]) => !RETIRED_TASK_KEYS.has(key)))
  return value
}

export function preserveArchivedTasks(current: unknown, replacement: unknown): Record<string, unknown> | null {
  const archived = Object.fromEntries(Object.entries(row(current)).filter(([key]) => RETIRED_TASK_KEYS.has(key)))
  const next = { ...row(activeData('tarefas', replacement)), ...archived }
  return Object.keys(next).length ? next : null
}
