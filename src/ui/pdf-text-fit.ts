import type { PDFFont } from 'pdf-lib/cjs/index.js'

/** Prefer one line, but preserve a legible minimum for exceptional long content. */
export function fitPdfFont(font: PDFFont, text: string, width: number, preferred: number, minimum = 6): number {
  const measured = font.widthOfTextAtSize(text.replace(/\s+/g, ' ').trim(), 1)
  return Math.max(minimum, Math.min(preferred, measured ? Math.floor(width / measured * 100) / 100 : preferred))
}

/** Keep table cells on one line without changing the underlying record. */
export function ellipsizePdfText(font: PDFFont, value: string, width: number, size: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (font.widthOfTextAtSize(text, size) <= width) return text
  const suffix = '...'
  if (font.widthOfTextAtSize(suffix, size) > width) return ''
  const chars = [...text]
  let low = 0, high = chars.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (font.widthOfTextAtSize(`${chars.slice(0, middle).join('').trimEnd()}${suffix}`, size) <= width) low = middle
    else high = middle - 1
  }
  return `${chars.slice(0, low).join('').trimEnd()}${suffix}`
}
