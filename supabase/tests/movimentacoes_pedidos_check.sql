-- §166 — rodar no execute_sql DEPOIS da migration 20261124120000 (ou com ela colada logo após o begin).
-- SEMPRE desfeito: termina com raise exception 'RESULTADO: ...'. Usuários e pedidos fictícios (ZZ).
-- Precisa de ok do Rafael para rodar (é escrita em produção, mesmo desfeita).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpsupa@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpsupc@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpconsa@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpconsc@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000dd01', 'Zz Adm', 'zz.mpadm', 'admin', 'apex'),
  ('00000000-0000-0000-0000-00000000dd02', 'Zz SupA', 'zz.mpsupa', 'supervisor', 'apex'),
  ('00000000-0000-0000-0000-00000000dd03', 'Zz SupC', 'zz.mpsupc', 'supervisor', 'campinas'),
  ('00000000-0000-0000-0000-00000000dd04', 'Zz ConsA', 'zz.mpconsa', 'consultor', 'apex'),
  ('00000000-0000-0000-0000-00000000dd05', 'Zz ConsC', 'zz.mpconsc', 'consultor', 'campinas')
on conflict (id) do update set role = excluded.role, operacao = excluded.operacao;
insert into public.consultor_neo (profile_id, neo_usuario_id) values
  ('00000000-0000-0000-0000-00000000dd04', 990000041), ('00000000-0000-0000-0000-00000000dd05', 990000051);
-- ZZM1 = pedido Apex (ConsA); ZZM2 = pedido Campinas (ConsC); ZZM3 = só no filme (fora da producao_pedidos_neo)
insert into public.producao_pedidos_neo (item_id, numero_pedido, usuario, usuario_id, etapa, cadastro, atualizacao, valor, quantidade, produto, cliente)
values (990000101, 'ZZM1', 'ZZ CONS A', 990000041, 'VENDA PERDIDA (NEOCRM)', now() - interval '5 days', now(), 100, 1, 'Produto Teste', 'Cliente Teste 1'),
       (990000102, 'ZZM2', 'ZZ CONS C', 990000051, 'NEGOCIACAO', now() - interval '5 days', now(), 50, 1, 'Produto Teste', 'Cliente Teste 2');

-- diário: grava 1x; mesma nota com horário novo não duplica; nota diferente entra
do $$ declare n int; begin
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T09:51:00-03:00","texto":"Status: CONSULTA NÃO APROVADA","tipo":"bko_status","status":"CONSULTA NÃO APROVADA","descricao":null,"vp_categoria":null,"etapa":"CREDITO"}]'::jsonb);
  assert n = 1, 'grava a primeira nota, veio ' || n;
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T10:30:00-03:00","texto":"Status: CONSULTA NÃO APROVADA","tipo":"bko_status","status":"CONSULTA NÃO APROVADA","descricao":null,"vp_categoria":null,"etapa":"CREDITO"}]'::jsonb);
  assert n = 0, 'mesma nota com horário novo não duplica, veio ' || n;
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T11:05:00-03:00","texto":"cliente sumiu\n(Venda Perdida)\nCategoria Inserido Restrição de Crédito","tipo":"venda_perdida","status":null,"descricao":null,"vp_categoria":"Restrição de Crédito","etapa":"VENDA PERDIDA"}]'::jsonb);
  assert n = 1, 'nota nova entra, veio ' || n;
end $$;

-- filme: ZZM1 NEGOCIACAO → CREDITO → DEVOLVIDO (BKO) → VENDA PERDIDA (consultor); ZZM2 parado em NEGOCIACAO
insert into public.pedido_movimentacoes (pedido_id, numero_pedido, etapa_id, etapa, entrou_em, saiu_em, entrou_por, saiu_por, sla_horas, consultor) values
  (99001, 'ZZM1', 1, 'NEGOCIACAO',    '2026-11-20 08:00-03', '2026-11-20 09:00-03', 'ZZ CONS A', 'ZZ CONS A', 24,   'ZZ CONS A'),
  (99001, 'ZZM1', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 09:52-03', 'ZZ CONS A', 'ZZ BKO',    8,    'ZZ CONS A'),
  (99001, 'ZZM1', 3, 'DEVOLVIDO',     '2026-11-20 09:52-03', '2026-11-20 11:05-03', 'ZZ BKO',    'ZZ CONS A', 24,   'ZZ CONS A'),
  (99001, 'ZZM1', 4, 'VENDA PERDIDA', '2026-11-20 11:05-03', null,                  'ZZ CONS A', null,        null, 'ZZ CONS A'),
  (99002, 'ZZM2', 1, 'NEGOCIACAO',    '2026-11-21 08:00-03', null,                  'ZZ CONS C', null,        24,   'ZZ CONS C'),
  (99003, 'ZZM3', 1, 'NEGOCIACAO',    '2026-11-21 08:00-03', null,                  'ZZ OUTRO',  null,        24,   'ZZ OUTRO');

-- permissão (funções internas: authenticated não executa; avaliadas como dono, com o sub de cada um)
do $$ begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  begin perform public.pedido_pode_ver('ZZM1'); assert false, 'authenticated chamou função interna';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd01', true);
  assert public.pedido_pode_ver('ZZM1') and public.pedido_pode_ver('ZZM2') and public.pedido_pode_ver('ZZM3'), 'admin vê tudo';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  assert public.pedido_pode_ver('ZZM1') and not public.pedido_pode_ver('ZZM2') and public.pedido_pode_ver('ZZM3'), 'sup Apex: Apex + sem consultor (=apex)';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  assert not public.pedido_pode_ver('ZZM1') and public.pedido_pode_ver('ZZM2'), 'sup Campinas só Campinas';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  assert public.pedido_pode_ver('ZZM1') and not public.pedido_pode_ver('ZZM2') and not public.pedido_pode_ver('ZZM3'), 'consultor só o dele';
  assert public.mp_escopo() is null, 'consultor sem aba';
end $$;
-- (Tasks 4 e 5 acrescentam blocos aqui, antes do RESULTADO)
do $$ begin raise exception 'RESULTADO: ok (§166)'; end $$;
