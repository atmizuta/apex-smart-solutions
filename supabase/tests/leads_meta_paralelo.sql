-- §137: relatório do paralelo (só leitura). Trocar a data pelo início do paralelo.
with base as (
  select id, aba, criado_em_lead, origem_entrada, meta_visto_em
    from public.leads where criado_em_lead >= timestamptz '2026-11-05 00:00-03' and apagado_em is null
)
select (criado_em_lead at time zone 'America/Sao_Paulo')::date as dia,
       count(*) filter (where origem_entrada = 'meta') as entrou_pela_meta,
       count(*) filter (where origem_entrada = 'planilha') as entrou_pela_planilha,
       count(*) filter (where meta_visto_em is null) as meta_nao_viu,
       string_agg(id, ', ') filter (where meta_visto_em is null) as ids_que_a_meta_nao_viu
  from base group by 1 order by 1;

-- §137 (revisão): leads que a Meta gravou primeiro. A planilha-espelho não manda ao banco id que ele já tem, então
-- não fica rastro de a planilha também ter recebido. Conferir estes ids na guia do mês (só a coluna id, com a conta
-- de serviço). Critério do paralelo: todo id daqui aparece na guia do mês.
select (criado_em_lead at time zone 'America/Sao_Paulo')::date as dia, aba, string_agg(id, ', ' order by criado_em_lead) as ids_da_meta
  from public.leads
 where origem_entrada = 'meta' and criado_em_lead >= timestamptz '2026-11-05 00:00-03' and apagado_em is null
 group by 1, 2 order by 1, 2;
