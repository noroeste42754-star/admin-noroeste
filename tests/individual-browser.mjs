import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel:'msedge', headless:true })
await mkdir('.netlify', { recursive:true })

const master = {
  m1:{ name:'Pessoa de teste', active:true, sex:'M', role:'publicador' },
  m2:{ name:'Outra pessoa', active:true, sex:'F', role:'publicador' },
}
const sources = {
  'master/pessoas':master,
  'tarefas/people':{ t1:{ masterId:'m1' }, t2:{ masterId:'m2' } },
  'tarefas/scale/periods':{ '2026-09':{ locked:true, meetings:{ mid:{ date:'2026-09-16', type:'midweek', assignments:{ mic1:'t1', mic2:'t2' } }, end:{ date:'2026-09-20', type:'weekend', assignments:{ presidente:'t1' } } } } },
  'tarefas/discursos/oradores':{ o1:{ masterId:'m1', tipo:'local' } },
  'tarefas/discursos/programacao':{ p1:{ data:'2026-09-20', tipo:'discurso_local', oradorId:'o1', temaTitulo:'Tema de teste', confirmacao:{ status:true } } },
  'tarefas/discursos/congregacoes':{},
  'limpeza/periodos':{ '2026-09':{ publicado:true, semanas:[{ dataMeioSemana:'2026-09-16', dataFimSemana:'2026-09-20', grupoNome:'Grupo 1', membrosMid:['m1'] }] } },
  'escala/participants':{ e1:{ masterId:'m1' }, e2:{ masterId:'m2' } },
  'escala/scales':{ l1:{ name:'Praça central' } },
  'escala/tables':{ l1:{ '2026-09':{ rows:{ '2026-09-19':{ slots:{ '08:00':{ p1:'e1', p2:'e2' } } } } } } },
  'escala/publishedMonth':'2026-09',
  'escala/publishedMonths':{ '2026-09':true },
  'escala/publishedSnapshots':{},
  programacao:{ pessoas:{ m1:{ masterId:'m1', active:true }, m2:{ masterId:'m2', active:true } }, settings:{ meetingTime:'19:30', rooms:[{ id:'main', name:'Salão principal' }] }, programs:{ w1:{ meetingDate:'2026-09-16', parts:[{ id:'a', section:'ministerio', title:'Iniciando conversas', assignedPersonId:'m1', assistantPersonId:'m2', confirmedAt:'2026-09-01' }] } } },
  secretario:{ publicadores:{ pub1:{ id:'pub1', masterId:'m1', ativo:true, categoria:'pioneiro_regular' } }, relatorios:{ r1:{ id:'r1', masterId:'m1', competencia:'2026-09', categoria:'pioneiro_regular', participou:true, estudos:1, horasCampo:50, origem:'minha_agenda', createdBy:'pessoa', lastEditedBy:'pessoa', status:'enviado' } }, fechamentos:{} },
  'agenda/config':{ outrosAnunciosDriveUrl:'https://drive.google.com/drive/folders/pasta-teste', icsReminders:{ tarefas:['P7D','P1D'], servicoCampo:['P1D'], quadro:['P1D'] } },
  'agenda/documentos':{
    tarefas:{ modulo:'tarefas', nome:'tarefas-2026-09.pdf', periodo:'Setembro de 2026', inicio:'2026-09-01', fim:'2026-09-30', criadoEm:'2026-09-15T10:00:00Z', url:'https://example.invalid/tarefas.pdf', oficial:true },
    admin:{ modulo:'admin', nome:'comunicado.pdf', periodo:'Setembro de 2026', inicio:'2026-09-01', fim:'2026-09-30', criadoEm:'2026-09-15T11:00:00Z', url:'https://example.invalid/comunicado.pdf', oficial:true },
  },
  servicoCampo:{ periods:{ '2026-09':{ published:true, assignments:{ s1:{ date:'2026-09-18', time:'16:00', location:'Salão do Reino', label:'Saída de campo', leaderId:'m1' } } } } },
}

try {
  for (const viewport of [{ width:1440, height:900 }, { width:390, height:844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers:'block' })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-09-15T12:00:00-03:00'))
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/.netlify/functions/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.split('/').pop()
      assert.notEqual(endpoint, 'calendar-subscriptions', 'retired subscription UI makes no requests')
      if (endpoint === 'auth-session') return route.fulfill({ json:{ uid:'audit', csrf:'a'.repeat(48), usuario:{ nome:'Auditoria', ativo:true, masterId:'m1', apps:{ mestre:true, individual:true } } } })
      if (endpoint === 'auth-users') return route.fulfill({ json:{} })
      if (endpoint === 'agenda-data') { const masterId=url.searchParams.get('masterId') || 'm1'; return route.fulfill({ json:{ masterId, person:master[masterId], events:[{id:'personal',source:'tarefas',date:'2026-09-20',time:'18:00',title:'Designação',detail:'Fim de semana',status:'futuro'}], announcements:[{id:'general',source:'tarefas',date:'2026-09-20',time:'18:00',title:'Reunião',detail:'Fim de semana',status:'futuro',people:['Pessoa de teste']}], agenda:{ config:sources['agenda/config'], documentos:sources['agenda/documentos'] }, completedSources:['tarefas','oradores','limpeza','escala','servicoCampo','quadro'], failedSources:[] } }) }
      if (route.request().method() !== 'GET') return route.fulfill({ json:{ ok:true } })
      const paths = JSON.parse(url.searchParams.get('paths') || '[]')
      assert.equal(paths.some(path => /^(secretario|programacao|oradores)(\/|$)|^tarefas\/discursos/.test(path)), false)
      return route.fulfill({ json:{ results:paths.map(path => ({ value:sources[path] ?? {} })) } })
    })
    await page.goto(process.env.APP_TEST_URL || 'http://127.0.0.1:5176/')
    assert.equal(await page.locator('[data-menu-card="secretario"], [data-menu-card="programacao"]').count(), 0)
    await page.locator('[data-menu-card="individual"]').click()
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    assert.equal(await page.locator('.agenda-personal-event .agenda-status.futuro').count(), 0)
    if (await page.locator('[data-sync-failure]').count()) { await page.locator('[data-sync-failure] button').click(); await page.locator('[data-sync-failure]').waitFor({ state:'detached' }) }
    assert.equal(await page.getByRole('tab', { name:'Relatório', exact:true }).count(), 0)
    await page.getByText('Calendário e compartilhamento', { exact:true }).click()
    for (const selector of ['#agendaIcsMonth', '#agendaIcsUpcoming']) assert.equal(await page.locator(selector).isEnabled(), true)
    for (const screen of ['Programação geral', 'Anúncios e PDFs']) {
      await page.getByRole('button', { name:screen, exact:true }).click()
      assert.equal(await page.locator('#agendaSource, #agendaStatus, #generalSource, #generalStatus, #generalShowPast').count(), 0)
      assert.equal(await page.locator('[id*="Subscription"], a[href^="webcal:"], [data-agenda-panel="subscription"]').count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, screen)
      await page.getByRole('button', { name:'Minhas designações' }).click()
    }
    await page.getByRole('button', { name:'Anúncios e PDFs', exact:true }).click()
    assert.equal(await page.getByRole('link', { name:'Abrir outros anúncios' }).getAttribute('href'), 'https://drive.google.com/drive/folders/pasta-teste')
    await page.reload()
    await page.locator('[data-menu-card="individual"]').click()
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    assert.equal(await page.getByText('PDFs dos módulos', { exact:true }).count(), 0)
    assert.equal(await page.locator('#agendaOtherDates').getAttribute('open'), null)
    await page.screenshot({ path:`.netlify/minha-agenda-${viewport.width}.png`, fullPage:true })
    await page.locator('#btnBack').click()
    await page.locator('#btnSair').waitFor({ state:'visible' })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ viewport, screens:3, driveFolder:true, opensOnPersonal:true, overflow:false, errors:0 }))
    await context.close()
  }
} finally {
  await browser.close()
}
