-- 16/10/2026 — Ajustes do Raio-X (REGRAS_NEGOCIO.md §97): pontos menores da revisão da §96.
-- 1) discador_pausas: atendimento sem fim_em não some da sequência (antes era filtrado e o intervalo do anterior até o
--    seguinte virava uma "pausa" falsa); sem fim, vale o início do atendimento.
-- 2) discador_consultor_dias sai: o "por dia" virou parte do Raio-X (§96) e nenhum painel no ar chama mais a função.
-- 3) Período máximo: 120 dias contando os dois extremos (antes passava 121).
-- 4) Venda do discador: CNPJ do NEO com mais de 14 dígitos fica de fora (antes o lpad cortava e podia casar com outro).
-- 5) TRUNCATE revogado das tabelas do discador para anon/authenticated (a RLS não vale para TRUNCATE).
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

create or replace function public.discador_exige_supervisao(p_de date, p_ate date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de >= 120 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
end $$;

create or replace function public.discador_vendas_atribuidas(p_de date, p_ate date, p_op text)
returns table (numero_pedido text, dia date, chamada_id bigint, agente_id int, carga text, operadora_base text, cidade text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select (c.valor::jsonb ->> 'janela_venda_dias')::int from public.config c where c.chave = 'discador'), 30) as dias
  ), pedidos as (
    select n.numero_pedido,
           min((n.cadastro at time zone 'America/Sao_Paulo')::date) as dia,
           min(case when length(regexp_replace(n.cnpj, '\D', '', 'g')) <= 14 then lpad(regexp_replace(n.cnpj, '\D', '', 'g'), 14, '0') end) as cnpj  -- CNPJ com mais de 14 dígitos não é cortado (não casaria com outro)
      from public.producao_pedidos_neo n
     where n.cadastro >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and n.cadastro <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
       and n.numero_pedido is not null
       and regexp_replace(coalesce(n.cnpj, ''), '\D', '', 'g') <> ''
     group by n.numero_pedido
  )
  select p.numero_pedido, p.dia, c.id, c.agente_id, c.carga, c.operadora_base, c.cidade
    from pedidos p
    cross join cfg
    cross join lateral (
      select d.id, d.agente_id, d.carga, d.operadora_base, d.cidade, d.operacao
        from public.discador_chamadas d
       where d.cnpj = p.cnpj and d.status = 'ANSWERED' and d.agente_id is not null
         and d.gerada_em >= ((p.dia - cfg.dias)::timestamp at time zone 'America/Sao_Paulo')
         and d.gerada_em <  ((p.dia + 1)::timestamp at time zone 'America/Sao_Paulo')
       order by d.gerada_em desc, d.id desc
       limit 1
    ) c
   where p_op = 'todas' or c.operacao = p_op;
$$;
revoke all on function public.discador_vendas_atribuidas(date, date, text) from public, anon, authenticated;

revoke truncate on public.discador_chamadas, public.discador_agente, public.discador_sync_log from anon, authenticated;
