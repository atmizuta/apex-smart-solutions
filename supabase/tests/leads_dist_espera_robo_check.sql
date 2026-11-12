-- §146.5 (12/11, Rafael): ligação do ProContact conta como atendimento e a devolução espera o robô. Tudo desfeito no fim.
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; v_lig bigint;
  e1 bigint; e2 bigint; e3 bigint; e4 bigint; e5 bigint;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- leads de A: lr-1 (sem ligação, robô ainda não cobriu), lr-2 (ligou aos 3 min), lr-3 (sem ligação, robô cobriu), lr-5 (já devolvido, tinha ligado aos 2 min)
  perform pg_temp.ld_lead('lr-1', 51); perform pg_temp.ld_lead('lr-2', 52); perform pg_temp.ld_lead('lr-3', 53); perform pg_temp.ld_lead('lr-5', 55);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A' where aba = 'TESTE DIST' and id in ('lr-1', 'lr-2', 'lr-3');
  e1 := pg_temp.ld_entrega('lr-1', v_a, 'auto', now() - interval '16 minutes');
  e2 := pg_temp.ld_entrega('lr-2', v_a, 'auto', now() - interval '16 minutes');
  e3 := pg_temp.ld_entrega('lr-3', v_a, 'auto', now() - interval '16 minutes');
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, devolvido_em, fechado_em)
  values ('TESTE DIST', 'lr-5', v_a, 'auto', now() - interval '60 minutes', now() - interval '44 minutes', now() - interval '44 minutes') returning id into e5;
  -- robô importou agora: ligação de A para lr-2 aos 3 min e para lr-5 aos 2 min
  select coalesce(max(id), 0) + 1 into v_lig from public.ligacoes_manuais;
  insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, importado_em)
  values (v_lig, 'teste.dist.a', '11900000052', public.chave_tel('(11) 90000-0052'), now() - interval '13 minutes', true, now()),
         (v_lig + 1, 'teste.dist.a', '11900000055', public.chave_tel('(11) 90000-0055'), now() - interval '58 minutes', true, now());
  -- deixa lr-1 de fora desta rodada: só ele é testado com o robô atrasado (abaixo)
  update public.leads_distribuicao set recebido_em = now() - interval '1 minute' where id = e1;
  r := public.leads_dist_tick();
  -- 1. ligação do ProContact dentro do prazo segura o lead e conta na hora real
  v_out := v_out || case when (select atendido_em = recebido_em + interval '3 minutes' and devolvido_em is null and confirmado from public.leads_distribuicao where id = e2)
                          and (select dono_id from public.leads where id = 'lr-2') = v_a then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. sem ligação e com o robô em dia: devolve como antes
  v_out := v_out || case when (select devolvido_em is not null from public.leads_distribuicao where id = e3) then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. entrega já devolvida recupera o crédito (atendido na hora da ligação)
  v_out := v_out || case when (select atendido_em = recebido_em + interval '2 minutes' from public.leads_distribuicao where id = e5) then '3 ok; ' else '3 FALHOU; ' end;
  -- 4. robô atrasado (última importação há 2 min, antes do fim do prazo de lr-1): espera, não devolve
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where id = e1;
  update public.ligacoes_manuais set importado_em = now() - interval '2 minutes' where importado_em > now() - interval '2 minutes';
  r := public.leads_dist_tick();
  v_out := v_out || case when (select devolvido_em is null from public.leads_distribuicao where id = e1) and (select dono_id from public.leads where id = 'lr-1') = v_a
                     then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. teto: robô parado e o lead já passou 15 + 30 min → devolve assim mesmo
  update public.leads_distribuicao set recebido_em = now() - interval '50 minutes' where id = e1;
  update public.ligacoes_manuais set importado_em = now() - interval '40 minutes' where importado_em > now() - interval '40 minutes';
  r := public.leads_dist_tick();
  v_out := v_out || case when (select devolvido_em is not null from public.leads_distribuicao where id = e1) then '5 ok' else '5 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
