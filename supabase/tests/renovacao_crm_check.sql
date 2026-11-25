-- Verificação da migration 20261125150000 (§165). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f711', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r3a@teste.invalid'),
('00000000-0000-0000-0000-00000000f712', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r3adm@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f711', 'Zzr3a Teste', 'zz.r3a', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f712', 'Zzr3adm Teste', 'zz.r3adm', 'admin', 'apex', null)
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;

do $$
declare r record; res jsonb; v_c uuid := '00000000-0000-0000-0000-00000000f711'; v_adm uuid := '00000000-0000-0000-0000-00000000f712'; v_id bigint;
begin
  -- prioridade (REGRAS §165)
  assert public.renovacao_prioridade('APTO', true, 300, false) = 'P1', 'P1';
  assert public.renovacao_prioridade('1 MÊS PARA APTO', true, 299.99, true) = 'P2', 'P2 fixa viável';
  assert public.renovacao_prioridade('2 MESES PARA APTO', false, 500, true) = 'P2', 'P2 fatura';
  assert public.renovacao_prioridade('APTO', false, 100, false) = 'P3', 'P3';
  assert public.renovacao_prioridade('NÃO APTO', true, 900, false) = 'P4', 'P4';
  assert public.renovacao_prioridade('NÃO APTO', true, 900, true) = 'P5', 'não apto com fixa hoje é P5';
  assert public.renovacao_prioridade('INATIVO', false, 900, false) = 'P5', 'P5';
  -- estágio das propostas
  assert public.renovacao_estagio(0) = 'proposta_enviada' and public.renovacao_estagio(4) = 'proposta_enviada'
     and public.renovacao_estagio(5) = 'negociacao' and public.renovacao_estagio(6) = 'fechado_ganho'
     and public.renovacao_estagio(7) = 'fechado_ganho' and public.renovacao_estagio(8) = 'fechado_perdido'
     and public.renovacao_estagio(9) = 'fechado_perdido', 'mapa status → estágio';

  -- importação (admin): novo entra; SAIU entra fora da base
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_adm::text, true);
  res := public.renovacao_importar(jsonb_build_array(
    jsonb_build_object('cnpj_digits', '00000000000301', 'razao_social', 'Zz Tres Um', 'apto', 'APTO', 'consultor_id', v_c, 'status', 0,
                       'fatura', 450, 'fixa_viavel', true, 'tem_fixa', false, 'movimentacao', 'NOVO 25/11', 'oportunidade', 'Renovação + Fixa'),
    jsonb_build_object('cnpj_digits', '00000000000302', 'razao_social', 'Zz Tres Dois', 'apto', 'NÃO APTO', 'consultor_id', v_c, 'status', 1,
                       'tentativas', 2, 'data_contato', '2026-10-02', 'fatura', 100, 'movimentacao', 'Permanece'),
    jsonb_build_object('cnpj_digits', '00000000000303', 'razao_social', 'Zz Tres Tres', 'apto', 'APTO', 'consultor_id', v_c, 'status', 0,
                       'movimentacao', 'SAIU da base 25/11')));
  assert (res->>'novos')::int = 3 and (res->>'sairam')::int = 1, 'importação: ' || res::text;
  assert (select prioridade from public.renovacao_carteira where cnpj_digits = '00000000000301') = 'P1', 'prioridade gravada na importação';
  assert not (select na_base from public.renovacao_carteira where cnpj_digits = '00000000000303'), 'SAIU fica fora da carteira ativa';
  assert (select primeiro_contato from public.renovacao_carteira where cnpj_digits = '00000000000302') = date '2026-10-02', '1º contato preenchido';

  -- reimportar: o painel prevalece sobre a planilha quando o cliente já foi trabalhado; quem estava em 0 adota a planilha
  select id into v_id from public.renovacao_carteira where cnpj_digits = '00000000000302';
  update public.renovacao_carteira set status = 2, observacoes = 'Zz do painel' where id = v_id;
  res := public.renovacao_importar(jsonb_build_array(
    jsonb_build_object('cnpj_digits', '00000000000302', 'razao_social', 'Zz Tres Dois', 'apto', 'APTO', 'consultor_id', v_c, 'status', 1,
                       'tentativas', 9, 'observacoes', 'Zz da planilha', 'movimentacao', 'Permanece'),
    jsonb_build_object('cnpj_digits', '00000000000301', 'razao_social', 'Zz Tres Um', 'apto', 'APTO', 'consultor_id', v_c, 'status', 1,
                       'tentativas', 3, 'data_contato', '2026-10-05', 'fatura', 450, 'fixa_viavel', true)));
  select * into r from public.renovacao_carteira where id = v_id;
  assert r.status = 2 and r.tentativas = 2 and r.observacoes = 'Zz do painel' and r.apto = 'APTO', 'painel prevalece: ' || row_to_json(r)::text;
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000301';
  assert r.status = 1 and r.tentativas = 3, 'em 0 adota a planilha: ' || row_to_json(r)::text;

  -- regras do atendimento (consultor)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);
  begin
    update public.renovacao_carteira set status = 8 where cnpj_digits = '00000000000301';
    assert false, 'Perdido sem motivo passou';
  exception when check_violation then null; end;
  begin
    update public.renovacao_carteira set status = 6 where cnpj_digits = '00000000000301';
    assert false, 'Ganho sem linhas passou';
  exception when check_violation then null; end;
  begin
    update public.renovacao_carteira set fatura = 1 where cnpj_digits = '00000000000301';
    assert false, 'consultor mexeu na fatura';
  exception when insufficient_privilege then null; end;
  update public.renovacao_carteira set status = 6, linhas_renovadas = 4, valor_proposta = 800 where cnpj_digits = '00000000000301';
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000301';
  assert r.data_fechamento = (now() at time zone 'America/Sao_Paulo')::date, 'data de fechamento automática';
  update public.renovacao_carteira set status = 8, motivo_perda = 'Preço' where cnpj_digits = '00000000000301';
  update public.renovacao_carteira set status = 9 where cnpj_digits = '00000000000302';

  -- resumo
  select * into r from public.renovacao_resumo where consultor_id = v_c;
  assert r.carteira = 2 and r.perdidos = 1 and r.desqualificados = 1, 'resumo: ' || row_to_json(r)::text;
  execute 'reset role';
end $$;

rollback;
