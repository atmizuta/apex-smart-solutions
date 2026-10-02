-- Rollback de 20261002100000_velocidade_lead_mesa.sql. Reverter o PAINEL antes (sem as funções, o card e a Mesa
-- só mostram "não foi possível carregar"; nada mais quebra). Apaga os cliques registrados (leads_contatos).
drop function if exists public.mesa_vendas_mes(date);
drop function if exists public.mesa_ligacoes_hoje(date);
drop function if exists public.mesa_pendencias(date);
drop function if exists public.mesa_leads_relogio(timestamptz);
drop function if exists public.meus_leads_relogio();
drop function if exists public.registrar_contato_lead(text, text, text);
drop table if exists public.leads_contatos;
alter table public.leads drop column if exists primeira_sync_em;
delete from public.config where chave = 'velocidade_lead';
