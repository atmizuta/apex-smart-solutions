-- crm-fibra/db/rollback-abordagens.sql
-- Desfaz a entrega "abordagem por IA": apaga a tabela abordagens e todos os
-- roteiros salvos. Publique antes o código sem a aba (ou volte o deploy
-- anterior): a ficha do lead lê essa tabela e quebraria sem ela.

drop table if exists crm_fibra.abordagens;
