-- Base de Mailing (seção 102.8): filtros pedidos pelo Rafael em 21/10/2026.
-- posicao = em que coluna de telefone o número estava na planilha comprada (1 a 4; o 1 é o de mais contato).
-- rf_ddd_cidade = DDD da cidade da empresa (Receita). Já estava na linha; agora vai também para a amostra, que conta.
-- O filtro de DDD da aba passa a ser este, e não o DDD do telefone.
alter table mailing.linha add column posicao smallint;

alter table mailing.amostra
  add column posicao smallint,
  add column rf_ddd_cidade smallint;
