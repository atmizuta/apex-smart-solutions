-- §122 (28/10, Rafael): só Luria, Lucas, Caio e Mariana pegam lead (quem já tem lead fica com ele; o gestor
-- continua redistribuindo para qualquer um). Hoje ganha o placar do dia. Quem pode pegar recebe o alerta lead_novo.
alter table public.leads_equipe add column if not exists pode_pegar boolean not null default false;
update public.leads_equipe set pode_pegar = true where nome_planilha in ('Luria', 'Lucas', 'Caio', 'Mariana');

create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_pode boolean; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha, e.pode_pegar into v_nome, v_pode from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  if not coalesce(v_pode, false) then raise exception 'você não está liberado para pegar leads' using errcode = '42501'; end if;
  update public.leads l set dono_id = auth.uid(), consultor = v_nome, pego_em = now()
   where l.aba = p_aba and l.id = p_id and l.dono_id is null and l.categoria = 'sem_contato' and l.apagado_em is null;
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
end $function$;

create or replace function public.leads_hoje(p_dono uuid default null::uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_esf int;
        v_ini_mes timestamptz; v_ini_dia timestamptz; v_fim_dia timestamptz; v_out jsonb;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_esf := coalesce(((select valor::jsonb from public.config where chave = 'leads_alertas') ->> 'esfriando_dias')::int, 2);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_fim_dia := (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo';
  with base as (
    select l.aba as b_aba, l.id as b_id, l.full_name as b_nome, l.categoria as b_cat, l.pego_em as b_pego, l.criado_em_lead as b_criado,
           l.classificado_em as b_class, l.status as b_status, i.ultimo as b_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null and (v_alvo is null or l.dono_id = v_alvo)
       and (l.categoria in ('sem_contato', 'andamento')
            or (l.categoria = 'perdido' and coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes
                and public.norm_nome(l.status) = 'cliente nao responde'))
  ), ret as (
    select a.lead_aba as r_aba, a.lead_id as r_id, a.quando as r_quando from public.agenda_retornos a
     where a.status = 'pendente' and a.lead_id is not null and (v_alvo is null or a.consultor_id = v_alvo)
  ), fila as (
    select 1 as prio, b.b_aba, b.b_id, b.b_nome, 'Novo sem contato'::text as motivo, coalesce(b.b_pego, b.b_criado) as desde from base b
     where b.b_cat = 'sem_contato' and b.b_ult is null
    union all
    select 2, b.b_aba, b.b_id, b.b_nome, 'Retorno vencido', r.r_quando from base b join ret r on r.r_aba = b.b_aba and r.r_id = b.b_id
     where r.r_quando <= now()
    union all
    select 3, b.b_aba, b.b_id, b.b_nome, 'Esfriando', coalesce(b.b_ult, b.b_pego, b.b_criado) from base b
     where b.b_cat = 'andamento' and coalesce(b.b_ult, b.b_pego, b.b_criado) < now() - make_interval(days => v_esf)
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())
    union all
    select 4, b.b_aba, b.b_id, b.b_nome, 'Para resgatar', coalesce(b.b_ult, b.b_class, b.b_criado) from base b
     where b.b_cat = 'perdido' and coalesce(b.b_ult, b.b_class, b.b_criado) < now() - make_interval(days => v_esf)
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())
  ), unica as (
    select distinct on (f.b_aba, f.b_id) f.* from fila f order by f.b_aba, f.b_id, f.prio
  ), rh as (   -- §122: retornos marcados para hoje (não cancelados)
    select a.lead_aba as h_aba, a.lead_id as h_id, a.status as h_status from public.agenda_retornos a
     where a.lead_id is not null and a.status <> 'cancelado' and a.quando >= v_ini_dia and a.quando < v_fim_dia
       and (v_alvo is null or a.consultor_id = v_alvo)
  )
  select jsonb_build_object(
    'fila', coalesce((select jsonb_agg(jsonb_build_object('aba', u.b_aba, 'lead_id', u.b_id, 'nome', u.b_nome, 'motivo', u.motivo, 'desde', u.desde)
                                       order by u.prio, u.desde) from unica u), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('aba', r.r_aba, 'lead_id', r.r_id, 'nome', l.full_name, 'quando', r.r_quando,
                                                             'vencido', r.r_quando <= now()) order by r.r_quando)
                            from ret r join public.leads l on l.aba = r.r_aba and l.id = r.r_id where r.r_quando < v_fim_dia), '[]'::jsonb),
    'livres', (select count(*) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
                 and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null and l.criado_em_lead >= now() - interval '60 days'),
    'placar', jsonb_build_object(
      'classificacoes', (select count(*) from public.leads_historico h
                          where h.acao = 'classificar' and h.em >= v_ini_dia and (v_alvo is null or h.por = v_alvo)),
      'retornos_hoje', (select count(*) from rh),
      'retornos_cumpridos', (select count(*) from rh
                               join public.leads l on l.aba = rh.h_aba and l.id = rh.h_id
                               cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
                              where rh.h_status = 'feito' or i.ultimo >= v_ini_dia
                                 or exists (select 1 from public.leads_historico h where h.lead_aba = rh.h_aba and h.lead_id = rh.h_id
                                               and h.acao = 'classificar' and h.em >= v_ini_dia))))
  into v_out;
  return v_out;
end $function$;

create or replace function public.leads_alertas(p_dono uuid default null::uuid)
 returns table(tipo text, aba text, lead_id text, nome text, dono_id uuid, dono_nome text, desde timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_cfg jsonb;
        v_min int; v_parado int; v_ini_mes timestamptz; v_aberto boolean; v_inicio timestamptz; v_pode boolean;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_pode := not v_gestor and exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid() and e.pode_pegar);
  v_cfg := coalesce((select valor::jsonb from public.config where chave = 'leads_alertas'), '{}'::jsonb);
  v_min := coalesce((v_cfg ->> 'sem_contato_min')::int, 15);
  v_parado := coalesce((v_cfg ->> 'parado_dias')::int, 3);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select x.aberto, x.inicio into v_aberto, v_inicio from public.leads_expediente_hoje() x;
  return query
  with base as (
    select l.aba as l_aba, l.id as l_id, l.full_name as l_nome, l.dono_id as l_dono, l.categoria as l_cat,
           l.pego_em as l_pego, l.criado_em_lead as l_criado, l.classificado_em as l_class, i.ligacoes as l_lig, i.ultimo as l_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (v_alvo is null or l.dono_id = v_alvo)
       and (l.categoria in ('sem_contato', 'andamento')
            or (l.categoria = 'perdido' and coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
  ), al as (
    select 'sem_contato'::text as a_tipo, b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_pego, b.l_criado) as a_desde from base b
     where b.l_cat = 'sem_contato' and b.l_ult is null and v_aberto
       and now() - greatest(coalesce(b.l_pego, b.l_criado), v_inicio) >= make_interval(mins => v_min)
    union all
    select 'parado', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_ult, b.l_pego, b.l_criado) from base b
     where b.l_cat = 'andamento' and coalesce(b.l_ult, b.l_pego, b.l_criado) < now() - make_interval(days => v_parado)
       and not exists (select 1 from public.agenda_retornos a where a.lead_aba = b.l_aba and a.lead_id = b.l_id
                          and a.status = 'pendente' and a.quando > now())
    union all
    select 'perda_suspeita', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_class, b.l_criado) from base b
     where v_gestor and b.l_cat = 'perdido' and b.l_lig = 0
    union all
    select 'retorno_vencido', b.l_aba, b.l_id, b.l_nome, b.l_dono, a.quando from base b
      join public.agenda_retornos a on a.lead_aba = b.l_aba and a.lead_id = b.l_id and a.status = 'pendente'
     where a.quando < now() and (b.l_ult is null or b.l_ult < a.quando)
    union all   -- §122: lead livre que chegou há menos de 2 h, só para quem pode pegar
    select 'lead_novo', l.aba, l.id, l.full_name, null::uuid, l.criado_em_lead from public.leads l
     where v_pode and l.dono_id is null and l.categoria = 'sem_contato' and coalesce(l.aba, '') <> 'REPIQUE'
       and l.apagado_em is null and l.criado_em_lead >= now() - interval '2 hours'
  )
  select al.a_tipo, al.l_aba, al.l_id, al.l_nome, al.l_dono, p.nome, al.a_desde
    from al left join public.profiles p on p.id = al.l_dono
   order by al.a_desde;
end $function$;
