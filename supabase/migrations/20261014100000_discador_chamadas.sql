-- 14/10/2026 — Discador automático do ProContact: uma linha por tentativa de discagem (REGRAS_NEGOCIO.md §82).
-- Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
-- Nome e CPF do cliente NUNCA chegam aqui: o robô descarta antes e a função ingest-discador só aceita as colunas abaixo.
-- Quem grava é só a Edge Function ingest-discador (service role). Leitura: admin/supervisor.
create table if not exists public.discador_chamadas (
  id bigint primary key,                   -- ID do relatório; upsert por ele (o robô reenvia ontem + hoje a cada hora)
  gerada_em timestamptz not null,          -- DataHora_Geracao (São Paulo)
  conectada_em timestamptz,                -- DataHora_Conectado
  atendida_em timestamptz,                 -- DataHora_Atendimento
  fim_em timestamptz,                      -- DataHora_Fim
  status text not null,                    -- ANSWERED, BUSY, NOANSWER, CHANUNAVAIL, ABANDONED, CONGESTION...
  agente_id int,                           -- "ID do Usuário" (número do agente); nulo = nenhum consultor atendeu
  seg_espera int,                          -- Tempo_Espera
  seg_falados int,                         -- Tempo_Chamada
  seg_total int,                           -- Tempo_Total
  tabulacao text,                          -- Última Tabulação (nulo se vazia)
  carga_id int,                            -- Cód. Carga
  carga text,                              -- Carga (nome do mailing)
  campanha text,
  cnpj text,                               -- Documento 2, 14 dígitos
  telefone text,
  chave_tel text,                          -- DDD + 8 últimos dígitos (mesma regra de ligacoes_manuais)
  operadora_base text,                     -- Campo 1 (operadora de origem da linha)
  cidade text,                             -- Campo 3
  regiao text,
  gravacao text,
  importado_em timestamptz not null default now()
);
create index if not exists idx_discador_gerada on public.discador_chamadas (gerada_em);
create index if not exists idx_discador_agente on public.discador_chamadas (agente_id, gerada_em);
create index if not exists idx_discador_carga on public.discador_chamadas (carga_id, gerada_em);
create index if not exists idx_discador_cnpj on public.discador_chamadas (cnpj, gerada_em);

alter table public.discador_chamadas enable row level security;
drop policy if exists discador_chamadas_select on public.discador_chamadas;
create policy discador_chamadas_select on public.discador_chamadas for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_chamadas from anon, authenticated;

-- Vínculo número do agente no discador → consultor do painel. Escrita só pela RPC discador_vincular_agente (admin).
create table if not exists public.discador_agente (
  agente_id int primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  apelido text,
  atualizado_em timestamptz not null default now()
);
alter table public.discador_agente enable row level security;
drop policy if exists discador_agente_select on public.discador_agente;
create policy discador_agente_select on public.discador_agente for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_agente from anon, authenticated;

-- Uma linha por execução do robô (mesmo formato de ligacoes_sync_log, sem a contagem eagle).
create table if not exists public.discador_sync_log (
  id bigint generated always as identity primary key,
  execucao_id uuid not null unique,
  iniciou_em timestamptz not null,
  terminou_em timestamptz not null default now(),
  ok boolean not null,
  lidas int not null default 0,
  enviadas int not null default 0,
  invalidas int not null default 0,
  periodo_de timestamptz,
  periodo_ate timestamptz,
  erro text                                -- mensagem curta, nunca dados de chamada
);
create index if not exists idx_discador_sync_log_ok on public.discador_sync_log (ok, terminou_em desc);
alter table public.discador_sync_log enable row level security;
drop policy if exists discador_sync_log_select on public.discador_sync_log;
create policy discador_sync_log_select on public.discador_sync_log for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_sync_log from anon, authenticated;

insert into public.config (chave, valor, atualizado_em)
values ('discador', '{"abandono_alerta":0.15,"janela_venda_dias":30}', now())
on conflict (chave) do nothing;

-- Retenção de 90 dias, todo dia 04:30 de São Paulo. Idempotente.
select cron.unschedule(jobid) from cron.job where jobname = 'discador-limpeza';
select cron.schedule('discador-limpeza', '30 7 * * *',
  $job$ delete from public.discador_chamadas where gerada_em < now() - interval '90 days' $job$);
