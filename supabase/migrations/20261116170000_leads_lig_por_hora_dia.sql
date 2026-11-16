-- §155 (16/11/2026): ligações por hora (13h–20h) de cada consultor num dia escolhido, para a visão Dia da Equipe no layout
-- do Mês. Mesma regra da leads_atividade_equipe2 (leads_equipe.usuario_telefonia × ligacoes_manuais.usuario, hora de SP).
-- Só admin/supervisor.
begin;
create or replace function public.leads_lig_por_hora_dia(p_dia date)
returns table(dono_id uuid, lig_por_hora integer[])
language plpgsql stable security definer set search_path to 'public' as $fn$
#variable_conflict use_column
declare v_ini timestamptz := p_dia::timestamp at time zone 'America/Sao_Paulo';
  v_fim timestamptz := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with eq as (
    select distinct on (e.profile_id) e.profile_id as e_id, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
      from public.leads_equipe e where e.profile_id is not null order by e.profile_id, e.id
  ), lig as (
    select lower(btrim(m.usuario)) as l_u, extract(hour from m.gerada_em at time zone 'America/Sao_Paulo')::int as l_h
      from public.ligacoes_manuais m where m.gerada_em >= v_ini and m.gerada_em < v_fim
  )
  select eq.e_id,
         array(select (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u and lig.l_h = h.h)::int
                 from generate_series(13, 20) as h(h) order by h.h)
    from eq;
end $fn$;
revoke execute on function public.leads_lig_por_hora_dia(date) from public, anon;
grant execute on function public.leads_lig_por_hora_dia(date) to authenticated;
commit;
