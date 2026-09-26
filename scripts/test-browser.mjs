import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
const probe=createServer()
await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve))
const port=probe.address().port
await new Promise(resolve=>probe.close(resolve))
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
let logs=''
server.stdout.on('data',chunk=>logs+=chunk);server.stderr.on('data',chunk=>logs+=chunk)
const url='http://127.0.0.1:'+port+'/'
try {
  let ready=false
  for(let attempt=0;attempt<100;attempt++){try{ready=(await fetch(url)).ok}catch{}if(ready)break;if(server.exitCode!==null)throw Error(logs);await delay(200)}
  if(!ready)throw Error('Preview não iniciou: '+logs)
  for(const script of (process.env.BROWSER_TESTS?.split(',')??['module-install-browser.mjs','operations-browser.mjs','layout-mobile-browser.mjs','usability-browser.mjs','pending-guidance-browser.mjs','messages-browser.mjs','oradores-browser.mjs','integration-browser.mjs'])) {
    console.log('\nNavegador: '+script)
    const child=spawn(process.execPath,['tests/'+script],{windowsHide:true,stdio:'inherit',env:{...process.env,APP_TEST_URL:url}})
    const timer=setTimeout(()=>child.kill(),180000)
    const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)})
    clearTimeout(timer)
    if(result!==0)throw Error(script+' falhou ('+result+')')
  }
}finally{server.kill()}
