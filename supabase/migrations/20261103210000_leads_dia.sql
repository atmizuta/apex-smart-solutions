-- §135: placar do dia (leads_dia_equipe) e relatório do consultor (leads_dia_consultor) na aba Equipe.
-- Só leitura, sem tabela nova, sem apagar nada. Spec: docs/superpowers/specs/2026-11-03-equipe-placar-relatorio-dia-design.md

-- Interna: um item por (consultor, lead) que ele pegou ou recebeu no dia, com o primeiro contato depois disso
-- (ligação dele para o telefone do lead, mesma regra chave_tel da ficha, ou clique dele no lead) e as ligações do dia.
create or replace function public.leads_dia_leads(p_dia date)
 returns table(dono_id uuid, lead_aba text, lead_id text, como text, de_dono uuid, em timestamptz, primeiro_contato timestamptz, ligacoes int)
 language sql stable security definer set search_path to 'public'
as $function$
  with lim as (
    select (p_dia::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
  ), ent as (
    select h.por as d, h.lead_aba, h.lead_id, 'pegou'::text as como, null::uuid as de, h.em
      from public.leads_historico h, lim
     where h.acao = 'pegar' and h.por is not null and h.em >= lim.ini and h.em < lim.fim
    union all
    select (h.depois ->> 'dono_id')::uuid, h.lead_aba, h.lead_id, 'recebeu', nullif(h.antes ->> 'dono_id', '')::uuid, h.em
      from public.leads_historico h, lim
     where h.acao = 'redistribuir' and nullif(h.depois ->> 'dono_id', '') is not null and h.em >= lim.ini and h.em < lim.fim
  ), pri as (   -- o mesmo lead para a mesma pessoa duas vezes no dia: vale a primeira entrada
    select distinct on (ent.d, ent.lead_aba, ent.lead_id) ent.* from ent order by ent.d, ent.lead_aba, ent.lead_id, ent.em
  )
  select p.d, p.lead_aba, p.lead_id, p.como, p.de, p.em,
         least(
           (select min(m.gerada_em) from public.ligacoes_manuais m, lim
             where eq.usu is not null and lower(btrim(m.usuario)) = eq.usu and public.chave_tel(l.phone_number) is not null
               and m.chave_tel = public.chave_tel(l.phone_number) and m.gerada_em >= p.em and m.gerada_em < lim.fim),
           (select min(c.em) from public.leads_contatos c, lim
             where c.lead_aba = p.lead_aba and c.lead_id = p.lead_id and c.profile_id = p.d and c.em >= p.em and c.em < lim.fim)),
         (select count(*) from public.ligacoes_manuais m, lim
           where eq.usu is not null and lower(btrim(m.usuario)) = eq.usu and public.chave_tel(l.phone_number) is not null
             and m.chave_tel = public.chave_tel(l.phone_number) and m.gerada_em >= lim.ini and m.gerada_em < lim.fim)::int
    from pri p
    join public.leads l on l.aba = p.lead_aba and l.id = p.lead_id
    left join lateral (select nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as usu
                         from public.leads_equipe e where e.profile_id = p.d order by e.id limit 1) eq on true
$function$;

create or replace function public.leads_dia_equipe(p_dia date default ((now() at time zone 'America/Sao_Paulo')::date))
 returns table(dono_id uuid, nome text, tem_telefonia boolean, pegos int, recebidos int, perdidos int, ligacoes int, atendidas int,
               min_falados int, whatsapp int, primeiro_contato_mediana_min numeric, sem_ligar int, classificados int, obs int,
               retornos_feitos int, retornos_atrasados int, vendas int, receita numeric, jornada_inicio timestamptz,
               jornada_fim timestamptz, posicao int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini timestamptz; v_fim timestamptz; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'data no futuro' using errcode = '22023'; end if;
  v_ini := p_dia::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
  with eq as (
    select distinct on (e.profile_id) e.profile_id as e_id, p.nome as e_nome,
           nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id
     where e.profile_id is not null order by e.profile_id, e.id
  ), h as (
    select x.* from public.leads_historico x where x.em >= v_ini and x.em < v_fim
  ), lig as (
    select lower(btrim(m.usuario)) as u, m.gerada_em as t, m.atendida as at, m.seg_falados as seg
      from public.ligacoes_manuais m where m.gerada_em >= v_ini and m.gerada_em < v_fim
  ), ctt as (
    select c.profile_id as pid, c.em as t, c.canal from public.leads_contatos c where c.em >= v_ini and c.em < v_fim
  ), ld as (
    select * from public.leads_dia_leads(p_dia)
  ), vend as (   -- venda: o dia começou sem venda (antes da 1ª classificação) e terminou com venda (depois da última)
    select v.por as v_por, count(*)::int as n, coalesce(sum(v.rec), 0) as rec from (
      select distinct on (x.por, x.lead_aba, x.lead_id) x.por,
             coalesce((x.depois ->> 'converteu')::boolean, false) as fim_conv,
             nullif(x.depois ->> 'receita', '')::numeric as rec,
             (select coalesce((y.antes ->> 'converteu')::boolean, false) from h y
               where y.acao = 'classificar' and y.por = x.por and y.lead_aba = x.lead_aba and y.lead_id = x.lead_id
               order by y.em limit 1) as ini_conv
        from h x where x.acao = 'classificar' and x.por is not null
       order by x.por, x.lead_aba, x.lead_id, x.em desc) v
     where v.fim_conv and not v.ini_conv group by v.por
  ), ativ as (
    select a.d, min(a.t) as ini, max(a.t) as fim from (
      select eq.e_id as d, lig.t from eq join lig on lig.u = eq.e_u
      union all select ctt.pid, ctt.t from ctt
      union all select h.por, h.em from h where h.acao in ('pegar', 'classificar')
    ) a group by a.d
  ), base as (
    select eq.e_id, eq.e_nome, eq.e_u is not null as b_tel,
      (select count(*) from h where h.acao = 'pegar' and h.por = eq.e_id)::int as b_pegos,
      (select count(*) from h where h.acao = 'redistribuir' and h.depois ->> 'dono_id' = eq.e_id::text)::int as b_receb,
      (select count(*) from h where h.acao in ('redistribuir', 'devolver') and h.antes ->> 'dono_id' = eq.e_id::text
                                 and coalesce(h.depois ->> 'dono_id', '') <> eq.e_id::text)::int as b_perd,
      (select count(*) from lig where eq.e_u is not null and lig.u = eq.e_u)::int as b_lig,
      (select count(*) from lig where eq.e_u is not null and lig.u = eq.e_u and lig.at)::int as b_at,
      round(coalesce((select sum(lig.seg) from lig where eq.e_u is not null and lig.u = eq.e_u), 0) / 60.0)::int as b_min,
      (select count(*) from ctt where ctt.pid = eq.e_id and ctt.canal = 'whatsapp')::int as b_wpp,
      (select round((percentile_cont(0.5) within group (order by extract(epoch from ld.primeiro_contato - ld.em) / 60))::numeric, 1)
         from ld where ld.dono_id = eq.e_id and ld.primeiro_contato is not null) as b_med,
      (select count(*) from ld where ld.dono_id = eq.e_id and ld.primeiro_contato is null)::int as b_sem,
      (select count(*) from h where h.acao = 'classificar' and h.por = eq.e_id)::int as b_cla,
      (select count(*) from h where h.acao = 'classificar' and h.por = eq.e_id
          and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
          and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), ''))::int as b_obs,
      (select count(*) from public.agenda_retornos a
        where a.consultor_id = eq.e_id and a.quando >= v_ini and a.quando < v_fim and a.status = 'feito')::int as b_rf,
      (select count(*) from public.agenda_retornos a
        where a.consultor_id = eq.e_id and a.quando >= v_ini and a.quando < v_fim and a.status = 'pendente' and a.quando < now())::int as b_ra,
      coalesce((select vend.n from vend where vend.v_por = eq.e_id), 0) as b_vend,
      coalesce((select vend.rec from vend where vend.v_por = eq.e_id), 0) as b_rec,
      (select ativ.ini from ativ where ativ.d = eq.e_id) as b_ji,
      (select ativ.fim from ativ where ativ.d = eq.e_id) as b_jf
    from eq
  )
  select b.e_id, b.e_nome, b.b_tel, b.b_pegos, b.b_receb, b.b_perd, b.b_lig, b.b_at, b.b_min, b.b_wpp, b.b_med, b.b_sem,
         b.b_cla, b.b_obs, b.b_rf, b.b_ra, b.b_vend, b.b_rec, b.b_ji, b.b_jf,
         (row_number() over (order by b.b_vend desc, b.b_at desc, b.e_nome))::int
    from base b
   order by b.b_vend desc, b.b_at desc, b.e_nome;
end $function$;

create or replace function public.leads_dia_consultor(p_dono uuid, p_dia date)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_ini timestamptz; v_fim timestamptz; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_u text; v_num jsonb; v_media jsonb; v_hora jsonb; v_par jsonb := '[]'::jsonb; v_leads jsonb; v_perd jsonb; v_pend jsonb;
        v_exp timestamptz; v_corte timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'data no futuro' using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = p_dono) then
    raise exception 'consultor fora da equipe de leads' using errcode = '22023';
  end if;
  v_ini := p_dia::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
  select nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') into v_u
    from public.leads_equipe e where e.profile_id = p_dono order by e.id limit 1;

  select to_jsonb(d) into v_num from public.leads_dia_equipe(p_dia) d where d.dono_id = p_dono;
  select jsonb_build_object(
           'pegos', round(avg(d.pegos + d.recebidos)::numeric, 1), 'ligacoes', round(avg(d.ligacoes)::numeric, 1),
           'atendidas', round(avg(d.atendidas)::numeric, 1), 'min_falados', round(avg(d.min_falados)::numeric, 1),
           'whatsapp', round(avg(d.whatsapp)::numeric, 1), 'sem_ligar', round(avg(d.sem_ligar)::numeric, 1),
           'classificados', round(avg(d.classificados)::numeric, 1), 'obs', round(avg(d.obs)::numeric, 1),
           'retornos_feitos', round(avg(d.retornos_feitos)::numeric, 1), 'retornos_atrasados', round(avg(d.retornos_atrasados)::numeric, 1),
           'vendas', round(avg(d.vendas)::numeric, 1), 'receita', round(avg(d.receita)::numeric, 2),
           'primeiro_contato_mediana_min', (select round((percentile_cont(0.5) within group (order by extract(epoch from l.primeiro_contato - l.em) / 60))::numeric, 1)
                                              from public.leads_dia_leads(p_dia) l where l.primeiro_contato is not null))
    into v_media
    from public.leads_dia_equipe(p_dia) d where d.jornada_inicio is not null or d.pegos + d.recebidos > 0;

  select jsonb_agg(jsonb_build_object('h', g.h, 'ligacoes', coalesce(x.n, 0), 'atendidas', coalesce(x.a, 0)) order by g.h) into v_hora
    from generate_series(13, 20) as g(h)
    left join (select extract(hour from m.gerada_em at time zone 'America/Sao_Paulo')::int as hh, count(*)::int as n,
                      (count(*) filter (where m.atendida))::int as a
                 from public.ligacoes_manuais m
                where v_u is not null and lower(btrim(m.usuario)) = v_u and m.gerada_em >= v_ini and m.gerada_em < v_fim
                group by 1) x on x.hh = g.h;

  -- parados: expediente 13h–21h, seg–sex; intervalos > 30 min sem ligação, clique, pegar ou classificar
  v_exp := v_ini + interval '13 hours';
  v_corte := least(v_ini + interval '21 hours', now());
  if extract(isodow from p_dia) < 6 and v_corte > v_exp then
    with t as (
      select v_exp as em
      union all select m.gerada_em from public.ligacoes_manuais m
                 where v_u is not null and lower(btrim(m.usuario)) = v_u and m.gerada_em > v_exp and m.gerada_em < v_corte
      union all select c.em from public.leads_contatos c where c.profile_id = p_dono and c.em > v_exp and c.em < v_corte
      union all select h.em from public.leads_historico h
                 where h.por = p_dono and h.acao in ('pegar', 'classificar') and h.em > v_exp and h.em < v_corte
      union all select v_corte
    ), g as (select t.em as de, lead(t.em) over (order by t.em) as ate from t)
    select coalesce(jsonb_agg(jsonb_build_object('de', g.de, 'ate', g.ate, 'min', floor(extract(epoch from g.ate - g.de) / 60)::int) order by g.de), '[]'::jsonb)
      into v_par from g where g.ate is not null and g.ate - g.de > interval '30 minutes';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'aba', l.lead_aba, 'lead_id', l.lead_id, 'nome', ld.full_name, 'como', l.como, 'de_nome', pd.nome, 'em', l.em,
           'primeiro_contato_min', case when l.primeiro_contato is not null then round((extract(epoch from l.primeiro_contato - l.em) / 60)::numeric, 1) end,
           'ligacoes', l.ligacoes, 'status', st.status, 'vendeu', coalesce(st.conv, false), 'receita', st.rec) order by l.em), '[]'::jsonb)
    into v_leads
    from public.leads_dia_leads(p_dia) l
    join public.leads ld on ld.aba = l.lead_aba and ld.id = l.lead_id
    left join public.profiles pd on pd.id = l.de_dono
    left join lateral (select x.depois ->> 'status' as status, (x.depois ->> 'converteu')::boolean as conv,
                              nullif(x.depois ->> 'receita', '')::numeric as rec
                         from public.leads_historico x
                        where x.lead_aba = l.lead_aba and x.lead_id = l.lead_id and x.acao = 'classificar' and x.em < v_fim
                        order by x.em desc limit 1) st on true
   where l.dono_id = p_dono;

  select coalesce(jsonb_agg(jsonb_build_object('aba', h.lead_aba, 'lead_id', h.lead_id, 'nome', ld.full_name, 'em', h.em,
                                               'para_nome', coalesce(nullif(h.depois ->> 'consultor', ''), 'Livres')) order by h.em), '[]'::jsonb)
    into v_perd
    from public.leads_historico h join public.leads ld on ld.aba = h.lead_aba and ld.id = h.lead_id
   where h.acao in ('redistribuir', 'devolver') and h.em >= v_ini and h.em < v_fim
     and h.antes ->> 'dono_id' = p_dono::text and coalesce(h.depois ->> 'dono_id', '') <> p_dono::text;

  v_pend := jsonb_build_object(
    'retornos_atrasados', (select coalesce(jsonb_agg(jsonb_build_object('aba', a.lead_aba, 'lead_id', a.lead_id, 'nome', a.nome, 'quando', a.quando) order by a.quando), '[]'::jsonb)
                             from public.agenda_retornos a where a.consultor_id = p_dono and a.status = 'pendente' and a.quando < now()),
    'sem_contato', (select coalesce(jsonb_agg(jsonb_build_object('aba', l.aba, 'lead_id', l.id, 'nome', l.full_name, 'pego_em', l.pego_em) order by l.pego_em), '[]'::jsonb)
                      from public.leads l where l.dono_id = p_dono and l.categoria = 'sem_contato' and l.apagado_em is null));

  return jsonb_build_object('dia', p_dia, 'historico_desde', '2026-10-27', 'numeros', v_num, 'media_equipe', v_media,
                            'por_hora', coalesce(v_hora, '[]'::jsonb), 'parados', v_par, 'leads', v_leads, 'perdidos', v_perd, 'pendencias', v_pend);
end $function$;

revoke execute on function public.leads_dia_leads(date) from public, anon, authenticated;
revoke execute on function public.leads_dia_equipe(date) from public, anon;
revoke execute on function public.leads_dia_consultor(uuid, date) from public, anon;
grant execute on function public.leads_dia_equipe(date) to authenticated;
grant execute on function public.leads_dia_consultor(uuid, date) to authenticated;
