interface WorkspaceTab { id: string; label: string; children?: WorkspaceTab[] }

export function renderWorkspaceNav(host: HTMLElement, title: string, home: string, active: string, tabs: WorkspaceTab[], select: (id: string) => void): void {
  const current = tabs.find(tab => tab.id === active || tab.children?.some(child => child.id === active))
  const button = (tab: WorkspaceTab, selected: boolean) => `<button type="button" data-workspace-tab="${tab.id}" aria-current="${selected ? 'page' : 'false'}">${tab.label}</button>`
  host.innerHTML = `<div class="workspace-heading"><h1>${title}</h1></div>
    <nav class="workspace-tabs" aria-label="${title}" data-workspace-home="${home}" data-workspace-active="${active}">${tabs.map(tab => button(tab, tab === current)).join('')}</nav>
    ${current?.children ? `<nav class="workspace-subtabs" aria-label="${current.label}">${current.children.map(tab => button(tab, tab.id === active)).join('')}</nav>` : ''}`
  const activeButton=host.querySelector<HTMLElement>('.workspace-tabs [aria-current="page"]')
  if(activeButton){
    const nav=activeButton.parentElement!
    const right=activeButton.offsetLeft-nav.offsetLeft+activeButton.offsetWidth
    nav.scrollLeft=right<=nav.clientWidth?0:Math.max(0,right-nav.clientWidth+12)
  }
  host.querySelectorAll<HTMLButtonElement>('[data-workspace-tab]').forEach(button => {
    button.addEventListener('click', () => select(button.dataset.workspaceTab!))
  })
}
