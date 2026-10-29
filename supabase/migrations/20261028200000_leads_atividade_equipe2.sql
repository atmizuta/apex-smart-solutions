-- §126.3 (redesign de Meus leads, Fase 3): atividade da equipe + ligações por hora (13h–20h, SP) + meta diária + pode_pegar.
-- Função NOVA (sem DROP): a leads_atividade_equipe() continua no banco para abas abertas com o painel antigo.
-- Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_atividade_equipe2_check.sql (ROLLBACK).
begin;
create or replace function public.leads_atividade_equipe2()
 returns table(dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamp with time zone, lig_hoje integer,
               ultima_obs timestamp with time zone, obs_hoje integer, lig_por_hora integer[], meta_dia integer, pode_pegar boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini_dia timestamptz; v_meta int;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select nullif(cfg.valor::jsonb ->> 'meta_ligacoes_dia', '')::int into v_meta from public.config cfg where cfg.chave = 'monitor_leads_metas';
  v_meta := coalesce(v_meta, 80);
  return query
  with eq as (
    select e.profile_id as e_id, p.nome as e_nome, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u, coalesce(e.pode_pegar, false) as e_pode
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null
  ), obs as (   -- OBS escrita = classificação que mudou a OBS para um texto não vazio (igual à leads_atividade_equipe)
    select h.por as o_por, h.em as o_em from public.leads_historico h
     where h.acao = 'classificar' and h.em >= now() - interval '7 days'
       and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
       and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), '')
  ), lig as (   -- ligações de hoje (SP), pela mesma regra de usuário da leads_atividade_equipe
    select lower(btrim(m.usuario)) as l_u, m.gerada_em as l_em from public.ligacoes_manuais m where m.gerada_em >= v_ini_dia
  )
  select eq.e_id, eq.e_nome, eq.e_u is not null,
         (select max(m.gerada_em) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= now() - interval '7 days'),
         (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u)::int,
         (select max(o.o_em) from obs o where o.o_por = eq.e_id),
         (select count(*) from obs o where o.o_por = eq.e_id and o.o_em >= v_ini_dia)::int,
         array(select (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u
                         and extract(hour from lig.l_em at time zone 'America/Sao_Paulo') = h.h)::int
                 from generate_series(13, 20) as h(h) order by h.h),
         v_meta, eq.e_pode
    from eq order by eq.e_nome;
end $function$;
revoke execute on function public.leads_atividade_equipe2() from public, anon;
grant execute on function public.leads_atividade_equipe2() to authenticated;
commit;
