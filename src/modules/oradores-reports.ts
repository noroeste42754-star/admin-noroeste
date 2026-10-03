import { PDFDocument, StandardFonts, rgb } from 'pdf-lib/cjs/index.js'
import { A4_PORTRAIT, PDF_INK, PDF_LINE, PDF_MUTED } from '../ui/public-pdf-layout.ts'
import { themeDate, type ThemeRow } from './oradores-themes.ts'

// Operational reports are separate from the public schedule and never published to Quadro.
async function report(title:string,subtitle:string,headers:string[],widths:number[],rows:string[][]):Promise<Uint8Array>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold)
  const clean=(value:string):string=>Array.from(value.replace(/[–—]/g,'-')).map(c=>{try{font.encodeText(c);return c}catch{return '?'}}).join('')
  const wrap=(value:string,width:number):string[]=>{
    const result:string[]=[];let line=''
    for(const word of clean(value).split(/\s+/)){
      if(line&&font.widthOfTextAtSize(line+' '+word,9)>width){result.push(line);line=''}
      for(const c of (line?' ':'')+word){if(font.widthOfTextAtSize(line+c,9)>width){result.push(line);line=''}line+=c}
    }
    result.push(line);return result
  }
  let page=pdf.addPage(A4_PORTRAIT),y=0,pageNumber=0
  const addHeader=():void=>{
    pageNumber++;page.drawText(title,{x:32,y:807,size:17,font:bold,color:PDF_INK});y=786
    for(const line of wrap(subtitle.slice(0,350),531)){page.drawText(line,{x:32,y,size:9,font,color:PDF_MUTED});y-=12}
    y-=12;let x=32
    headers.forEach((label,i)=>{page.drawRectangle({x,y:y-25,width:widths[i]!,height:25,color:PDF_INK});page.drawText(label,{x:x+6,y:y-16,size:9,font:bold,color:rgb(1,1,1)});x+=widths[i]!});y-=25
    page.drawText(`Página ${pageNumber}`,{x:490,y:20,size:8,font,color:PDF_MUTED})
  }
  addHeader()
  if(!rows.length){page.drawText('Nenhum registro para este filtro.',{x:38,y:y-22,size:10,font,color:PDF_MUTED});return pdf.save()}
  for(const values of rows){
    const lines=values.map((v,i)=>wrap(v,widths[i]!-12));let offset=0
    const count=Math.max(...lines.map(v=>v.length))
    if(count*12+12>y-40&&count*12+12<600){page=pdf.addPage(A4_PORTRAIT);addHeader()}
    while(offset<count){
      if(y<65){page=pdf.addPage(A4_PORTRAIT);addHeader()}
      const take=Math.min(count-offset,Math.floor((y-40-12)/12)),height=take*12+12;let x=32
      widths.forEach((width,i)=>{page.drawRectangle({x,y:y-height,width,height,borderColor:PDF_LINE,borderWidth:.4});lines[i]!.slice(offset,offset+take).forEach((line,n)=>page.drawText(line,{x:x+6,y:y-15-n*12,size:9,font,color:PDF_INK}));x+=width})
      y-=height;offset+=take
    }
  }
  return pdf.save()
}
export function createThemesReportPdf(rows:ThemeRow[],filterLabel:string,query:string,date:string):Promise<Uint8Array>{
  return report('Catálogo de temas',`Filtro: ${filterLabel}${query?' | Busca: '+query:''} | Consulta: ${themeDate(date)} | ${rows.length} temas`,
    ['Nº','Tema','Último uso','Próxima data'],[36,299,98,98],rows.map(row=>[String(row.theme.numero),row.theme.titulo,themeDate(row.lastPastDate),themeDate(row.nextDate)]))
}
export interface SubstitutionReportRow {name:string; themes:{numero:number;titulo:string}[]}
export function createSubstitutionsReportPdf(rows:SubstitutionReportRow[],date:string):Promise<Uint8Array>{
  return report('Substituições - temas disponíveis',`Data: ${themeDate(date)} | Oradores locais com temas disponíveis. Consulte a disponibilidade diretamente com o orador.`,
    ['Orador','Nº','Tema disponível'],[155,36,340],rows.flatMap(row=>row.themes.map(theme=>[row.name,String(theme.numero),theme.titulo])))
}
