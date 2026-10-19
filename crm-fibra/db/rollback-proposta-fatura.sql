-- Desfaz a proposta com fatura (sub-projeto 5): remove as quatro colunas e o que elas guardam.
-- Republique ANTES o código anterior: a ficha lê essas colunas e quebraria sem elas.
alter table crm_fibra.propostas drop column if exists situacao_atual;
alter table crm_fibra.proposta_itens drop column if exists franquia_gb;
alter table crm_fibra.proposta_itens drop column if exists quantidade;
alter table crm_fibra.catalogo_planos drop column if exists franquia_gb;
