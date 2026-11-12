-- §146.5: presença devolve a entrega devolvida nos últimos 3 min. Tudo desfeito no fim.
do $$
declare v_a uuid := pg_temp.ld_c(1); v_out text := ''; r jsonb;
begin
  perform pg_temp.ld_lead('lp-d1', 61); perform pg_temp.ld_lead('lp-d2', 62);
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, devolvido_em, fechado_em)
  values ('TESTE DIST', 'lp-d2', v_a, 'auto', now() - interval '30 minutes', now() - interval '10 minutes', now() - interval '10 minutes');
  perform pg_temp.ld_como(v_a);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r ? 'devolvida' and r -> 'devolvida' = 'null'::jsonb then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, devolvido_em, fechado_em)
  values ('TESTE DIST', 'lp-d1', v_a, 'auto', now() - interval '17 minutes', now() - interval '1 minute', now() - interval '1 minute');
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r -> 'devolvida' ->> 'lead_id' = 'lp-d1' and r -> 'devolvida' ->> 'nome' = 'Lead Teste' then '2 ok' else '2 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
