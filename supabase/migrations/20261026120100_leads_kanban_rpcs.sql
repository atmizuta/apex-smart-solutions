-- §112 Meus leads — RPCs. Toda mudança passa por aqui: grava leads_historico e enfileira leads_espelho.
begin;

create or replace function public.leads_pegar(p_aba text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  update public.leads l set dono_id = auth.uid(), consultor = v_nome, pego_em = now()
   where l.aba = p_aba and l.id = p_id and l.dono_id is null and l.categoria = 'sem_contato';
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
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;

-- p_novo nulo = devolver aos Livres (só lead ainda sem status; com status, passe para outro consultor).
create or replace function public.leads_redistribuir(p_aba text, p_id text, p_novo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_nome text; v_antes jsonb; v_cat text;
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
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $$;

-- Kanban: Livres (sem dono e sem status, últimos 60 dias) + leads do dono pedido.
-- Consultor só vê os próprios (p_dono é ignorado); admin/supervisor: p_dono nulo = todos.
create or replace function public.leads_kanban(p_dono uuid default null)
returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text,
              telefone text, email text, cnpj text, status text, categoria text, obs text, converteu boolean,
              receita numeric, retorno_em date, dono_id uuid, dono_nome text, pego_em timestamptz,
              classificado_em timestamptz, criado_em_lead timestamptz, primeiro_clique timestamptz,
              primeira_ligacao timestamptz, venda_neo boolean, receita_neo numeric, livre boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid; v_ini_mes timestamptz;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with neo as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, sum(coalesce(p.valor, 0)) as valor
      from public.producao_pedidos p
     where p.cnpj is not null and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
     group by 1
  ), base as (
    select l.*, (l.dono_id is null and l.categoria = 'sem_contato') as e_livre
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE'
       and (
         (l.dono_id is null and l.categoria = 'sem_contato' and l.criado_em_lead >= now() - interval '60 days')
         or (l.dono_id is not null and (v_alvo is null or l.dono_id = v_alvo)
             and (l.categoria in ('sem_contato', 'andamento')
                  or coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
       )
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
    left join neo n on length(regexp_replace(coalesce(b.cnpj, ''), '[^0-9]', '', 'g')) >= 11
                   and n.doc = regexp_replace(b.cnpj, '[^0-9]', '', 'g')
   order by b.criado_em_lead desc;
end $$;

create or replace function public.leads_kanban_resumo()
returns table(livres int, livre_mais_antigo timestamptz, fila_pendente int, fila_mais_antiga timestamptz, aviso text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select
    (select count(*)::int from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select min(l.criado_em_lead) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
        and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'),
    (select count(*)::int from public.leads_espelho f where f.feito_em is null),
    (select min(f.pedido_em) from public.leads_espelho f where f.feito_em is null),
    (select c.valor from public.config c where c.chave = 'leads_espelho_aviso');
end $$;

-- Versão leve do Kanban (o painel pergunta a cada 10 s e só recarrega leads_kanban quando muda).
create or replace function public.leads_kanban_versao() returns text
language sql stable security definer set search_path = public as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), count(*) filter (where dono_id is null and categoria = 'sem_contato'))
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day';
$$;

create or replace function public.leads_espelho_reescrever(p_aba text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into public.leads_espelho (lead_aba, lead_id)
  select l.aba, l.id from public.leads l where l.aba = p_aba
  on conflict (lead_aba, lead_id) do update
    set pedido_em = now(), proxima_em = now(), tentativas = 0, ultimo_erro = null, feito_em = null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Ingestão da guia de entrada (chamada só pela Edge Function, com service_role).
-- Lead novo (id em nenhuma aba): insere na aba do mês, sem dono, e enfileira. Lead que já existe NÃO é tocado:
-- a guia de entrada tem o dado original do Facebook e sobrescreveria correções feitas na guia do mês (e evita
-- escrita à toa a cada 10 s). 'atualizados' fica sempre 0 (mantido na resposta por compatibilidade).
create or replace function public.leads_entrada(p_leads jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_ins int := 0; v_upd int := 0; n int; v_aba text; v_ts timestamptz;
begin
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    if not exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- cron de 10 s: duas rodadas podem trazer o mesmo lead ao mesmo tempo; on conflict evita derrubar o lote
      v_aba := public.leads_mes_aba(v_ts);
      insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                                form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                                city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em)
      values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
              r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
              coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
              r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
              r ->> 'lead_status', 'sem_contato', false, 0, now(), now())
      on conflict (aba, id) do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        perform public.leads_espelho_enfileirar(v_aba, r ->> 'id');
        v_ins := v_ins + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd);
end $$;

revoke all on function public.leads_entrada(jsonb) from public, anon, authenticated;
grant execute on function public.leads_pegar(text, text) to authenticated;
grant execute on function public.leads_classificar(text, text, text, text, boolean, numeric, date) to authenticated;
grant execute on function public.leads_redistribuir(text, text, uuid) to authenticated;
grant execute on function public.leads_kanban(uuid) to authenticated;
grant execute on function public.leads_kanban_resumo() to authenticated;
grant execute on function public.leads_kanban_versao() to authenticated;
grant execute on function public.leads_espelho_reescrever(text) to authenticated;
-- o Supabase dá execute ao anon por padrão em função nova: só usuário logado chama as da tela
revoke execute on function public.leads_kanban_versao() from public, anon;
revoke execute on function public.leads_kanban(uuid) from public, anon;
revoke execute on function public.leads_kanban_resumo() from public, anon;
revoke execute on function public.leads_pegar(text, text) from public, anon;
revoke execute on function public.leads_classificar(text, text, text, text, boolean, numeric, date) from public, anon;
revoke execute on function public.leads_redistribuir(text, text, uuid) from public, anon;
revoke execute on function public.leads_espelho_reescrever(text) from public, anon;
commit;
