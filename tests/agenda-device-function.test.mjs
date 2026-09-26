import test from 'node:test'
import assert from 'node:assert/strict'
import { agendaDeviceResponse } from '../netlify/functions/agenda-device.ts'

const installationId = 'a'.repeat(48)
const people = { m_1:{ name:'Ana', active:true }, m_2:{ name:'Bia', active:true }, inactive:{ name:'Inativa', active:false } }
const request = (masterId, installation = installationId) => new Request('https://app.test/.netlify/functions/agenda-device', {
  method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ masterId, installationId:installation }),
})
const loadPeople = async () => people

test('lista apenas nomes ativos sem exigir pareamento', async () => {
  const response = await agendaDeviceResponse(new Request('https://app.test/.netlify/functions/agenda-device'), async () => null, loadPeople)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { people:{ m_1:{name:'Ana',active:true},m_2:{name:'Bia',active:true} }, masterId:'' })
})

test('seleção cria sessão para a pessoa escolhida', async () => {
  let created
  const response = await agendaDeviceResponse(request('m_2'), async () => null, loadPeople, async (masterId, installationId) => {
    created={masterId,installationId};return {session:{token:'t',masterId,installationId,expiresAt:1},cookie:'noroeste_device=novo'}
  })
  assert.equal(response.status, 200)
  assert.deepEqual(created,{masterId:'m_2',installationId})
  assert.equal(response.headers.get('set-cookie'),'noroeste_device=novo')
})

test('pessoa inativa não pode ser selecionada', async () => {
  const response = await agendaDeviceResponse(request('inactive'), async () => null, loadPeople)
  assert.equal(response.status, 400)
})

test('repetir a mesma seleção preserva a sessão', async () => {
  const current=async()=>({token:'old',masterId:'m_1',installationId,expiresAt:Date.now()+1000})
  const response = await agendaDeviceResponse(request('m_1'), current, loadPeople)
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{masterId:'m_1'})
  assert.equal(response.headers.get('set-cookie'),null)
})
