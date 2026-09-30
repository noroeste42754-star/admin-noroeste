# Segunda seção de Tarefas e Oradores

## Implementação

- Oradores tem duas entradas independentes: `oradoresS1` para a 1ª seção e `oradores` para a 2ª. O acesso antigo permanece apenas na 2ª seção.
- Os dois responsáveis podem editar temas, oradores visitantes, congregações visitantes e eventos gerais. Cadastros locais e programações são exclusivos da seção correspondente, com proteção no servidor e nas gravações em lote.
- Os dois módulos geram o mesmo PDF conjunto de Oradores: programação local das duas seções no mês e todas as saídas a partir do mês escolhido. Datas de saídas incluem o ano.
- Tarefas reconhece as duas seções e a reunião única; as designações com Master ID não podem cruzar as seções de trabalho. A proteção também é aplicada dentro da transação do Firebase para editores simultâneos.
- Dados pessoais dos oradores locais vêm do Master. Nomes não foram completados sem fonte ou confirmação; nomes de uma palavra foram aceitos conforme orientação do usuário.

## Proposta local atual: v16

Gerada em 30/09/2026 a partir dos exports conferidos novamente pelo usuário. Os arquivos originais e as versões anteriores foram preservados. Nenhum banco remoto foi alterado.

| Fonte em Downloads | SHA-256 |
| --- | --- |
| `tpl-novo-2-default-rtdb-export.json` | `b7c2a4a63dcdb470ff53470f7f1e1a1d37f3f9c7f99697b98133b81c2b58716f` |
| `oradores-tarefas-default-rtdb-export.json` | `c649ae7e46630469b5b5f42afe1e251e743f4fb898a0c2573a0aea6079425d93` |
| `escala-tpl-default-rtdb-export.json` | `0b1aa975c579074e9960ca57b3398bd495b8450405240650075795a249d6cb91` |

Saída local: `output/segunda-secao-2026-09-30-v16/FIREBASE-PROPOSTA.json`.

SHA-256 da proposta: `08e6187a66441ae336d558ff24b3b6dd2e625c5b826620e2b9ecfd64447e7028`.

A proposta completa contém contatos, senhas, sessões e outras raízes privadas do export. `output/` e `tmp/` estão ignorados pelo Git. O commit contém a implementação, testes, scripts e este registro; não contém exports privados nem PDFs com dados pessoais.

### Dados reconciliados

- 161 pessoas no Master, incluindo 2 cadastros criados com os nomes disponíveis no legado.
- 53 nomes abreviados, 4 correções por confirmação/fonte verificada e 66 nomes de uma palavra aceitos provisoriamente.
- 35 participantes de Tarefas e 20 oradores locais com Master ID e seção explícitos.
- 139 registros da 1ª seção reaproveitados; 193 programações no total, sendo 134 da 1ª seção e 59 da 2ª.
- 11 correções de ID na Escala, 5 participantes acrescentados e 13 disponibilidades aproveitadas, inclusive as dos perfis recém-criados.
- Export da Escala baixado novamente: restrições e parceiro obrigatório de Taynara atualizados e disponibilidade de Gleice recuperada.
- Como autorizado pelo usuário, as tabelas da Escala antiga são a referência para os meses presentes naquele export: 4 tabelas de setembro recuperadas, 156 designações recuperadas e 27 vínculos históricos corrigidos. Meses/locais exclusivos do projeto novo são conservados.
- A recuperação das tabelas não publica PDFs nem ativa publicações automaticamente. Estados de publicação e snapshots do projeto novo são conservados.
- Master, Tarefas/Oradores, usuários, Agenda, raízes privadas, Limpeza e Serviço de Campo ficaram idênticos à v15; o refresh dos exports alterou somente a Escala.

### Pendências mantidas

- Escolher o responsável da 1ª seção e atribuir `oradoresS1` no Admin; ninguém recebeu acesso automaticamente.
- Contatos de Diego Leite, Kaua G. e Fabiano Gomes serão informados depois. Natália também ficou sem telefone seguro na Escala.
- Uma referência histórica de Oradores em 06/06/2026 aponta para `disc_orador_15`, ausente no cadastro; não foi inventada uma identidade.
- Duas pessoas distintas têm o mesmo nome abreviado Maria Oliveira e permanecem com Master IDs separados.
- A grafia Massecleide / Massicleide no `.bss` permanece sem alteração por falta de confirmação.

## Gerar e conferir localmente

O script é uma migração pontual para estes exports, com hashes fixados. Ele recusa fontes diferentes e não sobrescreve uma pasta de saída existente. Antes de repetir a migração com outros exports, conferir as fontes e escolher uma nova versão de saída.

As duas evidências de nome utilizadas do `.bss` estão em `scripts/second-section-name-evidence.json`, com hashes de origem e sem contatos. A lista completa de nomes extraída permanece local.

```powershell
node scripts/prepare-second-section-json.mjs
node scripts/prepare-second-section-json.mjs --verify
node scripts/review-second-section-json.mjs
npm run test:all
npm run build
$env:BROWSER_TESTS='oradores-sections-browser.mjs'
node scripts/test-browser.mjs
```

O relatório local `REVISAO-FALHAS.json` confirmou ausência de vínculos inválidos em Tarefas/oradores locais, Master IDs locais duplicados, conflitos futuros entre seções, divergência de seção nas saídas futuras e diferenças de nome/telefone dos locais em relação ao Master. Os contatos pendentes e a ausência de um responsável S1 são registrados separadamente.

Os testes de navegador conferem acesso exclusivo aos locais, edição compartilhada e igualdade exata do PDF baixado por cada módulo. Os layouts A4 de Tarefas e Oradores foram renderizados e conferidos visualmente durante a implementação. Este refresh da Escala não modificou os dados usados nesses dois PDFs.

## Produção

Antes da publicação/importação, confirmar o banco configurado em `FIREBASE_DATABASE_URL` no ambiente de produção e manter backup recente. Publicar também as Netlify Functions: o diretório `dist` sozinho contém apenas o cliente. Aplicar a migração revisada ao banco correto, atribuir o acesso S1 e conferir os dois usuários e os documentos oficiais em produção.

Commit local não publica o aplicativo. Não executar push/deploy/importação sem autorização específica.
