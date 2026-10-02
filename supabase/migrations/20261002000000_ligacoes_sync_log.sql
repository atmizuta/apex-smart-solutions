-- 02/10/2026 — Robô ProContact: registro de cada execução da sincronização automática de chamadas manuais.
-- A Edge Function ingest-ligacoes grava aqui (service role) ao fim de cada execução; o painel lê para avisar
-- quando a sincronização parar. Spec: docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md
create table if not exists public.ligacoes_sync_log (
  id bigint generated always as identity primary key,
  execucao_id uuid not null unique,        -- gerado pelo robô; um final repetido (retentativa) não duplica
  iniciou_em timestamptz not null,
  terminou_em timestamptz not null default now(),
  ok boolean not null,
  lidas int not null default 0,            -- linhas do arquivo exportado
  enviadas int not null default 0,         -- linhas válidas enviadas à função
  invalidas int not null default 0,
  ignoradas_eagle int not null default 0,
  periodo_de timestamptz,
  periodo_ate timestamptz,
  erro text                                -- mensagem curta, nunca dados de ligação
);
create index if not exists idx_ligacoes_sync_log_ok on public.ligacoes_sync_log (ok, terminou_em desc);

alter table public.ligacoes_sync_log enable row level security;
drop policy if exists ligacoes_sync_log_select on public.ligacoes_sync_log;
create policy ligacoes_sync_log_select on public.ligacoes_sync_log for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
-- sem política de escrita: só a Edge Function (service_role) grava.
