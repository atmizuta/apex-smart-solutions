-- §149.3: conferência da migration 20261113140000 (META uma vez por tela). Roda com o corpo da migration; termina com
-- exceção de propósito (desfaz tudo).
do $$
declare v_adm uuid; r jsonb;
begin
  select id into v_adm from public.profiles where role = 'admin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  -- meta 1 e uma venda hoje: a meta está batida
  perform public.tv_meta_definir(1);
  delete from public.tv_meta_tela where dia = public.tv_hoje();
  update public.tv_meta_dia set comemorada_em = null where dia = public.tv_hoje();
  perform public.vendi('11222333000181', '[{"plano_id":"p57-100","gb":100,"valor_linha":94.99,"linhas":5}]', 'discador');
  r := public.tv_meta_comemorar('tv-sala-teste1');
  if not (r ->> 'comemorar')::boolean then raise exception 'FALHOU: 1ª tela não comemorou %', r; end if;
  r := public.tv_meta_comemorar('tv-sala-teste1');
  if (r ->> 'comemorar')::boolean then raise exception 'FALHOU: mesma tela comemorou duas vezes'; end if;
  r := public.tv_meta_comemorar('tv-mesa-teste2');
  if not (r ->> 'comemorar')::boolean then raise exception 'FALHOU: 2ª tela não comemorou (a 1ª gastou)'; end if;
  begin perform public.tv_meta_comemorar('X'); raise exception 'FALHOU: tela inválida passou'; exception when sqlstate '22023' then null; end;
  if (select comemorada_em from public.tv_meta_dia where dia = public.tv_hoje()) is null then raise exception 'FALHOU: registro do dia'; end if;
  raise exception 'RESULTADO: ok';
end $$;
