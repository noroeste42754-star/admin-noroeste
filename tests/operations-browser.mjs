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
  assert.equal(await page.locator('[data-menu-card="individual"]').count(),1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  await page.locator('[data-menu-card="tarefas"]').first().click();await page.locator('[data-workspace-tab="escala"]').waitFor()
  await page.locator('[data-workspace-tab="escala"]').click()
  if(width<560)await page.locator('.task-mobile-scale summary').first().click()
  const scope=width<560?'.task-mobile-scale':'.task-scale-table'
  await page.locator(scope+' [data-task-substitute][data-role="mic1"]').click()
  const dialog=page.locator('.modal').last()
  assert.equal(await dialog.locator('label').filter({hasText:'Caio'}).locator('input').isDisabled(),true)
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
  await home()
  await page.locator('[data-menu-card="servicoCampo"]').click();await page.locator('[data-service-edit-leader="s"]').click()
  assert.match(await page.locator('#serviceLeaderForm option[value="m2"]').textContent(),/nesta data e horário/)
  assert.equal(await page.locator('#serviceLeaderForm option[value="m2"]').getAttribute('disabled'),'')
  await page.locator('#serviceLeaderForm select[name="leaderId"]').selectOption('m3')
  await page.locator('#serviceLeaderForm [type="submit"]').click();await page.locator('#serviceLeaderForm').waitFor({state:'detached'})
  assert.equal(data.servicoCampo.periods[month].assignments.s.leaderId,'m3')
  await page.locator('#newManualService').click()
  await page.locator('#manualServiceForm [name="date"]').fill('2026-10-05')
  await page.locator('#manualServiceForm [name="location"]').fill('Jardim')
  await page.locator('#manualServiceForm [name="leaderId"]').selectOption('m1')
  failWrite=true;await page.locator('#manualServiceForm [type="submit"]').click();await page.locator('#manualServiceForm [data-editor-error]').waitFor()
  failWrite=false;await page.locator('#manualServiceForm [type="submit"]').click();await page.locator('#manualServiceForm').waitFor({state:'hidden'})
  assert.ok(Object.values(data.servicoCampo.periods[month].assignments).some(item=>item.location==='Jardim'&&item.leaderId==='m1'))
  await page.locator('[data-workspace-tab="configuracao"]').click()
  await page.locator('#newServiceTemplate').click();assert.equal(await page.locator('#serviceTemplateForm').isVisible(),true)
  await page.locator('#serviceTemplateForm [name="location"]').fill('Praça Central')
  await page.locator('#serviceTemplateForm [name="templateLeader"][value="m1"]').check()
  await page.locator('#serviceTemplateForm [type="submit"]').click();await page.locator('#serviceTemplateForm').waitFor({state:'hidden'})
  assert.ok(Object.values(data.servicoCampo.templates).some(item=>item.location==='Praça Central'))
  await home();await page.locator('[data-menu-card="limpeza"]').click();await page.locator('[data-cleaning-substitute]').click()
  await page.locator('.modal input[type="radio"]').check();await page.locator('[data-sub-save]').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.equal(data.limpeza.periodos[month].semanas[0].grupo,2)
  await page.locator('[data-cleaning-tab="grupos"]').click()
  assert.equal(await page.locator('.limpeza-sel').count(),0)
  await page.locator('#limpezaList details').first().locator('summary').click()
  await page.locator('[data-edit-cleaning-group="m1"]').click()
  await page.locator('#cleaningGroupForm select[name="group"]').selectOption('2')
  await page.locator('#cancelCleaningGroup').click();await page.locator('#cleaningGroupForm').waitFor({state:'detached'})
  assert.equal(data.master.pessoas.m1.limpeza.grupo,1)
  await page.locator('[data-edit-cleaning-group="m1"]').click()
  await page.locator('#cleaningGroupForm select[name="group"]').selectOption('2')
  failWrite=true;await page.locator('#cleaningGroupForm [type="submit"]').click();await page.locator('#cleaningGroupForm [data-editor-error]').waitFor()
  assert.equal(data.master.pessoas.m1.limpeza.grupo,1)
  failWrite=false;await page.locator('#cleaningGroupForm [type="submit"]').click();await page.locator('#cleaningGroupForm').waitFor({state:'detached'})
  assert.equal(data.master.pessoas.m1.limpeza.grupo,2)
  await page.locator('#startCleaningBulk').click()
  assert.ok(await page.locator('.limpeza-sel').count()>0)
  await page.locator('#limpezaList details').first().locator('summary').click()
  await page.locator('.limpeza-sel[data-mid="m2"]').selectOption('2')
  await page.locator('#btnSalvarLimpezaGrupos').click()
  assert.equal(data.master.pessoas.m2.limpeza.grupo,2)
  await page.locator('#startCleaningBulk').waitFor({state:'visible'})
  await home();await page.locator('[data-menu-card="escala"]').click();await page.locator('[data-slot]').first().click()
  await page.locator('[data-pair-substitute="p1"]').click();await page.locator('.modal').last().locator('label').filter({hasText:'Caio'}).locator('input').check()
  await page.locator('[data-sub-save]').click();await page.locator('[data-sub-save]').waitFor({state:'detached'})
  assert.equal(await page.locator('#pair1').inputValue(),'p3');await page.locator('#pairSave').click();await page.locator('.modal').waitFor({state:'detached'})
  assert.equal(data.escala.tables.l[month].rows['2026-10-04'].slots['09:00'].p1,'p3')
  await home();assert.equal(Object.keys(data.historicoOperacionalPrivado).length,4)
  // A single-module user opens that module directly, without a cross-module panel.
  session.usuario.apps={mestre:false,tarefas:false,escala:false,limpeza:false,servicoCampo:true}
  await page.goto(process.env.APP_TEST_URL);await page.locator('.service-summary').waitFor()
  assert.equal(await page.locator('.operations-overview').count(),0)
  assert.deepEqual(errors,[])
  console.log(`Operação ${width}px: entrada simples, quatro substituições, falha/retry e permissões OK`)
  await page.close()
 }
}finally{await browser.close()}
