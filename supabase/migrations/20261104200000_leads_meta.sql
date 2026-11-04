-- §137 (04/11, Rafael): lead direto da Meta no painel (Edge Function leads-meta).
-- leads_entrada2 = leads_entrada com p_espelho (enfileira ou não para a planilha) e p_origem ('planilha' | 'meta').
-- A leads_entrada(jsonb) continua existindo e chama a 2 com (true, 'planilha'): a planilha-espelho não muda.
-- Sem apagar função nem coluna (o conector recusa esse tipo de comando). Aplicar com execute_sql. Conferência: supabase/tests/leads_meta_check.sql.
begin;

alter table public.leads add column if not exists origem_entrada text;
alter table public.leads add column if not exists meta_visto_em timestamptz;

insert into public.config (chave, valor)
select 'leads_meta', '{"modo":"desligado","page_id":"","form_ids":[],"cursor":null}'
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
    -- cron de 10 s (planilha) e de 1 min (Meta): os dois podem trazer o mesmo lead ao mesmo tempo
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

-- grava o cursor sem reescrever o resto do JSON (o Rafael pode trocar o modo no meio de uma rodada); nunca volta
create or replace function public.leads_meta_cursor(p_cursor timestamptz) returns void
language sql security definer set search_path = public as $$
  update public.config
     set valor = jsonb_set(valor::jsonb, '{cursor}', to_jsonb(p_cursor))::text, atualizado_em = now()
   where chave = 'leads_meta'
     and (nullif(valor::jsonb ->> 'cursor', '') is null or (valor::jsonb ->> 'cursor')::timestamptz < p_cursor);
$$;

create or replace function public.leads_meta_aviso() returns text
language plpgsql stable security definer set search_path = public as $$
declare c jsonb; s jsonb; v_modo text; v_ok timestamptz; v_lim int; partes text[] := '{}';
begin
  select valor::jsonb into c from public.config where chave = 'leads_meta';
  select valor::jsonb into s from public.config where chave = 'leads_meta_status';
  v_modo := coalesce(c ->> 'modo', 'desligado');
  if v_modo not in ('ensaio', 'paralelo', 'principal') then return ''; end if;
  s := coalesce(s, '{}'::jsonb);
  v_ok := nullif(s ->> 'ultima_ok', '')::timestamptz;
  v_lim := case v_modo when 'principal' then 5 when 'paralelo' then 30 end;
  if v_lim is not null and (v_ok is null or v_ok < now() - make_interval(mins => v_lim)) then
    partes := partes || format('Leads da Meta: busca parada desde %s%s',
      coalesce(to_char(v_ok at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'o início'),
      case when coalesce(s ->> 'ultimo_erro', '') <> '' then ' — ' || (s ->> 'ultimo_erro') else '' end);
  end if;
  if jsonb_array_length(coalesce(s -> 'forms_fora', '[]'::jsonb)) > 0 then
    partes := partes || ('Formulário novo na Meta fora da busca: '
      || (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(s -> 'forms_fora') x));
  end if;
  if v_modo in ('ensaio', 'paralelo') and jsonb_array_length(coalesce(s -> 'campos_desconhecidos', '[]'::jsonb)) > 0 then
    partes := partes || ('Pergunta nova no formulário da Meta: '
      || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(s -> 'campos_desconhecidos') x));
  end if;
  return array_to_string(partes, ' · ');
end $$;

-- o aviso entra na versão: o quadro do gestor recarrega quando ele aparece ou some
create or replace function public.leads_kanban_versao()
 returns text language sql stable security definer set search_path to 'public' as $$
  select concat_ws('|', max(primeira_sync_em), max(pego_em), max(classificado_em), max(apagado_em),
                   count(*) filter (where dono_id is null and categoria = 'sem_contato' and apagado_em is null),
                   public.leads_meta_aviso())
    from public.leads where criado_em_lead >= now() - interval '60 days' or classificado_em >= now() - interval '1 day' or apagado_em >= now() - interval '1 day';
$$;

revoke all on function public.leads_entrada2(jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.leads_entrada(jsonb) from public, anon, authenticated;
revoke all on function public.leads_meta_cursor(timestamptz) from public, anon, authenticated;
revoke all on function public.leads_meta_aviso() from public, anon;
grant execute on function public.leads_meta_aviso() to authenticated;

commit;
