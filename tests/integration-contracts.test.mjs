import test from 'node:test'
import assert from 'node:assert/strict'
import { fortalezaToday, isValidCivilDate, addCivilDays, nextCivilMonth } from '../src/modules/civil-date.ts'
import { canonicalTaskPerson } from '../src/modules/central-person.ts'
import { mergeAgendaSources } from '../src/modules/agenda-sync.ts'
import { loadPartialAgendaRoot } from '../netlify/lib/agenda-root.ts'
import { transitionPublication, sourceHash, publicationVersion } from '../netlify/lib/publication-transition.ts'
import { guardedModuleWrite } from '../netlify/lib/published-write.ts'
import { publicationIssues, publicationPeriod, periodIsPublished } from '../src/modules/publication-contract.ts'
import { officialDocumentId } from '../src/modules/agenda-documents-domain.ts'
import { auditIntegrations } from '../src/modules/integration-audit.ts'
import { collectAgendaEvents } from '../src/modules/individual-domain.ts'

const month='2026-09'
function fixture() {return {
  master:{pessoas:{m:{name:'Ana',active:true,sex:'M'}}},
  tarefas:{people:{p:{masterId:'m',active:true}},scale:{periods:{[month]:{meetings:{a:{date:'2026-09-20',type:'weekend',assignments:{presidente:'p'}}}}}},discursos:{programacao:{a:{data:'2026-09-20',tipo:'discurso_local',oradorNome:'Ana',secao:'s2'}}}},
  limpeza:{periodos:{[month]:{inicio:'2026-09-01',fim:'2026-09-30',semanas:[]}}},
  servicoCampo:{leaders:{m:true},periods:{[month]:{month,assignments:{}}}},
  escala:{participants:{m:{active:true}},scales:{l:{name:'Praça'}},tables:{l:{[month]:{rows:{'2026-09-20':{slots:{'09:00':{p1:'m'}}}}}}}}
}}
test('datas civis respeitam Fortaleza, bissextos e passagem de mês',()=>{
  assert.equal(fortalezaToday(new Date('2026-10-01T01:00:00Z')),'2026-09-30')
  assert.equal(nextCivilMonth('2026-12-31'),'2027-01')
  assert.equal(isValidCivilDate('2026-02-30'),false)
  assert.equal(isValidCivilDate('2024-02-29'),true)
  assert.equal(addCivilDays('2026-09-30',1),'2026-10-01')
})
test('Admin inativo ou vínculo ausente nunca habilita Tarefas',()=>{
  assert.equal(canonicalTaskPerson('p',{masterId:'m',active:true},{m:{active:false}}).active,false)
  assert.equal(canonicalTaskPerson('p',{active:true},{}).active,false)
  assert.equal(canonicalTaskPerson('m',{active:true},{m:{name:'Central'}}).name,'Central')
})
for(const module of ['tarefas','limpeza','escala','servicoCampo','oradores']) {
  test(module+': publicação concorrente preserva versão oficial e reabertura atômica',()=>{
    const root=fixture(),key=officialDocumentId(module,month),hash=sourceHash(root,module,month),version=publicationVersion(root,module,month)
    const document={id:key,modulo:module,origemPeriodoId:month,sourceHash:hash}
    const next=transitionPublication(root,module,month,hash,null,document,version)
    assert.deepEqual(next.agenda.documentos[key],document)
    if(module!=='oradores')assert.equal(periodIsPublished(next,module,month),true)
    assert.equal(root.agenda,undefined)
    assert.equal(transitionPublication(next,module,month,hash,null,{...document,url:'outro'},version),undefined)
    const reopened=transitionPublication(next,module,month,sourceHash(next,module,month),document,null,publicationVersion(next,module,month))
    assert.equal(reopened.agenda.documentos[key],undefined)
    assert.equal(periodIsPublished(reopened,module,month),false)
  })
}
test('mudança central durante upload impede commit sem alterar dados',()=>{
  const root=fixture(),hash=sourceHash(root,'tarefas',month),version=publicationVersion(root,'tarefas',month)
  const changed=structuredClone(root);changed.master.pessoas.m.active=false
  assert.equal(transitionPublication(changed,'tarefas',month,hash,null,{},version),undefined)
})
test('TPL não publica PDF vazio nem ID de participante sem nome',()=>{
  const root=fixture()
  root.escala.scales.empty={name:'Sem designações'}
  assert.deepEqual(publicationIssues(root,'escala',month),[])
  const originalHash=sourceHash(root,'escala',month)
  root.escala.scales.empty.name='Outro nome sem designações'
  assert.equal(sourceHash(root,'escala',month),originalHash)
  root.escala.participants.m.name='m'
  root.master.pessoas.m.name='m'
  assert.match(publicationIssues(root,'escala',month).join(' '),/sem nome\/vínculo/)
  root.escala.tables={}
  assert.match(publicationIssues(root,'escala',month).join(' '),/nenhuma designação/)
})
test('confirmação não muda PDF de Oradores, mas protege a versão durante publicação',()=>{
  const root=fixture(),changed=structuredClone(root);changed.tarefas.discursos.programacao.a.status='confirmado'
  assert.equal(sourceHash(root,'oradores',month),sourceHash(changed,'oradores',month))
  assert.notEqual(publicationVersion(root,'oradores',month),publicationVersion(changed,'oradores',month))
})
for(const module of ['tarefas','limpeza','escala','servicoCampo']) {
  test(module+': edição atrasada não atravessa o bloqueio publicado',()=>{
    const root=fixture(),published=transitionPublication(root,module,month,sourceHash(root,module,month),null,{id:'pdf'})
    const path=module==='tarefas'?'tarefas/scale/periods/'+month:module==='limpeza'?'limpeza/periodos/'+month:module==='servicoCampo'?'servicoCampo/periods/'+month:'escala/tables/l/'+month
    assert.equal(guardedModuleWrite(published,path,'DELETE'),undefined)
    assert.ok(guardedModuleWrite(root,path,'PATCH',{notes:'editar'}))
    assert.deepEqual(publicationPeriod(root,module,month),publicationPeriod(fixture(),module,month))
  })
}
test('edição condicional e tentativa de publicar pela API genérica são protegidas',()=>{
  const root=fixture(),path='tarefas/scale/periods/'+month
  assert.equal(guardedModuleWrite(root,path,'PATCH',{locked:true}),undefined)
  assert.equal(guardedModuleWrite(root,path,'PUT',{},true,{meetings:{}}),undefined)
})
test('falha parcial não retira eventos; retry só lê fontes solicitadas',async()=>{
  const paths=[]
  const read=async path=>{paths.push(path);if(path==='limpeza/periodos')throw Error('offline');return {}}
  const result=await loadPartialAgendaRoot(['tarefas','limpeza'],read)
  assert.deepEqual(result.completedSources,['tarefas'])
  assert.deepEqual(result.failedSources,['limpeza'])
  const old=[{id:'t',source:'tarefas',date:month+'-01'},{id:'l',source:'limpeza',date:month+'-02'}]
  assert.deepEqual(mergeAgendaSources(old,[],result.completedSources),[old[1]])
  paths.length=0;await loadPartialAgendaRoot(['limpeza'],read)
  assert.deepEqual(paths,['master/pessoas','limpeza/periodos'])
})
test('TPL reconhece vínculo legado pela chave e reabertura remove evento mesmo com snapshot',()=>{
  const root=fixture();root.escala.publishedMonths={[month]:true}
  assert.equal(collectAgendaEvents(root,'m').filter(e=>e.source==='escala').length,1)
  root.escala.publishedSnapshots={[month]:{participants:root.escala.participants}}
  delete root.escala.publishedMonths[month]
  assert.equal(collectAgendaEvents(root,'m').filter(e=>e.source==='escala').length,0)
})
test('auditoria detecta vínculo quebrado e PDF ausente sem alterar backup',async()=>{
  const root=fixture();root.tarefas.people.p.masterId='missing';root.tarefas.scale.periods[month].locked=true
  const before=structuredClone(root),issues=await auditIntegrations(root,'2026-09-01')
  assert.ok(issues.some(i=>i.kind==='vinculo'&&i.module==='tarefas'))
  assert.ok(issues.some(i=>i.kind==='publicacao'&&i.module==='tarefas'))
  assert.deepEqual(root,before)
})
test('auditoria identifica nome de participante TPL preenchido somente pelo ID',async()=>{
  const root=fixture()
  root.master.pessoas.m.name='m'
  const issues=await auditIntegrations(root,'2026-09-01')
  assert.ok(issues.some(issue=>issue.module==='escala'&&issue.id==='m'&&issue.detail.includes('apenas com o ID')))
})
test('Oradores usa endereço e horário do local, nunca a origem visitante',()=>{
  const root=fixture()
  root.tarefas.discursos={oradores:{o:{masterId:'m'}},congregacoes:{local:{tipo:'local',secao:'s2',nome:'Noroeste',localizacao:'Rua Local',horario:'18:00'},dest:{tipo:'visitante',nome:'Centro',localizacao:'Rua Destino',horario:'19:30'}},programacao:{a:{data:'2026-09-20',tipo:'discurso_visitante',oradorId:'o',status:'confirmado',congregacaoOrigemId:'dest'},b:{data:'2026-09-27',tipo:'saida_orador',oradorId:'o',status:'confirmado',congregacaoDestinoId:'dest'}}}
  const events=collectAgendaEvents(root,'m').filter(e=>e.source==='oradores')
  assert.equal(events[0].location,'Rua Local');assert.equal(events[0].time,'18:00')
  assert.equal(events[1].location,'Rua Destino');assert.equal(events[1].time,'19:30')
})
test('contatos e cadastros sem designação não tornam PDFs desatualizados',()=>{
  const root=fixture(),changed=structuredClone(root)
  changed.master.pessoas.m.whatsapp='5585999999999'
  changed.master.pessoas.other={name:'Outra pessoa',active:true}
  changed.tarefas.people.other={masterId:'other',active:true}
  changed.escala.participants.other={masterId:'other',active:true}
  for(const module of ['tarefas','servicoCampo','escala','limpeza'])assert.equal(sourceHash(root,module,month),sourceHash(changed,module,month))
  changed.master.pessoas.m.name='Nome novo'
  assert.notEqual(sourceHash(root,'tarefas',month),sourceHash(changed,'tarefas',month))
})
