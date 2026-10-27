-- §118 Meus leads: Hoje / Quadro / Equipe — parte 2: expediente, alertas, resumo da equipe, fila do dia e retorno na Agenda.
begin;
-- Expediente de hoje (seg–sex de config.velocidade_lead, horário de SP): está aberto agora? e a hora em que abriu hoje.
create or replace function public.leads_expediente_hoje() returns table(aberto boolean, inicio timestamptz)
language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce((select valor::jsonb from public.config where chave = 'velocidade_lead'), '{}'::jsonb) j),
       h as (select (now() at time zone 'America/Sao_Paulo') agora,
                    coalesce(j -> 'seg_sex' ->> 0, '11:00')::time ini, coalesce(j -> 'seg_sex' ->> 1, '21:00')::time fim from cfg)
  select extract(isodow from agora) between 1 and 5 and agora::time >= ini and agora::time < fim,
         (agora::date + ini) at time zone 'America/Sao_Paulo'
    from h;
$$;
revoke all on function public.leads_expediente_hoje() from public, anon, authenticated;

-- Alertas (§118, 5.4). Consultor: os dele (sem perda suspeita). Gestor: do dono pedido ou de todos.
create or replace function public.leads_alertas(p_dono uuid default null)
returns table(tipo text, aba text, lead_id text, nome text, dono_id uuid, dono_nome text, desde timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_cfg jsonb;
        v_min int; v_parado int; v_ini_mes timestamptz; v_aberto boolean; v_inicio timestamptz;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
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
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE'
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
    union all
    select 'perda_suspeita', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_class, b.l_criado) from base b
     where v_gestor and b.l_cat = 'perdido' and b.l_lig = 0
    union all
    select 'retorno_vencido', b.l_aba, b.l_id, b.l_nome, b.l_dono, a.quando from base b
      join public.agenda_retornos a on a.lead_aba = b.l_aba and a.lead_id = b.l_id and a.status = 'pendente'
     where a.quando < now() and (b.l_ult is null or b.l_ult < a.quando)
  )
  select al.a_tipo, al.l_aba, al.l_id, al.l_nome, al.l_dono, p.nome, al.a_desde
    from al left join public.profiles p on p.id = al.l_dono
   order by al.a_desde;
end $$;

-- Resumo da equipe (aba Equipe) — só gestor.
create or replace function public.leads_equipe_resumo()
returns table(dono_id uuid, nome text, em_aberto int, sem_contato int, retornos_vencidos int, parados int, perdas_suspeitas int,
              pegos_mes int, convertidos_mes int, receita_mes numeric, tempo_medio_1o_contato_min numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_ini_mes timestamptz; v_ini_dia timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with a as (select x.tipo as a_tipo, x.dono_id as a_dono from public.leads_alertas(null) x),
       eq as (select e.profile_id as e_id, p.nome as e_nome from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null),
       ls as (select l.dono_id as s_dono, l.categoria as s_cat, l.pego_em as s_pego, coalesce(l.classificado_em, l.criado_em_lead) as s_quando, l.receita as s_rec
                from public.leads l where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE'),
       hoje as (select l.dono_id as h_dono, extract(epoch from (i.primeiro - l.pego_em)) / 60 as h_min
                  from public.leads l
                  cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
                 where l.pego_em >= v_ini_dia and i.primeiro is not null and i.primeiro >= l.pego_em)
  select eq.e_id, eq.e_nome,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_cat in ('sem_contato', 'andamento'))::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'sem_contato')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'retorno_vencido')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'parado')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'perda_suspeita')::int,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_pego >= v_ini_mes)::int,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_cat = 'convertido' and ls.s_quando >= v_ini_mes)::int,
         (select coalesce(sum(ls.s_rec), 0) from ls where ls.s_dono = eq.e_id and ls.s_cat = 'convertido' and ls.s_quando >= v_ini_mes),
         (select round(avg(hoje.h_min)::numeric, 1) from hoje where hoje.h_dono = eq.e_id)
    from eq order by eq.e_nome;
end $$;

-- Retorno na Agenda ligado ao lead (interna): atualiza o pendente do lead ou cria um, para o dono.
-- O gatilho caderno_agenda_preenche não deixa trocar consultor_id num UPDATE: pendente de outro dono é cancelado e um novo é criado.
create or replace function public.leads_agenda_lead(p_aba text, p_id text, p_quando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found or l.dono_id is null then return; end if;
  update public.agenda_retornos set status = 'cancelado', atualizado_em = now()
   where lead_aba = p_aba and lead_id = p_id and status = 'pendente' and consultor_id is distinct from l.dono_id;
  update public.agenda_retornos set quando = p_quando, atualizado_em = now()
   where lead_aba = p_aba and lead_id = p_id and status = 'pendente' and consultor_id = l.dono_id;
  if not found then
    insert into public.agenda_retornos (id, consultor_id, nome, telefone, chave_tel, quando, tipo, observacao, origem, status, lead_aba, lead_id)
    values (gen_random_uuid(), l.dono_id, coalesce(nullif(btrim(l.full_name), ''), 'Lead sem nome'), coalesce(l.phone_number, ''), public.chave_tel(l.phone_number), p_quando, 'ligacao', l.obs, 'manual', 'pendente', p_aba, p_id);   -- origem 'manual' (a regra da Agenda não aceita outra); o vínculo é lead_aba/lead_id
  end if;
  update public.leads set retorno_em = (p_quando at time zone 'America/Sao_Paulo')::date where aba = p_aba and id = p_id;
end $$;
revoke all on function public.leads_agenda_lead(text, text, timestamptz) from public, anon, authenticated;

create or replace function public.leads_agendar_retorno(p_aba text, p_id text, p_quando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_dono uuid;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select dono_id into v_dono from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_dono is null then raise exception 'pegue o lead antes de agendar' using errcode = '22023'; end if;
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_quando is null then raise exception 'informe a data e a hora' using errcode = '22023'; end if;
  perform public.leads_agenda_lead(p_aba, p_id, p_quando);
end $$;
revoke execute on function public.leads_agendar_retorno(text, text, timestamptz) from public, anon;
grant execute on function public.leads_agendar_retorno(text, text, timestamptz) to authenticated;
commit;

-- ===== parte 2 =====
begin;
-- Fila do dia + retornos de hoje (aba Hoje). Consultor: os dele; gestor: o dono pedido ou todos.
create or replace function public.leads_hoje(p_dono uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_esf int;
        v_ini_mes timestamptz; v_fim_dia timestamptz; v_out jsonb;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_esf := coalesce(((select valor::jsonb from public.config where chave = 'leads_alertas') ->> 'esfriando_dias')::int, 2);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_fim_dia := (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo';
  with base as (
    select l.aba as b_aba, l.id as b_id, l.full_name as b_nome, l.categoria as b_cat, l.pego_em as b_pego, l.criado_em_lead as b_criado,
           l.classificado_em as b_class, l.status as b_status, i.ultimo as b_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and (v_alvo is null or l.dono_id = v_alvo)
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
    union all
    select 4, b.b_aba, b.b_id, b.b_nome, 'Para resgatar', coalesce(b.b_ult, b.b_class, b.b_criado) from base b
     where b.b_cat = 'perdido' and coalesce(b.b_ult, b.b_class, b.b_criado) < now() - make_interval(days => v_esf)
  ), unica as (
    select distinct on (f.b_aba, f.b_id) f.* from fila f order by f.b_aba, f.b_id, f.prio
  )
  select jsonb_build_object(
    'fila', coalesce((select jsonb_agg(jsonb_build_object('aba', u.b_aba, 'lead_id', u.b_id, 'nome', u.b_nome, 'motivo', u.motivo, 'desde', u.desde)
                                       order by u.prio, u.desde) from unica u), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('aba', r.r_aba, 'lead_id', r.r_id, 'nome', l.full_name, 'quando', r.r_quando,
                                                             'vencido', r.r_quando <= now()) order by r.r_quando)
                            from ret r join public.leads l on l.aba = r.r_aba and l.id = r.r_id where r.r_quando < v_fim_dia), '[]'::jsonb),
    'livres', (select count(*) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
                 and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'))
  into v_out;
  return v_out;
end $$;
revoke execute on function public.leads_alertas(uuid) from public, anon;
revoke execute on function public.leads_equipe_resumo() from public, anon;
revoke execute on function public.leads_hoje(uuid) from public, anon;
grant execute on function public.leads_alertas(uuid) to authenticated;
grant execute on function public.leads_equipe_resumo() to authenticated;
grant execute on function public.leads_hoje(uuid) to authenticated;
commit;

-- ===== parte 3 =====
-- §118: classificar e redistribuir passam a mexer no retorno da Agenda ligado ao lead (mesma assinatura da §112).
begin;
create or replace function public.leads_classificar(p_aba text, p_id text, p_status text, p_obs text,
  p_converteu boolean, p_receita numeric, p_retorno date) returns void
language plpgsql security definer set search_path = public as $$
declare v_grupo text; v_dono uuid; v_antes jsonb; v_role text := coalesce(public.get_my_role(), '');
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select l.dono_id, jsonb_build_object('status', l.status, 'obs', l.obs, 'converteu', l.converteu, 'receita', l.receita, 'retorno_em', l.retorno_em)
    into v_dono, v_antes
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_role not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select o.grupo into v_grupo from public.leads_status_opcoes o where o.status = p_status and o.ativo;
  if v_grupo is null then raise exception 'status inválido: %', p_status using errcode = '22023'; end if;
  if p_receita is not null and p_receita < 0 then raise exception 'receita negativa' using errcode = '22023'; end if;
  if p_status = 'AGENDADO RETORNO' and p_retorno is null then raise exception 'informe a data do retorno' using errcode = '22023'; end if;
  update public.leads set
      status = p_status,
      categoria = v_grupo,
      obs = nullif(btrim(coalesce(p_obs, '')), ''),
      converteu = coalesce(p_converteu, false) or v_grupo = 'convertido',
      receita = coalesce(p_receita, 0),
      retorno_em = case when p_status = 'AGENDADO RETORNO' then p_retorno end,
      classificado_em = now(),
      classificado_por = auth.uid()
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, 'classificar', auth.uid(), v_antes,
            jsonb_build_object('status', p_status, 'obs', p_obs, 'converteu', coalesce(p_converteu, false) or v_grupo = 'convertido',
                               'receita', coalesce(p_receita, 0), 'retorno_em', p_retorno));
  if p_status = 'AGENDADO RETORNO' then
    perform public.leads_agenda_lead(p_aba, p_id, (p_retorno + time '10:00') at time zone 'America/Sao_Paulo');
  else
    update public.agenda_retornos set status = 'feito', feito_em = now(), atualizado_em = now()
     where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;

create or replace function public.leads_redistribuir(p_aba text, p_id text, p_novo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_antes jsonb; v_cat text; v_quando timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select jsonb_build_object('dono_id', l.dono_id, 'consultor', l.consultor), l.categoria into v_antes, v_cat
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if p_novo is null then
    if v_cat <> 'sem_contato' then raise exception 'lead com status não volta aos Livres; passe para outro consultor' using errcode = '22023'; end if;
  else
    select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = p_novo order by e.id limit 1;
    if v_nome is null then raise exception 'consultor fora da equipe de leads' using errcode = '22023'; end if;
  end if;
  update public.leads set dono_id = p_novo, consultor = v_nome, pego_em = case when p_novo is null then null else now() end
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, case when p_novo is null then 'devolver' else 'redistribuir' end, auth.uid(), v_antes,
            jsonb_build_object('dono_id', p_novo, 'consultor', v_nome));
  if p_novo is null then
    update public.agenda_retornos set status = 'cancelado', atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  else
    -- o retorno pendente vai junto (cancelado no dono antigo, recriado no novo — ver leads_agenda_lead)
    select a.quando into v_quando from public.agenda_retornos a
     where a.lead_aba = p_aba and a.lead_id = p_id and a.status = 'pendente' order by a.quando limit 1;
    if v_quando is not null then perform public.leads_agenda_lead(p_aba, p_id, v_quando); end if;
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;
commit;
