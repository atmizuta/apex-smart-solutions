-- Rollback da amostra por empresa e por telefone (seção 102.9). Depois dele, recarregar a amostra antiga pelo
-- 09_carga_supabase.py de antes (2% das linhas, com linha_id) para voltar a ter a chave por linha_id.
alter table mailing.amostra drop constraint amostra_pkey;
alter table mailing.amostra drop column if exists na_empresa, drop column if exists no_fone;
