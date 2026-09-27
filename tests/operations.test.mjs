import test from 'node:test'
import assert from 'node:assert/strict'
import { taskSubstitutes,fieldSubstitutes } from '../src/modules/substitution-domain.ts'
import { replaceCleaningGroup } from '../src/modules/limpeza-domain.ts'
import { auditedWrite } from '../netlify/lib/audited-write.ts'
import { appendActivity,ACTIVITY_ROOT } from '../netlify/lib/activity.ts'
import { activityAllowed } from '../src/modules/activity-domain.ts'
import { canAccessData,containsPrivateRoot,withoutPrivateRoots } from '../netlify/lib/data-authorization.ts'
import { databaseResponse } from '../netlify/functions/database.ts'
import { activityResponse } from '../netlify/functions/activity.ts'

const apps={mestre:false,tarefas:true,escala:false,limpeza:false}
const person=name=>({name,active:true,sex:'M',limpeza:{grupo:1}})
const people={m1:person('Ana'),m2:person('Beto'),m3:person('Caio')}
const entry={id:'event-1',at:'2026-10-01T12:00:00Z',actorId:'u1',actorName:'Admin',module:'tarefas',action:'alterar',paths:[]}
const fixture=()=>({master:{pessoas:people},tarefas:{people:{p1:{masterId:'m1',roles:{microfone:true}},p2:{masterId:'m2',roles:{microfone:true}},p3:{masterId:'m3',roles:{microfone:true}}},scale:{periods:{'2026-10':{meetings:{a:{date:'2026-10-04',type:'weekend',assignments:{mic1:'p1'}}}}}}}})
test('substituição em Tarefas exclui atual, sinaliza indisponível e ordena por uso',()=>{
 const root=fixture(),profiles=root.tarefas.people
 profiles.p1.name='Ana';profiles.p2.name='Beto';profiles.p3.name='Caio';profiles.p2.unavailableDates=['2026-10-04']
 const context={people:profiles,periods:root.tarefas.scale.periods,events:{}}
 const candidates=taskSubstitutes(context,{periodId:'2026-10',meetingId:'a',meeting:context.periods['2026-10'].meetings.a},'mic1')
 assert.deepEqual(candidates.map(c=>c.id),['p3','p2']);assert.match(candidates[1].reason,/Indisponível/)
})
test('Campo impede substituto inativo e ocupado na mesma data/hora',()=>{
 const item={id:'a',date:'2026-10-04',time:'09:00',leaderId:'m1'}
 const candidates=fieldSubstitutes(item,[item,{...item,id:'b',leaderId:'m2'}],{m1:true,m2:true,m3:true},{...people,m3:{...people.m3,active:false}})
 assert.equal(candidates.length,2);assert.ok(candidates.every(c=>c.reason))
})
test('substituição de grupo altera apenas a semana escolhida e respeita publicação',()=>{
 const period={semanas:[{referencia:'2026-10-07',grupo:1},{referencia:'2026-10-14',grupo:1}]}
 const config={grupos:2,gruposConfig:{2:{superintendenteMid:'m2',ajudantesMid:[]}}}
 const central={...people,m2:{...people.m2,limpeza:{grupo:2}}}
 const next=replaceCleaningGroup(period,0,2,config,central)
 assert.equal(next.semanas[0].grupo,2);assert.equal(next.semanas[0].manualGroup,true);assert.equal(next.semanas[1].grupo,1);assert.equal(period.semanas[0].grupo,1)
 assert.throws(()=>replaceCleaningGroup({...period,publicado:true},0,2,config,central),/Reabra/)
})
test('edição e histórico são atômicos; conflito e no-op não criam evento',()=>{
 const root=fixture(),path='tarefas/scale/periods/2026-10/meetings/a/assignments/mic1'
 const next=auditedWrite(root,path,'PUT','p2',true,'p1',entry)
 assert.equal(next.tarefas.scale.periods['2026-10'].meetings.a.assignments.mic1,'p2')
 assert.equal(next[ACTIVITY_ROOT].tarefas['event-1'].actorId,'u1');assert.equal(root[ACTIVITY_ROOT],undefined)
 assert.equal(auditedWrite(next,path,'PUT','p3',true,'p1',{...entry,id:'event-2'}),undefined)
 const noop=auditedWrite(next,path,'PUT','p2',true,'p2',{...entry,id:'event-2'})
 assert.equal(Object.keys(noop[ACTIVITY_ROOT].tarefas).length,1)
})
test('histórico não armazena valores sensíveis e é privado até para API genérica Admin',()=>{
 const next=auditedWrite({usuarios:{u:{senha:'antiga'}}},'usuarios/u','PATCH',{senha:'nova-secreta'},false,undefined,entry)
 assert.ok(!JSON.stringify(next[ACTIVITY_ROOT]).includes('nova-secreta'))
 assert.equal(canAccessData(ACTIVITY_ROOT,{mestre:true},false),false)
 assert.equal(containsPrivateRoot({[ACTIVITY_ROOT]:{}}),true)
 assert.equal(withoutPrivateRoots(next)[ACTIVITY_ROOT],undefined)
 assert.equal(activityAllowed(apps,'oradores'),false);assert.equal(activityAllowed(apps,'tarefas'),true)
})
test('restauração Admin preserva histórico privado; edição comum respeita publicação',()=>{
 const root=fixture();root[ACTIVITY_ROOT]={mestre:{old:{...entry,id:'old',module:'mestre'}}}
 const next=auditedWrite(root,'','PATCH',{master:{pessoas:people}},false,undefined,entry)
 assert.ok(next[ACTIVITY_ROOT].mestre.old)
 root.tarefas.scale.periods['2026-10'].locked=true
 assert.equal(auditedWrite(root,'tarefas/scale/periods/2026-10','DELETE',null,false,undefined,entry),undefined)
 const restored=auditedWrite(root,'','PATCH',{tarefas:{scale:{periods:{}}}},false,undefined,entry)
 assert.ok(restored[ACTIVITY_ROOT].mestre.old)
})
test('PATCH misto separa histórico de Oradores e Tarefas',()=>{
 const next=auditedWrite(fixture(),'tarefas','PATCH',{'discursos/temas/t':{titulo:'Tema'},'planning/periodMode':'month'},false,undefined,entry)
 assert.deepEqual(next[ACTIVITY_ROOT].oradores['event-1'].paths,['tarefas/discursos/temas/t'])
 assert.deepEqual(next[ACTIVITY_ROOT].tarefas['event-1'].paths,['tarefas/planning/periodMode'])
})
test('histórico retém 500 eventos recentes por módulo sem apagar outros módulos',()=>{
 const entries=Object.fromEntries(Array.from({length:500},(_,i)=>['e'+i,{...entry,id:'e'+i,at:'2026-09-01T12:00:00Z'}]))
 const root={[ACTIVITY_ROOT]:{tarefas:entries,mestre:{admin:entry}}}
 const next=appendActivity(root,{...root,changed:true},entry)
 assert.equal(Object.keys(next[ACTIVITY_ROOT].tarefas).length,500);assert.ok(next[ACTIVITY_ROOT].tarefas[entry.id]);assert.ok(next[ACTIVITY_ROOT].mestre.admin)
})

test('API filtra histórico antes da leitura e recusa módulo alheio, escrita e sessão ausente',async()=>{
 const reads=[],session=async()=>({usuario:{apps}})
 const database=()=>({ref:path=>({get:async()=>{reads.push(path);return {val:()=>({e:{...entry,paths:['tarefas/scale']}})}}})})
 const invoke=(query='',method='GET',sessionFor=session)=>activityResponse(new Request('https://app.test/activity'+query,{method}),sessionFor,database)
 assert.equal((await invoke('?module=oradores')).status,403);assert.equal(reads.length,0)
 assert.equal((await invoke('','POST')).status,405)
 assert.equal((await invoke('','GET',async()=>null)).status,401)
 const response=await invoke();assert.equal(response.status,200);assert.deepEqual(reads,[ACTIVITY_ROOT+'/tarefas']);assert.equal((await response.json()).entries.length,1)
})
test('API usa ator da sessão e preserva dados/histórico quando a gravação falha',async()=>{
 let root=fixture(),fail=false
 const session=async()=>({uid:'real-user',csrf:'csrf',usuario:{nome:'Responsável real',apps}})
 const database=()=>({ref:()=>({transaction:async fn=>{
  if(fail)throw Error('network')
  fn(null);const next=fn(structuredClone(root))
  if(next===undefined)return {committed:false}
  root=next;return {committed:true}
 }})})
 const invoke=(body,csrf='csrf',path='tarefas/people/p1/name')=>databaseResponse(new Request('https://app.test/database?path='+encodeURIComponent(path),{method:'PUT',headers:{'content-type':'application/json','x-noroeste-csrf':csrf},body:JSON.stringify(body)}),database,session)
 assert.equal((await invoke({value:'Alterado'},'errado')).status,403)
 assert.equal((await invoke({value:{forjado:true}},'csrf',ACTIVITY_ROOT)).status,403)
 fail=true;assert.equal((await invoke({value:'Alterado'})).status,503);assert.equal(root[ACTIVITY_ROOT],undefined)
 fail=false;assert.equal((await invoke({value:'Alterado',actorId:'forjado'})).status,200)
 const recorded=Object.values(root[ACTIVITY_ROOT].tarefas)[0]
 assert.equal(recorded.actorId,'real-user');assert.equal(recorded.actorName,'Responsável real')
 assert.ok(!JSON.stringify(recorded).includes('Alterado'));assert.equal(Object.keys(root[ACTIVITY_ROOT].tarefas).length,1)
})

test('atualização de grupos é atribuída à Limpeza sem duplicar evento em Admin',()=>{
 const next=auditedWrite(fixture(),'master/pessoas','PATCH',{'m1/limpeza/grupo':2},false,undefined,{...entry,module:'limpeza'})
 assert.ok(next[ACTIVITY_ROOT].limpeza);assert.equal(next[ACTIVITY_ROOT].mestre,undefined)
})
