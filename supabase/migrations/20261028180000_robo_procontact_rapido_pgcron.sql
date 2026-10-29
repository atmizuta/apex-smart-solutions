-- 28/10/2026 — rodada RÁPIDA do robô ProContact: chamadas manuais de 15 em 15 min. REGRAS_NEGOCIO.md §127.
-- O job robo-procontact-disparo (minuto 17, §69) continua igual: rodada completa = manuais do mês inteiro + discador.
-- Este job dispara nos minutos 02, 32 e 47 com rapido=sim: o robô puxa só as manuais de HOJE e pula o discador (~2 min).
-- 0 e 10–23 UTC = 21h e 07–20h em São Paulo; o robô na rodada rápida recusa sozinho domingo e fora de 07–22h
-- (mesmo disparado pela API). Mesmo token do Vault (github_robo_token) do job das 17. Idempotente: remove e recria.
-- Reverter: select cron.unschedule('robo-procontact-rapido');  (a rodada de hora em hora segue sozinha)
select cron.unschedule(jobid) from cron.job where jobname = 'robo-procontact-rapido';

select cron.schedule('robo-procontact-rapido', '2,32,47 0,10-23 * * *', $job$
  select net.http_post(
    url := 'https://api.github.com/repos/rafaangelao/apex-robo-procontact/actions/workflows/sincronizar.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_robo_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'apex-supabase-pgcron',
      'Content-Type', 'application/json'),
    body := '{"ref":"main","inputs":{"modo":"real","rapido":"sim"}}'::jsonb,
    timeout_milliseconds := 30000);
$job$);
