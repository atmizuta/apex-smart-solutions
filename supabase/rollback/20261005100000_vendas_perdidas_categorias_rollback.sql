-- Rollback de 20261005100000_vendas_perdidas_categorias.sql. Reverter o painel antes (sem a RPC a aba só mostra
-- "não foi possível carregar"). Apaga as categorias sincronizadas (podem ser trazidas de novo pela sync-exportacao).
drop function if exists public.vendas_perdidas(date, date);
drop table if exists public.exportacao_sync_log;
drop table if exists public.producao_atividades;
