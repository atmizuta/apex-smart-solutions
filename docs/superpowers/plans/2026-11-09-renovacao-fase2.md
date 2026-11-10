# Aba Renovação, Fase 2 (§143.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Juntar tudo de renovação na aba Renovação: Kanban, "Gerar proposta" ligado à carteira, subaba "Proposta e fatura", funil antigo seguindo o status da carteira e o time sem as abas Busca/Proposta/Funil/Agenda.

**Architecture:** No banco, `propostas.carteira_id` liga a proposta ao cliente da carteira; o estágio de uma proposta ligada é **sempre calculado** a partir do status da carteira (trigger em `propostas`), e mudar o status na carteira empurra o estágio das propostas abertas (trigger em `renovacao_carteira`) com histórico. No painel, o bloco `RENOVAÇÃO — §143` ganha Kanban, Gerar proposta, Propostas na ficha e a subaba Proposta e fatura (os mesmos nós HTML da aba Proposta, movidos); o funil antigo trava o cartão ligado e manda para a Renovação.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), HTML/JS no `_template.html`, testes jsdom (`node test_*.js`) com `renovacao_test_harness.js`, testes SQL em `supabase/tests/*_check.sql` (ROLLBACK).

**Spec:** `docs/superpowers/specs/2026-11-07-renovacao-aba-design.md` (§5.1 Kanban e Proposta e fatura, §5.2 ficha, §5.4 abas antigas, §6 integração)

## Global Constraints

- Repositório **público**: testes só com dados fictícios `Zz…` e CNPJs `000000000002xx`.
- Supabase `mdgfboijyqfkggcrhptn` é **produção**: DDL e o `renovacao_ligar_propostas()` só com ok do Rafael (Task 8). Antes, testar com `begin; … rollback;`.
- Migrations sem `DROP`; `create or replace` / `if not exists`; trigger/policy por `do $$ … if not exists … $$`; aplicar com `execute_sql` begin/commit.
- Edite só `_template.html`; `python build_painel.py` gera o painel.
- Design Sinal de Ápice: cores só por variável; reaproveitar `.kbBtn`, `.kbMeta`, `.kbN`, `.badge`, `.rnNome`, `.rnHist`; `mostrarAviso` / `fecharOverlay`.
- Estágio de proposta ligada = função do status da carteira: 1–4 → `proposta_enviada`; 5 → `negociacao`; 6 → `fechado_ganho`; 7 → `fechado_perdido`.
- A sincronização mexe só em propostas **abertas** (estágio fora de `fechado_ganho`/`fechado_perdido`); nunca há caminho proposta → carteira.
- Kanban: colunas 3-Contato efetivo · 4-Proposta enviada · 5-Em negociação · 6-Renovado · 7-Perdido. Soltar em 6/7 abre a janela de fechamento da Fase 1.
- Ordem das subabas: Carteira · Kanban · Proposta e fatura · Retornos · Resumo.
- Esconder Busca, Proposta, Funil e Agenda **só** para `role = 'consultor'` com `equipe = 'renovacao'`; ninguém mais muda.
- `<div>`/`</div>` balanceados.

## Review Focus

1. **Gerar proposta duas vezes para o mesmo cliente:** duas propostas ligadas; o cartão mostra o valor da mais nova; a carteira sobe para 4 só da primeira vez (na segunda já está em 4). Teste na Task 2.
2. **Cliente perdido (7) e depois reaberto (5):** as propostas antigas fechadas continuam fechadas; uma proposta nova já nasce em `negociacao`. Teste SQL na Task 1.
3. **Alguém muda o estágio de uma proposta ligada pelo console ou pelo funil antigo:** o banco recalcula a partir da carteira, e o funil antigo nem deixa arrastar. Testes nas Tasks 1 e 6.
4. **Cliente da carteira que não está em `clientes`:** "Gerar proposta" monta o cliente a partir dos dados da Claro, sem quebrar. Teste na Task 2.
5. **Admin usa a subaba Proposta e fatura e depois abre a aba Proposta normal:** o formulário volta para a aba Proposta, sem sumir. Teste na Task 5.

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261109150000_renovacao_fase2.sql` (criar) | `propostas.carteira_id`, `renovacao_carteira.status_desde`, `renovacao_estagio()`, triggers de estágio e de sincronização, `renovacao_ligar_propostas()` |
| `supabase/tests/renovacao_fase2_check.sql` (criar) | Conferência da migration; termina em ROLLBACK |
| `renovacao_test_harness.js` (modificar) | Builder ganha `.not()` e `.insert()` |
| `test_renovacao_proposta.js`, `test_renovacao_kanban.js`, `test_renovacao_ficha2.js`, `test_renovacao_subaba_proposta.js`, `test_renovacao_funil.js`, `test_renovacao_abas_time.js` (criar) | Testes JS por bloco |
| `_template.html` (modificar) | Markup das subabas, CSS do Kanban, bloco JS §143.2, `openProposal`/`registrarPropostaNoFunil`/`abrirPropostaDoCard`, funil antigo, atalho "Ver funil completo" |
| `REGRAS_NEGOCIO.md`, spec §6 (modificar) | §143.2 |

---

### Task 1: Banco: proposta ligada à carteira

**Files:**
- Create: `supabase/migrations/20261109150000_renovacao_fase2.sql`
- Create: `supabase/tests/renovacao_fase2_check.sql`

**Interfaces:**
- Consumes: `renovacao_carteira`, `renovacao_carteira_validar()` (Fase 1), `propostas`, `propostas_historico(proposta_id, user_id, estagio_anterior, estagio_novo, nota)`.
- Produces: `propostas.carteira_id bigint`; `renovacao_carteira.status_desde timestamptz not null` (muda só quando o status muda); `public.renovacao_estagio(int) returns text`; trigger `propostas_estagio_da_carteira` (BEFORE INSERT OR UPDATE em `propostas`); trigger `renovacao_carteira_sync_propostas` (AFTER UPDATE OF status); `public.renovacao_ligar_propostas() returns int` (liga propostas existentes pelo CNPJ, sem mudar estágio; só SQL, sem acesso pela API).

- [ ] **Step 1: Escrever o teste SQL**

Criar `supabase/tests/renovacao_fase2_check.sql`:

```sql
-- Verificação da migration 20261109150000 (§143.2). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f611', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r2a@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f611', 'Zzr2a Teste', 'zz.r2a', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id, status, status_desde) values
('00000000000201', 'Zz Dois Um',   '00000000-0000-0000-0000-00000000f611', 5, now() - interval '5 days'),
('00000000000202', 'Zz Dois Dois', '00000000-0000-0000-0000-00000000f611', 2, now() - interval '5 days'),
('00000000000203', 'Zz Dois Tres', '00000000-0000-0000-0000-00000000f611', 3, now() - interval '5 days');
insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id) values
('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'negociacao', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'fechado_perdido', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Dois', '00.000.000/0002-02', 'renovacao', 'base', 'lead', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-00000000f611', 'Zz Fora', '00.000.000/0009-99', 'portabilidade', 'avulsa', 'proposta_enviada', now(), now(), now(), null);

do $$
declare n int; r record; v_201 bigint; v_202 bigint; v_203 bigint;
  v_a uuid := '00000000-0000-0000-0000-00000000f611';
begin
  select id into v_201 from public.renovacao_carteira where cnpj_digits = '00000000000201';
  select id into v_202 from public.renovacao_carteira where cnpj_digits = '00000000000202';
  select id into v_203 from public.renovacao_carteira where cnpj_digits = '00000000000203';
  assert public.renovacao_estagio(1) = 'proposta_enviada' and public.renovacao_estagio(4) = 'proposta_enviada'
     and public.renovacao_estagio(5) = 'negociacao' and public.renovacao_estagio(6) = 'fechado_ganho'
     and public.renovacao_estagio(7) = 'fechado_perdido', 'mapa status → estágio';

  -- ligar (só carteira_id muda) não recalcula o estágio: a fechada continua fechada
  update public.propostas set carteira_id = v_201 where id in ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0002');
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0002') = 'fechado_perdido', 'ligar não reabre a fechada';
  -- ligar propostas antigas pelo CNPJ não muda o estágio
  n := public.renovacao_ligar_propostas();
  assert n = 1, 'só a proposta fictícia sem ligação casa, veio ' || n;
  select * into r from public.propostas where id = '00000000-0000-0000-0000-0000000a0003';
  assert r.carteira_id = v_202 and r.estagio = 'lead', 'ligada sem mudar estágio: ' || row_to_json(r)::text;
  assert (select carteira_id from public.propostas where id = '00000000-0000-0000-0000-0000000a0004') is null, 'CNPJ fora da carteira fica sem ligação';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  -- proposta nova ligada nasce no estágio que a carteira manda (201 está em 5)
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0005', v_a, 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), v_201);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0005') = 'negociacao', 'nova proposta segue a carteira';

  -- mudar o estágio de proposta ligada por fora é recalculado
  update public.propostas set estagio = 'lead' where id = '00000000-0000-0000-0000-0000000a0001';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0001') = 'negociacao', 'estágio ligado não muda por fora';
  -- proposta sem ligação continua livre (funil antigo)
  update public.propostas set estagio = 'negociacao' where id = '00000000-0000-0000-0000-0000000a0004';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0004') = 'negociacao', 'funil antigo segue livre';

  -- status 5 → 6 fecha as abertas, com histórico; a fechada antiga não muda
  update public.renovacao_carteira set status = 6, linhas_renovadas = 3 where id = v_201;
  assert (select count(*) from public.propostas where carteira_id = v_201 and estagio = 'fechado_ganho') = 2, 'abertas viraram ganho';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0002') = 'fechado_perdido', 'fechada antiga intocada';
  select count(*) into n from public.propostas_historico h
   where h.proposta_id in ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0005')
     and h.estagio_anterior = 'negociacao' and h.estagio_novo = 'fechado_ganho' and h.user_id = v_a and h.nota like 'Renovação:%';
  assert n = 2, 'histórico da sincronização, veio ' || n;
  assert (select status_desde from public.renovacao_carteira where id = v_201) = now(), 'status_desde muda com o status';

  -- status_desde não muda sem mudar status, nem por escrita direta
  update public.renovacao_carteira set observacoes = 'Zz obs', status_desde = now() - interval '1 day' where id = v_202;
  assert (select status_desde from public.renovacao_carteira where id = v_202) < now() - interval '4 days', 'status_desde intocado sem mudar status';

  -- perdido copia o motivo; reabrir não reabre a fechada; proposta nova nasce em negociação
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0006', v_a, 'Zz Dois Tres', '00.000.000/0002-03', 'renovacao', 'base', 'lead', now(), now(), now(), v_203);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0006') = 'proposta_enviada', 'status 3 → proposta_enviada';
  update public.renovacao_carteira set status = 7, motivo_perda = 'Preço' where id = v_203;
  select * into r from public.propostas where id = '00000000-0000-0000-0000-0000000a0006';
  assert r.estagio = 'fechado_perdido' and r.motivo_perda = 'Preço', 'perdido copia o motivo: ' || row_to_json(r)::text;
  update public.renovacao_carteira set status = 5 where id = v_203;
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0006') = 'fechado_perdido', 'reabrir não reabre a fechada';
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0007', v_a, 'Zz Dois Tres', '00.000.000/0002-03', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), v_203);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0007') = 'negociacao', 'nova depois de reabrir nasce em negociação';

  -- funções internas não são chamáveis pela API
  begin
    perform public.renovacao_ligar_propostas();
    assert false, 'consultor chamou renovacao_ligar_propostas';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $$;

rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

`execute_sql` com o arquivo. Expected: ERRO `column "status_desde" of relation "renovacao_carteira" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261109150000_renovacao_fase2.sql`:

```sql
-- §143.2 (09/11, Rafael): Renovação Fase 2 — proposta e funil ligados à carteira.
-- O estágio de uma proposta ligada (carteira_id) é SEMPRE calculado do status da carteira: quem muda é a carteira,
-- e a carteira empurra o estágio das propostas abertas (com histórico). Nunca há caminho proposta → carteira.
-- (Spec §6 dizia "recusar"; calcular dá a mesma garantia sem fazer o "gerar de novo" do funil falhar em silêncio.)
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_fase2_check.sql (desfaz tudo).
begin;

alter table public.propostas add column if not exists carteira_id bigint references public.renovacao_carteira(id) on delete set null;
create index if not exists propostas_carteira_idx on public.propostas (carteira_id) where carteira_id is not null;

-- Desde quando o cliente está no status atual (Kanban: "dias no status"). Antigos: última mudança no histórico ou a importação.
alter table public.renovacao_carteira add column if not exists status_desde timestamptz;
alter table public.renovacao_carteira disable trigger renovacao_carteira_validar;   -- preencher sem regravar atualizado_em/atualizado_por
update public.renovacao_carteira c set status_desde = coalesce(
  (select max(h.criado_em) from public.renovacao_historico h where h.carteira_id = c.id and h.campo = 'status'), c.importado_em)
 where c.status_desde is null;
alter table public.renovacao_carteira enable trigger renovacao_carteira_validar;
alter table public.renovacao_carteira alter column status_desde set default now();
alter table public.renovacao_carteira alter column status_desde set not null;

-- Mesmas regras da Fase 1 + status_desde (só muda quando o status muda; escrita direta é ignorada).
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
    new.status_desde := case when v_mudou then now() else old.status_desde end;
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

create or replace function public.renovacao_estagio(p_status int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case p_status when 5 then 'negociacao' when 6 then 'fechado_ganho' when 7 then 'fechado_perdido' else 'proposta_enviada' end
$function$;

-- Proposta ligada: estágio vem da carteira na criação e sempre que alguém tenta mudá-lo.
-- Ligar uma proposta existente (só carteira_id muda) não mexe no estágio.
create or replace function public.propostas_estagio_da_carteira()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_status smallint;
begin
  if new.carteira_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.estagio is not distinct from old.estagio then return new; end if;
  select status into v_status from public.renovacao_carteira where id = new.carteira_id;
  if v_status is null then return new; end if;
  new.estagio := public.renovacao_estagio(v_status);
  if tg_op = 'UPDATE' and new.estagio = old.estagio then new.estagio_entrada_em := old.estagio_entrada_em; end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'propostas_estagio_da_carteira' and tgrelid = 'public.propostas'::regclass) then
    create trigger propostas_estagio_da_carteira before insert or update on public.propostas
      for each row execute function public.propostas_estagio_da_carteira();
  end if;
end $$;

-- Status mudou na carteira → propostas abertas ligadas vão para o estágio correspondente (perdido copia o motivo).
create or replace function public.renovacao_carteira_sync_propostas()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_estagio text := public.renovacao_estagio(new.status);
begin
  if new.status is not distinct from old.status then return null; end if;
  with alvo as (
    select p.id, p.estagio as antes from public.propostas p
     where p.carteira_id = new.id and p.estagio not in ('fechado_ganho', 'fechado_perdido') and p.estagio <> v_estagio
     for update
  ), mudou as (
    update public.propostas p
       set estagio = v_estagio, estagio_entrada_em = now(), atualizado_em = now(),
           motivo_perda = case when new.status = 7 then new.motivo_perda else p.motivo_perda end
      from alvo where p.id = alvo.id
    returning p.id, alvo.antes
  )
  insert into public.propostas_historico (proposta_id, user_id, estagio_anterior, estagio_novo, nota)
  select m.id, auth.uid(), m.antes, v_estagio, 'Renovação: status ' || old.status || ' → ' || new.status from mudou m;
  return null;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_sync_propostas' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_sync_propostas after update of status on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_sync_propostas();
  end if;
end $$;

-- Liga propostas antigas ao cliente da carteira pelo CNPJ (sem mudar estágio). Só SQL: rodar uma vez ao aplicar.
create or replace function public.renovacao_ligar_propostas()
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  update public.propostas p set carteira_id = c.id
    from public.renovacao_carteira c
   where p.carteira_id is null
     and length(regexp_replace(coalesce(p.cliente_cnpj, ''), '[^0-9]', '', 'g')) between 13 and 14
     and lpad(regexp_replace(p.cliente_cnpj, '[^0-9]', '', 'g'), 14, '0') = c.cnpj_digits;
  get diagnostics n = row_count;
  return n;
end $function$;

revoke all on function public.renovacao_carteira_validar() from public, anon, authenticated;
revoke all on function public.propostas_estagio_da_carteira() from public, anon, authenticated;
revoke all on function public.renovacao_carteira_sync_propostas() from public, anon, authenticated;
revoke all on function public.renovacao_ligar_propostas() from public, anon, authenticated;

select public.renovacao_ligar_propostas();

commit;
```

- [ ] **Step 4: Rodar e ver passar, sem gravar**

`execute_sql` com `begin;` + migration sem `begin;`/`commit;` + teste sem o primeiro `begin;`.
Expected: sem erro. Depois `select count(*) from information_schema.columns where table_name = 'propostas' and column_name = 'carteira_id'` → 0 (nada ficou).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109150000_renovacao_fase2.sql supabase/tests/renovacao_fase2_check.sql
git commit -m "feat(renovacao): proposta ligada à carteira — estágio segue o status (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Gerar proposta a partir da carteira

**Files:**
- Modify: `renovacao_test_harness.js` (builder ganha `.not()` e `.insert()`)
- Create: `test_renovacao_proposta.js`
- Modify: `_template.html`: `proposalState` em `openProposal` (~7130), `registrarPropostaNoFunil` (~11590), `abrirPropostaDoCard` (~11578), `rnEstado`/`RN_COLS_LISTA`/`rnAplicarPermissao`/`rnCarregar`/`rnSalvar` (bloco §143), novo código antes do marcador `FIM RENOVAÇÃO §143`

**Interfaces:**
- Consumes: `openProposal(client, opts)`, `rnSalvar`, `rnNumBR`, `rnEstado`, `ppSeguro`.
- Produces: `proposalState.carteiraId`; `rnClienteDaCarteira(r, dados)` → objeto no formato de `clientes`; `rnGerarProposta(id)`; `rnPropostaGerada(carteiraId)`; `rnCarregarPropostas()` (preenche `rnEstado.propostas`, mais novas primeiro); `rnPropostasDe(carteiraId)` → array; `rnEstado.propostas`, `rnEstado.arrastando`; `RN_COLS_LISTA` inclui `status_desde`.

- [ ] **Step 1: Harness: `.not()` e `.insert()`**

Em `renovacao_test_harness.js`, trocar
`  const casa = (linha, filtros) => filtros.every(([op, c, v]) => op === 'eq' ? String(linha[c]) === String(v) : op === 'in' ? v.map(String).includes(String(linha[c])) : true);`
por
`  const casa = (linha, filtros) => filtros.every(([op, c, v]) => op === 'eq' ? String(linha[c]) === String(v) : op === 'in' ? v.map(String).includes(String(linha[c])) : op === 'notnull' ? (linha[c] !== null && linha[c] !== undefined) : true);`

e, dentro de `resposta()`, logo depois de `const linhas = window.__tabelas[tabela] || [];`, inserir:

```js
      if(q.op === 'insert'){
        const novo = Object.assign({ id: 'novo-' + window.__escritas.length }, q.patch);
        (window.__tabelas[tabela] = window.__tabelas[tabela] || []).push(novo);
        return { data: Object.assign({}, novo), error: null };
      }
```

e, no objeto `b`, depois da linha do `in:`, inserir:

```js
      not: (c, op, v) => { if(op === 'is' && v === null) q.filtros.push(['notnull', c, null]); return b; },
      insert: (payload) => { q.op = 'insert'; q.patch = payload; window.__escritas.push(q); return b; },
```

- [ ] **Step 2: Escrever o teste (vai falhar)**

Criar `test_renovacao_proposta.js`:

```js
// Testa a §143.2 — Gerar proposta na Renovação e a ligação proposta ⇄ carteira. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const dados = { 'VL_CONTR_NO_MSISDN_C_DESC_RET': 812.5, 'VALOR POR LINHA / ARPU': 81.25, 'QT LINHAS SILENTES': 2, 'CEP CABEADO?': 'CEP Cabeado' };
  const L = { id: 1, cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um', cidade: 'Zz Cidade', ddd: '19', linhas_voz: 10, tempo_contrato_voz: 22,
    apto: 'APTO', telefone: '19900000001', nome_adm: 'Zz Adm', status: 2, na_base: true, consultor_id: 'u-a' };
  const c = rnClienteDaCarteira(L, dados);
  eq([c.razao_social, c.cnpj, c.cnpj_digits, c.linhas_voz, c.tempo_contrato_voz, c.valor_contrato, c.arpu, c.qtde_silentes, c.cep_cabeado, c.apto_renovacao],
     ['Zz Dois Um', '00.000.000/0002-01', '00000000000201', 10, 22, 812.5, 81.25, 2, 'CEP Cabeado', 'APTO'], 'cliente montado da carteira no formato de clientes');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [Object.assign({ dados_claro: dados }, L), Object.assign({}, L, { id: 2, cnpj_digits: '00000000000202', razao_social: 'Zz Dois Dois', status: 5 })];
  window.__tabelas.propostas = [];
  await rnCarregar();
  const chamadas = []; const openOrig = openProposal;
  openProposal = (cli, opts) => { chamadas.push([cli, opts]); };

  // cliente que está em clientes: usa a linha de clientes (como a Busca)
  window.__tabelas.clientes = [{ cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um (base)', valor_contrato: 900 }];
  await rnGerarProposta(1);
  eq([chamadas[0][0].razao_social, chamadas[0][1]], ['Zz Dois Um (base)', { carteiraId: 1 }], 'abre a proposta com a linha de clientes e o carteiraId');
  // cliente fora de clientes: monta da carteira
  await rnGerarProposta(2);
  eq([chamadas[1][0].razao_social, chamadas[1][0].cnpj_digits, chamadas[1][1]], ['Zz Dois Dois', '00000000000202', { carteiraId: 2 }], 'sem clientes, monta da carteira');
  openProposal = openOrig;

  // registrar no funil: liga carteira_id e sobe a carteira para 4 (só se estava em 1–3)
  proposalState = { client: { razao_social: 'Zz Dois Um', cnpj: '00.000.000/0002-01' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 1 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(700, 812.5);
  await espera(20);
  const ins = window.__escritas.find(w => w.tabela === 'propostas' && w.op === 'insert');
  eq([ins.patch.carteira_id, ins.patch.estagio, ins.patch.tipo_proposta], [1, 'proposta_enviada', 'renovacao'], 'proposta gravada com carteira_id');
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').map(w => w.patch), [{ status: 4 }], 'carteira sobe para 4');
  eq(rnPropostasDe(1).length, 1, 'propostas da carteira recarregadas');

  // segunda proposta para o mesmo cliente: liga de novo, mas a carteira já está em 4
  proposalState = { client: { razao_social: 'Zz Dois Um', cnpj: '00.000.000/0002-01' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 1 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(650, 812.5);
  await espera(20);
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').length, 0, 'não mexe na carteira de novo');
  eq(rnPropostasDe(1).length, 2, 'duas propostas ligadas');

  // carteira em 5 não volta para 4
  proposalState = { client: { razao_social: 'Zz Dois Dois' }, avulsa: false, incluirRenovacao: true, propostaId: null, carteiraId: 2 };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(500, 600);
  await espera(20);
  eq(window.__escritas.filter(w => w.tabela === 'renovacao_carteira').length, 0, 'status 5 continua 5');

  // proposta sem carteira (avulsa) segue igual
  proposalState = { client: { razao_social: 'Zz Avulsa' }, avulsa: true, tipoAvulsa: 'portabilidade', incluirRenovacao: true, propostaId: null, carteiraId: null };
  window.__escritas.length = 0;
  await registrarPropostaNoFunil(100, 0);
  await espera(20);
  const insAv = window.__escritas.find(w => w.tabela === 'propostas' && w.op === 'insert');
  assert(insAv && !('carteira_id' in insAv.patch), 'avulsa não leva carteira_id');

  // reabrir pelo cartão leva o carteiraId junto
  const abriu = []; openProposal = (cli, opts) => abriu.push(opts);
  abrirPropostaDoCard({ id: 'p9', carteira_id: 1, origem: 'base', dados: { client: { razao_social: 'Zz' }, avulsa: false } });
  eq([abriu[0].propostaId, abriu[0].carteiraId], ['p9', 1], 'abrirPropostaDoCard mantém a ligação');
  openProposal = openOrig;
  fim();
`);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_proposta.js`
Expected: `FALHA: ReferenceError: rnClienteDaCarteira is not defined`.

- [ ] **Step 4: Implementar**

4a. Em `openProposal`, depois de `    origemFunil: opts.origemFunil || null,` inserir:
```js
    carteiraId: opts.carteiraId || null,   // §143.2: proposta gerada pela Renovação fica ligada ao cliente da carteira
```

4b. Em `abrirPropostaDoCard`, depois de `    origemFunil: p.origem,` inserir:
```js
    carteiraId: p.carteira_id || null,
```

4c. Em `registrarPropostaNoFunil`, trocar
```js
    if(proposalState.propostaId){
      const anterior = funilCache.find(p => p.id === proposalState.propostaId);
```
por
```js
    if(proposalState.carteiraId) payload.carteira_id = proposalState.carteiraId;   // §143.2: o banco calcula o estágio a partir da carteira
    if(proposalState.propostaId){
      const anterior = funilCache.find(p => p.id === proposalState.propostaId);
```
e trocar
```js
    loadFunil();
  }catch(e){
    console.error('Erro ao registrar proposta no funil de vendas:'
```
por
```js
    loadFunil();
    if(proposalState.carteiraId && typeof rnPropostaGerada === 'function') await rnPropostaGerada(proposalState.carteiraId);
  }catch(e){
    console.error('Erro ao registrar proposta no funil de vendas:'
```

4d. No bloco §143:
- `RN_COLS_LISTA`: acrescentar `,status_desde` ao fim da string.
- `const rnEstado = { aba: 'carteira', lista: [],` → `const rnEstado = { aba: 'carteira', lista: [], propostas: [], arrastando: null,`
- em `rnAplicarPermissao`, no `Object.assign(rnEstado, { aba: 'carteira', lista: [],` → `Object.assign(rnEstado, { aba: 'carteira', lista: [], propostas: [],`
- em `rnCarregar`, trocar
```js
      : Promise.resolve({ data: [{ id: currentUser.id, nome: currentUser.nome, equipe: 'renovacao' }], error: null }),
  ]);
```
por
```js
      : Promise.resolve({ data: [{ id: currentUser.id, nome: currentUser.nome, equipe: 'renovacao' }], error: null }),
    rnCarregarPropostas(),
  ]);
```
- em `rnSalvar`, depois de `  if(i >= 0) rnEstado.lista[i] = r.data;` inserir:
```js
  if('status' in patch && rnPropostasDe(id).length) await rnCarregarPropostas();   // o banco moveu o estágio das propostas ligadas
```

4e. Antes de `/* ============ FIM RENOVAÇÃO §143 ============ */` inserir:

```js
// ---- §143.2 Proposta ligada à carteira ----
// Cliente no formato de "clientes" a partir da carteira (reserva: os 1.242 da virada estão todos em clientes).
function rnClienteDaCarteira(r, dados){
  const d = dados || {};
  const num = (v) => (typeof v === 'number' ? v : (rnNumBR(v) || 0));
  return { razao_social: r.razao_social || '', cnpj: String(r.cnpj_digits || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    cnpj_digits: r.cnpj_digits, cidade: r.cidade || '', ddd: r.ddd || '', linhas_voz: r.linhas_voz || 0, linhas_fixas: 0,
    tempo_contrato_voz: r.tempo_contrato_voz || 0, valor_contrato: num(d['VL_CONTR_NO_MSISDN_C_DESC_RET']), arpu: num(d['VALOR POR LINHA / ARPU']),
    qtde_silentes: num(d['QT LINHAS SILENTES']), cep_cabeado: d['CEP CABEADO?'] || '', apto_renovacao: r.apto || '',
    telefone_contato: r.telefone || '', nome_admin: r.nome_adm || '' };
}
async function rnGerarProposta(id){
  const r = rnEstado.lista.find(x => x.id === id);
  if(!r) return;
  const c = await ppSeguro(() => sb.from('clientes').select('*').eq('cnpj_digits', r.cnpj_digits).maybeSingle());
  let client = c && !c.error && c.data ? c.data : null;
  if(!client){
    const d = await ppSeguro(() => sb.from('renovacao_carteira').select('dados_claro').eq('id', id).single());
    client = rnClienteDaCarteira(r, d && !d.error && d.data ? d.data.dados_claro : {});
  }
  openProposal(client, { carteiraId: id });
}
async function rnCarregarPropostas(){
  const p = await ppSeguro(() => sb.from('propostas').select('*').not('carteira_id', 'is', null).order('criado_em', { ascending: false }));
  rnEstado.propostas = p && !p.error ? (p.data || []) : [];
  return p;
}
function rnPropostasDe(carteiraId){ return (rnEstado.propostas || []).filter(p => p.carteira_id === carteiraId); }
// Chamado por registrarPropostaNoFunil depois de gravar: cliente em 1–3 vai para 4-Proposta enviada.
async function rnPropostaGerada(carteiraId){
  const r = rnEstado.lista.find(x => x.id === carteiraId);
  if(r && r.status >= 1 && r.status <= 3) await rnSalvar(carteiraId, { status: 4 });
  await rnCarregarPropostas();
  rnRender();
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && node test_renovacao_proposta.js && for t in test_renovacao_*.js test_funil.js test_tipo_avulsa.js; do node $t | tail -1; done`
Expected: todos com `0 falharam` / `PASSARAM`.

- [ ] **Step 6: Commit**

```bash
git add renovacao_test_harness.js test_renovacao_proposta.js _template.html
git commit -m "feat(renovacao): Gerar proposta pela carteira e ligação com o funil (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Kanban

**Files:**
- Create: `test_renovacao_kanban.js`
- Modify: `_template.html` (botão e `div` da subaba, CSS, `rnTrocarAba`, `rnRender`, código antes do marcador)

**Interfaces:**
- Consumes: `rnFiltrar`, `rnFiltrosVazios`, `rnStatusRotulo`, `rnClasseLinha`, `rnNomeConsultor`, `rnSalvar`, `rnAbrirFechamento`, `rnAbrirFicha`, `rnGerarProposta`, `rnPropostasDe`, `fmtBRL`.
- Produces: `RN_KANBAN = [3,4,5,6,7]`, `rnDiasNoStatus(r, agoraMs)`, `rnKanbanColunas(lista, filtros, hoje)` → `[{status, itens}]`, `rnRenderKanban()`, `rnMoverStatus(id, status)`; `rnTrocarAba` genérico por mapa de ids.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_kanban.js`:

```js
// Testa a §143.2 — Kanban da Renovação. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-09';
  const agora = new Date('2026-11-09T15:00:00Z').getTime();
  eq([rnDiasNoStatus({ status_desde: '2026-11-06T15:00:00Z' }, agora), rnDiasNoStatus({ status_desde: '2026-11-09T10:00:00Z' }, agora), rnDiasNoStatus({}, agora)], [3, 0, null], 'dias no status');
  const L = (o) => Object.assign({ razao_social: 'Zz', linhas_voz: 1, na_base: true, consultor_id: 'u-a', status_desde: '2026-11-08T12:00:00Z' }, o);
  const lista = [L({ id: 1, status: 3, linhas_voz: 5 }), L({ id: 2, status: 3, linhas_voz: 9 }), L({ id: 3, status: 5 }), L({ id: 4, status: 1 }),
                 L({ id: 5, status: 7, motivo_perda: 'Preço' }), L({ id: 6, status: 4, na_base: false }), L({ id: 7, status: 6, linhas_renovadas: 2, consultor_id: 'u-b' })];
  const cols = rnKanbanColunas(lista, rnFiltrosVazios(), '2026-11-09');
  eq(cols.map(c => [c.status, c.itens.map(r => r.id)]), [[3, [2, 1]], [4, []], [5, [3]], [6, [7]], [7, [5]]], 'colunas 3–7, só na base, mais linhas primeiro');
  eq(rnKanbanColunas(lista, Object.assign(rnFiltrosVazios(), { consultor: 'u-b' }), '2026-11-09').map(c => c.itens.length), [0, 0, 0, 1, 0], 'respeita o filtro de consultor');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = lista.filter(r => r.consultor_id === 'u-a');
  window.__tabelas.propostas = [{ id: 'p1', carteira_id: 3, valor_proposto: 1234.5, criado_em: '2026-11-08T10:00:00Z' }];
  await rnCarregar();
  assert(!!document.querySelector('#rnAbas [data-rn-aba="kanban"]'), 'botão da subaba Kanban');
  rnTrocarAba('kanban');
  assert(!document.getElementById('rnKanban').hidden && document.getElementById('rnCarteira').hidden, 'subaba Kanban aparece');
  const colunas = [...document.querySelectorAll('#rnKanban [data-rn-coluna]')];
  eq(colunas.map(c => c.dataset.rnColuna), ['3', '4', '5', '6', '7'], '5 colunas');
  const card3 = document.querySelector('#rnKanban [data-rn-card="3"]').textContent.replace(/\\s+/g, ' ');
  assert(/1.234,50/.test(card3), 'cartão mostra o valor da proposta: ' + card3);
  assert(/no status/.test(card3), 'cartão mostra os dias no status');

  // arrastar 3 → 5 grava o status
  window.__escritas.length = 0;
  const arrastar = (id, para) => {
    document.querySelector('#rnKanban [data-rn-card="' + id + '"]').dispatchEvent(new window.Event('dragstart', { bubbles: true }));
    document.querySelector('#rnKanban [data-rn-coluna="' + para + '"]').dispatchEvent(new window.Event('drop', { bubbles: true, cancelable: true }));
  };
  arrastar(1, 5);
  await espera(30);
  eq(window.__escritas.map(w => w.patch), [{ status: 5 }], 'soltar em outra coluna grava o status');
  assert(!!document.querySelector('#rnKanban [data-rn-coluna="5"] [data-rn-card="1"]'), 'cartão mudou de coluna');
  // soltar em Perdido abre a janela, não grava direto
  window.__escritas.length = 0;
  arrastar(2, 7);
  await espera(20);
  assert(document.getElementById('rnFechamento').classList.contains('active') && !!document.getElementById('rnFechMotivo'), 'Perdido abre a janela do motivo');
  eq(window.__escritas.length, 0, 'nada gravado antes do motivo');
  document.querySelector('#rnFechamento [data-rn-fech-cancelar]').click();
  await espera(200);
  // mesma coluna não grava
  arrastar(3, 5);
  await espera(20);
  eq(window.__escritas.length, 0, 'mesma coluna não grava');

  // botões do cartão
  const gerou = []; const gerarOrig = rnGerarProposta; rnGerarProposta = (id) => { gerou.push(id); };
  document.querySelector('#rnKanban [data-rn-card="3"] [data-rn-gerar]').click();
  eq(gerou, [3], 'Gerar proposta no cartão');
  rnGerarProposta = gerarOrig;
  document.querySelector('#rnKanban [data-rn-card="3"] [data-rn-abrir]').click();
  await espera(30);
  assert(document.getElementById('rnFicha').classList.contains('aberta'), 'clicar no nome abre a ficha');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_kanban.js`
Expected: `FALHA: ReferenceError: rnDiasNoStatus is not defined`.

- [ ] **Step 3: Implementar**

3a. Markup: depois de `          <button type="button" class="active" data-rn-aba="carteira">Carteira</button>` inserir
```html
          <button type="button" data-rn-aba="kanban">Kanban</button>
```
e antes de `      <div id="rnRetornos" class="rnVisao" hidden></div>` inserir
```html
      <div id="rnKanban" class="rnVisao" hidden></div>
```

3b. Trocar o corpo de `rnTrocarAba` por:
```js
function rnTrocarAba(aba){
  rnEstado.aba = aba;
  document.querySelectorAll('#rnAbas [data-rn-aba]').forEach(b => b.classList.toggle('active', b.dataset.rnAba === aba));
  const ids = { carteira: 'rnCarteira', kanban: 'rnKanban', proposta: 'rnProposta', retornos: 'rnRetornos', resumo: 'rnResumo' };
  Object.entries(ids).forEach(([k, id]) => { const el = document.getElementById(id); if(el) el.hidden = k !== aba; });
  rnRender();
}
```
e em `rnRender`, depois da linha da carteira, inserir
```js
  if(rnEstado.aba === 'kanban' && typeof rnRenderKanban === 'function') rnRenderKanban();
```

3c. CSS, depois de `  .rnRetBloco{margin-bottom:var(--space-3);}`:
```css
  .rnKanban{display:grid;grid-template-columns:repeat(5,minmax(200px,1fr));gap:var(--space-3);overflow-x:auto;}
  .rnKbCol{background:var(--ml-surface-2);border-radius:var(--radius-lg);padding:var(--space-2);min-height:200px;}
  .rnKbHead{display:flex;justify-content:space-between;font-weight:600;margin-bottom:var(--space-2);}
  .rnKbCard{background:var(--c-branco);border:1px solid var(--c-linha);border-radius:var(--radius-lg);padding:var(--space-2);margin-bottom:var(--space-2);cursor:grab;display:grid;gap:4px;}
  .rnKbCard.rnPerdido{background:var(--st-perdido-bg);}
  .rnKbCard.rnRenovado{background:var(--st-ganho-bg);}
```

3d. Antes do marcador `FIM RENOVAÇÃO §143`:
```js
// ---- §143.2 Kanban (a partir de Contato efetivo; não contatado e tentativa ficam na lista) ----
const RN_KANBAN = [3, 4, 5, 6, 7];
function rnDiasNoStatus(r, agoraMs){ return r.status_desde ? Math.max(0, Math.floor((agoraMs - new Date(r.status_desde).getTime()) / 86400000)) : null; }
function rnKanbanColunas(lista, filtros, hoje){
  const base = rnFiltrar(lista, Object.assign(rnFiltrosVazios(), { consultor: filtros.consultor || '' }), hoje);
  return RN_KANBAN.map(s => ({ status: s, itens: base.filter(r => r.status === s) }));
}
function rnCartaoHtml(r, agora, gestor){
  const p = rnPropostasDe(r.id)[0];
  const dias = rnDiasNoStatus(r, agora);
  return `<div class="rnKbCard ${rnClasseLinha(r)}" draggable="true" data-rn-card="${r.id}">
    <button type="button" class="rnNome" data-rn-abrir="${r.id}">${escapeHtml(r.razao_social || '(sem nome)')}</button>
    <div class="kbMeta">${r.linhas_voz ?? 0} linhas${p && p.valor_proposto ? ' · ' + fmtBRL(p.valor_proposto) : ''}${dias !== null ? ' · ' + (dias === 0 ? 'hoje' : dias + 'd') + ' no status' : ''}${gestor ? ' · ' + escapeHtml(rnNomeConsultor(r.consultor_id)) : ''}</div>
    <button type="button" class="kbBtn kbBtnG kbBtnSm" data-rn-gerar="${r.id}">Gerar proposta</button>
  </div>`;
}
function rnRenderKanban(){
  const agora = Date.now(); const gestor = rnGestor();
  document.getElementById('rnKanban').innerHTML = '<div class="rnKanban">' + rnKanbanColunas(rnEstado.lista, rnEstado.filtros, rnHoje()).map(c => `
    <div class="rnKbCol" data-rn-coluna="${c.status}">
      <div class="rnKbHead"><span>${escapeHtml(rnStatusRotulo(c.status))}</span><span class="kbN">${c.itens.length}</span></div>
      ${c.itens.map(r => rnCartaoHtml(r, agora, gestor)).join('') || '<p class="kbMeta">Nenhum cliente.</p>'}
    </div>`).join('') + '</div>';
}
function rnMoverStatus(id, status){
  const r = rnEstado.lista.find(x => x.id === id);
  if(!r || r.status === status) return;
  if(status === 6 || status === 7){ rnAbrirFechamento(id, status); return; }
  return rnSalvar(id, { status });
}
document.getElementById('rnKanban').addEventListener('dragstart', (e) => {
  const c = e.target.closest('[data-rn-card]');
  if(!c) return;
  rnEstado.arrastando = Number(c.dataset.rnCard);
  if(e.dataTransfer) e.dataTransfer.setData('text/plain', c.dataset.rnCard);
});
document.getElementById('rnKanban').addEventListener('dragover', (e) => { if(e.target.closest('[data-rn-coluna]')) e.preventDefault(); });
document.getElementById('rnKanban').addEventListener('drop', (e) => {
  const col = e.target.closest('[data-rn-coluna]');
  if(!col || !rnEstado.arrastando) return;
  e.preventDefault();
  const id = rnEstado.arrastando; rnEstado.arrastando = null;
  rnMoverStatus(id, Number(col.dataset.rnColuna));
});
document.getElementById('rnKanban').addEventListener('click', (e) => {
  const g = e.target.closest('[data-rn-gerar]');
  if(g){ rnGerarProposta(Number(g.dataset.rnGerar)); return; }
  const a = e.target.closest('[data-rn-abrir]');
  if(a) rnAbrirFicha(Number(a.dataset.rnAbrir));
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do node $t | tail -1; done`
Expected: todos `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_kanban.js _template.html
git commit -m "feat(renovacao): Kanban da carteira com arrastar e dias no status (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Ficha com Gerar proposta e Propostas ligadas

**Files:**
- Create: `test_renovacao_ficha2.js`
- Modify: `_template.html` (`rnRenderFicha` e listener da ficha)

**Interfaces:**
- Consumes: `rnPropostasDe`, `rnGerarProposta`, `abrirPropostaDoCard(p)`, `FUNIL_ESTAGIO_MAP`, `fmtBRL`.
- Produces: na ficha, botão `[data-rn-gerar]` e lista `[data-rn-proposta="<id>"]`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_ficha2.js`:

```js
// Testa a §143.2 — ficha com Gerar proposta e Propostas ligadas. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [{ id: 1, cnpj_digits: '00000000000201', razao_social: 'Zz Dois Um', linhas_voz: 3, status: 5, na_base: true, consultor_id: 'u-a', dados_claro: {} },
                                          { id: 2, cnpj_digits: '00000000000202', razao_social: 'Zz Sem Proposta', linhas_voz: 1, status: 2, na_base: true, consultor_id: 'u-a', dados_claro: {} }];
  window.__tabelas.propostas = [
    { id: 'p2', carteira_id: 1, valor_atual: 800, valor_proposto: 650, estagio: 'negociacao', criado_em: '2026-11-08T13:00:00Z' },
    { id: 'p1', carteira_id: 1, valor_atual: 800, valor_proposto: 700, estagio: 'fechado_perdido', criado_em: '2026-11-01T13:00:00Z' },
  ];
  window.__tabelas.renovacao_historico = [];
  await rnCarregar();
  await rnAbrirFicha(1);
  const itens = [...document.querySelectorAll('#rnFichaCorpo [data-rn-proposta]')].map(b => b.closest('li').textContent.replace(/\\s+/g, ' '));
  eq(itens.length, 2, 'duas propostas ligadas');
  assert(/800,00 → R\\$\\s?650,00/.test(itens[0]) && /08\\/11\\/2026/.test(itens[0]) && /Negociação/.test(itens[0]), 'mais nova primeiro, com valores, data e estágio: ' + itens[0]);
  assert(/Fechado\\/Perdido/.test(itens[1]), 'estágio da antiga');

  const abriu = []; const abrirOrig = abrirPropostaDoCard; abrirPropostaDoCard = (p) => abriu.push(p.id);
  document.querySelector('#rnFichaCorpo [data-rn-proposta="p2"]').click();
  eq(abriu, ['p2'], 'clicar na proposta reabre no gerador');
  abrirPropostaDoCard = abrirOrig;
  const gerou = []; const gerarOrig = rnGerarProposta; rnGerarProposta = (id) => gerou.push(id);
  document.querySelector('#rnFichaCorpo [data-rn-gerar]').click();
  eq(gerou, [1], 'Gerar proposta na ficha');
  rnGerarProposta = gerarOrig;

  await rnAbrirFicha(2);
  assert(/Nenhuma proposta ainda/.test(document.getElementById('rnFichaCorpo').textContent), 'cliente sem proposta avisa');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_ficha2.js`
Expected: `FALHOU: duas propostas ligadas — esperado 2, veio 0`.

- [ ] **Step 3: Implementar**

3a. Em `rnRenderFicha`, trocar `      : '<span class="kbMeta">Sem telefone.</span>'}</div>` por
```js
      : '<span class="kbMeta">Sem telefone.</span>'}<button type="button" class="kbBtn kbBtnG" data-rn-gerar="${r.id}">Gerar proposta</button></div>
```

3b. Em `rnRenderFicha`, antes de `    <h4>Histórico</h4>`, inserir:
```js
    <h4>Propostas</h4>
    ${rnPropostasDe(r.id).length
      ? '<ul class="rnHist">' + rnPropostasDe(r.id).map(p => `<li><button type="button" class="rnNome" data-rn-proposta="${escapeHtml(p.id)}">${p.valor_atual ? fmtBRL(p.valor_atual) : '—'} → ${p.valor_proposto ? fmtBRL(p.valor_proposto) : '—'}</button> · ${escapeHtml(new Date(p.criado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} · ${escapeHtml(FUNIL_ESTAGIO_MAP[p.estagio] ? FUNIL_ESTAGIO_MAP[p.estagio].label : p.estagio)}</li>`).join('') + '</ul>'
      : '<p class="kbMeta">Nenhuma proposta ainda.</p>'}
```

3c. Depois de `document.getElementById('rnFicha').addEventListener('click', (e) => { if(e.target.closest('[data-rn-ficha-fechar]')) rnFecharFicha(); });` inserir:
```js
document.getElementById('rnFicha').addEventListener('click', (e) => {
  const g = e.target.closest('[data-rn-gerar]');
  if(g){ rnGerarProposta(Number(g.dataset.rnGerar)); return; }
  const b = e.target.closest('[data-rn-proposta]');
  if(!b) return;
  const p = (rnEstado.propostas || []).find(x => x.id === b.dataset.rnProposta);
  if(p) abrirPropostaDoCard(p);
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js; do node $t | tail -1; done`
Expected: todos `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_ficha2.js _template.html
git commit -m "feat(renovacao): ficha com Gerar proposta e propostas ligadas (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Subaba Proposta e fatura

**Files:**
- Create: `test_renovacao_subaba_proposta.js`
- Modify: `_template.html` (botão e `div`, `rnRender`, handler do menu, código antes do marcador)

**Interfaces:**
- Consumes: `#panel-proposta` (formulário avulso + Analisar Fatura), `rnTrocarAba` da Task 3.
- Produces: `rnMoverProposta(paraRenovacao: boolean)`; subaba `proposta`.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_subaba_proposta.js`:

```js
// Testa a §143.2 — subaba Proposta e fatura (mesmo conteúdo da aba Proposta, movido). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [];
  await rnCarregar();
  const dentro = (id) => document.getElementById('avTipo').closest('#' + id);
  assert(!!dentro('panel-proposta'), 'começa na aba Proposta');
  assert(!!document.querySelector('#rnAbas [data-rn-aba="proposta"]'), 'botão da subaba');
  eq([...document.querySelectorAll('#rnAbas [data-rn-aba]')].map(b => b.dataset.rnAba), ['carteira', 'kanban', 'proposta', 'retornos', 'resumo'], 'ordem das subabas');
  rnTrocarAba('proposta');
  assert(!!dentro('rnProposta') && !document.getElementById('rnProposta').hidden, 'formulário vai para a subaba');
  eq(document.getElementById('panel-proposta').children.length, 0, 'nada duplicado');
  document.querySelector('#tabsNav button[data-tab="proposta"]').click();
  await espera(20);
  assert(!!dentro('panel-proposta'), 'aba Proposta normal pega o formulário de volta');
  document.getElementById('tabBtnRenovacao').click();
  await espera(20);
  rnTrocarAba('proposta');
  assert(!!dentro('rnProposta'), 'e volta para a subaba de novo');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_subaba_proposta.js`
Expected: `FALHOU: botão da subaba`.

- [ ] **Step 3: Implementar**

3a. Markup: depois de `          <button type="button" data-rn-aba="kanban">Kanban</button>` inserir
```html
          <button type="button" data-rn-aba="proposta">Proposta e fatura</button>
```
e depois de `      <div id="rnKanban" class="rnVisao" hidden></div>` inserir
```html
      <div id="rnProposta" class="rnVisao" hidden></div>
```

3b. Em `rnRender`, depois da linha do kanban:
```js
  if(rnEstado.aba === 'proposta') rnMoverProposta(true);
```

3c. No handler do menu (`tabsNav`), depois de `  if(btn.dataset.tab === 'renovacao'){ … }`:
```js
  if(btn.dataset.tab === 'proposta') rnMoverProposta(false);   // §143.2: o formulário pode estar na subaba da Renovação
```

3d. Antes do marcador `FIM RENOVAÇÃO §143`:
```js
// ---- §143.2 Proposta e fatura: os mesmos nós da aba Proposta (mesmo código e mesmos eventos), movidos, não copiados ----
function rnMoverProposta(paraRenovacao){
  const de = document.getElementById(paraRenovacao ? 'panel-proposta' : 'rnProposta');
  const para = document.getElementById(paraRenovacao ? 'rnProposta' : 'panel-proposta');
  if(!de || !para) return;
  while(de.firstChild) para.appendChild(de.firstChild);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js test_tipo_avulsa.js test_analisar_fatura.js test_proposta_manual.js; do node $t | tail -1; done`
Expected: todos `0 falharam` / `PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_subaba_proposta.js _template.html
git commit -m "feat(renovacao): subaba Proposta e fatura com o mesmo formulário da aba Proposta (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Funil antigo segue a Renovação

**Files:**
- Create: `test_renovacao_funil.js`
- Modify: `_template.html` (`kanbanCardHtml`, `moverCard`, `abrirCardFunil`, código antes do marcador)

**Interfaces:**
- Consumes: `funilCache`, `renderFunil`, `moverCard`, `abrirCardFunil`, `rnPodeVer`, `rnCarregar`, `rnAbrirFicha`.
- Produces: `rnAbrirNaRenovacao(carteiraId)`; cartão do funil com `p.carteira_id` não arrastável, com selo "Renovação"; `moverCard` recusa proposta ligada com aviso.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_funil.js`:

```js
// Testa a §143.2 — funil antigo com proposta ligada à Renovação. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex' };
  funilCache = [
    { id: 'pL', cliente_nome: 'Zz Ligada', estagio: 'negociacao', carteira_id: 7, consultor_id: 'u-a', estagio_entrada_em: '2026-11-08T12:00:00Z' },
    { id: 'pS', cliente_nome: 'Zz Solta', estagio: 'proposta_enviada', carteira_id: null, consultor_id: 'u-a', estagio_entrada_em: '2026-11-08T12:00:00Z' },
  ];
  renderFunil();
  const cL = document.querySelector('.kanbanCard[data-id="pL"]'), cS = document.querySelector('.kanbanCard[data-id="pS"]');
  eq([cL.getAttribute('draggable'), cS.getAttribute('draggable')], ['false', 'true'], 'ligada não arrasta');
  assert(/Renovação/.test(cL.textContent) && !/Renovação/.test(cS.textContent), 'selo Renovação só na ligada');

  let aviso = null; const avisoOrig = mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  window.__escritas.length = 0;
  await moverCard('pL', 'fechado_ganho');
  eq([window.__escritas.length, aviso && aviso[1]], [0, 'info'], 'mover a ligada não grava e avisa');
  assert(/aba Renovação/.test(aviso[0]), 'aviso manda para a Renovação');
  await moverCard('pS', 'negociacao');
  eq(window.__escritas.filter(w => w.tabela === 'propostas').map(w => w.patch.estagio), ['negociacao'], 'a solta continua movendo');
  mostrarAviso = avisoOrig;

  window.__tabelas.propostas_historico = [];
  await abrirCardFunil('pL');
  await espera(20);
  assert(!document.getElementById('funilCardEstagioSelect'), 'ligada sem "Mover para"');
  const abriu = []; const abrirOrig = rnAbrirNaRenovacao; rnAbrirNaRenovacao = (id) => abriu.push(id);
  document.getElementById('btnAbrirNaRenovacao').click();
  eq(abriu, [7], 'Abrir na Renovação leva o cliente certo');
  rnAbrirNaRenovacao = abrirOrig;
  await abrirCardFunil('pS');
  await espera(20);
  assert(!!document.getElementById('funilCardEstagioSelect') && !document.getElementById('btnAbrirNaRenovacao'), 'solta continua com "Mover para"');

  // rnAbrirNaRenovacao abre a aba e a ficha
  window.__tabelas.renovacao_carteira = [{ id: 7, cnpj_digits: '00000000000207', razao_social: 'Zz Ligada', status: 5, na_base: true, consultor_id: 'u-a', dados_claro: {} }];
  window.__tabelas.renovacao_historico = [];
  rnAplicarPermissao();
  await rnAbrirNaRenovacao(7);
  await espera(40);
  assert(document.getElementById('tabBtnRenovacao').classList.contains('active') && document.getElementById('rnFicha').classList.contains('aberta'), 'abre a aba e a ficha');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_funil.js`
Expected: `FALHOU: ligada não arrasta`.

- [ ] **Step 3: Implementar**

3a. Em `kanbanCardHtml`, trocar
```js
    <div class="kanbanCard" draggable="true" data-id="${p.id}">
      <div class="kcNome">${p.cliente_nome}</div>
```
por
```js
    <div class="kanbanCard${p.carteira_id ? ' kcRenovacao' : ''}" draggable="${p.carteira_id ? 'false' : 'true'}" data-id="${p.id}">
      <div class="kcNome">${p.cliente_nome}</div>
      ${p.carteira_id ? '<div class="kcMeta"><span class="badge">Renovação</span></div>' : ''}
```

3b. Em `moverCard`, trocar
```js
  const proposta = funilCache.find(p => p.id === id);
  if(!proposta || proposta.estagio === novoEstagio) return;
```
por
```js
  const proposta = funilCache.find(p => p.id === id);
  if(!proposta || proposta.estagio === novoEstagio) return;
  // §143.2: proposta ligada à carteira segue o status do cliente na Renovação (o banco também recalcula)
  if(proposta.carteira_id){ mostrarAviso('Esta proposta segue o status do cliente na aba Renovação. Mude por lá.', 'info'); renderFunil(); return; }
```

3c. Em `abrirCardFunil`, trocar
```js
    <div class="field" style="margin-bottom:16px">
      <label>Mover para</label>
      <select id="funilCardEstagioSelect">
        ${FUNIL_ESTAGIOS.map(e => `<option value="${e.id}" ${e.id === p.estagio ? 'selected' : ''}>${e.label}</option>`).join('')}
      </select>
    </div>
```
por
```js
    ${p.carteira_id
      ? `<p class="kbMeta" style="margin-bottom:8px">O estágio segue o status do cliente na Renovação.</p><button class="btn btn-outline" id="btnAbrirNaRenovacao" style="margin-bottom:16px">Abrir na Renovação</button>`
      : `<div class="field" style="margin-bottom:16px">
      <label>Mover para</label>
      <select id="funilCardEstagioSelect">
        ${FUNIL_ESTAGIOS.map(e => `<option value="${e.id}" ${e.id === p.estagio ? 'selected' : ''}>${e.label}</option>`).join('')}
      </select>
    </div>`}
```
e trocar
```js
  document.getElementById('funilCardEstagioSelect').addEventListener('change', function(){ moverCard(p.id, this.value); });
```
por
```js
  const selEstagio = document.getElementById('funilCardEstagioSelect');
  if(selEstagio) selEstagio.addEventListener('change', function(){ moverCard(p.id, this.value); });
  const btnRenov = document.getElementById('btnAbrirNaRenovacao');
  if(btnRenov) btnRenov.addEventListener('click', () => { fecharOverlay(document.getElementById('funilCardOverlay')); rnAbrirNaRenovacao(p.carteira_id); });
```

3d. Antes do marcador `FIM RENOVAÇÃO §143`:
```js
// ---- §143.2 Atalho do funil antigo: abre a aba Renovação na ficha do cliente ----
async function rnAbrirNaRenovacao(carteiraId){
  const bt = document.getElementById('tabBtnRenovacao');
  if(!rnPodeVer() || !bt){ mostrarAviso('Você não tem acesso à aba Renovação.', 'info'); return; }
  bt.click();
  if(!rnEstado.carregado) await rnCarregar();
  if(rnEstado.lista.some(r => r.id === carteiraId)) rnAbrirFicha(carteiraId);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js test_funil.js; do node $t | tail -1; done`
Expected: todos `0 falharam` / `PASSARAM`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_funil.js _template.html
git commit -m "feat(funil): proposta ligada segue a Renovação — sem arrastar e atalho para a ficha (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Time de renovação sem as abas antigas

**Files:**
- Create: `test_renovacao_abas_time.js`
- Modify: `_template.html` (`rnAplicarPermissao`, atalho `#dashFunil [data-tab="funil"]`)

**Interfaces:**
- Consumes: `rnAplicarPermissao`, `rnTrocarAba`.
- Produces: para consultor com `equipe = 'renovacao'`, botões `busca`/`proposta`/`funil`/`agenda` com `display:none`; para os demais, `display:''`. Atalho "Ver funil completo" leva o time ao Kanban da Renovação.

- [ ] **Step 1: Escrever o teste (vai falhar)**

Criar `test_renovacao_abas_time.js`:

```js
// Testa a §143.2 — o time de renovação vê só a Renovação no lugar de Busca/Proposta/Funil/Agenda. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const vis = () => ['busca', 'proposta', 'funil', 'agenda', 'renovacao'].map(t => document.querySelector('#tabsNav button[data-tab="' + t + '"]').style.display);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(vis(), ['none', 'none', 'none', 'none', 'inline-block'], 'time: só a Renovação');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao();
  eq(vis(), ['', '', '', '', 'none'], 'consultor fora do time: abas antigas de volta');
  currentUser = { id: 'u-adm', nome: 'Zzadm Teste', role: 'admin', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  eq(vis(), ['', '', '', '', 'inline-block'], 'admin vê tudo');

  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [];
  document.querySelector('#dashFunil [data-tab="funil"]').click();
  await espera(30);
  assert(document.getElementById('tabBtnRenovacao').classList.contains('active') && rnEstado.aba === 'kanban', '"Ver funil completo" leva o time ao Kanban');
  currentUser = { id: 'u-x', nome: 'Zzx Teste', role: 'consultor', operacao: 'apex', equipe: null };
  rnAplicarPermissao();
  document.querySelector('#dashFunil [data-tab="funil"]').click();
  await espera(30);
  assert(document.querySelector('#tabsNav button[data-tab="funil"]').classList.contains('active'), 'os demais continuam indo ao Funil');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `python build_painel.py >/dev/null && node test_renovacao_abas_time.js`
Expected: `FALHOU: time: só a Renovação`.

- [ ] **Step 3: Implementar**

3a. Em `rnAplicarPermissao`, depois da linha `  document.getElementById('tabBtnRenovacao').style.display = rnPodeVer() ? 'inline-block' : 'none';` inserir:
```js
  // §143.2: o time de renovação trabalha só pela aba Renovação (Busca, Proposta, Funil e Agenda saem do menu dele)
  const soRenovacao = rnSoRenovacao();
  ['busca', 'proposta', 'funil', 'agenda'].forEach(t => { const b = document.querySelector(`#tabsNav button[data-tab="${t}"]`); if(b) b.style.display = soRenovacao ? 'none' : ''; });
```
e, logo antes de `function rnAplicarPermissao(){`, inserir:
```js
function rnSoRenovacao(){ return !!currentUser && currentUser.role === 'consultor' && currentUser.equipe === 'renovacao'; }
```

3b. Trocar
```js
  el.addEventListener('click', () => document.querySelector('#tabsNav button[data-tab="funil"]').click());
```
por
```js
  el.addEventListener('click', () => {
    if(rnSoRenovacao()){ document.getElementById('tabBtnRenovacao').click(); rnTrocarAba('kanban'); return; }   // §143.2
    document.querySelector('#tabsNav button[data-tab="funil"]').click();
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `python build_painel.py >/dev/null && for t in test_renovacao_*.js test_reorganizacao_abas.js test_sidebar_nav.js test_agencia_lista.js test_conversao_leads.js; do node $t | tail -1; done`
Expected: todos `0 falharam` / `OK`.

- [ ] **Step 5: Commit**

```bash
git add test_renovacao_abas_time.js _template.html
git commit -m "feat(renovacao): time de renovação sem Busca/Proposta/Funil/Agenda (§143.2)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Documentação, testes, produção (produção só com ok do Rafael, passo a passo)

- [ ] **Step 1: REGRAS e spec.** Em `REGRAS_NEGOCIO.md`, dentro da §143, trocar a linha `- **Fase 2 (§143.2, a fazer):** …` (2 linhas) por:

```markdown
### §143.2 Fase 2 — Kanban, proposta ligada à carteira e uma aba só

- **Kanban** (subaba): colunas 3-Contato efetivo · 4-Proposta enviada · 5-Em negociação · 6-Renovado · 7-Perdido; arrastar
  muda o status (6/7 abrem a janela do fechamento); cartão com linhas, valor da proposta mais nova e dias no status
  (`renovacao_carteira.status_desde`).
- **Gerar proposta** (ficha e cartão): abre o gerador com a linha de `clientes` do CNPJ (ou, se faltar, com os dados da
  Claro) e liga a proposta ao cliente (`propostas.carteira_id`). Ao gerar, cliente em 1–3 vai para 4-Proposta enviada.
  A ficha lista as propostas ligadas (valor atual → proposto, data, estágio) e reabre no gerador.
- **Estágio da proposta ligada = status da carteira** (1–4 proposta enviada, 5 negociação, 6 ganho, 7 perdido), calculado no
  banco (`propostas_estagio_da_carteira`); mudar o status empurra as propostas abertas, com histórico e motivo da perda
  (`renovacao_carteira_sync_propostas`). Fechadas não reabrem. Nunca há caminho proposta → carteira.
- **Funil antigo:** cartão ligado tem selo "Renovação", não arrasta e oferece "Abrir na Renovação".
- **Proposta e fatura** (subaba): o mesmo formulário da aba Proposta (os nós são movidos entre a aba e a subaba).
- **Time de renovação** (consultor com equipe renovação): Busca, Proposta, Funil e Agenda saem do menu; "Ver funil
  completo" leva ao Kanban. Admin e supervisor continuam vendo tudo.
- Banco: migration `20261109150000_renovacao_fase2.sql` (liga as propostas antigas pelo CNPJ ao aplicar); conferência
  `supabase/tests/renovacao_fase2_check.sql`.
```

Na spec (§6), trocar o item "**Funil antigo:** … recusa mudança de `estagio` …" por: "**Funil antigo:** cartão com `carteira_id` mostra "Abrir na Renovação" e não pode ser arrastado. No banco, o estágio de proposta ligada é sempre calculado a partir do status da carteira (na criação e em qualquer tentativa de mudança); assim, gerar de novo pelo funil não falha."

- [ ] **Step 2: Testes alvo e HTML.** `python build_painel.py`; rodar `test_renovacao_*.js`, `test_funil.js`, `test_tipo_avulsa.js`, `test_analisar_fatura.js`, `test_proposta_manual.js`, `test_reorganizacao_abas.js`, `test_sidebar_nav.js`, `test_agencia_lista.js`, `test_conversao_leads.js`, `test_mailing.js` (a suíte inteira só se a memória da máquina permitir); conferir `<div>` abre = fecha. Commit `docs(regras): §143.2`.

- [ ] **Step 3: Produção — banco (pedir ok).** Mostrar a migration e o efeito (coluna nova em `propostas`, triggers, ~25 propostas ligadas). Com ok: aplicar com `execute_sql`; conferir objetos; rodar `renovacao_fase2_check.sql` (rollback) no banco real; `get_advisors security` filtrando os objetos novos.

- [ ] **Step 4: Produção — painel (pedir ok).** `git fetch oficial` e juntar se andou; build; comparar o ar com o gerado do oficial; envio com conferência do MD5 do ar no mesmo comando (temporário + `mv`), backup; conferir pela URL pública; REGRAS com MD5/backup; push oficial; `vigia_painel.ps1 -Aceitar`.
