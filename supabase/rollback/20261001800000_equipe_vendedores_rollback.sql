-- Rollback de 20261001800000_equipe_vendedores.sql. Sem a função o painel manda a lista vazia e a matriz volta a mostrar
-- só quem vendeu no mês (comportamento antigo); nada quebra.
drop function if exists public.equipe_vendedores();
