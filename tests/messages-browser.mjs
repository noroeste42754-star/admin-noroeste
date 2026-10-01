import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON||new URL('../package.json',import.meta.url))
const {chromium}=require('playwright')
const browser=await chromium.launch({channel:'msedge',headless:true})
const source={
  tarefas:{people:{p:{name:'Antigo',masterId:'m',active:true}},planning:{periodMode:'month',editingPeriod:'2026-10'},scale:{periods:{'2026-10':{meetings:{one:{date:'2026-10-04',type:'weekend',assignments:{presidente:'p',leitor:'m'}}}}}}},
  'master/pessoas':{m:{name:'Ana',whatsapp:'79999999999',active:true}},
  'master/config/congregacao':{nome:'Noroeste'},
  'limpeza/periodos':{one:{semanas:[{dataFimSemana:'2026-10-04',grupoNome:'Grupo Azul'}]}},
  'tarefas/discursos':{oradores:{a:{nome:'Ana',ativo:true,tipo:'local',telefone:'79999999999',temaIds:[]}},congregacoes:{local:{nome:'Noroeste',tipo:'local',ativa:true,horario:'09:30',localizacao:'Rua Um'},dest:{nome:'Central',tipo:'visitante',ativa:true,contato:'José',telefone:'79999999999',horario:'18:00'}},temas:{t:{numero:70,titulo:'Confiança'}},programacao:{out:{data:'2026-10-11',tipo:'saida_orador',status:'confirmado',oradorId:'a',temaId:'t',congregacaoDestinoId:'dest'},incoming:{data:'2026-10-04',tipo:'discurso_visitante',status:'confirmado',oradorId:'a',temaId:'t',congregacaoOrigemId:'dest'}}},
  'tarefas/planning':{meetingDays:{weekendDow:0},s2Time:'09:30'},
}
try{
  for(const width of [1280,390]){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'})
    const page=await context.newPage(),errors=[],writes=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
    await page.route('**/.netlify/functions/**',route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.split('/').pop()
      if(endpoint==='module-publication'&&route.request().postDataJSON()?.action==='status')return route.fulfill({json:{hash:'test',document:null}})
      if(endpoint==='auth-session')return route.fulfill({json:{uid:'audit',csrf:'a'.repeat(48),usuario:{nome:'Auditoria',ativo:true,apps:{mestre:true,tarefas:true,oradores:true,limpeza:true}}}})
      if(endpoint==='module-publication'&&route.request().postDataJSON()?.action==='status')return route.fulfill({json:{hash:'test',document:null}})
   if(endpoint==='auth-users')return route.fulfill({json:{}})
      if(route.request().method()!=='GET'){writes.push(url.pathname);return route.fulfill({json:{ok:true}})}
      return route.fulfill({json:{results:JSON.parse(url.searchParams.get('paths')||'[]').map(path=>({value:source[path]??{}}))}})
    })
    await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
    await page.evaluate(()=>{window.open=url=>{window.messageUrl=String(url);return null}})
    await page.locator('[data-menu-card="tarefas"]').click()
    await page.getByText('Mensagem das designações do dia',{exact:true}).click()
    await page.locator('#taskSendDay').click()
    const day=await page.locator('#taskMessagePreview textarea').inputValue()
    assert.match(day,/🪑 Presidente: Ana/);assert.doesNotMatch(day,/Limpeza/)
    await page.locator('#taskMessagePreview [data-close]').click()
    await page.locator('[data-workspace-tab="participantes"]').click()
    await page.locator('[data-message-task-person="p"]').click()
    assert.match(await page.locator('#taskMessagePreview textarea').inputValue(),/Olá, Ana!/)
    await page.locator('#taskMessagePreview [data-open]').click()
    assert.match(await page.evaluate(()=>window.messageUrl),/^https:\/\/wa.me\/5579999999999\?text=/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.locator('#taskMessagePreview [data-close]').click()
    await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
    await page.evaluate(()=>{window.open=url=>{window.messageUrl=String(url);return null}})
    await page.locator('[data-menu-card="oradores"]').click()
    await page.locator('[data-workspace-tab="congregacoes"]').click()
    await page.getByText(/Oferecer datas disponíveis/).click()
    assert.equal(await page.locator('[data-available-date="2026-10-04"]').count(),0)
    for(const checkbox of await page.locator('[data-available-date]').all())await checkbox.uncheck()
    await page.locator('[data-available-date="2026-10-11"]').check()
    await page.locator('#sendAvailableDates').click()
    await page.locator('#oradoresMessagePreview [data-open]').click()
    const free=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.match(free,/11\/10\/2026 — 09:30/);assert.ok(!free.includes('18/10/2026'))
    await page.locator('#oradoresMessagePreview [data-close]').click()
    await page.getByText(/Intercâmbios ·/).click()
    await page.locator('#notifyCongregationExchanges').click()
    await page.locator('#oradoresMessagePreview [data-open]').click()
    const exchange=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.match(exchange,/🎙️ \*Convites\*/);assert.match(exchange,/🚗 \*Saídas\*/);assert.match(exchange,/Tema 70/)
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
    await context.close();console.log(`Mensagens: Tarefas, masterId, telefone, datas livres e intercâmbio ${width}px OK`)
  }
}finally{await browser.close()}
