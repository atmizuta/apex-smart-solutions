# Adendo (05/10/2026, noite) — Vendas Perdidas vira sub-aba do Dashboard de Produção, com análise

Pedido do Rafael ao aprovar a publicação: *"quero que seja uma aba para supervisores/admins apenas, coloque ao lado de pedidos em alerta, … coloque mais informações para nós supervisores conseguirmos analisar ao certo por que cada venda está sendo perdida, e se você quiser colocar gráficos … pode colocar, e já publicar no painel"*.

Substitui a seção 5 da spec (aba no menu lateral). O resto (integração, tabelas, sync) continua.

## A. Onde
- Sub-aba **"Vendas Perdidas"** no Dashboard de Produção (iframe `_dashboard_producao.html`, empacotado em base64 no `_template.html` via `python dashboard_tpl.py extrair|empacotar`), **logo depois de "Pedidos em Alerta"**, criada só se `ADMIN_MODE` (mesmo padrão: botão inserido por script; painel removido do DOM para o consultor).
- A aba "Vendas Perdidas" do menu lateral (Tasks 4–5) **sai** do `_template.html` (botão, `<section id="panel-vendasperdidas">`, funções `vp*`, ligações em `enterApp`/`#tabsNav`) e `test_reorganizacao_abas.js` volta a lista sem `vendasperdidas`. `test_vendas_perdidas.js` passa a testar a sub-aba do Dashboard.

## B. Dados
- RPC **v3** `vendas_perdidas(p_de, p_ate)` (migration `20261005100300_vendas_perdidas_v3.sql`, rollback volta à v2): mesmas colunas + `grupo` (max de `producao_pedidos_neo.grupo`, ex.: "VOZ - Portabilidade"), `solicitacao` (de `producao_neo_raw.raw->>'solicitacao'`, max por pedido), `cidade` (`raw->>'cidade'`), `cadastro` (min `producao_pedidos_neo.cadastro`). Ordem `perdido_em desc, numero_pedido`. Mesmas permissões (admin/supervisor, 42501).
- O painel (`loadProducaoDashboard` no `_template.html`), **só em adminMode**, busca `vendas_perdidas(hoje−180 dias, hoje)` (SP) e a última execução ok de `exportacao_sync_log`, e injeta nos placeholders **`__PERDIDAS__`** (JSON) e **`__PERDIDAS_SYNC__`** (JSON string ISO ou `null`), adicionados a `RUNTIME_PLACEHOLDERS` no `build_painel.py`. Consultor: `[]`/`null`. Erro na busca: `[]` e a sub-aba mostra "não foi possível carregar". Na atualização automática de 1 h, chama também `frame.contentWindow.atualizarVendasPerdidas(linhas, syncOk)` se existir.

## C. A sub-aba (análise)
Visual do próprio Dashboard (classes e variáveis dele: `.section-title`, `.section-sub`, `.cards`/cards de KPI, `.cell-bar`, tabelas, `--perdido`, `--accent`…). Gráficos em **HTML/CSS/SVG puro** (barras horizontais, barras empilhadas, matriz com intensidade de cor) — sem biblioteca nova.
1. **Filtros próprios** (como em Pedidos em Alerta): Período (Este mês · Mês passado · Últimos 90 dias · Últimos 180 dias), Consultor, Motivo, Tipo de venda (grupo), "Limpar filtros". Os filtros da barra lateral do Dashboard não se aplicam (como Pedidos em Alerta).
2. **Aviso de sincronização** se a última sync ok tiver mais de 3 h (ou nunca).
3. **KPIs:** Vendas perdidas · Valor perdido · Ticket médio perdido · % com motivo informado · Maior motivo · Tempo médio até perder (dias entre cadastro e perda).
4. **Motivos (gráfico de barras horizontais):** pedidos e valor por motivo, % do total; "Sem motivo informado" por último; clique filtra tudo.
5. **Motivo × Tipo de venda (matriz):** linhas = motivos, colunas = grupos (VOZ - Portabilidade, VOZ - Novo, VOZ - Renovação, BANDA LARGA - Novo…); célula = nº de pedidos com cor proporcional; clique na célula filtra.
6. **Motivo × Consultor (matriz)**, mesma mecânica.
7. **Evolução semanal (barras empilhadas por semana, top 5 motivos + "outros")** no período.
8. **Tempo até perder por motivo:** faixas 0–1 dia, 2–7, 8–15, 16–30, 30+ (barras empilhadas por motivo) — mostra o que morre logo e o que morre por demora.
9. **Preenchimento por consultor:** perdas, com motivo, % (selo verde ≥90%, amarelo 50–89%, vermelho <50%), pior primeiro.
10. **Top cidades** com mais perdas (e o motivo principal de cada) — útil para "Fibra - Inviabilidade Técnica"/"Troca de Território".
11. **Tabela de pedidos** (respeita todos os filtros): pedido, perdido em, dias até perder, consultor, cliente, cidade, tipo de venda, solicitação, produtos, valor, motivo, tags. Ordenada por data da perda (mais recente primeiro).
12. **Exportar Excel** (mesmo mecanismo que o Dashboard já usa) com abas Resumo por motivo, Motivo × Tipo, Motivo × Consultor, Pedidos.

## D. Testes
`test_vendas_perdidas.js` reescrito para a sub-aba: decodifica o template do Dashboard (como os testes do Dashboard), injeta dados fictícios nos placeholders, roda no jsdom e confere: aba só com ADMIN_MODE, KPIs, ordem dos motivos, matriz (contagens e clique filtrando), evolução semanal (semanas), faixas de tempo, preenchimento e selos, filtros combinados, período (incluindo mês passado em janeiro), aviso de sync, Excel (abas), escape de HTML com nome malicioso. Mais: o painel injeta `__PERDIDAS__` só para admin (consultor recebe `[]`), e `build_painel.py` aceita os placeholders novos.
