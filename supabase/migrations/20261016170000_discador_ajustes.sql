-- 16/10/2026 — Ajustes do Raio-X (REGRAS_NEGOCIO.md §97): pontos menores da revisão da §96.
-- 1) discador_pausas: atendimento sem fim_em não some da sequência (antes era filtrado e o intervalo do anterior até o
--    seguinte virava uma "pausa" falsa); sem fim, vale o início do atendimento.
-- 2) discador_consultor_dias sai: o "por dia" virou parte do Raio-X (§96) e nenhum painel no ar chama mais a função.
create or replace function public.discador_pausas(p_de date, p_ate date, p_op text, p_agente int)
returns table (agente_id int, dia date, inicio timestamptz, fim timestamptz, minutos int, equipe_sem_chamadas boolean)
language sql stable as $$
  with cfg as (
    select coalesce((select (g.valor::jsonb ->> 'pausa_min')::int from public.config g where g.chave = 'discador'), 15) as pm
  ), at as (
    select c.agente_id as ag, (c.atendida_em at time zone 'America/Sao_Paulo')::date as d, coalesce(c.fim_em, c.atendida_em) as f,
           lead(c.atendida_em) over (partition by c.agente_id, (c.atendida_em at time zone 'America/Sao_Paulo')::date
                                     order by c.atendida_em, c.id) as prox
      from public.discador_periodo(p_de, p_ate, p_op) c
     where c.status = 'ANSWERED' and c.agente_id is not null and c.atendida_em is not null
       and (p_agente is null or c.agente_id = p_agente)
  )
  select a.ag, a.d, a.f, a.prox, floor(extract(epoch from a.prox - a.f) / 60)::int,
         not exists (select 1 from public.discador_periodo(p_de, p_ate, p_op) o
                      where o.status in ('ANSWERED', 'ABANDONED') and o.agente_id is distinct from a.ag
                        and o.gerada_em > a.f and o.gerada_em < a.prox)
    from at a cross join cfg
   where a.prox is not null and a.prox - a.f > make_interval(mins => cfg.pm);
$$;
revoke all on function public.discador_pausas(date, date, text, int) from public, anon, authenticated;

drop function if exists public.discador_consultor_dias(int, date, date, text);
