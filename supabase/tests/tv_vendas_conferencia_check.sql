-- §149: conferência da migration 20261112150300 (roda com 150000 + 150300; termina com exceção de propósito).
do $$
declare v_sup uuid; v_cons uuid; p record; v_id bigint; v_id2 bigint; r jsonb; v_st text;
begin
  select id into v_sup from public.profiles where role = 'admin' limit 1;
  select id into v_cons from public.profiles where role = 'consultor' and coalesce(operacao, 'apex') = 'apex' limit 1;

  -- dias úteis (13/11/2026 é sexta; 20/11 é feriado)
  if public.tv_dia_util_mais(date '2026-11-13', 3) <> date '2026-11-18' then raise exception 'FALHOU: 13/11 + 3 úteis = %', public.tv_dia_util_mais(date '2026-11-13', 3); end if;
  if public.tv_dia_util_mais(date '2026-11-19', 1) <> date '2026-11-23' then raise exception 'FALHOU: 19/11 + 1 útil = %', public.tv_dia_util_mais(date '2026-11-19', 1); end if;

  -- um pedido real recente do NEO (o CNPJ não sai do banco: fica só na transação desfeita)
  select n.cnpj, (n.cadastro at time zone 'America/Sao_Paulo')::date as dia into p
    from public.producao_pedidos_neo n
   where n.cnpj ~ '^[0-9]{14}$' and n.numero_pedido is not null
     and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)') and n.cadastro > now() - interval '20 days'
   order by n.cadastro desc limit 1;
  if p.cnpj is null then raise exception 'RESULTADO: sem pedido recente no NEO para testar'; end if;
  insert into public.vendas_marcadas (consultor_id, origem, cnpj, receita, dia) values (v_cons, 'discador', p.cnpj, 100, p.dia) returning id into v_id;
  insert into public.vendas_marcadas (consultor_id, origem, cnpj, receita, dia, marcada_em)
  values (v_cons, 'discador', '11222333000181', 100, public.tv_hoje() - 10, now() - interval '10 days') returning id into v_id2;
  perform public.vendas_conferir_neo();
  select neo_status into v_st from public.vendas_marcadas where id = v_id;
  if v_st <> 'confirmada' or (select neo_pedido from public.vendas_marcadas where id = v_id) is null then raise exception 'FALHOU: pedido do NEO não confirmou (%)', v_st; end if;
  select neo_status into v_st from public.vendas_marcadas where id = v_id2;
  if v_st <> 'nao_encontrada' then raise exception 'FALHOU: prazo vencido ficou %', v_st; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.tv_conferencia(); raise exception 'FALHOU: consultor viu a conferência'; exception when sqlstate '42501' then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  r := public.tv_conferencia();
  if not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id2 and x ->> 'aviso' like 'Sem pedido%') then
    raise exception 'FALHOU: não encontrada fora da lista';
  end if;
  begin perform public.vendas_conferencia_decidir(v_id2, 'ok', 'x'); raise exception 'FALHOU: motivo curto'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_conferencia_decidir(v_id2, 'talvez', 'motivo bom'); raise exception 'FALHOU: ação inválida'; exception when sqlstate '22023' then null; end;
  perform public.vendas_conferencia_decidir(v_id2, 'ok', 'cliente fechou depois');
  if (select neo_status from public.vendas_marcadas where id = v_id2) <> 'ok_gestor' then raise exception 'FALHOU: ok do gestor'; end if;
  if exists (select 1 from jsonb_array_elements(public.tv_conferencia()) x where (x ->> 'id')::bigint = v_id2) then raise exception 'FALHOU: decidida continua na lista'; end if;
  update public.vendas_marcadas set neo_status = 'nao_encontrada', neo_obs = null where id = v_id2;
  perform public.vendas_conferencia_decidir(v_id2, 'cancelar', 'marcou errado');
  if (select cancelada_em from public.vendas_marcadas where id = v_id2) is null then raise exception 'FALHOU: cancelar pela conferência'; end if;

  if not exists (select 1 from cron.job where jobname = 'tv-vendas-conferir-neo') then raise exception 'FALHOU: cron não agendado'; end if;
  raise exception 'RESULTADO: ok (vendas % e %)', v_id, v_id2;
end $$;
