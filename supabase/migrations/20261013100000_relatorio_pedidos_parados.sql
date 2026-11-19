-- 13/10/2026 — Relatório diário de pedidos parados (Antifraude e Entrega) por e-mail. REGRAS_NEGOCIO.md §81.
-- Spec: docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md (§5). Aditiva e idempotente.
-- Rollback: supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql.
-- Verificação: supabase/tests/relatorio_pedidos_parados_check.sql.
-- Destinatários NÃO entram aqui (repositório público): são gravados direto no banco.

-- 1) Destinatários por relatório. Só admin lê/grava (a `config` é legível por qualquer usuário logado).
create table if not exists public.relatorio_destinatarios (
  relatorio     text primary key,
  para          text[] not null default '{}',
  cc            text[] not null default '{}',
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.relatorio_destinatarios enable row level security;
drop policy if exists relatorio_destinatarios_admin on public.relatorio_destinatarios;
create policy relatorio_destinatarios_admin on public.relatorio_destinatarios
  for all using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- 2) Log: uma linha por execução da Edge Function. Só admin lê; só a função (service role) grava.
create table if not exists public.relatorio_envio_log (
  id            bigint generated always as identity primary key,
  relatorio     text not null,
  modo          text not null check (modo in ('agendado', 'teste', 'reenviar')),
  executado_em  timestamptz not null default now(),
  data_ref      date not null,
  status        text not null check (status in ('enviado', 'pulado', 'erro')),
  motivo        text,
  qtd_pedidos   integer,
  destinatarios text[] not null default '{}',
  erro          text
);
create index if not exists relatorio_envio_log_rel_dia on public.relatorio_envio_log (relatorio, data_ref);
alter table public.relatorio_envio_log enable row level security;
drop policy if exists relatorio_envio_log_admin_le on public.relatorio_envio_log;
create policy relatorio_envio_log_admin_le on public.relatorio_envio_log
  for select using (public.get_my_role() = 'admin');

-- 3) Linhas (itens) dos pedidos em ANTIFRAUDE e ENTREGA, com "na etapa desde" e a operação do vendedor
--    (sem vínculo = apex, §78). Só a Edge Function (service_role) executa.
create or replace function public.relatorio_pedidos_parados_linhas()
returns table (numero_pedido text, usuario text, etapa text, cadastro timestamptz, atualizacao timestamptz,
               valor numeric, quantidade numeric, produto text, cliente text, cnpj text,
               na_etapa_desde timestamptz, operacao text)
language sql stable security definer set search_path = public as $$
  select n.numero_pedido, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade, n.produto,
         n.cliente, n.cnpj,
         public.producao_na_etapa_desde(n.numero_pedido, n.etapa, n.atualizacao),
         coalesce(p.operacao, 'apex')
    from public.producao_pedidos_neo n
    left join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
    left join public.profiles p on p.id = c.profile_id
   where n.etapa in ('ANTIFRAUDE (NEOCRM)', 'ENTREGA (NEOCRM)')
   order by n.numero_pedido, n.item_id;
$$;
revoke all on function public.relatorio_pedidos_parados_linhas() from public, anon, authenticated;
grant execute on function public.relatorio_pedidos_parados_linhas() to service_role;

-- 4) Agenda: seg–sex 11:00 UTC = 08:00 São Paulo (sem horário de verão). O segredo é lido do Vault.
select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';
select cron.schedule('relatorio-pedidos-parados', '0 11 * * 1-5', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/relatorio-pedidos-parados',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"agendado"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
