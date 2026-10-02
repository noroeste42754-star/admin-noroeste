import { TASK_ROLES, TASK_ROLE_LABELS, assignmentForRole, personName, roleApplies, type TaskMeeting, type TaskPerson } from './tarefas-domain.ts'
import { formatTaskDate, paginateItems, rowsPerPrintPage } from './tarefas-output.ts'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib/cjs/index.js'
import { downloadPdf } from '../ui/pdf-download.ts'
import { ellipsizePdfText } from '../ui/pdf-text-fit.ts'
import { A4_PORTRAIT, PDF_ACCENT, PDF_INK, PDF_LINE, drawPublicPdfHeader } from '../ui/public-pdf-layout.ts'

const MIN_PT = 8, MAX_PT = 22
const A4_WIDTH = ((210 - 16) / 25.4) * 96
const A4_HEIGHT = ((297 - 16) / 25.4) * 96
const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!)

function assignmentName(value: unknown, people: Record<string, TaskPerson>): string {
  if (typeof value === 'string') return people[value] ? personName(people[value], value) : value
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  const direct = item['name'] ?? item['nome'] ?? item['label']
  if (typeof direct === 'string' && direct.trim()) return direct
  const id = item['personId'] ?? item['pessoaId'] ?? item['peopleId'] ?? item['id']
  return typeof id === 'string' ? (people[id] ? personName(people[id], id) : id) : ''
}

export function taskPrintHtml(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, pageSize = meetings.length): string {
  const last = meetings[meetings.length - 1]
  return paginateItems(meetings, pageSize).map((page, index, pages) => `<div class="tarefas-print-page"><header class="tarefas-print-header"><div><div class="tarefas-print-title">Escala de Tarefas</div><div class="tarefas-print-subtitle">${esc(congregation)}</div></div><div class="tarefas-print-period">${formatTaskDate(meetings[0]?.date)} - ${formatTaskDate(last?.date)}${pages.length > 1 ? ` · ${index + 1}/${pages.length}` : ''}</div></header><div class="tarefas-print-meetings">${page.map(meeting => { const roles = TASK_ROLES.filter(role => roleApplies(role, meeting)); return `<section class="tarefas-print-meeting"><h2>${formatTaskDate(meeting.date)} · ${meeting.type === 'midweek' ? 'Meio de semana' : meeting.type === 'weekend_s1' ? 'Fim de semana · 1ª seção' : meeting.type === 'weekend_merged' ? 'Fim de semana · Reunião única' : 'Fim de semana · 2ª seção'}</h2><table class="tarefas-print-table"><tbody>${roles.map(role => `<tr><th>${esc(TASK_ROLE_LABELS[role])}</th><td>${esc(assignmentName(assignmentForRole(meeting, role), people))}</td></tr>`).join('')}</tbody></table></section>` }).join('')}</div></div>`).join('')
}

export interface PreparedTaskPrint {
  html: string
  fontPt: number
}

export function prepareTaskPrint(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, preferredFontPt: number): PreparedTaskPrint {
  const doc = document.createElement('div'); doc.className = 'tarefas-print-doc'; doc.innerHTML = taskPrintHtml(meetings, congregation, people); document.body.appendChild(doc)
  let chosen = Math.min(MAX_PT, Math.max(MIN_PT, Math.round(preferredFontPt))), fitsHeight = false
  doc.dataset['measuring'] = 'true'
  for (let size = chosen; size >= MIN_PT; size -= 1) { doc.style.fontSize = `${size}pt`; chosen = size; const fitsWidth = doc.scrollWidth <= A4_WIDTH; fitsHeight = doc.scrollHeight <= A4_HEIGHT; if (fitsWidth && fitsHeight) break }
  if (!fitsHeight) { const header = doc.querySelector<HTMLElement>('.tarefas-print-header')?.offsetHeight ?? 0, tableHeader = doc.querySelector<HTMLElement>('thead')?.offsetHeight ?? 0, rows = [...doc.querySelectorAll<HTMLElement>('tbody tr')], rowHeight = Math.max(1, ...rows.map(row => row.offsetHeight)); doc.innerHTML = taskPrintHtml(meetings, congregation, people, rowsPerPrintPage(A4_HEIGHT, header, tableHeader, rowHeight)) }
  const html = doc.innerHTML
  doc.remove()
  return { html, fontPt: chosen }
}

export function printPreparedTaskSchedule(prepared: PreparedTaskPrint): void {
  const doc = document.createElement('div'); doc.className = 'tarefas-print-doc'; doc.innerHTML = prepared.html; doc.dataset['printing'] = 'true'; doc.style.fontSize = `${prepared.fontPt}pt`; document.body.appendChild(doc)
  const cleanup = () => { window.removeEventListener('afterprint', cleanup); doc.remove() }
  window.addEventListener('afterprint', cleanup); window.print(); setTimeout(cleanup, 2000)
}

export function printTaskSchedule(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, preferredFontPt: number): number {
  const prepared = prepareTaskPrint(meetings, congregation, people, preferredFontPt)
  printPreparedTaskSchedule(prepared)
  return prepared.fontPt
}

export interface TaskPdfResult { bytes: Uint8Array; pages: number; effectiveFontSize: number }

const PDF_MARGIN = 34

export async function createTaskSchedulePdf(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, preferredFontPt: number): Promise<TaskPdfResult> {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ordered = [...meetings].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || Number(b.type==='weekend_s1')-Number(a.type==='weekend_s1'))
  const page = pdf.addPage(A4_PORTRAIT)
  const period = ordered.length ? `${formatTaskDate(ordered[0]?.date)} - ${formatTaskDate(ordered[ordered.length - 1]?.date)}` : 'Sem período'
  let y = drawPublicPdfHeader(page, bold, regular, { title:'Escala de Tarefas', congregation, period, margin:PDF_MARGIN, compact:true })
  page.drawText('S1 = 1ª seção   ·   S2 = 2ª seção   ·   M = Meio de semana', { x:PDF_MARGIN, y:18, size:8, font:regular, color:PDF_INK })
  const blocks: Array<{ title:string; roles:typeof TASK_ROLES[number][] }> = [
    { title:'Áudio e Vídeo', roles:['operador1', 'operador2', 'mic1', 'mic2'] },
    { title:'Presidente, leitor e indicadores', roles:['presidente', 'leitor', 'entrada', 'auditorio'] },
  ]
  const width = A4_PORTRAIT[0] - PDF_MARGIN * 2, dateWidth = 75, cellWidth = (width - dateWidth) / 4
  const dateAndSection = (meeting:TaskMeeting):string => `${formatTaskDate(meeting.date).slice(0,5)} ${meeting.type==='midweek'?'M':meeting.type==='weekend_s1'?'S1':meeting.type==='weekend_merged'?'Única':'S2'}`
  const prepare = (size: number) => blocks.map(block => ({
    ...block,
    rows:ordered.map(meeting => {
      const cells = [ellipsizePdfText(bold, dateAndSection(meeting), dateWidth - 8, size),
        ...block.roles.map(role => ellipsizePdfText(regular, roleApplies(role, meeting) ? assignmentName(assignmentForRole(meeting, role), people) || 'A definir' : '-', cellWidth - 8, size))]
      return { cells, height:size + 6 }
    }),
  }))
  let effectiveFontSize = Math.min(10, Math.max(8, Number(preferredFontPt) || 10))
  let prepared = prepare(effectiveFontSize)
  const height = () => prepared.reduce((sum, block) => sum + 37 + block.rows.reduce((total, row) => total + row.height, 0), 0)
  while (height() > y - PDF_MARGIN && effectiveFontSize > 8) {
    effectiveFontSize = Math.max(8, effectiveFontSize - .25)
    prepared = prepare(effectiveFontSize)
  }
  if (height() > y - PDF_MARGIN) {
    if (ordered.length < 2) throw new Error('Uma reunião não cabe em uma folha A4 com nomes legíveis.')
    const monthBreak = ordered.findIndex((meeting, index) => index > 0 && meeting.date?.slice(0, 7) !== ordered[0]?.date?.slice(0, 7))
    const split = monthBreak > 0 && monthBreak < ordered.length ? monthBreak : Math.ceil(ordered.length / 2)
    const first = await createTaskSchedulePdf(ordered.slice(0, split), congregation, people, preferredFontPt)
    const second = await createTaskSchedulePdf(ordered.slice(split), congregation, people, preferredFontPt)
    const joined = await PDFDocument.create()
    for (const bytes of [first.bytes, second.bytes]) {
      const source = await PDFDocument.load(bytes)
      for (const copied of await joined.copyPages(source, source.getPageIndices())) joined.addPage(copied)
    }
    return { bytes:Uint8Array.from(await joined.save()), pages:first.pages + second.pages, effectiveFontSize:Math.min(first.effectiveFontSize, second.effectiveFontSize) }
  }
  if (!ordered.length) page.drawText('Nenhuma reunião cadastrada.', { x:PDF_MARGIN, y, size:10, font:regular })
  for (const block of ordered.length ? prepared : []) {
    page.drawText(block.title, { x:PDF_MARGIN, y:y - 9, size:9, font:bold, color:PDF_INK })
    y -= 15
    page.drawRectangle({ x:PDF_MARGIN, y:y - 18, width, height:18, color:PDF_ACCENT })
    ;['Data/Seção', ...block.roles.map(role => TASK_ROLE_LABELS[role])].forEach((label, index) => {
      const x = PDF_MARGIN + (index ? dateWidth + (index - 1) * cellWidth : 0)
      page.drawText(label, { x:x + 4, y:y - 12, size:8, font:bold, color:rgb(1, 1, 1) })
    })
    y -= 18
    for (const [rowIndex, row] of block.rows.entries()) {
      if (rowIndex % 2 === 0) page.drawRectangle({ x:PDF_MARGIN, y:y - row.height, width, height:row.height, color:rgb(.96, .97, .98) })
      row.cells.forEach((cell, column) => {
        const x = PDF_MARGIN + (column ? dateWidth + (column - 1) * cellWidth : 0)
        page.drawText(cell, { x:x + 4, y:y - 1.5 - effectiveFontSize, size:effectiveFontSize, font:column ? regular : bold, color:PDF_INK })
        page.drawLine({ start:{ x, y }, end:{ x, y:y - row.height }, thickness:.3, color:PDF_LINE })
      })
      page.drawLine({ start:{ x:PDF_MARGIN + width, y }, end:{ x:PDF_MARGIN + width, y:y - row.height }, thickness:.3, color:PDF_LINE })
      y -= row.height
      page.drawLine({ start:{ x:PDF_MARGIN, y }, end:{ x:PDF_MARGIN + width, y }, thickness:.3, color:PDF_LINE })
    }
    y -= 4
  }
  return { bytes:Uint8Array.from(await pdf.save()), pages:1, effectiveFontSize }
}

export async function downloadTaskSchedulePdf(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, preferredFontPt: number, periodId: string): Promise<TaskPdfResult> {
  const result = await createTaskSchedulePdf(meetings, congregation, people, preferredFontPt)
  downloadPdf(result.bytes, `tarefas-${periodId}.pdf`)
  return result
}

export async function downloadTaskScheduleXlsx(meetings: TaskMeeting[], congregation: string, people: Record<string, TaskPerson>, month: string): Promise<void> {
  const { downloadStyledXlsx } = await import('../ui/xlsx-download.ts')
  const ordered = [...meetings].sort((a,b)=>String(a.date??'').localeCompare(String(b.date??'')) || Number(b.type==='weekend_s1')-Number(a.type==='weekend_s1'))
  const groups = [
    { name:'Áudio e vídeo', roles:['operador1','operador2','mic1','mic2'] as const },
    { name:'Reunião', roles:['presidente','leitor','entrada','auditorio'] as const },
  ]
  await downloadStyledXlsx(groups.map(group=>({
    name:group.name,title:`Escala de Tarefas · ${group.name}`,subtitle:`${congregation} · ${month}`,
    headers:['Data','Seção',...group.roles.map(role=>TASK_ROLE_LABELS[role])],widths:[15,21,28,28,28,28],dateColumns:[1],
    rows:ordered.map(meeting=>[
      new Date(`${meeting.date}T12:00:00Z`),
      meeting.type==='midweek'?'Meio de semana':meeting.type==='weekend_s1'?'1ª seção':meeting.type==='weekend_merged'?'Reunião única':'2ª seção',
      ...group.roles.map(role=>roleApplies(role,meeting)?assignmentName(assignmentForRole(meeting,role),people)||'A definir':'-'),
    ]),
  })),`tarefas-${month}.xlsx`)
}
