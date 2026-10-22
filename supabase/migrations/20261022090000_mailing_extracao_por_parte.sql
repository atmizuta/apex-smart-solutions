-- Base de Mailing (seção 102.10): extração em trechos (22/10/2026, erro do Guilherme com filtro fino).
-- Cada chamada da função lê um trecho limitado da base; um arquivo do pedido junta vários trechos. O histórico continua
-- com uma linha por arquivo: pedido (gerado no navegador) + parte (número do arquivo), somando o que cada trecho entregou.
-- Tabela pequena (dezenas de linhas): sem efeito na base de 12 mi.
alter table mailing.extracao
  add column pedido uuid,
  add column parte smallint;
create unique index extracao_pedido_parte on mailing.extracao (pedido, parte);
