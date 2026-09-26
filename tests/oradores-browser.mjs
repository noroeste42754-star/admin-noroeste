import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { sourceHash } from '../netlify/lib/publication-transition.ts'
import { mkdir } from 'node:fs/promises'

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel:'msedge', headless:true })

const source = {
  'tarefas/discursos':{
    oradores:{ local:{ nome:'André Almeida', tipo:'local', funcao:'anciao', telefone:'5585999999999', ativo:true, temaIds:['tema_001'], aprovadoParaSaida:true }, visitante:{ nome:'Carlos Oliveira', tipo:'visitante', funcao:'anciao', telefone:'5585888888888', ativo:true, temaIds:['tema_001'], congregacaoId:'centro' } },
    temas:{ tema_001:{ numero:1, titulo:'Como encontrar verdadeira paz', ativo:true } },
    congregacoes:{ local:{ nome:'Noroeste', cidade:'Fortaleza', tipo:'local', ativa:true, contato:'', telefone:'', diaReuniao:'Domingo', horario:'18:00', localizacao:'', observacoes:'', secao:'s2' }, centro:{ nome:'Centro', cidade:'Fortaleza', tipo:'visitante', ativa:true, contato:'José', telefone:'5585777777777', diaReuniao:'Sábado', horario:'19:00', localizacao:'Centro', observacoes:'' } },
    programacao:{ p1:{ data:'2026-09-20', tipo:'discurso_visitante', status:'por_confirmar', secao:'s2', oradorId:'visitante', oradorNome:'Carlos Oliveira', temaId:'tema_001', temaNumero:1, temaTitulo:'Como encontrar verdadeira paz', congregacaoOrigemId:'centro', congregacaoOrigemNome:'Centro' }, p2:{ data:'2026-09-27', tipo:'saida_orador', status:'confirmado', oradorId:'local', oradorNome:'André Almeida', temaId:'tema_001', temaNumero:1, temaTitulo:'Como encontrar verdadeira paz', congregacaoDestinoId:'centro', congregacaoDestinoNome:'Centro', confirmacao:{status:true,confirmadoEm:'2026-09-01'} } },
  },
  'tarefas/events':{ e1:{ data:'2026-09-13', titulo:'Assembleia', tipo:'congresso_assembleia', impactoTarefas:{bloqueiaReuniao:true} } },
  'tarefas/planning':{ periodMode:'month', meetingDays:{weekendDow:0}, excludedDates:[], enableSection1:false, s2Time:'18:00' },
  'tarefas/people':{p1:{masterId:'m1',name:'Nome desatualizado'}},
  'master/pessoas':{m1:{name:'André Almeida',whatsapp:'5585999999999',active:true,role:'anciao'},m2:{name:'Bruno Souza',whatsapp:'5585777777777',active:true,role:'anciao'}},
  'tarefas/scale/periods':{},
}
source['tarefas/discursos'].oradores.local.pessoaId='p1'
source['tarefas/discursos'].programacao.nextMonth={data:'2026-10-15',tipo:'discurso_local',status:'por_definir'}
source['tarefas/discursos'].programacao.far={data:'2027-01-01',tipo:'discurso_local',status:'por_definir'}
source['tarefas/discursos'].temas.theme25={numero:25,titulo:'Tema vinte e cinco',ativo:true}
source['tarefas/discursos'].temas.theme38={numero:38,titulo:'Tema trinta e oito',ativo:true}

try {
  for (const width of [1280,390]) {
    const data=structuredClone(source),writes=[]
    let failNext=false, official=null
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',acceptDownloads:true})
    const page=await context.newPage(), errors=[]
    await page.clock.setFixedTime(new Date('2026-09-22T12:00:00-03:00'))
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/.netlify/functions/**',route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.split('/').pop()
      if(endpoint==='auth-session')return route.fulfill({json:{uid:'audit',csrf:'a'.repeat(48),usuario:{nome:'Auditoria',ativo:true,apps:{mestre:true,oradores:true}}}})
      if(endpoint==='module-publication') {
        const body=route.request().postDataJSON(),root={master:{pessoas:data['master/pessoas']},tarefas:{people:data['tarefas/people'],discursos:data['tarefas/discursos']}},hash=sourceHash(root,'oradores',body.periodId)
        if(body.action==='status')return route.fulfill({json:{hash,document:official}})
        if(body.action==='prepare')return route.fulfill({json:{root:{master:{pessoas:data['master/pessoas']},tarefas:{people:data['tarefas/people'],discursos:data['tarefas/discursos']}},hash,version:'test-version',previous:official}})
        official=body.document;return route.fulfill({json:{ok:true}})
      }
      if(endpoint==='auth-users')return route.fulfill({json:{}})
      if(route.request().method()!=='GET'){
        const path=url.searchParams.get('path'),body=route.request().postDataJSON()
        if(failNext){failNext=false;return route.fulfill({status:503,json:{error:'Falha simulada'}})}
        writes.push({path,body})
        if(path==='agenda/documentos')for(const [id,value] of Object.entries(body.value))data[`agenda/documentos/${id}`]=value
        if(path?.startsWith('tarefas/discursos/programacao/'))data['tarefas/discursos'].programacao[path.split('/').pop()]=body.value
        if(path?.startsWith('tarefas/discursos/congregacoes/'))data['tarefas/discursos'].congregacoes[path.split('/').pop()]=body.value
        if(path==='tarefas/discursos/oradores')data['tarefas/discursos'].oradores=body.value
        return route.fulfill({json:endpoint==='storage-file'?{url:'https://example.test/oradores.pdf'}:{ok:true}})
      }
      const paths=JSON.parse(url.searchParams.get('paths')||'[]')
      return route.fulfill({json:{results:paths.map(path=>({value:data[path]??{}}))}})
    })
    await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
    await page.locator('[data-menu-card="oradores"]').click()
    await page.getByRole('heading',{name:'Oradores',exact:true}).waitFor()
    assert.equal(await page.locator('[data-workspace-tab="pendencias"]').getAttribute('aria-current'),'page')
    assert.equal(await page.locator('[data-pending-id="far"]').count(),0)
    await page.locator('[data-pending-id="nextMonth"]').click()
    assert.equal(await page.locator('#oradoresMonth').inputValue(),'2026-10')
    assert.equal(await page.locator('#speakerScheduleForm [name="oradorId"]').evaluate(el=>el===document.activeElement),true)
    await page.locator('#cancelScheduleEdit').click()
    await page.locator('[data-workspace-tab="pendencias"]').click()
    await page.locator('[data-pending-id="p2"]').click()
    assert.equal(await page.locator('[data-reconfirm-schedule="p2"]').evaluate(el=>el===document.activeElement),true)
    await page.locator('#oradoresMonth').fill('2026-09')
    await page.locator('#oradoresMonth').dispatchEvent('change')
    await page.getByText('Carlos Oliveira',{exact:true}).waitFor()
    assert.equal(await page.locator('#scheduleSearch').count(),1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    const downloaded=page.waitForEvent('download')
    await page.locator('#speakerSchedulePdf').click()
    assert.equal(await (await downloaded).failure(),null)
    assert.equal(await page.locator('#speakerSchedulePublish').isEnabled(),true)
    await page.locator('#speakerSchedulePublish').click()
    await page.getByText('PDF de Oradores publicado no Quadro',{exact:true}).waitFor()
    await page.locator('#speakerPublicationStatus').filter({hasText:'Publicado e atualizado'}).waitFor()
    await page.locator('#scheduleSearch').fill('inexistente')
    await page.locator('#scheduleSearch').dispatchEvent('change')
    await page.getByText('Nenhum resultado para esta busca ou filtro.',{exact:true}).waitFor()
    await page.locator('#clearScheduleFilters').click()
    await page.locator('.oradores-card').filter({has:page.locator('[data-substitute-date="2026-09-20"]')}).locator('.oradores-more-actions summary').click()
    await page.locator('[data-substitute-date="2026-09-20"]').click()
    assert.equal(await page.locator('#emergencyDate').count(),0)
    assert.equal(await page.locator('#substitutionContext').innerText(),'Substituição para 20/09/2026')
    await page.getByRole('button',{name:'Substituições',exact:true}).waitFor()
    await page.locator('[data-workspace-tab="oradores"]').last().click()
    await page.locator('#speakerSearch').waitFor()
    assert.equal(await page.locator('#speakerResults').getByText('Carlos Oliveira',{exact:true}).count(),0)
    await page.locator('[data-edit-speaker="local"]').click()
    assert.equal(await page.locator('#speakerForm [name="nome"]').count(),0)
    assert.equal(await page.locator('#speakerForm [name="masterId"]').inputValue(),'m1')
    assert.equal(await page.locator('#speakerForm [name="masterId"]').isDisabled(),true)
    const repertoire=page.locator('[name="themeNumbers"]')
    await repertoire.fill('25, 1, 025, 38')
    await page.locator('#repertoirePreview').getByText('25 — Tema vinte e cinco',{exact:true}).waitFor()
    await repertoire.blur()
    assert.equal(await repertoire.inputValue(),'1, 25, 38')
    await mkdir(new URL('../output/oradores-review/',import.meta.url),{recursive:true})
    await page.screenshot({path:new URL(`../output/oradores-review/editor-${width}.png`,import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),fullPage:true})
    await repertoire.fill('99')
    assert.match(await page.locator('#repertoirePreview').innerText(),/99.*não cadastrado/)
    await repertoire.fill('25, 1, 38')
    page.once('dialog',dialog=>dialog.dismiss())
    await page.locator('#cancelSpeakerEdit').click()
    assert.equal(await repertoire.inputValue(),'1, 25, 38')
    failNext=true
    await page.locator('#speakerForm [type="submit"]').click()
    await page.locator('[data-form-error]').getByText(/Seu preenchimento foi mantido/).waitFor()
    assert.equal(await repertoire.inputValue(),'1, 25, 38')
    await page.locator('#speakerForm [type="submit"]').click()
    await page.getByText('Configuração do orador salva',{exact:true}).waitFor()
    assert.deepEqual(data['tarefas/discursos'].oradores.local.temaIds,['tema_001','theme25','theme38'])
    assert.equal(data['tarefas/discursos'].oradores.local.masterId,'m1')
    await page.locator('#speakerSearch').fill('25')
    assert.equal(await page.locator('#speakerResults .oradores-card').count(),1)
    assert.equal(await page.locator('[data-speaker-repertoire="local"]').innerText(),'1, 25, 38')
    await page.evaluate(()=>{window.open=url=>{window.messageUrl=String(url);return null}})
    await page.locator('[data-notify-speaker="local"]').click()
    await page.locator('#oradoresMessagePreview [data-open]').click()
    const message=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.match(message,/Tema 1:/)
    assert.match(message,/Congregação: Centro/)
    assert.match(message,/Endereço: Centro/)
    assert.ok(!message.includes('Localização:'))
    await page.locator('#oradoresMessagePreview [data-close]').click()
    await page.locator('[data-workspace-tab="oradores"]').last().click()
    await page.locator('#newSpeaker').click()
    assert.equal(await page.locator('[name="masterId"] option[value="m1"]').count(),0)
    await page.locator('#speakerForm [data-person-search]').fill('Bruno')
    await page.locator('[name="masterId"]').selectOption('m2')
    await repertoire.fill('25')
    await page.locator('[name="sentinelaDirigente"]').check()
    await page.locator('[name="sentinelaSubstituto"]').check()
    await page.locator('#speakerForm [type="submit"]').click()
    await page.locator('[data-form-error]').getByText(/pessoas diferentes/).waitFor()
    await page.locator('[name="sentinelaSubstituto"]').uncheck()
    await page.locator('#speakerForm [type="submit"]').click()
    await page.locator('#speakerForm').waitFor({state:'detached'})
    assert.equal(data['tarefas/discursos'].oradores.orador_m2.masterId,'m2')
    assert.ok(writes.every(write=>!write.path?.startsWith('master/')))
    await page.locator('[data-workspace-tab="emergencia"]').click()
    assert.equal(await page.locator('#emergencyDate,#substitutionContext').count(),0)
    await page.locator('[data-emergency-speaker="orador_m2"]').click()
    assert.equal(await page.locator('#speakerScheduleForm [name="data"]').inputValue(),'')
    assert.equal(await page.locator('#speakerScheduleForm [name="oradorId"]').inputValue(),'orador_m2')
    page.once('dialog',dialog=>dialog.accept())
    await page.locator('#cancelScheduleEdit').click()
    await page.locator('[data-workspace-tab="programacao"]').click()
    await page.locator('#newSchedule').click()
    await page.locator('[name="data"]').fill('2026-09-28')
    assert.equal(await page.locator('#speakerScheduleForm details').getAttribute('open'),null)
    await page.locator('[name="oradorId"]').selectOption('local')
    assert.match(await page.locator('[data-pick-theme="1"]').innerText(),/Já usado/)
    assert.match(await page.locator('[data-pick-theme="25"]').innerText(),/Disponível/)
    await page.locator('[data-pick-theme="25"]').click()
    assert.equal(await page.locator('[name="themeNumber"]').inputValue(),'25')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.screenshot({path:new URL(`../output/oradores-review/programacao-simplificada-${width}.png`,import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),fullPage:true})
    assert.equal(await page.locator('[name="temaId"]').inputValue(),'theme25')
    assert.match(await page.locator('#scheduleThemePreview').innerText(),/vinte e cinco/)
    await page.locator('#speakerScheduleForm [type="submit"]').click()
    await page.getByText('Programação criada',{exact:true}).waitFor()
    await page.locator('#speakerPublicationStatus').filter({hasText:'Publicado, mas os dados mudaram'}).waitFor()
    const scheduleWrite=writes.find(write=>write.path?.startsWith('tarefas/discursos/programacao/')&&write.body.value?.data==='2026-09-28')
    assert.equal(scheduleWrite.body.value.temaId,'theme25')
    await page.locator('[data-workspace-tab="oradores"]').last().click()
    await page.locator('[data-edit-speaker="local"]').click()
    await repertoire.fill('')
    page.once('dialog',dialog=>dialog.accept())
    await page.locator('#speakerForm [type="submit"]').click()
    await page.locator('#speakerForm').waitFor({state:'detached'})
    assert.deepEqual(data['tarefas/discursos'].oradores.local.temaIds,[])
    await page.locator('[data-workspace-tab="congregacoes"]').click()
    await page.locator('#congregationContext').selectOption('centro')
    await page.locator('[data-edit-congregation="centro"]').click()
    await page.locator('#congregationForm [name="horizonteDatas"]').selectOption('180')
    await page.locator('#congregationForm button.btn-primary').click()
    assert.equal(data['tarefas/discursos'].congregacoes.centro.horizonteDatas,180)
    await page.getByText(/Oferecer datas disponíveis · 180 dias/).click()
    assert.equal(await page.locator('#availableHorizon').inputValue(),'180')
    await page.getByText(/Intercâmbios ·/).click()
    assert.equal(await page.locator('#notifyCongregationExchanges').isEnabled(),true)
    await page.evaluate(()=>{window.open=url=>{window.messageUrl=String(url);return null}})
    await page.locator('#notifyCongregationExchanges').click()
    await page.locator('#oradoresMessagePreview [data-open]').click()
    const finalized=await page.evaluate(()=>new URL(window.messageUrl).searchParams.get('text'))
    assert.match(finalized,/27\/09\/2026/)
    assert.ok(!finalized.includes('20/09/2026'))
    await page.locator('#oradoresMessagePreview [data-close]').click()
    for(const tab of ['oradores','emergencia','congregacoes','temas','eventos','pendencias']){
      await page.locator(`[data-workspace-tab="${tab}"]`).last().click()
      await page.waitForFunction(()=>!document.querySelector('#oradoresRoot')?.textContent?.includes('Carregando'))
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${tab} sem overflow em ${width}px`)
      if(tab==='temas'){
        assert.equal(await page.locator('#themesPdf').isVisible(),true)
        assert.equal(await page.getByRole('button',{name:'Livres',exact:true}).isVisible(),true)
        assert.equal(await page.getByRole('button',{name:'Já usados',exact:true}).isVisible(),true)
        assert.equal(await page.getByRole('button',{name:'Todos',exact:true}).isVisible(),true)
        assert.equal(await page.getByRole('button',{name:'Mais opções',exact:true}).isVisible(),true)
        assert.equal(await page.locator('[data-theme-filter="available"]').getAttribute('aria-pressed'),'true')
        assert.ok((await page.locator('#themeResults').innerText()).includes('Tema trinta e oito'))
        assert.ok(!(await page.locator('#themeResults').innerText()).includes('Tema vinte e cinco'))
        await page.locator('[data-theme-filter="pending"]').click()
        assert.match(await page.locator('#themeResults').innerText(),/28\/09\/2026/)
        await page.locator('[data-theme-filter="used"]').click()
        assert.match(await page.locator('#themeResults').innerText(),/Último uso: 20\/09\/2026/)
        const download=page.waitForEvent('download');await page.locator('#themesPdf').click()
        const file=await download;assert.equal(await file.failure(),null)
        await file.saveAs(new URL(`../output/oradores-review/temas-${width}.pdf`,import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'))
      }
      if(tab==='emergencia'){
        assert.equal(await page.locator('#emergencyDate,#substitutionContext').count(),0)
        const download=page.waitForEvent('download');await page.locator('#substitutionsPdf').click()
        const file=await download;assert.equal(await file.failure(),null)
        await file.saveAs(new URL(`../output/oradores-review/substituicoes-${width}.pdf`,import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'))
      }
    }
    assert.deepEqual(errors,[])
    console.log(`Oradores: edição, falha de gravação, masterId, repertório, programação e navegação em ${width}px OK`)
    await context.close()
  }
  const context=await browser.newContext({viewport:{width:390,height:900},serviceWorkers:'block'})
  const page=await context.newPage(),readPaths=[]
  await page.route('**/.netlify/functions/**',route=>{
    const url=new URL(route.request().url()),endpoint=url.pathname.split('/').pop()
    if(endpoint==='auth-session')return route.fulfill({json:{uid:'speaker',csrf:'a'.repeat(48),usuario:{nome:'Oradores',ativo:true,apps:{mestre:false,oradores:true}}}})
    if(endpoint==='auth-users')return route.fulfill({json:{}})
    if(endpoint==='module-publication'&&route.request().postDataJSON()?.action==='status')return route.fulfill({json:{hash:'test',document:null}})
    assert.equal(route.request().method(),'GET','Consulta sem permissão Admin não deve gravar cadastros')
    const paths=JSON.parse(url.searchParams.get('paths')||'[]');readPaths.push(...paths)
    return route.fulfill({json:{results:paths.map(path=>({value:source[path]??{}}))}})
  })
  await page.goto(process.env.APP_TEST_URL||'http://127.0.0.1:5191/')
  await page.locator('[data-workspace-tab="programacao"]').click()
  await page.locator('#newSchedule').waitFor()
  await page.locator('[data-workspace-tab="oradores"]').last().click()
  await page.locator('#speakerSearch').waitFor()
  assert.equal(await page.locator('#newSpeaker,[data-edit-speaker]').count(),0)
  assert.ok(readPaths.includes('master/pessoas'))
  assert.ok(readPaths.includes('tarefas/scale/periods'))
  await page.locator('[data-workspace-tab="programacao"]').click()
  await page.locator('#newSchedule').click()
  assert.equal(await page.getByText(/Designações de Tarefas não verificadas/).count(),0)
  await context.close()
  console.log('Oradores: consulta sem Admin preserva permissões OK')
} finally { await browser.close() }
