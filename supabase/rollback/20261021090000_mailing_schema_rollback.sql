-- Rollback da base de mailing (seção 102): remove o schema inteiro (dados e registro de extrações).
drop schema if exists mailing cascade;
