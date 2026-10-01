# Auditoria do Quadro de Anúncios — 30/09/2026

Escopo: código local, build, funções, testes de navegador e export local do projeto novo. Não representa leitura autenticada do banco de produção nem confirmação de deploy.

## Alterações e correções

- Menu com os seis módulos solicitados e cinco entradas instaláveis de gestão; Quadro público com instalação própria.
- Serviço de Campo e Limpeza removidos das telas, novas permissões, publicação e armazenamento público. Rotas antigas direcionadas ao Quadro; APIs pessoais e de grupos encerradas com HTTP 410. Dados históricos preservados.
- Removida a dependência de Limpeza ao carregar Tarefas e compor suas mensagens. Backup/restauração operacional não apaga raízes históricas retiradas ou assinaturas pessoais antigas.
- Nova API pública projeta somente nomes nas designações, eventos gerais e documentos públicos. Sem Master IDs, telefones, senhas, tokens, caminhos internos de armazenamento ou configurações privadas dos responsáveis. Cliente público não envia identidade de instalação/dispositivo ou cookie.
- Quadro reúne as duas seções e todos os módulos ativos; somente períodos publicados de Tarefas/TPL e discursos confirmados com oradores válidos. Calendário, filtros, compartilhamento, PDFs conjuntos e cache público separado da antiga agenda pessoal.
- Rejeição de vínculo de discurso com congregação local inexistente, visitante ou pertencente à outra seção. Proteções de Master ID e edição entre as seções mantidas.
- Falha parcial, erro HTTP, resposta malformada, cache corrompido e indisponibilidade do Master tratados sem apagar fontes ainda indisponíveis. Anúncios e PDFs não dependem de leitura do Master.
- Service workers não armazenam APIs privadas, migram o shell antigo e consultam versão atual antes de recorrer ao cache. Dependências npm vulneráveis atualizadas pontualmente.

## Verificações

| Verificação | Resultado |
| --- | --- |
| Testes dos módulos ativos, API, permissões e integração | 223 verificações aprovadas |
| Compatibilidade com código/dados históricos | 68 verificações aprovadas; inclui testes compartilhados com o grupo ativo |
| Navegador | 11 suítes aprovadas, incluindo larguras de 320 a 1280 px |
| PWA compilada | Quadro e alias Agenda abrem offline; nenhum cache de Netlify Functions |
| PDF de Oradores | Entradas S1/S2 geram exatamente o mesmo PDF conjunto no teste controlado |
| PDF de Tarefas | Duas seções e reunião única identificadas; publicação, reabertura e conflitos testados |
| Inspeção visual das amostras PDF | Uma folha A4 retrato de Tarefas e duas folhas A4 paisagem de Oradores, sem cortes ou sobreposições |
| TypeScript e Vite | Build aprovado |
| Netlify Functions | Build local aprovado |
| npm audit | Zero vulnerabilidades reportadas |
| git diff --check | Sem erros de whitespace |

As suítes de integração simulam upload, commit perdido, reconciliação, reabertura e concorrência. Não geram publicação ou escrita no Firebase real. Códigos históricos continuam testados, mas não são entradas ativas da aplicação.

## Export local revisado

- 161 pessoas no Master; nenhum nome com mais de duas palavras. Sobrenomes ausentes não foram inventados.
- Dois usuários adaptados ao Quadro público; acesso antigo de Oradores preservado como S2, sem conceder S1 automaticamente.
- Dois discursos com referência substituída remapeados pelo mesmo `pessoaId` explícito do export antigo.
- Um perfil ativo na TPL ajustado para inativo porque o Master já estava inativo.
- Históricos, demais informações e credenciais preservados; nenhum export foi incluído no Git. Nenhuma importação no Firebase foi executada.

## Pendências de dados — não resolver por suposição

A auditoria do export adaptado retorna 13 alertas. Eles não são 13 identidades diferentes: quatro saídas futuras ligadas a um orador inativo são repetidas nas verificações dos PDFs de setembro e outubro; mais três períodos antigos de Tarefas estão sem PDF, um PDF antigo não tem hash e outro precisa ser republicado após alterações. Esses alertas são conservados no relatório privado local.

É necessária confirmação humana da identidade e situação do orador nas quatro saídas futuras. A aplicação mantém o bloqueio de republicação de Oradores enquanto o cadastro estiver inválido e não divulga essas designações no Quadro novo. Contatos já adiados pelo usuário não foram preenchidos por suposição. Após corrigir e importar o export revisado, conferir e republicar os PDFs afetados.

## Produção

Destino solicitado: `https://noroeste.netlify.app/`. As contas disponíveis no CLI não listavam esse site. O site responder HTTP 200 não comprova que este build foi publicado nele. Não foi usado o site pessoal nem o de testes como substituto, nem foram alteradas credenciais/envs de produção. Commit, push, importação do JSON e deploy são etapas distintas.

Na verificação anterior ao commit, tanto `/quadro/` quanto `/.netlify/functions/quadro-data` retornavam HTML do Admin antigo, em vez da nova tela/API JSON. Portanto a nova versão ainda não estava em produção naquele momento. Após publicação, esses dois endereços devem ser verificados separadamente.
