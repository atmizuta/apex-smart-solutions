-- §146.1 Task 2: conferência de 20261109120100_leads_dist_notas.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; f numeric[]; ra record; rb record; rc record; i int; s numeric;
begin
  -- 1. fatias: teto prende o maior e o resto divide
  f := public.leads_dist_fatias(array[3,1,1,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.40,0.20,0.20,0.20]::numeric[] then '1 ok; ' else '1 FALHOU ' || f::text || '; ' end;
  -- 2. nota zero recebe o piso, nunca zero
  f := public.leads_dist_fatias(array[1,1,1,1,0]::numeric[], 0.15, 0.40);
  v_out := v_out || case when round(f[5], 4) = 0.15 and round(f[1], 4) = 0.2125 then '2 ok; ' else '2 FALHOU ' || f::text || '; ' end;
  -- 3. dois no teto, terceiro com o resto
  f := public.leads_dist_fatias(array[5,5,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.40,0.40,0.20]::numeric[] then '3 ok; ' else '3 FALHOU ' || f::text || '; ' end;
  -- 4. limite impossível (2 pessoas, teto 40%) divide igual; vazio devolve vazio
  f := public.leads_dist_fatias(array[9,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.5,0.5]::numeric[] and public.leads_dist_fatias('{}'::numeric[], 0.15, 0.40) = '{}'::numeric[] then '4 ok; ' else '4 FALHOU ' || f::text || '; ' end;
  -- 5. soma sempre 1 e limites respeitados (notas variadas)
  f := public.leads_dist_fatias(array[0.3,2.5,1.1,0.9,0.05,1.7]::numeric[], 0.10, 0.30);
  s := 0; for i in 1..6 loop s := s + f[i]; end loop;
  v_out := v_out || case when abs(s - 1) < 0.00001 and (select bool_and(x between 0.10 - 1e-9 and 0.30 + 1e-9) from unnest(f) x) then '5 ok; ' else '5 FALHOU ' || f::text || '; ' end;

  -- Velocidade: A atendeu 10 de 10 em 2 min; B atendeu 10 de 10 em 30 min; C sem histórico.
  for i in 1..10 loop
    perform pg_temp.ld_lead('lv-a' || i, i);
    perform pg_temp.ld_lead('lv-b' || i, 20 + i);
    insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em)
    values ('TESTE DIST', 'lv-a' || i, v_a, 'auto', now() - make_interval(hours => i), now() - make_interval(hours => i) + interval '2 minutes', now()),
           ('TESTE DIST', 'lv-b' || i, v_b, 'pegou', now() - make_interval(hours => i), now() - make_interval(hours => i) + interval '30 minutes', now());
  end loop;
  -- Conversão: A 4 vendas em 10 leads de 5 dias atrás; B 1 em 10; um lead de A pego ONTEM e vendido não conta (maturação).
  for i in 1..10 loop
    perform pg_temp.ld_lead('lc-a' || i, 40 + i);
    perform pg_temp.ld_lead('lc-b' || i, 60 + i);
    update public.leads set dono_id = v_a, pego_em = now() - interval '5 days', converteu = (i <= 4) where aba = 'TESTE DIST' and id = 'lc-a' || i;
    update public.leads set dono_id = v_b, pego_em = now() - interval '5 days', converteu = (i <= 1) where aba = 'TESTE DIST' and id = 'lc-b' || i;
  end loop;
  perform pg_temp.ld_lead('lc-a-ontem', 90);
  update public.leads set dono_id = v_a, pego_em = now() - interval '1 day', converteu = true where aba = 'TESTE DIST' and id = 'lc-a-ontem';
  -- A e B abriram o painel hoje; C não.
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);

  select * into ra from public.leads_dist_notas() where consultor_id = v_a;
  select * into rb from public.leads_dist_notas() where consultor_id = v_b;
  select * into rc from public.leads_dist_notas() where consultor_id = v_c;
  -- 6. velocidade: A 10/10 a tempo, B 0/10
  v_out := v_out || case when ra.vel_ok = 10 and ra.vel_n = 10 and rb.vel_ok = 0 and rb.vel_n = 10 and ra.vel > rb.vel then '6 ok; ' else '6 FALHOU A=' || ra.vel_ok || '/' || ra.vel_n || ' B=' || rb.vel_ok || '/' || rb.vel_n || '; ' end;
  -- 7. conversão: A > B, suavizada (A abaixo de 40%, B acima de 10%), lead de ontem fora
  v_out := v_out || case when ra.conv > rb.conv and ra.conv < 0.40 and rb.conv > 0.10 then '7 ok; ' else '7 FALHOU A=' || ra.conv || ' B=' || rb.conv || '; ' end;
  -- 8. ativo e fatia: A e B ativos, C inativo sem fatia; com 2 ativos o teto de 40% é impossível → meio a meio; nota A > B
  v_out := v_out || case when ra.ativo and rb.ativo and not rc.ativo and rc.fatia is null and ra.fatia = 0.5 and rb.fatia = 0.5 and ra.nota > rb.nota
                     then '8 ok; ' else '8 FALHOU fatias ' || coalesce(ra.fatia::text, 'null') || '/' || coalesce(rb.fatia::text, 'null') || '; ' end;
  -- 9. consultor sem histórico fica na média do time (conv entre B e A)
  v_out := v_out || case when rc.conv between rb.conv and ra.conv and rc.vel between rb.vel and ra.vel then '9 ok; ' else '9 FALHOU C=' || rc.conv || '/' || rc.vel || '; ' end;
  -- 10. clique sem ligação (confirmado = false) não conta como a tempo
  update public.leads_distribuicao set confirmado = false where consultor_id = v_a and lead_id in ('lv-a1', 'lv-a2');
  select * into ra from public.leads_dist_notas() where consultor_id = v_a;
  v_out := v_out || case when ra.vel_ok = 8 then '10 ok; ' else '10 FALHOU ' || ra.vel_ok || '; ' end;
  -- 11. entrega com menos de 5 min e sem atendimento ainda não entra na velocidade
  perform pg_temp.ld_lead('lv-novo', 99);
  perform pg_temp.ld_entrega('lv-novo', v_b, 'auto', now() - interval '1 minute');
  select * into rb from public.leads_dist_notas() where consultor_id = v_b;
  v_out := v_out || case when rb.vel_n = 10 then '11 ok; ' else '11 FALHOU ' || rb.vel_n || '; ' end;
  -- 12. recebidos hoje conta auto e pegou de hoje (B: a entrega de agora)
  v_out := v_out || case when rb.recebidos_hoje >= 1 and rb.ultimo_recebido > now() - interval '2 minutes' then '12 ok' else '12 FALHOU ' || rb.recebidos_hoje end;
  raise exception 'RESULTADO: %', v_out;
end $$;
