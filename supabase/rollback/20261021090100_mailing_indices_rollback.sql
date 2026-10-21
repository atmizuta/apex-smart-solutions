-- Rollback dos índices da base de mailing (seção 102).
drop index if exists mailing.linha_padrao_prioridade;
drop index if exists mailing.linha_operadora_ddd;
drop index if exists mailing.extracao_criado;
