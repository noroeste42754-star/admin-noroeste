# Noroeste Admin

Módulos de gestão: Admin, Escala TPL, Tarefas, Oradores da 1ª seção e Oradores da 2ª seção. Cada responsável de Oradores edita somente sua seção; temas, visitantes, congregações visitantes e eventos gerais são compartilhados. Ambos geram o mesmo PDF conjunto.

## Quadro de Anúncios

O endereço `/quadro/` é público, sem login, nome ou pareamento. `/agenda/` abre o mesmo Quadro para manter os links e instalações anteriores. A tela reúne Tarefas publicadas, Oradores confirmados com cadastro válido, TPL publicada, eventos gerais e PDFs públicos dos módulos e do Admin. Não retorna contatos, senhas, sessões ou cadastros Master.

Falhas de uma fonte preservam os últimos dados dessa fonte, com aviso e nova tentativa. A consulta offline requer um primeiro acesso online. PDFs mantêm o prazo existente de 60 dias. O arquivo ICS inclui as designações gerais do mês; não é uma assinatura nem notificação pessoal automática.

Serviço de Campo, Limpeza e pareamento pessoal estão encerrados. Suas raízes históricas no Firebase são preservadas e não podem ser alteradas pelas rotas retiradas. Os testes de compatibilidade histórica permanecem separados dos módulos ativos.

## Validação

```powershell
npm ci
npm run validate
npm audit
netlify functions:build --src netlify/functions --functions tmp/functions-build
```

Os testes de navegador usam Microsoft Edge instalado, com respostas simuladas; não modificam o banco de produção. `test:pwa` usa o build compilado e testa abertura offline nos dois endereços. Relatório: `docs/AUDITORIA-2026-09-30.md`.

## JSON do Firebase

Depois da migração de duas seções, adapte uma cópia local do export:

```powershell
node scripts/prepare-quadro-json.mjs origem.json destino-novo.json export-antigo-oradores.json
npm run audit:integrations -- destino-novo.json
```

O terceiro argumento é opcional. Correções de referências usam apenas ID estável explícito do cadastro antigo, nunca semelhança de nome ou telefone. O script mantém nomes com uma palavra, abrevia nomes maiores para primeiro e último nome, preserva históricos e credenciais e não se conecta ao Firebase. A origem não é sobrescrita e o destino precisa ser novo. Exports, backups e relatórios de pessoas são privados e não devem ser versionados.

## Publicação

Commit e push exclusivamente para o remote `noroeste`, repositório `noroeste42754-star/admin-noroeste`. Preservar o repositório pessoal. O destino solicitado é `https://noroeste.netlify.app/`; confirmar a conta e o vínculo do site antes de executar um deploy.

A publicação deve incluir `dist` **e** as Netlify Functions, especialmente `quadro-data`. Subir apenas arquivos estáticos não instala a nova API. Sem acesso à conta/site correto ou confirmação do deploy automático, um push não comprova publicação. A importação do JSON é uma operação separada: guardar backup atual do Firebase e revisar as pendências antes de importar.
