import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib/cjs/index.js'
import { createSpeakersSchedulePdf, speakersPdfScheduleRows } from '../src/modules/oradores-documents.ts'
import { createThemesReportPdf, createSubstitutionsReportPdf } from '../src/modules/oradores-reports.ts'

test('relatórios de temas e substituições paginam em A4 sem truncar linhas extensas',async()=>{
  const rows=Array.from({length:120},(_,i)=>({id:String(i),theme:{numero:i+1,titulo:'Tema de teste com título longo para conferir a paginação',ativo:true},past:true,pending:true,lastPastDate:'2026-08-01',nextDate:'2026-11-15'}))
  const themes=await PDFDocument.load(await createThemesReportPdf(rows,'Todos','', '2026-09-22'))
  assert.ok(themes.getPageCount()>1)
  const emergency=await PDFDocument.load(await createSubstitutionsReportPdf([{name:'Nome comprido '.repeat(100),themes:rows.map(row=>row.theme)}],'2026-09-22'))
  assert.ok(emergency.getPageCount()>1)
  for(const pdf of [themes,emergency])for(const page of pdf.getPages()){assert.equal(page.getWidth(),595.28);assert.equal(page.getHeight(),841.89)}
})

test('saídas incluem o mês selecionado e todos os meses seguintes', () => {
  const rows = speakersPdfScheduleRows({ month:'2026-09', schedule:[
    { data:'2026-08-30', tipo:'saida_orador', status:'confirmado' },
    { data:'2026-09-01', tipo:'saida_orador', status:'confirmado' },
    { data:'2026-11-15', tipo:'saida_orador', status:'confirmado' },
    { data:'2026-11-20', tipo:'discurso_local', status:'confirmado' },
  ] })
  assert.deepEqual(rows.outgoing.map(item => item.data), ['2026-09-01', '2026-11-15'])
  assert.deepEqual(rows.local, [])
})

test('gera a programação de Oradores em A4 retrato', async () => {
  const bytes = await createSpeakersSchedulePdf({
    month:'2026-09',
    speakers:{ o1:{ nome:'Orador local', tipo:'local', funcao:'anciao', telefone:'', ativo:true, temaIds:['t1'] } },
    themes:{ t1:{ numero:1, titulo:'Tema de teste com título suficientemente longo', ativo:true } },
    congregations:{ c1:{ nome:'Congregação Centro', cidade:'', tipo:'visitante', ativa:true, contato:'', telefone:'', diaReuniao:'', horario:'', localizacao:'', observacoes:'' } },
    schedule:[{ data:'2026-09-20', tipo:'saida_orador', status:'confirmado', oradorId:'o1', temaId:'t1', congregacaoDestinoId:'c1', confirmacao:{status:true,confirmadoEm:'2026-09-01'} }],
  })
  const pdf = await PDFDocument.load(bytes)
  assert.equal(pdf.getPageCount(), 1)
  const { width, height } = pdf.getPage(0).getSize()
  assert.ok(Math.abs(width - 595.28) < .1)
  assert.ok(Math.abs(height - 841.89) < .1)
})
