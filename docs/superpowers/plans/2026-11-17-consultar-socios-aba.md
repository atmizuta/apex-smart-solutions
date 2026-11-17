# Aba "Consultar sócios" (§157) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba nova "Consultar sócios" (grupo Vendas) onde qualquer consultor da Apex digita um CNPJ e vê sócios (base da Receita na hora + Nova Vida guardada ou pelo robô), com limite de 20/dia somado à Renovação.

**Architecture:** Só banco + painel. Uma RPC `socios_pedir_cnpj` faz permissão, DV, limite, guardado de 30 dias e fila;
`socios_robo_pegar` passa a juntar pedidos do mesmo CNPJ e um gatilho espalha o resultado. O painel ganha a aba com
prefixo `sc*` e reaproveita o desenho dos estados da §156, extraído para `socEstadoHtml`. Robô, workflow e Edge não mudam.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql, gatilho), HTML/JS `_template.html` + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-17-consultar-socios-aba-design.md` (e, para o que não for dito, a da §156).

## Global Constraints

- Repositório **público**: dados de teste fictícios (empresa "ZZ …", CNPJ válido `11222333000181`, inválido `11222333000182`,
  outro válido `11444777000161`, CPF `12345678909`, telefones `119000000xx`).
- Worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\consulta-socios`, branch `feat/socios-avulsa` (de `oficial/main` e3792cb).
- **Produção só com ok do Rafael naquele momento** (CLAUDE.md global): aplicar a migration, publicar, push no oficial. Cada ok vale para uma ação.
- SQL pelo conector com `begin; … commit;`; **sem `DROP`** (o conector falha); gatilho e policy criados dentro de `do $$ … if not exists … $$`.
- Painel: editar só `_template.html`, LF, sem cor nova, raios por token (`--radius-lg`), classes existentes + `rnSoc*`.
- Números: limite **20**/dia (todas as origens, dia de São Paulo); guardado **30 dias**; releitura **5 s**; Tentar de novo
  após **3 min** pendente / **10 min** consultando.
- Nomes: RPCs `socios_pedir_cnpj(text, boolean)`, `socios_base_do_pedido(bigint)`; internas `socios_cnpj_valido(text)`,
  `socios_base_json(text)`, `socios_pode_avulsa()`, `socios_propagar_resultado()`; gatilho `socios_propagar`;
  colunas `razao_social`, `copiado_de`; origem `'avulsa'`; aba `data-tab="socios"`, botão `#tabBtnSocios`, painel `#panel-socios`.

## Review Focus

1. **Tentar de novo / duplo clique do próprio consultor** com pedido dele ainda em andamento: não pode gravar outra linha nem
   gastar limite (a RPC devolve o pedido dele). Teste na Task 1 (CASO 4).
2. **Pedido novo chegando enquanto o robô já consulta o mesmo CNPJ**: não pode virar uma 2ª consulta na Nova Vida
   (`socios_robo_pegar` ignora CNPJ com `consultando`) e tem que receber o resultado pelo gatilho. Teste na Task 1 (CASOS 6–7).
3. **Resultado guardado como porta para ver CPF sem limite**: guardado conta no limite; `socios_base_json` não é chamável
   pelo navegador. Teste na Task 1 (CASOS 11 e 14).
4. **Releitura rodando com a aba fechada** ou depois de trocar de usuário. Teste na Task 3.
5. **Refatoração quebrando a aba Sócios da Renovação**: `test_renovacao_socios.js` tem que continuar 43/43. Task 2.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20261117130000_socios_avulsa.sql` (novo) | colunas, policy, 5 funções, nova `socios_robo_pegar`, gatilho, grants |
| `supabase/tests/socios_avulsa_verificar.sql` (novo) | verificação em transação com rollback |
| `_template.html` (modificar) | `socEstadoHtml` extraído; botão, painel e funções `sc*` |
| `test_socios_aba.js` (novo) | testes jsdom da aba (usa `renovacao_test_harness.js`) |
| `REGRAS_NEGOCIO.md` (fim) | §157 |

---

### Task 1: Banco — RPC do campo livre, juntar pedidos do mesmo CNPJ

**Files:** Create `supabase/migrations/20261117130000_socios_avulsa.sql`, `supabase/tests/socios_avulsa_verificar.sql`

**Interfaces:**
- Produces: `socios_pedir_cnpj(p_cnpj text, p_atualizar boolean default false) → jsonb`:
  `{ok:true, id, status, guardado?:true, razao_social, base:{receita_mes, socios:[{nome,cpf,principal,obito}]}}` |
  `{ok:false, motivo:'sem_permissao'|'cnpj_invalido'|'limite'}`;
  `socios_base_do_pedido(p_id bigint) → jsonb` `{ok:true, razao_social, base}` | `{ok:false, motivo:'sem_permissao'}`;
  `socios_robo_pegar(p_max int) → table(id bigint, cnpj text)` (um por CNPJ).

- [ ] **Step 1: Escrever a verificação** `supabase/tests/socios_avulsa_verificar.sql`

```sql
-- Verificação da §157 no banco. Tudo em transação desfeita no fim. Saída: só 'OK' ou a exceção com o caso.
begin;
do $prep$
declare v_a uuid; v_b uuid; v_c uuid; v_sup uuid;
begin
  select id into v_a from public.profiles where role = 'consultor' and operacao = 'apex' order by id limit 1;
  select id into v_b from public.profiles where role = 'consultor' and operacao = 'apex' and id <> v_a order by id limit 1;
  select id into v_c from public.profiles where operacao = 'campinas' and role = 'consultor' order by id limit 1;
  select id into v_sup from public.profiles where role in ('admin','supervisor') order by id limit 1;
  if v_a is null or v_b is null or v_c is null or v_sup is null then raise exception 'PREP: faltam atores'; end if;
  if exists (select 1 from public.renovacao_carteira where cnpj_digits in ('11222333000181','11444777000161')) then raise exception 'PREP: CNPJ de teste está na carteira'; end if;
  perform set_config('t.a', v_a::text, true); perform set_config('t.b', v_b::text, true);
  perform set_config('t.c', v_c::text, true); perform set_config('t.sup', v_sup::text, true);
end $prep$;

do $t$
declare r jsonb; r2 jsonb; n int; x text := '11222333000181'; y text := '11444777000161';
  como text := '{"role":"authenticated","sub":"%s"}'; v_id bigint; v_outro bigint;
begin
  -- 1. Campinas barrado
  perform set_config('request.jwt.claims', format(como, current_setting('t.c')), true);
  r := public.socios_pedir_cnpj(x);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1: campinas: %', r; end if;
  -- 2. DV errado
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  r := public.socios_pedir_cnpj('11.222.333/0001-82');
  if r->>'motivo' is distinct from 'cnpj_invalido' then raise exception 'CASO 2: DV: %', r; end if;
  -- 3. A pede X (com pontuação): pendente, disparado, base é objeto
  r := public.socios_pedir_cnpj('11.222.333/0001-81');
  if (r->>'ok')::boolean is not true or r->>'status' <> 'pendente' or jsonb_typeof(r->'base'->'socios') <> 'array' then raise exception 'CASO 3: %', r; end if;
  v_id := (r->>'id')::bigint;
  if not exists (select 1 from public.socios_consultas where id = v_id and origem = 'avulsa' and disparado_em is not null) then raise exception 'CASO 3b'; end if;
  -- 4. A pede X de novo: mesmo pedido, nenhuma linha nova
  r2 := public.socios_pedir_cnpj(x);
  if (r2->>'id')::bigint <> v_id then raise exception 'CASO 4: criou outra linha'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = x;
  if n <> 1 then raise exception 'CASO 4b: % linhas', n; end if;
  -- 5. B pede X: linha nova pendente
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.socios_pedir_cnpj(x);
  v_outro := (r->>'id')::bigint;
  if v_outro = v_id or r->>'status' <> 'pendente' then raise exception 'CASO 5: %', r; end if;
  -- 6. robô pega: um por CNPJ, os dois viram consultando
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 1 then raise exception 'CASO 6: pegou % do mesmo CNPJ', n; end if;
  if (select count(*) from public.socios_consultas where cnpj_digits = x and status = 'consultando') <> 2 then raise exception 'CASO 6b'; end if;
  -- 6c. pedido novo de X com consulta em andamento não é pego de novo
  perform set_config('request.jwt.claims', format(como, current_setting('t.sup')), true);
  perform public.socios_pedir_cnpj(x);
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 0 then raise exception 'CASO 6c: pegou CNPJ que já está em consulta'; end if;
  -- 7. resultado de um vale para todos (gatilho)
  update public.socios_consultas set status = 'pronto', concluido_em = now(),
         resultado = '{"socios":[{"nome":"ZZ SOCIO","cpf":"12345678909","participacao":100,"telefones_consultados":false,"telefones":[]}]}'
   where id = (select min(id) from public.socios_consultas where cnpj_digits = x and status = 'consultando');
  if (select count(*) from public.socios_consultas where cnpj_digits = x and status = 'pronto' and resultado is not null) <> 3 then raise exception 'CASO 7: gatilho não copiou'; end if;
  -- 8. guardado: B pede X de novo → linha nova pronta, copiado_de, sem disparo
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.socios_pedir_cnpj(x);
  if (r->>'guardado')::boolean is not true or r->>'status' <> 'pronto' then raise exception 'CASO 8: %', r; end if;
  if not exists (select 1 from public.socios_consultas where id = (r->>'id')::bigint and copiado_de is not null and disparado_em is null) then raise exception 'CASO 8b'; end if;
  -- 9. atualizar ignora o guardado
  r := public.socios_pedir_cnpj(x, true);
  if r ? 'guardado' or r->>'status' <> 'pendente' then raise exception 'CASO 9: %', r; end if;
  -- 10. guardado de 31 dias não vale
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, resultado, concluido_em, pedido_em)
    values (y, 'avulsa', current_setting('t.b')::uuid, 'pronto', '{"socios":[]}', now() - interval '31 days', now() - interval '31 days');
  r := public.socios_pedir_cnpj(y);
  if r ? 'guardado' or r->>'status' <> 'pendente' then raise exception 'CASO 10: %', r; end if;
  -- 11. limite somando origens: A com 20 no dia → barrado (guardado também conta)
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  select count(*) into n from public.socios_consultas where pedido_por = current_setting('t.a')::uuid
     and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status)
    select '00000000000191', 'renovacao', current_setting('t.a')::uuid, 'pronto' from generate_series(1, 20 - n);
  r := public.socios_pedir_cnpj(x);
  if r->>'motivo' is distinct from 'limite' then raise exception 'CASO 11: guardado passou do limite: %', r; end if;
  -- 12. base do pedido: alheio barrado, próprio ok
  r := public.socios_base_do_pedido(v_outro);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 12a'; end if;
  r := public.socios_base_do_pedido(v_id);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 12b'; end if;
end $t$;

-- 13/14. como authenticated: vê só as próprias avulsas; não chama socios_base_json
set local role authenticated;
do $rls$
declare n int;
begin
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('t.a')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = '11222333000181' and pedido_por <> auth.uid();
  if n <> 0 then raise exception 'CASO 13a: A vê % pedidos alheios', n; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = '11222333000181' and pedido_por = auth.uid();
  if n < 1 then raise exception 'CASO 13b: A não vê os próprios'; end if;
  begin
    perform public.socios_base_json('11222333000181');
    raise exception 'CASO 14: authenticated chamou socios_base_json';
  exception when insufficient_privilege then null;
  end;
end $rls$;
reset role;
select 'OK' as verificacao;
rollback;
```

- [ ] **Step 2: Rodar e ver falhar** (é produção, mas tudo é desfeito): Expected `function public.socios_pedir_cnpj(...) does not exist`.

- [ ] **Step 3: Escrever a migration** `supabase/migrations/20261117130000_socios_avulsa.sql`

```sql
-- §157 (17/11/2026, pedido do Rafael): aba "Consultar sócios" (campo livre) para o time da Apex.
-- Spec: docs/superpowers/specs/2026-11-17-consultar-socios-aba-design.md (seção 4). Sem DROP (conector).
begin;

alter table public.socios_consultas add column if not exists razao_social text;
alter table public.socios_consultas add column if not exists copiado_de bigint references public.socios_consultas(id) on delete set null;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'socios_consultas' and policyname = 'socios_consultas_select_proprio') then
    create policy socios_consultas_select_proprio on public.socios_consultas for select to authenticated using (pedido_por = auth.uid());
  end if;
end $pol$;

create or replace function public.socios_cnpj_valido(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d !~ '^[0-9]{14}$' or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
  r := s % 11; if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
  r := s % 11; return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
end $$;

create or replace function public.socios_pode_avulsa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
                  and (p.role in ('admin','supervisor') or (p.role = 'consultor' and p.operacao = 'apex')));
$$;

-- base da Receita de um CNPJ (mesmo formato da socios_da_base, §156). Interna: nunca chamável pelo navegador.
create or replace function public.socios_base_json(p_cnpj text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'receita_mes', (select k.receita_mes from mailing.carga k order by k.carregado_em desc limit 1),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('nome', s.nome, 'cpf', s.cpf,
                          'principal', coalesce(s.principal, false), 'obito', coalesce(s.obito, false))
                          order by coalesce(s.principal, false) desc, s.nome)
                        from mailing.socio s where s.cnpj = p_cnpj), '[]'::jsonb));
$$;

create or replace function public.socios_pedir_cnpj(p_cnpj text, p_atualizar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'); v_eu uuid := auth.uid();
  v_ped public.socios_consultas; v_ref public.socios_consultas; v_hoje int; v_razao text; v_extra jsonb;
begin
  if v_eu is null or not public.socios_pode_avulsa() then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if not public.socios_cnpj_valido(v_cnpj) then return jsonb_build_object('ok', false, 'motivo', 'cnpj_invalido'); end if;
  perform pg_advisory_xact_lock(hashtext('socios:' || v_cnpj));
  select e.razao_social into v_razao from mailing.empresa e where e.cnpj = v_cnpj;
  v_extra := jsonb_build_object('razao_social', v_razao, 'base', public.socios_base_json(v_cnpj));

  update public.socios_consultas set status = 'erro', erro = 'A consulta não terminou.', concluido_em = now()
   where cnpj_digits = v_cnpj and status = 'consultando' and iniciado_em < now() - interval '10 minutes';

  -- meu pedido ainda em andamento (Tentar de novo / duplo clique): devolve o mesmo, sem linha nova nem limite
  select * into v_ped from public.socios_consultas
   where cnpj_digits = v_cnpj and pedido_por = v_eu and status in ('pendente','consultando') order by pedido_em desc limit 1;
  if found then
    if v_ped.status = 'pendente' and (v_ped.disparado_em is null or v_ped.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where cnpj_digits = v_cnpj and status = 'pendente';
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status) || v_extra;
  end if;

  select count(*) into v_hoje from public.socios_consultas
   where pedido_por = v_eu and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_hoje >= 20 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;

  if not coalesce(p_atualizar, false) then
    select * into v_ref from public.socios_consultas
     where cnpj_digits = v_cnpj and status in ('pronto','sem_socios') and concluido_em > now() - interval '30 days'
     order by concluido_em desc limit 1;
    if found then
      insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, resultado, concluido_em, copiado_de, razao_social)
           values (v_cnpj, 'avulsa', v_eu, v_ref.status, v_ref.resultado, v_ref.concluido_em, coalesce(v_ref.copiado_de, v_ref.id), v_razao)
        returning * into v_ped;
      return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status, 'guardado', true) || v_extra;
    end if;
  end if;

  -- outro consultor já pediu este CNPJ: entra junto (o gatilho entrega o resultado para todos)
  select * into v_ref from public.socios_consultas
   where cnpj_digits = v_cnpj and status in ('pendente','consultando') order by pedido_em limit 1;
  if found then
    insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, disparado_em, razao_social)
         values (v_cnpj, 'avulsa', v_eu, 'pendente', v_ref.disparado_em, v_razao) returning * into v_ped;
    if v_ref.status = 'pendente' and (v_ref.disparado_em is null or v_ref.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where cnpj_digits = v_cnpj and status = 'pendente';
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', 'pendente') || v_extra;
  end if;

  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, disparado_em, razao_social)
       values (v_cnpj, 'avulsa', v_eu, now(), v_razao) returning * into v_ped;
  perform public.socios_disparar_robo();
  return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', 'pendente') || v_extra;
end $$;

create or replace function public.socios_base_do_pedido(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.socios_consultas;
begin
  select * into v from public.socios_consultas where id = p_id;
  if not found or auth.uid() is null or not (v.pedido_por = auth.uid() or public.get_my_role() in ('admin','supervisor')) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'razao_social', v.razao_social, 'base', public.socios_base_json(v.cnpj_digits));
end $$;

-- §157: um pedido por CNPJ; marca todos os pendentes do CNPJ; ignora CNPJ que já está em consulta
create or replace function public.socios_robo_pegar(p_max int) returns table(id bigint, cnpj text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_cnpjs text[];
begin
  select array_agg(x.cnpj_digits) into v_cnpjs from (
    select q.cnpj_digits, min(q.pedido_em) as m from public.socios_consultas q
     where q.status = 'pendente'
       and not exists (select 1 from public.socios_consultas c where c.cnpj_digits = q.cnpj_digits and c.status = 'consultando')
     group by q.cnpj_digits order by m limit greatest(1, least(coalesce(p_max, 10), 20))) x;
  if v_cnpjs is null then return; end if;
  update public.socios_consultas s set status = 'consultando', iniciado_em = now()
   where s.status = 'pendente' and s.cnpj_digits = any(v_cnpjs);
  return query select distinct on (s.cnpj_digits) s.id, s.cnpj_digits from public.socios_consultas s
    where s.cnpj_digits = any(v_cnpjs) and s.status = 'consultando' order by s.cnpj_digits, s.pedido_em;
end $$;

-- gatilho: o resultado de um pedido vale para os outros do mesmo CNPJ em andamento
create or replace function public.socios_propagar_resultado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update public.socios_consultas o
     set status = new.status, resultado = new.resultado, erro = new.erro, concluido_em = new.concluido_em
   where o.cnpj_digits = new.cnpj_digits and o.id <> new.id and o.status in ('pendente','consultando');
  return null;
end $$;
do $trg$
begin
  if not exists (select 1 from pg_trigger where tgname = 'socios_propagar' and tgrelid = 'public.socios_consultas'::regclass) then
    create trigger socios_propagar after update of status on public.socios_consultas for each row
      when (old.status = 'consultando' and new.status in ('pronto','sem_socios','erro'))
      execute function public.socios_propagar_resultado();
  end if;
end $trg$;

revoke all on function public.socios_cnpj_valido(text), public.socios_pode_avulsa(), public.socios_base_json(text),
  public.socios_propagar_resultado(), public.socios_robo_pegar(int) from public, anon, authenticated;
grant execute on function public.socios_robo_pegar(int) to service_role;
revoke all on function public.socios_pedir_cnpj(text, boolean), public.socios_base_do_pedido(bigint) from public, anon;
grant execute on function public.socios_pedir_cnpj(text, boolean), public.socios_base_do_pedido(bigint) to authenticated;

commit;
```

- [ ] **Step 4: Pedir ok ao Rafael e aplicar** (produção). Expected: sucesso.
- [ ] **Step 5: Rodar a verificação** → `verificacao = OK`; conferir depois `select count(*) from socios_consultas where cnpj_digits in ('11222333000181','11444777000161')` → 0.
- [ ] **Step 6: Commit** `feat(socios): campo livre — socios_pedir_cnpj, juntar pedidos do mesmo CNPJ (§157)`.

---

### Task 2: Painel — extrair `socEstadoHtml` (refatoração; Renovação igual)

**Files:** Modify `_template.html` (função `rnSociosHtml`); Test: `test_renovacao_socios.js` (já existe, 43 casos)

**Interfaces:**
- Produces: `socEstadoHtml(s, opts) → string`, `s = {base, pedido, ultimo, aviso}`,
  `opts = {pedirAttr: 'data-rn-socios-pedir'|'data-sc-pedir', rodape: 'por'|'nv'}`. Botões levam `${pedirAttr}="tentar"|"atualizar"|"consultar"`.
  `rnSociosHtml()` passa a ser: checagem de `rnEstado.socios`/`fichaId` + `socEstadoHtml(s, {pedirAttr:'data-rn-socios-pedir', rodape:'por'})`.

- [ ] **Step 1:** Rodar `bash run_tests.sh test_renovacao_socios.js` antes → 43/43 (rede de segurança).
- [ ] **Step 2:** Mover o corpo de `rnSociosHtml` (do `const p = s.pedido…` ao `return partes.join('')`) para
  `function socEstadoHtml(s, opts)`: o `botao(txt, cls)` vira `botao(txt, cls, acao)` com `${opts.pedirAttr}="${acao}"`;
  o rodapé usa `opts.rodape === 'nv' ? 'Consultado na Nova Vida em ' + quando : 'Consultado em ' + quando + ' por ' + nome`.
- [ ] **Step 3:** `bash run_tests.sh "test_renovacao_*.js"` → 20/20 e `test_renovacao_socios` 43/43.
- [ ] **Step 4: Commit** `refactor(socios): estados da consulta em socEstadoHtml (reuso na §157)`.

---

### Task 3: Painel — aba "Consultar sócios"

**Files:** Modify `_template.html`; Create `test_socios_aba.js`

**Interfaces:**
- Consumes: `socEstadoHtml`, `rnSociosEmAndamento`, `kbCnpjValido`, `kbCnpjDigitos`, `kbCnpjMascara`, `ppSeguro`, RPCs da Task 1.
- Produces: `canSocios()`, `scAplicarPermissao()`, `scAbrir()`, `scConsultar(cnpj, atualizar)`, `scAbrirPedido(id, extra)`,
  `scReler()`, `scCarregarLista()`, `scParar()`, estado `scEstado = {atual, lista, timer, geracao}`.

- [ ] **Step 1: Teste** `test_socios_aba.js`

```js
// Testa a §157 — aba "Consultar sócios" (campo livre). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const clicar = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const res = () => document.getElementById('scResultado');
  const enviar = (v) => { document.getElementById('scCnpj').value = v; document.getElementById('scForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); };
  const pedidos = () => window.__rpcCalls.filter(c => c.nome === 'socios_pedir_cnpj');
  const BASE = { receita_mes: '2026-09', socios: [{ nome: 'ZZ SOCIA BASE', cpf: '12345678909', principal: true, obito: false }] };
  const RES = { socios: [{ nome: 'ZZ SOCIA NV', cpf: '12345678909', participacao: 100, telefones_consultados: true,
    telefones: [{ tipo: 'celular', numero: '11900000001', operadora: 'CLARO', whatsapp: true }] }] };
  const linha = (o) => Object.assign({ cnpj_digits: '11222333000181', razao_social: 'ZZ EMPRESA TESTE LTDA', pedido_por: 'u-a', pedido_em: new Date().toISOString(), iniciado_em: null, concluido_em: null, resultado: null, erro: null, copiado_de: null }, o);

  // visibilidade
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'campinas', equipe: null }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'none', 'Campinas não vê');
  currentUser = { id: 'u-r', nome: 'Zzr', role: 'consultor', operacao: 'apex', equipe: 'renovacao' }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'none', 'time da Renovação não vê');
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: null }; scAplicarPermissao();
  eq(document.getElementById('tabBtnSocios').style.display, 'inline-block', 'consultor Apex vê');

  window.__tabelas.socios_consultas = [];
  document.querySelector('#tabsNav button[data-tab="socios"]').click(); await espera(30);
  assert(document.getElementById('panel-socios').classList.contains('active'), 'abre a aba');
  assert(/Nenhuma consulta ainda/.test(document.getElementById('scLista').textContent), 'lista vazia');

  // DV inválido não chama o banco
  enviar('11.222.333/0001-82'); await espera(10);
  eq(pedidos().length, 0, 'DV inválido não chama o banco');
  assert(/os dígitos não batem/.test(document.getElementById('scAviso').textContent), 'aviso de DV');

  // resultado guardado
  window.__tabelas.socios_consultas = [linha({ id: 90, status: 'pronto', concluido_em: '2026-11-10T13:00:00Z', resultado: RES, copiado_de: 5 })];
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: true, id: 90, status: 'pronto', guardado: true, razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  enviar('11.222.333/0001-81'); await espera(40);
  eq(pedidos()[0].args, { p_cnpj: '11222333000181', p_atualizar: false }, 'chama com só dígitos');
  assert(/ZZ EMPRESA TESTE LTDA/.test(res().textContent) && /11\\.222\\.333\\/0001-81/.test(res().textContent), 'cabeçalho com razão e CNPJ');
  assert(/ZZ SOCIA NV/.test(res().textContent) && /Consultado na Nova Vida em 10\\/11 10:00/.test(res().textContent), 'guardado com a data original');
  assert(res().querySelector('[data-sc-pedir="atualizar"]'), 'botão Atualizar');
  assert(/ZZ EMPRESA TESTE LTDA/.test(document.getElementById('scLista').textContent) && /pronto · 1 sócio/.test(document.getElementById('scLista').textContent), 'lista com a consulta');

  // Atualizar → p_atualizar true → em andamento → releitura → pronto
  window.__tabelas.socios_consultas.unshift(linha({ id: 91, status: 'pendente' }));
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: true, id: 91, status: 'pendente', razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  clicar('#scResultado [data-sc-pedir="atualizar"]'); await espera(40);
  eq(pedidos().at(-1).args.p_atualizar, true, 'Atualizar ignora o guardado');
  assert(/Consultando na Nova Vida… 0:0\\d/.test(res().textContent) && /ZZ SOCIA BASE/.test(res().textContent), 'em andamento com a base');
  assert(scEstado.timer, 'agendou a releitura');
  Object.assign(window.__tabelas.socios_consultas[0], { status: 'pronto', concluido_em: '2026-11-17T18:00:00Z', resultado: RES });
  await scReler(); await espera(20);
  assert(/Consultado na Nova Vida em 17\\/11 15:00/.test(res().textContent) && !scEstado.timer, 'pronto pela releitura e parou');

  // limite
  window.__rpcRespostas.socios_pedir_cnpj = () => ({ data: { ok: false, motivo: 'limite' }, error: null });
  enviar('11444777000161'); await espera(20);
  assert(/Você já fez 20 consultas hoje/.test(document.getElementById('scAviso').textContent), 'aviso de limite');

  // reabrir da lista não chama socios_pedir_cnpj
  window.__rpcRespostas.socios_base_do_pedido = () => ({ data: { ok: true, razao_social: 'ZZ EMPRESA TESTE LTDA', base: BASE }, error: null });
  const antes = pedidos().length;
  scEstado.atual = null; res().innerHTML = '';
  await scCarregarLista();
  clicar('#scLista [data-sc-abrir="90"]'); await espera(40);
  eq(pedidos().length, antes, 'reabrir não consulta de novo');
  assert(/ZZ SOCIA NV/.test(res().textContent), 'reabriu o resultado');

  // trocar de aba para a releitura; trocar de usuário limpa
  window.__tabelas.socios_consultas[0].status = 'pendente';
  await scAbrirPedido(91); await espera(10);
  assert(scEstado.timer, 'releitura ligada');
  document.querySelector('#tabsNav button[data-tab="busca"]').click(); await espera(10);
  assert(!scEstado.timer, 'sair da aba para a releitura');
  scAplicarPermissao();
  assert(!scEstado.atual && res().innerHTML === '', 'trocar de usuário limpa');
  fim();
`);
```

- [ ] **Step 2:** `bash run_tests.sh test_socios_aba.js` → FAIL (`scAplicarPermissao is not defined`).

- [ ] **Step 3: Botão no menu** (grupo Vendas, logo depois da linha do `data-tab="funil"`):

```html
      <!-- §157: Consultar sócios — operação Apex; o time da Renovação usa a aba Sócios da ficha -->
      <button data-tab="socios" id="tabBtnSocios" style="display:none" data-sub="CPF e telefones dos sócios de qualquer CNPJ"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg><span class="sbLabel">Consultar sócios</span></button>
```

- [ ] **Step 4: Painel** (logo antes de `<section class="panel" id="panel-funil">`):

```html
    <!-- §157 Consultar sócios (campo livre) -->
    <section class="panel" id="panel-socios">
      <form id="scForm" class="rnSocConsultar" autocomplete="off">
        <div class="searchBox" style="flex:1;min-width:220px;margin:0"><input type="text" id="scCnpj" inputmode="numeric" maxlength="18" placeholder="CNPJ da empresa (com ou sem pontuação)"></div>
        <button type="submit" class="kbBtn kbBtnP">Consultar</button>
        <span class="kbMeta">conta 1 das suas 20 consultas do dia</span>
      </form>
      <p class="rnErro" id="scAviso" role="alert"></p>
      <div id="scResultado"></div>
      <h3 class="rnSocNome" style="margin-top:var(--space-6)">Minhas últimas consultas</h3>
      <div id="scLista"></div>
    </section>
```

- [ ] **Step 5: Funções** (depois do bloco `/* ============ FIM RENOVAÇÃO §143 ============ */`):

```js
/* ============ CONSULTAR SÓCIOS — §157 ============ */
const SC_MOTIVO = { limite: 'Você já fez 20 consultas hoje. Amanhã libera de novo.', sem_permissao: 'A consulta de sócios é só para a operação Apex.', cnpj_invalido: 'Confira o CNPJ: os dígitos não batem.' };
const SC_COLS = 'id,cnpj_digits,razao_social,status,pedido_por,pedido_em,iniciado_em,concluido_em,resultado,erro,copiado_de';
const scEstado = { atual: null, lista: [], timer: null, geracao: 0 };
function canSocios(){ return !!currentUser && ['consultor', 'supervisor', 'admin'].includes(currentUser.role) && veAbasDaApex() && !rnSoRenovacao(); }
function scParar(){ if(scEstado.timer){ clearTimeout(scEstado.timer); scEstado.timer = null; } }
function scAvisar(t){ const el = document.getElementById('scAviso'); if(el) el.textContent = t || ''; }
function scVisivel(){ const p = document.getElementById('panel-socios'); return !!p && p.classList.contains('active'); }
function scAplicarPermissao(){
  scParar(); scEstado.atual = null; scEstado.lista = []; scEstado.geracao++;
  const b = document.getElementById('tabBtnSocios'); if(b) b.style.display = canSocios() ? 'inline-block' : 'none';
  ['scResultado', 'scLista'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
  const i = document.getElementById('scCnpj'); if(i) i.value = '';
  scAvisar('');
}
async function scAbrir(){ await scCarregarLista(); scPintar(); scAgendar(); }
async function scCarregarLista(){
  if(!currentUser) return;
  const g = scEstado.geracao;
  const r = await ppSeguro(() => sb.from('socios_consultas').select('id,cnpj_digits,razao_social,status,pedido_em,resultado').eq('pedido_por', currentUser.id).order('pedido_em', { ascending: false }).limit(20));
  if(g !== scEstado.geracao) return;
  scEstado.lista = r && !r.error ? (r.data || []) : [];
  scPintarLista();
}
async function scConsultar(cnpjTexto, atualizar){
  const cnpj = kbCnpjDigitos(cnpjTexto);
  scAvisar('');
  if(!kbCnpjValido(cnpj)){ scAvisar(SC_MOTIVO.cnpj_invalido); return; }
  const g = scEstado.geracao;
  const r = await ppSeguro(() => sb.rpc('socios_pedir_cnpj', { p_cnpj: cnpj, p_atualizar: !!atualizar }));
  if(g !== scEstado.geracao) return;
  const d = r && !r.error ? r.data : null;
  if(!d || !d.ok){ scAvisar((d && SC_MOTIVO[d.motivo]) || 'Não foi possível consultar agora. Tente de novo.'); return; }
  await scAbrirPedido(d.id, { base: d.base, razao: d.razao_social });
  scCarregarLista();
}
async function scAbrirPedido(id, extra){
  scParar();
  const g = scEstado.geracao;
  let base = extra && extra.base, razao = extra && extra.razao;
  const [p, b] = await Promise.all([
    ppSeguro(() => sb.from('socios_consultas').select(SC_COLS).eq('id', id).maybeSingle()),
    base ? Promise.resolve(null) : ppSeguro(() => sb.rpc('socios_base_do_pedido', { p_id: id })),
  ]);
  if(g !== scEstado.geracao) return;
  if(b && !b.error && b.data && b.data.ok){ base = b.data.base; razao = razao || b.data.razao_social; }
  const ped = p && !p.error ? p.data : null;
  if(!ped){ scAvisar('Não foi possível abrir essa consulta.'); return; }
  const final = ped.status === 'pronto' || ped.status === 'sem_socios';
  scEstado.atual = { id, cnpj: ped.cnpj_digits, razao: razao || ped.razao_social, base: base || null, pedido: ped, ultimo: final ? ped : null, aviso: '' };
  scPintar(); scAgendar();
}
function scAgendar(){ scParar(); const a = scEstado.atual; if(a && rnSociosEmAndamento(a.pedido) && scVisivel()) scEstado.timer = setTimeout(scReler, 5000); }
async function scReler(){
  scParar();
  const a = scEstado.atual; if(!a) return;
  const g = scEstado.geracao, id = a.id;
  const r = await ppSeguro(() => sb.from('socios_consultas').select(SC_COLS).eq('id', id).maybeSingle());
  if(g !== scEstado.geracao || !scEstado.atual || scEstado.atual.id !== id) return;
  if(r && !r.error && r.data){
    scEstado.atual.pedido = r.data;
    if(r.data.status === 'pronto' || r.data.status === 'sem_socios') scEstado.atual.ultimo = r.data;
    if(!rnSociosEmAndamento(r.data)) scCarregarLista();
  }
  scPintar(); scAgendar();
}
function scPintar(){
  const el = document.getElementById('scResultado'); if(!el) return;
  const a = scEstado.atual;
  if(!a){ el.innerHTML = ''; return; }
  el.innerHTML = `<div class="rnSoc"><div class="rnSocTopo"><span class="rnSocNome">${escapeHtml(a.razao || 'Empresa sem nome na base')}</span><span class="rnSocPct">${escapeHtml(kbCnpjMascara(a.cnpj))}</span></div>`
    + socEstadoHtml(a, { pedirAttr: 'data-sc-pedir', rodape: 'nv' }) + '</div>';
}
function scSituacao(x){
  if(x.status === 'pronto'){ const n = x.resultado && Array.isArray(x.resultado.socios) ? x.resultado.socios.length : 0; return `pronto · ${n} ${n === 1 ? 'sócio' : 'sócios'}`; }
  return { sem_socios: 'sem sócios', erro: 'erro', pendente: 'em andamento', consultando: 'em andamento' }[x.status] || x.status;
}
function scPintarLista(){
  const el = document.getElementById('scLista'); if(!el) return;
  if(!scEstado.lista.length){ el.innerHTML = '<p class="kbMeta">Nenhuma consulta ainda.</p>'; return; }
  el.innerHTML = scEstado.lista.map(x => {
    const quando = x.pedido_em ? new Date(x.pedido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
    return `<button type="button" class="rnItem" data-sc-abrir="${x.id}"><span style="flex:1;min-width:0;text-align:left"><span class="rnSocNome">${escapeHtml(x.razao_social || kbCnpjMascara(x.cnpj_digits))}</span><span class="kbMeta" style="display:block">${escapeHtml(kbCnpjMascara(x.cnpj_digits))} · ${escapeHtml(quando)} · ${escapeHtml(scSituacao(x))}</span></span></button>`;
  }).join('');
}
document.getElementById('scForm').addEventListener('submit', (e) => { e.preventDefault(); scConsultar(document.getElementById('scCnpj').value, false); });
document.getElementById('panel-socios').addEventListener('click', (e) => {
  const p = e.target.closest('[data-sc-pedir]');
  if(p && scEstado.atual){ scConsultar(scEstado.atual.cnpj, p.dataset.scPedir === 'atualizar'); return; }
  const ab = e.target.closest('[data-sc-abrir]');
  if(ab){ scAbrirPedido(Number(ab.dataset.scAbrir)); return; }
  const cp = e.target.closest('[data-rn-socios-copiar]');
  if(cp){ (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.rnSociosCopiar) : Promise.reject()).then(() => mostrarAviso('CPF copiado.', 'ok'), () => mostrarAviso('Não foi possível copiar.', 'erro')); }
});
/* ============ FIM CONSULTAR SÓCIOS §157 ============ */
```

- [ ] **Step 6: Ligações**: depois de `rnAplicarPermissao();` (login, ~linha 3688) acrescentar `scAplicarPermissao(); // §157`;
  no clique do `tabsNav` acrescentar `if(btn.dataset.tab === 'socios') scAbrir(); else scParar(); // §157`.
- [ ] **Step 7:** `bash run_tests.sh test_socios_aba.js` → PASS; `bash run_tests.sh "test_renovacao_*.js"` → 20/20.
- [ ] **Step 8:** HTML: `<div`/`</div>` balanceadas no painel e nas funções novas; nenhum hex novo; LF.
- [ ] **Step 9: Commit** `feat(socios): aba Consultar sócios para o time da Apex (§157)`.

---

### Task 4: Regras, suíte, teste do Rafael e publicação

- [ ] **Step 1:** `git fetch oficial` + merge; confirmar próxima livre (§157). REGRAS: seção §157 (resumo da spec) e "Próxima livre: §158". Commit.
- [ ] **Step 2:** Suíte inteira; comparar falhas com o `oficial/main` limpo (mesmo procedimento da §156). Nenhuma falha nova.
- [ ] **Step 3:** Revisão final (revisor novo, opus) com a spec, o plano e o Review Focus; corrigir Critical/Important com teste RED→GREEN.
- [ ] **Step 4:** Painel local (`python -m http.server 8765`) para o Rafael testar: consultor Apex consulta um CNPJ (guardado e novo).
- [ ] **Step 5 (ok do Rafael):** publicar pelo procedimento da memória (comparar com o ar, backup, MD5 do ar no mesmo comando, envio, MD5 depois), REGRAS com a linha de publicação, painel gerado no commit, push no oficial sem force (ok), vigia `-Aceitar`.
