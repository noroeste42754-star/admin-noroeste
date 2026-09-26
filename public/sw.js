const CACHE = 'noroeste-admin-v6'
const ASSETS = ['/', '/index.html'] // vite adiciona o resto no build

const cacheableAsset = path => path.startsWith('/assets/') || ['/manifest.json', '/icon-192.png', '/icon-512.png'].includes(path)

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('noroeste-admin-') && key !== CACHE)
          .map(key => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', e => {
  if (e.data?.type !== 'REFRESH_SHELL') return
  e.waitUntil(fetch('/index.html', { cache:'no-store' }).then(response => response.ok ? caches.open(CACHE).then(cache => cache.put('/index.html', response)) : undefined))
})

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    const path = new URL(e.request.url).pathname
    if (path !== '/' && path !== '/index.html') {
      e.respondWith(fetch(e.request))
      return
    }
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const copy = response.clone()
          void caches.open(CACHE).then(cache => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin || !cacheableAsset(url.pathname)) return
  e.respondWith(caches.match(e.request).then(async cached => {
    if (cached) return cached
    const response = await fetch(e.request)
    if (response.ok) void caches.open(CACHE).then(cache => cache.put(e.request, response.clone()))
    return response
  }))
})
