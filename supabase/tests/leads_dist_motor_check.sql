-- §146.1 Task 3: conferência de 20261109120200_leads_dist_motor.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; r jsonb; d1 uuid; d2 uuid; n int;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);   -- C fica offline
  -- 1. modo manual não faz nada (nem fila)
  perform pg_temp.ld_cfg('{"modo":"manual"}');
  perform pg_temp.ld_lead('lm-0', 1);
  r := public.leads_distribuir('TESTE DIST', 'lm-0');
  v_out := v_out || case when r ->> 'motivo' = 'manual' and not exists (select 1 from public.leads_distribuicao where lead_id = 'lm-0') then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  -- 2. primeiro lead vai para A ou B (C offline), grava dono, entrega, histórico
  perform pg_temp.ld_lead('lm-1', 2);
  r := public.leads_distribuir('TESTE DIST', 'lm-1');
  d1 := (r ->> 'consultor_id')::uuid;
  v_out := v_out || case when (r ->> 'ok')::boolean and d1 in (v_a, v_b)
                          and (select dono_id from public.leads where aba = 'TESTE DIST' and id = 'lm-1') = d1
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-1' and consultor_id = d1 and recebido_em is not null and motivo ? 'consultores')
                          and exists (select 1 from public.leads_historico where lead_id = 'lm-1' and acao = 'redistribuir' and por is null and (depois ->> 'auto')::boolean)
                     then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. segundo lead vai para o outro (o primeiro está pendente)
  perform pg_temp.ld_lead('lm-2', 3);
  r := public.leads_distribuir('TESTE DIST', 'lm-2');
  d2 := (r ->> 'consultor_id')::uuid;
  v_out := v_out || case when d2 in (v_a, v_b) and d2 <> d1 then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. terceiro: ninguém na vez → fila aberta, lead sem dono
  perform pg_temp.ld_lead('lm-3', 4);
  r := public.leads_distribuir('TESTE DIST', 'lm-3');
  v_out := v_out || case when r ->> 'motivo' = 'ninguem_na_vez' and (select dono_id from public.leads where id = 'lm-3') is null
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-3' and consultor_id is null and fechado_em is null)
                     then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. d1 atende → d1 volta para a vez e recebe o lead da fila (mesma linha)
  update public.leads_distribuicao set atendido_em = now(), sinal = 'clique' where lead_id = 'lm-1';
  r := public.leads_distribuir('TESTE DIST', 'lm-3');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = d1
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lm-3') = 1 then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. quem perdeu este lead (excluidos) não recebe de novo
  update public.leads_distribuicao set atendido_em = now() where consultor_id in (v_a, v_b) and atendido_em is null;
  perform pg_temp.ld_lead('lm-4', 5);
  insert into public.leads_distribuicao (lead_aba, lead_id, devolucoes, excluidos) values ('TESTE DIST', 'lm-4', 1, array[v_a]);
  r := public.leads_distribuir('TESTE DIST', 'lm-4');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_b then '6 ok; ' else '6 FALHOU ' || r::text || '; ' end;
  -- 7. pausa tira da vez
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  update public.leads_presenca set pausa_ate = now() + interval '30 minutes' where profile_id = v_b;
  perform pg_temp.ld_lead('lm-5', 6);
  r := public.leads_distribuir('TESTE DIST', 'lm-5');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_a then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  update public.leads_presenca set pausa_ate = null where profile_id = v_b;
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  -- 8. fora do expediente: guarda (fila) e não distribui
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  perform pg_temp.ld_lead('lm-6', 7);
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when r ->> 'motivo' = 'fora_do_expediente' and (select dono_id from public.leads where id = 'lm-6') is null
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-6' and consultor_id is null and fechado_em is null)
                     then '8 ok; ' else '8 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  -- 9. "Bloquear todos" (§132) também para o motor
  update public.config set valor = '{"bloqueado":true}' where chave = 'leads_pegar_bloqueado';
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when r ->> 'motivo' = 'bloqueado' then '9 ok; ' else '9 FALHOU ' || r::text || '; ' end;
  update public.config set valor = '{"bloqueado":false}' where chave = 'leads_pegar_bloqueado';
  -- 10. sombra: grava para quem iria, não muda dono, uma vez só por lead
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  perform public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when (r ->> 'sombra')::boolean and (select dono_id from public.leads where id = 'lm-6') is null
                          and (select count(*) from public.leads_dist_sombra where lead_id = 'lm-6') = 1
                     then '10 ok; ' else '10 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  -- 11. déficit: com fatias iguais, quem recebeu menos hoje leva (B tem 1, A tem 4 recebidos hoje)
  update public.leads_distribuicao set fechado_em = now() where fechado_em is null;
  update public.leads_distribuicao set tipo = 'redistribuido' where consultor_id in (v_a, v_b);   -- tira da conta de recebidos (sem DELETE: o conector pede confirmação)
  for n in 1..4 loop perform pg_temp.ld_lead('ld-a' || n, 10 + n); insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em) values ('TESTE DIST', 'ld-a' || n, v_a, 'auto', now() - interval '1 minute', now(), now()); end loop;
  perform pg_temp.ld_lead('ld-b1', 20);
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em) values ('TESTE DIST', 'ld-b1', v_b, 'auto', now() - interval '1 minute', now(), now());
  perform pg_temp.ld_lead('lm-7', 21);
  r := public.leads_distribuir('TESTE DIST', 'lm-7');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_b then '11 ok; ' else '11 FALHOU ' || r::text || '; ' end;
  -- 12. lead já com dono ou apagado: não mexe e fecha a fila
  perform pg_temp.ld_lead('lm-8', 22);
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lm-8');
  update public.leads set apagado_em = now() where id = 'lm-8';
  r := public.leads_distribuir('TESTE DIST', 'lm-8');
  v_out := v_out || case when r ->> 'motivo' = 'lead_indisponivel' and not exists (select 1 from public.leads_distribuicao where lead_id = 'lm-8' and fechado_em is null)
                     then '12 ok; ' else '12 FALHOU ' || r::text || '; ' end;
  -- 13. "pegou" esquecido há mais de 15 min não trava; há 3 min trava
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  perform pg_temp.ld_lead('lm-9', 23);
  perform pg_temp.ld_entrega('lm-9', v_a, 'pegou', now() - interval '3 minutes');
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'pendente' then '13 ok; ' else '13 FALHOU ' || r::text || '; ' end;
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lm-9';
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'na_vez' then '13b ok; ' else '13b FALHOU ' || r::text || '; ' end;
  -- 14. offline aparece com estado offline e nunca é escolhido
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_c) is null
                          or (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_c) = 'offline'
                     then '14 ok' else '14 FALHOU ' || r::text end;
  -- 15. (revisão I-2/I-3) sombra conta a escolha como recebida e pendente: 3 leads seguidos não vão todos para a mesma pessoa;
  --     a linha da fila fecha quando a sombra é anotada
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  perform pg_temp.ld_lead('ls-1', 31); perform pg_temp.ld_lead('ls-2', 32); perform pg_temp.ld_lead('ls-3', 33);
  perform public.leads_distribuir('TESTE DIST', 'ls-1'); perform public.leads_distribuir('TESTE DIST', 'ls-2');
  r := public.leads_distribuir('TESTE DIST', 'ls-3');
  v_out := v_out || case when (select count(distinct escolhido) from public.leads_dist_sombra where lead_id in ('ls-1', 'ls-2')) = 2
                          and r ->> 'motivo' = 'ninguem_na_vez'
                          and not exists (select 1 from public.leads_distribuicao where lead_id in ('ls-1', 'ls-2') and fechado_em is null)
                     then '; 15 ok' else '; 15 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
