import { getStore } from '@netlify/blobs'
import type { AppPermissions } from '../../src/types.ts'
import { appSession, json, objectBody, validCsrf } from '../lib/secure-session.ts'
import { pdfHasExpired } from '../../src/modules/pdf-expiry.ts'

const MAX_PDF_BYTES = 4 * 1024 * 1024
const PDF_STORE = 'admin-noroeste-pdfs'
const MODULES: Record<string, keyof AppPermissions> = {
  tarefas:'tarefas', limpeza:'limpeza', escala:'escala',
  oradores:'oradores',
  servicoCampo:'servicoCampo',
}

export function validStoragePath(path: string): boolean {
  return path.length <= 240 && /^[A-Za-z0-9/_-]+\.pdf$/.test(path) && !path.includes('//') && !path.includes('..')
}

export function canManageStoragePath(path: string, apps: AppPermissions): boolean {
  if (/^agenda\/documentos\/admin\/[A-Za-z0-9._-]+\.pdf$/.test(path)) return apps.mestre === true
  const match = path.match(/^agenda\/documentos\/modulos\/([^/]+)\//)
  const permission = match ? MODULES[match[1] ?? ''] : undefined
  return Boolean(permission && (apps.mestre || apps[permission] === true || (permission === 'oradores' && apps.oradoresS1 === true)))
}

export function canReadPublicStoragePath(path: string): boolean {
  return /^agenda\/documentos\/(admin|modulos\/(tarefas|oradores|limpeza|escala|servicoCampo))\/[A-Za-z0-9/_.-]+\.pdf$/.test(path)
}

function decodePdf(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PDF_BYTES * 4 / 3) + 8) return null
  try {
    const binary = atob(value)
    if (binary.length < 5 || binary.length > MAX_PDF_BYTES || !binary.startsWith('%PDF-')) return null
    return Uint8Array.from(binary, char => char.charCodeAt(0))
  } catch { return null }
}

export async function storageFileResponse(
  request: Request,
  createStore = () => getStore(PDF_STORE, { consistency:'strong' }),
  resolveSession = appSession,
): Promise<Response> {
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) return json(405, { error:'Método não permitido.' })
  let store: ReturnType<typeof createStore>
  try { store = createStore() } catch { return json(503, { error:'Armazenamento de PDF indisponível.' }) }
  if (request.method === 'GET') {
    const path = new URL(request.url).searchParams.get('path') ?? ''
    if (!validStoragePath(path) || !canReadPublicStoragePath(path)) return json(404, { error:'PDF não encontrado.' })
    try {
      const item = await store.getWithMetadata(path, { type:'arrayBuffer', consistency:'strong' })
      if (!item) return json(404, { error:'PDF não encontrado.' })
      if (pdfHasExpired(item.metadata?.['createdAt'])) return json(410, { error:'PDF expirado.' })
      const filename = path.slice(path.lastIndexOf('/') + 1) || 'documento.pdf'
      return new Response(item.data, {
        status:200,
        headers:{
          'content-type':'application/pdf',
          'content-disposition':`inline; filename="${filename}"`,
          'content-length':String(item.data.byteLength),
          'cache-control':'public, max-age=300',
          'x-content-type-options':'nosniff',
        },
      })
    } catch (error) {
      console.error('PDF read failed:', error instanceof Error ? error.message : 'Unknown error')
      return json(503, { error:'Armazenamento de PDF indisponível.' })
    }
  }

  let session
  try { session = await resolveSession(request) } catch { return json(503, { error:'Sessão indisponível.' }) }
  if (!session) return json(401, { error:'Sessão expirada.' })
  if (!validCsrf(request, session)) return json(403, { error:'Validação da sessão ausente.' })
  const body = await objectBody(request), path = String(body['path'] ?? '')
  if (!validStoragePath(path) || !canManageStoragePath(path, session.usuario.apps)) return json(403, { error:'Arquivo não autorizado.' })

  try {
    if (request.method === 'DELETE') {
      await store.delete(path)
      return json(200, { ok:true })
    }
    const bytes = decodePdf(body['base64'])
    if (!bytes) return json(400, { error:'PDF inválido ou maior que 4 MB.' })
    const payload = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(payload).set(bytes)
    await store.set(path, payload, { metadata:{ contentType:'application/pdf', createdAt:new Date().toISOString(), bytes:bytes.byteLength } })
    const requestUrl = new URL(request.url)
    const url = `${requestUrl.origin}/.netlify/functions/storage-file?path=${encodeURIComponent(path)}`
    return json(200, { url })
  } catch (error) {
    console.error('PDF write failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(503, { error:'Armazenamento de PDF indisponível.' })
  }
}

export default (request: Request): Promise<Response> => storageFileResponse(request)
