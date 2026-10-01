-- Desfaz a virada: o dashboard volta a ler a tabela do upload manual (com os dados de antes da virada).
begin;
drop view public.producao_pedidos;
alter table public.producao_pedidos_manual rename to producao_pedidos;
commit;
