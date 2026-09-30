import test from 'node:test'
import assert from 'node:assert/strict'
import { refreshLegacyScaleParticipant, refreshLegacyScaleTables } from '../scripts/scale-legacy-refresh.mjs'

test('perfil criado recebe a disponibilidade mesmo quando o timestamp já vem no legado', () => {
  const scale = {participants:{},availability:{},legacyAvailability:{local:{old:{'4|18:00':true}}}}
  const result = refreshLegacyScaleParticipant(scale,'m',[['old',{active:true,updatedAt:'2026-09-30T10:00:00Z',availabilityUpdatedAt:'2026-09-30T20:00:00Z',name:'Não copiar',phone:'Não copiar',onlyWithId:'partner'}]],{partner:'m_partner'})
  assert.equal(result.created,true)
  assert.deepEqual(scale.availability.local.m,{'4|18:00':true})
  assert.equal(scale.participants.m.onlyWithId,'m_partner')
  assert.equal(scale.participants.m.name,undefined)
  assert.equal(scale.participants.m.phone,undefined)
})

test('atualização recente aproveita restrições e converte o parceiro para Master ID', () => {
  const scale={participants:{m:{masterId:'m',sameSexOnly:false,updatedAt:'2026-09-30T10:00:00Z',onlyWithId:'previous'}},availability:{}}
  const result=refreshLegacyScaleParticipant(scale,'m',[['old',{sameSexOnly:true,updatedAt:'2026-09-30T20:00:00Z',onlyWithId:'partner'}]],{partner:'m_partner'})
  assert.equal(result.created,false)
  assert.ok(result.updatedFields.includes('onlyWithId'))
  assert.equal(scale.participants.m.onlyWithId,'m_partner')
  assert.equal(scale.participants.m.sameSexOnly,true)
})

test('perfil ou disponibilidade mais antigos não substituem os dados recentes do projeto', () => {
  const scale={participants:{m:{masterId:'m',sameSexOnly:true,updatedAt:'2026-09-30T20:00:00Z',availabilityUpdatedAt:'2026-09-30T20:00:00Z'}},availability:{local:{m:{'4|18:00':true}}},legacyAvailability:{local:{old:{'2|08:00':true}}}}
  const before=structuredClone(scale)
  const result=refreshLegacyScaleParticipant(scale,'m',[['old',{sameSexOnly:false,updatedAt:'2026-09-29T20:00:00Z',availabilityUpdatedAt:'2026-09-29T20:00:00Z'}]],{})
  assert.equal(result.availabilityApplied,false)
  assert.deepEqual(scale,before)
})

test('perfil novo sem timestamp ainda conserva a disponibilidade disponível', () => {
  const scale={participants:{},availability:{},legacyAvailability:{local:{old:{'4|18:00':true}}}}
  refreshLegacyScaleParticipant(scale,'m',[['old',{active:true}]],{})
  assert.deepEqual(scale.availability.local.m,{'4|18:00':true})
})

test('escala antiga autorizada recupera meses e corrige identidades sem copiar IDs legados', () => {
  const tables={local:{'2026-08':{rows:{'2026-08-04':{slots:{'18:00':{p1:'wrong',p2:''}}}}}},newLocal:{'2026-10':{rows:{}}}}
  const legacy={local:{'2026-08':{rows:{'2026-08-04':{slots:{'18:00':{p1:'old',p2:'other'}}}}},'2026-09':{rows:{'2026-09-01':{slots:{'18:00':{p1:'old',p2:''}}}}}}}
  const original=structuredClone(legacy)
  const result=refreshLegacyScaleTables(tables,legacy,{old:'m1',other:'m2'},new Set(['m1','m2']))
  assert.deepEqual(tables.local['2026-08'].rows['2026-08-04'].slots['18:00'],{p1:'m1',p2:'m2'})
  assert.equal(result.tablesAdded.length,1)
  assert.equal(result.assignmentsRecovered.length,2)
  assert.equal(result.assignmentsCorrected.length,1)
  assert.ok(tables.newLocal['2026-10'])
  assert.deepEqual(legacy,original)
})

test('escala sem correspondência segura de Master é recusada', () => {
  assert.throws(()=>refreshLegacyScaleTables({}, {local:{month:{rows:{date:{slots:{time:{p1:'unknown'}}}}}}}, {}, new Set()),/Referência sem Master/)
})
