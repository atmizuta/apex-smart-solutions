# Discador — Raio-X do consultor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à supervisão, na aba Discador, jornada, ritmo, pausas, qualidade e resultado de cada consultor (colunas novas na tabela e um Raio-X ao clicar).

**Architecture:** O banco faz as contas:
- `discador_pausas`: função interna que acha os intervalos longos entre atendimentos;
- `discador_consultores`: ganha cinco colunas;
- `discador_consultor_raiox`: função nova que devolve um `jsonb` com dias, por hora, pausas, qualidade (consultor × equipe) e resultado de 7 dias úteis contra os 7 anteriores.

O painel monta o HTML com funções puras `dc*` (testadas no jsdom) e uma carga isolada por um contador de geração próprio.

**Tech Stack:** Postgres (Supabase `apex`), HTML/JS do `_template.html`, testes Node + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-16-discador-raiox-consultor-design.md`

## Global Constraints

- Produção (`mdgfboijyqfkggcrhptn`): aplicar SQL e publicar só com ok do Rafael naquele momento.
  - Os conectores recusam SQL grande, então aplicar com `execute_sql`, em transação, em partes de até ~8 KB.
  - O painel no ar chama `discador_consultores(p_de, p_ate, p_operacao)`: a assinatura não muda; só entram colunas novas.
- `config.discador`: `pausa_min` = 15 (minutos) e `curta_seg` = 15 (segundos), padrões.
- **Pausa longa:** intervalo entre o `fim_em` de um atendimento e o `atendida_em` do próximo do mesmo consultor no mesmo dia (SP) maior que `pausa_min`.
  - Pausa com "equipe sem chamadas" é aquela em que não houve nenhum contato (ANSWERED ou ABANDONED) de outro consultor na mesma operação dentro do intervalo. Ela **não** conta na tabela nem no destaque.
- **Curta:** atendida com `coalesce(seg_falados, 0)` < `curta_seg`.
- **Hora ativa:** hora (SP) com pelo menos um `atendida_em`.
- **Resultado:** 7 dias úteis (`public.boletim_dia_util`, que exclui sábado, domingo e feriado) até `p_ate`, e os 7 anteriores.
- **Destaque:** mais de 30% pior que a equipe, só com 20 ou mais atendidas no período:
  - atend./hora ativa: menor é pior;
  - pausas por hora ativa: maior é pior;
  - % curtas: maior é pior.
- Sem CSS novo, cor só por variável, `escapeHtml` em todo texto do banco. Nenhum dado de cliente na tela.
- REGRAS: **§96** (a §94 e a §95 são da Mesa/Biometria; conferir antes de publicar).
- Testes JS: `NODE_PATH=../boletim-manha/node_modules node test_discador.js`.

## Review Focus

1. **Consultor sem atendimento no período** (abriu o Raio-X e trocou para um dia em que ele não trabalhou). Esperado: cartões com 0 e "—", sem `NaN` e sem erro. Testado na Task 3.
2. **Pausa atravessando a virada de dia ou o último atendimento do dia.** Esperado: não existe pausa depois do último atendimento, e o `lead` é particionado por dia. Testado na Task 1.
3. **Clicar em A e logo em B, com a resposta de A chegando depois.** Esperado: aparece B. Testado na Task 4.
4. **Trocar o período com o Raio-X aberto.** Esperado: o Raio-X recarrega para o novo período. Testado na Task 4.
5. **Supervisor de Campinas abrindo um agente da Apex.** Esperado: o banco filtra pela operação dele, e o Raio-X vem vazio (o agente não tem atendimentos em Campinas), sem vazar dados. Testado na Task 1.

---

### Task 1: Banco — pausas, colunas novas e Raio-X

**Files:**
- Create: `supabase/migrations/20261016150000_discador_raiox.sql`
- Create: `supabase/rollback/20261016150000_discador_raiox_rollback.sql`
- Create: `supabase/tests/discador_raiox_check.sql`

**Interfaces:**
- Produces:
  - `discador_pausas(p_de date, p_ate date, p_op text, p_agente int) → table(agente_id int, dia date, inicio timestamptz, fim timestamptz, minutos int, equipe_sem_chamadas boolean)`. É interna, sem grant.
  - `discador_consultores(p_de, p_ate, p_operacao default null)`: as colunas de antes mais `jornada_inicio timestamptz, jornada_fim timestamptz, horas_ativas int, pausas int, curtas bigint`.
  - `discador_consultor_raiox(p_agente int, p_de date, p_ate date, p_operacao text default null) → jsonb` com as chaves `operacao, dias[], por_hora[], pausas[], qualidade{agente,equipe}, resultado{dias[], semana_atual, semana_anterior}`, no formato da spec §4.3.

- [ ] **Step 1: Teste SQL** (`supabase/tests/discador_raiox_check.sql`)

Cenário: segunda-feira 05/06/2000, operação apex, campanha `DISCADOR-APEX-ZZ`. O agente 900001 tem atendimentos às 10:00 (10 s), 10:05 (60 s) e 10:40 (30 s); entre 10:06 e 10:40 a equipe teve um contato às 10:20 (agente 900002, 120 s). Depois, 10:50 (5 s) e 11:30 (40 s), sem nenhum contato da equipe entre 10:50 e 11:30 (os intervalos 10:00→10:05 e 10:40→10:50 são curtos). O dia termina às 11:31. Há um pedido para o CNPJ atendido às 11:30. O agente 900003 é de Campinas, às 10:30.

```sql
-- Verificação de 20261016150000_discador_raiox.sql (§96). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fsupc@teste.invalid'),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fcons@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000f101', 'Zzfadm Teste',  'zz.fadm',  'admin',      'apex'),
  ('00000000-0000-0000-0000-00000000f102', 'Zzfsupc Teste', 'zz.fsupc', 'supervisor', 'campinas'),
  ('00000000-0000-0000-0000-00000000f103', 'Zzfcons Teste', 'zz.fcons', 'consultor',  'apex')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;
insert into public.discador_chamadas (id, gerada_em, atendida_em, fim_em, status, agente_id, seg_falados, seg_espera, tabulacao, campanha, cnpj) values
  (999500001, '2000-06-05 10:00-03', '2000-06-05 10:00:02-03', '2000-06-05 10:00:12-03', 'ANSWERED', 900001, 10,  2, 'SEM AVANÇO', 'DISCADOR-APEX-ZZ', '00000000000101'),
  (999500002, '2000-06-05 10:05-03', '2000-06-05 10:05:02-03', '2000-06-05 10:06:02-03', 'ANSWERED', 900001, 60,  2, 'RETORNO',    'DISCADOR-APEX-ZZ', '00000000000202'),
  (999500003, '2000-06-05 10:20-03', '2000-06-05 10:20:02-03', '2000-06-05 10:22:02-03', 'ANSWERED', 900002, 120, 4, null,         'DISCADOR-APEX-ZZ', '00000000000303'),
  (999500004, '2000-06-05 10:40-03', '2000-06-05 10:40:02-03', '2000-06-05 10:40:32-03', 'ANSWERED', 900001, 30,  2, 'DESCARTE',   'DISCADOR-APEX-ZZ', '00000000000404'),
  (999500005, '2000-06-05 10:50-03', '2000-06-05 10:50:02-03', '2000-06-05 10:50:07-03', 'ANSWERED', 900001, 5,   2, null,         'DISCADOR-APEX-ZZ', '00000000000505'),
  (999500006, '2000-06-05 11:30-03', '2000-06-05 11:30:02-03', '2000-06-05 11:30:42-03', 'ANSWERED', 900001, 40,  2, 'AQUISIÇÃO - GANHO', 'DISCADOR-APEX-ZZ', '00000000000606'),
  (999500007, '2000-06-05 10:30-03', '2000-06-05 10:30:02-03', '2000-06-05 10:31:02-03', 'ANSWERED', 900003, 60,  2, null,         'MIGRACAO-CLARO-ZZ', '00000000000707');
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999600001, 'ZZR1', 'PEDIDO CADASTRADO', '2000-06-05 00:00-03', '00.000.000/0006-06');

do $$
declare r record; j jsonb; n int;
begin
  -- pausas (como dono, antes de trocar de papel): 10:06→10:40 (34 min, equipe teve contato) e 10:50→11:30 (39 min, equipe parada)
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001);
  assert n = 2, 'duas pausas longas (>15 min), veio ' || n;
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001) where minutos = 34 and not equipe_sem_chamadas;
  assert n = 1, 'pausa 10:06–10:40 conta (equipe atendeu às 10:20)';
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001) where minutos = 39 and equipe_sem_chamadas;
  assert n = 1, 'pausa 10:50–11:30 marcada equipe sem chamadas';
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900002);
  assert n = 0, 'agente com um só atendimento não tem pausa (nada depois do último)';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f103', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f103', true);
  begin perform public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05'); assert false, 'consultor não lê o Raio-X';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f101', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f101', true);
  select * into r from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900001;
  assert r.atendidas = 5 and r.horas_ativas = 2 and r.pausas = 1 and r.curtas = 2, 'colunas novas: 5 atendidas, 2 horas ativas, 1 pausa (a outra é da equipe), 2 curtas';
  assert to_char(r.jornada_inicio at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' and to_char(r.jornada_fim at time zone 'America/Sao_Paulo', 'HH24:MI') = '11:30', 'jornada 10:00–11:30';
  select * into r from public.discador_consultores('2000-06-05', '2000-06-06') where agente_id = 900001;
  assert r.jornada_inicio is null and r.horas_ativas = 2, 'em vários dias, jornada nula e horas ativas somadas';

  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05');
  assert j ->> 'operacao' = 'apex', 'operação';
  assert jsonb_array_length(j -> 'dias') = 1 and (j -> 'dias' -> 0 ->> 'atendidas')::int = 5 and (j -> 'dias' -> 0 ->> 'horas_ativas')::int = 2
     and (j -> 'dias' -> 0 ->> 'pausas')::int = 1 and (j -> 'dias' -> 0 ->> 'min_pausa')::int = 34, 'dias';
  assert jsonb_array_length(j -> 'por_hora') = 13 and (select (x ->> 'atendidas')::int from jsonb_array_elements(j -> 'por_hora') x where (x ->> 'hora')::int = 10) = 4, 'por hora: 4 às 10h';
  assert jsonb_array_length(j -> 'pausas') = 2, 'lista com as duas pausas (inclusive a da equipe)';
  assert (j -> 'qualidade' -> 'agente' ->> 'curtas')::int = 2 and (j -> 'qualidade' -> 'agente' ->> 'seg_falados_medio_sem_curtas')::int = 43, 'qualidade: 2 curtas; média sem curtas (60+30+40)/3 = 43';
  assert (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'sem_avanco')::int = 1 and (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'ganho')::int = 1 and (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'sem_tabulacao')::int = 1, 'mix';
  assert (j -> 'qualidade' -> 'equipe' ->> 'atendidas')::int = 6, 'equipe da apex: 6 atendidas (Campinas fora)';
  assert (j -> 'resultado' -> 'semana_atual' ->> 'vendas')::int = 1 and (j -> 'resultado' -> 'semana_atual' ->> 'atendidas')::int = 5, 'resultado: 1 venda e 5 atendidas na semana';
  assert jsonb_array_length(j -> 'resultado' -> 'dias') = 7, '7 dias úteis';
  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-06');
  assert jsonb_array_length(j -> 'por_hora') = 0 and jsonb_array_length(j -> 'pausas') = 0, 'vários dias: sem por hora nem lista de pausas';
  j := public.discador_consultor_raiox(900001, '2000-06-07', '2000-06-07');
  assert jsonb_array_length(j -> 'dias') = 0 and (j -> 'qualidade' -> 'agente' ->> 'atendidas')::int = 0, 'dia sem atendimento: vazio e zerado';

  -- supervisor de Campinas: só vê Campinas; o agente da Apex vem vazio; pedir apex = 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f102', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f102', true);
  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05');
  assert j ->> 'operacao' = 'campinas' and jsonb_array_length(j -> 'dias') = 0, 'agente da Apex não aparece para Campinas';
  begin perform public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05', 'apex'); assert false, 'campinas pedindo apex';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
```

- [ ] **Step 2: Ver falhar (só leitura)**

`select to_regprocedure('public.discador_consultor_raiox(int,date,date,text)')` → nulo.

- [ ] **Step 3: Migration** (`supabase/migrations/20261016150000_discador_raiox.sql`)

```sql
-- 16/10/2026 — Raio-X do consultor na aba Discador (REGRAS_NEGOCIO.md §96). Spec: docs/superpowers/specs/2026-10-16-discador-raiox-consultor-design.md
-- Pausa longa: fim de um atendimento → início do próximo do mesmo consultor no mesmo dia (SP) > config.discador.pausa_min.
-- "Equipe sem chamadas": nenhum contato (ANSWERED/ABANDONED) de outro consultor da mesma operação no intervalo — não conta.

update public.config
   set valor = (jsonb_build_object('pausa_min', 15, 'curta_seg', 15) || valor::jsonb)::text, atualizado_em = now()
 where chave = 'discador';

-- Interna (sem security definer/SET, inlinável; fechada a authenticated). p_agente nulo = todos.
create or replace function public.discador_pausas(p_de date, p_ate date, p_op text, p_agente int)
returns table (agente_id int, dia date, inicio timestamptz, fim timestamptz, minutos int, equipe_sem_chamadas boolean)
language sql stable as $$
  with cfg as (
    select coalesce((select (g.valor::jsonb ->> 'pausa_min')::int from public.config g where g.chave = 'discador'), 15) as pm
  ), at as (
    select c.agente_id as ag, (c.atendida_em at time zone 'America/Sao_Paulo')::date as d, c.fim_em as f,
           lead(c.atendida_em) over (partition by c.agente_id, (c.atendida_em at time zone 'America/Sao_Paulo')::date
                                     order by c.atendida_em, c.id) as prox
      from public.discador_periodo(p_de, p_ate, p_op) c
     where c.status = 'ANSWERED' and c.agente_id is not null and c.atendida_em is not null and c.fim_em is not null
       and (p_agente is null or c.agente_id = p_agente)
  )
  select a.ag, a.d, a.f, a.prox, floor(extract(epoch from a.prox - a.f) / 60)::int,
         not exists (select 1 from public.discador_periodo(p_de, p_ate, p_op) o
                      where o.status in ('ANSWERED', 'ABANDONED') and o.agente_id is distinct from a.ag
                        and o.gerada_em > a.f and o.gerada_em < a.prox)
    from at a cross join cfg
   where a.prox is not null and a.prox - a.f > make_interval(mins => cfg.pm);
$$;
revoke all on function public.discador_pausas(date, date, text, int) from public, anon, authenticated;

drop function if exists public.discador_consultores(date, date, text);
create or replace function public.discador_consultores(p_de date, p_ate date, p_operacao text default null)
returns table (agente_id int, profile_id uuid, nome text, atendidas bigint, seg_falados_total bigint, seg_falados_medio int,
               sem_avanco bigint, retornos bigint, ganhos bigint, sem_tabulacao bigint, vendas bigint,
               jornada_inicio timestamptz, jornada_fim timestamptz, horas_ativas int, pausas int, curtas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text; v_cs int;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  v_cs := coalesce((select (g.valor::jsonb ->> 'curta_seg')::int from public.config g where g.chave = 'discador'), 15);
  return query
  with ch as (
    select c.agente_id as ag, coalesce(c.seg_falados, 0) as seg, upper(coalesce(c.tabulacao, '')) as tab, c.tabulacao is null as semtab,
           c.atendida_em as ini, c.fim_em as fim, c.atendida_em at time zone 'America/Sao_Paulo' as l
      from public.discador_periodo(p_de, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id is not null
  ), a as (
    select ch.ag, count(*) as n, sum(ch.seg)::bigint as seg,
           count(*) filter (where ch.tab like 'SEM AVAN%') as sa,
           count(*) filter (where ch.tab = 'RETORNO') as ret,
           count(*) filter (where ch.tab like '%GANHO') as gan,
           count(*) filter (where ch.semtab) as st,
           min(ch.ini) as ji, max(ch.fim) as jf,
           count(distinct date_trunc('hour', ch.l))::int as ha,
           count(*) filter (where ch.seg < v_cs) as cur
      from ch group by ch.ag
  ), v as (
    select va.agente_id as ag, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate, v_op) va group by va.agente_id
  ), pz as (
    select x.agente_id as ag, count(*)::int as n from public.discador_pausas(p_de, p_ate, v_op, null) x
     where not x.equipe_sem_chamadas group by x.agente_id
  )
  select coalesce(a.ag, v.ag), da.profile_id,
         coalesce(p.nome, nullif(btrim(da.apelido), ''), 'Agente ' || coalesce(a.ag, v.ag)),
         coalesce(a.n, 0), coalesce(a.seg, 0),
         case when coalesce(a.n, 0) > 0 then round(a.seg::numeric / a.n)::int end,
         coalesce(a.sa, 0), coalesce(a.ret, 0), coalesce(a.gan, 0), coalesce(a.st, 0), coalesce(v.n, 0),
         case when p_de = p_ate then a.ji end, case when p_de = p_ate then a.jf end,
         coalesce(a.ha, 0), coalesce(pz.n, 0), coalesce(a.cur, 0)
    from a
    full join v on v.ag = a.ag
    left join pz on pz.ag = coalesce(a.ag, v.ag)
    left join public.discador_agente da on da.agente_id = coalesce(a.ag, v.ag)
    left join public.profiles p on p.id = da.profile_id
   order by coalesce(a.n, 0) desc, 1;
end $$;
revoke all on function public.discador_consultores(date, date, text) from public, anon;
grant execute on function public.discador_consultores(date, date, text) to authenticated;

create or replace function public.discador_consultor_raiox(p_agente int, p_de date, p_ate date, p_operacao text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_op text; v_cs int; d date; k int; v_ini date; v_ini_ant date;
  v_dias jsonb; v_hora jsonb := '[]'::jsonb; v_pausas jsonb := '[]'::jsonb; v_qual jsonb; v_res jsonb;
  v_zero constant jsonb := '{"atendidas":0,"curtas":0,"seg_falados_medio_sem_curtas":null,"seg_espera_medio":null,"mix":{"sem_avanco":0,"retorno":0,"descarte":0,"perdido":0,"ganho":0,"sem_contato":0,"sem_tabulacao":0,"outros":0}}';
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  v_cs := coalesce((select (g.valor::jsonb ->> 'curta_seg')::int from public.config g where g.chave = 'discador'), 15);
  -- 7 dias úteis até p_ate e os 7 anteriores
  d := p_ate; k := 0;
  while k < 7 loop if public.boletim_dia_util(d) then k := k + 1; v_ini := d; end if; d := d - 1; end loop;
  k := 0;
  while k < 7 loop if public.boletim_dia_util(d) then k := k + 1; v_ini_ant := d; end if; d := d - 1; end loop;

  with t as (
    select c.atendida_em, c.fim_em, c.atendida_em at time zone 'America/Sao_Paulo' as l
      from public.discador_periodo(p_de, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id = p_agente and c.atendida_em is not null
  ), pz as (
    select * from public.discador_pausas(p_de, p_ate, v_op, p_agente) x where not x.equipe_sem_chamadas
  ), dd as (
    select t.l::date as dia, min(t.atendida_em) as ini, max(t.fim_em) as fim,
           count(distinct extract(hour from t.l))::int as ha, count(*)::int as n
      from t group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('dia', dd.dia, 'inicio', dd.ini, 'fim', dd.fim, 'horas_ativas', dd.ha, 'atendidas', dd.n,
           'pausas', (select count(*) from pz where pz.dia = dd.dia),
           'min_pausa', (select coalesce(sum(pz.minutos), 0) from pz where pz.dia = dd.dia)) order by dd.dia), '[]'::jsonb)
    into v_dias from dd;

  if p_de = p_ate then
    select jsonb_agg(jsonb_build_object('hora', g.h, 'atendidas', coalesce(x.n, 0)) order by g.h) into v_hora
      from generate_series(9, 21) as g(h)
      left join (select extract(hour from c.atendida_em at time zone 'America/Sao_Paulo')::int as h, count(*) as n
                   from public.discador_periodo(p_de, p_ate, v_op) c
                  where c.status = 'ANSWERED' and c.agente_id = p_agente and c.atendida_em is not null group by 1) x on x.h = g.h;
    select coalesce(jsonb_agg(jsonb_build_object('inicio', s.inicio, 'fim', s.fim, 'minutos', s.minutos, 'equipe_sem_chamadas', s.equipe_sem_chamadas)
                              order by s.inicio), '[]'::jsonb) into v_pausas
      from (select * from public.discador_pausas(p_de, p_ate, v_op, p_agente) order by minutos desc limit 50) s;
  end if;

  with q as (
    select c.agente_id = p_agente as eh, coalesce(c.seg_falados, 0) as seg, c.seg_espera as esp,
           upper(coalesce(c.tabulacao, '')) as tab, c.tabulacao is null as semtab
      from public.discador_periodo(p_de, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id is not null
  ), g as (
    select 'agente' as k, q.* from q where q.eh
    union all
    select 'equipe' as k, q.* from q
  )
  select jsonb_object_agg(z.k, z.obj) into v_qual from (
    select g.k, jsonb_build_object(
             'atendidas', count(*), 'curtas', count(*) filter (where g.seg < v_cs),
             'seg_falados_medio_sem_curtas', round(avg(g.seg) filter (where g.seg >= v_cs)),
             'seg_espera_medio', round(avg(g.esp)),
             'mix', jsonb_build_object(
               'sem_avanco', count(*) filter (where g.tab like 'SEM AVAN%'),
               'retorno', count(*) filter (where g.tab = 'RETORNO'),
               'descarte', count(*) filter (where g.tab = 'DESCARTE'),
               'perdido', count(*) filter (where g.tab like '%PERDIDO'),
               'ganho', count(*) filter (where g.tab like '%GANHO'),
               'sem_contato', count(*) filter (where g.tab = 'SEM CONTATO'),
               'sem_tabulacao', count(*) filter (where g.semtab),
               'outros', count(*) filter (where not g.semtab and not (g.tab like 'SEM AVAN%' or g.tab in ('RETORNO', 'DESCARTE', 'SEM CONTATO')
                                                                     or g.tab like '%PERDIDO' or g.tab like '%GANHO')))) as obj
      from g group by g.k) z;
  v_qual := jsonb_build_object('agente', coalesce(v_qual -> 'agente', v_zero), 'equipe', coalesce(v_qual -> 'equipe', v_zero));

  with dias as (
    select g::date as dia from generate_series(v_ini_ant, p_ate, interval '1 day') g where public.boletim_dia_util(g::date)
  ), at as (
    select (c.atendida_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
      from public.discador_periodo(v_ini_ant, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id = p_agente and c.atendida_em is not null group by 1
  ), vd as (
    select va.dia, count(*) as n from public.discador_vendas_atribuidas(v_ini_ant, p_ate, v_op) va where va.agente_id = p_agente group by 1
  )
  select jsonb_build_object(
           'dias', coalesce(jsonb_agg(jsonb_build_object('dia', dias.dia, 'atendidas', coalesce(at.n, 0), 'vendas', coalesce(vd.n, 0))
                                      order by dias.dia) filter (where dias.dia >= v_ini), '[]'::jsonb),
           'semana_atual', jsonb_build_object('atendidas', coalesce(sum(at.n) filter (where dias.dia >= v_ini), 0),
                                              'vendas', coalesce(sum(vd.n) filter (where dias.dia >= v_ini), 0)),
           'semana_anterior', jsonb_build_object('atendidas', coalesce(sum(at.n) filter (where dias.dia < v_ini), 0),
                                                 'vendas', coalesce(sum(vd.n) filter (where dias.dia < v_ini), 0)))
    into v_res
    from dias left join at on at.dia = dias.dia left join vd on vd.dia = dias.dia;

  return jsonb_build_object('operacao', v_op, 'dias', v_dias, 'por_hora', coalesce(v_hora, '[]'::jsonb), 'pausas', v_pausas,
                            'qualidade', v_qual, 'resultado', v_res);
end $$;
revoke all on function public.discador_consultor_raiox(int, date, date, text) from public, anon;
grant execute on function public.discador_consultor_raiox(int, date, date, text) to authenticated;
```

- [ ] **Step 4: Rollback** (`supabase/rollback/20261016150000_discador_raiox_rollback.sql`)

```sql
-- Desfaz 20261016150000_discador_raiox.sql (§96). Depois, recriar discador_consultores sem as colunas novas rodando o trecho
-- "create or replace function public.discador_consultores" de supabase/migrations/20261015210000_discador_operacao.sql (+ grants).
drop function if exists public.discador_consultor_raiox(int, date, date, text);
drop function if exists public.discador_consultores(date, date, text);
drop function if exists public.discador_pausas(date, date, text, int);
update public.config set valor = (valor::jsonb - 'pausa_min' - 'curta_seg')::text, atualizado_em = now() where chave = 'discador';
```

- [ ] **Step 5: Commit** (a aplicação e o teste acontecem na Task 5, com ok)

```bash
git add supabase/migrations/20261016150000_discador_raiox.sql supabase/rollback/20261016150000_discador_raiox_rollback.sql supabase/tests/discador_raiox_check.sql
git commit -m "feat(discador): pausas, colunas novas em consultores e Raio-X do consultor (secao 96)"
```

---

### Task 2: Tabela de Consultores com as colunas novas

**Files:**
- Modify: `_template.html` (`dcMediaEquipe`, `dcConsultoresHtml`)
- Test: `test_discador.js`

**Interfaces:**
- Produces:
  - `dcMediaEquipe(lista) → {semAvanco, semTab, conversao, atPorHora, pausasPorHora, curtas}`;
  - `dcHoraMin(iso) → 'HH:MM'` (SP) ou '—'.

- [ ] **Step 1: Testes** (antes de `// ==== mais testes entram aqui ====`)

```js
  // ==== §96: colunas novas da tabela ====
  eq(dcHoraMin('2026-10-15T17:02:00Z'), '14:02', 'hora em SP');
  eq(dcHoraMin(null), '—', 'hora nula');
  const consN = [
    { agente_id: 1, nome: 'A Teste', profile_id: 'p', atendidas: 100, seg_falados_total: 1, seg_falados_medio: 1, sem_avanco: 0, retornos: 0, ganhos: 0, sem_tabulacao: 0, vendas: 2,
      jornada_inicio: '2026-10-15T17:02:00Z', jornada_fim: '2026-10-15T22:58:00Z', horas_ativas: 5, pausas: 5, curtas: 60 },
    { agente_id: 2, nome: 'B Teste', profile_id: 'p', atendidas: 100, seg_falados_total: 1, seg_falados_medio: 1, sem_avanco: 0, retornos: 0, ganhos: 0, sem_tabulacao: 0, vendas: 2,
      jornada_inicio: null, jornada_fim: null, horas_ativas: 5, pausas: 0, curtas: 20 },
  ];
  const mN = dcMediaEquipe(consN);
  eq([mN.atPorHora, mN.pausasPorHora, mN.curtas], [20, 0.5, 0.4], 'médias: 200/10 at/h, 5/10 pausas/h, 80/200 curtas');
  const tN = dcConsultoresHtml(consN);
  assert(tN.includes('Jornada') && tN.includes('Atend./h') && tN.includes('Pausas') && tN.includes('% curtas'), 'cabeçalhos novos');
  const linhaA = tN.split('data-dc-agente="1"')[1].split('</tr>')[0];
  assert(linhaA.includes('14:02–19:58') && linhaA.includes('60,0%'), 'jornada e % curtas do A');
  assert((linhaA.match(/dcPior/g) || []).length === 2, 'A: pausas (1/h vs 0,5) e curtas (60% vs 40%) em vermelho');
  const linhaB = tN.split('data-dc-agente="2"')[1].split('</tr>')[0];
  assert(linhaB.includes('<td>—</td>') && !linhaB.includes('dcPior'), 'B: jornada — e sem destaque');
  assert(!dcConsultoresHtml([{ agente_id: 3, nome: 'C', atendidas: 0, horas_ativas: 0, pausas: 0, curtas: 0 }]).includes('NaN'), 'sem atendidas: sem NaN');
```

- [ ] **Step 2: Ver falhar** — `dcHoraMin is not defined`.

- [ ] **Step 3: Implementar**

Acrescentar, logo depois de `function dcDdMm(dia){…}`:

```js
function dcHoraMin(iso){ if(!iso) return '—'; const ms = Date.parse(iso); return Number.isFinite(ms) ? new Date(ms - 3 * 3600000).toISOString().slice(11, 16) : '—'; }
```

Trocar `dcMediaEquipe` inteira por:

```js
// Médias da equipe ponderadas (quem atende mais pesa mais); por hora ativa para ritmo e pausas (§96).
function dcMediaEquipe(consultores){
  const s = (consultores || []).reduce((a, c) => {
    a.at += Number(c.atendidas) || 0; a.sa += Number(c.sem_avanco) || 0; a.st += Number(c.sem_tabulacao) || 0; a.v += Number(c.vendas) || 0;
    a.ha += Number(c.horas_ativas) || 0; a.pz += Number(c.pausas) || 0; a.cu += Number(c.curtas) || 0;
    return a;
  }, { at: 0, sa: 0, st: 0, v: 0, ha: 0, pz: 0, cu: 0 });
  return { semAvanco: dcTaxa(s.sa, s.at), semTab: dcTaxa(s.st, s.at), conversao: dcTaxa(s.v, s.at),
           atPorHora: dcTaxa(s.at, s.ha), pausasPorHora: dcTaxa(s.pz, s.ha), curtas: dcTaxa(s.cu, s.at) };
}
```

Em `dcConsultoresHtml`, trocar a linha `+ td(dcFmtNum(at)) + td(dcFmtSeg(c.seg_falados_total)) + td(dcFmtSeg(c.seg_falados_medio))` por:

```js
      + td(c.jornada_inicio ? dcHoraMin(c.jornada_inicio) + '–' + dcHoraMin(c.jornada_fim) : '—')
      + td(dcFmtNum(at))
      + td(dcTaxa(at, c.horas_ativas) === null ? '—' : dcTaxa(at, c.horas_ativas).toFixed(1).replace('.', ','), amostra && dcPiorQueMedia(dcTaxa(at, c.horas_ativas), med.atPorHora, false))
      + td(dcFmtNum(c.pausas), amostra && dcPiorQueMedia(dcTaxa(c.pausas, c.horas_ativas), med.pausasPorHora, true))
      + td(dcFmtPct(dcTaxa(c.curtas, at)), amostra && dcPiorQueMedia(dcTaxa(c.curtas, at), med.curtas, true))
      + td(dcFmtSeg(c.seg_falados_total)) + td(dcFmtSeg(c.seg_falados_medio))
```

O cabeçalho passa a ser `<th>Consultor</th><th>Jornada</th><th>Atendidas</th><th>Atend./h</th><th>Pausas</th><th>% curtas</th><th>Falado</th><th>Médio</th><th>% sem avanço</th><th>Retornos</th><th>Ganhos</th><th>% sem tabulação</th><th>Vendas</th><th>Conversão</th>`.

A legenda passa a ser: `Em vermelho: mais de 30% pior que a média da equipe (atend./hora ativa ${…atPorHora com 1 casa} · pausas longas por hora ativa · curtas ${dcFmtPct(med.curtas)} · sem avanço … · sem tabulação … · conversão …), só para quem atendeu 20 ou mais. Pausa longa: mais de 15 min sem atender com a equipe recebendo chamadas. Clique na linha para o Raio-X.` O `title` da linha passa a ser `Abrir o Raio-X`.

- [ ] **Step 4: Ver passar** e rodar `test_discador.js` inteiro.

Os testes antigos que buscam `60,0%` e `9,0%` com regex por linha continuam valendo, porque as colunas só foram acrescentadas. Se algum quebrar pela ordem das colunas, ajustar o teste para a técnica de "split por linha" (ledger).

- [ ] **Step 5: Commit** — `feat(discador): jornada, atend./h, pausas e % curtas na tabela de consultores (secao 96)`.

---

### Task 3: HTML do Raio-X

**Files:**
- Modify: `_template.html`
- Test: `test_discador.js`

**Interfaces:**
- Consumes: `dcHoraMin`, `dcMediaEquipe`, `dcFmt*`, `dcTaxa`, `dcPiorQueMedia`, `DC_MIN_ATENDIDAS_DESTAQUE`, `DC_OPERACOES`.
- Produces: `dcRaioXHtml(nome, rx, medias, periodo) → string`, com `rx` = jsonb da RPC (ou `null` = falha), `medias` = `dcMediaEquipe(lista da tabela)` e `periodo` = `{de, ate}`; `dcVariacao(atual, anterior) → number|null`.

- [ ] **Step 1: Testes**

```js
  // ==== §96: Raio-X ====
  const RX = { operacao: 'apex',
    dias: [{ dia: '2026-10-15', inicio: '2026-10-15T17:02:00Z', fim: '2026-10-15T22:58:00Z', horas_ativas: 5, atendidas: 100, pausas: 2, min_pausa: 41 }],
    por_hora: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map(h => ({ hora: h, atendidas: h === 14 ? 30 : 0 })),
    pausas: [{ inicio: '2026-10-15T18:20:00Z', fim: '2026-10-15T18:48:00Z', minutos: 28, equipe_sem_chamadas: false },
             { inicio: '2026-10-15T20:00:00Z', fim: '2026-10-15T20:20:00Z', minutos: 20, equipe_sem_chamadas: true }],
    qualidade: { agente: { atendidas: 100, curtas: 60, seg_falados_medio_sem_curtas: 71, seg_espera_medio: 2, mix: { sem_avanco: 50, retorno: 6, descarte: 4, perdido: 3, ganho: 1, sem_contato: 20, sem_tabulacao: 16, outros: 0 } },
                 equipe: { atendidas: 1000, curtas: 400, seg_falados_medio_sem_curtas: 80, seg_espera_medio: 2, mix: { sem_avanco: 400, retorno: 60, descarte: 40, perdido: 30, ganho: 10, sem_contato: 300, sem_tabulacao: 160, outros: 0 } } },
    resultado: { dias: [{ dia: '2026-10-15', atendidas: 100, vendas: 2 }], semana_atual: { atendidas: 480, vendas: 6 }, semana_anterior: { atendidas: 400, vendas: 8 } } };
  const medRX = { atPorHora: 18, pausasPorHora: 0.2, curtas: 0.4 };
  const rxh = dcRaioXHtml('Caio Teste', RX, medRX, { de: '2026-10-15', ate: '2026-10-15' });
  assert(rxh.includes('Caio Teste') && rxh.includes('Apex') && rxh.includes('14:02–19:58'), 'cabeçalho e jornada');
  assert(rxh.includes('20,0') && rxh.includes('equipe 18,0'), 'atend./hora ativa 100/5 vs equipe');
  assert(rxh.includes('2 · 41 min'), 'pausas e minutos');
  assert(rxh.includes('60,0%') && rxh.includes('equipe 40,0%'), '% curtas vs equipe');
  assert((rxh.match(/dcPior/g) || []).length >= 2, 'pausas/h (0,4 vs 0,2) e curtas (60% vs 40%) em vermelho');
  assert(rxh.includes('15:20–15:48 · 28 min') && rxh.includes('equipe sem chamadas'), 'lista de pausas com a etiqueta');
  assert(rxh.includes('bmHoras') && rxh.includes('Qualidade') && rxh.includes('Resultado'), 'blocos');
  assert(rxh.includes('Semana anterior') && rxh.includes('▲') && rxh.includes('▼'), 'variação: atendidas sobe, vendas desce');
  assert(rxh.includes('data-dc-fechar'), 'botão fechar');
  const rxv = dcRaioXHtml('Caio Teste', Object.assign({}, RX, { por_hora: [], pausas: [], dias: [RX.dias[0], Object.assign({}, RX.dias[0], { dia: '2026-10-16' })] }), medRX, { de: '2026-10-15', ate: '2026-10-16' });
  assert(rxv.includes('2 dias') && rxv.includes('16/10') && !rxv.includes('bmHoras'), 'vários dias: tabela por dia, sem barras');
  const rx0 = dcRaioXHtml('Zé Teste', { operacao: 'apex', dias: [], por_hora: [], pausas: [], qualidade: { agente: { atendidas: 0, curtas: 0, mix: {} }, equipe: { atendidas: 0, curtas: 0, mix: {} } },
    resultado: { dias: [], semana_atual: { atendidas: 0, vendas: 0 }, semana_anterior: { atendidas: 0, vendas: 0 } } }, {}, { de: '2026-10-17', ate: '2026-10-17' });
  assert(!rx0.includes('NaN') && rx0.includes('Sem atendimentos'), 'consultor sem atendimento: sem NaN');
  assert(dcRaioXHtml('X', null, {}, { de: '2026-10-15', ate: '2026-10-15' }).includes('Não foi possível carregar'), 'falha');
  eq(dcVariacao(480, 400), 0.2, 'variação +20%');
  eq(dcVariacao(5, 0), null, 'sem base: nula');
```

- [ ] **Step 2: Ver falhar** — `dcRaioXHtml is not defined`.

- [ ] **Step 3: Implementar** (depois de `dcDiasHtml`)

```js
// §96: Raio-X do consultor (presença/ritmo, qualidade e resultado), a partir de discador_consultor_raiox.
function dcVariacao(atual, anterior){ const a = Number(anterior) || 0; return a > 0 ? (Number(atual) || 0) / a - 1 : null; }
function dcRaioXHtml(nome, rx, med, periodo){
  const e = escapeHtml;
  const fechar = '<button type="button" class="btn btn-sm btn-outline" data-dc-fechar style="width:auto">Fechar</button>';
  if(!rx) return `<div class="bmCard"><h4>${e(nome)} ${fechar}</h4><p class="ppVazio">Não foi possível carregar agora. Tente de novo em instantes.</p></div>`;
  med = med || {};
  const dias = Array.isArray(rx.dias) ? rx.dias : [], umDia = periodo.de === periodo.ate;
  const tot = dias.reduce((a, d) => { a.at += Number(d.atendidas) || 0; a.ha += Number(d.horas_ativas) || 0; a.pz += Number(d.pausas) || 0; a.min += Number(d.min_pausa) || 0; return a; }, { at: 0, ha: 0, pz: 0, min: 0 });
  const qa = (rx.qualidade && rx.qualidade.agente) || {}, qe = (rx.qualidade && rx.qualidade.equipe) || {};
  const amostra = tot.at >= DC_MIN_ATENDIDAS_DESTAQUE;
  const atH = dcTaxa(tot.at, tot.ha), pzH = dcTaxa(tot.pz, tot.ha), cur = dcTaxa(qa.curtas, qa.atendidas), curEq = dcTaxa(qe.curtas, qe.atendidas);
  const num1 = x => x === null || x === undefined ? '—' : Number(x).toFixed(1).replace('.', ',');
  const kpi = (rot, valor, sub, pior) => `<div class="bmCard bmKpi"><div class="bmRot">${e(rot)}</div><div class="bmNum${pior ? ' dcPior' : ''}"${pior ? ' style="color:var(--st-perdido)"' : ''}>${e(valor)}</div><div class="bmSub">${e(sub)}</div></div>`;
  const jornada = !dias.length ? '—' : (umDia ? dcHoraMin(dias[0].inicio) + '–' + dcHoraMin(dias[0].fim) : dias.length + ' dias');
  const cartoes = '<div class="bmGrade bmG6" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">'
    + kpi('Jornada', jornada, umDia ? 'primeiro e último atendimento' : 'dias com atendimento', false)
    + kpi('Atend./hora ativa', num1(atH), 'equipe ' + num1(med.atPorHora), amostra && dcPiorQueMedia(atH, med.atPorHora, false))
    + kpi('Pausas longas', tot.pz + ' · ' + tot.min + ' min', 'mais de 15 min, com a equipe recebendo', amostra && dcPiorQueMedia(pzH, med.pausasPorHora, true))
    + kpi('% curtas', dcFmtPct(cur), 'equipe ' + dcFmtPct(curEq), amostra && dcPiorQueMedia(cur, curEq, true))
    + '</div>';
  let ritmo;
  if(!dias.length) ritmo = '<p class="ppVazio">Sem atendimentos no período.</p>';
  else if(umDia){
    const ph = Array.isArray(rx.por_hora) ? rx.por_hora : [], max = Math.max(1, ...ph.map(h => Number(h.atendidas) || 0));
    const barras = `<div class="bmHoras">${ph.map(h => `<div class="bmHora" title="${e(h.hora + 'h: ' + h.atendidas + ' atendimentos')}"><b>${Number(h.atendidas) || ''}</b><i style="height:${Math.round((Number(h.atendidas) || 0) / max * 100)}%"></i><span>${e(String(h.hora))}h</span></div>`).join('')}</div>`;
    const pz = Array.isArray(rx.pausas) ? rx.pausas : [];
    const lista = pz.length ? '<ul style="margin:var(--space-3) 0 0;padding-left:18px">' + pz.map(x => `<li>${e(dcHoraMin(x.inicio) + '–' + dcHoraMin(x.fim) + ' · ' + x.minutos + ' min')}${x.equipe_sem_chamadas ? ' <span class="badge">equipe sem chamadas</span>' : ''}</li>`).join('') + '</ul>'
      : '<p class="ppVazio">Nenhuma pausa longa.</p>';
    ritmo = barras + '<div class="bmLegenda">Atendimentos por hora. Pausas longas abaixo; "equipe sem chamadas" = o discador não entregou ligações a ninguém nesse intervalo (não conta).</div>' + lista;
  } else {
    ritmo = '<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Dia</th><th>Jornada</th><th>Horas ativas</th><th>Atendidas</th><th>Atend./h</th><th>Pausas</th><th>Min em pausa</th></tr></thead><tbody>'
      + dias.map(d => `<tr><td>${e(dcDdMm(d.dia))}</td><td>${e(dcHoraMin(d.inicio) + '–' + dcHoraMin(d.fim))}</td><td>${e(String(d.horas_ativas))}</td><td>${e(dcFmtNum(d.atendidas))}</td><td>${e(num1(dcTaxa(d.atendidas, d.horas_ativas)))}</td><td>${e(String(d.pausas))}</td><td>${e(String(d.min_pausa))}</td></tr>`).join('')
      + '</tbody></table></div>';
  }
  const MIX = [['sem_avanco', 'Sem avanço'], ['sem_contato', 'Sem contato'], ['retorno', 'Retorno'], ['descarte', 'Descarte'], ['perdido', 'Perdido'], ['ganho', 'Ganho'], ['sem_tabulacao', 'Sem tabulação'], ['outros', 'Outros']];
  const ma = qa.mix || {}, me = qe.mix || {};
  const mix = MIX.map(([k, rot]) => {
    const pa = dcTaxa(ma[k], qa.atendidas) || 0, pe = dcTaxa(me[k], qe.atendidas) || 0;
    return `<div class="bmLin" style="grid-template-columns:120px minmax(0,1fr) auto"><div class="bmNome">${e(rot)}</div><div><div class="bmTrilho"><i style="width:${Math.round(pa * 100)}%"></i></div><div class="bmTrilho"><i class="at" style="width:${Math.round(pe * 100)}%"></i></div></div><div class="bmVal">${e(dcFmtPct(pa))}</div></div>`;
  }).join('');
  const qualidade = '<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th></th><th>Consultor</th><th>Equipe</th></tr></thead><tbody>'
    + `<tr><td>% curtas</td><td>${e(dcFmtPct(cur))}</td><td>${e(dcFmtPct(curEq))}</td></tr>`
    + `<tr><td>Tempo médio falado (sem curtas)</td><td>${e(dcFmtSeg(qa.seg_falados_medio_sem_curtas))}</td><td>${e(dcFmtSeg(qe.seg_falados_medio_sem_curtas))}</td></tr>`
    + `<tr><td>Espera média do cliente</td><td>${e(dcFmtSeg(qa.seg_espera_medio))}</td><td>${e(dcFmtSeg(qe.seg_espera_medio))}</td></tr>`
    + '</tbody></table></div><h4 style="margin-top:var(--space-4)">Tabulação <small>barra de cima: consultor · de baixo: equipe</small></h4>' + mix;
  const res = rx.resultado || {}, sa = res.semana_atual || {}, san = res.semana_anterior || {};
  const conv = (v, a) => dcTaxa(v, a);
  const chip = (atual, ant) => { const v = dcVariacao(atual, ant); return v === null ? '' : ` <span class="bmChip ${v >= 0 ? 'sobe' : 'desce'}">${v >= 0 ? '▲' : '▼'} ${Math.round(Math.abs(v) * 100)}%</span>`; };
  const resultado = '<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Dia</th><th>Atendidas</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>'
    + (Array.isArray(res.dias) ? res.dias : []).map(d => `<tr><td>${e(dcDdMm(d.dia))}</td><td>${e(dcFmtNum(d.atendidas))}</td><td>${e(dcFmtNum(d.vendas))}</td><td>${e(dcFmtPct(conv(d.vendas, d.atendidas)))}</td></tr>`).join('')
    + `<tr><td><b>Últimos 7 dias úteis</b></td><td><b>${e(dcFmtNum(sa.atendidas))}</b>${chip(sa.atendidas, san.atendidas)}</td><td><b>${e(dcFmtNum(sa.vendas))}</b>${chip(sa.vendas, san.vendas)}</td><td><b>${e(dcFmtPct(conv(sa.vendas, sa.atendidas)))}</b></td></tr>`
    + `<tr><td>Semana anterior</td><td>${e(dcFmtNum(san.atendidas))}</td><td>${e(dcFmtNum(san.vendas))}</td><td>${e(dcFmtPct(conv(san.vendas, san.atendidas)))}</td></tr>`
    + '</tbody></table></div>';
  const per = umDia ? dcDdMm(periodo.de) : dcDdMm(periodo.de) + ' a ' + dcDdMm(periodo.ate);
  return `<div class="bmCard" style="margin-top:var(--space-3)"><h4>${e(nome)} <small>Raio-X · ${e(DC_OPERACOES[rx.operacao] || '')} · ${e(per)}</small> ${fechar}</h4>${cartoes}</div>`
    + `<div class="bmGrade bmG2"><div class="bmCard"><h4>Ritmo</h4>${ritmo}</div><div class="bmCard"><h4>Qualidade</h4>${qualidade}</div></div>`
    + `<div class="bmGrade"><div class="bmCard"><h4>Resultado <small>vendas do discador nos últimos 7 dias úteis</small></h4>${resultado}</div></div>`;
}
```

- [ ] **Step 4: Ver passar.**

- [ ] **Step 5: Commit** — `feat(discador): HTML do Raio-X do consultor (secao 96)`.

---

### Task 4: Carga do Raio-X, corrida de cliques, recarga e janela de venda

**Files:**
- Modify: `_template.html` (`dcEstado`, `dcCarregar`, `dcAbrirDias` → `dcAbrirRaioX`, listener de `#dcConteudo`, novo listener de `#dcDetalhe`, `dcKpisHtml`)
- Test: `test_discador.js`

**Interfaces:**
- Produces:
  - `dcAbrirRaioX(agenteId, nome) → Promise`;
  - `dcEstado.raiox = {agenteId, nome} | null`;
  - `dcEstado.raioxGer`;
  - `dcEstado.consultores` (a última lista da tabela);
  - `dcEstado.janelaVenda` (número de dias; padrão 30).

- [ ] **Step 1: Testes**

```js
  // ==== §96: carga do Raio-X ====
  respostasOk();
  window.__rpcRespostas.discador_consultor_raiox = (a) => ({ data: Object.assign({}, RX, { operacao: 'apex', dias: [Object.assign({}, RX.dias[0], { atendidas: a.p_agente })] }), error: null });
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin', operacao: 'apex' };
  dcAplicarPermissao(); dcEstado.chave = 'hoje'; dcEstado.operacao = 'apex';
  await dcCarregar(); await espera(60);
  window.__rpcCalls.length = 0;
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click(); await espera(40);
  const chamadaRx = window.__rpcCalls.find(c => c.nome === 'discador_consultor_raiox');
  assert(chamadaRx && chamadaRx.args.p_agente === 193 && chamadaRx.args.p_operacao === 'apex', 'clique abre o Raio-X na operação');
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Raio-X') && document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste'), 'Raio-X na tela');
  // corrida: A (lento) e logo B — fica B
  window.__rpcAtraso = { discador_consultor_raiox: 120 };
  document.querySelector('#dcConteudo tr[data-dc-agente="189"]').click();
  window.__rpcAtraso = {};
  document.querySelector('#dcConteudo tr[data-dc-agente="193"]').click();
  await espera(200);
  assert(document.getElementById('dcDetalhe').innerHTML.includes('Caio Teste') && !document.getElementById('dcDetalhe').innerHTML.includes('Agente 189'), 'clique rápido A→B mostra B');
  // trocar o período recarrega o Raio-X aberto
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="ontem"]').click(); await espera(120);
  assert(window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox' && c.args.p_de === somaDiasStr(hojeSP(), -1)), 'trocar período recarrega o Raio-X');
  // fechar
  document.querySelector('#dcDetalhe [data-dc-fechar]').click(); await espera();
  assert(document.getElementById('dcDetalhe').innerHTML === '' && dcEstado.raiox === null, 'fechar limpa e não reabre');
  window.__rpcCalls.length = 0;
  document.querySelector('#dcPeriodos [data-dc-periodo="hoje"]').click(); await espera(100);
  assert(!window.__rpcCalls.some(c => c.nome === 'discador_consultor_raiox'), 'depois de fechar, trocar período não abre de novo');
  // janela de venda vem da config
  window.__tabelas.config = [{ chave: 'discador', valor: '{"janela_venda_dias":45}' }];
  await dcCarregar(); await espera(80);
  assert(document.getElementById('dcConteudo').innerHTML.includes('até 45 dias antes'), 'cartão de vendas usa a janela da config');
  window.__tabelas.config = [];
```

Ajustar os testes antigos que mudam de comportamento (Ruling, porque o detalhe por dia virou parte do Raio-X e o Raio-X recarrega ao trocar o período, spec §5):
- `clique no consultor busca por dia`: esperar `[['discador_consultor_raiox', 193]]` e conferir `Raio-X` e `Caio Teste` em `#dcDetalhe`;
- `trocar período limpa o detalhe`: passa a conferir que o Raio-X **recarregou** (`#dcDetalhe` contém `Raio-X`), e logo depois o teste fecha o Raio-X (`[data-dc-fechar]`) para não afetar os seguintes;
- `depois do inválido, o detalhe por dia ainda funciona`: esperar a chamada `discador_consultor_raiox`;
- `detalhe por dia na mesma operação` (§89): esperar `discador_consultor_raiox` com `p_operacao: 'campinas'`.

- [ ] **Step 2: Ver falhar.**

- [ ] **Step 3: Implementar**

1. `const dcEstado = { geracao: 0, chave: 'hoje', de: null, ate: null, operacao: 'apex' };` passa a `const dcEstado = { geracao: 0, chave: 'hoje', de: null, ate: null, operacao: 'apex', raiox: null, raioxGer: 0, consultores: null, janelaVenda: 30 };`.
2. Em `dcKpisHtml`: trocar `pedido no NEO com CNPJ atendido até 30 dias antes` por `` pedido no NEO com CNPJ atendido até ${e(String(dcEstado.janelaVenda))} dias antes ``. Atenção: essa string está dentro de um template literal, então usar `${…}` direto.
3. Em `dcCarregar`, no `Promise.all`, acrescentar ao fim do array `ppSeguro(() => sb.from('config').select('valor').eq('chave', 'discador').maybeSingle())` e o nome `cfgDc` na desestruturação. Depois do teste de geração:
   ```js
   try{ const jv = cfgDc && !cfgDc.error && cfgDc.data ? Number(JSON.parse(cfgDc.data.valor).janela_venda_dias) : NaN; dcEstado.janelaVenda = Number.isFinite(jv) && jv > 0 ? jv : 30; }catch(err){ dcEstado.janelaVenda = 30; }
   dcEstado.consultores = dados(cons);
   ```
4. Trocar a linha `document.getElementById('dcDetalhe').innerHTML = '';` em `dcCarregar` por nada (o Raio-X se refaz no fim) e, no fim de `dcCarregar` (depois de montar `dcConteudo`), acrescentar:
   ```js
   if(dcEstado.raiox) dcAbrirRaioX(dcEstado.raiox.agenteId, dcEstado.raiox.nome);
   ```
   Nas carga em que o período é inválido (`!p`), não mexer.
5. Substituir `dcAbrirDias` inteira por:
   ```js
   async function dcAbrirRaioX(agenteId, nome){
     if(!canSeeDiscador()) return;
     const p = dcPeriodo(dcEstado.chave, hojeSP(), dcEstado.de, dcEstado.ate);
     if(!p) return;
     dcEstado.raiox = { agenteId, nome };
     const ger = ++dcEstado.raioxGer, gerAba = dcEstado.geracao;
     const r = await ppSeguro(() => sb.rpc('discador_consultor_raiox', { p_agente: agenteId, p_de: p.de, p_ate: p.ate, p_operacao: dcOperacaoPedida() }));
     if(ger !== dcEstado.raioxGer || gerAba !== dcEstado.geracao || !canSeeDiscador() || !dcEstado.raiox) return;
     if(r && r.error) console.error('discador_consultor_raiox:', r.error);
     const el = document.getElementById('dcDetalhe');
     el.innerHTML = dcRaioXHtml(nome, r && !r.error && r.data && typeof r.data === 'object' ? r.data : null, dcMediaEquipe(dcEstado.consultores || []), p);
     if(typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
   }
   ```
6. O listener de `#dcConteudo` chama `dcAbrirRaioX(...)` no lugar de `dcAbrirDias(...)`.
7. Novo listener:
   ```js
   document.getElementById('dcDetalhe').addEventListener('click', function(ev){
     if(!ev.target.closest('[data-dc-fechar]')) return;
     dcEstado.raiox = null; dcEstado.raioxGer++;
     this.innerHTML = '';
   });
   ```
8. Em `dcResetar`, acrescentar `dcEstado.raiox = null; dcEstado.raioxGer++;`.
9. `dcDiasHtml` deixa de ser usada pelo painel. Manter a função, porque os testes antigos a usam (custo zero).

- [ ] **Step 4: Ver passar** `test_discador.js` e a suíte inteira (`bash run_tests.sh`). As 4 falhas conhecidas do oficial (exceljs, docx, cantos arredondados) não contam.

- [ ] **Step 5: Commit** — `feat(discador): Raio-X ao clicar no consultor, com recarga por periodo e janela de venda da config (secao 96)`.

---

### Task 5: Produção (cada passo com ok do Rafael)

1. Aplicar a migration pelo `execute_sql` em 3 partes, cada uma em transação:
   - (a) config + `discador_pausas`;
   - (b) `discador_consultores`;
   - (c) `discador_consultor_raiox` + grants.

   Rodar `discador_raiox_check.sql` e os três checks antigos. Nos antigos, os asserts de `discador_consultores` continuam válidos, porque as colunas antigas não mudaram.
2. Conferir com dado real (como supervisor, em transação com ROLLBACK): `discador_consultores('2026-10-15','2026-10-15')` traz jornada, horas, pausas e curtas para os 15 agentes; `discador_consultor_raiox(193, '2026-10-15', '2026-10-15')` monta sem erro.
3. Publicação do painel:
   - merge do oficial, build e testes;
   - comparar o painel no ar com o build do oficial;
   - backup, publicação e MD5;
   - REGRAS **§96** (conferir se ainda está livre);
   - push e vigia.

---

## Self-Review

- **Spec §3 (definições):** Task 1 (SQL) e Tasks 2 e 3 (destaques).
- **Spec §4.1–4.4:** Task 1.
- **Spec §5:**
  - colunas → Task 2;
  - Raio-X → Task 3;
  - abrir, fechar e recarregar, corrida A→B e janela de venda → Task 4.
- **Spec §6:** Task 5.
- **Nomes consistentes:** as chaves do `jsonb` (`dias`, `por_hora`, `pausas`, `qualidade.agente/equipe`, `mix`, `resultado.dias/semana_atual/semana_anterior`) são as mesmas no SQL (Task 1) e no JS (Task 3). As colunas novas `jornada_inicio`, `jornada_fim`, `horas_ativas`, `pausas` e `curtas` batem entre a Task 1 e a Task 2.
- **Review Focus:**
  - item 1 → Task 3 (`rx0`) e Task 1 (dia vazio);
  - item 2 → Task 1 (agente com um atendimento e `lead` por dia);
  - item 3 → Task 4;
  - item 4 → Task 4;
  - item 5 → Task 1.
