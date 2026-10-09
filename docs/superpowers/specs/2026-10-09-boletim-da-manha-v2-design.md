# Boletim da Manhã v2 — resumo do dia anterior

**Data:** 09/10/2026 · **Responsável:** Rafael · **Branch:** `feat/boletim-manha` (worktree `.worktrees/boletim-manha`)
**Substitui** o conteúdo da fase 1 (§76, spec `2026-10-08-boletim-da-manha-design.md`). Caminho aprovado: **A** — aproveita a aba, a regra das 10h, o "primeiro ganha", o histórico (`boletim_retratos`) e a `resumoDiaria`; mudam conteúdo, tela e PDF.
**Status:** spec para revisão.

## 1. Por que mudou
O boletim da fase 1 saiu com 93 ações, quase todas de pedidos parados há semanas. O pedido do Rafael (09/10): **um resumo do dia anterior** — ligações, vendas, quem vendeu mais e quem vendeu menos, leads, perdas — no visual da Apex, que a supervisão leia em poucos minutos. A prévia com os dados de 08/10 foi aprovada ("ficou realmente MUITO melhor").

## 2. Decisões
| # | Decisão |
|---|---|
| 1 | Sai a lista de ações (plano com check) **de vez**: sai o card "Plano do dia" da Mesa e a tabela `boletim_acoes`. |
| 2 | **Rafael Santiago e Isabelly** saem do **Dashboard de Produção e do boletim** (vendas, ranking, equipe, ligações, leads). **O Fechamento continua igual** (comissão). |
| 3 | O boletim que está no ar fica até o novo ficar pronto. Na publicação, o boletim de 09/10 (formato antigo) é apagado para o novo ser gerado no lugar. |
| 4 | Blocos escolhidos além da prévia: ritmo por hora, velocidade dos leads, funil por consultor, meta do mês por consultor, últimos 5 dias por consultor, perdas evitáveis × não evitáveis. Ficaram de fora: esteira de ontem e uso das ferramentas. |
| 5 | Lead sem contato: mostrar as duas contas — **planilha** (status "sem contato") e **sistema** (sem ligação manual nem clique no painel). |
| 6 | Mostrar de quem são as vendas perdidas e os leads sem contato, e o vendedor com a maior conversão de leads do dia. |
| 7 | PDF com até **4 páginas**. Visual da prévia aprovada (Sinal de Ápice: bordô/vermelho, Barlow, logos Apex e Claro). |

## 3. Período
Igual à fase 1: do último dia útil antes de hoje até ontem (terça = segunda; segunda = sexta a domingo; depois de feriado, desde o último dia útil). Rótulo: "Resumo de quinta-feira, 08/10/2026" ou "Resumo de sexta (09/10) a domingo (11/10)". Comparações contra a **média por dia útil dos 20 dias úteis anteriores**.

## 4. Conteúdo (tela na ordem; PDF uma página por bloco)

### Página 1 — Resumo
- **Cabeçalho:** faixa bordô→vermelho com os logos Apex e Claro empresas, "BOLETIM DA MANHÃ", rótulo do período.
- **Resumo em 3 linhas** (modelo fixo): (1) vendas e valor × média; (2) quem mais vendeu e quantos da equipe não venderam; (3) ligações × média e leads recebidos, com quantos sem contato.
- **6 números:** vendas (contratos), valor vendido, linhas móveis (+ ticket médio), ligações (+ atendidas e %), leads recebidos (+ quantos viraram venda), vendas perdidas (+ R$). ▲/▼ e % contra a média quando há referência.
- **Atenção hoje:** até 3 frases, todas sobre o período (seção 5). Sem check.
- **Mês até ontem:** vendido no mês (cadastro, mesma conta da Visão Diária) × soma das metas, com a marca da parte do mês útil já decorrida.

### Página 2 — Vendas
- **Ranking do período:** todos que venderam, do maior para o menor R$, com vendas e linhas; ouro/prata/bronze nos 3 primeiros. "Quem menos vendeu" = o último do ranking.
- **Não venderam:** equipe ativa (vendeu ao menos uma vez nos 20 dias úteis anteriores) que não vendeu no período.
- **O que foi vendido:** contagem por tipo (mesmos cards da Visão Diária).
- **Últimos 5 dias úteis:** mapa de calor consultor × dia (vendas), equipe ativa.
- **Meta do mês por consultor:** vendido no mês × meta (`metas_consultor`), % da meta e a marca do mês decorrido; sem meta = "sem meta".

### Página 3 — Ligações
- **Funil por consultor:** ligações → atendidas → conversas de mais de 1 min (`seg_falados > 60`) → vendas; vendas por 100 ligações; 1ª e última ligação. Consultor sem login de telefonia ligado = "—".
- **Ritmo por hora (8h–21h):** barras de ligações por hora e de vendas por hora (hora de entrada na sincronização). Destaca as horas do expediente (11h–21h) com menos de 20% da média por hora.

### Página 4 — Leads e perdas
- **Leads do período por consultor:** recebidos, viraram venda, % de conversão, mediana de minutos úteis até o 1º contato (relógio do lead, 11h–21h), sem contato (planilha) e sem contato (sistema).
- **Destaque:** maior conversão do dia (mínimo de 3 leads recebidos; empate → mais vendas, depois menor tempo até o 1º contato).
- **Leads sem contato:** lista com consultor e o nome do lead (**só na tela**; o PDF traz só a contagem por consultor).
- **Vendas perdidas:** total e R$; por consultor (quantas, R$, motivos); por motivo, agrupado em **evitáveis**, **não evitáveis** e **sem motivo** (seção 6).

### Rodapé (tela e última página do PDF)
Última sincronização ok de produção, leads e ligações; "gerado sem a sincronização das 9h59" quando for o caso; logins de telefonia e nomes de planilha sem vínculo; limites dos dados (ligações só manuais; hora da venda = entrada na sincronização; R$ = mensalidade).

## 5. "Atenção hoje" (no máximo 3, nesta ordem de prioridade)
1. **Leads sem contato** (planilha ou sistema) no período: "N leads de ontem ainda sem contato — X (a), Y (b)".
2. **Horas paradas:** horas do expediente com menos de 20% da média por hora de ligações: "Quase ninguém ligou das 11h às 14h (22 ligações)".
3. **Quem não vendeu e ligou pouco:** equipe ativa sem venda no período e com ligações abaixo da metade da média da equipe: "Conversar com X e Y: não venderam e ligaram pouco".
4. **Ligações ou valor vendido 30% ou mais abaixo da média.**
5. **Perdas evitáveis** no período: "N vendas perdidas evitáveis (R$ W)".
Sem nenhum caso: "Nada fora do normal ontem."

## 6. Perdas: evitável × não evitável
Classificação inicial em `config.boletim.perdas` (ajustável sem publicar):
- **Evitáveis:** Desistência Demora, Desistência Biometria, Não responde, Erro de Cadastro, Duplicidade, Desconfiança, CNPJ Inapto, Portabilidade em Andamento, Troca de Território.
- **Não evitáveis:** Restrição de Crédito, Fibra - Inviabilidade Técnica, Retenção (Concorrência), Multa Concorrência.
- **Sem motivo:** categoria vazia. Motivo novo, fora das duas listas: entra como "outros" (não evitável) e aparece no rodapé.

## 7. Pessoas, nomes e vínculos
- **Nome exibido:** o do NeoCRM (ex.: "Yasmin Silva", em caixa de título).
- **Fora:** `PRODUCAO_USUARIOS_EXCLUIDOS` (seção 75) + uma lista nova `PRODUCAO_FORA_DO_DASHBOARD` com `RAFAEL SANTIAGO ANGELÃO` e `ISABELLY FONSECA BATISTA DA SILVA`. A lista nova vale para o Dashboard (carga inicial, atualização de 1 h, equipe do Cadastro Diário) e para o boletim; **não** vale para o Fechamento.
- **Telefonia → consultor:** mapa `config.boletim.telefonia` (login do ProContact → nome do NeoCRM), preenchido direto no banco, fora do repositório. Login de pessoa fora do painel fica fora; login sem vínculo aparece pelo próprio login e entra no rodapé.
- **Planilha de leads → consultor:** mapa `config.boletim.planilha` (nome da coluna CONSULTOR → nome do NeoCRM), mesma regra.

## 8. Arquitetura
- **Fica:** aba "Boletim da Manhã" (admin/supervisor), regra das 10h e espera da sincronização (até 10:15), "primeiro ganha", seletor de boletins anteriores, abertura automática (`abre_sozinho`), recarga dos pedidos do dashboard antes de contar, não gravar quando faltar fonte essencial (vendas, ligações, leads).
- **Sai:** `bmAcoes`, `bmConferir`, `bmResultadoAnterior`, card "Plano do dia" da Mesa e a janela de nota.
- **Funções novas (puras, testáveis):** `bmMontarV2(dados, ctx)` → retrato v2; uma função por bloco (`bmRanking`, `bmFunil`, `bmPorHora`, `bmLeads`, `bmPerdas`, `bmMetaMes`, `bmCalor`, `bmAtencao`, `bmResumo`); `bmTelaV2(retrato)`; `bmPdfV2(retrato)`.
- **Fontes:** `resumoDiaria` (dashboard) por dia: período, 20 dias úteis de referência, dias do mês até ontem e 5 últimos dias úteis; `ligacoes_manuais` lida direto (admin/supervisor já leem pela RLS), só o período e a contagem dos 20 dias úteis; `mesa_leads_relogio` (contato e minutos úteis) + `leads` (categoria e nome); `vendas_perdidas` do período; `metas_consultor`, `consultor_neo`, `equipe_vendedores`; logs de sincronização.
- **Retrato v2** (`versao: 2`) guarda os blocos prontos (números, listas, mapa de calor, horas); tela e PDF desenham só a partir dele. Um retrato v1 que ainda exista mostra "formato antigo — não disponível".
- **Banco (migration aditiva + limpeza):** `boletim_gravar(p_dia, p_de, p_ate, p_retrato)` (sem ações); `boletim_obter` sem `acoes`; remove `boletim_acoes`, `boletim_marcar_acao`, `boletim_resolver_acoes`. Rollback volta as definições da fase 1 (sem dados de ação).
- **CSS:** bloco novo `.bm*` na seção 6 (telas) do `<style>`, só com variáveis (`var(--c-sinal)` etc.), sem mexer nas seções existentes.

## 9. PDF (até 4 páginas)
jsPDF, A4 retrato, `BoletimDaManha_AAAA-MM-DD.pdf`. Página 1 = resumo; 2 = vendas; 3 = ligações; 4 = leads e perdas (+ rodapé dos dados). Cabeçalho em todas as páginas com os logos e a faixa vermelha; barras, mapa de calor e semáforos desenhados com primitivas (nítidos). **Sem nome de cliente, de lead nem CNPJ.** Rodapé de página: "Boletim da Manhã — dd/mm/aaaa — página N de 4".

## 10. Testes (dados fictícios)
- Cada bloco puro: ranking e "não venderam" (equipe ativa), funil (com e sem login ligado), por hora (horas paradas), leads (conversão, destaque com mínimo de 3, duas contas de sem contato, minutos úteis), perdas (evitável/não evitável/sem motivo/outros), meta do mês, mapa de calor, atenção (prioridade e limite de 3), resumo (frases).
- Exclusões: Rafael e Isabelly fora do Dashboard e do boletim, **presentes no Fechamento**; pessoas de `PRODUCAO_USUARIOS_EXCLUIDOS` fora de tudo como antes.
- Geração: regra das 10h, espera da sync, primeiro ganha, fonte essencial faltando não grava.
- Tela: blocos renderizados; retrato v1 mostra "formato antigo".
- PDF: 4 páginas, textos de cada página, nenhum nome de cliente/lead nem CNPJ.
- Mesa: o card "Plano do dia" não existe mais.
- SQL: `boletim_gravar` sem ações (hora, dia útil, primeiro ganha, permissões); tabelas/RPCs de ação removidas.
- Regressão: `bash run_tests.sh` completo.

## 11. Publicação (só com o ok do Rafael)
Migration v2 + teste SQL em partes (com rollback); `config.boletim.telefonia`, `.planilha` e `.perdas` escritos no banco; apagar o retrato de 09/10 (v1); `git fetch oficial`, comparar o painel no ar, backup, MD5, vigia; `REGRAS_NEGOCIO.md` §77.
