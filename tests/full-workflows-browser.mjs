// All writes stay in this in-memory fixture. External navigation/messages are blocked.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { databaseResponse } from '../netlify/functions/database.ts'
import { activityResponse } from '../netlify/functions/activity.ts'
import { sourceHash, publicationVersion, transitionPublication } from '../netlify/lib/publication-transition.ts'
import { officialDocumentId } from '../src/modules/agenda-documents-domain.ts'
import { periodIsPublished } from '../src/modules/publication-contract.ts'
import { quadroEvents,quadroNotices } from '../src/modules/quadro-domain.ts'
const month='2026-10',origin=process.env.APP_TEST_URL
const fixture=()=>({
 master:{pessoas:Object.fromEntries(['Ana Um','Bruno Dois','Caio Tres','Davi Quatro'].map((name,i)=>['m'+(i+1),{name,active:true,sex:'M',role:'anciao',whatsapp:'5585999999999'}])),config:{congregacao:{nome:'Noroeste'},reunioes:{meiaDeSemana:{diaSemana:3,horario:'19:30'},fimDeSemana:{diaSemana:6,horario:'19:15'}}}},
 usuarios:{u:{nome:'Ana Um',masterId:'m1',senha:'senha-fixture',ativo:true,apps:{mestre:true,tarefas:true,escala:true,oradores:true,oradoresS1:true}}},
 tarefas:{people:{p1:{masterId:'m1',active:true,weekendSection:'s1',roles:{microfone:true,leitor:true,presidente:true}},p2:{masterId:'m2',active:true,weekendSection:'s2',roles:{microfone:true,leitor:true,presidente:true}}},planning:{periodMode:'month',editingPeriod:month,enableSection1:true,s1Time:'17:00',s2Time:'19:15',meetingDays:{midweekDow:3,weekendDow:6,weekendS1Dow:6}},scale:{periods:{[month]:{locked:false,meetings:{a:{date:'2026-10-03',type:'weekend_s1',assignments:{presidente:'p1'}},b:{date:'2026-10-03',type:'weekend',assignments:{presidente:'p2'}}}}}},events:{e:{data:'2026-11-01',titulo:'Evento de teste',tipo:'informativo'}},discursos:{
 oradores:{o1:{nome:'Ana Um',masterId:'m1',tipo:'local',secao:'s1',ativo:true,temaIds:['t']},o2:{nome:'Bruno Dois',masterId:'m2',tipo:'local',secao:'s2',ativo:true,temaIds:['t']}},temas:{t:{numero:1,titulo:'Tema de teste',ativo:true}},congregacoes:{l1:{nome:'Noroeste · 1ª seção',tipo:'local',secao:'s1',ativa:true,horario:'17:00'},l2:{nome:'Noroeste · 2ª seção',tipo:'local',secao:'s2',ativa:true,horario:'19:15'},v:{nome:'Visitante',tipo:'visitante',ativa:true,telefone:'5585999999999',diaReuniao:'Sábado',horario:'18:00',localizacao:'Rua de Teste, 1'}},programacao:{a:{data:'2026-10-03',tipo:'discurso_local',secao:'s1',oradorId:'o1',temaId:'t',localCongregacaoId:'l1'},b:{data:'2026-10-03',tipo:'discurso_local',secao:'s2',oradorId:'o2',temaId:'t',localCongregacaoId:'l2'},out:{data:'2026-11-07',tipo:'saida_orador',secao:'s1',oradorId:'o1',congregacaoDestinoId:'v',temaId:'t'}}}},
 escala:{participants:{p1:{masterId:'m1',active:true},p2:{masterId:'m2',active:true}},scales:{l:{name:'Local de teste',active:true,daysActive:[6],slots:['09:00']}},availability:{l:{p1:{'6|09:00':true},p2:{'6|09:00':true}}},tables:{l:{[month]:{slots:['09:00'],rows:{'2026-10-03':{dow:6,slots:{'09:00':{p1:'p1',p2:'p2'}}}}}}}},
 agenda:{config:{},documentos:{}}
})
const browser=await chromium.launch({channel:'msedge',headless:true})
let data=fixture(),session={uid:'u',csrf:'a'.repeat(48),usuario:data.usuarios.u},failWrite=false
const requests=[],errors=[],downloads=[]
const database=()=>({ref:path=>({get:async()=>{const v=path.split('/').filter(Boolean).reduce((x,k)=>x?.[k],data)??null;return{exists:()=>v!==null,val:()=>structuredClone(v)}},transaction:async fn=>{if(failWrite)throw Error('Falha simulada');fn(null);const next=fn(structuredClone(data));if(next===undefined)return{committed:false};data=next;return{committed:true}}})})
const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block',acceptDownloads:true,permissions:['clipboard-read','clipboard-write']})
await context.addInitScript(()=>{
 localStorage.setItem('noroeste_oradores_month','2026-10')
 Object.defineProperty(window,'open',{value:url=>{window.__externalLinks??=[];window.__externalLinks.push(String(url));return null}})
})
const page=await context.newPage()
page.setDefaultTimeout(5000)
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
page.on('download',async download=>{const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);downloads.push({name:download.suggestedFilename(),bytes:Buffer.concat(chunks)})})
await page.clock.setFixedTime(new Date('2026-10-01T12:00:00-03:00'))
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),endpoint=url.pathname.split('/').pop()
 if(url.origin!==new URL(origin).origin)return route.abort()
 if(!url.pathname.startsWith('/.netlify/functions/'))return route.continue()
 requests.push({endpoint,method:req.method()})
 if(endpoint==='auth-session')return route.fulfill({json:session})
 if(endpoint==='auth-users'){
  if(req.method()==='GET')return route.fulfill({json:data.usuarios})
  const id=url.searchParams.get('id'),body=req.postDataJSON()
  if(req.method()==='DELETE')delete data.usuarios[id];else data.usuarios[id]=body.value
  return route.fulfill({json:{ok:true}})
 }
 if(endpoint==='module-publication'){
  const b=req.postDataJSON(),key=officialDocumentId(b.module,b.periodId)
  if(b.action==='status')return route.fulfill({json:{hash:sourceHash(data,b.module,b.periodId),document:data.agenda.documentos[key]??null,published:periodIsPublished(data,b.module,b.periodId)}})
  if(b.action==='prepare')return route.fulfill({json:{root:data,hash:sourceHash(data,b.module,b.periodId),version:publicationVersion(data,b.module,b.periodId),previous:data.agenda.documentos[key]??null}})
  const next=transitionPublication(data,b.module,b.periodId,b.hash,b.previous,b.document,b.version)
  if(!next)return route.fulfill({status:409,json:{error:'Conflito'}})
  data=next;return route.fulfill({json:{ok:true}})
 }
 if(endpoint==='storage-file')return route.fulfill({json:{url:origin+'fixture.pdf'}})
 if(endpoint==='pdf-maintenance')return route.fulfill({json:{checkedAt:new Date().toISOString(),health:{database:'ok',storage:'ok',version:'fixture'},files:[]}})
 if(endpoint==='quadro-data')return route.fulfill({json:{events:quadroEvents(data,undefined,'2026-10-01'),notices:quadroNotices(data,'2026-10-01'),agenda:data.agenda,completedSources:['tarefas','oradores','escala','geral','quadro'],failedSources:[]}})
 if(endpoint==='congregation-geocode')return route.fulfill({status:503,json:{error:'Busca indisponível no teste'}})
 const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='GET'?{}:{body:req.postData()})})
 const response=endpoint==='activity'?await activityResponse(request,async()=>session,database):await databaseResponse(request,database,async()=>session)
 return route.fulfill({status:response.status,body:await response.text(),headers:{'content-type':'application/json'}})
})
const click=async selector=>{const target=page.locator(selector).first();await target.waitFor({state:'attached'});for(let i=0;i<4;i++){const hidden=target.locator('xpath=ancestor::details[not(@open)]').first();if(!await hidden.count())break;await hidden.locator(':scope > summary').click()}await target.click()}
const tab=async id=>{await page.locator(`[data-workspace-tab="${id}"]`).last().click()}
const go=async module=>{await page.goto(new URL(`/modulos/${module}/`,origin).href);await page.locator(`[data-workspace-tab]`).first().waitFor()}
const noModal=()=>page.locator('.modal-overlay').waitFor({state:'detached'})
try{
 await go('mestre');await tab('pessoas')
 assert.deepEqual(await page.locator('.workspace-tabs button').allTextContents(),['Pessoas','Acessos','Avançado'])
 await click('#btnAddPessoa');await click('#btnSalvarPessoa');assert.equal(await page.locator('#pNome').count(),1)
 await page.locator('#pNome').fill('Pessoa Teste');await click('#btnSalvarPessoa');await noModal()
 const mid=Object.keys(data.master.pessoas).find(id=>data.master.pessoas[id].name==='Pessoa Teste');assert.ok(mid)
 await click(`[data-edit-pessoa="${mid}"]`);await page.locator('#pNome').fill('Pessoa Editada');await click('#btnSalvarPessoa');await noModal();assert.equal(data.master.pessoas[mid].name,'Pessoa Editada')
 await click(`[data-del-pessoa="${mid}"]`);await page.waitForFunction(()=>!document.body.innerText.includes('Pessoa Editada'));assert.equal(data.master.pessoas[mid],undefined)
 await tab('usuarios');await click('#btnAddUsuario');await click('#btnSalvarUsuario');await page.locator('#uMasterId').selectOption('m3');await page.locator('#uSenha').fill('senha-fixture-2');await page.locator('#uApp_oradoresS1').check();await click('#btnSalvarUsuario');await noModal();assert.equal(data.usuarios.m3.apps.oradoresS1,true)
 await click('[data-edit-usuario="m3"]');await click('#btnCancelUsuario');await click('[data-del-usuario="m3"]');await page.locator('[data-del-usuario="m3"]').waitFor({state:'detached'})
 await tab('config');await click('#btnSalvarCong');await click('[data-cfg-sec="agenda"]');await click('#btnSalvarAgendaConfig')
 await tab('vinculos');await click('#btnRefreshLinks');await click('#btnExportLinkFailures');await click('#copyLinkFailureReport');await click('#downloadLinkFailureReport');await click('#closeLinkFailureReport')
 await tab('dados');await click('#btnDownloadBackup')
 await tab('saude');await click('#refreshPdfInventory')
 console.log('Admin: criar/editar/remover pessoa e acesso, validações, configurações, vínculos, relatório, backup e saúde OK')
 for(const [module,section,local] of [['oradoresS1','s1','l1'],['oradores','s2','l2']]){
  await go(module);assert.deepEqual(await page.locator('.workspace-tabs button').allTextContents(),['Programação','Oradores','Intercâmbio','Mais opções']);await tab('congregacoes');await page.locator('#congregationContext').selectOption(local);await click('[data-edit-congregation]');await click('#deleteCongregation');assert.match(await page.locator('#toast').innerText(),/vínculos/);assert.ok(data.tarefas.discursos.congregacoes[local]);await click('#cancelCongregationEdit')
  await click('#newCongregation');await page.locator('#congregationForm [name="nome"]').fill('Duplicada');await page.locator('#congregationForm [name="tipo"]').selectOption('local');await click('#congregationForm .btn-primary');assert.match(await page.locator('[data-form-error]').innerText(),/Já existe/);await click('#cancelCongregationEdit')
  await click('#newCongregation');await page.locator('#congregationForm [name="nome"]').fill('Congregação teste');await click('#congregationForm .btn-primary');await page.locator('#congregationForm').waitFor({state:'detached'});await click('[data-edit-congregation]');await click('#deleteCongregation');await page.locator('#congregationForm').waitFor({state:'detached'})
  await tab('temas');await click('#newTheme');await page.locator('#themeForm [name="numero"]').fill('999');await page.locator('#themeForm [name="titulo"]').fill('Tema teste adicional');await click('#themeForm .btn-primary');await page.locator('#themeForm').waitFor({state:'detached'});const tid=Object.keys(data.tarefas.discursos.temas).find(id=>data.tarefas.discursos.temas[id].numero===999);assert.ok(tid)
  await click(`[data-edit-theme="${tid}"]`);await click('#deleteTheme');await page.locator('#themeForm').waitFor({state:'detached'})
  for(const filter of ['all','available','pending','used'])await click(`[data-theme-filter="${filter}"]`)
  await click('#themesPdf')
  await tab('eventos');await click('#newSpeakerEvent');await page.locator('#speakerEventForm [name="data"]').fill('2026-12-10');await page.locator('#speakerEventForm [name="titulo"]').fill('Evento criado');await click('#speakerEventForm .btn-primary');await page.locator('#speakerEventForm').waitFor({state:'detached'});const eid=Object.keys(data.tarefas.events).find(id=>data.tarefas.events[id].titulo==='Evento criado');await click(`[data-edit-event="${eid}"]`);await click('#deleteEvent');await page.locator('#speakerEventForm').waitFor({state:'detached'})
  await tab('programacao');await click('#speakerSchedulePdf');await click('#speakerSchedulePublish');await page.waitForFunction(()=>document.querySelector('[data-publication-state]')?.textContent.includes('Publicado e atualizado'))
  const own=section==='s1'?'a':'b'
  await click(`[data-edit-schedule="${own}"]`);await click('#cancelScheduleEdit')
  await click(`[data-confirm-schedule="${own}"]`);await page.locator(`[data-confirm-schedule="${own}"]`).filter({hasText:'Desfazer'}).waitFor();await click(`[data-reconfirm-schedule="${own}"]`);await page.locator(`[data-reconfirm-schedule="${own}"]`).filter({hasText:'Desfazer'}).waitFor({state:'attached'})
  for(const filter of ['speaker','theme','confirm','reconfirm',''])await click(`[data-schedule-filter="${filter}"]`)
  await click('#newSchedule');await click('#cancelScheduleEdit')
  await click('#fillScheduleDates');await page.waitForFunction(()=>document.querySelectorAll('[data-edit-schedule]').length>=5)
  assert.equal(Object.values(data.tarefas.discursos.programacao).filter(p=>p.secao===section&&p.data.startsWith(month)&&p.tipo!=='saida_orador').length,5)
  await tab('oradores');await click('[data-edit-speaker]');await click('#cancelSpeakerEdit');await click('#newSpeaker');await click('#cancelSpeakerEdit')
  await click('[data-notify-speaker]');assert.match(await page.locator('#oradoresMessagePreview textarea').inputValue(),/🎙️|📖/);await click('#oradoresMessagePreview [data-copy]');await click('#oradoresMessagePreview [data-open]');await click('#oradoresMessagePreview [data-close]')
  await click(`#moduleMessage_${module}_save`);await page.locator('#toast').filter({hasText:'Mensagem do módulo salva'}).waitFor()
  await tab('congregacoes');await page.locator('#congregationContext').selectOption('v');await click('[data-available-date]');await click('#sendAvailableDates');await click('#oradoresMessagePreview [data-copy]');await click('#oradoresMessagePreview [data-close]')
  await tab('programacao');await click('#findSpeakerSubstitute');await tab('programacao');assert.equal(await page.locator('[data-workspace-tab="pendencias"],[data-workspace-tab="emergencia"],[data-notify-schedule],#oradoresMessageSettings').count(),0)
  console.log(module+': cadastros compartilhados, local protegido, duplicação recusada, datas da própria seção e publicação conjunta OK')
 }
 // Reload and module changes must keep optional panels/filters without database writes.
 const beforePreferences=structuredClone(data)
 await go('oradoresS1');await page.locator('[data-schedule-filter="confirm"]').click();await page.locator('#scheduleOnlyFuture').check()
 const optional=page.locator('[data-ui-preference="schedule-options"]')
 if(!await optional.evaluate(el=>el.open))await optional.locator('summary').click()
 await page.reload();await page.locator('#speakerSchedulePdf').waitFor()
 assert.equal(await optional.evaluate(el=>el.open),true)
 assert.equal(await page.locator('#scheduleOnlyFuture').isChecked(),true)
 assert.equal(await page.locator('[data-schedule-filter="confirm"]').getAttribute('aria-pressed'),'true')
 await optional.locator('summary').click();await page.reload();await page.locator('#speakerSchedulePdf').waitFor();assert.equal(await optional.evaluate(el=>el.open),false)
 await tab('congregacoes');await page.locator('#congregationContext').selectOption('v');await click('#availableHorizon');await page.locator('#availableHorizon').selectOption('180')
 await page.reload();await page.locator('#speakerSchedulePdf').waitFor();await tab('congregacoes');assert.equal(await page.locator('#availableHorizon').inputValue(),'180')
 await go('oradores');await page.locator('#speakerSchedulePdf').waitFor();assert.equal(await page.locator('#scheduleOnlyFuture').isChecked(),false)
 assert.equal(await page.locator('[data-schedule-filter=""]').getAttribute('aria-pressed'),'true')
 assert.deepEqual(data,beforePreferences)
 console.log('Preferências: painéis, filtros e prazo persistem após reload; seções isoladas e banco inalterado OK')
 await go('tarefas');await tab('escala');await click('#btnTarefasPdf');await click('#btnToggleTaskLock');await page.waitForFunction(()=>document.querySelector('#btnToggleTaskLock')?.textContent.includes('Reabrir'));assert.equal(data.tarefas.scale.periods[month].locked,true)
 assert.deepEqual(await page.locator('.workspace-tabs button').allTextContents(),['Escala','Pessoas','Mais opções'])
 await click('#btnToggleTaskLock');await page.waitForFunction(()=>document.querySelector('#btnToggleTaskLock')?.textContent.includes('Publicar'));assert.equal(data.tarefas.scale.periods[month].locked,false)
 await click('#btnClearTaskRole');await page.locator('#tarefasGenerateRole').selectOption('presidente');await click('#btnClearTaskRole');await page.locator('#toast').filter({hasText:/limpa|removida/i}).waitFor();await click('#btnGenerateTaskRole');await page.locator('#btnGenerateScale').waitFor()
 await tab('participantes');await click('#btnAddTaskPerson');await click('#cancelTaskPerson');await click('[data-edit-task-person]');await click('#saveTaskPerson');await page.locator('#saveTaskPerson').waitFor({state:'detached'});await click('#taskReviewAvailability')
 await tab('config');await click('#saveTaskRules');await click('#restoreTaskRules');await page.getByText('Datas sem reunião',{exact:true}).click();await page.locator('#taskExcludedDate').fill('2026-10-31');await click('#addTaskExcludedDate');await click('[data-remove-task-date]')
 await click('#moduleMessage_tarefas_save');await page.locator('#toast').filter({hasText:'Mensagem do módulo salva'}).waitFor()
 console.log('Tarefas: PDF, publicar/reabrir, geração por função, pessoas, disponibilidade e regras OK')
 await go('escala');await tab('escalaAtual');await click('#sPdf');await click('#sPublish');await page.getByRole('button',{name:'Reabrir para edição',exact:true}).click();await page.locator('#sPublish').waitFor();await click('#scaleToday')
 assert.deepEqual(await page.locator('.workspace-tabs button').allTextContents(),['Escala','Pessoas','Mais opções'])
 await tab('participantes');await click('[data-person-availability="p1"]');await page.locator('[data-avail]').first().uncheck();await page.locator('#availabilitySaveStatus').filter({hasText:'Disponibilidade salva'}).waitFor();assert.equal(data.escala.availability.l.p1?.['6|09:00'],undefined)
 failWrite=true;await page.locator('[data-avail]').first().check();await page.locator('#availabilitySaveStatus').filter({hasText:'Não foi possível salvar'}).waitFor();assert.equal(await page.locator('[data-avail]').first().isChecked(),false)
 failWrite=false;await click('[data-aday]');await page.locator('#availabilitySaveStatus').filter({hasText:'Disponibilidade salva'}).waitFor();await click('[data-atime]');await page.locator('#availabilitySaveStatus').filter({hasText:'Disponibilidade salva'}).waitFor();await click('#closePersonAvailability');assert.equal(await page.locator('#pList').count(),1)
 await click('#pNew');await click('#pmCancel');await click('[data-person="p1"]');await click('#pmSave');await noModal()
 await click('[data-person-confirmation="p1"]');await click('#mConfirmDone');await page.locator('#toast').filter({hasText:'Disponibilidade revisada hoje'}).waitFor();await click('#mCopy');await click('#mWhats')
 await tab('config');await tab('locais');await click('#lNew');await page.locator('#lmName').fill('Local extra');await page.locator('[data-lmday="6"]').check();await click('#lmSave');await noModal();const lid=Object.keys(data.escala.scales).find(id=>data.escala.scales[id].name==='Local extra');await click(`[data-local="${lid}"]`);await click('#lmDelete');await noModal()
 await tab('config');await click('#cSave');await click('#saveScaleRules');await click('#restoreScaleRules');await page.locator('#cExclusion').fill('2026-10-31');await click('#cAddExclusion');await click('[data-remove-exclusion]')
 console.log('TPL: PDF, publicar/reabrir, local criar/excluir, regras e exceções OK')
 await page.goto(new URL('/quadro/',origin).href);await click('#quadroPrev');await click('#quadroNext');await click('#quadroToday');for(const f of ['tarefas','escala','s1','s2','todos'])await click(`[data-quadro-filter="${f}"]`)
 await click('[data-quadro-tab="geral"]');await page.locator('details summary').click();await click('#quadroCopy')
 assert.deepEqual(errors,[])
 assert.ok(downloads.filter(d=>d.bytes.subarray(0,4).toString()==='%PDF').length>=6)
 console.log('Quadro: navegação, filtros e cópia OK. '+requests.length+' chamadas simuladas; nenhuma gravação remota.')
}catch(error){console.error('Tela no erro:',(await page.locator('body').innerText()).slice(-3500));throw error}
finally{await browser.close()}
