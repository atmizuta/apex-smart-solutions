-- Verificação de 20261016170000_discador_ajustes.sql (§97). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into public.discador_chamadas (id, gerada_em, atendida_em, fim_em, status, agente_id, seg_falados, campanha) values
  -- atendimento sem fim no meio (10:12): não pode inventar pausa de 10:00 até 10:24
  (999700001, '2000-06-05 10:00-03', '2000-06-05 10:00:02-03', '2000-06-05 10:00:30-03', 'ANSWERED', 900005, 28, 'DISCADOR-APEX-ZZ'),
  (999700002, '2000-06-05 10:12-03', '2000-06-05 10:12:02-03', null,                      'ANSWERED', 900005, 0,  'DISCADOR-APEX-ZZ'),
  (999700003, '2000-06-05 10:24-03', '2000-06-05 10:24:02-03', '2000-06-05 10:24:40-03', 'ANSWERED', 900005, 38, 'DISCADOR-APEX-ZZ'),
  -- atravessando a meia-noite: 23:50 de um dia e 00:20 do outro não são pausa
  (999700004, '2000-06-05 23:50-03', '2000-06-05 23:50:02-03', '2000-06-05 23:51:02-03', 'ANSWERED', 900006, 60, 'DISCADOR-APEX-ZZ'),
  (999700005, '2000-06-06 00:20-03', '2000-06-06 00:20:02-03', '2000-06-06 00:21:02-03', 'ANSWERED', 900006, 60, 'DISCADOR-APEX-ZZ');
do $$
declare n int;
begin
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-06', 'apex', 900005);
  assert n = 0, 'atendimento sem fim_em não cria pausa falsa, veio ' || n;
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-06', 'apex', 900006);
  assert n = 0, 'virada de dia não é pausa, veio ' || n;
  assert to_regprocedure('public.discador_consultor_dias(int,date,date,text)') is null, 'discador_consultor_dias removida';
end $$;
rollback;
