-- Alerta de sincronização da produção parada (30/09/2026).
-- A Edge Function alerta-sync-producao roda de 15 em 15 minutos (pg_cron) e, se a última sincronização
-- bem-sucedida passar do limite (padrão 3 h), abre UM alerta aqui e avisa pelo canal configurado (Telegram);
-- quando a sincronização volta, resolve o alerta e avisa a recuperação.
create table if not exists public.producao_sync_alerta (
  id bigint generated always as identity primary key,
  aberto_em timestamptz not null default now(),
  resolvido_em timestamptz,
  ultimo_ok_em timestamptz,               -- fim da última sincronização bem-sucedida quando o alerta abriu
  ultimo_erro text,                       -- erro da última execução, se ela falhou
  notificado_abertura boolean not null default false,
  notificado_resolucao boolean not null default false
);
-- só pode existir um alerta aberto por vez (garante que duas execuções simultâneas não abram dois)
create unique index if not exists uq_producao_sync_alerta_aberto on public.producao_sync_alerta ((1)) where resolvido_em is null;

alter table public.producao_sync_alerta enable row level security;
drop policy if exists "producao_sync_alerta_select" on public.producao_sync_alerta;
create policy "producao_sync_alerta_select" on public.producao_sync_alerta for select
  using ( public.get_my_role() in ('admin','supervisor') );
-- sem policy de escrita: só a Edge Function (service_role) grava.

-- Job de 15 em 15 minutos. O nome NÃO começa com "sync-producao-" de propósito: a migration de cron da
-- sincronização apaga tudo que casa com esse prefixo ao ser reaplicada. Este job não consulta a NeoSales,
-- então não interfere no intervalo mínimo entre consultas da API.
select cron.unschedule(jobid) from cron.job where jobname = 'alerta-sync-producao';
select cron.schedule('alerta-sync-producao', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/alerta-sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
$job$);
