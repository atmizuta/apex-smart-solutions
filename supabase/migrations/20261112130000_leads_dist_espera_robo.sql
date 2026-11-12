-- §146.5 (12/11, Rafael): "esperar o robô antes de devolver". A ligação feita direto no ProContact só chega pelo robô
-- (~15 em 15 min); a Bianca ligou aos 12 min e o lead voltou aos Livres antes da importação. Agora: (1) ligação do ProContact
-- do consultor para o lead conta como atendimento (hora real; também recupera crédito de entrega já devolvida); (2) a
-- devolução só acontece depois que o robô importou além do prazo — ou 30 min depois do prazo, se o robô parar.
-- Sem DROP. Check: supabase/tests/leads_dist_espera_robo_check.sql.
begin;

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
  -- §146.5: ligação do ProContact (chega pelo robô) também conta como atendimento, na hora real da ligação.
  -- Vale para entrega aberta (segura o lead) e para entrega já devolvida (recupera o crédito de velocidade).
  update public.leads_distribuicao d set atendido_em = greatest(x.primeira, d.recebido_em), confirmado = true, confirmado_em = now()
    from (select d2.id, min(m.gerada_em) primeira
            from public.leads_distribuicao d2
            join public.leads l on l.aba = d2.lead_aba and l.id = d2.lead_id
            join lateral (select e.usuario_telefonia from public.leads_equipe e where e.profile_id = d2.consultor_id order by e.id limit 1) eq on true
            join public.ligacoes_manuais m on m.chave_tel = public.chave_tel(l.phone_number)
                 and lower(btrim(m.usuario)) = lower(btrim(eq.usuario_telefonia))
                 and m.gerada_em >= d2.recebido_em - interval '5 minutes' and m.gerada_em <= coalesce(d2.devolvido_em, now())
           where d2.tipo in ('auto', 'pegou') and d2.consultor_id is not null and d2.recebido_em is not null and d2.atendido_em is null
             and d2.recebido_em > now() - interval '2 days' and coalesce(btrim(eq.usuario_telefonia), '') <> ''
           group by d2.id) x
   where d.id = x.id;
  update public.leads_distribuicao set confirmado = true, confirmado_em = now()   -- 24 h sem decisão: benefício da dúvida
   where atendido_em is not null and confirmado is null and atendido_em < now() - interval '24 hours';

  if v_modo = 'manual' then return jsonb_build_object('modo', v_modo, 'confirmados', n_conf, 'devolvidos', 0, 'distribuidos', 0); end if;

  -- 2. Devolução (só no automático e só entregas automáticas)
  if v_modo = 'automatico' and v_exp then   -- M-1: devolução só no expediente
    for r in select d.* from public.leads_distribuicao d
              where d.tipo = 'auto' and d.consultor_id is not null and d.fechado_em is null and d.atendido_em is null
                and d.recebido_em <= now() - v_dev
                and (v_robo >= d.recebido_em + v_dev or d.recebido_em <= now() - v_dev - interval '30 minutes')   -- §146.5: espera o robô cobrir o prazo (teto 30 min)
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
  if v_exp and (v_modo = 'sombra' or not public.leads_pegar_bloqueado()) then   -- §146.2: a Sombra anota mesmo com "Bloquear todos"
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

commit;
