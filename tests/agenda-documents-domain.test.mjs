import test from 'node:test'
import assert from 'node:assert/strict'
import { documentCoversMonth, groupPublicDocuments, officialDocumentId, publicDocumentMonths } from '../src/modules/agenda-documents-domain.ts'

const doc = (overrides = {}) => ({ id:'x', modulo:'tarefas', tipo:'modulo', periodo:'2026-09', inicio:'2026-09-01', fim:'2026-09-30', origemPeriodoId:'2026-09', nome:'arquivo.pdf', url:'https://example.test/a.pdf', criadoEm:'2026-09-01T10:00:00.000Z', ...overrides })

test('documento bimestral fica disponível nos dois meses cobertos', () => {
  const item = doc({ periodo:'Setembro e Outubro de 2026', inicio:'2026-09-01', fim:'2026-10-31' })
  assert.equal(documentCoversMonth(item, '2026-09'), true)
  assert.equal(documentCoversMonth(item, '2026-10'), true)
  assert.equal(documentCoversMonth(item, '2026-11'), false)
  assert.deepEqual(publicDocumentMonths([item], Date.parse('2026-09-24T00:00:00Z')), ['2026-10', '2026-09'])
})

test('seleção mantém apenas a versão oficial mais recente de cada módulo e ignora documentos legados do Admin', () => {
  const grouped = groupPublicDocuments([
    doc({ id:'old', criadoEm:'2026-09-01T10:00:00.000Z' }),
    doc({ id:'new', criadoEm:'2026-09-02T10:00:00.000Z' }),
    doc({ id:'speakers', modulo:'oradores' }),
    doc({ id:'manual', modulo:'admin', tipo:'admin', nome:'comunicado.pdf' }),
    doc({ id:'secretary', modulo:'programacao' }),
  ], '2026-09', Date.parse('2026-09-24T00:00:00Z'))
  assert.equal(grouped.modules.tarefas?.id, 'new')
  assert.equal(grouped.modules.oradores?.id, 'speakers')
  assert.equal(Object.hasOwn(grouped.modules, 'programacao'), false)
  assert.equal(Object.values(grouped.modules).some(item => item?.id === 'manual'), false)
})

test('id oficial é estável para republicação do mesmo período', () => {
  assert.equal(officialDocumentId('servicoCampo', '2026-09'), 'modulo-servicoCampo-2026-09')
  assert.equal(officialDocumentId('tarefas', '2026/09 bimestre'), officialDocumentId('tarefas', '2026/09 bimestre'))
})

test('PDF publicado expira para o Quadro após 60 dias', () => {
  const published = doc({ criadoEm:'2026-09-01T10:00:00.000Z' })
  assert.equal(groupPublicDocuments([published], '2026-09', Date.parse('2026-10-31T09:59:59Z')).modules.tarefas?.id, 'x')
  assert.equal(groupPublicDocuments([published], '2026-09', Date.parse('2026-10-31T10:00:00Z')).modules.tarefas, undefined)
  assert.deepEqual(publicDocumentMonths([published], Date.parse('2026-10-31T10:00:00Z')), [])
})
