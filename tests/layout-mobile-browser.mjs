import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
const browser=await chromium.launch({channel:'msedge',headless:true})
const master={m:{name:'Ana Maria de Oliveira Santos',active:true,whatsapp:'5585999999999',sex:'F'}}
const data={
 master:{pessoas:master,config:{limpeza:{ativa:true,grupos:1,inicioRotacao:'2026-10-01',gruposConfig:{}},congregacao:{nome:'Noroeste'}}},
 tarefas:{people:{p:{masterId:'m',active:true}},planning:{periodMode:'month',editingPeriod:'2026-10'},scale:{periods:{'2026-10':{meetings:{a:{date:'2026-10-04',type:'weekend',assignments:{presidente:'p'}}}}}},discursos:{}},
 escala:{scales:{l:{name:'Praça Central',active:true,daysActive:[0,3],slots:['08:00','09:00','10:00','11:00']}},participants:{p:{masterId:'m',active:true}},tables:{}},
 servicoCampo:{leaders:{m:true},periods:{'2026-10':{month:'2026-10',assignments:{s:{id:'s',date:'2026-10-04',time:'09:00',location:'Praça Central',label:'Saída de campo',leaderId:'m'}}}}},
 limpeza:{periodos:{}},agenda:{config:{},documentos:{}}
}
const read=path=>path.split('/').filter(Boolean).reduce((value,key)=>value?.[key],data)??{}
await mkdir(new URL('../output/layout-mobile/',import.meta.url),{recursive:true})
try {
 for(const width of [320,360,390,430,768,1280]){
  const page=await browser.newPage({viewport:{width,height:850},serviceWorkers:'block',colorScheme:width===430?'dark':'light'})
  const errors=[],writes=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
  await page.route('**/.netlify/functions/**',route=>{
   const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.split('/').pop()
   if(endpoint==='auth-session')return route.fulfill({json:{uid:'audit',csrf:'a'.repeat(48),usuario:{nome:'Auditoria',ativo:true,masterId:'m',apps:{mestre:true,tarefas:true,oradores:true,escala:true,limpeza:true,servicoCampo:true,individual:true}}}})
   if(endpoint==='auth-users')return route.fulfill({json:{}})
   if(endpoint==='module-publication')return route.fulfill({json:{hash:'test',document:null}})
   if(endpoint==='agenda-data')return route.fulfill({json:{masterId:'m',person:master.m,events:[{id:'teste-proximo',source:'tarefas',date:'2026-10-04',time:'10:00',title:'Leitura',detail:'Reunião',location:'Salão',status:'futuro'}],announcements:[],agenda:{},completedSources:['tarefas','oradores','limpeza','escala','servicoCampo','quadro'],failedSources:[]}})
   if(request.method()!=='GET'){writes.push(endpoint);return route.fulfill({json:{ok:true}})}
   const paths=JSON.parse(url.searchParams.get('paths')||'[]')
   return route.fulfill({json:paths.length?{results:paths.map(path=>({value:read(path)}))}:{value:read(url.searchParams.get('path')||'')}})
  })
  const home=()=>page.goto(process.env.APP_TEST_URL)
  const overflow=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,label+' '+width)
  for(const module of ['mestre','tarefas','oradores','limpeza','escala','servicoCampo','individual']){
   await home();await page.locator('[data-menu-card="'+module+'"]').click()
   await page.waitForFunction(()=>!document.querySelector('#appContent')?.textContent?.includes('Carregando'))
   if(module==='mestre'){
    await page.locator('#pFiltroNome').waitFor()
    assert.equal(await page.locator('#pFiltroRole').isVisible(),false)
    await page.locator('#btnAddPessoa').click();await page.locator('[role="dialog"]').waitFor()
    assert.equal(await page.locator('#pNome').evaluate(el=>el.labels.length>0),true)
    await page.keyboard.press('Escape');await page.locator('.modal').waitFor({state:'detached'})
   }
   if(module==='tarefas'&&width<=560){
    const card=page.locator('.task-mobile-scale [data-task-meeting-id]').first();await card.waitFor()
    assert.equal(await card.getAttribute('open'),null)
    await card.locator('summary').click();assert.equal(await card.locator('select').first().isVisible(),true)
   }
   if(module==='oradores'){
    await page.locator('[data-workspace-tab="programacao"]').click()
    await page.locator('#newSchedule').click()
    if(width<=560)assert.equal(await page.locator('#scheduleSearch').isVisible(),false)
    await page.locator('#cancelScheduleEdit').click()
    assert.equal(await page.locator('#scheduleSearch').isVisible(),true)
   }
   if(module==='limpeza'){
    await page.locator('[data-cleaning-tab="grupos"]').click()
    assert.equal(await page.locator('[data-cleaning-panel="grupos"]').isVisible(),true)
    assert.equal(await page.locator('[data-cleaning-panel="escala"]').isVisible(),false)
    await page.locator('[data-cleaning-tab="escala"]').click()
   }
   if(module==='escala'){
    await page.locator('[data-workspace-tab="participantes"]').first().click()
    assert.equal(await page.locator('#pList .entity-card').count(),1)
    await page.locator('[data-person-availability="p"]').click()
    await page.locator('[data-avail]').first().waitFor()
    assert.equal(await page.locator('#aPerson').inputValue(),'p')
    assert.ok(await page.locator('[data-avail]').first().getAttribute('aria-label'))
    if(width<=560)assert.equal(await page.locator('.availability-table').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
    await page.locator('[data-workspace-tab="participantes"]').first().click()
    await page.locator('[data-person-confirmation="p"]').click()
    assert.equal(await page.locator('#mTarget').inputValue(),'p')
   }
   if(module==='servicoCampo'){
    assert.equal(await page.locator('[data-service-leader]').isVisible(),false)
    await page.locator('.service-assignment summary').click()
    assert.equal(await page.locator('[data-service-leader]').isVisible(),true)
   }
   if(module==='individual'){
    await page.getByText(/Atualizada em/).waitFor()
    assert.equal(await page.locator('#individualRoot > .agenda-list .agenda-personal-event').count(),1)
    await page.locator('#agendaOtherDates summary').click()
    await page.locator('[data-personal-view="month"]').click()
    await page.locator('[data-personal-date="2026-10-04"]').click()
    assert.match(await page.locator('.agenda-selected-day').innerText(),/04\/10\/2026/)
    assert.equal(await page.locator('[data-personal-date="2026-10-04"]').getAttribute('aria-pressed'),'true')
    assert.equal(await page.locator('#individualRoot > .agenda-list .agenda-personal-event').count(),1)
    assert.match(await page.locator('#individualRoot > .agenda-list .agenda-event-location').innerText(),/Salão/)
    assert.equal(await page.locator('.agenda-personal-panel').filter({has:page.locator('summary').getByText('Mais opções')}).count(),0)
    await page.locator('[data-agenda-screen="quadro"]').click()
    assert.equal(await page.locator('[data-agenda-panel="moduleDocuments"]').getAttribute('open'),'')
    await page.locator('[data-agenda-screen="agenda"]').click()
   }
   await overflow(module)
   if(width===390)await page.screenshot({path:new URL('../output/layout-mobile/'+module+'-390.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),fullPage:true})
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
  console.log('Layout '+width+'px: sete módulos, leitura/edição e acessibilidade OK')
  await page.close()
 }
}finally{await browser.close()}
