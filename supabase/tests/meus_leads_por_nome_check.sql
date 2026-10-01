-- Verificação de 20261001200000_meus_leads_por_nome.sql. Roda SOMENTE depois da migration e SEMPRE termina em
-- ROLLBACK (nada fictício fica no banco). Falha = exceção com a mensagem do assert.
-- Cria perfis fictícios só dentro da transação (auth.users + profiles) para não depender de nomes reais.
begin;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.unico@teste.invalid'),
  ('00000000-0000-0000-0000-00000000aa02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dup1@teste.invalid'),
  ('00000000-0000-0000-0000-00000000aa03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dup2@teste.invalid'),
  ('00000000-0000-0000-0000-00000000aa04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.sem@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000aa01', 'Zzunico Teste', 'zz.unico', 'consultor'),
  ('00000000-0000-0000-0000-00000000aa02', 'Zzdup Um',      'zz.dup1',  'consultor'),
  ('00000000-0000-0000-0000-00000000aa03', 'Zzdup Dois',    'zz.dup2',  'consultor'),
  ('00000000-0000-0000-0000-00000000aa04', 'Zzsemlead Tr',  'zz.sem',   'consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

insert into public.leads (id, aba, consultor, full_name, phone_number, categoria, status, criado_em_lead) values
  ('zz:u1', 'ZZMES',   'ZZUNICO', 'Lead U1', 'p:+5519900000101', 'andamento',   'EM NEGOCIACAO', now() - interval '1 day'),
  ('zz:u2', 'ZZMES',   'Zzúnico', 'Lead U2', 'p:+5519900000102', 'convertido',  'PEDIDO CONCLUIDO (VENDA)', now()),
  ('zz:u3', 'REPIQUE', 'Zzunico', 'Lead U3', 'p:+5519900000103', 'sem_contato', '', now()),
  ('zz:d1', 'ZZMES',   'Zzdup',   'Lead D1', 'p:+5519900000104', 'andamento',   '', now()),
  ('zz:r1', 'REPIQUE', 'Zzsemlead','Lead R1', 'p:+5519900000105', 'andamento',  '', now());

do $$
declare n int; ok boolean;
begin
  execute 'set local role authenticated';

  -- 1) primeiro nome único casa por nome (sem acento/caixa); Repique e convertido ficam de fora da lista
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa01', true);
  assert public.meus_leads_vinculado() = true, 'nome único: vinculado';
  select count(*) into n from public.meus_leads_para_tratar() where lead_id like 'zz:%';
  assert n = 1, 'nome único: só o lead em aberto fora do Repique, veio ' || n;
  assert not exists (select 1 from public.meus_leads_para_tratar() where aba = 'REPIQUE'), 'nunca devolve Repique';

  -- 2) primeiro nome repetido entre perfis: não casa por nome
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa02', true);
  assert public.meus_leads_vinculado() = false, 'nome repetido: não vinculado';
  select count(*) into n from public.meus_leads_para_tratar() where lead_id like 'zz:%';
  assert n = 0, 'nome repetido: nenhum lead, veio ' || n;

  -- 3) consultor que só tem lead no Repique: seção não aparece
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa04', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa04', true);
  assert public.meus_leads_vinculado() = false, 'só Repique: não vinculado';

  -- 4) anon não executa
  execute 'reset role';
  execute 'set local role anon';
  ok := false;
  begin perform public.meus_leads_vinculado(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não executa meus_leads_vinculado';
  execute 'reset role';
end $$;

-- 5) pela equipe: o login ligado em leads_equipe vê os leads desse nome mesmo com primeiro nome repetido
insert into public.leads_equipe (nome_planilha, monitorar, profile_id) values ('Zzdup', true, '00000000-0000-0000-0000-00000000aa02');
do $$
declare n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa02', true);
  assert public.meus_leads_vinculado() = true, 'equipe: vinculado';
  select count(*) into n from public.meus_leads_para_tratar() where lead_id like 'zz:%';
  assert n = 1, 'equipe: 1 lead do Zzdup, veio ' || n;
  -- o outro "Zzdup" não herda os leads
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000aa03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa03', true);
  assert public.meus_leads_vinculado() = false, 'o outro perfil com o mesmo nome não vê os leads';
  execute 'reset role';
end $$;

select 'meus_leads_por_nome_check: OK' as resultado;
rollback;
