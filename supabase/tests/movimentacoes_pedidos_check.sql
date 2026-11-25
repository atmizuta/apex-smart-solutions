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
-- Task 4: linha do tempo, feed, parados e tempo por etapa
do $$ declare j jsonb; begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd04', 'role', 'authenticated')::text, true);
  j := public.pedido_linha_do_tempo('ZZM1');
  assert jsonb_array_length(j->'passagens') = 4, 'consultor vê as 4 passagens do pedido dele';
  assert jsonb_array_length(j->'anotacoes') = 2 and j->'motivo_real' = 'null'::jsonb and not (j->>'pode_decidir')::boolean, 'consultor: notas sim, motivo real não';
  assert (j->'anotacoes'->0->>'autor_provavel') = 'ZZ BKO', 'autor provável da nota 09:51 = quem moveu às 09:52';
  begin perform public.pedido_linha_do_tempo('ZZM2'); assert false, 'consultor viu pedido de outro';
  exception when insufficient_privilege then null; end;
  begin perform public.movimentacoes_feed(date '2026-11-20', null, null, null); assert false, 'consultor abriu o feed';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd03', 'role', 'authenticated')::text, true);
  j := public.movimentacoes_feed(date '2026-11-20', null, null, null);
  assert not exists (select 1 from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1'), 'sup Campinas não vê ZZM1 no feed';
  j := public.movimentacoes_parados('NEGOCIACAO');
  assert exists (select 1 from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM2'), 'sup Campinas vê ZZM2 parado';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd02', 'role', 'authenticated')::text, true);
  j := public.movimentacoes_feed(date '2026-11-20', null, null, null);
  assert (select count(*) from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1') = 6, 'sup Apex: 4 passagens + 2 notas de ZZM1 em 20/11';
  assert (j->'kpis'->>'entradas_vp')::int >= 1 and (j->'kpis'->>'anotacoes_bko')::int >= 1, 'kpis contam VP e BKO';
  j := public.movimentacoes_feed(date '2026-11-20', null, null, 'bko_status');
  assert (select count(*) from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1') = 1, 'filtro tipo';
  j := public.movimentacoes_tempo_etapa(date '2026-11-19', date '2026-11-21', 'ZZ CONS A');
  assert exists (select 1 from jsonb_array_elements(j->'etapas') e where e->>'etapa' = 'CREDITO' and (e->>'fora_sla_pct')::numeric = 0 and (e->>'passagens')::int = 1), 'CREDITO: 52 min, dentro do SLA de 8 h';
  j := public.movimentacoes_parados('VENDA PERDIDA');
  assert jsonb_array_length(j->'itens') = 0, 'VENDA PERDIDA não conta como parado';
  j := public.pedido_linha_do_tempo('ZZM3');
  assert j->'cabecalho' = 'null'::jsonb and jsonb_array_length(j->'passagens') = 1, 'pedido fora da producao_pedidos_neo: sem cabeçalho, com filme';
end $$;
-- Task 5: auditoria das vendas perdidas
-- ZZM4: VP sem nada antes (❔); ZZM5: entrou em VP e voltou (↩️); ZZM6: BKO reprovou crédito, consultor marcou crédito (✅);
-- ZZM7: BKO reprovou crédito, consultor marcou "Não responde" (⚠️); ZZM1 (Task 3) = devolvido sem nota nova depois (🔁).
-- ZZM4..7 estão fora da producao_pedidos_neo → contam como 'apex'.
reset role; -- o set local role do bloco da Task 4 vale até o fim da transação
insert into public.pedido_movimentacoes (pedido_id, numero_pedido, etapa_id, etapa, entrou_em, saiu_em, entrou_por, consultor) values
  (99004, 'ZZM4', 4, 'VENDA PERDIDA', '2026-11-20 12:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99005, 'ZZM5', 4, 'VENDA PERDIDA', '2026-11-20 12:00-03', '2026-11-20 15:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99005, 'ZZM5', 1, 'NEGOCIACAO',    '2026-11-20 15:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99006, 'ZZM6', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 10:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99006, 'ZZM6', 4, 'VENDA PERDIDA', '2026-11-20 10:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99007, 'ZZM7', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 10:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99007, 'ZZM7', 4, 'VENDA PERDIDA', '2026-11-20 10:00-03', null,                  'ZZ CONS A', 'ZZ CONS A');
insert into public.pedido_anotacoes (numero_pedido, atualizado_em_neo, texto, tipo, status, vp_categoria) values
  ('ZZM6', '2026-11-20 09:30-03', 'Status: CONSULTA NÃO APROVADA', 'bko_status', 'CONSULTA NÃO APROVADA', null),
  ('ZZM6', '2026-11-20 10:00-03', '(Venda Perdida) Categoria Inserido Restrição de Crédito', 'venda_perdida', null, 'Restrição de Crédito'),
  ('ZZM7', '2026-11-20 09:30-03', 'Status: CONSULTA NÃO APROVADA', 'bko_status', 'CONSULTA NÃO APROVADA', null),
  ('ZZM7', '2026-11-20 10:00-03', '(Venda Perdida) Categoria Inserido Não responde', 'venda_perdida', null, 'Não responde');

do $$ declare j jsonb; s jsonb; begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd02', 'role', 'authenticated')::text, true);
  j := public.vendas_perdidas_auditoria(date '2026-11-20', date '2026-11-20');
  select jsonb_object_agg(e->>'numero', e->>'selo') into s from jsonb_array_elements(j->'pedidos') e where e->>'numero' like 'ZZM%';
  assert s = '{"ZZM1":"devolvido","ZZM4":"sem","ZZM5":"saiu","ZZM6":"confere","ZZM7":"diferente"}'::jsonb, 'selos: ' || s::text;
  assert (select e->>'categoria' from jsonb_array_elements(j->'pedidos') e where e->>'numero' = 'ZZM1') = 'Restrição de Crédito', 'categoria vem do diário';
  perform public.venda_perdida_definir_motivo('ZZM7', 'Restrição de Crédito', 'BKO reprovou');
  assert (public.pedido_linha_do_tempo('ZZM7')->'motivo_real'->>'motivo') = 'Restrição de Crédito', 'motivo real gravado';
  begin perform public.venda_perdida_definir_motivo('ZZM7', '  ', null); assert false, 'aceitou motivo vazio';
  exception when sqlstate '22023' then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd03', 'role', 'authenticated')::text, true);
  j := public.vendas_perdidas_auditoria(date '2026-11-20', date '2026-11-20');
  assert not exists (select 1 from jsonb_array_elements(j->'pedidos') e where e->>'numero' = 'ZZM6'), 'sup Campinas não vê VP da Apex';
  begin perform public.venda_perdida_definir_motivo('ZZM6', 'Não responde', null); assert false, 'sup Campinas decidiu pedido Apex';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd04', 'role', 'authenticated')::text, true);
  begin perform public.venda_perdida_definir_motivo('ZZM1', 'Não responde', null); assert false, 'consultor decidiu motivo';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin raise exception 'RESULTADO: ok (§166)'; end $$;
