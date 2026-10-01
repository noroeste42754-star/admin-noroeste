import { json } from './secure-session.ts'
export function retiredAgendaResponse():Response {
  return json(410,{error:'A agenda pessoal foi encerrada. Consulte o Quadro de Anúncios, sem login.',url:'/quadro/'})
}
