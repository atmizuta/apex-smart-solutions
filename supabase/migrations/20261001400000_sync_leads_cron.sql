-- 01/10/2026 — sincronização automática dos leads (planilha do Google -> public.leads) a cada 30 min.
-- REGRAS_NEGOCIO.md seção 62. Idempotente: remove o job antigo (se houver) e recria.
-- O segredo NÃO está aqui: é lido do Vault (sync_producao_cron_secret, o mesmo da sync-producao) em tempo de
-- execução e conferido pela função contra o secret SYNC_CRON_SECRET. Minutos 22 e 52: longe da sync-producao
-- (minuto 7) e fora dos múltiplos de 15 do alerta. pg_cron roda em UTC (horário de SP = UTC-3).
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';

select cron.schedule('sync-leads-auto', '22,52 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-leads',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
