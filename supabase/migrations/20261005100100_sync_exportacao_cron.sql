-- 05/10/2026 — sync-exportacao (categoria da venda perdida) de hora em hora, no minuto 41. REGRAS_NEGOCIO.md §70.
-- Minuto 41: longe do 59 (produção), do 17 (robô) e dos múltiplos de 15 (alerta). Segredo no Vault, como as outras.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-exportacao-horario';

select cron.schedule('sync-exportacao-horario', '41 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-exportacao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
