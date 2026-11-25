-- 24/11/2026 — §166 Movimentações dos pedidos (APIs Movimentação + Atualizações da Xeotech).
-- Spec: docs/superpowers/specs/2026-11-24-movimentacoes-pedidos-design.md. Sem nome/CNPJ do cliente nas tabelas novas.
-- RLS ligado e SEM policy: o painel lê só pelas RPCs (security definer) desta migration.

create table if not exists public.pedido_movimentacoes (
  pedido_id bigint not null, numero_pedido text not null, etapa_id bigint not null, etapa text not null,
  entrou_em timestamptz not null, saiu_em timestamptz, entrou_por text, saiu_por text,
  sla_horas numeric, tempo text, texto text, vp_categoria text, consultor text, valor numeric, tags text,
  sincronizado_em timestamptz not null default now(),
  primary key (pedido_id, etapa_id, entrou_em)
);
create index if not exists pedido_mov_numero on public.pedido_movimentacoes (numero_pedido);
create index if not exists pedido_mov_entrou on public.pedido_movimentacoes (entrou_em);
create index if not exists pedido_mov_abertas on public.pedido_movimentacoes (etapa) where saiu_em is null;

create table if not exists public.pedido_anotacoes (
  id bigserial primary key, numero_pedido text not null, atualizado_em_neo timestamptz not null, texto text not null,
  tipo text not null check (tipo in ('bko_status', 'venda_perdida', 'livre')),
  status text, descricao text, vp_categoria text, etapa text, visto_em timestamptz not null default now()
);
create unique index if not exists pedido_anot_uk on public.pedido_anotacoes (numero_pedido, atualizado_em_neo, md5(texto));
create index if not exists pedido_anot_em on public.pedido_anotacoes (atualizado_em_neo);

create table if not exists public.neo_pedidos_sync_log (
  id bigserial primary key, api text not null check (api in ('atualizacoes', 'movimentacao')),
  janela_ini timestamptz, janela_fim timestamptz, http int, linhas int, gravados int, ok boolean, erro text,
  comecou_em timestamptz not null default now(), terminou_em timestamptz
);
create index if not exists neo_ped_log_ult on public.neo_pedidos_sync_log (api, ok, janela_fim desc);

create table if not exists public.vp_motivo_equivalencia (
  vp_categoria text not null, trecho_status text not null, primary key (vp_categoria, trecho_status)
);
insert into public.vp_motivo_equivalencia values ('Restrição de Crédito', 'NÃO APROVADA') on conflict do nothing;

create table if not exists public.venda_perdida_auditoria (
  numero_pedido text primary key, motivo_real text not null, obs text,
  decidido_por uuid not null, decidido_em timestamptz not null default now()
);

alter table public.pedido_movimentacoes enable row level security;
alter table public.pedido_anotacoes enable row level security;
alter table public.neo_pedidos_sync_log enable row level security;
alter table public.vp_motivo_equivalencia enable row level security;
alter table public.venda_perdida_auditoria enable row level security;

-- Diário: a API repete a última nota quando o pedido é mexido por outro motivo; só grava se o texto mudou.
create or replace function public.pedido_anotacoes_gravar(p_linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; ult text; n int := 0;
begin
  for r in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) order by value->>'atualizado_em_neo' loop
    ult := null;
    select a.texto into ult from public.pedido_anotacoes a
     where a.numero_pedido = r->>'numero_pedido' order by a.atualizado_em_neo desc, a.id desc limit 1;
    continue when ult is not distinct from r->>'texto';
    insert into public.pedido_anotacoes (numero_pedido, atualizado_em_neo, texto, tipo, status, descricao, vp_categoria, etapa)
    values (r->>'numero_pedido', (r->>'atualizado_em_neo')::timestamptz, r->>'texto', r->>'tipo', r->>'status',
            r->>'descricao', r->>'vp_categoria', r->>'etapa')
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Operação de cada pedido = a do consultor (via consultor_neo); sem consultor ligado = 'apex'.
create or replace function public.mp_pedidos() returns table (numero_pedido text, operacao text, cliente text, consultor text)
language sql stable security definer set search_path = public as $$
  select distinct on (n.numero_pedido) n.numero_pedido, coalesce(pr.operacao, 'apex'), n.cliente, n.usuario
    from public.producao_pedidos_neo n
    left join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
    left join public.profiles pr on pr.id = c.profile_id
   order by n.numero_pedido, pr.operacao is null, n.atualizacao desc nulls last;
$$;

-- 'todas' (admin), a operação (supervisor) ou null (sem aba).
create or replace function public.mp_escopo() returns text
language sql stable security definer set search_path = public as $$
  select case p.role when 'admin' then 'todas' when 'supervisor' then coalesce(p.operacao, 'apex') end
    from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.pedido_pode_ver(p_numero text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mp_escopo() = 'todas' then true
    when public.mp_escopo() is not null then
      coalesce((select o.operacao from public.mp_pedidos() o where o.numero_pedido = p_numero), 'apex') = public.mp_escopo()
    when (select role from public.profiles where id = auth.uid()) = 'consultor' then
      exists (select 1 from public.producao_pedidos_neo n where n.numero_pedido = p_numero and n.usuario_id = public.meu_neo_usuario_id())
    else false end;
$$;

revoke execute on function public.pedido_anotacoes_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.pedido_anotacoes_gravar(jsonb) to service_role;
revoke execute on function public.mp_pedidos() from public, anon, authenticated;
revoke execute on function public.mp_escopo() from public, anon, authenticated;
revoke execute on function public.pedido_pode_ver(text) from public, anon, authenticated;

-- RPCs do painel (§166): gaveta, feed do dia, parados e tempo por etapa. Erro 42501 sem permissão.
create or replace function public.pedido_linha_do_tempo(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_decide boolean := coalesce((select role from public.profiles where id = auth.uid()) in ('admin', 'supervisor'), false);
begin
  if not coalesce(public.pedido_pode_ver(p_numero), false) then
    raise exception 'sem permissão para ver este pedido' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cabecalho', (select jsonb_build_object('numero', p_numero,
                          'cliente', (array_agg(n.cliente order by n.atualizacao desc nulls last))[1],
                          'consultor', (array_agg(n.usuario order by n.atualizacao desc nulls last))[1],
                          'valor', sum(n.valor),
                          'etapa', (array_agg(n.etapa order by n.atualizacao desc nulls last))[1])
                    from public.producao_pedidos_neo n where n.numero_pedido = p_numero having count(*) > 0),
    'passagens', coalesce((select jsonb_agg(jsonb_build_object('etapa', m.etapa, 'entrou_em', m.entrou_em, 'saiu_em', m.saiu_em,
                    'entrou_por', m.entrou_por, 'saiu_por', m.saiu_por, 'sla_horas', m.sla_horas, 'texto', m.texto,
                    'vp_categoria', m.vp_categoria) order by m.entrou_em)
                  from public.pedido_movimentacoes m where m.numero_pedido = p_numero), '[]'::jsonb),
    'anotacoes', coalesce((select jsonb_agg(jsonb_build_object('em', a.atualizado_em_neo, 'tipo', a.tipo, 'status', a.status,
                    'descricao', a.descricao, 'vp_categoria', a.vp_categoria, 'texto', a.texto,
                    'autor_provavel', (select m.entrou_por from public.pedido_movimentacoes m
                                        where m.numero_pedido = a.numero_pedido
                                          and m.entrou_em between a.atualizado_em_neo - interval '10 minutes' and a.atualizado_em_neo + interval '1 minute'
                                        order by m.entrou_em desc limit 1)) order by a.atualizado_em_neo)
                  from public.pedido_anotacoes a where a.numero_pedido = p_numero), '[]'::jsonb),
    'motivo_real', case when v_decide then (select jsonb_build_object('motivo', v.motivo_real, 'obs', v.obs, 'em', v.decidido_em,
                        'por', (select p.nome from public.profiles p where p.id = v.decidido_por))
                      from public.venda_perdida_auditoria v where v.numero_pedido = p_numero) end,
    'pode_decidir', v_decide,
    'categorias', case when v_decide then coalesce((select jsonb_agg(x.c order by x.c)
                    from (select distinct categoria c from public.producao_atividades where categoria is not null) x), '[]'::jsonb) end);
end $$;

create or replace function public.movimentacoes_feed(p_dia date, p_consultor text default null, p_etapa text default null, p_tipo text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
        v_ini timestamptz := p_dia::timestamp at time zone 'America/Sao_Paulo';
        v_fim timestamptz := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
        r jsonb;
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  with ev as (
    select m.entrou_em em, m.numero_pedido, m.consultor, 'etapa'::text tipo, m.etapa, m.entrou_por quem,
           null::text status, null::text descricao, m.vp_categoria
      from public.pedido_movimentacoes m where m.entrou_em >= v_ini and m.entrou_em < v_fim
    union all
    select a.atualizado_em_neo, a.numero_pedido, null, a.tipo, a.etapa, null, a.status, a.descricao, a.vp_categoria
      from public.pedido_anotacoes a where a.atualizado_em_neo >= v_ini and a.atualizado_em_neo < v_fim
  ), e as (
    select ev.em, ev.numero_pedido, ev.tipo, ev.etapa, ev.quem, ev.status, ev.descricao, ev.vp_categoria, o.cliente,
           coalesce(o.consultor, ev.consultor,
             (select max(m2.consultor) from public.pedido_movimentacoes m2 where m2.numero_pedido = ev.numero_pedido)) consultor
      from ev left join public.mp_pedidos() o on o.numero_pedido = ev.numero_pedido
     where v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc
  ), f as (select * from e where p_consultor is null or consultor = p_consultor)
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('em', x.em, 'numero', x.numero_pedido, 'cliente', x.cliente,
               'consultor', x.consultor, 'tipo', x.tipo, 'etapa', x.etapa, 'quem', x.quem, 'status', x.status,
               'descricao', x.descricao, 'vp_categoria', x.vp_categoria) order by x.em desc)
             from (select * from f where (p_etapa is null or etapa = p_etapa) and (p_tipo is null or tipo = p_tipo)
                    order by em desc limit 500) x), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'movimentacoes', (select count(*) from f where tipo = 'etapa'),
      'anotacoes_bko', (select count(*) from f where tipo = 'bko_status'),
      'entradas_vp', (select count(*) from f where tipo = 'etapa' and etapa ilike 'VENDA PERDIDA%')),
    'atualizado_em', (select max(terminou_em) from public.neo_pedidos_sync_log where api = 'atualizacoes' and ok),
    'consultores', coalesce((select jsonb_agg(distinct consultor) from e where consultor is not null), '[]'::jsonb),
    'etapas', coalesce((select jsonb_agg(distinct etapa) from e where etapa is not null), '[]'::jsonb))
  into r;
  return r;
end $$;

-- Só a última passagem de cada pedido pode estar "parada"; CONCLUIDO e VENDA PERDIDA não contam.
create or replace function public.movimentacoes_parados(p_etapa text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero_pedido, 'cliente', x.cliente,
             'consultor', x.consultor, 'desde', x.entrou_em, 'sla_horas', x.sla_horas) order by x.entrou_em)
    from (select m.numero_pedido, o.cliente, coalesce(o.consultor, m.consultor) consultor, m.entrou_em, m.sla_horas
            from public.pedido_movimentacoes m left join public.mp_pedidos() o on o.numero_pedido = m.numero_pedido
           where m.etapa = p_etapa and m.saiu_em is null
             and m.etapa not ilike 'VENDA PERDIDA%' and m.etapa <> 'CONCLUIDO'
             and not exists (select 1 from public.pedido_movimentacoes m2 where m2.pedido_id = m.pedido_id and m2.entrou_em > m.entrou_em)
             and (v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc)
           order by m.entrou_em limit 300) x), '[]'::jsonb));
end $$;

create or replace function public.movimentacoes_tempo_etapa(p_de date, p_ate date, p_consultor text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
        v_ini timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
        v_fim timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (with p as (
    select m.*, coalesce(o.consultor, m.consultor) cons,
           extract(epoch from (m.saiu_em - m.entrou_em)) / 3600 horas,
           m.saiu_em is null and m.etapa not ilike 'VENDA PERDIDA%' and m.etapa <> 'CONCLUIDO'
             and not exists (select 1 from public.pedido_movimentacoes m2 where m2.pedido_id = m.pedido_id and m2.entrou_em > m.entrou_em) parado
      from public.pedido_movimentacoes m left join public.mp_pedidos() o on o.numero_pedido = m.numero_pedido
     where v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc
  ), f as (select * from p where p_consultor is null or cons = p_consultor),
  per as (
    select etapa, count(*) passagens,
           percentile_cont(0.5) within group (order by horas) filter (where horas is not null) mediana_h,
           percentile_cont(0.9) within group (order by horas) filter (where horas is not null) p90_h,
           round(100.0 * count(*) filter (where horas is not null and sla_horas > 0 and horas > sla_horas)
                 / nullif(count(*) filter (where horas is not null and sla_horas > 0), 0), 1) fora_sla_pct
      from f where entrou_em >= v_ini and entrou_em < v_fim group by etapa
  ), par as (select etapa, count(*) parados from f where parado group by etapa)
  select jsonb_build_object(
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('etapa', coalesce(per.etapa, par.etapa), 'passagens', coalesce(per.passagens, 0),
                 'mediana_h', round(per.mediana_h::numeric, 1), 'p90_h', round(per.p90_h::numeric, 1),
                 'fora_sla_pct', per.fora_sla_pct, 'parados', coalesce(par.parados, 0))
               order by coalesce(per.passagens, 0) desc)
             from per full join par on par.etapa = per.etapa), '[]'::jsonb),
    'consultores', coalesce((select jsonb_agg(distinct cons) from p where cons is not null), '[]'::jsonb)));
end $$;

revoke execute on function public.pedido_linha_do_tempo(text) from public, anon;
revoke execute on function public.movimentacoes_feed(date, text, text, text) from public, anon;
revoke execute on function public.movimentacoes_parados(text) from public, anon;
revoke execute on function public.movimentacoes_tempo_etapa(date, date, text) from public, anon;
grant execute on function public.pedido_linha_do_tempo(text), public.movimentacoes_feed(date, text, text, text),
  public.movimentacoes_parados(text), public.movimentacoes_tempo_etapa(date, date, text) to authenticated;
