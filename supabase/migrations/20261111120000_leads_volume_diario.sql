-- §148 (11/11, Rafael): gráfico "Leads por dia" na Conversão (Meus leads) — volume diário dos últimos 190 dias (90 de gráfico + 90 de comparação) para passar à agência.
-- leads_volume_diario(): só somas por dia (fuso de SP) e recorte (plataforma, tipo, linhas, campanha, Repique) — nada de cliente,
-- telefone, e-mail, CNPJ ou id de lead. Mesmas permissões da conversao_resumo (admin, agência, supervisor/consultor da Apex).
-- Volta UM jsonb (array de arrays [dia, plataforma, tipo, linhas, campanha, repique, leads, convertidos, receita]): uma linha só,
-- então o limite de linhas por resposta da API (db-max-rows) nunca corta o dia a dia (~1.900 recortes hoje).
-- Campanha com o texto de erro da Meta ("Você não tem permissão…") volta nula: a tela mostra "Sem nome (erro Meta)".
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_volume_diario_check.sql (desfaz tudo).
begin;

create or replace function public.leads_volume_diario()
 returns jsonb
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_role text; v_op text; v_saida jsonb;
begin
  select p.role, coalesce(p.operacao, 'apex') into v_role, v_op from public.profiles p where p.id = auth.uid();
  if v_role is null or not (v_role in ('admin', 'agencia') or (v_role in ('supervisor', 'consultor') and v_op = 'apex')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  with base as (
    select (l.criado_em_lead at time zone 'America/Sao_Paulo')::date as b_dia,
           case lower(trim(coalesce(l.platform, ''))) when 'fb' then 'fb' when 'ig' then 'ig' when '' then null else 'outro' end as b_plat,
           case when l.tipo_empresa ilike 'mei%' then 'mei' when l.tipo_empresa ilike 'empresa%' then 'empresa' else null end as b_tipo,
           case when l.qtd_linhas ilike '1%' then '1' when l.qtd_linhas ilike '2%' then '2-5' when l.qtd_linhas ilike 'mais%' then '5+' else null end as b_lin,
           case when l.campaign_name ilike 'você não tem permiss%' then null else nullif(trim(l.campaign_name), '') end as b_camp,
           upper(trim(coalesce(l.aba, ''))) = 'REPIQUE' as b_rep,
           coalesce(l.converteu, false) as b_conv, l.receita as b_receita
      from public.leads l
     where l.apagado_em is null and l.criado_em_lead is not null
       and l.criado_em_lead >= ((now() at time zone 'America/Sao_Paulo')::date - 190) at time zone 'America/Sao_Paulo'
  ), g as (
    select b.b_dia, b.b_plat, b.b_tipo, b.b_lin, b.b_camp, b.b_rep,
           count(*)::int as g_leads,
           (count(*) filter (where b.b_conv))::int as g_conv,
           round(coalesce(sum(b.b_receita) filter (where b.b_conv), 0), 2) as g_rec
      from base b
     group by b.b_dia, b.b_plat, b.b_tipo, b.b_lin, b.b_camp, b.b_rep
  )
  select coalesce(jsonb_agg(jsonb_build_array(to_char(g.b_dia, 'YYYY-MM-DD'), g.b_plat, g.b_tipo, g.b_lin, g.b_camp, g.b_rep, g.g_leads, g.g_conv, g.g_rec)
                            order by g.b_dia), '[]'::jsonb)
    into v_saida from g;
  return v_saida;
end $function$;

revoke all on function public.leads_volume_diario() from public, anon;
grant execute on function public.leads_volume_diario() to authenticated, agencia, service_role;

commit;
