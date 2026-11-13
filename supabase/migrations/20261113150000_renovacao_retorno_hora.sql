-- §151 (13/11, Rafael): redesign da Renovação — retorno com data E hora. A data continua em prox_retorno (os retornos
-- antigos seguem valendo, sem hora). Atrasado = data antes de hoje, ou hoje com a hora já passada (horário de SP).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_retorno_hora_check.sql.
begin;

alter table public.renovacao_carteira add column if not exists retorno_hora time;

create or replace view public.renovacao_resumo with (security_invoker = true) as
select c.consultor_id, p.nome as consultor_nome,
       count(*)::int                                                    as carteira,
       count(*) filter (where c.status >= 2)::int                       as contatados,
       count(*) filter (where c.status between 3 and 6)::int            as efetivo_mais,
       count(*) filter (where c.status between 4 and 6)::int            as propostas_mais,
       count(*) filter (where c.status = 6)::int                        as renovados,
       count(*) filter (where c.status = 7)::int                        as perdidos,
       coalesce(sum(c.linhas_renovadas), 0)::int                        as linhas_renovadas,
       coalesce(sum(c.bl_vendida), 0)::int                              as bl_vendida,
       coalesce(sum(c.sol_digitais), 0)::numeric(12,2)                  as sol_digitais,
       count(*) filter (where c.status not in (6, 7) and (
           c.prox_retorno < (now() at time zone 'America/Sao_Paulo')::date
        or (c.prox_retorno = (now() at time zone 'America/Sao_Paulo')::date
            and c.retorno_hora is not null and c.retorno_hora < (now() at time zone 'America/Sao_Paulo')::time)))::int as retornos_atrasados,
       count(*) filter (where c.a_completar)::int                       as a_completar
  from public.renovacao_carteira c
  left join public.profiles p on p.id = c.consultor_id
 where c.na_base
 group by c.consultor_id, p.nome;
grant select on public.renovacao_resumo to authenticated;

commit;
