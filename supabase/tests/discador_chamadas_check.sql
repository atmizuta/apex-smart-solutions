-- Verificação de 20261014100000_discador_chamadas.sql (§82). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
do $$
declare n int;
begin
  assert to_regclass('public.discador_chamadas') is not null, 'tabela discador_chamadas existe';
  assert to_regclass('public.discador_agente') is not null, 'tabela discador_agente existe';
  assert to_regclass('public.discador_sync_log') is not null, 'tabela discador_sync_log existe';

  -- nome e CPF não têm coluna
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'discador_chamadas' and column_name in ('nome', 'cpf', 'documento_1', 'nome_desc');
  assert n = 0, 'discador_chamadas não tem coluna de nome/CPF';

  -- upsert por id não duplica
  insert into public.discador_chamadas (id, gerada_em, status) values (999000001, '2000-01-03 10:00-03', 'BUSY');
  insert into public.discador_chamadas (id, gerada_em, status, tabulacao) values (999000001, '2000-01-03 10:00-03', 'ANSWERED', 'RETORNO')
    on conflict (id) do update set status = excluded.status, tabulacao = excluded.tabulacao;
  select count(*) into n from public.discador_chamadas where id = 999000001 and status = 'ANSWERED' and tabulacao = 'RETORNO';
  assert n = 1, 'upsert por id atualiza a linha';

  -- execucao_id único no log
  insert into public.discador_sync_log (execucao_id, iniciou_em, ok) values ('00000000-0000-0000-0000-00000000d001', now(), true);
  begin
    insert into public.discador_sync_log (execucao_id, iniciou_em, ok) values ('00000000-0000-0000-0000-00000000d001', now(), true);
    assert false, 'execucao_id repetido deveria falhar';
  exception when unique_violation then null;
  end;

  -- RLS ligada, só leitura por política, nenhuma política de escrita
  select count(*) into n from pg_class where oid in ('public.discador_chamadas'::regclass, 'public.discador_agente'::regclass, 'public.discador_sync_log'::regclass) and relrowsecurity;
  assert n = 3, 'RLS ligada nas 3 tabelas';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('discador_chamadas', 'discador_agente', 'discador_sync_log') and cmd <> 'SELECT';
  assert n = 0, 'nenhuma política de escrita';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('discador_chamadas', 'discador_agente', 'discador_sync_log') and cmd = 'SELECT';
  assert n = 3, 'uma política de leitura por tabela';

  -- configuração e cron
  assert (select (valor::jsonb ->> 'abandono_alerta')::numeric from public.config where chave = 'discador') = 0.15, 'config.discador.abandono_alerta = 0.15';
  assert (select (valor::jsonb ->> 'janela_venda_dias')::int from public.config where chave = 'discador') = 30, 'config.discador.janela_venda_dias = 30';
  select count(*) into n from cron.job where jobname = 'discador-limpeza' and schedule = '30 7 * * *';
  assert n = 1, 'cron discador-limpeza às 07:30 UTC';
end $$;
rollback;
