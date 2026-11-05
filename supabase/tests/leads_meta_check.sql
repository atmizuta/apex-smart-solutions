-- §137: conferência da migration 20261104200000 (webhook da agência). Rodar no execute_sql depois da migration.
-- Termina com exceção de propósito: os leads de teste, o log e as mudanças de config são desfeitos. Resultado na mensagem.
do $$
declare v jsonb; f int; m text; ok text[] := '{}'; ts timestamptz := '2026-11-04T22:06:57Z';
  um jsonb := jsonb_build_array(jsonb_build_object('id', 'l:zzmeta1', 'criado_em_lead', ts, 'full_name', 'Zz Teste'));
begin
  -- 1. Meta no paralelo: grava, não enfileira, marca origem e meta_visto_em
  v := public.leads_entrada2(um, false, 'meta');
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta1';
  if (v ->> 'inseridos')::int <> 1 or f <> 0 then raise exception 'FALHOU 1: % fila=%', v, f; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta1' and origem_entrada = 'meta' and meta_visto_em is not null and aba = 'NOVEMBRO')
    then raise exception 'FALHOU 1b: origem/visto/aba'; end if;
  ok := array_append(ok, '1');
  -- 2. mesmo lead de novo: não duplica
  v := public.leads_entrada2(um, false, 'meta');
  if (v ->> 'inseridos')::int <> 0 or (v ->> 'vistos')::int <> 0 then raise exception 'FALHOU 2: %', v; end if;
  ok := array_append(ok, '2');
  -- 3. chamada antiga (planilha): enfileira como antes e grava origem planilha
  v := public.leads_entrada(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', now() - interval '1 hour')));
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta2';
  if (v ->> 'inseridos')::int <> 1 or f <> 1 then raise exception 'FALHOU 3: % fila=%', v, f; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta2' and origem_entrada = 'planilha' and meta_visto_em is null)
    then raise exception 'FALHOU 3b'; end if;
  ok := array_append(ok, '3');
  -- 4. paralelo: lead da planilha que o webhook não trouxe aparece no aviso
  update public.config set valor = jsonb_build_object('modo', 'paralelo', 'paralelo_desde', now() - interval '2 hours')::text where chave = 'leads_meta';
  update public.config set valor = jsonb_build_object('ultimo_recebido_em', now())::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() not like '%chegaram pela planilha e não pelo webhook%' then raise exception 'FALHOU 4: %', public.leads_meta_aviso(); end if;
  ok := array_append(ok, '4');
  -- 5. o webhook vê o lead: some do aviso (meta_visto_em) e registrar grava log + status
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', now() - interval '1 hour')), false, 'meta');
  if (v ->> 'vistos')::int <> 1 then raise exception 'FALHOU 5: %', v; end if;
  perform public.leads_meta_registrar(jsonb_build_array(jsonb_build_object('lead_id', 'l:zzmeta2', 'aba', 'NOVEMBRO', 'criado_em', now(), 'modo', 'paralelo', 'resultado', 'repetido', 'ja_existia', true)), '[]'::jsonb);
  select count(*) into f from public.leads_webhook_log where lead_id = 'l:zzmeta2';
  if f <> 1 or public.leads_meta_aviso() <> '' then raise exception 'FALHOU 5b: log=% aviso=%', f, public.leads_meta_aviso(); end if;
  select valor into m from public.config where chave = 'leads_meta_status';
  if (m::jsonb ->> 'recebidos')::int <> 1 then raise exception 'FALHOU 5c: %', m; end if;
  ok := array_append(ok, '5');
  -- 6. principal: enfileira
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta3', 'criado_em_lead', ts)), true, 'meta');
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta3';
  if f <> 1 then raise exception 'FALHOU 6: fila=%', f; end if;
  ok := array_append(ok, '6');
  -- 7. origem inválida recusa
  begin perform public.leads_entrada2(um, false, 'outra'); raise exception 'FALHOU 7: aceitou origem inválida';
  exception when sqlstate '22023' then ok := array_append(ok, '7'); end;
  -- 8. erro registrado aparece no aviso; some quando chega lead depois
  perform public.leads_meta_erro('token inválido ou ausente (401)');
  if public.leads_meta_aviso() not like 'Webhook dos leads recusou um envio em % token inválido ou ausente (401)' then raise exception 'FALHOU 8: %', public.leads_meta_aviso(); end if;
  perform public.leads_meta_registrar(jsonb_build_array(jsonb_build_object('lead_id', 'l:zzmeta9', 'modo', 'paralelo', 'resultado', 'novo')), '[]'::jsonb);
  if public.leads_meta_aviso() <> '' then raise exception 'FALHOU 8b: %', public.leads_meta_aviso(); end if;
  ok := array_append(ok, '8');
  -- 9. campo desconhecido aparece no aviso (ensaio)
  update public.config set valor = '{"modo":"ensaio"}' where chave = 'leads_meta';
  perform public.leads_meta_registrar(jsonb_build_array(jsonb_build_object('lead_id', 'l:zzmeta9', 'modo', 'ensaio', 'resultado', 'ensaio')), '["zz_campo"]'::jsonb);
  if public.leads_meta_aviso() <> 'Campo novo no envio da agência: zz_campo' then raise exception 'FALHOU 9: %', public.leads_meta_aviso(); end if;
  ok := array_append(ok, '9');
  -- 10. desligado: sem aviso; a versão do quadro muda com o aviso
  m := public.leads_kanban_versao();
  update public.config set valor = '{"modo":"desligado"}' where chave = 'leads_meta';
  if public.leads_meta_aviso() <> '' or public.leads_kanban_versao() = m then raise exception 'FALHOU 10'; end if;
  ok := array_append(ok, '10');
  -- 11. JSON errado em config: aviso claro, sem derrubar a versão do quadro
  update public.config set valor = '{"modo":"paralelo",' where chave = 'leads_meta';
  if public.leads_meta_aviso() <> 'Leads da Meta: config.leads_meta ou leads_meta_status inválido' then raise exception 'FALHOU 11: %', public.leads_meta_aviso(); end if;
  perform public.leads_kanban_versao();
  ok := array_append(ok, '11');
  -- 12. principal: silêncio longo (só confere que não quebra fora do horário)
  update public.config set valor = '{"modo":"principal","alerta_horas":4}' where chave = 'leads_meta';
  update public.config set valor = jsonb_build_object('ultimo_recebido_em', now() - interval '5 hours')::text where chave = 'leads_meta_status';
  if extract(hour from now() at time zone 'America/Sao_Paulo') between 9 and 20 and public.leads_meta_aviso() not like 'Nenhum lead chegou pelo webhook%'
    then raise exception 'FALHOU 12: %', public.leads_meta_aviso(); end if;
  ok := array_append(ok, '12');
  raise exception 'RESULTADO: OK %', array_to_string(ok, ',');
end $$;
