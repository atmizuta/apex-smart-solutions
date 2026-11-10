-- §146.1: tick da distribuição a cada 1 min (o próprio tick sai cedo em manual e fora do expediente).
-- Voltar atrás: select cron.unschedule('leads-dist-tick');
select cron.schedule('leads-dist-tick', '* * * * *', $job$select public.leads_dist_tick()$job$);
