-- Desfaz 20261001000000_monitoramento_leads.sql. Reverta o PAINEL antes (o painel novo chama estas RPCs).
-- Apaga as ligações importadas e a lista da equipe de leads (as metas em config.monitor_leads_metas ficam).
drop function if exists public.meus_leads_para_tratar();
drop function if exists public.monitor_ligacoes_resumo();
drop function if exists public.monitor_ligacoes_por_usuario(date, date, date);
drop function if exists public.monitor_leads_leads(text);
drop table if exists public.leads_equipe;
drop table if exists public.ligacoes_manuais;
drop function if exists public.norm_nome(text);
drop function if exists public.chave_tel(text);
