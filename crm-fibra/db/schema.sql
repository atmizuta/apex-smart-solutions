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
    -- Renewal eligibility now follows the painel's current rule
    -- (tempo_contrato_voz > 15), not the apto_renovacao text field, which
    -- the painel's own REGRAS_NEGOCIO.md says stopped being populated
    -- reliably as of 2026-08-11. The three tiers mirror what
    -- apto_renovacao used to express: "apto agora" once the contract
    -- crosses the threshold, "1/2 meses para apto" while counting up to
    -- it (tempo_contrato_voz increments by 1 per month under contract).
    when c.tempo_contrato_voz > 15 then 'apto_agora'
    when c.tempo_contrato_voz = 15 then 'apto_1_mes'
    when c.tempo_contrato_voz = 14 then 'apto_2_meses'
    else null
  end as camada_renovacao,
  a.consultor_id as dono_consultor_id,
  a.status_contato,
  a.atribuido_em,
  a.ultimo_contato_em,
  -- Appended at the end on purpose: `create or replace view` only accepts
  -- new columns after the existing ones (same names/order/types before).
  c.linhas_voz,
  c.valor_contrato
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

-- Lead card + proposal builder (sub-project 2) — idempotent, safe to run again.

create table if not exists crm_fibra.catalogo_planos (
  id uuid primary key default gen_random_uuid(),
  categoria text not null
    check (categoria in ('convergente', 'pos_nacional', 'pos_regional', 'banda_larga', 'adicional')),
  nome text not null,
  valor numeric not null,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create unique index if not exists catalogo_planos_categoria_nome_key on crm_fibra.catalogo_planos (categoria, nome);

create table if not exists crm_fibra.propostas (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_propostas_cnpj on crm_fibra.propostas(cnpj_digits);

create table if not exists crm_fibra.proposta_itens (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references crm_fibra.propostas(id) on delete cascade,
  catalogo_plano_id uuid references crm_fibra.catalogo_planos(id),
  descricao text not null,
  valor numeric not null,
  ordem integer not null default 0
);

create index if not exists idx_proposta_itens_proposta on crm_fibra.proposta_itens(proposta_id);

alter table crm_fibra.catalogo_planos enable row level security;
alter table crm_fibra.propostas enable row level security;
alter table crm_fibra.proposta_itens enable row level security;

-- `on conflict do nothing` keeps any price an admin edited later: re-running
-- this file never overwrites the catalog.
insert into crm_fibra.catalogo_planos (categoria, nome, valor, observacao) values
  ('convergente', 'Fibra 1 Giga + Pós 65GB (regional RSC/RSI/RRS/RRE/RCO/RNO)', 194.89, null),
  ('convergente', 'Fibra 1 Giga + Pós 80GB (regional RMG/RPS/RBS/RNE + DDDs 55,27,62,64,98,19)', 194.89, null),
  ('convergente', 'Fibra 800 Mega + Pós 62GB', 149.89, null),
  ('convergente', 'Fibra 800 Mega + Pós 90GB', 164.89, null),
  ('convergente', 'Fibra 600 Mega + Pós 71GB (Grupos Padrão Especial/Especial+)', 99.89, 'Por 3 meses, depois R$129,89 (boleto) / R$124,89 (DCC)'),
  ('convergente', 'Fibra 600 Mega + Pós 71GB (Mercados em Desenvolvimento/Redes Neutras)', 94.89, 'Por 6 meses, depois R$124,89 (boleto) / R$119,89 (DCC)'),
  ('pos_nacional', 'Pós 12GB', 39.99, 'por linha'),
  ('pos_nacional', 'Pós 40GB', 54.99, 'por linha'),
  ('pos_nacional', 'Pós 70GB', 74.99, 'por linha'),
  ('pos_nacional', 'Pós 100GB', 89.99, 'por linha'),
  ('pos_nacional', 'Pós 150GB', 149.99, 'por linha'),
  ('pos_regional', 'Pós 30GB (regional RMG/RPS/RBS/RRS/RRE/RCO/RNO + DDDs 55,27,62,64,98,19)', 44.99, 'por linha'),
  ('banda_larga', '400 Mega (G1 Padrão)', 79.90, 'single/combinado/convergência'),
  ('banda_larga', '400 Mega (G4 Especial+)', 84.90, 'single'),
  ('banda_larga', '600 Mega (G1 Padrão)', 59.90, 'Por 3 meses, depois R$99,90'),
  ('banda_larga', '600 Mega (G3A Especial+ com oferta)', 59.90, 'Por 3 meses, depois R$89,90'),
  ('banda_larga', '600 Mega (G4, single)', 64.90, 'Por 6 meses, depois R$104,90'),
  ('banda_larga', '600 Mega (G4, combinado/convergência)', 54.90, 'Por 6 meses, depois R$84,90'),
  ('banda_larga', '800 Mega (todos os grupos)', 109.90, 'single/combinado/convergência'),
  ('banda_larga', '1 Giga (single/combinado)', 199.90, null),
  ('banda_larga', '1 Giga (convergência)', 149.90, null),
  ('adicional', 'Claro Monitor', 5.00, null)
on conflict (categoria, nome) do nothing;

-- Re-grant after the new tables exist (see the grants note above: default
-- privileges only cover objects created by the same role).
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;

-- AI sales approach (sub-project 3) — idempotent, safe to run again.

create table if not exists crm_fibra.abordagens (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  proposta_id uuid references crm_fibra.propostas(id) on delete set null,
  etapas jsonb not null,
  modelo text not null,
  criado_em timestamptz not null default now()
);

create index if not exists idx_abordagens_cnpj_criado on crm_fibra.abordagens (cnpj_digits, criado_em desc);

alter table crm_fibra.abordagens enable row level security;

-- Re-grant after the new table exists (default privileges only cover objects
-- created by the same role).
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;
