# Aba Renovação, Fase 1 (§143.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar o time de renovação da planilha do Google: carteira, ficha do cliente, retornos, resumo, redistribuição e importação da base dentro de uma aba "Renovação" no painel.

**Architecture:** Duas tabelas novas no Supabase (`renovacao_carteira`, `renovacao_historico`) com regras e RLS no banco, uma view de resumo e duas RPCs de importação (só admin). No painel (`_template.html`, arquivo único), um bloco novo de JS com prefixo `rn` e uma aba `data-tab="renovacao"` com 3 subabas (Carteira, Retornos, Resumo) e uma ficha lateral que reaproveita o visual de Meus leads (`.kbFicha`).

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), HTML/JS puro no `_template.html`, SheetJS 0.18.5 (já carregado), testes JS com jsdom (`node test_*.js`), testes SQL em `supabase/tests/*_check.sql` (sempre terminam em ROLLBACK).

**Spec:** `docs/superpowers/specs/2026-11-07-renovacao-aba-design.md`

## Global Constraints

- Repositório **público**: nenhum CNPJ, telefone, razão social ou nome de cliente real em arquivo. Testes usam dados fictícios com prefixo `Zz` e CNPJs `000000000001xx`.
- Supabase `mdgfboijyqfkggcrhptn` é **produção**: DDL e escrita só com ok do Rafael (Task 9). Antes disso, testar migrations dentro de `begin; … rollback;`.
- Migrations: sem `DROP`; `create … if not exists`; trigger/policy/constraint por `do $$ … if not exists … $$`; aplicar com `execute_sql` (begin/commit). `apply_migration` falha neste projeto.
- Edite só `_template.html`; o `painel_clientes_apex.html` é gerado por `python build_painel.py`.
- Design Sinal de Ápice: não mexer no CSS existente, no menu nem em `ApexMotion`; cores só por variável (`--st-perdido`, `--st-perdido-bg`, `--st-ganho`, `--st-ganho-bg`, `--muted`…); avisos com `mostrarAviso(msg, 'ok'|'erro'|'info')`; modal com `.overlay`/`.modal`/`.mHead`/`.mBody` e `fecharOverlay(el)`.
- Status: `1 Não contatado · 2 Tentativa s/ retorno · 3 Contato efetivo · 4 Proposta enviada · 5 Em negociação · 6 Renovado · 7 Perdido`.
- Canal: `WhatsApp, Ligação, E-mail, Visita`. Motivo: `Preço, Foi p/ concorrente, Sem interesse, Insatisfeito c/ Claro, Empresa fechada/baixada, Contato inválido, Outro`.
- Resumo: contatados = status ≥ 2; contato efetivo+ = 3 a 6; propostas+ = 4 a 6; renovados = 6; perdidos = 7; % conversão = renovados / efetivo+; retornos atrasados = `prox_retorno < hoje` e status ∉ {6,7}; tudo sobre `na_base = true`.
- "Hoje" sempre no fuso de São Paulo (`hojeSP()` no JS; `(now() at time zone 'America/Sao_Paulo')::date` no SQL).
- HTML novo com `<div>`/`</div>` balanceados (houve quebra de abas em 27/10 por isso).

## Review Focus

1. **Planilha real com CNPJ numérico sem zero à esquerda** (a base tem CNPJs de 13 dígitos): tem que virar 14 dígitos com zero na frente, nunca ser descartado. Teste na Task 7.
2. **Reimportar o mesmo arquivo depois de o time trabalhar** (ex.: a importação parou no meio): não pode apagar nem sobrescrever status, observações e consultor. Teste SQL na Task 2 e JS na Task 7.
3. **Registro legado "a completar" editado só na observação**: o consultor tem que conseguir salvar sem ser barrado pela regra do Perdido/Renovado, no banco e na ficha. Teste SQL na Task 1 e JS na Task 5.
4. **Consultor tentando burlar pelo console** (mudar `consultor_id`, `a_completar`, `equipe` ou dados da Claro): o banco recusa. Teste SQL na Task 1.
5. **Mudar status para Renovado/Perdido na lista e cancelar a janela**: o select volta ao status anterior, nada é gravado. Teste JS na Task 4.

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261107150000_renovacao_carteira.sql` (criar) | `profiles.equipe` + trava, tabelas, regras (triggers), RLS, view `renovacao_resumo` |
| `supabase/migrations/20261107150100_renovacao_importar.sql` (criar) | RPCs `renovacao_importar` e `renovacao_marcar_fora` |
| `supabase/tests/renovacao_check.sql` (criar) | Conferência das duas migrations; termina em ROLLBACK |
| `renovacao_test_harness.js` (criar) | Monta jsdom + Supabase falso para os testes da Renovação (nome fora do padrão `test_*` de propósito: não é teste) |
| `test_renovacao_aba.js`, `test_renovacao_carteira.js`, `test_renovacao_ficha.js`, `test_renovacao_resumo.js`, `test_renovacao_importar.js` (criar) | Testes JS por bloco |
| `_template.html` (modificar) | Botão da aba, painel, CSS `rn*`, bloco JS `RENOVAÇÃO — §143`, coluna "Renovação" na aba Consultores, `currentUser.equipe` |
| `REGRAS_NEGOCIO.md` (modificar) | Seção §143 / §143.1 |

---

### Task 1: Banco: carteira, histórico, regras, RLS e resumo

**Files:**
- Create: `supabase/migrations/20261107150000_renovacao_carteira.sql`
- Create: `supabase/tests/renovacao_check.sql`

**Interfaces:**
- Produces: tabela `public.renovacao_carteira` (colunas da spec 4.1), `public.renovacao_historico(carteira_id, user_id, campo, de, para, nota, criado_em)`, `profiles.equipe` (`null` | `'renovacao'`), view `public.renovacao_resumo(consultor_id, consultor_nome, carteira, contatados, efetivo_mais, propostas_mais, renovados, perdidos, linhas_renovadas, bl_vendida, sol_digitais, retornos_atrasados, a_completar)`. Erros: `42501` (permissão), `23514` com mensagens exatas `Perdido precisa do motivo` / `Renovado precisa das linhas renovadas`.

- [ ] **Step 0: Preparar o worktree** (o worktree `.worktrees/renovacao-aba` já existe, partindo de `oficial/main`)

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/renovacao-aba
git fetch oficial -q && git log --oneline -1 oficial/main
cmd //c mklink //J node_modules ..\\agencia-lista\\node_modules
node -e "require('jsdom'); require('xlsx'); console.log('ok')"
```
Expected: `ok`. Se `oficial/main` andou, `git merge --no-edit oficial/main` antes de seguir.

- [ ] **Step 1: Escrever o teste SQL (vai falhar: as tabelas não existem)**

Criar `supabase/tests/renovacao_check.sql`:

```sql
-- Verificação das migrations 20261107150000/150100 (§143.1, aba Renovação). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar em produção: rodar com execute_sql montando  begin; <corpo das migrations sem begin/commit>; <este arquivo sem o begin da linha 3>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.radm@teste.invalid'),
('00000000-0000-0000-0000-00000000f602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rsup@teste.invalid'),
('00000000-0000-0000-0000-00000000f603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ra@teste.invalid'),
('00000000-0000-0000-0000-00000000f604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rb@teste.invalid'),
('00000000-0000-0000-0000-00000000f605', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rag@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f601', 'Zzradm Teste', 'zz.radm', 'admin', 'apex', null),
('00000000-0000-0000-0000-00000000f602', 'Zzrsup Teste', 'zz.rsup', 'supervisor', 'apex', null),
('00000000-0000-0000-0000-00000000f603', 'Zzra Teste', 'zz.ra', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f604', 'Zzrb Teste', 'zz.rb', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f605', 'Zzrag Teste', 'zz.rag', 'agencia', 'apex', null)
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, linhas_voz, apto, cidade, consultor_id, status, linhas_renovadas, prox_retorno) values
('00000000000101', 'Zz Alfa',  10, 'APTO', 'Zz Cidade', '00000000-0000-0000-0000-00000000f603', 1, null, null),
('00000000000102', 'Zz Beta',   5, 'APTO', 'Zz Cidade', '00000000-0000-0000-0000-00000000f603', 2, null, (now() at time zone 'America/Sao_Paulo')::date - 3),
('00000000000103', 'Zz Gama',   3, '1 MÊS PARA APTO', 'Zz Outra', '00000000-0000-0000-0000-00000000f604', 3, null, null),
('00000000000104', 'Zz Delta',  8, 'APTO', 'Zz Outra', '00000000-0000-0000-0000-00000000f604', 6, 4, null);
-- legado da planilha: perdido sem motivo entra como "a completar"
insert into public.renovacao_carteira (cnpj_digits, razao_social, linhas_voz, consultor_id, status, a_completar) values
('00000000000105', 'Zz Legado', 2, '00000000-0000-0000-0000-00000000f604', 7, true);

create or replace function pg_temp.como(p uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
end $f$;

do $$
declare n int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record;
  v_a uuid := '00000000-0000-0000-0000-00000000f603'; v_b uuid := '00000000-0000-0000-0000-00000000f604';
  v_id101 bigint; v_id103 bigint; v_id105 bigint;
begin
  select id into v_id101 from public.renovacao_carteira where cnpj_digits = '00000000000101';
  select id into v_id103 from public.renovacao_carteira where cnpj_digits = '00000000000103';
  select id into v_id105 from public.renovacao_carteira where cnpj_digits = '00000000000105';
  -- insert sem a_completar que quebra a regra é recusado (dono do banco, sem auth)
  begin
    insert into public.renovacao_carteira (cnpj_digits, status) values ('00000000000106', 7);
    assert false, 'insert de perdido sem motivo passou';
  exception when check_violation then
    assert sqlerrm = 'Perdido precisa do motivo', 'mensagem: ' || sqlerrm;
  end;

  execute 'set local role authenticated';
  -- ===== Task 1: consultor A =====
  perform pg_temp.como(v_a);
  select count(*) into n from public.renovacao_carteira;
  assert n = 2, 'consultor A vê só os 2 dele, viu ' || n;
  update public.renovacao_carteira set status = 3 where id = v_id101;
  select * into r from public.renovacao_carteira where id = v_id101;
  assert r.data_contato = v_hoje, 'data_contato preenchida ao sair do status 1';
  assert r.atualizado_por = v_a, 'atualizado_por gravado';
  assert exists (select 1 from public.renovacao_historico h where h.carteira_id = v_id101 and h.campo = 'status' and h.de = '1' and h.para = '3' and h.user_id = v_a), 'histórico 1→3';
  begin
    update public.renovacao_carteira set consultor_id = v_b where id = v_id101;
    assert false, 'consultor trocou o consultor';
  exception when insufficient_privilege then null; end;
  begin
    update public.renovacao_carteira set razao_social = 'Zz Hack' where id = v_id101;
    assert false, 'consultor mudou dado da Claro';
  exception when insufficient_privilege then null; end;
  begin
    update public.renovacao_carteira set a_completar = true where id = v_id101;
    select a_completar into r from public.renovacao_carteira where id = v_id101;
    assert not r.a_completar, 'consultor não liga a_completar';
  end;
  update public.renovacao_carteira set observacoes = 'Zz invasão' where id = v_id103;
  get diagnostics n = row_count;
  assert n = 0, 'consultor A não edita cliente do B';
  begin
    update public.renovacao_carteira set status = 7 where id = v_id101;
    assert false, 'perdido sem motivo passou';
  exception when check_violation then
    assert sqlerrm = 'Perdido precisa do motivo', 'mensagem: ' || sqlerrm;
  end;
  update public.renovacao_carteira set status = 7, motivo_perda = 'Preço' where id = v_id101;
  begin
    update public.renovacao_carteira set canal = 'Fax' where id = v_id101;
    assert false, 'canal fora da lista passou';
  exception when check_violation then null; end;
  begin
    update public.renovacao_carteira set status = 6 where cnpj_digits = '00000000000102';
    assert false, 'renovado sem linhas passou';
  exception when check_violation then
    assert sqlerrm = 'Renovado precisa das linhas renovadas', 'mensagem: ' || sqlerrm;
  end;
  update public.renovacao_carteira set status = 6, linhas_renovadas = 2 where cnpj_digits = '00000000000102';
  begin
    update public.profiles set equipe = null where id = v_a;
    assert false, 'consultor saiu da equipe sozinho';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.renovacao_carteira (cnpj_digits) values ('00000000000107');
    assert false, 'consultor inseriu na carteira';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.renovacao_resumo;
  assert n = 1, 'consultor vê só a própria linha do resumo';

  -- ===== Task 1: legado a completar (consultor B) =====
  perform pg_temp.como(v_b);
  update public.renovacao_carteira set observacoes = 'Zz só obs' where id = v_id105;
  select * into r from public.renovacao_carteira where id = v_id105;
  assert r.a_completar and r.observacoes = 'Zz só obs', 'legado aceita editar só a observação';
  update public.renovacao_carteira set motivo_perda = 'Outro' where id = v_id105;
  select a_completar into r from public.renovacao_carteira where id = v_id105;
  assert not r.a_completar, 'completar o motivo tira a pendência';

  -- ===== Task 1: agência não vê nada =====
  perform pg_temp.como('00000000-0000-0000-0000-00000000f605');
  select count(*) into n from public.renovacao_carteira; assert n = 0, 'agência não vê carteira';
  select count(*) into n from public.renovacao_historico; assert n = 0, 'agência não vê histórico';

  -- ===== Task 1: supervisor redistribui =====
  perform pg_temp.como('00000000-0000-0000-0000-00000000f602');
  select count(*) into n from public.renovacao_carteira; assert n = 5, 'supervisor vê tudo, viu ' || n;
  update public.renovacao_carteira set consultor_id = v_b where id = v_id101;
  assert exists (select 1 from public.renovacao_historico h where h.carteira_id = v_id101 and h.campo = 'consultor' and h.de = v_a::text and h.para = v_b::text), 'histórico da redistribuição';
  begin
    update public.profiles set equipe = null where id = v_a;
    assert false, 'supervisor mudou equipe';
  exception when insufficient_privilege then null; end;

  -- ===== Task 1: admin marca equipe; resumo =====
  perform pg_temp.como('00000000-0000-0000-0000-00000000f601');
  update public.profiles set equipe = null where id = v_a;
  update public.profiles set equipe = 'renovacao' where id = v_a;
  select * into r from public.renovacao_resumo where consultor_id = v_b;
  -- B tem: 101 (7, redistribuído), 103 (3), 104 (6, 4 linhas), 105 (7)
  assert r.carteira = 4 and r.contatados = 4 and r.efetivo_mais = 2 and r.propostas_mais = 1
     and r.renovados = 1 and r.perdidos = 2 and r.linhas_renovadas = 4 and r.retornos_atrasados = 0,
     'resumo de B: ' || row_to_json(r)::text;
  select * into r from public.renovacao_resumo where consultor_id = v_a;
  -- A tem: 102 (6, retorno vencido mas renovado não conta)
  assert r.carteira = 1 and r.renovados = 1 and r.retornos_atrasados = 0, 'resumo de A: ' || row_to_json(r)::text;
  execute 'reset role';
end $$;

-- ===== Task 2 (importação) entra aqui =====

rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Rodar com `mcp__supabase__execute_sql` (projeto `mdgfboijyqfkggcrhptn`) o conteúdo do arquivo.
Expected: ERRO `column "equipe" of relation "profiles" does not exist` (ou `relation "public.renovacao_carteira" does not exist`). Nada fica gravado (a transação aborta).

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261107150000_renovacao_carteira.sql`:

```sql
-- §143.1 (07/11, Rafael): aba Renovação — a carteira do time de renovação sai da planilha do Google e vem para o painel.
-- Spec: docs/superpowers/specs/2026-11-07-renovacao-aba-design.md. Plano: docs/superpowers/plans/2026-11-07-renovacao-fase1.md
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_check.sql (desfaz tudo).
begin;

-- Quem é do time de renovação. Só admin muda (a policy profiles_update deixa cada um editar a própria linha).
alter table public.profiles add column if not exists equipe text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_equipe_check') then
    alter table public.profiles add constraint profiles_equipe_check check (equipe is null or equipe = 'renovacao');
  end if;
end $$;
create or replace function public.profiles_trava_equipe()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.equipe is distinct from old.equipe and auth.uid() is not null and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador muda a equipe' using errcode = '42501';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_trava_equipe' and tgrelid = 'public.profiles'::regclass) then
    create trigger profiles_trava_equipe before update on public.profiles for each row execute function public.profiles_trava_equipe();
  end if;
end $$;

create table if not exists public.renovacao_carteira (
  id bigint generated always as identity primary key,
  cnpj_digits text not null unique check (cnpj_digits ~ '^[0-9]{14}$'),
  razao_social text, telefone text, nome_adm text, linhas_voz int, apto text, cidade text, ddd text,
  tempo_contrato_voz int, classificacao text, desconto_claro text,
  dados_claro jsonb not null default '{}'::jsonb,
  consultor_id uuid references public.profiles(id) on delete set null,
  origem text,
  status smallint not null default 1 check (status between 1 and 7),
  data_contato date,
  prox_retorno date,
  canal text check (canal is null or canal in ('WhatsApp', 'Ligação', 'E-mail', 'Visita')),
  linhas_renovadas int check (linhas_renovadas is null or linhas_renovadas >= 0),
  bl_vendida int check (bl_vendida is null or bl_vendida >= 0),
  sol_digitais numeric(12,2) check (sol_digitais is null or sol_digitais >= 0),
  motivo_perda text check (motivo_perda is null or motivo_perda in ('Preço', 'Foi p/ concorrente', 'Sem interesse',
    'Insatisfeito c/ Claro', 'Empresa fechada/baixada', 'Contato inválido', 'Outro')),
  observacoes text,
  na_base boolean not null default true,
  a_completar boolean not null default false,
  importado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
create index if not exists renovacao_carteira_consultor_idx on public.renovacao_carteira (consultor_id) where na_base;

create table if not exists public.renovacao_historico (
  id bigint generated always as identity primary key,
  carteira_id bigint not null references public.renovacao_carteira(id) on delete cascade,
  user_id uuid,
  campo text not null check (campo in ('status', 'consultor')),
  de text, para text, nota text,
  criado_em timestamptz not null default now()
);
create index if not exists renovacao_historico_carteira_idx on public.renovacao_historico (carteira_id, criado_em desc);

-- Regras (spec 4.2). Perdido exige motivo; Renovado exige linhas; ao sair do 1 grava a data do contato.
-- Legado da planilha (a_completar) passa até a próxima mudança de status; quando fica válido, a pendência some.
-- Consultor só mexe no atendimento. a_completar nunca é ligado por UPDATE (só a importação liga, no INSERT).
create or replace function public.renovacao_carteira_validar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_mudou boolean := false; v_falha text;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and v_role not in ('admin', 'supervisor') and (
         new.consultor_id is distinct from old.consultor_id or new.cnpj_digits is distinct from old.cnpj_digits
      or new.dados_claro is distinct from old.dados_claro or new.na_base is distinct from old.na_base
      or new.razao_social is distinct from old.razao_social or new.telefone is distinct from old.telefone
      or new.nome_adm is distinct from old.nome_adm or new.linhas_voz is distinct from old.linhas_voz
      or new.apto is distinct from old.apto or new.cidade is distinct from old.cidade or new.ddd is distinct from old.ddd
      or new.tempo_contrato_voz is distinct from old.tempo_contrato_voz or new.classificacao is distinct from old.classificacao
      or new.desconto_claro is distinct from old.desconto_claro or new.origem is distinct from old.origem
      or new.importado_em is distinct from old.importado_em) then
      raise exception 'consultor só altera o atendimento' using errcode = '42501';
    end if;
    new.a_completar := old.a_completar;
    v_mudou := new.status is distinct from old.status;
    if v_mudou and new.status >= 2 and new.data_contato is null then
      new.data_contato := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  new.observacoes := nullif(trim(coalesce(new.observacoes, '')), '');
  v_falha := case
    when new.status = 7 and new.motivo_perda is null then 'Perdido precisa do motivo'
    when new.status = 6 and coalesce(new.linhas_renovadas, 0) < 1 then 'Renovado precisa das linhas renovadas'
  end;
  if v_falha is null then
    new.a_completar := false;
  elsif not (new.a_completar and not v_mudou) then
    raise exception '%', v_falha using errcode = '23514';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_validar' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_validar before insert or update on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_validar();
  end if;
end $$;

create or replace function public.renovacao_carteira_historico()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'status', old.status::text, new.status::text);
  end if;
  if new.consultor_id is distinct from old.consultor_id then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'consultor', old.consultor_id::text, new.consultor_id::text);
  end if;
  return null;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_historico' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_historico after update on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_historico();
  end if;
end $$;

-- RLS (spec 4.3). Inserir/excluir: ninguém pela API (importação é pela RPC da migration 150100).
alter table public.renovacao_carteira enable row level security;
alter table public.renovacao_historico enable row level security;
revoke insert, delete on table public.renovacao_carteira from anon, authenticated;
revoke insert, update, delete on table public.renovacao_historico from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_carteira' and policyname = 'renovacao_carteira_select') then
    create policy renovacao_carteira_select on public.renovacao_carteira for select to authenticated
      using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_carteira' and policyname = 'renovacao_carteira_update') then
    create policy renovacao_carteira_update on public.renovacao_carteira for update to authenticated
      using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'))
      with check (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_historico' and policyname = 'renovacao_historico_select') then
    create policy renovacao_historico_select on public.renovacao_historico for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
  end if;
end $$;

-- Resumo (spec 5.3). security_invoker: cada um vê só o que a RLS da carteira deixa.
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
       count(*) filter (where c.prox_retorno < (now() at time zone 'America/Sao_Paulo')::date and c.status not in (6, 7))::int as retornos_atrasados,
       count(*) filter (where c.a_completar)::int                       as a_completar
  from public.renovacao_carteira c
  left join public.profiles p on p.id = c.consultor_id
 where c.na_base
 group by c.consultor_id, p.nome;
grant select on public.renovacao_resumo to authenticated;

commit;
```

- [ ] **Step 4: Rodar o teste com a migration, sem gravar**

Com `execute_sql`, mandar um único texto: `begin;` + corpo da migration **sem** as linhas `begin;`/`commit;` + corpo de `renovacao_check.sql` **sem** a linha `begin;` (ele termina em `rollback;`).
Expected: sucesso sem erro (todas as `assert` passaram) e, depois, `select to_regclass('public.renovacao_carteira')` devolve `null` (nada ficou no banco).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261107150000_renovacao_carteira.sql supabase/tests/renovacao_check.sql
git commit -m "feat(renovacao): carteira, histórico, regras, RLS e resumo no banco (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Banco: importação da base

**Files:**
- Create: `supabase/migrations/20261107150100_renovacao_importar.sql`
- Modify: `supabase/tests/renovacao_check.sql` (trocar a linha `-- ===== Task 2 (importação) entra aqui =====`)

**Interfaces:**
- Consumes: `public.renovacao_carteira` (Task 1).
- Produces: `public.renovacao_importar(p_linhas jsonb) returns jsonb` → `{"novos": int, "atualizados": int}`. Cada item: `cnpj_digits` (14 dígitos, obrigatório), `razao_social, telefone, nome_adm, linhas_voz, apto, cidade, ddd, tempo_contrato_voz, classificacao, desconto_claro, origem, dados_claro, consultor_id, status, data_contato, prox_retorno, canal, linhas_renovadas, bl_vendida, sol_digitais, motivo_perda, observacoes` (todos opcionais). Campos de trabalho e `consultor_id`/`origem` só valem no **insert**. `public.renovacao_marcar_fora(p_cnpjs text[]) returns int` (quantos saíram). Só admin (senão `42501`); CNPJ inválido ou lista vazia → `22023`.

- [ ] **Step 1: Escrever o teste (vai falhar: as funções não existem)**

Em `supabase/tests/renovacao_check.sql`, trocar a linha `-- ===== Task 2 (importação) entra aqui =====` por:

```sql
do $$
declare j jsonb; n int; r record;
begin
  execute 'set local role authenticated';
  -- consultor não importa
  perform pg_temp.como('00000000-0000-0000-0000-00000000f603');
  begin
    perform public.renovacao_importar('[{"cnpj_digits": "00000000000199"}]'::jsonb);
    assert false, 'consultor importou';
  exception when insufficient_privilege then null; end;
  begin
    perform public.renovacao_marcar_fora(array['00000000000101']);
    assert false, 'consultor marcou fora da base';
  exception when insufficient_privilege then null; end;

  perform pg_temp.como('00000000-0000-0000-0000-00000000f601');
  j := public.renovacao_importar(jsonb_build_array(
    jsonb_build_object('cnpj_digits', '00000000000101', 'razao_social', 'Zz Alfa Novo Nome', 'linhas_voz', 11,
                       'dados_claro', jsonb_build_object('CIDADE', 'Zz Cidade', 'SCORE', 7),
                       'status', 1, 'observacoes', 'Zz não pode sobrescrever', 'consultor_id', null),
    jsonb_build_object('cnpj_digits', '00000000000199', 'razao_social', 'Zz Novo', 'status', 7,
                       'consultor_id', '00000000-0000-0000-0000-00000000f603', 'origem', 'Nova atribuição'),
    jsonb_build_object('cnpj_digits', '00000000000199', 'razao_social', 'Zz Novo Repetido')
  ));
  assert (j->>'novos')::int = 1 and (j->>'atualizados')::int = 1, 'contagem: ' || j::text;
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000101';
  assert r.razao_social = 'Zz Alfa Novo Nome' and r.linhas_voz = 11 and (r.dados_claro->>'SCORE') = '7', 'dados da Claro atualizados';
  assert r.status = 7 and r.motivo_perda = 'Preço' and r.consultor_id = '00000000-0000-0000-0000-00000000f604'
     and r.observacoes is null, 'atendimento e consultor preservados na reimportação: ' || row_to_json(r)::text;
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000199';
  assert r.razao_social = 'Zz Novo' and r.status = 7 and r.a_completar and r.consultor_id = '00000000-0000-0000-0000-00000000f603'
     and r.origem = 'Nova atribuição', 'novo entra com trabalho e como pendência: ' || row_to_json(r)::text;
  begin
    perform public.renovacao_importar('[{"cnpj_digits": "123"}]'::jsonb);
    assert false, 'CNPJ inválido passou';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.renovacao_marcar_fora(array[]::text[]);
    assert false, 'lista vazia marcou todo mundo fora';
  exception when invalid_parameter_value then null; end;
  n := public.renovacao_marcar_fora(array['00000000000101', '00000000000199']);
  assert n = 4, 'saíram 102, 103, 104 e 105, veio ' || n;
  assert not (select na_base from public.renovacao_carteira where cnpj_digits = '00000000000103'), '103 fora da base';
  assert (select status from public.renovacao_carteira where cnpj_digits = '00000000000103') = 3, 'fora da base não perde o status';
  select coalesce(sum(carteira), 0) into n from public.renovacao_resumo;
  assert n = 2, 'resumo só conta quem está na base, veio ' || n;
  j := public.renovacao_importar('[{"cnpj_digits": "00000000000103", "razao_social": "Zz Gama"}]'::jsonb);
  assert (select na_base from public.renovacao_carteira where cnpj_digits = '00000000000103'), 'reimportar volta para a base';
  execute 'reset role';
end $$;
```

- [ ] **Step 2: Rodar e ver falhar**

`begin;` + migration 150000 (sem begin/commit) + `renovacao_check.sql` (sem o primeiro `begin;`).
Expected: ERRO `function public.renovacao_importar(jsonb) does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261107150100_renovacao_importar.sql`:

```sql
-- §143.1 (07/11, Rafael): importação da carteira de renovação (só admin), pelo painel.
-- Junta por CNPJ: novo entra (com o atendimento da planilha, se vier); existente só tem os dados da Claro atualizados
-- e volta para a base; atendimento, consultor e origem nunca são sobrescritos. Quem sumiu do arquivo: renovacao_marcar_fora.
-- Sem DROP. Aplicar com execute_sql (begin/commit) depois da 150000. Conferência: supabase/tests/renovacao_check.sql.
begin;

create or replace function public.renovacao_importar(p_linhas jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_novos int; v_atual int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador importa a base' using errcode = '42501';
  end if;
  if jsonb_typeof(p_linhas) is distinct from 'array' then
    raise exception 'lista inválida' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e where coalesce(e->>'cnpj_digits', '') !~ '^[0-9]{14}$') then
    raise exception 'CNPJ inválido na lista' using errcode = '22023';
  end if;
  -- CNPJ repetido no mesmo lote: vale a primeira ocorrência (ordinality deixa o distinct on determinístico)
  with entrada as (
    select distinct on (x.cnpj_digits) x.*
      from (select r.*, e.n
              from jsonb_array_elements(p_linhas) with ordinality as e(j, n)
             cross join lateral jsonb_to_record(e.j) as r(
               cnpj_digits text, razao_social text, telefone text, nome_adm text, linhas_voz int, apto text, cidade text, ddd text,
               tempo_contrato_voz int, classificacao text, desconto_claro text, origem text, dados_claro jsonb, consultor_id uuid,
               status smallint, data_contato date, prox_retorno date, canal text, linhas_renovadas int, bl_vendida int,
               sol_digitais numeric, motivo_perda text, observacoes text)) x
     order by x.cnpj_digits, x.n
  ), upd as (
    update public.renovacao_carteira c set
      razao_social = e.razao_social, telefone = e.telefone, nome_adm = e.nome_adm, linhas_voz = e.linhas_voz,
      apto = e.apto, cidade = e.cidade, ddd = e.ddd, tempo_contrato_voz = e.tempo_contrato_voz,
      classificacao = e.classificacao, desconto_claro = e.desconto_claro,
      dados_claro = coalesce(e.dados_claro, '{}'::jsonb), na_base = true, importado_em = now()
      from entrada e
     where c.cnpj_digits = e.cnpj_digits
    returning 1
  ), ins as (
    insert into public.renovacao_carteira (cnpj_digits, razao_social, telefone, nome_adm, linhas_voz, apto, cidade, ddd,
      tempo_contrato_voz, classificacao, desconto_claro, dados_claro, origem, consultor_id, status, data_contato, prox_retorno,
      canal, linhas_renovadas, bl_vendida, sol_digitais, motivo_perda, observacoes, a_completar)
    select e.cnpj_digits, e.razao_social, e.telefone, e.nome_adm, e.linhas_voz, e.apto, e.cidade, e.ddd,
           e.tempo_contrato_voz, e.classificacao, e.desconto_claro, coalesce(e.dados_claro, '{}'::jsonb), e.origem, e.consultor_id,
           coalesce(e.status, 1), e.data_contato, e.prox_retorno, nullif(e.canal, ''), e.linhas_renovadas, e.bl_vendida,
           e.sol_digitais, nullif(e.motivo_perda, ''), e.observacoes,
           (coalesce(e.status, 1) = 7 and nullif(e.motivo_perda, '') is null)
             or (coalesce(e.status, 1) = 6 and coalesce(e.linhas_renovadas, 0) < 1)
      from entrada e
     where not exists (select 1 from public.renovacao_carteira c where c.cnpj_digits = e.cnpj_digits)
    returning 1
  )
  select (select count(*) from ins), (select count(*) from upd) into v_novos, v_atual;
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual);
end $function$;
revoke all on function public.renovacao_importar(jsonb) from public, anon;
grant execute on function public.renovacao_importar(jsonb) to authenticated;

create or replace function public.renovacao_marcar_fora(p_cnpjs text[])
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador importa a base' using errcode = '42501';
  end if;
  if coalesce(array_length(p_cnpjs, 1), 0) = 0 then
    raise exception 'lista vazia: ninguém foi marcado fora da base' using errcode = '22023';
  end if;
  update public.renovacao_carteira set na_base = false where na_base and not (cnpj_digits = any(p_cnpjs));
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.renovacao_marcar_fora(text[]) from public, anon;
grant execute on function public.renovacao_marcar_fora(text[]) to authenticated;

commit;
```

- [ ] **Step 4: Rodar e ver passar (sem gravar)**

`begin;` + migration 150000 (sem begin/commit) + migration 150100 (sem begin/commit) + `renovacao_check.sql` (sem o primeiro `begin;`).
Expected: sucesso; `select to_regproc('public.renovacao_importar')` depois devolve `null`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261107150100_renovacao_importar.sql supabase/tests/renovacao_check.sql
git commit -m "feat(renovacao): RPCs de importação da carteira por CNPJ (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Aba Renovação: botão, painel, permissão e marcação do time

**Files:**
- Create: `renovacao_test_harness.js`
- Create: `test_renovacao_aba.js`
- Modify: `_template.html`: menu (depois da linha do `tabBtnMeusLeads`, ~1469), painel (antes de `<section class="panel" id="panel-funil">`, ~1608), CSS (fim do bloco de estilos de Meus leads, depois de `.kbFicha.flutuante [data-kb-ficha-fechar]{…}`, ~990), `currentUser` (~3258), `enterApp` (~3327), handler do menu (~3570), tabela de usuários (~1700 e `renderUsersTable` ~11141), bloco JS novo (antes de `/* ============ MEUS LEADS (KANBAN) — §112`)

**Interfaces:**
- Produces (JS global): `RN_STATUS`, `RN_CANAIS`, `RN_MOTIVOS`, `RN_COLS_LISTA`, `RN_PAGINA`, `rnEstado`, `rnFiltrosVazios()`, `rnGestor()`, `rnPodeVer()`, `rnAplicarPermissao()`, `rnTrocarAba(aba)`, `rnCarregar()`, `rnRender()`, `rnStatus(msg)`, `rnHoje()`, `rnRetornoVencido(r, hoje)`, `rnAtualizarBadge()`, `rnNomeConsultor(id)`. `currentUser.equipe`. Marcadores do bloco: começa em `/* ============ RENOVAÇÃO — §143 ============` e termina em `/* ============ FIM RENOVAÇÃO §143 ============ */`; as Tasks 4–7 inserem código **antes** do marcador final.
- `renovacao_test_harness.js` exporta `rodar(testScript)`. No teste: `window.__tabelas[tabela]` (linhas), `window.__resp[tabela] = (q) => ({data, error})` (resposta customizada; `q = {tabela, op, filtros, patch}`), `window.__escritas` (updates feitos), `window.__rpcCalls`, `window.__rpcRespostas[nome]`, helpers `assert`, `eq`, `espera(ms)`, `fim()`.

- [ ] **Step 1: Escrever o harness**

Criar `renovacao_test_harness.js`:

```js
// Harness dos testes da aba Renovação (§143). Não é teste (o nome foge de test_*). DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

function rodar(testScript){
  const html = fs.readFileSync('_template.html', 'utf8');
  const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if(!m){ console.error('script nao encontrado'); process.exit(1); }
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(window, { __tabelas: {}, __resp: {}, __escritas: [], __rpcCalls: [], __rpcRespostas: {}, __sessao: null });
  const casa = (linha, filtros) => filtros.every(([op, c, v]) => op === 'eq' ? String(linha[c]) === String(v) : op === 'in' ? v.map(String).includes(String(linha[c])) : true);
  function builder(tabela){
    const q = { tabela, op: 'select', filtros: [], patch: null };
    const resposta = () => {
      const r = window.__resp[tabela];
      if(typeof r === 'function') return r(q);
      const linhas = window.__tabelas[tabela] || [];
      if(q.op === 'update'){
        const alvo = linhas.filter(l => casa(l, q.filtros));
        alvo.forEach(l => Object.assign(l, q.patch));
        return { data: alvo.map(l => Object.assign({}, l)), error: null };
      }
      return { data: linhas.filter(l => casa(l, q.filtros)).map(l => Object.assign({}, l)), error: null };
    };
    const b = {
      select: () => b, order: () => b, limit: () => b, is: () => b, gte: () => b, lte: () => b, lt: () => b,
      eq: (c, v) => { q.filtros.push(['eq', c, v]); return b; },
      in: (c, v) => { q.filtros.push(['in', c, v]); return b; },
      update: (patch) => { q.op = 'update'; q.patch = patch; window.__escritas.push(q); return b; },
      single: async () => { const r = resposta(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
      maybeSingle: async () => { const r = resposta(); return { data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }; },
      then: (ok, ko) => Promise.resolve(resposta()).then(ok, ko),
    };
    return b;
  }
  window.supabase = { createClient: comRange(() => ({
    auth: { getSession: async () => ({ data: { session: window.__sessao } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
    from: (t) => builder(t),
    functions: { invoke: async () => ({ data: {}, error: null }) },
    rpc: (nome, args) => {
      window.__rpcCalls.push({ nome, args });
      const r = window.__rpcRespostas[nome];
      const res = typeof r === 'function' ? r(args) : (r || { data: null, error: null });
      return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
    },
  })) };
  window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
  // Date do Node: o SheetJS roda no "realm" do Node e testa instanceof Date; Date criado no jsdom não passa.
  window.__dataNode = (...a) => new Date(...a);
  window.alert = () => {};
  window.confirm = () => true;
  window.Chart = function(){ this.destroy = function(){}; return this; };
  window.TextDecoder = TextDecoder;
  window.process = process;
  const prefixo = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  function fim(){ console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---'); process.exit(fail > 0 ? 1 : 0); }
`;
  const sufixo = `
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
  window.eval(m[1] + prefixo + testScript + sufixo);
}

module.exports = { rodar };
```

- [ ] **Step 2: Escrever o teste da aba (vai falhar)**

Criar `test_renovacao_aba.js`:

```js
// Testa a §143.1 — aba Renovação: quem vê, carga, subabas e marcação do time na aba Consultores. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const btn = () => document.getElementById('tabBtnRenovacao');
  assert(!!btn() && btn().dataset.tab === 'renovacao', 'botão da aba existe');
  assert(!!document.getElementById('panel-renovacao'), 'painel existe');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao(); eq(btn().style.display, 'inline-block', 'time de renovação vê');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'consultor fora do time não vê');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'inline-block', 'supervisor da Apex vê');
  currentUser = { id: 'u-c', nome: 'Zzc Teste', role: 'supervisor', operacao: 'campinas', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'supervisor de Campinas não vê');
  currentUser = { id: 'u-g', nome: 'Zzg Teste', role: 'agencia', operacao: 'apex', equipe: null };
  rnAplicarPermissao(); eq(btn().style.display, 'none', 'agência não vê');

  // carga ao abrir a aba
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    { id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Alfa', linhas_voz: 9, status: 2, prox_retorno: '2000-01-01', na_base: true, consultor_id: 'u-a' },
    { id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Beta', linhas_voz: 3, status: 7, prox_retorno: '2000-01-01', na_base: true, consultor_id: 'u-a' },
  ];
  btn().click();
  await espera(40);
  assert(rnEstado.carregado && rnEstado.lista.length === 2, 'abrir a aba carrega a carteira');
  eq(document.getElementById('rnBadgeMenu').textContent, '1', 'selo no menu = retornos vencidos (perdido não conta)');
  eq(document.getElementById('rnBadgeRetornos').textContent, '1', 'selo na subaba Retornos');
  eq(rnEstado.perfis.map(p => p.id), ['u-a'], 'consultor: lista de perfis é só ele');

  // subabas
  rnTrocarAba('resumo');
  assert(document.getElementById('rnCarteira').hidden && !document.getElementById('rnResumo').hidden, 'subaba Resumo aparece');
  assert(document.querySelector('#rnAbas [data-rn-aba="resumo"]').classList.contains('active'), 'botão da subaba ativo');
  document.querySelector('#rnAbas [data-rn-aba="carteira"]').click();
  assert(!document.getElementById('rnCarteira').hidden, 'clique volta para a Carteira');

  // aba Consultores: coluna Renovação, só admin marca, só consultor pode ser marcado
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  window.__tabelas.profiles = [
    { id: 'u-a', nome: 'Zza Teste', username: 'zz.a', role: 'consultor', equipe: 'renovacao' },
    { id: 'u-x', nome: 'Zzx Teste', username: 'zz.x', role: 'consultor', equipe: null },
    { id: 'u-s', nome: 'Zzs Teste', username: 'zz.s', role: 'supervisor', equipe: null },
  ];
  window.__tabelas.consultas_resumo = [];
  await renderUsersTable();
  const cx = (id) => document.querySelector('#usersTbody [data-rn-equipe="' + id + '"]');
  assert(cx('u-a').checked && !cx('u-a').disabled, 'admin vê marcado e pode mexer');
  assert(cx('u-s').disabled, 'supervisor não entra no time');
  window.__escritas.length = 0;
  cx('u-x').checked = true;
  cx('u-x').dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  const w = window.__escritas.find(e => e.tabela === 'profiles');
  assert(w && w.patch.equipe === 'renovacao' && JSON.stringify(w.filtros) === JSON.stringify([['eq', 'id', 'u-x']]), 'marcar grava equipe = renovacao');
  currentUser = { id: 'u-s', nome: 'Zzs Teste', role: 'supervisor', operacao: 'apex' };
  await renderUsersTable();
  assert(cx('u-a').disabled, 'supervisor vê mas não mexe');
  fim();
`);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_aba.js`
Expected: `FALHOU: botão da aba existe` e depois `FALHA: ReferenceError: rnAplicarPermissao is not defined`.

- [ ] **Step 4: Implementar**

4a. Menu: logo depois da linha do `<button data-tab="meusleads" id="tabBtnMeusLeads" …>…</button>`, inserir:

```html
      <button data-tab="renovacao" id="tabBtnRenovacao" style="display:none" data-sub="Carteira de renovação, retornos e resumo do time"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg><span class="sbLabel">Renovação</span></button>
```

4b. Painel: antes de `<section class="panel" id="panel-funil">`, inserir:

```html
    <section class="panel" id="panel-renovacao">
      <div class="kbBarra">
        <nav class="kbSeg" id="rnAbas" aria-label="Visões da Renovação">
          <button type="button" class="active" data-rn-aba="carteira">Carteira</button>
          <button type="button" data-rn-aba="retornos">Retornos <span class="kbBadge" id="rnBadgeRetornos"></span></button>
          <button type="button" data-rn-aba="resumo">Resumo</button>
        </nav>
        <span class="kbStatusLinha" id="rnStatus"></span>
      </div>
      <div id="rnCarteira" class="rnVisao">
        <div class="rnFiltros">
          <input type="search" id="rnBusca" class="kbBusca" placeholder="Buscar CNPJ, razão social ou ADM" autocomplete="off" aria-label="Buscar na carteira">
          <select id="rnFStatus" aria-label="Status"></select>
          <select id="rnFApto" aria-label="Apto"><option value="">Apto: todos</option><option value="APTO">APTO</option><option value="1 MÊS PARA APTO">1 mês para apto</option></select>
          <select id="rnFCidade" aria-label="Cidade"></select>
          <select id="rnFConsultor" aria-label="Consultor" style="display:none"></select>
          <button type="button" class="filterPill" data-rn-filtro="soVencido">Só retorno vencido</button>
          <button type="button" class="filterPill" data-rn-filtro="pendencias">Pendências</button>
          <button type="button" class="filterPill" data-rn-filtro="foraBase">Fora da base</button>
        </div>
        <div class="rnContadores" id="rnContadores"></div>
        <div class="rnRedistribuir" id="rnRedistribuir" style="display:none">
          <span id="rnSelN"></span>
          <select id="rnPassarPara" aria-label="Passar para"></select>
          <button type="button" class="btn btn-sm" id="rnPassar">Passar</button>
        </div>
        <table class="tbl rnTabela"><thead id="rnThead"></thead><tbody id="rnTbody"></tbody></table>
        <button type="button" class="btn btn-outline btn-sm" id="rnMais" style="display:none"></button>
      </div>
      <div id="rnRetornos" class="rnVisao" hidden></div>
      <div id="rnResumo" class="rnVisao" hidden></div>
      <aside class="kbFicha" id="rnFicha" aria-label="Ficha do cliente"><div class="kbFichaCorpo" id="rnFichaCorpo"></div></aside>
    </section>
```

4c. CSS: depois da regra `.kbFicha.flutuante [data-kb-ficha-fechar]{display:inline-flex;}`, inserir:

```css
  /* §143 Renovação: reaproveita Meus leads (kbSeg, kbFicha, kbBusca); só o que é próprio da carteira */
  .rnFiltros{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2);}
  .rnFiltros .kbBusca{min-width:240px;flex:1;}
  .rnContadores{display:flex;flex-wrap:wrap;gap:var(--space-4);color:var(--muted);margin-bottom:var(--space-2);}
  .rnRedistribuir{display:flex;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2);}
  .rnTabela select,.rnTabela input[type=date]{max-width:180px;}
  .rnTabela tr.rnPerdido td{background:var(--st-perdido-bg);}
  .rnTabela tr.rnRenovado td{background:var(--st-ganho-bg);}
  .rnVencido{color:var(--st-perdido);font-weight:600;}
  .rnNome{background:none;border:0;padding:0;font:inherit;font-weight:600;color:inherit;cursor:pointer;text-align:left;}
  .rnNome:hover{text-decoration:underline;}
```

4d. `currentUser` (linha `currentUser = { id: authUser.id, … operacao: profile.operacao || 'apex' };`): trocar por

```js
  currentUser = { id: authUser.id, email: authUser.email, nome: profile.nome, username: profile.username, role: profile.role,
    operacao: profile.operacao || 'apex', equipe: profile.equipe || null }; // seção 78; §143 equipe
```

4e. `enterApp`: depois da linha `kbAplicarPermissao().catch(err => console.error(err));`, inserir:

```js
    // 07/11/2026 (seção 143): Renovação — time de renovação + admin/supervisor da Apex; carrega já no login por causa do selo
    rnAplicarPermissao();
    if(rnPodeVer()) rnCarregar().catch(err => console.error(err));
```

4f. Handler do menu (`document.getElementById('tabsNav').addEventListener('click', …)`): depois da linha `if(btn.dataset.tab === 'agenda') loadAgenda();`, inserir:

```js
  if(btn.dataset.tab === 'renovacao'){ if(rnEstado.carregado) rnRender(); else rnCarregar(); }
```

4g. Aba Consultores. No `<thead>` da tabela de usuários (`<th>Última consulta</th><th>Ações</th>`), trocar por `<th>Última consulta</th><th>Renovação</th><th>Ações</th>`. Em `renderUsersTable()`: trocar os dois `colspan="6"` por `colspan="7"` e, no `return \`<tr>…`, entre `<td>${lastStr}</td>` e `<td style="white-space:nowrap">${actions}</td>`, inserir:

```js
      <td><input type="checkbox" data-rn-equipe="${u.id}" aria-label="Time de renovação"${u.equipe === 'renovacao' ? ' checked' : ''}${currentUser.role === 'admin' && u.role === 'consultor' ? '' : ' disabled'}></td>
```

E, depois do listener `document.getElementById('usersTbody').addEventListener('click', …)` (fim do bloco), inserir:

```js
// §143: admin marca quem é do time de renovação (o banco recusa de quem não é admin — trigger profiles_trava_equipe)
document.getElementById('usersTbody').addEventListener('change', async function(e){
  const cx = e.target.closest('input[data-rn-equipe]');
  if(!cx) return;
  const { error } = await sb.from('profiles').update({ equipe: cx.checked ? 'renovacao' : null }).eq('id', cx.dataset.rnEquipe);
  if(error){ cx.checked = !cx.checked; mostrarAviso('Não foi possível mudar o time: ' + error.message, 'erro'); return; }
  mostrarAviso(cx.checked ? 'Entrou no time de renovação.' : 'Saiu do time de renovação.', 'ok');
});
```

4h. Bloco JS: antes de `/* ============ MEUS LEADS (KANBAN) — §112 ============`, inserir:

```js
/* ============ RENOVAÇÃO — §143 ============
   07/11/2026: a carteira do time de renovação sai da planilha do Google e vem para o painel (Fase 1: Carteira, Retornos,
   Resumo, Redistribuir, Importar). Regras e permissões ficam no banco (renovacao_carteira_validar, RLS).
   Spec: docs/superpowers/specs/2026-11-07-renovacao-aba-design.md */
const RN_STATUS = { 1: 'Não contatado', 2: 'Tentativa s/ retorno', 3: 'Contato efetivo', 4: 'Proposta enviada', 5: 'Em negociação', 6: 'Renovado', 7: 'Perdido' };
const RN_CANAIS = ['WhatsApp', 'Ligação', 'E-mail', 'Visita'];
const RN_MOTIVOS = ['Preço', 'Foi p/ concorrente', 'Sem interesse', 'Insatisfeito c/ Claro', 'Empresa fechada/baixada', 'Contato inválido', 'Outro'];
const RN_COLS_LISTA = 'id,cnpj_digits,razao_social,telefone,nome_adm,linhas_voz,apto,cidade,ddd,consultor_id,origem,status,data_contato,prox_retorno,canal,linhas_renovadas,bl_vendida,sol_digitais,motivo_perda,observacoes,na_base,a_completar,atualizado_em';
const RN_PAGINA = 100;
function rnFiltrosVazios(){ return { busca: '', status: '', apto: '', cidade: '', consultor: '', soVencido: false, pendencias: false, foraBase: false }; }
const rnEstado = { aba: 'carteira', lista: [], perfis: [], carregado: false, geracao: 0, filtros: rnFiltrosVazios(), pagina: 1, selecionados: new Set(), fichaId: null, ficha: null, importacao: null };

function rnGestor(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function rnPodeVer(){
  if(!currentUser) return false;
  if(currentUser.equipe === 'renovacao') return true;
  return rnGestor() && veAbasDaApex();
}
function rnAplicarPermissao(){
  document.getElementById('tabBtnRenovacao').style.display = rnPodeVer() ? 'inline-block' : 'none';
  Object.assign(rnEstado, { aba: 'carteira', lista: [], perfis: [], carregado: false, filtros: rnFiltrosVazios(), pagina: 1, fichaId: null, ficha: null, importacao: null });
  rnEstado.selecionados.clear();
  rnEstado.geracao++;
  // troca de usuário na mesma aba do navegador: nada do anterior fica na tela
  ['rnTbody', 'rnRetornos', 'rnResumo', 'rnFichaCorpo', 'rnContadores'].forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('rnFicha').classList.remove('aberta');
}
function rnStatus(msg){ const el = document.getElementById('rnStatus'); if(el) el.textContent = msg || ''; }
function rnHoje(){ return hojeSP(); }
function rnRetornoVencido(r, hoje){ return !!r.prox_retorno && r.prox_retorno < hoje && r.status !== 6 && r.status !== 7; }
function rnNomeConsultor(id){
  if(!id) return 'Sem consultor';
  const p = rnEstado.perfis.find(x => x.id === id);
  return p ? p.nome : (currentUser && id === currentUser.id ? currentUser.nome : '—');
}
function rnAtualizarBadge(){
  const hoje = rnHoje();
  const n = rnEstado.lista.filter(r => r.na_base && rnRetornoVencido(r, hoje)).length;
  let bm = document.getElementById('rnBadgeMenu');
  if(!bm){ bm = document.createElement('span'); bm.id = 'rnBadgeMenu'; bm.className = 'kbBadge'; document.getElementById('tabBtnRenovacao').appendChild(bm); }
  [bm, document.getElementById('rnBadgeRetornos')].forEach(el => { el.textContent = n ? String(n) : ''; });
}
async function rnCarregar(){
  if(!rnPodeVer()) return;
  const geracao = ++rnEstado.geracao;
  rnStatus('Carregando a carteira…');
  const [car, pf] = await Promise.all([
    fetchAllRows(() => sb.from('renovacao_carteira').select(RN_COLS_LISTA).order('id')),
    rnGestor()
      ? ppSeguro(() => sb.from('profiles').select('id,nome,equipe').eq('equipe', 'renovacao').order('nome'))
      : Promise.resolve({ data: [{ id: currentUser.id, nome: currentUser.nome, equipe: 'renovacao' }], error: null }),
  ]);
  if(geracao !== rnEstado.geracao) return;
  if(car.error){ console.error(car.error); rnStatus('Não foi possível carregar a carteira agora.'); return; }
  rnEstado.lista = car.data || [];
  rnEstado.perfis = (pf && !pf.error && pf.data) || [];
  rnEstado.carregado = true;
  rnStatus('');
  rnAtualizarBadge();
  rnRender();
}
function rnTrocarAba(aba){
  rnEstado.aba = aba;
  document.querySelectorAll('#rnAbas [data-rn-aba]').forEach(b => b.classList.toggle('active', b.dataset.rnAba === aba));
  document.getElementById('rnCarteira').hidden = aba !== 'carteira';
  document.getElementById('rnRetornos').hidden = aba !== 'retornos';
  document.getElementById('rnResumo').hidden = aba !== 'resumo';
  rnRender();
}
document.getElementById('rnAbas').addEventListener('click', e => { const b = e.target.closest('[data-rn-aba]'); if(b) rnTrocarAba(b.dataset.rnAba); });
// Cada subaba tem seu render (Tasks 4 e 6 do plano); typeof deixa este bloco funcionar sozinho.
function rnRender(){
  if(rnEstado.aba === 'carteira' && typeof rnRenderCarteira === 'function') rnRenderCarteira();
  if(rnEstado.aba === 'retornos' && typeof rnRenderRetornos === 'function') rnRenderRetornos();
  if(rnEstado.aba === 'resumo' && typeof rnRenderResumo === 'function') rnRenderResumo();
}
/* ============ FIM RENOVAÇÃO §143 ============ */
```

- [ ] **Step 5: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_renovacao_aba.js`
Expected: `--- RESULTADO: 21 passaram, 0 falharam ---` (o número exato pode variar; 0 falharam é o que importa).

- [ ] **Step 6: Commit**

```bash
git add renovacao_test_harness.js test_renovacao_aba.js _template.html
git commit -m "feat(renovacao): aba Renovação, permissão e marcação do time na aba Consultores (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Carteira: lista, filtros, cores, edição na linha, fechamento e redistribuição

**Files:**
- Create: `test_renovacao_carteira.js`
- Modify: `_template.html` (bloco `RENOVAÇÃO — §143`, antes do marcador `FIM RENOVAÇÃO §143`)

**Interfaces:**
- Consumes: `rnEstado`, `rnHoje`, `rnRetornoVencido`, `rnNomeConsultor`, `rnGestor`, `rnRender`, `rnAtualizarBadge`, `RN_*` (Task 3).
- Produces: `rnNorm(s)`, `rnStatusRotulo(s)`, `rnFiltrar(lista, filtros, hoje)`, `rnContadores(lista, hoje)` → `{total, pctNaoContatado, vencidos, pendencias}`, `rnClasseLinha(r)`, `rnValidarFechamento(status, dados)` → `string|null`, `rnSalvar(id, patch)` → `Promise<boolean>`, `rnMensagemErro(err)`, `rnRenderCarteira()`, `rnAbrirFechamento(id, status)`, `rnRedistribuir()`. A ficha (Task 5) define `rnAbrirFicha(id)` e `rnRenderFicha()`; aqui elas são chamadas com `typeof`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_carteira.js`:

```js
// Testa a §143.1 — Carteira da Renovação: filtros, cores, edição, janela de fechamento e redistribuição. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const L = (o) => Object.assign({ id: 0, cnpj_digits: '00000000000100', razao_social: 'Zz', nome_adm: 'Zz Adm', linhas_voz: 1, apto: 'APTO',
    cidade: 'Zz Cidade', consultor_id: 'u-a', status: 1, prox_retorno: null, canal: null, linhas_renovadas: null, motivo_perda: null,
    observacoes: null, na_base: true, a_completar: false }, o);
  const HOJE = '2026-11-07';
  const base = () => [
    L({ id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Ácido Ltda', linhas_voz: 3, status: 2, prox_retorno: '2026-11-01' }),
    L({ id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Beta', linhas_voz: 30, status: 7, motivo_perda: 'Preço', prox_retorno: '2026-11-01', cidade: 'Zz Outra' }),
    L({ id: 3, cnpj_digits: '00000000000103', razao_social: 'Zz Gama', linhas_voz: 30, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' }),
    L({ id: 4, cnpj_digits: '00000000000104', razao_social: 'Zz Delta', linhas_voz: 8, status: 7, a_completar: true, consultor_id: null }),
    L({ id: 5, cnpj_digits: '00000000000105', razao_social: 'Zz Fora', linhas_voz: 99, na_base: false }),
  ];

  // ==== funções puras ====
  eq(rnFiltrar(base(), rnFiltrosVazios(), HOJE).map(r => r.id), [2, 3, 4, 1], 'só na base, mais linhas primeiro, empate por nome');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { foraBase: true }), HOJE).map(r => r.id), [5], 'Fora da base mostra só eles');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { busca: 'acido' }), HOJE).map(r => r.id), [1], 'busca sem acento');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { busca: '0103' }), HOJE).map(r => r.id), [3], 'busca por pedaço do CNPJ');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { soVencido: true }), HOJE).map(r => r.id), [1], 'vencido ignora perdido');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { pendencias: true }), HOJE).map(r => r.id), [4], 'Pendências');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { consultor: '-' }), HOJE).map(r => r.id), [4], 'Sem consultor');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { consultor: 'u-b' }), HOJE).map(r => r.id), [3], 'por consultor');
  eq(rnFiltrar(base(), Object.assign(rnFiltrosVazios(), { status: '7', cidade: 'Zz Outra' }), HOJE).map(r => r.id), [2], 'status + cidade');
  eq(rnContadores(base(), HOJE), { total: 4, pctNaoContatado: 0, vencidos: 1, pendencias: 1 }, 'contadores');
  eq([rnClasseLinha({ status: 7 }), rnClasseLinha({ status: 6 }), rnClasseLinha({ status: 3 })], ['rnPerdido', 'rnRenovado', ''], 'cores');
  eq(rnValidarFechamento(7, {}), 'Escolha o motivo da perda.', 'perdido sem motivo');
  eq(rnValidarFechamento(7, { motivo_perda: 'Preço' }), null, 'perdido com motivo');
  eq(rnValidarFechamento(6, { linhas_renovadas: 0 }), 'Informe quantas linhas foram renovadas.', 'renovado sem linhas');
  eq(rnValidarFechamento(6, { linhas_renovadas: 3 }), null, 'renovado com linhas');
  eq(rnStatusRotulo(3), '3-Contato efetivo', 'rótulo do status');

  // ==== consultor: render e edição ====
  rnHoje = () => HOJE;   // a tela usa o "hoje" de SP; o teste fixa a data
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base().filter(r => r.consultor_id === 'u-a');
  await rnCarregar();
  const linhas = () => [...document.querySelectorAll('#rnTbody tr[data-rn-id]')];
  eq(linhas().map(t => t.dataset.rnId), ['2', '1'], 'consultor vê os dele na base');
  assert(linhas()[0].classList.contains('rnPerdido'), 'linha do perdido fica vermelha');
  eq(document.querySelectorAll('#rnTbody [data-rn-sel]').length, 0, 'consultor não seleciona para redistribuir');
  assert(document.getElementById('rnFConsultor').style.display === 'none', 'consultor não tem filtro de consultor');
  assert(/2<\\/b> clientes/.test(document.getElementById('rnContadores').innerHTML), 'contador de clientes');

  window.__escritas.length = 0;
  const canal = linhas()[1].querySelector('[data-rn-campo="canal"]');
  canal.value = 'WhatsApp'; canal.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(20);
  eq(window.__escritas.map(w => [w.patch, w.filtros]), [[{ canal: 'WhatsApp' }, [['eq', 'id', 1]]]], 'canal grava na hora');
  eq(rnEstado.lista.find(r => r.id === 1).canal, 'WhatsApp', 'lista local atualizada com o que voltou do banco');

  // mudar para Perdido abre a janela; cancelar volta o select e não grava
  window.__escritas.length = 0;
  let st = document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]');
  st.value = '7'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  const ov = document.getElementById('rnFechamento');
  assert(ov && ov.classList.contains('active') && !!document.getElementById('rnFechMotivo'), 'Perdido abre a janela com motivo');
  document.querySelector('#rnFechamento [data-rn-fech-cancelar]').click();
  await espera(200);
  eq(window.__escritas.length, 0, 'cancelar não grava');
  eq(document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]').value, '2', 'cancelar volta o status');

  // salvar sem motivo avisa; com motivo grava status + motivo juntos
  st = document.querySelector('#rnTbody tr[data-rn-id="1"] [data-rn-campo="status"]');
  st.value = '7'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(10);
  eq(document.getElementById('rnFechErro').textContent, 'Escolha o motivo da perda.', 'sem motivo não salva');
  eq(window.__escritas.length, 0, 'nada gravado sem motivo');
  document.getElementById('rnFechMotivo').value = 'Sem interesse';
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(20);
  eq(window.__escritas[0].patch, { status: 7, motivo_perda: 'Sem interesse', observacoes: null }, 'grava status e motivo juntos');

  // Renovado pede linhas
  window.__escritas.length = 0;
  st = document.querySelector('#rnTbody tr[data-rn-id="2"] [data-rn-campo="status"]');
  st.value = '6'; st.dispatchEvent(new window.Event('change', { bubbles: true }));
  await espera(10);
  document.getElementById('rnFechLinhas').value = '5';
  document.getElementById('rnFechBl').value = '1';
  document.querySelector('#rnFechamento [data-rn-fech-salvar]').click();
  await espera(20);
  eq(window.__escritas[0].patch, { status: 6, linhas_renovadas: 5, bl_vendida: 1, sol_digitais: null }, 'renovado grava linhas, BL e digitais');

  // erro do banco vira aviso
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__resp.renovacao_carteira = (q) => q.op === 'update' ? { data: null, error: { message: 'Perdido precisa do motivo' } } : { data: window.__tabelas.renovacao_carteira, error: null };
  const ok = await rnSalvar(1, { status: 7 });
  eq([ok, aviso], [false, ['Perdido precisa do motivo', 'erro']], 'mensagem da regra do banco aparece');
  window.__resp.renovacao_carteira = (q) => q.op === 'update' ? { data: null, error: { message: 'connection reset' } } : { data: window.__tabelas.renovacao_carteira, error: null };
  await rnSalvar(1, { canal: 'Visita' });
  eq(aviso, ['Não foi possível salvar agora. Tente de novo.', 'erro'], 'erro técnico vira mensagem simples');
  delete window.__resp.renovacao_carteira; mostrarAviso = avisoOrig;

  // ==== gestor: filtro de consultor, seleção e redistribuição ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = base();
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }, { id: 'u-b', nome: 'Zzb Teste', equipe: 'renovacao' }];
  await rnCarregar();
  assert(document.getElementById('rnFConsultor').style.display === '', 'gestor tem filtro de consultor');
  assert(/Zzb Teste/.test(document.querySelector('#rnTbody tr[data-rn-id="3"]').textContent), 'gestor vê a coluna Consultor');
  const sel = (id) => { const c = document.querySelector('#rnTbody [data-rn-sel="' + id + '"]'); c.checked = true; c.dispatchEvent(new window.Event('change', { bubbles: true })); };
  sel(4); sel(1);
  assert(document.getElementById('rnRedistribuir').style.display === '', 'barra de redistribuir aparece com seleção');
  document.getElementById('rnPassarPara').value = 'u-b';
  window.__escritas.length = 0;
  await rnRedistribuir();
  const w = window.__escritas[0];
  eq([w.patch, w.filtros[0][0], w.filtros[0][2].slice().sort()], [{ consultor_id: 'u-b' }, 'in', [1, 4]], 'passa os selecionados de uma vez');
  eq(rnEstado.lista.filter(r => r.consultor_id === 'u-b').map(r => r.id).sort(), [1, 3, 4], 'lista local atualizada');
  eq(rnEstado.selecionados.size, 0, 'seleção limpa');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_carteira.js`
Expected: `FALHA: ReferenceError: rnFiltrar is not defined`.

- [ ] **Step 3: Implementar**

Inserir antes de `/* ============ FIM RENOVAÇÃO §143 ============ */`:

```js
// ---- Carteira ----
function rnNorm(s){ return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function rnStatusRotulo(s){ return s + '-' + (RN_STATUS[s] || '?'); }
function rnFiltrar(lista, f, hoje){
  const busca = rnNorm(f.busca); const buscaDig = onlyDigits(f.busca);
  return lista.filter(r => {
    if(f.foraBase ? r.na_base : !r.na_base) return false;
    if(f.status && String(r.status) !== String(f.status)) return false;
    if(f.apto && r.apto !== f.apto) return false;
    if(f.cidade && r.cidade !== f.cidade) return false;
    if(f.consultor === '-' ? !!r.consultor_id : (f.consultor && r.consultor_id !== f.consultor)) return false;
    if(f.soVencido && !rnRetornoVencido(r, hoje)) return false;
    if(f.pendencias && !r.a_completar) return false;
    if(busca){
      const achou = (rnNorm(r.razao_social) + ' ' + rnNorm(r.nome_adm)).includes(busca)
        || (buscaDig.length >= 3 && String(r.cnpj_digits || '').includes(buscaDig));
      if(!achou) return false;
    }
    return true;
  }).sort((a, b) => (b.linhas_voz || 0) - (a.linhas_voz || 0) || String(a.razao_social || '').localeCompare(String(b.razao_social || ''), 'pt-BR'));
}
function rnContadores(lista, hoje){
  const ativos = lista.filter(r => r.na_base);
  const nao = ativos.filter(r => r.status === 1).length;
  return { total: ativos.length, pctNaoContatado: ativos.length ? Math.round(nao * 100 / ativos.length) : 0,
           vencidos: ativos.filter(r => rnRetornoVencido(r, hoje)).length, pendencias: ativos.filter(r => r.a_completar).length };
}
function rnClasseLinha(r){ return r.status === 7 ? 'rnPerdido' : r.status === 6 ? 'rnRenovado' : ''; }
function rnValidarFechamento(status, d){
  if(status === 7 && !RN_MOTIVOS.includes(d.motivo_perda)) return 'Escolha o motivo da perda.';
  if(status === 6 && !(Number(d.linhas_renovadas) >= 1)) return 'Informe quantas linhas foram renovadas.';
  return null;
}
function rnMensagemErro(err){
  const m = (err && err.message) || '';
  return /Perdido precisa|Renovado precisa|consultor só altera/.test(m) ? m : 'Não foi possível salvar agora. Tente de novo.';
}
async function rnSalvar(id, patch){
  const r = await ppSeguro(() => sb.from('renovacao_carteira').update(patch).eq('id', id).select(RN_COLS_LISTA).single());
  if(!r || r.error || !r.data){ mostrarAviso(rnMensagemErro(r && r.error), 'erro'); rnRender(); return false; }
  const i = rnEstado.lista.findIndex(x => x.id === id);
  if(i >= 0) rnEstado.lista[i] = r.data;
  rnAtualizarBadge();
  rnRender();
  if(rnEstado.fichaId === id && typeof rnRenderFicha === 'function') rnRenderFicha();
  return true;
}
function rnOpcoes(pares, atual, vazio){
  return (vazio ? `<option value="">${escapeHtml(vazio)}</option>` : '')
    + pares.map(([v, t]) => `<option value="${escapeHtml(v)}"${String(v) === String(atual ?? '') ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
}
function rnPreencherFiltros(){
  const f = rnEstado.filtros; const gestor = rnGestor();
  document.getElementById('rnFStatus').innerHTML = rnOpcoes(Object.keys(RN_STATUS).map(k => [k, rnStatusRotulo(+k)]), f.status, 'Status: todos');
  const cidades = [...new Set(rnEstado.lista.map(r => r.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  document.getElementById('rnFCidade').innerHTML = rnOpcoes(cidades.map(c => [c, c]), f.cidade, 'Cidade: todas');
  document.getElementById('rnFApto').value = f.apto;
  const fc = document.getElementById('rnFConsultor');
  fc.style.display = gestor ? '' : 'none';
  if(gestor){
    fc.innerHTML = rnOpcoes([['-', 'Sem consultor']].concat(rnEstado.perfis.map(p => [p.id, p.nome])), f.consultor, 'Consultor: todos');
    document.getElementById('rnPassarPara').innerHTML = rnOpcoes(rnEstado.perfis.map(p => [p.id, p.nome]), '', 'Passar para…');
  }
  document.querySelectorAll('[data-rn-filtro]').forEach(b => b.classList.toggle('active', !!f[b.dataset.rnFiltro]));
}
function rnLinhaHtml(r, hoje, gestor){
  return `<tr class="${rnClasseLinha(r)}" data-rn-id="${r.id}">
    ${gestor ? `<td><input type="checkbox" data-rn-sel="${r.id}" aria-label="Selecionar"${rnEstado.selecionados.has(r.id) ? ' checked' : ''}></td>` : ''}
    <td><button type="button" class="rnNome" data-rn-abrir="${r.id}">${escapeHtml(r.razao_social || '(sem nome)')}</button><div class="kbMeta">${escapeHtml(r.nome_adm || '')}${r.a_completar ? ' · <span class="badge naoapto">completar</span>' : ''}</div></td>
    ${gestor ? `<td>${escapeHtml(rnNomeConsultor(r.consultor_id))}</td>` : ''}
    <td>${r.linhas_voz ?? '—'}</td>
    <td>${escapeHtml(r.apto || '—')}</td>
    <td><select data-rn-campo="status" aria-label="Status">${rnOpcoes(Object.keys(RN_STATUS).map(k => [k, rnStatusRotulo(+k)]), r.status)}</select></td>
    <td><input type="date" data-rn-campo="prox_retorno" aria-label="Próximo retorno" value="${escapeHtml(r.prox_retorno || '')}" class="${rnRetornoVencido(r, hoje) ? 'rnVencido' : ''}"></td>
    <td><select data-rn-campo="canal" aria-label="Canal">${rnOpcoes(RN_CANAIS.map(c => [c, c]), r.canal, '—')}</select></td>
  </tr>`;
}
function rnRenderCarteira(){
  const hoje = rnHoje(); const gestor = rnGestor();
  rnPreencherFiltros();
  const c = rnContadores(rnEstado.lista, hoje);
  document.getElementById('rnContadores').innerHTML = `<span><b>${c.total}</b> clientes</span><span><b>${c.pctNaoContatado}%</b> não contatados</span>`
    + `<span class="${c.vencidos ? 'rnVencido' : ''}"><b>${c.vencidos}</b> retornos vencidos</span>${c.pendencias ? `<span><b>${c.pendencias}</b> pendências</span>` : ''}`;
  const lista = rnFiltrar(rnEstado.lista, rnEstado.filtros, hoje);
  const mostrar = lista.slice(0, rnEstado.pagina * RN_PAGINA);
  document.getElementById('rnThead').innerHTML = `<tr>${gestor ? '<th><input type="checkbox" id="rnSelTodos" aria-label="Selecionar todos"></th>' : ''}<th>Razão social / ADM</th>${gestor ? '<th>Consultor</th>' : ''}<th>Linhas</th><th>Apto</th><th>Status</th><th>Próx. retorno</th><th>Canal</th></tr>`;
  document.getElementById('rnTbody').innerHTML = mostrar.map(r => rnLinhaHtml(r, hoje, gestor)).join('')
    || `<tr><td colspan="${gestor ? 8 : 6}">Nenhum cliente com esses filtros.</td></tr>`;
  const mais = document.getElementById('rnMais');
  mais.style.display = lista.length > mostrar.length ? '' : 'none';
  mais.textContent = `Mostrar mais (${lista.length - mostrar.length})`;
  document.getElementById('rnRedistribuir').style.display = gestor && rnEstado.selecionados.size ? '' : 'none';
  document.getElementById('rnSelN').textContent = rnEstado.selecionados.size + ' selecionado(s)';
}
function rnAbrirFechamento(id, status){
  const r = rnEstado.lista.find(x => x.id === id);
  if(!r) return;
  let ov = document.getElementById('rnFechamento');
  if(!ov){ ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'rnFechamento'; document.body.appendChild(ov); }
  const renov = status === 6;
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="rnFechTitulo">
    <div class="mHead"><button type="button" class="mClose" data-rn-fech-cancelar aria-label="Fechar">&times;</button>
      <h2 id="rnFechTitulo">${renov ? '6-Renovado' : '7-Perdido'}</h2><div class="mCnpj">${escapeHtml(r.razao_social || '')}</div></div>
    <div class="mBody">
      ${renov
        ? `<label class="field">Linhas renovadas *<input type="number" min="1" id="rnFechLinhas" value="${r.linhas_renovadas ?? ''}"></label>
           <label class="field">BL vendida (qtd)<input type="number" min="0" id="rnFechBl" value="${r.bl_vendida ?? ''}"></label>
           <label class="field">Soluções digitais (R$)<input type="number" min="0" step="0.01" id="rnFechDig" value="${r.sol_digitais ?? ''}"></label>`
        : `<label class="field">Motivo da perda *<select id="rnFechMotivo">${rnOpcoes(RN_MOTIVOS.map(m => [m, m]), r.motivo_perda, 'Escolha…')}</select></label>
           <label class="field">Observação<textarea id="rnFechObs" rows="3">${escapeHtml(r.observacoes || '')}</textarea></label>`}
      <p class="kbMeta rnVencido" id="rnFechErro" role="alert"></p>
      <div style="display:flex;gap:var(--space-2);justify-content:flex-end"><button type="button" class="btn btn-outline btn-sm" data-rn-fech-cancelar>Cancelar</button><button type="button" class="btn btn-sm" data-rn-fech-salvar>Salvar</button></div>
    </div></div>`;
  ov.classList.add('active');
  ov.onclick = async (e) => {
    if(e.target.closest('[data-rn-fech-cancelar]')){ fecharOverlay(ov); rnRender(); return; }
    if(!e.target.closest('[data-rn-fech-salvar]')) return;
    const num = (idCampo) => { const v = document.getElementById(idCampo).value; return v === '' ? null : Number(v); };
    const patch = renov
      ? { status, linhas_renovadas: num('rnFechLinhas'), bl_vendida: num('rnFechBl'), sol_digitais: num('rnFechDig') }
      : { status, motivo_perda: document.getElementById('rnFechMotivo').value || null, observacoes: document.getElementById('rnFechObs').value.trim() || null };
    const erro = rnValidarFechamento(status, patch);
    if(erro){ document.getElementById('rnFechErro').textContent = erro; return; }
    if(await rnSalvar(id, patch)) fecharOverlay(ov);
  };
}
async function rnRedistribuir(){
  const para = document.getElementById('rnPassarPara').value;
  const ids = [...rnEstado.selecionados];
  if(!para || !ids.length){ mostrarAviso('Escolha os clientes e para quem passar.', 'info'); return; }
  const r = await ppSeguro(() => sb.from('renovacao_carteira').update({ consultor_id: para }).in('id', ids));
  if(!r || r.error){ mostrarAviso('Não foi possível redistribuir agora.', 'erro'); return; }
  rnEstado.lista.forEach(x => { if(rnEstado.selecionados.has(x.id)) x.consultor_id = para; });
  rnEstado.selecionados.clear();
  mostrarAviso(`${ids.length} cliente(s) passados para ${rnNomeConsultor(para)}.`, 'ok');
  rnRender();
}
document.getElementById('rnTbody').addEventListener('change', async (e) => {
  const tr = e.target.closest('tr[data-rn-id]');
  if(!tr) return;
  const id = Number(tr.dataset.rnId);
  if(e.target.matches('[data-rn-sel]')){
    if(e.target.checked) rnEstado.selecionados.add(id); else rnEstado.selecionados.delete(id);
    rnRenderCarteira();
    return;
  }
  const campo = e.target.dataset.rnCampo;
  if(!campo) return;
  let valor = e.target.value || null;
  if(campo === 'status'){
    valor = Number(valor);
    if(valor === 6 || valor === 7){ rnAbrirFechamento(id, valor); return; }
  }
  await rnSalvar(id, { [campo]: valor });
});
document.getElementById('rnTbody').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rn-abrir]');
  if(b && typeof rnAbrirFicha === 'function') rnAbrirFicha(Number(b.dataset.rnAbrir));
});
document.getElementById('rnThead').addEventListener('change', (e) => {
  if(e.target.id !== 'rnSelTodos') return;
  rnFiltrar(rnEstado.lista, rnEstado.filtros, rnHoje()).slice(0, rnEstado.pagina * RN_PAGINA)
    .forEach(r => { if(e.target.checked) rnEstado.selecionados.add(r.id); else rnEstado.selecionados.delete(r.id); });
  rnRenderCarteira();
});
document.getElementById('rnBusca').addEventListener('input', (e) => { rnEstado.filtros.busca = e.target.value; rnEstado.pagina = 1; rnRenderCarteira(); });
[['rnFStatus', 'status'], ['rnFApto', 'apto'], ['rnFCidade', 'cidade'], ['rnFConsultor', 'consultor']].forEach(([idEl, k]) =>
  document.getElementById(idEl).addEventListener('change', (e) => { rnEstado.filtros[k] = e.target.value; rnEstado.pagina = 1; rnRenderCarteira(); }));
document.querySelectorAll('[data-rn-filtro]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.rnFiltro; rnEstado.filtros[k] = !rnEstado.filtros[k]; rnEstado.pagina = 1; rnRenderCarteira();
}));
document.getElementById('rnMais').addEventListener('click', () => { rnEstado.pagina++; rnRenderCarteira(); });
document.getElementById('rnPassar').addEventListener('click', rnRedistribuir);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_renovacao_carteira.js && node test_renovacao_aba.js`
Expected: os dois com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_carteira.js _template.html
git commit -m "feat(renovacao): Carteira com filtros, cores, edição, fechamento e redistribuição (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ficha do cliente

**Files:**
- Create: `test_renovacao_ficha.js`
- Modify: `_template.html` (bloco `RENOVAÇÃO — §143`, antes do marcador final)

**Interfaces:**
- Consumes: `rnEstado`, `rnSalvar`, `rnValidarFechamento`, `rnStatusRotulo`, `rnOpcoes`, `rnNomeConsultor`, `RN_*`.
- Produces: `RN_GRUPOS_FICHA`, `rnGruposFicha(dados)` → `[[titulo, [[chave, valor]…]]…]` (último grupo é sempre `'Tudo'`, em ordem alfabética, porque o jsonb não guarda a ordem das colunas), `rnHistoricoTexto(h)`, `rnAbrirFicha(id)`, `rnFecharFicha()`, `rnRenderFicha()`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_ficha.js`:

```js
// Testa a §143.1 — ficha do cliente da Renovação: grupos da Claro, histórico, atendimento e legado a completar. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const dados = { 'Tempo de contrato (Voz)': 21, 'SCORE': 7, 'POSSUI MÓVEL TIM': 'SIM', 'CEP CABEADO?': 'NÃO', 'Coluna Rara': 'x', 'telefone_1': '' };
  const g = rnGruposFicha(dados);
  eq(g.map(x => x[0]), ['Contrato e linhas', 'Concorrência', 'Fixa e cabeamento', 'Tudo'], 'só grupos com dado, Tudo no fim');
  eq(g[0][1], [['Tempo de contrato (Voz)', 21], ['SCORE', 7]], 'itens do grupo na ordem do grupo');
  eq(g[3][1].map(x => x[0]), ['CEP CABEADO?', 'Coluna Rara', 'POSSUI MÓVEL TIM', 'SCORE', 'Tempo de contrato (Voz)'], 'Tudo: todas as colunas com valor, em ordem alfabética');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [
    { id: 1, cnpj_digits: '00000000000101', razao_social: 'Zz Alfa', telefone: '11900000001', cidade: 'Zz Cidade', linhas_voz: 4, status: 3, na_base: true, consultor_id: 'u-a', dados_claro: dados },
    { id: 2, cnpj_digits: '00000000000102', razao_social: 'Zz Legado', telefone: null, linhas_voz: 2, status: 7, motivo_perda: null, a_completar: true, na_base: true, consultor_id: 'u-a', dados_claro: {} },
  ];
  window.__tabelas.renovacao_historico = [
    { carteira_id: 1, campo: 'status', de: '1', para: '3', user_id: 'u-a', criado_em: '2026-11-05T15:00:00Z' },
  ];
  await rnCarregar();
  document.querySelector('#rnTbody [data-rn-abrir="1"]').click();
  await espera(40);
  const ficha = document.getElementById('rnFicha');
  assert(ficha.classList.contains('aberta'), 'clicar no nome abre a ficha');
  const corpo = document.getElementById('rnFichaCorpo');
  assert(/00\\.000\\.000\\/0001-01/.test(corpo.textContent), 'CNPJ formatado');
  assert(corpo.querySelector('a[href^="https://wa.me/5511900000001"]') && corpo.querySelector('a[href="tel:11900000001"]'), 'WhatsApp e Ligar');
  eq([...corpo.querySelectorAll('details.rnGrupo summary')].map(s => s.firstChild.textContent.trim()), ['Contrato e linhas', 'Concorrência', 'Fixa e cabeamento', 'Tudo'], 'grupos na ficha');
  assert(/05\\/11 · Zza Teste: 1-Não contatado → 3-Contato efetivo/.test(corpo.textContent), 'histórico legível');

  // salvar atendimento
  window.__escritas.length = 0;
  const form = document.getElementById('rnFichaForm');
  form.elements.prox_retorno.value = '2026-11-20';
  form.elements.observacoes.value = '  Zz ligar de manhã  ';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  const p = window.__escritas[0].patch;
  eq([p.status, p.prox_retorno, p.observacoes, p.canal], [3, '2026-11-20', 'Zz ligar de manhã', null], 'grava o atendimento');

  // perdido sem motivo na ficha é barrado...
  window.__escritas.length = 0;
  document.getElementById('rnFichaForm').elements.status.value = '7';
  document.getElementById('rnFichaForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq(document.getElementById('rnFichaErro').textContent, 'Escolha o motivo da perda.', 'ficha usa a mesma regra');
  eq(window.__escritas.length, 0, 'nada gravado');

  // ...mas o legado a completar salva só a observação sem mudar o status
  rnFecharFicha();
  assert(!ficha.classList.contains('aberta'), 'fechar a ficha');
  await rnAbrirFicha(2);
  const f2 = document.getElementById('rnFichaForm');
  assert(!document.querySelector('#rnFichaCorpo a[href^="https://wa.me"]') && /Sem telefone/.test(document.getElementById('rnFichaCorpo').textContent), 'sem telefone avisa');
  f2.elements.observacoes.value = 'Zz cliente fechou a empresa';
  f2.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await espera(20);
  eq(window.__escritas.length, 1, 'legado salva observação mesmo perdido sem motivo');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_ficha.js`
Expected: `FALHA: ReferenceError: rnGruposFicha is not defined`.

- [ ] **Step 3: Implementar**

Inserir antes de `/* ============ FIM RENOVAÇÃO §143 ============ */`:

```js
// ---- Ficha do cliente ----
const RN_GRUPOS_FICHA = [
  ['Contrato e linhas', ['Tempo de contrato (Voz)', 'Tempo de contrato (Banda Larga)', 'Tempo de contrato (Telemetria)', 'Quantidade de linhas (Voz)',
    'Quantidade de linhas (Banda Larga)', 'Quantidade de linhas (Telemetria)', 'Classificação', 'Desconto Claro', 'APTO RENOVAÇÃO', 'TEMPO APTO RENOVAÇÃO',
    'Cluster Apto Renovação', 'CLUSTER LINHAS VOZ', 'CLUSTER TMC VOZ', 'VL_CONTR_NO_MSISDN_C_DESC_RET', 'VALOR POR LINHA / ARPU', 'QT LINHAS SILENTES',
    'Ultima cotação', 'DATA ULTIMA COTAÇÃO', 'RENOVAÇÃO ANTECIPADA', 'SCORE', 'QT LINHAS CHURN VOL.', 'DATA CHURN VOLUNTARIO']],
  ['Empresa (Receita)', ['Razão Social', 'CNPJ2', 'Segmento', 'NUMERO B2B CNAE', 'CNAE B2B', 'dataAbertura', 'situacaoCadastral', 'naturezaJuridica',
    'matrizFilial', 'capitalSocial', 'porte', 'PORTE2', 'opcaoSimples', 'opcaoMei', 'socios', 'faixa_faturamento', 'quantidade_funcionarios']],
  ['Contatos', ['Telefone de Contato', 'Nome do ADM', 'telefone_1', 'telefone_2', 'email', 'outrosTelefones', 'outrosEmails', 'Endereco', 'endereco2',
    'bairro', 'municipio', 'CIDADE', 'UF', 'cep', 'DDD']],
  ['Concorrência', ['POSSUI FIXA OI', 'POSSUI FIXA TIM', 'POSSUI FIXA VIVO', 'POSSUI MÓVEL OI', 'POSSUI MÓVEL TIM', 'POSSUI MÓVEL VIVO', 'FOI OU É CLIENTE FIXA?']],
  ['Fixa e cabeamento', ['CEP CABEADO?', 'PRE_APROVADO_FIXA', 'ÁREA CABEADA ARCGIS', 'COBERTURA 5G', 'INSTALAÇÃO CPF', 'HP CABEADO',
    'DSC_SITUACAO_COMERCIAL_PTV', 'DSC_SITUACAO_COMERCIAL_VIRTUA', 'DSC_SITUACAO_COMERCIAL', 'DSC_TIPO_REDE_FISICA_HP', 'CEP_LOGRADOURO', 'QTD_HP',
    'HP_CONECTADO', 'HP LIVRE']],
];
function rnGruposFicha(dados){
  const d = dados || {};
  const tem = (k) => d[k] !== undefined && d[k] !== null && d[k] !== '';
  const grupos = RN_GRUPOS_FICHA.map(([t, chaves]) => [t, chaves.filter(tem).map(k => [k, d[k]])]).filter(([, itens]) => itens.length);
  grupos.push(['Tudo', Object.keys(d).filter(tem).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(k => [k, d[k]])]);
  return grupos;
}
function rnHistoricoTexto(h){
  const quando = h.criado_em ? new Date(h.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) : '';
  const quem = h.user_id ? rnNomeConsultor(h.user_id) : 'Sistema';
  if(h.campo === 'status') return `${quando} · ${quem}: ${rnStatusRotulo(Number(h.de))} → ${rnStatusRotulo(Number(h.para))}`;
  return `${quando} · ${quem}: passou de ${rnNomeConsultor(h.de)} para ${rnNomeConsultor(h.para)}`;
}
async function rnAbrirFicha(id){
  rnEstado.fichaId = id; rnEstado.ficha = { dados: null, historico: null };
  document.getElementById('rnFicha').classList.add('aberta');
  rnRenderFicha();
  const [d, h] = await Promise.all([
    ppSeguro(() => sb.from('renovacao_carteira').select('dados_claro').eq('id', id).single()),
    ppSeguro(() => sb.from('renovacao_historico').select('campo,de,para,user_id,criado_em').eq('carteira_id', id).order('criado_em', { ascending: false })),
  ]);
  if(rnEstado.fichaId !== id) return;
  rnEstado.ficha = { dados: d && !d.error && d.data ? (d.data.dados_claro || {}) : {}, historico: h && !h.error ? (h.data || []) : [] };
  rnRenderFicha();
}
function rnFecharFicha(){ rnEstado.fichaId = null; rnEstado.ficha = null; document.getElementById('rnFicha').classList.remove('aberta'); }
function rnRenderFicha(){
  const el = document.getElementById('rnFichaCorpo');
  const r = rnEstado.lista.find(x => x.id === rnEstado.fichaId);
  if(!r){ el.innerHTML = ''; return; }
  const tel = onlyDigits(r.telefone);
  const cnpj = String(r.cnpj_digits || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const fic = rnEstado.ficha || {};
  const campo = (rotulo, html) => `<label class="field">${rotulo}${html}</label>`;
  el.innerHTML = `
    <div class="kbFichaTopo" style="display:flex;justify-content:space-between;gap:var(--space-2)">
      <div><h3>${escapeHtml(r.razao_social || '(sem nome)')}</h3><div class="kbMeta">${escapeHtml(cnpj)}${r.cidade ? ' · ' + escapeHtml(r.cidade) : ''} · ${r.linhas_voz ?? 0} linhas</div></div>
      <button type="button" class="kbBtn kbBtnG" data-rn-ficha-fechar aria-label="Fechar">&times;</button>
    </div>
    <div style="display:flex;gap:var(--space-2);margin:var(--space-2) 0">${tel
      ? `<a class="kbBtn kbBtnQ" target="_blank" rel="noopener" href="https://wa.me/55${escapeHtml(tel.replace(/^55/, ''))}">WhatsApp</a><a class="kbBtn kbBtnP" href="tel:${escapeHtml(tel)}">Ligar</a>`
      : '<span class="kbMeta">Sem telefone.</span>'}</div>
    <form id="rnFichaForm" class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-2)">
      ${campo('Status', `<select name="status">${rnOpcoes(Object.keys(RN_STATUS).map(k => [k, rnStatusRotulo(+k)]), r.status)}</select>`)}
      ${campo('Data do contato', `<input type="date" name="data_contato" value="${escapeHtml(r.data_contato || '')}">`)}
      ${campo('Próx. retorno', `<input type="date" name="prox_retorno" value="${escapeHtml(r.prox_retorno || '')}">`)}
      ${campo('Canal', `<select name="canal">${rnOpcoes(RN_CANAIS.map(c => [c, c]), r.canal, '—')}</select>`)}
      ${campo('Linhas renovadas', `<input type="number" min="0" name="linhas_renovadas" value="${r.linhas_renovadas ?? ''}">`)}
      ${campo('BL vendida (qtd)', `<input type="number" min="0" name="bl_vendida" value="${r.bl_vendida ?? ''}">`)}
      ${campo('Sol. digitais (R$)', `<input type="number" min="0" step="0.01" name="sol_digitais" value="${r.sol_digitais ?? ''}">`)}
      ${campo('Motivo da perda', `<select name="motivo_perda">${rnOpcoes(RN_MOTIVOS.map(m => [m, m]), r.motivo_perda, '—')}</select>`)}
      <label class="field" style="grid-column:1/-1">Observações<textarea name="observacoes" rows="3">${escapeHtml(r.observacoes || '')}</textarea></label>
      <p class="kbMeta rnVencido" id="rnFichaErro" role="alert" style="grid-column:1/-1"></p>
      <div style="grid-column:1/-1"><button type="submit" class="btn btn-sm">Salvar atendimento</button></div>
    </form>
    ${fic.dados
      ? rnGruposFicha(fic.dados).map(([t, itens]) => `<details class="rnGrupo"><summary>${escapeHtml(t)} <span class="kbMeta">${itens.length}</span></summary><dl>${itens.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl></details>`).join('')
      : '<p class="kbMeta">Carregando dados da Claro…</p>'}
    <h4>Histórico</h4>
    ${fic.historico
      ? (fic.historico.length ? '<ul class="rnHist">' + fic.historico.map(h => `<li>${escapeHtml(rnHistoricoTexto(h))}</li>`).join('') + '</ul>' : '<p class="kbMeta">Sem mudanças registradas.</p>')
      : '<p class="kbMeta">Carregando…</p>'}`;
}
document.getElementById('rnFicha').addEventListener('click', (e) => { if(e.target.closest('[data-rn-ficha-fechar]')) rnFecharFicha(); });
document.getElementById('rnFicha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = rnEstado.lista.find(x => x.id === rnEstado.fichaId);
  if(!r) return;
  const els = e.target.elements;
  const v = (k) => (els[k].value === '' ? null : els[k].value);
  const num = (k) => (v(k) === null ? null : Number(v(k)));
  const patch = { status: Number(v('status')), data_contato: v('data_contato'), prox_retorno: v('prox_retorno'), canal: v('canal'),
    linhas_renovadas: num('linhas_renovadas'), bl_vendida: num('bl_vendida'), sol_digitais: num('sol_digitais'),
    motivo_perda: v('motivo_perda'), observacoes: (v('observacoes') || '').trim() || null };
  // legado da planilha (a_completar): mesma regra do banco — só cobra quando o status muda
  const erro = r.a_completar && patch.status === r.status ? null : rnValidarFechamento(patch.status, patch);
  if(erro){ document.getElementById('rnFichaErro').textContent = erro; return; }
  if(await rnSalvar(r.id, patch)) mostrarAviso('Atendimento salvo.', 'ok');
});
```

E no CSS da Task 3 (logo depois de `.rnNome:hover{…}`), acrescentar:

```css
  .rnGrupo{border-top:1px solid var(--c-linha);padding:var(--space-2) 0;}
  .rnGrupo summary{cursor:pointer;font-weight:600;}
  .rnGrupo dl{display:grid;grid-template-columns:minmax(140px,40%) 1fr;gap:2px var(--space-2);margin:var(--space-2) 0 0;}
  .rnGrupo dt{color:var(--muted);}
  .rnGrupo dd{margin:0;overflow-wrap:anywhere;}
  .rnHist{margin:0;padding-left:1.1em;color:var(--muted);}
```

(`--c-linha` é a variável de borda do Sinal de Ápice, conferida em 07/11.)

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do node $t | tail -1; done`
Expected: todos com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_ficha.js _template.html
git commit -m "feat(renovacao): ficha do cliente com dados da Claro, histórico e atendimento (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Retornos e Resumo

**Files:**
- Create: `test_renovacao_resumo.js`
- Modify: `_template.html` (bloco `RENOVAÇÃO — §143`, antes do marcador final)

**Interfaces:**
- Consumes: `rnEstado`, `rnHoje`, `rnStatusRotulo`, `rnNomeConsultor`, `rnGestor`, `rnAbrirFicha`.
- Produces: `rnSomarDias(iso, n)`, `rnRetornos(lista, hoje)` → `{vencidos, hoje, proximos}`, `rnRenderRetornos()`, `rnLinhasResumo(rows)` → `{corpo:[linha], total: linha}` com `linha = {nome, carteira, contatados, cobertura, efetivo, propostas, renovados, perdidos, conversao, linhas, bl, digitais, atrasados}` (porcentagens com 1 casa), `rnRenderResumo()`. O Resumo chama `rnImportarHtml()` (Task 7) com `typeof`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_resumo.js`:

```js
// Testa a §143.1 — Retornos e Resumo da Renovação (fórmulas iguais às da planilha). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  eq(rnSomarDias('2026-11-28', 7), '2026-12-05', 'soma dias virando o mês');
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, status: 2, na_base: true, consultor_id: 'u-a' }, o);
  const lista = [
    L({ id: 1, prox_retorno: '2026-11-01' }), L({ id: 2, prox_retorno: '2026-11-07' }), L({ id: 3, prox_retorno: '2026-11-14' }),
    L({ id: 4, prox_retorno: '2026-11-15' }), L({ id: 5, prox_retorno: '2026-11-01', status: 6 }), L({ id: 6, prox_retorno: '2026-11-02', na_base: false }),
    L({ id: 7, prox_retorno: '2026-10-30', linhas_voz: 5 }),
  ];
  const g = rnRetornos(lista, '2026-11-07');
  eq([g.vencidos.map(r => r.id), g.hoje.map(r => r.id), g.proximos.map(r => r.id)], [[7, 1], [2], [3]], 'vencidos (mais antigo primeiro), hoje, próximos 7 dias');

  // mesmos números do Resumo da planilha em 07/11 (Bruno/Fabiana/Silvana)
  const rows = [
    { consultor_id: 'u-b', consultor_nome: 'Zzbruno', carteira: 414, contatados: 32, efetivo_mais: 16, propostas_mais: 4, renovados: 2, perdidos: 11, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 2, a_completar: 0 },
    { consultor_id: 'u-f', consultor_nome: 'Zzfabiana', carteira: 414, contatados: 84, efetivo_mais: 20, propostas_mais: 11, renovados: 4, perdidos: 24, linhas_renovadas: 19, bl_vendida: 1, sol_digitais: 0, retornos_atrasados: 22, a_completar: 0 },
    { consultor_id: 'u-s', consultor_nome: 'Zzsilvana', carteira: 414, contatados: 165, efetivo_mais: 17, propostas_mais: 8, renovados: 2, perdidos: 17, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: '0.00', retornos_atrasados: 0, a_completar: 0 },
  ];
  const r = rnLinhasResumo(rows);
  eq(r.corpo.map(l => [l.nome, l.cobertura, l.conversao]), [['Zzbruno', 7.7, 12.5], ['Zzfabiana', 20.3, 20], ['Zzsilvana', 39.9, 11.8]], '% cobertura e % conversão por consultor');
  eq([r.total.carteira, r.total.contatados, r.total.cobertura, r.total.efetivo, r.total.propostas, r.total.renovados, r.total.perdidos, r.total.conversao, r.total.linhas, r.total.bl, r.total.atrasados],
     [1242, 281, 22.6, 53, 23, 8, 52, 15.1, 19, 1, 24], 'linha TOTAL igual à da planilha');
  eq(rnLinhasResumo([{ consultor_id: null, carteira: 3, contatados: 0, efetivo_mais: 0, propostas_mais: 0, renovados: 0, perdidos: 0, linhas_renovadas: 0, bl_vendida: 0, sol_digitais: 0, retornos_atrasados: 0 }]).corpo[0].nome, 'Sem consultor', 'carteira sem dono aparece');

  // telas
  rnHoje = () => '2026-11-07';   // a tela usa o "hoje" de SP; o teste fixa a data
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'supervisor', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista;
  window.__tabelas.profiles = [{ id: 'u-a', nome: 'Zza Teste', equipe: 'renovacao' }];
  window.__tabelas.renovacao_resumo = rows;
  await rnCarregar();
  rnTrocarAba('retornos');
  await espera(20);
  const blocos = [...document.querySelectorAll('#rnRetornos .rnRetBloco h3')].map(h => h.textContent.replace(/\\s+/g, ' ').trim());
  eq(blocos, ['Vencidos 2', 'Hoje 1', 'Próximos 7 dias 1'], 'blocos de retorno com contagem');
  assert(/Zza Teste/.test(document.getElementById('rnRetornos').textContent), 'gestor vê de quem é o retorno');
  rnTrocarAba('resumo');
  await espera(30);
  const trs = [...document.querySelectorAll('#rnResumo tbody tr')].map(t => [...t.children].map(td => td.textContent));
  eq(trs.length, 4, '3 consultores + TOTAL');
  eq(trs[3].slice(0, 9), ['TOTAL', '1242', '281', '22,6%', '53', '23', '8', '52', '15,1%'], 'TOTAL formatado como na planilha');
  assert(!document.getElementById('rnArquivo'), 'supervisor não importa');
  window.__resp.renovacao_resumo = () => ({ data: null, error: { message: 'x' } });
  await rnRenderResumo();
  assert(/Não foi possível carregar o resumo/.test(document.getElementById('rnResumo').textContent), 'erro do resumo avisa');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_resumo.js`
Expected: `FALHA: ReferenceError: rnSomarDias is not defined`.

- [ ] **Step 3: Implementar**

Inserir antes de `/* ============ FIM RENOVAÇÃO §143 ============ */`:

```js
// ---- Retornos ----
function rnSomarDias(iso, n){ const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function rnRetornos(lista, hoje){
  const abertos = lista.filter(r => r.na_base && r.prox_retorno && r.status !== 6 && r.status !== 7);
  const limite = rnSomarDias(hoje, 7);
  const ord = (a, b) => a.prox_retorno.localeCompare(b.prox_retorno) || (b.linhas_voz || 0) - (a.linhas_voz || 0);
  return {
    vencidos: abertos.filter(r => r.prox_retorno < hoje).sort(ord),
    hoje: abertos.filter(r => r.prox_retorno === hoje).sort(ord),
    proximos: abertos.filter(r => r.prox_retorno > hoje && r.prox_retorno <= limite).sort(ord),
  };
}
function rnRenderRetornos(){
  const g = rnRetornos(rnEstado.lista, rnHoje());
  const dm = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  const bloco = (titulo, itens, cls) => `<div class="card rnRetBloco"><h3 class="${cls || ''}">${titulo} <span class="kbN">${itens.length}</span></h3>${itens.length
    ? '<ul class="rnRetLista">' + itens.map(r => `<li><button type="button" class="rnNome" data-rn-abrir="${r.id}">${escapeHtml(r.razao_social || '(sem nome)')}</button> <span class="kbMeta">${dm(r.prox_retorno)} · ${escapeHtml(rnStatusRotulo(r.status))}${rnGestor() ? ' · ' + escapeHtml(rnNomeConsultor(r.consultor_id)) : ''}</span></li>`).join('') + '</ul>'
    : '<p class="kbMeta">Nada aqui.</p>'}</div>`;
  document.getElementById('rnRetornos').innerHTML = bloco('Vencidos', g.vencidos, 'rnVencido') + bloco('Hoje', g.hoje) + bloco('Próximos 7 dias', g.proximos);
}
document.getElementById('rnRetornos').addEventListener('click', (e) => { const b = e.target.closest('[data-rn-abrir]'); if(b) rnAbrirFicha(Number(b.dataset.rnAbrir)); });

// ---- Resumo (fórmulas da planilha; a contagem vem da view renovacao_resumo) ----
function rnLinhasResumo(rows){
  const pct = (a, b) => (b ? Math.round(a * 1000 / b) / 10 : 0);
  const linha = (r, nome) => ({ nome, carteira: +r.carteira || 0, contatados: +r.contatados || 0, cobertura: pct(+r.contatados || 0, +r.carteira || 0),
    efetivo: +r.efetivo_mais || 0, propostas: +r.propostas_mais || 0, renovados: +r.renovados || 0, perdidos: +r.perdidos || 0,
    conversao: pct(+r.renovados || 0, +r.efetivo_mais || 0), linhas: +r.linhas_renovadas || 0, bl: +r.bl_vendida || 0,
    digitais: Number(r.sol_digitais || 0), atrasados: +r.retornos_atrasados || 0 });
  const corpo = rows.map(r => linha(r, r.consultor_id ? (r.consultor_nome || '—') : 'Sem consultor')).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  const tot = {};
  ['carteira', 'contatados', 'efetivo_mais', 'propostas_mais', 'renovados', 'perdidos', 'linhas_renovadas', 'bl_vendida', 'sol_digitais', 'retornos_atrasados']
    .forEach(k => { tot[k] = rows.reduce((s, r) => s + Number(r[k] || 0), 0); });
  return { corpo, total: linha(tot, 'TOTAL') };
}
async function rnRenderResumo(){
  const el = document.getElementById('rnResumo');
  const r = await ppSeguro(() => sb.from('renovacao_resumo').select('*'));
  if(rnEstado.aba !== 'resumo') return;
  if(!r || r.error){ el.innerHTML = '<p class="kbMeta">Não foi possível carregar o resumo agora.</p>'; return; }
  const { corpo, total } = rnLinhasResumo(r.data || []);
  const fp = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const fr = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tr = (l, cls) => `<tr class="${cls || ''}"><td>${escapeHtml(l.nome)}</td><td>${l.carteira}</td><td>${l.contatados}</td><td>${fp(l.cobertura)}</td><td>${l.efetivo}</td><td>${l.propostas}</td><td>${l.renovados}</td><td>${l.perdidos}</td><td>${fp(l.conversao)}</td><td>${l.linhas}</td><td>${l.bl}</td><td>${fr(l.digitais)}</td><td class="${l.atrasados ? 'rnVencido' : ''}">${l.atrasados}</td></tr>`;
  el.innerHTML = `<div class="card" style="overflow-x:auto"><table class="tbl"><thead><tr><th>Consultor</th><th>Carteira</th><th>Contatados</th><th>% Cobertura</th><th>Contato efetivo+</th><th>Propostas+</th><th>Renovados</th><th>Perdidos</th><th>% Conversão</th><th>Linhas renov.</th><th>BL vendidas</th><th>Sol. dig. (R$)</th><th>Retornos atrasados</th></tr></thead><tbody>`
    + corpo.map(l => tr(l)).join('') + (corpo.length > 1 ? tr(total, 'rnTotal') : '') + '</tbody></table></div>'
    + (currentUser && currentUser.role === 'admin' && typeof rnImportarHtml === 'function' ? rnImportarHtml() : '');
}
```

CSS (depois das regras da Task 5): `.rnTotal td{font-weight:700;}` e `.rnRetBloco{margin-bottom:var(--space-3);}`.

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do node $t | tail -1; done`
Expected: todos com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_resumo.js _template.html
git commit -m "feat(renovacao): Retornos e Resumo com as fórmulas da planilha (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Importar base (e migrar a planilha do time)

**Files:**
- Create: `test_renovacao_importar.js`
- Modify: `_template.html` (bloco `RENOVAÇÃO — §143`, antes do marcador final)

**Interfaces:**
- Consumes: `rnNorm`, `onlyDigits`, `RN_CANAIS`, `RN_MOTIVOS`, `rnEstado`, `rnCarregar`, `fetchAllRows`, RPCs `renovacao_importar(p_linhas)` e `renovacao_marcar_fora(p_cnpjs)` (Task 2).
- Produces: `rnChave(s)`, `rnLeitor(row)`, `rnTexto(v)`, `rnInt(v)`, `rnNumBR(v)`, `rnDataPlanilha(v)`, `rnValorCelula(v)`, `rnStatusPlanilha(v)`, `rnLerArquivo(wb, perfis)` → `{formato: 'base'|'planilha'|null, linhas: [item da RPC], erros: [string], abas: [string]}`, `rnPrevia(linhas, existentes)` → `{novos, atualizados, sairam, completar}`, `rnImportarHtml()`, `rnPrepararImportacao(arquivo)`, `rnExecutarImportacao()`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_importar.js`:

```js
// Testa a §143.1 — importação da carteira: base da Claro e planilha do time (migração). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  // ==== conversões ====
  eq([rnDataPlanilha('29/09/26'), rnDataPlanilha('1/10/2026'), rnDataPlanilha('2026-11-03 00:00:00'), rnDataPlanilha(new Date(2026, 9, 26)), rnDataPlanilha('ontem')],
     ['2026-09-29', '2026-10-01', '2026-11-03', '2026-10-26', null], 'datas da planilha');
  eq([rnNumBR('1.234,56'), rnNumBR('0,00'), rnNumBR(12.5), rnNumBR(''), rnNumBR('R$ 10')], [1234.56, 0, 12.5, null, 10], 'números BR');
  eq([rnInt(21), rnInt('15'), rnInt(''), rnInt(21.6)], [21, 15, null, 22], 'inteiros (número cru não perde a casa)');
  eq([rnStatusPlanilha('3-Contato efetivo'), rnStatusPlanilha('9-x'), rnStatusPlanilha('')], [3, 1, 1], 'status da planilha');
  eq(rnChave('MOTIVO PERDA ▼'), rnChave('motivo  perda'), 'cabeçalho com ▼ e espaços');

  // ==== monta um .xlsx fictício igual ao da planilha do time ====
  const X = window.XLSX;
  const base = [
    ['CONSULTOR', 'ORIGEM', 'CNPJ', 'Razão Social', 'Telefone de Contato', 'Nome do ADM', 'Quantidade de linhas (Voz)', 'APTO RENOVAÇÃO', 'CIDADE', 'DDD', 'Tempo de contrato (Voz)', 'Classificação', 'Desconto Claro', 'STATUS', 'SCORE'],
    ['Zzbruno', 'Nova atribuição', 1234567000189, 'Zz Um Ltda', 11900000001, 'Zz Adm Um', 12, 'APTO', 'Zz Cidade', 11, 21, 'CE', 'Nulo', 'ATIVO', 7],
    ['Zzbruno', 'Nova atribuição', '00.000.000/0001-02', 'Zz Dois Ltda', '', 'Zz Adm Dois', 3, '1 MÊS PARA APTO', 'Zz Cidade', 11, 20, 'CE', 'Nulo', 'ATIVO', ''],
    ['Zzbruno', 'Já atribuído (mailing anterior)', '00000000000103', 'Zz Três', '', '', 1, 'APTO', 'Zz Outra', 12, 22, 'CG', 'Nulo', 'ATIVO', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const time = [
    ['Razão Social', 'Telefone', 'STATUS ▼', 'DATA CONTATO', 'PRÓX. RETORNO', 'CANAL ▼', 'LINHAS RENOV.', 'BL VENDIDA (qtd)', 'SOL. DIGITAIS (R$)', 'MOTIVO PERDA ▼', 'OBSERVAÇÕES', 'CONSULTOR', 'CNPJ'],
    ['Zz Um Ltda', '', '3-Contato efetivo', __dataNode(2026, 8, 29), '26/10/26', 'WhatsApp', '', '', '', '', 'Zz retornar', 'Zzbruno', 1234567000189],
    ['Zz Dois Ltda', '', '7-Perdido', '01/10/2026', '', 'Fax', '', '', '', '', '', 'Zzbruno', '00000000000102'],
    ['Zz Três', '', '6-Renovado', '', '', 'Ligação', 15, 1, '0,00', '', '', 'Zzbruno', '00000000000103'],
  ];
  const resumo = [['RESUMO DA REDISTRIBUIÇÃO DA CARTEIRA'], ['Consultor', 'Qtd. Clientes']];
  const montar = (abas) => {
    const wb = X.utils.book_new();
    abas.forEach(([nome, aoa]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa, { cellDates: true }), nome));
    return X.read(X.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellDates: true });
  };
  const PERFIS = [{ id: 'u-b', nome: 'Zzbruno Teste', equipe: 'renovacao' }, { id: 'u-x', nome: 'Zzoutro Teste', equipe: 'renovacao' }];

  let lido = rnLerArquivo(montar([['Resumo', resumo], ['Base Completa', base], ['Zzbruno', time]]), PERFIS);
  eq(lido.erros, [], 'sem erros');
  eq([lido.formato, lido.abas], ['planilha', ['Zzbruno']], 'reconhece a planilha do time');
  eq(lido.linhas.map(l => l.cnpj_digits), ['01234567000189', '00000000000102', '00000000000103'], 'CNPJ numérico ganha o zero da frente; formatado vira dígitos; linha vazia ignorada');
  const um = lido.linhas[0];
  eq([um.razao_social, um.telefone, um.nome_adm, um.linhas_voz, um.apto, um.cidade, um.ddd, um.tempo_contrato_voz, um.classificacao, um.origem, um.consultor_id],
     ['Zz Um Ltda', '11900000001', 'Zz Adm Um', 12, 'APTO', 'Zz Cidade', '11', 21, 'CE', 'Nova atribuição', 'u-b'], 'colunas da Claro e consultor pelo nome da aba');
  eq([um.status, um.data_contato, um.prox_retorno, um.canal, um.observacoes], [3, '2026-09-29', '2026-10-26', 'WhatsApp', 'Zz retornar'], 'atendimento da aba do consultor');
  eq(um.dados_claro.SCORE, 7, 'dados_claro guarda as colunas da base');
  assert(!('Telefone de Contato' in lido.linhas[1].dados_claro), 'dados_claro não guarda célula vazia');
  eq([lido.linhas[1].status, lido.linhas[1].canal, lido.linhas[1].motivo_perda], [7, null, null], 'canal fora da lista vira vazio; perdido sem motivo segue para pendência');
  eq([lido.linhas[2].status, lido.linhas[2].linhas_renovadas, lido.linhas[2].bl_vendida, lido.linhas[2].sol_digitais], [6, 15, 1, 0], 'renovado com linhas, BL e digitais');

  // base da Claro sem as abas do time
  lido = rnLerArquivo(montar([['Plan1', base.map(r => r.slice(1))]]), PERFIS);
  eq([lido.formato, lido.erros, lido.linhas[0].consultor_id, lido.linhas[0].status], ['base', [], null, undefined], 'base pura: sem consultor e sem atendimento');

  // erros que bloqueiam
  lido = rnLerArquivo(montar([['Base Completa', base], ['Zzfabi', time.map((r, i) => i ? r.slice(0, 11).concat(['Zzfabi', r[12]]) : r)]]), PERFIS);
  assert(lido.erros.some(e => /"Zzfabi" não tem login no time de renovação/.test(e)), 'consultor sem login bloqueia');
  lido = rnLerArquivo(montar([['Qualquer', [['A', 'B'], [1, 2]]]]), PERFIS);
  eq(lido.erros, ['Não achei a base: falta uma aba com as colunas CNPJ e Razão Social.'], 'arquivo sem base');

  // prévia
  const linhas = rnLerArquivo(montar([['Base Completa', base], ['Zzbruno', time]]), PERFIS).linhas;
  eq(rnPrevia(linhas, [{ cnpj_digits: '00000000000103', na_base: true }, { cnpj_digits: '00000000000999', na_base: true }, { cnpj_digits: '00000000000998', na_base: false }]),
     { novos: 2, atualizados: 1, sairam: 1, completar: 1 }, 'prévia: novos, já existem, saem, pendências');

  // ==== tela: admin escolhe o arquivo, vê a prévia e importa em lotes ====
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 9, cnpj_digits: '00000000000103', na_base: true, status: 6, linhas_renovadas: 15 }];
  window.__tabelas.profiles = PERFIS;
  window.__tabelas.renovacao_resumo = [];
  await rnCarregar();
  rnTrocarAba('resumo');
  await espera(30);
  assert(!!document.getElementById('rnArquivo'), 'admin vê Importar base');
  const buf = X.write((() => { const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(base), 'Base Completa'); X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(time), 'Zzbruno'); return wb; })(), { type: 'array', bookType: 'xlsx' });
  await rnPrepararImportacao({ arrayBuffer: async () => buf });
  const prev = document.getElementById('rnPrevia').textContent.replace(/\\s+/g, ' ');
  assert(/3 CNPJs/.test(prev) && /2 novos/.test(prev) && /1 já existem/.test(prev), 'prévia na tela: ' + prev);
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.renovacao_importar = (a) => ({ data: { novos: a.p_linhas.length, atualizados: 0 }, error: null });
  window.__rpcRespostas.renovacao_marcar_fora = { data: 0, error: null };
  document.querySelector('#rnPrevia [data-rn-importar]').click();
  await espera(60);
  eq(window.__rpcCalls.map(c => c.nome), ['renovacao_importar', 'renovacao_marcar_fora'], 'importa e depois marca quem saiu');
  eq(window.__rpcCalls[1].args.p_cnpjs.length, 3, 'marcar_fora recebe todos os CNPJs do arquivo');
  eq(rnEstado.importacao, null, 'importação limpa depois de terminar');

  // falha no meio: para, avisa e não marca ninguém fora
  await rnPrepararImportacao({ arrayBuffer: async () => buf });
  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.renovacao_importar = { data: null, error: { message: 'timeout' } };
  document.querySelector('#rnPrevia [data-rn-importar]').click();
  await espera(40);
  eq(window.__rpcCalls.map(c => c.nome), ['renovacao_importar'], 'falha não chama marcar_fora');
  assert(aviso && aviso[1] === 'erro' && /importe o mesmo arquivo de novo/.test(aviso[0]), 'aviso explica como terminar');
  mostrarAviso = avisoOrig;
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_importar.js`
Expected: `FALHA: ReferenceError: rnDataPlanilha is not defined`.

- [ ] **Step 3: Implementar**

Inserir antes de `/* ============ FIM RENOVAÇÃO §143 ============ */`:

```js
// ---- Importar base (admin). Os dados vão do navegador direto ao Supabase: nada passa pelo repositório. ----
function rnChave(s){ return rnNorm(String(s ?? '').replace(/▼/g, '')).replace(/\s+/g, ' ').trim(); }
function rnLeitor(row){ const m = {}; Object.keys(row).forEach(k => { m[rnChave(k)] = row[k]; }); return (nome) => m[rnChave(nome)]; }
function rnEhData(v){ return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v); }
function rnIsoLocal(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function rnTexto(v){ if(v === null || v === undefined) return null; if(rnEhData(v)) return rnIsoLocal(v); const s = String(v).trim(); return s || null; }
function rnInt(v){ if(typeof v === 'number') return Math.round(v); const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; }
function rnNumBR(v){
  if(typeof v === 'number') return v;
  const s = String(v ?? '').replace(/R\$|\s/g, '');
  if(!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}
function rnDataPlanilha(v){
  if(rnEhData(v)) return rnIsoLocal(v);
  const s = String(v ?? '').trim(); let m;
  if((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function rnValorCelula(v){
  if(v === null || v === undefined) return null;
  if(rnEhData(v)) return rnIsoLocal(v);
  if(typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).trim();
  return s || null;
}
function rnStatusPlanilha(v){ const n = parseInt(String(v ?? '').trim(), 10); return n >= 1 && n <= 7 ? n : 1; }
function rnCnpjPlanilha(v){ const d = onlyDigits(v); return d ? d.padStart(14, '0') : ''; }
function rnLerArquivo(wb, perfis){
  const json = (nome) => XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '', raw: true });
  const cabecalho = (nome) => ((XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: '' })[0]) || []).map(rnChave);
  const tem = (nome, cab) => cabecalho(nome).includes(rnChave(cab));
  const nomeBase = wb.SheetNames.find(n => rnChave(n) === 'base completa') || wb.SheetNames.find(n => tem(n, 'CNPJ') && tem(n, 'Razão Social'));
  if(!nomeBase) return { formato: null, linhas: [], erros: ['Não achei a base: falta uma aba com as colunas CNPJ e Razão Social.'], abas: [] };
  const abasTime = wb.SheetNames.filter(n => n !== nomeBase && tem(n, 'STATUS') && tem(n, 'CNPJ'));
  const erros = []; const linhas = []; const vistos = new Set();
  for(const row of json(nomeBase)){
    const g = rnLeitor(row);
    const cnpj = rnCnpjPlanilha(g('CNPJ'));
    if(!cnpj) continue;
    if(!/^\d{14}$/.test(cnpj)){ erros.push(`CNPJ inválido na base: ${String(g('CNPJ')).slice(0, 20)}`); continue; }
    if(vistos.has(cnpj)) continue;
    vistos.add(cnpj);
    const dados = {};
    Object.keys(row).forEach(k => { const v = rnValorCelula(row[k]); if(v !== null) dados[String(k).trim()] = v; });
    linhas.push({ cnpj_digits: cnpj, razao_social: rnTexto(g('Razão Social')), telefone: rnTexto(g('Telefone de Contato')), nome_adm: rnTexto(g('Nome do ADM')),
      linhas_voz: rnInt(g('Quantidade de linhas (Voz)')), apto: rnTexto(g('APTO RENOVAÇÃO')), cidade: rnTexto(g('CIDADE')), ddd: rnTexto(g('DDD')),
      tempo_contrato_voz: rnInt(g('Tempo de contrato (Voz)')), classificacao: rnTexto(g('Classificação')), desconto_claro: rnTexto(g('Desconto Claro')),
      origem: rnTexto(g('ORIGEM')), dados_claro: dados, consultor_id: null, _consultor: rnTexto(g('CONSULTOR')) });
  }
  const trabalho = new Map();
  for(const aba of abasTime){
    for(const row of json(aba)){
      const g = rnLeitor(row);
      const cnpj = rnCnpjPlanilha(g('CNPJ'));
      if(!/^\d{14}$/.test(cnpj)) continue;
      const canal = rnTexto(g('CANAL')); const motivo = rnTexto(g('MOTIVO PERDA'));
      trabalho.set(cnpj, { _aba: aba, status: rnStatusPlanilha(g('STATUS')), data_contato: rnDataPlanilha(g('DATA CONTATO')),
        prox_retorno: rnDataPlanilha(g('PRÓX. RETORNO')), canal: RN_CANAIS.includes(canal) ? canal : null,
        linhas_renovadas: rnInt(g('LINHAS RENOV.')), bl_vendida: rnInt(g('BL VENDIDA (qtd)')), sol_digitais: rnNumBR(g('SOL. DIGITAIS (R$)')),
        motivo_perda: RN_MOTIVOS.includes(motivo) ? motivo : null, observacoes: rnTexto(g('OBSERVAÇÕES')) });
    }
  }
  const primeiro = (s) => rnNorm(s).split(' ')[0];
  const porNome = (nome) => { const achados = perfis.filter(p => p.equipe === 'renovacao' && primeiro(p.nome) === primeiro(nome)); return achados.length === 1 ? achados[0].id : null; };
  const semLogin = new Set();
  linhas.forEach(l => {
    const t = trabalho.get(l.cnpj_digits);
    const nome = (t && t._aba) || l._consultor;
    if(nome){ l.consultor_id = porNome(nome); if(!l.consultor_id) semLogin.add(nome); }
    delete l._consultor;
    if(t){ delete t._aba; Object.assign(l, t); }
  });
  semLogin.forEach(n => erros.push(`"${n}" não tem login no time de renovação (marque na aba Consultores).`));
  return { formato: abasTime.length ? 'planilha' : 'base', linhas, erros, abas: abasTime };
}
function rnPrevia(linhas, existentes){
  const mapa = new Map(existentes.map(e => [e.cnpj_digits, e]));
  const noArquivo = new Set(linhas.map(l => l.cnpj_digits));
  const novos = linhas.filter(l => !mapa.has(l.cnpj_digits));
  return { novos: novos.length, atualizados: linhas.length - novos.length,
    sairam: existentes.filter(e => e.na_base && !noArquivo.has(e.cnpj_digits)).length,
    completar: novos.filter(l => (l.status === 7 && !l.motivo_perda) || (l.status === 6 && !(l.linhas_renovadas >= 1))).length };
}
function rnImportarHtml(){
  return `<div class="card rnImportar"><h3>Importar base</h3><p class="kbMeta">Base da Claro (.xlsx) ou a planilha do time, com as abas dos consultores. Junta por CNPJ: quem é novo entra, quem já existe só tem os dados da Claro atualizados e quem saiu do arquivo fica "fora da base". O atendimento nunca é apagado.</p><input type="file" id="rnArquivo" accept=".xlsx,.xls"><div id="rnPrevia"></div></div>`;
}
async function rnPrepararImportacao(arquivo){
  const box = document.getElementById('rnPrevia');
  rnEstado.importacao = null;
  box.innerHTML = '<p class="kbMeta">Lendo o arquivo…</p>';
  let wb;
  try{ wb = XLSX.read(await arquivo.arrayBuffer(), { type: 'array', cellDates: true }); }
  catch(err){ box.innerHTML = '<p class="kbMeta">Não consegui ler esse arquivo. Use .xlsx.</p>'; return; }
  const pf = await ppSeguro(() => sb.from('profiles').select('id,nome,equipe').eq('equipe', 'renovacao'));
  const lido = rnLerArquivo(wb, (pf && !pf.error && pf.data) || []);
  if(lido.erros.length){ box.innerHTML = `<div class="kbAviso">${lido.erros.slice(0, 10).map(escapeHtml).join('<br>')}</div>`; return; }
  const ex = await fetchAllRows(() => sb.from('renovacao_carteira').select('cnpj_digits,na_base').order('id'));
  if(ex.error){ box.innerHTML = '<p class="kbMeta">Não foi possível conferir a carteira atual.</p>'; return; }
  const p = rnPrevia(lido.linhas, ex.data || []);
  rnEstado.importacao = lido;
  box.innerHTML = `<p>${lido.formato === 'planilha' ? 'Planilha do time (' + lido.abas.map(escapeHtml).join(', ') + ')' : 'Base da Claro'}: <b>${lido.linhas.length}</b> CNPJs.</p>`
    + `<ul><li><b>${p.novos}</b> novos</li><li><b>${p.atualizados}</b> já existem (só dados da Claro)</li><li><b>${p.sairam}</b> saem da base</li>`
    + (p.completar ? `<li><b>${p.completar}</b> entram como pendência (perdido sem motivo ou renovado sem linhas)</li>` : '')
    + '</ul><button type="button" class="btn btn-sm" data-rn-importar>Importar</button>';
}
async function rnExecutarImportacao(){
  const lido = rnEstado.importacao;
  if(!lido) return;
  const box = document.getElementById('rnPrevia');
  const btn = box.querySelector('[data-rn-importar]');
  if(btn) btn.disabled = true;
  let novos = 0, atualizados = 0;
  for(let i = 0; i < lido.linhas.length; i += 200){
    box.querySelector('p').textContent = `Importando ${Math.min(i + 200, lido.linhas.length)} de ${lido.linhas.length}…`;
    const r = await ppSeguro(() => sb.rpc('renovacao_importar', { p_linhas: lido.linhas.slice(i, i + 200) }));
    if(!r || r.error){
      mostrarAviso('A importação parou no meio (' + ((r && r.error && r.error.message) || 'erro') + '). O que já entrou está salvo; importe o mesmo arquivo de novo para terminar.', 'erro');
      if(btn) btn.disabled = false;
      return;
    }
    novos += (r.data && r.data.novos) || 0; atualizados += (r.data && r.data.atualizados) || 0;
  }
  const f = await ppSeguro(() => sb.rpc('renovacao_marcar_fora', { p_cnpjs: lido.linhas.map(l => l.cnpj_digits) }));
  rnEstado.importacao = null;
  if(!f || f.error){ mostrarAviso(`Importado: ${novos} novos e ${atualizados} atualizados, mas não consegui marcar quem saiu da base. Importe de novo.`, 'erro'); }
  else mostrarAviso(`Importado: ${novos} novos, ${atualizados} atualizados, ${f.data || 0} fora da base.`, 'ok');
  rnEstado.carregado = false;
  await rnCarregar();
}
document.getElementById('rnResumo').addEventListener('change', (e) => { if(e.target.id === 'rnArquivo' && e.target.files && e.target.files[0]) rnPrepararImportacao(e.target.files[0]); });
document.getElementById('rnResumo').addEventListener('click', (e) => { if(e.target.closest('[data-rn-importar]')) rnExecutarImportacao(); });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do node $t | tail -1; done`
Expected: todos com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_importar.js _template.html
git commit -m "feat(renovacao): importar base da Claro e migrar a planilha do time (§143.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentação, suíte inteira e conferência do HTML

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova seção §143 antes da linha `Próxima livre: §143 …`, e trocar essa linha)

- [ ] **Step 1: Escrever a §143 no REGRAS_NEGOCIO.md**

Antes da linha `Próxima livre: §143 (§138.2 e §138.3 reservadas).`, inserir:

```markdown
## §143 Aba Renovação: a carteira do time de renovação no painel (07/11/2026)

Pedido do Rafael: o time de renovação (vende só para quem já é cliente Claro) trabalhava numa planilha do Google
(1.242 CNPJs aptos de 24/09, 414 por consultor). Tudo da planilha vem para o painel, com regras que a planilha não tinha.
Spec: `docs/superpowers/specs/2026-11-07-renovacao-aba-design.md`. Entrega em 2 fases.

### §143.1 Fase 1 — Carteira, Retornos, Resumo, Redistribuir e Importar

- **Quem vê:** quem tem `profiles.equipe = 'renovacao'` (o admin marca na aba Consultores, coluna "Renovação") e
  admin/supervisor da Apex. O consultor vê e edita só a carteira dele; supervisor e admin veem tudo e redistribuem;
  só admin importa. Agência e os demais não veem nada (RLS).
- **Status:** 1-Não contatado · 2-Tentativa s/ retorno · 3-Contato efetivo · 4-Proposta enviada · 5-Em negociação ·
  6-Renovado · 7-Perdido. Canal: WhatsApp, Ligação, E-mail, Visita. Motivo da perda: Preço, Foi p/ concorrente,
  Sem interesse, Insatisfeito c/ Claro, Empresa fechada/baixada, Contato inválido, Outro.
- **Regras no banco** (`renovacao_carteira_validar`): Perdido exige motivo; Renovado exige linhas renovadas (≥ 1);
  ao sair do status 1 a data do contato é preenchida com o dia (SP); consultor não muda consultor, dados da Claro
  nem `a_completar`. Toda mudança de status ou de consultor vai para `renovacao_historico`.
- **Legado da planilha:** perdido sem motivo e renovado sem linhas entram "a completar" (filtro Pendências); a regra
  passa a valer na próxima mudança de status, e a pendência some quando o registro fica válido.
- **Resumo** (view `renovacao_resumo`, mesmas fórmulas da planilha): contatados = status ≥ 2; contato efetivo+ = 3 a 6;
  propostas+ = 4 a 6; % conversão = renovados / efetivo+; retornos atrasados = retorno antes de hoje e status ≠ 6/7.
  Só conta quem está na base.
- **Importar base** (admin, Resumo → Importar base): lê o .xlsx no navegador. Junta por CNPJ: novo entra; existente só
  tem os dados da Claro atualizados; quem sumiu do arquivo fica "fora da base" (não é apagado). Atendimento, consultor e
  origem nunca são sobrescritos. A planilha do time (abas dos consultores com "STATUS ▼") também traz o atendimento,
  ligando cada aba ao login pelo primeiro nome. Lotes de 200; se parar no meio, importar o mesmo arquivo de novo.
- **Ficha:** WhatsApp/Ligar, atendimento, dados da Claro agrupados (Contrato e linhas, Empresa, Contatos, Concorrência,
  Fixa e cabeamento, Tudo) e histórico.
- Banco: migrations `20261107150000_renovacao_carteira.sql` e `20261107150100_renovacao_importar.sql`; conferência
  `supabase/tests/renovacao_check.sql`. Testes JS: `test_renovacao_*.js`.
- **Fase 2 (§143.2, a fazer):** Kanban, Gerar proposta integrado, Proposta e fatura dentro da aba, trava no funil antigo
  e abas antigas escondidas para o time.
```

E trocar a linha `Próxima livre: §143 (§138.2 e §138.3 reservadas).` por `Próxima livre: §144 (§138.2, §138.3 e §143.2 reservadas).`

- [ ] **Step 2: Rodar a suíte inteira**

Run: `bash run_tests.sh`
Expected: `TOTAL: N passaram, 0 falharam` (pulados só os que dependem de planilha real, como antes). Se algum teste antigo falhar, ler o log em `$TMPDIR/apex_tests/` e conferir se a causa é a coluna nova da tabela de usuários (`colspan`/contagem de `<td>`) ou o botão novo do menu (contagem de abas): ajustar o teste antigo só se ele contar exatamente essas coisas.

- [ ] **Step 3: Conferir `<div>` balanceadas e a marcação nova**

Run:
```bash
python - <<'EOF'
import re
h = open('_template.html', encoding='utf-8').read()
print('div abre', len(re.findall(r'<div\b', h)), 'fecha', len(re.findall(r'</div>', h)))
s = h[h.index('id="panel-renovacao"'):]; s = s[:s.index('</section>')]
print('renovacao: div', len(re.findall(r'<div\b', s)), '/', len(re.findall(r'</div>', s)))
EOF
git show oficial/main:_template.html | python -c "import sys,re; h=sys.stdin.read(); print('oficial: div', len(re.findall(r'<div\b', h)), '/', len(re.findall(r'</div>', h)))"
```
Expected: no painel da Renovação, abre = fecha; a diferença abre−fecha do arquivo inteiro é **a mesma** do `oficial/main` (o template tem `<div` dentro de strings de JS, então o total não precisa ser zero, só não pode mudar).

- [ ] **Step 4: Commit**

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): §143.1 aba Renovação — carteira, retornos, resumo e importação

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Produção (cada passo só com ok do Rafael)

**Files:** nenhum novo. Usa as migrations, o painel gerado e a planilha.

- [ ] **Step 1: Pedir ok para o banco.** Mostrar ao Rafael: as 2 migrations (tabelas novas, `profiles.equipe` + trava, RPCs), que nada existente muda além da coluna nova em `profiles`, e que o teste rodou sem gravar. Esperar "ok".

- [ ] **Step 2: Aplicar as migrations** com `execute_sql`, uma de cada vez (cada arquivo já tem `begin`/`commit`), na ordem 150000 → 150100. Conferir:
```sql
select to_regclass('public.renovacao_carteira'), to_regclass('public.renovacao_historico'), to_regclass('public.renovacao_resumo'),
       to_regproc('public.renovacao_importar'), to_regproc('public.renovacao_marcar_fora'),
       (select count(*) from pg_trigger where tgname in ('profiles_trava_equipe','renovacao_carteira_validar','renovacao_carteira_historico'));
```
Expected: nenhum `null` e `3`. Depois, rodar `supabase/tests/renovacao_check.sql` puro (já termina em ROLLBACK). Expected: sem erro.

- [ ] **Step 3: Marcar o time** (com ok): `update public.profiles set equipe = 'renovacao' where id in (<ids do Bruno, da Fabiana e da Silvana>);` (pegar os ids com `select id, nome from profiles where role = 'consultor' and nome ilike any(array['bruno%','fabiana%','silvana%'])` e mostrar ao Rafael antes). Pode ser pela aba Consultores depois de publicado, se ele preferir.

- [ ] **Step 4: Publicar o painel** (com ok), seguindo o processo da memória `apex-publicacao-painel`: `git fetch oficial` e juntar se andou; `python build_painel.py`; baixar o painel do ar e comparar com o gerado (se o do ar tiver algo que o repositório não tem, juntar, nunca sobrescrever); backup no servidor; envio com MD5 do ar no mesmo comando; conferir o MD5 publicado.

- [ ] **Step 5: Virada** (o admin, no painel, com o Rafael acompanhando): baixar a planilha do time como .xlsx (Arquivo → Fazer download → .xlsx); Renovação → Resumo → Importar base; conferir a prévia (1.242 CNPJs, 1.242 novos, 0 saem, pendências = perdidos sem motivo + renovados sem linhas); Importar.

- [ ] **Step 6: Conferência número a número.** O Resumo do painel tem que bater com o Resumo da planilha do dia da virada (carteira, contatados, % cobertura, efetivo+, propostas+, renovados, perdidos, % conversão, linhas, BL, digitais, retornos atrasados, por consultor e no total). Se não bater, **não vira**: investigar (superpowers:systematic-debugging) antes de qualquer outra coisa. Batendo: o Rafael avisa o time e deixa a planilha só de consulta.

- [ ] **Step 7: Fechar.** `git fetch oficial`, juntar se andou, `git push oficial HEAD:main` (sem force), registrar na REGRAS o MD5 publicado e o commit, e atualizar a memória `apex-regras-negocio-doc` (próxima livre §144) e uma memória nova da §143 com o estado da Fase 1.
