/** Filters canonical-ID selects without creating people or accepting free-text IDs. */
export function installPersonSearch(): void {
  const selector = '#taskPersonMaster, #pmMaster, #speakerForm select[name="masterId"], #speakerScheduleForm select[name="oradorId"], #speakerScheduleForm select[name="oradorSecundarioId"], #speakerScheduleForm select[name="congregacaoId"], #taskMeetingForm select[data-meeting-role], #serviceLeaderForm select[name="leaderId"]'
  const enhance = (): void => {
    document.querySelectorAll<HTMLSelectElement>(selector).forEach(select => {
      if (select.disabled || select.dataset.searchReady) return
      select.dataset.searchReady = 'true'
      const options = [...select.options].map(option => option.cloneNode(true) as HTMLOptionElement)
      const names = options.map(option => option.text)
      options.forEach(option => { if (option.value && names.filter(name => name === option.text).length > 1) option.text += ` · ID ${option.value}` })
      const selectedValue = select.value
      select.replaceChildren(...options.map(option => option.cloneNode(true)))
      select.value = selectedValue
      const input = document.createElement('input')
      input.type = 'search'; input.className = 'form-input'; input.placeholder = 'Digite o nome para filtrar'
      input.setAttribute('aria-label', 'Buscar pessoa pelo nome'); input.dataset.personSearch = 'true'
      const hint = document.createElement('small'); hint.className = 'form-help'; hint.setAttribute('aria-live', 'polite')
      select.before(input); select.after(hint)
      input.addEventListener('input', () => {
        const selected = select.value
        const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
        const term = normalize(input.value.trim())
        const matches = options.filter(option => option.value && normalize(option.text).includes(term))
        select.replaceChildren(...options.filter(option => !option.value || option.value === selected || matches.includes(option)).map(option => option.cloneNode(true)))
        select.value = selected
        hint.textContent = `${matches.length} resultado(s). Escolha o nome abaixo.${selected ? ' A seleção atual foi preservada.' : ''}`
      })
    })
  }
  new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true })
  enhance()
}
