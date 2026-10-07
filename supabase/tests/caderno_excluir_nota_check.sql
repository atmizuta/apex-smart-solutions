-- Verificação de 20261007100000_caderno_excluir_nota.sql. Rodar SOMENTE depois da migration; SEMPRE
-- termina em ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis fictícios (zz*).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000ed01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.excons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000ed02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.exsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000ed03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.exoutro@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000ed01', 'Zzexcons Teste', 'zz.excons', 'consultor'),
  ('00000000-0000-0000-0000-00000000ed02', 'Zzexsup Teste',  'zz.exsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000ed03', 'Zzexoutro Teste','zz.exoutro','consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

do $$
declare n int; v_status text; v_nota_id uuid;
begin
  execute 'set local role authenticated';
  -- consultor ed01: cria a nota e dois retornos (um pendente, um já feito)
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ed01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ed01', true);
  insert into public.caderno_notas (id, telefone, nome, texto) values ('00000000-0000-0000-0000-0000000000e1', '(19) 90000-0091', 'Empresa Excluir Teste', 'nota a excluir');
  insert into public.agenda_retornos (id, nome, telefone, quando, nota_id) values
    ('00000000-0000-0000-0000-0000000000e2', 'Empresa Excluir Teste', '19900000091', now() + interval '1 day', '00000000-0000-0000-0000-0000000000e1'),
    ('00000000-0000-0000-0000-0000000000e3', 'Empresa Excluir Teste', '19900000091', now() - interval '1 day', '00000000-0000-0000-0000-0000000000e1');
  update public.agenda_retornos set status = 'feito' where id = '00000000-0000-0000-0000-0000000000e3';

  -- outro consultor (ed03) não consegue excluir a nota de ed01 (0 linhas, nada muda)
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ed03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ed03', true);
  delete from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count;
  assert n = 0, 'outro consultor conseguiu excluir nota alheia';

  -- supervisor (ed02) também não consegue excluir a nota de um consultor (0 linhas)
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ed02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ed02', true);
  delete from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count;
  assert n = 0, 'supervisor conseguiu excluir nota de um consultor';

  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000e1';
  assert n = 1, 'nota sumiu mesmo com as exclusões negadas pela RLS';

  -- o dono (ed01) exclui a própria nota: some, o retorno pendente vira cancelado, o já feito continua feito,
  -- e a FK (on delete set null) zera o nota_id dos dois (o cancelado agora, e o que já estava "feito").
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ed01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ed01', true);
  delete from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000e1';
  get diagnostics n = row_count;
  assert n = 1, 'dono não conseguiu excluir a própria nota';
  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000e1';
  assert n = 0, 'nota continua no banco depois do delete do dono';
  select status into v_status from public.agenda_retornos where id = '00000000-0000-0000-0000-0000000000e2';
  assert v_status = 'cancelado', 'retorno pendente da nota excluída não virou cancelado';
  select status into v_status from public.agenda_retornos where id = '00000000-0000-0000-0000-0000000000e3';
  assert v_status = 'feito', 'retorno já feito mudou de status (devia continuar feito)';
  select nota_id into v_nota_id from public.agenda_retornos where id = '00000000-0000-0000-0000-0000000000e2';
  assert v_nota_id is null, 'a FK não zerou o nota_id do retorno depois do delete da nota';
end $$;
rollback;
