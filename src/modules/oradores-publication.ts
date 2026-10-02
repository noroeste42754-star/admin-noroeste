import { monthBounds, scheduleCongregationId, scheduleCongregationName, scheduleSpeakerNames, type SpeakersRoot } from './oradores-domain.ts'
import { combinedCongregationTitle, localSpeakerOriginName } from './oradores-congregations.ts'

/** Only printable data: confirmation and administrative notes do not change the PDF. */
export function publicationSource(root: SpeakersRoot, month: string): string {
  const bounds = monthBounds(month), congregations = root.congregacoes ?? {}
  const localName = combinedCongregationTitle(congregations)
  const rows = Object.values(root.programacao ?? {}).filter(item => item.data >= bounds.start && (item.tipo === 'saida_orador' || item.data <= bounds.end))
    .sort((a,b) => a.data.localeCompare(b.data) || (a.secao??'s2').localeCompare(b.secao??'s2') || a.tipo.localeCompare(b.tipo))
    .map(item => {
      const theme = root.temas?.[item.temaId ?? ''], destination = congregations[scheduleCongregationId(item)]
      return [item.data, item.tipo==='saida_orador'?(root.oradores?.[item.oradorId??'']?.secao??item.secao??'s2'):item.secao??'s2', item.tipo, scheduleSpeakerNames(item,root.oradores??{}),
        theme?.numero ?? item.temaNumero ?? '-', item.tipo === 'saida_orador' ? '' : theme?.titulo ?? item.temaTitulo ?? '-',
        item.tipo === 'discurso_local' ? localSpeakerOriginName(item,congregations) : destination?.nome ?? scheduleCongregationName(item) ?? '-',
        item.tipo === 'saida_orador' ? destination?.localizacao?.trim() || '-' : '']
    })
  return JSON.stringify([month, localName, rows])
}
export async function publicationHash(source: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
