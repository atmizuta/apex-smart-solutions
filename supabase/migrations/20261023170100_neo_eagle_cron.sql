-- Seção 108 (23/10/2026): sync-neo-eagle de madrugada, 02:33 e 03:33 em São Paulo (05:33 e 06:33 UTC).
-- A segunda rodada cobre a primeira se a API recusar (LIMITE_API); gravar é idempotente (upsert por pedido).
-- A Eagle é outra estrutura na Xeotech: não divide o limite de consultas com a sync-producao/sync-exportacao da Apex.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-neo-eagle';

select cron.schedule('sync-neo-eagle', '33 5,6 * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-neo-eagle',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
