import { createRequire } from 'node:module'
import assert from 'node:assert/strict'

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel:'msedge', headless:true })

try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport:{ width, height:900 }, serviceWorkers:'block' })
    const page = await context.newPage(), errors = [], subscriptionRequests = []
    page.on('pageerror', error => errors.push(error.message))
    const person = { name:'Pessoa Teste', active:true, sex:'M' }
    await page.route('**/.netlify/functions/**', route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.split('/').pop()
      if (endpoint === 'calendar-subscriptions') {
        subscriptionRequests.push(route.request().method())
        return route.fulfill({ status:410, json:{ error:'Assinaturas retiradas' } })
      }
      if (endpoint === 'auth-session') return route.fulfill({ json:{ uid:'audit', csrf:'a'.repeat(48), usuario:{ nome:'Teste', ativo:true, masterId:'m1', apps:{ mestre:true, individual:true } } } })
      if (endpoint === 'auth-users') return route.fulfill({ json:{} })
      if (endpoint === 'agenda-data') return route.fulfill({ json:{ masterId:'m1', person, events:[{id:'a',source:'tarefas',date:'2026-10-03',title:'Presidente',detail:'Reunião do fim de semana',status:'futuro'}], announcements:[],agenda:{},completedSources:['tarefas','oradores','limpeza','escala','servicoCampo','quadro'],failedSources:[] } })
      const paths = JSON.parse(url.searchParams.get('paths') || '[]')
      return route.fulfill({ json:{ results:paths.map(path => ({ value:path === 'master/pessoas' ? { m1:person } : {} })) } })
    })
    await page.goto(process.env.APP_TEST_URL || 'http://localhost:5180/')
    await page.locator('[data-menu-card="individual"]').click()
    await page.getByText('Exportar ou compartilhar', { exact:true }).click()
    assert.equal(await page.locator('#agendaIcsMonth').isEnabled(), true)
    assert.equal(await page.locator('#agendaIcsUpcoming').isEnabled(), true)
    assert.equal(await page.locator('a[href^="webcal:"]').count(), 0)
    assert.deepEqual(subscriptionRequests, [])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ width, ics:true, retiredSubscriptions:true, overflow:false }))
    await context.close()
  }
} finally { await browser.close() }
