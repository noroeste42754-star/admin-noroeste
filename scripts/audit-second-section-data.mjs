import fs from 'node:fs'
import crypto from 'node:crypto'

const paths = {
  current: 'C:/Users/eliau/Downloads/tpl-novo-2-default-rtdb-export.json',
  tasks: 'C:/Users/eliau/Downloads/oradores-tarefas-default-rtdb-export.json',
  scale: 'C:/Users/eliau/Downloads/escala-tpl-default-rtdb-export.json',
}
const read = path => JSON.parse(fs.readFileSync(path, 'utf8'))
const data = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]))
const hash = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const short = value => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean)
  return words.length > 1 ? `${words[0]} ${words.at(-1)}` : words[0] || ''
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const keys = obj => Object.keys(obj || {})
const nodeSummary = (current, legacy) => Object.fromEntries([...new Set([...keys(current), ...keys(legacy)])].map(key => [key, {
  current: keys(current?.[key]).length,
  legacy: keys(legacy?.[key]).length,
  equal: same(current?.[key], legacy?.[key]),
}]))

const master = data.current.master?.pessoas || {}
const currentScale = data.current.escala?.participants || {}
const oldScale = data.scale.participants || {}
const currentTasks = data.current.tarefas || {}
const oldTasks = data.tasks || {}
const masterNames = Object.entries(master).map(([id, person]) => ({ id, name: person.name, full: norm(person.name), short: norm(short(person.name)), phone: String(person.whatsapp || '').replace(/\D/g, '') }))
const phoneTail = value => String(value || '').replace(/\D/g, '').slice(-8)
const scaleMatches = Object.entries(oldScale).map(([id, person]) => {
  const name = norm(person.name)
  const full = masterNames.filter(item => item.full === name)
  const candidates = full.length ? full : masterNames.filter(item => item.short === name)
  const phoneMatches = phoneTail(person.phone) ? masterNames.filter(item => phoneTail(item.phone) === phoneTail(person.phone)) : []
  const first = norm(person.name).split(' ')[0]
  const firstMatches = masterNames.filter(item => item.full.split(' ')[0] === first)
  const timestampMatches = Object.entries(currentScale).filter(([, item]) => person.availabilityUpdatedAt && item.availabilityUpdatedAt === person.availabilityUpdatedAt).map(([id]) => ({ id, name:master[id]?.name }))
  const current = candidates.length === 1 ? currentScale[candidates[0].id] : undefined
  return {
    oldId: id, name: person.name, matchType: full.length ? 'full' : 'short',
    candidates: candidates.map(item => ({ id: item.id, name: item.name })),
    phoneMatches: phoneMatches.map(item => ({ id: item.id, name: item.name })),
    firstMatches: firstMatches.map(item => ({ id: item.id, name: item.name })),
    timestampMatches,
    currentExists: Boolean(current),
    differs: Boolean(current) && !same(person, current),
  }
})

const report = {
  sources: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256: hash(path), bytes: fs.statSync(path).size }])),
  counts: { master: keys(master).length, currentScale: keys(currentScale).length, oldScale: keys(oldScale).length, currentTasks: keys(currentTasks.people).length, oldTasks: keys(oldTasks.people).length },
  masterNames: { wouldShorten: masterNames.filter(item => item.name !== short(item.name)).length, oneWord: masterNames.filter(item => !String(item.name).trim().includes(' ')).map(item => ({ id: item.id, name: item.name })), duplicateShortNames: Object.entries(Object.groupBy(masterNames, item => item.short)).filter(([, values]) => values.length > 1).map(([name, values]) => ({ name, ids: values.map(item => item.id) })) },
  scaleMatches,
  scaleSummary: {
    uniqueMatched: scaleMatches.filter(item => item.candidates.length === 1).length,
    uniqueInCurrent: scaleMatches.filter(item => item.candidates.length === 1 && item.currentExists).length,
    ambiguous: scaleMatches.filter(item => item.candidates.length > 1),
    unmatched: scaleMatches.filter(item => item.candidates.length === 0),
    matchedMissingCurrent: scaleMatches.filter(item => item.candidates.length === 1 && !item.currentExists),
    unmatchedWithUniquePhone: scaleMatches.filter(item => item.candidates.length === 0 && item.phoneMatches.length === 1).map(item => ({ oldId:item.oldId, name:item.name, candidate:item.phoneMatches[0] })),
    unmatchedWithUniqueFirst: scaleMatches.filter(item => item.candidates.length === 0 && item.firstMatches.length === 1).map(item => ({ oldId:item.oldId, name:item.name, candidate:item.firstMatches[0] })),
    uniqueTimestamp: scaleMatches.filter(item => item.timestampMatches.length === 1).map(item => ({ oldId:item.oldId, name:item.name, candidate:item.timestampMatches[0] })),
  },
  tasksNodes: nodeSummary(currentTasks, oldTasks),
  scaleNodes: nodeSummary(data.current.escala, data.scale),
  taskPeopleById: {
    onlyCurrent: keys(currentTasks.people).filter(id => !(id in oldTasks.people)),
    onlyLegacy: keys(oldTasks.people).filter(id => !(id in currentTasks.people)),
    different: keys(oldTasks.people).filter(id => id in currentTasks.people && !same(oldTasks.people[id], currentTasks.people[id])),
    changedFields: Object.fromEntries(keys(oldTasks.people).map(id => [id, [...new Set([...keys(oldTasks.people[id]), ...keys(currentTasks.people[id])])].filter(field => !same(oldTasks.people[id]?.[field], currentTasks.people[id]?.[field]))]).filter(([, fields]) => fields.length)),
  },
  taskTalkSchedule: {
    current: keys(currentTasks.discursos?.programacao).length,
    legacy: keys(oldTasks.discursos?.programacao).length,
    onlyCurrent: keys(currentTasks.discursos?.programacao).filter(id => !(id in (oldTasks.discursos?.programacao || {}))),
    onlyLegacy: keys(oldTasks.discursos?.programacao).filter(id => !(id in (currentTasks.discursos?.programacao || {}))),
    bySection: Object.fromEntries(['current','legacy'].map(which => {
      const schedules = which === 'current' ? currentTasks.discursos?.programacao : oldTasks.discursos?.programacao
      return [which, Object.groupBy(Object.values(schedules || {}), item => item.secao || 'undefined')]
    }).map(([which, groups]) => [which, Object.fromEntries(Object.entries(groups).map(([section, list]) => [section, list.length]))])),
    byYear: Object.fromEntries(['current','legacy'].map(which => {
      const schedules = which === 'current' ? currentTasks.discursos?.programacao : oldTasks.discursos?.programacao
      return [which, Object.groupBy(Object.values(schedules || {}), item => String(item.data || '').slice(0,4) || 'undefined')]
    }).map(([which, groups]) => [which, Object.fromEntries(Object.entries(groups).map(([year, list]) => [year, list.length]))])),
  },
}
process.stdout.write(JSON.stringify(report, null, 2))
