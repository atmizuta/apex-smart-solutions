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
      from generate_series(7, 22) as g(h)  -- Campinas começa ~8h
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

-- Ritmo por hora da aba: 7h–22h (antes 9h–21h; Campinas começa ~8h e as chamadas das 8h sumiam do gráfico). Mesma assinatura.
create or replace function public.discador_por_hora(p_de date, p_ate date, p_operacao text default null)
returns table (hora int, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint,
               media_atendidas numeric, media_abandonadas numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  with per as (
    select extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de, p_ate, v_op) c
  ), ref as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as dia,
           extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de - 28, p_de - 7, v_op) c
     where p_de = p_ate
       and (c.gerada_em at time zone 'America/Sao_Paulo')::date in (p_de - 7, p_de - 14, p_de - 21, p_de - 28)
  ), nd as (
    select count(distinct ref.dia) as n from ref
  ), a as (
    select per.h, count(*) as t,
           count(*) filter (where per.status in ('ANSWERED', 'ABANDONED')) as ct,
           count(*) filter (where per.status = 'ANSWERED' and per.agente_id is not null) as atd,
           count(*) filter (where per.status = 'ABANDONED') as abd
      from per group by per.h
  ), r as (
    select ref.h,
           count(*) filter (where ref.status = 'ANSWERED' and ref.agente_id is not null) as atd,
           count(*) filter (where ref.status = 'ABANDONED') as abd
      from ref group by ref.h
  )
  select g.h, coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0),
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.atd, 0)::numeric / nd.n, 1) end,
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.abd, 0)::numeric / nd.n, 1) end
    from generate_series(7, 22) as g(h)
    cross join nd
    left join a on a.h = g.h
    left join r on r.h = g.h
   order by g.h;
end $$;
grant execute on function public.discador_por_hora(date, date, text) to authenticated;
