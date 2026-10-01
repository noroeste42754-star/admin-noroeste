import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { databaseResponse } from '../netlify/functions/database.ts'
import { activityResponse } from '../netlify/functions/activity.ts'
const month='2026-10'
const fixture=()=>({
 master:{pessoas:Object.fromEntries(['Ana','Beto','Caio'].map((name,i)=>['m'+(i+1),{name,active:true,sex:'M',whatsapp:'5585999999999',limpeza:{grupo:i===2?2:1}}])),config:{congregacao:{nome:'Noroeste'},reunioes:{meiaDeSemana:{diaSemana:3},fimDeSemana:{diaSemana:0}},limpeza:{ativa:true,grupos:2,inicioRotacao:'2026-10-01',gruposConfig:{1:{nome:'Grupo 1',superintendenteMid:'m1',ajudantesMid:[]},2:{nome:'Grupo 2',superintendenteMid:'m3',ajudantesMid:[]}}}}},
 tarefas:{people:{p1:{masterId:'m1',active:true,roles:{microfone:true}},p2:{masterId:'m2',active:true,roles:{microfone:true}},p3:{masterId:'m3',active:true,roles:{microfone:true},unavailableDates:['2026-10-04']}},planning:{periodMode:'month',editingPeriod:month},scale:{periods:{[month]:{meetings:{a:{date:'2026-10-04',type:'weekend',assignments:{mic1:'p1'}}}}}},discursos:{}},
 servicoCampo:{leaders:{m1:true,m2:true,m3:true},periods:{[month]:{month,published:false,assignments:{s:{id:'s',date:'2026-10-04',time:'09:00',location:'Praça',label:'Saída',leaderId:'m1'},b:{id:'b',date:'2026-10-04',time:'09:00',location:'Salão',label:'Saída',leaderId:'m2'}}}}},
 escala:{participants:{p1:{masterId:'m1',active:true},p2:{masterId:'m2',active:true},p3:{masterId:'m3',active:true}},scales:{l:{name:'Praça',active:true,daysActive:[0],slots:['09:00']}},availability:{l:{p1:{'0|09:00':true},p2:{'0|09:00':true},p3:{'0|09:00':true}}},tables:{l:{[month]:{slots:['09:00'],rows:{'2026-10-04':{dow:0,slots:{'09:00':{p1:'p1',p2:'p2'}}}}}}}},
 limpeza:{periodos:{[month]:{id:month,modo:'month',inicio:'2026-10-01',fim:'2026-10-31',semanas:[{referencia:'2026-10-07',dataMeioSemana:'2026-10-07',dataFimSemana:'2026-10-11',grupo:1,grupoNome:'Grupo 1',superintendenteMid:'m1',ajudantesMid:[],membrosMid:['m1','m2']}]}}},agenda:{config:{},documentos:{}}
})
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
 for(const width of [390,1280]) {
  let data=fixture(),failWrite=false
  const session={uid:'u1',csrf:'a'.repeat(48),usuario:{nome:'Responsável',ativo:true,apps:{mestre:true,tarefas:true,escala:true,limpeza:true,oradores:true,servicoCampo:true}}}
  const read=path=>path.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data)??null
  const database=()=>({ref:path=>({get:async()=>({exists:()=>read(path)!==null,val:()=>structuredClone(read(path))}),transaction:async fn=>{
    if(failWrite)throw Error('Falha simulada')
    fn(null)
    const next=fn(structuredClone(data))
    if(next===undefined)return {committed:false}
    data=next;return {committed:true}
  }})})
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept())
  await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
  await page.route('**/.netlify/functions/**',async route=>{
    const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.split('/').pop()
    if(endpoint==='auth-session')return route.fulfill({json:session})
    if(endpoint==='auth-users')return route.fulfill({json:{}})
    if(endpoint==='module-publication')return route.fulfill({json:{hash:'test',document:null}})
    if(endpoint==='cleaning-groups'){
      if(failWrite)return route.fulfill({status:503,json:{error:'Falha simulada'}})
      for(const [mid,group] of Object.entries(req.postDataJSON().groups))data.master.pessoas[mid].limpeza.grupo=group
      return route.fulfill({json:{ok:true}})
    }
    const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='GET'?{}:{body:req.postData()})})
    const response=endpoint==='activity'?await activityResponse(request,async()=>session,database):await databaseResponse(request,database,async()=>session)
    return route.fulfill({status:response.status,body:await response.text(),headers:{'content-type':'application/json'}})
  })
  const home=async()=>{await page.goto(process.env.APP_TEST_URL);await page.locator('[data-menu-card="tarefas"]').first().waitFor()}
  await home()
  assert.equal(await page.getByRole('heading',{name:'Painel de trabalho'}).count(),0)
  assert.equal(await page.locator('.home-publication-row').count(),0)
  assert.equal(await page.locator('[data-menu-card="mestre"]').count(),1)
  assert.equal(await page.locator('[data-menu-card="quadro"]').count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.locator('[data-menu-card="tarefas"]').first().click();await page.locator('[data-workspace-tab="escala"]').waitFor()
  await page.locator('[data-workspace-tab="escala"]').click()
  if(width<560)await page.locator('.task-mobile-scale summary').first().click()
  const scope=width<560?'.task-mobile-scale':'.task-scale-table'
  await page.locator(scope+' [data-task-substitute][data-role="mic1"]').click()
  const dialog=page.locator('.modal').last()
  assert.equal(await dialog.locator('label').filter({hasText:'Caio'}).locator('input').isDisabled(),false)
  await dialog.locator('label').filter({hasText:'Caio'}).locator('input').check()
  await dialog.locator('[data-sub-save]').click()
  await dialog.locator('[data-advisory-back]').waitFor()
  assert.match(await page.locator('[role="dialog"]').last().textContent(),/Indisponível nesta data/)
  await dialog.locator('[data-advisory-back]').click()
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p1')
  await dialog.locator('label').filter({hasText:'Beto'}).locator('input').check()
  failWrite=true;await dialog.locator('[data-sub-save]').click();await dialog.locator('[data-editor-error]').waitFor()
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p1')
  failWrite=false;await dialog.locator('[data-sub-save]').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p2')
  await page.locator(scope+' [data-edit-meeting]').first().click()
  await page.locator('#taskMeetingForm [data-meeting-role="mic1"]').selectOption('p1')
  failWrite=true;await page.locator('#taskMeetingForm [type="submit"]').click();await page.locator('#taskMeetingForm [data-editor-error]').waitFor()
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p2')
  failWrite=false;await page.locator('#taskMeetingForm [type="submit"]').click();await page.locator('#taskMeetingForm').waitFor({state:'detached'})
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p1')
  await page.locator(scope+' [data-task-substitute][data-role="mic1"]').click()
  await page.locator('.modal').last().locator('label').filter({hasText:'Caio'}).locator('input').check()
  await page.locator('.modal').first().locator('[data-sub-save]').click()
  await page.locator('[data-advisory-confirm]').click()
  await page.locator('.modal').waitFor({state:'detached'})
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p3')
  await page.locator(scope+' [data-edit-meeting]').first().click()
  await page.locator('#taskMeetingForm [data-meeting-role="mic1"]').selectOption('p1')
  await page.locator('#taskMeetingForm [type="submit"]').click()
  await page.locator('#taskMeetingForm').waitFor({state:'detached'})
  await page.locator(scope+' [data-edit-meeting]').first().click()
  await page.locator('#taskMeetingForm [data-meeting-role="mic1"]').selectOption('p3')
  await page.locator('#taskMeetingForm [type="submit"]').click()
  await page.locator('[data-advisory-back]').waitFor()
  await page.locator('[data-advisory-back]').click()
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p1')
  await page.locator('#taskMeetingForm [type="submit"]').click()
  await page.locator('[data-advisory-confirm]').click()
  await page.locator('#taskMeetingForm').waitFor({state:'detached'})
  assert.equal(data.tarefas.scale.periods[month].meetings.a.assignments.mic1,'p3')
  await home()
  await page.locator('[data-menu-card="escala"]').click();await page.locator('[data-slot]').first().click()
  await page.locator('[data-pair-substitute="p1"]').click();await page.locator('.modal').last().locator('label').filter({hasText:'Caio'}).locator('input').check()
  await page.locator('[data-sub-save]').click();await page.locator('[data-sub-save]').waitFor({state:'detached'})
  assert.equal(await page.locator('#pair1').inputValue(),'p3');await page.locator('#pairSave').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.equal(data.escala.tables.l[month].rows['2026-10-04'].slots['09:00'].p1,'p3')
  await home();assert.equal(Object.keys(data.historicoOperacionalPrivado).length,2)
  // A single-module user opens that module directly, without a cross-module panel.
  session.usuario.apps={mestre:false,tarefas:true,escala:false,oradores:false}
  await page.goto(process.env.APP_TEST_URL);await page.locator('#tarefasRoot').waitFor()
  assert.equal(await page.locator('.operations-overview').count(),0)
  assert.deepEqual(errors,[])
  console.log(`Operação ${width}px: entrada simples, substituições de Tarefas e TPL, falha/retry e permissões OK`)
  await page.close()
 }
}finally{await browser.close()}
