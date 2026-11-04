-- §137: leads-meta a cada 1 min (24 h). Aplicar só depois do deploy da função (Task 7). pg_cron em UTC.
-- Mesmo segredo do Vault da sync-leads; a função lê SYNC_CRON_SECRET. Com modo desligado, a rodada sai cedo.
select cron.unschedule(jobid) from cron.job where jobname = 'leads-meta';

select cron.schedule('leads-meta', '* * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/leads-meta',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000);
$job$);
