import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TASK_ROLES,
  canShareMeeting,
  computeGeneration,
  eligibility,
  eventBlocksMeeting,
  isFolga,
  roleApplies,
  withCanonicalPeriod,
  canonicalMeetingType,
  normalizeTaskGroupTargets,
  summarizeTaskGroups,
  taskGroupForPerson,
} from '../src/modules/tarefas-domain.ts'
import {
  paginateItems,
  rowsPerPrintPage,
} from '../src/modules/tarefas-output.ts'

const basePerson = (overrides = {}) => ({
  name: 'Pessoa', active: true, rule: 'both', jovem: false,
  roles: { presidente: true, operador: true, leitor: true, entrada: true, auditorio: true, microfone: true },
  ...overrides,
})

const baseContext = (people, meeting = { date: '2026-09-12', type: 'weekend', assignments: {} }) => ({
  people,
  periods: { '2026-09': { meetings: { m1: meeting } } },
  events: {},
})

test('Oradores bloqueia entrada por vínculo, segundo orador e identidade central, com opção de desligar', () => {
  const context=baseContext({ p1:basePerson({masterId:'m1'}), p2:basePerson() })
  const meeting=context.periods['2026-09'].meetings.m1
  context.discursos={oradores:{o1:{pessoaId:'m1'},o2:{pessoaId:'p2'}},programacao:{d1:{data:meeting.date,secao:'s2',oradorId:'o1',oradorSecundarioId:'o2',tipo:'saida_orador'}}}
  for(const id of ['p1','p2']) assert.equal(eligibility(id,'entrada',meeting,{},context).reason,'Discurso na mesma data')
  assert.equal(eligibility('p1','entrada',{...meeting,date:'2026-09-13'},{},context).eligible,true)
  context.engineRules={evitarConflitosOradores:false}
  assert.equal(eligibility('p1','entrada',meeting,{},context).eligible,true)
  context.engineRules={evitarConflitosOradores:true}
  delete context.discursos.programacao.d1.secao
  assert.equal(eligibility('p1','entrada',meeting,{},context).reason,'Discurso na mesma data')
  context.discursos.programacao.d1.secao='s1'
  assert.equal(eligibility('p1','entrada',meeting,{},context).reason,'Pessoa designada na outra sessão neste dia')
})

test('geração exclui orador S2 e respeita checkbox desativado', () => {
  const context=baseContext({p1:basePerson()})
  context.discursos={oradores:{o1:{pessoaId:'p1'}},programacao:{d1:{data:'2026-09-12',secao:'s2',oradorId:'o1'}}}
  const run=enabled=>computeGeneration(context,'2026-09-01','entrada','2026-09-01T00:00:00Z','2026-09',false,'',{evitarConflitosOradores:enabled})
  const blocked=run(true),allowed=run(false)
  assert.equal(blocked.aborted,false)
  assert.equal(blocked.patch['2026-09/meetings/m1/assignments/entrada'],null)
  assert.equal(allowed.aborted,false)
  assert.ok(!Object.values(blocked.patch).includes('p1'))
  assert.ok(Object.values(allowed.patch).includes('p1'))
})

test('uma pessoa gera escala parcial sem exigir todas as funções', () => {
  const context=baseContext({p1:basePerson()})
  const result=computeGeneration(context,'2026-09-01',null,'2026-09-01T12:00:00Z','2026-09')
  assert.equal(result.aborted,false)
  assert.ok(result.generated>=1)
  assert.equal(result.patch['2026-09/generatedAt'],'2026-09-01T12:00:00Z')
  assert.ok(TASK_ROLES.some(role=>result.patch[`2026-09/meetings/m1/assignments/${role}`]===null))
})

test('meio de semana não aplica Presidente nem Leitor', () => {
  const context = baseContext({ p1: basePerson() })
  const meeting = { date: '2026-09-09', type: 'midweek' }
  assert.equal(eligibility('p1', 'presidente', meeting, {}, context).eligible, false)
  assert.equal(eligibility('p1', 'leitor', meeting, {}, context).eligible, false)
  assert.equal(eligibility('p1', 'mic1', meeting, {}, context).eligible, true)
})

test('registro especial continua uma única reunião de fim de semana sem Leitor', () => {
  const meeting = { date: '2026-09-12', type: 'weekend_merged' }
  assert.equal(roleApplies('presidente', meeting), true)
  assert.equal(roleApplies('leitor', meeting), false)
  const context=baseContext({p1:basePerson({weekendSection:'s1'}),p2:basePerson({weekendSection:'s2'})},meeting)
  assert.equal(eligibility('p1','entrada',meeting,{},context).eligible,true)
  assert.equal(eligibility('p2','entrada',meeting,{},context).eligible,true)
  const canonical=withCanonicalPeriod(context.periods,{periodMode:'month',enableSection1:true,meetingDays:{midweekDow:3,weekendDow:6,weekendS1Dow:6}},meeting.date)
  const sameDay=Object.values(canonical.periods['2026-09'].meetings).filter(item=>item.date===meeting.date)
  assert.equal(sameDay.length,1)
  assert.equal(sameDay[0].type,'weekend_merged')
})

test('função-base precisa estar explicitamente habilitada', () => {
  const context = baseContext({ p1: basePerson({ roles: {} }) })
  assert.equal(eligibility('p1', 'operador1', { date: '2026-09-12', type: 'weekend' }, {}, context).reason, 'Pessoa não habilitada nesta função')
})

test('jovem recebe somente microfone e não forma dupla com outro jovem', () => {
  const people = { jovem1: basePerson({ jovem: true }), jovem2: basePerson({ jovem: true }) }
  const context = baseContext(people)
  const meeting = { date: '2026-09-12', type: 'weekend' }
  assert.equal(eligibility('jovem1', 'entrada', meeting, {}, context).reason, 'Jovem recebe somente microfone')
  assert.equal(eligibility('jovem2', 'mic2', meeting, { mic1: 'jovem1' }, context).reason, 'Dois jovens nos microfones')
})

test('folga usa a paridade do dia e evento respeita o tipo declarado', () => {
  assert.equal(isFolga(basePerson({ refFolgaDate: '2026-08-02' }), '2026-09-12'), true)
  assert.equal(eventBlocksMeeting(
    { data: '2026-09-12', impactoTarefas: { bloqueiaReuniao: true, tiposReuniao: ['weekend_s2'] } },
    { date: '2026-09-12', type: 'weekend' },
  ), true)
})

test('somente Presidente pode acumular exatamente uma função mecânica', () => {
  assert.equal(canShareMeeting('p1', 'operador1', { presidente: 'p1' }), true)
  assert.equal(canShareMeeting('p1', 'leitor', { presidente: 'p1' }), false)
  assert.equal(canShareMeeting('p1', 'mic2', { presidente: 'p1', mic1: 'p1' }), false)
})

test('classificação de grupos usa jovem antes do cargo central e demais como fallback', () => {
  const context = baseContext({
    jovem:basePerson({jovem:true,masterId:'m1'}),
    anciao:basePerson({masterId:'m1'}),
    servo:basePerson({masterId:'m2'}),
    outro:basePerson({masterId:'m3'}),
  })
  context.masterPeople={m1:{role:'anciao'},m2:{role:'servo-ministerial'},m3:{role:'publicador'}}
  assert.equal(taskGroupForPerson('jovem',context),'jovens')
  assert.equal(taskGroupForPerson('anciao',context),'anciaos')
  assert.equal(taskGroupForPerson('servo',context),'servos')
  assert.equal(taskGroupForPerson('outro',context),'demais')
  assert.equal(normalizeTaskGroupTargets({enabled:true,anciaos:60,servos:30,jovens:20}).enabled,false)
})

test('metas distribuem participações totais por grupo, não multiplicam por pessoa', () => {
  const people={
    a1:basePerson({name:'Ancião 1',masterId:'ma1'}),
    a2:basePerson({name:'Ancião 2',masterId:'ma2'}),
    s1:basePerson({name:'Servo',masterId:'ms'}),
    d1:basePerson({name:'Demais',masterId:'md'}),
  }
  const meetings=Object.fromEntries(Array.from({length:20},(_,index)=>[`m${index}`,{date:`2026-09-${String(index+1).padStart(2,'0')}`,type:'weekend',assignments:{}}]))
  const context={people,periods:{'2026-09':{meetings}},events:{},masterPeople:{ma1:{role:'anciao'},ma2:{role:'anciao'},ms:{role:'servo-ministerial'},md:{role:'publicador'}},groupTargets:{enabled:true,anciaos:50,servos:25,jovens:0,demais:25}}
  const result=computeGeneration(context,'2026-09-01','entrada','2026-09-01T00:00:00Z','2026-09')
  assert.equal(result.aborted,false)
  const summary=summarizeTaskGroups(context,'2026-09',result.patch)
  assert.deepEqual(Object.fromEntries(Object.entries(summary.groups).map(([group,value])=>[group,value.actual])),{anciaos:10,servos:5,jovens:0,demais:5})
  assert.equal(result.patch['2026-09/appliedRules'].groupTargets.anciaos,50)
  assert.equal(result.patch['2026-09/appliedRules'].version,2)
})

test('prévia conta uma pessoa uma vez por reunião e inclui edição manual', () => {
  const context=baseContext({a:basePerson({masterId:'ma'}),s:basePerson({masterId:'ms'})},{date:'2026-09-12',type:'weekend',assignments:{presidente:'a',entrada:'a',leitor:'s'},manualEdits:{leitor:true}})
  context.masterPeople={ma:{role:'anciao'},ms:{role:'servo-ministerial'}}
  context.groupTargets={enabled:true,anciaos:50,servos:50,jovens:0,demais:0}
  const summary=summarizeTaskGroups(context,'2026-09')
  assert.equal(summary.total,2)
  assert.equal(summary.groups.anciaos.actual,1)
  assert.equal(summary.groups.servos.actual,1)
  const altered=summarizeTaskGroups(context,'2026-09',{'2026-09/meetings/m1/assignments/entrada':null})
  assert.equal(altered.groups.anciaos.actual,1)
})

test('sem candidatos no grupo desejado, geração usa demais sem criar vaga por causa da meta', () => {
  const context=baseContext({p1:basePerson({masterId:'md'})})
  context.masterPeople={md:{role:'publicador'}}
  context.groupTargets={enabled:true,anciaos:100,servos:0,jovens:0,demais:0}
  const result=computeGeneration(context,'2026-09-01','entrada','2026-09-01T00:00:00Z','2026-09')
  assert.equal(result.patch['2026-09/meetings/m1/assignments/entrada'],'p1')
  const summary=summarizeTaskGroups(context,'2026-09',result.patch)
  assert.equal(summary.groups.anciaos.target,1)
  assert.equal(summary.groups.anciaos.actual,0)
  assert.equal(summary.groups.demais.actual,1)
})

test('meta de jovens não remove restrições de microfone nem conta duas funções na reunião', () => {
  const people={j1:basePerson({name:'Jovem',jovem:true,masterId:'mj'}),a1:basePerson({name:'Ancião',masterId:'ma'}),s1:basePerson({name:'Servo',masterId:'ms'}),d1:basePerson({name:'Demais',masterId:'md'})}
  const context=baseContext(people)
  context.masterPeople={mj:{role:'publicador'},ma:{role:'anciao'},ms:{role:'servo-ministerial'},md:{role:'publicador'}}
  context.groupTargets={enabled:true,anciaos:10,servos:10,jovens:70,demais:10}
  const result=computeGeneration(context,'2026-09-01',null,'2026-09-01T00:00:00Z','2026-09')
  assert.equal(result.aborted,false)
  const assigned=Object.fromEntries(TASK_ROLES.map(role=>[role,result.patch[`2026-09/meetings/m1/assignments/${role}`]]))
  assert.equal(Object.entries(assigned).filter(([role,id])=>id==='j1'&&!['mic1','mic2'].includes(role)).length,0)
  assert.equal(Object.values(assigned).filter(id=>id==='j1').length<=1,true)
  const summary=summarizeTaskGroups(context,'2026-09',result.patch)
  assert.equal(summary.total,Object.values(assigned).filter(Boolean).length-(assigned.presidente&&Object.values(assigned).filter(id=>id===assigned.presidente).length===2?1:0))
})

test('metas desligadas preservam a geração anterior', () => {
  const context=baseContext({a:basePerson({name:'Ana',masterId:'ma'}),b:basePerson({name:'Beto',masterId:'mb'})})
  context.masterPeople={ma:{role:'anciao'},mb:{role:'publicador'}}
  const baseline=computeGeneration(context,'2026-09-01','entrada','2026-09-01T00:00:00Z','2026-09')
  context.groupTargets={enabled:false,anciaos:100,servos:0,jovens:0,demais:0}
  const disabled=computeGeneration(context,'2026-09-01','entrada','2026-09-01T00:00:00Z','2026-09')
  assert.deepEqual(disabled.patch,baseline.patch)
})

test('geração é determinística, canônica e preserva edição manual', () => {
  const people = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`p${index + 1}`, basePerson({ name: `Pessoa ${index + 1}` })]))
  const meeting = { date: '2026-09-12', type: 'weekend', assignments: { leitor: 'p8' }, manualEdits: { leitor: true } }
  const context = baseContext(people, meeting)
  const first = computeGeneration(context, '2026-09-01', null, '2026-09-01T12:00:00.000Z')
  const second = computeGeneration(context, '2026-09-01', null, '2026-09-01T12:00:00.000Z')
  assert.equal(first.aborted, false)
  assert.deepEqual(first.patch, second.patch)
  assert.equal(first.patch['2026-09/meetings/m1/assignments/leitor'], undefined)
  assert.equal(Object.keys(first.patch).some(key => /microfone1|microfone2/.test(key)), false)
  assert.equal(TASK_ROLES.every(role => role === 'leitor' || first.patch[`2026-09/meetings/m1/assignments/${role}`]), true)
})

test('período vazio recebe somente meio e fim de semana canônicos', () => {
  const result = withCanonicalPeriod(
    { '2026-11': { meetings: {} } },
    { periodMode: 'bimester', meetingDays: { midweekDow: 3, weekendDow: 6 }, excludedDates: ['2026-11-07'] },
    '2026-11-01',
  )
  assert.equal(result.periodId, '2026-11')
  const meetings = Object.values(result.periods['2026-11'].meetings)
  assert.equal(meetings.some(meeting => meeting.date === '2026-11-07'), false)
  assert.deepEqual(new Set(meetings.map(meeting => meeting.type)), new Set(['midweek', 'weekend']))
})

test('modo mensal limita as reuniões ao mês selecionado e mantém um fim de semana por data', () => {
  const result = withCanonicalPeriod(
    {},
    { periodMode: 'month', meetingDays: { midweekDow: 3, weekendDow: 6 } },
    '2026-09-01',
  )
  assert.equal(result.periodId, '2026-09')
  const meetings = Object.values(result.periods['2026-09'].meetings)
  assert.equal(meetings.every(meeting => meeting.date.startsWith('2026-09-')), true)
  const weekends = meetings.filter(meeting => meeting.type === 'weekend')
  assert.equal(new Set(weekends.map(meeting => meeting.date)).size, weekends.length)
})

test('reconhece as duas seções como reuniões distintas', () => {
  assert.equal(canonicalMeetingType('weekend'), 'weekend')
  assert.equal(canonicalMeetingType('weekend_s2'), 'weekend')
  assert.equal(canonicalMeetingType('weekend_s1'), 'weekend_s1')
  const result=withCanonicalPeriod({}, {periodMode:'month',enableSection1:true,meetingDays:{midweekDow:3,weekendDow:6,weekendS1Dow:6}}, '2026-09-01')
  const saturday=Object.values(result.periods['2026-09'].meetings).filter(item=>item.date==='2026-09-12')
  assert.deepEqual(new Set(saturday.map(item=>item.type)),new Set(['weekend','weekend_s1']))
})

test('Master ID impede a mesma pessoa nas duas seções mesmo com conflito opcional desligado', () => {
  const s1={date:'2026-09-12',type:'weekend_s1',assignments:{entrada:'p1'}}
  const s2={date:'2026-09-12',type:'weekend',assignments:{}}
  const context={people:{p1:basePerson({masterId:'m'}),p2:basePerson({masterId:'m'})},periods:{'2026-09':{meetings:{s1,s2}}},events:{},engineRules:{evitarConflitosOradores:false}}
  assert.equal(eligibility('p2','entrada',s2,{},context).reason,'Pessoa designada na outra sessão neste dia')
})

test('período travado bloqueia geração, mas escolha manual fora das regras é preservada', () => {
  const locked = baseContext({ p1: basePerson() })
  locked.periods['2026-09'].locked = true
  assert.deepEqual(computeGeneration(locked, '2026-09-01', null, '2026-09-01T12:00:00.000Z').patch, {})

  const invalid = baseContext(
    { p1: basePerson({ active: false }) },
    { date: '2026-09-12', type: 'weekend', assignments: { leitor: 'p1' }, manualEdits: { leitor: true } },
  )
  const result = computeGeneration(invalid, '2026-09-01', null, '2026-09-01T12:00:00.000Z')
  assert.equal(result.aborted, false)
  assert.equal(result.patch['2026-09/meetings/m1/assignments/leitor'], undefined)
  assert.equal(invalid.periods['2026-09'].meetings.m1.assignments.leitor, 'p1')
  assert.equal(result.patch['2026-09/meetings/m1/assignments/mic1'], null)
})

test('motor preenche vagas sem invalidar duas escolhas manuais incompatíveis', () => {
  const context = baseContext(
    { p1: basePerson({ active: false }), p2: basePerson() },
    { date: '2026-09-12', type: 'weekend', assignments: { entrada1: 'p1', entrada2: 'p1' }, manualEdits: { entrada1: true, entrada2: true } },
  )
  const result = computeGeneration(context, '2026-09-01', null, '2026-09-01T12:00:00.000Z')
  assert.equal(result.aborted, false)
  assert.equal(result.patch['2026-09/meetings/m1/assignments/entrada1'], undefined)
  assert.equal(result.patch['2026-09/meetings/m1/assignments/entrada2'], undefined)
  assert.ok(result.generated > 0)
})

test('geração de uma função não exige que as outras colunas já estejam preenchidas', () => {
  const context = baseContext({ p1: basePerson() }, { date: '2026-09-12', type: 'weekend', assignments: {} })
  const result = computeGeneration(context, '2026-09-01', 'mic1', '2026-09-01T12:00:00.000Z')
  assert.equal(result.aborted, false)
  assert.equal(result.patch['2026-09/meetings/m1/assignments/mic1'], 'p1')
  assert.equal(result.patch['2026-09/meetings/m1/assignments/leitor'], undefined)
})

test('geração somente de datas pendentes ignora reuniões anteriores', () => {
  const people = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
    `p${index + 1}`,
    basePerson({ name: `Pessoa ${index + 1}` }),
  ]))
  const context = baseContext(people, {
    date: '2026-09-12', type: 'weekend', assignments: { leitor: 'p1' }, manualEdits: {},
  })
  context.periods['2026-09'].meetings.old = { date: '2026-09-05', type: 'weekend', assignments: {}, manualEdits: {} }
  const result = computeGeneration(context, '2026-09-01', null, '2026-09-01T12:00:00.000Z', '2026-09', true, '2026-09-10')
  assert.equal(result.aborted, false)
  assert.ok(result.patch['2026-09/meetings/m1/assignments/leitor'])
  assert.ok(result.patch['2026-09/meetings/m1/assignments/mic1'])
  assert.equal(result.patch['2026-09/meetings/old/assignments/leitor'], undefined)
})

test('regras opcionais podem impedir o reaproveitamento do presidente e ficam registradas', () => {
  const people = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`p${index + 1}`, basePerson({ name:`Pessoa ${index + 1}` })]))
  const context = baseContext(people)
  const result = computeGeneration(context, '2026-09-01', null, '2026-09-01T12:00:00.000Z', '2026-09', false, '', {
    presidenteSegundaTarefa:false,
    equilibrarDesignacoes:false,
    evitarRepetirFuncao:false,
  })
  assert.equal(result.aborted, false)
  const assigned = TASK_ROLES.map(role => result.patch[`2026-09/meetings/m1/assignments/${role}`]).filter(Boolean)
  assert.equal(new Set(assigned).size, assigned.length)
  assert.deepEqual(result.patch['2026-09/appliedRules'], { presidenteSegundaTarefa:false, evitarConflitosOradores:true, equilibrarDesignacoes:false, evitarRepetirFuncao:false, version:1 })
})

test('paginação mantém todos os itens e nunca cria página vazia', () => {
  const items = Array.from({ length: 37 }, (_, index) => index)
  const pageSize = rowsPerPrintPage(700, 80, 30, 32)
  const pages = paginateItems(items, pageSize)
  assert.equal(pages.flat().length, 37)
  assert.equal(pages.every(page => page.length > 0 && page.length <= pageSize), true)
  assert.equal(rowsPerPrintPage(10, 20, 20, 30), 1)
})
