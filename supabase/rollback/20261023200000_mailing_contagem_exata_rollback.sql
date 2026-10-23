-- Desfaz a seção 110 (contagem completa da Base de Mailing). O painel antigo continua contando pela amostra.
select cron.unschedule('mailing-contagem') where exists (select 1 from cron.job where jobname = 'mailing-contagem');
select cron.unschedule('mailing-contagem-limpeza') where exists (select 1 from cron.job where jobname = 'mailing-contagem-limpeza');
drop function if exists mailing.contar_proxima();
drop table if exists mailing.contagem;
