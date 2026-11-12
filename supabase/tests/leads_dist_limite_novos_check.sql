-- §146.4 (12/11, Rafael): até 2 leads em "Meus novos" ainda recebe; com 2 fica fora da vez. Tudo desfeito no fim.
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb;
  est text;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. A com 1 lead em Meus novos continua na vez
  perform pg_temp.ld_lead('ln-1', 1);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() - interval '1 hour' where aba = 'TESTE DIST' and id = 'ln-1';
  r := public.leads_dist_escolher('{}'::uuid[]);
  est := (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a);
  v_out := v_out || case when est = 'na_vez' then '1 ok; ' else '1 FALHOU ' || coalesce(est, 'null') || '; ' end;
  perform pg_temp.ld_como(v_a);
  v_out := v_out || case when public.leads_dist_meu() ->> 'estado' = 'na_vez' then '1b ok; ' else '1b FALHOU; ' end;
  -- 2. com 2 fica fora da vez (motor, faixa e Equipe)
  perform pg_temp.ld_lead('ln-2', 2);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() - interval '1 hour' where aba = 'TESTE DIST' and id = 'ln-2';
  r := public.leads_dist_escolher('{}'::uuid[]);
  est := (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a);
  v_out := v_out || case when est = 'pendente' then '2 ok; ' else '2 FALHOU ' || coalesce(est, 'null') || '; ' end;
  v_out := v_out || case when public.leads_dist_meu() ->> 'estado' = 'pendente' then '2b ok; ' else '2b FALHOU; ' end;
  perform pg_temp.ld_como(pg_temp.ld_admin());
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(public.leads_dist_equipe(1) -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'pendente' then '2c ok; ' else '2c FALHOU; ' end;
  -- 3. limite configurável: max_meus_novos = 3 libera A com 2
  perform pg_temp.ld_cfg('{"max_meus_novos":3}');
  r := public.leads_dist_escolher('{}'::uuid[]);
  est := (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a);
  v_out := v_out || case when est = 'na_vez' then '3 ok' else '3 FALHOU ' || coalesce(est, 'null') end;
  raise exception 'RESULTADO: %', v_out;
end $$;
