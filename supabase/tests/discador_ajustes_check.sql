-- Verificação de 20261016170000_discador_ajustes.sql (§97). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000a701', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.gadm@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values ('00000000-0000-0000-0000-00000000a701', 'Zzgadm Teste', 'zz.gadm', 'admin', 'apex')
on conflict (id) do update set role = excluded.role;
insert into public.discador_chamadas (id, gerada_em, atendida_em, fim_em, status, agente_id, seg_falados, campanha) values
  -- atendimento sem fim no meio (10:12): não pode inventar pausa de 10:00 até 10:24
  (999700001, '2000-06-05 10:00-03', '2000-06-05 10:00:02-03', '2000-06-05 10:00:30-03', 'ANSWERED', 900005, 28, 'DISCADOR-APEX-ZZ'),
  (999700002, '2000-06-05 10:12-03', '2000-06-05 10:12:02-03', null,                      'ANSWERED', 900005, 0,  'DISCADOR-APEX-ZZ'),
  (999700003, '2000-06-05 10:24-03', '2000-06-05 10:24:02-03', '2000-06-05 10:24:40-03', 'ANSWERED', 900005, 38, 'DISCADOR-APEX-ZZ'),
  -- atravessando a meia-noite: 23:50 de um dia e 00:20 do outro não são pausa
  (999700004, '2000-06-05 23:50-03', '2000-06-05 23:50:02-03', '2000-06-05 23:51:02-03', 'ANSWERED', 900006, 60, 'DISCADOR-APEX-ZZ'),
  (999700005, '2000-06-06 00:20-03', '2000-06-06 00:20:02-03', '2000-06-06 00:21:02-03', 'ANSWERED', 900006, 60, 'DISCADOR-APEX-ZZ'),
  -- atendida do CNPJ 00000000000909
  (999700006, '2000-06-05 11:00-03', '2000-06-05 11:00:02-03', '2000-06-05 11:01:02-03', 'ANSWERED', 900007, 60, 'DISCADOR-APEX-ZZ');
update public.discador_chamadas set cnpj = '00000000000909' where id = 999700006;
-- pedido com 15 dígitos cujo começo é esse CNPJ: antes o lpad cortava e casava; agora fica de fora
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999800001, 'ZZS1', 'PEDIDO CADASTRADO', '2000-06-05 00:00-03', '000000000009091');
do $$
declare n int;
begin
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-06', 'apex', 900005);
  assert n = 0, 'atendimento sem fim_em não cria pausa falsa, veio ' || n;
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-06', 'apex', 900006);
  assert n = 0, 'virada de dia não é pausa, veio ' || n;
  assert to_regprocedure('public.discador_consultor_dias(int,date,date,text)') is null, 'discador_consultor_dias removida';
  select count(*) into n from public.discador_vendas_atribuidas('2000-06-05', '2000-06-05', 'apex') where numero_pedido = 'ZZS1';
  assert n = 0, 'CNPJ com 15 dígitos não casa com outro';
  assert not has_table_privilege('authenticated', 'public.discador_chamadas', 'TRUNCATE'), 'TRUNCATE revogado';
  -- período: 120 dias contando os extremos é o máximo (como admin)
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a701', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a701', true);
  perform public.discador_resumo('2000-01-01', '2000-04-29');
  begin perform public.discador_resumo('2000-01-01', '2000-04-30'); assert false, '121 dias deveria ser recusado';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
