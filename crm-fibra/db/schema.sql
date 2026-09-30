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

-- service_role needs explicit grants here: Supabase's automatic grants to
-- anon/authenticated/service_role only cover the public schema, not new
-- ones. RLS being enabled (above) still fully protects this data from
-- anon/authenticated, who get no grants at all — this only lets the
-- server-only service-role client (see lib/supabase-admin.ts) do its job.
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;
alter default privileges in schema crm_fibra grant select, insert, update, delete on tables to service_role;
