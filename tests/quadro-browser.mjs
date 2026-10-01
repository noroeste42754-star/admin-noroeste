import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const browser=await chromium.launch({channel:'msedge',headless:true}),date='2026-10-04'
const event=(id,source,title,detail,people)=>({id,source,date,time:'09:00',title,detail,people,status:'futuro'})
const payload=()=>({
 events:[event('t1','tarefas','Presidente','Fim de semana · 1ª seção',['Ana Santos']),event('t2','tarefas','Leitor','Fim de semana · 2ª seção',['Bruno Silva']),event('o1','oradores','Discurso público','Tema um · 1ª seção',['Ana Santos']),event('o2','oradores','Discurso público','Tema dois · 2ª seção',['Bruno Silva']),event('e','escala','Escala TPL','Carrinho de testemunho público',['Ana Santos','Bruno Silva'])],
 notices:[{id:'g',date,title:'Assembleia geral',description:'Informações para todos'}],
 agenda:{config:{outrosAnunciosDriveUrl:'https://drive.google.com/drive/folders/teste'},documentos:Object.fromEntries(['tarefas','oradores','escala','admin'].map(modulo=>[modulo,{id:modulo,modulo,tipo:modulo==='admin'?'admin':'modulo',periodo:'2026-10',inicio:'2026-10-01',fim:'2026-10-31',nome:modulo+'.pdf',url:'https://example.test/'+modulo+'.pdf',criadoEm:'2026-09-30T12:00:00Z'}]))},
 completedSources:['tarefas','oradores','escala','geral','quadro'],failedSources:[]
})
await mkdir(new URL('../output/quadro-auditoria/',import.meta.url),{recursive:true})
try{
 for(const width of [320,390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[]
  let phase=0
  page.on('pageerror',e=>errors.push(e.message))
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00-03:00'))
  await page.addInitScript(()=>{
   localStorage.setItem('noroeste_agenda_device_token_v1','a'.repeat(64))
   localStorage.setItem('noroeste_module_installation_v1','b'.repeat(64))
   localStorage.setItem('noroeste_agenda_person_v1',JSON.stringify({name:'Pessoa privada',phone:'5585999999999'}))
  })
  await page.route('**/.netlify/functions/**',route=>{
   const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.split('/').pop()
   requests.push({endpoint,sources:url.searchParams.get('sources')})
   assert.equal(endpoint,'quadro-data')
   assert.equal(request.method(),'GET')
   assert.equal(request.headers()['x-noroeste-device'],undefined)
   assert.equal(request.headers()['x-noroeste-installation'],undefined)
   if(phase===3)return route.fulfill({status:503,json:{error:'Falha simulada'}})
   const body=payload()
   if(phase===1){body.events=[];body.notices=[];body.agenda={config:{},documentos:{}};body.completedSources=['tarefas'];body.failedSources=['oradores']}
   if(phase===2){body.events=[event('o1-new','oradores','Discurso atualizado','Tema novo · 1ª seção',['Ana Santos'])];body.completedSources=['oradores'];body.failedSources=[]}
   return route.fulfill({json:body})
  })
  for(const alias of ['quadro/','agenda/']){
   await page.goto(new URL(alias,process.env.APP_TEST_URL).href)
   await page.getByRole('heading',{name:'Quadro de Anúncios',exact:true}).waitFor()
   await page.locator('[role="status"]').filter({hasText:'Atualizado em'}).waitFor()
   assert.equal(await page.locator('#agendaPerson,#selectUsuario,input[type="password"],#loginOverlay').count(),0)
   assert.equal((await page.locator('body').innerText()).includes('Pessoa privada'),false)
  }
  await page.locator('#quadroMonth').fill('2026-10')
  await page.locator('#quadroMonth').dispatchEvent('change')
  await page.locator('[data-quadro-date="'+date+'"]').click()
  assert.equal(await page.locator('.agenda-event').count(),5)
  assert.match(await page.locator('#quadroPanel').innerText(),/Assembleia geral/)
  await page.locator('[data-quadro-filter="s1"]').click()
  assert.equal(await page.locator('.agenda-event').count(),1)
  assert.equal((await page.locator('.agenda-list').innerText()).includes('Bruno Silva'),false)
  await page.locator('[data-quadro-filter="s2"]').click()
  assert.equal(await page.locator('.agenda-event').count(),1)
  assert.match(await page.locator('.agenda-list').innerText(),/Bruno Silva/)
  await page.locator('[data-quadro-filter="todos"]').click()
  await page.locator('[data-quadro-tab="documentos"]').click()
  assert.equal(await page.locator('a').filter({hasText:'Abrir PDF'}).count(),4)
  assert.equal(await page.locator('a[href="https://example.test/oradores.pdf"]').count(),1)
  assert.match(await page.locator('#quadroPanel').innerText(),/duas seções/)
  await page.locator('[data-quadro-tab="geral"]').click()
  const download=page.waitForEvent('download')
  await page.locator('details summary').click()
  await page.locator('#quadroIcs').click()
  assert.equal(await (await download).failure(),null)
  phase=1;await page.locator('#quadroRefresh').click();await page.locator('#quadroRetry').waitFor()
  assert.equal(await page.locator('.agenda-event').count(),3)
  assert.match(await page.locator('[role="status"]').first().innerText(),/Oradores/)
  phase=2;await page.locator('#quadroRetry').click();await page.locator('#quadroRetry').waitFor({state:'detached'})
  assert.equal(requests.at(-1).sources,'oradores')
  assert.equal(await page.locator('.agenda-event').count(),2)
  assert.match(await page.locator('.agenda-list').innerText(),/Discurso atualizado/)
  phase=3;await page.locator('#quadroRefresh').click();await page.locator('#quadroRetry').waitFor()
  assert.equal(await page.locator('.agenda-event').count(),2)
  await page.reload();await page.locator('#quadroRetry').waitFor()
  assert.equal(await page.locator('.agenda-event').count(),2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'largura '+width)
  if(width===390)await page.screenshot({path:new URL('../output/quadro-auditoria/quadro-390.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),fullPage:true})
  assert.deepEqual(errors,[])
  console.log('Quadro '+width+'px: público, alias, filtros das duas seções, quatro documentos, ICS, cache e retry OK')
  await context.close()
 }
}finally{await browser.close()}
