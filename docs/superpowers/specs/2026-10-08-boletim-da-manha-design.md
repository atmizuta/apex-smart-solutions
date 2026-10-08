# Boletim da Manhã + Plano do dia com check

**Data:** 08/10/2026
**Responsável:** Rafael
**Branch:** `feat/boletim-manha` (worktree `.worktrees/boletim-manha`, base `oficial/main` 57327cb)
**Origem:** brainstorming de 08/10/2026 (conteúdo aprovado) + decisões desta sessão (seção 2)
**Status:** spec para revisão (nada construído)

## 1. Objetivo e critérios de sucesso

Dar à supervisora (Isabelly) um retrato do dia anterior que **diz o que fazer hoje**, e transformar isso numa lista de ações com check. Objetivo de fundo: produtividade e organização como caminho para retorno financeiro.

- **A. Boletim da Manhã:** página no painel, pronta às 10h de todo dia útil, com o resumo do período anterior, o plano de hoje e muitos elementos visuais. Botão "Baixar PDF" (~8 páginas).
- **B. Plano do dia com check:** as ações do boletim viram uma lista na Mesa do Supervisor. A supervisora (ou um admin) marca "Feito" ou "Não deu", com nota. O sistema confere sozinho o que der. O boletim seguinte abre com o resultado.

**Sucesso:**
- Todo dia útil, a partir das 10h, a Isabelly abre o painel e o boletim já está na tela.
- A página 1 se lê em 2 minutos: manchete, semáforo, plano e resultado do plano anterior.
- O PDF tem gráficos, semáforos, mapa de calor e minigráficos.
- Cada número bate com a aba correspondente do painel, com teste automatizado.
- O plano tem de 5 a 8 ações na página 1, cada uma com quem faz, o que fazer, R$ e prazo; dá para marcar na Mesa; o boletim seguinte mostra o resultado.
- Nada do que existe quebra: testes passando e design Sinal de Ápice respeitado.

## 2. Decisões tomadas

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Como a Isabelly recebe | **Só no painel.** Abre sozinho no 1º acesso do dia, com "Baixar PDF". E-mail, WhatsApp e robô das 10h ficam para depois (seção 12). |
| 2 | Quem vê | **Admin e supervisor** veem (mesmas pessoas da Mesa). **Abre sozinho só para a Isabelly**, nos dois perfis dela; a lista fica em `config.boletim.abre_sozinho`. |
| 3 | Dias | **Só em dia útil** (seg–sex, sem feriado nacional, igual a `ppDiaUtil`). Cobre do último dia útil anterior a hoje até ontem. |
| 4 | Expediente (relógio do lead) | **Seg–sex 11:00–21:00. Sábado não tem expediente.** |
| 5 | Hora | **10h.** O retrato e o plano são gravados na 1ª abertura depois das 10h e não mudam mais no dia. |
| 6 | Limites | Pedido grande **R$ 150/mês**; queda **30%**; ritmo mínimo **50%**; zerado **2 dias úteis**; **8 ações** na página 1. Todos em `config.boletim`. |
| 7 | "Vendas de ontem" | **Mesma regra da Visão Diária** (data de cadastro; sem AGUARDANDO INTERACAO e PROPOSTA). |
| 8 | Dado de cliente | **Tela:** nome e CNPJ, como nas abas. **PDF:** só número do pedido e consultor. |
| 9 | Histórico | Retrato do dia + ações guardados por **12 meses**; boletim antigo reabre igual e baixa o PDF de novo. |
| 10 | Quem marca | **Isabelly e admins** marcam (registra quem e quando). **Consultor não vê** nada nesta versão. |
| — | Abordagem | **O boletim usa as abas como fonte** (seção 4). Contas do dashboard ficam numa função única `resumoDiaria`. |
| (i) | Hora da venda | A hora passa a vir da **entrada na sincronização** (`criado_em`) no boletim, no gráfico por hora da Visão Diária e no corte do relatório das 17h. |
| (ii) | Entregas | **3 fases**, cada uma publicada com OK (seção 14). |

## 3. Base empírica (Supabase `apex`, leitura em 08/10/2026)

| Fato | Número / consequência |
|---|---|
| Perfis da Isabelly | Usa o **admin "Isabelly"** (último login por senha 06/10). O supervisor "Isa" não entra desde 03/08. O boletim **não** pode achar a Isabelly pelo papel `supervisor`. |
| Guilherme | Admin, **nunca entrou** no painel. Com "só no painel", só vê o boletim se começar a entrar. |
| Sábado | 4 pedidos num único sábado em 8 semanas; 1 sábado com 10 ligações manuais em 4 semanas. |
| Ligações manuais | 1ª ligação do dia por volta de 11h (mediana); o grosso das 14h às 21h. A discadora não entra. |
| Hora do cadastro | A API do NeoSales manda `dataCadastro` **sem hora** (`dd/mm/aaaa`). No banco, todo `cadastro` fica 00:00 em São Paulo. Hoje o gráfico por hora da Visão Diária põe tudo às 00h e o corte das 17h não corta nada. |
| Hora de entrada (`criado_em`) | De 01 a 08/10, **134 de 134** pedidos entraram na sincronização no mesmo dia do cadastro. Atraso máximo ~1 h (sync no minuto 59; de 10 em 10 min entre 20:30 e 21:30). |
| Valor por pedido | Mediana R$ 55–60/mês; p90 R$ 120–145. Na esteira hoje, ≥ R$ 150: 12 pedidos (6%), R$ 5,3 mil (30% do valor). |
| Relógio do lead | `config.velocidade_lead` = seg–sex 08–18, sábado 08–12. `vlExpediente` já aceita `sabado: null` (sem expediente) sem mudar código. |

Os números de calibração do brainstorming (seção 10 do handoff de 08/10) servem para conferir os cálculos na implementação. Os testes usam só dados fictícios.

## 4. Arquitetura

### 4.1 Princípio
Cada número do boletim vem da **mesma função** que a aba correspondente usa. Onde a conta só existe no dashboard (iframe em base64), o dashboard passa a expor essa conta numa função única, usada também pela própria aba. Lição da 16.17: dois caminhos calculando o mesmo número divergem.

### 4.2 Peças (no `_template.html`, prefixo `bm`)
| Peça | O que faz | Depende de |
|---|---|---|
| `bmPeriodo(hoje)` | Dia útil? Período coberto `{de, ate, dias[]}`; edição (`normal`, `segunda`, `inicio_mes`). | `ppDiaUtil`, `ppFeriados`, `somaDiasStr` |
| `bmCarregar(ctx)` | Busca os dados (seção 4.4). Cada fonte falha sozinha (`ppSeguro`). | `fetchAllRows`, RPCs |
| `bmMontar(dados, ctx)` | **Função pura.** Devolve o **retrato** (seção 4.5). | funções das abas |
| `bmAcoes(retrato, dados, cfg)` | **Função pura.** As 12 regras → ações (seção 8). | |
| `bmConferir(acoesAbertas, dados, ctx)` | **Função pura.** Diz quais ações se resolveram sozinhas e o R$ recuperado. | |
| `bmTela(retrato)` | Desenha a página "Boletim da Manhã" a partir do retrato. | classes do painel, Chart.js |
| `bmPdf(retrato)` | Gera o PDF a partir do retrato (seção 9.2). | jsPDF 2.5.1, Chart.js |
| `bmGarantirDoDia()` | Orquestra: período, regra das 10h, espera da sincronização, gravação "primeiro ganha" (seção 6). | as peças acima |
| `bmPlanoCard()` | Card "Plano do dia" na Mesa: lista, marcar, desfazer (seção 8.4). | RPCs da seção 5 |
| `bmObterResumoDiaria()` | **Costura** com o dashboard: devolve `producaoFrame.contentWindow.resumoDiaria`, carregando o dashboard se preciso. Os testes trocam esta função. | `loadProducaoDashboard` |

Tela e PDF desenham **só** a partir do retrato: um boletim antigo reabre exatamente como foi. O retrato tem `versao`; o desenho tolera bloco ausente ("não disponível nesta edição"), para os retratos da Fase 1 continuarem abrindo depois das Fases 2 e 3.

### 4.3 `resumoDiaria(dia, opcoes)` no dashboard (fonte única das contas da Visão Diária)
- Nova função no template do dashboard (`_dashboard_producao.html`, via `python dashboard_tpl.py extrair`/`empacotar`), exposta em `window.resumoDiaria`, no mesmo padrão de `window.atualizarDadosDashboard`.
- Entrada: `dia` (`AAAA-MM-DD`), `opcoes.corteHora` (opcional).
- Filtro das linhas (o mesmo de hoje): `spParts(r.cadastro).date === dia` e etapa fora de `VISAO_DIARIA_ETAPAS_EXCLUIDAS`.
- Saída: `{ contratos, linhas, valor, ticket, porTipo[], porConsultor[], porHora[24], semHora, rows }`:
  - `contratos` por `pedidoKey` com `cnpjsComConvergencia` (16.15); `linhas` = soma das quantidades dos grupos `VOZ - *`; `valor` = soma; `ticket` = valor ÷ contratos;
  - `porTipo` pela lista `DIARIA_TIPOS_VENDA` (mesma contagem dos cards "Por tipo de venda");
  - `porConsultor` pela lógica de `agruparDiariaPor` (ranking da Visão Diária);
  - `porHora` pela **hora de entrada na sincronização**: `spParts(r.criado_em).hour`, só quando o dia de `criado_em` em SP é o próprio `dia`. Linha sem `criado_em` válido ou de outro dia entra no total e em `semHora`, fora do gráfico.
- `corteHora` (relatório das 17h): conta só as linhas com hora de entrada `< corteHora`. Linha sem hora conhecida continua contando (comportamento de hoje).
- Passam a usar `resumoDiaria`: `renderVisaoDiaria()` (cards, por hora, ranking, tipos), `dadosRelatorioDia()` (17h) e o boletim. Resultado visível: o gráfico por hora volta a ter barras ao longo do dia, e o relatório das 17h passa a cortar de verdade às 17h.
- `loadProducaoDashboard()` e a atualização de 1 h passam a pedir também a coluna `criado_em` de `producao_pedidos`.

### 4.4 Fontes de dados do boletim
| Fonte | Para quê | Observação |
|---|---|---|
| `resumoDiaria` (dashboard) | Vendas do período, mix, por hora, ranking, zerados, mapa de calor, tendência | 1 chamada por dia (≈ 30 por boletim) |
| RPC nova `boletim_pedidos()` | Linhas de pedido de **todos** os consultores, com `na_etapa_desde` | Mesmo formato de `producao_meus_pedidos` (+ `usuario_id`, `criado_em`); abertos + fechados dos últimos 120 dias; paginada com `fetchAllRows` e `ORDER BY numero_pedido, item_id` |
| `ppAgruparPedidos`, `ppClassificarFila`, `ppResumoFila`, `ppNivel`, `ppAgenda`, `ppRecuperaveis`, `ppDevolvidos` | Esteira, níveis, bola, agenda, recuperáveis, devolvidos | as mesmas do Pedidos Parados (53.3) |
| `filtrarRegistrosFechamento`, `agruparFechamentoPorConsultor`, `ppPlacar` | Ativações, realizado do mês, ritmo, previsão | regra do Fechamento (16.14) e do Meu Placar (53.5) |
| `metas_consultor`, `consultor_neo`, `equipe_vendedores()` | Metas, vínculo perfil × NeoCRM, lista da equipe | `filtrarProducaoEquipe` aplicado |
| `vendas_perdidas(p_de, p_ate)` | Perdas por categoria e consultor | só admin/supervisor (70) |
| `producao_etapa_historico` | Fluxo por etapa e tempo médio em cada etapa | só admin/supervisor lê |
| `mesa_leads_relogio`, `mesa_pendencias`, `mesaKpis`, `mesaNoPrazo`, `mesaMediana`, `vl*` | Leads, velocidade, sem dono, esfriando, retornos de lead | as mesmas da Mesa (68) |
| `ligacoes_manuais`, `monitor_ligacoes_por_usuario` | Ligações por consultor e por hora | só manuais (59, 67) |
| `mesa_retornos_objecoes`, `agenda_retornos`, `objecoes_uso` | Retornos e objeções | 72 |
| `propostas`, `consultas_log`, `caderno_notas`, `agenda_retornos` | Uso das ferramentas | só contagens |
| `producao_sync_log`, `ligacoes_sync_log`, `exportacao_sync_log`, `config` (`leads_sync_erro`, `producao_neo_atualizado_em`) | Saúde dos dados | |

- **Pessoas fora da Apex:** toda linha de produção passa por `filtrarProducaoPedidos`; listas de equipe por `filtrarProducaoEquipe` (16.18–16.20, 75).
- **Identidade do consultor:** a chave é o usuário do NeoCRM (`usuario_id`), exibido pelo nome do NeoCRM. Liga ao perfil por `consultor_neo`, à telefonia e à planilha de leads por `leads_equipe`. Quem não tem vínculo aparece pelo nome do NeoCRM e entra nas pendências do rodapé.
- **Fuso:** toda data em São Paulo, com os helpers que já existem (`hojeSP`, `leadDateSP`, `vlPartesSP`, `spParts`).

### 4.5 Retrato (JSON guardado em `boletim_retratos.retrato`)
```
{ versao, dia, periodo: {de, ate, dias[]}, edicao, gerado_em, gerado_por_nome,
  cfg,                       // limites usados naquele dia
  manchete: [3 frases], semaforo: [6 sinais], plano: [ids e textos das ações],
  resultado_anterior: {...},
  blocos: { vendas, mes, pessoas, esteira, perdas, leads, ligacoes, retornos },  // Fases 2 e 3
  saude: {...}, limites: [textos] }
```
- Itens de pedido guardam `numero`, `consultor`, `etapa`, `valor`, `dias` e, para a tela, `cliente` e `cnpj`. O PDF ignora `cliente` e `cnpj` (seção 9.2).
- Tamanho esperado: ~50 KB/dia.

## 5. Banco (migration aditiva `supabase/migrations/20261008100000_boletim_manha.sql`, rollback em `supabase/rollback/`, verificação em `supabase/tests/boletim_manha_check.sql`)

Nada do que o painel usa hoje muda de assinatura. Toda RPC: `security definer`, `set search_path = public`, `revoke` de `public, anon`, `grant` para `authenticated`, e erro `42501` se `get_my_role()` não for `admin`/`supervisor`.

### 5.1 `boletim_retratos`
| Coluna | Tipo | Observação |
|---|---|---|
| `dia` | `date` PK | dia do boletim (SP) |
| `periodo_de`, `periodo_ate` | `date not null` | período coberto |
| `retrato` | `jsonb not null` | seção 4.5 |
| `gerado_em` | `timestamptz not null default now()` | |
| `gerado_por` | `uuid not null` | `auth.uid()` |

### 5.2 `boletim_acoes`
| Coluna | Tipo | Observação |
|---|---|---|
| `id` | `bigint generated always as identity` PK | |
| `dia` | `date not null` → `boletim_retratos(dia)` `on delete cascade` | |
| `ordem` | `int not null` | posição no plano (1 = maior R$) |
| `regra` | `text not null` | uma das 12 (seção 8.1) |
| `chave` | `text not null` | pedido, consultor, CNPJ ou `leads-noite` |
| `quem` | `text not null` | nome de quem faz |
| `o_que` | `text not null` | texto da ação |
| `valor` | `numeric not null default 0` | R$ em jogo |
| `prazo` | `text not null` | "hoje", "até 11h" |
| `dias_seguidos` | `int not null default 1` | "2º dia", "3º dia" |
| `status` | `text not null default 'aberta'` check in (`aberta`, `feita`, `nao_deu`) | marcação manual |
| `nota` | `text` | |
| `marcado_por`, `marcado_em` | `uuid`, `timestamptz` | |
| `resolvida_em` | `timestamptz` | conferência automática |
| `desfecho` | `text` | ex.: `avancou`, `concluiu`, `perdeu`, `vendeu`, `atribuido` |
| `valor_recuperado` | `numeric not null default 0` | |

- Única: `(dia, regra, chave)`.
- RLS ligado nas duas tabelas: **select** para admin/supervisor; **nenhuma** escrita direta (só pelas RPCs).

### 5.3 RPCs
1. **`boletim_gravar(p_dia date, p_de date, p_ate date, p_retrato jsonb, p_acoes jsonb) returns jsonb`**
   - Recusa se `p_dia` não for hoje em SP, se hoje não for dia útil ou se agora (SP) for antes de `config.boletim.hora`.
   - `insert … on conflict (dia) do nothing`. As ações só são gravadas se o retrato foi gravado **por esta chamada** (mesma transação).
   - Devolve o retrato vencedor e suas ações. Se outra pessoa gravou antes, o navegador mostra o dela ("primeiro ganha").
2. **`boletim_marcar_acao(p_id bigint, p_status text, p_nota text) returns void`**
   - `p_status` em `feita`, `nao_deu` ou `aberta` (desfazer). Grava `marcado_por = auth.uid()` e `marcado_em = now()`.
   - Só ações do retrato mais recente podem ser marcadas.
3. **`boletim_resolver_acoes(p_itens jsonb) returns void`**
   - Lista de `{id, desfecho, valor_recuperado}`. Só preenche ações com `resolvida_em` nulo.
4. **`boletim_pedidos() returns table(...)`**
   - Mesmas colunas de `producao_meus_pedidos` + `usuario_id`, `criado_em`, `item_id`, para todos os usuários; abertos + fechados com `coalesce(atualizacao, cadastro)` nos últimos 120 dias.
   - `na_etapa_desde` vem de uma **função SQL nova `producao_na_etapa_desde(numero_pedido, etapa, atualizacao)`** com a expressão atual. `producao_meus_pedidos` e `mesa_pendencias` passam a chamá-la (mesmo resultado, comparado no teste SQL), para a regra existir num lugar só.

### 5.4 Retenção
- pg_cron `boletim-retencao`, todo dia às 03:30 SP: apaga retratos (e, em cascata, ações) com `dia` anterior a 12 meses.

### 5.5 Configuração
- **`config.boletim`** (JSON), criado pela migration com a lista `abre_sozinho` vazia:
  `{"hora":"10:00","pedido_grande":150,"queda_alerta":0.30,"ritmo_minimo":0.50,"ritmo_desde_dia_util":5,"dias_zerado":2,"dias_parado":2,"max_acoes_pagina1":8,"abre_sozinho":[],"retencao_meses":12}`
  - Os dois perfis da Isabelly entram em `abre_sozinho` por uma escrita separada em produção (com OK), fora do repositório.
- **`config.velocidade_lead`**: `{"seg_sex":["11:00","21:00"],"sabado":null,"verde_min":5,"amarelo_min":15,"janela_dias":7}`.
  - O padrão `VL_CFG_PADRAO` no código passa a ter o mesmo valor.
  - Efeito imediato na Mesa: o lead que chega entre 18h e 21h deixa de aparecer como "aguardando abertura"; o lead de sábado começa a contar na segunda às 11h.

## 6. O dia do boletim

### 6.1 Período e edição
- **Dia útil** = `ppDiaUtil` (seg–sex, sem feriado nacional de `ppFeriados`).
- **Período** = do último dia útil anterior a hoje até ontem.
  - Terça comum: só segunda.
  - Segunda: sexta, sábado e domingo.
  - Terça 13/10/2026 (depois do feriado de 12/10): sexta 09/10 a segunda 12/10.
- Nos textos: "Ontem (qua, 07/10)" para um dia; "De sexta (09/10) a segunda (12/10)" para vários.
- **Referência das comparações:**
  - média por dia útil dos **20 dias úteis anteriores** ao período (o período inteiro conta como um dia útil, porque fim de semana e feriado quase não têm venda);
  - **mesmo período da semana passada** (as mesmas datas menos 7 dias).
- **Edição:** `segunda` (toda segunda útil ou 1º dia útil da semana) e `inicio_mes` (1º dia útil do mês). Conteúdo extra na seção 7.4 (Fase 3).

### 6.2 Geração (regra das 10h)
- Só em dia útil e a partir de `config.boletim.hora` (10:00 SP).
- **Quem dispara:** a primeira abertura da aba "Boletim da Manhã" por admin ou supervisor. A Mesa não dispara (carregar tudo pesa); o card do plano mostra o botão "Abrir o Boletim de hoje".
- **Espera da sincronização:** só gera se a última sincronização ok da produção (`producao_sync_log`) terminou depois de **09:55 de hoje**. Senão mostra "Aguardando a sincronização das 9h59", tenta de novo a cada 1 min e, às **10:15**, gera assim mesmo, com o aviso "gerado sem a sincronização das 9h59" no rodapé.
- **Passos:** `bmCarregar` → `bmConferir` (ações do plano anterior) → `boletim_resolver_acoes` → `bmMontar` → `bmAcoes` → `boletim_gravar`. Se outra pessoa gravou primeiro, mostra o dela.
- **Antes das 10h, ou em sábado, domingo e feriado:** mostra o último retrato com o aviso "O boletim de hoje sai às 10h" (ou "Hoje não tem boletim: não é dia útil").
- **Boletins anteriores:** seletor com os retratos guardados (mais recente primeiro). Reabrir e "Baixar PDF" funcionam para qualquer um.

### 6.3 Quem vê e abertura automática
- Botão novo no menu, grupo **Visão geral**, logo depois da Mesa: `<button data-tab="boletim" id="tabBtnBoletim" style="display:none" data-sub="O dia em 2 minutos e o plano com check">`, com ícone SVG no padrão (`.sbLabel` "Boletim da Manhã").
- Visível se `producaoAdminMode()`. Para o consultor: botão escondido, painel vazio (`bmResetar()`), nada é carregado. A proteção real é a RLS e as RPCs (`42501`).
- **Abre sozinho** para quem está em `config.boletim.abre_sozinho`: no 1º acesso do dia a partir das 10h, o painel vai direto para a aba "Boletim da Manhã" (uma vez por dia; marca em `localStorage`, com `try/catch` — sem armazenamento, abre uma vez por sessão).
- Se essa pessoa já está com o painel aberto quando dão 10h, aparece `mostrarAviso('Boletim da Manhã pronto', 'info')` com o atalho, sem trocar de aba à força.

## 7. Conteúdo (definições)

Princípios aprovados: a página 1 resolve o dia em 2 minutos; todo número vem com comparação; todo bloco termina em ação. A fase de cada item está entre colchetes.

### 7.1 Página 1 [Fase 1]
**Manchete (3 frases, por modelo fixo, sem IA):**
1. Período: "Ontem (qua, 07/10): 24 contratos, R$ 2,3 mil — 12% acima da média de 20 dias úteis."
2. Mês: "Outubro: R$ 6,1 mil de R$ 15,5 mil (39%) com 35% do mês útil decorrido; previsão R$ 16,2 mil." (time inteiro via `ppPlacar`; sem meta, a frase omite a meta).
3. Maior risco: a ação nº 1 do plano em uma frase. Sem ações: "Sem risco grande hoje."

**Semáforo (6 sinais).** Regra única, com `q = config.boletim.queda_alerta` (0,30):
- "Maior é melhor": verde ≥ 100% da referência; amarelo ≥ (1 − q); vermelho abaixo.
- "Menor é melhor": verde ≤ 100%; amarelo ≤ (1 + q); vermelho acima.

| Sinal | Medida | Referência | Sentido |
|---|---|---|---|
| Vendas do período | valor total (`resumoDiaria`) | média por dia útil, 20 dias úteis | maior |
| Ritmo da meta | % da meta ÷ % do mês útil decorrido (time) | 100% | maior |
| Esteira parada | R$ em nível MÉDIO + MÁXIMO (6+ dias úteis na etapa) | o mesmo número no retrato anterior | menor |
| Perdas | R$ perdido no período (`vendas_perdidas`) | média por dia útil, 20 dias úteis | menor |
| Velocidade do lead | % dos leads do período atendidos em até `amarelo_min` (`mesaNoPrazo`) | média dos 20 dias úteis anteriores | maior |
| Ligações | ligações manuais do período (equipe) | média por dia útil, 20 dias úteis | maior |

- Sem referência (ex.: primeiro boletim, para a esteira): cinza "sem base".
- Cada sinal mostra o número, a referência e a seta (↑/↓).

**Plano do dia:** as 8 primeiras ações (seção 8), com quem faz, o que fazer, R$ e prazo. As demais vão para o anexo (última página do PDF e "ver todas" na tela).

**Resultado do plano anterior:** "Plano de qua, 07/10: 6 de 8 ações concluídas (4 feitas + 2 resolvidas sozinhas), R$ 1,4 mil recuperados." Abaixo, as marcadas "não deu", com a nota, e as que ficaram sem marcação.

### 7.2 Blocos de consulta [Fase 2]
**Bloco 1 — Vendas do período**
- Contratos, linhas, valor total e ticket médio (rótulos da Visão Diária), contra a média de 20 dias úteis e o mesmo período da semana passada.
- Mix por tipo de venda (`DIARIA_TIPOS_VENDA`), com o que subiu ou caiu contra a média.
- Vendas por hora (hora de entrada na sincronização; nota "precisão de até 1 h").
- Ranking do período (`porConsultor`), com a posição de antes (↑/↓) contra o dia útil anterior.
- Quem zerou e há quantos dias úteis está sem contrato (contando para trás até 20 dias úteis).

**Bloco 2 — Mês e meta**
- Meta da equipe (soma de `metas_consultor`), realizado (ativações pela regra do Fechamento), % atingido contra % do mês útil decorrido.
- Previsão de fechamento (`ppPlacar`: receita + aberto × taxa de conclusão; "—" com menos de 10 fechados).
- Falta por dia útil para a meta e quanto se ativou no período.
- Tabela por consultor: meta, realizado, %, falta por dia útil, previsão.
- Comparação com o mesmo ponto do mês passado (mesmo nº de dias úteis decorridos, pela regra do Fechamento).
- Calendário: dias úteis restantes (`ppDiasUteisNoMes`) e próximo feriado (`ppFeriados`).
- Nota fixa: "realizado = ativação (regra do Fechamento e do Meu Placar); vendas = cadastro (regra da Visão Diária)". A coluna "Vendas no mês / meta" da Mesa usa cadastro (`mesa_vendas_mes`), por isso não é comparável com este bloco.

**Bloco 3 — Pessoas**
- Destaques, com mensagem pronta para o grupo:
  - maior contrato do período;
  - maior R$ do período;
  - melhor conversão: contratos ÷ ligações atendidas no período, só com telefonia ligada e 20+ atendidas;
  - lead mais rápido: menor mediana até o 1º contato, com 3+ leads no período.
- Atenção:
  - zerou `dias_zerado`+ dias úteis seguidos;
  - caiu `queda_alerta` ou mais contra a própria média (valor do período × média por dia útil de 20 dias úteis);
  - perde ou devolve muito: R$ perdido + devolvido em 20 dias úteis acima de (1 + q) × a mediana da equipe;
  - ligou pouco: ligações do período abaixo de (1 − q) × a média da equipe (só com telefonia ligada).
- Mapa de calor consultor × dia (contratos, 10 dias úteis).
- Funil por consultor no período: ligações, atendidas, conversas acima de 1 min (`seg_falados > 60`), contratos, ativações. Sem telefonia ligada: "—".
- Tendência de 4 semanas (contratos por semana completa) — minigráfico.

**Bloco 4 — Esteira e dinheiro em risco**
- Estoque por etapa de `PP_ETAPAS` (`ppResumoFila.porEtapa`: pedidos e R$) e fluxo do período (entradas e saídas por etapa, de `producao_etapa_historico`).
- Pedidos que pioraram de nível: `ppClassificarFila` com referência hoje contra referência `periodo.de` (mesma comparação da regra 2 do plano).
- Top 10 em risco por R$: consultor, etapa, dias úteis parado, "com quem está a bola".
- Lista VIP: pedidos abertos (qualquer etapa aberta) com valor ≥ `pedido_grande`.
- Ativações do período (`filtrarRegistrosFechamento` com de/até = período).
- Agenda de hoje (`ppAgenda`): portabilidades e instalações de hoje e datas vencidas.
- Tempo médio em cada etapa: dias úteis entre entrar e sair, saídas dos últimos 30 dias (aviso: "histórico desde 30/09").
- Conflito: CNPJ com pedido aberto de dois ou mais consultores.
- Nota: a esteira segue a regra do Pedidos Parados e da Mesa (8 etapas + Território, dias desde a entrada na etapa). O "Pedidos em Alerta" do dashboard usa outra régua (4 etapas, desde a última atualização) e não é comparável.

### 7.3 Blocos de consulta [Fase 3]
**Bloco 5 — Perdas e devoluções**
- Perdas do período por categoria do NEO e por consultor (`vendas_perdidas`). Em destaque, as evitáveis: erro de cadastro, duplicidade, CNPJ inapto, inviabilidade técnica, desistência por demora (constante `BM_PERDAS_EVITAVEIS` com os nomes exatos das categorias, conferidos no banco na implementação).
- Recuperáveis do período (`ppRecuperaveis`: lead quente e crédito aprovado).
- Devolvidos do período (`ppDevolvidos`).
- Motivo que mais cresce: participação nos últimos 7 dias contra 30 dias.
- Quem não preenche o motivo: perdas sem categoria por consultor (30 dias).

**Bloco 6 — Leads**
- Leads do período por campanha e por hora de chegada.
- Por consultor: % no prazo (`mesaNoPrazo`) e mediana até o 1º contato (`mesaMediana`).
- Sem contato, sem dono e esfriando (5+ dias, como `mesa_pendencias`).
- Leads da noite esperando agora (chegaram depois das 21h do último dia útil).
- Recebidos × convertidos por consultor (mês) e conversão por campanha (30 dias).

**Bloco 7 — Ligações**
- Por consultor no período: ligações, atendidas, tempo falado, 1ª e última ligação, maior intervalo sem ligar dentro do expediente.
- Taxa de atendimento por hora (últimos 14 dias, 11h–21h): melhor horário para ligar.

**Bloco 8 — Retornos, objeções e uso**
- Retornos de hoje e atrasados por consultor; % cumpridos no período (`agenda_retornos`, mesmas regras de `mesa_retornos_objecoes`).
- Objeções mais ouvidas no período (`objecoes_uso`): tema para um treino rápido.
- Uso das ferramentas no período, só com o que já é registrado: propostas criadas, buscas na base, notas no Caderno, retornos marcados.

### 7.4 Edições especiais [Fase 3]
- **Segunda-feira:** além do período (sexta a domingo), o resumo da semana anterior (seg–sex): contratos, valor, ativações, ranking da semana.
- **1º dia útil do mês:** fechamento do mês anterior por consultor (meta, realizado, %), pela regra do Fechamento.

### 7.5 Rodapé — saúde dos dados [básico na Fase 1, completo na Fase 3]
- Última sincronização ok de cada fonte e falhas nas últimas 24 h: produção (`producao_sync_log`), leads (`config.leads_sync_erro` e a última entrada de lead), ligações (`ligacoes_sync_log`), exportação Xeotech (`exportacao_sync_log`).
- Pendências de cadastro: consultor sem vínculo no NeoCRM (`consultor_neo`), sem meta no mês, sem usuário de telefonia em `leads_equipe`.
- Limites dos dados (seção 11), em texto fixo.

## 8. Plano do dia (B)

### 8.1 As 12 regras
`d` = dias úteis na etapa (`ppClassificarFila`, referência = hoje). Pedido = linhas agrupadas por `ppAgruparPedidos`. "Supervisão" é um texto fixo: a ação é da supervisora ou do admin que estiver com o plano.

| # | Regra (`regra`) | Quando entra | Quem faz | O que fazer | R$ em jogo | Prazo | Resolve sozinha quando |
|---|---|---|---|---|---|---|---|
| 1 | `pedido_grande_parado` | pedido na esteira com valor ≥ `pedido_grande` e `d` ≥ `dias_parado` | consultor (bola com o cliente) ou Supervisão (operadora, back office, entrega) | "Acionar o cliente" / "Cobrar o back office": pedido, etapa, `d` | valor do pedido | hoje | o pedido saiu da etapa |
| 2 | `pedido_vermelho` | nível MÁXIMO com referência hoje, e menor com referência `periodo.de` | Supervisão | "Cobrar <consultor>: pedido chegou a 10 dias úteis em <etapa>" | valor | hoje | saiu da etapa |
| 3 | `cliente_parado` | BIOMETRIA ou AGUARDANDO ASSINATURA com `d` ≥ `dias_parado` | consultor | "Reenviar a mensagem ao cliente" | valor | hoje | saiu da etapa |
| 4 | `data_vencida` | `ppAgenda(...).atrasados` (data de portabilidade/instalação passou, pedido aberto) | consultor | "Confirmar a nova data com o cliente ou o back office" | valor | hoje | a data passou a hoje ou futuro, ou o pedido avançou/fechou |
| 5 | `consultor_zerado` | 0 contratos nos `dias_zerado` últimos dias úteis até ontem (`resumoDiaria`) | Supervisão | "Conversa individual hoje com <consultor>: N dias úteis sem venda" | média diária de R$ do consultor (20 dias úteis) × N | hoje | o consultor cadastrou contrato no dia do plano |
| 6 | `consultor_ritmo` | a partir do `ritmo_desde_dia_util`º dia útil do mês, com meta: % da meta ÷ % do mês útil < `ritmo_minimo` (`ppPlacar`) | Supervisão | "Plano de recuperação com <consultor>: X% da meta com Y% do mês; faltam R$ Z" | falta por dia útil | hoje | não resolve sozinha (é plano) |
| 7 | `lead_noite` | leads que chegaram depois das 21h do último dia útil e estão sem dono ou sem contato (`vlEsperando`) — **uma ação só** | Supervisão | "Distribuir agora: N sem dono, M sem contato" | nº de leads distintos da ação × receita média por lead (30 dias: soma de `leads.receita` ÷ leads recebidos) | até 11h | todos com dono e contato |
| 8 | `perda_recuperavel` | perdido **no período** com `#HOTLEAD` ou `#COMCREDITO` (`ppRecuperaveis`) | consultor | "Reatacar: lead quente / crédito aprovado" | valor | hoje | o CNPJ abriu pedido novo (R$ = valor do novo) |
| 9 | `perda_sem_motivo` | perdas do período com categoria vazia em `vendas_perdidas` — **uma ação por consultor** | Supervisão | "Cobrar <consultor>: N perdas sem motivo no NEO" | soma dessas perdas | hoje | todas ganharam categoria (R$ recuperado 0) |
| 10 | `cnpj_conflito` | CNPJ com pedido aberto de 2+ consultores | Supervisão | "Decidir o dono: pedido A (<consultor>) × pedido B (<consultor>)" | soma dos pedidos | hoje | sobrou um consultor só |
| 11 | `retorno_atrasado` | retornos atrasados (`agenda_retornos` e `leads_followups`) — **uma ação por consultor** | Supervisão | "Cobrar <consultor>: N retornos atrasados" | 0 | hoje | o consultor zerou os atrasados |
| 12 | `destaque` | destaques do período (Bloco 3; na Fase 1, só maior contrato e maior R$) | Supervisão | "Parabenizar no grupo", com a mensagem pronta | 0 | hoje | não resolve sozinha |

- **Um pedido, uma ação:** se um pedido cai em várias regras, fica só a primeira desta ordem: 4, 1, 2, 3, 8.
- **Ordem do plano:** R$ em jogo, do maior para o menor; empate pela ordem da tabela. R$ 0 vai para o fim.
- **Página 1:** as `max_acoes_pagina1` primeiras (8). O resto vai para o anexo.
- **Dias seguidos:** se a mesma `(regra, chave)` estava no plano anterior e continua valendo, entra com `dias_seguidos + 1` ("2º dia").
- **Textos:** nomes de consultor pelo nome do NeoCRM; pedido pelo número. Nome de cliente só na tela.

### 8.2 Conferência automática
- Roda ao gerar o boletim do dia, sobre as ações do plano anterior com `resolvida_em` nulo (`bmConferir` → `boletim_resolver_acoes`).
- Para regras de pedido, o `desfecho` diz o que aconteceu: `avancou`, `concluiu` ou `perdeu`. `valor_recuperado` = valor do pedido se avançou ou concluiu; 0 se perdeu ou foi devolvido.
- Outras: `vendeu` (regra 5, R$ = valor cadastrado no dia), `atribuido` (regra 7, R$ 0), `reaberto` (regra 8, R$ = valor do pedido novo).
- Uma ação marcada "Feito" também é conferida: se resolver, ganha `resolvida_em` e o R$ recuperado.

### 8.3 Resultado no boletim seguinte
- **Concluídas** = marcadas "Feito" + resolvidas sozinhas sem marcação.
- Frase: "Plano de <dia>: X de Y ações concluídas (A feitas + B resolvidas sozinhas), R$ W recuperados."
- Lista as "Não deu" (com nota) e as sem marcação.

### 8.4 Card "Plano do dia" na Mesa
- No topo da Mesa (admin e supervisor), com as ações do retrato mais recente e a data dele ("Plano de hoje" ou "Plano de qua, 07/10 — o de hoje sai às 10h").
- Cada linha: ordem, quem faz, o que fazer, R$, prazo, "2º dia" quando houver, situação.
- Botões **Feito** e **Não deu**: abrem uma janela no padrão do painel (overlay + `fecharOverlay`) com campo de nota opcional e "Salvar". Depois de salvar, a linha mostra "Feito por <nome> às HH:MM" e o botão **Desfazer**.
- Otimista: a linha muda na hora; se a RPC falhar, volta e aparece `mostrarAviso('Não foi possível salvar — tente de novo', 'erro')`.
- Ação resolvida sozinha aparece com o selo "resolvida".
- Depois das 10h, sem plano do dia: botão "Abrir o Boletim de hoje".

## 9. Tela e PDF

### 9.1 Tela
- Aba "Boletim da Manhã": barra com o dia, o período, o seletor de boletins anteriores e "Baixar PDF".
- Página 1 no topo; blocos abaixo (Fases 2 e 3), cada um com título, números com comparação e a linha "Ação" no fim.
- Só classes e variáveis do Sinal de Ápice (`.card`, `.kpiGrid`, `table.tbl`, `.filterPills`, tokens de cor). Gráficos com Chart.js 4.5.0.
- Cliente e CNPJ aparecem nas listas de pedido (admin/supervisor), como nas abas.
- Cada bloco carrega e falha sozinho ("não foi possível carregar este bloco").

### 9.2 PDF
- jsPDF 2.5.1, A4 retrato, nome `BoletimDaManha_AAAA-MM-DD.pdf`.
- Página 1 com layout fixo: manchete, semáforo (6 círculos), plano (até 8 linhas) e resultado anterior.
- Gráficos do Chart.js renderizados num canvas fora da tela e inseridos como imagem. Semáforos, mapa de calor e minigráficos desenhados com primitivas do jsPDF (nítidos em qualquer zoom).
- **Sem nome de cliente e sem CNPJ:** pedido pelo número e consultor; conflito de CNPJ aparece como "pedido A × pedido B".
- Cores literais no gerador do PDF (exceção já aceita para geradores de PDF no `test_redesign_shell.js`; a função nova entra na lista).
- Rodapé de cada página: "Boletim da Manhã — <dia> — página N de M — gerado às HH:MM".
- Fase 1: página 1 + anexo das ações. Fases 2 e 3: uma ou duas páginas por bloco (~8 no total).

## 10. Permissões e privacidade
- Admin e supervisor: veem o boletim e o plano, marcam ações.
- Consultor: não vê o botão, o painel fica vazio, e RLS + RPCs recusam (`42501`).
- Cliente e CNPJ: na tela (16.4) e no retrato guardado (tabela só para admin/supervisor); **nunca** no PDF.
- Repositório público: testes com dados fictícios; os IDs dos perfis da Isabelly não entram no repositório.

## 11. Limites dos dados (registrados e avisados no rodapé)
1. **Relógio do lead:** corrigido por esta entrega (seção 5.5). Leads antigos que chegaram entre 18h e 21h passam a contar pelo expediente novo.
2. **Ligações:** só as manuais do ProContact (equipe AQUISIÇÃO - CLARO); a discadora fica de fora. Só 8 dos 19 usuários de telefonia estão ligados a um perfil em `leads_equipe`: os outros aparecem com "—".
3. **Tempo por etapa:** o histórico começou em 30/09; a média só fica confiável depois de algumas semanas.
4. **Caderno, Agenda e Objeções:** saíram em 07/10; o bloco 8 começa quase vazio.
5. **Hora da venda:** é a hora em que o pedido entrou na sincronização, com até 1 h de atraso.
6. **Valores:** R$ do pedido é mensalidade (R$/mês, 53.3).

## 12. Fora do escopo
- Envio sozinho às 10h (robô com Playwright, e-mail, WhatsApp). O desenho deixa isso como acréscimo: um robô só precisaria abrir a aba depois das 10h.
- Consultor ver as próprias ações; fila "Próxima ação" do consultor.
- Alarmes em tempo real, ficha de 1:1 semanal, carteira de renovação, checklist antes do cadastro, régua da biometria, termômetro de uso com rastreamento novo, funil automático.
- Mudanças no "Pedidos em Alerta" do dashboard.

## 13. Testes (TDD; padrão jsdom do repositório; dados fictícios)
- **`test_boletim_manha.js`** (Fase 1):
  - `bmPeriodo`: terça comum, segunda, terça depois de feriado, sábado/domingo/feriado sem boletim.
  - Regra das 10h, espera da sincronização (antes de 09:55, depois, e o corte das 10:15), "primeiro ganha".
  - Abertura automática só para quem está em `abre_sozinho`; aviso às 10h sem trocar de aba; sem `localStorage` não quebra.
  - Semáforo: as duas direções, fronteiras de 70%/100%/130%, "sem base".
  - Manchete: os três modelos, período de um e de vários dias, sem meta, sem ações.
  - Cada uma das 12 regras (entra e não entra), "um pedido, uma ação", ordem por R$, limite de 8, "2º dia".
  - `bmConferir`: cada desfecho e o R$ recuperado; ação "Feito" que também se resolve.
  - Card da Mesa: marcar, desfazer, falha da RPC volta a linha.
  - Um bloco que falha não derruba os outros; consultor não vê nada nem chama RPC.
  - PDF (jsPDF simulado): número de páginas, textos da página 1, e **nenhum nome de cliente ou CNPJ** do cenário no PDF.
- **Paridade (os números batem com as abas):**
  - `resumoDiaria` rodando no jsdom do dashboard × cards da Visão Diária renderizados, no mesmo cenário (contratos com convergência, linhas, valor, tipos, ranking, por hora).
  - Esteira do boletim × `ppResumoFila` (Pedidos Parados); mês × `ppPlacar`; leads × `mesaKpis`.
- **Ajustes de testes existentes:** `test_visao_diaria.js` e `test_relatorio_17h.js` passam a usar `criado_em` para a hora (corte às 17h pela hora de entrada; linha sem hora conta como hoje).
- **SQL:** `supabase/tests/boletim_manha_check.sql`, em transação com `rollback`. Simula admin, supervisor, consultor e anon:
  - RLS das duas tabelas; RPCs com `42501` para consultor;
  - `boletim_gravar`: recusa antes das 10h, fora de dia útil e dia diferente de hoje; "primeiro ganha";
  - `boletim_marcar_acao`: status válidos, só o plano mais recente;
  - `boletim_resolver_acoes` não sobrescreve;
  - `producao_na_etapa_desde` dá o mesmo resultado da expressão antiga em `producao_meus_pedidos` e `mesa_pendencias`.
- **Regressão:** `bash run_tests.sh` completo. Falhas antigas conhecidas: `test_conversao_vendas.js` (horário) e `test_pedidos_alerta.js` (`exceljs`).
- **Fases 2 e 3:** testes por bloco, no mesmo arquivo ou em `test_boletim_blocos.js`.

## 14. Entregas, autorizações e riscos

**Fases (cada uma: plano próprio, TDD, revisão única no fim, publicação com OK):**
1. **Fundação + página 1 + Plano do dia com check:** migration (tabelas, RPCs, `producao_na_etapa_desde`, cron de retenção), `config.boletim`, `config.velocidade_lead`, `resumoDiaria` (com a correção da hora na Visão Diária e no 17h), aba "Boletim da Manhã" com a página 1, as 12 regras, conferência automática, card na Mesa, PDF da página 1 + anexo, rodapé básico.
2. **Blocos 1 a 4** (vendas, mês e meta, pessoas, esteira), na tela e no PDF.
3. **Blocos 5 a 8, rodapé completo e edições especiais** (segunda e 1º dia útil do mês).

**Autorizações:**
- Escritas em produção no Supabase `apex` (migration, `config.boletim`, perfis em `abre_sozinho`, `config.velocidade_lead`, cron): **só com OK explícito do Rafael**, antes de publicar o painel. Sem a migration, a aba mostra "não foi possível carregar" e o resto não quebra.
- Publicar o painel **só com OK do Rafael naquele momento**: `git fetch oficial` e merge; baixar o painel no ar e comparar (juntar, nunca sobrescrever); backup, MD5 e vigia.
- Registrar no `REGRAS_NEGOCIO.md` com o próximo número livre na hora (em 08/10 era a §76).

**Riscos:**
- **(a) Carga do dashboard.** Gerar o boletim carrega o dashboard (~12 mil linhas). Mitigação: reaproveitar o iframe já carregado e mostrar "Montando o boletim…"; acontece uma vez por dia.
- **(b) Conflito com outras sessões** no `_template.html` e na linha base64 do dashboard. Mitigação: worktree, `git fetch oficial` antes de merge/push, receita de merge da linha base64 (CLAUDE.md), push sem force.
- **(c) Limites mal calibrados.** Todos em `config.boletim`, ajustáveis sem publicar.
- **(d) Sincronização atrasada às 10h.** Espera até 10:15 e avisa no rodapé (seção 6.2).
- **(e) Isabelly com dois perfis.** Os dois entram em `abre_sozinho`; marcar ação funciona com qualquer um (registra qual).
- **(f) Mudança visível no relatório das 17h.** Passa a cortar de verdade às 17h; registrar na seção do REGRAS e avisar o Guilherme.
