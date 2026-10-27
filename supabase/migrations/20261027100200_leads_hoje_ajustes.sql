-- §118, ajustes da revisão final (27/10): busca exata nos Livres, lead com retorno marcado não esfria nem fica parado,
-- e reclassificar em andamento mantém o retorno futuro. Mesmas assinaturas (create or replace).
begin;
create or replace function public.leads_buscar(p_texto text)
returns table(aba text, lead_id text, nome text, cidade text, uf text, status text, categoria text, dono_nome text,
              livre boolean, cnpj text, telefone text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        v_dig text := regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g');
        v_txt text := public.norm_nome(p_texto);
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_texto, ''))) < 3 then return; end if;
  return query
  select l.aba, l.id, l.full_name, l.city, l.state, l.status, l.categoria, p.nome,
         (l.dono_id is null and l.categoria = 'sem_contato'),
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.cnpj end,
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.phone_number end
    from public.leads l left join public.profiles p on p.id = l.dono_id
   where coalesce(l.aba, '') <> 'REPIQUE'
     and (v_gestor or l.dono_id = auth.uid() or (l.dono_id is null and l.categoria = 'sem_contato'))
     and case when length(v_dig) >= 8 and (v_gestor or l.dono_id = auth.uid())
              then regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
                or regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
              -- Livre para consultor: só CNPJ ou telefone inteiros (pedaço do número deixaria adivinhar o telefone escondido)
              when length(v_dig) >= 8
              then regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') = v_dig
                or (public.chave_tel(l.phone_number) is not null and public.chave_tel(l.phone_number) = public.chave_tel(v_dig))
              else public.norm_nome(l.full_name) like '%' || v_txt || '%' end
   order by l.criado_em_lead desc nulls last
   limit 20;
end $$;
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
       and not exists (select 1 from public.agenda_retornos a where a.lead_aba = b.l_aba and a.lead_id = b.l_id
                          and a.status = 'pendente' and a.quando > now())   -- retorno marcado para frente: não está parado
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
commit;
begin;
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
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())   -- retorno marcado para frente
    union all
    select 4, b.b_aba, b.b_id, b.b_nome, 'Para resgatar', coalesce(b.b_ult, b.b_class, b.b_criado) from base b
     where b.b_cat = 'perdido' and coalesce(b.b_ult, b.b_class, b.b_criado) < now() - make_interval(days => v_esf)
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())
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
create or replace function public.leads_classificar(p_aba text, p_id text, p_status text, p_obs text,
  p_converteu boolean, p_receita numeric, p_retorno date) returns void
language plpgsql security definer set search_path = public as $$
declare v_grupo text; v_dono uuid; v_antes jsonb; v_role text := coalesce(public.get_my_role(), ''); v_manter boolean;
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
  -- Reclassificar ainda em andamento (ex.: EM NEGOCIAÇÃO com OBS) mantém o retorno marcado para frente; só fecha ao
  -- sair do andamento (venda/perda) ou se o retorno já venceu (revisão final §118, Important 4).
  v_manter := p_status <> 'AGENDADO RETORNO' and v_grupo = 'andamento'
              and exists (select 1 from public.agenda_retornos a where a.lead_aba = p_aba and a.lead_id = p_id and a.status = 'pendente' and a.quando > now());
  update public.leads set
      status = p_status,
      categoria = v_grupo,
      obs = nullif(btrim(coalesce(p_obs, '')), ''),
      converteu = coalesce(p_converteu, false) or v_grupo = 'convertido',
      receita = coalesce(p_receita, 0),
      retorno_em = case when p_status = 'AGENDADO RETORNO' then p_retorno when v_manter then retorno_em end,
      classificado_em = now(),
      classificado_por = auth.uid()
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, 'classificar', auth.uid(), v_antes,
            jsonb_build_object('status', p_status, 'obs', p_obs, 'converteu', coalesce(p_converteu, false) or v_grupo = 'convertido',
                               'receita', coalesce(p_receita, 0), 'retorno_em', p_retorno));
  if p_status = 'AGENDADO RETORNO' then
    perform public.leads_agenda_lead(p_aba, p_id, (p_retorno + time '10:00') at time zone 'America/Sao_Paulo');
  elsif not v_manter then
    update public.agenda_retornos set status = 'feito', feito_em = now(), atualizado_em = now()
     where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;
commit;
