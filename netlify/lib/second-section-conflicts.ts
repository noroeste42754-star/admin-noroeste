import { assignmentId } from '../../src/modules/tarefas-domain.ts'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''

function conflicts(value: unknown): Set<string> {
  const root = row(value), master = row(row(root['master'])['pessoas']), tasks = row(root['tarefas'])
  const people = row(tasks['people']), talks = row(tasks['discursos']), speakers = row(talks['oradores'])
  const memberships = new Map<string, Set<string>>(), work = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, key: string, section: string): void => {
    if (!key || !['s1', 's2'].includes(section)) return
    if (!map.has(key)) map.set(key, new Set())
    map.get(key)!.add(section)
  }
  const taskMaster = (id: string): string => text(row(people[id])['masterId']) || (master[id] ? id : '')
  const speakerMaster = (speaker: Row): string => text(speaker['masterId']) || taskMaster(text(speaker['pessoaId']))
  for (const raw of Object.values(people)) {
    const person = row(raw)
    if (person['active'] === false || person['rule'] === 'midweek') continue
    add(memberships, text(person['masterId']), text(person['weekendSection']))
  }
  for (const raw of Object.values(speakers)) {
    const speaker = row(raw)
    if (speaker['tipo'] !== 'local' || speaker['ativo'] === false) continue
    add(memberships, speakerMaster(speaker), speaker['secao'] === 's1' ? 's1' : 's2')
  }
  for (const rawPeriod of Object.values(row(row(tasks['scale'])['periods']))) {
    for (const rawMeeting of Object.values(row(row(rawPeriod)['meetings']))) {
      const meeting = row(rawMeeting), section = meeting['type'] === 'weekend_s1' ? 's1' : meeting['type'] === 'weekend' ? 's2' : ''
      const date = text(meeting['date'])
      if (!section || !date) continue
      for (const assignment of Object.values(row(meeting['assignments']))) {
        const masterId = taskMaster(assignmentId(assignment) || '')
        if (masterId) add(work, `${date}|${masterId}`, section)
      }
    }
  }
  for (const raw of Object.values(row(talks['programacao']))) {
    const item = row(raw), date = text(item['data'])
    if (!date) continue
    for (const id of [text(item['oradorId']), text(item['oradorSecundarioId'])]) {
      const speaker = row(speakers[id]), masterId = speakerMaster(speaker)
      if (speaker['tipo'] !== 'local' || !masterId) continue
      const section = item['tipo'] === 'saida_orador' ? speaker['secao'] : item['secao']
      add(work, `${date}|${masterId}`, section === 's1' ? 's1' : 's2')
    }
  }
  return new Set([
    ...[...memberships].filter(([, sections]) => sections.size > 1).map(([key]) => `membership|${key}`),
    ...[...work].filter(([, sections]) => sections.size > 1).map(([key]) => `assignment|${key}`),
  ])
}

/** Check inside the root transaction so concurrent editors cannot create a cross-section conflict. */
export function introducesSecondSectionConflict(current: unknown, next: unknown): boolean {
  const previous = conflicts(current)
  return [...conflicts(next)].some(key => !previous.has(key))
}
