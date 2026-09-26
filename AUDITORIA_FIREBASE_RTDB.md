# Auditoria do Firebase Realtime Database

Data da revisão: 26/09/2026.

## Escopo e conclusão

O frontend não usa o SDK cliente do Firebase e não abre conexões persistentes. Todas as operações passam por Netlify Functions, que reutilizam uma única inicialização nomeada do Firebase Admin em `netlify/lib/subscription-store.ts`. As regras do RTDB bloqueiam leitura e escrita diretas; a autorização por módulo ocorre nas Functions.

Não foi feita análise dos registros existentes porque o novo banco `tpl-novo-2` ainda não estava disponível para leitura durante esta revisão. Esta parte deve ser executada depois da importação dos dados.

## Problemas encontrados

| Gravidade | Local | Problema e impacto | Solução / risco |
|---|---|---|---|
| Alta | `netlify/functions/database.ts`, `module-publication.ts`, `cleaning-groups.ts`, `workflow-transition.ts` | Algumas gravações usam transação em `/`. Cada transação pode transferir a árvore inteira para a Function. Aumenta download e piora com o crescimento do banco. | Reestruturar por raízes transacionais menores e fan-out de auditoria. Risco alto: hoje a raiz garante atomicidade entre bloqueio, publicação, vínculos e histórico; não foi fragmentada silenciosamente. |
| Média | `netlify/lib/agenda-root.ts` | A Minha Agenda lê árvores completas de cada módulo solicitado e `master/pessoas` para montar os eventos. O filtro por pessoa ocorre na Function, depois do download do RTDB. | Criar `/agendasPorPessoa/{masterId}/{anoMes}` quando o volume justificar. Exige escritores derivados, migração e reconciliação. |
| Média | `netlify/functions/agenda-device.ts` | O seletor de nomes precisa carregar todas as pessoas ativas. | Resposta sanitizada apenas com nome/ativo e cache local por 24 horas. Implementado conforme decisão de produto. |
| Baixa | `expire-pdfs.ts` e `pdf-maintenance.ts` | Manutenção lê `agenda/documentos` mais de uma vez para evitar corrida com publicação. | Manter enquanto o conjunto for pequeno; consolidar somente junto da futura revisão do armazenamento. |

## Verificações solicitadas

- Inicialização Firebase: uma única fábrica central do Admin SDK.
- Inicializações duplicadas: nenhuma; `getApps()` reutiliza a instância `noroeste-admin`.
- Listeners realtime: nenhum `onValue`, `onChildAdded`, `onChildChanged` ou `onChildRemoved`.
- Cleanup/unsubscribe: não se aplica, pois não há listeners persistentes.
- Polling/refetch: não há intervalo automático. A lista de nomes usa cache diário; a agenda sincroniza ao abrir.
- Leituras da raiz: inexistentes para GETs normais; existem transações de escrita na raiz pelos motivos de atomicidade descritos acima.
- Consultas Firebase: não há `orderByChild`, `equalTo`, `limitToFirst` ou semelhantes. Portanto, nenhum `.indexOn` é necessário na arquitetura atual.
- Cache: Minha Agenda possui cache local por pessoa e mantém o último resultado quando uma fonte falha.
- Várias abas: cada aba faz chamadas HTTP independentes às Functions, mas não mantém conexão RTDB persistente.
- Dados históricos: histórico operacional é consultado somente na tela correspondente.

## Melhorias aplicadas nesta rodada

1. Removido o pareamento por código e sua transação na raiz.
2. Mantida sessão por cookie após seleção do nome; troca de pessoa exige senha de Admin.
3. Lista pública reduzida a pessoas ativas, contendo somente nome e estado ativo.
4. Cache da lista de nomes mantido por 24 horas.
5. `Outros anúncios` passou a usar pasta do Google Drive; PDFs manuais antigos deixam de compor o payload público.
6. Removida uma leitura de `agenda/documentos` da carga inicial do módulo Admin.
7. Regras diretas do RTDB mantidas fechadas (`.read` e `.write` falsas).

## Plano restante

### Fase 1 — segura

Concluída para listeners, inicialização, cache da identidade, remoção do pareamento e redução do payload público.

### Fase 2 — consultas

Depois de importar o banco novo, medir tamanhos por caminho e priorizar os maiores. Índices só devem ser criados quando surgirem consultas ordenadas; hoje não trariam benefício.

### Fase 3 — cache

Manter cache diário da Minha Agenda. Avaliar cache curto no servidor apenas para configurações e pessoas quando houver volume comprovado.

### Fase 4 — realtime versus sob demanda

Todos os recursos atuais devem continuar sob demanda. Não há caso que justifique listener realtime neste app administrativo.

### Fase 5 — modelagem

O primeiro nó derivado recomendado é `/agendasPorPessoa/{masterId}/{anoMes}`. Só deve ser implantado junto de rotinas atômicas de atualização, reconstrução e auditoria para não exibir agenda desatualizada.

### Fase 6 — monitoramento

Registrar mensalmente no console Firebase: bytes armazenados, download, conexões e caminhos de maior crescimento. No Netlify, acompanhar invocações, duração das Functions e largura de banda dos PDFs.

## Avaliação qualitativa

- Conexões: baixo risco.
- Download: risco moderado, principalmente pelas transações na raiz.
- Leituras desnecessárias: poucas a moderadas.
- Cache: parcialmente adequado.
- Modelagem para escala: precisa de ajustes antes de grande crescimento ou múltiplos frontends.
