select cron.unschedule(jobid) from cron.job where jobname = 'discador-limpeza';
delete from public.config where chave = 'discador';
drop table if exists public.discador_sync_log;
drop table if exists public.discador_agente;
drop table if exists public.discador_chamadas;
