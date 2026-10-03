import { fieldHelp } from '../ui/field-guidance'
import { localPreferences, persistDisclosures } from '../ui/local-preferences'
import { mountRecordEditor } from '../ui/record-editor'
import { fortalezaToday, fortalezaCurrentMonth } from './civil-date'
import { availableDates } from './oradores-available'
import { assignmentEntries, assignmentsMessage, exchangesMessage, availableMessage, scheduleCardText } from './oradores-messages'
import { cleanAddress } from './agenda-location'
import { congregationInUse, localSpeakerOriginName } from './oradores-congregations'
import { apiJson, ApiError } from '../secure-api'
import { publishModulePeriod, renderPublicationStatus } from './module-publication'
import type { AppContext } from '../types'
import { agendaConfigRef, child, compareAndSet, get, oradoresCadastroRef, oradoresCongregacoesRef, oradoresEventosRef, oradoresProgramacaoRef, oradoresRef, oradoresTemasRef, set, pessoasRef, tarefasScaleRef, tarefasPeopleRef, tarefasPlanejamentoRef, update } from '../firebase'
import { renderWorkspaceNav } from '../ui/workspace-nav'
import { moduleBackButton } from '../ui/module-header'
import { lockPublicationUi } from '../ui/publication-busy'
import { defaultModuleMessageSettings, mountModuleMessageSettings, type ModuleMessageSettings } from './module-message-settings'
import {
  EVENT_KIND_LABEL, SPEAKER_ROLE_LABEL, TALK_KIND_LABEL,
  formatSpeakerDate, monthBounds, newSpeakerId, normalizeSpeakerEvents, normalizeSpeakersRoot,
  phoneDigits, sameMonth, scheduleCongregationId, scheduleCongregationName, exchangeReady,
  validIsoDate, scheduleBaseForEdit, isDuplicateSchedule,
  type Speaker, type SpeakerCongregation, type SpeakerEvent, type SpeakerEventKind,
  type SpeakersRoot, type TalkKind, type TalkSchedule, type TalkTheme, type SpeakerSection,
} from './oradores-domain'

import { canonicalSpeaker, resolveSpeakerMasterId, repertoireNumbers, parseRepertoire, matchesSpeaker, speakerConflicts, type CentralPerson, type LinkedPerson } from './oradores-editor-domain'

import { filteredThemeRows, themeUsageIndex, themeDate, THEME_FILTER_LABELS, type ThemeFilter } from './oradores-themes'
import { downloadPdf } from '../ui/pdf-download'
import { copyMessageText, openMessageWhatsApp } from '../ui/message-actions'
let themeFilter:ThemeFilter='available'
let themeQuery=''

type Screen = 'programacao' | 'temas' | 'eventos' | 'oradores' | 'congregacoes'
type Planning = { meetingDays?:{ weekendDow?:number; weekendS1Dow?:number }; excludedDates?:string[]; enableSection1?:boolean; s1Time?:string; s2Time?:string }
type TaskPerson = LinkedPerson & {name?:string;active?:boolean}

let appContext: AppContext
let selectedSection:SpeakerSection='s2'
const messageSettingsModule=() => selectedSection==='s1'?'oradoresS1' as const:'oradores' as const
let masterPeople:Record<string,CentralPerson>={}
let rawSpeakers:Record<string,Speaker>={}
let speakerBaseline:Record<string,unknown>|null=null
let taskPeriods:Record<string,unknown>={}
let speakerQuery=''
let scheduleQuery=''
let scheduleFilter=''
let onlyFuture=false
let dirty=false
let saving=false
let guardController:AbortController|undefined
const today = fortalezaToday
const canEditPeople = ():boolean => Boolean(appContext.usuario.apps.mestre || (selectedSection==='s1' ? appContext.usuario.apps.oradoresS1 : appContext.usuario.apps.oradores))
const canEditShared = ():boolean => canEditPeople()
const canReadTasks = ():boolean => Boolean(appContext.usuario.apps.mestre || appContext.usuario.apps.tarefas || appContext.usuario.apps.oradores || appContext.usuario.apps.oradoresS1)
function allowLeave():boolean {
  if (saving) { toast('Aguarde o salvamento.'); return false }
  if (dirty && !confirm('Há alterações não salvas. Deseja descartá-las?')) return false
  dirty=false
  return true
}
function formError(form:HTMLFormElement,message:string):void {
  let box=form.querySelector<HTMLElement>('[data-form-error]')
  if (!box) { box=document.createElement('p');box.dataset.formError='';box.className='notice warning';box.setAttribute('role','alert');form.prepend(box) }
  box.textContent=message
}
function freezeForm(form:HTMLFormElement):()=>void {
  const controls=[...form.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|HTMLButtonElement>('input,select,textarea,button')]
  const disabled=controls.map(control=>control.disabled)
  controls.forEach(control=>{control.disabled=true})
  const submit=form.querySelector<HTMLButtonElement>('[type="submit"]'),label=submit?.textContent
  if(submit)submit.textContent='Salvando…'
  return ()=>{controls.forEach((control,index)=>{control.disabled=disabled[index]!});if(submit)submit.textContent=label??'Salvar'}
}
function installEditGuard():void {
  guardController?.abort(); guardController=new AbortController()
  const options={signal:guardController.signal}
  document.addEventListener('input',event=>{if((event.target as HTMLElement)?.closest('#oradoresRoot form')&&!(event.target as HTMLElement).matches('[data-person-search]'))dirty=true},options)
  document.addEventListener('change',event=>{if((event.target as HTMLElement)?.closest('#oradoresRoot form'))dirty=true},options)
  document.addEventListener('click',event=>{
    if (!document.getElementById('oradoresRoot')) return
    const button=(event.target as HTMLElement)?.closest('button')
    if (!button || !button.matches('[data-workspace-tab], [data-module-index], #btnBack, #btnSair, [id^="cancel"], [id^="new"], [data-edit-speaker], [data-edit-schedule], [data-edit-theme], [data-edit-congregation], [data-edit-event], #clearScheduleFilters, #fillScheduleDates, #oradoresPrev, #oradoresNext')) return
    if (!allowLeave()) {event.preventDefault();event.stopImmediatePropagation()}
  },{...options,capture:true})
  window.addEventListener('beforeunload',event=>{if(document.getElementById('oradoresRoot')&&(dirty||saving)){event.preventDefault();event.returnValue=''}},options)
}
function hydrateSpeakers():void { data.oradores=Object.fromEntries(Object.entries(rawSpeakers).map(([id,item])=>[id,canonicalSpeaker(item,masterPeople,taskPeople)])) }

let screen: Screen = 'programacao'
let data: SpeakersRoot = {}
let events: Record<string, SpeakerEvent> = {}
let planning: Planning = {}
let taskPeople: Record<string, TaskPerson> = {}
let selectedMonth = fortalezaCurrentMonth()
let preferences: ReturnType<typeof localPreferences>
let stopDisclosures: (() => void) | undefined
let editingId = ''
let rawSchedule:Record<string, unknown> = {}
let scheduleDraft: Record<string, string> | null = null
let selectedCongregationId = ''
let loadPromise: Promise<boolean> | null = null
let downloadingPdf = false
let publishingPdf = false
let messageSettings = defaultModuleMessageSettings('oradores')

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char] ?? char))
const root = (): HTMLElement => document.getElementById('oradoresRoot')!
const speakers = (): Record<string, Speaker> => data.oradores ?? {}
const themes = (): Record<string, TalkTheme> => data.temas ?? {}
const congregations = (): Record<string, SpeakerCongregation> => data.congregacoes ?? {}
const schedule = (): Record<string, TalkSchedule> => data.programacao ?? {}
const toast = (message: string): void => { const element=document.getElementById('toast'); if (!element) return; element.textContent=message; element.classList.add('show'); setTimeout(()=>element.classList.remove('show'), 3000) }
const option = (value:string, label:string, selected:string): string => `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`
const field = (label:string, control:string, help=''): string => `<label class="form-field"><span>${esc(label)}</span>${control}${help ? `<small>${esc(help)}</small>` : ''}</label>`
const sectionTitle = (title:string): string => `<div class="module-section-title">${screen === 'programacao' ? '' : moduleBackButton()}<h2>${esc(title)}</h2></div>`
const empty = (message:string): string => `<p class="empty-state">${esc(message)}</p>`
const isoNow = (): string => new Date().toISOString()

export default function mount(context: AppContext): void {
  selectedSection=context.oradoresSection??'s2'
  preferences=localPreferences(context.uid,messageSettingsModule())
  let legacyMonth=fortalezaCurrentMonth()
  try{legacyMonth=localStorage.getItem('noroeste_oradores_month')??legacyMonth}catch{/* storage opcional */}
  const month=preferences.get('month',legacyMonth)
  selectedMonth=context.overview?.month??(/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:fortalezaCurrentMonth())
  preferences.set('month',selectedMonth)
  appContext=context;themeFilter='available';themeQuery='';dirty=false;saving=false;masterPeople={};rawSpeakers={};taskPeriods={};speakerQuery='';scheduleQuery='';scheduleFilter='';onlyFuture=false;installEditGuard()
  const savedFilter=preferences.get('scheduleFilter','')
  scheduleFilter=['','speaker','theme'].includes(savedFilter)?savedFilter:''
  onlyFuture=preferences.get('onlyFuture',false)
  const savedTheme=preferences.get('themeFilter','available')
  themeFilter=Object.prototype.hasOwnProperty.call(THEME_FILTER_LABELS,savedTheme)?savedTheme as ThemeFilter:'available'
  selectedCongregationId=preferences.get('congregation','')
  screen='programacao'; editingId=''; scheduleDraft=null; loadPromise=null; data={}; events={}; planning={}; taskPeople={}
  const host=document.getElementById('appContent'); if (!host) return
  host.innerHTML='<div id="oradoresNav"></div><div id="oradoresRoot"></div>'
  stopDisclosures?.()
  stopDisclosures=persistDisclosures(root(),preferences)
  void openScreen('programacao')
}

async function load(): Promise<boolean> {
  try {
    const [rootSnapshot,eventSnapshot,planningSnapshot,peopleSnapshot,messageSnapshot]=await Promise.all([get(oradoresRef), get(oradoresEventosRef), get(tarefasPlanejamentoRef), get(tarefasPeopleRef), get<ModuleMessageSettings>(child(agendaConfigRef,`moduleWhatsApp/${messageSettingsModule()}`))])
    const [centralSnapshot,periodSnapshot]=await Promise.all([get(pessoasRef),canReadTasks()?get(tarefasScaleRef):Promise.resolve(null)])
    masterPeople=centralSnapshot.val() as Record<string,CentralPerson> ?? {}
    taskPeriods=periodSnapshot?.val() as Record<string,unknown> ?? {}
    rawSchedule = (rootSnapshot.val() as SpeakersRoot | null)?.programacao ?? {}
    data=normalizeSpeakersRoot(rootSnapshot.exists()?rootSnapshot.val():{})
    events=normalizeSpeakerEvents(eventSnapshot.exists()?eventSnapshot.val():{})
    planning=planningSnapshot.exists() ? planningSnapshot.val() as Planning : {}
    taskPeople=peopleSnapshot.exists() ? peopleSnapshot.val() as Record<string,TaskPerson> : {}
    speakerBaseline=(rootSnapshot.val() as SpeakersRoot|null)?.oradores??null;rawSpeakers=structuredClone(data.oradores??{});hydrateSpeakers()
    messageSettings={...defaultModuleMessageSettings('oradores'),...(messageSnapshot.exists()?messageSnapshot.val()??{}:{})}
    selectedCongregationId=selectedCongregationId && congregations()[selectedCongregationId] && (congregations()[selectedCongregationId]?.tipo==='visitante'||(congregations()[selectedCongregationId]?.secao??'s2')===selectedSection) ? selectedCongregationId : Object.entries(congregations()).filter(([,item])=>item.tipo==='visitante').sort((a,b)=>a[1].nome.localeCompare(b[1].nome,'pt-BR'))[0]?.[0] ?? ''
    return true
  } catch { toast('Não foi possível carregar Oradores'); return false }
}

async function openScreen(next: Screen): Promise<void> {
  if (!allowLeave()) return
  screen=next; editingId=''; renderNavigation(); root().innerHTML='<p class="empty-state">Carregando dados...</p>'
  loadPromise ??= load()
  const loaded=await loadPromise
  if (!root().isConnected || screen!==next) return
  if (!loaded) { loadPromise=null; root().innerHTML='<p class="empty-state">Não foi possível carregar os dados.</p><button id="retrySpeakers" class="btn btn-primary">Tentar novamente</button>'; document.getElementById('retrySpeakers')?.addEventListener('click',()=>void openScreen(next)); return }
  render()
}

function renderNavigation(): void {
  const host=document.getElementById('oradoresNav'); if (!host) return
  renderWorkspaceNav(host, selectedSection==='s1'?'Oradores · 1ª seção':'Oradores · 2ª seção', 'programacao', screen, [
    { id:'programacao', label:'Programação' },
    { id:'oradores', label:'Oradores' },
    { id:'congregacoes', label:'Intercâmbio' },
    { id:'temas', label:'Mais opções', children:[{id:'temas',label:'Temas'},{id:'eventos',label:'Eventos'}] },
  ], id=>void openScreen(id as Screen))
}

function render(): void {
  renderNavigation()
  if (screen==='programacao') renderSchedule()
  else if (screen==='oradores') renderSpeakers()
  else if (screen==='temas') renderThemes()
  else if (screen==='congregacoes') renderCongregations()
  else if (screen==='eventos') renderEvents()
}

function periodControl(): string {
  return `<div class="agenda-toolbar oradores-period"><button id="oradoresPrev" class="btn btn-ghost" type="button" aria-label="Mês anterior">‹</button><input id="oradoresMonth" class="form-input" type="month" value="${esc(selectedMonth)}"><button id="oradoresNext" class="btn btn-ghost" type="button" aria-label="Próximo mês">›</button></div>`
}
function bindPeriod(): void {
  const move=(delta:number):void=>{ const [year,month]=selectedMonth.split('-').map(Number), date=new Date(Date.UTC(year!,month!-1+delta,1)); selectedMonth=date.toISOString().slice(0,7); preferences.set('month',selectedMonth); renderSchedule() }
  document.getElementById('oradoresPrev')?.addEventListener('click',()=>move(-1)); document.getElementById('oradoresNext')?.addEventListener('click',()=>move(1))
  document.getElementById('oradoresMonth')?.addEventListener('change',event=>{ const value=(event.currentTarget as HTMLInputElement).value; if(!allowLeave()){(event.currentTarget as HTMLInputElement).value=selectedMonth;return} if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) { selectedMonth=value; preferences.set('month',value); renderSchedule() } })
}

function themeChoiceLabel(id:string):string {
  const usage=themeUse(id)
  return usage.nextDate?`Programado para ${themeDate(usage.nextDate)}`:usage.past?`Já usado em ${themeDate(usage.lastPastDate)}`:'Disponível'
}
async function showPublicationStatus():Promise<void> {
  const host=document.getElementById('speakerPublicationStatus')
  if(host){host.textContent='';await renderPublicationStatus(host,'oradores',selectedMonth)}
}

function speakerOptions(selected='', kind?:'local'|'visitante', section:SpeakerSection='s2', allSections=false): string {
  return `<option value="">A definir</option>${Object.entries(speakers()).filter(([id,item])=>(item.ativo || id===selected) && (!kind || item.tipo===kind) && (allSections||item.tipo==='visitante'||(item.secao??'s2')===section||id===selected)).sort((a,b)=>a[1].nome.localeCompare(b[1].nome,'pt-BR')).map(([id,item])=>option(id,item.nome,selected)).join('')}`
}
const scheduleSection=(item:TalkSchedule):SpeakerSection=>(item.tipo==='saida_orador'&&item.oradorId ? speakers()[item.oradorId]?.secao : item.secao)??item.secao??'s2'
const visibleSchedule=(item:TalkSchedule):boolean=>scheduleSection(item)===selectedSection
function congregationOptions(selected=''): string { return `<option value="">A definir</option>${Object.entries(congregations()).filter(([,item])=>item.ativa && item.tipo==='visitante').sort((a,b)=>a[1].nome.localeCompare(b[1].nome,'pt-BR')).map(([id,item])=>option(id,item.nome,selected)).join('')}` }

function scheduleEditor(): string {
  if (!editingId) return ''
  const item=editingId==='new' ? undefined : schedule()[editingId]
  const draft=scheduleDraft, kind=(draft?.['tipo'] as TalkKind|undefined) ?? item?.tipo ?? 'discurso_local', congregationId=draft?.['congregacaoId'] ?? (item ? scheduleCongregationId(item) : '')
  const section=selectedSection
  return `<form id="speakerScheduleForm" class="form-panel"><h3>${item?'Editar programação':'Nova programação'}</h3><div class="module-form-grid">
    ${field('Tipo',`<select name="tipo">${Object.entries(TALK_KIND_LABEL).map(([id,label])=>option(id,label,kind)).join('')}</select>`)}
    <input name="secao" type="hidden" value="${section}">
    ${field('Data',`<input name="data" type="date" value="${esc(draft?.['data'] ?? item?.data ?? `${selectedMonth}-01`)}" required>`)}
    ${field(kind==='discurso_visitante'?'Visitante':'Orador',`<select name="oradorId">${speakerOptions(draft?.['oradorId']??item?.oradorId,kind==='discurso_visitante'?'visitante':'local',section)}</select>`)}
    ${kind==='discurso_visitante' ? field('Nome digitado (se não cadastrado)',`<input name="oradorNome" maxlength="100" value="${esc(draft?.['oradorNome']??item?.oradorNome)}">`) : ''}
    ${kind!=='discurso_local' ? field(kind==='saida_orador'?'Congregação de destino':'Congregação de origem',`<select name="congregacaoId">${congregationOptions(congregationId)}</select>`) : ''}
    ${field('Número do tema',`<input name="themeNumber" type="text" inputmode="numeric" autocomplete="off" value="${esc(draft?.['themeNumber']??themes()[item?.temaId??'']?.numero??item?.temaNumero??'')}" placeholder="Ex.: 25" aria-describedby="scheduleThemePreview"><input name="temaId" type="hidden" value="${esc(draft?.['temaId']??item?.temaId)}">`)}<div id="scheduleThemePreview" class="form-help" aria-live="polite"></div>
  </div><details data-ui-preference="schedule-editor-options" ${draft?.['oradorSecundarioId']||item?.oradorSecundarioId||draft?.['horarioLocal']||item?.horarioLocal||draft?.['observacoes']||item?.observacoes?'open':''}><summary>Mais opções</summary><div class="module-form-grid">
    ${kind==='discurso_local' ? field('Segundo orador',`<select name="oradorSecundarioId">${speakerOptions(draft?.['oradorSecundarioId']??item?.oradorSecundarioId,'local',section)}</select>`) : ''}
    ${kind!=='saida_orador' ? field('Horário local',`<input name="horarioLocal" type="time" value="${esc(draft?.['horarioLocal']??item?.horarioLocal ?? (section==='s1'?planning.s1Time:planning.s2Time) ?? '')}">`) : ''}
    ${field('Observações',`<textarea name="observacoes" maxlength="500">${esc(draft?.['observacoes']??item?.observacoes)}</textarea>`)}
  </div></details><div id="scheduleHints" class="form-help" aria-live="polite"></div><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar</button><button id="cancelScheduleEdit" class="btn btn-ghost" type="button">Cancelar</button>${item?'<button id="deleteSchedule" class="btn btn-danger" type="button">Excluir</button>':''}</div></form>`
}

function scheduleCard(id:string,item:TalkSchedule,showActions=true): string {
  const speaker=speakers()[item.oradorId??'']?.nome?.trim() || item.oradorNome?.trim() || 'Sem orador', theme=themes()[item.temaId??''], congregation=item.tipo==='discurso_local'?localSpeakerOriginName(item,congregations()):congregations()[scheduleCongregationId(item)]?.nome ?? scheduleCongregationName(item)
  const section=` · ${scheduleSection(item)==='s1'?'1ª seção':'2ª seção'}`
  const actions=showActions?`<div class="service-actions"><button class="btn btn-ghost" data-edit-schedule="${esc(id)}" type="button">Editar</button><button class="btn btn-ghost" data-whatsapp-schedule="${esc(id)}" type="button">WhatsApp</button><button class="btn btn-ghost" data-copy-schedule="${esc(id)}" type="button">Copiar texto</button></div>`:''
  return `<article class="oradores-card"><div class="oradores-card-head"><div><strong>${esc(formatSpeakerDate(item.data))}</strong><small>${esc(TALK_KIND_LABEL[item.tipo]+section)}</small></div></div><div class="oradores-card-grid"><div><span>Orador</span><strong>${esc(speaker)}</strong></div><div><span>Tema</span><strong>${esc(theme?`${String(theme.numero).padStart(3,'0')} - ${theme.titulo}`:item.temaTitulo||'Sem tema')}</strong></div>${congregation?`<div><span>Congregação</span><strong>${esc(congregation)}</strong></div>`:''}${item.oradorSecundarioNome?`<div><span>Segundo orador</span><strong>${esc(item.oradorSecundarioNome)}</strong></div>`:''}</div>${actions}</article>`
}

function renderSchedule(): void {
  const monthRows=Object.entries(schedule()).filter(([,item])=>sameMonth(item.data,selectedMonth)&&visibleSchedule(item))
  const hasCombinedPdfRows=Object.values(schedule()).some(item=>sameMonth(item.data,selectedMonth)||(item.tipo==='saida_orador'&&item.data>=`${selectedMonth}-01`))
  const matchesFilter=(item:TalkSchedule,filter:string):boolean=>filter==='speaker'?!item.oradorId&&!item.oradorNome:filter==='theme'?!item.temaId&&!item.temaTitulo:true
  const rows=monthRows.filter(([,item])=>(!onlyFuture||item.data>=today())&&matchesFilter(item,scheduleFilter)&&[`${speakers()[item.oradorId??'']?.nome??item.oradorNome??''}`,themes()[item.temaId??'']?.titulo??item.temaTitulo??'',String(themes()[item.temaId??'']?.numero??item.temaNumero??'')].some(value=>value.toLocaleLowerCase('pt-BR').includes(scheduleQuery.toLocaleLowerCase('pt-BR')))).sort((a,b)=>a[1].data.localeCompare(b[1].data)||a[1].tipo.localeCompare(b[1].tipo))
  root().innerHTML=`${sectionTitle('Programação de oradores')}${periodControl()}<div class="service-actions"><button id="newSchedule" class="btn btn-primary" type="button">Nova programação</button><button id="speakerSchedulePdf" class="btn btn-ghost" type="button" ${hasCombinedPdfRows?'':'disabled'}>Baixar PDF</button><button id="speakerScheduleXlsx" class="btn btn-ghost" type="button" ${hasCombinedPdfRows?'':'disabled'}>Baixar XLSX</button><button id="speakerSchedulePublish" class="btn btn-ghost" type="button" ${hasCombinedPdfRows?'':'disabled'}>Publicar no Quadro</button></div><details class="workspace-disclosure" data-ui-preference="schedule-options"><summary>Mais opções da programação</summary><div class="service-actions"><button id="fillScheduleDates" class="btn btn-ghost" type="button">Criar datas do mês</button><button id="substitutionsPdf" class="btn btn-ghost" type="button">Baixar PDF de substituições</button></div></details><p id="speakerPublicationStatus" class="notice" aria-live="polite">Consultando publicação…</p>${monthRows.length ? '<p class="form-help">Publicar no Quadro atualiza o PDF; editar a programação não atualiza o arquivo já publicado.</p>' : ''}${scheduleEditor()}${monthRows.length ? `<div class="service-actions">${[['','Todos'],['speaker','Sem orador'],['theme','Sem tema']].map(([key,label])=>`<button class="btn ${scheduleFilter===key?'btn-primary':'btn-ghost'}" data-schedule-filter="${key}" aria-pressed="${scheduleFilter===key}">${label}: ${monthRows.filter(([,item])=>matchesFilter(item,key!)).length}</button>`).join('')}</div>
    ${field('Buscar na programação',`<input id="scheduleSearch" type="search" value="${esc(scheduleQuery)}" placeholder="Orador, número ou título do tema">`)}
    <label class="oradores-check"><input id="scheduleOnlyFuture" type="checkbox" ${onlyFuture?'checked':''}> Só o que falta (datas de hoje em diante)</label>` : ''}<div class="oradores-list">${rows.map(([id,item])=>scheduleCard(id,item)).join('')||empty(monthRows.length?'Nenhum resultado para esta busca ou filtro.':'Nenhuma programação neste mês. Use “Nova programação” ou “Criar datas do mês” para começar.')}</div>${monthRows.length && (scheduleQuery||scheduleFilter||onlyFuture)?'<button id="clearScheduleFilters" class="btn btn-ghost">Limpar filtros</button>':''}`
  mountRecordEditor(root(), 'speakerScheduleForm')
  bindPeriod()
  void showPublicationStatus()
  document.getElementById('clearScheduleFilters')?.addEventListener('click',()=>{if(!allowLeave())return;scheduleQuery='';scheduleFilter='';onlyFuture=false;preferences.set('scheduleFilter','');preferences.set('onlyFuture',false);renderSchedule()})
  document.querySelectorAll<HTMLButtonElement>('[data-copy-schedule]').forEach(button=>button.addEventListener('click',async()=>{
    const item=schedule()[button.dataset.copySchedule??'']
    if(!item||!visibleSchedule(item))return
    await copyMessageText(scheduleCardText(item,data,selectedSection==='s1'?planning.s1Time:planning.s2Time),toast)
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-whatsapp-schedule]').forEach(button=>button.addEventListener('click',()=>{
    const item=schedule()[button.dataset.whatsappSchedule??'']
    if(!item||!visibleSchedule(item))return
    const message=scheduleCardText(item,data,selectedSection==='s1'?planning.s1Time:planning.s2Time)
    openMessageWhatsApp(message,toast,speakers()[item.oradorId??'']?.telefone??'')
  }))
  document.querySelectorAll<HTMLButtonElement>('[data-schedule-filter]').forEach(button=>button.addEventListener('click',()=>{if(!allowLeave())return;scheduleFilter=button.dataset.scheduleFilter??'';preferences.set('scheduleFilter',scheduleFilter);renderSchedule()}))
  document.getElementById('scheduleSearch')?.addEventListener('change',event=>{if(!allowLeave())return;scheduleQuery=(event.target as HTMLInputElement).value;renderSchedule()})
  document.getElementById('scheduleOnlyFuture')?.addEventListener('change',event=>{if(!allowLeave())return;onlyFuture=(event.target as HTMLInputElement).checked;preferences.set('onlyFuture',onlyFuture);renderSchedule()})
  bindScheduleFields()
  document.getElementById('newSchedule')?.addEventListener('click',()=>{ editingId='new'; scheduleDraft=null; renderSchedule() })
  fieldHelp(root(),'#speakerScheduleForm [name="oradorId"]','Escolha um orador cadastrado. Nome e telefone dos locais são editados no Admin.')
  document.getElementById('substitutionsPdf')?.addEventListener('click',event=>void downloadSubstitutionsPdf(event.currentTarget as HTMLButtonElement))
  document.getElementById('fillScheduleDates')?.addEventListener('click',()=>void createMonthSlots())
  document.getElementById('speakerSchedulePdf')?.addEventListener('click',()=>void downloadSchedulePdf())
  document.getElementById('speakerScheduleXlsx')?.addEventListener('click',()=>void downloadScheduleXlsx())
  document.getElementById('speakerSchedulePublish')?.addEventListener('click',()=>void publishSchedulePdf())
  document.getElementById('cancelScheduleEdit')?.addEventListener('click',()=>{ editingId=''; scheduleDraft=null; renderSchedule() })
  document.getElementById('speakerScheduleForm')?.addEventListener('change',event=>{ if (['tipo','secao'].includes((event.target as HTMLElement).getAttribute('name')??'')) void saveDraftAndRerender(event.currentTarget as HTMLFormElement) })
  document.getElementById('speakerScheduleForm')?.addEventListener('submit',event=>{ event.preventDefault(); void saveSchedule(event.currentTarget as HTMLFormElement) })
  document.getElementById('deleteSchedule')?.addEventListener('click',()=>void deleteSchedule())
  document.querySelectorAll<HTMLButtonElement>('[data-edit-schedule]').forEach(button=>button.addEventListener('click',()=>{ editingId=button.dataset.editSchedule!; scheduleDraft=null; renderSchedule() }))
}

function saveDraftAndRerender(form:HTMLFormElement): void {
  const values=new FormData(form)
  scheduleDraft=Object.fromEntries([...values.entries()].filter(([,value])=>typeof value==='string').map(([key,value])=>[key,String(value)]))
  const speaker=speakers()[scheduleDraft.oradorId??'']
  if(speaker&&((scheduleDraft.tipo==='discurso_visitante'?speaker.tipo!=='visitante':speaker.tipo!=='local')||(speaker.tipo==='local'&&(speaker.secao??'s2')!==selectedSection))){scheduleDraft.oradorId='';scheduleDraft.oradorNome=''}
  if(scheduleDraft.tipo!=='discurso_local')scheduleDraft.oradorSecundarioId=''
  renderSchedule()
}

function scheduleWarnings(form:HTMLFormElement):string[] {
  const values=new FormData(form),date=String(values.get('data')??''),id=String(values.get('oradorId')??''),second=String(values.get('oradorSecundarioId')??''),section=String(values.get('secao')??'s2')
  const reasons=speakerConflicts(id,date,data,masterPeople,taskPeople,taskPeriods,editingId)
  if(second)reasons.push(...speakerConflicts(second,date,data,masterPeople,taskPeople,taskPeriods,editingId).map(reason=>'Segundo orador: '+reason))
  for(const speakerId of [id,second].filter(Boolean)){const person=speakers()[speakerId];if(person?.tipo==='local'&&(person.secao??'s2')!==section)reasons.push(`${person.nome} pertence à outra seção`)}
  if(id&&second&&(id===second||Boolean(speakers()[id]?.masterId&&speakers()[id]?.masterId===speakers()[second]?.masterId)))reasons.push('Escolha duas pessoas diferentes.')
  if(values.get('tipo')!=='saida_orador'&&blockedDate(date))reasons.push('Data bloqueada por evento ou configuração.')
  return [...new Set(reasons)]
}
function bindScheduleFields():void {
  const form=document.getElementById('speakerScheduleForm') as HTMLFormElement|null
  if(!form)return
  const control=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|null
  const refresh=(autofill=false):void=>{
    const speaker=speakers()[control('oradorId')?.value??''], number=control('themeNumber')!.value
    const parsed=parseRepertoire(number,themes(),schedule()[editingId]?.temaId?[schedule()[editingId]!.temaId!]:[])
    const error=number.trim()&&(!/^\d+$/.test(number.trim())||parsed.ids.length!==1)?parsed.error||'Informe o número de um único tema.':parsed.error
    control('themeNumber')!.setCustomValidity(error)
    control('temaId')!.value=error?'':parsed.ids[0]??''
    document.getElementById('scheduleThemePreview')!.innerHTML=error?esc(error):parsed.ids.length?esc(themes()[parsed.ids[0]!]!.titulo):'Tema a definir.'
    const congregation=control('congregacaoId'),time=control('horarioLocal')
    if(autofill&&speaker?.tipo==='visitante'&&speaker.congregacaoId&&congregation&&congregations()[speaker.congregacaoId]?.ativa)congregation.value=speaker.congregacaoId
    if(autofill&&time&&!time.value)time.value=control('secao')?.value==='s1'?planning.s1Time??'':planning.s2Time??''
    const warnings=scheduleWarnings(form)
    const repertoire=speaker?repertoireNumbers(speaker.temaIds,themes()):''
    const destination=congregations()[congregation?.value??'']
    document.getElementById('scheduleHints')!.innerHTML=`${speaker?`<p>Telefone: ${esc(speaker.telefone||'não informado')}. ${repertoire?'Temas: '+esc(repertoire):'Sem repertório informado.'}</p>`:''}
      ${speaker?.temaIds.filter(id=>themes()[id]?.ativo).sort((a,b)=>themes()[a]!.numero-themes()[b]!.numero).map(id=>`<button type="button" class="btn btn-ghost" data-pick-theme="${themes()[id]!.numero}" title="${esc(themes()[id]!.titulo)}">${themes()[id]!.numero} · ${themeChoiceLabel(id)}</button>`).join('')??''}
      ${speaker&&parsed.ids[0]&&!speaker.temaIds.includes(parsed.ids[0])?'<p class="notice warning">Este tema não está no repertório do orador. Confira antes de salvar.</p>':''}
      ${warnings.map(reason=>`<p class="notice warning">${esc(reason)}</p>`).join('')}
      ${destination?`<p>${esc(destination.nome)} · ${esc(destination.horario||'Horário não informado')} · ${esc(destination.localizacao||'Endereço não informado')}</p>`:''}
      ${!canReadTasks()?'<p>Designações de Tarefas não verificadas: seu acesso permite apenas consultar os cadastros de participantes.</p>':''}`
    document.querySelectorAll<HTMLButtonElement>('[data-pick-theme]').forEach(button=>button.addEventListener('click',()=>{control('themeNumber')!.value=button.dataset.pickTheme!;dirty=true;refresh()}))
  }
  form.addEventListener('input',()=>refresh())
  form.addEventListener('change',event=>{if((event.target as HTMLElement).getAttribute('name')!=='tipo')refresh((event.target as HTMLElement).getAttribute('name')==='oradorId')})
  refresh()
}

async function saveSchedule(form:HTMLFormElement): Promise<void> {
  if(saving)return
  const warnings=scheduleWarnings(form)
  if(warnings.length){formError(form,warnings.join('. '));return}
  const values=new FormData(form), kind=String(values.get('tipo')) as TalkKind, date=String(values.get('data')), speakerId=String(values.get('oradorId')??''), themeId=String(values.get('temaId')??''), congregationId=String(values.get('congregacaoId')??''), secondId=String(values.get('oradorSecundarioId')??''), section=selectedSection
  if(section!=='s1'&&section!=='s2'){formError(form,'Selecione uma seção válida');return}
  if(editingId!=='new' && schedule()[editingId] && !visibleSchedule(schedule()[editingId]!)){formError(form,'Esta programação pertence à outra seção.');return}
  if (!validIsoDate(date)) { formError(form,'Informe uma data válida'); return }
  const duplicate=Object.entries(schedule()).find(([id,item])=>id!==editingId && isDuplicateSchedule(item,date,kind,speakerId,congregationId,section))
  if (duplicate) { formError(form,'Já existe uma programação igual nesta data'); return }
  const speaker=speakers()[speakerId], theme=themes()[themeId], congregation=congregations()[congregationId], second=speakers()[secondId]
  if(speakerId&&(!speaker||!speaker.ativo)){formError(form,'Selecione um orador ativo.');return}
  if(secondId&&(!second||!second.ativo)){formError(form,'Selecione um segundo orador ativo.');return}
  if(kind==='saida_orador'&&speaker&&!speaker.aprovadoParaSaida){formError(form,'Este orador não está aprovado para saída.');return}
  const manualName=String(values.get('oradorNome')??'').trim(), now=isoNow(), previous=editingId==='new'||editingId==='__draft__'?undefined:schedule()[editingId]
  const item:TalkSchedule={ ...scheduleBaseForEdit(previous), data:date, tipo:kind, updatedAt:now, secao:section, ...(speakerId?{oradorId:speakerId,oradorNome:speaker?.nome}:manualName?{oradorNome:manualName}:{}), ...(theme?{temaId:themeId,temaNumero:theme.numero,temaTitulo:theme.titulo}:{}), ...(second?{oradorSecundarioId:secondId,oradorSecundarioNome:second.nome,oradorSecundarioTipo:second.tipo}:{}), ...(kind==='saida_orador'&&congregation?{congregacaoDestinoId:congregationId,congregacaoDestinoNome:congregation.nome}:kind==='discurso_visitante'&&congregation?{congregacaoOrigemId:congregationId,congregacaoOrigemNome:congregation.nome}:{}), ...(kind!=='saida_orador'&&String(values.get('horarioLocal')??'')?{horarioLocal:String(values.get('horarioLocal'))}:{}), ...(String(values.get('observacoes')??'').trim()?{observacoes:String(values.get('observacoes')).trim()}:{} ) }
  if(kind!=='saida_orador'){
    const local=Object.entries(congregations()).find(([,entry])=>entry.tipo==='local'&&entry.ativa&&(entry.secao??'s2')===section)
    if(local){item.localCongregacaoId=local[0];item.localCongregacaoNome=local[1].nome}
  } else {delete item.localCongregacaoId;delete item.localCongregacaoNome}
  const id=previous?editingId:newSpeakerId('programacao')
  saving=true
  const release=freezeForm(form)
  try { await compareAndSet(child(oradoresProgramacaoRef,id),rawSchedule[id] ?? null,item); rawSchedule[id]=structuredClone(item); schedule()[id]=item; dirty=false; editingId=''; scheduleDraft=null; toast(previous?'Programação atualizada':'Programação criada'); renderSchedule() } catch { formError(form,'Não foi possível salvar. Seu preenchimento foi mantido. Se houve edição por outro administrador, copie suas alterações e recarregue o aplicativo.') } finally {saving=false;release()}
}

async function deleteSchedule(): Promise<void> { const id=editingId, item=schedule()[id]; if (!item||!confirm(`Excluir a programação de ${formatSpeakerDate(item.data)}?`)) return; try { await compareAndSet(child(oradoresProgramacaoRef,id),rawSchedule[id] ?? null,null); delete rawSchedule[id]; delete schedule()[id]; dirty=false;editingId=''; toast('Programação excluída'); renderSchedule() } catch { toast('Não foi possível excluir') } }

function blockedDate(date:string): boolean { return planning.excludedDates?.includes(date)===true || Object.values(events).some(item=>item.data===date&&item.tipo!=='informativo') }
async function createMonthSlots(): Promise<void> {
  const {start,end}=monthBounds(selectedMonth), startDate=new Date(`${start}T12:00:00Z`), endDate=new Date(`${end}T12:00:00Z`), sections:(readonly [SpeakerSection,number,string])[] = selectedSection==='s1' ? [['s1',planning.meetingDays?.weekendS1Dow??planning.meetingDays?.weekendDow??0,planning.s1Time??'']] : [['s2',planning.meetingDays?.weekendDow??0,planning.s2Time??'']]
  const patch:Record<string,unknown>={}
  for (const [section,dow,time] of sections) for (let date=new Date(startDate); date<=endDate; date.setUTCDate(date.getUTCDate()+1)) { const iso=date.toISOString().slice(0,10); if (date.getUTCDay()!==dow||blockedDate(iso)||Object.values(schedule()).some(item=>item.data===iso&&item.tipo!=='saida_orador'&&(item.secao??'s2')===section)) continue; const id=newSpeakerId('programacao'), local=Object.entries(congregations()).find(([,item])=>item.tipo==='local'&&(item.secao??'s2')===section); patch[id]={data:iso,tipo:'discurso_local',secao:section,horarioLocal:time,...(local?{localCongregacaoId:local[0],localCongregacaoNome:local[1].nome}:{}),updatedAt:isoNow()} }
  if (!Object.keys(patch).length) { toast('Todas as datas do mês já estão criadas'); return }
  try { await update(oradoresProgramacaoRef,patch); Object.assign(schedule(),patch);Object.assign(rawSchedule,structuredClone(patch)); toast(`${Object.keys(patch).length} data(s) criada(s)`); renderSchedule() } catch { toast('Não foi possível criar as datas') }
}

async function downloadSchedulePdf(): Promise<void> {
  if (downloadingPdf) return; downloadingPdf=true
  const button=document.getElementById('speakerSchedulePdf') as HTMLButtonElement|null; if(button){button.disabled=true;button.textContent='Preparando PDF...'}
  try { const docs=await import('./oradores-documents'); await docs.downloadSpeakersSchedulePdf({month:selectedMonth,schedule:Object.values(schedule()),speakers:speakers(),themes:themes(),congregations:congregations()}); toast('Download do PDF iniciado') } catch { toast('Não foi possível gerar o PDF') } finally { downloadingPdf=false; if(button){button.disabled=false;button.textContent='Baixar PDF'} }
}

async function downloadScheduleXlsx(): Promise<void> {
  const button=document.getElementById('speakerScheduleXlsx') as HTMLButtonElement|null
  if(button){button.disabled=true;button.textContent='Preparando XLSX...'}
  try {
    const docs=await import('./oradores-documents')
    await docs.downloadSpeakersScheduleXlsx({month:selectedMonth,schedule:Object.values(schedule()),speakers:speakers(),themes:themes(),congregations:congregations()})
    toast('Download do XLSX iniciado')
  } catch { toast('Não foi possível gerar o XLSX') }
  finally { if(button){button.disabled=false;button.textContent='Baixar XLSX'} }
}

async function publishSchedulePdf(): Promise<void> {
  if (publishingPdf) return
  publishingPdf=true
  const releaseUi=lockPublicationUi()
  try {
    await publishModulePeriod('oradores',selectedMonth,rawSchedule)
    toast('PDF de Oradores publicado no Quadro');void showPublicationStatus()
  } catch (error) { toast(error instanceof Error?error.message:'Não foi possível publicar o PDF') }
  finally { publishingPdf=false; releaseUi() }
}

function speakerEditor(): string {
  if (!editingId || !canEditPeople()) return ''
  const item=editingId==='new'?undefined:rawSpeakers[editingId]
  const masterId=item?resolveSpeakerMasterId(item,masterPeople,taskPeople):''
  const visitor=item?.tipo==='visitante'
  const options=Object.entries(masterPeople).filter(([id,p])=>id===masterId || p.active!==false && !Object.entries(rawSpeakers).some(([otherId,other])=>otherId!==editingId&&resolveSpeakerMasterId(other,masterPeople,taskPeople)===id))
    .sort((a,b)=>a[1].name.localeCompare(b[1].name,'pt-BR')).map(([id,p])=>option(id,p.name,masterId)).join('')
  return `<form id="speakerForm" class="form-panel"><h3>${item?'Editar orador':'Adicionar do cadastro Admin'}</h3>
    ${visitor?`<p>${esc(item.nome)} · Visitante</p><p class="form-help">Cadastro visitante existente. Novos visitantes podem ser informados na programação.</p>`:
      field('Pessoa do cadastro Admin',`<select name="masterId" ${masterId?'disabled':''}><option value="">Selecionar pessoa...</option>${masterId&&!masterPeople[masterId]?option(masterId,'Vínculo não encontrado no Admin',masterId):''}${options}</select>`)}
    <p id="speakerIdentity" class="form-help"></p>
    ${field('Números dos temas',`<input name="themeNumbers" type="text" inputmode="text" autocomplete="off" placeholder="1, 25, 38, 45" value="${esc(repertoireNumbers(item?.temaIds??[],themes()))}" aria-describedby="repertoireHelp repertoirePreview">`)}
    <p id="repertoireHelp" class="form-help">Separe os números por vírgulas. Retire um número para remover o tema. Deixar vazio remove todos os temas.</p>
    <div id="repertoirePreview" class="form-help" aria-live="polite"></div>
    <div class="oradores-check-grid">
      <label class="oradores-check"><input name="ativo" type="checkbox" ${item?.ativo!==false?'checked':''}> Ativo em Oradores</label>
      ${visitor?'':`<label class="oradores-check"><input name="aprovadoParaSaida" type="checkbox" ${item?.aprovadoParaSaida?'checked':''}> Aprovado para saída</label>
      <label class="oradores-check"><input name="podePresidir" type="checkbox" ${item?.podePresidir?'checked':''}> Pode presidir</label>
      <label class="oradores-check"><input name="sentinelaDirigente" type="checkbox" ${item?.sentinelaDirigente?'checked':''}> Dirigente de A Sentinela</label>
      <label class="oradores-check"><input name="sentinelaSubstituto" type="checkbox" ${item?.sentinelaSubstituto?'checked':''}> Substituto de A Sentinela</label>`}
    </div><div class="service-actions"><button class="btn btn-primary" type="submit">Salvar</button><button id="cancelSpeakerEdit" class="btn btn-ghost" type="button">Cancelar</button></div>
  </form>`
}

function renderSpeakers(): void {
  root().innerHTML=`${sectionTitle('Oradores')}<p class="form-help">Selecione um orador local para consultar, editar ou preparar a mensagem das designações. Visitantes são definidos na programação.</p><div class="service-actions">${canEditPeople()?'<button id="newSpeaker" class="btn btn-primary">Adicionar do cadastro Admin</button>':''}</div>
    ${speakerEditor()}${field('Buscar orador ou número de tema',`<input id="speakerSearch" type="search" placeholder="Nome ou número do tema" value="${esc(speakerQuery)}" ${editingId?'disabled':''}>`)}
    <div id="speakerResults" class="oradores-list"></div><div id="oradoresMessageSettings"></div>`
  void mountModuleMessageSettings('oradoresMessageSettings',messageSettingsModule(),toast,settings=>{messageSettings=settings})
  mountRecordEditor(root(), 'speakerForm')
  const list=():void=>{
    const rows=Object.entries(speakers()).filter(([,item])=>item.tipo==='local'&&(item.secao??'s2')===selectedSection&&matchesSpeaker(item,speakerQuery,themes())).sort((a,b)=>Number(b[1].ativo)-Number(a[1].ativo)||a[1].nome.localeCompare(b[1].nome,'pt-BR'))
    document.getElementById('speakerResults')!.innerHTML=rows.map(([id,item])=>`<article class="oradores-card"><div class="oradores-card-head"><div><strong>${esc(item.nome)}</strong><small>${esc(SPEAKER_ROLE_LABEL[item.funcao])}</small></div><span class="status-pill">${item.ativo?'Ativo':'Inativo'}</span></div>
      <div class="oradores-card-grid"><div><span>Números dos temas no repertório</span><strong data-speaker-repertoire="${esc(id)}">${esc(repertoireNumbers(item.temaIds,themes())||'Nenhum tema')}</strong></div></div>
      <details data-ui-preference="speaker-contact:${esc(id)}"><summary>Contato e habilitações</summary><div class="oradores-card-grid"><div><span>Telefone</span><strong>${esc(item.telefone||'Não informado')}</strong></div><div><span>Saída</span><strong>${item.aprovadoParaSaida?'Aprovado':'Não aprovado'}</strong></div><div><span>A Sentinela</span><strong>${item.sentinelaDirigente?'Dirigente':item.sentinelaSubstituto?'Substituto':'—'}</strong></div></div></details>
      ${item.tipo==='local'&&!item.masterId?'<p class="notice warning">Vincule esta pessoa ao cadastro Admin para habilitar a programação.</p>':''}
      <h3>Próximas designações</h3><div class="oradores-list">${assignmentEntries(data,id,today(),selectedSection==='s1'?planning.s1Time:planning.s2Time).map(entry=>`<div class="module-list-row"><div><strong>${esc(formatSpeakerDate(entry.date))}</strong><small>${esc(entry.text)}</small></div></div>`).join('')||'<p class="form-help">Nenhuma designação futura.</p>'}</div>
      <div class="service-actions">${canEditPeople()?`<button class="btn btn-ghost" data-edit-speaker="${esc(id)}">Editar</button>`:''}<button data-whatsapp-speaker="${esc(id)}" class="btn btn-primary" ${assignmentEntries(data,id,today(),selectedSection==='s1'?planning.s1Time:planning.s2Time).length?'':'disabled'}>WhatsApp</button><button data-copy-speaker="${esc(id)}" class="btn btn-ghost" ${assignmentEntries(data,id,today(),selectedSection==='s1'?planning.s1Time:planning.s2Time).length?'':'disabled'}>Copiar texto</button></div></article>`).join('')||empty('Nenhum orador encontrado.')
    document.querySelectorAll<HTMLButtonElement>('[data-edit-speaker]').forEach(button=>button.addEventListener('click',()=>{editingId=button.dataset.editSpeaker!;renderSpeakers()}))
    document.querySelectorAll<HTMLButtonElement>('[data-whatsapp-speaker],[data-copy-speaker]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.whatsappSpeaker??button.dataset.copySpeaker??'',speaker=speakers()[id];if(!speaker)return;const message=assignmentsMessage(data,id,today(),messageSettings.meetingText,selectedSection==='s1'?planning.s1Time:planning.s2Time);if(button.dataset.copySpeaker!==undefined)void copyMessageText(message,toast);else openMessageWhatsApp(message,toast,speaker.telefone??'')}))
  }
  list()
  document.getElementById('speakerSearch')?.addEventListener('input',event=>{speakerQuery=(event.target as HTMLInputElement).value;list()})
  document.getElementById('newSpeaker')?.addEventListener('click',()=>{editingId='new';renderSpeakers()})
  document.getElementById('cancelSpeakerEdit')?.addEventListener('click',()=>{editingId='';renderSpeakers()})
  const form=document.getElementById('speakerForm') as HTMLFormElement|null
  if (!form) return
  const original=rawSpeakers[editingId]
  const input=form.elements.namedItem('themeNumbers') as HTMLInputElement
  const preview=():void=>{
    const parsed=parseRepertoire(input.value,themes(),original?.temaIds??[])
    input.setCustomValidity(parsed.error)
    document.getElementById('repertoirePreview')!.innerHTML=parsed.error?esc(parsed.error):parsed.ids.length?parsed.ids.map(id=>`<div>${themes()[id]!.numero} — ${esc(themes()[id]!.titulo)}${themes()[id]!.ativo?'':' (inativo)'}</div>`).join(''):'O repertório ficará sem temas.'
  }
  input.addEventListener('input',preview)
  input.addEventListener('blur',()=>{const parsed=parseRepertoire(input.value,themes(),original?.temaIds??[]);if(!parsed.error)input.value=parsed.formatted})
  preview()
  const identity=():void=>{
    const mid=(form.elements.namedItem('masterId') as HTMLSelectElement|null)?.value??''
    const person=masterPeople[mid]
    document.getElementById('speakerIdentity')!.textContent=person?`${person.name} · WhatsApp: ${person.whatsapp||'não informado'}. Dados pessoais são editados no Admin.${person.active===false?' Pessoa inativa no Admin.':''}`:''
  }
  form.querySelector('[name="masterId"]')?.addEventListener('change',identity);identity()
  form.addEventListener('submit',event=>{event.preventDefault();void saveSpeaker(form)})
}

async function saveSpeaker(form:HTMLFormElement):Promise<void> {
  if (saving || !canEditPeople()) return
  const values=new FormData(form), previous=rawSpeakers[editingId], visitor=previous?.tipo==='visitante'
  const mid=previous?resolveSpeakerMasterId(previous,masterPeople,taskPeople)||String(values.get('masterId')??''):String(values.get('masterId')??'')
  if (!visitor && !masterPeople[mid]) {formError(form,'Selecione uma pessoa do cadastro Admin.');return}
  if (!visitor && Object.entries(rawSpeakers).some(([id,item])=>id!==editingId&&resolveSpeakerMasterId(item,masterPeople,taskPeople)===mid)) {formError(form,'Esta pessoa já está vinculada a Oradores.');return}
  const parsed=parseRepertoire(String(values.get('themeNumbers')??''),themes(),previous?.temaIds??[])
  if(parsed.error){formError(form,parsed.error);return}
  const missing=(previous?.temaIds??[]).filter(id=>!themes()[id])
  if(missing.length){formError(form,'Há temas antigos ausentes do catálogo. Regularize o catálogo antes de alterar este repertório para preservar os vínculos.');return}
  const dirigente=values.get('sentinelaDirigente')==='on', substituto=values.get('sentinelaSubstituto')==='on', active=values.get('ativo')==='on'
  if(dirigente&&substituto){formError(form,'Dirigente e substituto de A Sentinela devem ser pessoas diferentes.');return}
  if((dirigente||substituto)&&(!active||masterPeople[mid]?.active===false)){formError(form,'O dirigente e o substituto precisam estar ativos em Oradores e no Admin.');return}
  const id=previous?editingId:`orador_${mid}`
  if(!previous&&rawSpeakers[id]){formError(form,'Já existe um cadastro com este vínculo. Reabra o cadastro existente.');return}
  if(previous?.temaIds.length&&!parsed.ids.length&&!confirm('Remover todos os temas do repertório deste orador?'))return
  const person=masterPeople[mid]
  if(previous && !visitor && (previous.secao??'s2')!==selectedSection){formError(form,'Este orador pertence à outra seção.');return}
  const item:Speaker={...(previous??{nome:person!.name,telefone:person!.whatsapp??'',tipo:'local',funcao:'publicador'}),...(!visitor?{masterId:mid}:{}),ativo:active,temaIds:parsed.ids,secao:previous?.secao??selectedSection,
    aprovadoParaSaida:!visitor&&values.get('aprovadoParaSaida')==='on',podePresidir:!visitor&&values.get('podePresidir')==='on',sentinelaDirigente:dirigente,sentinelaSubstituto:substituto}
  const next=structuredClone(speakerBaseline??{}) as Record<string,Speaker>
  next[id]={...next[id],...item}
  Object.entries(next).forEach(([otherId,other])=>{if(otherId!==id&&(other.secao??'s2')===(item.secao??'s2')){if(dirigente)other.sentinelaDirigente=false;if(substituto)other.sentinelaSubstituto=false}})
  saving=true
  const release=freezeForm(form)
  try {
    await compareAndSet(oradoresCadastroRef,speakerBaseline,next)
    speakerBaseline=structuredClone(next);rawSpeakers=normalizeSpeakersRoot({oradores:next}).oradores??{};hydrateSpeakers()
    dirty=false;editingId='';toast('Configuração do orador salva');renderSpeakers()
  } catch {formError(form,'Não foi possível salvar. Seu preenchimento foi mantido. Se outro administrador alterou o cadastro, copie suas alterações e recarregue o aplicativo.')}
  finally {saving=false;release()}
}

function themeEditor():string{if(!editingId)return'';const item=editingId==='new'?undefined:themes()[editingId];return`<form id="themeForm" class="form-panel"><h3>${item?'Editar tema':'Novo tema'}</h3><div class="module-form-grid">${field('Número',`<input name="numero" type="number" min="1" max="999" value="${item?.numero??''}" required>`)}${field('Título',`<input name="titulo" maxlength="180" value="${esc(item?.titulo)}" required>`)}</div><label class="oradores-check"><input name="ativo" type="checkbox" ${item?.ativo!==false?'checked':''}> Tema ativo</label><div class="service-actions"><button class="btn btn-primary">Salvar</button><button id="cancelThemeEdit" class="btn btn-ghost" type="button">Cancelar</button>${item?'<button id="deleteTheme" class="btn btn-danger" type="button">Excluir</button>':''}</div></form>`}
function themeUse(id:string) {return themeUsageIndex(data,today()).get(id)??{past:false,pending:false,lastPastDate:'',nextDate:''}}
async function downloadOperationalReport(button:HTMLButtonElement,generate:()=>Promise<Uint8Array>,filename:string):Promise<void>{
  if(button.disabled)return
  button.disabled=true
  try{downloadPdf(await generate(),filename);toast('Download do PDF iniciado')}catch{toast('Não foi possível gerar o PDF')}finally{button.disabled=false}
}
function renderThemes():void {
  root().innerHTML=`${sectionTitle('Temas')}<div class="service-actions">${canEditShared()?'<button id="newTheme" class="btn btn-primary">Novo tema</button>':''}<button id="themesPdf" class="btn btn-ghost">Baixar PDF dos temas</button></div>${canEditShared()?themeEditor():'<p class="form-help">Catálogo compartilhado, editável pelos responsáveis das duas seções.</p>'}
    ${field('Localizar tema',`<input id="themeSearch" type="search" value="${esc(themeQuery)}" placeholder="Digite o número ou parte do título">`)}
    <div class="service-actions">${Object.entries(THEME_FILTER_LABELS).map(([key,label])=>`<button class="btn ${themeFilter===key?'btn-primary':'btn-ghost'}" data-theme-filter="${key}" aria-pressed="${themeFilter===key}">${label}</button>`).join('')}</div>
    <p id="themeCount" class="form-help"></p><div id="themeResults"></div>`
  mountRecordEditor(root(), 'themeForm')
  const list=():void=>{
    const rows=filteredThemeRows(data,today(),themeFilter,themeQuery)
    document.getElementById('themeCount')!.textContent=`${rows.length} temas · ${THEME_FILTER_LABELS[themeFilter]}. Temas já programados estão ocupados.`
    document.querySelectorAll<HTMLButtonElement>('[data-theme-filter]').forEach(button=>{const active=button.dataset.themeFilter===themeFilter;button.setAttribute('aria-pressed',String(active));button.className='btn '+(active?'btn-primary':'btn-ghost')})
    document.getElementById('themeResults')!.innerHTML=rows.map(row=>`<article class="oradores-row"><div><strong>${row.theme.numero} — ${esc(row.theme.titulo)}</strong><small>${row.theme.ativo?'Ativo':'Inativo'} · ${row.lastPastDate?'Último uso: '+themeDate(row.lastPastDate):'Nunca usado'}${row.nextDate?' · Ocupado / próxima data: '+themeDate(row.nextDate):''}</small></div>${canEditShared()?`<button class="btn btn-ghost" data-edit-theme="${esc(row.id)}">Editar</button>`:''}</article>`).join('')||empty('Nenhum tema encontrado neste filtro.')
    document.querySelectorAll<HTMLButtonElement>('[data-edit-theme]').forEach(button=>button.addEventListener('click',()=>{editingId=button.dataset.editTheme!;renderThemes()}))
  }
  document.getElementById('themeSearch')?.addEventListener('input',event=>{themeQuery=(event.target as HTMLInputElement).value;list()})
  document.querySelectorAll<HTMLButtonElement>('[data-theme-filter]').forEach(button=>button.addEventListener('click',()=>{themeFilter=button.dataset.themeFilter as ThemeFilter;preferences.set('themeFilter',themeFilter);list()}))
  document.getElementById('themesPdf')?.addEventListener('click',event=>{
    const rows=filteredThemeRows(data,today(),themeFilter,themeQuery),label=THEME_FILTER_LABELS[themeFilter],query=themeQuery
    void downloadOperationalReport(event.currentTarget as HTMLButtonElement,async()=>{const {createThemesReportPdf}=await import('./oradores-reports');return createThemesReportPdf(rows,label,query,today())},`temas-${themeFilter}.pdf`)
  })
  document.getElementById('newTheme')?.addEventListener('click',()=>{editingId='new';renderThemes()})
  document.getElementById('cancelThemeEdit')?.addEventListener('click',()=>{editingId='';renderThemes()})
  document.getElementById('themeForm')?.addEventListener('submit',event=>{event.preventDefault();void saveTheme(event.currentTarget as HTMLFormElement)})
  document.getElementById('deleteTheme')?.addEventListener('click',()=>void deleteTheme())
  if(canEditShared()&&editingId&&themeUse(editingId).past){
    const form=document.getElementById('themeForm') as HTMLFormElement
    for(const name of ['numero','titulo'])(form.elements.namedItem(name) as HTMLInputElement).readOnly=true
    form.insertAdjacentHTML('afterbegin','<p class="form-help">Tema já usado: número e título são preservados. Você pode alterar a situação.</p>')
  }
  list()
}
async function saveTheme(form:HTMLFormElement):Promise<void>{const values=new FormData(form),number=Number(values.get('numero')),title=String(values.get('titulo')).trim();if(!Number.isInteger(number)||number<1||number>999||!title){toast('Informe número e título válidos');return}if(Object.entries(themes()).some(([id,item])=>id!==editingId&&item.numero===number)){toast('Já existe um tema com este número');return}if(editingId!=='new'&&themeUse(editingId).past&&(themes()[editingId]?.numero!==number||themes()[editingId]?.titulo!==title)){formError(form,'Número e título de um tema já usado devem ser preservados.');return}const id=editingId==='new'?`tema_${String(number).padStart(3,'0')}`:editingId,item={numero:number,titulo:title,ativo:values.get('ativo')==='on'};try{await set(child(oradoresTemasRef,id),item);themes()[id]=item;dirty=false;editingId='';renderThemes()}catch{toast('Não foi possível salvar')}}
async function deleteTheme():Promise<void>{const id=editingId,item=themes()[id];if(!item||Object.values(schedule()).some(row=>row.temaId===id)||Object.values(data.historicoTemas??{}).some(row=>row.temaId===id)||Object.values(speakers()).some(row=>row.temaIds.includes(id))){toast('Tema com histórico deve ser inativado, não excluído');return}if(!confirm(`Excluir o tema ${item.numero}?`))return;try{await set(child(oradoresTemasRef,id),null);delete themes()[id];dirty=false;editingId='';renderThemes()}catch{toast('Não foi possível excluir')}}

function congregationEditor():string{if(!editingId)return'';const item=editingId==='new'?undefined:congregations()[editingId];return`<form id="congregationForm" class="form-panel"><h3>${item?'Editar congregação':'Nova congregação'}</h3><div class="module-form-grid">${field('Nome',`<input name="nome" value="${esc(item?.nome)}" required>`)}${field('Cidade',`<input name="cidade" value="${esc(item?.cidade)}">`)}${field('Tipo',`<select name="tipo">${option('visitante','Visitante',item?.tipo??'visitante')}${option('local','Local',item?.tipo??'visitante')}</select>`)}${field('Contato',`<input name="contato" value="${esc(item?.contato)}">`)}${field('Telefone',`<input name="telefone" inputmode="tel" value="${esc(item?.telefone)}">`)}${field('Dia da reunião',`<input name="diaReuniao" placeholder="Sábado" value="${esc(item?.diaReuniao)}">`)}${field('Horário',`<input name="horario" type="time" value="${esc(item?.horario)}">`)}${field('Prazo padrão para oferecer datas',`<select name="horizonteDatas">${option('90','90 dias',String(item?.horizonteDatas??90))}${option('180','180 dias (aprox. 6 meses)',String(item?.horizonteDatas??90))}${option('365','365 dias (aprox. 1 ano)',String(item?.horizonteDatas??90))}</select>`)}${field('Endereço para impressão',`<input name="localizacao" value="${esc(item?.localizacao)}">`)}${field('Mapa (link HTTPS, Plus Code ou coordenadas)',`<input name="mapa" value="${esc(item?.mapa)}">`)}${field('Observações',`<textarea name="observacoes">${esc(item?.observacoes)}</textarea>`)}</div><p id="congregationGeocodeStatus" class="form-help" aria-live="polite">${item?'':'Ao salvar, o app buscará o Plus Code do endereço. Confira o ponto antes de confirmar.'}</p><label class="oradores-check"><input name="ativa" type="checkbox" ${item?.ativa!==false?'checked':''}> Congregação ativa</label><div class="service-actions"><button class="btn btn-primary">Salvar</button><button id="cancelCongregationEdit" class="btn btn-ghost" type="button">Cancelar</button>${item?'<button id="deleteCongregation" class="btn btn-danger" type="button">Excluir</button>':''}</div></form>`}
function renderCongregations():void {
  const rows=Object.entries(congregations()).filter(([,item])=>item.tipo==='visitante'||(item.secao??'s2')===selectedSection).sort((a,b)=>a[1].nome.localeCompare(b[1].nome,'pt-BR'))
  if(!rows.some(([id])=>id===selectedCongregationId))selectedCongregationId=rows.find(([,item])=>item.tipo==='visitante')?.[0]??rows[0]?.[0]??''
  const selected=congregations()[selectedCongregationId]
  const future=Object.values(schedule()).filter(item=>item.data>=today()&&visibleSchedule(item)&&item.tipo!=='discurso_local'&&scheduleCongregationId(item)===selectedCongregationId).sort((a,b)=>a.data.localeCompare(b.data))
  const ready=future.filter(exchangeReady)
  root().innerHTML=`${sectionTitle('Intercâmbio e congregações')}<div class="service-actions">${canEditShared()?'<button id="newCongregation" class="btn btn-primary">Nova congregação</button>':''}</div>${congregationEditor()}
    <label class="form-field context-select"><span>Congregação</span><select id="congregationContext" class="form-select">${rows.map(([id,item])=>option(id,item.nome,selectedCongregationId)).join('')}</select></label>
    ${selected?`<article class="oradores-card"><div class="oradores-card-head"><div><strong>${esc(selected.nome)}</strong><small>${esc([selected.tipo==='local'?'Local':'Visitante',selected.cidade].filter(Boolean).join(' · '))}</small></div><span class="status-pill">${selected.ativa?'Ativa':'Inativa'}</span></div>
      <div class="oradores-card-grid"><div><span>Contato</span><strong>${esc(selected.contato||'Não informado')}</strong></div><div><span>Telefone</span><strong>${esc(selected.telefone||'Não informado')}</strong></div><div><span>Reunião</span><strong>${esc([selected.diaReuniao,selected.horario].filter(Boolean).join(' às ')||'Não informada')}</strong></div><div><span>Endereço</span><strong>${esc(selected.localizacao||'Não informado')}</strong></div></div>
      <div class="service-actions">${canEditShared()||selected.tipo==='local'?`<button class="btn btn-ghost" data-edit-congregation="${esc(selectedCongregationId)}">Editar</button>`:'<p class="form-help">Cadastro visitante compartilhado, editável pelos responsáveis das duas seções.</p>'}</div>
      ${selected.tipo==='visitante'?`<details class="form-panel" data-ui-preference="available-dates"><summary>Oferecer datas disponíveis · ${selected.horizonteDatas??90} dias</summary><div id="availableDatesPanel"></div></details>
      <details class="form-panel" data-ui-preference="exchanges"><summary>Intercâmbios · ${future.length} futuro(s)</summary><p class="form-help">A mensagem reúne apenas os arranjos futuros com orador, tema e congregação definidos nesta seção.</p><div class="oradores-list">${future.map(item=>scheduleCard('',item,false)).join('')||empty('Nenhum intercâmbio futuro com esta congregação.')}</div><div class="service-actions"><button id="whatsappCongregationExchanges" class="btn btn-primary" ${ready.length?'':'disabled'}>WhatsApp</button><button id="copyCongregationExchanges" class="btn btn-ghost" ${ready.length?'':'disabled'}>Copiar texto</button></div></details>`:''}</article>`:empty('Nenhuma congregação cadastrada.')}<div id="oradoresMessageSettings"></div>`
  void mountModuleMessageSettings('oradoresMessageSettings',messageSettingsModule(),toast,settings=>{messageSettings=settings})
  mountRecordEditor(root(), 'congregationForm')
  fieldHelp(root(),'[name="localizacao"]','Endereço escrito: rua, número e bairro. Vai nas mensagens e PDFs.')
  fieldHelp(root(),'[name="mapa"]','Link do mapa, Plus Code com cidade ou coordenadas. Usado apenas no ICS.')
  const horizon=preferences.get(`horizon:${selectedCongregationId}`,selected?.horizonteDatas??90)
  renderAvailableDates([90,180,365].includes(horizon)?horizon:90)
  document.getElementById('congregationContext')?.addEventListener('change',event=>{if(!allowLeave()){(event.currentTarget as HTMLSelectElement).value=selectedCongregationId;return}selectedCongregationId=(event.currentTarget as HTMLSelectElement).value;preferences.set('congregation',selectedCongregationId);renderCongregations()})
  document.getElementById('newCongregation')?.addEventListener('click',()=>{editingId='new';renderCongregations()})
  document.getElementById('cancelCongregationEdit')?.addEventListener('click',()=>{editingId='';renderCongregations()})
  document.getElementById('congregationForm')?.addEventListener('submit',event=>{event.preventDefault();void saveCongregation(event.currentTarget as HTMLFormElement)})
  const congregationForm=document.getElementById('congregationForm') as HTMLFormElement|null
  if(!appContext.usuario.apps.mestre&&editingId!=='new'){
    const type=congregationForm?.querySelector<HTMLSelectElement>('[name="tipo"]')
    const kind=congregations()[editingId]?.tipo
    if(type&&kind)type.innerHTML=`<option value="${kind}">${kind==='local'?'Local':'Visitante'}</option>`
  }
  for(const name of ['localizacao','cidade'])congregationForm?.querySelector<HTMLInputElement>(`[name="${name}"]`)?.addEventListener('input',()=>{
    const map=congregationForm.querySelector<HTMLInputElement>('[name="mapa"]')
    if(map&&congregationForm.dataset.generatedCode===map.value){map.value='';delete congregationForm.dataset.generatedCode}
    const status=congregationForm.querySelector<HTMLElement>('#congregationGeocodeStatus')
    if(status)status.textContent='O endereço mudou. Ao salvar, o app buscará o novo ponto.'
    delete congregationForm.dataset.skipGeocode
  })
  document.getElementById('deleteCongregation')?.addEventListener('click',()=>void deleteCongregation())
  document.querySelector<HTMLButtonElement>('[data-edit-congregation]')?.addEventListener('click',()=>{editingId=selectedCongregationId;renderCongregations()})
  const exchangeMessage=()=>exchangesMessage(data,selectedCongregationId,today(),messageSettings.meetingText,selectedSection==='s1'?planning.s1Time:planning.s2Time,selectedSection)
  document.getElementById('whatsappCongregationExchanges')?.addEventListener('click',()=>{if(selected&&ready.length)openMessageWhatsApp(exchangeMessage(),toast,selected.telefone??'')})
  document.getElementById('copyCongregationExchanges')?.addEventListener('click',()=>{if(selected&&ready.length)void copyMessageText(exchangeMessage(),toast)})
}
async function saveCongregation(form:HTMLFormElement):Promise<void>{
  if(form.dataset.saving==='yes')return
  const values=new FormData(form),name=String(values.get('nome')).trim()
  if(!name){toast('Informe o nome');return}
  const address=cleanAddress(String(values.get('localizacao')??'')),city=String(values.get('cidade')??'').trim()
  const mapInput=form.querySelector<HTMLInputElement>('[name="mapa"]')
  const status=form.querySelector<HTMLElement>('#congregationGeocodeStatus')
  if(editingId==='new'&&address&&!mapInput?.value.trim()&&form.dataset.skipGeocode!=='yes'){
    form.dataset.saving='yes'
    if(status)status.textContent='Buscando o ponto do endereço…'
    try{
      const found=await apiJson<{plusCode:string;displayName:string;mapUrl:string;attribution:string}>('congregation-geocode',{method:'POST',body:JSON.stringify({address,city})})
      if(!form.isConnected||editingId!=='new')return
      if(mapInput)mapInput.value=found.plusCode
      form.dataset.generatedCode=found.plusCode
      if(status){
        status.textContent=`Ponto sugerido: ${found.displayName}. ${found.attribution}. `
        const link=document.createElement('a');link.href=found.mapUrl;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Conferir no mapa'
        status.append(link,document.createTextNode(' e clique em Salvar novamente. Se não for o local certo, corrija o campo Mapa.'))
      }
      return
    }catch(error){
      if(!form.isConnected)return
      if(status){
        status.textContent=error instanceof ApiError?error.message:'Não foi possível localizar o endereço. Confira-o ou informe o mapa manualmente.'
        const skip=document.createElement('button');skip.type='button';skip.className='btn btn-ghost';skip.textContent='Salvar sem ponto'
        skip.addEventListener('click',()=>{form.dataset.skipGeocode='yes';form.requestSubmit()})
        status.append(' ',skip)
      }
      return
    }finally{delete form.dataset.saving}
  }
  const id=editingId==='new'?newSpeakerId('congregacao'):editingId,horizon=Number(values.get('horizonteDatas')),tipo=String(values.get('tipo')) as 'local'|'visitante'
  if(editingId!=='new'&&congregations()[id]?.tipo==='local'&&(congregations()[id]?.secao??'s2')!==selectedSection){formError(form,'Esta congregação local pertence à outra seção.');return}
  if(tipo==='local'&&values.get('ativa')==='on'&&Object.entries(congregations()).some(([key,c])=>key!==id&&c.tipo==='local'&&c.ativa!==false&&(c.secao??'s2')===selectedSection)){formError(form,'Já existe uma congregação local ativa nesta seção. Edite o cadastro existente.');return}
  form.dataset.saving='yes'
  const item:SpeakerCongregation={nome:name,cidade:city,tipo,ativa:values.get('ativa')==='on',contato:String(values.get('contato')).trim(),telefone:phoneDigits(String(values.get('telefone'))),diaReuniao:String(values.get('diaReuniao')).trim(),horario:String(values.get('horario')),horizonteDatas:([90,180,365].includes(horizon)?horizon:90) as 90|180|365,localizacao:address,mapa:cleanAddress(String(values.get('mapa') ?? '')),observacoes:String(values.get('observacoes')).trim(),...(tipo==='local'?{secao:selectedSection}:{})}
  try{await set(child(oradoresCongregacoesRef,id),item);congregations()[id]=item;selectedCongregationId=id;dirty=false;editingId='';renderCongregations()}catch{toast('Não foi possível salvar')}finally{delete form.dataset.saving}
}
async function deleteCongregation():Promise<void>{const id=editingId,item=congregations()[id];if(!item||congregationInUse(id,schedule(),speakers())){toast('Congregação com vínculos deve ser inativada, não excluída');return}if(!confirm(`Excluir ${item.nome}?`))return;try{await set(child(oradoresCongregacoesRef,id),null);delete congregations()[id];dirty=false;editingId='';renderCongregations()}catch{toast('Não foi possível excluir')}}

function eventEditor():string {
  if(!editingId||!canEditShared())return''
  const item=editingId==='new'?undefined:events[editingId],types=item?.impactoTarefas?.tiposReuniao??[]
  const choices=[['midweek','Meio de semana'],['weekend_s1','Fim de semana · 1ª seção'],['weekend','Fim de semana · 2ª seção']]
  return`<form id="speakerEventForm" class="form-panel"><h3>${item?'Editar evento':'Novo evento'}</h3><div class="module-form-grid">${field('Data',`<input name="data" type="date" value="${esc(item?.data??`${selectedMonth}-01`)}" required>`)}${field('Título',`<input name="titulo" value="${esc(item?.titulo)}" required>`)}${field('Tipo',`<select name="tipo">${Object.entries(EVENT_KIND_LABEL).map(([id,label])=>option(id,label,item?.tipo??'informativo')).join('')}</select>`)}${field('Descrição',`<textarea name="descricao">${esc(item?.descricao)}</textarea>`)}</div><label class="oradores-check"><input name="bloqueiaReuniao" type="checkbox" ${item?.impactoTarefas?.bloqueiaReuniao?'checked':''}> Bloqueia reunião no módulo Tarefas</label><div class="oradores-check-grid">${choices.map(([value,label])=>`<label class="oradores-check"><input name="tipoReuniao" type="checkbox" value="${value}" ${types.includes(value!)?'checked':''}> ${label}</label>`).join('')}</div><div class="service-actions"><button class="btn btn-primary">Salvar</button><button id="cancelEventEdit" class="btn btn-ghost" type="button">Cancelar</button>${item?'<button id="deleteEvent" class="btn btn-danger" type="button">Excluir</button>':''}</div></form>`
}
function renderEvents():void {
  const rows=Object.entries(events).sort((a,b)=>a[1].data.localeCompare(b[1].data))
  root().innerHTML=`${sectionTitle('Eventos')}${canEditShared()?'<button id="newSpeakerEvent" class="btn btn-primary">Novo evento</button>':'<p class="form-help">Eventos gerais compartilhados, editáveis pelos responsáveis das duas seções.</p>'}${eventEditor()}<div class="module-option-list">${rows.map(([id,item])=>`<article class="oradores-row"><div><strong>${esc(item.titulo)}</strong><small>${esc(formatSpeakerDate(item.data))} · ${esc(EVENT_KIND_LABEL[item.tipo])}${item.impactoTarefas?.bloqueiaReuniao?' · Bloqueia Tarefas':''}</small></div>${canEditShared()?`<button class="btn btn-ghost" data-edit-event="${esc(id)}">Editar</button>`:''}</article>`).join('')||empty('Nenhum evento cadastrado.')}</div>`
  mountRecordEditor(root(),'speakerEventForm')
  document.getElementById('newSpeakerEvent')?.addEventListener('click',()=>{editingId='new';renderEvents()})
  document.getElementById('cancelEventEdit')?.addEventListener('click',()=>{editingId='';renderEvents()})
  document.getElementById('speakerEventForm')?.addEventListener('submit',event=>{event.preventDefault();void saveEvent(event.currentTarget as HTMLFormElement)})
  document.getElementById('deleteEvent')?.addEventListener('click',()=>void deleteEvent())
  document.querySelectorAll<HTMLButtonElement>('[data-edit-event]').forEach(button=>button.addEventListener('click',()=>{editingId=button.dataset.editEvent!;renderEvents()}))
}
async function saveEvent(form:HTMLFormElement):Promise<void>{const values=new FormData(form),date=String(values.get('data')),title=String(values.get('titulo')).trim(),blocks=values.get('bloqueiaReuniao')==='on',selectedTypes=values.getAll('tipoReuniao').map(String);if(!validIsoDate(date)||!title){toast('Informe data e título válidos');return}if(blocks&&!selectedTypes.length){toast('Escolha qual reunião será bloqueada');return}const tiposReuniao=[...selectedTypes];const id=editingId==='new'?newSpeakerId('evento'):editingId,item:SpeakerEvent={data:date,titulo:title,descricao:String(values.get('descricao')).trim(),tipo:String(values.get('tipo')) as SpeakerEventKind,impactoTarefas:{bloqueiaReuniao:blocks,tiposReuniao}};try{await set(child(oradoresEventosRef,id),item);events[id]=item;dirty=false;editingId='';renderEvents()}catch{toast('Não foi possível salvar')}}
async function deleteEvent():Promise<void>{const id=editingId,item=events[id];if(!item||!confirm(`Excluir ${item.titulo}?`))return;try{await set(child(oradoresEventosRef,id),null);delete events[id];dirty=false;editingId='';renderEvents()}catch{toast('Não foi possível excluir')}}

function renderAvailableDates(horizon=90):void {
  const panel=document.getElementById('availableDatesPanel');if(!panel)return
  const local=Object.values(congregations()).find(c=>c.tipo==='local'&&(c.secao??'s2')===selectedSection)
  const dates=local?availableDates(data,events,planning,today(),horizon,selectedSection):[]
  panel.innerHTML=`<label class="form-field"><span>Prazo desta mensagem</span><select id="availableHorizon">${[90,180,365].map(value=>option(String(value),`${value} dias`,String(horizon))).join('')}</select></label><p class="form-help">As ${dates.length} datas livres deste prazo entram automaticamente na mensagem. Abrir o WhatsApp não envia a mensagem sozinho.</p><p class="form-help">${esc(local?.nome||'Cadastre a congregação local e configure o dia da reunião.')}. Uma data sem orador definido continua livre; saídas não ocupam a reunião local.</p><div class="oradores-list" style="max-height:240px;overflow:auto">${dates.map(date=>`<div class="module-list-row">${esc(formatSpeakerDate(date))} · ${esc((selectedSection==='s1'?planning.s1Time:planning.s2Time)||local?.horario||'Horário a definir')}</div>`).join('')||empty('Nenhuma data livre neste intervalo.')}</div><div class="service-actions"><button id="sendAvailableDates" class="btn btn-primary" type="button" ${dates.length?'':'disabled'}>WhatsApp · todas as datas</button><button id="copyAvailableDates" class="btn btn-ghost" type="button" ${dates.length?'':'disabled'}>Copiar texto</button></div>`
  document.getElementById('availableHorizon')?.addEventListener('change',event=>{const value=Number((event.target as HTMLSelectElement).value);preferences.set(`horizon:${selectedCongregationId}`,value);renderAvailableDates(value)})
  const message=()=>availableMessage(data,selectedCongregationId,dates,selectedSection==='s1'?planning.s1Time:planning.s2Time,messageSettings.meetingText,selectedSection)
  document.getElementById('sendAvailableDates')?.addEventListener('click',()=>openMessageWhatsApp(message(),toast,congregations()[selectedCongregationId]?.telefone??''))
  document.getElementById('copyAvailableDates')?.addEventListener('click',()=>{void copyMessageText(message(),toast)})
}
function downloadSubstitutionsPdf(button:HTMLButtonElement):void {
  const used=new Set([...themeUsageIndex(data,today())].filter(([,usage])=>usage.past||usage.pending).map(([id])=>id))
  const rows=Object.values(speakers()).filter(item=>item.tipo==='local'&&item.ativo&&(item.secao??'s2')===selectedSection)
    .map(item=>({name:item.nome,themes:item.temaIds.filter(id=>themes()[id]?.ativo&&!used.has(id)).map(id=>themes()[id]!)}))
    .filter(row=>row.themes.length).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))
  const date=today()
  void downloadOperationalReport(button,async()=>{const {createSubstitutionsReportPdf}=await import('./oradores-reports');return createSubstitutionsReportPdf(rows,date)},`substituicoes-${date}.pdf`)
}
