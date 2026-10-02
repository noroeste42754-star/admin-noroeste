import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib/cjs/index.js'
import { downloadPdf } from '../ui/pdf-download.ts'
import { ellipsizePdfText } from '../ui/pdf-text-fit.ts'
import { localSpeakerOriginName } from './oradores-congregations.ts'
import { A4_PORTRAIT, PDF_ACCENT, PDF_INK, PDF_LINE, PDF_MUTED, drawPublicPdfHeader } from '../ui/public-pdf-layout.ts'
import { monthBounds, scheduleCongregationId, scheduleCongregationName, scheduleSpeakerNames, type Speaker, type SpeakerCongregation, type TalkSchedule, type TalkTheme } from './oradores-domain.ts'

interface Input {
  month: string
  schedule: TalkSchedule[]
  speakers: Record<string, Speaker>
  themes: Record<string, TalkTheme>
  congregations: Record<string, SpeakerCongregation>
}

const MARGIN = 32
const ROW_HEIGHT = 18
const monthLabel = (month:string): string => new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-15T12:00:00Z`))
const pdfDate = (date:string): string => /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8,10)}/${date.slice(5,7)}` : date
const congregationName = (item:TalkSchedule, congregations:Record<string,SpeakerCongregation>): string => congregations[scheduleCongregationId(item)]?.nome ?? scheduleCongregationName(item) ?? '-'

function drawRow(page:PDFPage, fonts:{regular:PDFFont;bold:PDFFont}, values:string[], widths:number[], y:number, header=false, shaded=false):void {
  const width=widths.reduce((sum,item)=>sum+item,0)
  page.drawRectangle({x:MARGIN,y:y-ROW_HEIGHT,width,height:ROW_HEIGHT,color:header?PDF_ACCENT:shaded?rgb(.975,.975,.969):rgb(1,1,1),borderColor:PDF_LINE,borderWidth:.4})
  let x=MARGIN
  values.forEach((value,index)=>{
    if(index)page.drawLine({start:{x,y},end:{x,y:y-ROW_HEIGHT},thickness:.4,color:PDF_LINE})
    const font=header?fonts.bold:fonts.regular,size=header?7.7:8.2
    page.drawText(ellipsizePdfText(font,value,widths[index]!-8,size),{x:x+4,y:y-12,size,font,color:header?rgb(1,1,1):PDF_INK})
    x+=widths[index]!
  })
}

export function speakersPdfScheduleRows(input:Pick<Input,'month'|'schedule'>):{local:TalkSchedule[];outgoing:TalkSchedule[]} {
  const bounds=monthBounds(input.month), sorted=[...input.schedule].sort((a,b)=>a.data.localeCompare(b.data)||(a.secao??'s2').localeCompare(b.secao??'s2')||a.tipo.localeCompare(b.tipo))
  return {
    local:sorted.filter(item=>item.tipo!=='saida_orador'&&item.data>=bounds.start&&item.data<=bounds.end),
    outgoing:sorted.filter(item=>item.tipo==='saida_orador'&&item.data>=bounds.start),
  }
}

export async function createSpeakersSchedulePdf(input:Input):Promise<Uint8Array> {
  const pdf=await PDFDocument.create(), regular=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold), fonts={regular,bold}
  const {local,outgoing}=speakersPdfScheduleRows(input)
  let page!:PDFPage,y=0,pageNumber=0
  const addPage=():void=>{
    page=pdf.addPage(A4_PORTRAIT);pageNumber+=1
    y=drawPublicPdfHeader(page,bold,regular,{title:'Programação de oradores',congregation:'Noroeste',period:monthLabel(input.month),margin:MARGIN,compact:true})
    page.drawText(`Página ${pageNumber}`,{x:A4_PORTRAIT[0]-MARGIN-31,y:20,size:7.5,font:regular,color:PDF_MUTED})
  }
  const ensure=(height:number):void=>{if(y-height<34)addPage()}
  const section=(title:string,headers:string[],widths:number[]):void=>{
    ensure(42)
    page.drawText(title.toLocaleUpperCase('pt-BR'),{x:MARGIN,y:y-2,size:9.2,font:bold,color:PDF_ACCENT})
    y-=13;drawRow(page,fonts,headers,widths,y,true);y-=ROW_HEIGHT
  }
  addPage()
  const localWidths=[47,35,116,29,189,115],localHeaders=['Data','Seção','Orador','Nº','Tema','Congregação']
  section('Discursos em nossa congregação',localHeaders,localWidths)
  if(!local.length){page.drawText('Nenhum discurso programado neste mês.',{x:MARGIN+4,y:y-17,size:8.5,font:regular,color:PDF_MUTED});y-=28}
  for(const [index,item] of local.entries()){
    const theme=input.themes[item.temaId??'']
    const origin=item.tipo==='discurso_visitante'?congregationName(item,input.congregations):localSpeakerOriginName(item,input.congregations)
    const values=[pdfDate(item.data),item.secao==='s1'?'1ª':'2ª',scheduleSpeakerNames(item,input.speakers),String(theme?.numero??item.temaNumero??'-'),theme?.titulo??item.temaTitulo??'-',origin]
    if(y-ROW_HEIGHT<34){addPage();section('Discursos em nossa congregação · continuação',localHeaders,localWidths)}
    drawRow(page,fonts,values,localWidths,y,false,index%2===0);y-=ROW_HEIGHT
  }
  y-=16
  // One combined outgoing table: section is internal routing, not a printed column.
  const outgoingWidths=[64,126,40,119,182],outgoingHeaders=['Data','Orador','Tema','Congregação','Endereço']
  section('Saídas de nossos oradores',outgoingHeaders,outgoingWidths)
  if(!outgoing.length){page.drawText('Nenhuma saída programada neste mês.',{x:MARGIN+4,y:y-17,size:8.5,font:regular,color:PDF_MUTED})}
  for(const [index,item] of outgoing.entries()){
    const theme=input.themes[item.temaId??''],destination=input.congregations[scheduleCongregationId(item)]
    const values=[/^\d{4}-\d{2}-\d{2}$/.test(item.data)?`${pdfDate(item.data)}/${item.data.slice(0,4)}`:item.data,scheduleSpeakerNames(item,input.speakers),String(theme?.numero??item.temaNumero??'-'),destination?.nome??scheduleCongregationName(item)??'-',destination?.localizacao?.trim()||'-']
    if(y-ROW_HEIGHT<34){addPage();section('Saídas de nossos oradores · continuação',outgoingHeaders,outgoingWidths)}
    drawRow(page,fonts,values,outgoingWidths,y,false,index%2===0);y-=ROW_HEIGHT
  }
  return pdf.save()
}

export async function downloadSpeakersSchedulePdf(input:Input):Promise<void>{const bytes=await createSpeakersSchedulePdf(input);downloadPdf(bytes,`programacao-oradores-${input.month}.pdf`)}

export async function downloadSpeakersScheduleXlsx(input:Input):Promise<void> {
  const { downloadStyledXlsx } = await import('../ui/xlsx-download.ts')
  const { local,outgoing } = speakersPdfScheduleRows(input)
  const date=(value:string)=>new Date(`${value}T12:00:00Z`)
  await downloadStyledXlsx([
    { name:'Discursos locais',title:'Programação de oradores · discursos locais',subtitle:`Noroeste · ${monthLabel(input.month)}`,
      headers:['Data','Seção','Orador','Nº','Tema','Congregação'],widths:[15,16,27,9,82,27],dateColumns:[1],
      rows:local.map(item=>{const theme=input.themes[item.temaId??''];return [date(item.data),item.secao==='s1'?'1ª seção':'2ª seção',scheduleSpeakerNames(item,input.speakers),Number(theme?.numero??item.temaNumero??0)||'-',theme?.titulo??item.temaTitulo??'-',item.tipo==='discurso_visitante'?congregationName(item,input.congregations):localSpeakerOriginName(item,input.congregations)]}),
    },
    { name:'Saídas',title:'Programação de oradores · saídas',subtitle:`Noroeste · a partir de ${monthLabel(input.month)}`,
      headers:['Data','Orador','Tema','Congregação','Endereço'],widths:[15,29,12,31,47],dateColumns:[1],
      rows:outgoing.map(item=>{const theme=input.themes[item.temaId??''],destination=input.congregations[scheduleCongregationId(item)];return [date(item.data),scheduleSpeakerNames(item,input.speakers),Number(theme?.numero??item.temaNumero??0)||'-',destination?.nome??scheduleCongregationName(item)??'-',destination?.localizacao?.trim()||'-']}),
    },
  ],`programacao-oradores-${input.month}.xlsx`)
}
