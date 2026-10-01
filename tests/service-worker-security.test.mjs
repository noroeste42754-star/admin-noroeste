import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('service workers não armazenam respostas das Netlify Functions', async () => {
  for (const file of ['../public/sw.js', '../public/agenda/sw.js', '../public/quadro/sw.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8')
    assert.match(source, /cacheableAsset/)
    assert.doesNotMatch(source, /cache\.put\([^\n]*\.netlify\/functions/)
  }
})

test('service worker do Admin só intercepta GET estático permitido', async () => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  assert.match(source, /e\.request\.method !== 'GET'/)
  assert.match(source, /!cacheableAsset\(url\.pathname\)/)
})
