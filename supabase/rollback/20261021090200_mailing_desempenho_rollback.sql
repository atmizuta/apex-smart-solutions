-- Rollback do desempenho da base de mailing (seção 102).
drop table if exists mailing.amostra;
alter table mailing.linha
  drop column if exists socio_nome,
  drop column if exists razao_social,
  drop column if exists primeira_da_empresa,
  drop column if exists primeira_do_fone;
