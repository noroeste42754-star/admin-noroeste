import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { publicationInput } from '../src/modules/publication-contract.ts'
import { createTaskSchedulePdf } from '../src/modules/tarefas-documents.ts'
import { createScaleSchedulePdf } from '../src/modules/escala-documents.ts'
import { createSpeakersSchedulePdf, speakersPdfScheduleRows } from '../src/modules/oradores-documents.ts'

const [source, month, destination] = process.argv.slice(2)
if (!source || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !destination) throw new Error('Uso: node scripts/generate-review-pdfs.mjs backup.json AAAA-MM pasta')
const root = JSON.parse(await readFile(resolve(source), 'utf8'))
const output = resolve(destination)
await mkdir(output, { recursive:true })
const created = []
const save = async (name, bytes, records) => {
  if (!records) return
  const filename = `${name}-${month}-revisao.pdf`
  await writeFile(join(output, filename), bytes, { flag:'wx' })
  created.push({ filename, records, bytes:bytes.length })
}

const tasks = publicationInput(root, 'tarefas', month)
if (tasks.meetings.length) await save('Noroeste-Tarefas', (await createTaskSchedulePdf(tasks.meetings, tasks.congregation, tasks.people, 10)).bytes, tasks.meetings.length)
const speakers = publicationInput(root, 'oradores', month)
const speakerRows = speakersPdfScheduleRows(speakers)
if (speakerRows.local.length || speakerRows.outgoing.length) await save('Noroeste-Oradores', await createSpeakersSchedulePdf(speakers), speakerRows.local.length + speakerRows.outgoing.length)
const scale = publicationInput(root, 'escala', month)
const scaleRecords = Object.values(scale.tables).reduce((total, months) => total + Object.keys(months[month]?.rows ?? {}).length, 0)
if (scaleRecords) await save('Noroeste-Escala-TPL', (await createScaleSchedulePdf({ ...scale, requestedFontPt:11 })).bytes, scaleRecords)
console.log(JSON.stringify({ month, created }, null, 2))
