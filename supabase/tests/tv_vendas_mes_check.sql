-- §149.1: conferência da migration 20261112180000 (Mês com as vendas da NEO antes de a TV existir, 12/11/2026).
-- Roda com o corpo da migration; o DO termina com exceção de propósito (desfaz tudo).
do $$
declare v_sup uuid; r jsonb; v_neo int; l jsonb; v_pos int; v_max bigint;
  v_ini date := date_trunc('month', public.tv_hoje())::date;
begin
  select id into v_sup from public.profiles where role = 'admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);

  -- 1) Mês: as vendas antes de 12/11 vêm da NEO (pedidos de consultores da Apex, sem perdido/devolvido)
  select count(distinct n.numero_pedido) into v_neo
    from public.producao_pedidos_neo n
    join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
    join public.profiles p on p.id = c.profile_id and coalesce(p.operacao, 'apex') = 'apex'
   where n.cadastro >= (v_ini::timestamp at time zone 'America/Sao_Paulo')
     and n.cadastro < (least(public.tv_hoje() + 1, date '2026-11-12')::timestamp at time zone 'America/Sao_Paulo')
     and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)') and n.numero_pedido is not null;
  r := public.tv_ranking('mes');
  if (r -> 'totais' ->> 'vendas')::int < v_neo then
    raise exception 'FALHOU: Mês com % vendas, NEO antes de 12/11 tem %', r -> 'totais' ->> 'vendas', v_neo;
  end if;
  r := public.tv_ranking('hoje');
  if (r -> 'totais' ->> 'vendas')::int <> (select count(*) from public.vendas_marcadas where operacao = 'apex' and cancelada_em is null and dia = public.tv_hoje()) then
    raise exception 'FALHOU: Hoje não pode puxar NEO (veio %)', r -> 'totais' ->> 'vendas';
  end if;

  -- 2) posição do VENDEU! = posição do ranking do Mês (mesma conta de vendas)
  r := public.tv_ranking('mes');
  select max(id) into v_max from public.vendas_marcadas;
  for l in select x from jsonb_array_elements(r -> 'linhas') x where (x ->> 'posicao') is not null loop
    v_pos := public.tv_posicao_mes((l ->> 'profile_id')::uuid, coalesce(v_max, 0), v_ini, public.tv_hoje());
    if v_pos is distinct from (l ->> 'posicao')::int then
      raise exception 'FALHOU: posição do VENDEU! (%) ≠ ranking do Mês (%)', v_pos, l ->> 'posicao';
    end if;
  end loop;

  raise exception 'RESULTADO: ok (NEO antes de 12/11: % pedidos; Mês com % vendas)', v_neo, r -> 'totais' ->> 'vendas';
end $$;
