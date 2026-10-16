-- Verificação de 20261016150000_discador_raiox.sql (§96). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000f101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000f102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fsupc@teste.invalid'),
  ('00000000-0000-0000-0000-00000000f103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.fcons@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000f101', 'Zzfadm Teste',  'zz.fadm',  'admin',      'apex'),
  ('00000000-0000-0000-0000-00000000f102', 'Zzfsupc Teste', 'zz.fsupc', 'supervisor', 'campinas'),
  ('00000000-0000-0000-0000-00000000f103', 'Zzfcons Teste', 'zz.fcons', 'consultor',  'apex')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;
insert into public.discador_chamadas (id, gerada_em, atendida_em, fim_em, status, agente_id, seg_falados, seg_espera, tabulacao, campanha, cnpj) values
  (999500001, '2000-06-05 10:00-03', '2000-06-05 10:00:02-03', '2000-06-05 10:00:12-03', 'ANSWERED', 900001, 10,  2, 'SEM AVANÇO', 'DISCADOR-APEX-ZZ', '00000000000101'),
  (999500002, '2000-06-05 10:05-03', '2000-06-05 10:05:02-03', '2000-06-05 10:06:02-03', 'ANSWERED', 900001, 60,  2, 'RETORNO',    'DISCADOR-APEX-ZZ', '00000000000202'),
  (999500003, '2000-06-05 10:20-03', '2000-06-05 10:20:02-03', '2000-06-05 10:22:02-03', 'ANSWERED', 900002, 120, 4, null,         'DISCADOR-APEX-ZZ', '00000000000303'),
  (999500004, '2000-06-05 10:40-03', '2000-06-05 10:40:02-03', '2000-06-05 10:40:32-03', 'ANSWERED', 900001, 30,  2, 'DESCARTE',   'DISCADOR-APEX-ZZ', '00000000000404'),
  (999500005, '2000-06-05 10:50-03', '2000-06-05 10:50:02-03', '2000-06-05 10:50:07-03', 'ANSWERED', 900001, 5,   2, null,         'DISCADOR-APEX-ZZ', '00000000000505'),
  (999500006, '2000-06-05 11:30-03', '2000-06-05 11:30:02-03', '2000-06-05 11:30:42-03', 'ANSWERED', 900001, 40,  2, 'AQUISIÇÃO - GANHO', 'DISCADOR-APEX-ZZ', '00000000000606'),
  (999500007, '2000-06-05 10:30-03', '2000-06-05 10:30:02-03', '2000-06-05 10:31:02-03', 'ANSWERED', 900003, 60,  2, null,         'MIGRACAO-CLARO-ZZ', '00000000000707');
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999600001, 'ZZR1', 'PEDIDO CADASTRADO', '2000-06-05 00:00-03', '00.000.000/0006-06');

do $$
declare r record; j jsonb; n int;
begin
  -- pausas (como dono, antes de trocar de papel): 10:06→10:40 (34 min, equipe teve contato) e 10:50→11:30 (39 min, equipe parada)
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001);
  assert n = 2, 'duas pausas longas (>15 min), veio ' || n;
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001) where minutos = 34 and not equipe_sem_chamadas;
  assert n = 1, 'pausa 10:06–10:40 conta (equipe atendeu às 10:20)';
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900001) where minutos = 39 and equipe_sem_chamadas;
  assert n = 1, 'pausa 10:50–11:30 marcada equipe sem chamadas';
  select count(*) into n from public.discador_pausas('2000-06-05', '2000-06-05', 'apex', 900002);
  assert n = 0, 'agente com um só atendimento não tem pausa (nada depois do último)';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f103', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f103', true);
  begin perform public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05'); assert false, 'consultor não lê o Raio-X';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f101', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f101', true);
  select * into r from public.discador_consultores('2000-06-05', '2000-06-05') where agente_id = 900001;
  assert r.atendidas = 5 and r.horas_ativas = 2 and r.pausas = 1 and r.curtas = 2, 'colunas novas: 5 atendidas, 2 horas ativas, 1 pausa (a outra é da equipe), 2 curtas';
  assert to_char(r.jornada_inicio at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' and to_char(r.jornada_fim at time zone 'America/Sao_Paulo', 'HH24:MI') = '11:30', 'jornada 10:00–11:30';
  select * into r from public.discador_consultores('2000-06-05', '2000-06-06') where agente_id = 900001;
  assert r.jornada_inicio is null and r.horas_ativas = 2, 'em vários dias, jornada nula e horas ativas somadas';

  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05');
  assert j ->> 'operacao' = 'apex', 'operação';
  assert jsonb_array_length(j -> 'dias') = 1 and (j -> 'dias' -> 0 ->> 'atendidas')::int = 5 and (j -> 'dias' -> 0 ->> 'horas_ativas')::int = 2
     and (j -> 'dias' -> 0 ->> 'pausas')::int = 1 and (j -> 'dias' -> 0 ->> 'min_pausa')::int = 34, 'dias';
  assert jsonb_array_length(j -> 'por_hora') = 13 and (select (x ->> 'atendidas')::int from jsonb_array_elements(j -> 'por_hora') x where (x ->> 'hora')::int = 10) = 4, 'por hora: 4 às 10h';
  assert jsonb_array_length(j -> 'pausas') = 2, 'lista com as duas pausas (inclusive a da equipe)';
  assert (j -> 'qualidade' -> 'agente' ->> 'curtas')::int = 2 and (j -> 'qualidade' -> 'agente' ->> 'seg_falados_medio_sem_curtas')::int = 43, 'qualidade: 2 curtas; média sem curtas (60+30+40)/3 = 43';
  assert (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'sem_avanco')::int = 1 and (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'ganho')::int = 1 and (j -> 'qualidade' -> 'agente' -> 'mix' ->> 'sem_tabulacao')::int = 1, 'mix';
  assert (j -> 'qualidade' -> 'equipe' ->> 'atendidas')::int = 6, 'equipe da apex: 6 atendidas (Campinas fora)';
  assert (j -> 'resultado' -> 'semana_atual' ->> 'vendas')::int = 1 and (j -> 'resultado' -> 'semana_atual' ->> 'atendidas')::int = 5, 'resultado: 1 venda e 5 atendidas na semana';
  assert jsonb_array_length(j -> 'resultado' -> 'dias') = 7, '7 dias úteis';
  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-06');
  assert jsonb_array_length(j -> 'por_hora') = 0 and jsonb_array_length(j -> 'pausas') = 0, 'vários dias: sem por hora nem lista de pausas';
  j := public.discador_consultor_raiox(900001, '2000-06-07', '2000-06-07');
  assert jsonb_array_length(j -> 'dias') = 0 and (j -> 'qualidade' -> 'agente' ->> 'atendidas')::int = 0, 'dia sem atendimento: vazio e zerado';

  -- supervisor de Campinas: só vê Campinas; o agente da Apex vem vazio; pedir apex = 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f102', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f102', true);
  j := public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05');
  assert j ->> 'operacao' = 'campinas' and jsonb_array_length(j -> 'dias') = 0, 'agente da Apex não aparece para Campinas';
  begin perform public.discador_consultor_raiox(900001, '2000-06-05', '2000-06-05', 'apex'); assert false, 'campinas pedindo apex';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
