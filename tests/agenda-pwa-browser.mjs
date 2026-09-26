import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, extname, sep } from 'node:path'
import { once } from 'node:events'

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const root = resolve('dist')
const people = { m_test1:{ name:'Pessoa teste 1', active:true }, m_test2:{ name:'Pessoa teste 2', active:true } }
let paired = '', installation = ''
const calls = [], errors = []
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const json = (status, body) => { response.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store' }); response.end(JSON.stringify(body)) }
  try {
    if (path.startsWith('/.netlify/functions/')) {
      calls.push(`${request.method} ${path}`)
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body = raw ? JSON.parse(raw) : {}
      if (path.endsWith('/agenda-device')) {
        if (request.method === 'GET') return json(200, { people, masterId:paired })
        if (request.method === 'POST') {
          assert.equal(body.adminPassword, undefined)
          paired = body.masterId; installation = body.installationId
          return json(200, { masterId:paired })
        }
        if (body.adminPassword !== 'fixture-admin') return json(401, { error:'Senha Admin inválida.' })
        paired = ''; return json(200, { ok:true })
      }
      if (path.endsWith('/agenda-data')) return json(200, {
        masterId:paired, person:people[paired], events:[], announcements:[], agenda:{},
      })
      return json(404, { error:'Unexpected endpoint' })
    }
    const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`)
    if (!file.startsWith(root + sep)) return json(403, {})
    const bytes = await readFile(file)
    const types = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png' }
    response.writeHead(200, { 'content-type':types[extname(file)] || 'application/octet-stream' }); response.end(bytes)
  } catch (error) { errors.push(error.message); json(500, { error:'Fixture failed' }) }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
await mkdir('.netlify', { recursive:true })
let context
const profiles = []
try {
  for (const viewport of [{ width:1440, height:900 }, { width:390, height:844 }]) {
    paired = ''; installation = ''
    const profile = await mkdtemp(resolve(tmpdir(), 'agenda-pwa-')); profiles.push(profile)
    const launch = () => chromium.launchPersistentContext(profile, { channel:'msedge', headless:true, viewport })
    const attach = page => { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept()) }
    context = await launch()
    let page = context.pages()[0]; attach(page)
    await page.goto(`${base}/agenda/`)
    await page.locator('#agendaPerson').selectOption('m_test1')
    await page.getByRole('button', { name:'Continuar', exact:true }).click()
    await page.getByRole('button', { name:'Anúncios e PDFs', exact:true }).click()
    assert.equal(await page.locator('input[type=password]').count(), 0)
    assert.match(installation, /^[a-f0-9]{48}$/)
    assert.equal(await page.getByText('PDFs dos módulos', { exact:true }).locator('xpath=../..').getAttribute('open'), '')
    // Localhost intentionally disables automatic registration; exercise the production worker explicitly.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/agenda/sw.js', { scope:'/agenda/' })
      await navigator.serviceWorker.ready
    })
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    await page.reload()
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    const beforeOffline = calls.length
    await context.close()
    context = await launch()
    await context.setOffline(true)
    page = context.pages()[0]; attach(page)
    await page.goto(`${base}/agenda/`)
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    await page.getByRole('button', { name:'Anúncios e PDFs', exact:true }).click()
    assert.equal(await page.getByText('PDFs dos módulos', { exact:true }).locator('xpath=../..').getAttribute('open'), '')
    assert.equal(await page.getByRole('tab', { name:'Relatório', exact:true }).count(), 0)
    assert.equal(calls.length, beforeOffline)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path:`.netlify/agenda-pwa-offline-${viewport.width}.png`, fullPage:true })
    await context.setOffline(false)
    await page.reload()
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    await page.locator('#bottomUser').click()
    await page.locator('#agendaAdminPassword').fill('wrong')
    await page.locator('#agendaUnlockConfirm').click()
    await page.locator('#agendaUnlockError').filter({ hasText:'inválida' }).waitFor()
    assert.equal(paired, 'm_test1')
    await page.locator('#agendaAdminPassword').fill('fixture-admin')
    await page.locator('#agendaUnlockConfirm').click()
    await page.locator('#agendaPerson').waitFor({ state:'visible' })
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('noroeste_agenda_offline_v3:'))), false)
    await page.locator('#agendaPerson').selectOption('m_test2')
    await page.getByRole('button', { name:'Continuar', exact:true }).click()
    await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
    assert.equal(await page.locator('#bottomUser').innerText(), 'Pessoa teste 2')
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ viewport, saveWithoutPassword:true, offlineBrowserRestart:true, preferencesPreserved:true, retiredReportAbsent:true, unlockPassword:true, identityIsolation:true }))
    await context.close(); context = null
  }
} finally {
  await context?.close()
  await new Promise(resolve => server.close(resolve))
  for (const profile of profiles) {
    assert.ok(resolve(profile).startsWith(resolve(tmpdir()) + sep + 'agenda-pwa-'))
    await rm(profile, { recursive:true, force:true })
  }
}
