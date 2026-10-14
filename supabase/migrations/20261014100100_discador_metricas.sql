-- 14/10/2026 — Funções de leitura da aba "Discador" (REGRAS_NEGOCIO.md §82). Todas checam admin/supervisor.
-- Datas p_de/p_ate em São Paulo, ambas inclusive, no máximo 120 dias.
-- Contato = ANSWERED + ABANDONED; abandono = ABANDONED ÷ contato; atendida = ANSWERED com agente.
-- Venda do discador: pedido do NEO (sem perdido/devolvido; GROSS já não entra, §49) cujo CNPJ teve chamada atendida entre
-- (dia do cadastro − janela_venda_dias) e o fim do dia do cadastro; vai para a ÚLTIMA chamada atendida. Um pedido conta uma vez.

create or replace function public.discador_exige_supervisao(p_de date, p_ate date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 120 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
end $$;

-- Sem security definer/SET de propósito: assim o Postgres "inlina" a função e usa o índice de gerada_em. Fica fechada a
-- authenticated; só as funções acima (que rodam como dono) a chamam.
create or replace function public.discador_periodo(p_de date, p_ate date)
returns setof public.discador_chamadas language sql stable as $$
  select * from public.discador_chamadas
   where gerada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and gerada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
$$;

create or replace function public.discador_vendas_atribuidas(p_de date, p_ate date)
returns table (numero_pedido text, dia date, chamada_id bigint, agente_id int, carga text, operadora_base text, cidade text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select (c.valor::jsonb ->> 'janela_venda_dias')::int from public.config c where c.chave = 'discador'), 30) as dias
  ), pedidos as (
    select n.numero_pedido,
           min((n.cadastro at time zone 'America/Sao_Paulo')::date) as dia,
           min(lpad(regexp_replace(n.cnpj, '\D', '', 'g'), 14, '0')) as cnpj
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
      select d.id, d.agente_id, d.carga, d.operadora_base, d.cidade
        from public.discador_chamadas d
       where d.cnpj = p.cnpj and d.status = 'ANSWERED' and d.agente_id is not null
         and d.gerada_em >= ((p.dia - cfg.dias)::timestamp at time zone 'America/Sao_Paulo')
         and d.gerada_em <  ((p.dia + 1)::timestamp at time zone 'America/Sao_Paulo')
       order by d.gerada_em desc, d.id desc
       limit 1
    ) c;
$$;

create or replace function public.discador_resumo(p_de date, p_ate date)
returns table (tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, sem_tabulacao bigint,
               seg_falados_medio int, vendas bigint, abandono_alerta numeric, ultima_sync timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  select count(*),
         count(*) filter (where c.status in ('ANSWERED', 'ABANDONED')),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null),
         count(*) filter (where c.status = 'ABANDONED'),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null and c.tabulacao is null),
         round(avg(c.seg_falados) filter (where c.status = 'ANSWERED' and c.agente_id is not null))::int,
         (select count(*) from public.discador_vendas_atribuidas(p_de, p_ate)),
         coalesce((select (g.valor::jsonb ->> 'abandono_alerta')::numeric from public.config g where g.chave = 'discador'), 0.15),
         (select max(l.terminou_em) from public.discador_sync_log l where l.ok)
    from public.discador_periodo(p_de, p_ate) c;
end $$;

create or replace function public.discador_por_hora(p_de date, p_ate date)
returns table (hora int, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint,
               media_atendidas numeric, media_abandonadas numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with per as (
    select extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de, p_ate) c
  ), ref as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as dia,
           extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de - 28, p_de - 7) c
     where p_de = p_ate
       and (c.gerada_em at time zone 'America/Sao_Paulo')::date in (p_de - 7, p_de - 14, p_de - 21, p_de - 28)
  ), nd as (
    select count(distinct ref.dia) as n from ref
  ), a as (
    select per.h, count(*) as t,
           count(*) filter (where per.status in ('ANSWERED', 'ABANDONED')) as ct,
           count(*) filter (where per.status = 'ANSWERED' and per.agente_id is not null) as atd,
           count(*) filter (where per.status = 'ABANDONED') as abd
      from per group by per.h
  ), r as (
    select ref.h,
           count(*) filter (where ref.status = 'ANSWERED' and ref.agente_id is not null) as atd,
           count(*) filter (where ref.status = 'ABANDONED') as abd
      from ref group by ref.h
  )
  select g.h, coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0),
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.atd, 0)::numeric / nd.n, 1) end,
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.abd, 0)::numeric / nd.n, 1) end
    from generate_series(9, 21) as g(h)
    cross join nd
    left join a on a.h = g.h
    left join r on r.h = g.h
   order by g.h;
end $$;

create or replace function public.discador_mapa_calor(p_de date, p_ate date)
returns table (dia_semana int, hora int, tentativas bigint, contato bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  select extract(dow from s.x)::int, extract(hour from s.x)::int, count(*),
         count(*) filter (where s.status in ('ANSWERED', 'ABANDONED'))
    from (select c.gerada_em at time zone 'America/Sao_Paulo' as x, c.status from public.discador_periodo(p_de, p_ate) c) s
   group by 1, 2
   order by 1, 2;
end $$;

create or replace function public.discador_consultores(p_de date, p_ate date)
returns table (agente_id int, profile_id uuid, nome text, atendidas bigint, seg_falados_total bigint, seg_falados_medio int,
               sem_avanco bigint, retornos bigint, ganhos bigint, sem_tabulacao bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with ch as (
    select c.agente_id as ag, coalesce(c.seg_falados, 0) as seg, upper(coalesce(c.tabulacao, '')) as tab, c.tabulacao is null as semtab
      from public.discador_periodo(p_de, p_ate) c
     where c.status = 'ANSWERED' and c.agente_id is not null
  ), a as (
    select ch.ag, count(*) as n, sum(ch.seg)::bigint as seg,
           count(*) filter (where ch.tab like 'SEM AVAN%') as sa,
           count(*) filter (where ch.tab = 'RETORNO') as ret,
           count(*) filter (where ch.tab like '%GANHO') as gan,
           count(*) filter (where ch.semtab) as st
      from ch group by ch.ag
  ), v as (
    select va.agente_id as ag, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate) va group by va.agente_id
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

create or replace function public.discador_consultor_dias(p_agente int, p_de date, p_ate date)
returns table (dia date, atendidas bigint, seg_falados_total bigint, sem_avanco bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with a as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n, sum(coalesce(c.seg_falados, 0))::bigint as seg,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like 'SEM AVAN%') as sa,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like '%GANHO') as gan
      from public.discador_periodo(p_de, p_ate) c
     where c.status = 'ANSWERED' and c.agente_id = p_agente
     group by 1
  ), v as (
    select va.dia as d, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate) va where va.agente_id = p_agente group by 1
  )
  select coalesce(a.d, v.d), coalesce(a.n, 0), coalesce(a.seg, 0), coalesce(a.sa, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.d = a.d
   order by 1;
end $$;

create or replace function public.discador_mailing(p_de date, p_ate date, p_dim text)
returns table (chave text, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  if p_dim is null or p_dim not in ('carga', 'operadora', 'cidade') then
    raise exception 'dimensão inválida' using errcode = '22023';
  end if;
  return query
  with ch as (
    select case p_dim when 'carga' then coalesce(c.carga, '(sem carga)')
                      when 'operadora' then coalesce(c.operadora_base, '(sem operadora)')
                      else coalesce(c.cidade, '(sem cidade)') end as k,
           c.status, c.agente_id, upper(coalesce(c.tabulacao, '')) as tab
      from public.discador_periodo(p_de, p_ate) c
  ), a as (
    select ch.k, count(*) as t,
           count(*) filter (where ch.status in ('ANSWERED', 'ABANDONED')) as ct,
           count(*) filter (where ch.status = 'ANSWERED' and ch.agente_id is not null) as atd,
           count(*) filter (where ch.status = 'ABANDONED') as abd,
           count(*) filter (where ch.status = 'ANSWERED' and ch.tab like '%GANHO') as gan
      from ch group by ch.k
  ), v as (
    select case p_dim when 'carga' then coalesce(va.carga, '(sem carga)')
                      when 'operadora' then coalesce(va.operadora_base, '(sem operadora)')
                      else coalesce(va.cidade, '(sem cidade)') end as k,
           count(*) as n
      from public.discador_vendas_atribuidas(p_de, p_ate) va group by 1
  )
  select coalesce(a.k, v.k), coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.k = a.k
   where p_dim <> 'cidade' or coalesce(a.t, 0) >= 300
   order by case when p_dim = 'cidade' then coalesce(v.n, 0)::numeric * 1000 / nullif(a.t, 0) end desc nulls last,
            coalesce(a.t, 0) desc
   limit case when p_dim = 'cidade' then 15 end;
end $$;

create or replace function public.discador_agentes_sem_vinculo()
returns table (agente_id int, atendidas_30d bigint, ultima_chamada timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(current_date, current_date);
  return query
  select c.agente_id, count(*) filter (where c.status = 'ANSWERED'), max(c.gerada_em)
    from public.discador_chamadas c
    left join public.discador_agente da on da.agente_id = c.agente_id
   where c.agente_id is not null and c.gerada_em >= now() - interval '30 days' and da.profile_id is null
   group by c.agente_id
   order by 2 desc;
end $$;

create or replace function public.discador_vincular_agente(p_agente int, p_profile uuid, p_apelido text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_agente is null or p_agente <= 0 then
    raise exception 'agente inválido' using errcode = '22023';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'consultor não encontrado' using errcode = '22023';
  end if;
  insert into public.discador_agente (agente_id, profile_id, apelido, atualizado_em)
  values (p_agente, p_profile, nullif(btrim(p_apelido), ''), now())
  on conflict (agente_id) do update
    set profile_id = excluded.profile_id, apelido = excluded.apelido, atualizado_em = now();
end $$;

-- Permissões: as internas ficam fechadas; as de leitura abertas a logados (a checagem de perfil é dentro).
revoke all on function public.discador_exige_supervisao(date, date) from public, anon, authenticated;
revoke all on function public.discador_periodo(date, date) from public, anon, authenticated;
revoke all on function public.discador_vendas_atribuidas(date, date) from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.discador_resumo(date, date)', 'public.discador_por_hora(date, date)', 'public.discador_mapa_calor(date, date)',
    'public.discador_consultores(date, date)', 'public.discador_consultor_dias(int, date, date)',
    'public.discador_mailing(date, date, text)', 'public.discador_agentes_sem_vinculo()',
    'public.discador_vincular_agente(int, uuid, text)'
  ] loop
    execute 'revoke all on function ' || fn || ' from public, anon';
    execute 'grant execute on function ' || fn || ' to authenticated';
  end loop;
end $$;
