import './style.css'
import mountQuadro from './modules/quadro'
import { refreshServiceWorkerWeekly } from './pwa-sync'

mountQuadro()
let installPrompt:(Event&{prompt():Promise<void>;userChoice:Promise<unknown>})|null=null
const offer=document.createElement('aside');offer.className='agenda-install-suggestion';offer.innerHTML='<span>Instale o Quadro de Anúncios para consultar também offline.</span><button id="quadroInstall" class="btn btn-ghost">Instalar Quadro</button>'
if(!window.matchMedia('(display-mode: standalone)').matches)document.querySelector('.quadro-standalone')?.prepend(offer)
document.getElementById('quadroInstall')?.addEventListener('click',async()=>{if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null}else alert('No menu do navegador, escolha Instalar aplicativo ou Adicionar à tela inicial. No iPhone, use Compartilhar → Adicionar à Tela de Início.')})
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e as typeof installPrompt})
window.addEventListener('appinstalled',()=>offer.remove())
if('serviceWorker'in navigator){
  const legacy=location.pathname.startsWith('/agenda')
  void navigator.serviceWorker.register(legacy?'/agenda/sw.js':'/quadro/sw.js',{scope:legacy?'/agenda/':'/quadro/'}).then(r=>refreshServiceWorkerWeekly(r,'noroeste_quadro_worker_update_v1')).catch(()=>undefined)
}
