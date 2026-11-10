-- §146.1 Task 4: conferência de 20261109120300_leads_dist_tick.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; r jsonb; d1 uuid; v_id bigint; v_idok bigint; v_idno bigint; v_lig bigint;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. modo manual: leads_entrada2 não distribui nem cria fila
  perform pg_temp.ld_cfg('{"modo":"manual"}');
  r := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-0', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0030')), false, 'planilha');
  v_out := v_out || case when (r ->> 'inseridos')::int = 1 and (select dono_id from public.leads where id = 'lt-0') is null
                          and not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-0') then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. automático: dois leads na mesma chamada vão para pessoas diferentes
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  perform public.leads_entrada2(jsonb_build_array(
    jsonb_build_object('id', 'lt-1', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0031'),
    jsonb_build_object('id', 'lt-2', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0032')), false, 'meta');
  v_out := v_out || case when (select count(distinct dono_id) from public.leads where id in ('lt-1', 'lt-2') and dono_id in (v_a, v_b)) = 2 then '2 ok; ' else '2 FALHOU; ' end;
  -- 3. pegar nos Livres fecha a fila e grava "pegou"
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  perform public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-3', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0033')), false, 'planilha');
  perform pg_temp.ld_como(v_c);
  r := public.leads_pegar((select aba from public.leads where id = 'lt-3'), 'lt-3');
  v_out := v_out || case when (r ->> 'ok')::boolean
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and tipo = 'pegou' and consultor_id = v_c and fechado_em is null)
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) = 1
                     then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. redistribuir pelo gestor: fecha a aberta e grava "redistribuido"; devolver aos Livres só fecha
  perform pg_temp.ld_como(pg_temp.ld_admin());
  perform public.leads_redistribuir((select aba from public.leads where id = 'lt-3'), 'lt-3', v_b);
  v_out := v_out || case when exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and tipo = 'redistribuido' and consultor_id = v_b and fechado_em is null)
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) = 1 then '4 ok; ' else '4 FALHOU; ' end;
  perform public.leads_redistribuir((select aba from public.leads where id = 'lt-3'), 'lt-3', null);
  v_out := v_out || case when not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) then '4b ok; ' else '4b FALHOU; ' end;
  -- 5. devolução aos 15 min: volta, vai para o outro, nunca para quem perdeu
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  update public.leads_distribuicao set atendido_em = now() where lead_id = 'lt-2';
  select dono_id into d1 from public.leads where id = 'lt-1';
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lt-1' and fechado_em is null;
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'devolvidos')::int = 1
                          and (select dono_id from public.leads where id = 'lt-1') is distinct from d1
                          and (select dono_id from public.leads where id = 'lt-1') in (v_a, v_b)
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lt-1' and devolvido_em is not null and consultor_id = d1)
                          and exists (select 1 from public.leads_historico where lead_id = 'lt-1' and acao = 'devolver' and por is null and (depois ->> 'auto')::boolean)
                     then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. segunda devolução: para de circular, fica nos Livres e vira aviso "parados"
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lt-1' and fechado_em is null;
  r := public.leads_dist_tick();
  v_out := v_out || case when (select dono_id from public.leads where id = 'lt-1') is null
                          and not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-1' and fechado_em is null)
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') -> 'parados' @> '[{"id":"lt-1"}]'
                     then '6 ok; ' else '6 FALHOU ' || r::text || '; ' end;
  -- 7. confirmação: clique com ligação real → true; clique sem ligação → false (robô importou depois)
  perform pg_temp.ld_lead('lt-ok', 40); perform pg_temp.ld_lead('lt-no', 41);
  update public.leads set dono_id = v_a where id in ('lt-ok', 'lt-no');
  v_idok := pg_temp.ld_entrega('lt-ok', v_a, 'auto', now() - interval '30 minutes');
  v_idno := pg_temp.ld_entrega('lt-no', v_a, 'auto', now() - interval '30 minutes');
  update public.leads_distribuicao set atendido_em = now() - interval '28 minutes', sinal = 'clique' where id in (v_idok, v_idno);
  select coalesce(max(id), 0) + 1 into v_lig from public.ligacoes_manuais;
  insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, importado_em)
  values (v_lig, 'Teste.Dist.A', '11900000040', public.chave_tel('(11) 90000-0040'), now() - interval '27 minutes', true, now());
  -- (se ligacoes_manuais tiver outra coluna obrigatória, preencher com valor fictício: seg_falados 30, tabulacao 'Teste')
  r := public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_idok) is true
                          and (select confirmado from public.leads_distribuicao where id = v_idno) is false then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  -- 8. robô parado (última importação há 40 min): não decide e avisa
  perform pg_temp.ld_lead('lt-par', 42);
  update public.leads set dono_id = v_b where id = 'lt-par';
  v_id := pg_temp.ld_entrega('lt-par', v_b, 'auto', now() - interval '30 minutes');
  update public.leads_distribuicao set atendido_em = now() - interval '28 minutes', sinal = 'clique' where id = v_id;
  update public.ligacoes_manuais set importado_em = least(importado_em, now() - interval '40 minutes') where importado_em > now() - interval '40 minutes';
  r := public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_id) is null
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'robo_parado' then '8 ok; ' else '8 FALHOU ' || r::text || '; ' end;
  -- 8b. mais de 24 h sem decisão vira true (benefício da dúvida)
  update public.leads_distribuicao set atendido_em = now() - interval '25 hours' where id = v_id;
  perform public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_id) is true then '8b ok; ' else '8b FALHOU; ' end;
  -- 9. motor quebrado não derruba a entrada: lead entra, fica nos Livres, aviso motor_erro
  perform pg_temp.ld_cfg('{"piso":"x"}');
  r := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-9', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0039')), false, 'planilha');
  v_out := v_out || case when (r ->> 'inseridos')::int = 1 and (select dono_id from public.leads where id = 'lt-9') is null
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'motor_erro'
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lt-9' and consultor_id is null and fechado_em is null)   -- revisão I-1
                     then '9 ok; ' else '9 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"piso":0.15}');
  -- 10. sombra: tick não sombreia de novo o mesmo lead nem atribui
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  perform pg_temp.ld_lead('lt-10', 43);
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lt-10');
  perform public.leads_dist_tick(); perform public.leads_dist_tick();
  v_out := v_out || case when (select count(*) from public.leads_dist_sombra where lead_id = 'lt-10') = 1
                          and (select dono_id from public.leads where id = 'lt-10') is null then '10 ok; ' else '10 FALHOU; ' end;
  -- 11. fora do expediente: tick não distribui a fila
  perform pg_temp.ld_cfg('{"modo":"automatico","expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'distribuidos')::int = 0 and (select dono_id from public.leads where id = 'lt-10') is null then '11 ok; ' else '11 FALHOU ' || r::text || '; ' end;
  -- 12. de volta ao expediente: tick distribui a fila (mais recente primeiro)
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  r := public.leads_dist_tick();
  v_out := v_out || case when (select dono_id from public.leads where id = 'lt-10') in (v_a, v_b) then '12 ok' else '12 FALHOU ' || r::text end;
  -- 13. (revisão I-4) usuario_telefonia vazio = sem telefonia (confirma); espaço sobrando no usuário da ligação ainda casa
  perform pg_temp.ld_cfg('{"modo":"manual"}');
  update public.leads_equipe set usuario_telefonia = '' where profile_id = v_b;
  perform pg_temp.ld_lead('lt-v', 44); perform pg_temp.ld_lead('lt-e', 45);
  update public.leads set dono_id = v_b where id = 'lt-v';
  update public.leads set dono_id = v_a where id = 'lt-e';
  v_id := pg_temp.ld_entrega('lt-v', v_b, 'pegou', now() - interval '30 minutes');
  v_idok := pg_temp.ld_entrega('lt-e', v_a, 'pegou', now() - interval '30 minutes');
  update public.leads_distribuicao set atendido_em = now() - interval '28 minutes', sinal = 'clique' where id in (v_id, v_idok);
  select coalesce(max(id), 0) + 1 into v_lig from public.ligacoes_manuais;
  insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, importado_em)
  values (v_lig, ' teste.dist.a ', '11900000045', public.chave_tel('(11) 90000-0045'), now() - interval '27 minutes', true, now());
  perform public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_id) is true
                          and (select confirmado from public.leads_distribuicao where id = v_idok) is true then '; 13 ok' else '; 13 FALHOU' end;
  raise exception 'RESULTADO: %', v_out;
end $$;
