-- Rollback de 20261001400000_sync_leads_cron.sql: desliga a sincronização automática dos leads.
-- O botão "Atualizar agora" continua funcionando. A trava de mês e o aviso no painel continuam (são da função).
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';
