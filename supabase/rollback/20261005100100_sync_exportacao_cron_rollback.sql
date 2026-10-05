-- Rollback de 20261005100100_sync_exportacao_cron.sql.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-exportacao-horario';
