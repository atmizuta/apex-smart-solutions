# Boletim da Manhã — Fase 1 (plano)

**Spec:** `docs/superpowers/specs/2026-10-08-boletim-da-manha-design.md` (seções 4–9 e 13–14).
**Branch:** `feat/boletim-manha` (worktree `.worktrees/boletim-manha`, base `oficial/main` 57327cb).
**Execução:** inline, sem subagentes (preferência do Rafael, 07/10); TDD por tarefa; uma revisão no fim; publicar com o OK já dado ("quando terminar já publica").
**Seção do REGRAS:** §76.

Testes com dados fictícios. Rodar `bash run_tests.sh <arquivo>` na tarefa e `bash run_tests.sh` completo no fim
(falhas antigas conhecidas: `test_conversao_vendas.js` por horário, `test_pedidos_alerta.js` por `exceljs`).

## Tarefa 1 — Banco (migration aditiva)
Arquivos: `supabase/migrations/20261008100000_boletim_manha.sql`, `supabase/rollback/20261008100000_boletim_manha_rollback.sql`,
`supabase/tests/boletim_manha_check.sql`.
- `producao_na_etapa_desde(numero, etapa, atualizacao)` (SQL, stable) com a expressão de hoje; `producao_meus_pedidos` e
  `mesa_pendencias` recriadas chamando-a (corpo idêntico no resto).
- `boletim_dia_util(date)` (seg–sex sem feriado nacional, mesma lista de `ppFeriados`, Páscoa calculada).
- Tabelas `boletim_retratos` e `boletim_acoes` (spec 5.1/5.2 + coluna `extra jsonb` com o que a conferência precisa:
  número do pedido, etapa, CNPJ, chaves dos leads, ids de retorno). RLS: select admin/supervisor; sem escrita direta.
- RPCs `boletim_gravar`, `boletim_marcar_acao`, `boletim_resolver_acoes`, `boletim_pedidos` (spec 5.3), todas
  `security definer`, `42501` fora de admin/supervisor, `revoke` de `public, anon`.
- `config.boletim` (insert se não existir) e `config.velocidade_lead` = seg–sex 11–21, sábado null.
- pg_cron `boletim-retencao` 06:30 UTC (03:30 SP).
- Teste SQL em transação com rollback: papéis, recusas do `boletim_gravar`, "primeiro ganha", marcar só o plano
  mais recente, resolver não sobrescreve, `producao_na_etapa_desde` = expressão antiga.

## Tarefa 2 — `resumoDiaria` no dashboard (fonte única da Visão Diária)
Arquivos: `_dashboard_producao.html` (extrair/empacotar), `_template.html` (colunas), `test_visao_diaria.js`,
`test_relatorio_17h.js`.
- `resumoDiaria(dia, {corteHora})` → `{contratos, linhas, valor, ticket, porTipo, porConsultor, porContrato, porHora[24], semHora, rows}`;
  hora = `criado_em` em SP quando é do próprio dia; senão `semHora`. `window.resumoDiaria`.
- `renderVisaoDiaria` (cards, por hora, clique da hora) e `dadosRelatorioDia` passam a usar `resumoDiaria`.
- `loadProducaoDashboard` e a atualização de 1 h pedem `criado_em`.
- Testes: fixtures ganham `criado_em` = `cadastro`; casos novos (cadastro 00:00 + entrada 18:00 fica fora do 17h e cai
  na barra das 18h; sem `criado_em` conta e vai para `semHora`); paridade `resumoDiaria` × cards.

## Tarefa 3 — Funções puras do boletim (`bm*`, `_template.html`)
Teste: `test_boletim_manha.js` (novo).
- `bmPeriodo(hoje)`, `bmDiasUteisAntes(dia, n)`, `bmRotuloPeriodo`.
- `bmCor(valor, ref, sentido, q)` e `bmSemaforo(med)` (6 sinais, "sem base").
- `bmManchete(...)` (3 frases; um dia × vários; sem meta; sem ações).
- `bmAcoes(ctx)` — as 12 regras, "um pedido, uma ação" (4, 1, 2, 3, 8), ordem por R$ e pela tabela, `dias_seguidos`.
- `bmConferir(acoes, ctx)` — desfechos e R$ recuperado.
- `bmResultadoAnterior(acoes)`.

## Tarefa 4 — Carga, montagem e geração do dia
- `bmCarregar(ctx)` (fontes isoladas com `ppSeguro`), `bmObterResumoDiaria()` (costura com o iframe),
  `bmMontar(dados, ctx)` (retrato), `bmGarantirDoDia()` (10h, espera da sync até 10:15, primeiro ganha).
- Testes com Supabase simulado: antes das 10h mostra o último; sem sync às 10:05 espera; às 10:16 gera com aviso;
  gravação devolve o vencedor; consultor não chama RPC.

## Tarefa 5 — Aba "Boletim da Manhã" (tela) e abertura automática
- Botão no grupo Visão geral depois da Mesa, `panel-boletim`, barra (dia, período, seletor, Baixar PDF),
  página 1 (manchete, semáforo, plano + "ver todas", resultado anterior, rodapé básico).
- `bmAoEntrar()`: abre sozinho para `config.boletim.abre_sozinho` (1×/dia, `localStorage` com try/catch);
  aviso às 10h sem trocar de aba.

## Tarefa 6 — Card "Plano do dia" na Mesa
- Lista do retrato mais recente, Feito / Não deu (janela com nota), Desfazer, otimista com volta em falha, selo
  "resolvida", botão "Abrir o Boletim de hoje".

## Tarefa 7 — PDF (página 1 + anexo)
- `bmPdf(retrato)` com jsPDF; semáforo desenhado; sem cliente e sem CNPJ; rodapé "página N de M"; exceção de cor
  literal no `test_redesign_shell.js`.

## Tarefa 8 — Fechamento
- `bash run_tests.sh` completo; revisão única do diff; `REGRAS_NEGOCIO.md` §76.
- Publicar: migration + teste SQL em produção; perfis da Isabelly em `abre_sozinho` (fora do repo); `git fetch oficial`,
  merge, comparar com o painel no ar, backup, MD5, vigia; push sem force.
