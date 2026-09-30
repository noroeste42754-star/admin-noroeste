import { SPEAKER_TEMPLATE, TASK_TEMPLATE, resolveMessageTemplate } from './message-domain'
import { editorBusy, editorSaved, editorError } from '../ui/editor-feedback'
import { agendaConfigRef, child, get, set } from '../firebase'

export type MessageSettingsModule = 'tarefas' | 'oradores' | 'oradoresS1'

export interface ModuleMessageSettings {
  meetingText?: string
}

const MODULE_LABELS: Record<MessageSettingsModule, string> = {
  tarefas:'Tarefas',
  oradores:'Oradores',
  oradoresS1:'Oradores · 1ª seção',
}

const MEETING_DEFAULTS: Record<MessageSettingsModule, string> = {
  tarefas:TASK_TEMPLATE,
  oradores:SPEAKER_TEMPLATE,
  oradoresS1:SPEAKER_TEMPLATE,
}

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char] ?? char)
}

export function defaultModuleMessageSettings(module: MessageSettingsModule): Required<ModuleMessageSettings> {
  return { meetingText:MEETING_DEFAULTS[module] }
}

export async function mountModuleMessageSettings(
  containerId: string,
  module: MessageSettingsModule,
  notify: (message: string) => void,
  onSaved?: (settings: Required<ModuleMessageSettings>) => void,
): Promise<void> {
  const container = document.getElementById(containerId)
  if (!container) return
  container.innerHTML = '<p class="empty-state">Carregando mensagens...</p>'

  const defaults = defaultModuleMessageSettings(module)
  let current: ModuleMessageSettings = {}
  try {
    const snapshot = await get<ModuleMessageSettings>(child(agendaConfigRef, `moduleWhatsApp/${module}`))
    current = snapshot.exists() ? snapshot.val() ?? {} : {}
  } catch {
    container.innerHTML = '<div class="notice warning">Não foi possível carregar as mensagens deste módulo.</div>'
    return
  }

  current.meetingText=resolveMessageTemplate(module==='oradoresS1'?'oradores':module,current.meetingText)
  if (!document.getElementById(containerId)) return
  const prefix = `moduleMessage_${module}`
  container.innerHTML = `
    <details class="form-panel" data-editor-scope>
      <summary><strong>Mensagem de ${esc(MODULE_LABELS[module])}</strong></summary>
      <p class="form-help" style="margin-top:12px">Este texto é usado nas mensagens preparadas pelo módulo e pode ser editado antes do envio.</p>
      <div class="form-group">
        <label class="form-label" for="${prefix}_meeting">Mensagem de reunião ou programação</label>
        <textarea id="${prefix}_meeting" class="form-input" rows="5" maxlength="2000">${esc(current.meetingText?.trim() || defaults.meetingText)}</textarea>
      </div>
      <button id="${prefix}_save" class="btn btn-primary" type="button">Salvar mensagem</button>
    </details>`

  document.getElementById(`${prefix}_save`)?.addEventListener('click', async () => {
    const next: ModuleMessageSettings = {
      ...current,
      meetingText:(document.getElementById(`${prefix}_meeting`) as HTMLTextAreaElement).value.trim() || defaults.meetingText,
    }
    const button = document.getElementById(`${prefix}_save`) as HTMLButtonElement
    const scope=container.querySelector<HTMLElement>('[data-editor-scope]')!
    const release=editorBusy(scope)
    button.disabled = true
    button.textContent = 'Salvando...'
    try {
      await set(child(agendaConfigRef, `moduleWhatsApp/${module}`), next)
      current=next
      onSaved?.({ ...defaults, ...next })
      editorSaved(scope)
      notify('Mensagem do módulo salva')
    } catch {
      editorError(scope)
      notify('Não foi possível salvar as mensagens')
    } finally {
      release()
      button.disabled = false
      button.textContent = 'Salvar mensagem'
    }
  })
}
