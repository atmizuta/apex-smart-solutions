-- Verificação da migration 20261125200000 (§165). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f811', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r4a@teste.invalid'),
('00000000-0000-0000-0000-00000000f812', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r4b@teste.invalid'),
('00000000-0000-0000-0000-00000000f813', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r4adm@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f811', 'Zzr4a Teste', 'zz.r4a', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f812', 'Zzr4b Teste', 'zz.r4b', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f813', 'Zzr4adm Teste', 'zz.r4adm', 'admin', 'apex', null)
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id) values
('00000000000401', 'Zz Quatro A', '00000000-0000-0000-0000-00000000f811'),
('00000000000402', 'Zz Quatro B', '00000000-0000-0000-0000-00000000f812');

do $$
declare a uuid := '00000000-0000-0000-0000-00000000f811'; b uuid := '00000000-0000-0000-0000-00000000f812'; adm uuid := '00000000-0000-0000-0000-00000000f813';
  ca bigint; cb bigint; n int; v_nota bigint; v_ct bigint;
begin
  select id into ca from public.renovacao_carteira where cnpj_digits = '00000000000401';
  select id into cb from public.renovacao_carteira where cnpj_digits = '00000000000402';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);

  -- anotação: cria no próprio cliente, autor gravado; no cliente de outro consultor não entra
  insert into public.renovacao_notas (carteira_id, texto) values (ca, 'Zz ligou, pediu retorno terça') returning id into v_nota;
  assert (select user_id from public.renovacao_notas where id = v_nota) = a, 'autor gravado';
  begin
    insert into public.renovacao_notas (carteira_id, texto) values (cb, 'Zz invasão');
    assert false, 'anotou no cliente de outro consultor';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.renovacao_notas (carteira_id, texto) values (ca, '   ');
    assert false, 'anotação vazia passou';
  exception when check_violation then null; end;

  -- contatos: telefone só dígitos, um principal por cliente
  insert into public.renovacao_contatos (carteira_id, nome, cargo, telefone, email, decisor, principal)
    values (ca, 'Zz Maria', 'Sócia', '(19) 99999-0001', 'maria@zz.invalid', true, true) returning id into v_ct;
  assert (select telefone from public.renovacao_contatos where id = v_ct) = '19999990001', 'telefone normalizado';
  insert into public.renovacao_contatos (carteira_id, nome, telefone, principal) values (ca, 'Zz João', '1933330002', true);
  assert (select count(*) from public.renovacao_contatos where carteira_id = ca and principal) = 1, 'só um principal';
  begin
    insert into public.renovacao_contatos (carteira_id, email) values (ca, 'sem-arroba');
    assert false, 'e-mail inválido passou';
  exception when check_violation then null; end;
  assert (select dados_claro from public.renovacao_carteira where id = ca) = '{}'::jsonb, 'dados da Claro intactos';

  -- anexos
  insert into public.renovacao_anexos (carteira_id, tipo, nome, caminho, mime, tamanho) values (ca, 'fatura', 'zz.pdf', ca || '/zz-1.pdf', 'application/pdf', 1000);
  begin
    insert into public.renovacao_anexos (carteira_id, tipo, nome, caminho) values (ca, 'fatura', 'zz.pdf', cb || '/zz-2.pdf');
    assert false, 'caminho de outro cliente passou';
  exception when check_violation then null; end;

  -- outro consultor não enxerga nada do cliente A e não apaga
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  assert (select count(*) from public.renovacao_notas) = 0 and (select count(*) from public.renovacao_contatos) = 0 and (select count(*) from public.renovacao_anexos) = 0, 'B não vê o cliente de A';

  -- admin vê e apaga; quem criou apaga a própria
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  assert (select count(*) from public.renovacao_notas) = 1, 'admin vê a anotação';
  delete from public.renovacao_notas where id = v_nota;
  assert (select count(*) from public.renovacao_notas) = 0, 'admin apaga';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', a::text, true);
  delete from public.renovacao_anexos where carteira_id = ca;
  assert (select count(*) from public.renovacao_anexos) = 0, 'criador apaga o próprio anexo';
  execute 'reset role';
  assert (select public from storage.buckets where id = 'renovacao-anexos') = false, 'bucket privado';
end $$;

rollback;
