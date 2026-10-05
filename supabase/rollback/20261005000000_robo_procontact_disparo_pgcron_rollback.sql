-- Rollback de 20261005000000_robo_procontact_disparo_pgcron.sql: tira o disparo pelo pg_cron (o agendamento do
-- GitHub continua). Para apagar também o token do Vault (opcional):
--   delete from vault.secrets where name = 'github_robo_token';
select cron.unschedule(jobid) from cron.job where jobname = 'robo-procontact-disparo';
