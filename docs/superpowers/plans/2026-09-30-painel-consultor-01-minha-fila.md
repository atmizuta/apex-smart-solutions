# Plano 1 — Minha Fila (pedidos parados, quantidade, R$ parados, etapa de cada um)

Spec: seções 3.3, 4.2. Depende do Plano 0 (RPC `producao_meus_pedidos`). Reaproveita a regra de dias úteis/feriados/níveis da seção 48.

**Meta:** o consultor abre o painel e vê **quantos pedidos dele estão parados, quanto dinheiro isso representa e em que etapa cada um está**. O Caio só vê os do Caio; a Vitória só os da Vitória; admin/supervisor escolhem "ver como".

**Arquivos**
- Modificar `_template.html`: botão `data-tab="minhafila"` no `#tabsNav` (grupo de produção), painel `#tab-minhafila`, JS `loadMinhaFila()`
- Extrair/reutilizar do dashboard (via `dashboard_tpl.py extrair|empacotar`) as funções `diasUteisParado`, feriados e `ALERTA_FAIXAS`; melhor mover para um módulo compartilhado no template do painel para não duplicar
- Criar `test_minha_fila.js`; registrar em `run_tests.sh`
- Atualizar `REGRAS_NEGOCIO.md` (seção 54)

## Tarefa 1 — Regra pura (TDD, sem tela)
- [ ] Constante `ETAPAS_FILA` com as 8 etapas e o campo `bola` (`cliente | operadora | backoffice | logistica`) — valores da spec 4.2, **a confirmar (D2)**.
- [ ] `agruparPedidosFila(linhas)`: 1 linha por `numero_pedido` (maior `atualizacao`, menor `cadastro`, soma de `valor`/`quantidade`, produtos unidos por " + ", primeiro cliente/CNPJ não vazio) — igual à seção 48.2.
- [ ] `classificarFila(pedido, refData)`: dias úteis (mesma função da 48), nível 🟡/🟠/🔴 pelas faixas 3/6/10; 0–2 dias = **em dia** (não entra em "parados", mas conta em "em aberto").
- [ ] `resumoFila(pedidos)`: `{parados, valorParado, abertos, valorAberto, porEtapa:[{etapa, n, valor, niveis}]}`.
- [ ] Testes (dados fictícios): pedido com 2 linhas soma valor; fronteiras 2/3/5/6/9/10 dias úteis; fim de semana e feriado; pedido concluído/perdido/devolvido não entra; referência = "Atualizado em", não hoje.

## Tarefa 2 — Dados (respeitando o dono)
- [ ] `loadMinhaFila()` chama `rpc('producao_meus_pedidos', {p_consultor})` paginado (limite de 1000 linhas, seção 36), já filtrado por etapa aberta.
- [ ] Sem vínculo (Plano 0) → estado vazio "seu usuário ainda não foi ligado ao NeoCRM; avise um administrador". Sem pedidos parados → "Fila limpa 🎉" com o valor em aberto.
- [ ] Admin/supervisor: `<select>` "Ver como" com os consultores vinculados; `p_consultor` vai na RPC. Consultor: sem seletor.

## Tarefa 3 — Tela
- [ ] Topo, 3 `.kpiCard`: **Pedidos parados**, **R$ parados** (rótulo final conforme D3: "R$/mês" se for mensalidade) e **R$ em aberto**.
- [ ] "Onde está o dinheiro": uma linha por etapa — etapa, nº de pedidos, R$, barra proporcional, selo de "bola com: cliente/operadora/…". Clique filtra a lista.
- [ ] Lista: `table.tbl`, 1 linha por pedido, ordenada por nível e dias: Cliente, CNPJ, Produto(s), Valor, **Etapa**, Dias úteis parado, Nível, botão "copiar nº". Linha na cor do nível usando os tokens `--alerta-*` já existentes (sem hex novo).
- [ ] Filtros: Etapa e Nível (reusar `.filterPill`); "Limpar filtros".
- [ ] Mobile (seção 47): lista vira cartões empilhados; KPIs em 2 colunas; toque ≥ 44px.
- [ ] Motion: só o `ApexMotion` existente (entrada dos KPIs); nada novo.
- [ ] Teste jsdom: consultor fictício vê só os próprios pedidos (mock da RPC); admin troca o "ver como" e a lista muda; soma de R$ dos cartões = soma da lista; estado sem vínculo.

## Tarefa 4 — Admin vê o total da equipe (opcional, barato)
- [ ] Na visão admin da própria aba: quadro "por consultor" (pedidos parados e R$ parados, como a tabela da spec 3.3) com clique levando ao "ver como". Não substitui Pedidos em Alerta; só atalho.
- [ ] Decidir com o usuário se **Pedidos em Alerta** passa a usar as mesmas 8 etapas (manter as duas telas coerentes).

## Tarefa 5 — Entrega
- [ ] `bash run_tests.sh` verde; `REGRAS_NEGOCIO.md` seção 54 (regra, etapas, quem vê, privacidade).
- [ ] Verificação no navegador (preview): logar como consultor de teste e conferir isolamento; conferir com números reais (hoje ≈ 76 pedidos / R$ 7,7 mil parados no total, por consultor na spec 3.3).
- [ ] Publicar só com autorização (CLAUDE.md: comparar site × repo, backup, MD5).

**Critério de pronto:** a soma dos R$ parados de todos os consultores bate com o total das etapas monitoradas na base; nenhum consultor vê pedido de outro.
