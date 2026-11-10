-- §146.1: tick de 1 min (confirmação ProContact, devolução 15 min, fila) e ganchos em leads_entrada2 / leads_pegar / leads_redistribuir.
-- Spec §6–§8. Sem DROP. Check: supabase/tests/leads_dist_tick_check.sql. O cron fica em 20261109120500_leads_dist_cron.sql.
begin;

create or replace function public.leads_dist_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := coalesce(c ->> 'modo', 'manual');
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_conf interval := make_interval(mins => (c ->> 'confirmar_min')::int);
  v_max int := (c ->> 'max_devolucoes')::int;
  v_exp boolean := public.leads_dist_no_expediente(now());
  v_robo timestamptz; r record; v_res jsonb; n_dev int := 0; n_dist int := 0; n_conf int := 0; v_parados jsonb;
begin
  -- 1. Confirmação pelo ProContact (todos os modos: "pegou" já junta velocidade). Só decide o que o robô já cobriu.
  select max(m.importado_em) into v_robo from public.ligacoes_manuais m;
  if v_exp and (v_robo is null or v_robo < now() - make_interval(mins => (c ->> 'robo_parado_min')::int)) then
    perform public.leads_dist_aviso('robo_parado', to_jsonb(v_robo));
  else
    perform public.leads_dist_aviso('robo_parado', null);
    update public.leads_distribuicao d set confirmado = x.ok, confirmado_em = now()
      from (select d2.id,
                   (eq.usuario_telefonia is null or exists (
                      select 1 from public.ligacoes_manuais m
                       where m.chave_tel = public.chave_tel(l.phone_number)
                         and lower(m.usuario) = lower(eq.usuario_telefonia)
                         and m.gerada_em between d2.recebido_em - interval '5 minutes' and d2.atendido_em + v_conf)) ok
              from public.leads_distribuicao d2
              join public.leads l on l.aba = d2.lead_aba and l.id = d2.lead_id
              left join lateral (select e.usuario_telefonia from public.leads_equipe e
                                  where e.profile_id = d2.consultor_id order by e.id limit 1) eq on true
             where d2.atendido_em is not null and d2.confirmado is null
               and d2.atendido_em <= now() - v_conf and v_robo >= d2.atendido_em + v_conf) x
     where d.id = x.id;
    get diagnostics n_conf = row_count;
  end if;
  update public.leads_distribuicao set confirmado = true, confirmado_em = now()   -- 24 h sem decisão: benefício da dúvida
   where atendido_em is not null and confirmado is null and atendido_em < now() - interval '24 hours';

  if v_modo = 'manual' then return jsonb_build_object('modo', v_modo, 'confirmados', n_conf, 'devolvidos', 0, 'distribuidos', 0); end if;

  -- 2. Devolução (só no automático e só entregas automáticas)
  if v_modo = 'automatico' then
    for r in select d.* from public.leads_distribuicao d
              where d.tipo = 'auto' and d.consultor_id is not null and d.fechado_em is null and d.atendido_em is null
                and d.recebido_em <= now() - v_dev
              order by d.recebido_em
              for update skip locked loop
      update public.leads set dono_id = null, consultor = null, pego_em = null
       where aba = r.lead_aba and id = r.lead_id and dono_id = r.consultor_id and categoria = 'sem_contato' and apagado_em is null;
      if not found then   -- lead já mudou por fora (tabulado, redistribuído, apagado): só fecha
        update public.leads_distribuicao set fechado_em = now() where id = r.id;
        continue;
      end if;
      update public.leads_distribuicao set devolvido_em = now(), fechado_em = now() where id = r.id;
      insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
        values (r.lead_aba, r.lead_id, 'devolver', null, jsonb_build_object('dono_id', r.consultor_id), jsonb_build_object('dono_id', null, 'auto', true));   -- §146: devolução automática
      update public.agenda_retornos set status = 'cancelado', atualizado_em = now()
       where lead_aba = r.lead_aba and lead_id = r.lead_id and status = 'pendente';
      perform public.leads_espelho_enfileirar(r.lead_aba, r.lead_id);
      if r.devolucoes + 1 < v_max then
        insert into public.leads_distribuicao (lead_aba, lead_id, devolucoes, excluidos)
        values (r.lead_aba, r.lead_id, r.devolucoes + 1, array_append(r.excluidos, r.consultor_id));
      else
        select coalesce(cf.valor::jsonb -> 'parados', '[]'::jsonb) into v_parados from public.config cf where cf.chave = 'leads_distribuicao_aviso';
        perform public.leads_dist_aviso('parados', coalesce(v_parados, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('aba', r.lead_aba, 'id', r.lead_id, 'em', now())));
      end if;
      n_dev := n_dev + 1;
    end loop;
  end if;

  -- 3. Fila (sombra e automático), lead mais recente primeiro; para quando ninguém está na vez
  if v_exp and not public.leads_pegar_bloqueado() then
    for r in select d.lead_aba, d.lead_id from public.leads_distribuicao d
               join public.leads l on l.aba = d.lead_aba and l.id = d.lead_id
              where d.consultor_id is null and d.fechado_em is null
                and (v_modo = 'automatico' or not exists (select 1 from public.leads_dist_sombra s where s.lead_aba = d.lead_aba and s.lead_id = d.lead_id))
              order by l.criado_em_lead desc nulls last
              limit 50 loop
      begin
        v_res := public.leads_distribuir(r.lead_aba, r.lead_id);
      exception when others then
        perform public.leads_dist_aviso('motor_erro', jsonb_build_object('em', now(), 'erro', sqlerrm));
        exit;
      end;
      exit when v_res ->> 'motivo' = 'ninguem_na_vez';
      if coalesce((v_res ->> 'ok')::boolean, false) then n_dist := n_dist + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('modo', v_modo, 'confirmados', n_conf, 'devolvidos', n_dev, 'distribuidos', n_dist);
end $function$;

-- leads_entrada2: igual à versão do §137 + chamada do motor para cada lead inserido (falha nunca derruba a entrada).
create or replace function public.leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_ins int := 0; v_vis int := 0; n int; v_aba text; v_ts timestamptz;
begin
  if coalesce(p_origem, '') not in ('planilha', 'meta') then
    raise exception 'origem inválida: %', p_origem using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    if exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- §137: a Meta também viu um lead que já entrou (pela planilha ou por rodada anterior)
      if p_origem = 'meta' then
        update public.leads set meta_visto_em = now() where id = r ->> 'id' and meta_visto_em is null;
        get diagnostics n = row_count;
        v_vis := v_vis + n;
      end if;
      continue;
    end if;
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    v_aba := public.leads_mes_aba(v_ts);
    -- planilha (cron de 10 s) e webhook da agência podem trazer o mesmo lead ao mesmo tempo
    insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                              form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                              city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em,
                              origem_entrada, meta_visto_em)
    values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
            r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
            coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
            r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
            r ->> 'lead_status', 'sem_contato', false, 0, now(), now(),
            p_origem, case when p_origem = 'meta' then now() end)
    on conflict (aba, id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      if p_espelho then perform public.leads_espelho_enfileirar(v_aba, r ->> 'id'); end if;
      v_ins := v_ins + 1;
      -- §146: distribuição automática (manual = sai na hora). Erro vira aviso; o lead fica nos Livres.
      begin
        perform public.leads_distribuir(v_aba, r ->> 'id');
      exception when others then
        perform public.leads_dist_aviso('motor_erro', jsonb_build_object('em', now(), 'erro', sqlerrm));
      end;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', 0, 'vistos', v_vis);
end $function$;

-- leads_pegar: igual à do §132 + entrega "pegou" (fecha a fila do lead, se houver).
create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_pode boolean; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha, e.pode_pegar into v_nome, v_pode from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  if not coalesce(v_pode, false) then raise exception 'você não está liberado para pegar leads' using errcode = '42501'; end if;
  if public.leads_pegar_bloqueado() then raise exception 'pegar leads está pausado pelo supervisor' using errcode = '42501'; end if;
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
  -- §146: entrega "pegou" (conta na velocidade e nos recebidos)
  update public.leads_distribuicao set fechado_em = now() where lead_aba = p_aba and lead_id = p_id and fechado_em is null;
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em) values (p_aba, p_id, auth.uid(), 'pegou', now());
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor', v_nome);
end $function$;

-- leads_redistribuir: igual à atual + entrega "redistribuido" (fora da nota). Devolver aos Livres só fecha.
create or replace function public.leads_redistribuir(p_aba text, p_id text, p_novo uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
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
  -- §146: decisão do gestor fecha a entrega aberta; passar para alguém grava "redistribuido" (não conta na nota nem nos recebidos)
  update public.leads_distribuicao set fechado_em = now() where lead_aba = p_aba and lead_id = p_id and fechado_em is null;
  if p_novo is not null then
    insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em) values (p_aba, p_id, p_novo, 'redistribuido', now());
  end if;
  if p_novo is null then
    update public.agenda_retornos set status = 'cancelado', atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  else
    -- o retorno pendente vai junto (cancelado no dono antigo, recriado no novo — ver leads_agenda_lead)
    select a.quando into v_quando from public.agenda_retornos a
     where a.lead_aba = p_aba and a.lead_id = p_id and a.status = 'pendente' order by a.quando limit 1;
    if v_quando is not null then perform public.leads_agenda_lead(p_aba, p_id, v_quando); end if;
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $function$;

revoke execute on function public.leads_dist_tick() from public, anon, authenticated;

commit;
