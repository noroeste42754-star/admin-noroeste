import type { AppContext,AgendaPublicDocument } from '../types'
import { apiJson } from '../secure-api'
import { addCivilDays,fortalezaCurrentMonth,fortalezaToday,isValidCivilDate } from './civil-date'
import { agendaToIcs,type AnnouncementEvent } from './individual-domain'
import { groupPublicDocuments,publicDocumentMonths,PUBLIC_PDF_MODULES,documentCoversMonth } from './agenda-documents-domain'
import { pdfHasExpired } from './pdf-expiry'
import { isQuadroData,mergeQuadroData,QUADRO_SOURCES,safePublicLink,type QuadroData } from './quadro-domain'

const CACHE_KEY='noroeste_quadro_publico_v1',UI_KEY='noroeste_quadro_ui_v1'
const empty=():QuadroData=>({events:[],notices:[],agenda:{config:{},documentos:{}},completedSources:[],failedSources:[]})
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]!))
const dateLabel=(v:string)=>v.split('-').reverse().join('/')
const monthLabel=(v:string)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${v}-15T12:00:00Z`))
const labels:Record<string,string>={tarefas:'Tarefas',oradores:'Oradores · duas seções',escala:'Escala TPL',geral:'Eventos gerais',quadro:'Anúncios e PDFs'}
let data=empty(),loading=false,savedAt=0,generation=0,host:HTMLElement|null=null
let month=fortalezaCurrentMonth(),selectedDate=fortalezaToday(),panel='geral',filter='todos',documentMonth=month
let refreshTimer:ReturnType<typeof setInterval>|undefined
let stopListeners:()=>void=()=>{}

export default function mount(_context?:AppContext):void {
  generation++;data=empty();savedAt=0;loading=false;month=fortalezaCurrentMonth();selectedDate=fortalezaToday();panel='geral';filter='todos';documentMonth=month
  clearInterval(refreshTimer)
  stopListeners()
  const content=document.getElementById('appContent');if(!content)return
  content.innerHTML='<section id="quadroRoot" class="quadro-root"></section>';host=document.getElementById('quadroRoot')
  try{const c=JSON.parse(localStorage.getItem(CACHE_KEY)??'null');if(isQuadroData(c?.data)){data=c.data;const timestamp=Number(c.savedAt);savedAt=Number.isFinite(timestamp)&&timestamp>=0&&timestamp<=Date.now()?timestamp:0}}catch{/* online-first */}
  try{const ui=JSON.parse(localStorage.getItem(UI_KEY)??'null');if(/^\d{4}-(0[1-9]|1[0-2])$/.test(ui?.month??''))month=ui.month;if(isValidCivilDate(ui?.date??''))selectedDate=ui.date;if(ui?.panel==='documentos')panel='documentos'}catch{/* defaults */}
  render();void synchronize()
  const currentHost=host
  const update=()=>{if(currentHost?.isConnected)void synchronize()}
  const connection=()=>{if(currentHost?.isConnected){render();if(navigator.onLine)void synchronize()}}
  window.addEventListener('quadro-updated',update);window.addEventListener('online',connection);window.addEventListener('offline',connection)
  stopListeners=()=>{window.removeEventListener('quadro-updated',update);window.removeEventListener('online',connection);window.removeEventListener('offline',connection)}
  refreshTimer=setInterval(()=>{if(!currentHost?.isConnected){clearInterval(refreshTimer);stopListeners();return}if(document.visibilityState==='visible'&&navigator.onLine&&!loading)void synchronize()},60000)
}
function persist():void{try{localStorage.setItem(UI_KEY,JSON.stringify({month,date:selectedDate,panel}))}catch{/* optional */}}
async function synchronize(sources?:string[]):Promise<void>{
  if(loading||!host?.isConnected)return
  const current=++generation;loading=true;render()
  try{
    const incoming=await apiJson<QuadroData>('quadro-data'+(sources?.length?'?sources='+encodeURIComponent(sources.join(',')):''),{credentials:'omit'})
    if(current!==generation||!host?.isConnected)return
    if(!isQuadroData(incoming))throw new Error('Resposta inválida')
    data=mergeQuadroData(data,incoming)
    if(!data.failedSources.length)savedAt=Date.now()
    try{localStorage.setItem(CACHE_KEY,JSON.stringify({data,savedAt}))}catch{/* optional offline storage */}
  }catch{if(current===generation)data.failedSources=[...new Set([...data.failedSources,...(sources??QUADRO_SOURCES)])]}
  finally{if(current===generation){loading=false;render()}}
}
function filteredEvents():AnnouncementEvent[]{return data.events.filter(e=>filter==='todos'||filter===e.source||filter==='s1'&&e.source==='oradores'&&e.detail.includes('1ª seção')||filter==='s2'&&e.source==='oradores'&&e.detail.includes('2ª seção'))}
function eventRows(events:AnnouncementEvent[]):string{return events.map(e=>`<article class="agenda-event"><time>${esc(e.time??'Dia inteiro')}</time><div><strong>${esc(e.title)}</strong><small><span class="agenda-source ${esc(e.source)}">${esc(labels[e.source])}</span> · ${esc(e.detail)}</small><p>${esc(e.people.join(' · '))}</p>${e.location?`<small>${esc(e.location)}</small>`:''}</div></article>`).join('')}
function selectedText():string {
  const events=data.events.filter(e=>e.date===selectedDate),notices=data.notices.filter(e=>e.date===selectedDate)
  const summary=[`QUADRO DE ANÚNCIOS · ${dateLabel(selectedDate)}`,...notices.map(n=>`${n.title}${n.description?'\n'+n.description:''}`),...events.map(e=>`${e.time?e.time+' · ':''}${e.title}\n${e.detail}${e.people.length?'\n'+e.people.join(', '):''}${e.location?'\n'+e.location:''}`)].join('\n\n')
  return (data.agenda.config.moduleWhatsApp?.quadro?.meetingText??'{dados_da_reuniao}').split('{dados_da_reuniao}').join(summary)
}
function render():void {
  if(!host?.isConnected)return
  const failed=data.failedSources,syncText=failed.length?'Informações parciais: '+failed.map(s=>labels[s]??s).join(', ')+'. Os últimos dados disponíveis foram preservados.':savedAt?'Atualizado em '+new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Fortaleza'}).format(savedAt):'Consultando os módulos...'
  host.innerHTML=`<header class="quadro-header"><div><h1>Quadro de Anúncios</h1><p>Programação e informações gerais para todos</p></div><button id="quadroRefresh" class="btn btn-ghost" ${loading?'disabled':''}>${loading?'Atualizando…':'Atualizar'}</button></header><p class="notice ${failed.length?'warning':''}" role="status">${esc(syncText)}${!navigator.onLine?' · Offline':''}</p>${failed.length?'<button id="quadroRetry" class="btn btn-ghost">Tentar novamente</button>':''}<nav class="quadro-tabs" aria-label="Consultas do Quadro"><button class="btn ${panel==='geral'?'btn-primary':'btn-ghost'}" data-quadro-tab="geral">Programação geral</button><button class="btn ${panel==='documentos'?'btn-primary':'btn-ghost'}" data-quadro-tab="documentos">Anúncios e PDFs</button></nav><div id="quadroPanel"></div>`
  panel==='documentos'?renderDocuments():renderGeneral()
  document.getElementById('quadroRefresh')?.addEventListener('click',()=>void synchronize())
  document.getElementById('quadroRetry')?.addEventListener('click',()=>void synchronize([...data.failedSources]))
  host.querySelectorAll<HTMLButtonElement>('[data-quadro-tab]').forEach(b=>b.addEventListener('click',()=>{panel=b.dataset.quadroTab!;persist();render()}))
}
function renderGeneral():void {
  const root=document.getElementById('quadroPanel')!,events=filteredEvents().filter(e=>e.date.startsWith(month))
  if(!selectedDate.startsWith(month))selectedDate=events.find(e=>e.date>=fortalezaToday())?.date??events[0]?.date??month+'-01'
  const [year,m]=month.split('-').map(Number),first=new Date(Date.UTC(year!,m!-1,1)).getUTCDay(),days=new Date(Date.UTC(year!,m!,0)).getUTCDate()
  const calendar=[...Array(first).fill(null),...Array.from({length:days},(_,i)=>i+1)]
  const notices=data.notices.filter(n=>n.date===selectedDate),selected=events.filter(e=>e.date===selectedDate)
  root.innerHTML=`<div class="agenda-toolbar"><button id="quadroPrev" class="btn btn-ghost" aria-label="Mês anterior">‹</button><label class="sr-only" for="quadroMonth">Mês da programação</label><input id="quadroMonth" type="month" class="form-input" value="${esc(month)}"><button id="quadroNext" class="btn btn-ghost" aria-label="Próximo mês">›</button><button id="quadroToday" class="btn btn-ghost">Hoje</button></div><div class="quadro-filters" aria-label="Filtrar programação">${[['todos','Todos'],['tarefas','Tarefas'],['escala','Escala TPL'],['s1','Oradores · 1ª'],['s2','Oradores · 2ª']].map(([value,label])=>`<button class="btn ${filter===value?'btn-primary':'btn-ghost'}" data-quadro-filter="${value}" aria-pressed="${filter===value}">${label}</button>`).join('')}</div><div class="agenda-calendar"><div class="agenda-weekdays">${['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>`<strong>${d}</strong>`).join('')}</div><div class="agenda-days">${calendar.map(day=>{if(!day)return'<div class="agenda-day empty"></div>';const date=`${month}-${String(day).padStart(2,'0')}`,count=events.filter(e=>e.date===date).length+data.notices.filter(n=>n.date===date).length;return`<button class="agenda-day agenda-day-button ${count?'has-events':''} ${date===selectedDate?'selected':''}" data-quadro-date="${date}" aria-pressed="${date===selectedDate}" aria-label="${dateLabel(date)}, ${count} itens"><span>${day}</span>${count?`<span class="quadro-day-count">${count}</span>`:''}</button>`}).join('')}</div></div><div class="agenda-selected-day"><strong>${esc(dateLabel(selectedDate))}</strong><span>${selected.length+notices.length} item(ns)</span></div><div class="agenda-list">${notices.map(n=>`<article class="notice"><strong>${esc(n.title)}</strong><p>${esc(n.description)}</p></article>`).join('')}${eventRows(selected)||(!notices.length?'<p class="empty-state">Nenhuma programação publicada nesta data.</p>':'')}</div><details class="form-panel"><summary>Copiar informações desta data</summary><textarea id="quadroText" class="form-input" rows="8" aria-label="Informações gerais para compartilhar">${esc(selectedText())}</textarea><div class="agenda-actions"><button id="quadroCopy" class="btn btn-ghost">Copiar texto</button>${safePublicLink(data.agenda.config.moduleWhatsApp?.quadro?.groupLink??data.agenda.config.quadroWhatsAppLink)?`<a class="btn btn-primary" href="${esc(safePublicLink(data.agenda.config.moduleWhatsApp?.quadro?.groupLink??data.agenda.config.quadroWhatsAppLink))}" target="_blank" rel="noopener noreferrer">Abrir grupo do Quadro</a>`:''}<button id="quadroIcs" class="btn btn-ghost">Baixar calendário geral</button></div></details>`
  const move=(delta:number)=>{month=addCivilDays(delta>0?month+'-'+String(days).padStart(2,'0'):month+'-01',delta>0?1:-1).slice(0,7);persist();render()}
  document.getElementById('quadroPrev')?.addEventListener('click',()=>move(-1));document.getElementById('quadroNext')?.addEventListener('click',()=>move(1))
  document.getElementById('quadroToday')?.addEventListener('click',()=>{month=fortalezaCurrentMonth();selectedDate=fortalezaToday();persist();render()})
  document.getElementById('quadroMonth')?.addEventListener('change',e=>{const value=(e.target as HTMLInputElement).value;if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value)){month=value;persist();render()}})
  root.querySelectorAll<HTMLButtonElement>('[data-quadro-date]').forEach(b=>b.addEventListener('click',()=>{selectedDate=b.dataset.quadroDate!;persist();render()}))
  root.querySelectorAll<HTMLButtonElement>('[data-quadro-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.quadroFilter!;render()}))
  document.getElementById('quadroCopy')?.addEventListener('click',async()=>{const button=document.getElementById('quadroCopy')!;try{await navigator.clipboard.writeText((document.getElementById('quadroText') as HTMLTextAreaElement).value);button.textContent='Copiado'}catch{button.textContent='Selecione e copie o texto'}})
  document.getElementById('quadroIcs')?.addEventListener('click',()=>{
    const all=data.events.filter(e=>e.date.startsWith(month)).map(e=>({...e,detail:[e.detail,e.people.join(', ')].filter(Boolean).join(' · ')}))
    const bytes=agendaToIcs(all,new Date().toISOString(),{calendarName:'Quadro de Anúncios Noroeste',namespace:'noroeste-quadro',reminders:{tarefas:data.agenda.config.icsReminders?.tarefas??[],oradores:data.agenda.config.icsReminders?.oradores??[],escala:data.agenda.config.icsReminders?.escala??[]}})
    const url=URL.createObjectURL(new Blob([bytes],{type:'text/calendar;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`quadro-anuncios-${month}.ics`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  })
}
function documentRow(item:AgendaPublicDocument,label:string):string {
  const url=safePublicLink(item.url)
  return url?`<article class="agenda-module-download"><div><strong>${esc(label)}</strong><small>${esc(item.periodo)} · ${esc(item.nome)}</small></div><a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" download="${esc(item.nome)}">Abrir PDF</a></article>`:''
}
function renderDocuments():void {
  const root=document.getElementById('quadroPanel')!,docs=Object.values(data.agenda.documentos??{}).filter(d=>!pdfHasExpired(d.criadoEm)),periods=publicDocumentMonths(docs)
  if(periods.length&&!periods.includes(documentMonth))documentMonth=periods.includes(month)?month:periods[0]!
  const grouped=groupPublicDocuments(docs,documentMonth),admin=docs.filter(d=>d.modulo==='admin'&&(documentCoversMonth(d,documentMonth)||!d.inicio&&!d.fim)).sort((a,b)=>b.criadoEm.localeCompare(a.criadoEm)),drive=safePublicLink(data.agenda.config.outrosAnunciosDriveUrl)
  root.innerHTML=`<section class="form-panel"><h2>PDFs publicados</h2><p class="form-help">Documentos oficiais dos módulos. Oradores reúne as duas seções em um único PDF.</p><label class="form-field"><span>Período</span><select id="quadroDocumentMonth" class="form-select">${(periods.length?periods:[month]).map(p=>`<option value="${p}" ${p===documentMonth?'selected':''}>${esc(monthLabel(p))}</option>`).join('')}</select></label><div class="agenda-module-downloads">${PUBLIC_PDF_MODULES.map(module=>grouped.modules[module]?documentRow(grouped.modules[module]!,labels[module]!):'').join('')||'<p class="empty-state">Nenhum PDF publicado neste período.</p>'}</div></section><section class="form-panel"><h2>Anúncios do Admin</h2>${admin.map(d=>documentRow(d,d.nome)).join('')||'<p class="form-help">Nenhum documento adicional publicado.</p>'}${drive?`<a class="btn btn-primary" href="${esc(drive)}" target="_blank" rel="noopener noreferrer">Abrir outros anúncios</a>`:''}<div class="quadro-notices">${data.notices.map(n=>`<article class="notice"><strong>${esc(dateLabel(n.date))} · ${esc(n.title)}</strong><p>${esc(n.description)}</p></article>`).join('')}</div></section>`
  document.getElementById('quadroDocumentMonth')?.addEventListener('change',e=>{documentMonth=(e.target as HTMLSelectElement).value;render()})
}
