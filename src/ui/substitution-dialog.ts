import { editorBusy,editorError,editorSaved } from './editor-feedback'
import { rankCandidates,type SubstituteCandidate } from '../modules/substitution-domain'
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
export function substitutionDialog(options:{title:string;current:string;candidates:SubstituteCandidate[];save:(id:string)=>Promise<boolean>;note?:string;allowWarnings?:boolean;confirmSelection?:(id:string,host:HTMLElement)=>Promise<boolean>}):void {
  const overlay=document.createElement('div');overlay.className='modal-overlay'
  overlay.innerHTML=`<div class="modal"><h2>${esc(options.title)}</h2><p>Atual: ${esc(options.current||'Vago')}</p><p class="form-help">Escolha um substituto e confira a troca. Menor quantidade de designações neste mês aparece primeiro.${options.allowWarnings?' Pessoas com ressalvas também podem ser escolhidas; você verá um aviso antes de salvar.':''}</p>${options.note?`<p class="notice">${esc(options.note)}</p>`:''}<label>Buscar candidato<input data-sub-search class="form-input" type="search"></label><div data-sub-list></div><p data-sub-preview aria-live="polite">Selecione uma pessoa para continuar.</p><button id="substitutionCancel" class="btn btn-ghost">Cancelar</button><button data-sub-save class="btn btn-primary" disabled>Confirmar substituição</button></div>`
  const parent=[...document.querySelectorAll<HTMLElement>('.modal')].pop()
  ;(parent??document.body).append(overlay)
  const candidates=rankCandidates([...options.candidates]),list=overlay.querySelector<HTMLElement>('[data-sub-list]')!,search=overlay.querySelector<HTMLInputElement>('[data-sub-search]')!,save=overlay.querySelector<HTMLButtonElement>('[data-sub-save]')!,preview=overlay.querySelector<HTMLElement>('[data-sub-preview]')!
  let selected=''
  const show=()=>{
    const query=search.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    const filtered=candidates.filter(c=>(c.name+' '+c.id).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query))
    list.innerHTML=filtered.map((c,i)=>`<label class="substitution-candidate"><input type="radio" name="substitute" value="${i}" ${c.reason&&!options.allowWarnings?'disabled':''} ${selected===c.id?'checked':''}><span><strong>${esc(c.name)}</strong><small>${esc(c.id)} · ${c.count} designações</small><small>${esc(c.reason||'Sem impedimento identificado pelas regras deste módulo')}</small></span></label>`).join('')||'<p>Nenhum candidato encontrado.</p>'
    list.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.addEventListener('change',()=>{
      const candidate=filtered[Number(input.value)]!;selected=candidate.id;save.disabled=false;preview.textContent=`${options.current||'Vago'} → ${candidate.name}. A troca afeta somente esta designação.`
    }))
  }
  search.addEventListener('input',show)
  overlay.querySelector('#substitutionCancel')!.addEventListener('click',()=>overlay.remove())
  save.addEventListener('click',async()=>{
    if(!selected)return
    try {
      if(options.confirmSelection&&!await options.confirmSelection(selected,overlay.querySelector<HTMLElement>('.modal')!))return
      const release=editorBusy(overlay)
      try {if(await options.save(selected)){editorSaved(overlay);overlay.remove()}else editorError(overlay,'A substituição não foi salva. Confira os dados e tente novamente.')}
      finally{release()}
    }
    catch(error){editorError(overlay,error instanceof Error?error.message:'Não foi possível salvar a substituição.')}
  })
  show();search.focus()
}
