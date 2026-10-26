# Meus leads (Kanban) com espelho na planilha: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a equipe de leads pega e classifica os leads numa aba Kanban "Meus leads" do painel. O banco passa a ser a fonte da verdade, e a planilha do Google vira um espelho escrito sozinho por uma fila.

**Architecture:**
- RPCs `security definer` fazem pegar, classificar e redistribuir em `public.leads`, gravam `leads_historico` e enfileiram `leads_espelho`.
- A Edge Function `planilha-espelho` roda a cada minuto pelo pg_cron, autenticada com a conta de serviço do Google (`GOOGLE_SA_JSON`). Ela faz duas coisas:
  1. lê a guia de entrada do formulário e insere os leads novos;
  2. esvazia a fila escrevendo CONSULTOR, STATUS, OBS, CONVERTEU? e RECEITA na guia do mês, achando a guia pelo nome e a linha pelo id.
- A tela é um Kanban em `_template.html` com funções puras `kb*` testadas no jsdom.

**Tech Stack:**
- Postgres (Supabase `apex`, mdgfboijyqfkggcrhptn) com plpgsql e pg_cron/pg_net.
- Edge Functions em Deno/TypeScript, testadas com `node --test` (Node 24, que lê `.ts` direto).
- Google Sheets API v4 com JWT RS256 assinado via WebCrypto.
- Painel em HTML/JS único (`_template.html` → `build_painel.py`) com testes jsdom (`run_tests.sh`).

**Spec:** `docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md`

## Global Constraints

- Partir sempre de `oficial/main` no worktree `.worktrees/leads-kanban` (branch `feat/leads-kanban`). Dar `git fetch oficial` antes de qualquer merge ou push. Push **sem** force.
- **Repositório público:** nada de chave, token, JSON da conta de serviço, telefone, CNPJ, nome ou e-mail real em arquivo do repositório (inclusive testes). Os testes usam dados fictícios (`Zz…`, `00000000000101`, `@teste.invalid`).
- **Banco de produção:** leitura livre. Migration, DDL, escrita e deploy só com **ok do Rafael na hora**.
- SQL pelo conector: `execute_sql` em partes de **≤ ~8 KB**, cada parte com `begin; … commit;`. O `apply_migration` do conector falha ("Invalid or expired requestState").
- Teste de banco (`supabase/tests/*_check.sql`): sempre termina em `ROLLBACK` e usa dados fictícios no ano 2000.
- Design "Sinal de Ápice" (CLAUDE.md):
  - não mexer no `<style>` base, no `aside.sidebar`, no `#pageHead`, no `ApexMotion`, no `mostrarAviso` nem no `fecharOverlay`;
  - CSS novo só num `<style id="kbStyles">` próprio, com `var(--…)`. Nenhuma cor em hex;
  - avisos com `mostrarAviso(msg,'ok'|'erro'|'info')`, nunca `alert()`.
- Editar só `_template.html`. Gerar com `python build_painel.py` e testar com `bash run_tests.sh`. O node_modules vem emprestado (ver Task 0).
- Seção do REGRAS: **§112**.
- Valores fixos da spec:
  - limite de leads por consultor: **nenhum**;
  - entrada de lead novo e escrita na planilha: cron **a cada 10 s** (pedido do Rafael, 26/10: "o lead não consegue entrar em 10 segundos?");
  - Kanban: verifica a cada **10 s** uma versão leve (`leads_kanban_versao`) e só recarrega tudo quando ela muda;
  - Livres mostram os **20** mais novos e um "ver mais";
  - aviso de atraso da planilha depois de **15 min**;
  - espera entre tentativas: **1, 2, 5, 10, 30 min**;
  - lote da fila: **100** itens.
- Guia do mês nova é **criada pelo time**. O código nunca cria guia: espera e avisa.
- Status com o texto exato da planilha (tabela `leads_status_opcoes`). Escrita com `valueInputOption=RAW`.
- Nos Livres, o consultor **não recebe** telefone, e-mail nem CNPJ. Admin e supervisor recebem.

## Review Focus

Cinco situações que a spec implica e que nenhum teste "natural" pega. Cada uma tem um teste adicionado na tarefa dona:

1. **Guia de outro produto com o mesmo mês** ("LEADS FIBRA CLARO APEX - SETEMBRO"): o espelho nunca pode escrever lead Claro nela. É filtrado por `guia_mes_contem = "CLARO B2B"`. Teste na Task 4.
2. **Duas rodadas do cron ao mesmo tempo** (uma rodada passou de 1 min): a mesma linha nova não pode ser acrescentada duas vezes na planilha. O `leads_espelho_pegar` reserva os itens com `for update skip locked`. Teste na Task 6.
3. **O consultor reclassifica enquanto a rodada escreve a versão anterior:** o item não pode ser marcado como feito com o valor velho. O `leads_espelho_feito` compara o `pedido_em`. Teste na Task 6.
4. **Consultor que tenta ler telefone ou CNPJ direto na tabela** (`sb.from('leads').select('phone_number')`, sem passar pela RPC): precisa ser negado, senão a proteção dos Livres é só visual. Teste na Task 3.
5. **Lead antigo de AGOSTO**, que só existe na guia FORM-, reclassificado: precisa achar a linha na própria guia FORM- (via `guias_fixas`) em vez de travar com "crie a guia AGOSTO". Teste na Task 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261026120000_leads_kanban_base.sql` | Colunas novas em `leads`, `leads_status_opcoes`, `leads_historico`, `leads_espelho`, `leads_mes_aba()`, `leads_espelho_enfileirar()`, chaves de `config` |
| `supabase/migrations/20261026120100_leads_kanban_rpcs.sql` | `leads_pegar`, `leads_classificar`, `leads_redistribuir`, `leads_kanban`, `leads_kanban_resumo`, `leads_espelho_reescrever`, `leads_entrada` |
| `supabase/migrations/20261026120200_leads_colunas_sensiveis.sql` | Tranca `phone_number`, `email` e `cnpj` para `authenticated`; RPC `leads_digital_admin()` |
| `supabase/migrations/20261026120300_leads_espelho_fila.sql` | `leads_espelho_pegar`, `leads_espelho_feito`, `leads_espelho_falha`, `leads_espelho_adiar`, `leads_espelho_atraso` (só service_role) |
| `supabase/rollback/20261026120000_leads_kanban_rollback.sql` | Desfaz as 4 migrations |
| `supabase/tests/leads_kanban_check.sql` | Verificação de banco (termina em ROLLBACK) |
| `supabase/functions/planilha-espelho/planilha.ts` (+ `.test.ts`) | Funções puras: guias, cabeçalho, colunas, linhas, formatos |
| `supabase/functions/planilha-espelho/google.ts` (+ `.test.ts`) | JWT da conta de serviço, token e cliente mínimo do Sheets |
| `supabase/functions/planilha-espelho/espelho.ts` (+ `.test.ts`) | Orquestração de uma rodada (entrada + fila + aviso), com dependências injetadas |
| `supabase/functions/planilha-espelho/index.ts` | Deno.serve: autenticação pelo cron, config, criação das dependências reais |
| `edge_function_sync_leads.ts` + `test_edge_function_sync_leads.js` | Sai cedo no modo `painel` |
| `_template.html` | Aba "Meus leads" (HTML, `kbStyles`, funções `kb*`), Digital via `leads_digital_admin`, card na Mesa |
| `test_leads_kanban.js` | Testes jsdom do Kanban |
| `test_venda_origem_lead.js` | Mock passa a responder a RPC `leads_digital_admin` |
| `REGRAS_NEGOCIO.md` | §112 |

**Ajuste de 26/10 (pedido do Rafael):** cron da `planilha-espelho` a cada **10 s** (pg_cron aceita segundos; o job `mailing-contagem` já usa) e Kanban com verificação leve de versão a cada 10 s. O lead aparece nos Livres ~10–20 s depois de cair na guia de entrada. O tempo Facebook → planilha é da integração deles e fica fora deste projeto (receber direto da Meta por webhook seria um projeto à parte).

**Decisão de implementação (acréscimo à spec 5.5):** a ingestão da guia de entrada fica **dentro da `planilha-espelho`**, que já tem a conta de serviço e roda a cada minuto. A `sync-leads` só ganha a saída cedo no modo `painel`. O comportamento é o da spec (só insere lead novo e nunca sobrescreve os campos de trabalho), e o lead novo aparece em ~1 min em vez de ~10.

---

### Task 0: Preparar o worktree

**Files:** nenhum arquivo do repositório.

- [ ] **Step 1: Conferir o worktree e o design atual**

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/leads-kanban
git fetch oficial && git status -sb && git log --oneline -3
grep -c 'data-apex-visual\|<aside class="sidebar">' _template.html   # precisa ser >= 1
```
Esperado: branch `feat/leads-kanban` com o commit da spec por cima de `oficial/main`.

- [ ] **Step 2: Emprestar o node_modules (junção, não cópia)**

```bash
cmd //c mklink /J node_modules "C:\\Users\\acer1\\Downloads\\apex-smart-solutions\\.worktrees\\cadastro-diario-vendas\\node_modules"
node -e "require('jsdom');require('papaparse');require('xlsx');console.log('ok')"
```
Esperado: `ok`. **Antes de `git worktree remove`, rodar `rmdir node_modules`** (apaga só a junção).

- [ ] **Step 3: Linha de base dos testes**

```bash
bash run_tests.sh 2>&1 | tail -4
```
Anotar quais testes já falham no oficial puro (até 15/10 eram `test_pedidos_alerta`, `test_proposta_*` e `test_redesign_shell`). Eles não contam como regressão.

---

### Task 1: Banco: estrutura base

**Files:**
- Create: `supabase/migrations/20261026120000_leads_kanban_base.sql`
- Create: `supabase/rollback/20261026120000_leads_kanban_rollback.sql`
- Create: `supabase/tests/leads_kanban_check.sql`

**Interfaces:**
- Produces:
  - colunas `leads.dono_id uuid`, `pego_em timestamptz`, `classificado_em timestamptz`, `classificado_por uuid`, `retorno_em date`, `aba_planilha text`;
  - tabelas `leads_status_opcoes(status pk, grupo, ordem, ativo)`, `leads_historico`, `leads_espelho(lead_aba, lead_id pk, pedido_em, tentativas, proxima_em, ultimo_erro, feito_em)`;
  - `leads_mes_aba(timestamptz) → text`;
  - `leads_espelho_enfileirar(p_aba text, p_id text) → void` (sem execute para authenticated);
  - config `leads_modo='planilha'`, `leads_planilha` (json), `leads_espelho_aviso=''`.

- [ ] **Step 1: Conferir a grafia real dos status no banco** (só leitura, pelo conector)

```sql
select status, count(*) from public.leads where status is not null group by 1 order by 1;
```
Para cada status da lista do Step 3, usar a grafia **mais frequente** que aparece aqui (ex.: "EM NEGOCIAÇÂO", com Â, está no código e vem da planilha). Se alguma grafia do banco diferir da do Step 3, trocar no INSERT antes de seguir. Mais tarde a planilha valida o texto: com grafia diferente, aparece o triângulo vermelho de validação.

- [ ] **Step 2: Escrever o teste de banco (parte da estrutura) em `supabase/tests/leads_kanban_check.sql`**

```sql
-- Verificação das migrations 20261026120000..120300 (§112). Rodar SOMENTE depois delas; SEMPRE termina em ROLLBACK.
-- Dados fictícios (zz*), aba 'JUNHO'. zz:1/zz:2 são criados "1 hora atrás" porque os Livres só mostram os últimos 60 dias.
-- Usuários: e201 admin, e202 supervisor, e203 consultor da equipe, e204 consultor fora da equipe.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ksup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kcon@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kfora@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000e201', 'Zzkadm Teste',  'zz.kadm',  'admin',      'apex'),
  ('00000000-0000-0000-0000-00000000e202', 'Zzksup Teste',  'zz.ksup',  'supervisor', 'apex'),
  ('00000000-0000-0000-0000-00000000e203', 'Zzkcon Teste',  'zz.kcon',  'consultor',  'apex'),
  ('00000000-0000-0000-0000-00000000e204', 'Zzkfora Teste', 'zz.kfora', 'consultor',  'apex')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZKCON', '00000000-0000-0000-0000-00000000e203', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, email, cnpj, categoria, converteu, receita) values
  ('JUNHO', 'zz:1', now() - interval '1 hour', 'Zz Empresa Um',   '11900000001', 'zz1@teste.invalid', '00000000000101', 'sem_contato', false, 0),
  ('JUNHO', 'zz:2', now() - interval '1 hour', 'Zz Empresa Dois', '11900000002', 'zz2@teste.invalid', '00000000000202', 'sem_contato', false, 0);

do $$
declare n int;
begin
  -- ===== Task 1: estrutura =====
  select count(*) into n from public.leads_status_opcoes where ativo;
  assert n = 18, 'tabulações ativas: esperado 18, veio ' || n;
  select count(*) into n from public.leads_status_opcoes where grupo = 'convertido';
  assert n = 1, 'só 1 status de venda';
  assert public.leads_mes_aba('2000-06-30 23:30-03') = 'JUNHO', 'mês em SP (23:30 de 30/06 ainda é junho)';
  assert public.leads_mes_aba('2000-07-01 02:30+00') = 'JUNHO', '02:30 UTC de 01/07 = 23:30 de 30/06 em SP';
  assert public.leads_mes_aba('2000-03-10 12:00-03') = 'MARCO', 'março sem cedilha, igual às abas';
  perform public.leads_espelho_enfileirar('JUNHO', 'zz:1');
  perform public.leads_espelho_enfileirar('JUNHO', 'zz:1');
  select count(*) into n from public.leads_espelho where lead_aba = 'JUNHO' and lead_id = 'zz:1' and feito_em is null;
  assert n = 1, 'enfileirar 2x o mesmo lead = 1 item pendente';
  assert (select valor from public.config where chave = 'leads_modo') = 'planilha', 'modo começa em planilha';
  -- ===== mais testes entram aqui =====
end $$;
rollback;
```

- [ ] **Step 3: Escrever a migration `supabase/migrations/20261026120000_leads_kanban_base.sql`**

```sql
-- §112 Meus leads (Kanban) com espelho na planilha — estrutura base.
-- Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
begin;

alter table public.leads
  add column if not exists dono_id uuid references public.profiles(id) on delete set null,
  add column if not exists pego_em timestamptz,
  add column if not exists classificado_em timestamptz,
  add column if not exists classificado_por uuid references public.profiles(id) on delete set null,
  add column if not exists retorno_em date,
  add column if not exists aba_planilha text;
create index if not exists idx_leads_dono on public.leads (dono_id);
create index if not exists idx_leads_livres on public.leads (criado_em_lead desc) where dono_id is null;
create index if not exists idx_leads_id on public.leads (id);

-- Tabulações (texto EXATO da planilha). grupo = categoria do funil.
create table if not exists public.leads_status_opcoes (
  status text primary key,
  grupo text not null check (grupo in ('andamento', 'convertido', 'perdido')),
  ordem int not null,
  ativo boolean not null default true
);
insert into public.leads_status_opcoes (status, grupo, ordem) values
  ('EM NEGOCIAÇÂO', 'andamento', 1),
  ('AGENDADO RETORNO', 'andamento', 2),
  ('AGUARDANDO DOCUMENTAÇÃO', 'andamento', 3),
  ('AGUARDANDO CLIENTE DECIDIR', 'andamento', 4),
  ('PEDIDO EM ANÁLISE', 'andamento', 5),
  ('PEDIDO CONCLUIDO (VENDA)', 'convertido', 10),
  ('CLIENTE NÃO RESPONDE', 'perdido', 20),
  ('CLIENTE NÃO ACEITOU VALORES', 'perdido', 21),
  ('CLIENTE SEM INTERESSE NO PLANO', 'perdido', 22),
  ('LEAD PAROU DE RESPONDER', 'perdido', 23),
  ('CNPJ INAPTO', 'perdido', 24),
  ('TELEFONE ERRADO OU SEM WHATSAPP', 'perdido', 25),
  ('LEAD FORA DO PERFIL', 'perdido', 26),
  ('CLIENTE SO QUERIA APARELHO', 'perdido', 27),
  ('CLIENTE SÓ QUERIA FIBRA', 'perdido', 28),
  ('CNPJ REPROVADO', 'perdido', 29),
  ('SUSPEITA DE FRAUDE', 'perdido', 30),
  ('CLIENTE NÃO QUER NO CNPJ', 'perdido', 31)
on conflict (status) do nothing;
alter table public.leads_status_opcoes enable row level security;
drop policy if exists leads_status_opcoes_select on public.leads_status_opcoes;
create policy leads_status_opcoes_select on public.leads_status_opcoes for select to authenticated using (true);
drop policy if exists leads_status_opcoes_write on public.leads_status_opcoes;
create policy leads_status_opcoes_write on public.leads_status_opcoes for all to authenticated
  using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- Histórico de pegar/classificar/redistribuir/devolver (só as RPCs escrevem).
create table if not exists public.leads_historico (
  id bigint generated always as identity primary key,
  lead_aba text not null,
  lead_id text not null,
  acao text not null check (acao in ('pegar', 'classificar', 'redistribuir', 'devolver')),
  por uuid references public.profiles(id) on delete set null,
  em timestamptz not null default now(),
  antes jsonb,
  depois jsonb
);
create index if not exists idx_leads_historico_lead on public.leads_historico (lead_aba, lead_id, em desc);
alter table public.leads_historico enable row level security;
drop policy if exists leads_historico_select on public.leads_historico;
create policy leads_historico_select on public.leads_historico for select to authenticated
  using (por = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));

-- Fila do espelho: no máximo 1 item por lead (repetir só atualiza pedido_em).
create table if not exists public.leads_espelho (
  lead_aba text not null,
  lead_id text not null,
  pedido_em timestamptz not null default now(),
  tentativas int not null default 0,
  proxima_em timestamptz not null default now(),
  ultimo_erro text,
  feito_em timestamptz,
  primary key (lead_aba, lead_id)
);
create index if not exists idx_leads_espelho_pendente on public.leads_espelho (proxima_em) where feito_em is null;
alter table public.leads_espelho enable row level security;
drop policy if exists leads_espelho_select on public.leads_espelho;
create policy leads_espelho_select on public.leads_espelho for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));

-- Nome da aba (mês) de um lead pela data de criação em São Paulo; sem data = mês corrente. Igual às abas: MARCO sem cedilha.
create or replace function public.leads_mes_aba(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select (array['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'])
         [extract(month from coalesce(p_ts, now()) at time zone 'America/Sao_Paulo')::int];
$$;

create or replace function public.leads_espelho_enfileirar(p_aba text, p_id text) returns void
language sql security definer set search_path = public as $$
  insert into public.leads_espelho (lead_aba, lead_id) values (p_aba, p_id)
  on conflict (lead_aba, lead_id) do update
    set pedido_em = now(), proxima_em = now(), tentativas = 0, ultimo_erro = null, feito_em = null;
$$;
revoke all on function public.leads_espelho_enfileirar(text, text) from public, anon, authenticated;

insert into public.config (chave, valor) values
  ('leads_modo', 'planilha'),
  ('leads_planilha', '{"sheet_id":"1nu3yNLedr3ier2f7S6dI95XX6gxyJpsg4dtpi66AP5w","entrada_prefixo":"FORM-","guia_mes_contem":"CLARO B2B","guias_fixas":{"AGOSTO":"FORM- LEADS CLARO B2B APEX - AGOSTO"}}'),
  ('leads_espelho_aviso', '')
on conflict (chave) do nothing;

commit;
```

- [ ] **Step 4: Escrever o rollback `supabase/rollback/20261026120000_leads_kanban_rollback.sql`**

```sql
-- Desfaz as migrations 20261026120000..120300 (§112). Rodar na ordem inversa da aplicação.
begin;
-- 120300
drop function if exists public.leads_espelho_pegar(int);
drop function if exists public.leads_espelho_feito(jsonb);
drop function if exists public.leads_espelho_falha(jsonb, text);
drop function if exists public.leads_espelho_adiar(jsonb, text);
drop function if exists public.leads_espelho_atraso();
-- 120200
drop function if exists public.leads_digital_admin();
grant select on public.leads to authenticated;
-- 120100
drop function if exists public.leads_pegar(text, text);
drop function if exists public.leads_classificar(text, text, text, text, boolean, numeric, date);
drop function if exists public.leads_redistribuir(text, text, uuid);
drop function if exists public.leads_kanban(uuid);
drop function if exists public.leads_kanban_resumo();
drop function if exists public.leads_kanban_versao();
drop function if exists public.leads_espelho_reescrever(text);
drop function if exists public.leads_entrada(jsonb);
-- 120000
drop function if exists public.leads_espelho_enfileirar(text, text);
drop function if exists public.leads_mes_aba(timestamptz);
drop table if exists public.leads_espelho;
drop table if exists public.leads_historico;
drop table if exists public.leads_status_opcoes;
drop index if exists public.idx_leads_dono;
drop index if exists public.idx_leads_livres;
drop index if exists public.idx_leads_id;
alter table public.leads
  drop column if exists dono_id, drop column if exists pego_em, drop column if exists classificado_em,
  drop column if exists classificado_por, drop column if exists retorno_em, drop column if exists aba_planilha;
delete from public.config where chave in ('leads_modo', 'leads_planilha', 'leads_espelho_aviso');
commit;
```

- [ ] **Step 5: Mostrar ao Rafael e pedir ok para aplicar a migration 120000 no banco**

Com o ok, aplicar pelo conector com `execute_sql` (arquivo < 8 KB, 1 parte). Depois rodar só o bloco "Task 1" do `leads_kanban_check.sql` (o arquivo inteiro, que termina em rollback). Esperado: sem erro de `assert`.
Se faltar o ok, parar aqui e seguir as Tasks 4 e 5, que não dependem do banco.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261026120000_leads_kanban_base.sql supabase/rollback/20261026120000_leads_kanban_rollback.sql supabase/tests/leads_kanban_check.sql
git commit -m "feat(leads): estrutura base do Kanban e da fila do espelho (secao 112)"
```

---

### Task 2: Banco: RPCs de pegar, classificar, redistribuir, Kanban e entrada

**Files:**
- Create: `supabase/migrations/20261026120100_leads_kanban_rpcs.sql`
- Modify: `supabase/tests/leads_kanban_check.sql` (bloco "Task 2" antes de `-- ===== mais testes entram aqui =====`)

**Interfaces:**
- Consumes: Task 1 (colunas, `leads_status_opcoes`, `leads_historico`, `leads_espelho_enfileirar`, `leads_mes_aba`).
- Produces (todas `security definer`, `search_path=public`):
  - `leads_pegar(p_aba text, p_id text) → jsonb`: `{ok:true, consultor}` ou `{ok:false, dono}`.
  - `leads_classificar(p_aba text, p_id text, p_status text, p_obs text, p_converteu boolean, p_receita numeric, p_retorno date) → void`.
  - `leads_redistribuir(p_aba text, p_id text, p_novo uuid) → void` (`p_novo` nulo = devolver; só para lead sem status).
  - `leads_kanban(p_dono uuid default null) → table(aba, lead_id, nome, cidade, uf, qtd_linhas, tipo_empresa, telefone, email, cnpj, status, categoria, obs, converteu, receita, retorno_em, dono_id, dono_nome, pego_em, classificado_em, criado_em_lead, primeiro_clique, primeira_ligacao, venda_neo, receita_neo, livre)`.
  - `leads_kanban_resumo() → table(livres int, livre_mais_antigo timestamptz, fila_pendente int, fila_mais_antiga timestamptz, aviso text)`.
  - `leads_kanban_versao() → text` (barata; muda quando entra, é pego ou é classificado algum lead).
  - `leads_espelho_reescrever(p_aba text) → int` (só admin).
  - `leads_entrada(p_leads jsonb) → jsonb` `{inseridos, atualizados}` (só service_role).

- [ ] **Step 1: Escrever os testes do bloco "Task 2"** (colar dentro do `do $$`, antes de `-- ===== mais testes entram aqui =====`)

```sql
  -- ===== Task 2: RPCs =====
  execute 'set local role authenticated';
  -- consultor fora da equipe não pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e204', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e204', true);
  begin
    perform public.leads_pegar('JUNHO', 'zz:1');
    assert false, 'consultor fora da equipe conseguiu pegar';
  exception when insufficient_privilege then null;
  end;
  -- consultor da equipe pega; segundo "pegar" (mesmo de outra pessoa) perde
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e203', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e203', true);
  assert (public.leads_pegar('JUNHO', 'zz:1') ->> 'ok')::boolean, 'pegar lead livre';
  assert not (public.leads_pegar('JUNHO', 'zz:1') ->> 'ok')::boolean, 'pegar de novo o mesmo lead perde';
  execute 'reset role';
  assert (select consultor from public.leads where aba = 'JUNHO' and id = 'zz:1') = 'ZZKCON', 'consultor = nome_planilha';
  assert (select count(*) from public.leads_historico where lead_id = 'zz:1' and acao = 'pegar') = 1, 'histórico do pegar';
  execute 'set local role authenticated';
  -- nos Livres o consultor não recebe telefone/e-mail/CNPJ; no próprio lead recebe
  assert (select telefone is null and email is null and cnpj is null from public.leads_kanban(null) where lead_id = 'zz:2'), 'Livre sem dado sensível para consultor';
  assert (select telefone = '11900000001' from public.leads_kanban(null) where lead_id = 'zz:1'), 'meu lead com telefone';
  assert (select livre from public.leads_kanban(null) where lead_id = 'zz:2'), 'zz:2 é livre';
  -- classificar: status inválido recusa; válido grava categoria/converteu e enfileira
  begin
    perform public.leads_classificar('JUNHO', 'zz:1', 'STATUS INVENTADO', null, false, null, null);
    assert false, 'status inválido aceito';
  exception when invalid_parameter_value then null;
  end;
  perform public.leads_classificar('JUNHO', 'zz:1', 'PEDIDO CONCLUIDO (VENDA)', 'zz obs', false, 1234.5, null);
  -- quem não é dono não classifica
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e204', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e204', true);
  begin
    perform public.leads_classificar('JUNHO', 'zz:1', 'CNPJ INAPTO', null, false, null, null);
    assert false, 'quem não é dono classificou';
  exception when insufficient_privilege then null;
  end;
  -- supervisor vê dado sensível nos Livres e redistribui
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e202', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e202', true);
  assert (select telefone = '11900000002' from public.leads_kanban(null) where lead_id = 'zz:2'), 'supervisor vê telefone nos Livres';
  perform public.leads_redistribuir('JUNHO', 'zz:2', '00000000-0000-0000-0000-00000000e203');
  begin
    perform public.leads_redistribuir('JUNHO', 'zz:1', null);   -- zz:1 já tem status
    assert false, 'devolveu aos Livres lead com status';
  exception when invalid_parameter_value then null;
  end;
  execute 'reset role';
  assert (select categoria = 'convertido' and converteu and receita = 1234.5 and obs = 'zz obs' from public.leads where id = 'zz:1'), 'classificar gravou';
  assert (select dono_id = '00000000-0000-0000-0000-00000000e203' and consultor = 'ZZKCON' from public.leads where id = 'zz:2'), 'redistribuir trocou o dono';
  assert (select count(*) from public.leads_espelho where lead_aba = 'JUNHO' and feito_em is null) = 2, 'zz:1 e zz:2 na fila';
  -- entrada: insere novo (aba pelo mês) e só atualiza dado do formulário do existente
  perform public.leads_entrada(jsonb_build_array(
    jsonb_build_object('id', 'zz:3', 'criado_em_lead', '2000-06-20T09:00:00-03:00', 'full_name', 'Zz Empresa Tres', 'phone_number', '11900000003'),
    jsonb_build_object('id', 'zz:1', 'criado_em_lead', (select criado_em_lead from public.leads where id = 'zz:1')::text, 'full_name', 'Zz Empresa Um Novo', 'phone_number', '11900000001')));
  assert (select aba = 'JUNHO' and categoria = 'sem_contato' and dono_id is null from public.leads where id = 'zz:3'), 'entrada inseriu zz:3 livre';
  assert (select full_name = 'Zz Empresa Um Novo' and status = 'PEDIDO CONCLUIDO (VENDA)' and consultor = 'ZZKCON' from public.leads where id = 'zz:1'), 'entrada não mexeu no trabalho do consultor';
  assert exists (select 1 from public.leads_espelho where lead_id = 'zz:3' and feito_em is null), 'lead novo vai para a fila';
  assert (public.leads_entrada(jsonb_build_array(jsonb_build_object('id', 'zz:3', 'criado_em_lead', '2000-06-20T09:00:00-03:00', 'full_name', 'Zz Empresa Tres', 'phone_number', '11900000003'))) ->> 'inseridos')::int = 0, 'entrada repetida não insere de novo';
```

- [ ] **Step 2: Escrever a migration `supabase/migrations/20261026120100_leads_kanban_rpcs.sql`**

```sql
-- §112 Meus leads — RPCs. Toda mudança passa por aqui: grava leads_historico e enfileira leads_espelho.
begin;

create or replace function public.leads_pegar(p_aba text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  update public.leads l set dono_id = auth.uid(), consultor = v_nome, pego_em = now()
   where l.aba = p_aba and l.id = p_id and l.dono_id is null and l.categoria = 'sem_contato';
  get diagnostics n = row_count;
  if n = 0 then
    select coalesce(p.nome, l.consultor) into v_dono
      from public.leads l left join public.profiles p on p.id = l.dono_id
     where l.aba = p_aba and l.id = p_id;
    if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', false, 'dono', coalesce(v_dono, 'outra pessoa'));
  end if;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'pegar', auth.uid(), jsonb_build_object('consultor', v_nome));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor', v_nome);
end $$;

create or replace function public.leads_classificar(p_aba text, p_id text, p_status text, p_obs text,
  p_converteu boolean, p_receita numeric, p_retorno date) returns void
language plpgsql security definer set search_path = public as $$
declare v_grupo text; v_dono uuid; v_antes jsonb; v_role text := coalesce(public.get_my_role(), '');
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select l.dono_id, jsonb_build_object('status', l.status, 'obs', l.obs, 'converteu', l.converteu, 'receita', l.receita, 'retorno_em', l.retorno_em)
    into v_dono, v_antes
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_role not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select o.grupo into v_grupo from public.leads_status_opcoes o where o.status = p_status and o.ativo;
  if v_grupo is null then raise exception 'status inválido: %', p_status using errcode = '22023'; end if;
  if p_receita is not null and p_receita < 0 then raise exception 'receita negativa' using errcode = '22023'; end if;
  if p_status = 'AGENDADO RETORNO' and p_retorno is null then raise exception 'informe a data do retorno' using errcode = '22023'; end if;
  update public.leads set
      status = p_status,
      categoria = v_grupo,
      obs = nullif(btrim(coalesce(p_obs, '')), ''),
      converteu = coalesce(p_converteu, false) or v_grupo = 'convertido',
      receita = coalesce(p_receita, 0),
      retorno_em = case when p_status = 'AGENDADO RETORNO' then p_retorno end,
      classificado_em = now(),
      classificado_por = auth.uid()
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, 'classificar', auth.uid(), v_antes,
            jsonb_build_object('status', p_status, 'obs', p_obs, 'converteu', coalesce(p_converteu, false) or v_grupo = 'convertido',
                               'receita', coalesce(p_receita, 0), 'retorno_em', p_retorno));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;

-- p_novo nulo = devolver aos Livres (só lead ainda sem status; com status, passe para outro consultor).
create or replace function public.leads_redistribuir(p_aba text, p_id text, p_novo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_antes jsonb; v_cat text;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select jsonb_build_object('dono_id', l.dono_id, 'consultor', l.consultor), l.categoria into v_antes, v_cat
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if p_novo is null then
    if v_cat <> 'sem_contato' then raise exception 'lead com status não volta aos Livres; passe para outro consultor' using errcode = '22023'; end if;
  else
    select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = p_novo order by e.id limit 1;
    if v_nome is null then raise exception 'consultor fora da equipe de leads' using errcode = '22023'; end if;
  end if;
  update public.leads set dono_id = p_novo, consultor = v_nome, pego_em = case when p_novo is null then null else now() end
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, case when p_novo is null then 'devolver' else 'redistribuir' end, auth.uid(), v_antes,
            jsonb_build_object('dono_id', p_novo, 'consultor', v_nome));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;

-- Kanban: Livres (sem dono e sem status, últimos 60 dias) + leads do dono pedido.
-- Consultor só vê os próprios (p_dono é ignorado); admin/supervisor: p_dono nulo = todos.
create or replace function public.leads_kanban(p_dono uuid default null)
returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text,
              telefone text, email text, cnpj text, status text, categoria text, obs text, converteu boolean,
              receita numeric, retorno_em date, dono_id uuid, dono_nome text, pego_em timestamptz,
              classificado_em timestamptz, criado_em_lead timestamptz, primeiro_clique timestamptz,
              primeira_ligacao timestamptz, venda_neo boolean, receita_neo numeric, livre boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid; v_ini_mes timestamptz;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with neo as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, sum(coalesce(p.valor, 0)) as valor
      from public.producao_pedidos p
     where p.cnpj is not null and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
     group by 1
  ), base as (
    select l.*, (l.dono_id is null and l.categoria = 'sem_contato') as e_livre
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE'
       and (
         (l.dono_id is null and l.categoria = 'sem_contato' and l.criado_em_lead >= now() - interval '60 days')
         or (l.dono_id is not null and (v_alvo is null or l.dono_id = v_alvo)
             and (l.categoria in ('sem_contato', 'andamento')
                  or coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
       )
  )
  select b.aba, b.id, b.full_name, b.city, b.state, b.qtd_linhas, b.tipo_empresa,
         case when b.e_livre and not v_gestor then null else b.phone_number end,
         case when b.e_livre and not v_gestor then null else b.email end,
         case when b.e_livre and not v_gestor then null else b.cnpj end,
         b.status, b.categoria, b.obs, b.converteu, b.receita, b.retorno_em, b.dono_id, pr.nome, b.pego_em,
         b.classificado_em, b.criado_em_lead,
         (select min(c.em) from public.leads_contatos c where c.lead_aba = b.aba and c.lead_id = b.id),
         (select min(m.gerada_em) from public.ligacoes_manuais m
           where m.chave_tel is not null and m.chave_tel = public.chave_tel(b.phone_number)
             and m.gerada_em >= b.criado_em_lead - interval '1 hour'),
         (n.doc is not null), n.valor, b.e_livre
    from base b
    left join public.profiles pr on pr.id = b.dono_id
    left join neo n on length(regexp_replace(coalesce(b.cnpj, ''), '[^0-9]', '', 'g')) >= 11
                   and n.doc = regexp_replace(b.cnpj, '[^0-9]', '', 'g')
   order by b.criado_em_lead desc;
end $$;

create or replace function public.leads_kanban_resumo()
returns table(livres int, livre_mais_antigo timestamptz, fila_pendente int, fila_mais_antiga timestamptz, aviso text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select
    (select count(*)::int from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select min(l.criado_em_lead) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select count(*)::int from public.leads_espelho f where f.feito_em is null),
    (select min(f.pedido_em) from public.leads_espelho f where f.feito_em is null),
    (select c.valor from public.config c where c.chave = 'leads_espelho_aviso');
end $$;

-- Versão leve do Kanban (o painel pergunta a cada 10 s e só recarrega leads_kanban quando muda).
create or replace function public.leads_kanban_versao() returns text
language sql stable security definer set search_path = public as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), count(*) filter (where dono_id is null and categoria = 'sem_contato'))
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day';
$$;

create or replace function public.leads_espelho_reescrever(p_aba text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.leads_espelho (lead_aba, lead_id)
  select l.aba, l.id from public.leads l where l.aba = p_aba
  on conflict (lead_aba, lead_id) do update
    set pedido_em = now(), proxima_em = now(), tentativas = 0, ultimo_erro = null, feito_em = null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Ingestão da guia de entrada (chamada só pela Edge Function, com service_role).
-- Lead novo (id em nenhuma aba): insere na aba do mês, sem dono, e enfileira. Existente: atualiza SÓ os
-- campos do formulário, e só quando mudou (evita escrita à toa a cada minuto).
create or replace function public.leads_entrada(p_leads jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_ins int := 0; v_upd int := 0; n int; v_aba text; v_ts timestamptz;
begin
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    update public.leads l set
        full_name = r ->> 'full_name', phone_number = r ->> 'phone_number', email = r ->> 'email',
        cnpj = r ->> 'cnpj', city = r ->> 'city', state = r ->> 'state', tipo_empresa = r ->> 'tipo_empresa',
        qtd_linhas = r ->> 'qtd_linhas', lead_status = r ->> 'lead_status', atualizado_em = now()
     where l.id = r ->> 'id'
       and (l.full_name, l.phone_number, l.email, l.cnpj, l.city, l.state, l.tipo_empresa, l.qtd_linhas, l.lead_status)
           is distinct from (r ->> 'full_name', r ->> 'phone_number', r ->> 'email', r ->> 'cnpj', r ->> 'city',
                             r ->> 'state', r ->> 'tipo_empresa', r ->> 'qtd_linhas', r ->> 'lead_status');
    get diagnostics n = row_count;
    v_upd := v_upd + n;
    if not exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- cron de 10 s: duas rodadas podem trazer o mesmo lead ao mesmo tempo; on conflict evita derrubar o lote
      v_aba := public.leads_mes_aba(v_ts);
      insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                                form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                                city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em)
      values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
              r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
              coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
              r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
              r ->> 'lead_status', 'sem_contato', false, 0, now(), now())
      on conflict (aba, id) do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        perform public.leads_espelho_enfileirar(v_aba, r ->> 'id');
        v_ins := v_ins + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd);
end $$;

revoke all on function public.leads_entrada(jsonb) from public, anon, authenticated;
grant execute on function public.leads_pegar(text, text) to authenticated;
grant execute on function public.leads_classificar(text, text, text, text, boolean, numeric, date) to authenticated;
grant execute on function public.leads_redistribuir(text, text, uuid) to authenticated;
grant execute on function public.leads_kanban(uuid) to authenticated;
grant execute on function public.leads_kanban_resumo() to authenticated;
grant execute on function public.leads_kanban_versao() to authenticated;
grant execute on function public.leads_espelho_reescrever(text) to authenticated;
commit;
```

- [ ] **Step 3: Com ok do Rafael, aplicar a migration 120100 e rodar o `leads_kanban_check.sql` inteiro**

O arquivo da migration tem ~10 KB: aplicar em **2 partes**. A parte 1 vai do `begin` até o fim do `leads_redistribuir` + `commit;`. A parte 2 é `begin;` + o resto. Esperado no check: nenhum `assert` falha e o script termina em ROLLBACK.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261026120100_leads_kanban_rpcs.sql supabase/tests/leads_kanban_check.sql
git commit -m "feat(leads): RPCs pegar/classificar/redistribuir/kanban/entrada (secao 112)"
```

---

### Task 3: Trancar telefone, e-mail e CNPJ na tabela, com a Digital via RPC

**Files:**
- Create: `supabase/migrations/20261026120200_leads_colunas_sensiveis.sql`
- Modify: `_template.html` (função `loadConversaoVendas`, ~linha 9146-9151, e a consulta de "Vendas x origem do lead", ~linha 10232)
- Modify: `test_venda_origem_lead.js` (mock da RPC)
- Modify: `supabase/tests/leads_kanban_check.sql` (bloco "Task 3")

**Interfaces:**
- Produces: `leads_digital_admin() → table(aba, id, consultor, status, categoria, converteu, receita, criado_em_lead, cnpj)`, só para admin e supervisor, ordenada por `aba, id` (paginação estável no `fetchAllRows`).

- [ ] **Step 1: Teste de banco (Review Focus 4)**: colar no bloco do `do $$`

```sql
  -- ===== Task 3: colunas sensíveis =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e203', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e203', true);
  begin
    perform phone_number from public.leads limit 1;
    assert false, 'consultor leu phone_number direto da tabela';
  exception when insufficient_privilege then null;
  end;
  begin
    perform cnpj from public.leads limit 1;
    assert false, 'consultor leu cnpj direto da tabela';
  exception when insufficient_privilege then null;
  end;
  perform status, categoria, consultor from public.leads limit 1;   -- colunas da Digital continuam liberadas
  begin
    perform * from public.leads_digital_admin();
    assert false, 'consultor chamou leads_digital_admin';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e202', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e202', true);
  assert (select count(*) from public.leads_digital_admin() where id like 'zz:%') = 3, 'supervisor recebe cnpj pela RPC';
  execute 'reset role';
```

- [ ] **Step 2: Migration `supabase/migrations/20261026120200_leads_colunas_sensiveis.sql`**

```sql
-- §112: telefone, e-mail e CNPJ dos leads deixam de ser legíveis direto da tabela pelo navegador. O consultor
-- só os recebe pelas RPCs (no lead dele); a Digital de admin/supervisor lê o CNPJ por leads_digital_admin().
begin;
revoke select on public.leads from anon, authenticated;
grant select (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, form_id, form_name,
              is_organic, platform, tipo_empresa, qtd_linhas, full_name, city, state, lead_status, consultor, status,
              categoria, obs, converteu, receita, atualizado_em, primeira_sync_em, dono_id, pego_em, classificado_em,
              classificado_por, retorno_em, aba_planilha)
  on public.leads to authenticated;

create or replace function public.leads_digital_admin()
returns table(aba text, id text, consultor text, status text, categoria text, converteu boolean, receita numeric,
              criado_em_lead timestamptz, cnpj text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select l.aba, l.id, l.consultor, l.status, l.categoria, l.converteu, l.receita, l.criado_em_lead, l.cnpj
                 from public.leads l order by l.aba, l.id;
end $$;
grant execute on function public.leads_digital_admin() to authenticated;
commit;
```

- [ ] **Step 3: Painel: Digital usa a RPC no modo admin.** Em `_template.html`, dentro de `loadConversaoVendas`, trocar

```js
  const leadsCols = adminMode
    ? 'consultor,status,categoria,converteu,receita,criado_em_lead,cnpj,aba'
    : 'consultor,status,categoria,converteu,receita,criado_em_lead,aba';

  const queries = [
    fetchAllRows(() => sb.from('leads').select(leadsCols)),
```
por

```js
  // 26/10/2026 (§112): telefone/e-mail/CNPJ não são mais legíveis direto da tabela; admin/supervisor recebem o CNPJ pela RPC.
  const queries = [
    adminMode
      ? fetchAllRows(() => sb.rpc('leads_digital_admin'))
      : fetchAllRows(() => sb.from('leads').select('consultor,status,categoria,converteu,receita,criado_em_lead,aba')),
```
e, na consulta de "Vendas x origem do lead" (~linha 10232), trocar

```js
    fetchAllRows(() => sb.from('leads').select('cnpj,criado_em_lead,converteu,receita')),
```
por

```js
    fetchAllRows(() => sb.rpc('leads_digital_admin')),   // §112: CNPJ só pela RPC (admin/supervisor)
```

- [ ] **Step 4: Ajustar o mock de `test_venda_origem_lead.js`**

No `rpc` do mock (procurar `rpc:` no arquivo), responder `leads_digital_admin` com os mesmos `MOCK_LEADS` usados hoje para `table === 'leads'`:

```js
    if(nome === 'leads_digital_admin') return makeQuery(() => ({ data: MOCK_LEADS, error: null }));
```
Se o mock não tiver `rpc`, adicionar ao objeto do client: `rpc: (nome) => nome === 'leads_digital_admin' ? makeQuery(() => ({ data: MOCK_LEADS, error: null })) : makeQuery(() => ({ data: [], error: null })),`.

- [ ] **Step 5: Rodar os testes do painel**

```bash
bash run_tests.sh 2>&1 | tail -4
```
Esperado: as mesmas falhas da linha de base da Task 0, nenhuma nova. Se `test_monitoramento_leads.js` ou outro teste mockar `from('leads')` com `cnpj` para admin, ajustar o mock do mesmo jeito do Step 4.

- [ ] **Step 6: Com ok do Rafael, aplicar a 120200 e rodar o check.**

**Atenção:** a 120200 só pode ir para produção **junto com a publicação do painel** da Task 3 (Task 11, passo 1). Senão a Digital do admin, ainda no código antigo, perde o CNPJ e mostra a conversão zerada. Até lá, rodar o check aplicando a 120200 **dentro da mesma transação do check** (colar o conteúdo da migration sem `begin/commit` logo depois do `begin;` do check). Assim ela é desfeita no ROLLBACK.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261026120200_leads_colunas_sensiveis.sql _template.html test_venda_origem_lead.js supabase/tests/leads_kanban_check.sql
git commit -m "feat(leads): telefone/e-mail/CNPJ so por RPC; Digital admin via leads_digital_admin (secao 112)"
```

---

### Task 4: Funções puras da planilha (`planilha.ts`)

**Files:**
- Create: `supabase/functions/planilha-espelho/planilha.ts`
- Test: `supabase/functions/planilha-espelho/planilha.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MESES: string[];
  export type Guia = { titulo: string; indice: number };
  export type CfgPlanilha = { sheet_id: string; entrada_prefixo: string; guia_mes_contem: string; guias_fixas?: Record<string, string> };
  export type Indices = { id: number; consultor: number; status: number; obs: number; converteu: number; receita: number };
  export type Cabecalho = { linha: number; colunas: string[]; idx: Indices };   // linha = nº A1 do cabeçalho
  export type LeadPlanilha = { aba: string; id: string; criado_em_lead: string | null; ad_id?: string | null; ad_name?: string | null;
    adset_id?: string | null; adset_name?: string | null; campaign_id?: string | null; campaign_name?: string | null;
    form_id?: string | null; form_name?: string | null; is_organic?: boolean | null; platform?: string | null;
    tipo_empresa?: string | null; qtd_linhas?: string | null; cnpj?: string | null; email?: string | null;
    full_name?: string | null; city?: string | null; state?: string | null; phone_number?: string | null;
    lead_status?: string | null; consultor: string | null; status: string | null; obs: string | null;
    converteu: boolean | null; receita: number | null };
  export type Escrita = { range: string; values: string[][] };
  export function norm(s: string): string;
  export function guiaEntrada(guias: Guia[], cfg: CfgPlanilha): Guia | null;
  export function guiasDoMes(guias: Guia[], aba: string, cfg: CfgPlanilha): Guia[];
  export function escolherGuia(cands: Guia[], idsPorGuia: Map<string, Set<string>>, leadId: string): Guia | null;
  export function lerCabecalho(valores: string[][]): Cabecalho | null;
  export function idsDaGuia(valores: string[][], cab: Cabecalho): Map<string, number>;   // id -> nº da linha A1
  export function colLetra(i: number): string;
  export function formatarReceita(n: number | null): string;
  export function isoSP(iso: string | null): string;
  export function escritasDaLinha(titulo: string, cab: Cabecalho, linha: number, lead: LeadPlanilha): Escrita[];
  export function linhaNova(cab: Cabecalho, lead: LeadPlanilha): string[];
  export function leadsDaEntrada(valores: string[][]): { leads: Record<string, unknown>[]; invalidos: number };
  ```

- [ ] **Step 1: Escrever os testes `planilha.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, guiaEntrada, guiasDoMes, escolherGuia, lerCabecalho, idsDaGuia, colLetra, formatarReceita, isoSP,
  escritasDaLinha, linhaNova, leadsDaEntrada } from "./planilha.ts";
import type { CfgPlanilha, Guia, LeadPlanilha } from "./planilha.ts";

const cfg: CfgPlanilha = { sheet_id: "zz", entrada_prefixo: "FORM-", guia_mes_contem: "CLARO B2B",
  guias_fixas: { AGOSTO: "FORM- LEADS CLARO B2B APEX - AGOSTO" } };
const guias: Guia[] = [
  { titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 },
  { titulo: "LEADS CLARO B2B APEX - SETEMBRO 26", indice: 1 },
  { titulo: "LEADS FIBRA CLARO APEX - SETEMBRO", indice: 2 },
  { titulo: "FORM- LEADS CLARO B2B APEX - AGOSTO", indice: 3 },
  { titulo: "Resumo Conversão", indice: 4 },
];
const CAB = ["", "created_time", "ad_id", "campaign_id", "full_name", "phone_number", "qual_o_seu_cnpj?", "lead_status", "VENDEDOR", "STATUS", "OBS", "CONVERTEU?", "RECEITA"];
const lead = (o: Partial<LeadPlanilha> = {}): LeadPlanilha => ({ aba: "OUTUBRO", id: "l:zz1", criado_em_lead: "2026-10-25T22:04:00+00:00",
  full_name: "Zz Empresa", phone_number: "11900000001", cnpj: "00000000000101", lead_status: "CREATED", campaign_id: "zzc",
  consultor: "ZZKCON", status: "EM NEGOCIAÇÂO", obs: "retornar", converteu: false, receita: 0, ...o });

test("norm tira acento, espaço repetido e caixa", () => {
  assert.equal(norm("  Em  negociação "), "EM NEGOCIACAO");
});
test("guia de entrada pelo prefixo", () => {
  assert.equal(guiaEntrada(guias, cfg)?.indice, 3);
});
test("guia do mês: ignora FORM-, Fibra e outros meses (Review Focus 1)", () => {
  assert.deepEqual(guiasDoMes(guias, "SETEMBRO", cfg).map((g) => g.titulo), ["LEADS CLARO B2B APEX - SETEMBRO 26"]);
  assert.deepEqual(guiasDoMes(guias, "OUTUBRO", cfg).map((g) => g.indice), [0]);
  assert.deepEqual(guiasDoMes(guias, "NOVEMBRO", cfg), []);
});
test("guia fixa: AGOSTO escreve na própria FORM- (Review Focus 5)", () => {
  assert.deepEqual(guiasDoMes(guias, "AGOSTO", cfg).map((g) => g.indice), [3]);
});
test("duas guias do mesmo mês: vale a que já tem o id; senão a primeira", () => {
  const dup: Guia[] = [{ titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 }, { titulo: "LEADS CLARO B2B APEX - OUTUBRO 27", indice: 1 }];
  const ids = new Map([["LEADS CLARO B2B APEX - OUTUBRO 27", new Set(["l:zz1"])]]);
  assert.equal(escolherGuia(dup, ids, "l:zz1")?.indice, 1);
  assert.equal(escolherGuia(dup, ids, "l:outro")?.indice, 0);
  assert.equal(escolherGuia([], ids, "l:zz1"), null);
});
test("cabeçalho com linha extra antes, VENDEDOR como consultor", () => {
  const cab = lerCabecalho([["título solto"], CAB, ["l:zz1", "2026-10-25T19:04:00-03:00"]])!;
  assert.equal(cab.linha, 2);
  assert.deepEqual(cab.idx, { id: 0, consultor: 8, status: 9, obs: 10, converteu: 11, receita: 12 });
});
test("cabeçalho com consultor em branco antes de STATUS", () => {
  const semNome = [...CAB]; semNome[8] = "";
  assert.equal(lerCabecalho([semNome])!.idx.consultor, 8);
});
test("sem cabeçalho → null", () => {
  assert.equal(lerCabecalho([["a", "b"]]), null);
});
test("ids da guia viram nº de linha A1", () => {
  const cab = lerCabecalho([CAB, ["l:zz1"], [], ["l:zz2"]])!;
  assert.deepEqual([...idsDaGuia([CAB, ["l:zz1"], [], ["l:zz2"]], cab)], [["l:zz1", 2], ["l:zz2", 4]]);
});
test("colLetra", () => {
  assert.deepEqual([0, 25, 26, 51, 52].map(colLetra), ["A", "Z", "AA", "AZ", "BA"]);
});
test("receita no formato brasileiro; zero/nulo vazio", () => {
  assert.equal(formatarReceita(1234.5), "1.234,50");
  assert.equal(formatarReceita(0), "");
  assert.equal(formatarReceita(null), "");
});
test("isoSP", () => {
  assert.equal(isoSP("2026-10-25T22:04:00+00:00"), "2026-10-25T19:04:00-03:00");
  assert.equal(isoSP(null), "");
});
test("escritas só nas colunas de trabalho, com aspas no título", () => {
  const cab = lerCabecalho([CAB])!;
  const e = escritasDaLinha("LEADS D'OUTUBRO", cab, 7, lead({ converteu: true, receita: 99 }));
  assert.deepEqual(e.map((x) => x.range), ["'LEADS D''OUTUBRO'!I7", "'LEADS D''OUTUBRO'!J7", "'LEADS D''OUTUBRO'!K7", "'LEADS D''OUTUBRO'!L7", "'LEADS D''OUTUBRO'!M7"]);
  assert.deepEqual(e.map((x) => x.values[0][0]), ["ZZKCON", "EM NEGOCIAÇÂO", "retornar", "sim", "99,00"]);
});
test("linha nova na ordem do cabeçalho", () => {
  const cab = lerCabecalho([CAB])!;
  const l = linhaNova(cab, lead());
  assert.equal(l.length, CAB.length);
  assert.deepEqual([l[0], l[1], l[4], l[5], l[6], l[8], l[9]], ["l:zz1", "2026-10-25T19:04:00-03:00", "Zz Empresa", "11900000001", "00000000000101", "ZZKCON", "EM NEGOCIAÇÂO"]);
  assert.equal(l[11], "");
});
test("entrada: lê leads, pula sem id e data inválida", () => {
  const r = leadsDaEntrada([CAB, ["l:zz1", "2026-10-25T19:04:00-03:00", "", "zzc", "Zz Empresa", "11900000001", "00000000000101", "CREATED"],
    ["", "2026-10-25T19:05:00-03:00"], ["l:zz2", "ERRO - NUNCA EXCLUIR LINHAS"]]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.invalidos, 1);
  assert.deepEqual([r.leads[0].id, r.leads[0].full_name, r.leads[0].cnpj, r.leads[0].campaign_id], ["l:zz1", "Zz Empresa", "00000000000101", "zzc"]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/planilha-espelho && node --test planilha.test.ts`
Esperado: FAIL, "Cannot find module './planilha.ts'".

- [ ] **Step 3: Implementar `planilha.ts`**

```ts
// Funções puras da planilha de leads (§112). Sem rede e sem Deno: testadas com `node --test`.
// Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
export const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
export type Guia = { titulo: string; indice: number };
export type CfgPlanilha = { sheet_id: string; entrada_prefixo: string; guia_mes_contem: string; guias_fixas?: Record<string, string> };
export type Indices = { id: number; consultor: number; status: number; obs: number; converteu: number; receita: number };
export type Cabecalho = { linha: number; colunas: string[]; idx: Indices };
export type LeadPlanilha = {
  aba: string; id: string; criado_em_lead: string | null; ad_id?: string | null; ad_name?: string | null;
  adset_id?: string | null; adset_name?: string | null; campaign_id?: string | null; campaign_name?: string | null;
  form_id?: string | null; form_name?: string | null; is_organic?: boolean | null; platform?: string | null;
  tipo_empresa?: string | null; qtd_linhas?: string | null; cnpj?: string | null; email?: string | null;
  full_name?: string | null; city?: string | null; state?: string | null; phone_number?: string | null;
  lead_status?: string | null; consultor: string | null; status: string | null; obs: string | null;
  converteu: boolean | null; receita: number | null;
};
export type Escrita = { range: string; values: string[][] };

export function norm(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function guiaEntrada(guias: Guia[], cfg: CfgPlanilha): Guia | null {
  const p = norm(cfg.entrada_prefixo);
  return [...guias].sort((a, b) => a.indice - b.indice).find((g) => norm(g.titulo).startsWith(p)) ?? null;
}

// Guias candidatas do mês do lead: título com o nome do mês (palavra inteira) + o trecho "CLARO B2B", fora a de entrada.
// guias_fixas sobrescreve (AGOSTO vive na própria guia FORM-).
export function guiasDoMes(guias: Guia[], aba: string, cfg: CfgPlanilha): Guia[] {
  const fixa = cfg.guias_fixas?.[aba];
  if (fixa) return guias.filter((g) => g.titulo === fixa);
  const mes = norm(aba), contem = norm(cfg.guia_mes_contem), pref = norm(cfg.entrada_prefixo);
  const reMes = new RegExp(`(^|[^A-Z])${mes}([^A-Z]|$)`);
  return guias
    .filter((g) => { const t = norm(g.titulo); return !t.startsWith(pref) && t.includes(contem) && reMes.test(t); })
    .sort((a, b) => a.indice - b.indice);
}

// Mais de uma guia do mês: a que já tem o id; senão a primeira (o time põe a mais nova à esquerda).
export function escolherGuia(cands: Guia[], idsPorGuia: Map<string, Set<string>>, leadId: string): Guia | null {
  if (!cands.length) return null;
  return cands.find((g) => idsPorGuia.get(g.titulo)?.has(leadId)) ?? cands[0];
}

// Cabeçalho = linha com "created_time" na 2ª coluna (mesma regra da sync-leads). Consultor: CONSULTOR, senão
// VENDEDOR/VENDEDORA/CONSULTORA, senão a coluna sem nome logo antes de STATUS (§60/§98).
export function lerCabecalho(valores: string[][]): Cabecalho | null {
  const i = valores.findIndex((r) => (r?.[1] ?? "").trim() === "created_time");
  if (i < 0) return null;
  const colunas = valores[i].map((c) => (c ?? "").trim());
  const achar = (nomes: string[]) => colunas.findIndex((c) => nomes.includes(norm(c)));
  const status = achar(["STATUS"]);
  let consultor = achar(["CONSULTOR"]);
  if (consultor < 0) consultor = achar(["VENDEDOR", "VENDEDORA", "CONSULTORA"]);
  if (consultor < 0 && status > 0 && colunas[status - 1] === "") consultor = status - 1;
  return { linha: i + 1, colunas, idx: { id: 0, consultor, status, obs: achar(["OBS"]), converteu: achar(["CONVERTEU?"]), receita: achar(["RECEITA"]) } };
}

export function idsDaGuia(valores: string[][], cab: Cabecalho): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = cab.linha; i < valores.length; i++) {
    const id = (valores[i]?.[cab.idx.id] ?? "").trim();
    if (id && !m.has(id)) m.set(id, i + 1);
  }
  return m;
}

export function colLetra(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatarReceita(n: number | null): string {
  return n ? FMT.format(n) : "";
}

export function isoSP(iso: string | null): string {
  const t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  return new Date(t - 3 * 3600000).toISOString().slice(0, 19) + "-03:00";
}

function aspas(titulo: string): string { return `'${titulo.replace(/'/g, "''")}'`; }

function valoresTrabalho(lead: LeadPlanilha): [keyof Indices, string][] {
  return [
    ["consultor", lead.consultor ?? ""],
    ["status", lead.status ?? ""],
    ["obs", lead.obs ?? ""],
    ["converteu", lead.converteu ? "sim" : ""],
    ["receita", formatarReceita(lead.receita)],
  ];
}

export function escritasDaLinha(titulo: string, cab: Cabecalho, linha: number, lead: LeadPlanilha): Escrita[] {
  return valoresTrabalho(lead)
    .filter(([k]) => cab.idx[k] >= 0)
    .map(([k, v]) => ({ range: `${aspas(titulo)}!${colLetra(cab.idx[k])}${linha}`, values: [[v]] }));
}

const CAMPOS_FORM: Record<string, keyof LeadPlanilha> = {
  ad_id: "ad_id", ad_name: "ad_name", adset_id: "adset_id", adset_name: "adset_name", campaign_id: "campaign_id",
  campaign_name: "campaign_name", form_id: "form_id", form_name: "form_name", is_organic: "is_organic", platform: "platform",
  "qual_o_tipo_da_sua_empresa?": "tipo_empresa", "qual_a_quantidade_de_linhas?": "qtd_linhas", "qual_o_seu_cnpj?": "cnpj",
  email: "email", full_name: "full_name", city: "city", state: "state", phone_number: "phone_number", lead_status: "lead_status",
};

export function linhaNova(cab: Cabecalho, lead: LeadPlanilha): string[] {
  const l = cab.colunas.map((c) => {
    if (c === "created_time") return isoSP(lead.criado_em_lead);
    const campo = CAMPOS_FORM[c];
    if (!campo) return "";
    const v = lead[campo];
    return v === null || v === undefined ? "" : String(v);
  });
  l[cab.idx.id] = lead.id;
  for (const [k, v] of valoresTrabalho(lead)) if (cab.idx[k] >= 0) l[cab.idx[k]] = v;
  return l;
}

// Guia de entrada → objetos para a RPC leads_entrada (só campos do formulário).
export function leadsDaEntrada(valores: string[][]): { leads: Record<string, unknown>[]; invalidos: number } {
  const cab = lerCabecalho(valores);
  if (!cab) throw new Error("cabeçalho não encontrado na guia de entrada (esperava 'created_time' na 2ª coluna)");
  const leads: Record<string, unknown>[] = [];
  let invalidos = 0;
  for (let i = cab.linha; i < valores.length; i++) {
    const r = valores[i] ?? [];
    const id = (r[cab.idx.id] ?? "").trim();
    if (!id) continue;
    const get = (nome: string) => { const j = cab.colunas.indexOf(nome); return j < 0 ? null : ((r[j] ?? "").trim() || null); };
    const criado = get("created_time");
    if (criado && isNaN(Date.parse(criado))) { invalidos++; continue; }
    const o: Record<string, unknown> = { id, criado_em_lead: criado };
    for (const [col, campo] of Object.entries(CAMPOS_FORM)) o[campo] = campo === "is_organic" ? (get(col) ?? "").toLowerCase() === "true" : get(col);
    leads.push(o);
  }
  return { leads, invalidos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/planilha-espelho && node --test planilha.test.ts`
Esperado: todos os testes `ok`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/planilha-espelho/planilha.ts supabase/functions/planilha-espelho/planilha.test.ts
git commit -m "feat(planilha-espelho): funcoes puras de guia, cabecalho e linhas (secao 112)"
```

---

### Task 5: Conta de serviço do Google e cliente do Sheets (`google.ts`)

**Files:**
- Create: `supabase/functions/planilha-espelho/google.ts`
- Test: `supabase/functions/planilha-espelho/google.test.ts`

**Interfaces:**
- Consumes: `Guia` de `planilha.ts`.
- Produces:
  ```ts
  export type ContaServico = { client_email: string; private_key: string };
  export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
  export async function assinarJwt(sa: ContaServico, agoraSeg: number): Promise<string>;
  export async function obterToken(sa: ContaServico, agoraSeg: number, f: FetchFn): Promise<string>;
  export type Sheets = {
    guias(): Promise<Guia[]>;
    ler(titulo: string): Promise<string[][]>;
    escrever(dados: { range: string; values: string[][] }[]): Promise<void>;
    acrescentar(titulo: string, linhas: string[][]): Promise<void>;
  };
  export function criarSheets(token: string, sheetId: string, f: FetchFn): Sheets;
  ```

- [ ] **Step 1: Testes `google.test.ts`** (a chave é gerada na hora; nenhuma chave real)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assinarJwt, obterToken, criarSheets } from "./google.ts";

async function chaveFalsa() {
  const par = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", par.privateKey));
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return { par, pem: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n` };
}
const b64urlDec = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

test("JWT RS256 com claims do Google e assinatura válida", async () => {
  const { par, pem } = await chaveFalsa();
  const jwt = await assinarJwt({ client_email: "zz@zz.iam.gserviceaccount.com", private_key: pem }, 1000);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(b64urlDec(h).toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(b64urlDec(c).toString());
  assert.deepEqual(claims, { iss: "zz@zz.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: 1000, exp: 4600 });
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", par.publicKey, b64urlDec(s), new TextEncoder().encode(`${h}.${c}`));
  assert.equal(ok, true);
});

test("obterToken troca o JWT por access_token", async () => {
  const { pem } = await chaveFalsa();
  let corpo = "";
  const f = async (url: string, init?: RequestInit) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    corpo = String(init?.body);
    return new Response(JSON.stringify({ access_token: "tok-zz" }), { status: 200 });
  };
  assert.equal(await obterToken({ client_email: "zz@zz", private_key: pem }, 1000, f), "tok-zz");
  assert.match(corpo, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
});

test("obterToken com erro do Google lança sem vazar a chave", async () => {
  const { pem } = await chaveFalsa();
  const f = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
  await assert.rejects(obterToken({ client_email: "zz@zz", private_key: pem }, 1000, f), (e: Error) => /token do Google: 400/.test(e.message) && !e.message.includes("PRIVATE"));
});

test("cliente do Sheets monta as URLs e corpos certos", async () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const f = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes("?fields=")) return new Response(JSON.stringify({ sheets: [{ properties: { title: "ZZ - OUTUBRO", index: 0 } }] }), { status: 200 });
    if (url.includes("/values/") && !init?.method) return new Response(JSON.stringify({ values: [["a", "b"]] }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const s = criarSheets("tok", "SID", f);
  assert.deepEqual(await s.guias(), [{ titulo: "ZZ - OUTUBRO", indice: 0 }]);
  assert.deepEqual(await s.ler("ZZ - OUTUBRO"), [["a", "b"]]);
  await s.escrever([{ range: "'ZZ'!A2", values: [["x"]] }]);
  await s.acrescentar("ZZ - OUTUBRO", [["l:1", "x"]]);
  assert.equal(chamadas[0].url, "https://sheets.googleapis.com/v4/spreadsheets/SID?fields=sheets.properties(title%2Cindex)");
  assert.equal(chamadas[1].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values/'ZZ%20-%20OUTUBRO'?valueRenderOption=FORMATTED_VALUE");
  assert.equal(chamadas[2].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values:batchUpdate");
  assert.deepEqual(JSON.parse(String(chamadas[2].init?.body)), { valueInputOption: "RAW", data: [{ range: "'ZZ'!A2", values: [["x"]] }] });
  assert.equal(chamadas[3].url, "https://sheets.googleapis.com/v4/spreadsheets/SID/values/'ZZ%20-%20OUTUBRO'!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS");
  assert.equal((chamadas[3].init?.headers as Record<string, string>).Authorization, "Bearer tok");
});

test("escrever vazio não chama a API", async () => {
  let n = 0;
  const s = criarSheets("tok", "SID", async () => { n++; return new Response("{}"); });
  await s.escrever([]);
  await s.acrescentar("X", []);
  assert.equal(n, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/planilha-espelho && node --test google.test.ts`
Esperado: FAIL, "Cannot find module './google.ts'".

- [ ] **Step 3: Implementar `google.ts`**

```ts
// Conta de serviço do Google (JWT RS256 via WebCrypto) + cliente mínimo da Sheets API v4 (§112).
// Nada aqui loga ou devolve a chave privada; erros do Google levam só status e o início da resposta.
import type { Guia } from "./planilha.ts";

export type ContaServico = { client_email: string; private_key: string };
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type Sheets = {
  guias(): Promise<Guia[]>;
  ler(titulo: string): Promise<string[][]>;
  escrever(dados: { range: string; values: string[][] }[]): Promise<void>;
  acrescentar(titulo: string, linhas: string[][]): Promise<void>;
};

const ESCOPO = "https://www.googleapis.com/auth/spreadsheets";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

function b64url(dados: Uint8Array | string): string {
  const bytes = typeof dados === "string" ? new TextEncoder().encode(dados) : dados;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemParaDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function assinarJwt(sa: ContaServico, agoraSeg: number): Promise<string> {
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: ESCOPO, aud: URL_TOKEN, iat: agoraSeg, exp: agoraSeg + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", pemParaDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(`${cab}.${claims}`)));
  return `${cab}.${claims}.${b64url(assinatura)}`;
}

export async function obterToken(sa: ContaServico, agoraSeg: number, f: FetchFn): Promise<string> {
  const jwt = await assinarJwt(sa, agoraSeg);
  const corpo = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }).toString();
  const r = await f(URL_TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo });
  const txt = await r.text();
  if (!r.ok) throw new Error(`token do Google: ${r.status} ${txt.slice(0, 120)}`);
  const tok = JSON.parse(txt).access_token;
  if (!tok) throw new Error("token do Google: resposta sem access_token");
  return tok;
}

function intervalo(titulo: string): string { return `'${titulo.replace(/'/g, "''")}'`; }

export function criarSheets(token: string, sheetId: string, f: FetchFn): Sheets {
  const auth = { Authorization: `Bearer ${token}` };
  const chamar = async (url: string, init?: RequestInit) => {
    const r = await f(url, { ...init, headers: { ...auth, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Sheets ${r.status}: ${txt.slice(0, 200)}`);
    return txt ? JSON.parse(txt) : {};
  };
  return {
    async guias() {
      const j = await chamar(`${API}/${sheetId}?fields=${encodeURIComponent("sheets.properties(title,index)")}`);
      return (j.sheets ?? []).map((s: { properties: { title: string; index: number } }) => ({ titulo: s.properties.title, indice: s.properties.index }));
    },
    async ler(titulo) {
      const j = await chamar(`${API}/${sheetId}/values/${encodeURI(intervalo(titulo))}?valueRenderOption=FORMATTED_VALUE`);
      return (j.values ?? []) as string[][];
    },
    async escrever(dados) {
      if (!dados.length) return;
      await chamar(`${API}/${sheetId}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: dados }) });
    },
    async acrescentar(titulo, linhas) {
      if (!linhas.length) return;
      await chamar(`${API}/${sheetId}/values/${encodeURI(intervalo(titulo) + "!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: linhas }) });
    },
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/planilha-espelho && node --test google.test.ts`
Esperado: todos `ok`. Se a URL de `ler` sair com `%27` no lugar de `'`, é porque usaram `encodeURIComponent`. Manter `encodeURI`, que preserva a aspa como o Google aceita, e ajustar só se o teste real da Task 11 mostrar HTTP 400.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/planilha-espelho/google.ts supabase/functions/planilha-espelho/google.test.ts
git commit -m "feat(planilha-espelho): JWT da conta de servico e cliente do Sheets (secao 112)"
```

---

### Task 6: Fila no banco e orquestração da rodada (`espelho.ts` + `index.ts`)

**Files:**
- Create: `supabase/migrations/20261026120300_leads_espelho_fila.sql`
- Create: `supabase/functions/planilha-espelho/espelho.ts`
- Create: `supabase/functions/planilha-espelho/index.ts`
- Test: `supabase/functions/planilha-espelho/espelho.test.ts`
- Modify: `supabase/tests/leads_kanban_check.sql` (bloco "Task 6")

**Interfaces:**
- Consumes: `planilha.ts` (Task 4), `google.ts` (Task 5), `leads_entrada` e `leads_espelho` (Tasks 1-2).
- Produces:
  - SQL (só service_role):
    - `leads_espelho_pegar(p_limite int) → table(lead_aba, lead_id, pedido_em, tentativas)`;
    - `leads_espelho_feito(p_itens jsonb) → int`;
    - `leads_espelho_falha(p_itens jsonb, p_erro text) → void`;
    - `leads_espelho_adiar(p_itens jsonb, p_motivo text) → void`;
    - `leads_espelho_atraso() → numeric` (minutos do pendente mais antigo, ou null).
  - TS:
    ```ts
    export type ItemFila = { lead_aba: string; lead_id: string; pedido_em: string; tentativas: number };
    export type DepsEspelho = {
      sheets: Sheets; cfg: CfgPlanilha; modo: string;
      pegarFila(limite: number): Promise<ItemFila[]>;
      leadsDaAba(aba: string): Promise<LeadPlanilha[]>;
      buscarLeads(chaves: { aba: string; id: string }[]): Promise<LeadPlanilha[]>;
      marcarFeito(itens: ItemFila[], guiaPorLead: Record<string, string>): Promise<void>;
      marcarFalha(itens: ItemFila[], erro: string): Promise<void>;
      adiar(itens: ItemFila[], motivo: string): Promise<void>;
      inserirEntrada(leads: Record<string, unknown>[]): Promise<{ inseridos: number; atualizados: number }>;
      registrarEntrada(erro: string | null): Promise<void>;
      atrasoMin(): Promise<number | null>;
      avisar(msg: string): Promise<void>;
    };
    export type Resultado = { ok: boolean; modo: string; entrada?: { inseridos: number; atualizados: number; invalidos: number };
      escritos: number; criados: number; adiados: number; falhas: number; aviso: string;
      ensaio?: Record<string, { atualizar: number; criar: number }> };
    export async function rodar(deps: DepsEspelho, op: { ensaioAba?: string }): Promise<Resultado>;
    ```

- [ ] **Step 1: Testes da orquestração `espelho.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rodar } from "./espelho.ts";
import type { DepsEspelho, ItemFila } from "./espelho.ts";
import type { LeadPlanilha } from "./planilha.ts";

const CAB = ["", "created_time", "full_name", "VENDEDOR", "STATUS", "OBS", "CONVERTEU?", "RECEITA"];
const lead = (id: string, o: Partial<LeadPlanilha> = {}): LeadPlanilha => ({ aba: "OUTUBRO", id, criado_em_lead: "2026-10-25T22:00:00+00:00",
  full_name: "Zz " + id, consultor: "ZZKCON", status: "EM NEGOCIAÇÂO", obs: "", converteu: false, receita: 0, ...o });
const item = (id: string, aba = "OUTUBRO"): ItemFila => ({ lead_aba: aba, lead_id: id, pedido_em: "2026-10-26T10:00:00Z", tentativas: 0 });

function deps(o: { fila?: ItemFila[]; leads?: LeadPlanilha[]; guias?: { titulo: string; indice: number }[]; valores?: Record<string, string[][]>;
  modo?: string; falharEscrita?: boolean; atraso?: number | null } = {}) {
  const log = { escritas: [] as unknown[], acrescentadas: [] as unknown[], feitos: [] as unknown[], falhas: [] as unknown[], adiados: [] as unknown[],
    avisos: [] as string[], entrada: [] as unknown[] };
  const valores = o.valores ?? {
    "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB, ["l:novo", "2026-10-26T08:00:00-03:00", "Zz Novo"]],
    "LEADS CLARO B2B APEX - OUTUBRO": [CAB, ["l:1", "2026-10-25T19:00:00-03:00", "Zz l:1"]],
  };
  const d: DepsEspelho = {
    sheets: {
      async guias() { return o.guias ?? [{ titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 }, { titulo: "FORM- LEADS CLARO B2B APEX - AGOSTO", indice: 1 }]; },
      async ler(t) { return valores[t] ?? []; },
      async escrever(x) { if (o.falharEscrita) throw new Error("Sheets 503: indisponível"); log.escritas.push(...x); },
      async acrescentar(t, l) { if (o.falharEscrita) throw new Error("Sheets 503: indisponível"); log.acrescentadas.push({ t, l }); },
    },
    cfg: { sheet_id: "zz", entrada_prefixo: "FORM-", guia_mes_contem: "CLARO B2B", guias_fixas: { AGOSTO: "FORM- LEADS CLARO B2B APEX - AGOSTO" } },
    modo: o.modo ?? "painel",
    async pegarFila() { return o.fila ?? []; },
    async leadsDaAba(aba) { return (o.leads ?? []).filter((l) => l.aba === aba); },
    async buscarLeads(ch) { return (o.leads ?? []).filter((l) => ch.some((c) => c.aba === l.aba && c.id === l.id)); },
    async marcarFeito(i, g) { log.feitos.push({ i, g }); },
    async marcarFalha(i, e) { log.falhas.push({ i, e }); },
    async adiar(i, m) { log.adiados.push({ i, m }); },
    async inserirEntrada(l) { log.entrada.push(...l); return { inseridos: 1, atualizados: 0 }; },
    async registrarEntrada() {},
    async atrasoMin() { return o.atraso ?? null; },
    async avisar(m) { log.avisos.push(m); },
  };
  return { d, log };
}

test("modo planilha não faz nada (exceto ensaio)", async () => {
  const { d, log } = deps({ modo: "planilha", fila: [item("l:1")], leads: [lead("l:1")] });
  const r = await rodar(d, {});
  assert.equal(r.escritos + r.criados, 0);
  assert.equal(log.entrada.length, 0);
});

test("entrada: manda os leads da guia FORM- para o banco", async () => {
  const { d, log } = deps();
  const r = await rodar(d, {});
  assert.deepEqual(r.entrada, { inseridos: 1, atualizados: 0, invalidos: 0 });
  assert.equal((log.entrada[0] as { id: string }).id, "l:novo");
});

test("linha existente: escreve; linha que não existe: acrescenta; marca feito com a guia", async () => {
  const { d, log } = deps({ fila: [item("l:1"), item("l:2")], leads: [lead("l:1", { status: "CNPJ INAPTO" }), lead("l:2")] });
  const r = await rodar(d, {});
  assert.equal(r.escritos, 1);
  assert.equal(r.criados, 1);
  assert.ok((log.escritas as { range: string }[]).some((e) => e.range === "'LEADS CLARO B2B APEX - OUTUBRO'!E2"));
  assert.equal((log.acrescentadas[0] as { l: string[][] }).l[0][0], "l:2");
  assert.deepEqual((log.feitos[0] as { g: Record<string, string> }).g, { "OUTUBRO|l:1": "LEADS CLARO B2B APEX - OUTUBRO", "OUTUBRO|l:2": "LEADS CLARO B2B APEX - OUTUBRO" });
});

test("guia do mês não existe: adia sem falhar e avisa para criar", async () => {
  const { d, log } = deps({ fila: [item("l:9", "NOVEMBRO")], leads: [lead("l:9", { aba: "NOVEMBRO" })] });
  const r = await rodar(d, {});
  assert.equal(r.adiados, 1);
  assert.equal(log.falhas.length, 0);
  assert.match(log.avisos.at(-1)!, /Crie a guia de NOVEMBRO/);
});

test("Google fora do ar: marca falha, não marca feito", async () => {
  const { d, log } = deps({ fila: [item("l:1")], leads: [lead("l:1")], falharEscrita: true });
  const r = await rodar(d, {});
  assert.equal(r.falhas, 1);
  assert.equal(log.feitos.length, 0);
  assert.match((log.falhas[0] as { e: string }).e, /Sheets 503/);
});

test("guia sem coluna STATUS: falha com mensagem clara e não escreve nada nela", async () => {
  const { d, log } = deps({ fila: [item("l:1")], leads: [lead("l:1")], valores: { "LEADS CLARO B2B APEX - OUTUBRO": [["", "created_time", "full_name"]], "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB] } });
  await rodar(d, {});
  assert.equal(log.escritas.length + log.acrescentadas.length, 0);
  assert.match((log.falhas[0] as { e: string }).e, /coluna STATUS/);
});

test("atraso > 15 min vira aviso; fila ok limpa o aviso", async () => {
  const a = deps({ atraso: 22 });
  await rodar(a.d, {});
  assert.match(a.log.avisos.at(-1)!, /atrasada há 22 min/);
  const b = deps({ atraso: 3 });
  await rodar(b.d, {});
  assert.equal(b.log.avisos.at(-1), "");
});

test("ensaio: calcula por guia sem escrever, sem entrada e sem mexer na fila", async () => {
  const { d, log } = deps({ modo: "planilha", leads: [lead("l:1"), lead("l:2")] });
  const r = await rodar(d, { ensaioAba: "OUTUBRO" });
  assert.deepEqual(r.ensaio, { "LEADS CLARO B2B APEX - OUTUBRO": { atualizar: 1, criar: 1 } });
  assert.equal(log.escritas.length + log.acrescentadas.length + log.feitos.length + log.entrada.length, 0);
});

test("mesmo lead novo 2x no lote: acrescenta 1 linha só (Review Focus 2)", async () => {
  const { d, log } = deps({ fila: [item("l:2"), item("l:2")], leads: [lead("l:2")] });
  await rodar(d, {});
  assert.equal((log.acrescentadas[0] as { l: string[][] }).l.length, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/planilha-espelho && node --test espelho.test.ts`
Esperado: FAIL, "Cannot find module './espelho.ts'".

- [ ] **Step 3: Implementar `espelho.ts`**

```ts
// Uma rodada da planilha-espelho (§112): (1) guia de entrada → banco; (2) fila → guia do mês; (3) aviso.
// Dependências injetadas: aqui não há rede nem banco (testado com node --test).
import type { Sheets } from "./google.ts";
import type { CfgPlanilha, Guia, LeadPlanilha } from "./planilha.ts";
import { escolherGuia, escritasDaLinha, guiaEntrada, guiasDoMes, idsDaGuia, leadsDaEntrada, lerCabecalho, linhaNova } from "./planilha.ts";

export type ItemFila = { lead_aba: string; lead_id: string; pedido_em: string; tentativas: number };
export type DepsEspelho = {
  sheets: Sheets; cfg: CfgPlanilha; modo: string;
  pegarFila(limite: number): Promise<ItemFila[]>;
  leadsDaAba(aba: string): Promise<LeadPlanilha[]>;
  buscarLeads(chaves: { aba: string; id: string }[]): Promise<LeadPlanilha[]>;
  marcarFeito(itens: ItemFila[], guiaPorLead: Record<string, string>): Promise<void>;
  marcarFalha(itens: ItemFila[], erro: string): Promise<void>;
  adiar(itens: ItemFila[], motivo: string): Promise<void>;
  inserirEntrada(leads: Record<string, unknown>[]): Promise<{ inseridos: number; atualizados: number }>;
  registrarEntrada(erro: string | null): Promise<void>;
  atrasoMin(): Promise<number | null>;
  avisar(msg: string): Promise<void>;
};
export type Resultado = {
  ok: boolean; modo: string; entrada?: { inseridos: number; atualizados: number; invalidos: number };
  escritos: number; criados: number; adiados: number; falhas: number; aviso: string;
  ensaio?: Record<string, { atualizar: number; criar: number }>;
};

const LOTE = 100;
const ATRASO_AVISO_MIN = 15;
const chave = (aba: string, id: string) => `${aba}|${id}`;

export async function rodar(deps: DepsEspelho, op: { ensaioAba?: string }): Promise<Resultado> {
  const res: Resultado = { ok: true, modo: deps.modo, escritos: 0, criados: 0, adiados: 0, falhas: 0, aviso: "" };
  const ensaio = !!op.ensaioAba;
  if (deps.modo !== "painel" && !ensaio) return res;

  const guias = await deps.sheets.guias();
  const cache = new Map<string, string[][]>();
  const ler = async (t: string) => { if (!cache.has(t)) cache.set(t, await deps.sheets.ler(t)); return cache.get(t)!; };

  // (1) entrada
  if (!ensaio) {
    try {
      const g = guiaEntrada(guias, deps.cfg);
      if (!g) throw new Error(`guia de entrada (título começando com "${deps.cfg.entrada_prefixo}") não encontrada`);
      const { leads, invalidos } = leadsDaEntrada(await ler(g.titulo));
      const r = await deps.inserirEntrada(leads);
      res.entrada = { ...r, invalidos };
      await deps.registrarEntrada(null);
    } catch (e) {
      res.ok = false;
      await deps.registrarEntrada((e as Error).message);
    }
  }

  // (2) fila (ou, no ensaio, todos os leads da aba pedida)
  let itens: ItemFila[];
  let leads: LeadPlanilha[];
  if (ensaio) {
    leads = await deps.leadsDaAba(op.ensaioAba!);
    itens = leads.map((l) => ({ lead_aba: l.aba, lead_id: l.id, pedido_em: "", tentativas: 0 }));
  } else {
    const brutos = await deps.pegarFila(LOTE);
    const vistos = new Set<string>();
    itens = brutos.filter((i) => { const k = chave(i.lead_aba, i.lead_id); if (vistos.has(k)) return false; vistos.add(k); return true; });
    leads = itens.length ? await deps.buscarLeads(itens.map((i) => ({ aba: i.lead_aba, id: i.lead_id }))) : [];
  }
  const porLead = new Map(leads.map((l) => [chave(l.aba, l.id), l]));
  const porAba = new Map<string, ItemFila[]>();
  for (const i of itens) porAba.set(i.lead_aba, [...(porAba.get(i.lead_aba) ?? []), i]);

  const faltando: string[] = [];
  const contagem: Record<string, { atualizar: number; criar: number }> = {};
  for (const [aba, doMes] of porAba) {
    const cands = guiasDoMes(guias, aba, deps.cfg);
    if (!cands.length) {
      faltando.push(aba);
      if (!ensaio) { await deps.adiar(doMes, `guia do mês ${aba} não existe na planilha`); res.adiados += doMes.length; }
      continue;
    }
    try {
      const idsPorGuia = new Map<string, Set<string>>();
      const info = new Map<string, { cab: NonNullable<ReturnType<typeof lerCabecalho>>; linhas: Map<string, number> }>();
      for (const g of cands) {
        const v = await ler(g.titulo);
        const cab = lerCabecalho(v);
        if (!cab || cab.idx.status < 0) throw new Error(`guia "${g.titulo}": cabeçalho ou coluna STATUS não encontrado`);
        const linhas = idsDaGuia(v, cab);
        info.set(g.titulo, { cab, linhas });
        idsPorGuia.set(g.titulo, new Set(linhas.keys()));
      }
      const escritas: { range: string; values: string[][] }[] = [];
      const novas = new Map<string, string[][]>();
      const guiaPorLead: Record<string, string> = {};
      const prontos: ItemFila[] = [];
      for (const i of doMes) {
        const l = porLead.get(chave(i.lead_aba, i.lead_id));
        if (!l) { prontos.push(i); continue; }   // lead apagado do banco: nada a espelhar
        const g = escolherGuia(cands, idsPorGuia, l.id) as Guia;
        const { cab, linhas } = info.get(g.titulo)!;
        const n = linhas.get(l.id);
        contagem[g.titulo] = contagem[g.titulo] ?? { atualizar: 0, criar: 0 };
        if (n) { escritas.push(...escritasDaLinha(g.titulo, cab, n, l)); contagem[g.titulo].atualizar++; res.escritos++; }
        else { novas.set(g.titulo, [...(novas.get(g.titulo) ?? []), linhaNova(cab, l)]); contagem[g.titulo].criar++; res.criados++; }
        guiaPorLead[chave(l.aba, l.id)] = g.titulo;
        prontos.push(i);
      }
      if (!ensaio) {
        for (let k = 0; k < escritas.length; k += 500) await deps.sheets.escrever(escritas.slice(k, k + 500));
        for (const [t, linhas] of novas) await deps.sheets.acrescentar(t, linhas);
        await deps.marcarFeito(prontos, guiaPorLead);
      }
    } catch (e) {
      res.ok = false;
      res.escritos = 0; res.criados = 0;
      res.falhas += doMes.length;
      if (!ensaio) await deps.marcarFalha(doMes, (e as Error).message);
      else throw e;
    }
  }
  if (ensaio) { res.ensaio = contagem; return res; }

  // (3) aviso para admin/supervisor
  if (faltando.length) res.aviso = `Crie a guia de ${faltando.join(", ")} na planilha — os leads desse mês estão esperando para ser escritos.`;
  else {
    const atraso = await deps.atrasoMin();
    if (atraso !== null && atraso > ATRASO_AVISO_MIN) res.aviso = `A planilha está atrasada há ${Math.round(atraso)} min (o painel funciona normal; a escrita tenta de novo sozinha).`;
  }
  await deps.avisar(res.aviso);
  return res;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/planilha-espelho && node --test espelho.test.ts`
Esperado: todos `ok`.

- [ ] **Step 5: Migration da fila `supabase/migrations/20261026120300_leads_espelho_fila.sql`**

```sql
-- §112 Fila do espelho: funções usadas só pela Edge Function planilha-espelho (service_role).
begin;
-- Reserva até p_limite itens vencidos (skip locked: duas rodadas nunca pegam o mesmo item — Review Focus 2).
create or replace function public.leads_espelho_pegar(p_limite int)
returns table(lead_aba text, lead_id text, pedido_em timestamptz, tentativas int)
language sql security definer set search_path = public as $$
  update public.leads_espelho e set proxima_em = now() + interval '2 minutes'
   where (e.lead_aba, e.lead_id) in (
     select f.lead_aba, f.lead_id from public.leads_espelho f
      where f.feito_em is null and f.proxima_em <= now()
      order by f.pedido_em limit p_limite for update skip locked)
  returning e.lead_aba, e.lead_id, e.pedido_em, e.tentativas;
$$;

-- Marca feito só se ninguém pediu de novo durante a rodada (pedido_em igual — Review Focus 3).
-- p_itens: [{lead_aba, lead_id, pedido_em, guia}]
create or replace function public.leads_espelho_feito(p_itens jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.leads_espelho e set feito_em = now(), ultimo_erro = null
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.pedido_em = (x ->> 'pedido_em')::timestamptz;
  get diagnostics n = row_count;
  update public.leads l set aba_planilha = x ->> 'guia'
    from jsonb_array_elements(p_itens) x
   where l.aba = x ->> 'lead_aba' and l.id = x ->> 'lead_id' and coalesce(x ->> 'guia', '') <> ''
     and l.aba_planilha is distinct from x ->> 'guia';
  return n;
end $$;

-- Falha: espera 1, 2, 5, 10 e depois 30 min.
create or replace function public.leads_espelho_falha(p_itens jsonb, p_erro text) returns void
language sql security definer set search_path = public as $$
  update public.leads_espelho e set tentativas = e.tentativas + 1, ultimo_erro = left(p_erro, 300),
         proxima_em = now() + make_interval(mins => (array[1, 2, 5, 10, 30])[least(e.tentativas + 1, 5)])
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.feito_em is null;
$$;

-- Guia do mês ainda não existe: tenta de novo em 5 min sem contar tentativa.
create or replace function public.leads_espelho_adiar(p_itens jsonb, p_motivo text) returns void
language sql security definer set search_path = public as $$
  update public.leads_espelho e set proxima_em = now() + interval '5 minutes', ultimo_erro = left(p_motivo, 300)
    from jsonb_array_elements(p_itens) x
   where e.lead_aba = x ->> 'lead_aba' and e.lead_id = x ->> 'lead_id' and e.feito_em is null;
$$;

create or replace function public.leads_espelho_atraso() returns numeric
language sql stable security definer set search_path = public as $$
  select round(extract(epoch from now() - min(pedido_em)) / 60) from public.leads_espelho where feito_em is null;
$$;

revoke all on function public.leads_espelho_pegar(int) from public, anon, authenticated;
revoke all on function public.leads_espelho_feito(jsonb) from public, anon, authenticated;
revoke all on function public.leads_espelho_falha(jsonb, text) from public, anon, authenticated;
revoke all on function public.leads_espelho_adiar(jsonb, text) from public, anon, authenticated;
revoke all on function public.leads_espelho_atraso() from public, anon, authenticated;
commit;
```

- [ ] **Step 6: Teste de banco do bloco "Task 6"** (no `do $$` do check)

```sql
  -- ===== Task 6: fila ===== (os itens de zz:1/zz:2/zz:3 estão pendentes desde o bloco da Task 2)
  update public.leads_espelho set proxima_em = now() - interval '1 second' where lead_aba = 'JUNHO';
  assert (select count(*) from public.leads_espelho_pegar(100) where lead_aba = 'JUNHO') = 3, 'pegar reserva os 3 itens';
  assert (select count(*) from public.leads_espelho_pegar(100) where lead_aba = 'JUNHO') = 0, 'reservados não voltam na rodada seguinte';
  -- feito com pedido_em velho não marca (consultor reclassificou no meio)
  perform public.leads_espelho_feito(jsonb_build_array(jsonb_build_object('lead_aba', 'JUNHO', 'lead_id', 'zz:1', 'pedido_em', '2000-01-01T00:00:00Z', 'guia', 'G')));
  assert (select feito_em is null from public.leads_espelho where lead_id = 'zz:1'), 'pedido_em diferente não marca feito';
  perform public.leads_espelho_feito((select jsonb_agg(jsonb_build_object('lead_aba', lead_aba, 'lead_id', lead_id, 'pedido_em', pedido_em, 'guia', 'ZZ GUIA'))
                                        from public.leads_espelho where lead_id = 'zz:2'));
  assert (select feito_em is not null from public.leads_espelho where lead_id = 'zz:2'), 'feito com pedido_em igual';
  assert (select aba_planilha = 'ZZ GUIA' from public.leads where id = 'zz:2'), 'aba_planilha gravada';
  perform public.leads_espelho_falha(jsonb_build_array(jsonb_build_object('lead_aba', 'JUNHO', 'lead_id', 'zz:3')), 'Sheets 503');
  assert (select tentativas = 1 and proxima_em > now() + interval '50 seconds' and ultimo_erro = 'Sheets 503' from public.leads_espelho where lead_id = 'zz:3'), 'falha conta tentativa e espera 1 min';
```

- [ ] **Step 7: Implementar `index.ts`**

```ts
// Edge Function: planilha-espelho (§112). Chamada pelo pg_cron a cada minuto com x-cron-secret (o mesmo SYNC_CRON_SECRET da
// sync-leads). Lê a guia de entrada do formulário → leads novos no banco; esvazia a fila leads_espelho → guia do mês.
// Corpo opcional: {"ensaio_aba":"OUTUBRO"} = ensaio a seco (calcula por guia, não escreve nada).
// Publicar: deploy_edge_function (index.ts, espelho.ts, planilha.ts, google.ts), verify_jwt=false. Secret: GOOGLE_SA_JSON.
import { createClient } from "npm:@supabase/supabase-js@2";
import { rodar } from "./espelho.ts";
import type { DepsEspelho, ItemFila } from "./espelho.ts";
import { criarSheets, obterToken } from "./google.ts";
import type { CfgPlanilha, LeadPlanilha } from "./planilha.ts";

const COLS = "aba,id,criado_em_lead,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,tipo_empresa,qtd_linhas,cnpj,email,full_name,city,state,phone_number,lead_status,consultor,status,obs,converteu,receita";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const agoraSP = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

Deno.serve(async (req) => {
  const segredo = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!segredo || !iguais(req.headers.get("x-cron-secret") ?? "", segredo)) return json({ error: "não autorizado" }, 401);
  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const falha = (ctx: string, error: { code?: string; message?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
    const cfgRows = await sb.from("config").select("chave,valor").in("chave", ["leads_modo", "leads_planilha"]);
    falha("ler config", cfgRows.error);
    const cfgMap = Object.fromEntries((cfgRows.data ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor]));
    const cfg = JSON.parse(cfgMap.leads_planilha || "{}") as CfgPlanilha;
    if (!cfg.sheet_id) throw new Error("config.leads_planilha sem sheet_id");
    const sa = JSON.parse(Deno.env.get("GOOGLE_SA_JSON") || "{}");
    if (!sa.client_email || !sa.private_key) throw new Error("secret GOOGLE_SA_JSON ausente ou inválido");
    const token = await obterToken(sa, Math.floor(Date.now() / 1000), fetch);
    const paraJson = (itens: ItemFila[], g: Record<string, string> = {}) =>
      itens.map((i) => ({ lead_aba: i.lead_aba, lead_id: i.lead_id, pedido_em: i.pedido_em, guia: g[`${i.lead_aba}|${i.lead_id}`] ?? "" }));
    const deps: DepsEspelho = {
      sheets: criarSheets(token, cfg.sheet_id, fetch),
      cfg,
      modo: cfgMap.leads_modo || "planilha",
      async pegarFila(limite) { const r = await sb.rpc("leads_espelho_pegar", { p_limite: limite }); falha("pegar fila", r.error); return r.data ?? []; },
      async leadsDaAba(aba) { const r = await sb.from("leads").select(COLS).eq("aba", aba).limit(5000); falha("ler leads da aba", r.error); return (r.data ?? []) as LeadPlanilha[]; },
      async buscarLeads(ch) {
        const out: LeadPlanilha[] = [];
        for (const aba of [...new Set(ch.map((c) => c.aba))]) {
          const ids = ch.filter((c) => c.aba === aba).map((c) => c.id);
          const r = await sb.from("leads").select(COLS).eq("aba", aba).in("id", ids);
          falha("ler leads da fila", r.error);
          out.push(...((r.data ?? []) as LeadPlanilha[]));
        }
        return out;
      },
      async marcarFeito(itens, g) { if (itens.length) falha("marcar feito", (await sb.rpc("leads_espelho_feito", { p_itens: paraJson(itens, g) })).error); },
      async marcarFalha(itens, erro) { if (itens.length) falha("marcar falha", (await sb.rpc("leads_espelho_falha", { p_itens: paraJson(itens), p_erro: erro })).error); },
      async adiar(itens, motivo) { if (itens.length) falha("adiar", (await sb.rpc("leads_espelho_adiar", { p_itens: paraJson(itens), p_motivo: motivo })).error); },
      async inserirEntrada(leads) { const r = await sb.rpc("leads_entrada", { p_leads: leads }); falha("gravar entrada", r.error); return r.data; },
      async registrarEntrada(erro) {
        const linhas = erro ? [{ chave: "leads_sync_erro", valor: `${agoraSP()} — ${erro}` }]
                            : [{ chave: "leads_atualizado_em", valor: agoraSP() }, { chave: "leads_sync_erro", valor: "" }];
        falha("registrar entrada", (await sb.from("config").upsert(linhas, { onConflict: "chave" })).error);
      },
      async atrasoMin() { const r = await sb.rpc("leads_espelho_atraso"); falha("atraso", r.error); return r.data === null ? null : Number(r.data); },
      async avisar(msg) { falha("aviso", (await sb.from("config").upsert({ chave: "leads_espelho_aviso", valor: msg }, { onConflict: "chave" })).error); },
    };
    const r = await rodar(deps, { ensaioAba: typeof corpo.ensaio_aba === "string" ? corpo.ensaio_aba : undefined });
    return json(r, 200);
  } catch (e) {
    console.error("planilha-espelho:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 7b: Rodar todos os testes da função**

Run: `cd supabase/functions/planilha-espelho && node --test planilha.test.ts google.test.ts espelho.test.ts`
Esperado: todos `ok`.

- [ ] **Step 8: Com ok do Rafael, aplicar a 120300 e rodar o check inteiro.** Esperado: sem `assert` falhando e ROLLBACK no fim.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20261026120300_leads_espelho_fila.sql supabase/functions/planilha-espelho/espelho.ts supabase/functions/planilha-espelho/espelho.test.ts supabase/functions/planilha-espelho/index.ts supabase/tests/leads_kanban_check.sql
git commit -m "feat(planilha-espelho): fila reservada, orquestracao da rodada e Edge Function (secao 112)"
```

---

### Task 7: `sync-leads` sai cedo no modo painel

**Files:**
- Modify: `edge_function_sync_leads.ts` (logo depois do bloco de autenticação, antes de `const registrarErro`)
- Test: `test_edge_function_sync_leads.js`

**Interfaces:**
- Consumes: `config.leads_modo` (Task 1).

- [ ] **Step 1: Teste** (no fim de `test_edge_function_sync_leads.js`, antes do `console.log('--- RESULTADO:'`)

```js
// --- 26/10/2026 (seção 112): no modo painel a sync-leads não lê nem grava nada (a planilha-espelho faz a entrada) ---
{
  const handlerSrc = fs.readFileSync('edge_function_sync_leads.ts', 'utf8');
  const iModo = handlerSrc.indexOf('leads_modo');
  const iFetch = handlerSrc.indexOf('await fetch(sheetTabCsvUrl');
  assert(iModo > 0 && iModo < iFetch, 'handler consulta config.leads_modo antes de baixar a planilha');
  assert(/modo: "painel"/.test(handlerSrc), 'resposta identifica o modo painel');
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=$(pwd -W)/node_modules node test_edge_function_sync_leads.js | tail -3`
Esperado: `FALHOU: handler consulta config.leads_modo antes de baixar a planilha`.

- [ ] **Step 3: Implementar.** Em `edge_function_sync_leads.ts`, logo antes de `// Erro de sincronização fica em config.leads_sync_erro`, inserir:

```ts
    // 26/10/2026 (REGRAS seção 112): no modo "painel" o banco é a fonte da verdade e a Edge Function planilha-espelho
    // já traz os leads novos da guia de entrada a cada minuto. Esta função não lê nem grava nada, para não
    // sobrescrever o que os consultores classificaram no painel. Voltar ao modo antigo: config.leads_modo = 'planilha'.
    const { data: modoRow } = await admin.from("config").select("valor").eq("chave", "leads_modo").maybeSingle();
    if ((modoRow?.valor ?? "planilha") === "painel") {
      return json({ ok: true, modo: "painel", msg: "Modo painel: a entrada de leads é feita pela planilha-espelho." }, 200, corsHeaders);
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=$(pwd -W)/node_modules node test_edge_function_sync_leads.js | tail -1`
Esperado: `--- RESULTADO: 129 passaram, 0 falharam ---` (127 de antes + 2).

- [ ] **Step 5: Commit**

```bash
git add edge_function_sync_leads.ts test_edge_function_sync_leads.js
git commit -m "feat(sync-leads): sai cedo no modo painel (secao 112)"
```

---

### Task 8: Painel: funções puras do Kanban

**Files:**
- Modify: `_template.html` (novo bloco de JS `/* ============ MEUS LEADS (KANBAN) — §112 ============ */` logo antes do bloco `/* ============ BIOMETRIA ============`)
- Create: `test_leads_kanban.js`

**Interfaces:**
- Consumes: linhas de `leads_kanban` (Task 2).
- Produces (globais no `<script>`):
  ```js
  const KB_COLUNAS = ['livres', 'novos', 'andamento', 'convertido', 'perdido'];
  const KB_LIVRES_VISIVEIS = 20;
  function kbColunaDoLead(l) → 'livres'|'novos'|'andamento'|'convertido'|'perdido'
  function kbMontar(leads) → { livres:[], novos:[], andamento:[], convertido:[], perdido:[] }   // já ordenadas
  function kbDivergencia(l) → string|null
  function kbGrupoDaColuna(col) → 'andamento'|'convertido'|'perdido'|null
  function kbOpcoesDoGrupo(opcoes, grupo) → [{status, grupo, ordem}] ordenadas (grupo null = todas)
  function kbValidar(form, hojeIso) → '' ou mensagem de erro   // form = {status, grupo, receita, retorno}
  function kbTempoDesde(iso, agoraMs) → 'agora'|'há N min'|'há N h'|'há N dias'
  ```

- [ ] **Step 1: Criar `test_leads_kanban.js`** (harness igual ao de `test_velocidade_lead.js`, completo aqui)

```js
// Testa o Kanban "Meus leads" (§112). Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
// Decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom. DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const L = (id, o) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Zz ' + id, categoria: 'sem_contato', livre: false, venda_neo: false,
    converteu: false, criado_em_lead: '2026-10-26T12:00:00Z', classificado_em: null, retorno_em: null, status: null }, o || {});

  // ==== Task 8: funções puras ====
  eq(kbColunaDoLead(L('a', { livre: true })), 'livres', 'livre');
  eq(kbColunaDoLead(L('b')), 'novos', 'meu sem status');
  eq(kbColunaDoLead(L('c', { categoria: 'andamento' })), 'andamento', 'andamento');
  eq(kbColunaDoLead(L('d', { categoria: 'perdido', venda_neo: true })), 'convertido', 'venda no NEO leva para Convertido');
  eq(kbColunaDoLead(L('e', { categoria: 'perdido' })), 'perdido', 'perdido');
  const m = kbMontar([L('n1', { livre: true, criado_em_lead: '2026-10-26T10:00:00Z' }), L('n2', { livre: true, criado_em_lead: '2026-10-26T11:00:00Z' }),
    L('v1', { criado_em_lead: '2026-10-26T11:00:00Z' }), L('v2', { criado_em_lead: '2026-10-26T09:00:00Z' }),
    L('a1', { categoria: 'andamento', retorno_em: '2026-10-28' }), L('a2', { categoria: 'andamento', retorno_em: null }), L('a3', { categoria: 'andamento', retorno_em: '2026-10-27' })]);
  eq(m.livres.map(x => x.lead_id), ['n2', 'n1'], 'Livres: mais novo primeiro');
  eq(m.novos.map(x => x.lead_id), ['v2', 'v1'], 'Meus novos: mais antigo primeiro (urgência)');
  eq(m.andamento.map(x => x.lead_id), ['a3', 'a1', 'a2'], 'Andamento: retorno mais próximo primeiro, sem retorno no fim');
  eq(kbDivergencia(L('x', { venda_neo: true, converteu: false })), 'NEO tem venda neste CNPJ, mas o lead não está marcado como convertido', 'divergência NEO sem marcar');
  eq(kbDivergencia(L('x', { categoria: 'convertido', converteu: true, venda_neo: false })), 'Marcado como venda, mas o NEO ainda não tem pedido neste CNPJ', 'divergência marcado sem NEO');
  eq(kbDivergencia(L('x', { livre: true, venda_neo: true })), null, 'livre não tem divergência');
  eq(kbDivergencia(L('x', { categoria: 'convertido', converteu: true, venda_neo: true })), null, 'bate com o NEO');
  eq([kbGrupoDaColuna('andamento'), kbGrupoDaColuna('novos'), kbGrupoDaColuna('livres')], ['andamento', null, null], 'grupo da coluna');
  const ops = [{ status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }, { status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'CLIENTE NÃO RESPONDE', grupo: 'perdido', ordem: 20 }];
  eq(kbOpcoesDoGrupo(ops, 'perdido').map(o => o.status), ['CLIENTE NÃO RESPONDE', 'CNPJ INAPTO'], 'opções do grupo em ordem');
  eq(kbOpcoesDoGrupo(ops, null).length, 3, 'sem grupo = todas');
  eq(kbValidar({ status: '', grupo: null }, '2026-10-26'), 'Escolha o status.', 'status obrigatório');
  eq(kbValidar({ status: 'AGENDADO RETORNO', grupo: 'andamento', retorno: '' }, '2026-10-26'), 'Informe a data do retorno.', 'retorno obrigatório');
  eq(kbValidar({ status: 'AGENDADO RETORNO', grupo: 'andamento', retorno: '2026-10-25' }, '2026-10-26'), 'A data do retorno não pode ser no passado.', 'retorno no passado');
  eq(kbValidar({ status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', receita: '-1' }, '2026-10-26'), 'Receita inválida.', 'receita negativa');
  eq(kbValidar({ status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', receita: '1.234,50' }, '2026-10-26'), '', 'receita em formato BR ok');
  const agora = Date.parse('2026-10-26T12:00:00Z');
  eq([kbTempoDesde('2026-10-26T11:59:40Z', agora), kbTempoDesde('2026-10-26T11:57:00Z', agora), kbTempoDesde('2026-10-26T09:00:00Z', agora), kbTempoDesde('2026-10-23T12:00:00Z', agora)],
     ['agora', 'há 3 min', 'há 3 h', 'há 3 dias'], 'tempo desde');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_leads_kanban.js | tail -2`
Esperado: `FALHA: ReferenceError: kbColunaDoLead is not defined`.

- [ ] **Step 3: Implementar** (colar em `_template.html` antes de `/* ============ BIOMETRIA ============`)

```js
/* ============ MEUS LEADS (KANBAN) — §112 ============
   26/10/2026: a equipe de leads pega e classifica os leads aqui; a planilha vira espelho (Edge Function planilha-espelho).
   Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md */
const KB_COLUNAS = ['livres', 'novos', 'andamento', 'convertido', 'perdido'];
const KB_LIVRES_VISIVEIS = 20;
function kbColunaDoLead(l){
  if(l.livre) return 'livres';
  if(l.categoria === 'convertido' || l.venda_neo) return 'convertido';
  if(l.categoria === 'perdido') return 'perdido';
  if(l.categoria === 'andamento') return 'andamento';
  return 'novos';
}
function kbMs(v){ const t = v ? Date.parse(v) : NaN; return isNaN(t) ? null : t; }
function kbMontar(leads){
  const c = { livres: [], novos: [], andamento: [], convertido: [], perdido: [] };
  (leads || []).forEach(l => c[kbColunaDoLead(l)].push(l));
  const desc = (a, b) => (kbMs(b.classificado_em || b.criado_em_lead) || 0) - (kbMs(a.classificado_em || a.criado_em_lead) || 0);
  c.livres.sort((a, b) => (kbMs(b.criado_em_lead) || 0) - (kbMs(a.criado_em_lead) || 0));
  c.novos.sort((a, b) => (kbMs(a.criado_em_lead) || 0) - (kbMs(b.criado_em_lead) || 0));
  c.andamento.sort((a, b) => (a.retorno_em ? 0 : 1) - (b.retorno_em ? 0 : 1) || String(a.retorno_em || '').localeCompare(String(b.retorno_em || '')));
  c.convertido.sort(desc);
  c.perdido.sort(desc);
  return c;
}
function kbDivergencia(l){
  if(l.livre) return null;
  if(l.venda_neo && !l.converteu) return 'NEO tem venda neste CNPJ, mas o lead não está marcado como convertido';
  if(l.converteu && !l.venda_neo) return 'Marcado como venda, mas o NEO ainda não tem pedido neste CNPJ';
  return null;
}
function kbGrupoDaColuna(col){ return ['andamento', 'convertido', 'perdido'].includes(col) ? col : null; }
function kbOpcoesDoGrupo(opcoes, grupo){
  return (opcoes || []).filter(o => !grupo || o.grupo === grupo).slice().sort((a, b) => a.ordem - b.ordem);
}
function kbNumeroBR(v){
  const s = String(v == null ? '' : v).trim();
  if(!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? NaN : n;
}
function kbValidar(f, hojeIso){
  if(!f.status) return 'Escolha o status.';
  if(f.status === 'AGENDADO RETORNO'){
    if(!f.retorno) return 'Informe a data do retorno.';
    if(f.retorno < hojeIso) return 'A data do retorno não pode ser no passado.';
  }
  const r = kbNumeroBR(f.receita);
  if(r !== null && (isNaN(r) || r < 0)) return 'Receita inválida.';
  return '';
}
function kbTempoDesde(iso, agoraMs){
  const t = kbMs(iso);
  if(t === null) return '—';
  const min = Math.floor((agoraMs - t) / 60000);
  if(min < 1) return 'agora';
  if(min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if(h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_leads_kanban.js | tail -1`
Esperado: `--- RESULTADO: N passaram, 0 falharam ---`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_kanban.js
git commit -m "feat(meus-leads): funcoes puras do Kanban (secao 112)"
```

---

### Task 9: Painel: aba "Meus leads" para o consultor (Livres, Pegar, Classificar, arrastar)

**Files:**
- Modify: `_template.html`:
  - botão no `#tabsNav`, logo depois do `tabBtnConversao`;
  - `<section class="panel" id="panel-meusleads">` antes do `panel-mailing`;
  - `<style id="kbStyles">` depois do `<style id="cadernoStyles">…</style>`;
  - JS no bloco da Task 8;
  - um `if` no handler do `#tabsNav`;
  - `kbAplicarPermissao()` junto de `mbAplicarPermissao()`.
- Modify: `test_leads_kanban.js` (bloco "Task 9")

**Interfaces:**
- Consumes: Task 8 (`kb*`), RPCs `leads_kanban`, `leads_pegar`, `leads_classificar`, `registrar_contato_lead`, tabela `leads_status_opcoes`, `leads_equipe` (própria linha), `plMensagemWhats(l, consultor)` e `vlMensagemPrimeiroContato(l, consultor)` (já existem), `ppPrimeiroNome()`, `escapeHtml()`, `mostrarAviso()`, `fecharOverlay()`.
- Produces:
  - `kbEstado = { geracao, naEquipe, leads, opcoes, dono, timer, verTodosLivres, soDivergencias }`;
  - `kbAplicarPermissao()`, `kbCarregar()`, `kbRender()`, `kbPegar(aba, id)`, `kbAbrirClassificar(aba, id, grupo)`, `kbSalvarClassificacao()`, `kbPodeVer()`.

- [ ] **Step 1: Testes do bloco "Task 9"** (antes de `// ==== mais testes entram aqui ====`)

```js
  // ==== Task 9: tela do consultor ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1 }];
  window.__tabelas.config = [{ valor: 'planilha' }];
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display === 'none', 'antes da virada (modo planilha) consultor não vê a aba');
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  window.__rpcRespostas.leads_kanban = { data: [L('n1', { livre: true, telefone: null }), L('m1', { telefone: '11900000001' })], error: null };
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display !== 'none', 'consultor da equipe vê a aba');
  await kbCarregar();
  const colLivres = document.querySelector('#kbBoard [data-kb-col="livres"]');
  assert(colLivres && colLivres.textContent.includes('Zz n1'), 'Livres renderiza o lead livre');
  assert(!colLivres.textContent.includes('11900000001'), 'Livres sem telefone');
  assert(document.querySelector('#kbBoard [data-kb-col="novos"]').textContent.includes('Zz m1'), 'Meus novos renderiza o meu lead');
  // pegar com sucesso move o card; pegar perdido avisa e recarrega
  window.__rpcRespostas.leads_pegar = { data: { ok: true, consultor: 'ZZKCON' }, error: null };
  window.__rpcRespostas.leads_kanban = { data: [L('n1', { livre: false, telefone: '11900000009' }), L('m1')], error: null };
  await kbPegar('OUTUBRO', 'n1');
  assert(window.__rpcCalls.some(c => c.nome === 'leads_pegar' && c.args.p_id === 'n1'), 'chamou leads_pegar');
  assert(document.querySelector('#kbBoard [data-kb-col="novos"]').textContent.includes('Zz n1'), 'depois de pegar vai para Meus novos');
  window.__rpcRespostas.leads_pegar = { data: { ok: false, dono: 'Fulana Zz' }, error: null };
  await kbPegar('OUTUBRO', 'n1');
  assert(document.body.textContent.includes('Esse lead já foi pego por Fulana Zz'), 'aviso de lead já pego');
  // classificar: modal filtra pelo grupo da coluna e valida
  kbAbrirClassificar('OUTUBRO', 'm1', 'perdido');
  const opts = [...document.querySelectorAll('#kbClassStatus option')].map(o => o.value).filter(Boolean);
  eq(opts, ['CNPJ INAPTO'], 'arrastar para Perdido mostra só status de perda');
  document.getElementById('kbClassStatus').value = 'CNPJ INAPTO';
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  await kbSalvarClassificacao();
  const call = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').pop();
  eq([call.args.p_aba, call.args.p_id, call.args.p_status], ['OUTUBRO', 'm1', 'CNPJ INAPTO'], 'classificar manda aba/id/status');
  kbAbrirClassificar('OUTUBRO', 'm1', null);
  document.getElementById('kbClassStatus').value = 'AGENDADO RETORNO';
  const antes = window.__rpcCalls.length;
  await kbSalvarClassificacao();
  assert(window.__rpcCalls.length === antes, 'AGENDADO RETORNO sem data não chama o banco');
  assert(document.getElementById('kbClassErro').textContent.includes('data do retorno'), 'mostra o erro no modal');
  // retorno rápido grava em leads_followups como a tela antiga (§64); perdido "para resgatar" ganha selo
  window.__rpcRespostas.leads_kanban = { data: [L('a1', { categoria: 'andamento', status: 'EM NEGOCIAÇÂO', telefone: '11900000001' }),
    L('p1', { categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE', classificado_em: new Date().toISOString() })], error: null };
  await kbCarregar();
  assert(document.querySelector('#kbBoard [data-id="p1"]').textContent.includes('para resgatar'), 'selo para resgatar');
  assert(document.querySelector('#kbBoard [data-id="a1"] [data-kb-retorno="3"]'), 'andamento tem botão Em 3 dias');
  // versão leve: igual não recarrega; mudou recarrega
  window.__rpcRespostas.leads_kanban_versao = { data: 'v1', error: null };
  assert(await kbVerificarVersao() === true, 'versão nova recarrega');
  const nCarga = window.__rpcCalls.filter(c => c.nome === 'leads_kanban').length;
  assert(await kbVerificarVersao() === false, 'versão igual não recarrega');
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_kanban').length === nCarga, 'não chamou leads_kanban de novo');
  // consultor fora da equipe não vê a aba
  window.__tabelas.leads_equipe = [];
  await kbAplicarPermissao();
  assert(document.getElementById('tabBtnMeusLeads').style.display === 'none', 'fora da equipe não vê');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_leads_kanban.js | tail -3`
Esperado: `FALHA: ReferenceError: kbAplicarPermissao is not defined`.

- [ ] **Step 3: Botão do menu** (depois da linha do `tabBtnConversao` em `#tabsNav`)

```html
      <button data-tab="meusleads" id="tabBtnMeusLeads" style="display:none" data-sub="Pegue e classifique os leads das campanhas"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/></svg><span class="sbLabel">Meus leads</span></button>
```

- [ ] **Step 4: Painel e modal** (antes de `<section class="panel" id="panel-mailing">`)

```html
    <section class="panel" id="panel-meusleads">
      <div class="card">
        <div class="kbTopo">
          <div>
            <h3 style="margin:0">Meus leads</h3>
            <p class="desc" id="kbStatus" style="margin:4px 0 0"></p>
          </div>
          <div class="kbFiltros" id="kbFiltrosGestor" style="display:none">
            <label class="field" style="margin:0"><span>Consultor</span><select id="kbDono"></select></label>
            <button type="button" class="filterPill" id="kbSoDiverg">Só divergências</button>
            <button type="button" class="btn btn-sm btn-outline" id="kbReescrever" style="display:none">Reescrever planilha</button>
          </div>
        </div>
        <div class="kbAviso" id="kbAviso" style="display:none"></div>
      </div>
      <div class="kbBoard" id="kbBoard"></div>
    </section>
    <div class="overlay" id="kbClassOverlay" style="display:none">
      <div class="modal">
        <h3 style="margin-top:0" id="kbClassTitulo">Classificar lead</h3>
        <label class="field"><span>Status</span><select id="kbClassStatus"></select></label>
        <label class="field"><span>OBS</span><textarea id="kbClassObs" rows="3"></textarea></label>
        <div id="kbClassVenda" style="display:none">
          <label class="field"><span><input type="checkbox" id="kbClassConverteu"> Converteu?</span></label>
          <label class="field"><span>Receita (R$)</span><input type="text" id="kbClassReceita" inputmode="decimal" placeholder="0,00"></label>
          <p class="desc" id="kbClassNeo"></p>
        </div>
        <label class="field" id="kbClassRetornoBox" style="display:none"><span>Data do retorno</span><input type="date" id="kbClassRetorno"></label>
        <p class="desc" id="kbClassErro" style="color:var(--c-bordo)"></p>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
          <button type="button" class="btn btn-sm btn-outline" id="kbClassCancelar">Cancelar</button>
          <button type="button" class="btn btn-sm" id="kbClassSalvar">Salvar</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 5: CSS** (novo bloco depois do `</style>` do `cadernoStyles`, só com tokens)

```html
<style id="kbStyles">
  /* Meus leads — Kanban (26/10/2026, §112). Só tokens do design; nenhuma cor fixa. */
  .kbTopo{display:flex;justify-content:space-between;align-items:flex-end;gap:var(--space-3);flex-wrap:wrap;}
  .kbFiltros{display:flex;gap:var(--space-2);align-items:flex-end;flex-wrap:wrap;}
  .kbAviso{margin-top:var(--space-2);padding:var(--space-2) var(--space-3);border-left:3px solid var(--c-bordo);background:var(--surface-2,var(--surface));font-size:.9rem;}
  .kbBoard{display:grid;grid-template-columns:repeat(5,minmax(240px,1fr));gap:var(--space-3);overflow-x:auto;padding-bottom:var(--space-2);}
  .kbCol{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-2);min-height:200px;}
  .kbCol.kbAlvo{outline:2px dashed var(--c-sinal);}
  .kbCol h4{margin:0 0 var(--space-2);font-size:.85rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);display:flex;justify-content:space-between;}
  .kbCard{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:var(--space-2);margin-bottom:var(--space-2);font-size:.88rem;}
  .kbCard[draggable="true"]{cursor:grab;}
  .kbCard .kbNome{font-weight:600;}
  .kbCard .kbMeta{color:var(--muted);font-size:.8rem;}
  .kbCard .kbAcoes{display:flex;gap:var(--space-1);flex-wrap:wrap;margin-top:var(--space-2);}
  .kbCard .kbDiv{margin-top:var(--space-1);font-size:.78rem;color:var(--c-bordo);}
  .kbCol[data-kb-col="perdido"].kbFechada .kbCard{display:none;}
  @media (max-width: 900px){
    .kbBoard{grid-template-columns:repeat(5,82vw);}
    .kbCol[data-kb-col="livres"]{position:sticky;left:0;z-index:1;}
  }
</style>
```
Antes de usar, conferir no `<style>` base os nomes reais de `--surface`, `--border`, `--radius`, `--bg` e `--space-*` (`grep -n -- "--surface\|--border\|--radius\|--space-1" _template.html | head`). Se algum não existir, trocar pelo equivalente que existe. **Não criar variável nova no `:root`.**

- [ ] **Step 6: JS da tela** (no bloco da Task 8, depois das funções puras)

```js
const kbEstado = { geracao: 0, naEquipe: false, modo: 'planilha', versao: '', leads: [], opcoes: [], dono: '', timer: null, verTodosLivres: false, soDivergencias: false, classAlvo: null, consultores: [] };
function kbGestor(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor') && veAbasDaApex(); }
// Antes da virada (config.leads_modo = 'planilha') só o admin vê a aba, para conferir; depois, equipe de leads + gestores.
function kbPodeVer(){
  if(!currentUser) return false;
  if(currentUser.role === 'admin') return true;
  return kbEstado.modo === 'painel' && (kbGestor() || kbEstado.naEquipe);
}
async function kbAplicarPermissao(){
  kbEstado.naEquipe = false;
  const m = await ppSeguro(() => sb.from('config').select('valor').eq('chave', 'leads_modo').maybeSingle());
  kbEstado.modo = m && !m.error && m.data ? String(m.data.valor || 'planilha') : 'planilha';
  if(currentUser && currentUser.role === 'consultor'){
    const r = await ppSeguro(() => sb.from('leads_equipe').select('id').eq('profile_id', currentUser.id));
    kbEstado.naEquipe = !!(r && !r.error && (r.data || []).length);
  }
  document.getElementById('tabBtnMeusLeads').style.display = kbPodeVer() ? 'inline-block' : 'none';
  document.getElementById('kbFiltrosGestor').style.display = kbGestor() ? '' : 'none';
  document.getElementById('kbReescrever').style.display = currentUser && currentUser.role === 'admin' ? '' : 'none';
}
async function kbCarregar(){
  if(!kbPodeVer()) return;
  const geracao = ++kbEstado.geracao;
  const [lds, ops] = await Promise.all([
    ppSeguro(() => sb.rpc('leads_kanban', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null })),
    kbEstado.opcoes.length ? Promise.resolve(null) : ppSeguro(() => sb.from('leads_status_opcoes').select('status,grupo,ordem').eq('ativo', true)),
  ]);
  if(geracao !== kbEstado.geracao) return;
  if(ops && !ops.error) kbEstado.opcoes = ops.data || [];
  if(!lds || lds.error){ console.error(lds && lds.error); document.getElementById('kbStatus').textContent = 'Não foi possível carregar os leads agora.'; return; }
  kbEstado.leads = lds.data || [];
  kbRender();
}
const KB_TITULOS = { livres: 'Livres', novos: 'Meus novos', andamento: 'Em andamento', convertido: 'Convertido', perdido: 'Perdido' };
function kbCard(l, agoraMs){
  const col = kbColunaDoLead(l);
  const div = kbDivergencia(l);
  const nomeConsultor = ppPrimeiroNome();
  const meta = [l.cidade, l.qtd_linhas ? l.qtd_linhas + ' linhas' : '', kbTempoDesde(l.criado_em_lead, agoraMs)].filter(Boolean).join(' · ');
  const tel = String(l.telefone || '').replace(/\D/g, '');
  const acoes = [];
  if(col === 'livres') acoes.push(`<button type="button" class="btn btn-sm" data-kb-pegar>Pegar</button>`);
  else {
    if(tel){
      const msg = col === 'novos' ? vlMensagemPrimeiroContato(l, nomeConsultor) : plMensagemWhats(l, nomeConsultor);
      acoes.push(`<a class="btn btn-sm btn-outline" data-kb-contato="ligar" href="tel:${escapeHtml(tel)}">Ligar</a>`);
      acoes.push(`<a class="btn btn-sm btn-outline" data-kb-contato="whatsapp" target="_blank" rel="noopener" href="https://wa.me/55${escapeHtml(tel.replace(/^55/, ''))}?text=${encodeURIComponent(msg)}">WhatsApp</a>`);
    }
    acoes.push(`<button type="button" class="btn btn-sm" data-kb-classificar>${col === 'novos' ? 'Classificar' : 'Reclassificar'}</button>`);
    // retornos rápidos (§64): mesma gravação de hoje em leads_followups, sem mudar o status
    if(col === 'andamento' || (col === 'perdido' && plParaResgatar(l))) acoes.push(
      `<button type="button" class="btn btn-sm btn-ghost" data-kb-retorno="1">Amanhã</button>`,
      `<button type="button" class="btn btn-sm btn-ghost" data-kb-retorno="3">Em 3 dias</button>`);
    if(kbGestor()) acoes.push(`<button type="button" class="btn btn-sm btn-outline" data-kb-redistribuir>Redistribuir</button>`);
  }
  return `<div class="kbCard" data-aba="${escapeHtml(l.aba)}" data-id="${escapeHtml(l.lead_id)}" ${col === 'livres' ? '' : 'draggable="true"'}>
    <div class="kbNome">${escapeHtml(l.nome || '(sem nome)')}</div>
    <div class="kbMeta">${escapeHtml(meta)}</div>
    ${l.status ? `<div><span class="badge">${escapeHtml(l.status)}</span>${plParaResgatar(l) ? ' <span class="badge">para resgatar</span>' : ''}${l.retorno_em ? ` <span class="kbMeta">retorno ${escapeHtml(l.retorno_em.split('-').reverse().join('/'))}</span>` : ''}</div>` : ''}
    ${l.obs ? `<div class="kbMeta">${escapeHtml(String(l.obs).slice(0, 80))}</div>` : ''}
    ${kbGestor() && l.dono_nome ? `<div class="kbMeta">Com ${escapeHtml(l.dono_nome)}</div>` : ''}
    ${col === 'convertido' && (l.receita || l.receita_neo) ? `<div class="kbMeta">R$ ${escapeHtml(String(l.receita || l.receita_neo))}${l.venda_neo ? ' · ✓ NEO' : ''}</div>` : ''}
    ${div ? `<div class="kbDiv">⚠ ${escapeHtml(div)}</div>` : ''}
    <div class="kbAcoes">${acoes.join('')}</div>
  </div>`;
}
function kbRender(){
  const agoraMs = Date.now();
  let leads = kbEstado.leads;
  if(kbEstado.soDivergencias) leads = leads.filter(l => kbDivergencia(l));
  const c = kbMontar(leads);
  const livresVis = kbEstado.verTodosLivres ? c.livres : c.livres.slice(0, KB_LIVRES_VISIVEIS);
  document.getElementById('kbBoard').innerHTML = KB_COLUNAS.map(col => {
    const lista = col === 'livres' ? livresVis : c[col];
    const mais = col === 'livres' && c.livres.length > livresVis.length ? `<button type="button" class="btn btn-sm btn-outline" data-kb-vermais>Ver mais (${c.livres.length - livresVis.length})</button>` : '';
    return `<div class="kbCol${col === 'perdido' ? ' kbFechada' : ''}" data-kb-col="${col}">
      <h4><span>${KB_TITULOS[col]}</span><span>${c[col].length}</span></h4>
      ${col === 'perdido' ? `<button type="button" class="btn btn-sm btn-outline" data-kb-abrirperdido>Mostrar</button>` : ''}
      ${lista.map(l => kbCard(l, agoraMs)).join('')}${mais}
    </div>`;
  }).join('');
  document.getElementById('kbStatus').textContent = `${c.livres.length} livre(s) · ${c.novos.length} novo(s) seu(s) · atualiza sozinho`;
}
async function kbPegar(aba, id){
  const r = await ppSeguro(() => sb.rpc('leads_pegar', { p_aba: aba, p_id: id }));
  if(!r || r.error){ mostrarAviso('Não foi possível pegar o lead agora.', 'erro'); return; }
  if(r.data && r.data.ok === false) mostrarAviso(`Esse lead já foi pego por ${r.data.dono}`, 'info');
  await kbCarregar();
}
function kbAcharLead(aba, id){ return kbEstado.leads.find(l => l.aba === aba && l.lead_id === id) || null; }
function kbAbrirClassificar(aba, id, grupo){
  const l = kbAcharLead(aba, id);
  if(!l) return;
  kbEstado.classAlvo = { aba, id };
  const sel = document.getElementById('kbClassStatus');
  const ops = kbOpcoesDoGrupo(kbEstado.opcoes, grupo);
  const rotulo = { andamento: 'Em andamento', convertido: 'Convertido', perdido: 'Perdido' };
  sel.innerHTML = '<option value="">Escolha…</option>' + ['andamento', 'convertido', 'perdido'].map(g => {
    const doG = ops.filter(o => o.grupo === g);
    return doG.length ? `<optgroup label="${rotulo[g]}">${doG.map(o => `<option value="${escapeHtml(o.status)}">${escapeHtml(o.status)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  sel.value = l.status && ops.some(o => o.status === l.status) ? l.status : '';
  document.getElementById('kbClassTitulo').textContent = 'Classificar — ' + (l.nome || '');
  document.getElementById('kbClassObs').value = l.obs || '';
  document.getElementById('kbClassConverteu').checked = !!(l.converteu || l.venda_neo);
  document.getElementById('kbClassReceita').value = l.receita ? String(l.receita).replace('.', ',') : (l.receita_neo ? String(l.receita_neo).replace('.', ',') : '');
  document.getElementById('kbClassNeo').textContent = l.venda_neo ? 'O NEO tem venda neste CNPJ — conferido e pré-preenchido.' : '';
  document.getElementById('kbClassRetorno').value = l.retorno_em || '';
  document.getElementById('kbClassErro').textContent = '';
  kbClassAjustar();
  document.getElementById('kbClassOverlay').style.display = 'flex';
}
function kbClassAjustar(){
  const st = document.getElementById('kbClassStatus').value;
  const op = kbEstado.opcoes.find(o => o.status === st);
  document.getElementById('kbClassVenda').style.display = op && op.grupo === 'convertido' ? '' : 'none';
  document.getElementById('kbClassRetornoBox').style.display = st === 'AGENDADO RETORNO' ? '' : 'none';
}
async function kbSalvarClassificacao(){
  const alvo = kbEstado.classAlvo;
  if(!alvo) return;
  const status = document.getElementById('kbClassStatus').value;
  const op = kbEstado.opcoes.find(o => o.status === status);
  const venda = !!op && op.grupo === 'convertido';
  const form = { status, grupo: op ? op.grupo : null, receita: venda ? document.getElementById('kbClassReceita').value : '', retorno: document.getElementById('kbClassRetorno').value };
  const erro = kbValidar(form, hojeSP());
  document.getElementById('kbClassErro').textContent = erro;
  if(erro) return;
  const r = await ppSeguro(() => sb.rpc('leads_classificar', {
    p_aba: alvo.aba, p_id: alvo.id, p_status: status, p_obs: document.getElementById('kbClassObs').value,
    p_converteu: venda && document.getElementById('kbClassConverteu').checked, p_receita: venda ? kbNumeroBR(form.receita) : null,
    p_retorno: status === 'AGENDADO RETORNO' ? form.retorno : null,
  }));
  if(!r || r.error){ document.getElementById('kbClassErro').textContent = 'Não foi possível salvar agora. Tente de novo.'; return; }
  fecharOverlay(document.getElementById('kbClassOverlay'));
  kbEstado.classAlvo = null;
  mostrarAviso('Lead classificado.', 'ok');
  await kbCarregar();
}
async function kbRetornoRapido(leadId, dias){
  const data = somaDiasStr(hojeSP(), dias || 1);
  const { error } = await sb.from('leads_followups').insert({ lead_id: leadId, consultor_id: currentUser.id, data_prevista: data, tipo: 'retorno', observacao: null });
  if(error){ mostrarAviso('Não foi possível agendar o retorno: ' + error.message, 'erro'); return; }
  mostrarAviso('Retorno agendado para ' + ppFmtDia(data) + '.', 'ok');
}
// A cada 10 s pergunta só a versão (barata); recarrega o Kanban inteiro só quando ela muda (§112, pedido de 26/10).
async function kbVerificarVersao(){
  const r = await ppSeguro(() => sb.rpc('leads_kanban_versao'));
  if(!r || r.error) return false;
  const v = String(r.data || '');
  if(v === kbEstado.versao) return false;
  kbEstado.versao = v;
  await kbCarregar();
  return true;
}
function kbAgendar(){
  clearInterval(kbEstado.timer);
  kbEstado.timer = setInterval(() => {
    const ativa = document.getElementById('panel-meusleads').classList.contains('active');
    if(ativa && document.visibilityState === 'visible') kbVerificarVersao();
  }, 10000);
}
document.getElementById('kbBoard').addEventListener('click', (e) => {
  const card = e.target.closest('.kbCard');
  if(e.target.closest('[data-kb-vermais]')){ kbEstado.verTodosLivres = true; kbRender(); return; }
  if(e.target.closest('[data-kb-abrirperdido]')){ e.target.closest('.kbCol').classList.remove('kbFechada'); e.target.closest('[data-kb-abrirperdido]').remove(); return; }
  if(!card) return;
  const aba = card.dataset.aba, id = card.dataset.id;
  if(e.target.closest('[data-kb-pegar]')) kbPegar(aba, id);
  else if(e.target.closest('[data-kb-classificar]')) kbAbrirClassificar(aba, id, null);
  else if(e.target.closest('[data-kb-redistribuir]')) kbAbrirRedistribuir(aba, id);
  else if(e.target.closest('[data-kb-retorno]')) kbRetornoRapido(id, Number(e.target.closest('[data-kb-retorno]').dataset.kbRetorno));
  else if(e.target.closest('[data-kb-contato]')) ppSeguro(() => sb.rpc('registrar_contato_lead', { p_aba: aba, p_lead_id: id, p_canal: e.target.closest('[data-kb-contato]').dataset.kbContato }));
});
document.getElementById('kbBoard').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.kbCard[draggable="true"]');
  if(card) e.dataTransfer.setData('text/plain', JSON.stringify({ aba: card.dataset.aba, id: card.dataset.id }));
});
document.getElementById('kbBoard').addEventListener('dragover', (e) => {
  const col = e.target.closest('.kbCol');
  if(col && kbGrupoDaColuna(col.dataset.kbCol)){ e.preventDefault(); col.classList.add('kbAlvo'); }
});
document.getElementById('kbBoard').addEventListener('dragleave', (e) => { const col = e.target.closest('.kbCol'); if(col) col.classList.remove('kbAlvo'); });
document.getElementById('kbBoard').addEventListener('drop', (e) => {
  const col = e.target.closest('.kbCol');
  if(!col) return;
  col.classList.remove('kbAlvo');
  const grupo = kbGrupoDaColuna(col.dataset.kbCol);
  if(!grupo) return;
  e.preventDefault();
  try { const d = JSON.parse(e.dataTransfer.getData('text/plain')); kbAbrirClassificar(d.aba, d.id, grupo); } catch(_) {}
});
document.getElementById('kbClassStatus').addEventListener('change', kbClassAjustar);
document.getElementById('kbClassSalvar').addEventListener('click', kbSalvarClassificacao);
document.getElementById('kbClassCancelar').addEventListener('click', () => fecharOverlay(document.getElementById('kbClassOverlay')));
```
(`kbAbrirRedistribuir` é definida na Task 10. Até lá o botão só aparece para gestor, e o teste da Task 9 roda como consultor.)

- [ ] **Step 7: Ligar a aba.** No handler de clique do `#tabsNav` (depois de `if(btn.dataset.tab === 'conversao') loadConversaoVendas();`):

```js
  if(btn.dataset.tab === 'meusleads'){ kbCarregar(); kbAgendar(); }
```
e, logo depois de `mbAplicarPermissao();` no login:

```js
    // 26/10/2026 (seção 112): Meus leads — equipe de leads + admin/supervisor
    kbAplicarPermissao().catch(err => console.error(err));
```
Para o teste não quebrar com `kbAbrirRedistribuir` indefinida, criar já na Task 9 um esqueleto que a Task 10 substitui:

```js
function kbAbrirRedistribuir(){ /* Task 10 (§112): redistribuir — só gestor */ }
```

- [ ] **Step 8: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_leads_kanban.js | tail -1 && bash run_tests.sh 2>&1 | tail -3`
Esperado: `test_leads_kanban.js` passa, sem falha nova no restante.

- [ ] **Step 9: Commit**

```bash
git add _template.html test_leads_kanban.js
git commit -m "feat(meus-leads): aba Kanban do consultor com pegar, classificar e arrastar (secao 112)"
```

---

### Task 10: Painel: visão da supervisão, card na Mesa e reescrever planilha

**Files:**
- Modify: `_template.html` (bloco `kb*`; `loadMesa` para o card)
- Modify: `test_leads_kanban.js` (bloco "Task 10")

**Interfaces:**
- Consumes: RPCs `leads_redistribuir`, `leads_kanban_resumo`, `leads_espelho_reescrever`, `leads_equipe` (lista completa para gestor), `config.leads_espelho_aviso`.
- Produces: `kbAbrirRedistribuir(aba, id)` (substitui o esqueleto), `kbCarregarFiltros()`, `kbMesaCard()`.

- [ ] **Step 1: Testes do bloco "Task 10"**

```js
  // ==== Task 10: supervisão ====
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.leads_equipe = [{ profile_id: 'u-zz', nome_planilha: 'ZZKCON' }, { profile_id: 'u-zz2', nome_planilha: 'ZZOUTRA' }];
  window.__rpcRespostas.leads_kanban = { data: [L('m1', { dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', telefone: '11900000001' }), L('d1', { categoria: 'convertido', converteu: true, venda_neo: false, dono_id: 'u-zz' })], error: null };
  await kbAplicarPermissao();
  await kbCarregarFiltros();
  assert(document.getElementById('kbFiltrosGestor').style.display !== 'none', 'gestor vê filtros');
  eq([...document.querySelectorAll('#kbDono option')].map(o => o.value), ['', 'u-zz', 'u-zz2'], 'seletor de consultor: Todos + equipe');
  await kbCarregar();
  assert(document.querySelector('#kbBoard [data-id="m1"]').textContent.includes('Com Zzkcon Teste'), 'card mostra com quem está');
  document.getElementById('kbSoDiverg').click();
  assert(!document.querySelector('#kbBoard [data-id="m1"]') && document.querySelector('#kbBoard [data-id="d1"]'), 'filtro de divergências');
  document.getElementById('kbSoDiverg').click();
  window.__rpcRespostas.leads_redistribuir = { data: null, error: null };
  kbAbrirRedistribuir('OUTUBRO', 'm1');
  document.getElementById('kbRedNovo').value = 'u-zz2';
  await kbSalvarRedistribuicao();
  const red = window.__rpcCalls.filter(c => c.nome === 'leads_redistribuir').pop();
  eq([red.args.p_id, red.args.p_novo], ['m1', 'u-zz2'], 'redistribuir manda o novo dono');
  window.__rpcRespostas.leads_kanban_resumo = { data: [{ livres: 4, livre_mais_antigo: '2026-10-26T11:00:00Z', fila_pendente: 0, fila_mais_antiga: null, aviso: 'Crie a guia de NOVEMBRO na planilha' }], error: null };
  const card = await kbMesaCard();
  assert(card.includes('4 livre') && card.includes('Crie a guia de NOVEMBRO'), 'card da Mesa com livres e aviso');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_leads_kanban.js | tail -3`
Esperado: `FALHA: ReferenceError: kbCarregarFiltros is not defined`.

- [ ] **Step 3: Modal de redistribuir** (HTML logo depois do `kbClassOverlay`)

```html
    <div class="overlay" id="kbRedOverlay" style="display:none">
      <div class="modal">
        <h3 style="margin-top:0" id="kbRedTitulo">Redistribuir lead</h3>
        <label class="field"><span>Passar para</span><select id="kbRedNovo"></select></label>
        <p class="desc" id="kbRedErro" style="color:var(--c-bordo)"></p>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
          <button type="button" class="btn btn-sm btn-outline" id="kbRedCancelar">Cancelar</button>
          <button type="button" class="btn btn-sm" id="kbRedSalvar">Salvar</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 4: JS da supervisão** (trocar o esqueleto `kbAbrirRedistribuir` por este bloco)

```js
async function kbCarregarFiltros(){
  if(!kbGestor()) return;
  const r = await ppSeguro(() => sb.from('leads_equipe').select('profile_id,nome_planilha'));
  kbEstado.consultores = (r && !r.error ? r.data || [] : []).filter(x => x.profile_id);
  const sel = document.getElementById('kbDono');
  sel.innerHTML = '<option value="">Todos</option>' + kbEstado.consultores.map(c => `<option value="${escapeHtml(c.profile_id)}">${escapeHtml(c.nome_planilha)}</option>`).join('');
  sel.value = kbEstado.dono || '';
}
function kbAbrirRedistribuir(aba, id){
  const l = kbAcharLead(aba, id);
  if(!l || !kbGestor()) return;
  kbEstado.redAlvo = { aba, id };
  const semStatus = l.categoria === 'sem_contato';
  document.getElementById('kbRedNovo').innerHTML = (semStatus ? '<option value="">Devolver aos Livres</option>' : '')
    + kbEstado.consultores.filter(c => c.profile_id !== l.dono_id).map(c => `<option value="${escapeHtml(c.profile_id)}">${escapeHtml(c.nome_planilha)}</option>`).join('');
  document.getElementById('kbRedTitulo').textContent = 'Redistribuir — ' + (l.nome || '');
  document.getElementById('kbRedErro').textContent = '';
  document.getElementById('kbRedOverlay').style.display = 'flex';
}
async function kbSalvarRedistribuicao(){
  const alvo = kbEstado.redAlvo;
  if(!alvo) return;
  const novo = document.getElementById('kbRedNovo').value || null;
  const r = await ppSeguro(() => sb.rpc('leads_redistribuir', { p_aba: alvo.aba, p_id: alvo.id, p_novo: novo }));
  if(!r || r.error){ document.getElementById('kbRedErro').textContent = (r && r.error && r.error.message) || 'Não foi possível salvar agora.'; return; }
  fecharOverlay(document.getElementById('kbRedOverlay'));
  kbEstado.redAlvo = null;
  mostrarAviso(novo ? 'Lead passado para outro consultor.' : 'Lead devolvido aos Livres.', 'ok');
  await kbCarregar();
}
async function kbMesaCard(){
  const r = await ppSeguro(() => sb.rpc('leads_kanban_resumo'));
  const x = r && !r.error && Array.isArray(r.data) ? r.data[0] : null;
  if(!x) return '';
  const antigo = x.livre_mais_antigo ? ` · mais antigo ${kbTempoDesde(x.livre_mais_antigo, Date.now())}` : '';
  return `<div class="card"><h4 style="margin:0">Meus leads</h4>
    <p class="desc" style="margin:4px 0 0">${x.livres} livre(s)${escapeHtml(antigo)} · planilha: ${x.fila_pendente ? x.fila_pendente + ' na fila' : 'em dia'}</p>
    ${x.aviso ? `<div class="kbAviso">${escapeHtml(x.aviso)}</div>` : ''}</div>`;
}
document.getElementById('kbDono').addEventListener('change', (e) => { kbEstado.dono = e.target.value; kbCarregar(); });
document.getElementById('kbSoDiverg').addEventListener('click', (e) => { kbEstado.soDivergencias = !kbEstado.soDivergencias; e.target.classList.toggle('active', kbEstado.soDivergencias); kbRender(); });
document.getElementById('kbReescrever').addEventListener('click', async () => {
  const aba = mesAbaAtualKb();
  const r = await ppSeguro(() => sb.rpc('leads_espelho_reescrever', { p_aba: aba }));
  mostrarAviso(r && !r.error ? `${r.data} lead(s) de ${aba} na fila para reescrever na planilha.` : 'Não foi possível pedir a reescrita.', r && !r.error ? 'ok' : 'erro');
});
function mesAbaAtualKb(){ return ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'][Number(hojeSP().slice(5, 7)) - 1]; }
document.getElementById('kbRedSalvar').addEventListener('click', kbSalvarRedistribuicao);
document.getElementById('kbRedCancelar').addEventListener('click', () => fecharOverlay(document.getElementById('kbRedOverlay')));
```
E também:
- em `kbAplicarPermissao`, no fim: `if(kbGestor()) kbCarregarFiltros().catch(err => console.error(err));`;
- em `kbRender`, no fim, a faixa de aviso para gestor: `if(kbGestor()) ppSeguro(() => sb.from('config').select('valor').eq('chave', 'leads_espelho_aviso').maybeSingle()).then(r => { const a = r && r.data ? String(r.data.valor || '') : ''; const el = document.getElementById('kbAviso'); el.style.display = a ? '' : 'none'; el.textContent = a; });`.

- [ ] **Step 5: Card na Mesa** (mesmo padrão do card "Lead × Mailing", §99, que carrega sem travar o resto)
  1. No HTML da Mesa, logo depois de `<div id="mesaOrig"></div>` (~linha 1314), acrescentar `<div id="mesaKb"></div>`.
  2. Na função que limpa a Mesa (a linha `document.getElementById('mesaOrig').innerHTML = ''; mesaEstado.origEm = null;   // §99`), acrescentar logo abaixo: `document.getElementById('mesaKb').innerHTML = '';   // §112`.
  3. Em `loadMesa`, logo depois de `mesaCarregarOrigens(hoje, forcar); // §99 — idem`, acrescentar:
  ```js
  kbMesaCard().then(h => { const el = document.getElementById('mesaKb'); if(el && canSeeMesa()) el.innerHTML = h; }).catch(err => console.error(err)); // §112 — não bloqueia o resto
  ```

- [ ] **Step 6: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_leads_kanban.js | tail -1 && bash run_tests.sh 2>&1 | tail -3`
Esperado: tudo passa, sem falha nova (incluindo os testes da Mesa, `test_velocidade_lead.js`).

- [ ] **Step 7: Commit**

```bash
git add _template.html test_leads_kanban.js
git commit -m "feat(meus-leads): visao da supervisao, redistribuir, card na Mesa e reescrever planilha (secao 112)"
```

---

### Task 11: Preparação e virada (produção, passo a passo com o Rafael)

**Files:**
- Create: `supabase/virada/20261026_leads_kanban_virada.sql`
- Modify: `REGRAS_NEGOCIO.md` (§112)

Cada passo abaixo é uma ação em produção: **mostrar o comando, pedir ok, executar, conferir e só então seguir**.

- [ ] **Step 1: Conferir a conta de serviço** (o Rafael já fez o roteiro: secret `GOOGLE_SA_JSON` + planilha compartilhada com o e-mail)

Publicar a `planilha-espelho` com `deploy_edge_function`: arquivos `index.ts`, `espelho.ts`, `planilha.ts` e `google.ts`, `verify_jwt: false`. Ela fica parada porque `leads_modo = planilha` e ainda não há cron. Então rodar o **ensaio a seco** pelo SQL:

```sql
select net.http_post(
  url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/planilha-espelho',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
  body := '{"ensaio_aba":"OUTUBRO"}'::jsonb, timeout_milliseconds := 60000) as req;
-- depois de ~10 s:
select status_code, left(content, 600) from net._http_response where id = <req>;
```
Esperado: `200` com `"ensaio":{"LEADS CLARO B2B APEX - OUTUBRO":{"atualizar":~740,"criar":~0}}` e `"ensaioEntrada":{lidos, novos:{MÊS:n}, exemplos:[ids]}` (revisão final, item 6). `novos` é o que a entrada criaria como Livre na virada: mostrar ao Rafael. Se houver lead antigo que o time não copiou de propósito, definir `leads_planilha.entrada_desde` (ISO, ex. o início do dia da virada) antes da PARTE 3. Se der `401` ou `403` do Google, a planilha não foi compartilhada com o e-mail da conta. Se der `token do Google: 400`, o JSON do secret está incompleto. Mostrar o resultado ao Rafael.

- [ ] **Step 2: Publicar painel + migration 120200 juntos** (com ok)

Revisão final (item 8): a `20261026120200` vai em **dois tempos**:
1. **antes** do envio do painel, só o `create function public.leads_digital_admin()` + `grant` (não tira nada de ninguém);
2. enviar o painel, seguindo a memória "Publicação do painel": comparar com o que está no ar, fazer backup e enviar com o MD5 no mesmo comando, vigia `-Aceitar`;
3. **depois**, o `revoke select` + `grant select (colunas)`.

Assim a Digital do admin nunca fica sem fonte de CNPJ. Também aplicar a `20261026120400` (trava de rodada) antes do Step 1. Conferir na Digital (admin) que a conversão e "Vendas x origem do lead" continuam com números. Até a virada, a aba "Meus leads" só aparece para o **admin** (regra da Task 9 com `config.leads_modo = 'planilha'`). O Rafael pode abrir e conferir; consultores e supervisores ainda não a veem.

- [ ] **Step 3: Escrever `supabase/virada/20261026_leads_kanban_virada.sql`** (rodado em partes, com ok, no horário combinado)

```sql
-- §112 Virada para o modo painel. Rodar em horário combinado, fora do pico, parte por parte.
-- PARTE 0 (antes): uma última sincronização no modo planilha (traz dono/status/OBS atuais). Disparar a sync-leads:
-- select net.http_post(url := '.../functions/v1/sync-leads', headers := jsonb_build_object('Content-Type','application/json',
--   'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')), body := '{}'::jsonb);

-- PARTE 1: dono_id a partir do nome da planilha (mesma normalização do painel)
begin;
update public.leads l set dono_id = e.profile_id, pego_em = coalesce(l.pego_em, l.primeira_sync_em)
  from public.leads_equipe e
 where l.dono_id is null and e.profile_id is not null and coalesce(l.consultor, '') <> ''
   and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor)
   and coalesce(l.aba, '') <> 'REPIQUE';
commit;
-- nomes que não casaram (o Rafael vincula em Usuários → equipe de leads e roda a PARTE 1 de novo)
select l.consultor, count(*) from public.leads l
 where l.dono_id is null and coalesce(l.consultor, '') <> '' and coalesce(l.aba, '') <> 'REPIQUE'
 group by 1 order by 2 desc;

-- PARTE 2 (com ok explícito): duplicatas da guia de entrada gravadas como AGOSTO que já existem na aba do mês
select count(*) from public.leads a
 where a.aba = 'AGOSTO' and public.leads_mes_aba(a.criado_em_lead) <> 'AGOSTO'
   and exists (select 1 from public.leads b where b.id = a.id and b.aba = public.leads_mes_aba(a.criado_em_lead));
-- conferido o número (eram 10 em 26/10):
-- begin; delete from public.leads a where a.aba = 'AGOSTO' and public.leads_mes_aba(a.criado_em_lead) <> 'AGOSTO'
--   and exists (select 1 from public.leads b where b.id = a.id and b.aba = public.leads_mes_aba(a.criado_em_lead)); commit;

-- PARTE 3: ligar o modo painel e o cron do espelho
begin;
update public.config set valor = 'painel' where chave = 'leads_modo';
select cron.schedule('planilha-espelho', '10 seconds', $$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/planilha-espelho',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$$);
commit;

-- VOLTAR ATRÁS (revisão final, item 9): antes, esperar a fila zerar, senão a sync antiga desfaz classificações que ainda
-- não chegaram à planilha:  select count(*) from public.leads_espelho where feito_em is null;  -- precisa dar 0
-- begin; update public.config set valor = 'planilha' where chave = 'leads_modo';
--   select cron.unschedule('planilha-espelho'); commit;
-- Depois da Task 12 (link fechado), voltar ao modo planilha exige reabrir "qualquer pessoa com o link".
```

- [ ] **Step 4: Publicar a `sync-leads` com a saída cedo (Task 7)** com ok e **antes da PARTE 3**: ela não muda nada enquanto o modo for `planilha`.

- [ ] **Step 5: Conferências depois da PARTE 3** (nos primeiros 10 min)

```sql
select count(*) filter (where feito_em is null) pendentes, max(feito_em) ultimo_feito, max(ultimo_erro) erro from public.leads_espelho;
select chave, left(valor, 200) from public.config where chave in ('leads_espelho_aviso', 'leads_sync_erro', 'leads_atualizado_em');
select status_code, left(content, 300) from net._http_response order by id desc limit 3;
```
Esperado:
- pendentes perto de 0;
- aviso vazio;
- `leads_atualizado_em` andando a cada minuto;
- respostas `200` com `"ok":true`.

Depois, com o Rafael: um consultor pega 1 lead de teste e classifica, e os dois conferem a linha na planilha em até 2 min.

- [ ] **Step 6: O Rafael (ou o dono da planilha) tira a edição dos consultores** na planilha. Isso não é código.

- [ ] **Step 7: REGRAS §112 + push**

Escrever a §112 no `REGRAS_NEGOCIO.md`, no formato da §111:
- o que mudou, a chave `leads_modo`, a fila, o aviso, a virada e o voltar atrás;
- tabelas e RPCs;
- secret `GOOGLE_SA_JSON`;
- cron `planilha-espelho`;
- testes e números da virada.

Depois:
```bash
git add REGRAS_NEGOCIO.md supabase/virada/20261026_leads_kanban_virada.sql
git commit -m "docs(regras): secao 112 Meus leads e virada"
git fetch oficial && git rebase oficial/main && bash run_tests.sh | tail -3 && git push oficial HEAD:main
```

---

### Task 12: Passo 3 da virada (depois de alguns dias estável)

**Files:**
- Modify: `_template.html` (remover a sub-aba "Meus leads para tratar": botão `data-digital-sub="meus"`, `#digitalSubMeus`, `canSeeMeusLeadsDigital`, `plCarregar`/`plRender`/`plClassificar`; as funções `plMensagemWhats`/`plTipoMensagem`/`plNormStatus`/`plParaResgatar` **ficam**, porque o Kanban usa)
- Modify: testes que cobrem a sub-aba (`test_leads_followups.js`, `test_monitoramento_leads.js`, conforme o `grep`)
- Modify: `REGRAS_NEGOCIO.md` (§112, item "passo 3")

- [ ] **Step 1: Confirmar com o Rafael** que passou o período combinado sem problema e que pode fechar o link.
- [ ] **Step 2:** `grep -n "data-digital-sub=\"meus\"\|digitalSubMeus\|canSeeMeusLeadsDigital\|plCarregar\|plRender\b\|plClassificar" _template.html test_*.js` e remover o código e os testes da sub-aba. Manter as funções `pl*` de mensagem.
- [ ] **Step 3:** `python build_painel.py && bash run_tests.sh | tail -3`. Esperado: sem falha nova.
- [ ] **Step 4:** publicar o painel (fluxo de publicação, com ok).
- [ ] **Step 5:** o Rafael fecha "qualquer pessoa com o link" na planilha. A `sync-leads` no modo painel não lê mais a planilha, e a `planilha-espelho` usa a conta de serviço. Conferir no SQL que a rodada seguinte da `planilha-espelho` continua `200`.
- [ ] **Step 6:** atualizar a §112 com a data do passo 3, commit e push no oficial.

---

## Execução

- As Tasks 4, 5, 6 (parte TS), 7 e 8 não dependem do banco e podem ser feitas antes do ok das migrations.
- As Tasks 1, 2, 3 e 6 (SQL) precisam do ok para aplicar no banco. A 120200 só vai junto com o painel (Task 11, passo 2).
- A Task 11 é toda acompanhada pelo Rafael.
