-- §148: conferência da migration 20261111120000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'. O corpo abaixo é cópia da migration.
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

do $$
declare v_admin uuid; v_dif int; v_dias int; v_total bigint; v_ok boolean := false; v_ok2 boolean := false; v_cons uuid;
begin
  if has_function_privilege('anon', 'public.leads_volume_diario()', 'execute') then raise exception 'FALHOU: anon executa leads_volume_diario'; end if;
  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  create temp table zz_vol on commit drop as
    select (e->>0)::date as dia, e->>1 as plataforma, e->>2 as tipo, e->>3 as linhas, e->>4 as campanha, (e->>5)::boolean as repique,
           (e->>6)::int as leads, (e->>7)::int as convertidos, (e->>8)::numeric as receita
      from jsonb_array_elements(public.leads_volume_diario()) e;

  -- total por dia bate com a tabela (fuso de SP, sem apagados)
  select count(*) into v_dif from (
    (select r.dia, sum(r.leads)::bigint, sum(r.convertidos)::bigint from zz_vol r group by r.dia
     except
     select (l.criado_em_lead at time zone 'America/Sao_Paulo')::date, count(*), count(*) filter (where l.converteu)
       from public.leads l where l.apagado_em is null and l.criado_em_lead >= now() - interval '95 days' group by 1)
  ) x where x.dia >= (now() at time zone 'America/Sao_Paulo')::date - 94;
  if v_dif <> 0 then raise exception 'FALHOU: % dia(s) com total diferente entre leads_volume_diario e leads', v_dif; end if;
  select count(distinct r.dia), sum(r.leads) into v_dias, v_total from zz_vol r;
  if exists (select 1 from zz_vol r where r.campanha ilike 'você não tem%') then raise exception 'FALHOU: texto de erro da Meta saiu como campanha'; end if;
  if exists (select 1 from zz_vol r where r.plataforma not in ('fb', 'ig', 'outro') or r.linhas not in ('1', '2-5', '5+') or r.tipo not in ('mei', 'empresa')) then
    raise exception 'FALHOU: recorte fora dos valores esperados';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform 1 from public.leads_volume_diario(); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU: usuário sem perfil leu o volume'; end if;

  select p.id into v_cons from public.profiles p where p.role = 'consultor' and coalesce(p.operacao, 'apex') <> 'apex' limit 1;
  if v_cons is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
    begin perform 1 from public.leads_volume_diario(); exception when insufficient_privilege then v_ok2 := true; end;
    if not v_ok2 then raise exception 'FALHOU: consultor de fora da Apex leu o volume'; end if;
  end if;

  raise exception 'RESULTADO: OK — % dias, % leads, totais por dia batem, sem perfil recusado, fora da Apex %', v_dias, v_total, case when v_cons is null then 'sem caso' else 'recusado' end;
end $$;
