import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({channel:'msedge',headless:true})
try{
  for(const width of [1280,390]){
    const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'})
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
    const roles={presidente:true,operador:true,leitor:true,entrada:true,auditorio:true,microfone:true}
    const master={a:{name:'Ancião',active:true,role:'anciao'},s:{name:'Servo',active:true,role:'servo-ministerial'},j:{name:'Jovem',active:true,role:'publicador'},d:{name:'Demais',active:true,role:'publicador'}}
    const data={master:{pessoas:master,config:{congregacao:{nome:'Noroeste'}}},tarefas:{people:{a:{masterId:'a',active:true,roles},s:{masterId:'s',active:true,roles},j:{masterId:'j',active:true,jovem:true,roles},d:{masterId:'d',active:true,roles}},planning:{periodMode:'month',editingPeriod:'2026-10',meetingDays:{midweekDow:3,weekendDow:0}},scale:{periods:{'2026-10':{meetings:{m1:{date:'2026-10-04',type:'weekend',assignments:{}}}}}},discursos:{},events:{}},agenda:{config:{}}}
    const read=path=>path.split('/').filter(Boolean).reduce((value,key)=>value?.[key],data)??null
    const put=(path,value)=>{const parts=path.split('/').filter(Boolean);let node=data;for(const key of parts.slice(0,-1))node=node[key]??={};if(value===null)delete node[parts.at(-1)];else node[parts.at(-1)]=value}
    const errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/.netlify/functions/**',route=>{
      const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.split('/').pop()
      if(endpoint==='auth-session')return route.fulfill({json:{uid:'admin',csrf:'a'.repeat(48),usuario:{nome:'Admin',ativo:true,apps:{mestre:true,tarefas:true,oradores:false,limpeza:false,escala:false,servicoCampo:false,individual:false}}}})
      if(endpoint==='auth-users')return route.fulfill({json:{}})
      if(endpoint==='module-publication')return route.fulfill({json:{hash:'test',document:null}})
      if(request.method()==='GET'){
        const paths=JSON.parse(url.searchParams.get('paths')||'[]')
        return route.fulfill({json:paths.length?{results:paths.map(path=>({value:read(path)}))}:{value:read(url.searchParams.get('path')||'')}})
      }
      if(endpoint==='database'&&request.method()==='PATCH'){
        const base=url.searchParams.get('path')||'',patch=request.postDataJSON().value
        for(const [path,value] of Object.entries(patch))put(`${base}/${path}`,value)
        return route.fulfill({json:{ok:true}})
      }
      return route.fulfill({json:{ok:true}})
    })
    await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
    await page.locator('[data-menu-card="tarefas"]').click()
    await page.locator('[data-workspace-tab="config"]').click()
    await page.locator('#taskGroupEnabled').check()
    await page.locator('[data-task-group="anciaos"]').fill('90')
    assert.equal(await page.locator('#saveTaskGroups').isDisabled(),true)
    await page.locator('[data-task-group="anciaos"]').fill('50')
    await page.locator('[data-task-group="servos"]').fill('30')
    await page.locator('[data-task-group="jovens"]').fill('10')
    assert.match(await page.locator('#taskGroupRemaining').innerText(),/10%/)
    await page.locator('#saveTaskGroups').click()
    await page.waitForFunction(()=>document.querySelector('#taskGroupEnabled')?.checked===true)
    assert.equal(data.tarefas.planning.groupTargets.anciaos,50)
    await page.locator('[data-workspace-tab="escala"]').click()
    await page.locator('#btnGenerateScale').click()
    await page.locator('#taskGroupPreviewTitle').waitFor()
    assert.match(await page.locator('.modal').innerText(),/Anciãos/)
    await page.locator('#cancelTaskGroups').click()
    assert.deepEqual(data.tarefas.scale.periods['2026-10'].meetings.m1.assignments,{})
    await page.locator('#btnGenerateScale').click()
    await page.locator('#confirmTaskGroups').click()
    await page.waitForFunction(()=>Boolean(document.querySelector('#btnGenerateScale')&&!document.querySelector('#taskGroupPreviewTitle')))
    assert.ok(data.tarefas.scale.periods['2026-10'].meetings.m1.assignments.presidente)
    assert.equal(data.tarefas.scale.periods['2026-10'].appliedRules.groupTargets.anciaos,50)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    assert.deepEqual(errors,[])
    console.log(`Tarefas por grupo ${width}px: configuração, prévia, cancelamento e gravação OK`)
    await page.close()
  }
}finally{await browser.close()}
