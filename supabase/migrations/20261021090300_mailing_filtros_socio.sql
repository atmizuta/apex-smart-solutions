-- Base de Mailing (seção 102.7): filtros do sócio, pedido do Rafael em 21/10/2026.
-- Sexo (M/F/I), geração (Z/Y/X/BOOMER/VETERANO) e faixa de risco do score (MUITO BAIXO … MUITO ALTO).
-- Servem SÓ para filtrar: não vão no arquivo do ProContact. Antes ficavam fora do banco pela lista de LGPD; o Rafael
-- liberou estes três só como filtro. Os valores vêm do sócio da linha (o do telefone ou, sem ele, o principal).
alter table mailing.linha
  add column sexo text,
  add column geracao text,
  add column faixa_risco text;

alter table mailing.amostra
  add column sexo text,
  add column geracao text,
  add column faixa_risco text;
