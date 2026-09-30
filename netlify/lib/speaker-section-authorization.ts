import type { AppPermissions } from '../../src/types.ts'

type Section = 's1' | 's2'
type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function sectionFor(collection: string, value: unknown, speakers: Row, strict = true): Section | 'shared' | 'invalid' {
  const item = row(value)
  if (!Object.keys(item).length) return 'invalid'
  if (collection === 'oradores' || collection === 'congregacoes') {
    if (item['tipo'] === 'visitante') return 'shared'
    return item['secao'] === 's1' || item['secao'] === 's2' ? item['secao'] : 's2'
  }
  if (collection !== 'programacao') return 'shared'
  const section = item['secao'] === 's1' || item['secao'] === 's2' ? item['secao'] : 's2'
  const speaker = row(speakers[String(item['oradorId'] ?? '')])
  if (strict && item['oradorId'] && !Object.keys(speaker).length) return 'invalid'
  // Outgoing talks belong to the speaker's roster, including mislabeled legacy rows.
  if (!strict && item['tipo'] === 'saida_orador' && speaker['tipo'] === 'local') return speaker['secao'] === 's1' ? 's1' : 's2'
  if (strict && speaker['tipo'] === 'local' && (speaker['secao'] ?? 's2') !== section) return 'invalid'
  const secondary = row(speakers[String(item['oradorSecundarioId'] ?? '')])
  if (strict && item['oradorSecundarioId'] && !Object.keys(secondary).length) return 'invalid'
  if (strict && secondary['tipo'] === 'local' && (secondary['secao'] ?? 's2') !== section) return 'invalid'
  return section
}

/** Authorize every changed record, including deletions and full-map compare-and-set writes. */
export function canMutateSpeakerSection(current: unknown, path: string, method: string, value: unknown, apps: AppPermissions): boolean {
  if (apps.mestre) return true
  if (path === 'tarefas') return method === 'PATCH' && Object.keys(row(value)).every(key => !key.startsWith('discursos'))
  if (path === 'tarefas/events' || path.startsWith('tarefas/events/')) return Boolean(apps.oradores || apps.oradoresS1)
  if (path === 'tarefas/discursos') return false
  if (!path.startsWith('tarefas/discursos/')) return true
  const allowed = new Set<Section>([...(apps.oradoresS1 ? ['s1' as const] : []), ...(apps.oradores ? ['s2' as const] : [])])
  if (!allowed.size) return false
  const [, , collection, id] = path.split('/')
  if (!['oradores', 'congregacoes', 'programacao'].includes(collection ?? '')) return ['temas', 'historicoTemas'].includes(collection ?? '')
  if (path.split('/').length > 4) return false
  const talks = row(row(row(current)['tarefas'])['discursos'])
  const previousMap = row(talks[collection!])
  const speakers = row(talks['oradores'])
  const changes: Array<[unknown, unknown]> = []
  if (id) {
    const before = previousMap[id]
    const after = method === 'DELETE' ? null : method === 'PATCH' ? { ...row(before), ...row(value) } : value
    changes.push([before, after])
  } else if (method === 'PUT') {
    const proposed = row(value)
    for (const key of new Set([...Object.keys(previousMap), ...Object.keys(proposed)])) if (!equal(previousMap[key], proposed[key])) changes.push([previousMap[key], proposed[key]])
  } else if (method === 'PATCH') {
    for (const [key, after] of Object.entries(row(value))) {
      if (key.includes('/')) return false
      if (!equal(previousMap[key], after)) changes.push([previousMap[key], after])
    }
  } else return false
  return changes.every(([before, after]) => {
    const beforeSection=sectionFor(collection!, before, speakers, false),afterSection=sectionFor(collection!, after, speakers, true)
    if (before && after && ['oradores','congregacoes'].includes(collection!) && (beforeSection==='shared')!==(afterSection==='shared')) return false
    return [beforeSection, afterSection]
    .filter((_, index) => (index === 0 ? before : after) !== null && (index === 0 ? before : after) !== undefined)
    .every(section => section === 'shared' || allowed.has(section as Section))
  })
}
