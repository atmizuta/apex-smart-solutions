-- Sincronização automática da produção via API NeoSales (29/09/2026).
-- Tabela SEPARADA de producao_pedidos: o dashboard só troca de fonte depois que a paridade for provada.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.producao_pedidos_neo (
  id bigint generated always as identity primary key,
  item_id bigint not null unique,            -- itemId do NeoSales: chave de upsert (1 linha por item)
  numero_pedido text,
  grupo text,                                 -- numeroLinha da API (= coluna GRUPO do export manual)
  usuario text,
  etapa text,
  cadastro timestamptz,
  atualizacao timestamptz,
  valor numeric not null default 0,
  quantidade numeric,
  produto text,
  cliente text,
  cnpj text,
  tag text,                                   -- tagPedido da API
  criado_em timestamptz not null default now(),
  data_portabilidade timestamptz,
  data_instalacao timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_producao_neo_pedido on public.producao_pedidos_neo(numero_pedido);
create index if not exists idx_producao_neo_etapa on public.producao_pedidos_neo(etapa);
create index if not exists idx_producao_neo_usuario on public.producao_pedidos_neo(usuario);
create index if not exists idx_producao_neo_atualizacao on public.producao_pedidos_neo(atualizacao);

alter table public.producao_pedidos_neo enable row level security;
-- mesma regra de producao_pedidos: select p/ qualquer logado (o painel decide se pede cliente/cnpj).
-- Sem policy de escrita: só a Edge Function (service_role, ignora RLS) grava.
drop policy if exists "producao_neo_select" on public.producao_pedidos_neo;
create policy "producao_neo_select" on public.producao_pedidos_neo for select
  using ( auth.role() = 'authenticated' );

-- JSON cru de cada item (contém nome/CNPJ do cliente): só admin lê — LGPD.
create table if not exists public.producao_neo_raw (
  item_id bigint primary key,
  raw jsonb not null,
  sincronizado_em timestamptz not null default now()
);
alter table public.producao_neo_raw enable row level security;
drop policy if exists "producao_neo_raw_select" on public.producao_neo_raw;
create policy "producao_neo_raw_select" on public.producao_neo_raw for select
  using ( public.get_my_role() = 'admin' );

-- Uma linha por execução da sincronização. O cursor é o janela_fim da última execução ok.
create table if not exists public.producao_sync_log (
  id bigint generated always as identity primary key,
  modo text not null check (modo in ('horario','reconciliar','backfill','manual')),
  iniciou_em timestamptz not null default now(),
  terminou_em timestamptz,
  janela_ini timestamptz,
  janela_fim timestamptz,
  linhas_api integer,
  gravadas integer,
  removidas integer,
  descartes jsonb,
  observacao text,
  ok boolean,
  erro text
);
create index if not exists idx_producao_sync_log_cursor on public.producao_sync_log(ok, modo, janela_fim desc);
alter table public.producao_sync_log enable row level security;
drop policy if exists "producao_sync_log_select" on public.producao_sync_log;
create policy "producao_sync_log_select" on public.producao_sync_log for select
  using ( public.get_my_role() in ('admin','supervisor') );
