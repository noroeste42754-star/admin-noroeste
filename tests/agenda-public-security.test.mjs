import test from 'node:test'
import assert from 'node:assert/strict'
import { publicAgendaConfig, publicAgendaDocuments, publicAgendaEvent } from '../netlify/lib/agenda-public.ts'

test('payload público da Agenda remove caminhos internos e URLs inseguras', () => {
  const documents = publicAgendaDocuments({
    ok:{ id:'ok', modulo:'tarefas', tipo:'modulo', periodo:'2026-09', nome:'Tarefas.pdf', url:'https://example.test/tarefas.pdf', storagePath:'agenda/privado.pdf', criadoEm:'2026-09-13T00:00:00Z' },
    speakers:{ id:'speakers', modulo:'oradores', tipo:'modulo', periodo:'2026-09', nome:'Oradores.pdf', url:'https://example.test/oradores.pdf', criadoEm:'2026-09-13T00:00:00Z' },
    legacyAdmin:{ id:'legacyAdmin', modulo:'admin', tipo:'admin', periodo:'2026-09', nome:'Antigo.pdf', url:'https://example.test/antigo.pdf', criadoEm:'2026-09-13T00:00:00Z' },
    bad:{ id:'bad', modulo:'tarefas', periodo:'2026-09', nome:'Ruim.pdf', url:'javascript:alert(1)', criadoEm:'2026-09-13T00:00:00Z' },
  })
  assert.equal(documents.ok.storagePath, undefined)
  assert.equal(documents.speakers.modulo, 'oradores')
  assert.equal(documents.bad, undefined)
  assert.equal(documents.legacyAdmin, undefined)
  assert.deepEqual(publicAgendaConfig({ quadroWhatsAppLink:'javascript:alert(1)', outrosAnunciosDriveUrl:'https://drive.google.com/drive/folders/pasta', moduleWhatsApp:{ tarefas:{ groupLink:'https://chat.whatsapp.com/example', meetingText:'Olá' }, oradores:{ documentText:'Oradores publicados' } } }), { outrosAnunciosDriveUrl:'https://drive.google.com/drive/folders/pasta', moduleWhatsApp:{ tarefas:{ groupLink:'https://chat.whatsapp.com/example', meetingText:'Olá' }, oradores:{ documentText:'Oradores publicados' } } })
})

test('evento publico ignora fontes retiradas e preserva fontes ativas', () => {
  const base = { id:'evento', date:'2026-09-20', title:'Designação', detail:'Reunião', status:'futuro', note:'Observação interna' }
  assert.equal(publicAgendaEvent({ ...base, source:'oradores' })?.source, 'oradores')
  assert.equal(publicAgendaEvent({ ...base, source:'oradores' })?.note, undefined)
  assert.equal(publicAgendaEvent({ ...base, source:'programacao' }), null)
  assert.equal(publicAgendaEvent({ ...base, source:'tarefas' })?.source, 'tarefas')
})
