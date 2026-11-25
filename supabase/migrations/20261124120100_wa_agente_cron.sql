-- §165: tick de 1 em 1 min (rede de segurança do agente) e limpeza diária dos 90 dias.
-- Aplicar só com ok do Rafael, DEPOIS do secret wa_agente_cron_secret no Vault e do deploy da whatsapp-webhook.
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'wa-agente-tick') then
    perform cron.schedule('wa-agente-tick', '* * * * *', $job$
      select net.http_post(
        url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/whatsapp-webhook',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_agente_cron_secret')),
        body := '{"acao":"tick"}'::jsonb,
        timeout_milliseconds := 5000);
    $job$);
  end if;
  if not exists (select 1 from cron.job where jobname = 'wa-agente-limpar') then
    perform cron.schedule('wa-agente-limpar', '40 6 * * *', $job$   -- 03:40 em São Paulo
      select net.http_post(
        url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/whatsapp-webhook',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'wa_agente_cron_secret')),
        body := '{"acao":"limpar"}'::jsonb,
        timeout_milliseconds := 5000);
    $job$);
  end if;
end $do$;
