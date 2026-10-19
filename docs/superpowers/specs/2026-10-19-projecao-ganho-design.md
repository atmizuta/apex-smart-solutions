# Projeção de Ganho — design (19/10/2026)

Nova sub-aba **"Projeção de Ganho"** dentro do Dashboard de Produção do painel de clientes Apex
(`_template.html` → iframe do dashboard embutido em `PRODUCAO_DASHBOARD_TPL_B64`). Projeta quanto a
operação vai fechar no mês, na semana e por dia útil, em **receita (R$) e contratos**, a partir do
valor ponderado dos pedidos pela etapa atual no NeoCRM. Junto vem um 3º botão **"Apex + Campinas"** no
seletor de operação (só admin). Regras de negócio: `REGRAS_NEGOCIO.md` §101 (a criar na entrega).

## 1. Objetivo e público

- **Para quem:** admin e supervisores. O Jaime (supervisor de Campinas) vê só Campinas; os supervisores
  da Apex veem só a Apex; o admin escolhe Apex, Campinas ou as duas somadas.
- **Problema:** hoje o painel mostra o que já entrou, mas não quanto o mês vai fechar se o ritmo
  continuar. Pedidos em Antifraude e Biometria ainda podem cair, então não valem o mesmo que um pedido
  concluído.
- **Sucesso:** ao abrir a aba, a gestão vê a projeção do mês, da semana e do dia útil (R$ e contratos), de
  onde ela vem (dia, semana, etapa, consultor, tipo de venda) e baixa tudo em Excel com um clique.

## 2. Decisões tomadas com o usuário (19/10/2026)

| Tema | Decisão |
|---|---|
| O que é "ganho" | Receita (R$, campo `valor`) **e** contratos, ponderados pelo peso da etapa |
| Pesos | Concluído 100% · Entrega 100% · Validação eSIM 100% (dentro da faixa "Entrega") · Antifraude 50% · Biometria 50% |
| Etapas não citadas | 0%, inclusive Território, Faturamento e Portabilidade em Andamento ("só as que eu disse") |
| Escopo dos pesos | Só nesta aba. `PRODUCAO_ETAPA_CATEGORY` (Ganho/Andamento) do resto do painel não muda |
| Cálculo | Ritmo do mês: realizado ponderado ÷ dias úteis completos, × dias úteis de cada período |
| Hoje | Só dias completos: o que entrou hoje aparece como "hoje (parcial)" e entra no ritmo amanhã |
| Grupos | Todos os grupos entram (como a Visão Diária); a barra de filtros do Dashboard não vale aqui |
| Dias úteis | Seg–sex sem feriados nacionais (o calendário que o Dashboard já usa) |
| Quem vê | Admin e supervisor; consultor não vê a aba |
| Quebras | Por consultor, por etapa e por tipo de venda (as três) |
| Onde fica | Sub-aba do Dashboard de Produção (ao lado de Pedidos em Alerta / Vendas Perdidas) |
| Operações | Apex e Campinas separadas; "Apex + Campinas" só para admin, como 3º botão do seletor que já existe (vale para o Dashboard inteiro e o Fechamento) |
| Campinas | Conta a partir do início da operação (06/10/2026); nos meses seguintes, desde o dia 1º |
| Excel | Botão "Baixar Excel", com 7 abas (inclui a lista de pedidos com o peso aplicado) |

## 3. Regra de cálculo

### 3.1 Linhas que entram
- Fonte: os mesmos registros que o Dashboard recebe (`producao_pedidos`, já sem as pessoas fora do
  Dashboard — `foraDoDashboard` — e já filtrados pela operação selecionada).
- Mês do pedido: **data de cadastro** no dia de São Paulo (`spParts(cadastro).date`). Vale a **etapa
  atual**.
- Peso por etapa (constante `PROJ_PESOS`, exclusiva desta aba):

| Etapa (texto exato do NeoCRM) | Faixa | Peso |
|---|---|---|
| `CONCLUIDO (NEOCRM)` | Concluído | 1 |
| `ENTREGA (NEOCRM)` | Entrega + Validação eSIM | 1 |
| `VALIDAÇÃO ESIM (NEOCRM)` | Entrega + Validação eSIM | 1 |
| `ANTIFRAUDE (NEOCRM)` | Antifraude | 0,5 |
| `BIOMETRIA (NEOCRM)` | Biometria | 0,5 |
| qualquer outra | — | 0 (a linha é ignorada) |

### 3.2 Receita e contratos
- **Receita ponderada** = Σ `valor × peso`, linha a linha.
- **Contrato** = `pedidoKey(r, idx, cnpjConvergenciaSet)` do Dashboard: `numero_pedido` distinto, e venda
  de convergência (banda larga + outro tipo do mesmo CNPJ no mesmo dia) vira 1 contrato, igual à Visão
  Diária (§16.13 e §16.15). O conjunto de convergência é calculado por dia de cadastro, só com as linhas de
  peso > 0.
- **Peso do contrato** = o maior peso entre as linhas dele (9 de 658 pedidos de set–out têm linhas em
  etapas diferentes).
- **Faixa principal do contrato** (para a quebra por etapa) = a faixa da linha de maior peso; empate na
  ordem Concluído > Entrega + Validação eSIM > Antifraude > Biometria. Assim a soma da quebra bate com o
  total.

### 3.3 Dias úteis, início da operação e "hoje"
- **Dia útil:** `!isWeekend(d) && !isHoliday(d)` (funções do Dashboard; incluem Carnaval, Sexta-feira
  Santa, Corpus Christi e 20/11).
- **Hoje:** o dia atual em São Paulo. As funções de cálculo recebem `hoje` como parâmetro (testável).
- **Início da operação:** `OPERACAO_INICIO = { campinas: '2026-10-06' }`. Os dias úteis de uma operação
  num mês vão de `max(1º do mês, início)` até o fim do mês. A Apex não tem data (sempre dia 1º). Mês
  anterior ao início da operação não aparece no seletor de mês para ela.
- **Dias úteis do mês (D)** e **dias úteis completos (Dc)** = dias úteis da operação no mês com data
  **< hoje**. **Restantes** = D − Dc (incluem hoje, se hoje for útil).
- **Realizado até ontem (R)** = receita ponderada das linhas com cadastro **< hoje** no mês. Venda feita
  em sábado, domingo ou feriado entra em R, mas não conta como dia.
- **Hoje (parcial)** = receita ponderada das linhas com cadastro = hoje. Não entra no ritmo.

### 3.4 Projeções (por operação)
- **Ritmo diário** = R ÷ Dc (e contratos ÷ Dc). Se Dc = 0 (1º dia útil do mês ou da operação), não há
  ritmo: os cards mostram "—" e o texto "a projeção começa no 2º dia útil".
- **Projeção mensal** = ritmo × D (= R + ritmo × restantes).
- **Projeção semanal** = realizado ponderado da semana até ontem + ritmo × dias úteis que faltam na semana
  (com hoje). Semana de segunda a domingo; no sábado e no domingo vale a semana seguinte (inteira projetada).
  Conta a semana inteira, mesmo que passe para o outro mês. Na segunda-feira é igual a ritmo × dias úteis da
  semana; no meio da semana bate com a linha "atual" da tabela "Semana a semana". (Ajuste confirmado pelo
  usuário na revisão do plano, 19/10/2026.)
- **Projeção diária** = o próprio ritmo.
- **Mês fechado** (mês anterior ao atual): Dc = D, então a projeção é igual ao realizado; selo "mês
  fechado", e o card da semana mostra "—".

### 3.5 "Apex + Campinas"
- Cada operação é calculada separadamente (com a própria data de início e o próprio ritmo) e o resultado é
  a **soma**: realizado, hoje, ritmo e projeções (outubro/2026: 12.391,37 + 4.358,41 = R$ 16.749,78).
- Os dias úteis mostrados no topo são os do calendário do mês (os da Apex).

### 3.6 Quebras
- **Por consultor** (`usuario`): contratos e receita até ontem, ritmo = receita ÷ Dc da operação dele,
  projeção do mês (R$ e contratos). Ordem: maior projeção primeiro. Lista completa, com rolagem própria.
  Limitação conhecida: quem entrou no meio do mês fica subestimado no 1º mês.
- **Por tipo de venda** (`grupo`): pedidos com ao menos 1 linha do tipo, receita até ontem, % do total e
  projeção do mês (receita ÷ Dc × D, por operação, somadas). Rótulo de `DIARIA_TIPOS_VENDA` quando existir,
  senão o próprio nome do grupo (grupo novo do NeoCRM aparece sozinho). A soma dos pedidos pode passar do
  total (um pedido pode ter Voz + SVA): a tela avisa.
- **Por etapa:** só a composição do realizado até ontem — contratos (faixa principal), valor bruto, peso,
  valor ponderado e % — sem projeção (a etapa de um pedido muda com o tempo).
- **Por operação** (só em "Apex + Campinas"): uma linha por operação com realizado, ritmo e projeções.

## 4. Tela (sub-aba "Projeção de Ganho")

- Botão da sub-aba criado só com `ADMIN_MODE` (admin/supervisor), como o de Pedidos em Alerta; para o
  consultor o botão não existe e o painel sai do DOM.
- A barra de filtros da esquerda do Dashboard fica escondida nesta aba (`body.tab-projecao .layout .panel`),
  como na Visão Diária e nos Pedidos em Alerta.
- De cima para baixo:
  1. Título "Projeção de Ganho · <Operação Apex | Operação Campinas | Apex + Campinas>", a linha
     "Ritmo = ponderado até ontem ÷ dias úteis completos · mês pela data de cadastro · atualizado às HH:MM",
     o **seletor de mês** (mês atual primeiro, depois os anteriores que têm dados) e o botão
     **"Baixar Excel"**.
  2. Selos da regra: Concluído 100% · Entrega + Validação eSIM 100% · Antifraude 50% · Biometria 50% ·
     Demais etapas 0% · Dias úteis: seg–sex, sem feriados nacionais.
  3. Quatro cards (R$ grande, contratos embaixo): **Projeção do mês** (destaque bordô), **Projeção da
     semana** (com as datas e os dias úteis), **Projeção diária** (por dia útil) e **Realizado ponderado**
     (até ontem, com "hoje (parcial)").
  4. Barra de progresso: "% da projeção do mês já realizado · Dc de D dias úteis completos · faltam N
     (com hoje)".
  5. **Dia a dia:** uma barra por dia útil do mês — realizado (cheia), hoje (hachurada), futuros
     (tracejada, na altura do ritmo) — com a linha do ritmo e os feriados de dia de semana marcados. Dia
     não útil só aparece se teve venda (barra estreita, rótulo "sáb"/"dom"/"feriado"), para o gráfico somar
     o realizado.
  6. **Semana a semana** (semanas seg–sex cortadas no mês: dias úteis, R$, contratos; semanas fechadas com
     o realizado, a atual e as futuras com ritmo × dias úteis, marcadas como projetadas; linha do mês) e
     **Por etapa**, lado a lado.
  7. **Por consultor** (com a coluna Operação em "Apex + Campinas").
  8. **Por tipo de venda**.
  9. **Por operação** (só em "Apex + Campinas").
- Clicar numa barra de dia, numa semana, numa linha de consultor, de tipo ou de etapa abre o analítico que
  já existe (`openDrilldown`) com os pedidos por trás do número.
- Cores só por variável do Dashboard: `--accent`, `--bordo`, `--ganho` (selo 100%) e `--andamento`
  (selo 50%). No celular: cards em 2 colunas, tabelas com rolagem horizontal.
- Atualização de 1 h: `window.atualizarDadosDashboard` redesenha também esta aba (mantendo o mês
  escolhido).

## 5. Excel

- Biblioteca: ExcelJS 4.4.0, carregada no clique por `carregarExcelJS()` (a mesma dos Pedidos em Alerta).
  Se falhar: "Não foi possível gerar o Excel agora — tente de novo".
- Arquivo: `ProjecaoGanho_<Apex|Campinas|ApexCampinas>_<AAAA-MM>.xlsx`, com a operação e o mês da tela.
- Abas:
  1. **Resumo:** título, operação, mês, data/hora da base, regra dos pesos, dias úteis (total, completos,
     restantes), os quatro cards (R$ e contratos) e, em "Apex + Campinas", uma linha por operação.
  2. **Dia a dia:** data, dia da semana, situação (realizado / hoje parcial / projetado / feriado), R$,
     contratos.
  3. **Semana a semana:** semana, dias úteis, situação, R$, contratos, linha do mês.
  4. **Por consultor** (com Operação em "Apex + Campinas").
  5. **Por tipo de venda.**
  6. **Por etapa.**
  7. **Pedidos:** uma linha por `numero_pedido` do mês com peso > 0 — nº, operação, consultor, tipo(s)
     (" + "), etapa(s), cadastro, valor bruto, peso, valor ponderado, cliente, CNPJ. (Só admin e supervisor
     baixam; eles já veem cliente/CNPJ no analítico e no Excel dos Pedidos em Alerta, §16.4.)
- Formato: linha 1 título, linha 2 operação/mês/base, cabeçalho congelado com filtro automático; R$ como
  moeda, datas reais do Excel, nº do pedido e CNPJ como texto; selo de peso colorido (100% verde de ganho,
  50% amarelo de andamento); linhas projetadas em itálico cinza.

## 6. Operação "Apex + Campinas" (painel de fora, `_template.html`)

- Seletor de operação do Dashboard e do Fechamento: 3º botão
  `<button class="filterPill" data-operacao="todas">Apex + Campinas</button>`, visível só para admin
  (como os outros dois). Continua abrindo sempre na Apex.
- `operacaoAtiva()` aceita `'todas'` para admin; `trocarOperacao('todas')` recarrega o Dashboard (e o
  Fechamento, se estiver na tela), como já faz com as outras.
- Com `'todas'`: `filtrarDashboardPedidos`, `filtrarDashboardEquipe`, `filtrarDashboardPerdidas` e o
  filtro do Fechamento deixam passar as duas operações (continuam tirando `foraDoDashboard` / excluídos).
  Todas as sub-abas do Dashboard e o Fechamento mostram as duas somadas.
- **Boletim da Manhã continua sempre Apex** (o código já volta o Dashboard para a Apex quando precisa,
  §78) — com `'todas'` ele também volta.
- Supervisor e consultor: nada muda (só a própria operação, sem seletor).
- Cada registro enviado ao Dashboard ganha o campo `operacao` (`operacaoDoVendedor(usuario)`), na carga e
  na atualização de 1 h. Conferir na implementação que nada no dashboard lista campos por `Object.keys`
  (analítico/exportações) — se listar, o campo novo é ignorado lá.
- Novo placeholder `__OPERACAO__` (`"apex" | "campinas" | "todas"`), substituído antes de `__DATA__`
  (como os de Vendas Perdidas) e incluído em `RUNTIME_PLACEHOLDERS` do `build_painel.py`.
- Limitação que continua (§78): a separação é só de exibição; o banco entrega a produção inteira a qualquer
  login.

## 7. Onde o código entra

- **Dashboard embutido** (editado com `python dashboard_tpl.py extrair` → `_dashboard_producao.html` →
  `python dashboard_tpl.py empacotar`):
  - constantes `PROJ_PESOS`, `PROJ_FAIXAS`, `OPERACAO_INICIO`, `OPERACAO_SELECIONADA = __OPERACAO__`;
  - funções puras (sem DOM): `projPeso(etapa)`, `projFaixa(etapa)`, `diasUteisPeriodo(de, ate)`,
    `projDiasOperacao(op, mes, hoje)`, `montarProjecao(dados, { mes, hoje, operacao })` → objeto com totais
    por operação e somados, dias, semanas, consultores, tipos e etapas;
  - tela: botão da sub-aba (só `ADMIN_MODE`), painel, `renderProjecao()`, CSS com escopo
    `body.tab-projecao`, cliques no `openDrilldown`;
  - Excel: `gerarExcelProjecao(ExcelJS, projecao, contexto)` (testável) + `exportarProjecaoExcel()`;
  - `atualizarDadosDashboard` chama `renderProjecao()` quando a aba existe.
- **`_template.html`** (fora do iframe): 3º botão nos dois seletores, `'todas'` em `operacaoAtiva`,
  `trocarOperacao` e nos filtros, campo `operacao` nos registros, `__OPERACAO__`.
- **`build_painel.py`:** `__OPERACAO__` em `RUNTIME_PLACEHOLDERS`.
- Não mexer: bloco `<style>` "Sinal de Ápice", menu lateral, cabeçalho de página, `ApexMotion`
  (`CLAUDE.md`).

## 8. Testes

- **`test_projecao_ganho.js`** (novo, dados fictícios, jsdom; escrito antes do código):
  - pesos e faixas (Validação eSIM na faixa Entrega; Território, Faturamento, Portabilidade em Andamento,
    Negociação etc. = 0);
  - dias úteis: 12/10 (outubro/2026 = 21), Carnaval, 20/11;
  - ritmo só com dias completos; "hoje (parcial)" fora do ritmo; venda de sábado entra no realizado sem
    contar dia;
  - semana no meio da semana, no sábado (semana seguinte) e virando o mês; tabela de semanas cortada no mês
    somando o mês;
  - 1º dia útil (sem ritmo, "—"); mês fechado (projeção = realizado);
  - Campinas com início 06/10 (outubro = 18 dias úteis) e "Apex + Campinas" = soma das duas;
  - contratos: pedido distinto, convergência = 1, maior peso entre as linhas, faixa principal;
  - quebras por consultor, tipo (grupo sem rótulo aparece pelo nome) e etapa, com os totais batendo;
  - tela: botão só com `ADMIN_MODE`; cards e tabelas renderizados; atualização de 1 h redesenha;
  - Excel: 7 abas, nome do arquivo, valores e formatos, relido com a ExcelJS do Node (como
    `test_pedidos_alerta.js`).
- **`test_operacao_campinas.js`** (atualizado): 3º botão só para admin; `'todas'` no Dashboard e no
  Fechamento; Boletim continua Apex; supervisor de Campinas só vê Campinas; registros com `operacao`.
- **Suíte inteira:** `bash run_tests.sh` sem falhas.
- **Conferência com dados reais:** os números da aba (outubro/2026, Apex, Campinas e as duas) comparados
  com uma consulta direta no Supabase.

## 9. Fora de escopo (YAGNI)

Pesos editáveis na tela; metas; cálculo de comissão; feriados estaduais e municipais; projeção hora a
hora; envio automático do Excel; ajuste para consultor que entrou no meio do mês; separação por operação no
banco (RLS — fase 2 da §78).

## 10. Entrega

- Branch `feat/projecao-ganho` no worktree `.worktrees/projecao-ganho`, a partir do `oficial/main`
  (`fa943c6`).
- `REGRAS_NEGOCIO.md`: nova **§101** e linha no changelog.
- Publicação só com o OK do usuário: baixar o painel no ar e comparar com a base (§45 — se houver algo
  publicado por fora, juntar, nunca sobrescrever; há outras sessões mexendo no `_template.html` em
  paralelo), backup no servidor, envio, conferência do MD5; depois commit e push (remoto a confirmar:
  `oficial` ou `origin`).
