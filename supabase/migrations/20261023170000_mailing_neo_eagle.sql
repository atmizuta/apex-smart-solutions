-- Seção 108 (23/10/2026, pedido do Rafael): "Cruzar com o NEO" da Base de Mailing passa a olhar também os pedidos
-- da Eagle no NeoSales (painel 15216), últimos 150 dias de cadastro, todas as etapas.
-- SÓ para a aba Base de Mailing: fica no schema mailing (sem acesso para anon/authenticated) e só a Edge Function
-- mailing-api lê. Nunca juntar com producao_pedidos_neo nem levar para Dashboard, Fechamento ou Boletim.
-- Mínimo necessário para cruzar: sem nome do cliente, valor, endereço ou telefone.
create table mailing.neo_eagle (
  numero_pedido text primary key,
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  etapa text,
  consultor text,
  cadastro date not null,
  atualizado_em_neo timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index neo_eagle_cnpj on mailing.neo_eagle (cnpj);
create index neo_eagle_cadastro on mailing.neo_eagle (cadastro);

-- Uma linha por execução da sync-neo-eagle (só contagens e erro sem token).
create table mailing.neo_eagle_sync (
  id bigint generated always as identity primary key,
  comecou_em timestamptz not null default now(),
  terminou_em timestamptz,
  periodo text,
  ok boolean,
  http integer,
  linhas integer,
  pedidos integer,
  gravados integer,
  apagados integer,
  erro text
);

alter table mailing.neo_eagle enable row level security;
alter table mailing.neo_eagle_sync enable row level security;
revoke all on mailing.neo_eagle, mailing.neo_eagle_sync from public, anon, authenticated;
revoke all on all sequences in schema mailing from public, anon, authenticated;
