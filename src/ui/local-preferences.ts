type Preference = string | number | boolean
type StorageAccess = () => Pick<Storage, 'getItem' | 'setItem'>

/** Presentation only: never store credentials, drafts or database records here. */
export function localPreferences(userId: string, module: string, access: StorageAccess = () => localStorage) {
  const prefix = `noroeste:ui:v1:${encodeURIComponent(userId)}:${encodeURIComponent(module)}:`
  return {
    get<T extends Preference>(key: string, fallback: T): T {
      try {
        const value: unknown = JSON.parse(access().getItem(prefix + key) ?? 'null')
        return typeof value === typeof fallback ? value as T : fallback
      } catch { return fallback }
    },
    set(key: string, value: Preference): void {
      try { access().setItem(prefix + key, JSON.stringify(value)) } catch { /* Private mode/quota must not block the module. */ }
    },
  }
}

/** Restore newly rendered disclosures too, including asynchronously loaded messages. */
export function persistDisclosures(root: HTMLElement, preferences: ReturnType<typeof localPreferences>): () => void {
  const initialized = new WeakSet<HTMLDetailsElement>()
  const restore = () => {
    root.querySelectorAll<HTMLDetailsElement>('details[data-ui-preference]').forEach(details => {
      if (initialized.has(details)) return
      initialized.add(details)
      details.open = preferences.get(`open:${details.dataset.uiPreference}`, details.open)
    })
  }
  const remember = (event: Event) => {
    const details = event.target
    if (details instanceof HTMLDetailsElement && details.isConnected && root.contains(details) && initialized.has(details)) {
      preferences.set(`open:${details.dataset.uiPreference}`, details.open)
    }
  }
  restore()
  root.addEventListener('toggle', remember, true)
  const observer = new MutationObserver(restore)
  observer.observe(root, { childList:true, subtree:true })
  return () => { observer.disconnect(); root.removeEventListener('toggle', remember, true) }
}
