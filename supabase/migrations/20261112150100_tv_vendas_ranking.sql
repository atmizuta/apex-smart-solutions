-- §149 TV Vendas — parte 2: contatos, ranking (Hoje | Mês), vendas novas para a festa e meta do dia.
-- Contato = conversa no discador (tabulação ≠ SEM CONTATO) + lead classificado; um CNPJ conta uma vez por consultor e dia.
-- O mês tem ~370 mil chamadas: dias até anteontem vão para tv_contatos_cache (o robô ainda completa o dia anterior).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_vendas_ranking_check.sql.
begin;

create table if not exists public.tv_contatos_cache (
  dia         date not null,
  profile_id  uuid not null,
  contatos    int not null,
  primary key (dia, profile_id)
);
create table if not exists public.tv_contatos_cache_dias (
  dia       date primary key,
  feito_em  timestamptz not null default now()
);
alter table public.tv_contatos_cache enable row level security;
alter table public.tv_contatos_cache_dias enable row level security;
revoke all on table public.tv_contatos_cache from public, anon, authenticated;
revoke all on table public.tv_contatos_cache_dias from public, anon, authenticated;

create or replace function public.tv_contatos_calc(p_de date, p_ate date)
 returns table(dia date, profile_id uuid, contatos int)
 language sql stable security definer set search_path to 'public'
as $$
  with disc as (
    select (d.gerada_em at time zone 'America/Sao_Paulo')::date as dia, a.profile_id,
           coalesce(nullif(regexp_replace(coalesce(d.cnpj, ''), '\D', '', 'g'), ''), 'ch' || d.id) as chave
      from public.discador_chamadas d
      join public.discador_agente a on a.agente_id = d.agente_id and a.profile_id is not null
     where d.operacao = 'apex'
       and d.gerada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.gerada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and d.tabulacao is not null and d.tabulacao <> 'SEM CONTATO'
  ), lds as (
    select (h.em at time zone 'America/Sao_Paulo')::date as dia, h.por as profile_id,
           coalesce(nullif(regexp_replace(coalesce(l.cnpj, ''), '\D', '', 'g'), ''), 'ld' || h.lead_aba || '|' || h.lead_id) as chave
      from public.leads_historico h
      join public.leads l on l.aba = h.lead_aba and l.id = h.lead_id
     where h.acao = 'classificar' and h.por is not null
       and h.em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and h.em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  )
  select x.dia, x.profile_id, count(distinct x.chave)::int
    from (select * from disc union all select * from lds) x
   group by x.dia, x.profile_id
$$;

create or replace function public.tv_contatos(p_de date, p_ate date)
 returns table(profile_id uuid, contatos int)
 language plpgsql security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_corte date := public.tv_hoje() - 2; v_dia date;
begin
  for v_dia in select g::date from generate_series(p_de, least(p_ate, v_corte), interval '1 day') g loop
    if not exists (select 1 from public.tv_contatos_cache_dias c where c.dia = v_dia) then
      insert into public.tv_contatos_cache (dia, profile_id, contatos)
        select t.dia, t.profile_id, t.contatos from public.tv_contatos_calc(v_dia, v_dia) t
        on conflict (dia, profile_id) do update set contatos = excluded.contatos;
      insert into public.tv_contatos_cache_dias (dia) values (v_dia) on conflict (dia) do nothing;
    end if;
  end loop;
  return query
    select s.pid, sum(s.n)::int from (
      select c.profile_id as pid, c.contatos as n from public.tv_contatos_cache c
       where c.dia between p_de and least(p_ate, v_corte)
      union all
      select t.profile_id, t.contatos from public.tv_contatos_calc(greatest(p_de, v_corte + 1), p_ate) t
       where p_ate > v_corte
    ) s group by s.pid;
end $function$;

create or replace function public.tv_meta_atual()
 returns int language sql stable security definer set search_path to 'public'
as $$ select m.meta from public.tv_meta_dia m where m.dia <= public.tv_hoje() order by m.dia desc limit 1 $$;

-- Posição no ranking do mês contando só as vendas até p_ate_id (ordem: vendas, depois receita). Nula sem venda.
create or replace function public.tv_posicao_mes(p_consultor uuid, p_ate_id bigint, p_de date, p_ate date)
 returns int language sql stable security definer set search_path to 'public'
as $$
  with v as (
    select x.consultor_id, count(*) as n, sum(x.receita) as r
      from public.vendas_marcadas x
     where x.operacao = 'apex' and x.cancelada_em is null and x.dia between p_de and p_ate and x.id <= p_ate_id
     group by x.consultor_id
  ), o as (select v.consultor_id, rank() over (order by v.n desc, v.r desc) as pos from v)
  select o.pos::int from o where o.consultor_id = p_consultor
$$;

create or replace function public.tv_ranking(p_periodo text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := public.tv_hoje(); v_de date; v_linhas jsonb; v_tot jsonb; v_ult jsonb; v_meta jsonb;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_periodo is null or p_periodo not in ('hoje', 'mes') then raise exception 'período inválido' using errcode = '22023'; end if;
  v_de := case when p_periodo = 'hoje' then v_hoje else date_trunc('month', v_hoje)::date end;
  with cont as (select * from public.tv_contatos(v_de, v_hoje)),
  vend as (
    select v.consultor_id, count(*)::int as vendas, sum(v.receita) as receita
      from public.vendas_marcadas v
     where v.operacao = 'apex' and v.cancelada_em is null and v.dia between v_de and v_hoje
     group by v.consultor_id
  ), base as (
    select p.id, p.nome, coalesce(c.contatos, 0) as contatos, coalesce(x.vendas, 0) as vendas, coalesce(x.receita, 0) as receita
      from public.profiles p
      left join cont c on c.profile_id = p.id
      left join vend x on x.consultor_id = p.id
     where coalesce(p.operacao, 'apex') = 'apex'
       and ((p.role = 'consultor' and (coalesce(c.contatos, 0) > 0 or coalesce(x.vendas, 0) > 0)) or coalesce(x.vendas, 0) > 0)
  ), ord as (
    select b.*, case when b.vendas > 0 then rank() over (partition by (b.vendas > 0) order by b.vendas desc, b.receita desc) end as posicao
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', o.id, 'nome', o.nome, 'contatos', o.contatos, 'vendas', o.vendas,
             'receita', o.receita, 'conversao', case when o.contatos > 0 then round(100.0 * o.vendas / o.contatos, 1) end,
             'posicao', o.posicao) order by o.vendas desc, o.receita desc, o.contatos desc, o.nome), '[]'::jsonb),
         jsonb_build_object('contatos', coalesce(sum(o.contatos), 0), 'vendas', coalesce(sum(o.vendas), 0),
             'receita', coalesce(sum(o.receita), 0),
             'conversao', case when sum(o.contatos) > 0 then round(100.0 * sum(o.vendas) / sum(o.contatos), 1) end)
    into v_linhas, v_tot
    from ord o;
  v_meta := jsonb_build_object('dia', v_hoje, 'meta', public.tv_meta_atual(),
    'vendas_hoje', (select count(*) from public.vendas_marcadas v where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje));
  select jsonb_build_object('nome', p.nome, 'em', v.marcada_em) into v_ult
    from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
   where v.operacao = 'apex' and v.cancelada_em is null order by v.id desc limit 1;
  return jsonb_build_object('periodo', p_periodo, 'de', v_de, 'ate', v_hoje, 'linhas', v_linhas, 'totais', v_tot,
                            'meta', v_meta, 'ultima', v_ult, 'gerado_em', now());
end $function$;

-- A consulta barata da TV (a cada 3 s): último id, cancelamentos de hoje (a TV tira da fila) e a meta.
create or replace function public.tv_ultima_venda()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_ini timestamptz := (public.tv_hoje()::timestamp at time zone 'America/Sao_Paulo');
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ultimo_id', (select max(v.id) from public.vendas_marcadas v where v.operacao = 'apex'),
    'cancelados_ids', coalesce((select jsonb_agg(v.id order by v.id) from public.vendas_marcadas v
                                 where v.operacao = 'apex' and v.cancelada_em >= v_ini), '[]'::jsonb),
    'meta', public.tv_meta_atual());
end $function$;

-- Vendas novas para o VENDEU!: só de hoje, não canceladas e dos últimos 15 min (TV que ficou sem internet não
-- solta festa de venda velha). No máximo 20 por chamada.
create or replace function public.tv_vendas_desde(p_id bigint)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := public.tv_hoje(); v_mes date := date_trunc('month', public.tv_hoje())::date;
        r record; v_out jsonb := '[]'::jsonb; v_cts jsonb; v_ct int; v_vh int;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_object_agg(t.profile_id::text, t.contatos), '{}'::jsonb) into v_cts
    from public.tv_contatos_calc(v_hoje, v_hoje) t;
  for r in
    select v.id, v.consultor_id, v.receita, v.origem, p.nome
      from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
     where v.operacao = 'apex' and v.id > coalesce(p_id, 0) and v.cancelada_em is null and v.dia = v_hoje
       and v.marcada_em > now() - interval '15 minutes'
     order by v.id limit 20
  loop
    select count(*) into v_vh from public.vendas_marcadas x
     where x.consultor_id = r.consultor_id and x.operacao = 'apex' and x.cancelada_em is null and x.dia = v_hoje and x.id <= r.id;
    v_ct := coalesce((v_cts ->> r.consultor_id::text)::int, 0);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'consultor_id', r.consultor_id, 'nome', r.nome, 'receita', r.receita, 'origem', r.origem,
      'vendas_hoje', v_vh, 'contatos_hoje', v_ct,
      'conversao_hoje', case when v_ct > 0 then round(100.0 * v_vh / v_ct, 1) end,
      'pos_antes', public.tv_posicao_mes(r.consultor_id, r.id - 1, v_mes, v_hoje),
      'pos_depois', public.tv_posicao_mes(r.consultor_id, r.id, v_mes, v_hoje)));
  end loop;
  return v_out;
end $function$;

create or replace function public.tv_meta_definir(p_meta int)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_meta is null or p_meta < 1 or p_meta > 1000 then raise exception 'Meta de 1 a 1000 vendas.' using errcode = '22023'; end if;
  insert into public.tv_meta_dia (dia, meta, definida_por) values (public.tv_hoje(), p_meta, auth.uid())
  on conflict (dia) do update set meta = excluded.meta, definida_por = excluded.definida_por, definida_em = now();
end $function$;

-- "Sim" uma vez por dia, quando as vendas de hoje chegam na meta (update … where comemorada_em is null).
create or replace function public.tv_meta_comemorar()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := public.tv_hoje(); v_meta int := public.tv_meta_atual(); v_vendas int; v_ok timestamptz; v_pessoas jsonb;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if v_meta is null then return jsonb_build_object('comemorar', false); end if;
  select count(*) into v_vendas from public.vendas_marcadas v where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje;
  if v_vendas < v_meta then return jsonb_build_object('comemorar', false, 'vendas', v_vendas, 'meta', v_meta); end if;
  insert into public.tv_meta_dia (dia, meta) values (v_hoje, v_meta) on conflict (dia) do nothing;
  update public.tv_meta_dia set comemorada_em = now() where dia = v_hoje and comemorada_em is null returning comemorada_em into v_ok;
  if v_ok is null then return jsonb_build_object('comemorar', false, 'vendas', v_vendas, 'meta', v_meta); end if;
  select coalesce(jsonb_agg(jsonb_build_object('nome', x.nome, 'vendas', x.n) order by x.n desc, x.nome), '[]'::jsonb) into v_pessoas
    from (select p.nome, count(*)::int as n from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
           where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje group by p.nome) x;
  return jsonb_build_object('comemorar', true, 'vendas', v_vendas, 'meta', v_meta, 'pessoas', v_pessoas);
end $function$;

revoke all on function public.tv_contatos_calc(date, date) from public, anon, authenticated;
revoke all on function public.tv_contatos(date, date) from public, anon, authenticated;
revoke all on function public.tv_posicao_mes(uuid, bigint, date, date) from public, anon, authenticated;
revoke all on function public.tv_meta_atual() from public, anon;
revoke all on function public.tv_ranking(text) from public, anon;
revoke all on function public.tv_ultima_venda() from public, anon;
revoke all on function public.tv_vendas_desde(bigint) from public, anon;
revoke all on function public.tv_meta_definir(int) from public, anon;
revoke all on function public.tv_meta_comemorar() from public, anon;
grant execute on function public.tv_meta_atual() to authenticated;
grant execute on function public.tv_ranking(text) to authenticated;
grant execute on function public.tv_ultima_venda() to authenticated;
grant execute on function public.tv_vendas_desde(bigint) to authenticated;
grant execute on function public.tv_meta_definir(int) to authenticated;
grant execute on function public.tv_meta_comemorar() to authenticated;

commit;

-- Índice parcial das conversas da Apex (≈11 mil em 30 dias numa tabela de 1 milhão): sem ele, o mês lê ~370 mil
-- chamadas (14,6 s medidos em 12/11). CONCURRENTLY não roda dentro de transação: mandar este comando SOZINHO,
-- depois do commit acima. Não trava o robô (só leitura da tabela durante a construção).
create index concurrently if not exists idx_discador_conversa_apex on public.discador_chamadas (gerada_em)
  include (agente_id, cnpj)
  where operacao = 'apex' and tabulacao is not null and tabulacao <> 'SEM CONTATO';
