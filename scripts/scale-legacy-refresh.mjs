const PROFILE_FIELDS = ['active','capPerMonth','even','fromDate','obs','odd','onlyEvenDays','onlyOddDays','pioneer','refFolgaDate','sameSexOnly','startFromDate','withChild','updatedAt']
const latest = (entries, field) => [...entries].sort((a,b) => String(b[1][field] || '').localeCompare(String(a[1][field] || '')))[0]

/** Refresh operational data without copying legacy names, contacts or identity fields. */
export function refreshLegacyScaleParticipant(scale, masterId, entries, idMap) {
  const [, source] = latest(entries, 'updatedAt')
  const created = !scale.participants[masterId]
  const profile = scale.participants[masterId] ||= { masterId }
  const updatedFields = []
  const pending = []
  if (created || String(source.updatedAt || '') > String(profile.updatedAt || '')) {
    for (const field of PROFILE_FIELDS) {
      if (source[field] === undefined) continue
      if (JSON.stringify(profile[field]) !== JSON.stringify(source[field])) updatedFields.push(field)
      profile[field] = structuredClone(source[field])
    }
    if (Object.hasOwn(source, 'onlyWithId')) {
      const partner = source.onlyWithId ? idMap[source.onlyWithId] : undefined
      if (source.onlyWithId && !partner) pending.push({ path:`escala/participants/${masterId}/onlyWithId`, issue:`parceiro ${source.onlyWithId} não identificado` })
      else {
        if (profile.onlyWithId !== partner) updatedFields.push('onlyWithId')
        if (partner) profile.onlyWithId = partner
        else delete profile.onlyWithId
      }
    }
  }
  const [availabilitySourceId, availabilityProfile] = latest(entries, 'availabilityUpdatedAt')
  const availabilityApplied = created || String(availabilityProfile.availabilityUpdatedAt || '') > String(profile.availabilityUpdatedAt || '')
  if (availabilityApplied) {
    scale.availability ||= {}
    for (const [localId, byPerson] of Object.entries(scale.legacyAvailability || {})) {
      if (!Object.hasOwn(byPerson, availabilitySourceId)) continue
      scale.availability[localId] ||= {}
      scale.availability[localId][masterId] = structuredClone(byPerson[availabilitySourceId])
    }
    if (availabilityProfile.availabilityUpdatedAt !== undefined) profile.availabilityUpdatedAt = availabilityProfile.availabilityUpdatedAt
  }
  return { created, updatedFields, pending, availabilityApplied, availabilitySourceId, availabilityAt:availabilityProfile.availabilityUpdatedAt ?? null }
}

/** The user selected the freshly exported legacy schedules as the migration source. */
export function refreshLegacyScaleTables(tables, legacyTables, idMap, masterIds) {
  const report = { tablesAdded:[], assignmentsRecovered:[], assignmentsCorrected:[] }
  for (const [localId, months] of Object.entries(legacyTables || {})) {
    tables[localId] ||= {}
    for (const [month, source] of Object.entries(months)) {
      const previous = tables[localId][month]
      const next = structuredClone(source)
      for (const [date, row] of Object.entries(next.rows || {})) {
        for (const [time, cell] of Object.entries(row.slots || {})) {
          for (const role of ['p1','p2']) {
            const legacyId = cell[role]
            if (!legacyId) continue
            const masterId = idMap[legacyId] || (masterIds.has(legacyId) ? legacyId : undefined)
            if (!masterId || !masterIds.has(masterId)) throw new Error(`Referência sem Master em escala/tables/${localId}/${month}/${date}/${time}/${role}: ${legacyId}`)
            const before = previous?.rows?.[date]?.slots?.[time]?.[role]
            cell[role] = masterId
            if (!before) report.assignmentsRecovered.push({ localId, month, date, time, role, masterId })
            else if (before !== masterId) report.assignmentsCorrected.push({ localId, month, date, time, role, before, masterId })
          }
        }
      }
      if (!previous) report.tablesAdded.push({ localId, month })
      tables[localId][month] = next
    }
  }
  return report
}
