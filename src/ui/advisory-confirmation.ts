const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

export function confirmAdvisoryWarnings(host: HTMLElement, title: string, warnings: string[]): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><h2>${escapeHtml(title)}</h2><p class="form-help">O motor não escolheria esta pessoa automaticamente pelos motivos abaixo. Você pode manter a escolha manual.</p><ul>${warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul><div class="service-actions"><button type="button" class="btn btn-ghost" data-advisory-back>Voltar e revisar</button><button type="button" class="btn btn-primary" data-advisory-confirm>Salvar mesmo assim</button></div></div>`
    host.append(overlay)
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const finish = (confirmed: boolean) => {
      overlay.removeEventListener('keydown', onKeydown)
      overlay.remove()
      previousFocus?.focus()
      resolve(confirmed)
    }
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    }
    overlay.addEventListener('keydown', onKeydown)
    overlay.querySelector('[data-advisory-back]')?.addEventListener('click', () => finish(false))
    overlay.querySelector('[data-advisory-confirm]')?.addEventListener('click', () => finish(true))
    overlay.querySelector<HTMLButtonElement>('[data-advisory-back]')?.focus()
  })
}
