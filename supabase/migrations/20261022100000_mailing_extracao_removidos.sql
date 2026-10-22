-- Base de Mailing (seção 102.12): remover duplicados e cruzar com o NEO (22/10/2026, pedido do Rafael).
-- O painel tira do arquivo as empresas com pedido no NeoSales e os telefones repetidos, completando a quantidade.
-- quantidade_entregue continua sendo o que saiu da base; estas colunas dizem quantas dessas linhas o painel removeu.
alter table mailing.extracao
  add column removidos_neo integer not null default 0,
  add column removidos_repetidos integer not null default 0;
