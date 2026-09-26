import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser=await chromium.launch({channel:'msedge',headless:true})
const token='a'.repeat(64)
const csrf='b'.repeat(48)
const apps={mestre:true,tarefas:true,oradores:true,limpeza:true,escala:true,servicoCampo:true,individual:true}
const session={uid:'test',csrf,installationToken:token,usuario:{nome:'Responsável',ativo:true,masterId:'m1',apps}}
const modules=['mestre','tarefas','oradores','limpeza','escala','servicoCampo']
const page=await browser.newPage({serviceWorkers:'block'})
const seenHeaders=[]
try {
  await page.route('**/.netlify/functions/**',route=>{
    const request=route.request(),url=new URL(request.url()),endpoint=url.pathname.split('/').pop()
    if(request.headers()['x-noroeste-installation'])seenHeaders.push(request.headers()['x-noroeste-installation'])
    if(endpoint==='auth-users')return route.fulfill({json:{test:{nome:'Responsável',ativo:true}}})
    if(endpoint==='auth-session'){
      if(request.method()==='POST'||request.headers()['x-noroeste-installation']===token)return route.fulfill({json:session})
      return route.fulfill({json:{authenticated:false}})
    }
    if(endpoint==='database'){
      const paths=JSON.parse(url.searchParams.get('paths')||'[]')
      return route.fulfill({json:paths.length?{results:paths.map(()=>({value:{}}))}:{value:{}}})
    }
    if(endpoint==='module-publication')return route.fulfill({json:{hash:'test',document:null}})
    return route.fulfill({json:{entries:[],ok:true}})
  })
  await page.goto(process.env.APP_TEST_URL)
  await page.locator('#loginOverlay:not(.hidden)').waitFor()
  assert.equal(await page.locator('#moduleInstallOffer').count(),0)
  await page.locator('#inputSenha').fill('senha-teste')
  await page.locator('#btnEntrar').click()
  await page.locator('#appShell:not(.hidden)').waitFor()
  assert.equal(await page.evaluate(()=>localStorage.getItem('noroeste_module_installation_v1')),token)
  await page.locator('#moduleInstallOffer summary').click()
  assert.equal(await page.locator('#moduleInstallOffer a').count(),6)
  for(const module of modules){
    const path=`/modulos/${module}/`
    await page.goto(new URL(path,process.env.APP_TEST_URL).href)
    await page.locator('#appShell:not(.hidden)').waitFor()
    const rootId={mestre:'mestreRoot',tarefas:'tarefasRoot',oradores:'oradoresRoot',limpeza:'limpezaRoot',escala:'escalaRoot',servicoCampo:'servicoCampoRoot'}[module]
    await page.locator(`#${rootId}`).waitFor()
    assert.equal(await page.locator('#loginOverlay:not(.hidden)').count(),0,module)
    assert.equal(await page.locator('#moduleInstallOffer button').count(),1,module)
    assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'),`${path}manifest.json`)
    const manifest=await page.evaluate(async href=>(await (await fetch(href)).json()),`${path}manifest.json`)
    assert.equal(manifest.start_url,path)
    assert.equal(manifest.scope,path)
    assert.equal(manifest.id,path)
    assert.equal(manifest.icons[0].src,`${path}icon.svg`)
  }
  assert.ok(seenHeaders.length>0)
  assert.ok(seenHeaders.every(value=>value===token))
  console.log('Instalação dos seis módulos: login inicial, acesso persistente e abertura direta confirmados.')
} finally {
  await browser.close()
}
