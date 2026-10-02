export interface StyledSheet {
  name: string
  title: string
  subtitle: string
  headers: string[]
  widths: number[]
  rows: Array<Array<string | number | Date>>
  dateColumns?: number[]
  orientation?: 'portrait' | 'landscape'
}

const PURPLE = 'FF5B3C88'
const WINE = 'FF942926'
const INK = 'FF202026'
const PAPER = 'FFF7F7F5'
const BORDER = 'FFD8D8D8'

/** Browser-only export, loaded on demand so normal navigation stays lightweight. */
export async function downloadStyledXlsx(sheets: StyledSheet[], filename: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Congregação Noroeste'
  workbook.subject = 'Programação mensal'
  for (const spec of sheets) {
    const sheet = workbook.addWorksheet(spec.name, {
      views: [{ state:'frozen', ySplit:4 }],
      pageSetup: { paperSize:9, orientation:spec.orientation ?? 'portrait', fitToPage:true, fitToWidth:1, fitToHeight:0 },
    })
    sheet.columns = spec.widths.map(width => ({ width }))
    sheet.mergeCells(1, 1, 1, spec.headers.length)
    const title = sheet.getCell(1, 1)
    title.value = spec.title
    title.font = { name:'Aptos Display', size:16, bold:true, color:{ argb:PURPLE } }
    title.alignment = { vertical:'middle' }
    sheet.getRow(1).height = 29
    sheet.mergeCells(2, 1, 2, spec.headers.length)
    const subtitle = sheet.getCell(2, 1)
    subtitle.value = spec.subtitle
    subtitle.font = { name:'Aptos', size:10, bold:true, color:{ argb:WINE } }
    sheet.getRow(2).height = 23
    const heading = sheet.getRow(4)
    heading.values = spec.headers
    heading.height = 24
    heading.eachCell(cell => {
      cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:PURPLE } }
      cell.font = { name:'Aptos', size:10, bold:true, color:{ argb:'FFFFFFFF' } }
      cell.alignment = { vertical:'middle', horizontal:'left' }
      cell.border = { bottom:{ style:'thin', color:{ argb:BORDER } } }
    })
    spec.rows.forEach((values, index) => {
      const row = sheet.addRow(values)
      row.height = 21
      row.eachCell({ includeEmpty:true }, (cell, column) => {
        cell.font = { name:'Aptos', size:10, color:{ argb:INK } }
        cell.alignment = { vertical:'middle', horizontal:'left', shrinkToFit:true }
        if (index % 2 === 0) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:PAPER } }
        cell.border = { bottom:{ style:'hair', color:{ argb:BORDER } } }
        if (spec.dateColumns?.includes(column)) cell.numFmt = 'dd/mm/yyyy'
      })
    })
    if (spec.rows.length) sheet.autoFilter = { from:{ row:4, column:1 }, to:{ row:4 + spec.rows.length, column:spec.headers.length } }
    sheet.headerFooter.oddFooter = 'Noroeste · página &P de &N'
  }
  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = Uint8Array.from(new Uint8Array(buffer))
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
}
