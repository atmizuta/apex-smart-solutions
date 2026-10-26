-- Desfaz as migrations 20261026120000..120300 (§112). Rodar na ordem inversa da aplicação.
begin;
-- cron da virada (se existir)
select cron.unschedule('planilha-espelho') where exists (select 1 from cron.job where jobname = 'planilha-espelho');
-- 120400
drop function if exists public.leads_espelho_travar(int);
drop function if exists public.leads_espelho_destravar(text);
delete from public.config where chave = 'leads_espelho_rodada';
-- 120300
drop function if exists public.leads_espelho_pegar(int);
drop function if exists public.leads_espelho_feito(jsonb);
drop function if exists public.leads_espelho_falha(jsonb, text);
drop function if exists public.leads_espelho_adiar(jsonb, text);
drop function if exists public.leads_espelho_atraso();
-- 120200
drop function if exists public.leads_digital_admin();
grant select on public.leads to authenticated;
-- 120100
drop function if exists public.leads_pegar(text, text);
drop function if exists public.leads_classificar(text, text, text, text, boolean, numeric, date);
drop function if exists public.leads_redistribuir(text, text, uuid);
drop function if exists public.leads_kanban(uuid);
drop function if exists public.leads_kanban_resumo();
drop function if exists public.leads_kanban_versao();
drop function if exists public.leads_espelho_reescrever(text);
drop function if exists public.leads_entrada(jsonb);
-- 120000
drop function if exists public.leads_espelho_enfileirar(text, text);
drop function if exists public.leads_mes_aba(timestamptz);
drop table if exists public.leads_espelho;
drop table if exists public.leads_historico;
drop table if exists public.leads_status_opcoes;
drop index if exists public.idx_leads_dono;
drop index if exists public.idx_leads_livres;
drop index if exists public.idx_leads_id;
alter table public.leads
  drop column if exists dono_id, drop column if exists pego_em, drop column if exists classificado_em,
  drop column if exists classificado_por, drop column if exists retorno_em, drop column if exists aba_planilha;
delete from public.config where chave in ('leads_modo', 'leads_planilha', 'leads_espelho_aviso');
commit;
