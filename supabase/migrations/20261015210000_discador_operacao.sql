-- 15/10/2026 — Operação (Apex / Campinas) na aba Discador (REGRAS_NEGOCIO.md §89).
-- A operação de cada chamada vem da CAMPANHA (abandonada/não atendida não tem consultor), por PREFIXO do nome em
-- config.discador.campanhas (o nome muda por mês: "MIGRAÇÃO CLARO OUTUBRO"). Campanha sem regra fica com operacao nula:
-- só aparece em "Todas" e o resumo avisa o admin. Admin escolhe apex/campinas/todas (padrão apex); supervisor vê só a
-- própria operação (pedir outra = 42501). Chamada sem p_operacao (painel antigo) continua funcionando.
-- Mudou a regra em config? Reclassificar:  update public.discador_chamadas set operacao = public.discador_operacao_da_campanha(campanha);

update public.config
   set valor = (valor::jsonb || '{"campanhas":[{"prefixo":"DISCADOR-APEX","operacao":"apex"},{"prefixo":"MIGRAÇÃO CLARO","operacao":"campinas"}]}'::jsonb)::text,
       atualizado_em = now()
 where chave = 'discador' and not (valor::jsonb ? 'campanhas');

create or replace function public.discador_operacao_da_campanha(p_campanha text)
returns text language sql stable set search_path = public as $$
  select x.c ->> 'operacao'
    from public.config g
    cross join lateral jsonb_array_elements(coalesce(g.valor::jsonb -> 'campanhas', '[]'::jsonb)) as x(c)
   where g.chave = 'discador' and p_campanha is not null and coalesce(x.c ->> 'prefixo', '') <> ''
     and upper(btrim(p_campanha)) like upper(btrim(x.c ->> 'prefixo')) || '%'
   order by length(x.c ->> 'prefixo') desc
   limit 1;
$$;

alter table public.discador_chamadas add column if not exists operacao text;
create or replace function public.discador_chamadas_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.operacao := public.discador_operacao_da_campanha(new.campanha);
  return new;
end $$;
drop trigger if exists trg_discador_chamadas_operacao on public.discador_chamadas;
create trigger trg_discador_chamadas_operacao before insert or update of campanha on public.discador_chamadas
  for each row execute function public.discador_chamadas_operacao();
update public.discador_chamadas set operacao = public.discador_operacao_da_campanha(campanha);
create index if not exists idx_discador_operacao on public.discador_chamadas (operacao, gerada_em);

-- Operação efetiva de quem chama: admin escolhe (padrão apex); supervisor só a própria.
create or replace function public.discador_operacao_efetiva(p_operacao text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_role text := coalesce(public.get_my_role(), ''); v_minha text;
begin
  if v_role = 'admin' then
    if p_operacao is null then return 'apex'; end if;
    if p_operacao not in ('apex', 'campinas', 'todas') then
      raise exception 'operação inválida' using errcode = '22023';
    end if;
    return p_operacao;
  end if;
  if v_role <> 'supervisor' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select p.operacao into v_minha from public.profiles p where p.id = auth.uid();
  v_minha := coalesce(v_minha, 'apex');
  if p_operacao is not null and p_operacao <> v_minha then
    raise exception 'sem permissão para esta operação' using errcode = '42501';
  end if;
  return v_minha;
end $$;

-- As funções antigas (sem operação) saem; as novas têm p_operacao com padrão nulo (mesma chamada do painel antigo).
drop function if exists public.discador_resumo(date, date);
drop function if exists public.discador_por_hora(date, date);
drop function if exists public.discador_mapa_calor(date, date);
drop function if exists public.discador_consultores(date, date);
drop function if exists public.discador_consultor_dias(int, date, date);
drop function if exists public.discador_mailing(date, date, text);
drop function if exists public.discador_vendas_atribuidas(date, date);
drop function if exists public.discador_periodo(date, date);

-- Sem security definer/SET de propósito (inlinável, usa os índices). Fechada a authenticated.
create or replace function public.discador_periodo(p_de date, p_ate date, p_op text)
returns setof public.discador_chamadas language sql stable as $$
  select * from public.discador_chamadas
   where gerada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and gerada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
     and (p_op = 'todas' or operacao = p_op);
$$;

-- A venda vai para a ÚLTIMA chamada atendida (de qualquer operação); a operação da venda é a da campanha dessa chamada.
create or replace function public.discador_vendas_atribuidas(p_de date, p_ate date, p_op text)
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

create or replace function public.discador_resumo(p_de date, p_ate date, p_operacao text default null)
returns table (tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, sem_tabulacao bigint,
               seg_falados_medio int, vendas bigint, abandono_alerta numeric, ultima_sync timestamptz,
               operacao text, sem_operacao text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  select count(*),
         count(*) filter (where c.status in ('ANSWERED', 'ABANDONED')),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null),
         count(*) filter (where c.status = 'ABANDONED'),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null and c.tabulacao is null),
         round(avg(c.seg_falados) filter (where c.status = 'ANSWERED' and c.agente_id is not null))::int,
         (select count(*) from public.discador_vendas_atribuidas(p_de, p_ate, v_op)),
         coalesce((select (g.valor::jsonb ->> 'abandono_alerta')::numeric from public.config g where g.chave = 'discador'), 0.15),
         (select max(l.terminou_em) from public.discador_sync_log l where l.ok),
         v_op,
         case when public.get_my_role() = 'admin' then
           (select string_agg(distinct coalesce(d.campanha, '(sem campanha)'), ', ')
              from public.discador_chamadas d
             where d.operacao is null
               and d.gerada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
               and d.gerada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo'))
         end
    from public.discador_periodo(p_de, p_ate, v_op) c;
end $$;

create or replace function public.discador_por_hora(p_de date, p_ate date, p_operacao text default null)
returns table (hora int, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint,
               media_atendidas numeric, media_abandonadas numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  with per as (
    select extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de, p_ate, v_op) c
  ), ref as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as dia,
           extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de - 28, p_de - 7, v_op) c
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

create or replace function public.discador_mapa_calor(p_de date, p_ate date, p_operacao text default null)
returns table (dia_semana int, hora int, tentativas bigint, contato bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  select extract(dow from s.x)::int, extract(hour from s.x)::int, count(*),
         count(*) filter (where s.status in ('ANSWERED', 'ABANDONED'))
    from (select c.gerada_em at time zone 'America/Sao_Paulo' as x, c.status from public.discador_periodo(p_de, p_ate, v_op) c) s
   group by 1, 2
   order by 1, 2;
end $$;

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

create or replace function public.discador_consultor_dias(p_agente int, p_de date, p_ate date, p_operacao text default null)
returns table (dia date, atendidas bigint, seg_falados_total bigint, sem_avanco bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  with a as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n, sum(coalesce(c.seg_falados, 0))::bigint as seg,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like 'SEM AVAN%') as sa,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like '%GANHO') as gan
      from public.discador_periodo(p_de, p_ate, v_op) c
     where c.status = 'ANSWERED' and c.agente_id = p_agente
     group by 1
  ), v as (
    select va.dia as d, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate, v_op) va where va.agente_id = p_agente group by 1
  )
  select coalesce(a.d, v.d), coalesce(a.n, 0), coalesce(a.seg, 0), coalesce(a.sa, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.d = a.d
   order by 1;
end $$;

create or replace function public.discador_mailing(p_de date, p_ate date, p_dim text, p_operacao text default null)
returns table (chave text, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_op text;
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  if p_dim is null or p_dim not in ('carga', 'operadora', 'cidade') then
    raise exception 'dimensão inválida' using errcode = '22023';
  end if;
  v_op := public.discador_operacao_efetiva(p_operacao);
  return query
  with ch as (
    select case p_dim when 'carga' then coalesce(c.carga, '(sem carga)')
                      when 'operadora' then coalesce(c.operadora_base, '(sem operadora)')
                      else coalesce(c.cidade, '(sem cidade)') end as k,
           c.status, c.agente_id, upper(coalesce(c.tabulacao, '')) as tab
      from public.discador_periodo(p_de, p_ate, v_op) c
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
      from public.discador_vendas_atribuidas(p_de, p_ate, v_op) va group by 1
  )
  select coalesce(a.k, v.k), coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.k = a.k
   where p_dim <> 'cidade' or coalesce(a.t, 0) >= 300
   order by case when p_dim = 'cidade' then coalesce(v.n, 0)::numeric * 1000 / nullif(a.t, 0) end desc nulls last,
            coalesce(a.t, 0) desc
   limit case when p_dim = 'cidade' then 15 end;
end $$;

revoke all on function public.discador_operacao_da_campanha(text) from public, anon, authenticated;
revoke all on function public.discador_operacao_efetiva(text) from public, anon, authenticated;
revoke all on function public.discador_periodo(date, date, text) from public, anon, authenticated;
revoke all on function public.discador_vendas_atribuidas(date, date, text) from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.discador_resumo(date, date, text)', 'public.discador_por_hora(date, date, text)', 'public.discador_mapa_calor(date, date, text)',
    'public.discador_consultores(date, date, text)', 'public.discador_consultor_dias(int, date, date, text)',
    'public.discador_mailing(date, date, text, text)'
  ] loop
    execute 'revoke all on function ' || fn || ' from public, anon';
    execute 'grant execute on function ' || fn || ' to authenticated';
  end loop;
end $$;
