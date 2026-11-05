-- §137: relatório do paralelo (só leitura). Trocar a data pelo início do paralelo (config leads_meta.paralelo_desde).
-- Critério: chegou_so_pela_planilha = 0 todo dia, e todo id de ids_da_meta aparece na guia do mês (conferir só a coluna id).
with base as (
  select l.id, l.criado_em_lead, l.origem_entrada, l.meta_visto_em,
         exists (select 1 from public.leads_webhook_log w where w.lead_id = l.id) as webhook_viu
    from public.leads l where l.criado_em_lead >= timestamptz '2026-11-05 00:00-03' and l.apagado_em is null
)
select (criado_em_lead at time zone 'America/Sao_Paulo')::date as dia,
       count(*) filter (where origem_entrada = 'meta') as entrou_pelo_webhook,
       count(*) filter (where origem_entrada = 'planilha') as entrou_pela_planilha,
       count(*) filter (where origem_entrada = 'planilha' and meta_visto_em is null and not webhook_viu) as chegou_so_pela_planilha,
       string_agg(id, ', ') filter (where origem_entrada = 'planilha' and meta_visto_em is null and not webhook_viu) as ids_so_planilha
  from base group by 1 order by 1;

-- leads que o webhook gravou primeiro: conferir na guia do mês (a planilha-espelho não deixa rastro desses)
select (criado_em_lead at time zone 'America/Sao_Paulo')::date as dia, aba, string_agg(id, ', ' order by criado_em_lead) as ids_da_meta
  from public.leads
 where origem_entrada = 'meta' and criado_em_lead >= timestamptz '2026-11-05 00:00-03' and apagado_em is null
 group by 1, 2 order by 1, 2;

-- recebimentos do webhook (o ensaio também aparece aqui)
select date_trunc('hour', recebido_em at time zone 'America/Sao_Paulo') as hora, modo, resultado, count(*)
  from public.leads_webhook_log where recebido_em >= now() - interval '3 days' group by 1, 2, 3 order by 1 desc;
