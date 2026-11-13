-- Verificação da migration 20261113120000 (§143, ajuste de 13/11). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f621', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r3adm@teste.invalid'),
('00000000-0000-0000-0000-00000000f622', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r3a@teste.invalid'),
('00000000-0000-0000-0000-00000000f623', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r3b@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f621', 'Zzr3adm Teste', 'zz.r3adm', 'admin', 'apex', null),
('00000000-0000-0000-0000-00000000f622', 'Zzr3a Teste', 'zz.r3a', 'consultor', 'apex', 'renovacao'),
('00000000-0000-0000-0000-00000000f623', 'Zzr3b Teste', 'zz.r3b', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id, status) values
('00000000000301', 'Zz Tres Um',   '00000000-0000-0000-0000-00000000f622', 4),
('00000000000302', 'Zz Tres Dois', '00000000-0000-0000-0000-00000000f623', 4);
insert into public.propostas (id, consultor_id, cliente_nome, tipo_proposta, origem, estagio, estagio_entrada_em, criado_em, atualizado_em, carteira_id) values
('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-00000000f621', 'Zz Tres Um', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), (select id from public.renovacao_carteira where cnpj_digits = '00000000000301')),
('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-00000000f621', 'Zz Tres Dois', 'renovacao', 'base', 'proposta_enviada', now(), now(), now(), (select id from public.renovacao_carteira where cnpj_digits = '00000000000302')),
('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-00000000f621', 'Zz Solta', 'portabilidade', 'avulsa', 'proposta_enviada', now(), now(), now(), null);

do $$
declare n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f622', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f622', true);
  select count(*) into n from public.propostas where id::text like '00000000-0000-0000-0000-0000000b%';
  assert n = 1, 'consultor A vê só a proposta do admin ligada ao cliente dele, viu ' || n;
  assert exists (select 1 from public.propostas where id = '00000000-0000-0000-0000-0000000b0001'), 'é a do cliente dele';
  update public.propostas set observacoes = 'Zz' where id = '00000000-0000-0000-0000-0000000b0001';
  get diagnostics n = row_count;
  assert n = 0, 'ver não dá direito de editar a proposta do admin';

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f623', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f623', true);
  select count(*) into n from public.propostas where id::text like '00000000-0000-0000-0000-0000000b%';
  assert n = 1 and exists (select 1 from public.propostas where id = '00000000-0000-0000-0000-0000000b0002'), 'consultor B vê só a do cliente dele';
  execute 'reset role';
end $$;

rollback;
