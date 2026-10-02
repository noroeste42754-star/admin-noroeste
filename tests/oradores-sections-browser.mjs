import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'

const browser=await chromium.launch({channel:'msedge',headless:true})
const hashes=[]
const source={
  'master/pessoas':{m1:{name:'Ana Um',active:true,whatsapp:'5579999991111'},m2:{name:'Bruno Dois',active:true,whatsapp:'5579999992222'}},
  'tarefas/people':{a:{masterId:'m1',weekendSection:'s1'},b:{masterId:'m2',weekendSection:'s2'}},
  'tarefas/planning':{meetingDays:{weekendDow:6,weekendS1Dow:6},s1Time:'17:00',s2Time:'19:15',enableSection1:true},
  'tarefas/discursos':{
    oradores:{a:{masterId:'m1',nome:'Ana Um',tipo:'local',secao:'s1',ativo:true,temaIds:['t']},b:{masterId:'m2',nome:'Bruno Dois',tipo:'local',secao:'s2',ativo:true,temaIds:['t']}},
    temas:{t:{numero:1,titulo:'Tema compartilhado',ativo:true}},
    congregacoes:{l1:{nome:'Noroeste',tipo:'local',secao:'s1',ativa:true,horario:'17:00'},l2:{nome:'Noroeste',tipo:'local',secao:'s2',ativa:true,horario:'19:15'},dest:{nome:'Destino',tipo:'visitante',ativa:true}},
    programacao:{p2:{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'b',temaId:'t'},out1:{data:'2026-11-07',tipo:'saida_orador',secao:'s1',oradorId:'a',temaId:'t',congregacaoDestinoId:'dest'},out2:{data:'2026-11-14',tipo:'saida_orador',secao:'s2',oradorId:'b',temaId:'t',congregacaoDestinoId:'dest'}},
  },
  'tarefas/events':{e:{data:'2026-12-13',titulo:'Evento geral',tipo:'congresso_assembleia'}},
}
try {
  for(const [module,section,ownId,otherId] of [['oradoresS1','s1','a','b'],['oradores','s2','b','a']]){
    const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block',acceptDownloads:true})
    await context.addInitScript(()=>localStorage.setItem('noroeste_oradores_month','2026-10'))
    const page=await context.newPage()
    await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
    await page.route('**/.netlify/functions/**',route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.split('/').pop()
      if(endpoint==='auth-session')return route.fulfill({json:{uid:'responsavel',csrf:'a'.repeat(48),usuario:{nome:'Responsável',ativo:true,apps:{mestre:false,[module]:true}}}})
      if(endpoint==='auth-users')return route.fulfill({json:{}})
      if(endpoint==='module-publication')return route.fulfill({json:{hash:'test',document:null}})
      assert.equal(route.request().method(),'GET')
      const paths=JSON.parse(url.searchParams.get('paths')||'[]')
      return route.fulfill({json:{results:paths.map(path=>({value:source[path]??{}}))}})
    })
    await page.goto(new URL(`/modulos/${module}/`,process.env.APP_TEST_URL).href)
    await page.getByRole('heading',{name:`Oradores · ${section==='s1'?'1ª':'2ª'} seção`,exact:true}).waitFor()
    assert.equal(await page.locator('[data-workspace-tab="pendencias"],[data-notify-schedule],#oradoresMessageSettings').count(),0)
    await page.locator('[data-workspace-tab="programacao"]').click()
    await page.locator('#speakerSchedulePdf').waitFor()
    assert.equal(await page.locator('#speakerSchedulePdf').isEnabled(),true,'PDF conjunto disponível mesmo sem programação local da seção no mês')
    assert.equal(await page.locator(`[data-edit-schedule="p2"]`).count(),section==='s2'?1:0)
    const downloaded=page.waitForEvent('download')
    await page.locator('#speakerSchedulePdf').click()
    const download=await downloaded,stream=await download.createReadStream(),chunks=[]
    for await(const chunk of stream)chunks.push(chunk)
    hashes.push(createHash('sha256').update(Buffer.concat(chunks)).digest('hex'))
    await page.locator('[data-workspace-tab="oradores"]').last().click()
    await page.locator('#speakerSearch').waitFor()
    assert.equal(await page.locator(`[data-edit-speaker="${ownId}"]`).count(),1)
    assert.equal(await page.locator(`[data-edit-speaker="${otherId}"]`).count(),0)
    await page.locator('#oradoresMessageSettings textarea').waitFor({state:'attached'})
    await page.locator('[data-workspace-tab="congregacoes"]').click()
    const options=await page.locator('#congregationContext option').evaluateAll(items=>items.map(item=>item.value))
    assert.deepEqual(new Set(options),new Set([section==='s1'?'l1':'l2','dest']))
    assert.equal(await page.locator('[data-edit-congregation="dest"]').count(),1)
    await page.locator('#oradoresMessageSettings textarea').waitFor({state:'attached'})
    await page.locator('[data-workspace-tab="temas"]').last().click()
    assert.equal(await page.locator('#newTheme').count(),1)
    await page.locator('[data-workspace-tab="eventos"]').click()
    assert.equal(await page.locator('#newSpeakerEvent').count(),1)
    await context.close()
  }
  assert.equal(hashes[0],hashes[1],'As duas entradas geram exatamente o mesmo PDF conjunto')
  console.log('Oradores: isolamento dos locais, edição compartilhada e PDF idêntico pelos dois módulos OK')
} finally {await browser.close()}
