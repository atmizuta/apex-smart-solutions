-- §146.2 (10/11, Rafael): lado do consultor da distribuição automática + ajustes da revisão (M-1) + textos na linha do tempo.
-- Spec: docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md §11–§12. Plano: docs/superpowers/plans/2026-11-10-leads-distribuicao-consultor.md
-- Sem DROP. Check: supabase/tests/leads_dist_consultor_check.sql.
begin;

-- Lead que caiu automaticamente para o consultor e ainda espera o primeiro contato.
create or replace function public.leads_dist_entrega_aberta(p_uid uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object('aba', d.lead_aba, 'lead_id', d.lead_id, 'nome', l.full_name, 'tipo', d.tipo, 'recebido_em', d.recebido_em,
                            'prazo_atender_min', (public.leads_dist_cfg() ->> 'prazo_atender_min')::int,
                            'prazo_devolver_min', (public.leads_dist_cfg() ->> 'prazo_devolver_min')::int)
    from public.leads_distribuicao d join public.leads l on l.aba = d.lead_aba and l.id = d.lead_id
   where d.consultor_id = p_uid and d.tipo = 'auto' and d.fechado_em is null and d.atendido_em is null
     and l.apagado_em is null and l.dono_id = d.consultor_id   -- revisão: lead apagado ou passado adiante não conta
   order by d.recebido_em desc
   limit 1
$function$;

-- Presença (v2): também devolve o modo e a entrega aberta (o painel avisa "lead novo para você" em qualquer aba).
create or replace function public.leads_presenca_ping(p_acao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pausa timestamptz; v_min int := (public.leads_dist_cfg() ->> 'pausa_min')::int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if coalesce(p_acao, '') not in ('', 'pausa', 'voltar') then raise exception 'ação inválida: %', p_acao using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    return jsonb_build_object('equipe', false, 'pausa_ate', null, 'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', null);
  end if;
  insert into public.leads_presenca as p (profile_id, visto_em, pausa_ate)
  values (auth.uid(), now(), case when p_acao = 'pausa' then now() + make_interval(mins => v_min) end)
  on conflict (profile_id) do update set visto_em = now(),
    pausa_ate = case when p_acao = 'pausa' then now() + make_interval(mins => v_min)
                     when p_acao = 'voltar' then null else p.pausa_ate end
  returning p.pausa_ate into v_pausa;
  return jsonb_build_object('equipe', true, 'pausa_ate', case when v_pausa > now() then v_pausa end,
                            'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', public.leads_dist_entrega_aberta(auth.uid()));
end $function$;

-- O que o consultor vê da distribuição (só os números dele).
create or replace function public.leads_dist_meu()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); n record; p public.leads_presenca;
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_total int; v_estado text;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into n from public.leads_dist_notas() x where x.consultor_id = auth.uid();
  if not found then return jsonb_build_object('grupo', false, 'modo', c ->> 'modo'); end if;
  select * into p from public.leads_presenca where profile_id = auth.uid();
  select coalesce(sum(x.recebidos_hoje), 0) into v_total from public.leads_dist_notas() x where x.ativo;
  v_estado := case when not public.leads_dist_no_expediente(now()) then 'fora'
                   when p.pausa_ate > now() then 'pausa'
                   when exists (select 1 from public.leads_distribuicao d
                                 where d.consultor_id = auth.uid() and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                                   and d.atendido_em is null and d.recebido_em > now() - v_dev) then 'pendente'
                   when p.visto_em is null or p.visto_em < now() - v_pres then 'offline'
                   else 'na_vez' end;
  return jsonb_build_object('grupo', true, 'modo', c ->> 'modo', 'estado', v_estado,
    'pausa_ate', case when p.pausa_ate > now() then p.pausa_ate end,
    'rapidos_ok', n.vel_ok, 'rapidos_n', n.vel_n, 'conv', n.conv, 'fatia', n.fatia, 'recebidos_hoje', n.recebidos_hoje,
    'alvo_hoje', case when n.fatia is null then null else round(n.fatia * greatest(v_total, n.recebidos_hoje))::int end,
    'entrega', public.leads_dist_entrega_aberta(auth.uid()));
end $function$;

-- "Por que foi para ele" (gestor, linha do tempo): fatia de quem recebeu e quem estava fora da vez.
create or replace function public.leads_dist_motivo_texto(p_aba text, p_id text, p_em timestamptz)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select nullif(concat_ws('; ',
           (select 'fatia ' || round((e ->> 'fatia')::numeric * 100) || '%, ' || (e ->> 'recebidos_hoje') || ' recebido(s) hoje antes deste'
              from jsonb_array_elements(d.motivo -> 'consultores') e where (e ->> 'consultor_id')::uuid = d.consultor_id),
           (select 'fora da vez: ' || string_agg((e ->> 'nome') || ' (' || case e ->> 'estado'
                      when 'pendente' then 'com lead sem contato' when 'pausa' then 'em pausa' when 'offline' then 'fora do painel'
                      when 'perdeu_este' then 'já perdeu este lead' else e ->> 'estado' end || ')', ', ')
              from jsonb_array_elements(d.motivo -> 'consultores') e where e ->> 'estado' <> 'na_vez')), '')
    from public.leads_distribuicao d
   where d.lead_aba = p_aba and d.lead_id = p_id and d.tipo = 'auto' and d.recebido_em = p_em
   order by d.id desc
   limit 1
$function$;

-- Motor: igual ao da §146.1 + não entrega nos últimos prazo_devolver_min do expediente (M-1: o lead fica para o dia seguinte).
create or replace function public.leads_distribuir(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := c ->> 'modo';
  v_fila public.leads_distribuicao; v_esc jsonb; v_id uuid; v_nome text; n int;
begin
  if coalesce(v_modo, 'manual') not in ('sombra', 'automatico') then return jsonb_build_object('ok', false, 'motivo', 'manual'); end if;
  perform pg_advisory_xact_lock(hashtext('leads_distribuir'));
  select * into v_fila from public.leads_distribuicao d where d.lead_aba = p_aba and d.lead_id = p_id and d.fechado_em is null;
  if not exists (select 1 from public.leads l where l.aba = p_aba and l.id = p_id and l.dono_id is null
                    and l.apagado_em is null and l.categoria = 'sem_contato') then
    if v_fila.id is not null and v_fila.consultor_id is null then
      update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel');
  end if;
  if v_fila.id is null then
    insert into public.leads_distribuicao (lead_aba, lead_id) values (p_aba, p_id) returning * into v_fila;
  end if;
  if not public.leads_dist_no_expediente(now())
     or not public.leads_dist_no_expediente(now() + make_interval(mins => (c ->> 'prazo_devolver_min')::int + 2)) then   -- +2 min: o tick precisa alcançar o prazo antes do fim do expediente
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_expediente');
  end if;
  if public.leads_pegar_bloqueado() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  v_esc := public.leads_dist_escolher(v_fila.excluidos);
  v_id := (v_esc ->> 'escolhido')::uuid;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'ninguem_na_vez'); end if;
  if v_modo = 'sombra' then
    insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido, motivo) values (p_aba, p_id, v_id, v_esc)
    on conflict (lead_aba, lead_id) do nothing;
    update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;
    return jsonb_build_object('ok', true, 'sombra', true, 'consultor_id', v_id);
  end if;
  v_nome := v_esc ->> 'nome';
  update public.leads set dono_id = v_id, consultor = v_nome, pego_em = now()
   where aba = p_aba and id = p_id and dono_id is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel'); end if;
  update public.leads_distribuicao set consultor_id = v_id, tipo = 'auto', recebido_em = now(), motivo = v_esc where id = v_fila.id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'redistribuir', null, jsonb_build_object('consultor', v_nome, 'dono_id', v_id, 'auto', true));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor_id', v_id, 'consultor', v_nome);
end $function$;

-- Tick: igual ao da §146.1 (com as correções da revisão) + devolução só no expediente (M-1).
create or replace function public.leads_dist_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := coalesce(c ->> 'modo', 'manual');
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_conf interval := make_interval(mins => (c ->> 'confirmar_min')::int);
  v_max int := (c ->> 'max_devolucoes')::int;
  v_exp boolean := public.leads_dist_no_expediente(now());
  v_robo timestamptz; r record; v_res jsonb; n_dev int := 0; n_dist int := 0; n_conf int := 0; v_parados jsonb; v_av jsonb;
begin
  select coalesce(cf.valor::jsonb, '{}'::jsonb) into v_av from public.config cf where cf.chave = 'leads_distribuicao_aviso';
  v_av := coalesce(v_av, '{}'::jsonb);
  -- 1. Confirmação pelo ProContact (todos os modos: "pegou" já junta velocidade). Só decide o que o robô já cobriu.
  select max(m.importado_em) into v_robo from public.ligacoes_manuais m;
  if v_exp and (v_robo is null or v_robo < now() - make_interval(mins => (c ->> 'robo_parado_min')::int)) then
    -- só grava quando muda: o tick não segura a linha de avisos a cada minuto (evita travar com a entrada de lead)
    if not (v_av ? 'robo_parado') then perform public.leads_dist_aviso('robo_parado', to_jsonb(v_robo)); end if;
  else
    if v_av ? 'robo_parado' then perform public.leads_dist_aviso('robo_parado', null); end if;
    update public.leads_distribuicao d set confirmado = x.ok, confirmado_em = now()
      from (select d2.id,
                   (coalesce(btrim(eq.usuario_telefonia), '') = '' or exists (   -- mesma regra do placar: vazio = sem telefonia
                      select 1 from public.ligacoes_manuais m
                       where m.chave_tel = public.chave_tel(l.phone_number)
                         and lower(btrim(m.usuario)) = lower(btrim(eq.usuario_telefonia))
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
  if v_modo = 'automatico' and v_exp then   -- M-1: devolução só no expediente
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

-- Linha do tempo da ficha: textos da distribuição automática e, para o gestor, o motivo (§146.2).
create or replace function public.leads_ficha_detalhes(p_aba text, p_id text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        l public.leads%rowtype; v_livre boolean; i record; v_anuncio jsonb; v_ev jsonb;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  v_livre := l.dono_id is null and l.categoria = 'sem_contato';
  if not v_gestor then
    if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
    if not v_livre and l.dono_id is distinct from auth.uid() then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
  end if;
  v_anuncio := jsonb_build_object('campanha', l.campaign_name, 'conjunto', l.adset_name, 'anuncio', l.ad_name,
                                  'formulario', l.form_name, 'plataforma', l.platform, 'organico', l.is_organic);
  if v_livre and not v_gestor then
    return jsonb_build_object('anuncio', v_anuncio, 'resumo', null, 'eventos',
      jsonb_build_array(jsonb_build_object('em', l.criado_em_lead, 'tipo', 'chegou', 'titulo', 'Lead chegou', 'detalhe', l.campaign_name, 'quem', null)));
  end if;
  select * into i from public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.em desc), '[]'::jsonb) into v_ev from (
    select l.criado_em_lead as em, 'chegou'::text as tipo, 'Lead chegou'::text as titulo, l.campaign_name as detalhe, null::text as quem
    union all
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then case when h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                                                     then 'Distribuído automaticamente para ' else 'Passou para ' end || coalesce(h.depois ->> 'consultor', '')
                       else case when h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                                 then 'Voltou aos Livres (sem contato no prazo)' else 'Devolveu aos Livres' end end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '')
                when v_gestor and h.acao = 'redistribuir' and h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                  then public.leads_dist_motivo_texto(h.lead_aba, h.lead_id, h.em) end, p.nome
      from public.leads_historico h left join public.profiles p on p.id = h.por
     where h.lead_aba = l.aba and h.lead_id = l.id
    union all
    select c.em, 'clique', case c.canal when 'whatsapp' then 'Abriu o WhatsApp' when 'ligar' then 'Clicou em Ligar' else 'Contato registrado' end, null, p.nome
      from public.leads_contatos c left join public.profiles p on p.id = c.profile_id
     where c.lead_aba = l.aba and c.lead_id = l.id
    union all
    select m.gerada_em, 'ligacao', case when m.atendida then 'Ligação atendida' else 'Ligação não atendida' end,
           nullif(concat_ws(' · ', case when coalesce(m.seg_falados, 0) > 0 then (m.seg_falados / 60) || ' min ' || (m.seg_falados % 60) || ' s' end, nullif(m.tabulacao, '')), ''),
           m.usuario
      from public.ligacoes_manuais m
     where public.chave_tel(l.phone_number) is not null and m.chave_tel = public.chave_tel(l.phone_number)
       and m.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select d.gerada_em, 'discador', case when d.status = 'ANSWERED' then 'Discador: atendida' else 'Discador: ' || lower(coalesce(d.status, '')) end,
           case when coalesce(d.seg_falados, 0) > 0 then (d.seg_falados / 60) || ' min ' || (d.seg_falados % 60) || ' s' end, null
      from public.discador_chamadas d
     where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) = 14
       and d.cnpj = regexp_replace(l.cnpj, '[^0-9]', '', 'g') and d.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select a.criado_em, 'retorno', case a.status when 'pendente' then 'Retorno agendado' when 'feito' then 'Retorno feito' else 'Retorno cancelado' end,
           to_char(a.quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), null
      from public.agenda_retornos a where a.lead_aba = l.aba and a.lead_id = l.id
  ) e where e.em is not null;
  return jsonb_build_object('anuncio', v_anuncio,
    'resumo', jsonb_build_object('ligacoes', i.ligacoes, 'atendidas', i.atendidas, 'cliques', i.cliques, 'ultimo', i.ultimo),
    'eventos', v_ev);
end $function$;

revoke execute on function public.leads_dist_entrega_aberta(uuid) from public, anon, authenticated;
revoke execute on function public.leads_dist_motivo_texto(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_meu() from public, anon;
grant execute on function public.leads_dist_meu() to authenticated;

commit;
