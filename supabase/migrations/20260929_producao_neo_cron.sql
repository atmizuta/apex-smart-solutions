-- Agendamento da sincronização da produção (NeoSales). Idempotente: remove o job antigo e recria.
-- O segredo NÃO está aqui: é lido do Vault (sync_producao_cron_secret) em tempo de execução.
-- pg_cron roda em UTC; São Paulo = UTC-3 (sem horário de verão).

select cron.unschedule(jobid) from cron.job
 where jobname like 'sync-producao-%';

-- De hora em hora (minuto 7): janela desde o último sucesso - 15 min (no máx. 85 min de dia).
select cron.schedule('sync-producao-horario', '7 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);

-- 23:37 (SP), fora da janela diurna e longe do job horário (minuto 7): refaz os últimos 2 dias — cura qualquer lacuna.
select cron.schedule('sync-producao-reconciliar', '37 2 * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"reconciliar"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);

-- Carga inicial ÚNICA, uma consulta por job: a NeoSales só aceita 1 consulta a cada ~2 min e a função faz
-- só uma por execução. 5 janelas mensais, uma a cada 5 min a partir das 22:12 (SP) de 29/09/2026 (= 01:12 UTC
-- de 30/09), sempre longe do job horário (minuto 7). Cada job se desagenda (o cron de 30/09 repetiria todo ano).
do $do$
declare
  r record;
begin
  for r in
    select * from (values
      (1, '2026-05-01 00:00:00', '2026-06-01 00:00:00'),
      (2, '2026-06-01 00:00:00', '2026-07-01 00:00:00'),
      (3, '2026-07-01 00:00:00', '2026-08-01 00:00:00'),
      (4, '2026-08-01 00:00:00', '2026-09-01 00:00:00'),
      (5, '2026-09-01 00:00:00', null)            -- sem "fim": vai até o momento da execução
    ) as t(n, ini, fim) order by n
  loop
    perform cron.schedule(
      'sync-producao-backfill-' || r.n,
      (12 + (r.n - 1) * 5) || ' 1 30 9 *',
      format($job$
        select net.http_post(
          url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
          headers := jsonb_build_object('Content-Type','application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
          body := %L::jsonb,
          timeout_milliseconds := 10000);
        select cron.unschedule('sync-producao-backfill-%s');
      $job$,
      (jsonb_build_object('modo','backfill','inicio', r.ini)
        || case when r.fim is null then '{}'::jsonb else jsonb_build_object('fim', r.fim) end)::text,
      r.n)
    );
  end loop;
end
$do$;
