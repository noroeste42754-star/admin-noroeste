import test from 'node:test'
import assert from 'node:assert/strict'
import { congregationGeocodeResponse, geocodeQuery, lookupCongregation } from '../netlify/functions/congregation-geocode.ts'

const session = { csrf:'secret', usuario:{ apps:{ oradores:true, mestre:false } } }
const request = (body, csrf='secret') => new Request('https://app.test/.netlify/functions/congregation-geocode', {
  method:'POST', headers:{ 'content-type':'application/json', 'x-noroeste-csrf':csrf }, body:JSON.stringify(body),
})

test('consulta apenas no Brasil e converte coordenadas em Plus Code completo', async () => {
  let called
  const result = await lookupCongregation(geocodeQuery('Rua Principal, 5', 'Carmópolis, SE'), async (url, options) => {
    called={url:String(url),options}
    return new Response(JSON.stringify([{ lat:'-10.65',lon:'-36.98',display_name:'Rua Principal, Carmópolis, Sergipe, Brasil',address:{country_code:'br'} }]),{status:200})
  })
  assert.match(called.url,/countrycodes=br/)
  assert.match(called.url,/limit=1/)
  assert.match(called.options.headers['user-agent'],/noroeste.netlify.app/)
  assert.match(result.plusCode,/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{3}$/)
  assert.match(result.mapUrl,/google.com\/maps\/search/)
  assert.match(result.attribution,/OpenStreetMap/)
})

test('não aceita coordenadas de outro país', async () => {
  const result=await lookupCongregation('Endereço',async()=>new Response(JSON.stringify([{lat:'1',lon:'2',address:{country_code:'us'}}]),{status:200}))
  assert.equal(result,null)
})

test('busca exige sessão, permissão e CSRF', async () => {
  const resolver=async()=>{throw new Error('não deve consultar serviço externo')}
  assert.equal((await congregationGeocodeResponse(request({address:'Rua Principal, 5'}),async()=>null,resolver)).status,403)
  assert.equal((await congregationGeocodeResponse(request({address:'Rua Principal, 5'}),async()=>({ ...session, usuario:{apps:{oradores:false,mestre:false}} }),resolver)).status,403)
  assert.equal((await congregationGeocodeResponse(request({address:'Rua Principal, 5'},'wrong'),async()=>session,resolver)).status,403)
})

test('busca usa endereço e cidade e não permite endereço vago', async () => {
  assert.equal((await congregationGeocodeResponse(request({address:'Rua'}),async()=>session)).status,400)
  let query
  const result={plusCode:'7G2R8C2C+222',displayName:'Local',mapUrl:'https://www.google.com/maps/search/?api=1&query=x',attribution:'© OpenStreetMap contributors'}
  const response=await congregationGeocodeResponse(request({address:'Rua Principal, 5',city:'Carmópolis, SE'}),async()=>session,async value=>{query=value;return result})
  assert.equal(response.status,200)
  assert.equal(query,'Rua Principal, 5, Carmópolis, SE, Brasil')
  assert.deepEqual(await response.json(),result)
})
