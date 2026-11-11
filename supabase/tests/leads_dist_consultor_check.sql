-- §146.2 Task 1: conferência de 20261110120000_leads_dist_consultor.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; d1 uuid; ev jsonb; v_fim text;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. ping sem entrega devolve modo e entrega nula
  perform pg_temp.ld_como(v_a);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r ->> 'modo' = 'automatico' and r -> 'entrega' = 'null'::jsonb and (r ->> 'equipe')::boolean then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. lead distribuído aparece no ping do dono, com o nome
  perform pg_temp.ld_lead('lc-1', 1);
  r := public.leads_distribuir('TESTE DIST', 'lc-1');
  d1 := (r ->> 'consultor_id')::uuid;
  perform pg_temp.ld_como(d1);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r -> 'entrega' ->> 'lead_id' = 'lc-1' and r -> 'entrega' ->> 'nome' = 'Lead Teste'
                          and (r -> 'entrega' ->> 'prazo_atender_min')::int = 5 then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. meu: grupo, estado pendente, fatia e entrega
  r := public.leads_dist_meu();
  v_out := v_out || case when (r ->> 'grupo')::boolean and r ->> 'estado' = 'pendente' and r ->> 'fatia' is not null
                          and r -> 'entrega' ->> 'lead_id' = 'lc-1' and (r ->> 'recebidos_hoje')::int >= 1 then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. clicou em Ligar: a entrega sai do ping e o estado volta para na_vez
  update public.leads_distribuicao set atendido_em = now(), sinal = 'clique' where lead_id = 'lc-1' and fechado_em is null;
  r := public.leads_dist_meu();
  v_out := v_out || case when r -> 'entrega' = 'null'::jsonb and r ->> 'estado' = 'na_vez' then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. fora do grupo: grupo false
  perform pg_temp.ld_como(pg_temp.ld_admin());
  r := public.leads_dist_meu();
  v_out := v_out || case when not (r ->> 'grupo')::boolean then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. linha do tempo: gestor vê "Distribuído automaticamente" com o motivo; o dono vê sem motivo
  r := public.leads_ficha_detalhes('TESTE DIST', 'lc-1');
  select e into ev from jsonb_array_elements(r -> 'eventos') e where e ->> 'tipo' = 'redistribuir';
  v_out := v_out || case when ev ->> 'titulo' like 'Distribuído automaticamente para Teste Dist %' and ev ->> 'detalhe' like 'fatia %' then '6 ok; ' else '6 FALHOU ' || coalesce(ev::text, 'null') || '; ' end;
  perform pg_temp.ld_como(d1);
  r := public.leads_ficha_detalhes('TESTE DIST', 'lc-1');
  select e into ev from jsonb_array_elements(r -> 'eventos') e where e ->> 'tipo' = 'redistribuir';
  v_out := v_out || case when ev ->> 'titulo' like 'Distribuído automaticamente%' and ev ->> 'detalhe' is null then '6b ok; ' else '6b FALHOU ' || coalesce(ev::text, 'null') || '; ' end;
  -- 7. M-1: a menos de 15 min do fim do expediente o motor não entrega (o lead fica na fila)
  v_fim := to_char((now() at time zone 'America/Sao_Paulo') + interval '10 minutes', 'HH24:MI');
  perform pg_temp.ld_cfg(jsonb_build_object('expediente', jsonb_build_object('dias', '[1,2,3,4,5,6,7]'::jsonb, 'inicio', '00:00', 'fim', v_fim)));
  perform pg_temp.ld_lead('lc-2', 2);
  r := public.leads_distribuir('TESTE DIST', 'lc-2');
  v_out := v_out || case when r ->> 'motivo' = 'fora_do_expediente'
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lc-2' and consultor_id is null and fechado_em is null) then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  -- 8. M-1: fora do expediente o tick não devolve
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  perform pg_temp.ld_lead('lc-3', 3);
  update public.leads set dono_id = v_b where id = 'lc-3';
  perform pg_temp.ld_entrega('lc-3', v_b, 'auto', now() - interval '20 minutes');
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'devolvidos')::int = 0 and (select dono_id from public.leads where id = 'lc-3') = v_b then '8 ok' else '8 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
