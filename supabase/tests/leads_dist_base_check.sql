-- §146.1 Task 1: conferência de 20261109120000_leads_dist_base.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; v_id bigint; n int;
begin
  -- 1. padrões
  v_out := v_out || case when (public.leads_dist_cfg() ->> 'piso')::numeric = 0.15 and (public.leads_dist_cfg() ->> 'prazo_devolver_min')::int = 15
                          and public.leads_dist_cfg() ->> 'modo' = 'automatico' then '1 ok; ' else '1 FALHOU ' || public.leads_dist_cfg()::text || '; ' end;
  -- 2. expediente
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5],"inicio":"13:00","fim":"21:00"}}');
  v_out := v_out || case when public.leads_dist_no_expediente('2026-11-09 15:00-03') and not public.leads_dist_no_expediente('2026-11-09 22:00-03')
                          and not public.leads_dist_no_expediente('2026-11-08 15:00-03') and not public.leads_dist_no_expediente('2026-11-09 12:59-03')
                     then '2 ok; ' else '2 FALHOU; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  v_out := v_out || case when not public.leads_dist_no_expediente(now()) then '2b ok; ' else '2b FALHOU; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  v_out := v_out || case when public.leads_dist_no_expediente(now()) then '2c ok; ' else '2c FALHOU; ' end;
  -- 3. presença e pausa
  perform pg_temp.ld_como(v_a);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when (r ->> 'equipe')::boolean and r ->> 'pausa_ate' is null
                          and exists (select 1 from public.leads_presenca where profile_id = v_a and visto_em > now() - interval '1 second') then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  r := public.leads_presenca_ping('pausa');
  v_out := v_out || case when (r ->> 'pausa_ate')::timestamptz between now() + interval '59 minutes' and now() + interval '61 minutes' then '3b ok; ' else '3b FALHOU ' || r::text || '; ' end;
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r ->> 'pausa_ate' is not null then '3c ok; ' else '3c FALHOU (ping comum tirou a pausa); ' end;
  r := public.leads_presenca_ping('voltar');
  v_out := v_out || case when r ->> 'pausa_ate' is null then '3d ok; ' else '3d FALHOU; ' end;
  -- 4. fora da equipe: não grava
  perform pg_temp.ld_como(gen_random_uuid());
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when not (r ->> 'equipe')::boolean then '4 ok; ' else '4 FALHOU; ' end;
  -- 5. ação inválida
  perform pg_temp.ld_como(v_a);
  begin perform public.leads_presenca_ping('dormir'); v_out := v_out || '5 FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '5 ok; ' else '5 FALHOU ' || sqlerrm || '; ' end; end;
  -- 6. clique no telefone (registrar_contato_lead 'ligar') marca a entrega aberta do dono
  perform pg_temp.ld_lead('ld-1', 1);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-1';
  v_id := pg_temp.ld_entrega('ld-1', v_a, 'auto', now() - interval '2 minutes');
  perform public.registrar_contato_lead('TESTE DIST', 'ld-1', 'ligar');
  v_out := v_out || case when (select sinal = 'clique' and atendido_em is not null from public.leads_distribuicao where id = v_id) then '6 ok; ' else '6 FALHOU; ' end;
  -- 6b. WhatsApp não conta como atendimento
  perform pg_temp.ld_lead('ld-1b', 11);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-1b';
  v_id := pg_temp.ld_entrega('ld-1b', v_a, 'auto', now());
  perform public.registrar_contato_lead('TESTE DIST', 'ld-1b', 'whatsapp');
  v_out := v_out || case when (select atendido_em is null from public.leads_distribuicao where id = v_id) then '6b ok; ' else '6b FALHOU; ' end;
  -- 7. clique de outra pessoa (gestor) não marca a entrega do dono
  perform pg_temp.ld_lead('ld-2', 2);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-2';
  v_id := pg_temp.ld_entrega('ld-2', v_a, 'auto', now());
  perform pg_temp.ld_como(pg_temp.ld_admin());
  perform public.registrar_contato_lead('TESTE DIST', 'ld-2', 'ligar');
  v_out := v_out || case when (select atendido_em is null from public.leads_distribuicao where id = v_id) then '7 ok; ' else '7 FALHOU; ' end;
  -- 8. tabulação marca a entrega aberta do dono (sinal tabulacao)
  update public.leads set classificado_em = now() where aba = 'TESTE DIST' and id = 'ld-2';
  v_out := v_out || case when (select sinal = 'tabulacao' and atendido_em is not null from public.leads_distribuicao where id = v_id) then '8 ok; ' else '8 FALHOU; ' end;
  -- 9. só uma entrega aberta por lead
  begin perform pg_temp.ld_entrega('ld-2', v_b, 'auto', now()); v_out := v_out || '9 FALHOU; ';
  exception when unique_violation then v_out := v_out || '9 ok; '; end;
  -- 10. aviso grava e apaga
  perform public.leads_dist_aviso('teste', '"x"');
  perform public.leads_dist_aviso('teste', null);
  v_out := v_out || case when not ((select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'teste') then '10 ok; ' else '10 FALHOU; ' end;
  -- 11. RLS: authenticated não lê as tabelas novas direto
  execute 'set local role authenticated';
  begin
    select count(*) into n from public.leads_distribuicao;
    v_out := v_out || case when n = 0 then '11 ok' else '11 FALHOU' end;
  exception when insufficient_privilege then v_out := v_out || '11 ok';
  end;
  execute 'reset role';
  raise exception 'RESULTADO: %', v_out;
end $$;
