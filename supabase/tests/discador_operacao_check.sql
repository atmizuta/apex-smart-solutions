-- Verificação de 20261015210000_discador_operacao.sql (§89). Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK. Dados fictícios em junho de 2000 (zz*), CNPJs falsos.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000e101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.eadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esupa@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esupc@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000e101', 'Zzeadm Teste',  'zz.eadm',  'admin',      'apex'),
  ('00000000-0000-0000-0000-00000000e102', 'Zzesupa Teste', 'zz.esupa', 'supervisor', 'apex'),
  ('00000000-0000-0000-0000-00000000e103', 'Zzesupc Teste', 'zz.esupc', 'supervisor', 'campinas')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;

insert into public.discador_chamadas (id, gerada_em, status, agente_id, seg_falados, campanha, carga, cnpj) values
  (999300001, '2000-06-05 10:05-03', 'ANSWERED',  900001, 60, 'DISCADOR-APEX-AQUISICAO-CLARO-ABORDAGEM-', 'ZZ-A', '00000000000101'),
  (999300002, '2000-06-05 10:10-03', 'BUSY',      null,   null, 'DISCADOR-APEX-AQUISICAO-CLARO-ABORDAGEM-', 'ZZ-A', '00000000000202'),
  (999300003, '2000-06-05 11:00-03', 'ANSWERED',  900002, 30, 'Migração Claro Outubro', 'ZZ-C', '00000000000303'),
  (999300004, '2000-06-05 11:05-03', 'ABANDONED', null,   null, 'MIGRAÇÃO CLARO OUTUBRO', 'ZZ-C', '00000000000404'),
  (999300005, '2000-06-05 11:30-03', 'NOANSWER',  null,   null, 'ZZ-CAMPANHA-NOVA', 'ZZ-X', '00000000000505');
-- venda do CNPJ atendido pela campanha de Campinas
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999400001, 'ZZQ1', 'PEDIDO CADASTRADO', '2000-06-05 00:00-03', '00.000.000/0003-03');

do $$
declare r record; n int;
begin
  -- gatilho classificou pela campanha (prefixo, sem diferença de caixa); campanha sem regra fica nula
  select count(*) into n from public.discador_chamadas where id between 999300001 and 999300005 and
    ((id in (999300001, 999300002) and operacao = 'apex') or (id in (999300003, 999300004) and operacao = 'campinas') or (id = 999300005 and operacao is null));
  assert n = 5, 'operação pela campanha: 2 apex, 2 campinas, 1 nula — veio ' || n;
  update public.discador_chamadas set campanha = 'MIGRAÇÃO CLARO NOVEMBRO' where id = 999300005;
  assert (select operacao from public.discador_chamadas where id = 999300005) = 'campinas', 'mudar a campanha reclassifica';
  update public.discador_chamadas set campanha = 'ZZ-CAMPANHA-NOVA' where id = 999300005;

  execute 'set local role authenticated';

  -- admin: padrão apex; campinas; todas; aviso de campanha sem operação
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e101', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e101', true);
  select * into r from public.discador_resumo('2000-06-05', '2000-06-05');
  assert r.operacao = 'apex' and r.tentativas = 2 and r.atendidas = 1 and r.vendas = 0, 'admin sem operação = apex';
  assert r.sem_operacao = 'ZZ-CAMPANHA-NOVA', 'admin vê a campanha sem operação';
  select * into r from public.discador_resumo('2000-06-05', '2000-06-05', 'campinas');
  assert r.operacao = 'campinas' and r.tentativas = 2 and r.abandonadas = 1 and r.vendas = 1, 'admin em campinas (com a venda)';
  select * into r from public.discador_resumo('2000-06-05', '2000-06-05', 'todas');
  assert r.tentativas = 5 and r.vendas = 1, 'admin em todas';
  begin perform public.discador_resumo('2000-06-05', '2000-06-05', 'xyz'); assert false, 'operação inválida';
  exception when invalid_parameter_value then null; end;
  select count(*) into n from public.discador_mailing('2000-06-05', '2000-06-05', 'carga', 'campinas') where chave = 'ZZ-C' and vendas = 1;
  assert n = 1, 'mailing de campinas com a venda';

  -- supervisor de campinas: vê só campinas; pedir apex ou todas = 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e103', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e103', true);
  select * into r from public.discador_resumo('2000-06-05', '2000-06-05');
  assert r.operacao = 'campinas' and r.tentativas = 2 and r.sem_operacao is null, 'supervisor de campinas vê campinas, sem o aviso do admin';
  select count(*) into n from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900002 and vendas = 1;
  assert n = 1, 'consultor de campinas na tabela, com a venda';
  begin perform public.discador_resumo('2000-06-05', '2000-06-05', 'apex'); assert false, 'supervisor de campinas não vê apex';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_por_hora('2000-06-05', '2000-06-05', 'todas'); assert false, 'supervisor não vê todas';
  exception when insufficient_privilege then null; end;

  -- supervisor da apex: só apex
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e102', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e102', true);
  select * into r from public.discador_resumo('2000-06-05', '2000-06-05');
  assert r.operacao = 'apex' and r.tentativas = 2, 'supervisor da apex vê apex';
  begin perform public.discador_mapa_calor('2000-06-05', '2000-06-05', 'campinas'); assert false, 'supervisor da apex não vê campinas';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
