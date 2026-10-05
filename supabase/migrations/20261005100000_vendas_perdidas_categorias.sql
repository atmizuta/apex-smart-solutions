-- 05/10/2026 — Vendas Perdidas por categoria (API de Exportação Xeotech). REGRAS_NEGOCIO.md §70. Aditiva.
-- Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md

-- 1) Categoria da venda perdida por pedido (gravada pela Edge Function sync-exportacao; sem CPF/CNPJ)
create table if not exists public.producao_atividades (
  numero_pedido text primary key,
  categoria text,
  subcategoria text,
  tags text[] not null default '{}',
  etapa text,
  usuario text,
  cliente text,
  produtos text,
  valor numeric not null default 0,
  itens int not null default 0,
  data_cadastro date,
  atualizado_em_neo timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index if not exists producao_atividades_etapa_idx on public.producao_atividades (etapa);
create index if not exists producao_atividades_categoria_idx on public.producao_atividades (categoria);
alter table public.producao_atividades enable row level security;
drop policy if exists producao_atividades_select on public.producao_atividades;
create policy producao_atividades_select on public.producao_atividades
  for select to authenticated using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.producao_atividades from anon, authenticated;

-- 2) Log de execuções da sincronização
create table if not exists public.exportacao_sync_log (
  id bigint generated always as identity primary key,
  iniciou_em timestamptz not null default now(),
  terminou_em timestamptz,
  ok boolean,
  http int,
  linhas int,
  pedidos int,
  gravados int,
  erro text
);
create index if not exists exportacao_sync_log_ok_idx on public.exportacao_sync_log (ok, terminou_em desc);
alter table public.exportacao_sync_log enable row level security;
drop policy if exists exportacao_sync_log_select on public.exportacao_sync_log;
create policy exportacao_sync_log_select on public.exportacao_sync_log
  for select to authenticated using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.exportacao_sync_log from anon, authenticated;

-- 3) Vendas perdidas no período (etapa e valor de producao_pedidos_neo; categoria de producao_atividades)
create or replace function public.vendas_perdidas(p_de date, p_ate date)
returns table (numero_pedido text, usuario text, profile_id uuid, cliente text, produtos text, valor numeric,
               perdido_em timestamptz, categoria text, subcategoria text, tags text[], tag_pedido text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with p as (
    select n.numero_pedido as np, max(n.usuario) as usu, max(n.usuario_id) as uid, max(n.cliente) as cli,
           string_agg(distinct n.produto, ' + ') as prods, coalesce(sum(n.valor), 0) as val,
           max(coalesce(n.atualizacao, n.cadastro)) as atu,
           string_agg(distinct nullif(btrim(n.tag), ''), ',') as tg
      from public.producao_pedidos_neo n
     where n.etapa = 'VENDA PERDIDA (NEOCRM)' and n.numero_pedido is not null
     group by n.numero_pedido
  ),
  q as (
    select p.*, coalesce((select max(h.em) from public.producao_etapa_historico h
                           where h.numero_pedido = p.np and h.etapa_nova = 'VENDA PERDIDA (NEOCRM)'), p.atu) as perd
      from p
  )
  select q.np, q.usu,
         (select cn.profile_id from public.consultor_neo cn where cn.neo_usuario_id = q.uid),
         coalesce(a.cliente, q.cli), coalesce(q.prods, a.produtos), q.val, q.perd,
         a.categoria, a.subcategoria, a.tags, q.tg
    from q left join public.producao_atividades a on a.numero_pedido = q.np
   where (q.perd at time zone 'America/Sao_Paulo')::date between p_de and p_ate
   order by q.perd desc;
end $$;
revoke all on function public.vendas_perdidas(date, date) from public, anon;
grant execute on function public.vendas_perdidas(date, date) to authenticated;
