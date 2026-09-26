import type { AgendaPublicDocument } from '../types.ts'
import { pdfHasExpired } from './pdf-expiry.ts'

export const PUBLIC_PDF_MODULES = ['tarefas', 'oradores', 'escala', 'limpeza', 'servicoCampo'] as const
export type PublicPdfModule = typeof PUBLIC_PDF_MODULES[number]

export interface PublicDocumentGroups {
  modules: Partial<Record<PublicPdfModule, AgendaPublicDocument>>
}

const validMonth = (value: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(value)

export function safeDocumentKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

export function officialDocumentId(module: PublicPdfModule, originPeriodId: string): string {
  return `modulo-${module}-${safeDocumentKey(originPeriodId)}`
}

export function documentCoversMonth(item: AgendaPublicDocument, month: string): boolean {
  if (!validMonth(month)) return false
  const start = item.inicio?.slice(0, 7)
  const end = item.fim?.slice(0, 7)
  if (validMonth(start ?? '') && validMonth(end ?? '')) return month >= start! && month <= end!
  return item.periodo === month || item.periodo.startsWith(month)
}

export function groupPublicDocuments(documents: AgendaPublicDocument[], month: string, now = Date.now()): PublicDocumentGroups {
  const modules: Partial<Record<PublicPdfModule, AgendaPublicDocument>> = {}
  documents.filter(item => !pdfHasExpired(item.criadoEm, now) && documentCoversMonth(item, month)).forEach(item => {
    if (!PUBLIC_PDF_MODULES.includes(item.modulo as PublicPdfModule)) return
    const module = item.modulo as PublicPdfModule
    const current = modules[module]
    if (!current || item.criadoEm > current.criadoEm) modules[module] = item
  })
  return { modules }
}

export function publicDocumentMonths(documents: AgendaPublicDocument[], now = Date.now()): string[] {
  const result = new Set<string>()
  documents.filter(item => PUBLIC_PDF_MODULES.includes(item.modulo as PublicPdfModule) && !pdfHasExpired(item.criadoEm, now)).forEach(item => {
    const start = item.inicio?.slice(0, 7)
    const end = item.fim?.slice(0, 7)
    if (!validMonth(start ?? '') || !validMonth(end ?? '') || start! > end!) {
      if (validMonth(item.periodo)) result.add(item.periodo)
      return
    }
    let [year, month] = start!.split('-').map(Number)
    const [endYear, endMonth] = end!.split('-').map(Number)
    while (year < endYear || (year === endYear && month <= endMonth)) {
      result.add(`${year}-${String(month).padStart(2, '0')}`)
      month += 1
      if (month > 12) { month = 1; year += 1 }
    }
  })
  return [...result].sort((a, b) => b.localeCompare(a))
}
