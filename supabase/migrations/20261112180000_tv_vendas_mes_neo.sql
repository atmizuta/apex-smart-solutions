-- §149.1 (12/11, Rafael): "quando clica em Mês só está contando as vendas do dia". As vendas marcadas (Vendi!/lead)
-- só existem a partir de 12/11/2026; antes disso o Mês fica vazio. Agora as vendas antes de 12/11 vêm da NEO
-- (pedidos de consultores ligados em consultor_neo, sem perdido/devolvido; GROSS já não entra, §49) e, de 12/11 em
-- diante, das vendas marcadas. A mesma conta vale para o ranking e para a posição do VENDEU! (tv_posicao_mes).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_vendas_mes_check.sql.
begin;

create or replace function public.tv_vendas_periodo(p_de date, p_ate date, p_ate_id bigint)
 returns table(consultor_id uuid, vendas int, receita numeric)
 language sql stable security definer set search_path to 'public'
as $$
  with neo as (
    select c.profile_id as consultor_id, n.numero_pedido, sum(coalesce(n.valor, 0)) as receita
      from public.producao_pedidos_neo n
      join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
     where n.cadastro >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and n.cadastro <  (least(p_ate + 1, date '2026-11-12')::timestamp at time zone 'America/Sao_Paulo')
       and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)') and n.numero_pedido is not null
     group by c.profile_id, n.numero_pedido
  ), tv as (
    select v.consultor_id, v.receita
      from public.vendas_marcadas v
     where v.operacao = 'apex' and v.cancelada_em is null
       and v.dia between greatest(p_de, date '2026-11-12') and p_ate
       and (p_ate_id is null or v.id <= p_ate_id)
  )
  select x.consultor_id, count(*)::int, sum(x.receita)
    from (select neo.consultor_id, neo.receita from neo union all select tv.consultor_id, tv.receita from tv) x
   group by x.consultor_id
$$;

create or replace function public.tv_posicao_mes(p_consultor uuid, p_ate_id bigint, p_de date, p_ate date)
 returns int language sql stable security definer set search_path to 'public'
as $$
  with v as (
    select t.consultor_id, t.vendas as n, t.receita as r
      from public.tv_vendas_periodo(p_de, p_ate, p_ate_id) t
      join public.profiles p on p.id = t.consultor_id and coalesce(p.operacao, 'apex') = 'apex'
  ), o as (select v.consultor_id, rank() over (order by v.n desc, v.r desc) as pos from v)
  select o.pos::int from o where o.consultor_id = p_consultor
$$;

create or replace function public.tv_ranking(p_periodo text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_hoje date := public.tv_hoje(); v_de date; v_linhas jsonb; v_tot jsonb; v_ult jsonb; v_meta jsonb;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_periodo is null or p_periodo not in ('hoje', 'mes') then raise exception 'período inválido' using errcode = '22023'; end if;
  v_de := case when p_periodo = 'hoje' then v_hoje else date_trunc('month', v_hoje)::date end;
  with cont as (select * from public.tv_contatos(v_de, v_hoje)),
  vend as (select t.consultor_id, t.vendas, t.receita from public.tv_vendas_periodo(v_de, v_hoje, null) t),
  base as (
    select p.id, p.nome, coalesce(c.contatos, 0) as contatos, coalesce(x.vendas, 0) as vendas, coalesce(x.receita, 0) as receita
      from public.profiles p
      left join cont c on c.profile_id = p.id
      left join vend x on x.consultor_id = p.id
     where coalesce(p.operacao, 'apex') = 'apex'
       and ((p.role = 'consultor' and (coalesce(c.contatos, 0) > 0 or coalesce(x.vendas, 0) > 0)) or coalesce(x.vendas, 0) > 0)
  ), ord as (
    select b.*, case when b.vendas > 0 then rank() over (partition by (b.vendas > 0) order by b.vendas desc, b.receita desc) end as posicao
      from base b
  )
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', o.id, 'nome', o.nome, 'contatos', o.contatos, 'vendas', o.vendas,
             'receita', o.receita, 'conversao', case when o.contatos > 0 then round(100.0 * o.vendas / o.contatos, 1) end,
             'posicao', o.posicao) order by o.vendas desc, o.receita desc, o.contatos desc, o.nome), '[]'::jsonb),
         jsonb_build_object('contatos', coalesce(sum(o.contatos), 0), 'vendas', coalesce(sum(o.vendas), 0),
             'receita', coalesce(sum(o.receita), 0),
             'conversao', case when sum(o.contatos) > 0 then round(100.0 * sum(o.vendas) / sum(o.contatos), 1) end)
    into v_linhas, v_tot
    from ord o;
  v_meta := jsonb_build_object('dia', v_hoje, 'meta', public.tv_meta_atual(),
    'vendas_hoje', (select count(*) from public.vendas_marcadas v where v.operacao = 'apex' and v.cancelada_em is null and v.dia = v_hoje));
  select jsonb_build_object('nome', p.nome, 'em', v.marcada_em) into v_ult
    from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
   where v.operacao = 'apex' and v.cancelada_em is null order by v.id desc limit 1;
  return jsonb_build_object('periodo', p_periodo, 'de', v_de, 'ate', v_hoje, 'linhas', v_linhas, 'totais', v_tot,
                            'meta', v_meta, 'ultima', v_ult, 'gerado_em', now());
end $function$;

revoke all on function public.tv_vendas_periodo(date, date, bigint) from public, anon, authenticated;

commit;
