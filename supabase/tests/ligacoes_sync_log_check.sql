-- Verificação de ligacoes_sync_log. Roda SOMENTE depois de a migration estar aplicada e SEMPRE termina em ROLLBACK.
begin;

do $$
declare n int;
begin
  assert to_regclass('public.ligacoes_sync_log') is not null, 'tabela ligacoes_sync_log existe';

  insert into public.ligacoes_sync_log (execucao_id, iniciou_em, ok, lidas, enviadas)
    values ('00000000-0000-0000-0000-000000000001', now() - interval '1 minute', true, 10, 8);

  -- execucao_id é único (retentativa do robô não duplica)
  begin
    insert into public.ligacoes_sync_log (execucao_id, iniciou_em, ok)
      values ('00000000-0000-0000-0000-000000000001', now(), true);
    assert false, 'execucao_id repetido deveria falhar';
  exception when unique_violation then null;
  end;

  -- RLS ligada e sem política de escrita
  assert (select relrowsecurity from pg_class where oid = 'public.ligacoes_sync_log'::regclass), 'RLS ligada';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ligacoes_sync_log' and cmd in ('INSERT','UPDATE','DELETE','ALL');
  assert n = 0, 'nenhuma política de escrita (só a service role grava)';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ligacoes_sync_log' and cmd = 'SELECT';
  assert n = 1, 'uma política de leitura';
end $$;

rollback;
