import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { dirname,resolve } from 'node:path'
import { createHash } from 'node:crypto'

export function adaptQuadroJson(source,legacy={}) {
  const root=structuredClone(source)
  if(!root.master?.pessoas||!root.usuarios||Array.isArray(root.usuarios))throw Error('Export inválido: master/pessoas e usuarios são necessários.')
  let shortenedNames=0,users=0,inactiveProfiles=0,speakerReferences=0
  for(const person of Object.values(root.master.pessoas)) {
    if(typeof person.name!=='string'||!person.name.trim())throw Error('Nome ausente: não será inventado.')
    const parts=person.name.trim().split(/\s+/)
    if(parts.length>2){person.name=parts[0]+' '+parts.at(-1);shortenedNames++}
  }
  for(const user of Object.values(root.usuarios)) {
    if(!user.apps||typeof user.apps!=='object'||Array.isArray(user.apps))throw Error('Permissões de usuário inválidas.')
    user.apps={...user.apps,quadro:true,individual:false,limpeza:false,servicoCampo:false,oradoresS1:user.apps.oradoresS1===true}
    if(root.master.pessoas[user.masterId])user.nome=root.master.pessoas[user.masterId].name
    users++
  }
  for(const [collection,field] of [[root.tarefas?.people,'active'],[root.escala?.participants,'active'],[root.tarefas?.discursos?.oradores,'ativo']]) {
    for(const [id,profile] of Object.entries(collection??{})) {
      const person=root.master.pessoas[profile.masterId??id]
      if(person?.active===false&&profile[field]!==false){profile[field]=false;inactiveProfiles++}
    }
  }
  const speakers=root.tarefas?.discursos?.oradores??{},old=legacy.discursos?.oradores??legacy.tarefas?.discursos?.oradores??{}
  for(const talk of Object.values(root.tarefas?.discursos?.programacao??{}))for(const field of ['oradorId','oradorSecundarioId']) {
    const id=talk[field],oldPersonId=old[id]?.pessoaId
    if(!id||speakers[id]||!oldPersonId)continue
    const matches=Object.entries(speakers).filter(([,speaker])=>speaker.pessoaId===oldPersonId&&root.master.pessoas[speaker.masterId])
    // Exact stable legacy ID only. A name/phone match never creates an identity.
    if(matches.length!==1)continue
    const [nextId,speaker]=matches[0];talk[field]=nextId
    talk[field==='oradorId'?'oradorNome':'oradorSecundarioNome']=root.master.pessoas[speaker.masterId].name
    speakerReferences++
  }
  return {root,summary:{people:Object.keys(root.master.pessoas).length,shortenedNames,users,inactiveProfiles,speakerReferences,historicalRootsPreserved:['limpeza','servicoCampo'].filter(key=>Object.hasOwn(root,key))}}
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'))) {
  const [input,output,legacyPath]=process.argv.slice(2)
  if(!input||!output||resolve(input)===resolve(output))throw Error('Uso: node scripts/prepare-quadro-json.mjs origem.json destino-novo.json (não sobrescreve a origem).')
  const bytes=await readFile(input),legacy=legacyPath?JSON.parse(await readFile(legacyPath,'utf8')):{},{root,summary}=adaptQuadroJson(JSON.parse(bytes),legacy),result=JSON.stringify(root,null,2)+'\n'
  await mkdir(dirname(resolve(output)),{recursive:true});await writeFile(output,result,{flag:'wx'})
  console.log(JSON.stringify({...summary,sourceSha256:createHash('sha256').update(bytes).digest('hex'),outputSha256:createHash('sha256').update(result).digest('hex')},null,2))
}
