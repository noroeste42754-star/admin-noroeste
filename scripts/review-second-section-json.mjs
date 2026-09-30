import fs from 'node:fs'
import path from 'node:path'

const directory = path.resolve(process.argv[2] || 'output/segunda-secao-2026-09-30-v16')
const source = JSON.parse(fs.readFileSync(path.join(directory, 'FIREBASE-PROPOSTA.json'), 'utf8'))
const master = source.master?.pessoas ?? {}
const tasks = source.tarefas ?? {}
const people = tasks.people ?? {}
const talks = tasks.discursos ?? {}
const speakers = talks.oradores ?? {}
const schedules = talks.programacao ?? {}
const entries = object => Object.entries(object ?? {})
const digits = value => String(value ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
const work = new Map()
const addWork = (date, masterId, section, sourceId) => {
  if (!masterId || !['s1', 's2'].includes(section) || date < '2026-09-30') return
  const key = `${date}|${masterId}`
  if (!work.has(key)) work.set(key, [])
  work.get(key).push({ section, sourceId })
}

const report = {
  generatedAt: new Date().toISOString(),
  source: 'FIREBASE-PROPOSTA.json',
  counts: {
    master: Object.keys(master).length,
    taskPeople: Object.keys(people).length,
    localSpeakers: entries(speakers).filter(([, speaker]) => speaker.tipo === 'local').length,
    scheduleS1: Object.values(schedules).filter(item => item.secao === 's1').length,
    scheduleS2: Object.values(schedules).filter(item => item.secao === 's2').length,
  },
  invalidTaskPeople: [],
  invalidLocalSpeakers: [],
  duplicateLocalMasterIds: [],
  crossSectionAssignments: [],
  futureSpeakerSectionMismatches: [],
  localSpeakerNameDifferences: [],
  localSpeakerPhoneDifferences: [],
  notificationWithoutMasterPhone: [],
  section1Users: [],
}

for (const [id, person] of entries(people)) {
  if (!person.masterId || !master[person.masterId] || !['s1', 's2'].includes(person.weekendSection)) {
    report.invalidTaskPeople.push({ id, masterId: person.masterId ?? null, weekendSection: person.weekendSection ?? null })
  }
  if (person.active !== false && !digits(master[person.masterId]?.whatsapp)) report.notificationWithoutMasterPhone.push({ area: 'tarefas', id, masterId: person.masterId ?? null })
}

const localByMaster = new Map()
for (const [id, speaker] of entries(speakers)) {
  if (speaker.tipo !== 'local') continue
  const canonical = master[speaker.masterId]
  if (!canonical || !['s1', 's2'].includes(speaker.secao)) report.invalidLocalSpeakers.push({ id, masterId: speaker.masterId ?? null, section: speaker.secao ?? null })
  if (speaker.masterId) {
    if (!localByMaster.has(speaker.masterId)) localByMaster.set(speaker.masterId, [])
    localByMaster.get(speaker.masterId).push(id)
  }
  if (canonical?.name && speaker.nome !== canonical.name) report.localSpeakerNameDifferences.push({ id, masterId: speaker.masterId, section: speaker.secao, speakerName: speaker.nome, masterName: canonical.name })
  if (canonical?.whatsapp && digits(speaker.telefone) !== digits(canonical.whatsapp)) report.localSpeakerPhoneDifferences.push({ id, masterId: speaker.masterId, section: speaker.secao, speakerName: speaker.nome })
  if (speaker.ativo !== false && !digits(canonical?.whatsapp)) report.notificationWithoutMasterPhone.push({ area: 'oradores', id, masterId: speaker.masterId ?? null })
}
report.duplicateLocalMasterIds = [...localByMaster].filter(([, ids]) => ids.length > 1).map(([masterId, ids]) => ({ masterId, ids }))

for (const [periodId, period] of entries(tasks.scale?.periods)) {
  for (const [meetingId, meeting] of entries(period.meetings)) {
    const section = meeting.type === 'weekend_s1' ? 's1' : meeting.type === 'weekend' ? 's2' : null
    if (!section) continue
    for (const personId of Object.values(meeting.assignments ?? {})) {
      const masterId = people[personId]?.masterId ?? (master[personId] ? personId : null)
      addWork(meeting.date, masterId, section, `tarefas/${periodId}/${meetingId}`)
    }
  }
}

for (const [id, item] of entries(schedules)) {
  if (item.data < '2026-09-30') continue
  for (const speakerId of [item.oradorId, item.oradorSecundarioId].filter(Boolean)) {
    const speaker = speakers[speakerId]
    if (speaker?.tipo !== 'local') continue
    if (speaker.secao !== item.secao) report.futureSpeakerSectionMismatches.push({ id, date: item.data, type: item.tipo, scheduleSection: item.secao, speakerSection: speaker.secao, speakerId })
    addWork(item.data, speaker.masterId, speaker.secao, `oradores/${id}`)
  }
}

report.crossSectionAssignments = [...work].flatMap(([key, records]) => {
  const sections = new Set(records.map(record => record.section))
  if (sections.size < 2) return []
  const [date, masterId] = key.split('|')
  return [{ date, masterId, records }]
})
report.section1Users = entries(source.usuarios).filter(([, user]) => user.apps?.oradoresS1 === true).map(([id]) => id)

fs.writeFileSync(path.join(directory, 'REVISAO-FALHAS.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])), null, 2))
