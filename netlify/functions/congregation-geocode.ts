import { OpenLocationCode } from 'open-location-code'
import { appSession, json, objectBody, validCsrf, type AppSession } from '../lib/secure-session.ts'
import { adminDatabase } from '../lib/subscription-store.ts'

interface NominatimPlace {
  lat?: string
  lon?: string
  display_name?: string
  address?: { country_code?: string }
}

export interface GeocodedCongregation {
  plusCode: string
  displayName: string
  mapUrl: string
  attribution: string
}

const encoder = new OpenLocationCode()
const attribution = '© OpenStreetMap contributors'

export function geocodeQuery(address: string, city: string): string {
  return [address.trim(), city.trim(), 'Brasil'].filter(Boolean).join(', ').slice(0, 240)
}

export async function lookupCongregation(query: string, fetcher: typeof fetch = fetch): Promise<GeocodedCongregation | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('countrycodes', 'br')
  url.searchParams.set('limit', '1')
  const response = await fetcher(url, {
    headers: { 'user-agent': 'NoroesteAgenda/1.0 (https://noroeste.netlify.app/)', 'accept-language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('Serviço de localização indisponível.')
  const places = await response.json() as NominatimPlace[]
  const place = Array.isArray(places) ? places[0] : undefined
  const latitude = Number(place?.lat), longitude = Number(place?.lon)
  if (!place || place.address?.country_code !== 'br' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const plusCode = encoder.encode(latitude, longitude, 11)
  return {
    plusCode,
    displayName: String(place.display_name ?? '').slice(0, 300),
    mapUrl:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(plusCode)}`,
    attribution,
  }
}

async function cachedLookup(query: string): Promise<GeocodedCongregation | null> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(query.toLocaleLowerCase('pt-BR')))
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const database = adminDatabase()
  const cacheRef = database.ref(`geocodificacaoPrivada/cache/${key}`)
  const cached = (await cacheRef.get()).val() as { result?: GeocodedCongregation | null; until?: number } | null
  if (cached && Number(cached.until) > Date.now()) return cached.result ?? null
  const rateRef = database.ref('geocodificacaoPrivada/proximaConsulta')
  const reserved = await rateRef.transaction(current => {
    const now = Date.now()
    return Number(current) > now ? undefined : now + 1100
  }, undefined, false)
  if (!reserved.committed) throw new Error('Aguarde um instante e tente salvar novamente.')
  const result = await lookupCongregation(query)
  await cacheRef.set({ result, until:Date.now() + 30 * 24 * 60 * 60 * 1000 })
  return result
}

export async function congregationGeocodeResponse(
  request: Request,
  resolveSession = appSession,
  resolveAddress = cachedLookup,
): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error:'Método não permitido.' })
  const session: AppSession | null = await resolveSession(request)
  if (!session || !(session.usuario.apps.oradores || session.usuario.apps.mestre)) return json(403, { error:'Acesso não autorizado.' })
  if (!validCsrf(request, session)) return json(403, { error:'Sessão inválida.' })
  const body = await objectBody(request)
  const address = typeof body['address'] === 'string' ? body['address'].trim() : ''
  const city = typeof body['city'] === 'string' ? body['city'].trim() : ''
  if (address.length < 8 || address.length > 180 || city.length > 80) return json(400, { error:'Informe um endereço mais completo.' })
  try {
    const result = await resolveAddress(geocodeQuery(address, city))
    return result ? json(200, result) : json(404, { error:'Não encontramos um ponto para esse endereço. Confira rua, número e cidade ou informe o mapa manualmente.' })
  } catch (error) {
    console.error('Geocode failed:', error instanceof Error ? error.message : 'Unknown error')
    return json(503, { error:error instanceof Error && error.message.startsWith('Aguarde') ? error.message : 'A busca de endereço está indisponível. Tente novamente ou informe o mapa manualmente.' })
  }
}

export default (request: Request): Promise<Response> => congregationGeocodeResponse(request)
