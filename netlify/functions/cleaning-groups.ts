import { json } from '../lib/secure-session.ts'
export default async ():Promise<Response> => json(410,{error:'O módulo Limpeza foi retirado. Os dados históricos foram preservados.'})
