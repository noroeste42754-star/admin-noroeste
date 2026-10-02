import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib/cjs/index.js'
import { downloadPdf } from '../ui/pdf-download.ts'
import { fitPdfFont } from '../ui/pdf-text-fit.ts'
import { combinedCongregationTitle, localCongregationName } from './oradores-congregations.ts'
import { A4_LANDSCAPE, PDF_INK, PDF_LINE, PDF_MUTED, drawPublicPdfHeader } from '../ui/public-pdf-layout.ts'
import { monthBounds, scheduleCongregationId, scheduleCongregationName, scheduleSpeakerNames, type Speaker, type SpeakerCongregation, type TalkSchedule, type TalkTheme } from './oradores-domain.ts'

interface Input {
  month: string
  schedule: TalkSchedule[]
  speakers: Record<string, Speaker>
  themes: Record<string, TalkTheme>
  congregations: Record<string, SpeakerCongregation>
}

const monthLabel = (month:string): string => new Intl.DateTimeFormat('pt-BR', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${month}-15T12:00:00Z`))
const pdfDate = (date:string): string => /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date.slice(8,10)}/${date.slice(5,7)}` : date
const speakerName = scheduleSpeakerNames
const congregationName = (item:TalkSchedule, congregations:Record<string,SpeakerCongregation>): string => congregations[scheduleCongregationId(item)]?.nome ?? scheduleCongregationName(item) ?? '-'

function wrap(font:PDFFont, value:string, size:number, maxWidth:number):string[]{
  const lines:string[]=[]; let line=''
  for(const word of value.trim().split(/\s+/)){
    if(line&&font.widthOfTextAtSize(`${line} ${word}`,size)>maxWidth){lines.push(line);line=''}
    for(const character of (line?' ':'')+word){
      if(line&&font.widthOfTextAtSize(line+character,size)>maxWidth){lines.push(line);line=''}
      line+=character
    }
  }
  if(line)lines.push(line)
  return lines.length?lines:['']
}
function rowHeight(font:PDFFont, values:string[], widths:number[]):number{return Math.max(20,...values.map((value,index)=>wrap(font,value,fitPdfFont(font,value,widths[index]!-10,8),widths[index]!-10).length*9+7))}
function drawRow(page:PDFPage, fonts:{regular:PDFFont;bold:PDFFont}, values:string[], widths:number[], y:number, height:number, header=false):void{
  const x=32,total=widths.reduce((sum,width)=>sum+width,0); page.drawRectangle({x,y:y-height,width:total,height,color:header?PDF_INK:rgb(1,1,1),borderColor:PDF_LINE,borderWidth:.5});let cursor=x
  values.forEach((value,index)=>{if(index)page.drawLine({start:{x:cursor,y},end:{x:cursor,y:y-height},thickness:.5,color:PDF_LINE});const font=header?fonts.bold:fonts.regular,size=fitPdfFont(font,value,widths[index]!-10,header?8.3:8);wrap(font,value,size,widths[index]!-10).forEach((line,lineIndex)=>page.drawText(line,{x:cursor+5,y:y-12-lineIndex*9,size,font,color:header?rgb(1,1,1):PDF_INK}));cursor+=widths[index]!})
}

export function speakersPdfScheduleRows(input:Pick<Input,'month'|'schedule'>):{local:TalkSchedule[];outgoing:TalkSchedule[]}{
  const bounds=monthBounds(input.month), sorted=[...input.schedule].sort((a,b)=>a.data.localeCompare(b.data)||(a.secao??'s2').localeCompare(b.secao??'s2')||a.tipo.localeCompare(b.tipo))
  return {
    local:sorted.filter(item=>item.tipo!=='saida_orador'&&item.data>=bounds.start&&item.data<=bounds.end),
    outgoing:sorted.filter(item=>item.tipo==='saida_orador'&&item.data>=bounds.start),
  }
}

export async function createSpeakersSchedulePdf(input:Input):Promise<Uint8Array>{
  const pdf=await PDFDocument.create(), regular=await pdf.embedFont(StandardFonts.Helvetica), bold=await pdf.embedFont(StandardFonts.HelveticaBold), fonts={regular,bold}
  const {local,outgoing}=speakersPdfScheduleRows(input)
  const congregation=combinedCongregationTitle(input.congregations)
  let page:PDFPage,y=0,pageNumber=0
  const addPage=():void=>{page=pdf.addPage(A4_LANDSCAPE);pageNumber+=1;y=drawPublicPdfHeader(page,bold,regular,{title:'Programação de oradores',congregation,period:monthLabel(input.month),margin:32,compact:true});page.drawText(`Página ${pageNumber}`,{x:748,y:20,size:7.5,font:regular,color:PDF_MUTED})}
  const ensure=(height:number):void=>{if(y-height<34)addPage()}
  const section=(title:string,headers:string[],widths:number[]):void=>{ensure(48);page.drawText(title.toLocaleUpperCase('pt-BR'),{x:32,y:y-2,size:10,font:bold,color:PDF_INK});y-=14;drawRow(page,fonts,headers,widths,y,20,true);y-=20}
  addPage()
  const localWidths=[72,42,150,45,280,188],localHeaders=['Data','Seção','Orador','Nº','Tema','Congregação']
  section('Discursos em nossa congregação',localHeaders,localWidths)
  if(!local.length){page!.drawText('Nenhum discurso programado neste período.',{x:37,y:y-20,size:8.5,font:regular,color:PDF_MUTED});y-=32}
  for(const item of local){const theme=input.themes[item.temaId??''];const external=item.tipo==='discurso_visitante'?congregationName(item,input.congregations):localCongregationName(item,input.congregations);const values=[pdfDate(item.data),item.secao==='s1'?'1ª':'2ª',speakerName(item,input.speakers),String(theme?.numero??item.temaNumero??'-'),theme?.titulo??item.temaTitulo??'-',external];const height=rowHeight(regular,values,localWidths);if(y-height<34){addPage();section('Discursos em nossa congregação - continuação',localHeaders,localWidths)}drawRow(page!,fonts,values,localWidths,y,height);y-=height}
  y-=16
  const outgoingWidths=[72,42,145,60,180,278],outgoingHeaders=['Data','Seção','Orador','Tema','Congregação','Endereço']
  section('Saídas de nossos oradores',outgoingHeaders,outgoingWidths)
  if(!outgoing.length){page!.drawText('Nenhuma saída programada neste período.',{x:37,y:y-20,size:8.5,font:regular,color:PDF_MUTED})}
  for(const item of outgoing){const theme=input.themes[item.temaId??''],destination=input.congregations[scheduleCongregationId(item)];const speaker=input.speakers[item.oradorId??''];const values=[/^\d{4}-\d{2}-\d{2}$/.test(item.data)?`${pdfDate(item.data)}/${item.data.slice(0,4)}`:item.data,(speaker?.secao??item.secao)==='s1'?'1ª':'2ª',speakerName(item,input.speakers),String(theme?.numero??item.temaNumero??'-'),destination?.nome??scheduleCongregationName(item)??'-',destination?.localizacao?.trim()||'-'];const height=rowHeight(regular,values,outgoingWidths);if(y-height<34){addPage();section('Saídas de nossos oradores - continuação',outgoingHeaders,outgoingWidths)}drawRow(page!,fonts,values,outgoingWidths,y,height);y-=height}
  return pdf.save()
}

export async function downloadSpeakersSchedulePdf(input:Input):Promise<void>{const bytes=await createSpeakersSchedulePdf(input);downloadPdf(bytes,`programacao-oradores-${input.month}.pdf`)}
