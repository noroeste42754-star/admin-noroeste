import { resolveCentralPerson } from './central-person.ts'
import { resolveSpeakerMasterId } from './oradores-editor-domain.ts'
import { fortalezaToday } from './civil-date.ts'
import { PUBLIC_PDF_MODULES,officialDocumentId,type PublicPdfModule } from './agenda-documents-domain.ts'
import { publicationIssues,publicationSourceValue,periodIsPublished,type PublicationRoot } from './publication-contract.ts'
export interface IntegrationIssue { module:PublicPdfModule; id:string; kind:'vinculo'|'inativo'|'publicacao'; detail:string }
export async function auditIntegrations(root:PublicationRoot,today=fortalezaToday()):Promise<IntegrationIssue[]> {
  const issues:IntegrationIssue[]=[],people=root.master?.pessoas??{},tasks=root.tarefas?.people??{}
  const profiles:Array<[PublicPdfModule,Record<string,any>]>=[['tarefas',tasks],['escala',root.escala?.participants??{}],['oradores',root.tarefas?.discursos?.oradores??{}]]
  for(const [module,records] of profiles) {
    const seen=new Map<string,string>()
    for(const [id,p] of Object.entries(records)) {
      if(module==='oradores'&&p.tipo!=='local')continue
      const mid=module==='oradores'?resolveSpeakerMasterId(p,people,tasks):resolveCentralPerson(id,p.masterId,people).masterId
      if(!mid||!people[mid])issues.push({module,id,kind:'vinculo',detail:'Vínculo central ausente ou inexistente.'})
      else {
        if(module==='escala'&&(!String(people[mid].name??'').trim()||String(people[mid].name).trim()===id))issues.push({module,id,kind:'vinculo',detail:'Nome ausente ou preenchido apenas com o ID. Corrija no Admin antes de imprimir.'})
        if(seen.has(mid))issues.push({module,id,kind:'vinculo',detail:`Vínculo duplicado com ${seen.get(mid)}.`})
        seen.set(mid,id)
        if(people[mid].active===false&&p.active!==false&&p.ativo!==false)issues.push({module,id,kind:'inativo',detail:'Pessoa inativa no Admin ainda habilitada no cadastro do módulo.'})
      }
    }
  }
  const documents=root.agenda?.documentos??{}
  for(const module of PUBLIC_PDF_MODULES) {
    const periods=module==='tarefas'?Object.keys(root.tarefas?.scale?.periods??{}):module==='escala'?[...Object.keys(root.escala?.publishedMonths??{}),root.escala?.publishedMonth].filter(Boolean):[]
    const ids=new Set<string>([...periods,...Object.values(documents).filter((d:any)=>d.modulo===module&&d.origemPeriodoId).map((d:any)=>d.origemPeriodoId)])
    for(const id of ids) {
      if(!/^\d{4}-(0[1-9]|1[0-2])(?:-bimester)?$/.test(id))continue
      const document=documents[officialDocumentId(module,id)], published=periodIsPublished(root,module,id)
      if(module!=='oradores'&&published!==Boolean(document))issues.push({module,id,kind:'publicacao',detail:published?'Período publicado sem PDF oficial no Quadro.':'PDF oficial disponível, mas período está aberto.'})
      if(id.slice(0,7)>=today.slice(0,7))for(const detail of publicationIssues(root,module,id))issues.push({module,id,kind:'inativo',detail})
      if(document) {
        if(!document.sourceHash)issues.push({module,id,kind:'publicacao',detail:'PDF anterior sem verificação de versão. Confira antes de republicar.'})
        else {
          const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(publicationSourceValue(root,module,id))))).map(b=>b.toString(16).padStart(2,'0')).join('')
          if(hash!==document.sourceHash)issues.push({module,id,kind:'publicacao',detail:'Os dados atuais diferem da versão do PDF publicado.'})
        }
      }
    }
  }
  return issues
}
