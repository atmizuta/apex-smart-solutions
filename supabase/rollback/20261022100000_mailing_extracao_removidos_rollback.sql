-- Desfaz 20261022100000_mailing_extracao_removidos.sql.
alter table mailing.extracao drop column if exists removidos_neo, drop column if exists removidos_repetidos;
