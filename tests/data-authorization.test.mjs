import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessData, canMutateData, containsPrivateRoot, normalizeDataPath, withoutPrivateRoots } from '../netlify/lib/data-authorization.ts'

const apps = overrides => ({ mestre:false, tarefas:false, limpeza:false, oradores:false, escala:false, programacao:false, secretario:false, servicoCampo:false, individual:false, ...overrides })

test('sessão comum acessa somente os módulos autorizados', () => {
  assert.equal(canAccessData('tarefas/scale', apps({ tarefas:true }), true), true)
  assert.equal(canAccessData('secretario/relatorios', apps({ tarefas:true }), false), false)
  assert.equal(canAccessData('usuarios', apps({ tarefas:true }), false), false)
  assert.equal(canAccessData('master/pessoas', apps({ tarefas:true }), false), true)
  assert.equal(canAccessData('master/pessoas', apps({ tarefas:true }), true), false)
})

test('Limpeza nao consulta o modulo retirado', () => {
  const cleaning = apps({ limpeza:true })
  assert.equal(canAccessData('secretario/grupos', cleaning, false), false)
  assert.equal(canAccessData('secretario/publicadores', cleaning, false), false)
  assert.equal(canAccessData('secretario/relatorios', cleaning, false), false)
  assert.equal(canAccessData('tarefas/planning', cleaning, false), false)
  assert.equal(canAccessData('master/pessoas', cleaning, false), false)
})

test('cada módulo altera somente as próprias mensagens da Agenda', () => {
  const tasks = apps({ tarefas:true })
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/tarefas', tasks, true), true)
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/limpeza', tasks, true), false)
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/oradores', apps({ oradores:true }), true), true)
  assert.equal(canAccessData('agenda/config/icsReminders/tarefas', tasks, true), false)
})

test('responsáveis de TPL e Tarefas podem salvar as preferências do próprio motor', () => {
  assert.equal(canAccessData('escala/settings/engineRules', apps({ escala:true }), true), true)
  assert.equal(canAccessData('tarefas/planning/engineRules', apps({ tarefas:true }), true), true)
  assert.equal(canAccessData('escala/settings/engineRules', apps({ tarefas:true }), true), false)
  assert.equal(canAccessData('tarefas/planning/engineRules', apps({ escala:true }), true), false)
})

test('Oradores altera discursos e eventos gerais e consulta os cadastros necessários', () => {
  const speakers = apps({ oradores:true })
  assert.equal(canAccessData('tarefas/discursos', speakers, true), true)
  assert.equal(canAccessData('tarefas/events', speakers, true), true)
  assert.equal(canAccessData('tarefas/events', speakers, false), true)
  assert.equal(canAccessData('tarefas/planning', speakers, false), true)
  assert.equal(canAccessData('tarefas/people', speakers, false), true)
  assert.equal(canAccessData('tarefas/scale/periods', speakers, false), true)
  assert.equal(canAccessData('tarefas/scale/periods', speakers, true), false)
  assert.equal(canAccessData('tarefas/scale', speakers, false), false)
  assert.equal(canAccessData('tarefas/planning/oradoresPublicacoes', speakers, true), false)
  assert.equal(canAccessData('tarefas/planning/engineRules', speakers, true), false)
  assert.equal(canAccessData('tarefas/discursos', apps({ tarefas:true }), false), true)
  assert.equal(canAccessData('tarefas/discursos', apps({ tarefas:true }), true), false)
  assert.equal(canMutateData('tarefas', 'PATCH', { 'discursos/oradores/o1':{} }, apps({ tarefas:true })), false)
  assert.equal(canMutateData('tarefas', 'PATCH', { 'discursos/oradores/o1':{} }, speakers), true)
  assert.equal(canMutateData('tarefas', 'PATCH', { 'scale/periods/2026-09':{} }, speakers), false)
})

test('publicação de PDF respeita o módulo da sessão', () => {
  assert.equal(canAccessData('agenda/documentos', apps({ oradores:true }), true), true)
  assert.equal(canAccessData('agenda/documentos', apps({ individual:true }), true), false)
  const tarefas = apps({ tarefas:true })
  const own = { modulo:'tarefas', tipo:'modulo', storagePath:'agenda/documentos/modulos/tarefas/2026-09.pdf' }
  const other = { modulo:'oradores', tipo:'modulo', storagePath:'agenda/documentos/modulos/oradores/2026-09.pdf' }
  assert.equal(canMutateData('agenda/documentos', 'PATCH', { 'modulo-tarefas-2026-09':own }, tarefas), true)
  assert.equal(canMutateData('agenda/documentos', 'PATCH', { 'modulo-oradores-2026-09':other }, tarefas), false)
  assert.equal(canMutateData('agenda/documentos', 'PATCH', { 'modulo-oradores-2026-09':other }, apps({ oradores:true })), true)
  assert.equal(canMutateData('agenda/documentos', 'DELETE', undefined, tarefas), false)
  assert.equal(canMutateData('agenda/documentos/modulo-oradores-2026-09', 'PUT', own, tarefas), false)
})

test('raízes privadas são removidas do backup e nunca aceitas na restauração', () => {
  const value = { master:{}, agendaAssinaturasPrivadas:{ token:{} }, appSessoesPrivadas:{ session:{} } }
  assert.deepEqual(withoutPrivateRoots(value), { master:{} })
  assert.equal(containsPrivateRoot(value), true)
  assert.equal(normalizeDataPath('../usuarios'), null)
  assert.equal(normalizeDataPath('tarefas/__proto__/polluted'), null)
  assert.equal(canAccessData('agendaPareamentosPrivados', apps({mestre:true}), false), false)
  assert.equal(containsPrivateRoot({agendaPareamentosPrivados:{}}), true)
})
