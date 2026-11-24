# §166 Movimentações dos pedidos (APIs Movimentação + Atualizações da Xeotech) — design

**Data:** 24/11/2026 · **Pedido do Rafael** · **Seção:** §166 do `REGRAS_NEGOCIO.md`
Complementa (não substitui) `2026-10-05-vendas-perdidas-categorias-design.md` (sync-exportacao).

## 1. Objetivo

1. Ver **por onde cada pedido passou** no NEO (etapas, quem moveu, quanto tempo ficou, SLA) e as
   **anotações da BKO** ("Status: … / Descrição: …").
2. Uma aba nova **Movimentações** com o feed do dia e o **tempo por etapa**.
3. **Auditar as vendas perdidas**: conferir se a categoria escolhida pelo consultor ao mover para Venda
   Perdida (VP) bate com o que a BKO anotou antes, se o pedido saiu da VP depois, ou se foi devolvido pela
   BKO e perdido pelo consultor sem anotação nova.

Fora deste escopo (cada um terá o seu design depois): API Consulta Cliente, API Consulta Pedido (botão sob
demanda), API Alterar Etapa (escreve no NEO), estrutura Eagle (outro token).

## 2. O que as APIs entregam (testado em 23–24/11 com o token do dono)

| API | Endpoint | Devolve | Limite que importa |
|---|---|---|---|
| **Movimentação de Pedidos** | `POST /api/v1/pedidos/movimentacao/{token}` | uma linha por **passagem em etapa** (22 campos: `pedidoId`, `etapaId`, `numeroAtividade`, `nomeEtapa`, `usuarioEntrou/Saiu`, `dataHoraEntrou/Saiu`, `tempo`, `slaHoras`, `movimentacao`, `nomeConsultor`, `total`…) de todo pedido **atualizado** na janela (histórico inteiro dele) | `pedidoTipo` obrigatório (usamos `COMERCIAL`); `dataHoraFim` exclusivo; formato `yyyy-MM-dd HH:mm:ss` |
| **Atualizações de Pedidos** | `POST /api/v1/pedidos/atualizacoes/{token}` | uma linha por pedido atualizado na janela, com `descricaoUltimaMovimentacao` = **a última** anotação do pedido (é onde aparecem as notas da BKO) | `dataHoraFim` inclusivo; formato `yyyy-MM-ddTHH:mm:ss`; janela ≤ 90 dias |

- **Guarda compartilhada** pelas APIs de pedidos: 2 execuções simultâneas no total, 1 por estrutura,
  **120 s de espera** depois de cada execução, **3 execuções por estrutura a cada 10 min**; 429 com
  `Retry-After`. Tentativa recusada também conta. A exportação (`sync-exportacao`) tem guarda própria.
- O token vai **na URL**: nunca registrar URL, token nem a mensagem crua de erro de rede em log.
- `numeroAtividade` = `numero_pedido` da `producao_pedidos_neo` (19 de 19 conferidos).
- A Movimentação **perde** anotações que não mudam etapa; a Atualizações mostra **só a última**. Por isso a
  Atualizações roda com frequência e cada texto novo é guardado (diário só cresce).
- O `id` da Movimentação **não** é estável: não serve de chave.

## 3. Dados

### 3.1 `pedido_movimentacoes` — o **filme** (uma linha por passagem em etapa)

| Coluna | Origem |
|---|---|
| `pedido_id bigint`, `numero_pedido text`, `etapa_id bigint`, `etapa text` | `pedidoId`, `numeroAtividade`, `etapaId`, `nomeEtapa` |
| `entrou_em timestamptz`, `saiu_em timestamptz null` | `dataHoraEntrou`, `dataHoraSaiu` (horário de SP) |
| `entrou_por text`, `saiu_por text` | `usuarioEntrou`, `usuarioSaiu` |
| `sla_horas numeric`, `tempo text` | `slaHoras`, `tempo` |
| `texto text` | `movimentacao` (sem HTML, ver 3.4) |
| `vp_categoria text null` | categoria tirada de `Categoria Inserido …` quando a etapa é VP |
| `consultor text`, `valor numeric`, `tags text` | `nomeConsultor`, `total`, `tagsAtividade` |
| `sincronizado_em timestamptz` | hora da gravação |

- **Chave:** `unique (pedido_id, etapa_id, entrou_em)`. Não usamos `saiu` nem o texto na chave: `saiu` começa
  vazio e é preenchido depois, e a mesma passagem viraria duas linhas. Upsert atualiza a linha.
- Índices: `(numero_pedido)`, `(entrou_em)`, parcial `(etapa_id) where saiu_em is null` (pedidos parados agora).

### 3.2 `pedido_anotacoes` — o **diário** (só cresce)

| Coluna | |
|---|---|
| `numero_pedido text`, `atualizado_em_neo timestamptz` | `numeroAtividade`, `dataHoraAtualizacao` |
| `texto text` | `descricaoUltimaMovimentacao` sem HTML |
| `tipo text` | `bko_status` · `venda_perdida` · `livre` |
| `status text null`, `descricao text null` | partes de `Status: … / Descrição: …` |
| `vp_categoria text null` | quando o texto é de VP |
| `etapa text` | `nomeEtapa` no momento |
| `visto_em timestamptz` | primeira vez que a sync viu o texto |

- **Chave:** `unique (numero_pedido, atualizado_em_neo, md5(texto))`; `on conflict do nothing`.
- Textos que são só `Movimentado para X` **não entram** (já estão no filme).
- **Autor provável:** a API não diz quem escreveu. A RPC mostra como "provável: Fulano" quem fez a última
  passagem do filme até aquele horário, sempre marcado como deduzido.

### 3.3 `neo_pedidos_sync_log`

`id`, `api` (`atualizacoes`|`movimentacao`), `janela_ini`, `janela_fim`, `http`, `linhas`, `gravados`, `ok`,
`erro` (sem token), `comecou_em`, `terminou_em`. A próxima janela começa no `janela_fim` da última execução
**ok** daquela API.

### 3.4 Separar os textos (função pura, com teste)

Formatos vistos no NEO:

- BKO: `<B>Status: CONSULTA NÃO APROVADA\n\nDescrição: REPROVADO …</B><BR>` → `tipo=bko_status`,
  `status`, `descricao`.
- VP: `<B>texto livre</B><BR>Alteração TAGS de […]<BR>(Venda Perdida)<BR>Categoria Inserido <categoria><BR>`
  → `tipo=venda_perdida`, `vp_categoria`.
- `Movimentado para X` → descartado no diário.
- Qualquer outro → `tipo=livre`.

Tira `<B>`, `<BR>` e entidades HTML antes de gravar.

### 3.5 `vp_motivo_equivalencia` e `venda_perdida_auditoria`

- `vp_motivo_equivalencia (vp_categoria text, trecho_status text)`: quando a categoria do consultor
  "bate" com o status da BKO (`status ilike '%' || trecho_status || '%'`). Começa com uma linha:
  `Restrição de Crédito` ↔ `NÃO APROVADA`. O resto é preenchido com o Rafael depois de ~2 semanas de
  anotações reais.
- `venda_perdida_auditoria (numero_pedido text pk, motivo_real text, obs text, decidido_por uuid,
  decidido_em timestamptz)`: a decisão humana (seção 6). É a **única escrita** da feature feita pelo painel.

**Fora de todas as tabelas:** nome do cliente, CNPJ, `complementos` (o cliente já está na
`producao_pedidos_neo`, ligado pelo `numero_pedido`). RLS ligado nas tabelas novas **sem** policy de leitura:
o painel só lê pelas RPCs.

## 4. Edge Function `sync-pedidos-neo`

Mesmo molde da `sync-exportacao`:

- `index.ts`: confere `x-cron-secret` (`SYNC_CRON_SECRET`, comparação em tempo constante), lê o secret
  **`NEO_PEDIDOS_TOKEN`**, abre o log, chama a API, grava, fecha o log. Corpo `{"api":"atualizacoes"|"movimentacao"}`;
  `{"modo":"teste"}` faz tudo menos gravar e devolve só contagens.
- `pedidos.ts`: funções puras (janela, separar textos, montar linhas, mensagem de erro, ocultar token).
- `pedidos.test.ts`: testes Deno com exemplos **inventados** (repo público).
- Erros (HTTP ≠ 200, HTTP 200 com `codigo`/`mensagem` de erro, JSON inválido, queda): log com `ok=false`,
  `erro` sem token, **janela não avança**. A repetição é segura por causa das chaves únicas.
- Janela da Movimentação: no máximo 7 dias por chamada (a carga inicial roda em várias chamadas).
- `NEO_PEDIDOS_TOKEN` é separado do `NEO_EXPORT_TOKEN`: trocar um não derruba o outro.

### 4.1 Agenda (pg_cron, horário de SP)

| API | Quando | Chamadas/h |
|---|---|---|
| Atualizações | 08–22 h: :03 :13 :23 :33 :43 :53 · fora disso: :03 | 6 |
| Movimentação | :08 e :38, o dia todo | 2 |

As duas ficam a ≥ 5 min uma da outra (guarda de 120 s) e usam 8 das ~18 chamadas/h permitidas.

### 4.2 Carga inicial

Filme desde **01/09/2026**, em janelas de 7 dias, **uma vez, à noite** (cota de IO do Micro). Depois, conferir
o tamanho das tabelas. O diário começa vazio: anotação antiga não é recuperável pela API.

## 5. Painel

### 5.1 Gaveta "Linha do tempo do pedido"

- Abre ao clicar no número do pedido em Pedidos em Alerta, Vendas Perdidas e na aba Movimentações.
- Gaveta de 560 px no molde da ficha do lead (§126), sem CSS novo além do mínimo.
- Cabeçalho (número, cliente, consultor, valor, etapa atual), barra de etapas proporcional ao tempo
  (vermelha quando passou do SLA) e linha do tempo com filme + diário em ordem de horário:
  🔵 anotação da BKO (autor provável), ⚪ mudança de etapa (por quem, quanto tempo), 🟠 venda perdida (categoria).
- Pedido sem histórico: só o cabeçalho e "Histórico começa em 01/09".
- Para `admin`/`supervisor`, bloco **Motivo real** (seção 6).
- RPC `pedido_linha_do_tempo(p_numero text) returns jsonb`.

### 5.2 Aba Movimentações

Botão novo no `nav#tabsNav`, visível só para `admin` e `supervisor`. Três sub-abas:

1. **Feed do dia:** filtros dia (hoje), consultor, etapa, tipo; KPIs movimentações / anotações da BKO /
   entradas em VP; lista mais nova primeiro, clicável. Relê sozinha a cada 5 min com a aba aberta.
   "Atualizado às HH:MM" = último `ok` do log; fica com a cor de alerta se tiver mais de 30 min.
   RPC `movimentacoes_feed(p_dia date, p_consultor text, p_etapa text, p_tipo text)`.
2. **Tempo por etapa:** período (últimos 30 dias), filtro consultor; por etapa: passagens, mediana,
   percentil 90, % fora do SLA, parados agora (clicável). RPC `movimentacoes_tempo_etapa(p_de date, p_ate date, p_consultor text)`.
3. **Vendas perdidas:** seção 6.

Só classes e variáveis existentes (`.card`, `.kpiGrid`, `table.tbl`, `.badge`, `.filterPill`); nada no bloco
de estilo do Sinal de Ápice.

### 5.3 Quem vê

| `profiles.role` | Gaveta | Aba Movimentações | Motivo real |
|---|---|---|---|
| `admin` | todo pedido | sim, tudo | sim |
| `supervisor` | só pedidos da **operação dele** | sim, só da operação dele | sim, só da operação dele |
| `consultor` | só pedidos com `usuario_id = meu_neo_usuario_id()` | não | não |
| `agencia` | não | não | não |

- **Operação do pedido** = `profiles.operacao` do consultor do pedido (`producao_pedidos_neo.usuario_id` →
  `consultor_neo.neo_usuario_id` → `profile_id` → `profiles.operacao`). Pedido sem consultor ligado (~4%,
  ex-consultores) conta como `apex`, a operação base da estrutura NEO. Decisão do Rafael (24/11): supervisor
  vê só a própria operação.
- O mesmo filtro vale para o feed, o tempo por etapa e a auditoria de VP (supervisor de Campinas vê os
  números só de Campinas).
- O banco não tem cargo BKO: as BKO usam o perfil que já têm (`admin` ou `supervisor`).
- A trava fica **dentro** de cada RPC (`security definer`, checa `auth.uid()` em `profiles` antes de devolver),
  numa função auxiliar única `pedido_pode_ver(p_numero text) returns boolean` usada por todas.

## 6. Auditoria das vendas perdidas

Para cada passagem do filme em etapa de VP no período:

- **Consultor:** `vp_categoria` da passagem (ou `producao_atividades.categoria` se faltar).
- **BKO:** última anotação `bko_status` do diário com `atualizado_em_neo` **menor** que a entrada em VP.
- **Filme:** passagens antes e depois da VP.

Selo, na ordem (o primeiro que valer):

| Selo | Regra |
|---|---|
| ↩️ **Saiu da VP** | existe passagem do mesmo pedido em outra etapa com `entrou_em` depois da entrada em VP |
| 🔁 **Devolvido e perdido** | a passagem anterior à VP é uma etapa "de devolução" em que o pedido entrou por alguém que não é o consultor, e não há anotação `bko_status` entre essa devolução e a VP |
| ✅ **Confere** | há anotação BKO antes e `vp_motivo_equivalencia` liga a categoria ao status |
| ⚠️ **Motivo diferente** | há anotação BKO antes e o status tem equivalência cadastrada só para **outra** categoria |
| ❔ **Sem como conferir** | nenhum dos anteriores (inclui status sem equivalência cadastrada) |

A lista de etapas "de devolução" é pequena e fixa; é definida no plano a partir das etapas reais do filme.

Tela: totais do período (VP, cada selo, "VP reais" = total − ↩️), tabela por consultor (VPs, % ⚠️+🔁,
categorias mais usadas), números clicáveis que abrem a lista de pedidos. RPC
`vendas_perdidas_auditoria(p_de date, p_ate date)`.

**Motivo real:** na gaveta, admin/supervisor confirma a categoria do consultor ou escolhe outra da mesma
lista de categorias do NEO, com observação. RPC `venda_perdida_definir_motivo(p_numero, p_motivo, p_obs)`
grava em `venda_perdida_auditoria`. A tela mostra o motivo real quando existe.

**Limite:** VPs anteriores à entrada no ar ficam quase todas em ❔ (a anotação da BKO foi coberta pela própria
VP). Rascunho de pedido à Xeotech para expor o log completo (`pedido_movimentacao`) na API: o Rafael envia.

## 7. Testes

| O quê | Como |
|---|---|
| Separar textos, janela, erros (429 + Retry-After, HTTP 200 com erro, JSON inválido), token fora do erro | `pedidos.test.ts` (Deno), API falsa, exemplos inventados |
| Selos da VP, trava de cargo, linha do tempo | SQL em `begin … rollback` no banco com pedidos de mentira |
| Painel | testes do `run_tests.sh` da parte mexida; abrir gaveta e as 3 sub-abas; contar `<div>`/`</div>`; outras abas no lugar |

## 8. Entrada no ar (um ok do Rafael em cada passo)

1. Migration: tabelas, índices, RPCs, equivalência inicial.
2. Secret `NEO_PEDIDOS_TOKEN`: **o Rafael cria** no Supabase (Edge Functions → Secrets).
3. Deploy da Edge Function + uma chamada manual de Atualizações com janela de 1 h; conferir log.
4. Crons; acompanhar 1 dia de log.
5. Carga do filme desde 01/09, à noite; conferir tamanho no disco.
6. Painel (gaveta + aba) no processo de publicação de sempre.
7. Equivalências da VP depois de ~2 semanas, com o Rafael.

## 9. Números de referência (24/11)

- Categorias de VP já usadas pelos consultores (`producao_atividades`): Restrição de Crédito, Não responde,
  Desistência Biometria, Desistência Demora, Fibra - Inviabilidade Técnica, Troca de Território, Erro de
  Cadastro, Desconfiança, CNPJ Inapto, Retenção (Concorrência), Duplicidade, Portabilidade em Andamento,
  Erro Portabilidade, Multa Concorrência; 101 VPs sem categoria.
- `producao_pedidos_neo` desde 01/09: `usuario_id` em 100%, 96% ligam a um consultor em `consultor_neo`.
