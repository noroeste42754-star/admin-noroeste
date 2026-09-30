import test from 'node:test'
import { agendaLocation, cleanAddress } from '../src/modules/agenda-location.ts'
test('localização limpa HTML, codifica Plus Code e oferece coordenadas sem aceitar esquemas inseguros', () => {
  assert.equal(cleanAddress('Rua B-4 &#x20; Aracaju &amp; Centro'), 'Rua B-4 Aracaju & Centro')
  assert.match(agendaLocation('Endereço', '2V6X+GW2 Aracaju, SE').url, /2V6X%2BGW2/)
  assert.equal(agendaLocation('Endereço', '-10.9, -37.1').geo, '-10.9;-37.1')
  assert.equal(agendaLocation('Endereço', 'javascript:alert(1)').url, '')
  const ics = agendaToIcs([{id:'map',source:'oradores',date:'2026-09-20',title:'Discurso',detail:'Reunião',status:'futuro',location:'Rua B-4 &#x20;',mapLocation:'-10.9, -37.1'}], '2026-09-01T00:00:00Z').replace(/\r\n /g,'')
  assert.match(ics, /LOCATION:Rua B-4/)
  assert.match(ics, /GEO:-10.9;-37.1/)
  assert.match(ics, /URL:https:\/\/www.google.com\/maps/)
})
import assert from 'node:assert/strict'
import { agendaMessage, agendaToIcs, announcementMessage, boardCleaningMessage, boardMeetingDates, boardMeetingEvents, boardMeetingMessage, boardMeetingWhatsappMessage, collectAgendaEvents, collectAnnouncementEvents, eventsInFeedWindow, normalizeAgendaPeople, sanitizeAgendaPeople, upcomingAgendaEvents, validAgendaDate, validAgendaTime } from '../src/modules/individual-domain.ts'

test('ICS inclui fuso e dobra linhas UTF-8 sem perder texto nem identificador', () => {
  const title = 'Reunião com designação e oração '.repeat(12)
  const event = { id:'programacao:parte1', source:'programacao', date:'2026-09-17', time:'19:30', title, detail:'Detalhes', status:'futuro' }
  const first = agendaToIcs([event], '2026-09-16T12:00:00.000Z')
  assert.match(first, /BEGIN:VTIMEZONE\r\nTZID:America\/Fortaleza/)
  assert.match(first, /TZOFFSETTO:-0300/)
  assert.ok(first.split('\r\n').every(line => Buffer.byteLength(line) <= 75))
  assert.ok(first.replace(/\r\n /g, '').includes(`SUMMARY:${title}\r\n`))
  assert.match(first, /DTSTART;TZID=America\/Fortaleza:20260917T193000/)
  const updated = agendaToIcs([{ ...event, title:'Atualizado' }], '2026-09-17T12:00:00.000Z')
  assert.equal(first.match(/UID:[^\r]+/)[0], updated.match(/UID:[^\r]+/)[0])
  const empty = agendaToIcs([], '2026-09-16T12:00:00.000Z')
  assert.doesNotMatch(empty, /\r\n\r\n/)
})

const root = {
  master: { pessoas:{ m1:{ name:'Ana', active:true }, m2:{ name:'Bruno', active:true } } },
  tarefas: {
    people: { task1: { masterId: 'm1' }, task2: { masterId: 'm2' } },
    scale: { periods: { '2026-09': { locked:true, meetings: { a: { date:'2026-09-09', type:'midweek', assignments:{ leitor:'task1', mic1:'task2' } } } } } },
    discursos: { oradores:{ o1:{ pessoaId:'task1' } }, programacao:{ p1:{ data:'2026-09-13', tipo:'saida_orador', oradorId:'o1', temaTitulo:'Esperança', congregacaoDestinoNome:'Centro' } } },
  },
  limpeza: { periodos:{ p:{ publicado:true, semanas:[{ dataMeioSemana:'2026-09-10', dataFimSemana:'2026-09-13', grupo:2, grupoNome:'Grupo 2', membrosMid:['m1'] }] } } },
  escala: { participants:{ e1:{ masterId:'m1' } }, publishedMonths:{ '2026-09':true }, settings:{ locals:{ l1:{ name:'Praça' } } }, tables:{ l1:{ '2026-09':{ rows:{ '2026-09-12':{ slots:{ '08:00':{ p1:'e1', p2:'e2' } } } } } } } },
  programacao: { pessoas:{ m1:{ masterId:'m1' } }, settings:{ meetingTime:'19:30', rooms:[{ id:'main', name:'Salão principal' }] }, programs:{ w:{ meetingDate:'2026-09-16', parts:[{ id:'x', title:'Leitura da Bíblia', assignedPersonId:'m1', confirmedAt:'2026-09-01' }] } } },
  servicoCampo:{ periods:{ '2026-09':{ month:'2026-09', published:true, assignments:{ s1:{ id:'s1', templateId:'t1', date:'2026-09-17', time:'16:00', location:'Salão do Reino', label:'Saída de campo', leaderId:'m1' } } } } },
}

test('cache de identidades remove telefone e grupo de limpeza', () => {
  const people = sanitizeAgendaPeople({ m1:{ name:'Ana', whatsapp:'5585999999999', active:true, sex:'F', role:'publicador', limpeza:{ grupo:3 } } })
  assert.deepEqual(people.m1, { name:'Ana', whatsapp:'', active:true, sex:'F', role:'publicador', limpeza:{ grupo:null } })
})

test('lista de pessoas ausente ou malformada vira coleção vazia', () => {
  assert.deepEqual(normalizeAgendaPeople(undefined), {})
  assert.deepEqual(normalizeAgendaPeople(null), {})
  assert.deepEqual(normalizeAgendaPeople([]), {})
  assert.deepEqual(normalizeAgendaPeople({ semNome:{ active:true }, m1:{ name:'Ana', active:true } }), { m1:{ name:'Ana', active:true } })
})

test('agrega apenas atribuicoes do masterId solicitado', () => {
  const events = collectAgendaEvents(root, 'm1')
  assert.deepEqual(events.map(event => event.source), ['tarefas', 'limpeza', 'escala', 'limpeza', 'servicoCampo'])
  assert.equal(events.some(event => event.title === 'Microfone 1'), false)
  assert.equal(events.find(event => event.source === 'tarefas')?.status, 'futuro')
  assert.equal(events.find(event => event.source === 'escala')?.title, 'Escala TPL')
  assert.match(events.find(event => event.source === 'escala')?.detail ?? '', /Carrinho/)
})

test('respeita permissao por fonte e ignora modulos removidos', () => {
  const copy = structuredClone(root); copy.tarefas.discursos.programacao.p1.observacoes = 'x'.repeat(300)
  const events = collectAgendaEvents(copy, 'm1', { escala:false })
  assert.equal(events.some(event => event.source === 'escala'), false)
  assert.equal(events.some(event => ['oradores', 'programacao'].includes(event.source)), false)
})

test('Serviço de Campo só publica dirigente de mês fechado para o Quadro', () => {
  const draft = structuredClone(root)
  draft.servicoCampo.periods['2026-09'].published = false
  assert.equal(collectAgendaEvents(draft, 'm1').some(event => event.source === 'servicoCampo'), false)
  const events = collectAnnouncementEvents(root, { tarefas:false, limpeza:false, escala:false, oradores:false, programacao:false })
  assert.equal(events.length, 1)
  assert.equal(events[0].people[0], 'Ana')
})

test('ICS preserva data civil, horario, local e escape', () => {
  const event = { id:'a,1', source:'escala', date:'2026-09-12', time:'08:00', title:'Campo, manhã', detail:'Dupla; confirmada', location:'Praça', status:'futuro' }
  const ics = agendaToIcs([event], '2026-09-06T12:00:00.000Z')
  assert.match(ics, /DTSTART;TZID=America\/Fortaleza:20260912T080000/)
  assert.match(ics, /SUMMARY:Campo\\, manhã/)
  assert.match(ics, /DESCRIPTION:Dupla\\; confirmada/)
  assert.match(ics, /DURATION:PT1H/)
  assert.match(ics, /METHOD:PUBLISH/)
})

test('datas e horários impossíveis não entram na agenda nem no ICS', () => {
  assert.equal(validAgendaDate('2026-02-28'), true)
  assert.equal(validAgendaDate('2026-02-31'), false)
  assert.equal(validAgendaTime('23:59'), true)
  assert.equal(validAgendaTime('24:00'), false)
  const invalid = { id:'x', source:'tarefas', date:'2026-02-31', time:'24:00', title:'Inválido', detail:'', status:'futuro' }
  assert.doesNotMatch(agendaToIcs([invalid], '2026-09-01T12:00:00.000Z'), /BEGIN:VEVENT/)
  assert.deepEqual(eventsInFeedWindow([invalid], '2026-09-01'), [])
})

test('ICS aplica no máximo dois lembretes configurados por módulo', () => {
  const event = { id:'lembrete', source:'tarefas', date:'2026-09-12', title:'Leitura', detail:'Reunião', status:'futuro' }
  const ics = agendaToIcs([event], '2026-09-01T12:00:00.000Z', { reminders:{ tarefas:['P7D', 'P1D', 'PT1H'] } })
  assert.equal((ics.match(/BEGIN:VALARM/g) ?? []).length, 2)
  assert.match(ics, /TRIGGER:-P7D/)
  assert.match(ics, /TRIGGER:-P1D/)
  assert.match(ics, /DTEND;VALUE=DATE:20260913/)
})

test('janela da assinatura mantém dois meses anteriores e doze seguintes', () => {
  const event = date => ({ id:date, source:'tarefas', date, title:date, detail:'', status:'futuro' })
  const result = eventsInFeedWindow([event('2026-07-09'), event('2026-07-10'), event('2027-09-10'), event('2027-09-11')], '2026-09-10')
  assert.deepEqual(result.map(item => item.date), ['2026-07-10', '2027-09-10'])
})

test('agenda ignora tarefas e escala ainda não publicadas', () => {
  const copy = structuredClone(root)
  copy.tarefas.scale.periods['2026-09'].locked = false
  copy.escala.publishedMonths['2026-09'] = false
  const events = collectAgendaEvents(copy, 'm1')
  assert.equal(events.some(event => event.source === 'tarefas'), false)
  assert.equal(events.some(event => event.source === 'escala'), false)
})

test('proximos compromissos ignora realizados e eventos anteriores', () => {
  const events = [
    { id:'past', source:'tarefas', date:'2026-09-01', title:'Passado', detail:'', status:'futuro' },
    { id:'done', source:'tarefas', date:'2026-09-10', title:'Realizado', detail:'', status:'realizado' },
    { id:'waiting', source:'tarefas', date:'2026-09-10', title:'Confirmar', detail:'', status:'confirmacao-pendente' },
    { id:'changed', source:'tarefas', date:'2026-10-01', title:'Alterado', detail:'', status:'alterado' },
  ]
  assert.deepEqual(upcomingAgendaEvents(events, '2026-09-10').map(event => event.id), ['waiting', 'changed'])
})

test('mensagem cronologica usa somente os eventos recebidos', () => {
  const events = collectAgendaEvents(root, 'm1').slice(0, 2)
  const message = agendaMessage(events)
  assert.match(message, /09\/09\/2026/)
  assert.doesNotMatch(message, /Microfone/)
})

test('sem vinculo canonico nao retorna dados por nome', () => {
  assert.deepEqual(collectAgendaEvents(root, ''), [])
  assert.deepEqual(collectAgendaEvents(root, 'nome parecido'), [])
})

test('quadro de anúncios agrupa designações por pessoa e por origem', () => {
  const announcements = collectAnnouncementEvents(root)
  assert.equal(announcements.some(item => item.source === 'programacao'), false)
  assert.equal(announcements.some(item => item.source === 'tarefas' && item.people.includes('Ana')), true)
  assert.equal(announcements.some(item => item.source === 'tarefas' && item.people.includes('Bruno')), true)
})

test('reuniao de hoje permanece no texto ate o fim do dia civil', () => {
  const data = structuredClone(root)
  data.tarefas.scale.periods['2026-09'].meetings.a.date = '2026-09-15'
  data.limpeza.periodos.p.semanas[0].dataMeioSemana = '2026-09-15'
  const events = collectAnnouncementEvents(data)
  const today = boardMeetingDates(events, '2026-09-15').find(item => item.date === '2026-09-15')
  assert.ok(today)
  const message = boardMeetingMessage(boardMeetingEvents(events, today), today)
  assert.match(message, /^TAREFAS/m)
  assert.match(message, /^LIMPEZA/m)
  assert.equal(boardMeetingDates(events, '2026-09-16').some(item => item.date === '2026-09-15'), false)
})

test('calendario pessoal exporta os quatro modulos incluindo as duas limpezas', () => {
  const events = collectAgendaEvents(root, 'm1')
  assert.deepEqual([...new Set(events.map(event => event.source))].sort(), ['escala', 'limpeza', 'servicoCampo', 'tarefas'])
  const ics = agendaToIcs(events, '2026-09-15T23:59:00-03:00')
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, events.length)
  assert.equal((ics.match(/SUMMARY:Limpeza/g) || []).length, 2)
  assert.match(ics, /SUMMARY:Leitor/)
})

test('dados das reuniões selecionam datas futuras e módulos conforme o tipo', () => {
  const events = [...collectAnnouncementEvents(root),
    { id:'tarefas:weekend', source:'tarefas', date:'2026-09-13', title:'Presidente', detail:'Reunião do fim de semana', status:'futuro', people:['Ana'] },
    { id:'tarefas:midweek', source:'tarefas', date:'2026-09-16', title:'Microfone 1', detail:'Reunião do meio de semana', status:'futuro', people:['Bruno'] },
    { id:'limpeza:midweek', source:'limpeza', date:'2026-09-16', title:'Limpeza - Grupo 1', detail:'Limpeza após a reunião do meio de semana', status:'futuro', people:['Ana'] },
  ]
  const dates = boardMeetingDates(events, '2026-09-10')
  assert.deepEqual(dates.map(item => [item.date, item.kind]), [
    ['2026-09-10', 'midweek'],
    ['2026-09-13', 'weekend'],
    ['2026-09-16', 'midweek'],
  ])
  const weekend = boardMeetingEvents(events, dates[1])
  assert.equal(weekend.some(item => item.source === 'oradores'), false)
  assert.equal(weekend.some(item => item.source === 'tarefas'), true)
  assert.equal(weekend.some(item => item.source === 'limpeza'), true)
  assert.equal(weekend.some(item => item.source === 'programacao'), false)
  const midweek = boardMeetingEvents(events, dates[2])
  assert.equal(midweek.some(item => item.source === 'programacao'), false)
  assert.equal(midweek.some(item => item.source === 'tarefas'), true)
  assert.equal(midweek.some(item => item.source === 'limpeza'), true)
  assert.equal(midweek.some(item => item.source === 'oradores'), false)
  const weekendMessage = boardMeetingMessage(weekend, dates[1])
  assert.match(weekendMessage, /^ORADORES/m)
  assert.match(weekendMessage, /^TAREFAS/m)
  assert.match(weekendMessage, /^LIMPEZA/m)
  assert.match(boardCleaningMessage(weekend), /^Limpeza: Grupo /m)
  assert.doesNotMatch(boardCleaningMessage(weekend), /Limpeza semanal do Salão do Reino|Ana|Bruno/)
  assert.doesNotMatch(boardMeetingWhatsappMessage(weekend, dates[1]), /LIMPEZA/)
  const midweekMessage = boardMeetingMessage(midweek, dates[2])
  assert.match(midweekMessage, /^TAREFAS/m)
  assert.doesNotMatch(midweekMessage, /^VIDA E MINISTÉRIO/m)
})

test('Oradores integra as duas seções confirmadas por vínculo e inclui visitantes no quadro', () => {
  const data = { master:{ pessoas:{ m1:{ name:'Ana', active:true }, m2:{ name:'Bruno', active:true } } }, tarefas:{ people:{ p1:{ masterId:'m1' }, p2:{ masterId:'m2' } }, discursos:{ oradores:{ o1:{ nome:'Ana', pessoaId:'p1', secao:'s2' }, o2:{ nome:'Bruno', pessoaId:'p2', secao:'s1' }, v1:{ nome:'Visitante' } }, temas:{ t1:{ titulo:'Tema público' } }, programacao:{
    local:{ data:'2026-09-20', tipo:'discurso_local', status:'confirmado', oradorId:'o1', temaId:'t1', observacoes:'SEGREDO' },
    visita:{ secao:'s2', data:'2026-09-27', tipo:'discurso_visitante', status:'confirmado', oradorId:'v1' },
    saida:{ secao:'s2', data:'2026-09-20', tipo:'saida_orador', status:'confirmado', oradorSecundarioId:'o1', congregacaoDestinoNome:'Destino' },
    primeira:{ secao:'s1', data:'2026-09-20', status:'confirmado', oradorId:'o2' },
    rascunho:{ secao:'s2', data:'2026-09-20', status:'por_confirmar', oradorId:'o1' },
  } } } }
  const personal = collectAgendaEvents(data, 'm1')
  assert.equal(personal.length, 2)
  assert.equal(collectAgendaEvents(data, 'm2').length, 1)
  assert.equal(personal.find(item => item.title === 'Saída de orador').location, 'Destino')
  assert.deepEqual(collectAgendaEvents(data, 'm1', { oradores:false }), [])
  assert.deepEqual(collectAgendaEvents(data, 'Ana'), [])
  const board = collectAnnouncementEvents(data)
  assert.ok(board.some(item => item.people.includes('Visitante')))
  const selected = { date:'2026-09-20', kind:'weekend' }
  const meeting = boardMeetingEvents(board, selected)
  assert.equal(meeting.length, 2)
  assert.match(boardMeetingMessage(meeting, selected), /Ana/)
  assert.match(boardMeetingMessage(meeting, selected), /Tema público/)
  assert.doesNotMatch(JSON.stringify(board), /SEGREDO|rascunho/)
  assert.match(boardMeetingMessage(meeting, selected), /Bruno/)
  assert.match(agendaToIcs(personal, '2026-09-01T00:00:00Z'), /oradores:local/)
})

test('texto da limpeza mostra apenas o grupo e preserva participantes nos dados', () => {
  const event = { id:'limpeza:grupo', source:'limpeza', date:'2026-09-16', title:'Limpeza - Grupo 1', detail:'Limpeza após a reunião do meio de semana', status:'futuro', people:['Ana', 'Bruno'] }
  assert.equal(boardCleaningMessage([event]), 'Limpeza: Grupo 1')
  const message = boardMeetingMessage([event], { date:event.date, kind:'midweek' })
  assert.match(message, /Limpeza: Grupo 1/)
  assert.doesNotMatch(message, /Ana|Bruno|Limpeza após/)
  assert.deepEqual(event.people, ['Ana', 'Bruno'])
})

test('compartilhamento do quadro usa somente dados públicos', () => {
  const events = collectAnnouncementEvents(root)
  events[0].note = 'Observação administrativa sigilosa'
  const message = announcementMessage(events)
  assert.match(message, /Quadro de anúncios Noroeste/)
  assert.match(message, /Ana/)
  assert.doesNotMatch(message, /Observação administrativa/)
})
