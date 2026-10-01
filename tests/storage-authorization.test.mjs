import test from 'node:test'
import assert from 'node:assert/strict'
import { canManageStoragePath, canReadPublicStoragePath, validStoragePath, storageFileResponse } from '../netlify/functions/storage-file.ts'
import { PDFDocument } from 'pdf-lib'

const apps = overrides => ({ mestre:false, tarefas:false, limpeza:false, oradores:false, escala:false, programacao:false, secretario:false, servicoCampo:false, individual:false, ...overrides })

test('Storage aceita somente os caminhos PDF usados pelo app', () => {
  assert.equal(validStoragePath('agenda/documentos/modulos/tarefas/2026-09.pdf'), true)
  assert.equal(validStoragePath('agenda/documentos/../../usuarios.pdf'), false)
  assert.equal(canManageStoragePath('qualquer/caminho.pdf', apps({ mestre:true })), false)
  assert.equal(canManageStoragePath('agenda/documentos/admin/aviso.pdf', apps({ mestre:true })), true)
})

test('permissão de módulo não publica PDF em nome de outro módulo', () => {
  const tarefas = apps({ tarefas:true })
  assert.equal(canManageStoragePath('agenda/documentos/modulos/tarefas/2026-09.pdf', tarefas), true)
  assert.equal(canManageStoragePath('agenda/documentos/modulos/oradores/2026-09.pdf', tarefas), false)
  assert.equal(canManageStoragePath('agenda/documentos/modulos/oradores/2026-09.pdf', apps({ oradores:true })), true)
  assert.equal(canManageStoragePath('secretario/templates/s21.pdf', tarefas), false)
  assert.equal(canManageStoragePath('secretario/templates/outro.pdf', apps({ secretario:true })), false)
})

test('leitura pública inclui documentos da Agenda, mas não templates do Secretário', () => {
  assert.equal(canReadPublicStoragePath('agenda/documentos/admin/aviso.pdf'), true)
  assert.equal(canReadPublicStoragePath('agenda/documentos/modulos/limpeza/2026-09.pdf'), false)
  assert.equal(canReadPublicStoragePath('secretario/templates/s21.pdf'), false)
  assert.equal(canReadPublicStoragePath('agenda/documentos/modulos/secretario/s21.pdf'), false)
})

function memoryStorage() {
  const files = new Map()
  return {
    files,
    async set(path, data) { files.set(path, data.slice(0)) },
    async getWithMetadata(path) { return files.has(path) ? { data:files.get(path).slice(0), metadata:{ contentType:'application/pdf' } } : null },
    async delete(path) { files.delete(path) },
  }
}

const session = async () => ({ csrf:'test-csrf', usuario:{ apps:apps({ mestre:true }) } })
function storageRequest(method, path, bytes) {
  const endpoint = 'https://app.test/.netlify/functions/storage-file'
  return new Request(method === 'GET' ? `${endpoint}?path=${encodeURIComponent(path)}` : endpoint, {
    method,
    headers:{ 'content-type':'application/json', 'x-noroeste-csrf':'test-csrf' },
    ...(method === 'GET' ? {} : { body:JSON.stringify({ path, ...(bytes ? { base64:Buffer.from(bytes).toString('base64') } : {}) }) }),
  })
}

async function pdf(pages) {
  const doc = await PDFDocument.create()
  for (let index = 0; index < pages; index++) doc.addPage([595.28, 841.89])
  return doc.save()
}

for (const module of ['tarefas', 'oradores', 'escala']) {
  test(`PDF de ${module}: upload, download exato, substituicao e remocao`, async () => {
    const store = memoryStorage()
    const path = `agenda/documentos/modulos/${module}/2026-09.pdf`
    const invoke = (method, bytes) => storageFileResponse(storageRequest(method, path, bytes), () => store, session)
    let url
    for (const pages of [1, 2]) {
      const bytes = await pdf(pages)
      const upload = await invoke('POST', bytes)
      assert.equal(upload.status, 200)
      const body = await upload.json()
      if (url) assert.equal(body.url, url)
      url = body.url
      assert.equal(store.files.size, 1)
      const download = await invoke('GET')
      assert.equal(download.status, 200)
      assert.equal(download.headers.get('content-type'), 'application/pdf')
      assert.equal(Number(download.headers.get('content-length')), bytes.length)
      const downloaded = new Uint8Array(await download.arrayBuffer())
      assert.deepEqual(downloaded, bytes)
      assert.equal((await PDFDocument.load(downloaded)).getPageCount(), pages)
    }
    assert.equal((await invoke('DELETE')).status, 200)
    assert.equal((await invoke('GET')).status, 404)
    assert.equal(store.files.size, 0)
  })
}

test('falha de inicializacao do armazenamento retorna erro recuperavel', async () => {
  const response = await storageFileResponse(storageRequest('GET', 'agenda/documentos/admin/aviso.pdf'), () => { throw new Error('Store unavailable') }, session)
  assert.equal(response.status, 503)
  assert.match((await response.json()).error, /indisponível/)
})

test('PDF invalido nao substitui documento existente', async () => {
  const store = memoryStorage(), path = 'agenda/documentos/admin/aviso.pdf'
  const original = await pdf(1)
  const invoke = bytes => storageFileResponse(storageRequest('POST', path, bytes), () => store, session)
  assert.equal((await invoke(original)).status, 200)
  assert.equal((await invoke(new TextEncoder().encode('not a PDF'))).status, 400)
  assert.equal((await invoke(new Uint8Array(4 * 1024 * 1024 + 1))).status, 400)
  assert.deepEqual(new Uint8Array(store.files.get(path)), original)
})

test('documentos do Admin e de modulos permanecem independentes', async () => {
  const store = memoryStorage(), bytes = await pdf(1)
  const paths = ['agenda/documentos/admin/aviso.pdf', 'agenda/documentos/admin/aviso2.pdf', 'agenda/documentos/modulos/tarefas/2026-09.pdf']
  for (const path of paths) assert.equal((await storageFileResponse(storageRequest('POST', path, bytes), () => store, session)).status, 200)
  assert.equal((await storageFileResponse(storageRequest('DELETE', paths[2]), () => store, session)).status, 200)
  for (const path of paths.slice(0, 2)) assert.equal((await storageFileResponse(storageRequest('GET', path), () => store, session)).status, 200)
})

test('link direto de PDF vencido deixa de abrir após 60 dias', async () => {
  const bytes = await pdf(1)
  const store = { async getWithMetadata() { return { data:bytes.buffer, metadata:{ createdAt:new Date(Date.now()-61*86400_000).toISOString() } } } }
  const response = await storageFileResponse(storageRequest('GET', 'agenda/documentos/admin/aviso.pdf'), () => store, session)
  assert.equal(response.status, 410)
})

test('falha de gravacao nao anuncia sucesso e permite repetir a substituicao', async () => {
  const store = memoryStorage(), path = 'agenda/documentos/modulos/tarefas/2026-09.pdf'
  const original = await pdf(1), replacement = await pdf(2)
  const invoke = (method, bytes, backend = store) => storageFileResponse(storageRequest(method, path, bytes), () => backend, session)
  assert.equal((await invoke('POST', original)).status, 200)
  const failing = { ...store, async set() { throw new Error('Simulated write failure') } }
  assert.equal((await invoke('POST', replacement, failing)).status, 503)
  assert.deepEqual(new Uint8Array(await (await invoke('GET')).arrayBuffer()), original)
  assert.equal((await invoke('POST', replacement)).status, 200)
  assert.deepEqual(new Uint8Array(await (await invoke('GET')).arrayBuffer()), replacement)
})

test('falha de remocao nao anuncia sucesso e preserva o PDF para nova tentativa', async () => {
  const store = memoryStorage(), path = 'agenda/documentos/modulos/escala/2026-09.pdf'
  assert.equal((await storageFileResponse(storageRequest('POST', path, await pdf(1)), () => store, session)).status, 200)
  const failing = { ...store, async delete() { throw new Error('Simulated delete failure') } }
  assert.equal((await storageFileResponse(storageRequest('DELETE', path), () => failing, session)).status, 503)
  assert.equal(store.files.has(path), true)
  assert.equal((await storageFileResponse(storageRequest('DELETE', path), () => store, session)).status, 200)
  assert.equal(store.files.has(path), false)
})
