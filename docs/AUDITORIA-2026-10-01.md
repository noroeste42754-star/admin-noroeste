# Auditoria de fluxos, simplificação e PDFs - 01/10/2026

## Escopo e limites

Repositório Noroeste, cópia local do export revisado e aplicação local em navegador. Sem push, deploy, importação no Firebase, publicação real de PDFs ou envio de WhatsApp. Testes de gravação usam dados fictícios em memória; testes com o export real bloqueiam escritas e conexões externas.

Não se trata de uma garantia de ausência de falhas em produção, nem de clique em todas as combinações possíveis de cada cadastro. A validação cobre as ações e transições descritas abaixo. Instalação nativa, envio efetivo de mensagens, restauração real e disponibilidade dos arquivos de produção não foram executados.

## Alterações

- Tarefas e Oradores abrem diretamente na programação/escala, sem tela de Pendências.
- Oradores mantém Programação, Oradores e Intercâmbio; Temas/Eventos em Mais opções. Substituições acessíveis pela programação. Mensagens ficam nas pessoas e no intercâmbio, sem pedir confirmação por WhatsApp em cada card da programação.
- Tarefas e TPL priorizam Escala/Pessoas. Configurações avançadas recolhidas; disponibilidade TPL acessível na pessoa. Admin prioriza Pessoas/Acessos, com backup e diagnóstico em Avançado.
- Congregações locais identificadas por seção; PDF conjunto não usa a congregação S2 como nome de uma reunião S1. Proteção contra exclusão de congregação vinculada, mudança de seção e duplicação de local ativo.
- PDF de Oradores usa endereço do campo de endereço, nunca observações administrativas. Hash da publicação acompanha os mesmos campos impressos.
- Fontes dos três PDFs ajustadas à largura antes de quebrar nomes; limite mínimo preserva a legibilidade em conteúdos excepcionalmente extensos. Tarefas identifica S1/S2/M e reunião única.
- Quadro resolve vínculo legado explícito de orador com o Master sem associação por semelhança de nome.

## Persistência

| Estado | Onde fica |
| --- | --- |
| Painéis opcionais de Oradores e Tarefas | localStorage, chave por usuário/módulo; S1 e S2 independentes |
| Mês, filtros e prazo de datas oferecidas em Oradores | localStorage, por usuário/seção; prazo por congregação |
| Mês, formato, função e letra de Tarefas | localStorage; trocar mensal/bimestral não grava o banco |
| Mês/local da TPL | localStorage já existente |
| Filtros, mês, data, aba, período dos PDFs e painel de compartilhamento do Quadro | localStorage público, sem identidade pessoal |
| Cadastros, designações, regras, disponibilidade, confirmações e modelos de mensagem salvos | Firebase/JSON, sujeitos às permissões e botões de salvar |

Preferências locais não expiram por prazo do app e não são sincronizadas entre aparelhos. Limpar dados do navegador ou trocar de origem as remove. Storage inválido, bloqueado ou sem espaço não impede as novas preferências opcionais de carregar com padrões seguros. Rascunhos de formulário, credenciais e cadastros não foram copiados para esse armazenamento.

## Quadro de Anúncios

- Layout revisado em 320, 390, 768 e 1280 px, com dados reais de setembro e outubro. Barra de mês/Hoje ajustada; em 320 px o mês e ano permanecem legíveis.
- Filtros e período dos PDFs sobrevivem à recarga; atualização não fecha o painel opcional de compartilhamento.
- Meses com somente anúncios do Admin agora podem ser selecionados, sem depender de PDF de Tarefas/Oradores/TPL.
- Abas e links PDF têm identificação acessível. Os dois módulos de Oradores aparecem como um único PDF conjunto.
- Exportação de calendário inclui também eventos gerais de dia inteiro, além das designações; limita-se ao mês escolhido, sem depender do filtro visual.
- Testes cobrem acesso anônimo, alias Agenda, ausência de contatos/credenciais, navegação, filtros, downloads, cópia, calendário, falha parcial, retry e cache offline.

No export revisado, outubro possui dados administrativos nos três módulos, mas somente um discurso confirmado aparece no Quadro; Tarefas/TPL não estão publicadas nesse mês. Setembro também foi usado para conferir as duas seções. Os testes não mudam confirmação/publicação apenas para preencher a tela.

## PDFs de conferência

Gerados pelos botões de download da aplicação, usando o export real em modo local e somente leitura; salvos em Downloads, fora do Git.

- Tarefas outubro: 1 página A4 retrato.
- Oradores outubro: 2 páginas A4 paisagem; discursos do mês e todas as saídas futuras, incluindo as duas seções. Os dois botões de módulos produzem arquivos idênticos no teste com relógio controlado.
- TPL outubro: 3 páginas A4 paisagem, uma por local com designações. O quarto local está sem pessoas designadas e não produz uma folha vazia.
- Seis páginas renderizadas e inspecionadas: nomes em uma linha, sem corte, sobreposição ou texto fora da página. Participantes das duplas ficam em linhas separadas intencionalmente.

## Dados locais

O export revisado mantém 161 pessoas no Master, todas com uma ou duas palavras no nome, sem inventar sobrenomes. As duas congregações locais usam seus IDs existentes, uma por seção, com horários preservados. Endereços de visitantes foram recuperados dos campos explícitos dos exports antigos, preservando observações e mapas. Demais vínculos/históricos e credenciais não foram excluídos.

A auditoria de integração retorna cinco alertas de publicação: três períodos antigos de Tarefas sem PDF oficial, Oradores setembro sem hash de versão e Oradores outubro com PDF publicado desatualizado. Os PDFs de conferência locais não substituem os publicados. Nenhuma publicação/importação foi feita nesta rodada.

## Reprodução

Rodada concluída: 233 verificações dos módulos ativos/segurança/integração e 69 verificações de compatibilidade histórica aprovadas (há testes compartilhados); build TypeScript/Vite aprovado; 12 suítes de navegador, mais a navegação Voltar dos cinco módulos, aprovadas. Quadro e alias Agenda abrem offline no build compilado. Auditoria npm de dependências de produção sem vulnerabilidades e diff sem erros de whitespace.

Executar `npm run validate` para testes de domínio, segurança, integração, históricos, build, navegador e PWA. `npm run audit:integrations -- CAMINHO_DO_EXPORT` audita uma cópia local sem modificá-la. `tests/full-workflows-browser.mjs` cobre CRUD, validações, publicação/reabertura simuladas, mensagens, geração, isolamento das seções e persistência; `tests/quadro-browser.mjs` verifica os fluxos públicos e downloads de fixtures.

Relatórios privados, capturas de tela, exports e PDFs ficam fora do Git. Antes de publicar, ainda é necessária a aprovação visual do usuário e a autorização de deploy.
