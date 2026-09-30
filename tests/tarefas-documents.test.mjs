import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib/cjs/index.js'
import { createTaskSchedulePdf, taskPrintHtml } from '../src/modules/tarefas-documents.ts'
import { TASK_ROLES } from '../src/modules/tarefas-domain.ts'

test('impressão identifica as duas seções e não apresenta reunião única como segunda seção', () => {
  for (const [type, label] of [['weekend_s1', '1ª seção'], ['weekend', '2ª seção'], ['weekend_merged', 'Reunião única']]) {
    const html = taskPrintHtml([{ date:'2026-09-26', type, assignments:{} }], 'Noroeste', {})
    assert.ok(html.includes(`Fim de semana · ${label}</h2>`))
    if (type === 'weekend_merged') assert.equal(html.includes('2ª seção'), false)
  }
})

test('mes com cinco reunioes de cada tipo cabe em uma folha com nomes completos', async () => {
  const people = { p:{ name:'Joao da Silva Santos' } }
  const meetings = Array.from({ length:10 }, (_, index) => ({ date:`2026-10-${String(index + 1).padStart(2, '0')}`, type:index % 2 ? 'weekend' : 'midweek', assignments:Object.fromEntries(TASK_ROLES.map(role => [role, 'p'])) }))
  const result = await createTaskSchedulePdf(meetings, 'Noroeste', people, 14)
  assert.equal(result.pages, 1)
  const longNames=await createTaskSchedulePdf(meetings, 'Noroeste', { p:{ name:'Nome muito extenso '.repeat(20) } }, 14)
  assert.ok(longNames.pages>1)
})

test('bimestre com 19 reunioes permanece em uma folha e nao modifica designacoes', async () => {
  const people = { p:{ name:'Pessoa de Nome Completo Para Conferencia' } }
  const meetings = Array.from({ length:19 }, (_, index) => ({
    date:`2026-${index < 10 ? '09' : '10'}-${String(index % 10 + 1).padStart(2, '0')}`,
    type:index % 2 ? 'weekend' : 'midweek',
    assignments:Object.fromEntries(TASK_ROLES.map(role => [role, 'p'])),
  }))
  const original = structuredClone(meetings)
  const result = await createTaskSchedulePdf(meetings, 'Noroeste', people, 14)
  assert.equal(result.pages, 1)
  assert.ok(result.effectiveFontSize >= 6)
  assert.deepEqual(meetings, original)
})

test('Tarefas gera PDF real em A4 retrato com linhas de escala', async () => {
  const meetings = [{ date:'2026-09-12', type:'weekend', assignments:{ presidente:'p1', operador1:'p2', operador2:'p3', leitor:'p4', entrada:'p5', auditorio:'p6', mic1:'p7', mic2:'p8' } }]
  const people = Object.fromEntries(Array.from({ length:8 }, (_, index) => [`p${index + 1}`, { name:`Pessoa ${index + 1}` }]))
  const result = await createTaskSchedulePdf(meetings, 'Noroeste', people, 14)
  assert.equal(Buffer.from(result.bytes).subarray(0, 4).toString(), '%PDF')
  assert.equal(result.pages, 1)
  assert.ok(result.effectiveFontSize >= 7)
  const pdf = await PDFDocument.load(result.bytes)
  const { width, height } = pdf.getPage(0).getSize()
  assert.ok(Math.abs(width - 595.28) < 0.1)
  assert.ok(Math.abs(height - 841.89) < 0.1)
  assert.ok(height > width)
})
