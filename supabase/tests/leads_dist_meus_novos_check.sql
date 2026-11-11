-- §146.3 (11/11, Rafael): quem tem lead em "Meus novos" (dono + sem status) não está na vez. Tudo desfeito no fim.
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- A tem um lead em Meus novos (pego na mão, sem status)
  perform pg_temp.ld_lead('mn-1', 1);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() - interval '1 hour' where aba = 'TESTE DIST' and id = 'mn-1';
  -- 1. motor: A fica "pendente" e o lead novo vai para B
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'pendente'
                          and (r ->> 'escolhido')::uuid = v_b then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. faixa do consultor: A vê "pendente"
  perform pg_temp.ld_como(v_a);
  r := public.leads_dist_meu();
  v_out := v_out || case when r ->> 'estado' = 'pendente' then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. Equipe: A aparece como pendente
  perform pg_temp.ld_como(pg_temp.ld_admin());
  r := public.leads_dist_equipe(1);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'pendente' then '3 ok; ' else '3 FALHOU; ' end;
  -- 4. A tabula (sai de Meus novos) e volta para a vez
  update public.leads set categoria = 'andamento', classificado_em = now() where aba = 'TESTE DIST' and id = 'mn-1';
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'na_vez' then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. lead apagado em Meus novos não trava
  perform pg_temp.ld_lead('mn-2', 2);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now(), apagado_em = now() where aba = 'TESTE DIST' and id = 'mn-2';
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'na_vez' then '5 ok; ' else '5 FALHOU; ' end;
  -- 6. todos com Meus novos: ninguém na vez, o lead fica na fila
  perform pg_temp.ld_lead('mn-3', 3); perform pg_temp.ld_lead('mn-4', 4); perform pg_temp.ld_lead('mn-5', 5);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'mn-3';
  update public.leads set dono_id = v_b, consultor = 'Teste Dist B', pego_em = now() where aba = 'TESTE DIST' and id = 'mn-4';
  r := public.leads_distribuir('TESTE DIST', 'mn-5');
  v_out := v_out || case when r ->> 'motivo' = 'ninguem_na_vez' and (select dono_id from public.leads where id = 'mn-5') is null then '6 ok' else '6 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
