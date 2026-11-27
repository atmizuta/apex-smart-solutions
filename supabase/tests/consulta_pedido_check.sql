-- Verificação de 20261127120000_consulta_pedido.sql (§170). Rodar SÓ depois da migration.
-- Termina com o erro "RESULTADO: ok (§170)" de propósito: tudo é desfeito. DADOS FICTÍCIOS.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cpadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000ee02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cpsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000ee03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cpcons@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000ee01', 'Zz CpAdm', 'zz.cpadm', 'admin', 'apex'),
  ('00000000-0000-0000-0000-00000000ee02', 'Zz CpSup', 'zz.cpsup', 'supervisor', 'campinas'),
  ('00000000-0000-0000-0000-00000000ee03', 'Zz CpCons', 'zz.cpcons', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;
-- ZZC1: 2 itens, com id do NEO; ZZC2: sem movimentação (sem id); ZZC3 só dá ao painel a etapa fictícia
insert into public.producao_pedidos_neo (item_id, numero_pedido, usuario, etapa, cadastro, atualizacao, valor, quantidade, produto, cliente) values
  (990009001, 'ZZC1', 'ZZ CONS', 'PROPOSTA (NEOCRM)', now(), now(), 10, 1, 'Produto Teste', 'Cliente Teste'),
  (990009002, 'ZZC1', 'ZZ CONS', 'PROPOSTA (NEOCRM)', now(), now(), 20, 1, 'Produto Teste', 'Cliente Teste'),
  (990009003, 'ZZC2', 'ZZ CONS', 'PROPOSTA (NEOCRM)', now(), now(), 10, 1, 'Produto Teste', 'Cliente Teste'),
  (990009004, 'ZZC3', 'ZZ CONS', 'CRÉDITO TESTE ZZ (NEOCRM)', now(), now(), 1, 1, 'Produto Teste', 'Cliente Teste');
insert into public.pedido_movimentacoes (pedido_id, numero_pedido, etapa_id, etapa, entrou_em, entrou_por, consultor) values
  (99901, 'ZZC1', 1, 'PROPOSTA', now() - interval '1 day', 'ZZ CONS', 'ZZ CONS');

-- normalização e vaga (horário futuro, sem log real: 15:26 UTC fica entre os crons :23 e :33)
do $$
declare t timestamptz := '2027-01-04 15:26:00+00';
begin
  assert public.etapa_norm('Crédito  Teste ZZ') = public.etapa_norm('CRÉDITO TESTE ZZ (NEOCRM)'), 'norm: acento, sufixo e espaço';
  assert public.etapa_norm('VALIDAÇÃO ESIM (NEOCRM)') = 'VALIDACAO ESIM', 'norm: validação';
  assert public.etapa_norm(null) is null and public.etapa_norm('  ') is null, 'norm: vazio';
  assert public.consulta_espera_s(t) = 0, 'livre';
  insert into public.neo_consulta_log (numero_pedido, comecou_em, terminou_em) values ('ZZC1', t - interval '60 seconds', t - interval '55 seconds');
  assert public.consulta_espera_s(t) = 75, '130 s depois do fim: ' || public.consulta_espera_s(t);
  update public.neo_consulta_log set terminou_em = null where numero_pedido = 'ZZC1';
  assert public.consulta_espera_s(t) = 170, 'sem fim conta até 100 s: ' || public.consulta_espera_s(t);
  delete from public.neo_consulta_log where numero_pedido = 'ZZC1';
  insert into public.neo_pedidos_sync_log (api, comecou_em, terminou_em, ok) values
    ('atualizacoes', t - interval '9 minutes', t - interval '9 minutes' + interval '5 seconds', true),
    ('movimentacao', t - interval '5 minutes', t - interval '5 minutes' + interval '5 seconds', true);
  assert public.consulta_espera_s(t) = 60, 'seria a 3ª em 10 min: ' || public.consulta_espera_s(t);
  delete from public.neo_pedidos_sync_log where comecou_em > t - interval '1 hour';
  assert public.consulta_espera_s('2027-01-04 15:21:00+00') = 280, 'cron das :23 em 120 s: ' || public.consulta_espera_s('2027-01-04 15:21:00+00');
  assert public.consulta_espera_s('2027-01-04 15:23:10+00') = 150, 'cron disparou há 10 s: ' || public.consulta_espera_s('2027-01-04 15:23:10+00');
  assert public.consulta_espera_s('2027-01-04 05:12:00+00') = 0, 'de madrugada o :13 não tem cron';
end $$;

-- gravar: corrige todas as linhas, registra no histórico, não corrige de novo, etapa desconhecida não mexe
do $$
declare l bigint; s jsonb;
begin
  insert into public.neo_consulta_log (numero_pedido, pedido_id, usuario) values ('ZZC1', 99901, '00000000-0000-0000-0000-00000000ee01') returning id into l;
  s := public.consulta_pedido_salvar(l, 'Crédito  Teste ZZ', '{"total": 30}'::jsonb, '[{"linha": "1"}]'::jsonb);
  assert (s->>'corrigiu')::boolean and s->>'etapa_painel' = 'CRÉDITO TESTE ZZ (NEOCRM)' and s->>'etapa_antes' = 'PROPOSTA (NEOCRM)', 'corrige: ' || s::text;
  assert (select count(*) from public.producao_pedidos_neo where numero_pedido = 'ZZC1' and etapa = 'CRÉDITO TESTE ZZ (NEOCRM)') = 2, 'todas as linhas do pedido';
  assert exists (select 1 from public.producao_etapa_historico where numero_pedido = 'ZZC1' and etapa_nova = 'CRÉDITO TESTE ZZ (NEOCRM)'), 'histórico pelo gatilho';
  assert (select ok and terminou_em is not null from public.neo_consulta_log where id = l), 'fecha o log';
  insert into public.neo_consulta_log (numero_pedido, pedido_id, usuario) values ('ZZC1', 99901, '00000000-0000-0000-0000-00000000ee01') returning id into l;
  s := public.consulta_pedido_salvar(l, 'CRÉDITO TESTE ZZ', '{}'::jsonb, '[]'::jsonb);
  assert not (s->>'corrigiu')::boolean, 'segunda vez já confere: ' || s::text;
  insert into public.neo_consulta_log (numero_pedido, pedido_id, usuario) values ('ZZC1', 99901, '00000000-0000-0000-0000-00000000ee01') returning id into l;
  s := public.consulta_pedido_salvar(l, 'ETAPA INVENTADA ZZ', '{}'::jsonb, '[]'::jsonb);
  assert s->>'etapa_painel' is null and not (s->>'corrigiu')::boolean, 'desconhecida: ' || s::text;
  assert (select count(*) from public.producao_pedidos_neo where numero_pedido = 'ZZC1' and etapa = 'CRÉDITO TESTE ZZ (NEOCRM)') = 2, 'desconhecida não mexe';
  assert (select count(*) from public.pedido_consulta_neo where numero_pedido = 'ZZC1') = 1, 'uma linha por pedido';
end $$;

-- permissões, reserva e gaveta, com o login de cada um
do $$
declare r jsonb;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ee03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ee03', true);
  assert public.consulta_pedido_preparar('ZZC1')->>'motivo' = 'permissao', 'consultor não consulta';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ee02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ee02', true);
  assert public.consulta_pedido_preparar('ZZC1')->>'motivo' = 'permissao', 'supervisor de Campinas não consulta pedido da Apex';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000ee01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ee01', true);
  assert public.consulta_pedido_preparar('ZZC2')->>'motivo' = 'sem_pedido_id', 'sem id do NEO';
  r := public.consulta_pedido_preparar('ZZC1');   -- depende da hora real: reserva ou pede para esperar
  assert ((r->>'ok')::boolean and (r->>'pedido_id')::bigint = 99901 and r ? 'log_id') or r->>'motivo' = 'vaga', 'admin: ' || r::text;
  r := public.pedido_linha_do_tempo('ZZC1');
  assert (r->>'pode_consultar')::boolean and (r->>'tem_pedido_id')::boolean, 'gaveta: pode e tem id';
  assert r->'consulta_neo'->>'etapa_neo' = 'ETAPA INVENTADA ZZ' and r->'consulta_neo'->>'por' = 'Zz CpAdm'
     and not (r->'consulta_neo' ? 'consultado_por'), 'gaveta traz a consulta sem o uuid: ' || (r->'consulta_neo')::text;
  assert not (public.pedido_linha_do_tempo('ZZC2')->>'tem_pedido_id')::boolean, 'gaveta: sem id';
  begin perform public.consulta_pedido_salvar(1, 'x', '{}'::jsonb, '[]'::jsonb); assert false, 'authenticated gravou';
  exception when insufficient_privilege then null; end;
  begin perform public.consulta_espera_s(now()); assert false, 'authenticated leu a vaga';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin raise exception 'RESULTADO: ok (§170)'; end $$;
