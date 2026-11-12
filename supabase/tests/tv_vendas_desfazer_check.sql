-- §149.2: conferência da migration 20261112200000 (Desfazer sem motivo para quem marcou, em até 10 min, mesmo sendo
-- admin/supervisor; lista "Vendas de hoje" para o gestor). Roda com o corpo da migration; termina com exceção de propósito.
do $$
declare v_adm uuid; v_cons uuid; r jsonb; v_id bigint; v_id2 bigint; v_t text;
  um_plano jsonb := '[{"plano_id":"p57-100","gb":100,"valor_linha":94.99,"linhas":5}]';
begin
  select id into v_adm from public.profiles where role = 'admin' limit 1;
  select id into v_cons from public.profiles where role = 'consultor' and coalesce(operacao, 'apex') = 'apex' limit 1;

  -- admin marca e desfaz a própria venda em até 10 min, sem motivo
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  v_id := (public.vendi('11222333000181', um_plano, 'discador') ->> 'id')::bigint;
  perform public.vendi_cancelar(v_id, null);
  select motivo_cancel into v_t from public.vendas_marcadas where id = v_id and cancelada_em is not null;
  if v_t is distinct from 'desfeito pelo consultor' then raise exception 'FALHOU: admin não desfez a própria venda sem motivo (%)', v_t; end if;

  -- motivo opcional é guardado
  v_id := (public.vendi('11222333000181', um_plano, 'discador') ->> 'id')::bigint;
  perform public.vendi_cancelar(v_id, '  marquei errado ');
  if (select motivo_cancel from public.vendas_marcadas where id = v_id) <> 'marquei errado' then raise exception 'FALHOU: motivo não guardado'; end if;

  -- venda de outra pessoa: gestor precisa de motivo
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  v_id2 := (public.vendi('11444777000161', um_plano, 'renovacao') ->> 'id')::bigint;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  begin perform public.vendi_cancelar(v_id2, null); raise exception 'FALHOU: gestor cancelou venda de outro sem motivo'; exception when sqlstate '22023' then null; end;

  -- lista de hoje (gestor)
  r := public.tv_vendas_hoje();
  if not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id2 and x ->> 'origem' = 'renovacao' and (x ->> 'cancelada')::boolean = false) then
    raise exception 'FALHOU: venda de hoje fora da lista';
  end if;
  if not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'id')::bigint = v_id and (x ->> 'cancelada')::boolean and x ->> 'motivo' = 'marquei errado') then
    raise exception 'FALHOU: cancelada sem motivo na lista';
  end if;
  perform public.vendi_cancelar(v_id2, 'teste do gestor');

  -- consultor não vê a lista
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.tv_vendas_hoje(); raise exception 'FALHOU: consultor viu a lista'; exception when sqlstate '42501' then null; end;

  raise exception 'RESULTADO: ok (vendas % e %)', v_id, v_id2;
end $$;
