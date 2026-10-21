-- Rollback da posição do telefone e do DDD da cidade na amostra (seção 102.8).
alter table mailing.linha drop column if exists posicao;
alter table mailing.amostra drop column if exists posicao, drop column if exists rf_ddd_cidade;
