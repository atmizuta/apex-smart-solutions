-- §149: conferência da migration 20261112150100 (roda com as migrations 150000 e 150100; termina com exceção de propósito).
do $$
declare v_cons uuid; v_sup uuid; r jsonb; v_id bigint; v_id2 bigint; v_n int; c record; v_ini date := date_trunc('month', public.tv_hoje())::date;
  v_jan date := greatest(date_trunc('month', public.tv_hoje())::date, public.tv_hoje() - 5);   -- janela curta: o mês inteiro sem o índice parcial passa do tempo do execute_sql
begin
  select id into v_cons from public.profiles where role = 'consultor' and coalesce(operacao, 'apex') = 'apex' limit 1;
  select id into v_sup from public.profiles where role = 'admin' limit 1;

  -- contatos: o caminho com cache dá o mesmo que o cálculo direto no mês
  for c in
    select coalesce(a.profile_id, b.profile_id) as pid, a.contatos as com_cache, b.contatos as direto
      from public.tv_contatos(v_jan, public.tv_hoje()) a
      full join (select t.profile_id, sum(t.contatos)::int as contatos from public.tv_contatos_calc(v_jan, public.tv_hoje()) t group by 1) b
        on b.profile_id = a.profile_id
  loop
    if c.com_cache is distinct from c.direto then raise exception 'FALHOU: cache diverge para % (% x %)', left(c.pid::text, 8), c.com_cache, c.direto; end if;
  end loop;
  select count(*) into v_n from public.tv_contatos_cache_dias where dia between v_jan and public.tv_hoje() - 2;
  if v_n <> greatest(0, (public.tv_hoje() - 2) - v_jan + 1) then raise exception 'FALHOU: dias no cache (%)', v_n; end if;
  if exists (select 1 from public.tv_contatos_cache_dias where dia >= public.tv_hoje() - 1) then raise exception 'FALHOU: ontem/hoje no cache'; end if;

  -- consultor não vê a TV
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.tv_ranking('hoje'); raise exception 'FALHOU: consultor viu o ranking'; exception when sqlstate '42501' then null; end;
  begin perform public.tv_ultima_venda(); raise exception 'FALHOU: consultor viu a última venda'; exception when sqlstate '42501' then null; end;
  r := public.vendi('11222333000181', '[{"plano_id":"p57-100","gb":100,"valor_linha":94.99,"linhas":5}]', 'discador');
  v_id := (r ->> 'id')::bigint;
  r := public.vendi('11444777000161', '[{"plano_id":"p57-40","gb":40,"valor_linha":59.99,"linhas":1}]', 'renovacao');
  v_id2 := (r ->> 'id')::bigint;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  begin perform public.tv_ranking('semana'); raise exception 'FALHOU: período inválido'; exception when sqlstate '22023' then null; end;
  r := public.tv_ultima_venda();
  if (r ->> 'ultimo_id')::bigint < v_id2 then raise exception 'FALHOU: ultimo_id %', r; end if;

  r := public.tv_vendas_desde(v_id - 1);
  if jsonb_array_length(r) < 2 then raise exception 'FALHOU: vendas_desde trouxe %', jsonb_array_length(r); end if;
  if (r -> 0 ->> 'id')::bigint <> v_id or (r -> 1 ->> 'id')::bigint <> v_id2 then raise exception 'FALHOU: ordem das vendas'; end if;
  if (r -> 1 ->> 'vendas_hoje')::int < 2 then raise exception 'FALHOU: vendas_hoje da 2ª'; end if;
  if (r -> 1 ->> 'pos_depois') is null then raise exception 'FALHOU: sem posição depois'; end if;
  if (r -> 1 ->> 'pos_antes') is distinct from (r -> 0 ->> 'pos_depois') then raise exception 'FALHOU: pos_antes da 2ª ≠ pos_depois da 1ª'; end if;

  r := public.tv_ranking('hoje');
  select (l ->> 'vendas')::int into v_n from jsonb_array_elements(r -> 'linhas') l where l ->> 'profile_id' = v_cons::text;
  if coalesce(v_n, 0) < 2 then raise exception 'FALHOU: ranking de hoje sem as 2 vendas (%)', v_n; end if;
  if (r -> 'totais' ->> 'vendas')::int < 2 or (r -> 'meta' ->> 'vendas_hoje')::int < 2 then raise exception 'FALHOU: totais %', r -> 'totais'; end if;
  if r -> 'ultima' ->> 'nome' is null then raise exception 'FALHOU: sem última venda'; end if;
  -- dias antes da janela entram no cache vazios (só nesta transação), para o Mês não recalcular o mês inteiro
  insert into public.tv_contatos_cache_dias (dia) select g::date from generate_series(v_ini, v_jan - 1, interval '1 day') g on conflict (dia) do nothing;
  r := public.tv_ranking('mes');
  if (r ->> 'de')::date <> v_ini then raise exception 'FALHOU: mês começa em %', r ->> 'de'; end if;

  -- cancelada some da festa e aparece em cancelados_ids
  update public.vendas_marcadas set cancelada_em = now() where id = v_id2;
  r := public.tv_vendas_desde(v_id - 1);
  if exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id2) then raise exception 'FALHOU: cancelada na festa'; end if;
  if not ((public.tv_ultima_venda() -> 'cancelados_ids') @> jsonb_build_array(v_id2)) then raise exception 'FALHOU: cancelados_ids'; end if;
  -- venda de mais de 15 min não vira festa (TV que ficou sem internet)
  update public.vendas_marcadas set marcada_em = now() - interval '20 minutes' where id = v_id;
  r := public.tv_vendas_desde(v_id - 1);
  if exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id) then raise exception 'FALHOU: venda velha na festa'; end if;

  -- meta: define, comemora uma vez só
  begin perform public.tv_meta_definir(0); raise exception 'FALHOU: meta 0'; exception when sqlstate '22023' then null; end;
  perform public.tv_meta_definir(1);
  update public.tv_meta_dia set comemorada_em = null where dia = public.tv_hoje();
  if public.tv_meta_atual() <> 1 then raise exception 'FALHOU: meta atual'; end if;
  r := public.tv_meta_comemorar();
  if not (r ->> 'comemorar')::boolean or jsonb_array_length(r -> 'pessoas') < 1 then raise exception 'FALHOU: 1ª comemoração %', r; end if;
  r := public.tv_meta_comemorar();
  if (r ->> 'comemorar')::boolean then raise exception 'FALHOU: comemorou duas vezes'; end if;

  raise exception 'RESULTADO: ok (vendas % e %)', v_id, v_id2;
end $$;
