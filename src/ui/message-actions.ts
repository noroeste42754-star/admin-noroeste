import { whatsappPhone } from '../modules/message-domain'

export async function copyMessageText(message:string,toast:(text:string)=>void):Promise<void>{
  if(!message.trim()){toast('Nenhuma informação para copiar.');return}
  try{await navigator.clipboard.writeText(message);toast('Texto copiado')}
  catch{toast('Não foi possível copiar o texto')}
}

export function openMessageWhatsApp(message:string,toast:(text:string)=>void,phone?:string):void{
  if(!message.trim()){toast('Nenhuma informação para enviar.');return}
  const digits=phone===undefined?'':whatsappPhone(phone)
  if(digits===null||phone!==undefined&&!digits){toast('Cadastre um WhatsApp com DDD ou use Copiar texto.');return}
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer')
}
