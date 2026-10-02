-- 02/10/2026 — sync-leads a cada 10 min (era 22,52). REGRAS_NEGOCIO.md §68 (velocidade do lead).
-- Minutos 2,12,22,32,42,52: fora dos múltiplos de 15 do alerta e do minuto 59 da produção. pg_cron em UTC.
-- Mesmo corpo da seção 62 (20261001400000_sync_leads_cron.sql); o segredo continua no Vault.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';

select cron.schedule('sync-leads-auto', '2-59/10 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-leads',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
