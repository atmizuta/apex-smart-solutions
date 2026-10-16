-- Verificação de 20261014110100_discador_metricas.sql (§87). Rodar SOMENTE depois das duas migrations; SEMPRE termina
-- em ROLLBACK. Dados fictícios em junho de 2000 (zz*), CNPJs falsos. Junho porque jan/2000 tinha horário de verão (UTC-2).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dadm@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000d101', 'Zzdsup Teste',  'zz.dsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000d102', 'Zzdcons Teste', 'zz.dcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000d103', 'Zzdadm Teste',  'zz.dadm',  'admin')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

insert into public.discador_agente (agente_id, profile_id) values (900001, '00000000-0000-0000-0000-00000000d102');

insert into public.discador_chamadas (id, gerada_em, status, agente_id, seg_falados, tabulacao, carga_id, carga, operadora_base, cidade, cnpj, campanha) values
  (999100001, '2000-06-05 10:05-03', 'ANSWERED',  900001, 60,   'SEM AVANÇO',        1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000101', 'DISCADOR-APEX-ZZ'),
  (999100002, '2000-06-05 10:10-03', 'ANSWERED',  900001, 120,  null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000202', 'DISCADOR-APEX-ZZ'),
  (999100003, '2000-06-05 10:20-03', 'ABANDONED', null,   null, null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000303', 'DISCADOR-APEX-ZZ'),
  (999100004, '2000-06-05 11:00-03', 'BUSY',      null,   null, null,                2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000404', 'DISCADOR-APEX-ZZ'),
  (999100005, '2000-06-05 11:05-03', 'NOANSWER',  null,   null, null,                2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000505', 'DISCADOR-APEX-ZZ'),
  (999100006, '2000-06-05 11:30-03', 'ANSWERED',  900002, 30,   'AQUISIÇÃO - GANHO', 2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000202', 'DISCADOR-APEX-ZZ'),
  (999100007, '2000-05-29 10:00-03', 'ANSWERED',  900001, 10,   'RETORNO',           1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000606', 'DISCADOR-APEX-ZZ'),
  (999100008, '2000-05-22 10:00-03', 'ABANDONED', null,   null, null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000707', 'DISCADOR-APEX-ZZ');

-- pedidos: ZZP1 (2 itens, CNPJ B pontuado) conta 1 venda, atribuída à ÚLTIMA atendida (999100006, agente 900002, ZZ-CARGA-2);
-- ZZP2 perdido não conta; ZZP3 (CNPJ C só abandonado) não conta; ZZP4 (CNPJ A, 43 dias depois) fora da janela de 30.
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999200001, 'ZZP1', 'PEDIDO CADASTRADO',       '2000-06-05 00:00-03', '00.000.000/0002-02'),
  (999200002, 'ZZP1', 'PEDIDO CADASTRADO',       '2000-06-05 00:00-03', '00.000.000/0002-02'),
  (999200003, 'ZZP2', 'VENDA PERDIDA (NEOCRM)',  '2000-06-05 00:00-03', '00.000.000/0001-01'),
  (999200004, 'ZZP3', 'PEDIDO CADASTRADO',       '2000-06-05 00:00-03', '00.000.000/0003-03'),
  (999200005, 'ZZP4', 'PEDIDO CADASTRADO',       '2000-07-18 00:00-03', '00.000.000/0001-01');

do $$
declare r record; n int; v_ok boolean;
begin
  -- discador_periodo precisa ser inlinável (sem security definer nem SET) para usar o índice de gerada_em
  assert not (select prosecdef from pg_proc where oid = 'public.discador_periodo(date,date,text)'::regprocedure), 'discador_periodo não é security definer';
  assert (select proconfig is null from pg_proc where oid = 'public.discador_periodo(date,date,text)'::regprocedure), 'discador_periodo sem SET';

  execute 'set local role authenticated';

  -- consultor: tudo recusado com 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d102', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d102', true);
  begin perform public.discador_resumo('2000-06-05', '2000-06-05'); assert false, 'consultor não pode ler resumo';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_consultores('2000-06-05', '2000-06-05'); assert false, 'consultor não pode ler consultores';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_mailing('2000-06-05', '2000-06-05', 'carga'); assert false, 'consultor não pode ler mailing';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d102'); assert false, 'consultor não vincula';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_vendas_atribuidas('2000-06-05', '2000-06-05', 'apex'); assert false, 'função interna fechada para authenticated';
  exception when insufficient_privilege then null; end;

  -- supervisor
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d101', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d101', true);

  select * into r from public.discador_resumo('2000-06-05', '2000-06-05');
  assert r.tentativas = 6, 'tentativas 6, veio ' || r.tentativas;
  assert r.contato = 4, 'contato 4 (3 ANSWERED + 1 ABANDONED), veio ' || r.contato;
  assert r.atendidas = 3, 'atendidas 3, veio ' || r.atendidas;
  assert r.abandonadas = 1, 'abandonadas 1';
  assert r.sem_tabulacao = 1, 'sem tabulação 1';
  assert r.seg_falados_medio = 70, 'média falada (60+120+30)/3 = 70, veio ' || r.seg_falados_medio;
  assert r.vendas = 1, 'uma venda (ZZP1 uma vez; perdido, só-abandonado e fora da janela não contam), veio ' || r.vendas;
  assert r.abandono_alerta = 0.15, 'abandono_alerta da config';

  select * into r from public.discador_por_hora('2000-06-05', '2000-06-05') where hora = 10;
  assert r.tentativas = 3 and r.atendidas = 2 and r.abandonadas = 1, '10h: 3 tentativas, 2 atendidas, 1 abandonada';
  assert r.media_atendidas = 0.5 and r.media_abandonadas = 0.5, '10h: média de 2 segundas de referência = 0,5 e 0,5';
  select count(*) into n from public.discador_por_hora('2000-06-05', '2000-06-05');
  assert n = 16, 'horas 7 a 22 = 16 linhas';
  select count(*) into n from public.discador_por_hora('2000-06-05', '2000-06-06') where media_atendidas is not null;
  assert n = 0, 'sem média quando o período tem mais de um dia';

  select count(*) into n from public.discador_mapa_calor('2000-06-05', '2000-06-05') where dia_semana = 1 and hora = 11 and tentativas = 3 and contato = 1;
  assert n = 1, 'mapa de calor: segunda 11h com 3 tentativas e 1 contato';

  select * into r from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900001;
  assert r.nome = 'Zzdcons Teste', 'agente vinculado mostra o nome do consultor';
  assert r.atendidas = 2 and r.seg_falados_total = 180 and r.sem_avanco = 1 and r.sem_tabulacao = 1 and r.vendas = 0, 'linha do agente 900001';
  select * into r from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900002;
  assert r.nome = 'Agente 900002' and r.ganhos = 1 and r.vendas = 1, 'agente sem vínculo aparece como "Agente N" e leva a venda';

  select count(*) into n from public.discador_consultor_dias(900002, '2000-06-05', '2000-06-05') where dia = '2000-06-05' and atendidas = 1 and vendas = 1;
  assert n = 1, 'detalhe por dia do agente 900002';

  select * into r from public.discador_mailing('2000-06-05', '2000-06-05', 'carga') where chave = 'ZZ-CARGA-2';
  assert r.tentativas = 3 and r.contato = 1 and r.ganhos = 1 and r.vendas = 1, 'mailing por carga ZZ-CARGA-2';
  select * into r from public.discador_mailing('2000-06-05', '2000-06-05', 'carga') where chave = 'ZZ-CARGA-1';
  assert r.tentativas = 3 and r.abandonadas = 1 and r.vendas = 0, 'mailing por carga ZZ-CARGA-1';
  select count(*) into n from public.discador_mailing('2000-06-05', '2000-06-05', 'cidade');
  assert n = 0, 'cidade com menos de 300 tentativas não aparece';
  begin perform public.discador_mailing('2000-06-05', '2000-06-05', 'x'); assert false, 'dimensão inválida';
  exception when invalid_parameter_value then null; end;
  begin perform public.discador_resumo('2000-06-05', '1999-12-01'); assert false, 'período invertido';
  exception when invalid_parameter_value then null; end;
  begin perform public.discador_resumo('2000-01-01', '2000-06-30'); assert false, 'período acima de 120 dias';
  exception when invalid_parameter_value then null; end;

  select count(*) into n from public.discador_resumo('2000-07-18', '2000-07-18') where vendas = 0;
  assert n = 1, 'ZZP4 (43 dias depois da chamada) fica fora da janela de 30 dias';

  -- supervisor também não vincula (só admin)
  begin perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d102'); assert false, 'supervisor não vincula';
  exception when insufficient_privilege then null; end;

  -- admin vincula; nome passa a aparecer
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d103', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d103', true);
  perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d101', '  ');
  select nome = 'Zzdsup Teste' into v_ok from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900002;
  assert v_ok, 'depois do vínculo o agente 900002 mostra o nome';
  begin perform public.discador_vincular_agente(0, null); assert false, 'agente inválido';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
