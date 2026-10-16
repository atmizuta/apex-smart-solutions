-- Desfaz 20261016150000_discador_raiox.sql (§96) numa transação só: discador_consultores volta à versão da §89 (sem as
-- colunas novas) no mesmo passo, para o painel não ficar sem a função.
begin;
drop function if exists public.discador_consultor_raiox(int, date, date, text);
drop function if exists public.discador_consultores(date, date, text);
drop function if exists public.discador_pausas(date, date, text, int);
update public.config set valor = (valor::jsonb - 'pausa_min' - 'curta_seg')::text, atualizado_em = now() where chave = 'discador';
-- versão da §89 (20261015210000_discador_operacao.sql)
create or replace function public.discador_consultores(p_de date, p_ate date, p_operacao text default null)
returns table (agente_id int, profile_id uuid, nome text, atendidas bigint, seg_falados_total bigint, seg_falados_medio int,
               sem_avanco bigint, retornos bigint, ganhos bigint, sem_tabulacao bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  with ch as (
    select c.agente_id as ag, coalesce(c.seg_falados, 0) as seg, upper(coalesce(c.tabulacao, '')) as tab, c.tabulacao is null as semtab
      from public.discador_periodo(p_de, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id is not null
  ), a as (
    select ch.ag, count(*) as n, sum(ch.seg)::bigint as seg,
           count(*) filter (where ch.tab like 'SEM AVAN%') as sa,
           count(*) filter (where ch.tab = 'RETORNO') as ret,
           count(*) filter (where ch.tab like '%GANHO') as gan,
           count(*) filter (where ch.semtab) as st
      from ch group by ch.ag
  ), v as (
    select va.agente_id as ag, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate, v_op) va group by va.agente_id
  )
  select coalesce(a.ag, v.ag), da.profile_id,
         coalesce(p.nome, nullif(btrim(da.apelido), ''), 'Agente ' || coalesce(a.ag, v.ag)),
         coalesce(a.n, 0), coalesce(a.seg, 0),
         case when coalesce(a.n, 0) > 0 then round(a.seg::numeric / a.n)::int end,
         coalesce(a.sa, 0), coalesce(a.ret, 0), coalesce(a.gan, 0), coalesce(a.st, 0), coalesce(v.n, 0)
    from a
    full join v on v.ag = a.ag
    left join public.discador_agente da on da.agente_id = coalesce(a.ag, v.ag)
    left join public.profiles p on p.id = da.profile_id
   order by coalesce(a.n, 0) desc, 1;
end $$;
revoke all on function public.discador_consultores(date, date, text) from public, anon;
grant execute on function public.discador_consultores(date, date, text) to authenticated;
commit;
