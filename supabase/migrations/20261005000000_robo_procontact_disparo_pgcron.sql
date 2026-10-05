-- 05/10/2026 — o pg_cron passa a disparar o robô ProContact (GitHub Actions) de hora em hora. REGRAS_NEGOCIO.md §69.
-- Motivo: o agendamento do próprio GitHub (cron do workflow) atrasa 40+ min e pula horários — em 02 e 03/10 disparou
-- 2–4 vezes por dia em vez de 15, e na segunda 05/10 nenhuma vez até as 14h. O pg_cron é pontual.
-- Minuto 17 das 10h às 01h UTC = 07:17 às 22:17 em São Paulo (o robô recusa sozinho domingo e fora de 07–22h).
-- O token (GitHub fine-grained, só o repositório apex-robo-procontact, permissão Actions: read/write) fica no Vault
-- com o nome github_robo_token — foi gravado pelo Rafael direto no SQL Editor; NUNCA no repositório.
-- O agendamento do GitHub continua como reserva: execuções a mais não duplicam nada (upsert por id) e o workflow
-- não roda duas vezes ao mesmo tempo (concurrency). Idempotente: remove o job antigo (se houver) e recria.
select cron.unschedule(jobid) from cron.job where jobname = 'robo-procontact-disparo';

select cron.schedule('robo-procontact-disparo', '17 10-23,0-1 * * *', $job$
  select net.http_post(
    url := 'https://api.github.com/repos/rafaangelao/apex-robo-procontact/actions/workflows/sincronizar.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_robo_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'apex-supabase-pgcron',
      'Content-Type', 'application/json'),
    body := '{"ref":"main","inputs":{"modo":"real"}}'::jsonb,
    timeout_milliseconds := 30000);
$job$);
