-- Verificação das migrations 20261107150000/150100 (§143.1, aba Renovação). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar em produção: rodar com execute_sql montando  begin; <corpo das migrations sem begin/commit>; <este arquivo sem o begin da linha 3>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.radm@teste.invalid'),
('00000000-0000-0000-0000-00000000f602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rsup@teste.invalid'),
('00000000-0000-0000-0000-00000000f603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ra@teste.invalid'),
('00000000-0000-0000-0000-00000000f604', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rb@teste.invalid'),
('00000000-0000-0000-0000-00000000f605', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.rag@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f601', 'Zzradm Teste', 'zz.radm', 'admin', 'apex', null),
('00000000-0000-0000-0000-00000000f602', 'Zzrsup Teste', 'zz.rsup', 'supervisor', 'apex', null),
('00000000-0000-0000-0000-00000000f603', 'Zzra Teste', 'zz.ra', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f604', 'Zzrb Teste', 'zz.rb', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f605', 'Zzrag Teste', 'zz.rag', 'agencia', 'apex', null)
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, linhas_voz, apto, cidade, consultor_id, status, linhas_renovadas, prox_retorno) values
('00000000000101', 'Zz Alfa',  10, 'APTO', 'Zz Cidade', '00000000-0000-0000-0000-00000000f603', 1, null, null),
('00000000000102', 'Zz Beta',   5, 'APTO', 'Zz Cidade', '00000000-0000-0000-0000-00000000f603', 2, null, (now() at time zone 'America/Sao_Paulo')::date - 3),
('00000000000103', 'Zz Gama',   3, '1 MÊS PARA APTO', 'Zz Outra', '00000000-0000-0000-0000-00000000f604', 3, null, null),
('00000000000104', 'Zz Delta',  8, 'APTO', 'Zz Outra', '00000000-0000-0000-0000-00000000f604', 6, 4, null);
-- legado da planilha: perdido sem motivo entra como "a completar"
insert into public.renovacao_carteira (cnpj_digits, razao_social, linhas_voz, consultor_id, status, a_completar) values
('00000000000105', 'Zz Legado', 2, '00000000-0000-0000-0000-00000000f604', 7, true);


do $$
declare n int; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; r record;
  v_a uuid := '00000000-0000-0000-0000-00000000f603'; v_b uuid := '00000000-0000-0000-0000-00000000f604';
  v_id101 bigint; v_id103 bigint; v_id105 bigint;
begin
  select id into v_id101 from public.renovacao_carteira where cnpj_digits = '00000000000101';
  select id into v_id103 from public.renovacao_carteira where cnpj_digits = '00000000000103';
  select id into v_id105 from public.renovacao_carteira where cnpj_digits = '00000000000105';
  -- insert sem a_completar que quebra a regra é recusado (dono do banco, sem auth)
  begin
    insert into public.renovacao_carteira (cnpj_digits, status) values ('00000000000106', 7);
    assert false, 'insert de perdido sem motivo passou';
  exception when check_violation then
    assert sqlerrm = 'Perdido precisa do motivo', 'mensagem: ' || sqlerrm;
  end;

  execute 'set local role authenticated';
  -- ===== Task 1: consultor A =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', (v_a)::text, true);
  select count(*) into n from public.renovacao_carteira;
  assert n = 2, 'consultor A vê só os 2 dele, viu ' || n;
  update public.renovacao_carteira set status = 3 where id = v_id101;
  select * into r from public.renovacao_carteira where id = v_id101;
  assert r.data_contato = v_hoje, 'data_contato preenchida ao sair do status 1';
  assert r.atualizado_por = v_a, 'atualizado_por gravado';
  assert exists (select 1 from public.renovacao_historico h where h.carteira_id = v_id101 and h.campo = 'status' and h.de = '1' and h.para = '3' and h.user_id = v_a), 'histórico 1→3';
  begin
    update public.renovacao_carteira set consultor_id = v_b where id = v_id101;
    assert false, 'consultor trocou o consultor';
  exception when insufficient_privilege then null; end;
  begin
    update public.renovacao_carteira set razao_social = 'Zz Hack' where id = v_id101;
    assert false, 'consultor mudou dado da Claro';
  exception when insufficient_privilege then null; end;
  begin
    update public.renovacao_carteira set a_completar = true where id = v_id101;
    select a_completar into r from public.renovacao_carteira where id = v_id101;
    assert not r.a_completar, 'consultor não liga a_completar';
  end;
  update public.renovacao_carteira set observacoes = 'Zz invasão' where id = v_id103;
  get diagnostics n = row_count;
  assert n = 0, 'consultor A não edita cliente do B';
  begin
    update public.renovacao_carteira set status = 7 where id = v_id101;
    assert false, 'perdido sem motivo passou';
  exception when check_violation then
    assert sqlerrm = 'Perdido precisa do motivo', 'mensagem: ' || sqlerrm;
  end;
  update public.renovacao_carteira set status = 7, motivo_perda = 'Preço' where id = v_id101;
  begin
    update public.renovacao_carteira set canal = 'Fax' where id = v_id101;
    assert false, 'canal fora da lista passou';
  exception when check_violation then null; end;
  begin
    update public.renovacao_carteira set status = 6 where cnpj_digits = '00000000000102';
    assert false, 'renovado sem linhas passou';
  exception when check_violation then
    assert sqlerrm = 'Renovado precisa das linhas renovadas', 'mensagem: ' || sqlerrm;
  end;
  update public.renovacao_carteira set status = 6, linhas_renovadas = 2 where cnpj_digits = '00000000000102';
  begin
    update public.profiles set equipe = null where id = v_a;
    assert false, 'consultor saiu da equipe sozinho';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.renovacao_carteira (cnpj_digits) values ('00000000000107');
    assert false, 'consultor inseriu na carteira';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.renovacao_resumo;
  assert n = 1, 'consultor vê só a própria linha do resumo';

  -- ===== Task 1: legado a completar (consultor B) =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', (v_b)::text, true);
  update public.renovacao_carteira set observacoes = 'Zz só obs' where id = v_id105;
  select * into r from public.renovacao_carteira where id = v_id105;
  assert r.a_completar and r.observacoes = 'Zz só obs', 'legado aceita editar só a observação';
  update public.renovacao_carteira set motivo_perda = 'Outro' where id = v_id105;
  select a_completar into r from public.renovacao_carteira where id = v_id105;
  assert not r.a_completar, 'completar o motivo tira a pendência';

  -- ===== Task 1: agência não vê nada =====
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f605', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000f605')::text, true);
  select count(*) into n from public.renovacao_carteira; assert n = 0, 'agência não vê carteira';
  select count(*) into n from public.renovacao_historico; assert n = 0, 'agência não vê histórico';

  -- ===== Task 1: supervisor redistribui =====
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f602', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000f602')::text, true);
  select count(*) into n from public.renovacao_carteira; assert n = 5, 'supervisor vê tudo, viu ' || n;
  update public.renovacao_carteira set consultor_id = v_b where id = v_id101;
  assert exists (select 1 from public.renovacao_historico h where h.carteira_id = v_id101 and h.campo = 'consultor' and h.de = v_a::text and h.para = v_b::text), 'histórico da redistribuição';
  begin
    update public.profiles set equipe = null where id = v_a;
    assert false, 'supervisor mudou equipe';
  exception when insufficient_privilege then null; end;

  -- ===== Task 1: admin marca equipe; resumo =====
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f601', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000f601')::text, true);
  update public.profiles set equipe = null where id = v_a;
  update public.profiles set equipe = 'renovacao' where id = v_a;
  select * into r from public.renovacao_resumo where consultor_id = v_b;
  -- B tem: 101 (7, redistribuído), 103 (3), 104 (6, 4 linhas), 105 (7)
  assert r.carteira = 4 and r.contatados = 4 and r.efetivo_mais = 2 and r.propostas_mais = 1
     and r.renovados = 1 and r.perdidos = 2 and r.linhas_renovadas = 4 and r.retornos_atrasados = 0,
     'resumo de B: ' || row_to_json(r)::text;
  select * into r from public.renovacao_resumo where consultor_id = v_a;
  -- A tem: 102 (6, retorno vencido mas renovado não conta)
  assert r.carteira = 1 and r.renovados = 1 and r.retornos_atrasados = 0, 'resumo de A: ' || row_to_json(r)::text;
  execute 'reset role';
end $$;

-- ===== Task 2: importação =====
do $$
declare j jsonb; n int; r record;
begin
  execute 'set local role authenticated';
  -- consultor não importa
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f603', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000f603')::text, true);
  begin
    perform public.renovacao_importar('[{"cnpj_digits": "00000000000199"}]'::jsonb);
    assert false, 'consultor importou';
  exception when insufficient_privilege then null; end;
  begin
    perform public.renovacao_marcar_fora(array['00000000000101']);
    assert false, 'consultor marcou fora da base';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f601', 'role', 'authenticated')::text, true); perform set_config('request.jwt.claim.sub', ('00000000-0000-0000-0000-00000000f601')::text, true);
  j := public.renovacao_importar(jsonb_build_array(
    jsonb_build_object('cnpj_digits', '00000000000101', 'razao_social', 'Zz Alfa Novo Nome', 'linhas_voz', 11,
                       'dados_claro', jsonb_build_object('CIDADE', 'Zz Cidade', 'SCORE', 7),
                       'status', 1, 'observacoes', 'Zz não pode sobrescrever', 'consultor_id', null),
    jsonb_build_object('cnpj_digits', '00000000000199', 'razao_social', 'Zz Novo', 'status', 7,
                       'consultor_id', '00000000-0000-0000-0000-00000000f603', 'origem', 'Nova atribuição'),
    jsonb_build_object('cnpj_digits', '00000000000199', 'razao_social', 'Zz Novo Repetido')
  ));
  assert (j->>'novos')::int = 1 and (j->>'atualizados')::int = 1, 'contagem: ' || j::text;
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000101';
  assert r.razao_social = 'Zz Alfa Novo Nome' and r.linhas_voz = 11 and (r.dados_claro->>'SCORE') = '7', 'dados da Claro atualizados';
  assert r.status = 7 and r.motivo_perda = 'Preço' and r.consultor_id = '00000000-0000-0000-0000-00000000f604'
     and r.observacoes is null, 'atendimento e consultor preservados na reimportação: ' || row_to_json(r)::text;
  select * into r from public.renovacao_carteira where cnpj_digits = '00000000000199';
  assert r.razao_social = 'Zz Novo' and r.status = 7 and r.a_completar and r.consultor_id = '00000000-0000-0000-0000-00000000f603'
     and r.origem = 'Nova atribuição', 'novo entra com trabalho e como pendência: ' || row_to_json(r)::text;
  begin
    perform public.renovacao_importar('[{"cnpj_digits": "123"}]'::jsonb);
    assert false, 'CNPJ inválido passou';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.renovacao_marcar_fora(array[]::text[]);
    assert false, 'lista vazia marcou todo mundo fora';
  exception when invalid_parameter_value then null; end;
  n := public.renovacao_marcar_fora(array['00000000000101', '00000000000199']);
  assert n = 4, 'saíram 102, 103, 104 e 105, veio ' || n;
  assert not (select na_base from public.renovacao_carteira where cnpj_digits = '00000000000103'), '103 fora da base';
  assert (select status from public.renovacao_carteira where cnpj_digits = '00000000000103') = 3, 'fora da base não perde o status';
  select coalesce(sum(carteira), 0) into n from public.renovacao_resumo;
  assert n = 2, 'resumo só conta quem está na base, veio ' || n;
  j := public.renovacao_importar('[{"cnpj_digits": "00000000000103", "razao_social": "Zz Gama"}]'::jsonb);
  assert (select na_base from public.renovacao_carteira where cnpj_digits = '00000000000103'), 'reimportar volta para a base';
  execute 'reset role';
end $$;

rollback;
