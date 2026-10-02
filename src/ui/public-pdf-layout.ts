import { rgb, type PDFFont, type PDFPage } from 'pdf-lib/cjs/index.js'

export const A4_PORTRAIT: [number, number] = [595.28, 841.89]
export const A4_LANDSCAPE: [number, number] = [841.89, 595.28]
export const PDF_INK = rgb(.08, .1, .14)
export const PDF_MUTED = rgb(.32, .34, .38)
export const PDF_LINE = rgb(.68, .7, .73)
export const PDF_ACCENT = rgb(91/255, 60/255, 136/255)
export const PDF_WINE = rgb(148/255, 41/255, 38/255)
export const PDF_GOLD = rgb(155/255, 109/255, 23/255)

export function drawPublicPdfHeader(page: PDFPage, bold: PDFFont, regular: PDFFont, options: {
  title: string
  congregation: string
  period?: string
  margin?: number
  compact?: boolean
}): number {
  const { width, height } = page.getSize()
  const margin = options.margin ?? 42
  if (options.compact) {
    page.drawText(options.title.toLocaleUpperCase('pt-BR'), { x:margin, y:height - 30, size:16, font:bold, color:PDF_ACCENT })
    page.drawText(options.congregation.toLocaleUpperCase('pt-BR'), { x:margin, y:height - 45, size:9, font:regular, color:PDF_MUTED })
    page.drawLine({ start:{ x:margin, y:height - 53 }, end:{ x:width - margin, y:height - 53 }, thickness:.6, color:PDF_LINE })
    if (options.period) page.drawText(options.period.toLocaleUpperCase('pt-BR'), { x:margin, y:height - 69, size:10, font:bold, color:PDF_WINE })
    return height - 84
  }
  page.drawText(options.title.toLocaleUpperCase('pt-BR'), { x:margin, y:height - 54, size:18, font:bold, color:PDF_ACCENT })
  page.drawText((options.congregation || 'Congregacao').toLocaleUpperCase('pt-BR'), { x:margin, y:height - 72, size:9, font:regular, color:PDF_MUTED })
  page.drawLine({ start:{ x:margin, y:height - 82 }, end:{ x:width - margin, y:height - 82 }, thickness:1, color:PDF_MUTED })
  let y = height - 108
  if (options.period) {
    page.drawText(options.period.toLocaleUpperCase('pt-BR'), { x:margin, y, size:11, font:bold, color:PDF_INK })
    y -= 28
  }
  return y
}
