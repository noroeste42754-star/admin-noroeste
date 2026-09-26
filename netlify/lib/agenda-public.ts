import type { AgendaConfig, AgendaPublicDocument, AgendaReminderModule } from '../../src/types.ts'
import { pdfHasExpired } from '../../src/modules/pdf-expiry.ts'
import type { AgendaEvent, AgendaSource, AgendaStatus, AnnouncementEvent } from '../../src/modules/individual-domain.ts'

const SOURCES = new Set<AgendaSource>(['tarefas', 'oradores', 'limpeza', 'escala', 'servicoCampo'])
const STATUSES = new Set<AgendaStatus>(['futuro', 'confirmacao-pendente', 'alterado', 'realizado'])
const REMINDER_MODULES = new Set<AgendaReminderModule>([...SOURCES, 'oradores', 'quadro'])
const DOCUMENT_MODULES = new Set(['tarefas', 'oradores', 'limpeza', 'escala', 'servicoCampo'])
const reminderPattern = /^P(?:\d+D)?(?:T\d+[HM])?$/

const text = (value: unknown, maximum: number): string => typeof value === 'string' ? value.trim().slice(0, maximum) : ''
const httpsUrl = (value: unknown): string => {
  const candidate = text(value, 2_000)
  try { return new URL(candidate).protocol === 'https:' ? candidate : '' }
  catch { return '' }
}

export function publicAgendaEvent(value: AgendaEvent): AgendaEvent | null {
  if (!SOURCES.has(value.source) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !STATUSES.has(value.status)) return null
  const title = text(value.title, 160), detail = text(value.detail, 300)
  const id = text(value.id, 240)
  if (!id || !title || !detail) return null
  return {
    id, source:value.source, date:value.date, title, detail, status:value.status,
    ...(value.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ? { time:value.time } : {}),
    ...(value.location ? { location:text(value.location, 300) } : {}),
    ...(value.mapLocation ? { mapLocation:text(value.mapLocation, 2000) } : {}),
  }
}

export function publicAnnouncementEvent(value: AnnouncementEvent): AnnouncementEvent | null {
  const event = publicAgendaEvent({ ...value, note:undefined })
  if (!event) return null
  return { ...event, people:[...new Set(value.people.map(name => text(name, 120)).filter(Boolean))] }
}

export function publicAgendaDocuments(value: unknown): Record<string, AgendaPublicDocument> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: Record<string, AgendaPublicDocument> = {}
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
    const item = raw as Record<string, unknown>, modulo = text(item['modulo'], 40)
    const url = httpsUrl(item['url']), id = text(item['id'], 240) || text(key, 240)
    if (!DOCUMENT_MODULES.has(modulo) || !id || !url || pdfHasExpired(item['criadoEm'])) return
    result[key] = {
      id, modulo:modulo as AgendaPublicDocument['modulo'], url,
      tipo:item['tipo'] === 'admin' || modulo === 'admin' ? 'admin' : 'modulo',
      periodo:text(item['periodo'], 80), nome:text(item['nome'], 240) || 'Documento.pdf',
      criadoEm:text(item['criadoEm'], 40),
      ...(text(item['inicio'], 20) ? { inicio:text(item['inicio'], 20) } : {}),
      ...(text(item['fim'], 20) ? { fim:text(item['fim'], 20) } : {}),
      ...(text(item['origemPeriodoId'], 120) ? { origemPeriodoId:text(item['origemPeriodoId'], 120) } : {}),
    }
  })
  return result
}

export function publicAgendaConfig(value: unknown): AgendaConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const source = value as Record<string, unknown>, result: AgendaConfig = {}
  const legacyLink = httpsUrl(source['quadroWhatsAppLink'])
  if (legacyLink) result.quadroWhatsAppLink = legacyLink
  const outrosAnunciosDriveUrl = httpsUrl(source['outrosAnunciosDriveUrl'])
  if (outrosAnunciosDriveUrl) result.outrosAnunciosDriveUrl = outrosAnunciosDriveUrl

  const moduleWhatsApp = source['moduleWhatsApp']
  if (moduleWhatsApp && typeof moduleWhatsApp === 'object' && !Array.isArray(moduleWhatsApp)) {
    result.moduleWhatsApp = {}
    Object.entries(moduleWhatsApp as Record<string, unknown>).forEach(([module, raw]) => {
      if (!REMINDER_MODULES.has(module as AgendaReminderModule) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return
      const item = raw as Record<string, unknown>, groupLink = httpsUrl(item['groupLink'])
      result.moduleWhatsApp![module as AgendaReminderModule] = {
        ...(groupLink ? { groupLink } : {}),
        ...(text(item['meetingText'], 4_000) ? { meetingText:text(item['meetingText'], 4_000) } : {}),
        ...(text(item['documentText'], 4_000) ? { documentText:text(item['documentText'], 4_000) } : {}),
      }
    })
  }

  const reminders = source['icsReminders']
  if (reminders && typeof reminders === 'object' && !Array.isArray(reminders)) {
    result.icsReminders = {}
    Object.entries(reminders as Record<string, unknown>).forEach(([module, raw]) => {
      if (!REMINDER_MODULES.has(module as AgendaReminderModule) || !Array.isArray(raw)) return
      result.icsReminders![module as AgendaReminderModule] = [...new Set(raw.filter(item => typeof item === 'string' && reminderPattern.test(item)))].slice(0, 2) as string[]
    })
  }
  return result
}
