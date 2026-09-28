-- crm-fibra/db/schema.sql
-- Idempotent: safe to run again.

create schema if not exists crm_fibra;

create table if not exists crm_fibra.consultores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  username text not null unique,
  password_hash text not null,
  papel text not null default 'consultor' check (papel in ('admin', 'consultor')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz
);

alter table crm_fibra.consultores enable row level security;

-- Deliberately no policies granted to `anon` or `authenticated`: this table
-- is only ever read/written by the Next.js server using the service role
-- key (see spec §7). RLS being enabled with zero policies means even a
-- leaked anon key cannot read or write this table.
