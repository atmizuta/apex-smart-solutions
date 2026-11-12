-- §149: conferência da migration 20261112150200 (roda com 150000 + 150200; termina com exceção de propósito).
do $$
declare l record; l2 record; v record; v_n int; v_rec numeric;
begin
  select le.aba, le.id, le.dono_id into l from public.leads le join public.profiles p on p.id = le.dono_id
   where le.apagado_em is null and coalesce(le.categoria, '') <> 'convertido' and coalesce(p.operacao, 'apex') = 'apex'
     and public.leads_cnpj_valido(regexp_replace(coalesce(le.cnpj, ''), '[^0-9]', '', 'g'))
   limit 1;
  if l.id is null then raise exception 'RESULTADO: sem lead com CNPJ válido para testar'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', l.dono_id, 'role', 'authenticated')::text, true);

  perform public.leads_classificar(l.aba, l.id, 'PEDIDO CONCLUIDO (VENDA)', 'teste §149', true, 321.50, null);
  select * into v from public.vendas_marcadas where lead_aba = l.aba and lead_id = l.id and cancelada_em is null;
  if v.id is null then raise exception 'FALHOU: gatilho não criou a venda'; end if;
  if v.receita <> 321.50 or v.origem <> 'lead' or v.consultor_id <> l.dono_id or v.cnpj is null then
    raise exception 'FALHOU: venda do lead % / % / % / %', v.receita, v.origem, v.consultor_id, v.cnpj;
  end if;

  perform public.venda_itens_lead(l.aba, l.id, '[{"plano_id":"p57-70","gb":70,"valor_linha":79.99,"linhas":4}]');
  select linhas, receita into v_n, v_rec from public.vendas_marcadas where id = v.id;
  if v_n <> 4 or v_rec <> 321.50 then raise exception 'FALHOU: itens (% linhas, receita %)', v_n, v_rec; end if;

  -- salvar de novo como venda não duplica; receita acompanha
  perform public.leads_classificar(l.aba, l.id, 'PEDIDO CONCLUIDO (VENDA)', 'teste §149 2', true, 400, null);
  select count(*) into v_n from public.vendas_marcadas where lead_aba = l.aba and lead_id = l.id and cancelada_em is null;
  if v_n <> 1 then raise exception 'FALHOU: duplicou (%)', v_n; end if;
  if (select receita from public.vendas_marcadas where id = v.id) <> 400 then raise exception 'FALHOU: receita não acompanhou'; end if;

  begin perform public.vendi_cancelar(v.id, null); raise exception 'FALHOU: vendi_cancelar tirou venda de lead'; exception when sqlstate '22023' then null; end;

  -- sair de venda cancela; voltar cria outra
  perform public.leads_classificar(l.aba, l.id, 'EM NEGOCIAÇÂO', 'voltou', false, null, null);
  if (select cancelada_em from public.vendas_marcadas where id = v.id) is null then raise exception 'FALHOU: sair de venda não cancelou'; end if;
  -- now() é o mesmo na transação inteira: recua o classificado_em para simular outra classificação (outra transação)
  update public.leads set classificado_em = classificado_em - interval '1 minute' where aba = l.aba and id = l.id;
  perform public.leads_classificar(l.aba, l.id, 'PEDIDO CONCLUIDO (VENDA)', 'de novo', true, 100, null);
  select count(*) into v_n from public.vendas_marcadas where lead_aba = l.aba and lead_id = l.id;
  if v_n <> 2 then raise exception 'FALHOU: voltar a ser venda (% linhas)', v_n; end if;

  -- apagar o lead cancela
  update public.leads set apagado_em = now() where aba = l.aba and id = l.id;
  select count(*) into v_n from public.vendas_marcadas where lead_aba = l.aba and lead_id = l.id and cancelada_em is null;
  if v_n <> 0 then raise exception 'FALHOU: lead apagado com venda ativa'; end if;

  -- lead com CNPJ ruim: venda entra com cnpj nulo
  select le.aba, le.id, le.dono_id into l2 from public.leads le join public.profiles p on p.id = le.dono_id
   where le.apagado_em is null and coalesce(le.categoria, '') <> 'convertido' and coalesce(p.operacao, 'apex') = 'apex'
     and not public.leads_cnpj_valido(regexp_replace(coalesce(le.cnpj, ''), '[^0-9]', '', 'g'))
   limit 1;
  if l2.id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', l2.dono_id, 'role', 'authenticated')::text, true);
    perform public.leads_classificar(l2.aba, l2.id, 'PEDIDO CONCLUIDO (VENDA)', 'teste cnpj ruim', true, 50, null);
    select * into v from public.vendas_marcadas where lead_aba = l2.aba and lead_id = l2.id and cancelada_em is null;
    if v.id is null or v.cnpj is not null then raise exception 'FALHOU: lead com CNPJ ruim (id %, cnpj %)', v.id, v.cnpj; end if;
  end if;

  -- outro consultor não mexe nos itens
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where role = 'consultor' and id <> l.dono_id limit 1), 'role', 'authenticated')::text, true);
  begin perform public.venda_itens_lead(l.aba, l.id, '[{"plano_id":"x","valor_linha":50,"linhas":1}]'); raise exception 'FALHOU: outro consultor mexeu'; exception when sqlstate '42501' then null; end;

  raise exception 'RESULTADO: ok (lead %|%, cnpj ruim testado: %)', l.aba, left(l.id, 6), l2.id is not null;
end $$;
