# Leads direto da Meta no painel (§137) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** uma Edge Function `leads-meta` que, a cada 1 min, busca os leads do formulário na Graph API da Meta e os grava no painel pela mesma porta da planilha (`leads_entrada`), com modos `desligado`/`ensaio`/`paralelo`/`principal` em `config`.

**Architecture:** mesmo molde da `planilha-espelho`: lógica pura com deps injetadas (`converter.ts`, `meta.ts`, `rodada.ts`) testada com `node --test`, e um `index.ts` fino que liga Supabase e Graph API. No banco, a `leads_entrada` ganha uma irmã `leads_entrada2(p_leads, p_espelho, p_origem)` (a antiga passa a chamá-la, sem `DROP`), duas colunas em `leads`, o cursor gravado por RPC atômica e um aviso `leads_meta_aviso()` que o painel mostra ao gestor.

**Tech Stack:** Deno/TypeScript (Edge Function Supabase), testes com `node --test` (Node 24 lê `.ts`), PostgreSQL (plpgsql, pg_cron, pg_net, Vault), HTML único do painel (`_template.html` + `painel_clientes_apex.html`).

**Spec:** `docs/superpowers/specs/2026-11-04-leads-meta-entrada-design.md`

## Global Constraints

- Seção do REGRAS: **§137**.
- Supabase `mdgfboijyqfkggcrhptn` é **produção**: migration, deploy, cron, secret e `update` em `config` só com **ok do Rafael**, cada um.
- Repositório **público**: nada de token, telefone, CNPJ, e-mail ou nome de lead em código, teste, log, commit ou `config`. Nos testes, só dados fictícios com prefixo `Zz`/`zz`.
- `META_PAGE_TOKEN` só como secret da função; nunca em URL (vai no cabeçalho `Authorization: Bearer`), nunca em mensagem de erro.
- SQL pelo conector: **sem `DROP`** nas migrations aplicadas com `execute_sql` (falha com "Invalid or expired requestState"); usar `begin; … commit;`. O rollback tem `DROP` e roda pelo SQL Editor do Supabase se o conector recusar.
- O formato gravado é o da planilha: `l:`/`ag:`/`as:`/`c:`/`f:` nos ids, `p:` no telefone, `lead_status = 'CREATED'`.
- Cursor: a busca sempre volta **15 min** antes do cursor; sem cursor, busca as últimas **24 h**; o cursor só anda depois de uma rodada inteira ok e nunca volta.
- Limites do aviso: **30 min** sem rodada ok no `paralelo`, **5 min** no `principal`; no `ensaio` não há limite de tempo.
- Cron a cada 1 min (`* * * * *`), `x-cron-secret` do Vault `sync_producao_cron_secret` (a função lê `SYNC_CRON_SECRET`), `timeout_milliseconds := 50000`.
- O painel só muda na linha do aviso do gestor; consultor não vê nada novo. Mudar `_template.html` e `painel_clientes_apex.html` igual.
- Publicação do painel só com ok do Rafael, seguindo o processo de sempre (comparar com o ar, backup, MD5 no mesmo comando, vigia).

## Review Focus

- **Hora com `+0000`** (formato da Graph API, sem dois-pontos): tem que virar a mesma `aba` que o `-05:00` da planilha; um lead do dia 1º às 01:30 de São Paulo é do mês novo, não do anterior. Teste em `converter.test.ts`.
- **Pergunta com nome levemente diferente** (sem `?`, maiúscula): tem que cair no campo certo, não em `campos_desconhecidos`. Teste em `converter.test.ts`.
- **Paginação com muitas páginas ou `next` em loop**: a rodada não pode ficar presa; para em 50 páginas com erro claro. Teste em `meta.test.ts`.
- **Falha só na checagem de formulários** (token sem `pages_read_engagement`): não pode parar a entrada de leads. Teste em `rodada.test.ts`.
- **Troca de modo pelo Rafael no meio de uma rodada**: gravar o cursor não pode desfazer o `modo` novo. Coberto pela RPC `leads_meta_cursor` (jsonb_set) e testado em `leads_meta_check.sql`.

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261104200000_leads_meta.sql` (criar) | colunas, `config`, `leads_entrada2`, `leads_entrada` chamando a 2, `leads_meta_cursor`, `leads_meta_aviso`, `leads_kanban_versao` com o aviso |
| `supabase/rollback/20261104200000_leads_meta_rollback.sql` (criar) | desfaz a migration e o cron |
| `supabase/tests/leads_meta_check.sql` (criar) | conferência no banco (termina em exceção de propósito: nada fica gravado) |
| `supabase/tests/leads_meta_paralelo.sql` (criar) | relatório diário do paralelo (só leitura) |
| `supabase/migrations/20261104200100_leads_meta_cron.sql` (criar) | cron de 1 min (aplicar só depois do deploy da função) |
| `supabase/functions/leads-meta/converter.ts` + `.test.ts` (criar) | lead da Graph API → objeto da `leads_entrada`; `mesAba` |
| `supabase/functions/leads-meta/meta.ts` + `.test.ts` (criar) | cliente mínimo da Graph API |
| `supabase/functions/leads-meta/rodada.ts` + `.test.ts` (criar) | uma rodada: modos, cursor, status, checagem de formulários |
| `supabase/functions/leads-meta/index.ts` (criar) | porta, config, deps reais |
| `_template.html` e `painel_clientes_apex.html` (linha ~4381) | aviso do gestor lê também `leads_meta_aviso()` |
| `REGRAS_NEGOCIO.md` | §137 |

---

### Task 1: Banco — migration, rollback e conferência

**Files:**
- Create: `supabase/migrations/20261104200000_leads_meta.sql`
- Create: `supabase/rollback/20261104200000_leads_meta_rollback.sql`
- Create: `supabase/tests/leads_meta_check.sql`
- Create: `supabase/tests/leads_meta_paralelo.sql`

**Interfaces:**
- Produces:
  - `public.leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text) returns jsonb` → `{"inseridos": int, "atualizados": 0, "vistos": int}`; `p_origem` ∈ `planilha`/`meta`.
  - `public.leads_entrada(p_leads jsonb)` = `leads_entrada2(p_leads, true, 'planilha')` (a `planilha-espelho` não muda).
  - `public.leads_meta_cursor(p_cursor timestamptz) returns void` (só service role).
  - `public.leads_meta_aviso() returns text` (authenticated).
  - Colunas `leads.origem_entrada text`, `leads.meta_visto_em timestamptz`.
  - `config.leads_meta` = `{"modo":"desligado","page_id":"","form_ids":[],"cursor":null}`; `config.leads_meta_status` = `{}`.

- [ ] **Step 1: Escrever a migration**

`supabase/migrations/20261104200000_leads_meta.sql`:

```sql
-- §137 (04/11, Rafael): lead direto da Meta no painel (Edge Function leads-meta).
-- leads_entrada2 = leads_entrada com p_espelho (enfileira ou não para a planilha) e p_origem ('planilha' | 'meta').
-- A leads_entrada(jsonb) continua existindo e chama a 2 com (true, 'planilha'): a planilha-espelho não muda.
-- Sem DROP (o conector recusa). Aplicar com execute_sql. Conferência: supabase/tests/leads_meta_check.sql.
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
```

- [ ] **Step 2: Escrever o rollback**

`supabase/rollback/20261104200000_leads_meta_rollback.sql`:

```sql
-- Desfaz a §137 (20261104200000_leads_meta.sql e 20261104200100_leads_meta_cron.sql).
-- Tem DROP: se o conector recusar, rodar no SQL Editor do Supabase.
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'leads-meta';

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
drop function if exists public.leads_meta_cursor(timestamptz);
drop function if exists public.leads_meta_aviso();
alter table public.leads drop column if exists origem_entrada;
alter table public.leads drop column if exists meta_visto_em;
delete from public.config where chave in ('leads_meta', 'leads_meta_status');
commit;
```

- [ ] **Step 3: Escrever a conferência**

`supabase/tests/leads_meta_check.sql` (roda depois da migration aplicada; o `do` termina em exceção de propósito, então nada fica gravado):

```sql
-- §137: conferência da migration 20261104200000. Rodar no execute_sql. Resultado na mensagem 'RESULTADO: ...'.
-- Termina com exceção de propósito: os leads de teste e as mudanças de config são desfeitos.
do $$
declare v jsonb; f int; m text; ok text[] := '{}'; ts timestamptz := '2026-11-04T22:06:57Z';
  um jsonb := jsonb_build_array(jsonb_build_object('id', 'l:zzmeta1', 'criado_em_lead', ts, 'full_name', 'Zz Teste'));
begin
  -- 1. Meta no paralelo: grava, não enfileira, marca origem e meta_visto_em
  v := public.leads_entrada2(um, false, 'meta');
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta1';
  if (v ->> 'inseridos')::int <> 1 or f <> 0 then raise exception 'FALHOU 1: % fila=%', v, f; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta1' and origem_entrada = 'meta' and meta_visto_em is not null and aba = 'NOVEMBRO')
    then raise exception 'FALHOU 1b: origem/visto/aba'; end if;
  ok := ok || '1';
  -- 2. mesmo lead de novo: não duplica, não conta como visto de novo
  v := public.leads_entrada2(um, false, 'meta');
  if (v ->> 'inseridos')::int <> 0 or (v ->> 'vistos')::int <> 0 then raise exception 'FALHOU 2: %', v; end if;
  ok := ok || '2';
  -- 3. chamada antiga (planilha): enfileira como antes e grava origem planilha
  v := public.leads_entrada(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', ts)));
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta2';
  if (v ->> 'inseridos')::int <> 1 or f <> 1 then raise exception 'FALHOU 3: % fila=%', v, f; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta2' and origem_entrada = 'planilha' and meta_visto_em is null)
    then raise exception 'FALHOU 3b'; end if;
  ok := ok || '3';
  -- 4. a Meta vê o lead que veio da planilha: só ganha meta_visto_em
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta2', 'criado_em_lead', ts)), false, 'meta');
  if (v ->> 'vistos')::int <> 1 or (v ->> 'inseridos')::int <> 0 then raise exception 'FALHOU 4: %', v; end if;
  if not exists (select 1 from public.leads where id = 'l:zzmeta2' and origem_entrada = 'planilha' and meta_visto_em is not null)
    then raise exception 'FALHOU 4b'; end if;
  ok := ok || '4';
  -- 5. principal: enfileira
  v := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'l:zzmeta3', 'criado_em_lead', ts)), true, 'meta');
  select count(*) into f from public.leads_espelho where lead_id = 'l:zzmeta3';
  if f <> 1 then raise exception 'FALHOU 5: fila=%', f; end if;
  ok := ok || '5';
  -- 6. origem inválida recusa
  begin perform public.leads_entrada2(um, false, 'outra'); raise exception 'FALHOU 6: aceitou origem inválida';
  exception when sqlstate '22023' then ok := ok || '6'; end;
  -- 7. cursor: grava, não volta, não mexe no modo
  update public.config set valor = '{"modo":"paralelo","page_id":"zz","form_ids":["1"],"cursor":null}' where chave = 'leads_meta';
  perform public.leads_meta_cursor('2026-11-04T10:00:00Z');
  perform public.leads_meta_cursor('2026-11-04T09:00:00Z');
  select valor into m from public.config where chave = 'leads_meta';
  if (m::jsonb ->> 'cursor')::timestamptz <> '2026-11-04T10:00:00Z' or m::jsonb ->> 'modo' <> 'paralelo' then raise exception 'FALHOU 7: %', m; end if;
  ok := ok || '7';
  -- 8. aviso: paralelo 10 min = nada; 40 min = aviso; principal 10 min = aviso; desligado = nada
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '10 minutes')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() <> '' then raise exception 'FALHOU 8a: %', public.leads_meta_aviso(); end if;
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '40 minutes', 'ultimo_erro', 'Graph 401')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() not like 'Leads da Meta: busca parada desde%Graph 401' then raise exception 'FALHOU 8b: %', public.leads_meta_aviso(); end if;
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"principal"')::text where chave = 'leads_meta';
  update public.config set valor = jsonb_build_object('ultima_ok', now() - interval '10 minutes')::text where chave = 'leads_meta_status';
  if public.leads_meta_aviso() = '' then raise exception 'FALHOU 8c'; end if;
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"desligado"')::text where chave = 'leads_meta';
  if public.leads_meta_aviso() <> '' then raise exception 'FALHOU 8d'; end if;
  ok := ok || '8';
  -- 9. formulário fora e pergunta nova
  update public.config set valor = jsonb_set(valor::jsonb, '{modo}', '"ensaio"')::text where chave = 'leads_meta';
  update public.config set valor = '{"forms_fora":[{"id":"9","name":"Zz Form"}],"campos_desconhecidos":["zz_pergunta"]}' where chave = 'leads_meta_status';
  if public.leads_meta_aviso() <> 'Formulário novo na Meta fora da busca: Zz Form · Pergunta nova no formulário da Meta: zz_pergunta'
    then raise exception 'FALHOU 9: %', public.leads_meta_aviso(); end if;
  ok := ok || '9';
  -- 10. a versão do quadro muda com o aviso
  m := public.leads_kanban_versao();
  update public.config set valor = '{}' where chave = 'leads_meta_status';
  if public.leads_kanban_versao() = m then raise exception 'FALHOU 10: versão não mudou'; end if;
  ok := ok || '10';
  raise exception 'RESULTADO: OK %', array_to_string(ok, ',');
end $$;
```

- [ ] **Step 4: Escrever o relatório do paralelo**

`supabase/tests/leads_meta_paralelo.sql`:

```sql
-- §137: relatório do paralelo (só leitura). Trocar a data pelo início do paralelo.
with base as (
  select id, aba, criado_em_lead, origem_entrada, meta_visto_em
    from public.leads where criado_em_lead >= timestamptz '2026-11-05 00:00-03' and apagado_em is null
)
select (criado_em_lead at time zone 'America/Sao_Paulo')::date as dia,
       count(*) filter (where origem_entrada = 'meta') as entrou_pela_meta,
       count(*) filter (where origem_entrada = 'planilha') as entrou_pela_planilha,
       count(*) filter (where meta_visto_em is null) as meta_nao_viu,
       string_agg(id, ', ') filter (where meta_visto_em is null) as ids_que_a_meta_nao_viu
  from base group by 1 order by 1;
```

- [ ] **Step 5: Conferir o SQL sem aplicar**

Ler a migration e o rollback lado a lado com `supabase/migrations/20261026120100_leads_kanban_rpcs.sql` (corpo antigo da `leads_entrada`) e `20261027190000_leads_apagar_versao_dono.sql` (`leads_kanban_versao`): a lista de colunas do `insert` e o `concat_ws` têm que bater, fora o que a §137 acrescenta.

Run: `grep -c -i "drop " supabase/migrations/20261104200000_leads_meta.sql`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261104200000_leads_meta.sql supabase/rollback/20261104200000_leads_meta_rollback.sql supabase/tests/leads_meta_check.sql supabase/tests/leads_meta_paralelo.sql
git commit -m "feat(leads-meta): banco da secao 137 (leads_entrada2, cursor, aviso)"
```

(A aplicação no banco é a Task 6, com ok do Rafael.)

---

### Task 2: `converter.ts` — lead da Graph API no formato da planilha

**Files:**
- Create: `supabase/functions/leads-meta/converter.ts`
- Test: `supabase/functions/leads-meta/converter.test.ts`

**Interfaces:**
- Produces:
  - `type CampoMeta = { name: string; values?: string[] }`
  - `type LeadMeta = { id: string; created_time: string; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string; form_id?: string; is_organic?: boolean; platform?: string; field_data?: CampoMeta[] }`
  - `type LeadEntrada = { id: string; criado_em_lead: string; ad_id: string | null; ad_name: string | null; adset_id: string | null; adset_name: string | null; campaign_id: string | null; campaign_name: string | null; form_id: string | null; form_name: string | null; is_organic: boolean; platform: string | null; tipo_empresa: string | null; qtd_linhas: string | null; cnpj: string | null; email: string | null; full_name: string | null; city: string | null; state: string | null; phone_number: string | null; lead_status: string }`
  - `function converter(l: LeadMeta, formName: string | null): { lead: LeadEntrada | null; desconhecidos: string[] }` (`lead = null` quando falta id ou a hora é inválida)
  - `function mesAba(iso: string): string` (mesmo resultado de `leads_mes_aba`)
  - `function horaIso(s: string): string | null` (aceita `+0000` e `-05:00`, devolve ISO UTC)

- [ ] **Step 1: Escrever os testes**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { converter, horaIso, mesAba } from "./converter.ts";
import type { LeadMeta } from "./converter.ts";

const base = (o: Partial<LeadMeta> = {}): LeadMeta => ({
  id: "100200300", created_time: "2026-11-04T22:06:57+0000",
  ad_id: "111", ad_name: "Zz Anúncio", adset_id: "222", adset_name: "Zz Conjunto", campaign_id: "333", campaign_name: "Zz Campanha",
  form_id: "444", is_organic: false, platform: "fb",
  field_data: [
    { name: "qual_o_tipo_da_sua_empresa?", values: ["zz_mei"] },
    { name: "qual_a_quantidade_de_linhas?", values: ["zz_1_a_5"] },
    { name: "qual_o_seu_cnpj?", values: ["00000000000000"] },
    { name: "email", values: ["zz@zz.zz"] },
    { name: "full_name", values: ["Zz Fulano"] },
    { name: "city", values: ["Zz Cidade"] },
    { name: "state", values: ["ZZ"] },
    { name: "phone_number", values: ["+5500000000000"] },
  ],
  ...o,
});

test("converte no formato da planilha: prefixos, p: no telefone, perguntas, CREATED", () => {
  const { lead, desconhecidos } = converter(base(), "Zz Formulário");
  assert.deepEqual(desconhecidos, []);
  assert.deepEqual(lead, {
    id: "l:100200300", criado_em_lead: "2026-11-04T22:06:57.000Z",
    ad_id: "ag:111", ad_name: "Zz Anúncio", adset_id: "as:222", adset_name: "Zz Conjunto", campaign_id: "c:333", campaign_name: "Zz Campanha",
    form_id: "f:444", form_name: "Zz Formulário", is_organic: false, platform: "fb",
    tipo_empresa: "zz_mei", qtd_linhas: "zz_1_a_5", cnpj: "00000000000000", email: "zz@zz.zz", full_name: "Zz Fulano",
    city: "Zz Cidade", state: "ZZ", phone_number: "p:+5500000000000", lead_status: "CREATED",
  });
});

test("orgânico: sem anúncio e sem platform viram null", () => {
  const { lead } = converter(base({ ad_id: undefined, ad_name: undefined, adset_id: undefined, adset_name: undefined,
    campaign_id: undefined, campaign_name: undefined, platform: "", is_organic: true }), null);
  assert.equal(lead!.ad_id, null);
  assert.equal(lead!.campaign_name, null);
  assert.equal(lead!.platform, null);
  assert.equal(lead!.is_organic, true);
  assert.equal(lead!.form_name, null);
});

test("não põe prefixo duas vezes", () => {
  const { lead } = converter(base({ id: "l:100200300", form_id: "f:444" }), null);
  assert.equal(lead!.id, "l:100200300");
  assert.equal(lead!.form_id, "f:444");
  const t = converter(base({ field_data: [{ name: "phone_number", values: ["p:+5500000000000"] }] }), null);
  assert.equal(t.lead!.phone_number, "p:+5500000000000");
});

test("pergunta com nome levemente diferente (sem ?, maiúscula) cai no campo certo", () => {
  const { lead, desconhecidos } = converter(base({ field_data: [{ name: "Qual_o_seu_CNPJ", values: ["00000000000000"] }] }), null);
  assert.equal(lead!.cnpj, "00000000000000");
  assert.deepEqual(desconhecidos, []);
});

test("pergunta desconhecida é ignorada e listada", () => {
  const { lead, desconhecidos } = converter(base({ field_data: [{ name: "zz_pergunta_nova", values: ["x"] }] }), null);
  assert.ok(lead);
  assert.deepEqual(desconhecidos, ["zz_pergunta_nova"]);
});

test("sem id ou com hora inválida: lead null", () => {
  assert.equal(converter(base({ id: "" }), null).lead, null);
  assert.equal(converter(base({ created_time: "ontem" }), null).lead, null);
});

test("horaIso aceita +0000 e -05:00 e dá o mesmo instante", () => {
  assert.equal(horaIso("2026-11-04T22:06:57+0000"), "2026-11-04T22:06:57.000Z");
  assert.equal(horaIso("2026-11-04T17:06:57-05:00"), "2026-11-04T22:06:57.000Z");
  assert.equal(horaIso("zz"), null);
});

test("mesAba usa o horário de São Paulo (igual leads_mes_aba)", () => {
  assert.equal(mesAba("2026-11-04T22:06:57.000Z"), "NOVEMBRO");
  assert.equal(mesAba("2026-12-01T02:30:00.000Z"), "NOVEMBRO");   // 30/11 23:30 em SP
  assert.equal(mesAba("2026-12-01T04:30:00.000Z"), "DEZEMBRO");   // 01/12 01:30 em SP
  assert.equal(mesAba("2026-03-15T12:00:00.000Z"), "MARCO");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/leads-meta && node --test converter.test.ts`
Expected: FAIL (`Cannot find module './converter.ts'`)

- [ ] **Step 3: Implementar**

```ts
// Lead da Graph API da Meta → objeto da RPC leads_entrada2, no mesmo formato que a planilha grava (§137).
// Sem rede e sem Deno: testado com `node --test`.
export type CampoMeta = { name: string; values?: string[] };
export type LeadMeta = {
  id: string; created_time: string; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string;
  campaign_id?: string; campaign_name?: string; form_id?: string; is_organic?: boolean; platform?: string; field_data?: CampoMeta[];
};
export type LeadEntrada = {
  id: string; criado_em_lead: string; ad_id: string | null; ad_name: string | null; adset_id: string | null; adset_name: string | null;
  campaign_id: string | null; campaign_name: string | null; form_id: string | null; form_name: string | null; is_organic: boolean;
  platform: string | null; tipo_empresa: string | null; qtd_linhas: string | null; cnpj: string | null; email: string | null;
  full_name: string | null; city: string | null; state: string | null; phone_number: string | null; lead_status: string;
};
type CampoPergunta = "tipo_empresa" | "qtd_linhas" | "cnpj" | "email" | "full_name" | "city" | "state" | "phone_number";

// Nome da pergunta (sem "?", minúsculo) → campo. Os nomes são os do cabeçalho da planilha (o ensaio confirma).
const PERGUNTAS: Record<string, CampoPergunta> = {
  qual_o_tipo_da_sua_empresa: "tipo_empresa", qual_a_quantidade_de_linhas: "qtd_linhas", qual_o_seu_cnpj: "cnpj",
  email: "email", full_name: "full_name", city: "city", state: "state", phone_number: "phone_number",
};
const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

const normPergunta = (s: string) => s.trim().toLowerCase().replace(/\?+$/, "");
const vazio = (s: string | undefined | null) => (s ?? "").trim() === "";
function prefixo(p: string, v: string | undefined | null): string | null {
  if (vazio(v)) return null;
  const t = v!.trim();
  return t.startsWith(p) ? t : p + t;
}

// A Graph API manda "+0000" (sem dois-pontos); a planilha, "-05:00". Devolve ISO UTC ou null.
export function horaIso(s: string): string | null {
  const t = (s ?? "").trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(t);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

// Igual a public.leads_mes_aba: mês do horário de São Paulo.
export function mesAba(iso: string): string {
  const mes = Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", month: "numeric" }));
  return MESES[mes - 1];
}

export function converter(l: LeadMeta, formName: string | null): { lead: LeadEntrada | null; desconhecidos: string[] } {
  const desconhecidos: string[] = [];
  const criado = horaIso(l.created_time);
  if (vazio(l.id) || !criado) return { lead: null, desconhecidos };
  const perguntas: Partial<Record<CampoPergunta, string | null>> = {};
  for (const c of l.field_data ?? []) {
    const campo = PERGUNTAS[normPergunta(c.name)];
    if (!campo) { desconhecidos.push(c.name); continue; }
    const v = (c.values ?? [])[0];
    perguntas[campo] = vazio(v) ? null : v.trim();
  }
  const lead: LeadEntrada = {
    id: prefixo("l:", l.id)!, criado_em_lead: criado,
    ad_id: prefixo("ag:", l.ad_id), ad_name: vazio(l.ad_name) ? null : l.ad_name!,
    adset_id: prefixo("as:", l.adset_id), adset_name: vazio(l.adset_name) ? null : l.adset_name!,
    campaign_id: prefixo("c:", l.campaign_id), campaign_name: vazio(l.campaign_name) ? null : l.campaign_name!,
    form_id: prefixo("f:", l.form_id), form_name: vazio(formName) ? null : formName,
    is_organic: l.is_organic === true, platform: vazio(l.platform) ? null : l.platform!,
    tipo_empresa: perguntas.tipo_empresa ?? null, qtd_linhas: perguntas.qtd_linhas ?? null, cnpj: perguntas.cnpj ?? null,
    email: perguntas.email ?? null, full_name: perguntas.full_name ?? null, city: perguntas.city ?? null, state: perguntas.state ?? null,
    phone_number: prefixo("p:", perguntas.phone_number), lead_status: "CREATED",
  };
  return { lead, desconhecidos };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/leads-meta && node --test converter.test.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/leads-meta/converter.ts supabase/functions/leads-meta/converter.test.ts
git commit -m "feat(leads-meta): converter lead da Graph API no formato da planilha"
```

---

### Task 3: `meta.ts` — cliente mínimo da Graph API

**Files:**
- Create: `supabase/functions/leads-meta/meta.ts`
- Test: `supabase/functions/leads-meta/meta.test.ts`

**Interfaces:**
- Consumes: `LeadMeta` de `./converter.ts`.
- Produces:
  - `type FetchFn = (url: string, init?: RequestInit) => Promise<Response>`
  - `type FormMeta = { id: string; name: string; status: string }`
  - `type Meta = { leadsDesde(formId: string, desdeSeg: number): Promise<LeadMeta[]>; nomeForm(formId: string): Promise<string | null>; forms(pageId: string): Promise<FormMeta[]> }`
  - `const GRAPH_VERSAO: string`, `const MAX_PAGINAS = 50`
  - `function criarMeta(token: string, f: FetchFn): Meta`

- [ ] **Step 1: Escrever os testes**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarMeta, GRAPH_VERSAO, MAX_PAGINAS } from "./meta.ts";

type Chamada = { url: string; init?: RequestInit };
function falso(respostas: (Chamada & { status?: number; corpo: unknown })[] | ((c: Chamada) => { status?: number; corpo: unknown })) {
  const chamadas: Chamada[] = [];
  let i = 0;
  const f = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const r = typeof respostas === "function" ? respostas({ url, init }) : respostas[i++];
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  };
  return { f, chamadas };
}
const G = `https://graph.facebook.com/${GRAPH_VERSAO}`;

test("leadsDesde: monta URL com campos e filtro, token só no cabeçalho, segue paginação", async () => {
  const { f, chamadas } = falso([
    { url: "", corpo: { data: [{ id: "1", created_time: "2026-11-04T22:00:00+0000" }], paging: { next: `${G}/444/leads?after=zz` } } },
    { url: "", corpo: { data: [{ id: "2", created_time: "2026-11-04T22:01:00+0000" }] } },
  ]);
  const leads = await criarMeta("tokzz", f).leadsDesde("444", 1762293000);
  assert.deepEqual(leads.map((l) => l.id), ["1", "2"]);
  const u = new URL(chamadas[0].url);
  assert.equal(u.origin + u.pathname, `${G}/444/leads`);
  assert.equal(u.searchParams.get("fields"), "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data");
  assert.deepEqual(JSON.parse(u.searchParams.get("filtering")!), [{ field: "time_created", operator: "GREATER_THAN", value: 1762293000 }]);
  assert.equal(u.searchParams.get("limit"), "100");
  assert.equal(u.searchParams.get("access_token"), null);
  assert.equal((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer tokzz");
  assert.equal(chamadas[1].url, `${G}/444/leads?after=zz`);
  assert.equal((chamadas[1].init?.headers as Record<string, string>).Authorization, "Bearer tokzz");
});

test("leadsDesde: para em MAX_PAGINAS com erro claro (next em loop)", async () => {
  const { f, chamadas } = falso(() => ({ corpo: { data: [], paging: { next: `${G}/444/leads?after=loop` } } }));
  await assert.rejects(criarMeta("tokzz", f).leadsDesde("444", 0), /mais de 50 páginas/);
  assert.equal(chamadas.length, MAX_PAGINAS);
});

test("erro HTTP vira exceção com status e mensagem da Meta, sem o token", async () => {
  const { f } = falso([{ url: "", status: 401, corpo: { error: { message: "Error validating access token tokzz", code: 190 } } }]);
  await assert.rejects(criarMeta("tokzz", f).leadsDesde("444", 0), (e: Error) => {
    assert.match(e.message, /^Graph 401 \(190\): Error validating access token/);
    assert.doesNotMatch(e.message, /tokzz/);
    return true;
  });
});

test("erro no corpo com HTTP 200 também vira exceção", async () => {
  const { f } = falso([{ url: "", corpo: { error: { message: "zz", code: 100 } } }]);
  await assert.rejects(criarMeta("tokzz", f).nomeForm("444"), /^Graph 200 \(100\): zz/);
});

test("nomeForm e forms", async () => {
  const { f, chamadas } = falso([
    { url: "", corpo: { id: "444", name: "Zz Formulário" } },
    { url: "", corpo: { data: [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "555", name: "Zz Velho", status: "ARCHIVED" }] } },
  ]);
  const m = criarMeta("tokzz", f);
  assert.equal(await m.nomeForm("444"), "Zz Formulário");
  assert.deepEqual(await m.forms("999"), [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "555", name: "Zz Velho", status: "ARCHIVED" }]);
  assert.equal(chamadas[0].url, `${G}/444?fields=name`);
  assert.equal(chamadas[1].url, `${G}/999/leadgen_forms?fields=id%2Cname%2Cstatus&limit=100`);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/leads-meta && node --test meta.test.ts`
Expected: FAIL (`Cannot find module './meta.ts'`)

- [ ] **Step 3: Conferir a versão atual da Graph API**

Abrir https://developers.facebook.com/docs/graph-api/changelog e usar a versão mais recente em `GRAPH_VERSAO` (abaixo está `v24.0`; trocar se houver mais nova).

- [ ] **Step 4: Implementar**

```ts
// Cliente mínimo da Graph API da Meta (§137). O token vai só no cabeçalho Authorization: nunca na URL nem no erro.
import type { LeadMeta } from "./converter.ts";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type FormMeta = { id: string; name: string; status: string };
export type Meta = {
  leadsDesde(formId: string, desdeSeg: number): Promise<LeadMeta[]>;
  nomeForm(formId: string): Promise<string | null>;
  forms(pageId: string): Promise<FormMeta[]>;
};

export const GRAPH_VERSAO = "v24.0";
export const MAX_PAGINAS = 50;
const API = `https://graph.facebook.com/${GRAPH_VERSAO}`;
const CAMPOS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data";

export function criarMeta(token: string, f: FetchFn): Meta {
  async function chamar(url: string): Promise<Record<string, unknown>> {
    const r = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = await r.json().catch(() => ({})) as Record<string, unknown>;
    const err = corpo.error as { message?: string; code?: number } | undefined;
    if (!r.ok || err) {
      const msg = String(err?.message ?? "sem mensagem").split(token).join("…").slice(0, 160);
      throw new Error(`Graph ${r.status} (${err?.code ?? "?"}): ${msg}`);
    }
    return corpo;
  }
  async function paginar<T>(primeira: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = primeira;
    for (let p = 0; url; p++) {
      if (p >= MAX_PAGINAS) throw new Error(`Graph: mais de ${MAX_PAGINAS} páginas, parei`);
      const j = await chamar(url);
      out.push(...((j.data as T[]) ?? []));
      url = (j.paging as { next?: string } | undefined)?.next;
    }
    return out;
  }
  return {
    leadsDesde(formId, desdeSeg) {
      const q = new URLSearchParams({
        fields: CAMPOS,
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desdeSeg }]),
        limit: "100",
      });
      return paginar<LeadMeta>(`${API}/${encodeURIComponent(formId)}/leads?${q}`);
    },
    async nomeForm(formId) {
      const j = await chamar(`${API}/${encodeURIComponent(formId)}?fields=name`);
      return typeof j.name === "string" ? j.name : null;
    },
    forms(pageId) {
      return paginar<FormMeta>(`${API}/${encodeURIComponent(pageId)}/leadgen_forms?${new URLSearchParams({ fields: "id,name,status", limit: "100" })}`);
    },
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd supabase/functions/leads-meta && node --test meta.test.ts`
Expected: PASS (5 testes). Se mudou `GRAPH_VERSAO`, os testes usam a constante e continuam valendo.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/leads-meta/meta.ts supabase/functions/leads-meta/meta.test.ts
git commit -m "feat(leads-meta): cliente da Graph API com paginacao e erro sem token"
```

---

### Task 4: `rodada.ts` — modos, cursor, status e checagem de formulários

**Files:**
- Create: `supabase/functions/leads-meta/rodada.ts`
- Test: `supabase/functions/leads-meta/rodada.test.ts`

**Interfaces:**
- Consumes: `converter`, `mesAba`, `horaIso`, `LeadEntrada` (`./converter.ts`); `Meta`, `FormMeta` (`./meta.ts`).
- Produces:
  - `type Modo = "desligado" | "ensaio" | "paralelo" | "principal"`
  - `type CfgMeta = { modo: Modo; page_id: string; form_ids: string[]; cursor: string | null }`
  - `type StatusMeta = { ultima_ok?: string; ultimo_erro?: string; erro_em?: string | null; buscados?: number; inseridos?: number; vistos?: number; invalidos?: number; campos_desconhecidos?: string[]; forms_fora?: { id: string; name: string }[]; forms_checado_em?: string; forms_erro?: string; ensaio?: { id: string; aba: string; ja_existia: boolean }[] }`
  - `type DepsMeta = { meta: Meta; cfg: CfgMeta; status: StatusMeta; agora: Date; idsExistentes(ids: string[]): Promise<Set<string>>; inserir(leads: LeadEntrada[], espelho: boolean): Promise<{ inseridos: number; vistos: number }>; salvarCursor(iso: string): Promise<void>; salvarStatus(s: StatusMeta): Promise<void> }`
  - `function rodar(d: DepsMeta): Promise<{ ok: boolean; modo: Modo; buscados: number; inseridos: number; vistos: number; invalidos: number; erro?: string }>`
  - Constantes: `VOLTA_MIN = 15`, `SEM_CURSOR_H = 24`, `FORMS_A_CADA_MIN = 60`, `ENSAIO_MAX = 50`.

- [ ] **Step 1: Escrever os testes**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rodar } from "./rodada.ts";
import type { CfgMeta, DepsMeta, StatusMeta } from "./rodada.ts";
import type { LeadEntrada, LeadMeta } from "./converter.ts";
import type { FormMeta } from "./meta.ts";

const AGORA = new Date("2026-11-04T22:10:00Z");
const lm = (id: string, t = "2026-11-04T22:06:57+0000", campos: LeadMeta["field_data"] = [{ name: "full_name", values: ["Zz " + id] }]): LeadMeta =>
  ({ id, created_time: t, form_id: "444", platform: "fb", field_data: campos });

function deps(o: { cfg?: Partial<CfgMeta>; status?: StatusMeta; leads?: Record<string, LeadMeta[]>; existentes?: string[];
  falharLeads?: boolean; falharForms?: boolean; forms?: FormMeta[] } = {}) {
  const log = { inseridos: [] as { leads: LeadEntrada[]; espelho: boolean }[], cursores: [] as string[], status: [] as StatusMeta[],
    desde: [] as number[], formsChamado: 0 };
  const d: DepsMeta = {
    meta: {
      async leadsDesde(formId, desde) { log.desde.push(desde); if (o.falharLeads) throw new Error("Graph 401 (190): zz"); return o.leads?.[formId] ?? []; },
      async nomeForm() { return "Zz Formulário"; },
      async forms() { log.formsChamado++; if (o.falharForms) throw new Error("Graph 403 (10): zz"); return o.forms ?? [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }]; },
    },
    cfg: { modo: "paralelo", page_id: "999", form_ids: ["444"], cursor: "2026-11-04T22:00:00.000Z", ...o.cfg },
    status: o.status ?? {},
    agora: AGORA,
    async idsExistentes(ids) { return new Set(ids.filter((i) => (o.existentes ?? []).includes(i))); },
    async inserir(leads, espelho) { log.inseridos.push({ leads, espelho }); return { inseridos: leads.length, vistos: 0 }; },
    async salvarCursor(iso) { log.cursores.push(iso); },
    async salvarStatus(s) { log.status.push(s); },
  };
  return { d, log };
}

test("desligado: não chama a Meta nem grava nada", async () => {
  const { d, log } = deps({ cfg: { modo: "desligado" } });
  const r = await rodar(d);
  assert.deepEqual(r, { ok: true, modo: "desligado", buscados: 0, inseridos: 0, vistos: 0, invalidos: 0 });
  assert.equal(log.desde.length + log.inseridos.length + log.cursores.length + log.status.length, 0);
});

test("paralelo: grava sem espelho, cursor = maior created_time, status ok", async () => {
  const { d, log } = deps({ leads: { "444": [lm("1", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:06:57+0000")] } });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 1);
  assert.equal(log.inseridos[0].espelho, false);
  assert.deepEqual(log.inseridos[0].leads.map((l) => l.id), ["l:1", "l:2"]);
  assert.equal(log.inseridos[0].leads[0].form_name, "Zz Formulário");
  assert.deepEqual(log.cursores, ["2026-11-04T22:06:57.000Z"]);
  const s = log.status.at(-1)!;
  assert.equal(s.ultima_ok, AGORA.toISOString());
  assert.equal(s.ultimo_erro, "");
  assert.equal(s.inseridos, 2);
});

test("principal: grava com espelho", async () => {
  const { d, log } = deps({ cfg: { modo: "principal" }, leads: { "444": [lm("1")] } });
  await rodar(d);
  assert.equal(log.inseridos[0].espelho, true);
});

test("busca volta 15 min antes do cursor; sem cursor, últimas 24 h", async () => {
  const a = deps();
  await rodar(a.d);
  assert.equal(a.log.desde[0], Date.parse("2026-11-04T21:45:00Z") / 1000);
  const b = deps({ cfg: { cursor: null } });
  await rodar(b.d);
  assert.equal(b.log.desde[0], Date.parse("2026-11-03T22:10:00Z") / 1000);
});

test("cursor não volta e não é gravado sem lead novo", async () => {
  const { d, log } = deps({ leads: { "444": [lm("1", "2026-11-04T21:50:00+0000")] } });
  await rodar(d);
  assert.deepEqual(log.cursores, []);
});

test("erro na Meta: cursor parado, nada gravado, status com erro e ultima_ok preservada", async () => {
  const { d, log } = deps({ falharLeads: true, status: { ultima_ok: "2026-11-04T22:00:00.000Z" } });
  const r = await rodar(d);
  assert.equal(r.ok, false);
  assert.match(r.erro!, /Graph 401/);
  assert.equal(log.inseridos.length + log.cursores.length, 0);
  const s = log.status.at(-1)!;
  assert.match(s.ultimo_erro!, /Graph 401/);
  assert.equal(s.erro_em, AGORA.toISOString());
  assert.equal(s.ultima_ok, "2026-11-04T22:00:00.000Z");
});

test("ensaio: não grava, guarda id/aba/ja_existia sem dado pessoal, limite de 50", async () => {
  const muitos = Array.from({ length: 60 }, (_, i) => lm(String(i)));
  const { d, log } = deps({ cfg: { modo: "ensaio" }, leads: { "444": muitos }, existentes: ["l:0"] });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 0);
  const e = log.status.at(-1)!.ensaio!;
  assert.equal(e.length, 50);
  assert.deepEqual(Object.keys(e[0]).sort(), ["aba", "id", "ja_existia"]);
  assert.deepEqual(e[0], { id: "l:0", aba: "NOVEMBRO", ja_existia: true });   // os 50 primeiros na ordem da Meta (mais novo primeiro)
  assert.equal(e[1].ja_existia, false);
  assert.ok(!JSON.stringify(log.status).includes("Zz "));
  assert.equal(log.cursores.length, 1);
});

test("lead inválido é contado e os outros seguem; pergunta nova vai para o status", async () => {
  const { d, log } = deps({ leads: { "444": [lm("", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:02:00+0000", [{ name: "zz_nova", values: ["x"] }])] } });
  const r = await rodar(d);
  assert.equal(r.invalidos, 1);
  assert.deepEqual(log.inseridos[0].leads.map((l) => l.id), ["l:2"]);
  assert.deepEqual(log.status.at(-1)!.campos_desconhecidos, ["zz_nova"]);
});

test("checagem de formulários: 1 vez por hora, avisa ativo fora da lista", async () => {
  const a = deps({ forms: [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "777", name: "Zz Novo", status: "ACTIVE" }, { id: "888", name: "Zz Velho", status: "ARCHIVED" }] });
  await rodar(a.d);
  assert.equal(a.log.formsChamado, 1);
  assert.deepEqual(a.log.status.at(-1)!.forms_fora, [{ id: "777", name: "Zz Novo" }]);
  const b = deps({ status: { forms_checado_em: "2026-11-04T21:30:00.000Z", forms_fora: [] } });
  await rodar(b.d);
  assert.equal(b.log.formsChamado, 0);
});

test("form_ids com prefixo f: também casam na checagem", async () => {
  const { d, log } = deps({ cfg: { form_ids: ["f:444"] } });
  await rodar(d);
  assert.deepEqual(log.status.at(-1)!.forms_fora, []);
});

test("falha só na checagem de formulários não para a entrada", async () => {
  const { d, log } = deps({ falharForms: true, leads: { "444": [lm("1")] } });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 1);
  const s = log.status.at(-1)!;
  assert.match(s.forms_erro!, /Graph 403/);
  assert.equal(s.ultimo_erro, "");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/leads-meta && node --test rodada.test.ts`
Expected: FAIL (`Cannot find module './rodada.ts'`)

- [ ] **Step 3: Implementar**

```ts
// Uma rodada da leads-meta (§137): busca na Meta → converte → grava (ou só conta no ensaio) → cursor e status.
// Idempotente: a busca volta 15 min antes do cursor e a leads_entrada2 ignora id repetido.
import { converter, horaIso, mesAba } from "./converter.ts";
import type { LeadEntrada } from "./converter.ts";
import type { Meta } from "./meta.ts";

export type Modo = "desligado" | "ensaio" | "paralelo" | "principal";
export type CfgMeta = { modo: Modo; page_id: string; form_ids: string[]; cursor: string | null };
export type StatusMeta = {
  ultima_ok?: string; ultimo_erro?: string; erro_em?: string | null; buscados?: number; inseridos?: number; vistos?: number;
  invalidos?: number; campos_desconhecidos?: string[]; forms_fora?: { id: string; name: string }[]; forms_checado_em?: string;
  forms_erro?: string; ensaio?: { id: string; aba: string; ja_existia: boolean }[];
};
export type DepsMeta = {
  meta: Meta; cfg: CfgMeta; status: StatusMeta; agora: Date;
  idsExistentes(ids: string[]): Promise<Set<string>>;
  inserir(leads: LeadEntrada[], espelho: boolean): Promise<{ inseridos: number; vistos: number }>;
  salvarCursor(iso: string): Promise<void>;
  salvarStatus(s: StatusMeta): Promise<void>;
};
export type ResultadoRodada = { ok: boolean; modo: Modo; buscados: number; inseridos: number; vistos: number; invalidos: number; erro?: string };

export const VOLTA_MIN = 15;
export const SEM_CURSOR_H = 24;
export const FORMS_A_CADA_MIN = 60;
export const ENSAIO_MAX = 50;

const semF = (id: string) => id.replace(/^f:/, "");

async function checarForms(d: DepsMeta, st: StatusMeta): Promise<StatusMeta> {
  const ultima = st.forms_checado_em ? Date.parse(st.forms_checado_em) : 0;
  if (d.agora.getTime() - ultima < FORMS_A_CADA_MIN * 60_000) return st;
  try {
    const nossos = new Set(d.cfg.form_ids.map(semF));
    const fora = (await d.meta.forms(d.cfg.page_id)).filter((f) => f.status === "ACTIVE" && !nossos.has(semF(f.id))).map((f) => ({ id: f.id, name: f.name }));
    return { ...st, forms_fora: fora, forms_checado_em: d.agora.toISOString(), forms_erro: "" };
  } catch (e) {
    // sem permissão para listar formulários não pode parar a entrada de leads
    return { ...st, forms_checado_em: d.agora.toISOString(), forms_erro: (e as Error).message };
  }
}

export async function rodar(d: DepsMeta): Promise<ResultadoRodada> {
  const modo = d.cfg.modo;
  const r: ResultadoRodada = { ok: true, modo, buscados: 0, inseridos: 0, vistos: 0, invalidos: 0 };
  if (modo !== "ensaio" && modo !== "paralelo" && modo !== "principal") return r;
  const agoraIso = d.agora.toISOString();
  try {
    const base = d.cfg.cursor ? Date.parse(d.cfg.cursor) - VOLTA_MIN * 60_000 : d.agora.getTime() - SEM_CURSOR_H * 3600_000;
    const desdeSeg = Math.floor(base / 1000);
    const leads: LeadEntrada[] = [];
    const desconhecidos = new Set<string>();
    for (const formId of d.cfg.form_ids) {
      const id = semF(formId);
      const brutos = await d.meta.leadsDesde(id, desdeSeg);
      if (!brutos.length) continue;
      const nome = await d.meta.nomeForm(id);
      r.buscados += brutos.length;
      for (const b of brutos) {
        const c = converter(b, nome);
        c.desconhecidos.forEach((x) => desconhecidos.add(x));
        if (c.lead) leads.push(c.lead); else r.invalidos++;
      }
    }
    let ensaio: StatusMeta["ensaio"];
    if (modo === "ensaio") {
      const existentes = await d.idsExistentes(leads.map((l) => l.id));
      ensaio = leads.slice(0, ENSAIO_MAX).map((l) => ({ id: l.id, aba: mesAba(l.criado_em_lead), ja_existia: existentes.has(l.id) }));
    } else if (leads.length) {
      const g = await d.inserir(leads, modo === "principal");
      r.inseridos = g.inseridos;
      r.vistos = g.vistos;
    }
    const maior = leads.map((l) => l.criado_em_lead).sort().at(-1);
    if (maior && (!d.cfg.cursor || Date.parse(maior) > Date.parse(horaIso(d.cfg.cursor) ?? d.cfg.cursor))) await d.salvarCursor(maior);
    let st: StatusMeta = { ...d.status, ultima_ok: agoraIso, ultimo_erro: "", erro_em: null, buscados: r.buscados, inseridos: r.inseridos,
      vistos: r.vistos, invalidos: r.invalidos, campos_desconhecidos: [...desconhecidos] };
    if (ensaio) st.ensaio = ensaio;
    st = await checarForms(d, st);
    await d.salvarStatus(st);
    return r;
  } catch (e) {
    const erro = (e as Error).message;
    await d.salvarStatus({ ...d.status, ultimo_erro: erro, erro_em: agoraIso });
    return { ...r, ok: false, erro };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/leads-meta && node --test rodada.test.ts converter.test.ts meta.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/leads-meta/rodada.ts supabase/functions/leads-meta/rodada.test.ts
git commit -m "feat(leads-meta): rodada com modos, cursor, status e checagem de formularios"
```

---

### Task 5: `index.ts` — porta da função e deps reais

**Files:**
- Create: `supabase/functions/leads-meta/index.ts`

**Interfaces:**
- Consumes: `rodar`, `CfgMeta`, `DepsMeta`, `StatusMeta` (`./rodada.ts`); `criarMeta` (`./meta.ts`); RPCs `leads_entrada2`, `leads_meta_cursor` (Task 1).
- Produces: endpoint `POST /functions/v1/leads-meta` com `x-cron-secret`; resposta JSON = `ResultadoRodada` (200) ou `{ error }` (401/500).

- [ ] **Step 1: Implementar**

```ts
// Edge Function: leads-meta (§137). Chamada pelo pg_cron a cada 1 min com x-cron-secret (o mesmo SYNC_CRON_SECRET da
// sync-leads e da planilha-espelho). Busca os leads do formulário na Graph API da Meta e grava pela leads_entrada2.
// Modo em config.leads_meta (desligado | ensaio | paralelo | principal); status em config.leads_meta_status.
// Publicar: deploy_edge_function (index.ts, rodada.ts, meta.ts, converter.ts), verify_jwt=false. Secret: META_PAGE_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2";
import { rodar } from "./rodada.ts";
import type { CfgMeta, DepsMeta, StatusMeta } from "./rodada.ts";
import { criarMeta } from "./meta.ts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const segredo = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!segredo || !iguais(req.headers.get("x-cron-secret") ?? "", segredo)) return json({ error: "não autorizado" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const falha = (ctx: string, error: { code?: string; message?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  let status: StatusMeta = {};
  try {
    const rows = await sb.from("config").select("chave,valor").in("chave", ["leads_meta", "leads_meta_status"]);
    falha("ler config", rows.error);
    const m = Object.fromEntries((rows.data ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor]));
    const cfg = JSON.parse(m.leads_meta || "{}") as CfgMeta;
    status = JSON.parse(m.leads_meta_status || "{}") as StatusMeta;
    if (!["ensaio", "paralelo", "principal"].includes(cfg.modo)) return json({ ok: true, modo: cfg.modo ?? "desligado" }, 200);
    const token = Deno.env.get("META_PAGE_TOKEN") ?? "";
    if (!token) throw new Error("secret META_PAGE_TOKEN ausente");
    if (!cfg.page_id || !Array.isArray(cfg.form_ids) || !cfg.form_ids.length) throw new Error("config.leads_meta sem page_id ou form_ids");
    const deps: DepsMeta = {
      meta: criarMeta(token, fetch),
      cfg, status, agora: new Date(),
      async idsExistentes(ids) {
        const achados = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const r = await sb.from("leads").select("id").in("id", ids.slice(i, i + 200));
          falha("conferir ids", r.error);
          for (const x of (r.data ?? []) as { id: string }[]) achados.add(x.id);
        }
        return achados;
      },
      async inserir(leads, espelho) {
        const r = await sb.rpc("leads_entrada2", { p_leads: leads, p_espelho: espelho, p_origem: "meta" });
        falha("gravar leads", r.error);
        return { inseridos: Number(r.data?.inseridos ?? 0), vistos: Number(r.data?.vistos ?? 0) };
      },
      async salvarCursor(iso) { falha("gravar cursor", (await sb.rpc("leads_meta_cursor", { p_cursor: iso })).error); },
      async salvarStatus(s) {
        falha("gravar status", (await sb.from("config").upsert({ chave: "leads_meta_status", valor: JSON.stringify(s) }, { onConflict: "chave" })).error);
      },
    };
    const r = await rodar(deps);
    return json(r, 200);
  } catch (e) {
    // erro antes da rodada (config, secret): sem isto a busca pararia em silêncio
    const erro = (e as Error).message;
    console.error("leads-meta:", erro);
    await sb.from("config").upsert({ chave: "leads_meta_status", valor: JSON.stringify({ ...status, ultimo_erro: erro, erro_em: new Date().toISOString() }) }, { onConflict: "chave" })
      .then(() => null, () => null);
    return json({ error: erro }, 500);
  }
});
```

- [ ] **Step 2: Conferir sem rede**

`index.ts` importa `npm:` e `Deno`, então não roda no `node --test`. Conferir:

Run: `cd supabase/functions/leads-meta && grep -n -E "META_PAGE_TOKEN|access_token|console\.(log|error)" index.ts meta.ts rodada.ts converter.ts`
Expected: `META_PAGE_TOKEN` só em `index.ts` (ler o secret e a mensagem de ausente); nenhum `access_token`; só o `console.error` com a mensagem de erro (que nunca leva o token, Task 3).

Run: `cd supabase/functions/leads-meta && node --test converter.test.ts meta.test.ts rodada.test.ts`
Expected: PASS (nada quebrou)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/leads-meta/index.ts
git commit -m "feat(leads-meta): porta da Edge Function com config, secret e deps reais"
```

---

### Task 6: Cron, aviso no painel e REGRAS §137

**Files:**
- Create: `supabase/migrations/20261104200100_leads_meta_cron.sql`
- Modify: `_template.html` (linha com `leads_espelho_aviso`, ~4381)
- Modify: `painel_clientes_apex.html` (a mesma linha, ~4381)
- Modify: `REGRAS_NEGOCIO.md` (nova §137 no fim; atualizar "Próxima livre")

**Interfaces:**
- Consumes: `leads_meta_aviso()` (Task 1); função `leads-meta` (Task 5).

- [ ] **Step 1: Escrever a migration do cron**

```sql
-- §137: leads-meta a cada 1 min (24 h). Aplicar só depois do deploy da função (Task 7). pg_cron em UTC.
-- Mesmo segredo do Vault da sync-leads; a função lê SYNC_CRON_SECRET. Com modo desligado, a rodada sai cedo.
select cron.unschedule(jobid) from cron.job where jobname = 'leads-meta';

select cron.schedule('leads-meta', '* * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/leads-meta',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000);
$job$);
```

- [ ] **Step 2: Trocar a linha do aviso nos dois HTMLs**

Em `_template.html` e em `painel_clientes_apex.html`, trocar exatamente esta linha:

```js
  if(kbGestor()) ppSeguro(() => sb.from('config').select('valor').eq('chave', 'leads_espelho_aviso').maybeSingle()).then(r => { const a = r && r.data ? String(r.data.valor || '') : ''; const el = document.getElementById('kbAviso'); el.style.display = a ? '' : 'none'; el.textContent = a; });
```

por:

```js
  // §137: o aviso do gestor junta o da planilha (espelho) e o da busca na Meta (leads-meta)
  if(kbGestor()) Promise.all([
    ppSeguro(() => sb.from('config').select('valor').eq('chave', 'leads_espelho_aviso').maybeSingle()),
    ppSeguro(() => sb.rpc('leads_meta_aviso'))
  ]).then(([r, m]) => { const a = [r && r.data ? String(r.data.valor || '') : '', m && !m.error && m.data ? String(m.data) : ''].filter(Boolean).join(' · '); const el = document.getElementById('kbAviso'); el.style.display = a ? '' : 'none'; el.textContent = a; });
```

- [ ] **Step 3: Conferir os dois arquivos**

Run: `grep -c "sb.rpc('leads_meta_aviso')" _template.html painel_clientes_apex.html`
Expected: `_template.html:1` e `painel_clientes_apex.html:1`

Run: `for f in _template.html painel_clientes_apex.html; do echo "$f agora: $(grep -o '<div' $f | wc -l)/$(grep -o '</div>' $f | wc -l)  antes: $(git show HEAD:$f | grep -o '<div' | wc -l)/$(git show HEAD:$f | grep -o '</div>' | wc -l)"; done`
Expected: em cada arquivo, `agora` igual a `antes` (a troca não mexe em `<div>`).

Run: `git diff --stat`
Expected: só `_template.html` e `painel_clientes_apex.html`, poucas linhas cada.

- [ ] **Step 4: Escrever a §137 no REGRAS**

No fim de `REGRAS_NEGOCIO.md`, antes da linha `Próxima livre: §137.`, acrescentar a seção e trocar a linha final para `Próxima livre: §138.`:

```markdown
## §137 — Leads direto da Meta no painel (Edge Function `leads-meta`)

- **Pedido (04/11, Rafael):** tirar a planilha da entrada dos leads. O lead do formulário da Meta cai direto no painel, sem depender da guia do mês.
- **Como funciona:** a Edge Function `leads-meta` roda a cada 1 min (cron `leads-meta`) e busca na Graph API os leads dos formulários em `config.leads_meta.form_ids`, desde 15 min antes do cursor. Converte para o formato da planilha (`l:`/`ag:`/`as:`/`c:`/`f:`, `p:` no telefone, `CREATED`) e grava pela `leads_entrada2(p_leads, p_espelho, p_origem)`. A `leads_entrada(jsonb)` da planilha chama a 2 com `(true, 'planilha')`.
- **Modos (`config.leads_meta.modo`):** `desligado` (sai cedo) · `ensaio` (não grava; `leads_meta_status.ensaio` com id/aba/ja_existia) · `paralelo` (grava sem pôr na fila da planilha; a integração nativa Meta→Sheets continua escrevendo a linha) · `principal` (grava e põe na fila; só depois de desligar a integração nativa).
- **Colunas novas:** `leads.origem_entrada` (`planilha`/`meta`) e `leads.meta_visto_em`. Relatório do paralelo: `supabase/tests/leads_meta_paralelo.sql`.
- **Aviso ao gestor** (Meus leads, junto do aviso da planilha): `leads_meta_aviso()` — busca parada há mais de 30 min (paralelo) ou 5 min (principal), formulário ativo fora da busca, pergunta nova no formulário.
- **Segredo:** `META_PAGE_TOKEN` (usuário do sistema do Business Manager dono da Página, com `leads_retrieval`, `pages_show_list`, `pages_read_engagement`). Nunca no repo.
- **Trocar de modo:** `update config set valor = jsonb_set(valor::jsonb, '{modo}', '"paralelo"')::text where chave = 'leads_meta';`
- **Reverter:** `modo = desligado` (a planilha segue sozinha). Depois da troca: religar a integração nativa e `modo = paralelo`. Tudo: `supabase/rollback/20261104200000_leads_meta_rollback.sql`.
- **Spec/plano:** `docs/superpowers/specs/2026-11-04-leads-meta-entrada-design.md`, `docs/superpowers/plans/2026-11-04-leads-meta-entrada.md`.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261104200100_leads_meta_cron.sql _template.html painel_clientes_apex.html REGRAS_NEGOCIO.md
git commit -m "feat(leads-meta): cron, aviso do gestor no painel e REGRAS secao 137"
```

---

### Task 7: Pôr no ar em `desligado` (cada passo com ok do Rafael)

Nada aqui é código novo; é a sequência de produção. **Pedir ok antes de cada passo.**

- [ ] **Step 1: Juntar com a oficial** — `git fetch oficial && git merge oficial/main` na worktree (se o REGRAS ganhou seção nova, renumerar a §137 e a "Próxima livre"). Rodar de novo `node --test converter.test.ts meta.test.ts rodada.test.ts` em `supabase/functions/leads-meta`: PASS.
- [ ] **Step 2: Migration** — aplicar `20261104200000_leads_meta.sql` com `execute_sql` (begin/commit). Depois rodar `supabase/tests/leads_meta_check.sql`. Expected: erro com `RESULTADO: OK 1,2,3,4,5,6,7,8,9,10`.
- [ ] **Step 3: Conferir que a planilha segue igual** — esperar 1 min e conferir `select chave, valor from config where chave in ('leads_sync_erro','leads_espelho_aviso')` (vazios) e que lead novo da planilha entrou com `origem_entrada = 'planilha'`.
- [ ] **Step 4: Deploy da função** — `deploy_edge_function` `leads-meta` (index.ts, rodada.ts, meta.ts, converter.ts), `verify_jwt=false`. Chamar uma vez com o `x-cron-secret`: Expected `{"ok":true,"modo":"desligado"}`.
- [ ] **Step 5: Cron** — aplicar `20261104200100_leads_meta_cron.sql`. Conferir `select jobname, schedule, active from cron.job where jobname = 'leads-meta'` e, depois de 2 min, `select status, return_message from cron.job_run_details where jobid = (select jobid from cron.job where jobname='leads-meta') order by start_time desc limit 2` (succeeded).
- [ ] **Step 6: Publicar o painel** — processo de sempre: comparar o do ar com a `oficial/main`, backup, envio com MD5 no mesmo comando, vigia `-Aceitar`. Abrir Meus leads como gestor: sem aviso novo (modo desligado).
- [ ] **Step 7: Push e oficial** — com ok, push da branch e merge na `oficial/main` (fetch antes; juntar, nunca sobrescrever).

### Task 8: Ensaio, paralelo e troca (depois da agência)

Depende do token. Cada passo com ok do Rafael; os critérios de passagem são os da spec, seção 4.

- [ ] **Step 1: Secret e config** — `META_PAGE_TOKEN` nas secrets da função; `update config set valor = jsonb_build_object('modo','ensaio','page_id','<id da Página>','form_ids', jsonb_build_array('<id do formulário sem f:>'),'cursor', null)::text where chave = 'leads_meta';`
- [ ] **Step 2: Ensaio** — depois de 2 min: `select valor from config where chave = 'leads_meta_status'`. Expected: `ultima_ok` recente, `ultimo_erro` vazio, `campos_desconhecidos` vazio (se não, acrescentar o nome em `PERGUNTAS` de `converter.ts` com teste, e redeploy), `ensaio` com os ids das últimas 24 h e `ja_existia = true` nos que a planilha já trouxe. Conferir um lead à mão (CNPJ, telefone, aba) contra a linha da planilha, sem copiar dado pessoal para a conversa.
- [ ] **Step 3: Paralelo** — `modo = paralelo`. Rodar `leads_meta_paralelo.sql` todo dia por ~5 dias úteis. Passa quando `meta_nao_viu = 0` e nenhum lead `meta` ficou sem linha na planilha.
- [ ] **Step 4: Troca** — no momento combinado: desligar a integração nativa Meta→Sheets e `modo = principal` no mesmo minuto. Conferir o lead seguinte no painel e na guia do mês (uma linha só).
- [ ] **Step 5: REGRAS e memória** — anotar as datas do ensaio, do paralelo e da troca na §137.
