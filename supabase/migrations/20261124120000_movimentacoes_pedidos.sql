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
