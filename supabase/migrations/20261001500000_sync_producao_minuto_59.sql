-- 01/10/2026 — sincronização horária da produção (NeoSales) passa do minuto 7 para o minuto 59.
-- REGRAS_NEGOCIO.md seção 63. Motivo: o relatório das 17h (seção 56) corta em 16:59 e precisa dos pedidos
-- sincronizados ANTES das 17:00 (com o minuto 7 os dados mais novos eram das 16:07).
-- A janela da consulta vem do cursor (última execução ok) com 15 min de sobreposição, então trocar o minuto não
-- abre lacuna (a 1ª rodada no minuto 59 cobre ~67 min, abaixo do limite diurno de 85 min). Só muda o horário;
-- o comando (URL, segredo do Vault, corpo) continua o mesmo da migration 20260929_producao_neo_cron.sql.
-- Distância dos outros jobs que chamam funções: sync-leads-auto (22, 52), reconciliação (02:37 UTC).
select cron.alter_job(jobid, schedule := '59 * * * *') from cron.job where jobname = 'sync-producao-horario';
