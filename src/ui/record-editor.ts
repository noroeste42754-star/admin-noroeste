/** Move an existing form into a consistent dialog without replacing its save handler. */
export function mountRecordEditor(host: HTMLElement, formId: string): HTMLFormElement | null {
  const form = host.querySelector<HTMLFormElement>(`#${formId}`)
  if (!form) return null
  const dialog = document.createElement('dialog')
  dialog.className = 'modal record-editor-dialog'
  dialog.append(form)
  host.append(dialog)
  dialog.addEventListener('cancel', event => {
    event.preventDefault()
    const cancel = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Cancelar')
    cancel?.click()
  })
  dialog.showModal()
  return form
}

export function closeRecordEditor(form: HTMLElement): void {
  const dialog = form.closest<HTMLDialogElement>('dialog.record-editor-dialog')
  if (dialog?.open) dialog.close()
  dialog?.remove()
}
