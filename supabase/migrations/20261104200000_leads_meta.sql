-- §137 (04/11–05/11, Rafael): lead da Meta direto no painel. A agência (Connect Max) envia cada lead por webhook
-- para a Edge Function leads-meta; ela grava pela leads_entrada2 e registra o recebimento em leads_webhook_log.
-- leads_entrada2 = leads_entrada com p_espelho (enfileira ou não para a planilha) e p_origem ('planilha' | 'meta').
-- A leads_entrada(jsonb) continua existindo e chama a 2 com (true, 'planilha'): a planilha-espelho não muda.
-- Sem apagar função nem coluna (o conector recusa esse tipo de comando). Aplicar com execute_sql. Conferência: supabase/tests/leads_meta_check.sql.
begin;

alter table public.leads add column if not exists origem_entrada text;
alter table public.leads add column if not exists meta_visto_em timestamptz;

-- um registro por lead recebido no webhook (sem nome, telefone, e-mail nem CNPJ): ensaio, auditoria e paralelo
create table if not exists public.leads_webhook_log (
  id bigserial primary key,
  recebido_em timestamptz not null default now(),
  lead_id text not null,
  aba text,
  criado_em_lead timestamptz,
  modo text not null,
  resultado text not null,
  ja_existia boolean not null default false
);
create index if not exists leads_webhook_log_lead_id_idx on public.leads_webhook_log (lead_id);
create index if not exists leads_webhook_log_recebido_em_idx on public.leads_webhook_log (recebido_em);
alter table public.leads_webhook_log enable row level security;   -- sem policy: só service role e funções security definer

insert into public.config (chave, valor)
select 'leads_meta', '{"modo":"desligado","paralelo_desde":null,"alerta_horas":4}'
 where not exists (select 1 from public.config where chave = 'leads_meta');
insert into public.config (chave, valor)
select 'leads_meta_status', '{}'
 where not exists (select 1 from public.config where chave = 'leads_meta_status');

create or replace function public.leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_ins int := 0; v_vis int := 0; n int; v_aba text; v_ts timestamptz;
begin
  if coalesce(p_origem, '') not in ('planilha', 'meta') then
    raise exception 'origem inválida: %', p_origem using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    if exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- §137: a Meta também viu um lead que já entrou (pela planilha ou por rodada anterior)
      if p_origem = 'meta' then
        update public.leads set meta_visto_em = now() where id = r ->> 'id' and meta_visto_em is null;
        get diagnostics n = row_count;
        v_vis := v_vis + n;
      end if;
      continue;
    end if;
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    v_aba := public.leads_mes_aba(v_ts);
    -- planilha (cron de 10 s) e webhook da agência podem trazer o mesmo lead ao mesmo tempo
    insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                              form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                              city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em,
                              origem_entrada, meta_visto_em)
    values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
            r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
            coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
            r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
            r ->> 'lead_status', 'sem_contato', false, 0, now(), now(),
            p_origem, case when p_origem = 'meta' then now() end)
    on conflict (aba, id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      if p_espelho then perform public.leads_espelho_enfileirar(v_aba, r ->> 'id'); end if;
      v_ins := v_ins + 1;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', 0, 'vistos', v_vis);
end $$;

create or replace function public.leads_entrada(p_leads jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select public.leads_entrada2(p_leads, true, 'planilha');
$$;

-- registra os leads recebidos e atualiza o status numa transação só (envios simultâneos não se atropelam)
create or replace function public.leads_meta_registrar(p_itens jsonb, p_campos jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.leads_webhook_log (lead_id, aba, criado_em_lead, modo, resultado, ja_existia)
  select x ->> 'lead_id', x ->> 'aba', nullif(x ->> 'criado_em', '')::timestamptz, x ->> 'modo', x ->> 'resultado',
         coalesce((x ->> 'ja_existia')::boolean, false)
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) x;
  update public.config
     set valor = (coalesce(nullif(valor, ''), '{}')::jsonb
                  || jsonb_build_object('ultimo_recebido_em', clock_timestamp(),
                                        'recebidos', coalesce((coalesce(nullif(valor, ''), '{}')::jsonb ->> 'recebidos')::int, 0)
                                                     + jsonb_array_length(coalesce(p_itens, '[]'::jsonb)))
                  || case when jsonb_array_length(coalesce(p_campos, '[]'::jsonb)) > 0
                          then jsonb_build_object('campos_desconhecidos', p_campos, 'campos_em', clock_timestamp()) else '{}'::jsonb end)::text,
         atualizado_em = now()
   where chave = 'leads_meta_status';
end $$;

create or replace function public.leads_meta_erro(p_msg text) returns void
language sql security definer set search_path = public as $$
  update public.config
     set valor = (coalesce(nullif(valor, ''), '{}')::jsonb || jsonb_build_object('ultimo_erro', left(p_msg, 300), 'erro_em', clock_timestamp()))::text,
         atualizado_em = now()
   where chave = 'leads_meta_status';
$$;

create or replace function public.leads_meta_aviso() returns text
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; s jsonb; v_modo text; v_rec timestamptz; v_err timestamptz; v_desde timestamptz; v_h int; n int; partes text[] := '{}';
begin
  begin
    select valor::jsonb into c from public.config where chave = 'leads_meta';
    select valor::jsonb into s from public.config where chave = 'leads_meta_status';
  exception when others then
    -- JSON errado numa edição à mão não pode derrubar a leads_kanban_versao (quadro do gestor parava de atualizar)
    return 'Leads da Meta: config.leads_meta ou leads_meta_status inválido';
  end;
  v_modo := coalesce(c ->> 'modo', 'desligado');
  if v_modo not in ('ensaio', 'paralelo', 'principal') then return ''; end if;
  s := coalesce(s, '{}'::jsonb);
  v_rec := nullif(s ->> 'ultimo_recebido_em', '')::timestamptz;
  v_err := nullif(s ->> 'erro_em', '')::timestamptz;
  v_h := coalesce(nullif(c ->> 'alerta_horas', '')::int, 4);
  -- envio recusado nas últimas 24 h e nada recebido depois
  if v_err > now() - interval '24 hours' and (v_rec is null or v_err > v_rec) then
    partes := partes || format('Webhook dos leads recusou um envio em %s: %s',
      to_char(v_err at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), coalesce(s ->> 'ultimo_erro', ''));
  end if;
  -- paralelo: lead que chegou pela planilha e não pelo webhook (15 min de folga)
  if v_modo = 'paralelo' then
    v_desde := coalesce(nullif(c ->> 'paralelo_desde', '')::timestamptz, now());
    select count(*) into n from public.leads l
     where l.origem_entrada = 'planilha' and l.apagado_em is null and l.meta_visto_em is null
       and l.criado_em_lead >= v_desde and l.criado_em_lead < now() - interval '15 minutes'
       and not exists (select 1 from public.leads_webhook_log w where w.lead_id = l.id);
    if n > 0 then partes := partes || format('%s lead(s) chegaram pela planilha e não pelo webhook da agência', n); end if;
  end if;
  -- principal: silêncio longo em horário comercial (9h–20h de SP)
  if v_modo = 'principal' and extract(hour from now() at time zone 'America/Sao_Paulo') between 9 and 20
     and coalesce(v_rec, '-infinity'::timestamptz) < now() - make_interval(hours => v_h) then
    partes := partes || format('Nenhum lead chegou pelo webhook da agência há mais de %s h', v_h);
  end if;
  -- campo fora do padrão nas últimas 24 h (ensaio e paralelo)
  if v_modo in ('ensaio', 'paralelo') and jsonb_array_length(coalesce(s -> 'campos_desconhecidos', '[]'::jsonb)) > 0
     and nullif(s ->> 'campos_em', '')::timestamptz > now() - interval '24 hours' then
    partes := partes || ('Campo novo no envio da agência: '
      || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(s -> 'campos_desconhecidos') x));
  end if;
  return array_to_string(partes, ' · ');
end $$;

-- o aviso entra na versão (só o hash): o quadro do gestor recarrega quando ele aparece, muda ou some
create or replace function public.leads_kanban_versao()
 returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), max(apagado_em),
                   count(*) filter (where dono_id is null and categoria = 'sem_contato' and apagado_em is null),
                   md5(public.leads_meta_aviso()))
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day' or apagado_em >= now() - interval '1 day';
$$;

revoke all on function public.leads_entrada2(jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.leads_entrada(jsonb) from public, anon, authenticated;
revoke all on function public.leads_meta_registrar(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.leads_meta_erro(text) from public, anon, authenticated;
revoke all on function public.leads_meta_aviso() from public, anon;
grant execute on function public.leads_meta_aviso() to authenticated;
revoke all on table public.leads_webhook_log from anon, authenticated;

commit;
