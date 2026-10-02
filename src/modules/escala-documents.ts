import { localSlots, participantName, type EscalaLocal, type EscalaParticipant, type EscalaTables } from './escala-domain.ts'
import { dayLabel, hasScaleAssignments, monthLabel, printRowsForLocal } from './escala-output.ts'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib/cjs/index.js'
import { downloadPdf } from '../ui/pdf-download.ts'
import { ellipsizePdfText } from '../ui/pdf-text-fit.ts'
import { A4_LANDSCAPE, PDF_ACCENT, PDF_LINE, drawPublicPdfHeader } from '../ui/public-pdf-layout.ts'

const esc = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!)

export interface ScalePrintInput { month: string; locals: Record<string, EscalaLocal>; tables: EscalaTables; participants: Record<string, EscalaParticipant>; exclusions: string[]; requestedFontPt: number; localIds?: string[] }
export interface PreparedScalePrint { html: string; fontPt: number }

export function scalePrintHtml(input: Omit<ScalePrintInput, 'requestedFontPt'>): string {
  const allowed = input.localIds ? new Set(input.localIds) : null
  return Object.entries(input.locals).filter(([id]) => (!allowed || allowed.has(id)) && hasScaleAssignments(input.tables[id]?.[input.month])).sort((a, b) => Number(a[1].sortOrder ?? 0) - Number(b[1].sortOrder ?? 0)).map(([localId, local]) => {
    const slots = input.tables[localId]?.[input.month]?.slots ?? localSlots(local), rows = printRowsForLocal(localId, input.month, local, input.tables, input.participants, input.exclusions)
    return `<section class="escala-print-page"><header><strong>${esc(local.name ?? localId)}</strong><span>${esc(monthLabel(input.month))}</span></header><table><thead><tr><th>Dia</th>${slots.map(time => `<th>${time}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr><th>${esc(dayLabel(row.date))}</th>${row.cells.map(names => `<td>${names.map(person => `<span>${esc(person)}</span>`).join('') || '&nbsp;'}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`
  }).join('')
}

export function prepareScalePrint(input: ScalePrintInput): PreparedScalePrint {
  document.querySelector('.escala-print-doc')?.remove()
  const printable = document.createElement('div'); printable.className = 'escala-print-doc'; printable.innerHTML = scalePrintHtml(input)
  let chosen = Math.min(18, Math.max(8, Number(input.requestedFontPt || 12)))
  printable.style.setProperty('--escala-print-font', `${chosen}pt`); printable.dataset['measuring'] = 'true'; document.body.appendChild(printable)
  for (let pt = chosen; pt >= 8; pt -= 1) { printable.style.setProperty('--escala-print-font', `${pt}pt`); chosen = pt; const overflow = [...printable.querySelectorAll<HTMLElement>('.escala-print-page')].some(page => page.scrollWidth > page.clientWidth || page.scrollHeight > 735); if (!overflow || pt === 8) break }
  const html = printable.innerHTML
  printable.remove()
  return { html, fontPt: chosen }
}

export function printPreparedScale(prepared: PreparedScalePrint, month: string): void {
  const printable = document.createElement('div'); printable.className = 'escala-print-doc'; printable.dataset['printing'] = 'true'; printable.innerHTML = prepared.html
  printable.style.setProperty('--escala-print-font', `${prepared.fontPt}pt`); document.body.appendChild(printable)
  const title = document.title; document.title = `Escala do carrinho - ${monthLabel(month)}`
  const cleanup = () => { document.title = title; printable.remove() }
  window.addEventListener('afterprint', cleanup, { once: true }); window.print(); setTimeout(cleanup, 2000)
}

export function printScaleSchedule(input: ScalePrintInput): number {
  const prepared = prepareScalePrint(input)
  printPreparedScale(prepared, input.month)
  return prepared.fontPt
}

export interface ScalePdfResult { bytes: Uint8Array; pages: number; effectiveFontSize: number }
function fit(font: PDFFont, value: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(value, size) <= width) return value
  let result = value
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) result = result.slice(0, -1)
  return `${result.trim()}...`
}

function cellLines(names: string[], font: PDFFont, fontSize: number, slotCount: number): string[] {
  return names.slice(0, 2).map(name => ellipsizePdfText(font, name, 720 / Math.max(1, slotCount) - 8, fontSize))
}

function rowHeight(row: ReturnType<typeof printRowsForLocal>[number], font: PDFFont, fontSize: number, slotCount: number): number {
  return Math.max(fontSize + 7, ...row.cells.map(names => cellLines(names, font, fontSize, slotCount).length * (fontSize + 1) + 6))
}

function drawScaleHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, local: string, month: string): number {
  return drawPublicPdfHeader(page, bold, regular, { title:'Escala TPL', congregation:fit(bold, local, 10, 650), period:monthLabel(month), margin:30, compact:true })
}

function drawScaleTable(page: PDFPage, regular: PDFFont, bold: PDFFont, slots: string[], rows: ReturnType<typeof printRowsForLocal>, y: number, fontSize: number): void {
  const x = 30, width = 782, dayWidth = 62, slotWidth = (width - dayWidth) / Math.max(1, slots.length), headerHeight = 22
  page.drawRectangle({ x, y:y - headerHeight, width, height:headerHeight, color:PDF_ACCENT, borderColor:PDF_LINE, borderWidth:.5 })
  page.drawText('Dia', { x:x + 5, y:y - 15, size:fontSize, font:bold, color:rgb(1, 1, 1) })
  slots.forEach((time, index) => {
    const cellX = x + dayWidth + index * slotWidth
    page.drawLine({ start:{ x:cellX, y }, end:{ x:cellX, y:y - headerHeight }, thickness:.4, color:PDF_LINE })
    page.drawText(fit(bold, time, fontSize, slotWidth - 8), { x:cellX + 4, y:y - 15, size:fontSize, font:bold, color:rgb(1, 1, 1) })
  })
  let cursor = y - headerHeight
  rows.forEach(row => {
    const height = rowHeight(row, regular, fontSize, slots.length)
    cursor -= height
    page.drawRectangle({ x, y:cursor, width, height, borderColor:rgb(.48, .5, .5), borderWidth:.45, color:rgb(1, 1, 1) })
    page.drawText(fit(bold, dayLabel(row.date), fontSize - .5, dayWidth - 8), { x:x + 4, y:cursor + (height - fontSize) / 2, size:fontSize - .5, font:bold })
    row.cells.forEach((names, index) => {
      const cellX = x + dayWidth + index * slotWidth
      page.drawLine({ start:{ x:cellX, y:cursor }, end:{ x:cellX, y:cursor + height }, thickness:.35, color:rgb(.58, .6, .6) })
      cellLines(names, regular, fontSize, slots.length).forEach((name, line) => page.drawText(name, { x:cellX + 3.5, y:cursor + height - 3 - fontSize - line * (fontSize + 1), size:fontSize, font:regular }))
    })
  })
}

export async function createScaleSchedulePdf(input: ScalePrintInput): Promise<ScalePdfResult> {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const allowed = input.localIds ? new Set(input.localIds) : null
  const selectedLocals = Object.entries(input.locals).filter(([id]) => (!allowed || allowed.has(id)) && hasScaleAssignments(input.tables[id]?.[input.month])).sort((a, b) => Number(a[1].sortOrder ?? 0) - Number(b[1].sortOrder ?? 0))
  if (!selectedLocals.length) throw new Error('Nenhuma designação na Escala TPL para este período.')
  const requested = Number.isFinite(input.requestedFontPt) ? input.requestedFontPt : 12
  let effectiveFontSize = Math.min(11, Math.max(7, requested))
  for (const [localId, local] of selectedLocals) {
    for (const row of Object.values(input.tables[localId]?.[input.month]?.rows ?? {})) {
      for (const cell of Object.values(row.slots ?? {})) for (const id of [cell.p1, cell.p2].filter(Boolean)) {
        const name = participantName(input.participants[id], id)
        if (!name || name === id) throw new Error(`A Escala TPL contém participante sem nome cadastrado (${id}). Corrija o vínculo antes de gerar o PDF.`)
      }
    }
    const allSlots = input.tables[localId]?.[input.month]?.slots ?? localSlots(local)
    const allRows = printRowsForLocal(localId, input.month, local, input.tables, input.participants, input.exclusions)
    const occupied = allSlots.map((_, index) => index).filter(index => allRows.some(row => row.cells[index]?.length))
    const columns = occupied.length ? occupied : allSlots.map((_, index) => index)
    const slots = columns.map(index => allSlots[index])
    const rows = allRows.map(row => ({ ...row, cells:columns.map(index => row.cells[index]) }))
    const page = pdf.addPage(A4_LANDSCAPE)
    const y = drawScaleHeader(page, regular, bold, String(local.name ?? localId), input.month)
    let fontSize = Math.min(11, Math.max(8, requested))
    const height = () => rows.reduce((sum, row) => sum + rowHeight(row, regular, fontSize, slots.length), 22)
    while (height() > y - 30 && fontSize > 6) fontSize = Math.max(6, fontSize - .25)
    if (height() > y - 30) throw new Error(`A escala ${local.name ?? localId} não cabe em uma folha A4 com nomes legíveis. Reduza os horários ou o período.`)
    effectiveFontSize = Math.min(effectiveFontSize, fontSize)
    drawScaleTable(page, regular, bold, slots, rows, y, fontSize)
  }
  return { bytes:Uint8Array.from(await pdf.save()), pages:pdf.getPageCount(), effectiveFontSize }
}

export async function downloadScaleSchedulePdf(input: ScalePrintInput): Promise<ScalePdfResult> {
  const result = await createScaleSchedulePdf(input)
  downloadPdf(result.bytes, `escala-tpl-${input.month}.pdf`)
  return result
}

export async function downloadScaleScheduleXlsx(input: ScalePrintInput): Promise<void> {
  const { downloadStyledXlsx } = await import('../ui/xlsx-download.ts')
  const allowed=input.localIds?new Set(input.localIds):null
  const selected=Object.entries(input.locals).filter(([id])=>(!allowed||allowed.has(id))&&hasScaleAssignments(input.tables[id]?.[input.month]))
    .sort((a,b)=>Number(a[1].sortOrder??0)-Number(b[1].sortOrder??0))
  if(!selected.length) throw new Error('Nenhuma designação na Escala TPL para este mês.')
  await downloadStyledXlsx(selected.map(([localId,local],index)=>{
    const allSlots=input.tables[localId]?.[input.month]?.slots??localSlots(local)
    const allRows=printRowsForLocal(localId,input.month,local,input.tables,input.participants,input.exclusions)
    const occupied=allSlots.map((_,i)=>i).filter(i=>allRows.some(row=>row.cells[i]?.length))
    const columns=occupied.length?occupied:allSlots.map((_,i)=>i)
    return {
      name:`${index+1}-${local.name??localId}`.slice(0,31).replace(/[\\/*?\[\]:]/g,'-'),
      title:`Escala TPL · ${local.name??localId}`,subtitle:monthLabel(input.month),
      headers:['Dia',...columns.map(i=>allSlots[i])],widths:[18,...columns.map(()=>38)],dateColumns:[1],orientation:'landscape' as const,
      rows:allRows.map(row=>[new Date(`${row.date}T12:00:00Z`),...columns.map(i=>row.cells[i]?.join(' / ')??'')]),
    }
  }),`escala-tpl-${input.month}.xlsx`)
}
