-- Verificação de 20261006100000_caderno_agenda_objecoes.sql. Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis fictícios (zz*).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdoutro@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000cc01', 'Zzcdcons Teste', 'zz.cdcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000cc02', 'Zzcdsup Teste',  'zz.cdsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000cc03', 'Zzcdoutro Teste','zz.cdoutro','consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

do $$
declare n int; j jsonb;
begin
  execute 'set local role authenticated';
  -- consultor cc01
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc01', true);
  insert into public.caderno_notas (id, telefone, nome, texto) values ('00000000-0000-0000-0000-0000000000a1', '(19) 90000-0001', 'Empresa Teste', 'nota 1');
  -- upsert pelo mesmo id não duplica e mantém o dono
  insert into public.caderno_notas (id, telefone, nome, texto) values ('00000000-0000-0000-0000-0000000000a1', '(19) 90000-0001', 'Empresa Teste', 'nota 1 editada')
    on conflict (id) do update set texto = excluded.texto;
  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1';
  assert n = 1, 'upsert duplicou a nota';
  assert (select chave_tel from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1') = public.chave_tel('(19) 90000-0001'), 'chave_tel preenchida';
  insert into public.agenda_retornos (id, nome, telefone, quando) values
    ('00000000-0000-0000-0000-0000000000b1', 'Empresa Teste', '19900000001', now() - interval '1 hour'),
    ('00000000-0000-0000-0000-0000000000b2', 'Empresa Teste', '19900000001', now() + interval '1 day');
  update public.agenda_retornos set status = 'feito' where id = '00000000-0000-0000-0000-0000000000b1';
  assert (select feito_em from public.agenda_retornos where id = '00000000-0000-0000-0000-0000000000b1') is not null, 'feito_em preenchido';
  begin
    insert into public.agenda_retornos (id, nome, telefone, quando, status) values ('00000000-0000-0000-0000-0000000000b3', 'X', '1', now(), 'sumiu');
    assert false, 'status inválido aceito';
  exception when check_violation then null; end;
  begin
    insert into public.caderno_notas (id, consultor_id, texto) values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000cc03', 'x');
    assert false, 'consultor gravou nota em nome de outro';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_retornos_objecoes(current_date);
    assert false, 'consultor chamou a RPC da Mesa';
  exception when insufficient_privilege then null; end;
  insert into public.objecoes_uso (objecao, fonte, util) values ('caro', 'ia', true);
  begin
    update public.objecoes_respostas set fala = 'x' where chave = 'caro';
    get diagnostics n = row_count;
    assert n = 0, 'consultor editou a biblioteca';
  end;
  -- outro consultor cc03 não vê nem altera o do cc01
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc03', true);
  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1';
  assert n = 0, 'outro consultor leu a nota';
  update public.agenda_retornos set status = 'cancelado' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'outro consultor alterou o retorno';
  select count(*) into n from public.objecoes_respostas where ativo;
  assert n >= 9, 'biblioteca semeada e legível';
  -- supervisor lê tudo e chama a RPC
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc02', true);
  select count(*) into n from public.agenda_retornos where consultor_id = '00000000-0000-0000-0000-00000000cc01';
  assert n = 2, 'supervisor lê os retornos do consultor';
  j := public.mesa_retornos_objecoes((now() at time zone 'America/Sao_Paulo')::date);
  assert exists (select 1 from jsonb_array_elements(j->'consultores') e where e->>'nome' = 'Zzcdcons Teste' and (e->>'feitos7')::int = 1), 'RPC: feitos7 do consultor';
  assert exists (select 1 from jsonb_array_elements(j->'objecoes') e where e->>'objecao' = 'caro' and (e->>'uteis')::int >= 1), 'RPC: top objeções';
  -- anônimo não lê nada
  execute 'set local role anon';
  select count(*) into n from public.caderno_notas;
  assert n = 0, 'anônimo leu notas';
end $$;
rollback;
