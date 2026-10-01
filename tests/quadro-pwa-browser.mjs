import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser=await chromium.launch({channel:'msedge',headless:true})
try {
  for(const alias of ['quadro/','agenda/']) {
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[]
    let offline=false
    page.on('pageerror',error=>errors.push(error.message))
    await context.route('**/.netlify/functions/**',route=>offline?route.abort('internetdisconnected'):route.fulfill({json:{events:[],notices:[{id:'aviso',date:'2026-10-04',title:'Anúncio geral público',description:'Informação preservada offline'}],agenda:{config:{},documentos:{}},completedSources:['tarefas','oradores','escala','geral','quadro'],failedSources:[]}}))
    await page.goto(process.env.APP_TEST_URL)
    if(alias==='agenda/')await page.evaluate(async()=>{const cache=await caches.open('noroeste-agenda-v5');await cache.put('/agenda/',new Response('<html>Agenda pessoal antiga</html>'))})
    await page.goto(new URL(alias,process.env.APP_TEST_URL).href)
    await page.getByRole('heading',{name:'Quadro de Anúncios',exact:true}).waitFor()
    await page.evaluate(async()=>{await navigator.serviceWorker.ready})
    await page.waitForFunction(()=>navigator.serviceWorker.controller!==null)
    await page.locator('[role="status"]').filter({hasText:'Atualizado em'}).waitFor()
    await page.reload()
    await page.locator('[role="status"]').filter({hasText:'Atualizado em'}).waitFor()
    const paths=await page.evaluate(async()=>{const keys=await caches.keys(),result=[];for(const key of keys)for(const request of await (await caches.open(key)).keys())result.push(new URL(request.url).pathname);return result})
    assert.equal(paths.some(path=>path.startsWith('/.netlify/functions/')),false)
    if(alias==='agenda/')assert.equal((await page.evaluate(()=>caches.keys())).includes('noroeste-agenda-v5'),false)
    offline=true;await context.setOffline(true)
    await page.reload()
    await page.getByRole('heading',{name:'Quadro de Anúncios',exact:true}).waitFor()
    await page.locator('#quadroRetry').waitFor()
    assert.match(await page.locator('[role="status"]').first().innerText(),/Offline/)
    assert.equal(await page.locator('#agendaPerson,#selectUsuario,input[type="password"]').count(),0)
    await page.locator('[data-quadro-tab="documentos"]').click()
    assert.match(await page.locator('#quadroPanel').innerText(),/Anúncio geral público/)
    assert.deepEqual(errors,[])
    console.log('PWA /'+alias+': shell compilado, abertura offline, anúncio salvo e ausência de cache privado confirmados')
    await context.close()
  }
}finally{await browser.close()}
