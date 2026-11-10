-- §146.1: nota (conversão 14 dias + velocidade últimos 10) e fatia (piso/teto) de cada consultor que pega lead.
-- Spec §4. Sem DROP. Check: supabase/tests/leads_dist_notas_check.sql.
begin;

-- Fatias proporcionais às notas, presas entre piso e teto ("enchimento": prende quem passou do teto, depois quem ficou abaixo
-- do piso, e redistribui o resto entre os livres até estabilizar). Limite impossível → divide igual.
create or replace function public.leads_dist_fatias(p_notas numeric[], p_piso numeric, p_teto numeric)
 returns numeric[] language plpgsql immutable set search_path to 'public'
as $function$
declare n int := coalesce(array_length(p_notas, 1), 0); f numeric[]; fixo boolean[]; resto numeric; soma numeric;
  livres int; mudou boolean; i int; volta int := 0;
begin
  if n = 0 then return '{}'::numeric[]; end if;
  if n * p_piso > 1 or n * p_teto < 1 then return array_fill(round(1.0 / n, 6), array[n]); end if;
  fixo := array_fill(false, array[n]); f := array_fill(0::numeric, array[n]);
  loop
    volta := volta + 1;
    resto := 1; soma := 0; livres := 0;
    for i in 1..n loop
      if fixo[i] then resto := resto - f[i];
      else soma := soma + greatest(coalesce(p_notas[i], 0), 0); livres := livres + 1; end if;
    end loop;
    exit when livres = 0;
    for i in 1..n loop
      if not fixo[i] then
        f[i] := case when soma > 0 then resto * greatest(coalesce(p_notas[i], 0), 0) / soma else resto / livres end;
      end if;
    end loop;
    mudou := false;
    for i in 1..n loop
      if not fixo[i] and f[i] > p_teto then f[i] := p_teto; fixo[i] := true; mudou := true; end if;
    end loop;
    if not mudou then
      for i in 1..n loop
        if not fixo[i] and f[i] < p_piso then f[i] := p_piso; fixo[i] := true; mudou := true; end if;
      end loop;
    end if;
    exit when not mudou or volta > 2 * n;
  end loop;
  for i in 1..n loop f[i] := round(f[i], 6); end loop;
  return f;
end $function$;

-- Componentes da nota (sem a fatia). Grupo = leads_equipe.pode_pegar. Ativo hoje = abriu o painel hoje (SP).
create or replace function public.leads_dist_notas_base(p_agora timestamptz default now())
 returns table (consultor_id uuid, nome text, ativo boolean, conv numeric, vel numeric, nota numeric,
                recebidos_hoje int, ultimo_recebido timestamptz, vel_n int, vel_ok int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  c jsonb := public.leads_dist_cfg();
  v_mat numeric := (c ->> 'maturacao_dias')::numeric; v_jan numeric := (c ->> 'janela_dias')::numeric;
  v_kc numeric := (c ->> 'suav_conv')::numeric; v_kv numeric := (c ->> 'suav_vel')::numeric;
  v_prazo interval := make_interval(mins => (c ->> 'prazo_atender_min')::int);
  v_ult int := (c ->> 'vel_ultimas')::int; v_peso numeric := (c ->> 'peso_conversao')::numeric;
  v_hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with eq as (
    select distinct on (e.profile_id) e.profile_id, e.nome_planilha
      from public.leads_equipe e where e.pode_pegar and e.profile_id is not null order by e.profile_id, e.id
  ), cv as (   -- conversão: peso 1,0 (maturação) até 0,5 (maturação + janela)
    select x.dono_id, sum(x.w) sw, sum(x.w * x.conv01) sc
      from (select l.dono_id, case when l.converteu then 1 else 0 end conv01,
                   1.0 - 0.5 * least(1.0, greatest(0.0, (extract(epoch from p_agora - l.pego_em) / 86400.0 - v_mat) / v_jan)) w
              from public.leads l
             where l.dono_id in (select profile_id from eq) and l.apagado_em is null
               and l.pego_em >= p_agora - make_interval(days => (v_mat + v_jan)::int)
               and l.pego_em <  p_agora - make_interval(days => v_mat::int)) x
     group by x.dono_id
  ), ent as (   -- velocidade: só entregas já decididas (atendidas ou com o prazo passado)
    select d.consultor_id cid, d.recebido_em, d.atendido_em, d.confirmado,
           row_number() over (partition by d.consultor_id order by d.recebido_em desc) rn
      from public.leads_distribuicao d
     where d.tipo in ('auto', 'pegou') and d.recebido_em is not null and d.consultor_id in (select profile_id from eq)
       and (d.atendido_em is not null or d.recebido_em <= p_agora - v_prazo)
  ), vl as (
    select ent.cid, count(*)::int vn,
           count(*) filter (where ent.atendido_em is not null and ent.atendido_em - ent.recebido_em <= v_prazo
                              and ent.confirmado is distinct from false)::int vok
      from ent where ent.rn <= v_ult group by ent.cid
  ), rh as (
    select d.consultor_id cid,
           count(*) filter (where (d.recebido_em at time zone 'America/Sao_Paulo')::date = v_hoje)::int n,
           max(d.recebido_em) ult
      from public.leads_distribuicao d where d.tipo in ('auto', 'pegou') and d.recebido_em is not null group by d.consultor_id
  ), base as (
    select eq.profile_id, eq.nome_planilha,
           coalesce((pr.visto_em at time zone 'America/Sao_Paulo')::date = v_hoje, false) ativo,
           coalesce(cv.sw, 0) sw, coalesce(cv.sc, 0) sc, coalesce(vl.vn, 0) vn, coalesce(vl.vok, 0) vok,
           coalesce(rh.n, 0) rn, rh.ult
      from eq
      left join cv on cv.dono_id = eq.profile_id
      left join vl on vl.cid = eq.profile_id
      left join rh on rh.cid = eq.profile_id
      left join public.leads_presenca pr on pr.profile_id = eq.profile_id
  ), med as (
    select case when sum(sw) > 0 then sum(sc) / sum(sw) else 0 end mc,
           case when sum(vn) > 0 then sum(vok)::numeric / sum(vn) else 0 end mv
      from base
  ), cvv as (
    select b.*, (b.sc + v_kc * m.mc) / (b.sw + v_kc) c_, (b.vok + v_kv * m.mv) / (b.vn + v_kv) v_ from base b, med m
  ), ma as (
    select avg(c_) filter (where ativo) mac, avg(v_) filter (where ativo) mav from cvv
  )
  select cvv.profile_id, cvv.nome_planilha, cvv.ativo, round(cvv.c_, 4), round(cvv.v_, 4),
         round(v_peso * (case when coalesce(ma.mac, 0) > 0 then cvv.c_ / ma.mac else 1 end)
             + (1 - v_peso) * (case when coalesce(ma.mav, 0) > 0 then cvv.v_ / ma.mav else 1 end), 4),
         cvv.rn, cvv.ult, cvv.vn, cvv.vok
    from cvv, ma;
end $function$;

-- Nota + fatia (fatia só entre os ativos hoje).
create or replace function public.leads_dist_notas(p_agora timestamptz default now())
 returns table (consultor_id uuid, nome text, ativo boolean, conv numeric, vel numeric, nota numeric, fatia numeric,
                recebidos_hoje int, ultimo_recebido timestamptz, vel_n int, vel_ok int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare c jsonb := public.leads_dist_cfg(); v_ids uuid[]; v_notas numeric[]; v_f numeric[];
begin
  select array_agg(b.consultor_id order by b.consultor_id), array_agg(b.nota order by b.consultor_id)
    into v_ids, v_notas from public.leads_dist_notas_base(p_agora) b where b.ativo;
  v_f := public.leads_dist_fatias(coalesce(v_notas, '{}'::numeric[]), (c ->> 'piso')::numeric, (c ->> 'teto')::numeric);
  return query
  select b.consultor_id, b.nome, b.ativo, b.conv, b.vel, b.nota,
         case when b.ativo then v_f[array_position(v_ids, b.consultor_id)] end,
         b.recebidos_hoje, b.ultimo_recebido, b.vel_n, b.vel_ok
    from public.leads_dist_notas_base(p_agora) b order by b.nome;
end $function$;

revoke execute on function public.leads_dist_fatias(numeric[], numeric, numeric) from public, anon, authenticated;
revoke execute on function public.leads_dist_notas_base(timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_notas(timestamptz) from public, anon, authenticated;

commit;
