import test from 'node:test'
import assert from 'node:assert/strict'
import { canMutateSpeakerSection } from '../netlify/lib/speaker-section-authorization.ts'
import { canAccessData, canMutateData } from '../netlify/lib/data-authorization.ts'
import { introducesSecondSectionConflict } from '../netlify/lib/second-section-conflicts.ts'

const root={tarefas:{discursos:{
  oradores:{a:{nome:'Ana',tipo:'local',secao:'s1'},b:{nome:'Bruno',tipo:'local',secao:'s2'}},
  programacao:{one:{data:'2026-10-03',tipo:'discurso_local',secao:'s1',oradorId:'a'},two:{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'b'}},
  congregacoes:{local1:{tipo:'local',secao:'s1'},local2:{tipo:'local',secao:'s2'}},
}}}
const s1={mestre:false,oradoresS1:true,oradores:false,tarefas:false}
const s2={mestre:false,oradoresS1:false,oradores:true,tarefas:false}

test('permissão antiga de Oradores permanece S2; nova permissão abre S1 e PDF conjunto',()=>{
  assert.equal(canAccessData('tarefas/discursos',s1,false),true)
  assert.equal(canAccessData('tarefas/discursos',s1,true),true)
  assert.equal(canAccessData('agenda/documentos',s1,true),true)
  assert.equal(canMutateData('agenda/documentos','PATCH',{'modulo-oradores-2026-10':{modulo:'oradores',tipo:'modulo',storagePath:'agenda/documentos/modulos/oradores/2026-10.pdf'}},s1),true)
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/oradoresS1',s1,true),true)
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/oradores',s1,true),false)
  assert.equal(canAccessData('agenda/config/moduleWhatsApp/oradoresS1',s2,true),false)
})

test('responsável de S1 não altera cadastro, discurso ou congregação local de S2',()=>{
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores/a','PUT',{nome:'Ana Nova',tipo:'local',secao:'s1'},s1),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores/b','PUT',{nome:'Bruno Novo',tipo:'local',secao:'s2'},s1),false)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/two','DELETE',undefined,s1),false)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/congregacoes/local2','PUT',{tipo:'local',secao:'s2'},s1),false)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/one','PUT',{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'a'},s1),false)
})

test('responsável de S2 não altera S1 e não pode trocar orador para a outra seção',()=>{
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/one','DELETE',undefined,s2),false)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/two','PUT',{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'b'},s2),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/two','PUT',{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'a'},s2),false)
})

test('troca de cadastro em lote não permite alterar a outra seção',()=>{
  const all={...root.tarefas.discursos.oradores,a:{nome:'Ana Nova',tipo:'local',secao:'s1'}}
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores','PUT',all,s1),true)
  all.b={nome:'Bruno Novo',tipo:'local',secao:'s2'}
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores','PUT',all,s1),false)
})

test('saída legada com seção incorreta pode ser corrigida somente pelo responsável do orador',()=>{
  const legacy=structuredClone(root)
  legacy.tarefas.discursos.programacao.out={tipo:'saida_orador',secao:'s2',oradorId:'a'}
  assert.equal(canMutateSpeakerSection(legacy,'tarefas/discursos/programacao/out','PUT',{tipo:'saida_orador',secao:'s1',oradorId:'a'},s1),true)
  assert.equal(canMutateSpeakerSection(legacy,'tarefas/discursos/programacao/out','DELETE',undefined,s2),false)
})

test('os dois responsáveis editam catálogos compartilhados, sem acesso aos registros locais da outra seção',()=>{
  const shared=structuredClone(root)
  shared.tarefas.discursos.oradores.visitante={tipo:'visitante',secao:'s2',nome:'Visitante'}
  shared.tarefas.discursos.congregacoes.visitante={tipo:'visitante',secao:'s2',nome:'Destino'}
  for (const apps of [s1,s2]) {
    assert.equal(canMutateSpeakerSection(shared,'tarefas/discursos/oradores/visitante','PUT',{tipo:'visitante',secao:'s2',nome:'Visitante atualizado'},apps),true)
    assert.equal(canMutateSpeakerSection(shared,'tarefas/discursos/congregacoes/visitante','PUT',{tipo:'visitante',nome:'Destino atualizado'},apps),true)
    assert.equal(canMutateSpeakerSection(shared,'tarefas/events/evento','PUT',{titulo:'Evento geral'},apps),true)
  }
  assert.equal(canAccessData('tarefas/events',s1,true),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/temas/t','PUT',{numero:1},s1),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/congregacoes/visitante','PUT',{tipo:'visitante'},s2),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores/visitante','PUT',{tipo:'visitante'},s1),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/temas/t','PUT',{numero:1},{mestre:true}),true)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/oradores/b','PUT',{tipo:'visitante'},s2),false)
  assert.equal(canMutateSpeakerSection(root,'tarefas/discursos/programacao/new','PUT',{secao:'s1',oradorId:'inexistente'},s1),false)
})

test('transação recusa Master ID duplicado entre seções e conflito entre Tarefas e Oradores',()=>{
  const current={master:{pessoas:{m:{name:'Ana'}}},tarefas:{people:{p:{masterId:'m',weekendSection:'s1'}},scale:{periods:{outubro:{meetings:{one:{date:'2026-10-03',type:'weekend_s1',assignments:{entrada:'p'}}}}}},discursos:{oradores:{a:{masterId:'m',tipo:'local',secao:'s1'}},programacao:{}}}}
  const next=structuredClone(current)
  next.tarefas.discursos.oradores.b={masterId:'m',tipo:'local',secao:'s2'}
  assert.equal(introducesSecondSectionConflict(current,next),true)
  delete next.tarefas.discursos.oradores.b
  next.tarefas.discursos.programacao.talk={data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'a'}
  assert.equal(introducesSecondSectionConflict(current,next),true)
  next.tarefas.discursos.programacao.talk.secao='s1'
  assert.equal(introducesSecondSectionConflict(current,next),false)
  next.tarefas.scale.periods.outubro.meetings.two={date:'2026-10-03',type:'weekend',assignments:{entrada:'m'}}
  assert.equal(introducesSecondSectionConflict(current,next),true)
  assert.equal(introducesSecondSectionConflict(next,{...next,agenda:{}}),false)
})
