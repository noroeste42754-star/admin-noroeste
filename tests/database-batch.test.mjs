import test from 'node:test'
import assert from 'node:assert/strict'
import { get, pessoasRef, limpezaRef } from '../src/firebase.ts'
import { readBatch } from '../netlify/lib/database-reads.ts'

test('mais de 24 leituras preservam todos os resultados em cargas repetidas', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    const paths = JSON.parse(new URL(url, 'http://localhost').searchParams.get('paths'))
    calls.push(paths)
    return Response.json({ results:paths.map(path => ({ value:path })) })
  })
  const refs = Array.from({ length:57 }, (_, i) => ({ path:`limpeza/periodos/${i}` }))
  for (let round = 0; round < 10; round++) {
    const snapshots = await Promise.all(refs.map(ref => get(ref)))
    assert.deepEqual(snapshots.map(snapshot => snapshot.val()), refs.map(ref => ref.path))
  }
  assert.equal(calls.length, 30)
  assert.ok(calls.every(paths => paths.length > 0 && paths.length <= 24))
})

test('resposta incompleta rejeita o lote e permite uma nova leitura', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results:[] }))
  const results = await Promise.allSettled([get(pessoasRef), get(limpezaRef)])
  assert.ok(results.every(result => result.status === 'rejected' && /incompleta/.test(result.reason.message)))
  globalThis.fetch.mock.mockImplementation(async () => Response.json({ results:[{ value:{ recovered:true } }] }))
  assert.deepEqual((await get(limpezaRef)).val(), { recovered:true })
})

test('leituras simultaneas usam uma chamada e nao conservam cache', async t => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    const paths = JSON.parse(new URL(url, 'http://localhost').searchParams.get('paths'))
    calls.push(paths)
    return Response.json({ results:paths.map(path => ({ value:{ path, version:calls.length } })) })
  })
  const results = await Promise.all([get(pessoasRef), get(limpezaRef), get(pessoasRef)])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['master/pessoas', 'limpeza'])
  assert.equal(results[1].val().path, 'limpeza')
  assert.equal((await get(pessoasRef)).val().version, 2)
})

test('erro individual e falha de rede nao viram dados vazios ou promessas pendentes', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ results:[{ value:null }, { error:'Negado', status:403 }] }))
  const result = await Promise.allSettled([get(pessoasRef), get(limpezaRef)])
  assert.equal(result[0].value.exists(), false)
  assert.equal(result[1].reason.status, 403)
  globalThis.fetch.mock.mockImplementation(async () => { throw new Error('offline') })
  await assert.rejects(get(pessoasRef), /offline/)
})

test('lote verifica cada permissao, preserva ordem e isola falhas', async () => {
  const paths = ['master/pessoas', 'limpeza', 'tarefas']
  const seen = []
  const results = await readBatch(JSON.stringify(paths), { tarefas:true }, async path => {
    seen.push(path)
    if (path === 'tarefas') throw new Error('offline')
    return { pessoa:'teste' }
  })
  assert.deepEqual(seen, ['master/pessoas', 'tarefas'])
  assert.deepEqual(results[0], { value:{ pessoa:'teste' } })
  assert.equal(results[1].status, 403)
  assert.equal(results[2].status, 503)
  for (const raw of ['oops', '[]', '[null]', '["a/../b"]', JSON.stringify(Array(33).fill('limpeza'))]) {
    assert.equal(await readBatch(raw, { mestre:true }, async () => assert.fail('nao deve ler')), null)
  }
})
