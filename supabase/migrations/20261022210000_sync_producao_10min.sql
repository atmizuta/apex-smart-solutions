-- Seção 107 (22/10/2026): sincronização da produção a cada 10 min de dia (pedido do Rafael).
-- Antes: job 1 "sync-producao-horario" no minuto 59 de toda hora ('59 0-22 * * *' UTC).
-- Agora (horários em UTC; São Paulo = UTC-3):
--   job 1  '9,19,29,49,59 10-22 * * *'  -> 07:09 às 19:59 SP, de 10 em 10 min. Pula o :39 para ficar longe da
--          sync-exportacao do :41 (a NeoSales aceita uma consulta a cada ~2 min e a API nova divide esse limite).
--          O :59 continua: o relatório das 17h depende da rodada das 16:59.
--   sync-producao-20h      '9,19 23 * * *'  -> 20:09 e 20:19 SP; das 20:30 às 21:30 já rodam os jobs da noite (13/14).
--   sync-producao-madrugada '59 0-9 * * *'  -> 21:59 às 06:59 SP, de hora em hora como antes.
select cron.alter_job(job_id := 1, schedule := '9,19,29,49,59 10-22 * * *');

select cron.schedule('sync-producao-20h', '9,19 23 * * *', $$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$$);

select cron.schedule('sync-producao-madrugada', '59 0-9 * * *', $$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$$);

-- Botão "Atualizar dashboard agora" (seção 106): recusa nos 3 min antes de cada rodada automática (minutos x7–x9)
-- e perto da exportação (39–42), além da janela da noite e dos 3 min desde a última execução.
create or replace function public.producao_sync_agora()
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $f$
declare
  v_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_min int := extract(minute from v_sp)::int;
  v_hm int := extract(hour from v_sp)::int * 100 + extract(minute from v_sp)::int;
  v_ultimo timestamptz;
  v_pedido timestamptz;
  v_espera int;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;

  -- 20:28–21:31 (SP): os jobs da janela da noite já rodam de 10 em 10 min
  if v_hm between 2028 and 2131 then
    return jsonb_build_object('ok', false, 'motivo', 'noite');
  end if;
  -- x7–x9: a automática (x9) vai rodar; 39–42: a da exportação (41) divide o limite da API
  if v_min % 10 >= 7 or v_min between 39 and 42 then
    return jsonb_build_object('ok', false, 'motivo', 'automatica');
  end if;

  -- dois cliques ao mesmo tempo: um espera o outro gravar o carimbo
  perform pg_advisory_xact_lock(hashtext('producao_sync_agora'));

  select max(iniciou_em) into v_ultimo from public.producao_sync_log;
  select nullif(valor, '')::timestamptz into v_pedido from public.config where chave = 'producao_sync_agora_em';
  v_ultimo := greatest(v_ultimo, v_pedido);
  if v_ultimo is not null and v_ultimo > now() - interval '3 minutes' then
    v_espera := ceil(extract(epoch from (v_ultimo + interval '3 minutes' - now())))::int;
    return jsonb_build_object('ok', false, 'motivo', 'recente', 'espera_seg', v_espera);
  end if;

  insert into public.config (chave, valor, atualizado_em)
  values ('producao_sync_agora_em', now()::text, now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em;

  perform net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);

  return jsonb_build_object('ok', true, 'pedido_em', now());
end
$f$;

revoke all on function public.producao_sync_agora() from public, anon;
grant execute on function public.producao_sync_agora() to authenticated;
