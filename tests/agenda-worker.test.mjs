import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../public/agenda/sw.js', import.meta.url), 'utf8')

function worker(initial = {}, network = async () => { throw new Error('offline') }) {
  const entries = new Map(Object.entries(initial).map(([path, body]) => [path, new Response(body)]))
  const handlers = {}, calls = []
  const pathOf = value => new URL(typeof value === 'string' ? value : value.url, 'https://app.test').pathname
  const cache = {
    async match(request) { return entries.get(pathOf(request))?.clone() },
    async put(request, response) { entries.set(pathOf(request), response.clone()) },
    async keys() { return [...entries.keys()].map(path => new Request(`https://app.test${path}`)) },
    async delete(request) { return entries.delete(pathOf(request)) },
  }
  runInNewContext(source, {
    URL, self:{ location:{ origin:'https://app.test' }, addEventListener(type, handler) { handlers[type] = handler } },
    caches:{ open:async () => cache, match:cache.match },
    fetch:async request => { calls.push(pathOf(request)); return network(pathOf(request)) },
  })
  return {
    entries, calls,
    async navigate() {
      let response
      handlers.fetch({ request:{ mode:'navigate', url:'https://app.test/agenda/', method:'GET' }, respondWith(value) { response = value } })
      return response
    },
    async refresh() {
      let pending
      handlers.message({ data:{ type:'REFRESH_SHELL' }, waitUntil(value) { pending = value } })
      return pending
    },
  }
}

test('PWA tenta rede atualizada e abre o shell salvo quando offline', async () => {
  const app = worker({ '/agenda/':'cached shell' })
  assert.equal(await (await app.navigate()).text(), 'cached shell')
  assert.deepEqual(app.calls, ['/agenda/'])
})

test('PWA sem cache busca o shell na rede', async () => {
  const app = worker({}, async () => new Response('online shell'))
  assert.equal(await (await app.navigate()).text(), 'online shell')
  assert.equal(app.calls[0], '/agenda/')
})

test('atualizacao incompleta preserva o shell e os assets da versao offline', async () => {
  const app = worker({ '/agenda/':'old shell', '/assets/old.js':'old code' }, async path => {
    if (path === '/agenda/') return new Response('<script src="/assets/new.js"></script>')
    if (path === '/assets/new.js') return new Response('unavailable', { status:503 })
    return new Response('asset')
  })
  await app.refresh().catch(() => {})
  assert.equal(await app.entries.get('/agenda/').clone().text(), 'old shell')
  assert.equal(app.entries.has('/assets/old.js'), true)
})

test('atualizacao completa troca o shell e remove assets antigos', async () => {
  const app = worker({ '/agenda/':'old shell', '/assets/old.js':'old code' }, async path => new Response(path === '/agenda/' ? '<script src="/assets/new.js"></script>' : 'asset'))
  await app.refresh()
  assert.match(await app.entries.get('/agenda/').clone().text(), /new.js/)
  assert.equal(app.entries.has('/assets/new.js'), true)
  assert.equal(app.entries.has('/assets/old.js'), false)
})
