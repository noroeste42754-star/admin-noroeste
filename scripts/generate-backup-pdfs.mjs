import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { publicationInput, publicationPeriod } from '../src/modules/publication-contract.ts'
import { createTaskSchedulePdf } from '../src/modules/tarefas-documents.ts'
import { createCleaningPdf } from '../src/modules/limpeza-documents.ts'
import { createScaleSchedulePdf } from '../src/modules/escala-documents.ts'
import { createFieldServicePdf } from '../src/modules/servico-campo-documents.ts'
import { createSpeakersSchedulePdf, speakersPdfScheduleRows } from '../src/modules/oradores-documents.ts'

const [source, month, destination] = process.argv.slice(2)
if (!source || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !destination) {
  throw new Error('Uso: node scripts/generate-backup-pdfs.mjs backup.json AAAA-MM pasta-de-saida')
}
const root = JSON.parse(await readFile(resolve(source), 'utf8'))
const output = resolve(destination)
await mkdir(output, { recursive:true })
const created = []
async function save(name, bytes, count) {
  if (!count) return
  const filename = `${name}-${month}-previa.pdf`
  await writeFile(join(output, filename), bytes, { flag:'wx' })
  created.push({ filename, records:count, bytes:bytes.length })
}

const tasks = publicationInput(root, 'tarefas', month)
if (tasks.meetings.length) {
  const result = await createTaskSchedulePdf(tasks.meetings, tasks.congregation, tasks.people, 14)
  await save('tarefas', result.bytes, tasks.meetings.length)
}

const cleaningId = Object.keys(root.limpeza?.periodos ?? {}).find(id => {
  const period = publicationPeriod(root, 'limpeza', id)
  return period?.inicio?.slice(0, 7) === month
})
if (cleaningId) {
  const cleaning = publicationInput(root, 'limpeza', cleaningId)
  if (cleaning.semanas?.length) {
    const result = await createCleaningPdf(cleaning, { requestedFontSize:11 })
    await save('limpeza', result.bytes, cleaning.semanas.length)
  }
}

const scale = publicationInput(root, 'escala', month)
const scaleCount = Object.values(scale.tables).reduce((total, months) => total + Object.keys(months[month]?.rows ?? {}).length, 0)
if (scaleCount) {
  const result = await createScaleSchedulePdf({ ...scale, requestedFontPt:12 })
  await save('escala-tpl', result.bytes, scaleCount)
}

const field = publicationInput(root, 'servicoCampo', month)
if (field.assignments.length) {
  await save('servico-de-campo', await createFieldServicePdf(field), field.assignments.length)
}

const speakers = publicationInput(root, 'oradores', month)
const speakerRows = speakersPdfScheduleRows(speakers)
if (speakerRows.local.length || speakerRows.outgoing.length) {
  await save('oradores', await createSpeakersSchedulePdf(speakers), speakerRows.local.length + speakerRows.outgoing.length)
}

console.log(JSON.stringify({ month, created, skipped:[
  ...(!tasks.meetings.length ? ['tarefas'] : []),
  ...(!cleaningId ? ['limpeza'] : []),
  ...(!scaleCount ? ['escala-tpl'] : []),
  ...(!field.assignments.length ? ['servico-de-campo'] : []),
  ...(!speakerRows.local.length && !speakerRows.outgoing.length ? ['oradores'] : []),
] }, null, 2))
