// Optional audit instrumentation: NODE_OPTIONS=--import=./tests/button-coverage.mjs.
// Records action types only; repeated row actions share one key. No remote writes.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const seen=new Map(),contexts=new WeakSet()
async function instrument(context){
  if(contexts.has(context))return
  contexts.add(context)
  await context.exposeBinding('__buttonAudit',(_source,event)=>{
    const key=`${event.module}|${event.key}`,entry=seen.get(key)??{module:event.module,key:event.key,labels:[],seen:0,clicked:0,disabled:0}
    if(event.label&&!entry.labels.includes(event.label))entry.labels.push(event.label)
    entry[event.event]=(entry[event.event]??0)+1
    seen.set(key,entry)
  })
  await context.addInitScript(()=>{
    const reported=new WeakMap()
    const module=()=>document.querySelector('#mestreRoot')?'mestre':document.querySelector('#tarefasRoot')?'tarefas':document.querySelector('#escalaRoot')?'escala':document.querySelector('#oradoresRoot')?(document.body.innerText.includes('Oradores · 1ª seção')?'oradoresS1':'oradores'):document.querySelector('#quadroRoot')?'quadro':location.pathname.includes('quadro')||location.pathname.includes('agenda')?'quadro':location.pathname.match(/\/modulos\/([^/]+)/)?.[1]??'app'
    const key=el=>{
      if(el.id)return '#'+el.id
      const attrs=[...el.attributes].filter(a=>a.name.startsWith('data-'))
      if(attrs.length){const a=attrs[0],value=/^data-(workspace-tab|quadro-tab|quadro-filter|theme-filter|schedule-filter|tab|module)$/.test(a.name)?'='+a.value:'';return '['+a.name+value+']'}
      if(el.type==='submit')return `form#${el.closest('form')?.id??''} submit`
      if(el.tagName==='A')return 'link:'+el.textContent.trim()
      return 'text:'+el.textContent.trim().slice(0,80)
    }
    const report=(el,event)=>{
      if(!(el instanceof HTMLElement))return
      const label=(el.getAttribute('aria-label')||el.textContent||'').trim().replace(/\s+/g,' ').slice(0,100)
      void window.__buttonAudit({module:module(),key:key(el),label,event})
    }
    const scan=()=>document.querySelectorAll('button,[role="button"],a.btn').forEach(el=>{
      if(!el.getClientRects().length)return
      const state=el.disabled?'disabled':'seen',identity=module()+'|'+key(el)+'|'+state
      if(reported.get(el)===identity)return
      reported.set(el,identity);report(el,state)
    })
    document.addEventListener('click',event=>{const el=event.target.closest?.('button,[role="button"],a.btn');if(el)report(el,'clicked')},true)
    document.addEventListener('DOMContentLoaded',()=>{scan();new MutationObserver(scan).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','hidden','style','class']})})
  })
}
const launch=chromium.launch.bind(chromium)
chromium.launch=async(...args)=>{
  const browser=await launch(...args),newContext=browser.newContext.bind(browser),newPage=browser.newPage.bind(browser)
  browser.newContext=async(...options)=>{const context=await newContext(...options);await instrument(context);return context}
  browser.newPage=async(...options)=>{const page=await newPage(...options);await instrument(page.context());return page}
  return browser
}
process.once('exit',()=>{
  if(!seen.size)return
  const dir=path.resolve('output/button-audit-2026-10-01')
  fs.mkdirSync(dir,{recursive:true})
  const name=path.basename(process.argv[1]??'browser').replace(/[^a-z0-9.-]/gi,'_')
  fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify([...seen.values()],null,2)+'\n')
})
