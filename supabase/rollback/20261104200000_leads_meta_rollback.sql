-- Desfaz a §137 (20261104200000_leads_meta.sql). Antes: modo desligado e apagar a Edge Function leads-meta.
-- Tem DROP: se o conector recusar, rodar no SQL Editor do Supabase.
begin;

create or replace function public.leads_entrada(p_leads jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_ins int := 0; v_upd int := 0; n int; v_aba text; v_ts timestamptz;
begin
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    if not exists (select 1 from public.leads l where l.id = r ->> 'id') then
      v_aba := public.leads_mes_aba(v_ts);
      insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                                form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                                city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em)
      values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
              r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
              coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
              r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
              r ->> 'lead_status', 'sem_contato', false, 0, now(), now())
      on conflict (aba, id) do nothing;
      get diagnostics n = row_count;
      if n > 0 then
        perform public.leads_espelho_enfileirar(v_aba, r ->> 'id');
        v_ins := v_ins + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', v_upd);
end $$;
revoke all on function public.leads_entrada(jsonb) from public, anon, authenticated;

create or replace function public.leads_kanban_versao()
 returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), max(apagado_em),
                   count(*) filter (where dono_id is null and categoria = 'sem_contato' and apagado_em is null))
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day' or apagado_em >= now() - interval '1 day';
$$;

drop function if exists public.leads_entrada2(jsonb, boolean, text);
drop function if exists public.leads_meta_registrar(jsonb, jsonb);
drop function if exists public.leads_meta_erro(text);
drop function if exists public.leads_meta_token_confere(text);
delete from vault.secrets where name = 'leads_webhook_token';
drop table if exists public.leads_webhook_log;
drop function if exists public.leads_meta_aviso();
alter table public.leads drop column if exists origem_entrada;
alter table public.leads drop column if exists meta_visto_em;
delete from public.config where chave in ('leads_meta', 'leads_meta_status');
commit;
