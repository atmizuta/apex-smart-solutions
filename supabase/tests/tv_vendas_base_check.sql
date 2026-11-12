-- §149: conferência da migration 20261112150000 (roda junto com o corpo dela; o DO termina com exceção de propósito).
do $$
declare v_cons uuid; v_sup uuid; v_camp uuid; r jsonb; v_id bigint; v_id2 bigint; n record; v_t text;
  um_plano jsonb := '[{"plano_id":"p57-100","gb":100,"valor_linha":94.99,"linhas":5}]';
begin
  select id into v_cons from public.profiles where role = 'consultor' and coalesce(operacao, 'apex') = 'apex' limit 1;
  select id into v_sup from public.profiles where role = 'admin' limit 1;
  select id into v_camp from public.profiles where coalesce(operacao, 'apex') = 'campinas' limit 1;

  -- itens: soma e validação
  select * into n from public.vendas_itens_normalizar('[{"plano_id":"p57-100","gb":100,"valor_linha":94.99,"linhas":5},{"plano_id":"p57-40","gb":40,"valor_linha":59.99,"linhas":2}]');
  if n.receita <> 594.93 or n.linhas <> 7 or jsonb_array_length(n.itens) <> 2 then raise exception 'FALHOU: soma dos itens (% / %)', n.receita, n.linhas; end if;
  begin perform public.vendas_itens_normalizar('[]'); raise exception 'FALHOU: lista vazia passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_itens_normalizar('[{"plano_id":"x","valor_linha":94.99,"linhas":0}]'); raise exception 'FALHOU: 0 linhas passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_itens_normalizar('[{"plano_id":"x","valor_linha":9.99,"linhas":1}]'); raise exception 'FALHOU: valor baixo passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_itens_normalizar('[{"plano_id":"x","valor_linha":"abc","linhas":1}]'); raise exception 'FALHOU: valor texto passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_itens_normalizar('[{"plano_id":"","valor_linha":50,"linhas":1}]'); raise exception 'FALHOU: sem plano passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendas_itens_normalizar('[{"plano_id":"a","valor_linha":50,"linhas":200},{"plano_id":"b","valor_linha":50,"linhas":101}]'); raise exception 'FALHOU: 301 linhas passou'; exception when sqlstate '22023' then null; end;

  -- consultor da Apex marca
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  r := public.vendi('11.222.333/0001-81', um_plano, 'discador');
  v_id := (r ->> 'id')::bigint;
  if (r ->> 'receita')::numeric <> 474.95 or (r ->> 'linhas')::int <> 5 then raise exception 'FALHOU: retorno do vendi %', r; end if;
  select cnpj into v_t from public.vendas_marcadas where id = v_id;
  if v_t <> '11222333000181' then raise exception 'FALHOU: CNPJ gravado com máscara (%)', v_t; end if;
  r := public.vendi('11222333000181', um_plano, 'renovacao');
  v_id2 := (r ->> 'id')::bigint;
  if coalesce(r ->> 'aviso', '') not like 'Você já marcou este CNPJ hoje às%' then raise exception 'FALHOU: aviso do CNPJ repetido (%)', r ->> 'aviso'; end if;
  begin perform public.vendi('11222333000180', um_plano, 'discador'); raise exception 'FALHOU: DV errado passou'; exception when sqlstate '22023' then null; end;
  begin perform public.vendi('11222333000181', um_plano, 'lead'); raise exception 'FALHOU: origem lead pelo Vendi!'; exception when sqlstate '22023' then null; end;

  -- desfazer: dono em até 10 min, sem motivo
  perform public.vendi_cancelar(v_id, null);
  select motivo_cancel into v_t from public.vendas_marcadas where id = v_id and cancelada_em is not null;
  if v_t is distinct from 'desfeito pelo consultor' then raise exception 'FALHOU: desfazer do dono (%)', v_t; end if;
  begin perform public.vendi_cancelar(v_id, null); raise exception 'FALHOU: cancelou duas vezes'; exception when sqlstate '22023' then null; end;
  update public.vendas_marcadas set marcada_em = now() - interval '11 minutes' where id = v_id2;
  begin perform public.vendi_cancelar(v_id2, null); raise exception 'FALHOU: dono cancelou depois de 10 min'; exception when sqlstate '42501' then null; end;

  -- gestor cancela qualquer uma, com motivo
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  if not public.tv_eh_gestor() then raise exception 'FALHOU: admin não é gestor'; end if;
  begin perform public.vendi_cancelar(v_id2, ''); raise exception 'FALHOU: gestor sem motivo'; exception when sqlstate '22023' then null; end;
  perform public.vendi_cancelar(v_id2, 'teste do gestor');

  -- Campinas não marca
  if v_camp is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_camp, 'role', 'authenticated')::text, true);
    begin perform public.vendi('11222333000181', um_plano, 'discador'); raise exception 'FALHOU: Campinas marcou'; exception when sqlstate '42501' then null; end;
    if public.tv_eh_gestor() then raise exception 'FALHOU: Campinas é gestor da TV'; end if;
  end if;
  -- sem login
  perform set_config('request.jwt.claims', '', true);
  begin perform public.vendi('11222333000181', um_plano, 'discador'); raise exception 'FALHOU: sem login marcou'; exception when sqlstate '42501' then null; end;

  raise exception 'RESULTADO: ok (consultor %, vendas % e %)', left(v_cons::text, 8), v_id, v_id2;
end $$;
