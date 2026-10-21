-- Rollback dos filtros do sócio da base de mailing (seção 102.7).
alter table mailing.linha drop column if exists sexo, drop column if exists geracao, drop column if exists faixa_risco;
alter table mailing.amostra drop column if exists sexo, drop column if exists geracao, drop column if exists faixa_risco;
