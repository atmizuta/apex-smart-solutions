-- Rollback de 20261002100100_sync_leads_10min.sql: volta aos minutos 22 e 52 (seção 62).
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';

select cron.schedule('sync-leads-auto', '22,52 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-leads',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
