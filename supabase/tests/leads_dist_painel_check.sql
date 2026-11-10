-- §146.1 Task 5: conferência de 20261109120400_leads_dist_painel.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; ca jsonb;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. consultor não vê nem configura
  perform pg_temp.ld_como(v_a);
  begin perform public.leads_dist_equipe(1); v_out := v_out || '1 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1 ok; ' else '1 FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"modo":"sombra"}'); v_out := v_out || '1b FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1b ok; ' else '1b FALHOU ' || sqlerrm || '; ' end; end;
  -- 2. gestor configura modo e parâmetros válidos
  perform pg_temp.ld_como(pg_temp.ld_admin());
  r := public.leads_dist_config('{"modo":"sombra","piso":0.10,"teto":0.45}');
  v_out := v_out || case when r ->> 'modo' = 'sombra' and (r ->> 'piso')::numeric = 0.10 and (r ->> 'teto')::numeric = 0.45 and r ? 'alterado_por'
                     then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. inválidos recusados (22023)
  begin perform public.leads_dist_config('{"modo":"turbo"}'); v_out := v_out || '3a FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3a ok; ' else '3a FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"piso":0.5,"teto":0.4}'); v_out := v_out || '3b FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3b ok; ' else '3b FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"prazo_devolver_min":3}'); v_out := v_out || '3c FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3c ok; ' else '3c FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"suav_conv":1}'); v_out := v_out || '3d FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3d ok; ' else '3d FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"expediente":{"dias":[8],"inicio":"13:00","fim":"21:00"}}'); v_out := v_out || '3e FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3e ok; ' else '3e FALHOU ' || sqlerrm || '; ' end; end;
  v_out := v_out || case when (public.leads_dist_cfg() ->> 'piso')::numeric = 0.10 then '3f ok; ' else '3f FALHOU (inválido gravou); ' end;
  -- 4. sombra e entregas aparecem em teria × recebeu; estados
  perform pg_temp.ld_lead('lp-1', 1); perform pg_temp.ld_lead('lp-2', 2);
  insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido) values ('TESTE DIST', 'lp-1', v_a), ('TESTE DIST', 'lp-2', v_a);
  perform pg_temp.ld_entrega('lp-1', v_b, 'pegou', now());
  update public.leads_presenca set pausa_ate = now() + interval '20 minutes' where profile_id = v_a;
  r := public.leads_dist_equipe(1);
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a;
  v_out := v_out || case when (ca ->> 'teria')::int = 2 and (ca ->> 'recebeu')::int = 0 and ca ->> 'estado' = 'pausa' and ca ->> 'pausa_ate' is not null
                     then '4 ok; ' else '4 FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_b;
  v_out := v_out || case when (ca ->> 'recebeu')::int = 1 and ca ->> 'estado' = 'pendente' then '4b ok; ' else '4b FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  -- 5. clicou e não ligou (14 dias) e devolvidos hoje
  update public.leads_distribuicao set atendido_em = now(), confirmado = false, devolvido_em = now() where lead_id = 'lp-1';
  r := public.leads_dist_equipe(1);
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_b;
  v_out := v_out || case when (ca ->> 'clicou_nao_ligou')::int = 1 and (ca ->> 'devolvidos_hoje')::int = 1 then '5 ok; ' else '5 FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  -- 6. cabeçalho: cfg, aviso, fila
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lp-2');
  r := public.leads_dist_equipe(1);
  v_out := v_out || case when r -> 'cfg' ->> 'modo' = 'sombra' and (r ->> 'fila')::int >= 1 and r ? 'aviso' and r ? 'no_expediente' then '6 ok' else '6 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
