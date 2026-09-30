import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { planEscalaIdMigration } from '../src/modules/escala-migration.ts'
import { validateBackup } from '../src/modules/mestre-backup-domain.ts'
import { refreshLegacyScaleParticipant, refreshLegacyScaleTables } from './scale-legacy-refresh.mjs'

const sources = {
  current: 'C:/Users/eliau/Downloads/tpl-novo-2-default-rtdb-export.json',
  tasks: 'C:/Users/eliau/Downloads/oradores-tarefas-default-rtdb-export.json',
  scale: 'C:/Users/eliau/Downloads/escala-tpl-default-rtdb-export.json',
}
const expectedHashes = {
  current: 'b7c2a4a63dcdb470ff53470f7f1e1a1d37f3f9c7f99697b98133b81c2b58716f',
  tasks: 'c649ae7e46630469b5b5f42afe1e251e743f4fb898a0c2573a0aea6079425d93',
  scale: '0b1aa975c579074e9960ca57b3398bd495b8450405240650075795a249d6cb91',
}
const outDir = path.resolve('output/segunda-secao-2026-09-30-v16')
const sha256 = buffer => crypto.createHash('sha256').update(buffer).digest('hex')
const sourceData = {}
for (const [key, sourcePath] of Object.entries(sources)) {
  const buffer = fs.readFileSync(sourcePath)
  if (sha256(buffer) !== expectedHashes[key]) throw new Error(`A fonte ${key} mudou; revise o novo export antes de continuar.`)
  sourceData[key] = JSON.parse(buffer.toString('utf8'))
}
// Only the two verified name/link facts used by this migration are versioned.
// Full publisher lists, contacts and exports remain local and ignored by Git.
const secretaryMapPath = path.resolve('scripts/second-section-name-evidence.json')
const secretaryMap = JSON.parse(fs.readFileSync(secretaryMapPath, 'utf8'))
if (secretaryMap.sources?.bss?.sha256 !== 'ef766f3ca9e6292533949e72e02a8bbdc61b1a5cbe68358d2895c23c5612da52' ||
    secretaryMap.sources?.legacy?.sha256 !== 'a55266d3e9105eb8c99f3317401089f19aeedac5774630261c72b5978204decd') {
  throw new Error('A fonte de nomes do Secretário mudou.')
}
if (sha256(fs.readFileSync('C:/Users/eliau/Downloads/ServiceSecretary.bss')) !== secretaryMap.sources.bss.sha256) throw new Error('O arquivo .bss mudou; reverifique os nomes antes de gerar a proposta.')

const current = structuredClone(sourceData.current)
const master = current.master.pessoas
const oldScale = sourceData.scale
const oldTasks = sourceData.tasks
const gleiceLegacy = oldScale.participants.esc_pub_61
const gleiceId = `m_${crypto.createHash('sha256').update('escala-tpl:esc_pub_61:Gleice').digest('hex').slice(0,8)}`
if (!gleiceLegacy || gleiceLegacy.name !== 'Gleice' || master[gleiceId]) throw new Error('Cadastro de Gleice precisa ser revisto.')
master[gleiceId] = { active:gleiceLegacy.active === true, name:gleiceLegacy.name, sex:gleiceLegacy.sex, whatsapp:String(gleiceLegacy.phone || '').replace(/\D/g, '') }
// O usuário autorizou criar os cadastros antigos sem Master. Natália não tem
// identidade segura no Master; seu telefone antigo aponta para outra pessoa.
const nataliaLegacy = oldScale.participants.esc_pub_40
const nataliaId = `m_${crypto.createHash('sha256').update('escala-tpl:esc_pub_40:Natália').digest('hex').slice(0,8)}`
if (!nataliaLegacy || nataliaLegacy.name !== 'Natália' || master[nataliaId]) throw new Error('Cadastro de Natália precisa ser revisto.')
master[nataliaId] = { active:nataliaLegacy.active === true, name:nataliaLegacy.name, sex:nataliaLegacy.sex, whatsapp:'' }
const originalMasterNames = Object.fromEntries(Object.entries(master).map(([id, person]) => [id, person.name]))
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const words = value => String(value || '').trim().split(/\s+/).filter(Boolean)
const short = value => { const parts = words(value); return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : parts[0] || '' }
const phone = value => String(value || '').replace(/\D/g, '').slice(-8)
const objectEntries = obj => Object.entries(obj || {})
const masterEntries = objectEntries(master)
const report = { masterAdded:[{ masterId:gleiceId, name:'Gleice', source:'escala/participants/esc_pub_61' },{ masterId:nataliaId, name:'Natália', source:'escala/participants/esc_pub_40', contactPending:true }], namesShortened: [], namesCompleted: [], singleNames: [], duplicateShortNames: [], scaleKeyCorrections: [], scaleOldMatches: [], scaleAdded: [], availabilityUpdated: [], speakersAdded: [], speakerMasterLinks:[], speakerFieldsSynchronized:[], identityCorrections:[], outgoingSectionCorrections:[], localSectionActivated:[], redundantMeetingsRemoved:[], futureSpeakerSectionMismatches:[], pending: [] }
report.scaleProfileUpdates = []

// Os campos de identidade do master são a referência. Nomes com uma palavra ficam intactos.
for (const [id, person] of masterEntries) {
  if (words(person.name).length === 1) report.singleNames.push({ masterId:id, name:person.name })
  const next = short(person.name)
  if (next && next !== person.name) {
    report.namesShortened.push({ masterId:id, before:person.name, after:next })
    person.name = next
  }
}
// Nomes e identidades confirmados pelo usuário em 30/09/2026.
const confirmedMasterNames = {
  m_9652d780: { before:'Vera', after:'Vera Bonfim' },
  m_7a9cc669: { before:'Elenilde Messias', after:'Elenildes' },
  m_113a3ed1: { before:'Tainara Bastos', after:'Taynara' },
}
for (const [id, { before, after }] of Object.entries(confirmedMasterNames)) {
  if (master[id]?.name !== before) throw new Error(`Nome de ${id} mudou: revisar confirmação do usuário.`)
  master[id].name = after
  report.namesCompleted.push({ masterId:id, before, after, source:'confirmação do usuário em 30/09/2026' })
}
const elbetty = secretaryMap.verified.find(item => item.publisherId === 157 && item.masterId === 'm_41d6536a')
if (!elbetty || elbetty.shortName !== 'Elbetty Carvalho' || master.m_41d6536a.name !== 'Elbetty') throw new Error('Nome de Elbetty precisa ser revalidado.')
master.m_41d6536a.name = elbetty.shortName
report.namesCompleted.push({ masterId:'m_41d6536a', before:'Elbetty', after:elbetty.shortName, source:'ServiceSecretary.bss/publishers/157' })
report.singleNames = report.singleNames.filter(item => item.masterId !== 'm_41d6536a')
const nameGroups = Object.groupBy(masterEntries, ([, person]) => norm(person.name))
report.duplicateShortNames = Object.entries(nameGroups).filter(([, rows]) => rows.length > 1).map(([name, rows]) => ({ name, masterIds:rows.map(([id]) => id) }))

// Estes três perfis já estavam na Escala nova, mas apontavam para IDs ausentes do master.
// A evidência é a correspondência com o perfil antigo pelo timestamp e por nome/telefone.
const invalidMasterCorrections = {
  m_0367ee81: { masterId:'m_c8c66b5c', legacyId:'esc_pub_48', reason:'timestamp da disponibilidade e telefone de Diego Miguel' },
  m_4081972f: { masterId:'m_f44fc76d', legacyId:'esc_pub_02', reason:'timestamp da disponibilidade e nome Leonardo' },
  m_7c3902d5: { masterId:'m_51beda71', legacyId:'esc_pub_31', reason:'timestamp do cadastro e nome Eduardo S' },
}
for (const [id, correction] of Object.entries(invalidMasterCorrections)) {
  const person = current.escala.participants[id]
  const legacy = oldScale.participants[correction.legacyId]
  if (!person || !master[correction.masterId] || !legacy) throw new Error(`Correção ${id} não pode ser validada.`)
  const stampMatches = person.availabilityUpdatedAt && person.availabilityUpdatedAt === legacy.availabilityUpdatedAt
  const updateMatches = person.updatedAt && person.updatedAt === legacy.updatedAt
  if (!stampMatches && !updateMatches) throw new Error(`Timestamp de ${id} não confere.`)
  person.masterId = correction.masterId
  report.scaleKeyCorrections.push({ oldKey:id, masterId:correction.masterId, reason:correction.reason })
}
for (const [id, person] of objectEntries(current.escala.participants)) {
  if (!master[person.masterId]) throw new Error(`Escala ainda aponta para masterId inexistente: ${id} -> ${person.masterId}`)
}

const originalScale = structuredClone(current.escala)
const plan = planEscalaIdMigration(current.escala)
if (!plan.canApply || plan.stats.duplicateProfilesMerged !== 0) throw new Error(`Migração da Escala tem conflitos: ${JSON.stringify(plan.conflicts)}`)
current.escala = plan.migrated
const remap = plan.idMap
function remapExact(value) {
  if (typeof value === 'string') return remap[value] || value
  if (Array.isArray(value)) return value.map(remapExact)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    const nextKey = remap[key] || key
    const nextValue = remapExact(child)
    if (Object.hasOwn(result, nextKey) && JSON.stringify(result[nextKey]) !== JSON.stringify(nextValue)) throw new Error(`Colisão ao trocar ID ${key} por ${nextKey}`)
    result[nextKey] = nextValue
  }
  return result
}
for (const key of Object.keys(current.escala)) if (!['participants','availability','tables'].includes(key)) current.escala[key] = remapExact(current.escala[key])
for (const [oldKey, masterId] of Object.entries(remap)) if (oldKey !== masterId) report.scaleKeyCorrections.push({ oldKey, masterId, reason:'masterId já válido no perfil atual' })

// Identidades de três nomes abreviados nos snapshots históricos foram confirmadas pelo usuário.
const severina = secretaryMap.verified.find(item => item.publisherId === 147 && item.masterId === 'm_2e30b9f5')
if (!severina || master.m_2e30b9f5?.active !== false) throw new Error('Vínculo histórico de Severina precisa ser revalidado.')
const historicalIdMap = { esc_pub_03:'m_193980d5', esc_pub_17:'m_2e30b9f5', esc_pub_53:'m_400ecf52' }
for (const [legacyId, masterId] of Object.entries(historicalIdMap)) if (!master[masterId]) throw new Error(`Vínculo histórico sem master: ${legacyId}`)
function remapHistorical(value) {
  if (typeof value === 'string') return historicalIdMap[value] || value
  if (Array.isArray(value)) return value.map(remapHistorical)
  if (!value || typeof value !== 'object') return value
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    const nextKey = historicalIdMap[key] || key
    const nextValue = remapHistorical(child)
    if (Object.hasOwn(result, nextKey) && JSON.stringify(result[nextKey]) !== JSON.stringify(nextValue)) throw new Error(`Colisão em vínculo histórico ${key}`)
    result[nextKey] = nextValue
  }
  return result
}
current.escala.tables = remapHistorical(current.escala.tables)

// Uma correspondência precisa de nome exato, perfil atual identificado por timestamp,
// ou telefone único compatível com o nome. Telefone isolado não define identidade.
const oldToMaster = {}
const confirmedLegacyIds = {
  esc_pub_30: { name:'Luciene Stna', masterId:'m_fd873784' },
  esc_pub_44: { name:'Vera B.', masterId:'m_9652d780' },
  esc_pub_49: { name:'Elenildes', masterId:'m_7a9cc669' },
  esc_pub_50: { name:'Carlos', masterId:'m_2e795415' },
  esc_pub_60: { name:'Taynara', masterId:'m_113a3ed1' },
}
const matchOld = ([oldId, oldPerson]) => {
  const name = norm(oldPerson.name)
  const confirmed = confirmedLegacyIds[oldId]
  if (confirmed) {
    if (oldPerson.name !== confirmed.name || !master[confirmed.masterId]) throw new Error(`Confirmação de ${oldId} precisa ser revalidada.`)
    return { oldId, name:oldPerson.name, masterId:confirmed.masterId, evidence:'identidade confirmada pelo usuário em 30/09/2026', status:'vinculado' }
  }
  const exact = masterEntries.filter(([id, person]) => [originalMasterNames[id], short(originalMasterNames[id]), person.name].some(value => norm(value) === name))
  const timestamp = objectEntries(originalScale.participants).filter(([, person]) => oldPerson.availabilityUpdatedAt && person.availabilityUpdatedAt === oldPerson.availabilityUpdatedAt && master[remap[person.masterId] || person.masterId])
  const byPhone = phone(oldPerson.phone) ? masterEntries.filter(([, person]) => phone(person.whatsapp) === phone(oldPerson.phone)) : []
  const compatible = ([id]) => {
    const tokens = norm(originalMasterNames[id]).split(' '), oldTokens = name.split(' ')
    return oldTokens[0] === tokens[0] || oldTokens.some(token => token.length > 2 && tokens.includes(token)) ||
      (oldTokens.length > 1 && oldTokens[0] === tokens[0] && tokens.some(token => token.startsWith(oldTokens[1])))
  }
  let candidates = [], evidence = ''
  if (oldId === 'esc_pub_61') { candidates = masterEntries.filter(([id]) => id === gleiceId); evidence = 'cadastro criado a partir do perfil antigo' }
  else if (oldId === 'esc_pub_40') { candidates = masterEntries.filter(([id]) => id === nataliaId); evidence = 'cadastro criado conforme autorização do usuário; telefone pendente' }
  else if (exact.length === 1) { candidates = exact; evidence = 'nome exato' }
  else if (timestamp.length === 1) { const target = remap[timestamp[0][0]] || timestamp[0][1].masterId; candidates = masterEntries.filter(([id]) => id === target); evidence = 'timestamp do perfil atual' }
  else if (byPhone.length === 1 && compatible(byPhone[0])) { candidates = byPhone; evidence = 'telefone único e nome compatível' }
  if (candidates.length !== 1) return { oldId, name:oldPerson.name, status:'pendente', reason:byPhone.length === 1 && !compatible(byPhone[0]) ? 'telefone aponta para nome diferente' : 'sem correspondência inequívoca' }
  const masterId = candidates[0][0]
  if (!master[masterId]) throw new Error(`Vínculo inexistente para ${oldId}`)
  return { oldId, name:oldPerson.name, masterId, evidence, status:'vinculado' }
}
for (const entry of objectEntries(oldScale.participants)) {
  const result = matchOld(entry)
  report.scaleOldMatches.push(result)
  if (result.masterId) oldToMaster[result.oldId] = result.masterId
  else report.pending.push({ path:`escala/participants/${result.oldId}`, name:result.name, issue:result.reason })
}

const oldGroups = Object.groupBy(objectEntries(oldScale.participants).filter(([id]) => oldToMaster[id]), ([id]) => oldToMaster[id])
current.escala.legacyAvailability = oldScale.availability
for (const [masterId, entries] of Object.entries(oldGroups)) {
  const refreshed = refreshLegacyScaleParticipant(current.escala, masterId, entries, oldToMaster)
  report.pending.push(...refreshed.pending)
  if (refreshed.created) report.scaleAdded.push({ masterId, legacyIds:entries.map(([id]) => id), name:master[masterId].name })
  else if (refreshed.updatedFields.length) report.scaleProfileUpdates.push({masterId, fields:refreshed.updatedFields})
  if (refreshed.availabilityApplied) report.availabilityUpdated.push({ masterId, legacyId:refreshed.availabilitySourceId, name:master[masterId].name, at:refreshed.availabilityAt })
}
delete current.escala.legacyAvailability
report.scaleTablesRefresh = refreshLegacyScaleTables(current.escala.tables, oldScale.tables, {...oldToMaster,...historicalIdMap}, new Set(Object.keys(master)))

// Reaproveita a programação da primeira seção; a segunda já está no projeto atual.
const currentTalks = current.tarefas.discursos.programacao
for (const [id, talk] of objectEntries(oldTasks.discursos.programacao)) {
  if (talk.secao !== 's1' || currentTalks[id]) continue
  currentTalks[id] = structuredClone(talk)
  report.speakersAdded.push({ id, date:talk.data, oradorId:talk.oradorId || null, oradorNome:talk.oradorNome || null })
  if (talk.oradorId && !current.tarefas.discursos.oradores[talk.oradorId]) {
    const legacyOrator = oldTasks.discursos.oradores[talk.oradorId]
    const equivalent = legacyOrator && objectEntries(current.tarefas.discursos.oradores).find(([, speaker]) => speaker.pessoaId && speaker.pessoaId === legacyOrator.pessoaId)
    if (equivalent) currentTalks[id].oradorId = equivalent[0]
    else report.pending.push({ path:`tarefas/discursos/programacao/${id}/oradorId`, issue:`orador ${talk.oradorId} ausente no cadastro atual` })
  }
}

// O usuário confirmou que Diego Miguel e Diego Leite são pessoas diferentes.
// O cadastro de Oradores era de Diego Leite, com vínculo/telefone de Miguel.
const diegoSpeaker = current.tarefas.discursos.oradores.orad_1778764164473
const diegoTask = current.tarefas.people.p_e8f617d1d52c98
if (diegoSpeaker?.nome !== 'Diego Leite' || diegoTask?.masterId !== 'm_c8c66b5c' || !master.m_b62e9870) throw new Error('A correção dos dois Diegos precisa ser revista.')
diegoSpeaker.masterId = 'm_b62e9870'
delete diegoSpeaker.pessoaId
if (diegoTask.oradorId === 'orad_1778764164473') delete diegoTask.oradorId
report.identityCorrections.push({ oradorId:'orad_1778764164473', beforeMasterId:'m_c8c66b5c', afterMasterId:'m_b62e9870', taskPersonPreserved:'p_e8f617d1d52c98', source:'usuário: Diego Miguel e Diego Leite são pessoas diferentes' })

// Materializa os vínculos explícitos de Oradores ao Master, antes disponíveis
// apenas indiretamente pelo pessoaId de Tarefas.
for (const [id, speaker] of objectEntries(current.tarefas.discursos.oradores)) {
  if (speaker.tipo === 'visitante') continue
  const linked = speaker.masterId || current.tarefas.people[speaker.pessoaId]?.masterId || (master[speaker.pessoaId] && speaker.pessoaId)
  if (!linked || !master[linked]) { report.pending.push({ path:`tarefas/discursos/oradores/${id}/masterId`, issue:'orador local sem vínculo seguro com Master' }); continue }
  if (speaker.masterId && speaker.masterId !== linked) throw new Error(`Conflito no vínculo de Oradores ${id}.`)
  speaker.masterId = linked
  report.speakerMasterLinks.push({ oradorId:id, masterId:linked, secao:speaker.secao || 's2' })
  const canonicalName = master[linked].name
  const canonicalPhone = master[linked].whatsapp || ''
  if (speaker.nome !== canonicalName || speaker.telefone !== canonicalPhone) {
    report.speakerFieldsSynchronized.push({ oradorId:id, masterId:linked, beforeName:speaker.nome, afterName:canonicalName, contactChanged:speaker.telefone !== canonicalPhone })
    speaker.nome = canonicalName
    speaker.telefone = canonicalPhone
  }
}
for (const [id, local] of objectEntries(current.tarefas.discursos.congregacoes)) {
  if (local.tipo !== 'local' || local.secao !== 's1' || local.ativa !== false) continue
  if (current.tarefas.planning?.enableSection1 !== true) throw new Error('Primeira seção não está habilitada no planejamento.')
  local.ativa = true
  report.localSectionActivated.push({ congregationId:id, secao:'s1' })
}
if (current.tarefas.planning?.enableSection1 !== true) throw new Error('Planejamento de Tarefas não habilita a primeira seção.')
for (const [id, person] of objectEntries(current.tarefas.people)) {
  if (!master[person.masterId] || !['s1','s2'].includes(person.weekendSection)) throw new Error(`Participante de Tarefas sem Master ou seção: ${id}`)
}
for (const [id, user] of objectEntries(current.usuarios)) {
  if (user.apps?.oradoresS1 === true) throw new Error(`Permissão S1 já existe para ${id}; revisar migração.`)
  user.apps ||= {}
  user.apps.oradoresS1 = false // O acesso antigo Oradores permanece somente na S2.
}
for (const [id, talk] of objectEntries(currentTalks)) {
  const speaker = current.tarefas.discursos.oradores[talk.oradorId]
  if (talk.data < '2026-09-30' || speaker?.tipo !== 'local' || !speaker.secao || speaker.secao === talk.secao) continue
  if (talk.tipo === 'saida_orador') {
    report.outgoingSectionCorrections.push({ id, date:talk.data, before:talk.secao, after:speaker.secao, oradorId:talk.oradorId })
    talk.secao = speaker.secao
    continue
  }
  report.futureSpeakerSectionMismatches.push({ id, date:talk.data, tipo:talk.tipo, programSection:talk.secao, speakerSection:speaker.secao, oradorId:talk.oradorId })
}
// O bloqueio legado de fim de semana era geral: inclui explicitamente as duas seções.
for (const event of Object.values(current.tarefas.events || {})) {
  const impact = event.impactoTarefas
  if (impact?.bloqueiaReuniao && impact.tiposReuniao?.includes('weekend') && !impact.tiposReuniao.includes('weekend_s1')) impact.tiposReuniao.push('weekend_s1')
}
for (const [periodId, period] of objectEntries(current.tarefas.scale.periods)) {
  const meetings = period.meetings || {}
  for (const [id, meeting] of objectEntries(meetings)) {
    if (meeting.type !== 'weekend' || Object.keys(meeting.assignments || {}).length || Object.keys(meeting.manualEdits || {}).length) continue
    if (!objectEntries(meetings).some(([otherId, other]) => otherId !== id && other.date === meeting.date && other.type === 'weekend_merged')) continue
    delete meetings[id]
    report.redundantMeetingsRemoved.push({ periodId, meetingId:id, date:meeting.date, reason:'reunião vazia duplicada por registro especial do mesmo dia' })
  }
}

const participantIds = new Set(Object.keys(current.escala.participants))
for (const [id, person] of objectEntries(current.escala.participants)) {
  if (id !== person.masterId || !master[id]) throw new Error(`Participante sem ID canônico: ${id}`)
  if (person.onlyWithId && !participantIds.has(person.onlyWithId)) report.pending.push({ path:`escala/participants/${id}/onlyWithId`, issue:`parceiro ${person.onlyWithId} ausente` })
}
for (const [localId, byPerson] of objectEntries(current.escala.availability)) for (const id of Object.keys(byPerson)) if (!participantIds.has(id)) report.pending.push({ path:`escala/availability/${localId}/${id}`, issue:'participante ausente' })
for (const [localId, byMonth] of objectEntries(current.escala.tables)) for (const [month, table] of objectEntries(byMonth)) for (const [date, row] of objectEntries(table.rows)) for (const [time, cell] of objectEntries(row.slots)) for (const id of [cell.p1,cell.p2].filter(Boolean)) if (!participantIds.has(id) && !(id === 'm_2e30b9f5' && master[id]?.active === false)) report.pending.push({ path:`escala/tables/${localId}/${month}/rows/${date}/slots/${time}`, issue:`designação para participante ausente ${id}` })

const serializable = JSON.parse(JSON.stringify(current))
const valid = validateBackup(serializable)
if (!valid.ok) throw new Error(`JSON proposto inválido: ${valid.error}`)
for (const root of Object.keys(sourceData.current)) {
  if (['master','escala','tarefas','usuarios'].includes(root)) continue
  if (JSON.stringify(current[root]) !== JSON.stringify(sourceData.current[root])) throw new Error(`Raiz ${root} foi alterada sem intenção.`)
}
if (Object.keys(current.master.pessoas).length !== Object.keys(sourceData.current.master.pessoas).length + report.masterAdded.length) throw new Error('Contagem de master/pessoas inesperada.')
if (Object.keys(current.tarefas.discursos.programacao).length !== Object.keys(sourceData.current.tarefas.discursos.programacao).length + report.speakersAdded.length) throw new Error('Contagem de discursos inesperada.')

const json = JSON.stringify(serializable, null, 2) + '\n'
if (process.argv.includes('--verify')) {
  const existing = fs.readFileSync(path.join(outDir, 'FIREBASE-PROPOSTA.json'))
  if (sha256(existing) !== sha256(Buffer.from(json))) throw new Error('A proposta salva diverge da migração reproduzida com as fontes verificadas.')
  console.log(JSON.stringify({verified:true,outputSha256:sha256(existing),sourcesVerified:Object.keys(sources)},null,2))
  process.exit(0)
}
if (fs.existsSync(outDir)) throw new Error(`A pasta de saída já existe: ${outDir}`)
fs.mkdirSync(outDir, { recursive:true })
fs.writeFileSync(path.join(outDir, 'FIREBASE-PROPOSTA.json'), json)
fs.writeFileSync(path.join(outDir, 'RELATORIO-DADOS.json'), JSON.stringify({ sources:Object.fromEntries(Object.entries(sources).map(([key, sourcePath]) => [key, { path:sourcePath, sha256:expectedHashes[key] }])), outputSha256:sha256(Buffer.from(json)), migrationStats:plan.stats, ...report }, null, 2) + '\n')
const peopleMarkdown = [
  '# Dados pessoais que precisam de revisão',
  '',
  '## Nomes de uma palavra aceitos provisoriamente pelo usuário',
  '',
  ...report.singleNames.map(item => `- ${item.name} — \`${item.masterId}\``),
  '',
  '## Nomes abreviados que ficaram iguais',
  '',
  ...report.duplicateShortNames.map(item => `- ${item.name}: ${item.masterIds.map(id => `\`${id}\``).join(', ')}`),
  '',
  '## Participantes antigos da Escala sem vínculo seguro',
  '',
  ...report.scaleOldMatches.filter(item => item.status === 'pendente').map(item => `- ${item.name} — \`${item.oldId}\`: ${item.reason}`),
  ...(report.scaleOldMatches.some(item => item.status === 'pendente') ? [] : ['Nenhuma pendência de identificação nesta versão.']),
  '',
  '## Programações futuras com seção diferente da seção atual do orador',
  '',
  ...report.futureSpeakerSectionMismatches.map(item => `- ${item.date} — \`${item.id}\`: programação ${item.programSection}, orador ${item.speakerSection} (\`${item.oradorId}\`). Mantida sem alteração automática.`),
  ...(report.futureSpeakerSectionMismatches.length ? [] : ['Nenhuma divergência futura. As saídas seguem a seção cadastrada do orador.']),
  '',
  '## Contatos necessários para mensagens individuais',
  '',
  '- Diego Leite — `m_b62e9870`: sem telefone; o telefone antigo era de Diego Miguel e foi retirado deste orador.',
  '- Kaua G. — `m_eebabc04`: sem telefone.',
  '- Fabiano Gomes — `m_fd1243c4`: sem telefone.',
  `- Natália — \`${nataliaId}\`: sem telefone seguro no cadastro antigo da Escala.`,
  '',
  '## Grafia divergente no banco antigo do Secretário',
  '',
  '- `m_0eb2ae36`: Master = Massecleide; `.bss` = Massicleide Feitosa Santos. O sobrenome pode ser Santos, mas a grafia do primeiro nome precisa de confirmação antes de alterar.',
  '',
  '## Referências históricas da Escala sem participante atual',
  '',
  '- `esc_pub_03`: Mayara Francine — vinculada a `m_193980d5` conforme resposta do usuário.',
  '- `esc_pub_17`: Severina — ligada a `m_2e30b9f5` apenas nas escalas históricas; permanece inativa e sem participante atual.',
  '- `esc_pub_53`: Valdirez — vinculada a `m_400ecf52` conforme resposta do usuário.',
  '',
].join('\n')
fs.writeFileSync(path.join(outDir, 'PENDENCIAS-PESSOAS.md'), peopleMarkdown)
const md = `# Proposta local para segunda seção\n\nBase: \`${path.basename(sources.current)}\` (SHA-256 \`${expectedHashes.current}\`). Nenhuma escrita no Firebase.\n\n- ${report.masterAdded.length} pessoa criada no Master com o nome disponível no legado.\n- ${report.namesShortened.length} nomes reduzidos a primeiro nome e último sobrenome.\n- ${report.namesCompleted.length} nomes completados ou corrigidos por fonte verificada ou confirmação do usuário.\n- ${report.singleNames.length} nomes de uma palavra aceitos provisoriamente pelo usuário.\n- ${report.duplicateShortNames.length} nome(s) abreviado(s) repetido(s), a revisar.\n- ${report.scaleKeyCorrections.length} correções de chave/ID na Escala.\n- ${report.scaleAdded.length} participantes da Escala antiga adicionados ao cadastro do módulo com masterId confirmado.\n- ${report.availabilityUpdated.length} disponibilidades mais recentes aproveitadas.\n- ${report.speakersAdded.length} registros de Oradores da primeira seção acrescentados.\n- ${report.speakerMasterLinks.length} oradores locais vinculados explicitamente ao Master.\n- ${report.localSectionActivated.length} congregação local da primeira seção reativada.\n- ${report.pending.length} pendências de vínculo ou referência.\n\nO arquivo \`FIREBASE-PROPOSTA.json\` é para revisão local. Antes de importar, comparar com um export novo do banco em produção.\n`
fs.writeFileSync(path.join(outDir, 'LEIA-ANTES.md'), md + `\nO acesso legado \`oradores\` continua exclusivo da 2ª seção; \`oradoresS1\` foi acrescentado como falso para todos os usuários até a atribuição pelo Admin. ${report.outgoingSectionCorrections.length} saídas futuras tiveram a seção ajustada à seção já cadastrada do orador. ${report.speakerFieldsSynchronized.length} fichas locais tiveram nome/contato sincronizados com o Master, como o aplicativo já faz em memória. Diego Leite foi desvinculado de Diego Miguel; seu contato está pendente.\n\nExports antigos baixados novamente em 30/09/2026 e autorizados como base pelo usuário. ${report.scaleTablesRefresh.tablesAdded.length} tabelas mensais recuperadas, ${report.scaleTablesRefresh.assignmentsRecovered.length} designações recuperadas e ${report.scaleTablesRefresh.assignmentsCorrected.length} vínculos de designações corrigidos conforme a Escala antiga. ${report.scaleProfileUpdates.length} perfis existentes atualizados. A recuperação de tabelas não publica novos PDFs nem ativa publicação automaticamente no app novo.\n\nEste JSON contém dados pessoais, senhas e sessões privadas. Conservar localmente; não enviar ao GitHub.\n`)
console.log(JSON.stringify({ outDir, counts:{ masterAdded:report.masterAdded.length, namesShortened:report.namesShortened.length, namesCompleted:report.namesCompleted.length, singleNames:report.singleNames.length, duplicateShortNames:report.duplicateShortNames.length, scaleKeyCorrections:report.scaleKeyCorrections.length, scaleAdded:report.scaleAdded.length, availabilityUpdated:report.availabilityUpdated.length, speakersAdded:report.speakersAdded.length, pending:report.pending.length }, outputSha256:sha256(Buffer.from(json)) }, null, 2))
