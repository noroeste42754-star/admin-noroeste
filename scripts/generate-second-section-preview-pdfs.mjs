import fs from 'node:fs/promises'
import path from 'node:path'
import { publicationInput } from '../src/modules/publication-contract.ts'
import { createTaskSchedulePdf } from '../src/modules/tarefas-documents.ts'
import { createSpeakersSchedulePdf, speakersPdfScheduleRows } from '../src/modules/oradores-documents.ts'

const source = path.resolve(process.argv[2] || 'output/segunda-secao-2026-09-30-v16/FIREBASE-PROPOSTA.json')
const output = path.resolve('output/pdf')
const root = JSON.parse(await fs.readFile(source, 'utf8'))
const tasks = publicationInput(root, 'tarefas', '2026-09')
const speakers = publicationInput(root, 'oradores', '2026-10')
const taskSections = new Set(tasks.meetings.map(item => item.type))
const speakerSections = new Set(speakersPdfScheduleRows(speakers).local.map(item => item.secao))
if (!taskSections.has('weekend_s1') || !taskSections.has('weekend') || !speakerSections.has('s1') || !speakerSections.has('s2')) {
  throw new Error('As prévias precisam conter as duas seções de cada módulo.')
}
await fs.mkdir(output, { recursive:true })
const taskPdf = await createTaskSchedulePdf(tasks.meetings, tasks.congregation, tasks.people, 11)
const speakerPdf = await createSpeakersSchedulePdf(speakers)
const files = [
  ['tarefas-duas-secoes-2026-09.pdf', taskPdf.bytes],
  ['oradores-duas-secoes-2026-10.pdf', speakerPdf],
]
for (const [name, bytes] of files) await fs.writeFile(path.join(output, name), bytes)
console.log(JSON.stringify({ files:files.map(([name, bytes]) => ({ name, bytes:bytes.length })), taskPages:taskPdf.pages, taskFontPt:taskPdf.effectiveFontSize, taskSections:[...taskSections], speakerSections:[...speakerSections] }, null, 2))
