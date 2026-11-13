# Redesign da aba Renovação, "Central do dia" (§151) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a tela da aba Renovação por "Hoje · Carteira · Funil · Resumo · Proposta e fatura", com a Central do dia como tela inicial, sem mudar regras nem dados (só a coluna `retorno_hora`).

**Architecture:** Dentro do bloco JS `RENOVAÇÃO — §143` do `_template.html`, as funções de dados e regras ficam; as de tela (marcação do `#panel-renovacao`, CSS `.rn*`, `rnRender*`, `rnRenderFicha`, listeners da Carteira) são substituídas. A ficha (`#rnFicha`) é a mesma em toda a aba: inline na Central (`.noPainel`) e gaveta nas outras subabas. Banco: `renovacao_carteira.retorno_hora` e a view `renovacao_resumo` com atraso por hora.

**Tech Stack:** HTML/CSS/JS puro no `_template.html`; Supabase/Postgres; testes jsdom com `renovacao_test_harness.js`; testes SQL `supabase/tests/*_check.sql` (ROLLBACK).

**Spec:** `docs/superpowers/specs/2026-11-13-renovacao-redesign-design.md` (mockups em `docs/superpowers/specs/assets/2026-11-13-renovacao-redesign-*.html`)

## Global Constraints

- Repositório público: testes só com dados fictícios `Zz…`, CNPJs `000000000004xx`.
- Supabase `mdgfboijyqfkggcrhptn` é produção: DDL só com ok do Rafael (Task 7); antes, `begin … rollback`. Sem DROP; `execute_sql` begin/commit.
- Só `_template.html` (o painel é gerado por `python build_painel.py`). Arquivos em LF.
- Visual: mesma linguagem do §126 (tokens `--ml-*`); cor só por variável; hex novo só na declaração de token (`--rn-st1`, `--rn-st3`, `--rn-st4` e fundos); vermelho só no botão principal e no atrasado (cor + ⏱ + texto); verde só para hoje/renovado.
- Subabas, nesta ordem: `hoje` "Hoje" · `carteira` "Carteira" · `kanban` "Funil" · `resumo` "Resumo" · `proposta` "Proposta e fatura". Tela inicial: `hoje`.
- Etapas (texto em frase normal): 1 Não contatado · 2 Tentativa · 3 Contato efetivo · 4 Proposta enviada · 5 Em negociação · 6 Renovado · 7 Perdido.
- "Atrasado" = `prox_retorno` antes de hoje (SP) **ou** hoje com `retorno_hora` já passada; status ≠ 6/7.
- Fila da Central: Atrasados (mais antigo primeiro) → Hoje (por hora; sem hora no fim) → Sugeridos (10 maiores, `apto = 'APTO'`, status 1, na base, sem retorno atrasado/hoje).
- "Como foi o contato?": Não atendeu=2 · Falei com o responsável=3 · Mandei proposta=4 · Negociando=5 · Renovou ✓=6 · Perdido=7.
- Carteira: 50 por página; nada editável na linha; visões Todos · Não contatados · Em andamento · Atrasados · Pendências · Renovados · Perdidos · Fora da base.
- Gestor: um seletor só de consultor ("Time todo" / "Sem consultor" / cada consultor), no topo da aba, valendo para Hoje, Carteira e Funil (a spec cita o seletor na Central e o consultor em "Mais filtros": é o mesmo filtro, então fica num lugar só).
- Último contato: apertar um botão de "Como foi o contato?" e salvar grava `data_contato` = hoje (o gatilho do banco só preenche quando está vazio).
- `<div>`/`</div>` balanceados.

## Review Focus

1. **Gestor com "Time todo" e depois um consultor:** a fila, os cartões, a Carteira e o Funil passam a mostrar só aquele consultor. Teste na Task 3.
2. **Cliente salvo com retorno no futuro na Central:** sai da fila e "Salvar e próximo" abre o seguinte, sem pular nem repetir. Teste na Task 4.
3. **Retorno de hoje sem hora:** é "Hoje", nunca "Atrasado", até virar o dia. Teste na Task 2.
4. **Trocar de subaba com a ficha aberta:** na Carteira a gaveta fecha; voltar para Hoje mostra a ficha inline do mesmo cliente. Teste na Task 3.
5. **Mudar o botão de contato e voltar antes de salvar:** nada grava; o texto digitado na observação não se perde. Teste na Task 4.

---

## Mapa: o que fica e o que muda no bloco §143

| Fica (dados/regras) | Substituído (tela) | Removido |
|---|---|---|
| `rnGestor`, `rnPodeVer`, `rnSoRenovacao`, `rnStatus`, `rnHoje`, `rnNomeConsultor`, `rnCarregar`, `rnNorm`, `rnStatusRotulo`, `rnClasseLinha`, `rnValidarFechamento`, `rnMensagemErro`, `rnSalvar`, `rnOpcoes`, `rnAbrirFechamento`, `rnRedistribuir`, `RN_GRUPOS_FICHA`, `rnGruposFicha`, `rnHistoricoTexto`, `rnAbrirFicha`, `rnFecharFicha`, `rnSomarDias`, `rnLinhasResumo`, importação inteira, propostas (`rnClienteDaCarteira`, `rnGerarProposta`, `rnCarregarPropostas`, `rnPropostasDe`, `rnPropostaGerada`), `RN_KANBAN`, `rnDiasNoStatus`, `rnKanbanColunas`, `rnMoverStatus`, listeners do Kanban, `rnMoverProposta`, `rnAbrirNaRenovacao` | marcação do painel, CSS `.rn*`, `rnAplicarPermissao`, `rnTrocarAba`, `rnRender`, `rnAtualizarBadge`, `rnRetornoVencido`, `rnFiltrar`, `rnPreencherFiltros`, `rnLinhaHtml`, `rnRenderCarteira`, listeners da Carteira, `rnRenderFicha` e o submit da ficha, `rnCartaoHtml`, `rnRenderKanban`, `rnRenderResumo` | `rnContadores`, `rnRetornos`, `rnRenderRetornos` e o listener de `#rnRetornos`, edição na linha (selects/data na tabela e o `focusout`) |

Testes antigos: `test_renovacao_carteira.js` e `test_renovacao_resumo.js` são **apagados** (testavam a edição na linha e a subaba Retornos) e substituídos por `test_renovacao_carteira2.js` e `test_renovacao_resumo2.js`. Ajustes pontuais em `test_renovacao_correcoes.js`, `test_renovacao_correcoes2.js`, `test_renovacao_ficha.js`, `test_renovacao_kanban.js` e `test_renovacao_subaba_proposta.js` estão escritos nas tasks.

---

### Task 1: Banco: hora do retorno

**Files:**
- Create: `supabase/migrations/20261113150000_renovacao_retorno_hora.sql`
- Create: `supabase/tests/renovacao_retorno_hora_check.sql`

**Interfaces:**
- Produces: `renovacao_carteira.retorno_hora time` (nulo, gravável pelo consultor); `renovacao_resumo.retornos_atrasados` com atraso por hora.

- [ ] **Step 1: Teste SQL**

Criar `supabase/tests/renovacao_retorno_hora_check.sql`:

```sql
-- Verificação da migration 20261113150000 (§151). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f641', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r5a@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f641', 'Zzr5a Teste', 'zz.r5a', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id, status, prox_retorno) values
('00000000000401', 'Zz Quatro Um',   '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date),
('00000000000402', 'Zz Quatro Dois', '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date),
('00000000000403', 'Zz Quatro Tres', '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date - 1);

do $$
declare n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f641', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f641', true);
  -- consultor grava a hora (é campo de atendimento)
  update public.renovacao_carteira set retorno_hora = '00:00' where cnpj_digits = '00000000000401';
  update public.renovacao_carteira set retorno_hora = '23:59:59' where cnpj_digits = '00000000000402';
  get diagnostics n = row_count;
  assert n = 1, 'consultor grava retorno_hora';
  -- hoje 00:00 já passou → atrasado; hoje 23:59:59 ainda não; ontem sem hora → atrasado
  select retornos_atrasados into n from public.renovacao_resumo where consultor_id = '00000000-0000-0000-0000-00000000f641';
  assert n = 2, 'atrasados com hora: 401 (00:00) e 403 (ontem), veio ' || n;
  execute 'reset role';
end $$;

rollback;
```

- [ ] **Step 2: Ver falhar.** `execute_sql` com o arquivo. Expected: ERRO `column "retorno_hora" of relation "renovacao_carteira" does not exist`.

- [ ] **Step 3: Migration**

Criar `supabase/migrations/20261113150000_renovacao_retorno_hora.sql`:

```sql
-- §151 (13/11, Rafael): redesign da Renovação — retorno com data E hora. A data continua em prox_retorno (os retornos
-- antigos seguem valendo, sem hora). Atrasado = data antes de hoje, ou hoje com a hora já passada (horário de SP).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_retorno_hora_check.sql.
begin;

alter table public.renovacao_carteira add column if not exists retorno_hora time;

create or replace view public.renovacao_resumo with (security_invoker = true) as
select c.consultor_id, p.nome as consultor_nome,
       count(*)::int                                                    as carteira,
       count(*) filter (where c.status >= 2)::int                       as contatados,
       count(*) filter (where c.status between 3 and 6)::int            as efetivo_mais,
       count(*) filter (where c.status between 4 and 6)::int            as propostas_mais,
       count(*) filter (where c.status = 6)::int                        as renovados,
       count(*) filter (where c.status = 7)::int                        as perdidos,
       coalesce(sum(c.linhas_renovadas), 0)::int                        as linhas_renovadas,
       coalesce(sum(c.bl_vendida), 0)::int                              as bl_vendida,
       coalesce(sum(c.sol_digitais), 0)::numeric(12,2)                  as sol_digitais,
       count(*) filter (where c.status not in (6, 7) and (
           c.prox_retorno < (now() at time zone 'America/Sao_Paulo')::date
        or (c.prox_retorno = (now() at time zone 'America/Sao_Paulo')::date
            and c.retorno_hora is not null and c.retorno_hora < (now() at time zone 'America/Sao_Paulo')::time)))::int as retornos_atrasados,
       count(*) filter (where c.a_completar)::int                       as a_completar
  from public.renovacao_carteira c
  left join public.profiles p on p.id = c.consultor_id
 where c.na_base
 group by c.consultor_id, p.nome;
grant select on public.renovacao_resumo to authenticated;

commit;
```

- [ ] **Step 4: Ver passar sem gravar.** `begin;` + migration sem `begin;`/`commit;` + teste sem o primeiro `begin;`. Expected: sem erro; depois `select count(*) from information_schema.columns where table_name = 'renovacao_carteira' and column_name = 'retorno_hora'` → 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261113150000_renovacao_retorno_hora.sql supabase/tests/renovacao_retorno_hora_check.sql
git commit -m "feat(renovacao): retorno com hora e atraso por hora no resumo (§151)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Base visual, navegação, hora do retorno e Carteira

**Files:**
- Create: `test_renovacao_redesign_base.js`, `test_renovacao_carteira2.js`
- Delete: `test_renovacao_carteira.js`
- Modify: `test_renovacao_correcoes.js`, `test_renovacao_correcoes2.js`, `test_renovacao_subaba_proposta.js`
- Modify: `_template.html` (tokens §126, CSS `.rn*`, marcação `#panel-renovacao`, bloco §143)

**Interfaces:**
- Produces: `rnHoraSP()` → `'HH:MM'`; `rnAgora()` → `{data:'YYYY-MM-DD', hora:'HH:MM'}`; `rnEstadoRetorno(r, agora)` → `'atrasado'|'hoje'|'futuro'|null`; `rnRetornoVencido(r, hojeOuAgora)`; `rnDataSP(iso)`; `rnDiasEntre(a, b)`; `rnTextoAtraso(r, agora)`; `RN_ETAPA`; `rnEtapaHtml(s)`; `rnIniciais(nome)`; `rnChaveRetorno(r)`, `rnOrdemLinhas`, `rnOrdemRetorno`; `RN_VISOES`; `rnContarVisoes(lista, f, agora)`; `rnFiltrar(lista, f, hojeOuAgora)` com `f.visao` e `f.ordem`; `rnProximoPassoHtml(r, agora)`; `rnUltimoContato(r)`; `RN_VISAO_ID`; `rnMostrarAba(aba)`; `rnPosicionarFicha(aba)`; `rnTrocarAba(aba)`; estado `rnEstado.aba` (padrão `'hoje'`), `buscaHoje`, `fichaAba`, `fichaStatus`; `RN_COLS_LISTA` com `retorno_hora`; ids novos `rnHoje`, `rnKpis`, `rnFilaLista`, `rnHojeBusca`, `rnHojeFicha`, `rnVisoes`, `rnChips`, `rnMaisFiltros`, `rnMaisFiltrosBt`, `rnOrdem`.

- [ ] **Step 1: Testes novos (vão falhar)**

Criar `test_renovacao_redesign_base.js`:

```js
// Testa a §151 — base do redesign da Renovação: subabas, hora do retorno, selo. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join(' ');
  assert(/#panel-meusleads,#kbFicha,#kbPassar,#panel-renovacao,#rnFicha\\{--ml-ink/.test(css), 'tokens do §126 valem na Renovação');
  eq([...document.querySelectorAll('#rnAbas [data-rn-aba]')].map(b => [b.dataset.rnAba, b.childNodes[0].textContent.trim()]),
     [['hoje', 'Hoje'], ['carteira', 'Carteira'], ['kanban', 'Funil'], ['resumo', 'Resumo'], ['proposta', 'Proposta e fatura']], 'subabas na ordem');
  assert(!document.getElementById('rnRetornos'), 'Retornos deixou de ser subaba');

  const ag = { data: '2026-11-13', hora: '16:00' };
  const R = (o) => Object.assign({ status: 3, na_base: true }, o);
  eq([rnEstadoRetorno(R({ prox_retorno: '2026-11-12' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-13', retorno_hora: '15:00:00' }), ag),
      rnEstadoRetorno(R({ prox_retorno: '2026-11-13', retorno_hora: '17:00' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-13' }), ag),
      rnEstadoRetorno(R({ prox_retorno: '2026-11-14' }), ag), rnEstadoRetorno(R({ prox_retorno: '2026-11-01', status: 6 }), ag), rnEstadoRetorno(R({}), ag)],
     ['atrasado', 'atrasado', 'hoje', 'hoje', 'futuro', null, null], 'estado do retorno com hora');
  eq([rnRetornoVencido(R({ prox_retorno: '2026-11-13', retorno_hora: '10:00' }), '2026-11-13'), rnRetornoVencido(R({ prox_retorno: '2026-11-12' }), '2026-11-13')],
     [false, true], 'com só a data (texto) vale a regra antiga');
  eq([rnTextoAtraso(R({ prox_retorno: '2026-11-10' }), ag), rnTextoAtraso(R({ prox_retorno: '2026-11-12' }), ag), rnTextoAtraso(R({ prox_retorno: '2026-11-13', retorno_hora: '09:30:00' }), ag)],
     ['há 3 dias', 'há 1 dia', 'era 09:30'], 'texto do atraso');
  eq([rnIniciais('Padaria Pão Dourado Ltda'), rnIniciais('X'), rnIniciais('')], ['PP', 'X', '?'], 'iniciais');
  assert(/rnSt5/.test(rnEtapaHtml(5)) && /Em negociação/.test(rnEtapaHtml(5)), 'etiqueta da etapa');
  assert(/^\\d{2}:\\d{2}$/.test(rnHoraSP()) && rnAgora().data === rnHoje(), 'agora em SP');

  // tela inicial e selo com hora
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [R({ id: 1, prox_retorno: '2026-11-13', retorno_hora: '15:00', consultor_id: 'u-a' }), R({ id: 2, prox_retorno: '2026-11-13', retorno_hora: '18:00', consultor_id: 'u-a' }), R({ id: 3, prox_retorno: '2026-11-12', consultor_id: 'u-a' })];
  window.__tabelas.propostas = [];
  await rnCarregar();
  eq(rnEstado.aba, 'hoje', 'abre na Central');
  assert(!document.getElementById('rnHoje').hidden && document.getElementById('rnCarteira').hidden, 'Hoje visível');
  eq(document.querySelector('#rnAbas .active').dataset.rnAba, 'hoje', 'Hoje ativa');
  eq([document.getElementById('rnBadgeMenu').textContent, document.getElementById('rnBadgeRetornos').textContent], ['2', '2'], 'selo conta o atraso por hora');
  // ficha muda de casa conforme a subaba
  rnTrocarAba('carteira');
  eq([document.getElementById('rnFicha').parentElement.id, document.getElementById('rnFicha').classList.contains('noPainel')], ['panel-renovacao', false], 'fora da Central a ficha é gaveta');
  rnTrocarAba('hoje');
  eq([document.getElementById('rnFicha').parentElement.id, document.getElementById('rnFicha').classList.contains('noPainel')], ['rnHojeFicha', true], 'na Central a ficha fica ao lado da fila');
  fim();
`);
```

Criar `test_renovacao_carteira2.js`:

```js
// Testa a §151 — Carteira redesenhada: visões, mais filtros, etiquetas, ordem, tabela sem edição. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const AG = { data: '2026-11-13', hora: '16:00' };
  const L = (o) => Object.assign({ cnpj_digits: '00000000000400', razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', cidade: 'Zz Cidade', ddd: '19',
    consultor_id: 'u-a', status: 1, prox_retorno: null, retorno_hora: null, na_base: true, a_completar: false }, o);
  const base = () => [
    L({ id: 1, razao_social: 'Zz Ácido', linhas_voz: 3, status: 2, prox_retorno: '2026-11-13', retorno_hora: '15:00' }),
    L({ id: 2, razao_social: 'Zz Beta', linhas_voz: 30, status: 7, motivo_perda: 'Preço', cidade: 'Zz Outra' }),
    L({ id: 3, razao_social: 'Zz Gama', linhas_voz: 30, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' }),
    L({ id: 4, razao_social: 'Zz Delta', linhas_voz: 8, status: 1, a_completar: true, consultor_id: null }),
    L({ id: 5, razao_social: 'Zz Fora', linhas_voz: 99, na_base: false }),
    L({ id: 6, razao_social: 'Zz Hoje', linhas_voz: 2, status: 4, prox_retorno: '2026-11-13', retorno_hora: '18:00', data_contato: '2026-11-10', canal: 'WhatsApp' }),
  ];
  const ids = (f) => rnFiltrar(base(), Object.assign(rnFiltrosVazios(), f), AG).map(r => r.id);
  eq(ids({}), [2, 3, 4, 1, 6], 'Todos: na base, mais linhas primeiro');
  eq([ids({ visao: 'nao' }), ids({ visao: 'andamento' }), ids({ visao: 'atrasados' }), ids({ visao: 'pendencias' }), ids({ visao: 'renovados' }), ids({ visao: 'perdidos' }), ids({ visao: 'fora' })],
     [[4], [1, 6], [1], [4], [3], [2], [5]], 'visões');
  eq(ids({ ordem: 'retorno' }), [1, 6, 2, 3, 4], 'retorno mais próximo primeiro (sem retorno no fim, por linhas)');
  eq(ids({ busca: 'acido' }), [1], 'busca sem acento');
  eq(rnContarVisoes(base(), rnFiltrosVazios(), AG), { todos: 5, nao: 1, andamento: 2, atrasados: 1, pendencias: 1, renovados: 1, perdidos: 1, fora: 1 }, 'contagem das visões');
  eq(rnValidarFechamento(7, {}), 'Escolha o motivo da perda.', 'perdido sem motivo');
  eq(rnValidarFechamento(6, { linhas_renovadas: 3 }), null, 'renovado com linhas');
  eq(rnStatusRotulo(3), '3-Contato efetivo', 'rótulo do status (histórico)');
  eq(rnUltimoContato(L({ data_contato: '2026-11-10', canal: 'WhatsApp' })), '10/11 · WhatsApp', 'último contato');

  // ==== tela (gestor) ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  window.__tabelas.propostas = [];
  await rnCarregar();
  rnTrocarAba('carteira');
  const visoes = () => [...document.querySelectorAll('#rnVisoes [data-rn-visao]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim());
  eq(visoes(), ['Todos 5', 'Não contatados 1', 'Em andamento 2', 'Atrasados 1', 'Pendências 1', 'Renovados 1', 'Perdidos 1', 'Fora da base 1'], 'pílulas com contagem');
  eq(document.querySelectorAll('#rnTbody select, #rnTbody input:not([type=checkbox])').length, 0, 'nada editável na linha');
  const linhas = () => [...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId);
  eq(linhas(), ['2', '3', '4', '1', '6'], 'tabela na ordem');
  assert(/Zzb Teste/.test(document.querySelector('#rnTbody tr[data-rn-id="3"]').textContent), 'gestor vê o consultor na linha');
  assert(/⏱ era 15:00/.test(document.querySelector('#rnTbody tr[data-rn-id="1"]').textContent), 'próximo passo: atrasado');
  assert(/Retorno hoje 18:00/.test(document.querySelector('#rnTbody tr[data-rn-id="6"]').textContent), 'próximo passo: hoje');
  assert(/10\\/11 · WhatsApp/.test(document.querySelector('#rnTbody tr[data-rn-id="6"]').textContent), 'último contato');
  assert(/Primeiro contato/.test(document.querySelector('#rnTbody tr[data-rn-id="4"]').textContent), 'não contatado sem retorno');

  document.querySelector('#rnVisoes [data-rn-visao="atrasados"]').click();
  eq(linhas(), ['1'], 'clicar na visão filtra');
  document.querySelector('#rnVisoes [data-rn-visao="todos"]').click();

  const mf = document.getElementById('rnMaisFiltros');
  assert(mf.hidden, 'Mais filtros começa fechado');
  document.getElementById('rnMaisFiltrosBt').click();
  assert(!mf.hidden && document.getElementById('rnMaisFiltrosBt').getAttribute('aria-expanded') === 'true', 'abre Mais filtros');
  const cid = document.getElementById('rnFCidade'); cid.value = 'Zz Outra'; cid.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(linhas(), ['2'], 'filtra pela cidade');
  const chip = document.querySelector('#rnChips [data-rn-limpar="cidade"]');
  assert(!!chip && /Cidade: Zz Outra/.test(chip.textContent), 'etiqueta do filtro');
  chip.click();
  eq([linhas().length, document.querySelectorAll('#rnChips [data-rn-limpar]').length], [5, 0], 'tirar a etiqueta limpa o filtro');

  const ord = document.getElementById('rnOrdem'); ord.value = 'retorno'; ord.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(linhas(), ['1', '6', '2', '3', '4'], 'ordem por retorno');

  document.querySelector('#rnTbody tr[data-rn-id="6"] td:nth-child(3)').click();
  await espera(30);
  eq([rnEstado.fichaId, document.getElementById('rnFicha').classList.contains('aberta')], [6, true], 'clicar na linha abre a ficha');
  const cx = document.querySelector('#rnTbody [data-rn-sel="2"]'); cx.checked = true; cx.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(document.getElementById('rnSelN').textContent, '1 selecionado(s)', 'marcar não abre a ficha e conta');

  // 50 por página
  window.__tabelas.renovacao_carteira = Array.from({ length: 60 }, (_, i) => L({ id: 100 + i, linhas_voz: i }));
  rnEstado.carregado = false; await rnCarregar(); rnTrocarAba('carteira');
  eq([linhas().length, /Mostrar mais \\(10\\)/.test(document.getElementById('rnMais').textContent)], [50, true], '50 por vez');
  fim();
`);
```

- [ ] **Step 2: Ver falhar.** `python build_painel.py >/dev/null && node test_renovacao_redesign_base.js; node test_renovacao_carteira2.js` → Expected: `FALHOU: tokens do §126 valem na Renovação` e `FALHA: ReferenceError: rnContarVisoes is not defined`.

- [ ] **Step 3: Tokens, CSS e marcação**

3a. Trocar `#panel-meusleads,#kbFicha,#kbPassar{--ml-ink:` por `#panel-meusleads,#kbFicha,#kbPassar,#panel-renovacao,#rnFicha{--ml-ink:`.

3b. Apagar as linhas de CSS que começam em `  .rnFiltros{` e vão até a linha `  .rnKbCard.rnRenovado{background:var(--st-ganho-bg);}` (inclusive) e pôr no lugar:

```css
  /* §151 redesign da Renovação ("Central do dia"): linguagem do §126 (--ml-*); etapas com tokens próprios, hex só aqui */
  #panel-renovacao,#rnFicha{--rn-st1:#6B7280;--rn-st1-bg:#EEF0F2;--rn-st2:var(--st-andamento);--rn-st2-bg:var(--st-andamento-bg);--rn-st3:#1D4ED8;--rn-st3-bg:#E0E7FF;--rn-st4:#6D28D9;--rn-st4-bg:#EDE9FE;--rn-st5:var(--st-devolvido);--rn-st5-bg:var(--st-devolvido-bg);--rn-st6:var(--st-ganho);--rn-st6-bg:var(--st-ganho-bg);--rn-st7:var(--st-perdido);--rn-st7-bg:var(--st-perdido-bg);}
  #panel-renovacao{color:var(--ml-ink);}
  .rnTopo{display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap;margin-bottom:var(--space-4);}
  .rnSel{height:36px;padding:0 12px;border:0;border-radius:var(--radius-lg);background:var(--ml-surface);font:inherit;font-size:var(--fs-base);color:var(--ml-ink);box-shadow:var(--shadow-sm);}
  .rnN{font-family:'Barlow Condensed',sans-serif;font-weight:700;font-variant-numeric:tabular-nums;}
  .rnEtapa{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:var(--fs-xs);font-weight:600;white-space:nowrap;}
  .rnEtapa i{width:7px;height:7px;border-radius:50%;background:currentColor;}
  .rnSt1{color:var(--rn-st1);background:var(--rn-st1-bg);}.rnSt2{color:var(--rn-st2);background:var(--rn-st2-bg);}.rnSt3{color:var(--rn-st3);background:var(--rn-st3-bg);}.rnSt4{color:var(--rn-st4);background:var(--rn-st4-bg);}.rnSt5{color:var(--rn-st5);background:var(--rn-st5-bg);}.rnSt6{color:var(--rn-st6);background:var(--rn-st6-bg);}.rnSt7{color:var(--rn-st7);background:var(--rn-st7-bg);}
  .rnAv{width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:var(--fs-xs);background:var(--ml-surface-2);color:var(--ml-ink-2);flex:none;}
  .rnVazio{color:var(--ml-ink-3);padding:var(--space-4);text-align:center;}
  .rnLate{color:var(--ml-late);font-weight:600;}.rnOk{color:var(--ml-ok);font-weight:600;}.rnMuted{color:var(--ml-ink-3);}
  .rnNome{background:none;border:0;padding:0;font:inherit;font-weight:600;color:inherit;cursor:pointer;text-align:left;}
  .rnNome:hover{text-decoration:underline;}
  /* Central do dia */
  .rnKpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--space-3);margin-bottom:var(--space-4);}
  .rnKpi{background:var(--ml-surface);border-radius:12px;padding:var(--space-4);}
  .rnKpi .rnN{font-size:34px;line-height:1;display:block;}
  .rnKpi small{display:block;margin-top:4px;color:var(--ml-ink-2);font-size:var(--fs-sm);}
  .rnKpi .rnKpiSub{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .rnKpiBar{height:6px;border-radius:999px;background:var(--ml-surface-2);margin:10px 0 4px;overflow:hidden;}
  .rnKpiBar span{display:block;height:100%;border-radius:inherit;background:var(--ml-ink);}
  .rnKpi.late .rnN{color:var(--ml-late);}.rnKpi.ok .rnN{color:var(--ml-ok);}
  .rnHojeGrade{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:var(--space-4);align-items:start;}
  .rnBloco{background:var(--ml-surface);border-radius:12px;padding:var(--space-3);}
  .rnBuscaSuave{background:var(--ml-surface-2);margin-bottom:var(--space-2);}
  .rnGrupoT{display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:var(--fs-sm);margin:var(--space-3) var(--space-1) var(--space-1);}
  .rnGrupoT.late{color:var(--ml-late);}.rnGrupoT.ok{color:var(--ml-ok);}
  .rnItem{display:flex;align-items:center;gap:var(--space-3);width:100%;padding:10px;border:0;border-radius:10px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;transition:background var(--dur-fast) var(--ease-out);}
  .rnItem:hover{background:var(--ml-surface-2);}.rnItem.sel{background:var(--ml-novo-soft);}
  .rnItem.sel .rnAv{background:var(--ml-surface);color:var(--c-sinal);}
  .rnItemTxt{flex:1;min-width:0;display:flex;flex-direction:column;}
  .rnItemTxt b{font-size:var(--fs-base);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .rnItemTxt small{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .rnQuando{font-size:var(--fs-xs);font-weight:600;white-space:nowrap;color:var(--ml-ink-2);}
  .rnQuando.atrasado{color:var(--ml-late);}.rnQuando.hoje{color:var(--ml-ok);}
  .rnHojeFicha{min-height:200px;}
  .rnHojeFicha .kbFicha.noPainel{border-radius:12px;background:var(--ml-surface);}
  /* Ficha */
  #rnFicha .kbFichaCorpo{padding:var(--space-4);overflow-y:auto;gap:var(--space-3);}
  .rnFichaTopo{display:flex;align-items:center;gap:var(--space-3);}
  .rnFichaTopo .rnAv{width:46px;height:46px;font-size:var(--fs-base);background:var(--ml-novo-soft);color:var(--c-sinal);}
  .rnFichaNome{font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;line-height:1.1;margin:0;}
  .rnFichaMeta{color:var(--ml-ink-3);font-size:var(--fs-sm);}
  .rnFichaAcoes{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;}
  #rnFicha.noPainel [data-rn-ficha-fechar]{display:none;}
  .rnFichaAbas{display:flex;gap:var(--space-4);border-bottom:1px solid var(--c-linha);}
  .rnFichaAbas button{border:0;background:none;padding:8px 0;font:inherit;font-weight:600;font-size:var(--fs-sm);color:var(--ml-ink-3);cursor:pointer;}
  .rnFichaAbas button.on{color:var(--ml-ink);box-shadow:inset 0 -2px 0 var(--c-sinal);}
  .rnPergunta{font-weight:600;font-size:var(--fs-sm);margin:0 0 var(--space-2);}
  .rnContato{display:flex;flex-wrap:wrap;gap:var(--space-2);}
  .rnContatoBt{border:1.5px solid var(--c-linha);background:var(--ml-surface);border-radius:10px;padding:9px 14px;font:inherit;font-weight:600;font-size:var(--fs-sm);color:var(--ml-ink);cursor:pointer;}
  .rnContatoBt.on{border-color:currentColor;}
  .rnCampos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2);margin-top:var(--space-3);}
  .rnCampos label{display:flex;flex-direction:column;gap:4px;font-size:var(--fs-xs);color:var(--ml-ink-3);font-weight:600;}
  .rnCampos input,.rnCampos select,.rnCampos textarea{border:0;border-radius:8px;background:var(--ml-surface-2);padding:9px 10px;font:inherit;font-size:var(--fs-base);color:var(--ml-ink);}
  .rnCampos .rnLargo{grid-column:1/-1;}
  .rnFichaRodape{display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-3);}
  .rnErro{color:var(--ml-late);font-weight:600;font-size:var(--fs-sm);margin:var(--space-2) 0 0;min-height:1em;}
  .rnGrupo{border-top:1px solid var(--c-linha);padding:var(--space-2) 0;}
  .rnGrupo summary{cursor:pointer;font-weight:600;}
  .rnGrupo dl{display:grid;grid-template-columns:minmax(140px,40%) 1fr;gap:2px var(--space-2);margin:var(--space-2) 0 0;}
  .rnGrupo dt{color:var(--ml-ink-3);}
  .rnGrupo dd{margin:0;overflow-wrap:anywhere;}
  .rnHist{margin:0;padding-left:1.1em;color:var(--ml-ink-2);display:grid;gap:4px;}
  /* Carteira */
  .rnCartBarra{display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;}
  .rnCartBarra .kbBusca{flex:1;min-width:240px;box-shadow:var(--shadow-sm);}
  .rnVisoes{display:flex;flex-wrap:wrap;gap:6px;margin:var(--space-3) 0;}
  .rnVisaoBt{border:0;border-radius:999px;padding:7px 14px;background:var(--ml-surface);font:inherit;font-weight:600;font-size:var(--fs-sm);color:var(--ml-ink-2);cursor:pointer;}
  .rnVisaoBt b{margin-left:4px;opacity:.7;font-variant-numeric:tabular-nums;}
  .rnVisaoBt.on{background:var(--ml-ink);color:var(--ml-surface);}
  .rnVisaoBt.late b{color:var(--ml-late);opacity:1;}.rnVisaoBt.on.late b{color:inherit;}
  .rnMaisFiltros{display:flex;flex-wrap:wrap;gap:var(--space-2);background:var(--ml-surface);border-radius:12px;padding:var(--space-3);margin-bottom:var(--space-3);}
  .rnMaisFiltros[hidden]{display:none;}
  .rnChips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:var(--space-2);}
  .rnChips:empty{display:none;}
  .rnChip{border:1px solid var(--ml-ink);background:var(--ml-surface);border-radius:8px;padding:4px 10px;font:inherit;font-size:var(--fs-xs);font-weight:600;cursor:pointer;}
  .rnRedistribuir{display:flex;gap:var(--space-2);align-items:center;background:var(--ml-surface);border-radius:12px;padding:var(--space-2) var(--space-3);margin-bottom:var(--space-2);box-shadow:var(--ml-float);}
  .rnTabelaCasa{background:var(--ml-surface);border-radius:12px;overflow:hidden;}
  .rnTabela{width:100%;border-collapse:collapse;}
  .rnTabela th{text-align:left;font-size:var(--fs-xs);font-weight:600;color:var(--ml-ink-3);padding:10px 12px;background:var(--ml-surface-2);}
  .rnTabela td{padding:10px 12px;border-top:1px solid var(--ml-surface-2);font-size:var(--fs-sm);vertical-align:middle;}
  #rnTbody tr{cursor:pointer;}#rnTbody tr:hover td{background:var(--ml-surface-2);}
  .rnEmpresa{display:flex;align-items:center;gap:var(--space-3);}
  .rnEmpresa b{display:block;}.rnEmpresa small{display:block;color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .rnNumTd{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;}
  .rnTdSel{width:36px;}
  .rnMaisBt{margin:var(--space-3) auto 0;}
  /* Funil */
  .kanbanCard.kcRenovacao{cursor:pointer;}
  .rnKanban{display:grid;grid-template-columns:repeat(5,minmax(210px,1fr));gap:var(--space-3);overflow-x:auto;}
  .rnKbCol{background:var(--ml-surface-3);border-radius:12px;padding:var(--space-2);min-height:240px;}
  .rnKbHead{display:flex;justify-content:space-between;align-items:center;margin:4px 4px 10px;}
  .rnKbCard{background:var(--ml-surface);border-radius:10px;padding:10px 12px;margin-bottom:var(--space-2);cursor:grab;display:grid;gap:4px;box-shadow:var(--shadow-sm);}
  .rnKbCard:active{cursor:grabbing;box-shadow:var(--ml-float);}
  .rnKbCard small{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .rnParado{font-size:var(--fs-xs);color:var(--ml-ink-3);}.rnParado.late{color:var(--ml-late);font-weight:600;}
  /* Resumo */
  .rnBarra{display:inline-flex;align-items:center;gap:8px;}
  .rnBarra span{display:block;width:110px;height:8px;border-radius:999px;background:var(--ml-surface-2);overflow:hidden;}
  .rnBarra span i{display:block;height:100%;border-radius:inherit;background:var(--ml-ink);}
  .rnBarra.ok span i{background:var(--ml-ok);}
  .rnResumoTbl tbody tr{cursor:default;}
  .rnTotal td{font-weight:700;}
  .rnResumoRodape{display:flex;justify-content:flex-end;margin-top:var(--space-3);}
  /* tela estreita e movimento */
  @media (max-width:900px){
    .rnHojeGrade{grid-template-columns:1fr;}
    .rnKpis{grid-template-columns:repeat(2,minmax(0,1fr));}
    .rnTabela thead{display:none;}
    #rnTbody tr{display:grid;grid-template-columns:1fr auto;gap:4px var(--space-2);padding:var(--space-2);border-top:1px solid var(--ml-surface-2);}
    #rnTbody td{border:0;padding:2px 4px;}
  }
  @media (prefers-reduced-motion: reduce){ .rnItem{transition:none;} }
```

3c. Trocar a `<section class="panel" id="panel-renovacao">…</section>` inteira por:

```html
    <section class="panel" id="panel-renovacao">
      <div class="rnTopo">
        <nav class="kbSeg" id="rnAbas" aria-label="Visões da Renovação">
          <button type="button" class="active" data-rn-aba="hoje">Hoje <span class="kbBadge" id="rnBadgeRetornos"></span></button>
          <button type="button" data-rn-aba="carteira">Carteira</button>
          <button type="button" data-rn-aba="kanban">Funil</button>
          <button type="button" data-rn-aba="resumo">Resumo</button>
          <button type="button" data-rn-aba="proposta">Proposta e fatura</button>
        </nav>
        <select id="rnFConsultor" class="rnSel" aria-label="Consultor" style="display:none"></select>
        <span class="kbStatusLinha" id="rnStatus"></span>
      </div>
      <div id="rnHoje" class="rnVisao">
        <div class="rnKpis" id="rnKpis"></div>
        <div class="rnHojeGrade">
          <div class="rnBloco">
            <div class="rnCartBarra">
              <input type="search" id="rnHojeBusca" class="kbBusca rnBuscaSuave" placeholder="Buscar empresa, CNPJ ou ADM" autocomplete="off" aria-label="Buscar na fila">
              <button type="button" class="kbBtn kbBtnQ" id="rnHojeFiltros">Filtros</button>
            </div>
            <div id="rnFilaLista"></div>
          </div>
          <div class="rnHojeFicha" id="rnHojeFicha"></div>
        </div>
      </div>
      <div id="rnCarteira" class="rnVisao" hidden>
        <div class="rnCartBarra">
          <input type="search" id="rnBusca" class="kbBusca" placeholder="Buscar empresa, CNPJ ou ADM" autocomplete="off" aria-label="Buscar na carteira">
          <button type="button" class="kbBtn kbBtnQ" id="rnMaisFiltrosBt" aria-expanded="false" aria-controls="rnMaisFiltros">Mais filtros</button>
          <select id="rnOrdem" class="rnSel" aria-label="Ordem"><option value="linhas">Mais linhas primeiro</option><option value="retorno">Retorno mais próximo</option></select>
        </div>
        <div class="rnVisoes" id="rnVisoes"></div>
        <div class="rnMaisFiltros" id="rnMaisFiltros" hidden>
          <select id="rnFCidade" class="rnSel" aria-label="Cidade"></select>
          <select id="rnFDdd" class="rnSel" aria-label="DDD"></select>
          <select id="rnFApto" class="rnSel" aria-label="Apto"><option value="">Apto: todos</option><option value="APTO">APTO</option><option value="1 MÊS PARA APTO">1 mês para apto</option></select>
        </div>
        <div class="rnChips" id="rnChips"></div>
        <div class="rnRedistribuir" id="rnRedistribuir" style="display:none">
          <span id="rnSelN"></span>
          <select id="rnPassarPara" class="rnSel" aria-label="Passar para"></select>
          <button type="button" class="kbBtn kbBtnP" id="rnPassar">Passar</button>
        </div>
        <div class="rnTabelaCasa"><table class="rnTabela"><thead id="rnThead"></thead><tbody id="rnTbody"></tbody></table></div>
        <button type="button" class="kbBtn kbBtnQ rnMaisBt" id="rnMais" style="display:none"></button>
      </div>
      <div id="rnKanban" class="rnVisao" hidden></div>
      <div id="rnResumo" class="rnVisao" hidden></div>
      <div id="rnProposta" class="rnVisao" hidden></div>
      <aside class="kbFicha" id="rnFicha" aria-label="Ficha do cliente"><div class="kbFichaCorpo" id="rnFichaCorpo"></div></aside>
    </section>
```

- [ ] **Step 4: JS: estado, hora e navegação**

4a. `const RN_COLS_LISTA = '…atualizado_em,status_desde';` → acrescentar `,retorno_hora` no fim da string. `const RN_PAGINA = 100;` → `const RN_PAGINA = 50;`.

4b. Trocar `function rnFiltrosVazios(){ return { busca: '', status: '', apto: '', cidade: '', ddd: '', consultor: ''` por `function rnFiltrosVazios(){ return { busca: '', visao: 'todos', ordem: 'linhas', status: '', apto: '', cidade: '', ddd: '', consultor: ''`.

4c. Em `const rnEstado = { aba: 'carteira',` trocar `aba: 'carteira'` por `aba: 'hoje', buscaHoje: '', fichaAba: 'atendimento', fichaStatus: null`.

4d. Trocar a função `rnAplicarPermissao` inteira (de `function rnAplicarPermissao(){` até o `}` da coluna 0 seguinte) por:

```js
function rnAplicarPermissao(){
  document.getElementById('tabBtnRenovacao').style.display = rnPodeVer() ? 'inline-block' : 'none';
  // §143.2: o time de renovação trabalha só pela aba Renovação (Busca, Proposta, Funil e Agenda saem do menu dele)
  const soRenovacao = rnSoRenovacao();
  ['busca', 'proposta', 'funil', 'agenda'].forEach(t => { const b = document.querySelector(`#tabsNav button[data-tab="${t}"]`); if(b) b.style.display = soRenovacao ? 'none' : ''; });
  Object.assign(rnEstado, { aba: 'hoje', lista: [], propostas: [], perfis: [], carregado: false, filtros: rnFiltrosVazios(), pagina: 1, fichaId: null, ficha: null,
    importacao: null, buscaHoje: '', fichaAba: 'atendimento', fichaStatus: null });
  rnEstado.selecionados.clear();
  rnEstado.geracao++;
  // troca de usuário na mesma aba do navegador: nada do anterior fica na tela
  if(typeof rnMoverProposta === 'function') rnMoverProposta(false);
  ['rnTbody', 'rnResumo', 'rnFichaCorpo', 'rnKanban', 'rnKpis', 'rnFilaLista', 'rnVisoes', 'rnChips'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
  const busca = document.getElementById('rnHojeBusca'); if(busca) busca.value = '';
  document.getElementById('rnFicha').classList.remove('aberta');
  rnMostrarAba('hoje');
}
```

4e. Trocar `function rnRetornoVencido(r, hoje){ … }` (uma linha) por:

```js
// §151: retorno com data e hora. Recebe { data, hora } (rnAgora) ou só a data em texto (regra antiga: só data).
const RN_HORA_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function rnHoraSP(){ return RN_HORA_FMT.format(new Date()); }
function rnAgora(){ return { data: rnHoje(), hora: rnHoraSP() }; }
function rnComoAgora(x){ return typeof x === 'string' ? { data: x, hora: '00:00' } : x; }
function rnEstadoRetorno(r, agora){
  if(!r.prox_retorno || r.status === 6 || r.status === 7) return null;
  if(r.prox_retorno < agora.data) return 'atrasado';
  if(r.prox_retorno > agora.data) return 'futuro';
  const h = r.retorno_hora ? String(r.retorno_hora).slice(0, 5) : '';
  return h && h < agora.hora ? 'atrasado' : 'hoje';
}
function rnRetornoVencido(r, hoje){ return rnEstadoRetorno(r, rnComoAgora(hoje)) === 'atrasado'; }
function rnDataSP(iso){ return CONVERSAO_DATE_FMT.format(new Date(iso)); }
function rnDiasEntre(a, b){ return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }
function rnTextoAtraso(r, agora){
  const d = rnDiasEntre(r.prox_retorno, agora.data);
  if(d > 0) return `há ${d} dia${d > 1 ? 's' : ''}`;
  return 'era ' + String(r.retorno_hora || '').slice(0, 5);
}
const RN_ETAPA = { 1: 'Não contatado', 2: 'Tentativa', 3: 'Contato efetivo', 4: 'Proposta enviada', 5: 'Em negociação', 6: 'Renovado', 7: 'Perdido' };
function rnEtapaHtml(s){ return `<span class="rnEtapa rnSt${Number(s) || 1}"><i></i>${escapeHtml(RN_ETAPA[s] || '?')}</span>`; }
function rnIniciais(nome){
  const p = String(nome || '').split(/\s+/).filter(w => w.length > 1 || /^[A-Za-zÀ-ú]$/.test(w));
  return p.length ? p.slice(0, 2).map(w => w[0].toUpperCase()).join('') : '?';
}
```

4f. Em `rnAtualizarBadge`, trocar

```js
  const hoje = rnHoje();
  const n = rnEstado.lista.filter(r => r.na_base && rnRetornoVencido(r, hoje)).length;
```
por
```js
  const agora = rnAgora();
  const n = rnEstado.lista.filter(r => r.na_base && rnEstadoRetorno(r, agora) === 'atrasado').length;
```

4g. Trocar a função `rnTrocarAba` inteira e a função `rnRender` inteira por:

```js
const RN_VISAO_ID = { hoje: 'rnHoje', carteira: 'rnCarteira', kanban: 'rnKanban', resumo: 'rnResumo', proposta: 'rnProposta' };
function rnMostrarAba(aba){
  document.querySelectorAll('#rnAbas [data-rn-aba]').forEach(b => b.classList.toggle('active', b.dataset.rnAba === aba));
  Object.entries(RN_VISAO_ID).forEach(([k, id]) => { const el = document.getElementById(id); if(el) el.hidden = k !== aba; });
  rnPosicionarFicha(aba);
}
// A ficha é uma só: ao lado da fila na Central (.noPainel) e gaveta nas outras subabas.
function rnPosicionarFicha(aba){
  const f = document.getElementById('rnFicha');
  const naHoje = aba === 'hoje';
  const casa = document.getElementById(naHoje ? 'rnHojeFicha' : 'panel-renovacao');
  if(f.parentElement !== casa) casa.appendChild(f);
  f.classList.toggle('noPainel', naHoje);
  if(!naHoje) f.classList.remove('aberta');
}
function rnTrocarAba(aba){
  rnEstado.aba = aba;
  rnMostrarAba(aba);
  rnRender();
}
```
(o listener `document.getElementById('rnAbas').addEventListener('click', …)` continua) e

```js
function rnRender(){
  if(rnEstado.aba === 'hoje' && typeof rnRenderHoje === 'function') rnRenderHoje();
  if(rnEstado.aba === 'carteira' && typeof rnRenderCarteira === 'function') rnRenderCarteira();
  if(rnEstado.aba === 'kanban' && typeof rnRenderKanban === 'function') rnRenderKanban();
  if(rnEstado.aba === 'resumo' && typeof rnRenderResumo === 'function') rnRenderResumo();
  if(rnEstado.aba === 'proposta') rnMoverProposta(true);
}
```

4h. Apagar `function rnContadores(lista, hoje){ … }` (de `function rnContadores(` até antes de `function rnClasseLinha(`). Trocar a função `rnFiltrar` inteira (de `function rnFiltrar(lista, f, hoje){` até antes de onde ficava `rnContadores`) por:

```js
function rnChaveRetorno(r){ return r.prox_retorno ? r.prox_retorno + ' ' + (r.retorno_hora ? String(r.retorno_hora).slice(0, 5) : '99:99') : '9999-99-99'; }
function rnOrdemLinhas(a, b){ return (b.linhas_voz || 0) - (a.linhas_voz || 0) || String(a.razao_social || '').localeCompare(String(b.razao_social || ''), 'pt-BR'); }
function rnOrdemRetorno(a, b){ return rnChaveRetorno(a).localeCompare(rnChaveRetorno(b)) || rnOrdemLinhas(a, b); }
function rnCasaBusca(r, busca){
  const b = rnNorm(busca); if(!b) return true;
  const dig = onlyDigits(busca);
  return (rnNorm(r.razao_social) + ' ' + rnNorm(r.nome_adm)).includes(b) || (dig.length >= 3 && String(r.cnpj_digits || '').includes(dig));
}
function rnFiltrar(lista, f, hoje){
  const agora = rnComoAgora(hoje);
  const v = f.visao || 'todos';
  const fora = !!f.foraBase || v === 'fora';
  return lista.filter(r => {
    if(fora ? r.na_base : !r.na_base) return false;
    if(f.status && String(r.status) !== String(f.status)) return false;
    if(v === 'nao' && r.status !== 1) return false;
    if(v === 'andamento' && !(r.status >= 2 && r.status <= 5)) return false;
    if((v === 'atrasados' || f.soVencido) && rnEstadoRetorno(r, agora) !== 'atrasado') return false;
    if((v === 'pendencias' || f.pendencias) && !r.a_completar) return false;
    if(v === 'renovados' && r.status !== 6) return false;
    if(v === 'perdidos' && r.status !== 7) return false;
    if(f.apto && r.apto !== f.apto) return false;
    if(f.cidade && r.cidade !== f.cidade) return false;
    if(f.ddd && String(r.ddd || '') !== f.ddd) return false;
    if(f.consultor === '-' ? !!r.consultor_id : (f.consultor && r.consultor_id !== f.consultor)) return false;
    return rnCasaBusca(r, f.busca);
  }).sort(f.ordem === 'retorno' ? rnOrdemRetorno : rnOrdemLinhas);
}
```

4i. Apagar a seção de Retornos: de `// ---- Retornos ----` até antes de `// ---- Resumo`, e pôr no lugar:

```js
// ---- Datas ----
function rnSomarDias(iso, n){ const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
```

- [ ] **Step 5: JS: Carteira**

5a. Trocar o trecho de `function rnPreencherFiltros(){` até antes de `function rnAbrirFechamento(id, status){` por:

```js
const RN_VISOES = [['todos', 'Todos'], ['nao', 'Não contatados'], ['andamento', 'Em andamento'], ['atrasados', 'Atrasados'], ['pendencias', 'Pendências'],
  ['renovados', 'Renovados'], ['perdidos', 'Perdidos'], ['fora', 'Fora da base']];
function rnContarVisoes(lista, f, agora){ return Object.fromEntries(RN_VISOES.map(([v]) => [v, rnFiltrar(lista, Object.assign({}, f, { visao: v }), agora).length])); }
function rnUltimoContato(r){ return r.data_contato ? r.data_contato.slice(8, 10) + '/' + r.data_contato.slice(5, 7) + (r.canal ? ' · ' + r.canal : '') : '—'; }
function rnProximoPassoHtml(r, agora){
  const est = rnEstadoRetorno(r, agora);
  const hora = r.retorno_hora ? ' ' + String(r.retorno_hora).slice(0, 5) : '';
  if(est === 'atrasado') return `<span class="rnLate">⏱ ${escapeHtml(rnTextoAtraso(r, agora))}</span>`;
  if(est === 'hoje') return `<span class="rnOk">● Retorno hoje${escapeHtml(hora)}</span>`;
  if(est === 'futuro') return `Retorno ${escapeHtml(r.prox_retorno.slice(8, 10) + '/' + r.prox_retorno.slice(5, 7) + hora)}`;
  if(r.status === 6) return `<span class="rnOk">${Number(r.linhas_renovadas) || 0} linhas renovadas</span>`;
  if(r.status === 7) return `<span class="rnMuted">${escapeHtml(r.motivo_perda || 'Perdido')}</span>`;
  if(r.status === 1) return 'Primeiro contato';
  return '<span class="rnMuted">Sem retorno marcado</span>';
}
function rnPreencherFiltros(){
  const f = rnEstado.filtros; const gestor = rnGestor();
  const cidades = [...new Set(rnEstado.lista.map(r => r.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  document.getElementById('rnFCidade').innerHTML = rnOpcoes(cidades.map(c => [c, c]), f.cidade, 'Cidade: todas');
  const ddds = [...new Set(rnEstado.lista.map(r => String(r.ddd || '')).filter(Boolean))].sort();
  document.getElementById('rnFDdd').innerHTML = rnOpcoes(ddds.map(d => [d, d]), f.ddd, 'DDD: todos');
  document.getElementById('rnFApto').value = f.apto;
  document.getElementById('rnOrdem').value = f.ordem || 'linhas';
  const fc = document.getElementById('rnFConsultor');
  fc.style.display = gestor ? '' : 'none';
  if(gestor){
    fc.innerHTML = rnOpcoes([['-', 'Sem consultor']].concat(rnEstado.perfis.map(p => [p.id, p.nome])), f.consultor, 'Time todo');
    const pp = document.getElementById('rnPassarPara');
    pp.innerHTML = rnOpcoes(rnEstado.perfis.map(p => [p.id, p.nome]), pp.value, 'Passar para…');
  }
}
function rnChipsHtml(f){
  return [['cidade', 'Cidade'], ['ddd', 'DDD'], ['apto', 'Apto']].filter(([k]) => f[k])
    .map(([k, t]) => `<button type="button" class="rnChip" data-rn-limpar="${k}">${t}: ${escapeHtml(f[k])} ✕</button>`).join('');
}
function rnLinhaHtml(r, agora, gestor){
  const sub = [r.nome_adm, r.cidade, r.apto, gestor ? rnNomeConsultor(r.consultor_id) : ''].filter(Boolean).join(' · ');
  return `<tr class="${rnClasseLinha(r)}" data-rn-id="${r.id}">
    ${gestor ? `<td class="rnTdSel"><input type="checkbox" data-rn-sel="${r.id}" aria-label="Selecionar"${rnEstado.selecionados.has(r.id) ? ' checked' : ''}></td>` : ''}
    <td><div class="rnEmpresa"><span class="rnAv">${escapeHtml(rnIniciais(r.razao_social))}</span><span><b>${escapeHtml(r.razao_social || '(sem nome)')}</b><small>${escapeHtml(sub)}</small></span></div></td>
    <td class="rnNumTd">${r.linhas_voz ?? '—'}</td>
    <td>${rnEtapaHtml(r.status)}</td>
    <td class="rnMuted">${escapeHtml(rnUltimoContato(r))}</td>
    <td>${rnProximoPassoHtml(r, agora)}</td>
  </tr>`;
}
function rnRenderCarteira(){
  const agora = rnAgora(); const gestor = rnGestor(); const f = rnEstado.filtros;
  rnPreencherFiltros();
  const cont = rnContarVisoes(rnEstado.lista, f, agora);
  document.getElementById('rnVisoes').innerHTML = RN_VISOES.map(([v, t]) =>
    `<button type="button" class="rnVisaoBt${(f.visao || 'todos') === v ? ' on' : ''}${v === 'atrasados' && cont[v] ? ' late' : ''}" data-rn-visao="${v}">${t} <b>${cont[v]}</b></button>`).join('');
  document.getElementById('rnChips').innerHTML = rnChipsHtml(f);
  const lista = rnFiltrar(rnEstado.lista, f, agora);
  const mostrar = lista.slice(0, rnEstado.pagina * RN_PAGINA);
  document.getElementById('rnThead').innerHTML = `<tr>${gestor ? '<th class="rnTdSel"><input type="checkbox" id="rnSelTodos" aria-label="Selecionar todos"></th>' : ''}<th>Empresa</th><th>Linhas</th><th>Etapa</th><th>Último contato</th><th>Próximo passo</th></tr>`;
  document.getElementById('rnTbody').innerHTML = mostrar.map(r => rnLinhaHtml(r, agora, gestor)).join('')
    || `<tr><td colspan="${gestor ? 6 : 5}" class="rnVazio">Nenhum cliente com esses filtros.</td></tr>`;
  const mais = document.getElementById('rnMais');
  mais.style.display = lista.length > mostrar.length ? '' : 'none';
  mais.textContent = `Mostrar mais (${lista.length - mostrar.length})`;
  document.getElementById('rnRedistribuir').style.display = gestor && rnEstado.selecionados.size ? '' : 'none';
  document.getElementById('rnSelN').textContent = rnEstado.selecionados.size + ' selecionado(s)';
}
```

5b. Em `rnRedistribuir`, trocar `rnFiltrar(rnEstado.lista, rnEstado.filtros, rnHoje())` por `rnFiltrar(rnEstado.lista, rnEstado.filtros, rnAgora())`.

5c. Trocar o trecho de `document.getElementById('rnTbody').addEventListener('change', async (e) => {` até a linha `document.getElementById('rnPassar').addEventListener('click', rnRedistribuir);` (inclusive) por:

```js
document.getElementById('rnTbody').addEventListener('change', (e) => {
  if(!e.target.matches('[data-rn-sel]')) return;
  const id = Number(e.target.dataset.rnSel);
  if(e.target.checked) rnEstado.selecionados.add(id); else rnEstado.selecionados.delete(id);
  rnRenderCarteira();
});
document.getElementById('rnTbody').addEventListener('click', (e) => {
  if(e.target.closest('input, label')) return;   // marcar para redistribuir não abre a ficha
  const tr = e.target.closest('tr[data-rn-id]');
  if(tr && typeof rnAbrirFicha === 'function') rnAbrirFicha(Number(tr.dataset.rnId));
});
document.getElementById('rnThead').addEventListener('change', (e) => {
  if(e.target.id !== 'rnSelTodos') return;
  rnFiltrar(rnEstado.lista, rnEstado.filtros, rnAgora())
    .forEach(r => { if(e.target.checked) rnEstado.selecionados.add(r.id); else rnEstado.selecionados.delete(r.id); });
  rnRenderCarteira();
});
document.getElementById('rnBusca').addEventListener('input', (e) => { rnEstado.filtros.busca = e.target.value; rnEstado.pagina = 1; rnRenderCarteira(); });
[['rnFApto', 'apto'], ['rnFCidade', 'cidade'], ['rnFDdd', 'ddd'], ['rnOrdem', 'ordem']].forEach(([idEl, k]) =>
  document.getElementById(idEl).addEventListener('change', (e) => { rnEstado.filtros[k] = e.target.value; rnEstado.pagina = 1; rnRenderCarteira(); }));
document.getElementById('rnFConsultor').addEventListener('change', (e) => { rnEstado.filtros.consultor = e.target.value; rnEstado.pagina = 1; rnRender(); });
document.getElementById('rnVisoes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rn-visao]'); if(!b) return;
  rnEstado.filtros.visao = b.dataset.rnVisao; rnEstado.pagina = 1; rnRenderCarteira();
});
document.getElementById('rnChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rn-limpar]'); if(!b) return;
  rnEstado.filtros[b.dataset.rnLimpar] = ''; rnEstado.pagina = 1; rnRenderCarteira();
});
document.getElementById('rnMaisFiltrosBt').addEventListener('click', (e) => {
  const p = document.getElementById('rnMaisFiltros'); p.hidden = !p.hidden;
  e.currentTarget.setAttribute('aria-expanded', String(!p.hidden));
});
document.getElementById('rnMais').addEventListener('click', () => { rnEstado.pagina++; rnRenderCarteira(); });
document.getElementById('rnPassar').addEventListener('click', rnRedistribuir);
```

- [ ] **Step 6: Testes antigos**

- `git rm test_renovacao_carteira.js` (a edição na linha não existe mais; o que ainda vale está no `test_renovacao_carteira2.js`).
- `test_renovacao_correcoes.js`: apagar as linhas de `  const dt = () => document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="prox_retorno"]');` até `  eq(window.__escritas.length, 0, 'sair sem mudar não grava de novo');` (inclusive) e trocar o comentário `// ==== #3 data digitada na lista só grava ao sair do campo, e ano absurdo não grava ====` por `// ==== base para o #4 (a data deixou de ser editável na lista na §151) ====`.
- `test_renovacao_correcoes2.js`: trocar `eq(document.querySelector('#rnAbas .active').dataset.rnAba, 'carteira', 'subaba ativa volta para Carteira');` por `eq(document.querySelector('#rnAbas .active').dataset.rnAba, 'hoje', 'subaba ativa volta para Hoje');`.
- `test_renovacao_subaba_proposta.js`: trocar a lista esperada `['carteira', 'kanban', 'proposta', 'retornos', 'resumo']` por `['hoje', 'carteira', 'kanban', 'resumo', 'proposta']`.

- [ ] **Step 7: Rodar.** `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do echo "$t :: $(node $t 2>&1 | grep -E 'RESULTADO|FALHA' | tail -1)"; done`. Expected: `redesign_base`, `carteira2` e os antigos ajustados com 0 falharam. Se `test_renovacao_ficha.js` falhar no clique `#rnTbody [data-rn-abrir="1"]`, trocar esse clique por `rnTrocarAba('carteira'); document.querySelector('#rnTbody tr[data-rn-id="1"] td:nth-child(2)').click();` (a linha inteira abre a ficha agora).

- [ ] **Step 8: Commit**

```bash
git add -A _template.html test_renovacao_*.js
git commit -m "feat(renovacao): base do redesign — tokens, subabas, retorno com hora e Carteira nova (§151)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Central do dia

**Files:**
- Create: `test_renovacao_hoje.js`
- Modify: `_template.html` (bloco §143; `rnAbrirFicha`; `rnRenderFicha` vazio)

**Interfaces:**
- Consumes: `rnAgora`, `rnEstadoRetorno`, `rnOrdemRetorno`, `rnOrdemLinhas`, `rnCasaBusca`, `rnEtapaHtml`, `rnIniciais`, `rnTextoAtraso`, `rnDataSP`, `rnPropostasDe`, `rnNomeConsultor`, `rnAbrirFicha`.
- Produces: `rnPorConsultor(lista, consultor)`; `rnFila(lista, agora, consultor)` → `{atrasados, hoje, sugeridos}`; `rnFilaPlana(fila)`; `rnListaHoje()`; `rnKpis(lista, propostas, agora, consultor)` → `{carteira, pctContatado, atrasados, vencemHoje, negociacao, valorNegociacao, linhasMes, clientesMes}`; `rnRenderHoje()`.

- [ ] **Step 1: Teste (vai falhar)**

Criar `test_renovacao_hoje.js`:

```js
// Testa a §151 — Central do dia: fila, cartões, ficha ao lado, gestor. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const AG = { data: '2026-11-13', hora: '16:00' };
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', dados_claro: {} }, o);
  const lista = [
    L({ id: 1, razao_social: 'Zz Ontem', prox_retorno: '2026-11-12' }),
    L({ id: 2, razao_social: 'Zz Semana', prox_retorno: '2026-11-06' }),
    L({ id: 3, razao_social: 'Zz Hoje Cedo', prox_retorno: '2026-11-13', retorno_hora: '10:00' }),
    L({ id: 4, razao_social: 'Zz Hoje Tarde', prox_retorno: '2026-11-13', retorno_hora: '17:30' }),
    L({ id: 5, razao_social: 'Zz Hoje Sem Hora', prox_retorno: '2026-11-13' }),
    L({ id: 6, razao_social: 'Zz Hoje 16h30', prox_retorno: '2026-11-13', retorno_hora: '16:30' }),
    L({ id: 7, razao_social: 'Zz Renovado', status: 6, linhas_renovadas: 12, status_desde: '2026-11-05T13:00:00Z', prox_retorno: '2026-11-01' }),
    L({ id: 8, razao_social: 'Zz Renovado Out', status: 6, linhas_renovadas: 99, status_desde: '2026-10-30T13:00:00Z' }),
    L({ id: 9, razao_social: 'Zz Negocia', status: 5 }),
    L({ id: 10, razao_social: 'Zz Do B', prox_retorno: '2026-11-10', consultor_id: 'u-b' }),
    L({ id: 11, razao_social: 'Zz Fora', prox_retorno: '2026-11-10', na_base: false }),
  ].concat(Array.from({ length: 12 }, (_, i) => L({ id: 20 + i, razao_social: 'Zz Sug ' + i, status: 1, linhas_voz: i + 1, apto: i === 11 ? '1 MÊS PARA APTO' : 'APTO' })));
  const f = rnFila(lista, AG, '');
  eq(f.atrasados.map(r => r.id), [2, 10, 1, 3], 'atrasados: mais antigo primeiro (inclui hoje com hora passada), na base');
  eq(f.hoje.map(r => r.id), [6, 4, 5], 'hoje: por hora, sem hora no fim');
  eq(f.sugeridos.map(r => r.id), [30, 29, 28, 27, 26, 25, 24, 23, 22, 21], 'sugeridos: 10 maiores APTO não contatados');
  eq(rnFila(lista, AG, 'u-b').atrasados.map(r => r.id), [10], 'filtra por consultor');
  eq(rnFilaPlana(f).length, 17, 'fila plana');
  const propostas = [{ id: 'p1', carteira_id: 9, valor_proposto: 1200, estagio: 'negociacao', criado_em: '2026-11-12T10:00:00Z' },
                     { id: 'p0', carteira_id: 9, valor_proposto: 999, estagio: 'fechado_perdido', criado_em: '2026-11-13T10:00:00Z' }];
  const k = rnKpis(lista, propostas, AG, '');
  eq([k.carteira, k.atrasados, k.vencemHoje, k.negociacao, k.valorNegociacao, k.linhasMes, k.clientesMes], [22, 4, 3, 1, 1200, 12, 1], 'cartões do topo');

  // ==== tela do consultor ====
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista.filter(r => r.consultor_id === 'u-a');
  window.__tabelas.propostas = propostas; window.__tabelas.renovacao_historico = [];
  await rnCarregar();
  await espera(40);
  const kpis = [...document.querySelectorAll('#rnKpis .rnKpi')].map(x => x.textContent.replace(/\\s+/g, ' ').trim());
  assert(/^21 clientes na carteira/.test(kpis[0]) && /^3 retornos atrasados/.test(kpis[1]) && /3 vencem hoje/.test(kpis[1]), 'cartões: carteira e atrasados: ' + kpis.join(' | '));
  assert(/^12 linhas renovadas no mês/.test(kpis[3]) && /1 cliente/.test(kpis[3]), 'cartão de linhas no mês');
  const grupos = [...document.querySelectorAll('#rnFilaLista .rnGrupoT')].map(g => g.textContent.replace(/\\s+/g, ' ').trim());
  eq(grupos, ['⏱ Atrasados 3', '● Hoje 3', '★ Sugeridos 10'], 'três blocos com contagem');
  assert(/há 7 dias/.test(document.querySelector('#rnFilaLista [data-rn-abrir="2"]').textContent), 'atrasado diz há quanto tempo');
  assert(/17:30/.test(document.querySelector('#rnFilaLista [data-rn-abrir="4"]').textContent), 'hoje diz a hora');
  eq([rnEstado.fichaId, document.getElementById('rnFicha').parentElement.id], [2, 'rnHojeFicha'], 'abre sozinha o primeiro da fila, ao lado');
  assert(document.querySelector('#rnFilaLista [data-rn-abrir="2"]').classList.contains('sel'), 'item aberto marcado');
  document.querySelector('#rnFilaLista [data-rn-abrir="4"]').click();
  await espera(30);
  eq(rnEstado.fichaId, 4, 'clicar abre outro');
  assert(document.querySelector('#rnFilaLista [data-rn-abrir="4"]').classList.contains('sel') && !document.querySelector('#rnFilaLista [data-rn-abrir="2"]').classList.contains('sel'), 'marcação acompanha');
  const bh = document.getElementById('rnHojeBusca'); bh.value = 'tarde'; bh.dispatchEvent(new window.Event('input', { bubbles: true }));
  eq([...document.querySelectorAll('#rnFilaLista [data-rn-abrir]')].map(b => b.dataset.rnAbrir), ['4'], 'busca na fila');
  document.getElementById('rnHojeFiltros').click();
  eq([rnEstado.aba, document.getElementById('rnBusca').value, rnEstado.filtros.busca], ['carteira', 'tarde', 'tarde'], 'Filtros leva a busca para a Carteira');
  rnEstado.filtros.busca = ''; document.getElementById('rnBusca').value = ''; rnTrocarAba('hoje');
  bh.value = ''; bh.dispatchEvent(new window.Event('input', { bubbles: true }));

  // trocar de subaba com a ficha aberta
  rnTrocarAba('carteira');
  assert(!document.getElementById('rnFicha').classList.contains('aberta'), 'na Carteira a gaveta fecha');
  rnTrocarAba('hoje');
  eq([rnEstado.fichaId, document.getElementById('rnFicha').parentElement.id], [4, 'rnHojeFicha'], 'de volta à Central, o mesmo cliente ao lado');

  // ==== gestor: Time todo e um consultor ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista;
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  await rnCarregar();
  await espera(40);
  const sel = document.getElementById('rnFConsultor');
  assert(sel.style.display === '' && sel.options[0].textContent === 'Time todo', 'seletor do gestor');
  assert(/Zzb Teste/.test(document.querySelector('#rnFilaLista [data-rn-abrir="10"]').textContent), 'Time todo mostra o consultor');
  sel.value = 'u-b'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  eq([...document.querySelectorAll('#rnFilaLista [data-rn-abrir]')].map(b => b.dataset.rnAbrir), ['10'], 'um consultor: só a fila dele');
  assert(/^1 retornos atrasados|^1 retorno/.test([...document.querySelectorAll('#rnKpis .rnKpi')][1].textContent.trim()), 'cartões do consultor escolhido');
  rnTrocarAba('carteira');
  eq([...document.querySelectorAll('#rnTbody tr[data-rn-id]')].map(t => t.dataset.rnId), ['10'], 'a Carteira respeita o consultor');

  // vazio
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 1, status: 6, linhas_renovadas: 2 })];
  await rnCarregar();
  assert(/Nada atrasado nem para hoje/.test(document.getElementById('rnFilaLista').textContent), 'fila vazia avisa');
  assert(/Escolha um cliente da fila/.test(document.getElementById('rnFichaCorpo').textContent), 'ficha vazia orienta');
  fim();
`);
```

- [ ] **Step 2: Ver falhar.** `python build_painel.py >/dev/null && node test_renovacao_hoje.js` → Expected: `FALHA: ReferenceError: rnFila is not defined`.

- [ ] **Step 3: Implementar**

3a. Em `rnAbrirFicha`, logo depois da linha `  rnEstado.fichaId = id; rnEstado.ficha = { dados: null, historico: null };`, inserir:

```js
  document.querySelectorAll('#rnFilaLista .rnItem').forEach(b => b.classList.toggle('sel', Number(b.dataset.rnAbrir) === id));
```

3b. Em `rnRenderFicha`, trocar `  if(!r){ el.innerHTML = ''; return; }` por `  if(!r){ el.innerHTML = rnEstado.aba === 'hoje' ? '<p class="rnVazio">Escolha um cliente da fila.</p>' : ''; return; }`.

3c. Antes do marcador `FIM RENOVAÇÃO §143`:

```js
// ---- §151 Central do dia ----
function rnPorConsultor(lista, consultor){ return consultor ? lista.filter(r => (consultor === '-' ? !r.consultor_id : r.consultor_id === consultor)) : lista; }
function rnFila(lista, agora, consultor){
  const base = rnPorConsultor(lista, consultor).filter(r => r.na_base);
  const est = new Map(base.map(r => [r.id, rnEstadoRetorno(r, agora)]));
  return {
    atrasados: base.filter(r => est.get(r.id) === 'atrasado').sort(rnOrdemRetorno),
    hoje: base.filter(r => est.get(r.id) === 'hoje').sort(rnOrdemRetorno),
    sugeridos: base.filter(r => r.status === 1 && r.apto === 'APTO' && est.get(r.id) !== 'atrasado' && est.get(r.id) !== 'hoje').sort(rnOrdemLinhas).slice(0, 10),
  };
}
function rnFilaPlana(fila){ return fila.atrasados.concat(fila.hoje, fila.sugeridos); }
function rnListaHoje(){ return rnEstado.lista.filter(r => rnCasaBusca(r, rnEstado.buscaHoje)); }
function rnPropostaAberta(p){ return p.estagio !== 'fechado_ganho' && p.estagio !== 'fechado_perdido'; }
function rnKpis(lista, propostas, agora, consultor){
  const base = rnPorConsultor(lista, consultor).filter(r => r.na_base);
  const mes = agora.data.slice(0, 7);
  const renovMes = base.filter(r => r.status === 6 && r.status_desde && rnDataSP(r.status_desde).slice(0, 7) === mes);
  const neg = base.filter(r => r.status === 5);
  const valor = neg.reduce((s, r) => { const p = (propostas || []).find(x => x.carteira_id === r.id && rnPropostaAberta(x)); return s + (p ? Number(p.valor_proposto) || 0 : 0); }, 0);
  const est = base.map(r => rnEstadoRetorno(r, agora));
  return {
    carteira: base.length,
    pctContatado: base.length ? Math.round(base.filter(r => r.status >= 2).length * 100 / base.length) : 0,
    atrasados: est.filter(e => e === 'atrasado').length,
    vencemHoje: est.filter(e => e === 'hoje').length,
    negociacao: neg.length, valorNegociacao: valor,
    linhasMes: renovMes.reduce((s, r) => s + (Number(r.linhas_renovadas) || 0), 0), clientesMes: renovMes.length,
  };
}
function rnKpiHtml(n, rotulo, sub, cls, barra){
  return `<div class="rnKpi ${cls || ''}"><span class="rnN">${escapeHtml(String(n))}</span><small>${escapeHtml(rotulo)}</small>`
    + (barra != null ? `<div class="rnKpiBar"><span style="width:${Math.max(0, Math.min(100, barra))}%"></span></div>` : '')
    + `<span class="rnKpiSub">${escapeHtml(sub)}</span></div>`;
}
function rnItemFilaHtml(r, tipo, agora, gestor){
  const quando = tipo === 'atrasado' ? '⏱ ' + rnTextoAtraso(r, agora) : tipo === 'hoje' ? (r.retorno_hora ? String(r.retorno_hora).slice(0, 5) : 'hoje') : (r.apto || '');
  const sub = [r.nome_adm, (r.linhas_voz ?? 0) + ' linhas', gestor ? rnNomeConsultor(r.consultor_id) : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="rnItem${rnEstado.fichaId === r.id ? ' sel' : ''}" data-rn-abrir="${r.id}">
    <span class="rnAv">${escapeHtml(rnIniciais(r.razao_social))}</span>
    <span class="rnItemTxt"><b>${escapeHtml(r.razao_social || '(sem nome)')}</b><small>${escapeHtml(sub)}</small></span>
    ${rnEtapaHtml(r.status)}<span class="rnQuando ${tipo}">${escapeHtml(quando)}</span></button>`;
}
function rnRenderHoje(){
  const agora = rnAgora(); const gestor = rnGestor(); const c = rnEstado.filtros.consultor || '';
  rnPreencherFiltros();
  const k = rnKpis(rnEstado.lista, rnEstado.propostas, agora, c);
  document.getElementById('rnKpis').innerHTML =
    rnKpiHtml(k.carteira, 'clientes na carteira', `${k.pctContatado}% já contatados`, '', k.pctContatado)
    + rnKpiHtml(k.atrasados, 'retornos atrasados', `${k.vencemHoje} vencem hoje`, k.atrasados ? 'late' : '')
    + rnKpiHtml(k.negociacao, 'em negociação', k.valorNegociacao ? fmtBRL(k.valorNegociacao) + ' em propostas' : 'sem proposta aberta', '')
    + rnKpiHtml(k.linhasMes, 'linhas renovadas no mês', `${k.clientesMes} cliente${k.clientesMes === 1 ? '' : 's'}`, k.linhasMes ? 'ok' : '');
  const fila = rnFila(rnListaHoje(), agora, c);
  const bloco = (titulo, cls, itens, tipo) => itens.length
    ? `<div class="rnGrupoT ${cls}"><span>${titulo}</span><span class="kbN">${itens.length}</span></div>` + itens.map(r => rnItemFilaHtml(r, tipo, agora, gestor)).join('') : '';
  const vazio = !fila.atrasados.length && !fila.hoje.length ? '<p class="rnVazio">Nada atrasado nem para hoje. 👏</p>' : '';
  document.getElementById('rnFilaLista').innerHTML = vazio
    + bloco('⏱ Atrasados', 'late', fila.atrasados, 'atrasado') + bloco('● Hoje', 'ok', fila.hoje, 'hoje') + bloco('★ Sugeridos', '', fila.sugeridos, 'sugerido');
  const plana = rnFilaPlana(fila);
  if(!rnEstado.fichaId && plana.length) rnAbrirFicha(plana[0].id);
  else rnRenderFicha();
}
document.getElementById('rnFilaLista').addEventListener('click', (e) => { const b = e.target.closest('[data-rn-abrir]'); if(b) rnAbrirFicha(Number(b.dataset.rnAbrir)); });
document.getElementById('rnHojeBusca').addEventListener('input', (e) => { rnEstado.buscaHoje = e.target.value; rnRenderHoje(); });
// "Filtros" leva para a Carteira com a mesma busca
document.getElementById('rnHojeFiltros').addEventListener('click', () => {
  rnEstado.filtros.busca = rnEstado.buscaHoje; document.getElementById('rnBusca').value = rnEstado.buscaHoje;
  rnEstado.pagina = 1; rnTrocarAba('carteira');
});
```

- [ ] **Step 4: Rodar.** `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do echo "$t :: $(node $t 2>&1 | grep -E 'RESULTADO|FALHA' | tail -1)"; done` → Expected: todos com 0 falharam.

- [ ] **Step 5: Commit** `git add -A _template.html test_renovacao_hoje.js && git commit -m "feat(renovacao): Central do dia — fila, cartões e ficha ao lado (§151)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 4: Ficha nova

**Files:**
- Create: `test_renovacao_ficha3.js`
- Modify: `test_renovacao_ficha.js` (se necessário, ver Step 4)
- Modify: `_template.html` (`rnRenderFicha`, listeners e submit da ficha, `rnAbrirFicha`)

**Interfaces:**
- Consumes: `rnFila`, `rnFilaPlana`, `rnListaHoje`, `rnAgora`, `rnSomarDias`, `rnSalvar`, `rnValidarFechamento`, `rnGruposFicha`, `rnHistoricoTexto`, `rnPropostasDe`.
- Produces: `RN_CONTATO`; `rnGrupoContato(s)` → `'retorno'|'renovou'|'perdido'`; `rnEscolherContato(s)`; `rnIrParaProximo(idAtual)`; form `#rnFichaForm` com `name="status"` (oculto), `prox_retorno`, `retorno_hora`, `linhas_renovadas`, `bl_vendida`, `sol_digitais`, `motivo_perda`, `canal`, `observacoes`; `[data-rn-contato]`, `[data-rn-ficha-aba]`, `[data-rn-ficha-sec]`, `[data-rn-canal]`, `[data-rn-proximo]`.

- [ ] **Step 1: Teste (vai falhar)**

Criar `test_renovacao_ficha3.js`:

```js
// Testa a §151 — ficha nova: "Como foi o contato?", retorno com hora, canal, salvar e próximo, abas. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-13'; rnHoraSP = () => '16:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', nome_adm: 'Zz Adm', telefone: '19900000001', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', dados_claro: { SCORE: 7 } }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    L({ id: 1, razao_social: 'Zz Um', prox_retorno: '2026-11-10' }), L({ id: 2, razao_social: 'Zz Dois', prox_retorno: '2026-11-11' }),
    L({ id: 3, razao_social: 'Zz Tres', prox_retorno: '2026-11-13', retorno_hora: '18:00' }), L({ id: 4, razao_social: 'Zz Perdido', status: 7, motivo_perda: 'Preço' }),
  ];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  await rnCarregar(); await espera(40);
  eq(rnEstado.fichaId, 1, 'ficha no primeiro atrasado');
  const form = () => document.getElementById('rnFichaForm');
  const bt = (s) => document.querySelector('#rnFichaForm [data-rn-contato="' + s + '"]');
  eq([...document.querySelectorAll('#rnFichaForm [data-rn-contato]')].map(b => b.textContent.trim()),
     ['Não atendeu', 'Falei com o responsável', 'Mandei proposta', 'Negociando', 'Renovou ✓', 'Perdido'], 'botões do contato');
  assert(bt(3).classList.contains('on') && form().elements.status.value === '3', 'status atual marcado');

  // Não atendeu sugere amanhã na mesma hora; trocar de botão não perde o texto nem grava
  form().elements.prox_retorno.value = '';
  form().elements.observacoes.value = 'Zz caixa postal';
  bt(2).click();
  eq([form().elements.status.value, form().elements.prox_retorno.value, form().elements.retorno_hora.value], ['2', '2026-11-14', '16:00'], 'Não atendeu: amanhã, mesma hora');
  bt(7).click();
  assert(!document.querySelector('[data-rn-grupo="perdido"]').hidden && document.querySelector('[data-rn-grupo="retorno"]').hidden, 'Perdido mostra o motivo no lugar do retorno');
  bt(2).click();
  eq([form().elements.observacoes.value, window.__escritas.length], ['Zz caixa postal', 0], 'trocar de botão não perde o texto nem grava');

  // WhatsApp marca o canal
  document.querySelector('#rnFichaCorpo [data-rn-canal="WhatsApp"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  eq(form().elements.canal.value, 'WhatsApp', 'clicar em WhatsApp marca o canal');

  // Perdido sem motivo e Renovou sem linhas são barrados
  bt(7).click(); form().elements.motivo_perda.value = '';
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(10);
  eq([document.getElementById('rnFichaErro').textContent, window.__escritas.length], ['Escolha o motivo da perda.', 0], 'perdido exige motivo');
  bt(6).click();
  form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await espera(10);
  eq(document.getElementById('rnFichaErro').textContent, 'Informe quantas linhas foram renovadas.', 'renovou exige linhas');

  // Salvar e próximo: grava status/retorno/hora/canal/obs e abre o próximo da fila
  bt(2).click();
  form().elements.prox_retorno.value = '2026-11-20'; form().elements.retorno_hora.value = '09:30';
  document.querySelector('#rnFichaForm [data-rn-proximo]').click();
  await espera(40);
  const w = window.__escritas.find(x => x.tabela === 'renovacao_carteira');
  eq(w.patch, { status: 2, data_contato: '2026-11-13', prox_retorno: '2026-11-20', retorno_hora: '09:30', canal: 'WhatsApp', observacoes: 'Zz caixa postal' }, 'grava o atendimento com o contato de hoje');
  eq(rnEstado.fichaId, 2, 'abre o próximo (o 1 saiu da fila)');
  assert(!document.querySelector('#rnFilaLista [data-rn-abrir="1"]'), 'o cliente salvo saiu da fila');
  window.__escritas.length = 0;
  document.querySelector('#rnFichaForm [data-rn-proximo]').click();
  await espera(40);
  eq([window.__escritas.length, rnEstado.fichaId], [0, 3], 'sem mudança: não grava e vai para o próximo');

  // abas da ficha
  const aba = (k) => document.querySelector('#rnFichaCorpo [data-rn-ficha-aba="' + k + '"]');
  aba('dados').click();
  assert(!document.querySelector('[data-rn-ficha-sec="dados"]').hidden && document.querySelector('[data-rn-ficha-sec="atendimento"]').hidden, 'aba Dados da Claro');
  assert(/SCORE/.test(document.querySelector('[data-rn-ficha-sec="dados"]').textContent), 'mostra os dados da Claro');
  aba('atendimento').click();

  // perdido: sem Gerar proposta; fora da Central só "Salvar"
  rnTrocarAba('carteira'); await rnAbrirFicha(4);
  assert(!document.querySelector('#rnFichaCorpo [data-rn-gerar]') && /Reabra o status/.test(document.getElementById('rnFichaCorpo').textContent), 'perdido sem Gerar proposta');
  assert(!document.querySelector('#rnFichaForm [data-rn-proximo]'), 'fora da Central não tem Salvar e próximo');
  fim();
`);
```

- [ ] **Step 2: Ver falhar.** `python build_painel.py >/dev/null && node test_renovacao_ficha3.js` → Expected: `FALHOU: botões do contato`.

- [ ] **Step 3: Implementar**

3a. Em `rnAbrirFicha`, depois da linha `  rnEstado.fichaId = id; rnEstado.ficha = { dados: null, historico: null };`, inserir `  rnEstado.fichaStatus = null; rnEstado.fichaAba = 'atendimento';`.

3b. Trocar a função `rnRenderFicha` inteira (de `function rnRenderFicha(){` até antes de `document.getElementById('rnFicha').addEventListener('click', (e) => { if(e.target.closest('[data-rn-ficha-fechar]')) rnFecharFicha(); });`) por:

```js
const RN_CONTATO = [[2, 'Não atendeu'], [3, 'Falei com o responsável'], [4, 'Mandei proposta'], [5, 'Negociando'], [6, 'Renovou ✓'], [7, 'Perdido']];
function rnGrupoContato(s){ return s === 6 ? 'renovou' : s === 7 ? 'perdido' : 'retorno'; }
function rnRenderFicha(){
  const el = document.getElementById('rnFichaCorpo');
  const r = rnEstado.lista.find(x => x.id === rnEstado.fichaId);
  if(!r){ el.innerHTML = rnEstado.aba === 'hoje' ? '<p class="rnVazio">Escolha um cliente da fila.</p>' : ''; return; }
  const tel = onlyDigits(r.telefone);
  const cnpj = String(r.cnpj_digits || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const fic = rnEstado.ficha || {};
  const sel = rnEstado.fichaStatus || r.status;
  const aba = rnEstado.fichaAba || 'atendimento';
  const grupo = rnGrupoContato(sel);
  const props = rnPropostasDe(r.id);
  const esconde = (cond) => (cond ? '' : ' hidden');
  const hora = r.retorno_hora ? String(r.retorno_hora).slice(0, 5) : '';
  el.innerHTML = `
    <div class="rnFichaTopo">
      <span class="rnAv">${escapeHtml(rnIniciais(r.razao_social))}</span>
      <div style="flex:1;min-width:0"><h3 class="rnFichaNome">${escapeHtml(r.razao_social || '(sem nome)')}</h3>
        <div class="rnFichaMeta">${escapeHtml([cnpj, r.cidade, (r.linhas_voz ?? 0) + ' linhas', r.apto].filter(Boolean).join(' · '))}</div></div>
      ${rnEtapaHtml(r.status)}
      <button type="button" class="kbBtn kbBtnG kbBtnIco" data-rn-ficha-fechar aria-label="Fechar">&times;</button>
    </div>
    <div class="rnFichaAcoes">${tel
      ? `<a class="kbBtn kbBtnP" data-rn-canal="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/55${escapeHtml(tel.replace(/^55/, ''))}">WhatsApp</a><a class="kbBtn kbBtnQ" data-rn-canal="Ligação" href="tel:${escapeHtml(tel)}">Ligar</a>`
      : '<span class="kbMeta">Sem telefone.</span>'}${r.status >= 6 ? '<span class="kbMeta">Reabra o status para gerar proposta.</span>' : `<button type="button" class="kbBtn kbBtnQ" data-rn-gerar="${r.id}">Gerar proposta</button>`}</div>
    <nav class="rnFichaAbas" aria-label="Ficha do cliente">${[['atendimento', 'Atendimento'], ['dados', 'Dados da Claro'], ['propostas', 'Propostas · ' + props.length], ['historico', 'Histórico']]
      .map(([k, t]) => `<button type="button" data-rn-ficha-aba="${k}" class="${aba === k ? 'on' : ''}">${escapeHtml(t)}</button>`).join('')}</nav>
    <section data-rn-ficha-sec="atendimento"${esconde(aba === 'atendimento')}>
      <form id="rnFichaForm">
        <input type="hidden" name="status" value="${sel}">
        <p class="rnPergunta">Como foi o contato?</p>
        <div class="rnContato">${RN_CONTATO.map(([s, t]) => `<button type="button" class="rnContatoBt${s === sel ? ' on rnSt' + s : ''}" data-rn-contato="${s}">${escapeHtml(t)}</button>`).join('')}</div>
        <div class="rnCampos" data-rn-grupo="retorno"${esconde(grupo === 'retorno')}>
          <label>Próximo retorno<input type="date" name="prox_retorno" value="${escapeHtml(r.prox_retorno || '')}"></label>
          <label>Hora<input type="time" name="retorno_hora" value="${escapeHtml(hora)}"></label>
        </div>
        <div class="rnCampos" data-rn-grupo="renovou"${esconde(grupo === 'renovou')}>
          <label>Linhas renovadas *<input type="number" min="0" name="linhas_renovadas" value="${r.linhas_renovadas ?? ''}"></label>
          <label>BL vendida (qtd)<input type="number" min="0" name="bl_vendida" value="${r.bl_vendida ?? ''}"></label>
          <label class="rnLargo">Soluções digitais (R$)<input type="number" min="0" step="0.01" name="sol_digitais" value="${r.sol_digitais ?? ''}"></label>
        </div>
        <div class="rnCampos" data-rn-grupo="perdido"${esconde(grupo === 'perdido')}>
          <label class="rnLargo">Motivo da perda *<select name="motivo_perda">${rnOpcoes(RN_MOTIVOS.map(m => [m, m]), r.motivo_perda, 'Escolha…')}</select></label>
        </div>
        <div class="rnCampos">
          <label>Canal<select name="canal">${rnOpcoes(RN_CANAIS.map(c => [c, c]), r.canal, '—')}</select></label>
          <label class="rnLargo">Observação<textarea name="observacoes" rows="3">${escapeHtml(r.observacoes || '')}</textarea></label>
        </div>
        <p class="rnErro" id="rnFichaErro" role="alert"></p>
        <div class="rnFichaRodape">${rnEstado.aba === 'hoje'
          ? '<button type="submit" class="kbBtn kbBtnQ">Salvar</button><button type="submit" class="kbBtn kbBtnP" data-rn-proximo>Salvar e próximo →</button>'
          : '<button type="submit" class="kbBtn kbBtnP">Salvar</button>'}</div>
      </form>
    </section>
    <section data-rn-ficha-sec="dados"${esconde(aba === 'dados')}>${fic.dados
      ? rnGruposFicha(fic.dados).map(([t, itens]) => `<details class="rnGrupo"><summary>${escapeHtml(t)} <span class="kbMeta">${itens.length}</span></summary><dl>${itens.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl></details>`).join('')
      : '<p class="kbMeta">Carregando dados da Claro…</p>'}</section>
    <section data-rn-ficha-sec="propostas"${esconde(aba === 'propostas')}>${props.length
      ? '<ul class="rnHist">' + props.map(p => `<li><button type="button" class="rnNome" data-rn-proposta="${escapeHtml(p.id)}">${p.valor_atual ? fmtBRL(p.valor_atual) : '—'} → ${p.valor_proposto ? fmtBRL(p.valor_proposto) : '—'}</button> · ${escapeHtml(new Date(p.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} · ${escapeHtml(FUNIL_ESTAGIO_MAP[p.estagio] ? FUNIL_ESTAGIO_MAP[p.estagio].label : p.estagio)}</li>`).join('') + '</ul>'
      : '<p class="kbMeta">Nenhuma proposta ainda.</p>'}</section>
    <section data-rn-ficha-sec="historico"${esconde(aba === 'historico')}>${fic.historico
      ? (fic.historico.length ? '<ul class="rnHist">' + fic.historico.map(h => `<li>${escapeHtml(rnHistoricoTexto(h))}</li>`).join('') + '</ul>' : '<p class="kbMeta">Sem mudanças registradas.</p>')
      : '<p class="kbMeta">Carregando…</p>'}</section>`;
}
function rnEscolherContato(s){
  const form = document.getElementById('rnFichaForm');
  if(!form) return;
  rnEstado.fichaStatus = s;
  form.elements.status.value = String(s);
  form.querySelectorAll('[data-rn-contato]').forEach(b => { const on = Number(b.dataset.rnContato) === s; b.className = 'rnContatoBt' + (on ? ' on rnSt' + s : ''); });
  const g = rnGrupoContato(s);
  form.querySelectorAll('[data-rn-grupo]').forEach(d => { d.hidden = d.dataset.rnGrupo !== g; });
  if(s === 2 && !form.elements.prox_retorno.value){ const a = rnAgora(); form.elements.prox_retorno.value = rnSomarDias(a.data, 1); form.elements.retorno_hora.value = a.hora; }
  document.getElementById('rnFichaErro').textContent = '';
}
function rnIrParaProximo(idAtual){
  const plana = rnFilaPlana(rnFila(rnListaHoje(), rnAgora(), rnEstado.filtros.consultor || ''));
  const i = plana.findIndex(x => x.id === idAtual);
  const prox = plana.slice(i + 1).find(x => x.id !== idAtual) || plana.find(x => x.id !== idAtual);
  if(prox) rnAbrirFicha(prox.id);
  else { rnEstado.fichaId = null; rnRenderFicha(); }
}
document.getElementById('rnFicha').addEventListener('click', (e) => {
  const c = e.target.closest('[data-rn-contato]');
  if(c){ rnEscolherContato(Number(c.dataset.rnContato)); return; }
  const a = e.target.closest('[data-rn-ficha-aba]');
  if(a){
    rnEstado.fichaAba = a.dataset.rnFichaAba;
    document.querySelectorAll('#rnFicha [data-rn-ficha-aba]').forEach(b => b.classList.toggle('on', b === a));
    document.querySelectorAll('#rnFicha [data-rn-ficha-sec]').forEach(s => { s.hidden = s.dataset.rnFichaSec !== rnEstado.fichaAba; });
    return;
  }
  const k = e.target.closest('[data-rn-canal]');
  if(k){ const sel = document.querySelector('#rnFichaForm [name="canal"]'); if(sel) sel.value = k.dataset.rnCanal; }
});
```

3c. Trocar o submit da ficha inteiro (de `document.getElementById('rnFicha').addEventListener('submit', async (e) => {` até antes de `// ---- Datas ----`) por:

```js
document.getElementById('rnFicha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = rnEstado.lista.find(x => x.id === rnEstado.fichaId);
  if(!r) return;
  const els = e.target.elements;
  const ler = (k) => (els[k] ? (els[k].value === '' ? null : els[k].value) : undefined);
  const num = (k) => { const x = ler(k); return x == null ? x : Number(x); };
  const status = Number(ler('status'));
  const patch = { status };
  // apertar um botão de "Como foi o contato?" = contato feito hoje (o gatilho do banco só preenche a primeira vez)
  if(rnEstado.fichaStatus) patch.data_contato = rnHoje();
  if(status <= 5){ patch.prox_retorno = ler('prox_retorno'); patch.retorno_hora = ler('retorno_hora'); }
  if(status === 6){ patch.linhas_renovadas = num('linhas_renovadas'); patch.bl_vendida = num('bl_vendida'); patch.sol_digitais = num('sol_digitais'); }
  if(status === 7) patch.motivo_perda = ler('motivo_perda');
  patch.canal = ler('canal');
  patch.observacoes = (ler('observacoes') || '').trim() || null;
  Object.keys(patch).forEach(k => { if(patch[k] === undefined) delete patch[k]; });
  // legado da planilha (a_completar): mesma regra do banco — só cobra quando o status muda
  const erro = r.a_completar && status === r.status ? null : rnValidarFechamento(status, Object.assign({}, r, patch));
  if(erro){ document.getElementById('rnFichaErro').textContent = erro; return; }
  // só o que mudou: não apaga o que outra pessoa gravou enquanto a ficha estava aberta (hora: o banco devolve HH:MM:SS)
  const igual = (k) => (k === 'retorno_hora' ? String(patch[k] ?? '').slice(0, 5) === String(r[k] ?? '').slice(0, 5) : String(patch[k] ?? '') === String(r[k] ?? ''));
  const mudou = {};
  Object.keys(patch).forEach(k => { if(!igual(k)) mudou[k] = patch[k]; });
  const proximo = !!(e.submitter && e.submitter.hasAttribute('data-rn-proximo'));
  if(!Object.keys(mudou).length){ if(proximo) rnIrParaProximo(r.id); else mostrarAviso('Nada mudou no atendimento.', 'info'); return; }
  const antes = rnEstado.fichaStatus;
  rnEstado.fichaStatus = null;
  if(await rnSalvar(r.id, mudou)){ mostrarAviso('Atendimento salvo.', 'ok'); if(proximo) rnIrParaProximo(r.id); }
  else rnEstado.fichaStatus = antes;
});
```

- [ ] **Step 4: Rodar.** `python build_painel.py >/dev/null && for t in test_renovacao_*.js test_funil.js; do echo "$t :: $(node $t 2>&1 | grep -E 'RESULTADO|PASSARAM|FALHA' | tail -1)"; done` → Expected: todos 0 falharam. Se `test_renovacao_ficha.js` acusar `grupos na ficha` ou `histórico legível`, é porque o texto agora está em seções ocultas: os seletores continuam valendo (o conteúdo existe no DOM); se falhar o `form.elements.observacoes`/`prox_retorno`, conferir que o teste abre a ficha de um cliente com status ≤ 5 (os campos existem sempre).

- [ ] **Step 5: Commit** `git add -A _template.html test_renovacao_*.js && git commit -m "feat(renovacao): ficha nova — Como foi o contato?, retorno com hora, Salvar e próximo (§151)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 5: Funil, Resumo e Importar numa janela

**Files:**
- Create: `test_renovacao_resumo2.js`
- Delete: `test_renovacao_resumo.js`
- Modify: `test_renovacao_kanban.js`
- Modify: `_template.html` (`rnCartaoHtml`, `rnRenderKanban`, `rnRenderResumo`, listeners do `#rnResumo`)

**Interfaces:**
- Consumes: `rnEtapaHtml`, `rnDiasNoStatus`, `rnPropostasDe`, `rnPropostaAberta`, `rnKanbanColunas`, `rnLinhasResumo`, `rnImportarHtml`, `fecharOverlay`.
- Produces: cartão do Funil com `.rnParado` ("parado há N dias", `.late` a partir de 7 dias em 3–5); Resumo com `.rnKpis`, `.rnResumoTbl`, `[data-rn-abrir-importar]`, `#rnImportar` (overlay com a importação de hoje).

- [ ] **Step 1: Teste (vai falhar)**

Criar `test_renovacao_resumo2.js`:

```js
// Testa a §151 — Resumo redesenhado (fórmulas da planilha) e Funil com "parado há". DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const rows = [
    { consultor_id: 'u-b', consultor_nome: 'Zzbruno', carteira: 414, contatados: 32, efetivo_mais: 16, propostas_mais: 4, renovados: 2, perdidos: 11, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 2, a_completar: 0 },
    { consultor_id: 'u-f', consultor_nome: 'Zzfabiana', carteira: 414, contatados: 84, efetivo_mais: 20, propostas_mais: 11, renovados: 4, perdidos: 24, linhas_renovadas: 19, bl_vendida: 1, sol_digitais: 0, retornos_atrasados: 22, a_completar: 0 },
    { consultor_id: 'u-s', consultor_nome: 'Zzsilvana', carteira: 414, contatados: 165, efetivo_mais: 17, propostas_mais: 8, renovados: 2, perdidos: 17, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: '0.00', retornos_atrasados: 0, a_completar: 0 },
  ];
  const r = rnLinhasResumo(rows);
  eq([r.total.carteira, r.total.contatados, r.total.cobertura, r.total.efetivo, r.total.propostas, r.total.renovados, r.total.perdidos, r.total.conversao, r.total.linhas, r.total.atrasados],
     [1242, 281, 22.6, 53, 23, 8, 52, 15.1, 19, 24], 'TOTAL igual à planilha');

  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = []; window.__tabelas.profiles = []; window.__tabelas.propostas = [];
  window.__tabelas.renovacao_resumo = rows;
  await rnCarregar();
  rnTrocarAba('resumo'); await espera(30);
  const kpis = [...document.querySelectorAll('#rnResumo .rnKpi')].map(k => k.textContent.replace(/\\s+/g, ' ').trim());
  eq(kpis, ['1.242 clientes na carteira', '22,6% contatados (281)', '15,1% conversão (8 de 53)', '24 retornos atrasados'], 'cartões do Resumo');
  const tr = [...document.querySelectorAll('#rnResumo tbody tr')].map(t => [...t.children].map(td => td.textContent.replace(/\\s+/g, ' ').trim()));
  eq(tr.length, 4, '3 consultores + TOTAL');
  eq(tr[3].slice(0, 7), ['TOTAL', '1242', '22,6%', '15,1%', '23', '8', '52'], 'linha TOTAL');
  const ov = document.getElementById('rnImportar');
  assert(!!ov && !ov.classList.contains('active') && !!document.getElementById('rnArquivo'), 'importação fica numa janela fechada');
  document.querySelector('#rnResumo [data-rn-abrir-importar]').click();
  assert(ov.classList.contains('active'), 'botão abre a importação');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex' };
  await rnRenderResumo();
  assert(!document.querySelector('#rnResumo [data-rn-abrir-importar]'), 'supervisor não importa');

  // Funil: parado há N dias, vermelho a partir de 7 em 3–5
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
  window.__tabelas.renovacao_carteira = [
    { id: 1, razao_social: 'Zz Parado', linhas_voz: 3, status: 3, na_base: true, consultor_id: 'u-a', status_desde: dias(8) },
    { id: 2, razao_social: 'Zz Recente', linhas_voz: 3, status: 4, na_base: true, consultor_id: 'u-a', status_desde: dias(2) },
    { id: 3, razao_social: 'Zz Ganho', linhas_voz: 3, status: 6, linhas_renovadas: 3, na_base: true, consultor_id: 'u-a', status_desde: dias(30) },
  ];
  await rnCarregar(); rnTrocarAba('kanban');
  const p1 = document.querySelector('#rnKanban [data-rn-card="1"] .rnParado'), p2 = document.querySelector('#rnKanban [data-rn-card="2"] .rnParado');
  assert(p1 && p1.classList.contains('late') && /parado há 8 dias/.test(p1.textContent), 'parado há 8 dias em vermelho');
  assert(p2 && !p2.classList.contains('late') && /parado há 2 dias/.test(p2.textContent), 'parado há 2 dias sem alarme');
  assert(!document.querySelector('#rnKanban [data-rn-card="3"] .rnParado') && /3 renovadas/.test(document.querySelector('#rnKanban [data-rn-card="3"]').textContent), 'renovado sem "parado", com as linhas');
  assert(/Contato efetivo/.test(document.querySelector('#rnKanban [data-rn-coluna="3"] .rnKbHead').textContent), 'coluna com a etiqueta da etapa');
  fim();
`);
```

- [ ] **Step 2: Ver falhar.** `python build_painel.py >/dev/null && node test_renovacao_resumo2.js` → Expected: `FALHOU: cartões do Resumo`.

- [ ] **Step 3: Implementar**

3a. Trocar as funções `rnCartaoHtml` e `rnRenderKanban` inteiras por:

```js
function rnCartaoHtml(r, agora, gestor){
  const props = rnPropostasDe(r.id);
  const p = props.find(rnPropostaAberta) || (r.status >= 6 ? props[0] : null);
  const dias = rnDiasNoStatus(r, agora);
  const late = dias !== null && dias >= 7 && r.status >= 3 && r.status <= 5;
  const parado = dias === null || r.status >= 6 ? '' : dias === 0 ? 'nesta etapa desde hoje' : `parado há ${dias} dia${dias > 1 ? 's' : ''}`;
  const sub = [`${r.linhas_voz ?? 0} linhas`, p && p.valor_proposto ? fmtBRL(p.valor_proposto) : '', r.status === 6 && r.linhas_renovadas ? `${r.linhas_renovadas} renovadas` : '',
    r.status === 7 && r.motivo_perda ? r.motivo_perda : '', gestor ? rnNomeConsultor(r.consultor_id) : ''].filter(Boolean).join(' · ');
  return `<div class="rnKbCard" draggable="true" data-rn-card="${r.id}">
    <button type="button" class="rnNome" data-rn-abrir="${r.id}">${escapeHtml(r.razao_social || '(sem nome)')}</button>
    <small>${escapeHtml(sub)}</small>
    ${parado ? `<span class="rnParado${late ? ' late' : ''}">${late ? '⏱ ' : ''}${escapeHtml(parado)}</span>` : ''}
    ${r.status >= 6 ? '' : `<button type="button" class="kbBtn kbBtnG kbBtnSm" data-rn-gerar="${r.id}">Gerar proposta</button>`}
  </div>`;
}
function rnRenderKanban(){
  const agora = Date.now(); const gestor = rnGestor();
  rnPreencherFiltros();
  document.getElementById('rnKanban').innerHTML = '<div class="rnKanban">' + rnKanbanColunas(rnEstado.lista, rnEstado.filtros, rnHoje()).map(c => `
    <div class="rnKbCol" data-rn-coluna="${c.status}">
      <div class="rnKbHead">${rnEtapaHtml(c.status)}<span class="kbN">${c.itens.length}</span></div>
      ${c.itens.map(r => rnCartaoHtml(r, agora, gestor)).join('') || '<p class="rnVazio">Nenhum cliente.</p>'}
    </div>`).join('') + '</div>';
}
```

3b. Trocar a função `rnRenderResumo` inteira por:

```js
async function rnRenderResumo(){
  const el = document.getElementById('rnResumo');
  const r = await ppSeguro(() => sb.from('renovacao_resumo').select('*'));
  if(rnEstado.aba !== 'resumo') return;
  if(!r || r.error){ el.innerHTML = '<p class="rnVazio">Não foi possível carregar o resumo agora.</p>'; return; }
  const { corpo, total } = rnLinhasResumo(r.data || []);
  const fp = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const fr = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const barra = (v, cls) => `<span class="rnBarra ${cls || ''}"><span><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span>${fp(v)}</span>`;
  const kpi = (n, t, cls) => `<div class="rnKpi ${cls || ''}"><span class="rnN">${escapeHtml(String(n))}</span><small>${escapeHtml(t)}</small></div>`;
  const tr = (l, cls) => `<tr class="${cls || ''}"><td>${escapeHtml(l.nome)}</td><td class="rnNumTd">${l.carteira}</td><td>${barra(l.cobertura)}</td><td>${barra(l.conversao, 'ok')}</td>`
    + `<td>${l.propostas}</td><td>${l.renovados}</td><td>${l.perdidos}</td><td>${l.linhas}</td><td>${l.bl}</td><td>${fr(l.digitais)}</td><td class="${l.atrasados ? 'rnLate' : ''}">${l.atrasados}</td></tr>`;
  el.innerHTML = `<div class="rnKpis">${kpi(total.carteira.toLocaleString('pt-BR'), 'clientes na carteira')}${kpi(fp(total.cobertura), `contatados (${total.contatados})`)}`
    + `${kpi(fp(total.conversao), `conversão (${total.renovados} de ${total.efetivo})`, 'ok')}${kpi(total.atrasados, 'retornos atrasados', total.atrasados ? 'late' : '')}</div>`
    + `<div class="rnTabelaCasa"><table class="rnTabela rnResumoTbl"><thead><tr><th>Consultor</th><th>Carteira</th><th>Cobertura</th><th>Conversão</th><th>Propostas+</th><th>Renovados</th><th>Perdidos</th><th>Linhas renov.</th><th>BL</th><th>Sol. dig. (R$)</th><th>Atrasados</th></tr></thead>`
    + `<tbody>${corpo.map(l => tr(l)).join('')}${corpo.length > 1 ? tr(total, 'rnTotal') : ''}</tbody></table></div>`
    + (currentUser && currentUser.role === 'admin' && typeof rnImportarHtml === 'function'
      ? `<div class="rnResumoRodape"><button type="button" class="kbBtn kbBtnQ" data-rn-abrir-importar>Importar base</button></div>`
        + `<div class="overlay" id="rnImportar"><div class="modal" role="dialog" aria-modal="true" aria-label="Importar base"><div class="mHead"><button type="button" class="mClose" data-rn-fechar-importar aria-label="Fechar">&times;</button><h2>Importar base</h2></div><div class="mBody">${rnImportarHtml()}</div></div></div>`
      : '');
}
```

3c. Depois da linha `document.getElementById('rnResumo').addEventListener('click', (e) => { if(e.target.closest('[data-rn-importar]')) rnExecutarImportacao(); });`, inserir:

```js
document.getElementById('rnResumo').addEventListener('click', (e) => {
  if(e.target.closest('[data-rn-abrir-importar]')){ const ov = document.getElementById('rnImportar'); if(ov) ov.classList.add('active'); return; }
  if(e.target.closest('[data-rn-fechar-importar]')){ const ov = document.getElementById('rnImportar'); if(ov) fecharOverlay(ov); }
});
```

3d. Testes antigos: `git rm test_renovacao_resumo.js` (a subaba Retornos acabou; o Resumo está no `test_renovacao_resumo2.js`). Em `test_renovacao_kanban.js`, trocar `assert(/no status/.test(card3), 'cartão mostra os dias no status');` por `assert(/parado há/.test(card3), 'cartão mostra há quanto tempo está parado');`.

- [ ] **Step 4: Rodar.** `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do echo "$t :: $(node $t 2>&1 | grep -E 'RESULTADO|FALHA' | tail -1)"; done` → Expected: todos 0 falharam (inclui `test_renovacao_importar.js`, que abre a importação dentro do `#rnResumo`).

- [ ] **Step 5: Commit** `git add -A _template.html test_renovacao_*.js && git commit -m "feat(renovacao): Funil e Resumo no visual novo, importação numa janela (§151)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 6: Documentação, testes e conferência

- [ ] **Step 1: REGRAS.** Antes da linha `Próxima livre: …`, inserir a seção:

```markdown
## §151 Redesign da aba Renovação: "Central do dia" (13/11/2026)

Pedido do Rafael ("redesign COMPLETO dessa aba… bonito, fácil de usar e claro"). Spec:
`docs/superpowers/specs/2026-11-13-renovacao-redesign-design.md` (mockups aprovados em `docs/superpowers/specs/assets/`).

- **Subabas:** Hoje · Carteira · Funil · Resumo · Proposta e fatura. A subaba Retornos acabou (virou Atrasados e Hoje da Central).
- **Hoje (Central do dia):** 4 cartões (carteira com % contatado, retornos atrasados e de hoje, em negociação com o valor das
  propostas abertas, **linhas renovadas no mês**); fila em três blocos (Atrasados do mais antigo, Hoje por hora, 10 Sugeridos =
  maiores APTO não contatados) com a ficha ao lado; gestor escolhe "Time todo" ou um consultor (vale para todas as subabas).
- **Ficha:** "Como foi o contato?" com botões (Não atendeu=2 · Falei com o responsável=3 · Mandei proposta=4 · Negociando=5 ·
  Renovou=6 · Perdido=7); retorno com **data e hora**; WhatsApp/Ligar marcam o canal; "Salvar e próximo" na Central; abas
  Atendimento · Dados da Claro · Propostas · Histórico.
- **Retorno com hora:** coluna `renovacao_carteira.retorno_hora`. Atrasado = data antes de hoje ou hoje com a hora já passada
  (SP); a view `renovacao_resumo` usa a mesma regra. Retornos antigos continuam só com a data.
- **Carteira:** visões com contagem (Todos, Não contatados, Em andamento, Atrasados, Pendências, Renovados, Perdidos, Fora da
  base), "Mais filtros" (cidade, DDD, apto) com etiquetas ✕, ordem por linhas ou por retorno, 50 por vez, nada editável na
  linha (clicar abre a ficha).
- **Funil:** cartão com "parado há N dias" (vermelho a partir de 7 dias em Contato efetivo, Proposta e Negociação).
- **Resumo:** cartões + tabela com barras; Importar base (admin) numa janela.
- Visual: linguagem do §126 (tokens `--ml-*` valem também em `#panel-renovacao` e `#rnFicha`); etapas com `--rn-st1…7`.
- Banco: migration `20261113150000_renovacao_retorno_hora.sql`; conferência `supabase/tests/renovacao_retorno_hora_check.sql`.
```

e trocar a linha `Próxima livre: …` por `Próxima livre: §152 (§138.2 e §138.3 reservadas; §150 reservada pela biometria em Pedidos em Alerta).`

- [ ] **Step 2: Testes.** `python build_painel.py`; rodar `test_renovacao_*.js`, `test_funil.js`, `test_tipo_avulsa.js`, `test_analisar_fatura.js`, `test_proposta_manual.js`, `test_reorganizacao_abas.js`, `test_sidebar_nav.js`, `test_agencia_lista.js`, `test_conversao_leads.js`, `test_meus_leads_redesign.js`, `test_leads_kanban.js`. Expected: 0 falharam (exceto as falhas antigas conhecidas do oficial: `redesign_shell` 39/1, `proposta_timbrada`/`proposta_manual_docs` sem `docx`).

- [ ] **Step 3: HTML.** Conferir `<div>` abre = fecha no `#panel-renovacao` e diferença do arquivo igual à do `oficial/main`:

```bash
python - <<'EOF'
import re, subprocess
h = open('_template.html', encoding='utf-8').read()
s = h[h.index('id="panel-renovacao"'):]; s = s[:s.index('</section>')]
print('renovacao: div', len(re.findall(r'<div\b', s)), '/', len(re.findall(r'</div>', s)))
o = subprocess.run(['git', 'show', 'oficial/main:_template.html'], capture_output=True, encoding='utf-8').stdout
for n, x in (('branch', h), ('oficial', o)): print(n, len(re.findall(r'<div\b', x)) - len(re.findall(r'</div>', x)))
EOF
```

- [ ] **Step 4: Commit** `git add REGRAS_NEGOCIO.md && git commit -m "docs(regras): §151 redesign da aba Renovação" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`

---

### Task 7: Produção (cada passo com ok do Rafael)

- [ ] **Step 1: Banco (ok).** Aplicar `20261113150000_renovacao_retorno_hora.sql` com `execute_sql`; conferir a coluna e rodar `renovacao_retorno_hora_check.sql` (rollback) no banco real. **O banco vem antes do painel** (o painel novo lê `retorno_hora`).
- [ ] **Step 2: Painel (ok).** `git fetch oficial` e juntar se andou; build; comparar o ar com o gerado do oficial; envio com temporário + conferência do MD5 do ar no mesmo comando + backup; conferir pela URL pública; REGRAS com MD5/backup; push oficial; `vigia_painel.ps1 -Aceitar`.
