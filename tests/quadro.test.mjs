import test from 'node:test'
import assert from 'node:assert/strict'
import { quadroDataResponse } from '../netlify/functions/quadro-data.ts'
import { loadPartialAgendaRoot } from '../netlify/lib/agenda-root.ts'
import { quadroEvents,quadroNotices,mergeQuadroData,isQuadroData,safePublicLink,quadroCalendarEvents,QUADRO_SOURCES } from '../src/modules/quadro-domain.ts'
import { agendaToIcs } from '../src/modules/individual-domain.ts'
import { fortalezaToday,addCivilDays } from '../src/modules/civil-date.ts'
import { canAccessData,canMutateData,withoutPrivateRoots } from '../netlify/lib/data-authorization.ts'
import { canManageStoragePath,canReadPublicStoragePath,storageFileResponse } from '../netlify/functions/storage-file.ts'
import { apiJson } from '../src/secure-api.ts'
import { adaptQuadroJson } from '../scripts/prepare-quadro-json.mjs'

const date=addCivilDays(fortalezaToday(),1),month=date.slice(0,7)
const fixture=()=>({
 master:{pessoas:{m1:{name:'Ana Santos',active:true,whatsapp:'5585000000001'},m2:{name:'Bruno Silva',active:true,whatsapp:'5585000000002'}},config:{reunioes:{meiaDeSemana:{horario:'19:00'},fimDeSemana:{horario:'18:00'}}}},
 usuarios:{secret:{senha:'NAO_PUBLICAR'}},appSessoesPrivadas:{token:'NAO_PUBLICAR'},
 tarefas:{people:{p1:{masterId:'m1'},p2:{masterId:'m2'}},scale:{periods:{[month]:{locked:true,meetings:{one:{date,type:'weekend_s1',assignments:{presidente:'p1'}},two:{date,type:'weekend',assignments:{presidente:'p2'}}}},draft:{locked:false,meetings:{draft:{date,type:'midweek',assignments:{leitor:'p1'}}}}}},discursos:{
 oradores:{o1:{masterId:'m1',tipo:'local',secao:'s1',nome:'Nome antigo',telefone:'SEGREDO'},o2:{masterId:'m2',tipo:'local',secao:'s2'}},temas:{t:{titulo:'Tema geral'}},
 congregacoes:{l1:{tipo:'local',secao:'s1',nome:'Noroeste S1',horario:'09:00',localizacao:'Rua Um'},l2:{tipo:'local',secao:'s2',nome:'Noroeste S2',horario:'18:00'},dest:{tipo:'visitante',nome:'Destino',horario:'16:00'}},
 programacao:{one:{data:date,tipo:'discurso_local',secao:'s1',oradorId:'o1',temaId:'t',status:'confirmado'},two:{data:date,tipo:'discurso_local',secao:'s2',oradorId:'o2',status:'confirmado'},out:{data:date,tipo:'saida_orador',secao:'s1',oradorId:'o1',congregacaoDestinoId:'dest',status:'confirmado'},draft:{data:date,tipo:'discurso_local',oradorId:'o2'}}},
 events:{general:{data:date,titulo:'Assembleia',descricao:'Evento geral'},past:{data:'2020-01-01',titulo:'Antigo'},bad:{data:'2026-02-30',titulo:'Inválido'}}},
 escala:{participants:{p1:{masterId:'m1'},p2:{masterId:'m2'}},scales:{l:{name:'Praça'}},publishedMonths:{[month]:true},tables:{l:{[month]:{rows:{[date]:{slots:{'10:00':{p1:'p1',p2:'p2'}}}}}}}},
 limpeza:{periodos:{secret:'HISTORICO'}},servicoCampo:{leaders:{m1:true}},
 agenda:{config:{moduleWhatsApp:{quadro:{groupLink:'https://chat.whatsapp.com/publico',meetingText:'Informações {dados_da_reuniao}'},oradores:{documentText:'INTERNO'},limpeza:{meetingText:'RETIRADO'}},icsReminders:{tarefas:['P1D'],limpeza:['P1D']}},documentos:{
 active:{id:'active',modulo:'oradores',periodo:month,nome:'Oradores.pdf',url:'https://app.test/oradores.pdf',criadoEm:new Date().toISOString(),storagePath:'NAO_PUBLICAR'},
 admin:{id:'admin',modulo:'admin',periodo:month,nome:'Comunicado.pdf',url:'https://app.test/comunicado.pdf',criadoEm:new Date().toISOString()},
 retired:{id:'retired',modulo:'limpeza',periodo:month,nome:'Limpeza.pdf',url:'https://app.test/limpeza.pdf',criadoEm:new Date().toISOString()}
 }}
})
const empty=()=>({events:[],notices:[],agenda:{config:{},documentos:{}},completedSources:[],failedSources:[]})

test('calendário do Quadro inclui eventos gerais de dia inteiro e limita ao mês escolhido',()=>{
 const source={...empty(),events:[{id:'t',source:'tarefas',date:'2026-10-03',title:'Presidente',detail:'1ª seção',people:['Ana Santos'],status:'futuro'}],notices:[{id:'a',date:'2026-10-04',title:'Assembleia',description:'Evento geral'},{id:'b',date:'2026-11-01',title:'Novembro',description:''}]}
 const events=quadroCalendarEvents(source,'2026-10'),ics=agendaToIcs(events,'2026-10-01T12:00:00Z',{namespace:'noroeste-quadro'})
 assert.equal(events.length,2)
 assert.match(ics,/SUMMARY:Assembleia/);assert.match(ics,/DTSTART;VALUE=DATE:20261004/);assert.match(ics,/DTEND;VALUE=DATE:20261005/)
 assert.match(ics,/Ana Santos/);assert.doesNotMatch(ics,/SUMMARY:Novembro/)
 assert.deepEqual(quadroCalendarEvents(source,'2026-13'),[])
})
test('adaptação do JSON conserva históricos, não inventa sobrenomes e resolve somente IDs exatos',()=>{
 const root=fixture();root.master.pessoas.m1.name='Ana Maria Santos';root.master.pessoas.m2.name='Bruno';root.usuarios.secret={nome:'Ana Maria',senha:'senha-teste',masterId:'m1',apps:{mestre:true,oradores:true,limpeza:true}}
 root.tarefas.discursos.oradores.o1.pessoaId='p-stable'
 root.tarefas.discursos.programacao.one.oradorId='old-id'
 const before=structuredClone(root),legacy={discursos:{oradores:{'old-id':{pessoaId:'p-stable'}}}}
 const {root:next,summary}=adaptQuadroJson(root,legacy)
 assert.equal(next.master.pessoas.m1.name,'Ana Santos');assert.equal(next.master.pessoas.m2.name,'Bruno')
 assert.equal(next.usuarios.secret.apps.oradores,true);assert.equal(next.usuarios.secret.apps.oradoresS1,false);assert.equal(next.usuarios.secret.apps.quadro,true);assert.equal(next.usuarios.secret.apps.limpeza,false)
 assert.equal(next.usuarios.secret.senha,'senha-teste');assert.equal(next.usuarios.secret.nome,'Ana Santos')
 assert.equal(next.tarefas.discursos.programacao.one.oradorId,'o1');assert.equal(summary.speakerReferences,1)
 assert.deepEqual(next.limpeza,root.limpeza);assert.deepEqual(next.servicoCampo,root.servicoCampo);assert.deepEqual(root,before)
 assert.equal(adaptQuadroJson(root,{discursos:{oradores:{'old-id':{nome:'Ana Santos'}}}}).root.tarefas.discursos.programacao.one.oradorId,'old-id')
})
test('Quadro não divulga designação de orador inativo ou cadastro ausente',()=>{
 const root=fixture();root.tarefas.discursos.oradores.o1.ativo=false;delete root.tarefas.discursos.oradores.o2
 assert.equal(quadroEvents(root).some(e=>e.source==='oradores'),false)
})

test('Quadro resolve vínculo legado explícito por pessoaId sem inferir pelo nome',()=>{
 const root=fixture(),speaker=root.tarefas.discursos.oradores.o1
 delete speaker.masterId;speaker.pessoaId='p1'
 assert.ok(quadroEvents(root).some(e=>e.source==='oradores'&&e.people.includes('Ana Santos')))
 speaker.pessoaId='ausente'
 assert.equal(quadroEvents(root).some(e=>e.source==='oradores'&&e.people.includes('Ana Santos')),false)
})
test('Quadro combina Tarefas e Oradores das duas seções, TPL e eventos gerais publicados',()=>{
 const root=fixture(),events=quadroEvents(root)
 assert.equal(events.length,6)
 assert.deepEqual(events.filter(e=>e.source==='tarefas').map(e=>e.time).sort(),['09:00','18:00'])
 assert.ok(events.some(e=>e.source==='oradores'&&e.detail.includes('1ª seção')))
 assert.ok(events.some(e=>e.source==='oradores'&&e.detail.includes('2ª seção')))
 assert.ok(events.some(e=>e.title==='Saída de orador'&&e.people[0]==='Ana Santos'))
 assert.deepEqual(events.find(e=>e.source==='escala').people.sort(),['Ana Santos','Bruno Silva'])
 assert.equal(events.some(e=>e.id.includes('draft')),false)
 assert.deepEqual(quadroNotices(root).map(n=>n.title),['Assembleia'])
})
test('API pública funciona sem sessão e não expõe cadastro, contato, token ou configurações privadas',async()=>{
 const response=await quadroDataResponse(new Request('https://app.test/quadro-data'),async()=>({root:fixture(),completedSources:[...QUADRO_SOURCES],failedSources:[]}))
 assert.equal(response.status,200)
 const payload=await response.json(),serialized=JSON.stringify(payload)
 assert.equal(isQuadroData(payload),true)
 for(const secret of ['NAO_PUBLICAR','5585000000001','5585000000002','SEGREDO','masterId','usuarios','appSessoesPrivadas','storagePath','INTERNO','RETIRADO'])assert.equal(serialized.includes(secret),false,secret)
 assert.deepEqual(Object.keys(payload.agenda.documentos).sort(),['active','admin'])
 assert.deepEqual(Object.keys(payload.agenda.config.moduleWhatsApp),['quadro'])
 assert.equal(payload.agenda.config.icsReminders.limpeza,undefined)
 assert.equal(response.headers.get('cache-control'),'no-store')
})
test('API recusa métodos e fontes retiradas antes de consultar Firebase',async()=>{
 const fail=()=>assert.fail('não deveria consultar Firebase')
 for(const method of ['POST','PATCH','DELETE'])assert.equal((await quadroDataResponse(new Request('https://app.test/quadro-data',{method}),fail)).status,405)
 for(const source of ['limpeza','servicoCampo','usuarios',''])assert.equal((await quadroDataResponse(new Request('https://app.test/quadro-data?sources='+source),fail)).status,400)
 assert.equal((await quadroDataResponse(new Request('https://app.test/quadro-data'),async()=>{throw Error('offline')})).status,503)
})
test('cliente público não envia credenciais, token de instalação ou dispositivo',async t=>{
 const storage=globalThis.localStorage
 globalThis.localStorage={getItem:()=> 'a'.repeat(64)}
 try {
  t.mock.method(globalThis,'fetch',async(_url,init)=>{
   assert.equal(init.credentials,'omit')
   assert.equal(init.headers.has('x-noroeste-installation'),false)
   assert.equal(init.headers.has('x-noroeste-device'),false)
   return Response.json({})
  })
  await apiJson('quadro-data',{credentials:'omit'})
 }finally{globalThis.localStorage=storage}
})
test('falha parcial e retry não apagam dados das fontes indisponíveis',()=>{
 const before=empty();before.events=quadroEvents(fixture());before.notices=quadroNotices(fixture())
 const incoming={...empty(),completedSources:['tarefas'],failedSources:['oradores']}
 const merged=mergeQuadroData(before,incoming)
 assert.equal(merged.events.some(e=>e.source==='tarefas'),false)
 assert.equal(merged.events.filter(e=>e.source==='oradores').length,3)
 assert.equal(merged.notices.length,1)
 const retry=mergeQuadroData(merged,{...empty(),completedSources:['oradores']})
 assert.equal(retry.events.some(e=>e.source==='oradores'),false)
 assert.deepEqual(retry.failedSources,[])
})
test('leitura parcial limita fontes, preserva falhas e não lê raízes privadas ou retiradas',async()=>{
 const paths=[],root=fixture(),read=async path=>{
  paths.push(path);if(path==='escala/tables')throw Error('offline')
  return path.split('/').reduce((v,k)=>v?.[k],root)??null
 }
 const result=await loadPartialAgendaRoot([...QUADRO_SOURCES],read)
 assert.deepEqual(result.failedSources,['escala'])
 assert.equal(paths.some(p=>/limpeza|servicoCampo|usuarios|Privad/.test(p)),false)
 paths.length=0;await loadPartialAgendaRoot(['quadro'],read)
 assert.deepEqual(paths.sort(),['agenda/config','agenda/documentos'])
})
test('falha no Master não impede os anúncios gerais e os PDFs',async()=>{
 const result=await loadPartialAgendaRoot([...QUADRO_SOURCES],async path=>{if(path.startsWith('master/'))throw Error('offline');return {}})
 assert.deepEqual(result.failedSources.sort(),['tarefas','oradores','escala'].sort())
 assert.deepEqual(result.completedSources.sort(),['geral','quadro'])
})
test('cache e links inválidos não quebram nem executam conteúdo no Quadro',()=>{
 assert.equal(isQuadroData({...empty(),agenda:{}}),false)
 assert.equal(isQuadroData({...empty(),agenda:{config:{moduleWhatsApp:{quadro:{meetingText:42}}},documentos:{}}}),false)
 assert.equal(isQuadroData({...empty(),failedSources:['usuarios']}),false)
 assert.equal(isQuadroData({...empty(),events:[{id:'a',date:'2026-02-30',source:'tarefas',title:'X',detail:'X',people:[]}]}),false)
 assert.equal(isQuadroData({...empty(),events:[{id:'a',date,time:'25:00',source:'tarefas',title:'X',detail:'X',people:[]}]}),false)
 for(const url of ['javascript:alert(1)','http://app.test','https://login:password@app.test'])assert.equal(safePublicLink(url),'')
 assert.equal(safePublicLink('https://app.test/quadro/'),'https://app.test/quadro/')
})
test('módulos retirados são negados mesmo para Admin e histórico permanece intacto',async()=>{
 const root=fixture(),before=structuredClone(root),admin={mestre:true}
 for(const module of ['limpeza','servicoCampo']){
  assert.equal(canAccessData(module,admin,false),false)
  assert.equal(canAccessData(module,admin,true),false)
  assert.equal(canMutateData('','PATCH',{[module]:null},admin),false)
  const path='agenda/documentos/modulos/'+module+'/2026-10.pdf'
  assert.equal(canManageStoragePath(path,admin),false)
  assert.equal(canReadPublicStoragePath(path),false)
  let reads=0
  const response=await storageFileResponse(new Request('https://app.test/storage-file?path='+encodeURIComponent(path)),()=>({getWithMetadata(){reads++;throw Error('não ler')}}))
  assert.equal(response.status,404);assert.equal(reads,0)
 }
 assert.equal(withoutPrivateRoots(root).limpeza,undefined)
 assert.deepEqual(root,before)
 for(const path of ['master/pessoas','usuarios','agenda/config','agenda/documentos'])assert.equal(canAccessData(path,{quadro:true,limpeza:true,servicoCampo:true},false),false)
})
test('endpoints pessoais e de Limpeza encerrados não consultam Firebase',async()=>{
 for(const file of ['agenda-data','agenda-device','calendar','calendar-subscriptions','cleaning-groups']){
  const handler=(await import('../netlify/functions/'+file+'.ts')).default
  for(const method of ['GET','POST','PATCH','DELETE'])assert.equal((await handler(new Request('https://app.test/'+file,{method}))).status,410,file)
 }
})
