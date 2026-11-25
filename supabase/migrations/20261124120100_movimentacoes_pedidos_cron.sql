-- 24/11/2026 — §166 sync-pedidos-neo. Atualizações a cada 10 min das 08 às 22 h SP (:03…:53) e 1x/h fora disso (:03);
-- Movimentação :08 e :38. ≥ 5 min entre as duas (guarda de 120 s da Xeotech). Segredo no Vault, como as outras.
-- pg_cron roda em UTC: 08–22 h SP = 11–01 h UTC.
-- Desligar: select cron.unschedule(jobid) from cron.job where jobname like 'neo-pedidos-%';
select cron.unschedule(jobid) from cron.job where jobname in ('neo-pedidos-atualizacoes-dia', 'neo-pedidos-atualizacoes-noite', 'neo-pedidos-movimentacao');
select cron.schedule('neo-pedidos-atualizacoes-dia', '3,13,23,33,43,53 0,1,11-23 * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"atualizacoes"}'::jsonb, timeout_milliseconds := 120000);
$job$);
select cron.schedule('neo-pedidos-atualizacoes-noite', '3 2-10 * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"atualizacoes"}'::jsonb, timeout_milliseconds := 120000);
$job$);
select cron.schedule('neo-pedidos-movimentacao', '8,38 * * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"movimentacao"}'::jsonb, timeout_milliseconds := 120000);
$job$);
