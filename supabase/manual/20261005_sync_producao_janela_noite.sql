-- 05/10/2026: sync da produção (NeoSales) de 10 em 10 min das 20:30 às 21:30 (SP). Ver REGRAS_NEGOCIO.md seção 59.
-- Já aplicado em produção (jobs 13 e 14); guardado aqui para versionamento.
select cron.schedule('sync-producao-janela-noite-a', '30,40,50 23 * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);
select cron.schedule('sync-producao-janela-noite-b', '0,10,20,30 0 * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);
select cron.alter_job(1, schedule := '59 0-22 * * *'); -- evita colisão com a execução das 21:00
