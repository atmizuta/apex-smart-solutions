-- Rollback de 20261001700000_ligacoes_ignora_eagle.sql: volta a aceitar ligações de usuários eagle.*.
-- As ligações apagadas NÃO voltam sozinhas: reenviar o Excel da telefonia no Monitoramento Leads (com o painel da seção 65
-- revertido, porque o painel também ignora eagle.* no upload).
drop trigger if exists ligacoes_manuais_ignora_eagle on public.ligacoes_manuais;
drop function if exists public.ligacoes_manuais_ignora_eagle();
