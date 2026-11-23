# §164 Sub-aba "Ranking" no Dashboard — design

**Data:** 23/11/2026 · **Pedido do Rafael:** "crie uma sub aba de ranking, que por lá todos os consultores consigam
visualizar claramente todos os rankings". Prévia aprovada ("está bom, pode seguir") com pedido de refinar o design —
o refinamento está na prévia local `previa-ranking.html` (scratchpad da sessão) e descrito na seção Visual.

## Objetivo

Uma tela onde qualquer consultor vê, de forma clara, três rankings da equipe e a própria posição em cada um.
Sucesso = o consultor abre a sub-aba e sabe em 5 segundos em que lugar está e quanto falta para subir.

## Onde e quem vê

- Nova sub-aba **"Ranking"** no Dashboard de Produção (iframe), logo depois de "Visão Diária".
- Visível para **todos os logins** que já veem o Dashboard (consultor, supervisor, admin).
- **Apex e Campinas nunca se misturam** (Rafael, 23/11: "faça a aba de apex separado de campinas"). Cada ranking,
  total do time, "sua posição" e "ainda sem venda" é calculado dentro de uma operação só (`operacaoDoVendedor`, §78).
  - Consultor e supervisor da **Apex** veem o ranking da Apex; os da **Campinas** veem o ranking da Campinas (o
    Dashboard já abre para os logins de Campinas; a sub-aba vale para eles também).
  - Admin usa o seletor que já existe: "Operação Apex" ou "Operação Campinas" mostram aquela operação. Com
    "Apex + Campinas", a sub-aba mostra **dois blocos separados**, um embaixo do outro (título "Operação Apex" e
    "Operação Campinas"), cada um com seus três rankings — nunca um ranking único com as duas.
  - A equipe de cada operação (para "Ainda sem venda") vem de `equipe_vendedores` filtrada por operação
    (`filtrarDashboardEquipe`); hoje há 38 nomes ligados à Apex e 10 à Campinas.
- **Fora do ranking:** quem já está fora do Dashboard (`foraDoDashboard`) e, só no ranking, **Anderson Teixeira Mizuta**
  (lista nova `RANKING_FORA`, dentro do iframe). Ele continua nas outras sub-abas.

## Período

- Botões **Hoje | Semana | Mês** (abre em Mês) + seletor de mês para ver meses anteriores (só vale com "Mês").
- Semana = segunda-feira da semana atual até hoje.
- Data do pedido = data de **cadastro** em horário de São Paulo, a mesma da Visão Diária.

## Pedidos que contam

Todos os pedidos de `producao_pedidos`, **menos** as etapas:
`VENDA PERDIDA (NEOCRM)`, `DEVOLVIDO (NEOCRM)`, `PROPOSTA (NEOCRM)`, `AGUARDANDO INTERACAO (NEOCRM)`.
(Proposta e Aguardando interação já ficam fora da Visão Diária; perdido e devolvido saem por decisão do Rafael.)

## Os três rankings

| # | Ranking | Soma `quantidade` dos grupos | Desempate |
|---|---|---|---|
| 1 | **Linhas** | todos os grupos que começam com `VOZ` (Novo, Portabilidade, Tranf. Titularidade, Renovação, TT + Renovação) — igual ao card "Linhas" da Visão Diária. Soluções digitais nunca entram. | soma de `valor` desses mesmos itens (receita das linhas) |
| 2 | **Fibra** | grupos que começam com `BANDA LARGA` (fibra **e** modem). Mostra o detalhe "N fibra e M modem" com a mesma regra da §160 (`BL_MODEM_RE`). | receita da banda larga |
| 3 | **Soluções digitais** | `SVA MÓVEL` (Claro Monitor), `SVA FIXA` (Wi-Fi Mesh), `INCREMENTO DE MÓDULO` (Passaporte), `NET - TV` (Claro TV Empresas) | receita desses itens |

- Ordem: quantidade ↓, depois receita ↓, depois nome (A→Z).
- A receita do desempate é **só a do próprio ranking** — aparelho (grupo `APARELHO`) nunca entra (um iPhone distorceria).
- Grupo novo que o NEO criar não entra em nenhum ranking até ser incluído na lista (mesma manutenção da §16.11).

## O que a tela mostra

1. **Cabeçalho:** título "Ranking da equipe", texto do período ("Novembro, de 1º a 23 (hoje)"), seletor de período.
2. **Faixa do time:** total de linhas (com receita), fibras (com "N fibra e M modem") e soluções digitais do período.
3. **Sua posição** (só quando o login tem nome no NEO e aparece no ranking da operação): posição em cada ranking e
   "Faltam N linhas para passar Fulano" / "Empatado com Fulano; passa com mais receita" / "Você lidera com N" /
   "Ainda sem venda neste período".
   - O nome do NEO do login vem do vínculo `consultor_neo` (mesmo caminho da RPC `vendedores_operacao`); sem vínculo,
     tenta o nome do perfil; sem nada, a faixa não aparece (admin sem vínculo não vê a faixa).
4. **Três colunas de ranking** (uma embaixo da outra em tela estreita), cada uma com:
   - **Pódio "ápice"** com os 3 primeiros: nome, quantidade, receita. Posição vaga aparece apagada.
   - **Lista do 4º em diante:** posição, seta, nome, quantidade, receita e uma barra de fundo proporcional ao líder.
   - A linha do login fica destacada (rosa).
   - **"Ainda sem venda (N)":** nomes da equipe da operação (`equipe_vendedores`) com zero no período, em uma linha
     de texto no rodapé do card — ninguém some.
5. **Seta subiu/caiu:** posição agora × posição calculada com os pedidos até o fim de ontem, dentro do mesmo período.
   ▲ N verde, ▼ N vermelho, "=" cinza, "novo" para quem não estava no ranking ontem. Não aparece em "Hoje"
   (nem em "Semana" na segunda-feira, quando o período começa hoje).
6. **Rodapé:** uma frase explicando o que conta e o que é a seta.

## Visual (refinado, dentro do Sinal de Ápice)

- Só variáveis do `:root` do iframe (`--accent`, `--accent-dark`, `--bordo`, `--rosa`, `--text`, `--muted`, `--border`)
  + três cores novas de medalha (`--ouro`, `--prata`, `--bronze`) usadas só num ponto de 10 px ao lado do nome.
- Fontes: Barlow Condensed nos números e títulos, Barlow no texto; números com `tabular-nums`.
- **Elemento marcante = o pódio em forma de pico** (o "ápice" da marca, como na TV Vendas): 1º no centro, base
  vermelha (`--accent`) com topo em ponta; 2º `--accent-dark` inclinado para o centro; 3º `--bordo` inclinado para o
  centro (`clip-path`).
- Resto discreto: seletor de período segmentado (botão ativo grafite), faixa do time numa barra só (não 3 cards
  iguais), "sua posição" numa faixa bordô com o número da posição grande.
- Sem animação automática. Foco visível nos botões. Layout sem rolagem horizontal até 360 px.
- Sem "Modo TV" por enquanto (Rafael, 23/11).

## Como funciona (técnico)

- Tudo dentro do iframe do Dashboard (`_dashboard_producao.html` via `dashboard_tpl.py extrair/empacotar`), sobre os
  `records` que o painel já injeta (`__DATA__`). Consultor já recebe `grupo, usuario, etapa, cadastro, valor,
  quantidade, produto` de todo o time — **nenhuma mudança no banco, RLS, RPC ou Edge Function.**
- Botão da sub-aba criado como os de "Projeção de Ganho" / "Vendas Perdidas" (inserido no `.tabs` + `switchTab`).
- Nome do login: novo placeholder `__EU_NEO__` substituído no `loadProducaoDashboard()` do `_template.html`
  (JSON com o nome em maiúsculo ou `null`).
- Funções puras e testáveis no iframe: `rankingCategoria(grupo)`, `rankingConta(etapa)`, `rankingCalcular(records,
  {inicio, fim, categoria})`, `rankingPosicoes(lista)`, `rankingSeta(posAgora, posOntem)`, `rankingFalta(lista, nome)`.
- Atualiza junto com o Dashboard (sincronização a cada 10 min e recarga de 1 h que já existem).

## Testes

`test_dashboard_ranking.js` (jsdom, padrão dos outros `test_dashboard_*.js`):
- grupos → categoria (VOZ* = linhas; BANDA LARGA* = fibra, com modem identificado; 4 grupos digitais; APARELHO fora);
- etapas fora (perdido, devolvido, proposta, aguardando interação) e o resto dentro;
- desempate pela receita do próprio ranking e depois pelo nome; receita de aparelho não interfere;
- período Hoje / Semana / Mês / mês anterior pela data de cadastro em SP;
- seta: ▲/▼/=/novo; sem seta em Hoje;
- "faltam N para passar X", empate e líder;
- Anderson e `foraDoDashboard` fora; zeros da equipe em "Ainda sem venda";
- operação: consultor de Campinas vê só Campinas e o da Apex só Apex; admin com "Apex + Campinas" recebe dois blocos e
  nenhuma posição mistura vendedor das duas operações.
Suíte inteira rodada antes e depois; só podem falhar as mesmas que já falham na `oficial/main`.

## Fora do escopo

Banco, TV Vendas, Visão Diária, Fechamento, Boletim, Modo TV, metas por ranking, histórico de campeões.

## Publicação

Só com ok do Rafael na hora: comparar o ar com o oficial, backup, MD5 do ar no mesmo comando do envio (roteiro da
memória de publicação). REGRAS_NEGOCIO.md ganha a **§164** no mesmo PR.
