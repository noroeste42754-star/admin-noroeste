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
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',permissions:['clipboard-read','clipboard-write']})
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
    await page.locator('#taskCopyDay').click()
    const day=await page.evaluate(()=>navigator.clipboard.readText())
    assert.match(day,/🪑 Presidente: Ana/);assert.doesNotMatch(day,/Limpeza/)
    await page.locator('#taskSendDay').click()
    assert.match(await page.evaluate(()=>window.messageUrl),/^https:\/\/wa.me\/\?text=/)
    if(width<600)await page.locator('.task-mobile-scale [data-meeting-key]').first().locator(':scope > summary').click()
    await page.locator('[data-copy-meeting="one"]:visible').click()
    const meeting=await page.evaluate(()=>navigator.clipboard.readText())
    assert.match(meeting,/04\/10\/2026.*2ª seção/)
    await page.locator('[data-whatsapp-meeting="one"]:visible').click()
    assert.equal(await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text')),meeting.replace(/\r\n/g,'\n'))
    await page.locator('[data-workspace-tab="participantes"]').click()
    await page.locator('[data-copy-task-person="p"]').click()
    assert.match(await page.evaluate(()=>navigator.clipboard.readText()),/Olá, Ana!/)
    await page.locator('[data-whatsapp-task-person="p"]').click()
    assert.match(await page.evaluate(()=>window.messageUrl),/^https:\/\/wa.me\/5579999999999\?text=/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
    await page.evaluate(()=>{window.open=url=>{window.messageUrl=String(url);return null}})
    await page.locator('[data-menu-card="oradores"]').click()
    await page.locator('[data-edit-schedule="incoming"]').waitFor()
    const card=page.locator('.oradores-card').filter({has:page.locator('[data-edit-schedule="incoming"]')})
    assert.deepEqual(await card.locator('.service-actions button').allTextContents(),['Editar','WhatsApp','Copiar texto'])
    await page.locator('[data-copy-schedule="incoming"]').click()
    const cardText=await page.evaluate(()=>navigator.clipboard.readText())
    assert.match(cardText,/04\/10\/2026/);assert.doesNotMatch(cardText,/confirma/i)
    await page.locator('[data-whatsapp-schedule="incoming"]').click()
    assert.match(await page.evaluate(()=>window.messageUrl),/^https:\/\/wa.me\/5579999999999\?text=/)
    assert.equal(await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text')),cardText.replace(/\r\n/g,'\n'))
    await page.locator('[data-workspace-tab="congregacoes"]').click()
    await page.getByText(/Oferecer datas disponíveis/).click()
    assert.equal(await page.locator('[data-available-date="2026-10-04"]').count(),0)
    assert.equal(await page.locator('[data-available-date]').count(),0)
    await page.locator('#copyAvailableDates').click()
    const copiedDates=await page.evaluate(()=>navigator.clipboard.readText())
    assert.match(copiedDates,/11\/10\/2026 — 09:30/)
    assert.match(copiedDates,/18\/10\/2026 — 09:30/)
    await page.locator('#sendAvailableDates').click()
    const free=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.equal(free,copiedDates.replace(/\r\n/g,'\n'))
    await page.getByText(/Intercâmbios ·/).click()
    await page.locator('#copyCongregationExchanges').click()
    const copiedExchange=await page.evaluate(()=>navigator.clipboard.readText())
    await page.locator('#whatsappCongregationExchanges').click()
    const exchange=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.equal(exchange,copiedExchange.replace(/\r\n/g,'\n'))
    assert.match(exchange,/🎙️ \*Convites\*/);assert.match(exchange,/🚗 \*Saídas\*/);assert.match(exchange,/Tema 70/)
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[])
    await context.close();console.log(`Mensagens: Tarefas, masterId, telefone, datas livres e intercâmbio ${width}px OK`)
  }
}finally{await browser.close()}
