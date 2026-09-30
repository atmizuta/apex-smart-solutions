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

-- Task 2 (Leads & Carteira) additions — idempotent, safe to run again.

create table if not exists crm_fibra.atribuicoes (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null unique,
  consultor_id uuid not null references crm_fibra.consultores(id),
  status_contato text not null default 'nao_contatado'
    check (status_contato in ('nao_contatado','tentativa_1','tentativa_2','tentativa_3','respondeu','sem_resposta')),
  atribuido_em timestamptz not null default now(),
  ultimo_contato_em timestamptz
);

alter table crm_fibra.atribuicoes enable row level security;

create table if not exists crm_fibra.mensagens (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','ligacao','email')),
  conteudo text not null,
  gerado_por_ia boolean not null default false,
  abordagem_tipo text,
  enviado_em timestamptz not null default now()
);

alter table crm_fibra.mensagens enable row level security;

create or replace view crm_fibra.leads_segmentados as
select
  c.cnpj_digits,
  c.razao_social,
  c.cidade,
  c.ddd,
  c.tel1,
  c.tel2,
  c.telefone_contato,
  c.email,
  c.arpu,
  c.apto_renovacao,
  c.cep_cabeado,
  c.linhas_fixas,
  case
    when c.cep_cabeado = 'CEP Cabeado' and coalesce(c.linhas_fixas, 0) = 0
      then 'fibra_candidato'
    else null
  end as camada_fibra,
  case
    when c.apto_renovacao = 'APTO' then 'apto_agora'
    when c.apto_renovacao = '1 MÊS PARA APTO' then 'apto_1_mes'
    when c.apto_renovacao = '2 MESES PARA APTO' then 'apto_2_meses'
    else null
  end as camada_renovacao,
  a.consultor_id as dono_consultor_id,
  a.status_contato,
  a.atribuido_em,
  a.ultimo_contato_em
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits
where c.cnpj_digits is not null and c.cnpj_digits <> '';

-- Explicit grants: Plan 1's final review found that Supabase's automatic
-- grants only cover the public schema, and `alter default privileges` only
-- auto-applies to objects created afterward by the *same* role — grant
-- explicitly here too so this migration is correct regardless of which
-- role applies it.
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;
grant select on crm_fibra.leads_segmentados to service_role;
