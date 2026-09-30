import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const [source, destination] = process.argv.slice(2)
if (!source || !destination || resolve(source) === resolve(destination)) {
  throw new Error('Informe o export original e um arquivo de destino diferente.')
}
const original = JSON.parse(await readFile(source, 'utf8'))
const data = structuredClone(original)
const removed = ['secretario', 'oradores', 'programacao']
for (const key of removed) delete data[key]
const removedDocuments = []
for (const [id, doc] of Object.entries(data.agenda?.documentos ?? {})) {
  if (removed.includes(doc.modulo)) {
    delete data.agenda.documentos[id]
    removedDocuments.push(id)
  }
}

// Identity confirmed by the user; retain the existing TPL assignment IDs.
const participantId = 'm_30985d99'
const masterId = 'm_3fa99d9d'
const person = data.master?.pessoas?.[masterId]
assert.equal(person?.name, 'Eliaudrey Conceição Santos')
assert.ok(data.escala?.participants?.[participantId])
data.escala.participants[participantId].masterId = masterId
for (const snapshot of Object.values(data.escala.publishedSnapshots ?? {})) {
  const participant = snapshot.participants?.[participantId]
  if (participant) {
    participant.masterId = masterId
    participant.name = person.name
  }
}

for (const key of Object.keys(original)) {
  if (![...removed, 'agenda', 'escala'].includes(key)) assert.deepEqual(data[key], original[key])
}
assert.deepEqual(data.escala.tables, original.escala.tables)
await writeFile(destination, JSON.stringify(data, null, 2) + '\n', { flag:'wx' })
assert.deepEqual(JSON.parse(await readFile(destination, 'utf8')), data)
console.log(JSON.stringify({ destination, removedRoots:removed.filter(key => key in original), removedDocuments, linkedParticipant:participantId, masterId, originalPreserved:true }, null, 2))
