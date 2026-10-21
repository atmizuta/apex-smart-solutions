-- Rollback dos índices da base de mailing (seção 102).
drop index if exists mailing.linha_prioridade;
drop index if exists mailing.extracao_criado;
