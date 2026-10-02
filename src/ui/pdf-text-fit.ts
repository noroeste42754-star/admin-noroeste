import type { PDFFont } from 'pdf-lib/cjs/index.js'

/** Prefer one line, but preserve a legible minimum for exceptional long content. */
export function fitPdfFont(font: PDFFont, text: string, width: number, preferred: number, minimum = 6): number {
  const measured = font.widthOfTextAtSize(text.replace(/\s+/g, ' ').trim(), 1)
  return Math.max(minimum, Math.min(preferred, measured ? Math.floor(width / measured * 100) / 100 : preferred))
}
