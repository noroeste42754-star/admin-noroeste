import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || new URL('../package.json', import.meta.url))
const { chromium } = require('playwright')
const browser = await chromium.launch({ channel:'msedge', headless:true })
await mkdir('tmp/layout', { recursive:true })
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/.netlify/functions/**', route => {
      const url = new URL(route.request().url())
      const endpoint = url.pathname.split('/').pop()
      if (endpoint === 'auth-session') return route.fulfill({ json:{ uid:'audit', csrf:'a'.repeat(48), usuario:{ nome:'Teste', ativo:true, apps:{ mestre:true } } } })
      if (endpoint === 'auth-users') return route.fulfill({ json:{} })
      const paths = JSON.parse(url.searchParams.get('paths') || '[]')
      return route.fulfill({ json:{ results:paths.map(path => ({ value:path === 'master/pessoas' ? { m1:{ name:'Pessoa de teste', active:true, sex:'M', role:'publicador', limpeza:{ grupo:1 } } } : {} })) } })
    })
    await page.goto(process.env.APP_TEST_URL || 'http://127.0.0.1:5190/')
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const module of ['limpeza', 'servicoCampo', 'tarefas', 'escala', 'mestre', 'individual']) {
        await page.locator(`[data-menu-card="${module}"]`).click()
        if (module === 'limpeza') await page.locator('#btnGerarEscalaLimpeza').waitFor({ state:'attached' })
        if (module === 'individual') await page.getByRole('heading', { name:'Próximas designações' }).waitFor()
        if (module === 'servicoCampo') {
          await page.locator('[data-workspace-tab="configuracao"]').click()
          await page.locator('#serviceTemplateForm').waitFor({ state:'attached' })
          await page.locator('#btnBack').click()
          await page.locator('#serviceMonth').waitFor({ state:'attached' })
        }
        if (module === 'tarefas' || module === 'escala' || module === 'mestre') {
          await page.locator('.workspace-tabs [data-workspace-tab="'+(module === 'mestre' ? 'usuarios' : 'participantes')+'"]').click()
          await page.waitForFunction(() => !document.querySelector('#appContent')?.textContent?.includes('Carregando dados'))
          if (!repeat) {
            const tabs = module === 'mestre' ? ['config','vinculos','dados'] : module === 'escala' ? ['disponibilidade','mensagens','config','locais','escalaAtual','pendencias'] : ['pendencias','config']
            for (const tab of tabs) {
              await page.locator(`[data-workspace-tab="${tab}"]`).first().click()
              await page.waitForFunction(() => !document.querySelector('#appContent')?.textContent?.includes('Carregando dados'))
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${module}/${tab}: no overflow`)
              await page.screenshot({ path:`tmp/layout/${module}-${tab}-${width}.png`, fullPage:true, animations:'disabled' })
            }
          }
          await page.locator('#btnBack').click()
          await page.waitForFunction(() => {
            const nav = document.querySelector('[data-workspace-home]')
            return nav && nav.dataset.workspaceActive === nav.dataset.workspaceHome
          })
        }
        await page.waitForFunction(() => !document.querySelector('#appContent')?.textContent?.includes('Carregando dados'))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${module}: no horizontal page overflow`)
        if (!repeat) await page.screenshot({ path:`tmp/layout/${module}-${width}.png`, fullPage:true, animations:'disabled' })
        await page.locator('#btnBack').click()
        await page.locator('[data-menu-card="mestre"]').waitFor({ timeout:5000 })
        assert.equal(await page.locator('#btnBack').isVisible(), false)
        assert.equal(await page.locator('#btnSair').isVisible(), true)
      }
    }
    assert.deepEqual(errors, [])
    console.log(`Back navigation passed: ${width}px, all six modules, two cycles without reload`)
    await page.close()
  }
} finally { await browser.close() }
