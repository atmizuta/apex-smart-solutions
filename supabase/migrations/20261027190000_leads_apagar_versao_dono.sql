-- §120 (27/10 noite): apagar lead do painel (só supervisor/admin; a planilha não muda) e versão do Quadro por consultor
-- (a classificação de um colega não recarrega a tela dos outros). Todas as leituras ignoram o lead apagado.
-- Mesmas assinaturas (create or replace); funções novas: leads_apagar, leads_restaurar, leads_kanban_versao_dono.
begin;
alter table public.leads add column if not exists apagado_em timestamptz;
alter table public.leads add column if not exists apagado_por uuid;
alter table public.leads add column if not exists apagado_motivo text;
create index if not exists leads_dono_idx on public.leads (dono_id);
alter table public.leads_historico drop constraint leads_historico_acao_check;
alter table public.leads_historico add constraint leads_historico_acao_check check (acao = any (array['pegar', 'classificar', 'redistribuir', 'devolver', 'apagar', 'restaurar']));

-- Apagar = esconder do painel. Não entra na fila do espelho (a linha da planilha fica como está) e cancela o retorno da Agenda.
create or replace function public.leads_apagar(p_aba text, p_id text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.leads set apagado_em = now(), apagado_por = auth.uid(), apagado_motivo = nullif(btrim(coalesce(p_motivo, '')), '')
   where aba = p_aba and id = p_id and apagado_em is null;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'apagar', auth.uid(), jsonb_build_object('motivo', nullif(btrim(coalesce(p_motivo, '')), '')));
  update public.agenda_retornos set status = 'cancelado', atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
end $$;
create or replace function public.leads_restaurar(p_aba text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.leads set apagado_em = null, apagado_por = null, apagado_motivo = null where aba = p_aba and id = p_id and apagado_em is not null;
  if not found then raise exception 'lead não está apagado' using errcode = 'P0002'; end if;
  insert into public.leads_historico (lead_aba, lead_id, acao, por) values (p_aba, p_id, 'restaurar', auth.uid());
end $$;
revoke execute on function public.leads_apagar(text, text, text) from public, anon;
revoke execute on function public.leads_restaurar(text, text) from public, anon;
grant execute on function public.leads_apagar(text, text, text) to authenticated;
grant execute on function public.leads_restaurar(text, text) to authenticated;

create or replace function public.leads_kanban_versao()
 returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), max(apagado_em),
                   count(*) filter (where dono_id is null and categoria = 'sem_contato' and apagado_em is null))
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day' or apagado_em >= now() - interval '1 day';
$$;
-- Versão só do que aparece para quem pergunta: os leads do dono (consultor = ele mesmo; gestor = o filtro) + os Livres.
create or replace function public.leads_kanban_versao_dono(p_dono uuid default null) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_meus text; v_livres text;
begin
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  if v_alvo is null and not v_gestor then return ''; end if;
  if v_alvo is null then return public.leads_kanban_versao(); end if;
  select concat_ws('|', count(*), max(pego_em), max(classificado_em), max(apagado_em), max(retorno_em)) into v_meus
    from public.leads where dono_id = v_alvo;
  select concat_ws('|', count(*), max(criado_em_lead)) into v_livres
    from public.leads where dono_id is null and categoria = 'sem_contato' and apagado_em is null and criado_em_lead >= now() - interval '60 days';
  return v_meus || '#' || v_livres;
end $$;
revoke execute on function public.leads_kanban_versao_dono(uuid) from public, anon;
grant execute on function public.leads_kanban_versao_dono(uuid) to authenticated;
commit;
begin;
create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_nome text; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
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
end $$;
create or replace function public.leads_kanban_resumo()
 returns table(livres integer, livre_mais_antigo timestamp with time zone, fila_pendente integer, fila_mais_antiga timestamp with time zone, aviso text)
 language plpgsql stable security definer set search_path to 'public' as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select
    (select count(*)::int from public.leads l where l.dono_id is null and l.categoria = 'sem_contato' and l.apagado_em is null
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select min(l.criado_em_lead) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato' and l.apagado_em is null
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select count(*)::int from public.leads_espelho f where f.feito_em is null),
    (select min(f.pedido_em) from public.leads_espelho f where f.feito_em is null),
    (select c.valor from public.config c where c.chave = 'leads_espelho_aviso');
end $$;
create or replace function public.leads_kanban(p_dono uuid default null::uuid)
 returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text, telefone text, email text, cnpj text, status text, categoria text, obs text, converteu boolean, receita numeric, retorno_em date, dono_id uuid, dono_nome text, pego_em timestamp with time zone, classificado_em timestamp with time zone, criado_em_lead timestamp with time zone, primeiro_clique timestamp with time zone, primeira_ligacao timestamp with time zone, venda_neo boolean, receita_neo numeric, livre boolean)
 language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid; v_ini_mes timestamptz;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with base as (
    select l.*, (l.dono_id is null and l.categoria = 'sem_contato') as e_livre,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (
         (l.dono_id is null and l.categoria = 'sem_contato' and l.criado_em_lead >= now() - interval '60 days')
         or (l.dono_id is not null and (v_alvo is null or l.dono_id = v_alvo)
             and (l.categoria in ('sem_contato', 'andamento')
                  or coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
       )
  ), neo as (
    -- só os CNPJs dos leads da tela (antes somava todos os pedidos do NEO a cada recarga)
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, sum(coalesce(p.valor, 0)) as valor
      from public.producao_pedidos p
     where p.cnpj is not null and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
       and regexp_replace(p.cnpj, '[^0-9]', '', 'g') in (select b.doc from base b where length(b.doc) >= 11)
     group by 1
  )
  select b.aba, b.id, b.full_name, b.city, b.state, b.qtd_linhas, b.tipo_empresa,
         case when b.e_livre and not v_gestor then null else b.phone_number end,
         case when b.e_livre and not v_gestor then null else b.email end,
         case when b.e_livre and not v_gestor then null else b.cnpj end,
         b.status, b.categoria, b.obs, b.converteu, b.receita, b.retorno_em, b.dono_id, pr.nome, b.pego_em,
         b.classificado_em, b.criado_em_lead,
         (select min(c.em) from public.leads_contatos c where c.lead_aba = b.aba and c.lead_id = b.id),
         (select min(m.gerada_em) from public.ligacoes_manuais m
           where m.chave_tel is not null and m.chave_tel = public.chave_tel(b.phone_number)
             and m.gerada_em >= b.criado_em_lead - interval '1 hour'),
         (n.doc is not null), n.valor, b.e_livre
    from base b
    left join public.profiles pr on pr.id = b.dono_id
    left join neo n on length(b.doc) >= 11 and n.doc = b.doc
   order by b.criado_em_lead desc;
end $$;
commit;
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
   where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
     and (v_gestor or l.dono_id = auth.uid() or (l.dono_id is null and l.categoria = 'sem_contato'))
     and case when length(v_dig) >= 8 and (v_gestor or l.dono_id = auth.uid())
              then regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
                or regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
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
  )
  select jsonb_build_object(
    'fila', coalesce((select jsonb_agg(jsonb_build_object('aba', u.b_aba, 'lead_id', u.b_id, 'nome', u.b_nome, 'motivo', u.motivo, 'desde', u.desde)
                                       order by u.prio, u.desde) from unica u), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('aba', r.r_aba, 'lead_id', r.r_id, 'nome', l.full_name, 'quando', r.r_quando,
                                                             'vencido', r.r_quando <= now()) order by r.r_quando)
                            from ret r join public.leads l on l.aba = r.r_aba and l.id = r.r_id where r.r_quando < v_fim_dia), '[]'::jsonb),
    'livres', (select count(*) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
                 and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null and l.criado_em_lead >= now() - interval '60 days'))
  into v_out;
  return v_out;
end $$;
create or replace function public.leads_equipe_resumo()
 returns table(dono_id uuid, nome text, em_aberto integer, sem_contato integer, retornos_vencidos integer, parados integer, perdas_suspeitas integer, pegos_mes integer, convertidos_mes integer, receita_mes numeric, tempo_medio_1o_contato_min numeric)
 language plpgsql stable security definer set search_path to 'public' as $$
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
                from public.leads l where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null),
       hoje as (select l.dono_id as h_dono, extract(epoch from (i.primeiro - l.pego_em)) / 60 as h_min
                  from public.leads l
                  cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
                 where l.pego_em >= v_ini_dia and l.apagado_em is null and i.primeiro is not null and i.primeiro >= l.pego_em)
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
commit;
