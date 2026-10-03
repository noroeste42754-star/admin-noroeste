import test from 'node:test'
import { readFile, access } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { canAccessData, canMutateData, withoutPrivateRoots } from '../netlify/lib/data-authorization.ts'
import { activeData, preserveArchivedTasks } from '../netlify/lib/retired-data.ts'
import { loadAgendaRoot } from '../netlify/lib/agenda-root.ts'
import { parseAgendaUiPreferences } from '../src/modules/individual-preferences.ts'

test('redirecionamentos dos módulos retirados vêm antes do fallback da SPA',async()=>{
  const rules=(await readFile(new URL('../public/_redirects',import.meta.url),'utf8')).trim().split(/\r?\n/).filter(line=>line&&!line.startsWith('#'))
  const fallback=rules.indexOf('/* /index.html 200')
  assert.ok(fallback>=0)
  for(const module of ['limpeza','servicoCampo'])for(const suffix of ['','/*']){
    const index=rules.indexOf('/modulos/'+module+suffix+' /quadro/ 301!')
    assert.ok(index>=0&&index<fallback,module+suffix)
  }
})

test('raízes legadas continuam retiradas, mas tarefas/discursos voltou a ser ativo', () => {
  const apps = { mestre:true }
  for (const path of ['programacao', 'secretario/relatorios', 'oradores', 'limpeza', 'servicoCampo']) {
    assert.equal(canAccessData(path, apps, false), false)
    assert.equal(canAccessData(path, apps, true), false)
    assert.equal(canMutateData('', 'PATCH', { [path]:null }, apps), false)
  }
  assert.equal(canAccessData('tarefas/discursos/oradores', apps, false), true)
  assert.equal(canAccessData('tarefas/discursos/oradores', apps, true), true)
  assert.equal(canMutateData('tarefas', 'DELETE', null, apps), false)
})

test('leituras da Agenda nao consultam mais os modulos retirados', async () => {
  const calls = []
  await loadAgendaRoot(async path => { calls.push(path); return null })
  assert.equal(calls.some(path => /limpeza|servicoCampo/.test(path)), false)
  assert.ok(calls.includes('tarefas/scale/periods'))
  assert.ok(calls.includes('tarefas/discursos'))
  assert.equal(calls.some(path => /secretario|programacao/.test(path)), false)
})

test('backup operacional inclui discursos ativos e omite raízes aposentadas', () => {
  const source = { master:{ pessoas:{} }, tarefas:{ people:{ p:{} }, discursos:{ historico:true } }, secretario:{ relatorios:{} }, programacao:{}, oradores:{} }
  const before = structuredClone(source)
  assert.deepEqual(withoutPrivateRoots(source), { master:{ pessoas:{} }, tarefas:{ people:{ p:{} }, discursos:{ historico:true } } })
  assert.deepEqual(source, before)
  assert.deepEqual(activeData('tarefas', source.tarefas), { people:{ p:{} }, discursos:{ historico:true } })
})

test('restauracao de Tarefas usa o conteúdo ativo do backup', () => {
  const archived = { historico:{ registro:'preservar' } }
  assert.deepEqual(preserveArchivedTasks({ people:{ antigo:{} }, discursos:archived }, { people:{ novo:{} }, discursos:{ novo:true } }), { people:{ novo:{} }, discursos:{ novo:true } })
  assert.equal(preserveArchivedTasks({ discursos:archived }, null), null)
})

test('preferencias antigas de Relatorio e fontes removidas migram para telas ativas', () => {
  const prefs = parseAgendaUiPreferences(JSON.stringify({ screen:'relatorio', personal:{ source:'oradores' }, board:{ subscriptionModules:['programacao', 'limpeza'] } }), '2026-09')
  assert.equal(prefs.screen, 'agenda')
  assert.equal('source' in prefs.personal, false)
  assert.equal(prefs.board.subscriptionModules, undefined)
  assert.equal('report' in prefs, false)
})

test('rota de Oradores existe e módulos legados continuam ausentes', async () => {
  const router = await readFile(new URL('../src/router.ts', import.meta.url), 'utf8')
  assert.equal(router.includes("import('./modules/oradores')"), true)
  await access(new URL('../src/modules/oradores.ts', import.meta.url))
  await access(new URL('../src/modules/oradores-domain.ts', import.meta.url))
  await access(new URL('../src/modules/oradores-documents.ts', import.meta.url))
  for (const module of ['programacao', 'secretario']) {
    assert.equal(router.includes(`import('./modules/${module}`), false)
    for (const suffix of ['', '-domain', '-documents']) {
      await assert.rejects(access(new URL(`../src/modules/${module}${suffix}.ts`, import.meta.url)))
    }
  }
  for (const module of ['individual', 'limpeza', 'servico-campo']) {
    await assert.rejects(access(new URL(`../src/modules/${module}.ts`, import.meta.url)))
  }
  await assert.rejects(access(new URL('../src/agenda-main.ts', import.meta.url)))
  const legacyAgenda=await readFile(new URL('../agenda/index.html',import.meta.url),'utf8')
  assert.match(legacyAgenda,/\/src\/quadro-main\.ts/)
  await assert.rejects(access(new URL('../netlify/functions/secretary-report.ts', import.meta.url)))
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  for (const dependency of ['docx', 'jszip']) assert.equal(dependency in packageJson.dependencies, false)
  assert.equal('exceljs' in packageJson.dependencies, true, 'XLSX é exportação ativa e carregada somente quando solicitada')
})
