import test from 'node:test'
import assert from 'node:assert/strict'
import { localPreferences } from '../src/ui/local-preferences.ts'

test('preferências locais persistem e ficam isoladas por usuário e módulo/seção',()=>{
  const data=new Map(),access=()=>({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)})
  const s1=localPreferences('u','oradoresS1',access)
  s1.set('open:options',true);s1.set('month','2026-10')
  assert.equal(localPreferences('u','oradoresS1',access).get('open:options',false),true)
  assert.equal(localPreferences('u','oradores',access).get('open:options',false),false)
  assert.equal(localPreferences('other','oradoresS1',access).get('open:options',false),false)
  assert.equal(s1.get('month',''), '2026-10')
  s1.set('open:options',false)
  assert.equal(localPreferences('u','oradoresS1',access).get('open:options',true),false)
})

test('storage indisponível, JSON inválido e tipos inesperados não derrubam o módulo',()=>{
  const unavailable=localPreferences('u','oradores',()=>{throw Error('bloqueado')})
  assert.doesNotThrow(()=>unavailable.set('open',true))
  assert.equal(unavailable.get('open',false),false)
  for(const raw of ['{','null','[]','{}','"true"','1']){
    const preferences=localPreferences('u','oradores',()=>({getItem:()=>raw,setItem:()=>{throw Error('quota')}}))
    assert.equal(preferences.get('open',false),false)
    assert.doesNotThrow(()=>preferences.set('open',true))
  }
})
