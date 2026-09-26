// Executed inside the root transaction so links created concurrently are checked again.
export function deleteUnreferencedMasterPerson(current:unknown,mid:string):unknown|undefined {
  if(!current||typeof current!=='object'||Array.isArray(current)) return undefined
  const root=current as Record<string,any>
  if(!root.master?.pessoas?.[mid]) return undefined
  const references=(value:unknown,path:string[]):boolean=>{
    if(path.length===3&&path[0]==='master'&&path[1]==='pessoas'&&path[2]===mid) return false
    if(value===mid) return true
    if(!value||typeof value!=='object') return false
    return Object.entries(value).some(([key,child])=>(key===mid&&child!==null&&child!==false)||references(child,[...path,key]))
  }
  // The person's own key is not a reference.
  const copy=structuredClone(root)
  delete copy.master.pessoas[mid]
  // A paired phone must not prevent deletion. Revoke it in the same transaction.
  const devices=copy.agendaDispositivosPrivados as Record<string,Record<string,unknown>>|undefined
  for(const device of Object.values(devices??{})) if(device?.masterId===mid) device.revoked=true
  const sessions=copy.appSessoesPrivadas as Record<string,Record<string,any>>|undefined
  for(const [token,session] of Object.entries(sessions??{})) if(session?.uid===mid||session?.usuario?.masterId===mid) delete sessions![token]
  const {agendaDispositivosPrivados:_devices,appSessoesPrivadas:_sessions,...linkedRoot}=copy
  if(references(linkedRoot,[])) return undefined
  return copy
}
