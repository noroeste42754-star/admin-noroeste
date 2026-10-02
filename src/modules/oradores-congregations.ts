import type { Speaker, SpeakerCongregation, SpeakersRoot, TalkSchedule } from './oradores-domain.ts'

export function localCongregationName(item:TalkSchedule, congregations:Record<string,SpeakerCongregation>):string {
  const section=item.secao??'s2', linked=congregations[item.localCongregacaoId??'']
  const local=linked?.tipo==='local'&&(linked.secao??'s2')===section?linked:Object.values(congregations).find(c=>c.tipo==='local'&&(c.secao??'s2')===section)
  return local?.nome?.trim()||item.localCongregacaoNome?.trim()||`Congregação local · ${section==='s1'?'1ª':'2ª'} seção`
}

export function combinedCongregationTitle(congregations:Record<string,SpeakerCongregation>):string {
  const names=Object.values(congregations).filter(c=>c.tipo==='local'&&c.ativa!==false).sort((a,b)=>(a.secao??'s2').localeCompare(b.secao??'s2')).map(c=>c.nome.trim()).filter(Boolean)
  return [...new Set(names)].join(' / ')||'Congregação Noroeste · 1ª e 2ª seções'
}

export function congregationInUse(id:string,schedule:Record<string,TalkSchedule>,speakers:Record<string,Speaker>={}):boolean {
  return Object.values(schedule).some(item=>[item.localCongregacaoId,item.congregacaoOrigemId,item.congregacaoDestinoId].includes(id))||Object.values(speakers).some(item=>item.congregacaoId===id)
}

/** Reject broken links and newly duplicated local congregations, also for Admin. */
export function preservesSpeakerCongregations(before:SpeakersRoot,after:SpeakersRoot):boolean {
  for(const [id,previous] of Object.entries(before.congregacoes??{})) {
    const next=after.congregacoes?.[id]
    if(congregationInUse(id,after.programacao??{},after.oradores??{})&&(!next||next.tipo!==previous.tipo||(previous.tipo==='local'&&(next.secao??'s2')!==(previous.secao??'s2'))))return false
  }
  const count=(root:SpeakersRoot,section:string)=>Object.values(root.congregacoes??{}).filter(c=>c.tipo==='local'&&c.ativa!==false&&(c.secao??'s2')===section).length
  return ['s1','s2'].every(section=>count(after,section)<=Math.max(1,count(before,section)))
}
