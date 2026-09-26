import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright')
const browser=await chromium.launch({channel:'msedge',headless:true})
const source={
  'master/pessoas':{m:{name:'Ana',active:true,whatsapp:''}},
  tarefas:{people:{p:{name:'Ana',masterId:'m',active:true}},planning:{periodMode:'month',editingPeriod:'2026-10'},scale:{periods:{'2026-10':{meetings:{one:{date:'2026-10-04',type:'weekend',assignments:{presidente:'missing'}}}}}}},
  escala:{scales:{l:{name:'Praça',active:true,daysActive:[0],slots:['09:00']}},participants:{p:{masterId:'m',active:true}},tables:{l:{'2026-10':{slots:['09:00'],rows:{'2026-10-04':{dow:0,slots:{'09:00':{p1:'p',p2:''}}}}}}}},
  'master/config':{limpeza:{ativa:false,grupos:1,gruposConfig:{}},congregacao:{nome:'Noroeste'}},
  servicoCampo:{periods:{'2026-10':{month:'2026-10',assignments:{s:{id:'s',date:'2026-10-04',time:'09:00',location:'Praça',label:'Saída',leaderId:''}}}}},
}
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[],writes=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
  await page.route('**/.netlify/functions/**',route=>{
   const url=new URL(route.request().url()),endpoint=url.pathname.split('/').pop()
   if(endpoint==='auth-session')return route.fulfill({json:{uid:'audit',csrf:'a'.repeat(48),usuario:{nome:'Auditoria',ativo:true,apps:{mestre:true,tarefas:true,escala:true,limpeza:true}}}})
   if(endpoint==='module-publication'&&route.request().postDataJSON()?.action==='status')return route.fulfill({json:{hash:'test',document:null}})
   if(endpoint==='auth-users')return route.fulfill({json:{}})
   if(route.request().method()!=='GET'){writes.push(endpoint);return route.fulfill({json:{ok:true}})}
   return route.fulfill({json:{results:JSON.parse(url.searchParams.get('paths')||'[]').map(path=>({value:source[path]??{}}))}})
  })
  const home=()=>page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
  await home();await page.locator('[data-menu-card="tarefas"]').click()
  await page.locator('[data-workspace-tab="pendencias"]').click()
  await page.locator('[data-pending-index]').filter({hasText:'Presidente aponta para pessoa inexistente'}).click()
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('data-meeting-role')),'presidente')
  assert.equal(await page.locator('.correction-target').isVisible(),true)
  source.tarefas.scale.periods['2026-10'].locked=true
  await home();await page.locator('[data-menu-card="tarefas"]').click()
  await page.locator('[data-workspace-tab="pendencias"]').click()
  await page.locator('[data-pending-index]').filter({hasText:'Presidente aponta para pessoa inexistente'}).click()
  assert.equal(await page.locator('#btnToggleTaskLock').evaluate(el=>el===document.activeElement),true)
  source.tarefas.scale.periods['2026-10'].locked=false
  await home();await page.locator('[data-menu-card="escala"]').click()
  await page.locator('[data-workspace-tab="pendencias"]').click()
  await page.locator('[data-pending]').filter({hasText:'Dupla incompleta'}).click()
  assert.equal(await page.locator('#pair2').evaluate(el=>el===document.activeElement),true)
  await page.locator('#pairCancel').click()
  await page.locator('[data-workspace-tab="pendencias"]').click()
  await page.locator('[data-pending]').filter({hasText:'Ana sem WhatsApp'}).click()
  await page.locator('#pWpp').waitFor()
  assert.equal(await page.locator('#pWpp').evaluate(el=>el===document.activeElement),true)
  assert.ok(await page.locator('#pWpp').getAttribute('aria-describedby'))
  await home();await page.locator('[data-menu-card="limpeza"]').click()
  await page.locator('[data-cleaning-pending]').filter({hasText:'data inicial'}).click()
  assert.equal(await page.locator('#lInicio').evaluate(el=>el===document.activeElement),true)
  assert.equal(await page.locator('#lInicio').isVisible(),true)
  if(width===390){assert.ok(await page.locator('#lInicio').evaluate(el=>getComputedStyle(el).fontSize==='16px'))}
  await home();await page.locator('[data-menu-card="servicoCampo"]').click()
  await page.locator('[data-field-pending="s"]').click()
  assert.equal(await page.locator('#serviceLeaderForm select[name="leaderId"]').evaluate(el=>el===document.activeElement),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
  console.log(`Pendências ${width}px: função inexistente, dupla, Admin/telefone e configuração recolhida OK`)
  await page.close()
 }
}finally{await browser.close()}
