-- Verificação de 20261005100000_vendas_perdidas_categorias.sql. Rodar SÓ depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpsem@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000cc01', 'Zzvpsup Teste', 'zz.vpsup', 'supervisor'),
  ('00000000-0000-0000-0000-00000000cc02', 'Zzvpcons Teste', 'zz.vpcons', 'consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;
-- pedidos fictícios: P1 perdido hoje com categoria; P2 perdido hoje sem atividade; P3 perdido há 400 dias; P4 concluído
insert into public.producao_pedidos_neo (id, item_id, numero_pedido, usuario, etapa, cadastro, atualizacao, valor, quantidade, produto, cliente)
values (990000001, 990000001, 'ZZP1', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 100, 1, 'Produto Teste', 'Cliente Teste 1'),
       (990000002, 990000002, 'ZZP1', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 50, 1, 'Produto Teste 2', 'Cliente Teste 1'),
       (990000003, 990000003, 'ZZP2', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 70, 1, 'Produto Teste', 'Cliente Teste 2'),
       (990000004, 990000004, 'ZZP3', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '500 days', now() - interval '400 days', 10, 1, 'Produto Teste', 'Cliente Teste 3'),
       (990000005, 990000005, 'ZZP4', 'ZZ CONSULTOR', 'CONCLUIDO (NEOCRM)', now() - interval '3 days', now(), 99, 1, 'Produto Teste', 'Cliente Teste 4');
insert into public.producao_atividades (numero_pedido, categoria, tags, etapa, usuario, valor, itens)
values ('ZZP1', 'Não responde', '{#SEMINTERESSE}', 'VENDA PERDIDA (NEOCRM)', 'ZZ CONSULTOR', 150, 2);

do $$
declare n int; v numeric; c text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc01', true);
  select count(*) into n from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido like 'ZZP%';
  assert n = 2, 'vendas_perdidas: só P1 e P2 (P3 fora do período, P4 não é perdido), veio ' || n;
  select valor, categoria into v, c from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido = 'ZZP1';
  assert v = 150 and c = 'Não responde', 'P1: valor somado dos itens (150) e categoria da atividade';
  assert (select categoria from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido = 'ZZP2') is null, 'P2 sem atividade: categoria null (não some)';
  assert exists (select 1 from public.producao_atividades where numero_pedido = 'ZZP1'), 'supervisor lê producao_atividades';

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc02', true);
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'consultor chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.producao_atividades where numero_pedido = 'ZZP1'), 'consultor não lê producao_atividades (RLS)';

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc03', true);
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'sem perfil chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'anon chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
