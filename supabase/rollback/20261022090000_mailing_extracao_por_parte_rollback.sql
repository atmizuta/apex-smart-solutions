-- Desfaz 20261022090000_mailing_extracao_por_parte.sql (a função volta a gravar uma linha por chamada).
drop index if exists mailing.extracao_pedido_parte;
alter table mailing.extracao drop column if exists parte, drop column if exists pedido;
