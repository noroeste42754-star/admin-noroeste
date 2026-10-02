import test from 'node:test'
import assert from 'node:assert/strict'
import { localCongregationName, combinedCongregationTitle, congregationInUse, preservesSpeakerCongregations } from '../src/modules/oradores-congregations.ts'
import { auditedWrite } from '../netlify/lib/audited-write.ts'
const congregacoes={one:{nome:'Noroeste · 1ª seção',tipo:'local',secao:'s1',ativa:true},two:{nome:'Noroeste · 2ª seção',tipo:'local',secao:'s2',ativa:true}}
test('PDF identifica as duas congregações e nunca usa S2 como fallback de S1',()=>{
 assert.equal(localCongregationName({secao:'s1',localCongregacaoId:'two'},congregacoes),congregacoes.one.nome)
 assert.equal(localCongregationName({secao:'s2'},congregacoes),congregacoes.two.nome)
 assert.match(localCongregationName({secao:'s1'},{two:congregacoes.two}),/1ª/)
 assert.equal(combinedCongregationTitle(congregacoes),'Noroeste · 1ª seção / Noroeste · 2ª seção')
})
test('exclusão protege origem, destino, congregação local e visitantes vinculados',()=>{
 for(const field of ['localCongregacaoId','congregacaoOrigemId','congregacaoDestinoId'])assert.equal(congregationInUse('one',{p:{[field]:'one'}}),true)
 assert.equal(congregationInUse('one',{}, {p:{congregacaoId:'one'}}),true)
 const before={congregacoes,programacao:{p:{localCongregacaoId:'one'}}},after=structuredClone(before)
 delete after.congregacoes.one
 assert.equal(preservesSpeakerCongregations(before,after),false)
 const root={tarefas:{discursos:before}}
 for(const [method,value] of [['DELETE',undefined],['PUT',null]])assert.equal(auditedWrite(root,'tarefas/discursos/congregacoes/one',method,value,false,undefined,{module:'oradores',paths:[]}),undefined)
 after.congregacoes.one={...congregacoes.one,ativa:false}
 assert.equal(preservesSpeakerCongregations(before,after),true)
 after.congregacoes.one.secao='s2'
 assert.equal(preservesSpeakerCongregations(before,after),false)
})
test('não permite criar uma segunda congregação local ativa na mesma seção',()=>{
 const before={congregacoes},after=structuredClone(before)
 after.congregacoes.duplicate={...congregacoes.one}
 assert.equal(preservesSpeakerCongregations(before,after),false)
 after.congregacoes.duplicate.ativa=false
 assert.equal(preservesSpeakerCongregations(before,after),true)
})
