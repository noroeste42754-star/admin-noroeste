const BASE = '/quadro/'
const PREFIX = 'noroeste-quadro-'
const CACHE = PREFIX + 'v1'
const SHELL = [BASE, BASE + 'manifest.json', '/icon-192.png', '/icon-512.png']
const cacheableAsset = path => path.startsWith('/assets/') || SHELL.includes(path)

async function refreshShell(seed) {
  const cache = await caches.open(CACHE)
  const response = seed || await fetch(BASE, { cache:'no-store' })
  if (!response.ok) throw new Error('Shell unavailable')
  const html = await response.clone().text()
  const assets = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(match => match[1]).filter(path => path.startsWith('/'))
  const currentShell = [...new Set([...SHELL, ...assets.filter(cacheableAsset)])]
  // Update HTML only after all its dependencies are available for offline use.
  const downloaded = await Promise.all(currentShell.filter(path => path !== BASE).map(async path => {
    const asset = await fetch(path, { cache:'no-store' })
    if (!asset.ok) throw new Error('Shell asset unavailable')
    return [path, asset]
  }))
  await Promise.all(downloaded.map(([path, asset]) => cache.put(path, asset)))
  await cache.put(BASE, response)
  const keep = new Set(currentShell.map(path => new URL(path, self.location.origin).href))
  const keys = await cache.keys()
  await Promise.all(keys.filter(request => cacheableAsset(new URL(request.url).pathname) && !keep.has(request.url)).map(request => cache.delete(request)))
}
self.addEventListener('install', event => {
  event.waitUntil(refreshShell())
  self.skipWaiting()
})
self.addEventListener('message', event => {
  if (event.data?.type === 'REFRESH_SHELL') event.waitUntil(refreshShell())
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  if (event.request.mode === 'navigate') {
    if (!url.pathname.startsWith(BASE)) return
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request)
        if (!response.ok) throw new Error('Shell unavailable')
        await refreshShell(response.clone()).catch(() => {})
        return response
      } catch {
        return await caches.match(BASE) || new Response('Quadro indisponível offline. Conecte-se para o primeiro acesso.', {status:503,headers:{'content-type':'text/plain; charset=utf-8'}})
      }
    })())
    return
  }
  // Never intercept/copy authentication, device or database responses.
  if (!cacheableAsset(url.pathname)) return
  event.respondWith(caches.match(event.request).then(async cached => {
    if (cached) return cached
    const network = await fetch(event.request)
    if (network.ok) {
      const copy = network.clone()
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)))
    }
    return network
  }))
})
