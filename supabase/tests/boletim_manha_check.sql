-- Verificação de 20261008100000_boletim_manha.sql (§76). Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis fictícios (zz*).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.bmsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.bmcons@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000b001', 'Zzbmsup Teste',  'zz.bmsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000b002', 'Zzbmcons Teste', 'zz.bmcons', 'consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

do $$
declare
  n int; j jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_id bigint; v_id_antigo bigint; v_status text;
  v_desf text; v_rec numeric;
begin
  -- dia útil (mesma regra do painel)
  assert public.boletim_dia_util('2026-10-08'), 'quinta comum é dia útil';
  assert not public.boletim_dia_util('2026-10-10'), 'sábado não é dia útil';
  assert not public.boletim_dia_util('2026-10-12'), '12/10 é feriado';
  assert not public.boletim_dia_util('2026-04-03'), 'sexta-feira santa 2026';
  assert not public.boletim_dia_util('2026-06-04'), 'corpus christi 2026';

  -- a função única dá o mesmo resultado da expressão antiga em todas as linhas
  select count(*) into n from public.producao_pedidos_neo x
   where public.producao_na_etapa_desde(x.numero_pedido, x.etapa, x.atualizacao) is distinct from
         coalesce((select max(h.em) from public.producao_etapa_historico h where h.numero_pedido = x.numero_pedido and h.etapa_nova = x.etapa), x.atualizacao);
  assert n = 0, 'producao_na_etapa_desde diverge da expressão antiga em ' || n || ' linhas';

  -- retratos antigos fictícios para testar "só o plano mais recente" (como postgres, antes de trocar de papel)
  insert into public.boletim_retratos (dia, periodo_de, periodo_ate, retrato, gerado_por)
    values ('2000-01-04', '2000-01-03', '2000-01-03', '{"versao":1}', '00000000-0000-0000-0000-00000000b001');
  insert into public.boletim_acoes (dia, ordem, regra, chave, quem, o_que, valor, prazo)
    values ('2000-01-04', 1, 'destaque', 'zz-antigo', 'Supervisão', 'teste', 0, 'hoje') returning id into v_id_antigo;

  execute 'set local role authenticated';

  -- consultor: tudo recusado com 42501, e nada visível
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b002', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b002', true);
  select count(*) into n from public.boletim_retratos; assert n = 0, 'consultor não lê boletim_retratos';
  select count(*) into n from public.boletim_acoes; assert n = 0, 'consultor não lê boletim_acoes';
  begin perform public.boletim_pedidos(); assert false, 'consultor chamou boletim_pedidos';
  exception when sqlstate '42501' then null; end;
  begin perform public.boletim_obter(null, null); assert false, 'consultor chamou boletim_obter';
  exception when sqlstate '42501' then null; end;
  begin perform public.boletim_marcar_acao(v_id_antigo, 'feita', null); assert false, 'consultor marcou ação';
  exception when sqlstate '42501' then null; end;
  begin perform public.boletim_resolver_acoes('[]'); assert false, 'consultor resolveu ação';
  exception when sqlstate '42501' then null; end;
  begin perform public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":1}', '[]'); assert false, 'consultor gravou';
  exception when sqlstate '42501' then null; end;
  begin insert into public.boletim_retratos (dia, periodo_de, periodo_ate, retrato, gerado_por) values ('2000-02-01', '2000-01-31', '2000-01-31', '{}', auth.uid());
    assert false, 'escrita direta em boletim_retratos';
  exception when insufficient_privilege then null; end;

  -- supervisor
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b001', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b001', true);
  select count(*) into n from public.boletim_retratos where dia = '2000-01-04'; assert n = 1, 'supervisor lê boletim_retratos';
  perform public.boletim_pedidos();
  perform public.mesa_pendencias(v_hoje);
  begin update public.boletim_acoes set status = 'feita' where id = v_id_antigo; get diagnostics n = row_count;
    assert n = 0, 'update direto em boletim_acoes';
  exception when insufficient_privilege then null; end;
  -- dia diferente de hoje é recusado
  begin perform public.boletim_gravar(v_hoje - 1, v_hoje - 2, v_hoje - 2, '{"versao":1}', '[]'); assert false, 'gravou dia diferente de hoje';
  exception when sqlstate '22023' then null; end;

  if public.boletim_dia_util(v_hoje) and not exists (select 1 from public.boletim_retratos where dia = v_hoje) then
    -- antes da hora configurada: recusa (config é só do admin; troca como postgres e volta)
    execute 'reset role';
    update public.config set valor = (coalesce(valor::jsonb, '{}'::jsonb) || '{"hora":"23:59"}')::text where chave = 'boletim';
    execute 'set local role authenticated';
    if (now() at time zone 'America/Sao_Paulo')::time < time '23:59' then
      begin perform public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":1}', '[]'); assert false, 'gravou antes da hora';
      exception when sqlstate '22023' then null; end;
    end if;
    execute 'reset role';
    update public.config set valor = (coalesce(valor::jsonb, '{}'::jsonb) || '{"hora":"00:00"}')::text where chave = 'boletim';
    execute 'set local role authenticated';
    -- grava com 2 ações; a 2ª chamada (outra pessoa) não muda nada: primeiro ganha
    j := public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":1,"marca":"primeiro"}',
      '[{"ordem":1,"regra":"pedido_grande_parado","chave":"ZZ1","quem":"Zz","o_que":"Acionar","valor":200,"prazo":"hoje","extra":{"numero":"ZZ1"}},
        {"ordem":2,"regra":"destaque","chave":"maior-contrato","quem":"Supervisão","o_que":"Parabenizar","valor":0,"prazo":"hoje"}]');
    assert (j ->> 'gravou')::boolean, 'primeira gravação grava';
    assert jsonb_array_length(j -> 'acoes') = 2, 'duas ações gravadas';
    j := public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":1,"marca":"segundo"}',
      '[{"ordem":1,"regra":"destaque","chave":"x","quem":"S","o_que":"x","valor":0,"prazo":"hoje"}]');
    assert not (j ->> 'gravou')::boolean, 'segunda gravação não grava';
    assert j -> 'retrato' ->> 'marca' = 'primeiro', 'devolve o retrato do primeiro';
    assert jsonb_array_length(j -> 'acoes') = 2, 'ações do segundo não entram';
    assert j ->> 'gerado_por_nome' = 'Zzbmsup Teste', 'nome de quem gerou';

    select id into v_id from public.boletim_acoes where dia = v_hoje and chave = 'ZZ1';
    -- marcar: status inválido, plano antigo, feita com nota, desfazer
    begin perform public.boletim_marcar_acao(v_id, 'xyz', null); assert false, 'aceitou status inválido';
    exception when sqlstate '22023' then null; end;
    begin perform public.boletim_marcar_acao(v_id_antigo, 'feita', null); assert false, 'marcou ação de plano antigo';
    exception when sqlstate '22023' then null; end;
    perform public.boletim_marcar_acao(v_id, 'feita', '  cliente assinou  ');
    j := public.boletim_obter(v_hoje, null);
    assert (select x ->> 'status' from jsonb_array_elements(j -> 'acoes') x where (x ->> 'id')::bigint = v_id) = 'feita', 'marcou feita';
    assert (select x ->> 'nota' from jsonb_array_elements(j -> 'acoes') x where (x ->> 'id')::bigint = v_id) = 'cliente assinou', 'nota sem espaços';
    assert (select x ->> 'marcado_por_nome' from jsonb_array_elements(j -> 'acoes') x where (x ->> 'id')::bigint = v_id) = 'Zzbmsup Teste', 'quem marcou';
    perform public.boletim_marcar_acao(v_id, 'aberta', null);
    select status into v_status from public.boletim_acoes where id = v_id; assert v_status = 'aberta', 'desfazer volta a aberta';

    -- resolver não sobrescreve
    perform public.boletim_resolver_acoes(jsonb_build_array(jsonb_build_object('id', v_id, 'desfecho', 'avancou', 'valor_recuperado', 200)));
    perform public.boletim_resolver_acoes(jsonb_build_array(jsonb_build_object('id', v_id, 'desfecho', 'perdeu', 'valor_recuperado', 0)));
    select desfecho, valor_recuperado into v_desf, v_rec from public.boletim_acoes where id = v_id;
    assert v_desf = 'avancou' and v_rec = 200, 'resolver não sobrescreve';

    -- p_antes devolve o mais recente antes do dia
    j := public.boletim_obter(null, v_hoje);
    assert j ->> 'dia' = '2000-01-04', 'boletim anterior a hoje';
  end if;
end $$;
rollback;
