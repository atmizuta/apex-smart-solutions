-- §127: última consulta da situação cadastral de cada CNPJ na Receita (Edge Function verificar-cnpj).
-- Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md. Só a Edge Function grava (service role); quem está logado lê.
-- Sem DROP; não mexe em tabela existente.
create table if not exists public.cnpj_consultas (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  situacao text not null check (situacao in ('ATIVA','BAIXADA','INAPTA','SUSPENSA','NULA','NAO_ENCONTRADO')),
  situacao_desde date,
  motivo text,
  razao_social text,
  fonte text not null check (fonte in ('brasilapi','cnpjws')),
  consultado_em timestamptz not null default now(),
  consultado_por uuid references auth.users(id) on delete set null
);
alter table public.cnpj_consultas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cnpj_consultas' and policyname = 'cnpj_consultas_ler') then
    create policy cnpj_consultas_ler on public.cnpj_consultas for select to authenticated using (true);
  end if;
end $$;
grant select on public.cnpj_consultas to authenticated;
