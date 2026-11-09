-- Verificação da migration 20261109150000 (§143.2). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f611', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r2a@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f611', 'Zzr2a Teste', 'zz.r2a', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id, status, status_desde) values
('00000000000201', 'Zz Dois Um',   '00000000-0000-0000-0000-00000000f611', 5, now() - interval '5 days'),
('00000000000202', 'Zz Dois Dois', '00000000-0000-0000-0000-00000000f611', 2, now() - interval '5 days'),
('00000000000203', 'Zz Dois Tres', '00000000-0000-0000-0000-00000000f611', 3, now() - interval '5 days');
insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id) values
('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'negociacao', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'fechado_perdido', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-00000000f611', 'Zz Dois Dois', '00.000.000/0002-02', 'renovacao', 'base', 'lead', now(), now(), now(), null),
('00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-00000000f611', 'Zz Fora', '00.000.000/0009-99', 'portabilidade', 'avulsa', 'proposta_enviada', now(), now(), now(), null);

do $$
declare n int; r record; v_201 bigint; v_202 bigint; v_203 bigint;
  v_a uuid := '00000000-0000-0000-0000-00000000f611';
begin
  select id into v_201 from public.renovacao_carteira where cnpj_digits = '00000000000201';
  select id into v_202 from public.renovacao_carteira where cnpj_digits = '00000000000202';
  select id into v_203 from public.renovacao_carteira where cnpj_digits = '00000000000203';
  assert public.renovacao_estagio(1) = 'proposta_enviada' and public.renovacao_estagio(4) = 'proposta_enviada'
     and public.renovacao_estagio(5) = 'negociacao' and public.renovacao_estagio(6) = 'fechado_ganho'
     and public.renovacao_estagio(7) = 'fechado_perdido', 'mapa status → estágio';

  -- ligar (só carteira_id muda) não recalcula o estágio: a fechada continua fechada
  update public.propostas set carteira_id = v_201 where id in ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0002');
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0002') = 'fechado_perdido', 'ligar não reabre a fechada';
  -- ligar propostas antigas pelo CNPJ não muda o estágio
  n := public.renovacao_ligar_propostas();
  assert n = 1, 'só a proposta fictícia sem ligação casa, veio ' || n;
  select * into r from public.propostas where id = '00000000-0000-0000-0000-0000000a0003';
  assert r.carteira_id = v_202 and r.estagio = 'lead', 'ligada sem mudar estágio: ' || row_to_json(r)::text;
  assert (select carteira_id from public.propostas where id = '00000000-0000-0000-0000-0000000a0004') is null, 'CNPJ fora da carteira fica sem ligação';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  -- proposta nova ligada nasce no estágio que a carteira manda (201 está em 5)
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0005', v_a, 'Zz Dois Um', '00.000.000/0002-01', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), v_201);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0005') = 'negociacao', 'nova proposta segue a carteira';

  -- mudar o estágio de proposta ligada por fora é recalculado
  update public.propostas set estagio = 'lead' where id = '00000000-0000-0000-0000-0000000a0001';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0001') = 'negociacao', 'estágio ligado não muda por fora';
  -- proposta sem ligação continua livre (funil antigo)
  update public.propostas set estagio = 'negociacao' where id = '00000000-0000-0000-0000-0000000a0004';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0004') = 'negociacao', 'funil antigo segue livre';

  -- status 5 → 6 fecha as abertas, com histórico; a fechada antiga não muda
  update public.renovacao_carteira set status = 6, linhas_renovadas = 3 where id = v_201;
  assert (select count(*) from public.propostas where carteira_id = v_201 and estagio = 'fechado_ganho') = 2, 'abertas viraram ganho';
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0002') = 'fechado_perdido', 'fechada antiga intocada';
  select count(*) into n from public.propostas_historico h
   where h.proposta_id in ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0005')
     and h.estagio_anterior = 'negociacao' and h.estagio_novo = 'fechado_ganho' and h.user_id = v_a and h.nota like 'Renovação:%';
  assert n = 2, 'histórico da sincronização, veio ' || n;
  assert (select status_desde from public.renovacao_carteira where id = v_201) = now(), 'status_desde muda com o status';

  -- status_desde não muda sem mudar status, nem por escrita direta
  update public.renovacao_carteira set observacoes = 'Zz obs', status_desde = now() - interval '1 day' where id = v_202;
  assert (select status_desde from public.renovacao_carteira where id = v_202) < now() - interval '4 days', 'status_desde intocado sem mudar status';

  -- perdido copia o motivo; reabrir não reabre a fechada; proposta nova nasce em negociação
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0006', v_a, 'Zz Dois Tres', '00.000.000/0002-03', 'renovacao', 'base', 'lead', now(), now(), now(), v_203);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0006') = 'proposta_enviada', 'status 3 → proposta_enviada';
  update public.renovacao_carteira set status = 7, motivo_perda = 'Preço' where id = v_203;
  select * into r from public.propostas where id = '00000000-0000-0000-0000-0000000a0006';
  assert r.estagio = 'fechado_perdido' and r.motivo_perda = 'Preço', 'perdido copia o motivo: ' || row_to_json(r)::text;
  update public.renovacao_carteira set status = 5 where id = v_203;
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0006') = 'fechado_perdido', 'reabrir não reabre a fechada';
  insert into public.propostas (id, consultor_id, cliente_nome, cliente_cnpj, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id)
  values ('00000000-0000-0000-0000-0000000a0007', v_a, 'Zz Dois Tres', '00.000.000/0002-03', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), v_203);
  assert (select estagio from public.propostas where id = '00000000-0000-0000-0000-0000000a0007') = 'negociacao', 'nova depois de reabrir nasce em negociação';

  -- funções internas não são chamáveis pela API
  begin
    perform public.renovacao_ligar_propostas();
    assert false, 'consultor chamou renovacao_ligar_propostas';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end $$;

rollback;
