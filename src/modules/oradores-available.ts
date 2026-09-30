import type { SpeakersRoot, SpeakerEvent, SpeakerSection } from './oradores-domain.ts'
export function availableDates(root:SpeakersRoot,events:Record<string,SpeakerEvent>,planning:{meetingDays?:{weekendDow?:number;weekendS1Dow?:number};excludedDates?:string[]},today:string,horizon:number,section:SpeakerSection='s2'):string[] {
  const dow=section==='s1'?(planning.meetingDays?.weekendS1Dow??planning.meetingDays?.weekendDow):planning.meetingDays?.weekendDow
  if(dow===undefined||dow<0||dow>6)return []
  const occupied=new Set(Object.values(root.programacao??{}).filter(row=>(row.secao??'s2')===section&&row.tipo!=='saida_orador').map(row=>row.data))
  const blocked=new Set([...(planning.excludedDates??[]),...Object.values(events).filter(event=>event.tipo!=='informativo').map(event=>event.data)])
  const dates:string[]=[],start=new Date(`${today}T12:00:00Z`)
  for(let offset=0;offset<=Math.min(365,Math.max(0,horizon));offset++){
    const date=new Date(start);date.setUTCDate(date.getUTCDate()+offset)
    const iso=date.toISOString().slice(0,10)
    if(date.getUTCDay()===dow&&!occupied.has(iso)&&!blocked.has(iso))dates.push(iso)
  }
  return dates
}
