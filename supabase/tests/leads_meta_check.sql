-- §137: conferência da migration 20261104200000. Rodar no execute_sql. Resultado na mensagem 'RESULTADO: ...'.
-- Termina com exceção de propósito: os leads de teste e as mudanças de config são desfeitos.
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
  ok := ok || '1';
  -- 2. mesmo lead de novo: não duplica, não conta como visto de novo
  v := public.leads_entrada2(um, false, 'meta');
  if (v ->> 'inseridos')::int <> 0 or (v ->> 'vistos')::int <> 0 then raise exception 'FALHOU 2: %', v; end if;
  ok := ok || '2';
  -- 3. chamada antiga (planilha): enfileira como antes e grava origem planilha
  v := public.leads_entrada(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', ts)));
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta2';
  if (v ->> 'inseridos')::int <> 1 or f <> 1 then raise exception 'FALHOU 3: % fila=%', v, f; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta2' and origem_entrada = 'planilha' and meta_visto_em is null)
    then raise exception 'FALHOU 3b'; end if;
  ok := ok || '3';
  -- 4. a Meta vê o lead que veio da planilha: só ganha meta_visto_em
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', ts)), false, 'meta');
  if (v ->> 'vistos')::int <> 1 or (v ->> 'inseridos')::int <> 0 then raise exception 'FALHOU 4: %', v; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta2' and origem_entrada = 'planilha' and meta_visto_em is not null)
    then raise exception 'FALHOU 4b'; end if;
  ok := ok || '4';
  -- 5. principal: enfileira
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta3', 'criado_em_lead', ts)), true, 'meta');
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta3';
  if f <> 1 then raise exception 'FALHOU 5: fila=%', f; end if;
  ok := ok || '5';
  -- 6. origem inválida recusa
  begin perform public.leads_entrada2(um, false, 'outra'); raise exception 'FALHOU 6: aceitou origem inválida';
  exception when sqlstate '22023' then ok := ok || '6'; end;
  -- 7. cursor: grava, não volta, não mexe no modo
  update public.config set valor = '{"modo":"paralelo","page_id":"zz","form_ids":["1"],"cursor":null}' where chave = 'leads_meta';
  perform public.leads_meta_cursor('2026-11-04T10:00:00Z');
  perform public.leads_meta_cursor('2026-11-04T09:00:00Z');
  select valor into m from public.config where chave = 'leads_meta';
  if (m::jsonb ->> 'cursor')::timestamptz <> '2026-11-04T10:00:00Z' or m::jsonb ->> 'modo' <> 'paralelo' then raise exception 'FALHOU 7: %', m; end if;
  ok := ok || '7';
  -- 8. aviso: paralelo 10 min = nada; 40 min = aviso; principal 10 min = aviso; desligado = nada
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '10 minutes')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() <> '' then raise exception 'FALHOU 8a: %', public.leads_meta_aviso(); end if;
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '40 minutes', 'ultimo_erro', 'Graph 401')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() not like 'Leads da Meta: busca parada desde%Graph 401' then raise exception 'FALHOU 8b: %', public.leads_meta_aviso(); end if;
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"principal"')::text where chave = 'leads_meta';
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '10 minutes')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() = '' then raise exception 'FALHOU 8c'; end if;
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"desligado"')::text where chave = 'leads_meta';
  if public.leads_meta_aviso() <> '' then raise exception 'FALHOU 8d'; end if;
  ok := ok || '8';
  -- 9. formulário fora e pergunta nova
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"ensaio"')::text where chave = 'leads_meta';
  update public.config set valor = '{"forms_fora":[{"id":"9","name":"Zz Form"}],"campos_desconhecidos":["zz_pergunta"]}' where chave = 'leads_meta_status';
  if public.leads_meta_aviso() <> 'Formulário novo na Meta fora da busca: Zz Form · Pergunta nova no formulário da Meta: zz_pergunta'
    then raise exception 'FALHOU 9: %', public.leads_meta_aviso(); end if;
  ok := ok || '9';
  -- 10. a versão do quadro muda com o aviso
  m := public.leads_kanban_versao();
  update public.config set valor = '{}' where chave = 'leads_meta_status';
  if public.leads_kanban_versao() = m then raise exception 'FALHOU 10: versão não mudou'; end if;
  ok := ok || '10';
  -- 11. (revisão) JSON errado em config.leads_meta: aviso claro, sem derrubar a versão do quadro
  update public.config set valor = '{"modo":"paralelo",' where chave = 'leads_meta';
  if public.leads_meta_aviso() <> 'Leads da Meta: config.leads_meta ou leads_meta_status inválido' then raise exception 'FALHOU 11: %', public.leads_meta_aviso(); end if;
  perform public.leads_kanban_versao();
  ok := ok || '11';
  -- 12. (revisão) erro ao listar formulários aparece no aviso
  update public.config set valor = '{"modo":"paralelo","page_id":"zz","form_ids":["1"],"cursor":null}' where chave = 'leads_meta';
  update public.config set valor = jsonb_build_object('ultima_ok', now(), 'forms_erro', 'Graph 403 (10): zz')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() <> 'Não consegui listar os formulários da Meta (o aviso de formulário novo está parado): Graph 403 (10): zz'
    then raise exception 'FALHOU 12: %', public.leads_meta_aviso(); end if;
  ok := ok || '12';
  raise exception 'RESULTADO: OK %', array_to_string(ok, ',');
end $$;
