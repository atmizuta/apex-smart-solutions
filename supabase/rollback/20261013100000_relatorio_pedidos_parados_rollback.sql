-- Desfaz 20261013100000_relatorio_pedidos_parados.sql (apaga destinatários e histórico de envios).
select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';
drop function if exists public.relatorio_pedidos_parados_linhas();
drop table if exists public.relatorio_envio_log;
drop table if exists public.relatorio_destinatarios;
