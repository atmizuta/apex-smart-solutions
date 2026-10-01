-- Rollback de 20261001500000_sync_producao_minuto_59.sql: volta a sincronização horária da produção para o minuto 7.
select cron.alter_job(jobid, schedule := '7 * * * *') from cron.job where jobname = 'sync-producao-horario';
