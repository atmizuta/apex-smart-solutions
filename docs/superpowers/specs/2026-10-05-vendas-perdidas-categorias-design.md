# Vendas Perdidas por categoria (API de Exportação Xeotech) — integração + aba

**Data:** 05/10/2026 · **Responsável:** Rafael · **Branch:** `feat/vendas-perdidas-categorias` (worktree `.worktrees/vendas-perdidas`, base `oficial/main` 94ab11b)
**Status:** spec aprovada em conversa ("pode seguir, integra e depois cria a aba"); nada construído além da função de teste.

## 1. Objetivo
Os consultores passaram a escolher uma **categoria** ao marcar a venda perdida no NEO (orientação da gestão no fim de setembro). Essa categoria não vem na API que o painel já usa (Carga da Produção v2), só na **API do Relatório de Exportação** da Xeotech. Objetivo:
1. **Integrar:** trazer a categoria (e subcategoria, tags da atividade) de cada pedido para o banco, de hora em hora.
2. **Aba "Vendas Perdidas":** admin/supervisor filtram os motivos das vendas perdidas por período, consultor e categoria, veem o valor perdido por motivo, abrem os pedidos de cada motivo e veem quem não está preenchendo a categoria.

Sucesso: abrir a aba e, em segundos, saber os 3 maiores motivos de perda do mês, quanto valem e quais consultores deixam perdas sem categoria.

## 2. O que o teste mostrou (05/10, função `sync-exportacao` v1–v2, só contagens)
- `POST https://api.xeotech.com.br/api/v1/producao/exportacao/{token}` com `{painelId:15455, dataInicio, dataFim, formato:"json"}` → HTTP 200 em ~2,4 s, **1.574 linhas (itens), 613 pedidos, 2,5 MB**.
- **O período é ignorado:** um dia (02/10) ou 01/09–05/10 devolvem as mesmas 1.574 linhas (cadastros de 26/05 a 05/10) — a API devolve o conteúdo atual do painel. Logo, **uma chamada traz tudo**; não há janela a calcular. (Se um dia passar a filtrar, a sincronização manda hoje−90 dias até hoje, que cobre o caso.)
- Campos úteis por linha: `numeroPedido`, `nomeEtapa`, `categoriaAtividade`, `subCategoriaAtividade` (sempre vazia hoje), `tagsAtividade` (array), `nomeUsuario`, `nomeCliente`, `nomeProduto`, `valor` (pode vir número ou texto com vírgula), `quantidade`, `dataCadastro` (`yyyy-MM-dd`), `dataHoraAtualizacao` (`yyyy-MM-ddTHH:mm:ss`, SP), `solicitacao`, `tipoNegociacao`.
- Vendas perdidas no período: 466 itens / **196 pedidos, todos já presentes em `producao_pedidos_neo`**; 63% dos itens perdidos com categoria. Categorias em uso: Não responde, Restrição de Crédito, Desistência Demora, Desconfiança, Troca de Território, Erro de Cadastro, CNPJ Inapto, Duplicidade, Fibra - Inviabilidade Técnica, Desistência Biometria, Retenção (Concorrência), Portabilidade em Andamento, Multa Concorrência.
- Limites da API (doc): mínimo 120 s entre execuções, 3 execuções/10 min por estrutura, 1 simultânea; erros `{codigo, mensagem, requestId}` com HTTP 4xx/5xx; 429 com `Retry-After`.
- Token: o **token de integração do usuário Proprietário** (Menu → Meu perfil → Meus dados), salvo pelo Rafael como secret de Edge Function `NEO_EXPORT_TOKEN`. Nunca em arquivo, log ou resposta.

## 3. Banco (migration aditiva `supabase/migrations/20261005100000_vendas_perdidas_categorias.sql`, com rollback)

### 3.1 `producao_atividades` — uma linha por pedido
| Coluna | Tipo | Origem |
|---|---|---|
| `numero_pedido` | `text` PK | `numeroPedido` |
| `categoria` | `text` | categoria do pedido = a `categoriaAtividade` não vazia mais frequente entre os itens (empate: a do item com `dataHoraAtualizacao` mais recente); null se nenhuma |
| `subcategoria` | `text` | mesma regra com `subCategoriaAtividade` |
| `tags` | `text[]` | união ordenada de `tagsAtividade` dos itens |
| `etapa` | `text` | `nomeEtapa` (do item mais recente) |
| `usuario` | `text` | `nomeUsuario` |
| `cliente` | `text` | `nomeCliente` |
| `produtos` | `text` | `nomeProduto` distintos unidos por " + " |
| `valor` | `numeric` | soma de `valor` dos itens (texto "6999,00" → 6999.00) |
| `itens` | `int` | nº de linhas do pedido |
| `data_cadastro` | `date` | menor `dataCadastro` |
| `atualizado_em_neo` | `timestamptz` | maior `dataHoraAtualizacao` (SP, `-03:00`) |
| `sincronizado_em` | `timestamptz default now()` | hora da gravação |

- **Não guarda CPF/CNPJ** (não é preciso para o motivo).
- RLS ligado; `select` só `get_my_role() in ('admin','supervisor')`; escrita só pela função (service role).
- Índices: `(etapa)`, `(categoria)`.

### 3.2 `exportacao_sync_log` — uma linha por execução
`id bigint identity`, `iniciou_em timestamptz default now()`, `terminou_em`, `ok boolean`, `http int`, `linhas int`, `pedidos int`, `gravados int`, `erro text` (código + mensagem da API, nunca o token). RLS: leitura admin/supervisor.

### 3.3 RPC `vendas_perdidas(p_de date, p_ate date)` (security definer, admin/supervisor; `42501` aos demais)
Um registro por pedido **hoje** em `VENDA PERDIDA (NEOCRM)` segundo `producao_pedidos_neo` (fonte da verdade da etapa, sincronizada de hora em hora), com data da perda entre `p_de` e `p_ate`:
- `numero_pedido`, `usuario` (de `producao_pedidos_neo`), `profile_id` (via `consultor_neo` pelo `usuario_id`), `cliente`, `produtos`, `valor` (soma de `producao_pedidos_neo.valor` do pedido), `perdido_em` = último `producao_etapa_historico.em` com `etapa_nova = 'VENDA PERDIDA (NEOCRM)'`, senão a maior `atualizacao` do pedido, `categoria`, `subcategoria`, `tags` (de `producao_atividades`; null se o pedido ainda não chegou pela exportação), `tag_pedido` (as tags `#...` do pedido em `producao_pedidos_neo`, para fallback visual).
- Datas de corte em São Paulo (`perdido_em at time zone 'America/Sao_Paulo'`).

### 3.4 Cron `sync-exportacao-horario` — `41 * * * *`
Chama a Edge Function com `x-cron-secret` (Vault `sync_producao_cron_secret`, igual às outras). Minuto 41: longe do 59 (produção), do 17 (robô) e dos múltiplos de 15 (alerta). Uma chamada/hora ≪ limites da API.

## 4. Edge Function `sync-exportacao` (substitui a de teste)
- Pasta `supabase/functions/sync-exportacao/` no padrão das outras: `index.ts` (HTTP, auth, Supabase) + `exportacao.ts` (lógica pura) + `exportacao.test.ts` (`node --test`).
- Auth: `x-cron-secret` comparado em tempo constante; sem ele, 401.
- Fluxo: abre linha em `exportacao_sync_log` → `POST` à API com `dataInicio = hoje−90 dias`, `dataFim = hoje` (SP) → em erro HTTP, grava `ok=false`, `http`, `erro = codigo + mensagem` (e `Retry-After` se 429) e termina **sem tocar** em `producao_atividades` → em sucesso, agrega por pedido (`agruparPorPedido`, regra 3.1), faz `upsert` em lotes de 500 por `numero_pedido`, fecha o log com `ok=true`, contagens.
- Pedidos que saírem do painel **não são apagados** (histórico fica).
- `modo:"teste"` no corpo: faz tudo menos gravar e devolve só contagens (para diagnóstico futuro).
- Funções puras exportadas e testadas: `paraNumero(v)` (número, "6999,00", "1.234,56", vazio→0), `paraTimestampSP(s)` (`yyyy-MM-ddTHH:mm:ss` → ISO com `-03:00`), `categoriaDoPedido(itens, campo)` (mais frequente, empate pelo mais recente, vazio → null), `agruparPorPedido(linhas)`, `periodoConsulta(agoraMs)` (hoje−90 → hoje em SP), `mensagemErro(status, corpo)`.

## 5. Aba "Vendas Perdidas" (admin/supervisor)

**Navegação:** botão `data-tab="vendasperdidas"` id `tabBtnVendasPerdidas`, grupo **Vendas**, logo depois de **Funil**, `data-sub="Motivos das vendas perdidas, por categoria"`, visível só para admin/supervisor (`canSeeVendasPerdidas()`); para o consultor o botão some e o painel fica vazio (mesmo padrão da Mesa, seção 68). Visual só com classes/tokens existentes, sem hex.

**Filtros (topo, `.filterPill` + campos):** período — pílulas **Este mês** (padrão), **Mês passado**, **Últimos 90 dias**, **Personalizado** (De/Até); **Consultor** (select, "Todos"); **Categoria** (select, "Todas" + "Sem categoria"). Filtros aplicados no navegador sobre o resultado da RPC (volume pequeno); trocar o período recarrega a RPC.

**Blocos:**
1. **Aviso de sincronização** (só se `exportacao_sync_log` não tiver execução ok nas últimas 3 h, ou nunca): "As categorias do NEO não sincronizam desde DD/MM HH:MM" em `var(--c-sinal)`.
2. **KPIs (`.kpiGrid`):** Pedidos perdidos · Valor perdido · **% com categoria** · Maior motivo (nome + % das perdas com categoria).
3. **Motivos (`table.tbl`):** uma linha por categoria (+ "Sem categoria" por último): pedidos, % do total, valor (sem barra gráfica — as classes de barra existentes são escopadas a `.kpiCard`; YAGNI). Clique na linha → filtra a lista de pedidos (bloco 5) por essa categoria (clicar de novo limpa).
4. **Preenchimento por consultor (`table.tbl`):** consultor, perdas, com categoria, **% preenchido** (selo `.ppNivel`: ≥90% `ok`, 50–89% `medio`, <50% `maximo`), maior motivo do consultor. Ordenado pelo % (pior primeiro). Clique filtra por consultor.
5. **Pedidos (`table.tbl`):** nº do pedido, data da perda, consultor, cliente, produtos, valor, categoria (ou "Sem categoria" com selo `.badge`), tags da atividade. Ordenado pela data da perda (mais recente primeiro). Respeita todos os filtros.
6. **Exportar Excel** (`mlBaixarXlsx`, abas "Motivos", "Preenchimento", "Pedidos").

**Carga:** ao abrir a aba e ao mudar o período; botão "Atualizar". RPC `vendas_perdidas` + leitura do último `exportacao_sync_log`. Erro da RPC → bloco "Não foi possível carregar" sem derrubar o resto do painel.

## 6. Permissões e privacidade
- Tabelas e RPC só admin/supervisor; consultor não vê a aba nem os dados.
- Sem CPF/CNPJ na tabela nova. Cliente aparece só para admin/supervisor (como em Pedidos em Alerta).
- Token só no secret da função; resposta e log da função nunca contêm o token.

## 7. Fora de escopo
- Consultor ver as próprias perdas por categoria (pode vir depois, com RPC por `auth.uid()`).
- Campo `formularios`/`atividades` (veio vazio no teste).
- Alterar a seção "Motivos de Perda" (tags) do Dashboard — continua como está.

## 8. Testes
- `supabase/functions/sync-exportacao/exportacao.test.ts` (`node --test`): conversões, categoria por pedido (frequência, empate, vazio), agrupamento (soma de valor, itens, produtos, datas, tags), período em SP, mensagem de erro (com e sem JSON, 429 com Retry-After), e que nenhuma saída contém o token.
- `test_vendas_perdidas.js` (jsdom, dados fictícios): permissões (consultor sem botão/painel, admin com), período padrão "Este mês" e chamada da RPC com as datas certas (SP), KPIs, tabela de motivos (ordem, "Sem categoria" por último, %), clique filtra, preenchimento por consultor e selos, lista de pedidos e filtros combinados, aviso de sincronização (3 h / nunca), erro de carga, Excel (abas), troca de login.
- SQL: `supabase/tests/vendas_perdidas_check.sql` em transação com rollback (papéis: admin, supervisor, consultor, sem perfil, anon; RPC devolve só perdidas no período; categoria via `producao_atividades`).
- Regressão: `bash run_tests.sh`.

## 9. Entrega
Ordem: (A) banco + função + cron → aplicar com ok (dado em 05/10: "integra") e rodar a 1ª sincronização real conferindo contagens com o teste (≈613 pedidos); (B) aba → publicar **com ok do Rafael no momento**, comparando com o painel no ar, backup, MD5, vigia. Registrar em `REGRAS_NEGOCIO.md` como **§70**.
