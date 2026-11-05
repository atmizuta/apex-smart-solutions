# Conversão dos leads + perfil Agência (§138.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-aba **Conversão** em Meus leads (mês a mês, por consultor, leads/convertidos/taxa/receita) e um login **Agência** que só enxerga essa tela, com a negação feita pelo próprio Postgres.

**Architecture:** O banco ganha `conversao_resumo()` (só somas) e `meu_perfil()`, um papel de banco `agencia` (sem privilégio nenhum além dessas duas funções) e um gancho de token do Supabase Auth que carimba `role = agencia` no JWT de quem tem esse perfil. O painel (`_template.html`) ganha funções puras `cv*`, a sub-aba dentro de `#panel-meusleads` (linguagem visual da §126) e um caminho de entrada próprio para a agência.

**Tech Stack:** HTML/JS único (`_template.html` → `build_painel.py` → `painel_clientes_apex.html`), testes Node + jsdom (`bash run_tests.sh`), Postgres/Supabase (SQL via `execute_sql` em `begin/commit`), Edge Functions Deno.

**Spec:** `docs/superpowers/specs/2026-11-05-conversao-leads-design.md` (seções 2, 3, 4, 5, 8, 9 e 10 valem para esta fase).

## Global Constraints

- Trabalhar só em `.worktrees/conversao-leads` (branch `feat/conversao-leads`), partindo de `oficial/main`; `git fetch oficial` antes de publicar e antes de dar push.
- Editar só `_template.html`; o painel é gerado por `python build_painel.py`.
- Cores só por variável (`var(--ml-*)`, `var(--c-sinal)`, `var(--st-ganho)`…); nenhum hex novo; único verde = `--st-ganho` (via `--ml-ok`).
- Não tocar no bloco "SISTEMA VISUAL SINAL DE ÁPICE", `aside.sidebar`, `nav#tabsNav` (só esconder botões por `style.display`), `#pageHead`, `ApexMotion`, `mostrarAviso`, `fecharOverlay`.
- Cantos 8 px na sub-aba (o `test_redesign_shell` proíbe raio de 10–14 px): usar `var(--radius-lg)`/`var(--radius-sm)`.
- Repositório público: nada de nome de cliente, telefone, CNPJ, valor por consultor ou UUID real em teste, spec, plano ou REGRAS. Testes usam nomes `Zz…` e UUID de exemplo.
- Banco é produção (`mdgfboijyqfkggcrhptn`): rodar SQL que escreve (inclusive conferências com rollback) e publicar Edge Function **só com ok do Rafael**. Sem `DROP` literal no texto enviado ao conector (ver Task 2, passo da constraint).
- Mensagens ao usuário com `mostrarAviso`, nunca `alert()`.
- Contar `<div>`/`</div>` antes de publicar (devem bater) e abrir outra aba depois da mudança.

## Review Focus

1. **Mês em andamento e virada de ano:** a guia não tem ano (NOVEMBRO de 2026 e de 2027 viram a mesma `aba`). Esperado: a tela não quebra; "em andamento" vale para a guia cujo nome é o mês atual de SP. Teste em Task 3 (`cvMesAtual` em 1º de dezembro sem guia DEZEMBRO → `null`, abre na última guia).
2. **Consultor com 0 lead convertido e mês com 0 lead:** taxa `null` mostra "—", sem `NaN%`/`Infinity`. Teste em Task 3 (`cvPct(null)`, `cvTaxa(0,0)`).
3. **Nome de consultor com HTML** (`<b>`/aspas) não pode quebrar a tabela. Teste em Task 4 (render escapa).
4. **Usuário que não é da Apex (Campinas) ou consultor fora da equipe de leads:** Campinas não vê a sub-aba; consultor da Apex fora da equipe vê Meus leads só com Conversão. Teste em Task 4.
5. **Agência com o gancho ainda desligado ou falha do `meu_perfil`:** o login não pode cair no caminho normal (que chamaria dezenas de carregadores). Esperado: se o perfil vier com `role = 'agencia'` por qualquer caminho, entra só na Conversão. Teste em Task 5.

---

## Arquivos

| Arquivo | O quê |
|---|---|
| `supabase/migrations/20261105120000_conversao_resumo.sql` (novo) | `conversao_resumo()` + `meu_perfil()` |
| `supabase/tests/conversao_resumo_check.sql` (novo) | totais batem com `leads`; sem perfil é recusado |
| `supabase/migrations/20261105120100_perfil_agencia.sql` (novo) | perfil `agencia`, papel de banco, `PUBLIC` → grants explícitos, gancho, policies de `profiles` |
| `supabase/tests/agencia_acesso_check.sql` (novo) | o que a agência lê e o que é negado; gancho por perfil |
| `supabase/functions/quick-api/create-user.ts` (novo no repo; hoje só existe publicado, v19) | aceita criar `agencia` (só admin) |
| `_template.html` | funções `cv*`, sub-aba, CSS, entrada da agência, perfil nos usuários |
| `test_conversao_leads.js` (novo) | funções puras, render, permissões, entrada da agência |
| `REGRAS_NEGOCIO.md` | §138.1 (Task 7) |

---

### Task 1: `conversao_resumo()` e `meu_perfil()` no banco

**Files:**
- Create: `supabase/migrations/20261105120000_conversao_resumo.sql`
- Test: `supabase/tests/conversao_resumo_check.sql`

**Interfaces:**
- Produces: `public.conversao_resumo() returns table(aba text, ordem timestamptz, consultor text, leads int, convertidos int, receita numeric, conv_sem_receita int)`; `public.meu_perfil() returns table(id uuid, nome text, username text, role text, operacao text)`. Executáveis por `authenticated` e `service_role` (a Task 2 acrescenta `agencia`).

- [ ] **Step 1: Escrever a migration**

```sql
-- §138.1 (05/11, Rafael): Conversão dos leads em Meus leads. Spec: docs/superpowers/specs/2026-11-05-conversao-leads-design.md (seção 4).
-- conversao_resumo(): só somas por guia (mês) e consultor — nada de cliente, telefone, e-mail, CNPJ ou id de lead.
-- meu_perfil(): a linha do próprio usuário em profiles (o login da agência lê o perfil por aqui; ver Task 2).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/conversao_resumo_check.sql (desfaz tudo).
begin;

create or replace function public.conversao_resumo()
 returns table(aba text, ordem timestamptz, consultor text, leads int, convertidos int, receita numeric, conv_sem_receita int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text; v_op text;
begin
  select p.role, coalesce(p.operacao, 'apex') into v_role, v_op from public.profiles p where p.id = auth.uid();
  if v_role is null or not (v_role in ('admin', 'agencia') or (v_role in ('supervisor', 'consultor') and v_op = 'apex')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with base as (
    select l.aba as b_aba, l.criado_em_lead as b_criado,
           coalesce(nullif(trim(l.consultor), ''), nullif(trim(pr.nome), '')) as b_consultor,
           coalesce(l.converteu, false) as b_conv, l.receita as b_receita
      from public.leads l
      left join public.profiles pr on pr.id = l.dono_id
     where l.apagado_em is null and nullif(trim(l.aba), '') is not null
  ), ordens as (
    select b.b_aba as o_aba, min(b.b_criado) as o_ordem from base b group by b.b_aba
  )
  select b.b_aba, o.o_ordem, b.b_consultor,
         count(*)::int,
         (count(*) filter (where b.b_conv))::int,
         coalesce(sum(b.b_receita) filter (where b.b_conv), 0)::numeric,
         (count(*) filter (where b.b_conv and coalesce(b.b_receita, 0) = 0))::int
    from base b join ordens o on o.o_aba = b.b_aba
   group by b.b_aba, o.o_ordem, b.b_consultor
   order by o.o_ordem, b.b_aba, b.b_consultor;
end $function$;

create or replace function public.meu_perfil()
 returns table(id uuid, nome text, username text, role text, operacao text)
 language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.nome, p.username, p.role, coalesce(p.operacao, 'apex') from public.profiles p where p.id = auth.uid()
$function$;

revoke all on function public.conversao_resumo() from public, anon;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.conversao_resumo() to authenticated, service_role;
grant execute on function public.meu_perfil() to authenticated, service_role;

commit;
```

- [ ] **Step 2: Escrever a conferência**

`supabase/tests/conversao_resumo_check.sql`: cola o corpo da migration **sem** `begin;`/`commit;` dentro de um `begin;` e termina num `DO` que sempre lança exceção (padrão do repo: o resultado vem na mensagem e tudo é desfeito).

```sql
-- §138.1: conferência da migration 20261105120000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'.
begin;
-- (colar aqui as duas funções e os grants da migration, sem begin/commit)

do $$
declare v_admin uuid; v_dif int; v_abas int; v_ok boolean := false; v_eu uuid;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select count(*) into v_dif from (
    (select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba
     except
     select l.aba, count(*), count(*) filter (where l.converteu), coalesce(sum(l.receita) filter (where l.converteu), 0)
       from public.leads l where l.apagado_em is null and nullif(trim(l.aba), '') is not null group by l.aba)
    union all
    (select l.aba, count(*), count(*) filter (where l.converteu), coalesce(sum(l.receita) filter (where l.converteu), 0)
       from public.leads l where l.apagado_em is null and nullif(trim(l.aba), '') is not null group by l.aba
     except
     select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba)
  ) x;
  if v_dif <> 0 then raise exception 'FALHOU: % guia(s) com total diferente entre conversao_resumo e leads', v_dif; end if;
  select count(distinct r.aba) into v_abas from public.conversao_resumo() r;

  select m.id into v_eu from public.meu_perfil() m;
  if v_eu is distinct from v_admin then raise exception 'FALHOU: meu_perfil não devolveu o próprio usuário'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform 1 from public.conversao_resumo();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALHOU: usuário sem perfil leu a conversão'; end if;

  raise exception 'RESULTADO: OK — % guias conferidas, meu_perfil certo, sem perfil recusado', v_abas;
end $$;
```

- [ ] **Step 3: Rodar a conferência (com ok do Rafael)**

Pedir ok ("vou rodar a conferência da §138.1 no banco; cria as funções e desfaz tudo no fim"). Rodar o arquivo inteiro com `execute_sql`.
Expected: erro com a mensagem `RESULTADO: OK — N guias conferidas, meu_perfil certo, sem perfil recusado`. Qualquer `FALHOU:` → corrigir a função e repetir.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261105120000_conversao_resumo.sql supabase/tests/conversao_resumo_check.sql
git commit -m "feat(banco): conversao_resumo e meu_perfil (§138.1)"
```

---

### Task 2: Papel `agencia`, funções fora do `PUBLIC`, gancho de token e policies de `profiles`

**Files:**
- Create: `supabase/migrations/20261105120100_perfil_agencia.sql`
- Test: `supabase/tests/agencia_acesso_check.sql`

**Interfaces:**
- Consumes: `conversao_resumo()`, `meu_perfil()` (Task 1).
- Produces: papel de banco `agencia`; `profiles.role` aceita `'agencia'`; `public.apex_token_hook(event jsonb) returns jsonb` (para o Rafael ligar em Authentication → Hooks → Custom Access Token).

- [ ] **Step 1: Escrever a migration**

```sql
-- §138.1 (05/11, Rafael): perfil Agência negado por padrão no próprio Postgres. Spec seção 3.
-- 1) profiles.role aceita 'agencia'; 2) papel de banco agencia só executa meu_perfil e conversao_resumo;
-- 3) funções nossas deixam de ser executáveis pelo PUBLIC (anon/authenticated/service_role continuam iguais);
-- 4) gancho de token: carimba role=agencia no JWT de quem tem esse perfil (o Rafael liga no dashboard);
-- 5) admin edita/remove perfis 'agencia'.
-- A troca da constraint (passo 1) vai num comando separado (ver plano, Task 2 Step 3). Conferência: supabase/tests/agencia_acesso_check.sql.
begin;

-- 2) papel de banco
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'agencia') then
    create role agencia nologin noinherit;
  end if;
end $$;
grant agencia to authenticator;

-- 3) nossas funções: PUBLIC → grants explícitos (quem já executava continua executando; agencia não herda)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_get_userbyid(p.proowner) = current_user
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

grant execute on function public.meu_perfil() to agencia;
grant execute on function public.conversao_resumo() to agencia;

-- 4) gancho de token (roda como supabase_auth_admin em cada login e renovação de token)
create or replace function public.apex_token_hook(event jsonb)
 returns jsonb language plpgsql stable set search_path to 'public'
as $function$
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  if v_role = 'agencia' then
    return jsonb_set(event, '{claims,role}', '"agencia"'::jsonb);
  end if;
  return event;
exception when others then
  return event;   -- um erro aqui nunca pode barrar o login de ninguém
end $function$;
revoke execute on function public.apex_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.apex_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_token_hook') then
    create policy profiles_select_token_hook on public.profiles for select to supabase_auth_admin using (true);
  end if;
end $$;

-- 5) admin gerencia perfis 'agencia' (supervisor não)
alter policy profiles_update on public.profiles
  using ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')))
  with check ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));
alter policy profiles_delete on public.profiles
  using (((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));

commit;
```

E, no fim do mesmo arquivo, o passo 1 em bloco próprio (comentado como "rodar separado"):

```sql
-- 1) RODAR SEPARADO (o conector do Supabase falha em comandos com a palavra de remover; o execute monta o texto):
begin;
do $$ begin
  execute 'alter table public.profiles ' || 'dr' || 'op constraint profiles_role_check';
  execute $q$alter table public.profiles add constraint profiles_role_check check (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))$q$;
end $$;
commit;
```

- [ ] **Step 2: Escrever a conferência de segurança**

`supabase/tests/agencia_acesso_check.sql`: `begin;` + corpo da migration (sem `begin/commit`, incluindo o passo 1) + um perfil de teste + o `DO` abaixo; termina sempre em exceção (rollback).

```sql
-- §138.1: o que a agência lê e o que é negado (tudo desfeito no fim). Resultado na mensagem 'RESULTADO: ...'.
begin;
-- (colar aqui o corpo da migration 20261105120100, sem begin/commit, com o passo 1)

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a6e01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-agencia-teste@exemplo.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-4000-8000-0000000a6e01', 'Zz Agência Teste', 'zz-agencia-teste', 'agencia');

do $$
declare
  v_neg text[] := array[]::text[];
  v_falhou text[] := array[]::text[];
  q text;
  v_ev jsonb; v_role text; v_admin uuid; v_cons uuid;
begin
  -- gancho: só a agência muda de papel
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;
  select p.id into v_cons from public.profiles p where p.role = 'consultor' limit 1;
  foreach q in array array[v_admin::text, v_cons::text, gen_random_uuid()::text] loop
    v_ev := public.apex_token_hook(jsonb_build_object('user_id', q, 'claims', jsonb_build_object('role', 'authenticated')));
    if v_ev #>> '{claims,role}' <> 'authenticated' then v_falhou := v_falhou || ('gancho mudou ' || q); end if;
  end loop;
  v_ev := public.apex_token_hook(jsonb_build_object('user_id', '00000000-0000-4000-8000-0000000a6e01', 'claims', jsonb_build_object('role', 'authenticated')));
  if v_ev #>> '{claims,role}' <> 'agencia' then v_falhou := v_falhou || 'gancho não carimbou a agência'::text; end if;
  v_ev := public.apex_token_hook('{"user_id":"não-é-uuid","claims":{"role":"authenticated"}}'::jsonb);
  if v_ev #>> '{claims,role}' <> 'authenticated' then v_falhou := v_falhou || 'gancho com evento ruim'::text; end if;

  -- como a agência
  set local role agencia;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000a6e01","role":"agencia"}', true);
  foreach q in array array[
    'select 1 from public.clientes limit 1',
    'select 1 from public.leads limit 1',
    'select 1 from public.profiles limit 1',
    'select 1 from public.config limit 1',
    'select 1 from public.producao_pedidos_neo limit 1',
    'select 1 from public.producao_pedidos_manual limit 1',
    'select 1 from public.leads_kanban3(null, true)',
    'select 1 from public.leads_ficha(''OUTUBRO'', ''x'')',
    'select public.leads_pegar(''OUTUBRO'', ''x'')',
    'select 1 from public.producao_meus_pedidos()',
    'select 1 from public.reconciliacao_neocrm()',
    'select public.get_my_role()'
  ] loop
    begin
      execute q;
      v_falhou := v_falhou || ('agência conseguiu: ' || q);
    exception
      when insufficient_privilege then v_neg := v_neg || q;
      when undefined_function then v_neg := v_neg || ('(assinatura diferente) ' || q);
    end;
  end loop;
  begin
    perform 1 from public.conversao_resumo();
    perform 1 from public.meu_perfil() m where m.role = 'agencia';
    if not found then v_falhou := v_falhou || 'meu_perfil não devolveu a agência'::text; end if;
  exception when others then v_falhou := v_falhou || ('agência não leu o permitido: ' || sqlerrm);
  end;
  reset role;

  -- anon e authenticated continuam executando o que executavam
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and pg_get_userbyid(p.proowner) = current_user and p.proname <> 'apex_token_hook'
                and not has_function_privilege('authenticated', p.oid, 'execute')) then
    v_falhou := v_falhou || 'authenticated perdeu execute em alguma função'::text;
  end if;

  if array_length(v_falhou, 1) > 0 then raise exception 'FALHOU: %', array_to_string(v_falhou, ' | '); end if;
  raise exception 'RESULTADO: OK — % acessos negados à agência; gancho certo; authenticated intacto', array_length(v_neg, 1);
end $$;
```

Observação para quem executa: se alguma linha cair em "(assinatura diferente)", conferir a assinatura real (`select oid::regprocedure from pg_proc where proname = '…'`) e corrigir a chamada no teste — ela conta como negada, mas o teste deve chamar a função de verdade.

- [ ] **Step 3: Rodar a conferência (com ok do Rafael)**

Pedir ok. Rodar `agencia_acesso_check.sql` inteiro com `execute_sql`.
Expected: `RESULTADO: OK — 10 acessos negados à agência; gancho certo; função nova fechada; anon/authenticated intactos` (revisão final: conferência com asserções genéricas). Se o conector responder `Invalid or expired requestState`, mandar em dois pedaços (passo 1 separado), como diz a memória do conector.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261105120100_perfil_agencia.sql supabase/tests/agencia_acesso_check.sql
git commit -m "feat(banco): perfil Agencia negado por padrao (papel, gancho de token, profiles) (§138.1)"
```

---

### Task 3: Funções puras da Conversão (`cv*`)

**Files:**
- Modify: `_template.html` (logo depois do bloco "§126.3 (Fase 3): Equipe e "Passar para" — funções puras", junto das outras funções puras de Meus leads)
- Test: `test_conversao_leads.js` (novo)

**Interfaces:**
- Produces (globais no script do painel):
  - `CV_MESES: string[]`, `CV_MIN_LEADS = 10`
  - `cvNorm(s) → string`, `cvEhRepique(aba) → boolean`, `cvRotuloMes(aba) → string`
  - `cvPartesSP(agoraMs) → { ano, mes, dia, diasNoMes }`
  - `cvMesesDe(linhas) → Mes[]` com `Mes = { aba, ordem, leads, convertidos, receita, convSemReceita, repique }` (meses por `ordem`, Repique no fim)
  - `cvMesAtual(meses, agoraMs) → string|null`, `cvMesPadrao(meses, agoraMs) → string|null`, `cvAnterior(meses, aba) → Mes|null`
  - `cvTaxa(conv, leads) → number|null`, `cvVariacao(a, b) → number|null`, `cvComparar(mes, anterior) → { leads, convertidos, receita, taxaPp }|null`
  - `cvCorTaxa(taxa, media, leads) → 'hi'|'lo'|''|'poucos'`
  - `cvRanking(linhas, aba) → { linhas: Linha[], semConsultor: Linha|null, total: { leads, convertidos, receita, taxa } }` com `Linha = { consultor, leads, convertidos, receita, pos?, taxa?, cor? }`
  - `cvPct(t) → '21,2%'|'—'`, `cvBRL0(v) → 'R$ 19.552'`, `cvVar(v, sufixo) → '+12%'|'−1,1 pp'|''`

- [ ] **Step 1: Criar o teste (harness + funções puras)**

`test_conversao_leads.js` (harness igual ao de `test_meus_leads_fase3.js`):

```js
// Testa a §138.1 (Conversão em Meus leads + perfil Agência).
// Spec: docs/superpowers/specs/2026-11-05-conversao-leads-design.md. DADOS FICTÍCIOS (repo público).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];
const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
window.__fromCalls = [];
window.__sessao = null;
function builder(tabela){
  window.__fromCalls.push(tabela);
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    single: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: window.__sessao } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const SP = (s) => Date.parse(s + '-03:00');
  const L = [
    { aba: 'SETEMBRO', ordem: '2026-09-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 100, convertidos: 20, receita: 2000, conv_sem_receita: 1 },
    { aba: 'SETEMBRO', ordem: '2026-09-01T03:00:00+00:00', consultor: 'Zz Bia', leads: 50, convertidos: 5, receita: 400, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 120, convertidos: 30, receita: 3000.5, conv_sem_receita: 2 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Bia', leads: 80, convertidos: 10, receita: 900, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Caio', leads: 4, convertidos: 0, receita: 0, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: null, leads: 6, convertidos: 0, receita: 0, conv_sem_receita: 0 },
    { aba: 'REPIQUE', ordem: '2026-07-09T03:00:00+00:00', consultor: 'Zz Ana', leads: 40, convertidos: 2, receita: 100, conv_sem_receita: 0 },
    { aba: 'NOVEMBRO', ordem: '2026-11-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 10, convertidos: 1, receita: 50, conv_sem_receita: 0 },
  ];
  window.__L = L;

  // ==== Task 3: funções puras ====
  eq(cvMesesDe(L).map(m => m.aba), ['SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'REPIQUE'], 'meses por ordem, Repique sempre no fim');
  const out = cvMesesDe(L).find(m => m.aba === 'OUTUBRO');
  eq([out.leads, out.convertidos, out.receita, out.convSemReceita, out.repique], [210, 40, 3900.5, 2, false], 'soma do mês inclui "sem consultor"');
  eq(cvMesesDe(L).find(m => m.aba === 'REPIQUE').repique, true, 'Repique marcado');
  eq([cvRotuloMes('OUTUBRO'), cvRotuloMes('REPIQUE'), cvRotuloMes('MARÇO')], ['Outubro', 'Repique', 'Março'], 'rótulo do mês');
  eq(cvPartesSP(SP('2026-11-04T23:30:00')), { ano: 2026, mes: 11, dia: 4, diasNoMes: 30 }, 'data em SP (23:30 ainda é dia 4)');
  eq(cvPartesSP(Date.parse('2026-11-01T02:00:00Z')).mes, 10, '01/11 02:00 UTC = 31/10 em SP');
  const ms = cvMesesDe(L);
  eq(cvMesAtual(ms, SP('2026-11-04T10:00:00')), 'NOVEMBRO', 'mês atual pelo calendário de SP');
  eq(cvMesAtual(ms, SP('2026-12-01T10:00:00')), null, 'Review Focus 1: sem guia do mês atual → null');
  eq(cvMesPadrao(ms, SP('2026-12-01T10:00:00')), 'NOVEMBRO', 'sem guia do mês atual, abre na última guia (nunca no Repique)');
  eq(cvMesAtual(cvMesesDe([{ aba: 'MARCO', ordem: '2027-03-01', consultor: 'Zz', leads: 1, convertidos: 0, receita: 0 }]), SP('2027-03-10T10:00:00')), 'MARCO', 'MARÇO sem acento também casa');
  eq(cvAnterior(ms, 'OUTUBRO').aba, 'SETEMBRO', 'mês anterior');
  eq([cvAnterior(ms, 'SETEMBRO'), cvAnterior(ms, 'REPIQUE')], [null, null], 'primeiro mês e Repique não têm anterior');
  eq([cvTaxa(20, 100), cvTaxa(0, 0), cvTaxa(0, 5)], [0.2, null, 0], 'Review Focus 2: taxa com 0 leads é null');
  eq([cvVariacao(120, 100), cvVariacao(90, 100), cvVariacao(5, 0)], [20, -10, null], 'variação %');
  eq(cvComparar(out, cvAnterior(ms, 'OUTUBRO')), { leads: 40, convertidos: 60, receita: 63, taxaPp: 2.4 }, 'comparação com setembro (taxa em pontos)');
  eq(cvComparar(out, null), null, 'sem anterior, sem comparação');
  eq([cvCorTaxa(0.25, 0.2, 50), cvCorTaxa(0.2, 0.2, 50), cvCorTaxa(0.17, 0.2, 50), cvCorTaxa(0.15, 0.2, 50), cvCorTaxa(0, 0.2, 9), cvCorTaxa(null, 0.2, 10)],
     ['hi', 'hi', '', 'lo', 'poucos', ''], 'cor da taxa: ≥ média verde, < 80% vermelho, < 10 leads "poucos"');
  const rk = cvRanking(L, 'OUTUBRO');
  eq(rk.linhas.map(r => [r.pos, r.consultor, r.cor]), [[1, 'Zz Ana', 'hi'], [2, 'Zz Bia', 'lo'], [3, 'Zz Caio', 'poucos']], 'ranking por receita, cor contra a média do mês');
  eq(rk.semConsultor, { consultor: null, leads: 6, convertidos: 0, receita: 0 }, 'linha "Ainda sem consultor"');
  eq(rk.total, { leads: 210, convertidos: 40, receita: 3900.5, taxa: 40 / 210 }, 'total do mês');
  eq(cvRanking([{ aba: 'X', consultor: 'Zz B', leads: 10, convertidos: 2, receita: 100 }, { aba: 'X', consultor: 'Zz A', leads: 10, convertidos: 2, receita: 100 }], 'X').linhas.map(r => r.consultor), ['Zz A', 'Zz B'], 'empate: nome');
  eq(cvRanking(L, 'NADA'), { linhas: [], semConsultor: null, total: { leads: 0, convertidos: 0, receita: 0, taxa: null } }, 'mês sem linhas');
  eq([cvPct(0.212), cvPct(0), cvPct(null)], ['21,2%', '0,0%', '—'], 'Review Focus 2: porcentagem');
  eq([cvBRL0(19552.01), cvBRL0(0)], ['R$ 19.552', 'R$ 0'], 'receita sem centavos nos cartões');
  eq([cvVar(12, '%'), cvVar(-1.1, ' pp'), cvVar(0, '%'), cvVar(null, '%')], ['+12%', '−1,1 pp', '0%', ''], 'variação com sinal');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash run_tests.sh test_conversao_leads.js`
Expected: FAIL (`cvMesesDe is not defined`).

- [ ] **Step 3: Implementar as funções puras**

No `_template.html`, depois do bloco de funções puras da §126.3:

```js
// ===== §138.1: Conversão (Meus leads) — funções puras. Spec 2026-11-05-conversao-leads-design.md seções 4 e 5 =====
const CV_MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const CV_MIN_LEADS = 10;   // abaixo disso a taxa oscila demais: cor neutra e "poucos leads"
function cvNorm(s){ return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
function cvEhRepique(aba){ return cvNorm(aba) === 'REPIQUE'; }
function cvRotuloMes(aba){ const s = String(aba || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }
function cvPartesSP(agoraMs){
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(new Date(agoraMs)).forEach(x => { if(x.type !== 'literal') p[x.type] = Number(x.value); });
  return { ano: p.year, mes: p.month, dia: p.day, diasNoMes: new Date(Date.UTC(p.year, p.month, 0)).getUTCDate() };
}
function cvMesesDe(linhas){
  const por = new Map();
  (linhas || []).forEach(r => {
    if(!r || !r.aba) return;
    const m = por.get(r.aba) || { aba: r.aba, ordem: r.ordem || null, leads: 0, convertidos: 0, receita: 0, convSemReceita: 0, repique: cvEhRepique(r.aba) };
    m.leads += Number(r.leads) || 0;
    m.convertidos += Number(r.convertidos) || 0;
    m.receita += Number(r.receita) || 0;
    m.convSemReceita += Number(r.conv_sem_receita) || 0;
    if(r.ordem && (!m.ordem || String(r.ordem) < String(m.ordem))) m.ordem = r.ordem;
    por.set(r.aba, m);
  });
  const todos = [...por.values()].map(m => Object.assign(m, { receita: Math.round(m.receita * 100) / 100 }));
  const normais = todos.filter(m => !m.repique).sort((a, b) => String(a.ordem || '').localeCompare(String(b.ordem || '')) || a.aba.localeCompare(b.aba));
  return normais.concat(todos.filter(m => m.repique));
}
// A guia não tem ano (§138, Review Focus 1): "em andamento" = a guia com o nome do mês atual de SP.
function cvMesAtual(meses, agoraMs){
  const alvo = cvNorm(CV_MESES[cvPartesSP(agoraMs).mes - 1]);
  const m = (meses || []).find(x => !x.repique && cvNorm(x.aba) === alvo);
  return m ? m.aba : null;
}
function cvMesPadrao(meses, agoraMs){
  const atual = cvMesAtual(meses, agoraMs);
  if(atual) return atual;
  const normais = (meses || []).filter(m => !m.repique);
  if(normais.length) return normais[normais.length - 1].aba;
  return meses && meses.length ? meses[0].aba : null;
}
function cvAnterior(meses, aba){
  const normais = (meses || []).filter(m => !m.repique);
  const i = normais.findIndex(m => m.aba === aba);
  return i > 0 ? normais[i - 1] : null;
}
function cvTaxa(conv, leads){ const l = Number(leads) || 0; return l > 0 ? (Number(conv) || 0) / l : null; }
function cvVariacao(a, b){ const x = Number(b) || 0; return x > 0 ? Math.round(((Number(a) || 0) - x) / x * 100) : null; }
function cvComparar(mes, anterior){
  if(!mes || !anterior) return null;
  const t1 = cvTaxa(mes.convertidos, mes.leads), t0 = cvTaxa(anterior.convertidos, anterior.leads);
  return {
    leads: cvVariacao(mes.leads, anterior.leads),
    convertidos: cvVariacao(mes.convertidos, anterior.convertidos),
    receita: cvVariacao(mes.receita, anterior.receita),
    taxaPp: t1 === null || t0 === null ? null : Math.round((t1 - t0) * 1000) / 10,
  };
}
function cvCorTaxa(taxa, media, leads){
  if((Number(leads) || 0) < CV_MIN_LEADS) return 'poucos';
  if(taxa === null || taxa === undefined || media === null || media === undefined) return '';
  if(taxa >= media) return 'hi';
  if(taxa < media * 0.8) return 'lo';
  return '';
}
function cvRanking(linhas, aba){
  const doMes = (linhas || []).filter(r => r && r.aba === aba);
  const num = (r) => ({ consultor: r.consultor || null, leads: Number(r.leads) || 0, convertidos: Number(r.convertidos) || 0, receita: Math.round((Number(r.receita) || 0) * 100) / 100 });
  const total = { leads: 0, convertidos: 0, receita: 0 };
  doMes.map(num).forEach(r => { total.leads += r.leads; total.convertidos += r.convertidos; total.receita += r.receita; });
  total.receita = Math.round(total.receita * 100) / 100;
  total.taxa = cvTaxa(total.convertidos, total.leads);
  const lista = doMes.filter(r => r.consultor).map(num)
    .sort((a, b) => (b.receita - a.receita) || (b.convertidos - a.convertidos) || a.consultor.localeCompare(b.consultor, 'pt-BR'))
    .map((r, i) => { const t = cvTaxa(r.convertidos, r.leads); return Object.assign(r, { pos: i + 1, taxa: t, cor: cvCorTaxa(t, total.taxa, r.leads) }); });
  const sem = doMes.filter(r => !r.consultor).map(num);
  const semConsultor = sem.length ? sem.reduce((a, r) => ({ consultor: null, leads: a.leads + r.leads, convertidos: a.convertidos + r.convertidos, receita: Math.round((a.receita + r.receita) * 100) / 100 })) : null;
  return { linhas: lista, semConsultor, total };
}
function cvPct(t){ return t === null || t === undefined ? '—' : (Math.round(t * 1000) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'; }
function cvBRL0(v){ return 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR'); }
function cvVar(v, sufixo){
  if(v === null || v === undefined) return '';
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + sufixo;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash run_tests.sh test_conversao_leads.js`
Expected: `TOTAL: 1 passaram, 0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_conversao_leads.js
git commit -m "feat(conversao): funcoes puras da Conversao em Meus leads (§138.1)"
```

---

### Task 4: Sub-aba Conversão em Meus leads (tela, CSS, carga, quem vê)

**Files:**
- Modify: `_template.html` — `#kbAbas` (~linha 1893), depois de `#kbTodos` (~1922), CSS depois do bloco `/* §126: Hoje B … */` (~1205), `KB_ABA_TITULOS` (~3578), `kbTrocarAba` (~4786), `kbAplicarPermissao` (~4272), clique do menu `meusleads` (~3461)
- Test: `test_conversao_leads.js`

**Interfaces:**
- Consumes: funções `cv*` da Task 3; RPC `conversao_resumo` (Task 1); `kbPodeVer`, `kbGestor`, `kbAbasDoPerfil`, `kbAbaPadrao`, `kbEstadoTabela`, `kbSalvarFiltros`, `veAbasDaApex`, `escapeHtml`, `fmtBRL`, `ppSeguro` (já existem).
- Produces: `cvEstado`, `cvPodeVer() → boolean`, `cvSoConversao() → boolean`, `cvGestor() → boolean`, `cvHtml(est) → string`, `cvRender()`, `async cvCarregar()`, `kbAbasVisiveis() → string[]`, `kbAbaInicial() → string`; elemento `#cvConversao`; botão `[data-kb-aba="conversao"]`.

- [ ] **Step 1: Escrever os testes da tela e de quem vê**

Em `test_conversao_leads.js`, no lugar de `// ==== mais testes entram aqui ====` (mantenha o marcador depois):

```js
  // ==== Task 4: tela e permissões ====
  const agora = SP('2026-11-04T15:00:00');
  const base = { linhas: L, meses: cvMesesDe(L), sel: 'OUTUBRO', agoraMs: agora, gestor: true, atualizadoEm: agora };
  const div = document.createElement('div');
  div.innerHTML = cvHtml(base);
  eq([...div.querySelectorAll('[data-cv-mes]')].map(b => b.dataset.cvMes), ['SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'REPIQUE'], 'cartões dos meses (Repique no fim)');
  assert(div.querySelector('[data-cv-mes="OUTUBRO"]').classList.contains('on'), 'mês escolhido marcado');
  assert(/em andamento/.test(div.querySelector('[data-cv-mes="NOVEMBRO"]').textContent), 'novembro "em andamento"');
  assert(/recontato/.test(div.querySelector('[data-cv-mes="REPIQUE"]').textContent), 'Repique "recontato"');
  eq([...div.querySelectorAll('.cvRank tbody tr')].map(t => t.querySelector('.cvNome').textContent), ['Zz Ana', 'Zz Bia', 'Zz Caio', 'Ainda sem consultor'], 'ranking + linha sem consultor no fim');
  assert(/poucos leads/.test(div.querySelector('.cvRank tbody tr:nth-child(3)').textContent), 'Zz Caio com "poucos leads"');
  assert(/vs setembro/i.test(div.querySelector('.cvKpis').textContent), 'mês fechado compara com o anterior');
  assert(/2 convertidos de Outubro estão sem receita/.test(div.querySelector('.cvAviso').textContent), 'aviso de gestor');
  div.innerHTML = cvHtml(Object.assign({}, base, { gestor: false }));
  assert(!div.querySelector('.cvAviso'), 'agência/consultor não veem o aviso de receita');
  div.innerHTML = cvHtml(Object.assign({}, base, { sel: 'NOVEMBRO' }));
  assert(/dia 4 de 30/.test(div.querySelector('.cvKpis').textContent) && !/vs /.test(div.querySelector('.cvKpis').textContent), 'mês em andamento: sem comparação, com "dia 4 de 30"');
  div.innerHTML = cvHtml(Object.assign({}, base, { linhas: [{ aba: 'OUTUBRO', ordem: 'x', consultor: '<b>Zz "x"</b>', leads: 12, convertidos: 1, receita: 1 }], meses: cvMesesDe([{ aba: 'OUTUBRO', ordem: 'x', leads: 12, convertidos: 1, receita: 1 }]) }));
  assert(!div.querySelector('.cvRank b') && div.querySelector('.cvNome').textContent === '<b>Zz "x"</b>', 'Review Focus 3: nome escapado');
  div.innerHTML = cvHtml({ erro: true });
  assert(!!div.querySelector('[data-cv-tentar]'), 'erro com "Tentar de novo"');
  div.innerHTML = cvHtml({ linhas: [], meses: [], agoraMs: agora });
  assert(/Nenhum lead/.test(div.textContent), 'sem leads');

  // permissões (Review Focus 4)
  currentUser = { id: 'u-c', nome: 'Zz Cons', role: 'consultor', operacao: 'campinas' };
  assert(!cvPodeVer(), 'consultor de Campinas não vê a Conversão');
  currentUser = { id: 'u-c', nome: 'Zz Cons', role: 'consultor', operacao: 'apex' };
  kbEstado.modo = 'painel'; kbEstado.naEquipe = false;
  assert(cvPodeVer() && cvSoConversao(), 'consultor da Apex fora da equipe: só Conversão');
  eq(kbAbasVisiveis(), ['conversao'], 'abas do consultor fora da equipe');
  kbEstado.naEquipe = true;
  eq(kbAbasVisiveis(), ['hoje', 'quadro', 'todos', 'conversao'], 'consultor da equipe: + Conversão');
  currentUser = { id: 'u-s', nome: 'Zz Sup', role: 'supervisor', operacao: 'apex' };
  eq(kbAbasVisiveis(), ['hoje', 'quadro', 'todos', 'equipe', 'conversao'], 'supervisor: todas + Conversão');
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro', 'todos'], 'kbAbasDoPerfil antigo intacto');

  // carga e troca de mês
  window.__rpcRespostas.conversao_resumo = { data: L, error: null };
  window.__rpcCalls.length = 0;
  kbTrocarAba('conversao');
  await espera(30);
  eq(window.__rpcCalls.filter(c => c.nome === 'conversao_resumo').length, 1, 'abrir a sub-aba chama conversao_resumo uma vez');
  assert(document.getElementById('cvConversao').style.display === '' && document.getElementById('kbBoard').style.display === 'none', 'só a Conversão aparece');
  assert(document.getElementById('panel-meusleads').classList.contains('cvAtiva'), 'painel marca cvAtiva (esconde busca/resumo)');
  document.querySelector('#cvConversao [data-cv-mes="SETEMBRO"]').click();
  eq([cvEstado.sel, window.__rpcCalls.filter(c => c.nome === 'conversao_resumo').length], ['SETEMBRO', 1], 'trocar de mês não chama o banco de novo');
  document.querySelector('#cvConversao [data-cv-lista]').click();
  eq([kbEstado.aba, kbEstado.filtros.mes, kbEstadoTabela().visao], ['todos', 'SETEMBRO', 'convertido'], 'ver na Lista: Convertidos + filtro do mês');
  window.__rpcRespostas.conversao_resumo = { data: null, error: { message: 'x' } };
  cvEstado.linhas = null;
  kbTrocarAba('conversao'); await espera(30);
  assert(!!document.querySelector('#cvConversao [data-cv-tentar]'), 'erro do banco mostra "Tentar de novo"');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash run_tests.sh test_conversao_leads.js`
Expected: FAIL (`cvHtml is not defined`).

- [ ] **Step 3: Markup**

Em `#kbAbas`, depois do botão Lista:

```html
          <button type="button" data-kb-aba="conversao">Conversão</button>
```

Depois do fechamento de `<div id="kbTodos" …>…</div>` (antes do `<svg class="kbSprite"…>`):

```html
      <div id="cvConversao" class="cvConversao" style="display:none" aria-live="polite"></div>
```

- [ ] **Step 4: CSS** (depois do bloco `/* §126: Hoje B … */`)

```css
  /* §138.1: Conversão (Meus leads) — linguagem da §126, só tokens; cantos 8 px */
  #panel-meusleads.cvAtiva #kbResumo,#panel-meusleads.cvAtiva #kbAviso,#panel-meusleads.cvAtiva #kbStatus,#panel-meusleads.cvAtiva .kbBuscaBox,#panel-meusleads.cvAtiva #kbFiltrosGestor,#panel-meusleads.cvAtiva #kbPausaAviso{display:none !important;}
  .cvConversao{display:flex;flex-direction:column;gap:14px;padding-top:14px;color:var(--ml-ink);}
  .cvMeses{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scroll-snap-type:x proximity;}
  .cvMes{flex:0 0 210px;scroll-snap-align:end;display:flex;flex-direction:column;gap:3px;text-align:left;background:var(--ml-surface);border:2px solid transparent;border-radius:var(--radius-lg);padding:12px 14px;cursor:pointer;font:inherit;color:var(--ml-ink);}
  .cvMes:hover{background:var(--ml-surface-2);}
  .cvMes.on{border-color:var(--c-sinal);}
  .cvMes.cvRepique{background:var(--ml-surface-2);}
  .cvMesLb{display:flex;justify-content:space-between;align-items:center;gap:6px;font-family:var(--font-head);font-weight:600;font-size:var(--fs-sm);letter-spacing:.06em;text-transform:uppercase;color:var(--ml-ink-3);}
  .cvTag{font-family:var(--font-body);font-size:var(--fs-xs);font-weight:600;letter-spacing:0;text-transform:none;background:var(--ml-soon-soft);color:var(--ml-soon);border-radius:999px;padding:0 8px;}
  .cvMesRv{font-family:var(--font-head);font-weight:700;font-size:var(--fs-xl);line-height:1.1;}
  .cvMesSm{font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .cvMini{display:block;height:5px;margin-top:6px;background:var(--ml-surface-3);border-radius:var(--radius-sm);}
  .cvMini i{display:block;height:100%;background:var(--c-sinal);border-radius:var(--radius-sm);}
  .cvKpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;}
  .cvKpi{background:var(--ml-surface);border-radius:var(--radius-lg);padding:14px 16px;}
  .cvKpiLb{font-size:var(--fs-sm);font-weight:600;color:var(--ml-ink-3);}
  .cvKpiV{font-family:var(--font-head);font-weight:700;font-size:var(--fs-kpi);line-height:1.1;margin-top:2px;}
  .cvKpiD{font-size:var(--fs-sm);color:var(--ml-ink-2);margin-top:2px;}
  .cvUp{color:var(--ml-ok);font-weight:600;}
  .cvDn{color:var(--ml-late);font-weight:600;}
  .cvAviso{background:var(--ml-soon-soft);color:var(--ml-soon);border-radius:var(--radius-lg);padding:10px 14px;font-size:var(--fs-sm);font-weight:600;}
  .cvLink{border:0;background:none;padding:0;font:inherit;color:var(--c-sinal-600);font-weight:700;cursor:pointer;text-decoration:underline;}
  .cvCard{background:var(--ml-surface);border-radius:var(--radius-lg);overflow:hidden;}
  .cvCard h3{margin:0;padding:14px 16px 2px;font-family:var(--font-head);font-weight:700;font-size:var(--fs-lg);text-transform:uppercase;letter-spacing:.02em;}
  .cvSub{padding:0 16px 10px;color:var(--ml-ink-3);font-size:var(--fs-sm);}
  .cvRank{width:100%;border-collapse:collapse;}
  .cvRank th{text-align:left;font-size:var(--fs-xs);font-weight:600;color:var(--ml-ink-3);text-transform:uppercase;letter-spacing:.06em;padding:8px 16px;background:var(--ml-surface-2);}
  .cvRank td{padding:11px 16px;border-top:1px solid var(--ml-surface-3);font-variant-numeric:tabular-nums;}
  .cvRank .r{text-align:right;}
  .cvPos{width:34px;font-family:var(--font-head);font-weight:700;color:var(--ml-ink-3);}
  .cvPos.top{color:var(--c-sinal);}
  .cvNome{font-weight:600;}
  .cvSem .cvNome{font-weight:500;color:var(--ml-ink-3);}
  .cvTaxa{display:inline-block;min-width:56px;text-align:center;border-radius:999px;padding:1px 8px;font-weight:600;font-size:var(--fs-sm);background:var(--ml-surface-2);}
  .cvTaxa.hi{background:var(--ml-ok-soft);color:var(--ml-ok);}
  .cvTaxa.lo{background:var(--ml-late-soft);color:var(--ml-late);}
  .cvPoucos{display:block;font-size:var(--fs-xs);color:var(--ml-ink-3);font-weight:500;}
  .cvBarra{display:inline-flex;align-items:center;gap:10px;justify-content:flex-end;}
  .cvBarra .t{width:140px;height:8px;background:var(--ml-surface-3);border-radius:var(--radius-sm);}
  .cvBarra .t i{display:block;height:100%;background:var(--c-sinal);border-radius:var(--radius-sm);}
  .cvRank tfoot td{font-weight:700;background:var(--ml-surface-2);}
  .cvRodape{font-size:var(--fs-xs);color:var(--ml-ink-3);text-align:right;}
  .cvVazio{background:var(--ml-surface);border-radius:var(--radius-lg);padding:28px;text-align:center;color:var(--ml-ink-2);}
  @media (max-width:760px){ .cvKpis{grid-template-columns:repeat(2,minmax(0,1fr));} .cvBarra .t{display:none;} .cvRank th,.cvRank td{padding:9px 10px;} }
```

- [ ] **Step 5: JS — estado, permissões, render, carga**

Logo depois das funções puras da Task 3:

```js
// ===== §138.1: Conversão — tela =====
const cvEstado = { linhas: null, meses: [], sel: null, carregando: false, erro: false, atualizadoEm: null, geracao: 0 };
function cvPodeVer(){
  if(!currentUser) return false;
  const r = currentUser.role;
  return r === 'admin' || r === 'agencia' || ((r === 'supervisor' || r === 'consultor') && veAbasDaApex());
}
function cvSoConversao(){ return !!currentUser && (currentUser.role === 'agencia' || (!kbPodeVer() && cvPodeVer())); }
function cvGestor(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function kbAbasVisiveis(){
  if(cvSoConversao()) return ['conversao'];
  const abas = kbAbasDoPerfil(kbGestor());
  return cvPodeVer() ? abas.concat('conversao') : abas;
}
function kbAbaInicial(){ return cvSoConversao() ? 'conversao' : kbAbaPadrao(kbGestor()); }
function cvHtml(est){
  if(est.carregando) return '<div class="cvVazio">Carregando a conversão…</div>';
  if(est.erro) return '<div class="cvVazio">Não foi possível carregar a conversão. <button type="button" class="kbBtn kbBtnQ kbBtnSm" data-cv-tentar>Tentar de novo</button></div>';
  const meses = est.meses || [];
  if(!meses.length) return '<div class="cvVazio">Nenhum lead ainda.</div>';
  const atual = cvMesAtual(meses, est.agoraMs);
  const mes = meses.find(m => m.aba === est.sel) || meses[meses.length - 1];
  const maxRec = Math.max(1, ...meses.map(m => m.receita));
  const cartoes = meses.map(m => {
    const tag = m.repique ? '<span class="cvTag">recontato</span>' : m.aba === atual ? '<span class="cvTag">em andamento</span>' : '';
    return `<button type="button" class="cvMes${m.aba === mes.aba ? ' on' : ''}${m.repique ? ' cvRepique' : ''}" data-cv-mes="${escapeHtml(m.aba)}" aria-pressed="${m.aba === mes.aba}">`
      + `<span class="cvMesLb">${escapeHtml(cvRotuloMes(m.aba))}${tag}</span>`
      + `<span class="cvMesRv">${cvBRL0(m.receita)}</span>`
      + `<span class="cvMesSm">${m.convertidos} de ${m.leads} leads · ${cvPct(cvTaxa(m.convertidos, m.leads))}</span>`
      + `<span class="cvMini"><i style="width:${Math.round(m.receita / maxRec * 100)}%"></i></span></button>`;
  }).join('');
  const rk = cvRanking(est.linhas, mes.aba);
  const ant = cvAnterior(meses, mes.aba);
  const emAndamento = mes.aba === atual;
  const cmp = !emAndamento && !mes.repique ? cvComparar(mes, ant) : null;
  const sp = cvPartesSP(est.agoraMs);
  const delta = (v, suf) => {
    if(mes.repique) return 'lote de recontato';
    if(emAndamento) return `em andamento: dia ${sp.dia} de ${sp.diasNoMes}`;
    if(!cmp || v === null) return '';
    return `<span class="${v > 0 ? 'cvUp' : v < 0 ? 'cvDn' : ''}">${cvVar(v, suf)}</span> vs ${escapeHtml(cvRotuloMes(ant.aba).toLowerCase())}`;
  };
  const tkt = mes.convertidos > 0 ? ` · ticket médio ${fmtBRL(mes.receita / mes.convertidos)}` : '';
  const kpi = (lb, v, d) => `<div class="cvKpi"><div class="cvKpiLb">${lb}</div><div class="cvKpiV">${v}</div><div class="cvKpiD">${d || '&nbsp;'}</div></div>`;
  const kpis = '<div class="cvKpis">'
    + kpi('Leads recebidos', mes.leads.toLocaleString('pt-BR'), delta(cmp && cmp.leads, '%'))
    + kpi('Convertidos', mes.convertidos.toLocaleString('pt-BR'), delta(cmp && cmp.convertidos, '%'))
    + kpi('Taxa de conversão', cvPct(cvTaxa(mes.convertidos, mes.leads)), delta(cmp && cmp.taxaPp, ' pp'))
    + kpi('Receita', cvBRL0(mes.receita), (delta(cmp && cmp.receita, '%') || '') + tkt)
    + '</div>';
  const aviso = est.gestor && mes.convSemReceita > 0
    ? `<div class="cvAviso">${mes.convSemReceita} convertido${mes.convSemReceita > 1 ? 's' : ''} de ${escapeHtml(cvRotuloMes(mes.aba))} ${mes.convSemReceita > 1 ? 'estão' : 'está'} sem receita · <button type="button" class="cvLink" data-cv-lista="${escapeHtml(mes.aba)}">ver na Lista</button></div>` : '';
  const topo = rk.linhas.length ? rk.linhas[0].receita : 0;
  const linha = (r) => `<tr${r.pos ? '' : ' class="cvSem"'}><td class="cvPos${r.pos && r.pos <= 3 ? ' top' : ''}">${r.pos || ''}</td>`
    + `<td class="cvNome">${r.consultor ? escapeHtml(r.consultor) : 'Ainda sem consultor'}</td>`
    + `<td class="r">${r.leads}</td><td class="r">${r.convertidos}</td>`
    + `<td class="r">${r.pos ? `<span class="cvTaxa ${r.cor === 'poucos' ? '' : r.cor}">${cvPct(r.taxa)}</span>${r.cor === 'poucos' ? '<span class="cvPoucos">poucos leads</span>' : ''}` : ''}</td>`
    + `<td class="r"><span class="cvBarra">${fmtBRL(r.receita)}<span class="t"><i style="width:${topo > 0 ? Math.round(r.receita / topo * 100) : 0}%"></i></span></span></td></tr>`;
  const corpo = rk.linhas.map(linha).join('') + (rk.semConsultor ? linha(rk.semConsultor) : '');
  const tabela = `<div class="cvCard"><h3>Consultores em ${escapeHtml(cvRotuloMes(mes.aba).toLowerCase())}</h3>`
    + '<div class="cvSub">Ordenado por receita. Taxa em verde: na média do mês ou acima; em vermelho: bem abaixo.</div>'
    + '<table class="cvRank"><thead><tr><th></th><th>Consultor</th><th class="r">Leads</th><th class="r">Convertidos</th><th class="r">Taxa</th><th class="r">Receita</th></tr></thead>'
    + `<tbody>${corpo || '<tr><td colspan="6">Nenhum lead neste mês ainda.</td></tr>'}</tbody>`
    + `<tfoot><tr><td></td><td>Total</td><td class="r">${rk.total.leads}</td><td class="r">${rk.total.convertidos}</td><td class="r">${cvPct(rk.total.taxa)}</td><td class="r">${fmtBRL(rk.total.receita)}</td></tr></tfoot></table></div>`;
  const hora = est.atualizadoEm ? new Date(est.atualizadoEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '';
  return `<div class="cvMeses">${cartoes}</div>${kpis}${aviso}${tabela}${hora ? `<div class="cvRodape">Atualizado às ${hora}</div>` : ''}`;
}
function cvRender(){
  const el = document.getElementById('cvConversao');
  if(el) el.innerHTML = cvHtml(Object.assign({}, cvEstado, { agoraMs: Date.now(), gestor: cvGestor() }));
}
async function cvCarregar(){
  if(!cvPodeVer()) return;
  const g = ++cvEstado.geracao;
  cvEstado.carregando = !cvEstado.linhas; cvEstado.erro = false;
  cvRender();
  const r = await ppSeguro(() => sb.rpc('conversao_resumo'));
  if(g !== cvEstado.geracao) return;
  cvEstado.carregando = false;
  if(!r || r.error){ console.error(r && r.error); cvEstado.erro = !cvEstado.linhas; cvRender(); return; }
  cvEstado.linhas = r.data || [];
  cvEstado.meses = cvMesesDe(cvEstado.linhas);
  if(!cvEstado.sel || !cvEstado.meses.some(m => m.aba === cvEstado.sel)) cvEstado.sel = cvMesPadrao(cvEstado.meses, Date.now());
  cvEstado.atualizadoEm = Date.now();
  cvRender();
}
document.getElementById('cvConversao').addEventListener('click', function(e){
  const m = e.target.closest('[data-cv-mes]');
  if(m){ cvEstado.sel = m.dataset.cvMes; cvRender(); return; }
  if(e.target.closest('[data-cv-tentar]')){ cvCarregar(); return; }
  const l = e.target.closest('[data-cv-lista]');
  if(l){
    kbEstado.filtros = Object.assign({}, kbEstado.filtros || {}, { mes: l.dataset.cvLista });
    kbSalvarFiltros();
    Object.assign(kbEstadoTabela(), { visao: 'convertido', pagina: 1 });
    kbTrocarAba('todos');
  }
});
```

- [ ] **Step 6: Ligar na troca de sub-aba, no menu e no botão do menu**

`KB_ABA_TITULOS`: acrescentar `conversao: 'Conversão'`.

Em `kbTrocarAba(aba)`, trocar as duas primeiras linhas e acrescentar a Conversão:

```js
function kbTrocarAba(aba){
  const abas = kbAbasVisiveis();
  kbEstado.aba = abas.includes(aba) ? aba : kbAbaInicial();
```

e, depois de `document.getElementById('kbTodos').style.display = …;`:

```js
  document.getElementById('cvConversao').style.display = kbEstado.aba === 'conversao' ? '' : 'none';
  document.getElementById('panel-meusleads').classList.toggle('cvAtiva', kbEstado.aba === 'conversao');
  document.getElementById('kbAbas').style.display = abas.length > 1 ? '' : 'none';   // agência/consultor fora da equipe: sem barra de uma aba só
```

e, junto dos outros carregamentos do fim da função:

```js
  if(kbEstado.aba === 'conversao') cvCarregar();
```

Em `kbAplicarPermissao`, a linha do botão do menu:

```js
  document.getElementById('tabBtnMeusLeads').style.display = kbPodeVer() || cvPodeVer() ? 'inline-block' : 'none';
```

No clique do menu (linha `if(btn.dataset.tab === 'meusleads'){ kbCarregar(); kbAgendar(); }`):

```js
    if(btn.dataset.tab === 'meusleads'){
      if(cvSoConversao()) kbTrocarAba('conversao');
      else { kbCarregar(); kbAgendar(); if(kbEstado.aba === 'conversao') cvCarregar(); }
    }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `bash run_tests.sh test_conversao_leads.js`
Expected: PASS. Depois a suíte inteira: `bash run_tests.sh` → `0 falharam` (os de Meus leads continuam passando; `test_leads_followups` e `test_conversao_vendas` às vezes estouram tempo na suíte completa — se falharem, rodar isolados).

- [ ] **Step 8: Commit**

```bash
git add _template.html test_conversao_leads.js
git commit -m "feat(conversao): sub-aba Conversao em Meus leads (§138.1)"
```

---

### Task 5: Perfil Agência no painel (login, menu, usuários) e criação do login

**Files:**
- Modify: `_template.html` — `loadProfileAndEnter` (~3160), `ROLE_LABELS` (~3187), `enterApp` (~3190), `newRole` em `enterApp` (~3223), `canManageUser` (~10705)
- Create: `supabase/functions/quick-api/create-user.ts` (cópia do publicado v19 com a mudança)
- Test: `test_conversao_leads.js`

**Interfaces:**
- Consumes: RPC `meu_perfil` (Task 1), `cvSoConversao`, `kbTrocarAba` (Task 4).
- Produces: `papelDoToken(sessao) → string|null`, `agEntrar()`; `ROLE_LABELS.agencia = 'Agência'`.

- [ ] **Step 1: Escrever os testes**

Antes de `// ==== mais testes entram aqui ====`:

```js
  // ==== Task 5: entrada da agência ====
  const jwt = (o) => 'x.' + btoa(JSON.stringify(o)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') + '.y';
  eq([papelDoToken({ access_token: jwt({ role: 'agencia' }) }), papelDoToken({ access_token: jwt({ role: 'authenticated' }) }), papelDoToken(null), papelDoToken({ access_token: 'lixo' })],
     ['agencia', 'authenticated', null, null], 'papel lido do token');
  eq(ROLE_LABELS.agencia, 'Agência', 'rótulo do perfil');
  currentUser = { id: 'u-adm', nome: 'Zz Adm', role: 'admin', operacao: 'apex' };
  assert(canManageUser('agencia'), 'admin cria Agência');
  currentUser = { id: 'u-s', nome: 'Zz Sup', role: 'supervisor', operacao: 'apex' };
  assert(!canManageUser('agencia'), 'supervisor não cria Agência');

  // login com o gancho ligado: perfil vem do meu_perfil, nunca da tabela profiles
  window.__sessao = { access_token: jwt({ role: 'agencia', sub: 'u-ag' }) };
  window.__rpcRespostas.meu_perfil = { data: [{ id: 'u-ag', nome: 'Zz Agência', username: 'zz-ag', role: 'agencia', operacao: 'apex' }], error: null };
  window.__rpcRespostas.conversao_resumo = { data: L, error: null };
  window.__fromCalls.length = 0; window.__rpcCalls.length = 0;
  await loadProfileAndEnter({ id: 'u-ag', email: 'zz-ag@exemplo.invalid' });
  await espera(60);
  eq(currentUser.role, 'agencia', 'agência entrou');
  eq(window.__fromCalls.filter(t => t !== 'leads_status_opcoes'), [], 'agência não lê nenhuma tabela direto');
  eq([...new Set(window.__rpcCalls.map(c => c.nome))].sort(), ['conversao_resumo', 'meu_perfil'], 'agência só chama meu_perfil e conversao_resumo');
  const visiveis = [...document.querySelectorAll('#tabsNav button[data-tab]')].filter(b => b.style.display !== 'none').map(b => b.dataset.tab);
  eq(visiveis, ['meusleads'], 'menu da agência: só Meus leads');
  assert(document.getElementById('panel-meusleads').classList.contains('active') && kbEstado.aba === 'conversao', 'abre direto em Meus leads → Conversão');
  assert(!document.querySelector('#cvConversao .cvAviso'), 'agência não vê aviso de gestor');

  // Review Focus 5: gancho desligado (token "authenticated"), perfil 'agencia' pela tabela → mesmo caminho fechado
  window.__sessao = { access_token: jwt({ role: 'authenticated', sub: 'u-ag' }) };
  window.__tabelas.profiles = [{ id: 'u-ag', nome: 'Zz Agência', username: 'zz-ag', role: 'agencia', operacao: 'apex' }];
  window.__rpcCalls.length = 0; window.__fromCalls.length = 0;
  await loadProfileAndEnter({ id: 'u-ag', email: 'zz-ag@exemplo.invalid' });
  await espera(60);
  eq([...new Set(window.__rpcCalls.map(c => c.nome))].sort(), ['conversao_resumo'], 'gancho desligado: ainda só a conversão');
  eq(window.__fromCalls, ['profiles'], 'gancho desligado: só leu o próprio perfil');
```

(Se `enterApp` já tiver rodado para outro perfil no mesmo teste, os botões escondidos ficam escondidos; o teste da agência roda depois dos de permissão, então confere só `display`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash run_tests.sh test_conversao_leads.js`
Expected: FAIL (`papelDoToken is not defined`).

- [ ] **Step 3: Implementar**

Antes de `async function loadProfileAndEnter`:

```js
// §138.1: com o gancho de token ligado, a agência entra no banco com o papel 'agencia' (não lê a tabela profiles).
function papelDoToken(sessao){
  try{
    const t = sessao && sessao.access_token;
    if(!t) return null;
    const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
    return p && typeof p.role === 'string' ? p.role : null;
  }catch(_e){ return null; }
}
```

Em `loadProfileAndEnter`, trocar a leitura do perfil e pular os vendedores para a agência:

```js
async function loadProfileAndEnter(authUser){
  const { data: sess } = await sb.auth.getSession();
  let profile = null, error = null;
  if(papelDoToken(sess && sess.session) === 'agencia'){
    const r = await sb.rpc('meu_perfil');
    error = r.error; profile = r.data && r.data[0] ? r.data[0] : null;
  } else {
    const r = await sb.from('profiles').select('*').eq('id', authUser.id).single();
    error = r.error; profile = r.data;
  }
  if(error || !profile){
    await sb.auth.signOut();
    const errEl = document.getElementById('loginError');
    errEl.textContent = 'Sua conta não tem mais acesso. Contate o administrador.';
    errEl.style.display = 'block';
    return;
  }
  currentUser = { id: authUser.id, email: authUser.email, nome: profile.nome, username: profile.username, role: profile.role,
    operacao: profile.operacao || 'apex' }; // seção 78
  operacaoSelecionada = 'apex'; // admin: sempre abre na Operação Apex
  if(currentUser.role !== 'agencia') await carregarVendedoresOperacao(); // seção 78; §138.1: a agência não lê vendedores
  enterApp();
}
```

`ROLE_LABELS`: `{admin:'Administrador', supervisor:'Supervisor', consultor:'Consultor', agencia:'Agência'}`.

Em `enterApp`, logo depois de preencher `ubName`/`ubRole`:

```js
    if(currentUser.role === 'agencia'){ agEntrar(); return; }   // §138.1: só Meus leads → Conversão, nenhum outro carregador
```

(o `return` sai do `try`; o `setTimeout(() => ApexMotion.loader.hide(), 600)` depois do `try/catch` não roda nesse caminho, então `agEntrar` esconde o loader.)

Função nova, perto de `enterApp`:

```js
// §138.1: entrada do perfil Agência — esconde o menu todo menos Meus leads e abre direto na Conversão.
function agEntrar(){
  document.querySelectorAll('#tabsNav button[data-tab]').forEach(b => { b.style.display = b.dataset.tab === 'meusleads' ? 'inline-block' : 'none'; });
  document.querySelectorAll('#tabsNav .navGroupLabel').forEach(g => { g.style.display = 'none'; });
  document.querySelector('#tabsNav button[data-tab="meusleads"]').click();
  setTimeout(() => ApexMotion.loader.hide(), 300);
}
```

Em `enterApp`, o seletor de perfil de novo usuário:

```js
    document.getElementById('newRole').innerHTML = '<option value="consultor">Consultor</option>'
      + (currentUser.role === 'admin' ? '<option value="supervisor">Supervisor</option><option value="admin">Administrador</option><option value="agencia">Agência</option>' : '');
```

`canManageUser`:

```js
  if(currentUser.role === 'admin') return targetRole === 'admin' || targetRole === 'supervisor' || targetRole === 'consultor' || targetRole === 'agencia';
```

- [ ] **Step 4: Edge Function de criação de usuário no repo**

Criar `supabase/functions/quick-api/create-user.ts` com o conteúdo publicado hoje (v19, ler com `get_edge_function` slug `quick-api`) e só estas duas mudanças:

```ts
    const wantedRole = ["admin", "supervisor", "consultor", "agencia"].includes(role) ? role : "consultor";
```

```ts
    const permitido =
      (callerRole === "admin" && (wantedRole === "admin" || wantedRole === "supervisor" || wantedRole === "consultor" || wantedRole === "agencia")) ||
      (callerRole === "supervisor" && wantedRole === "consultor");
```

e no cabeçalho do arquivo, uma linha: `// §138.1 (05/11): admin também cria o perfil "agencia". Publicar: deploy_edge_function slug quick-api, entrypoint create-user.ts, verify_jwt=true.`

- [ ] **Step 5: Rodar e ver passar**

Run: `bash run_tests.sh test_conversao_leads.js` → PASS; depois `bash run_tests.sh` → `0 falharam`.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_conversao_leads.js supabase/functions/quick-api/create-user.ts
git commit -m "feat(agencia): login da Agencia so na Conversao; admin cria o perfil (§138.1)"
```

---

### Task 6: Edge Functions que aceitam o token do usuário

**Files:**
- Create/Modify: `supabase/functions/<slug>/…` das que precisarem de trava (as que ainda não estão no repo entram com o conteúdo publicado)

**Interfaces:**
- Consumes: claim `role = 'agencia'` no JWT (Task 2).
- Produces: as funções com `verify_jwt = true` que usam a chave de serviço recusam a agência com 403.

- [ ] **Step 1: Classificar**

Para cada slug com `verify_jwt: true` — `quick-api`, `reset-password`, `send-email-lote`, `caderno-ia`, `diag-gemini-tmp`, `mailing-api`, `verificar-cnpj` — ler a fonte (`get_edge_function`) e anotar numa tabela no ledger (`.superpowers/sdd/2026-11-05-conversao-leads/progress.md`):
- **A** usa só o token do usuário para falar com o banco (o papel `agencia` já é negado pelo Postgres) → nada a fazer;
- **B** usa a chave de serviço mas confere o perfil numa lista que não tem `agencia` (ex.: `quick-api` com `callerRole === "admin"`) → nada a fazer;
- **C** usa a chave de serviço sem conferir perfil, ou confere com "não é X" → precisa de trava.

- [ ] **Step 2: Trava nas do grupo C**

Logo depois da validação do usuário (onde a função já tem o header `Authorization`), inserir:

```ts
  // §138.1: o perfil Agência só vê a Conversão do painel — não usa nenhuma outra função.
  const tokenAg = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const papelAg = JSON.parse(atob(tokenAg.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role;
    if (papelAg === "agencia") return new Response(JSON.stringify({ error: "Sem permissão." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (_e) { /* token sem payload legível: segue a validação que a função já faz */ }
```

(usar o nome do objeto de cabeçalhos CORS que a função já tem; se não tiver, `{ "Content-Type": "application/json" }`). Copiar a fonte para `supabase/functions/<slug>/` no repo antes de editar.

- [ ] **Step 3: Conferir o grupo C localmente**

Para cada função alterada: `deno check supabase/functions/<slug>/<entrypoint>.ts` (se o `deno` não estiver instalado, conferir a sintaxe com `node --check` num `.mjs` temporário só com o trecho) e registrar no ledger.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions
git commit -m "feat(agencia): Edge Functions com chave de servico recusam o perfil Agencia (§138.1)"
```

(As funções só são publicadas na Task 7, com ok.)

---

### Task 7: Verificação, prévia, banco, publicação e liberação da agência

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (§138.1)

- [ ] **Step 1: Verificação local**

`git fetch oficial && git merge --no-edit oficial/main` (se entrou algo, repetir testes). `bash run_tests.sh` → `0 falharam`. Contar divs no `_template.html`:

```bash
grep -o '<div[ >]' _template.html | wc -l; grep -o '</div>' _template.html | wc -l
```

Os dois números iguais. `python build_painel.py`.

- [ ] **Step 2: Prévia com dados reais para o Rafael**

Servir o painel gerado localmente com um mock que devolve o resultado real de `conversao_resumo` (rodado como admin no `execute_sql`, só leitura), nas três visões: admin (com aviso), consultor (sem aviso) e agência (menu só com Meus leads). Mostrar print/link ao Rafael. **Esperar o ok.**

- [ ] **Step 3: Banco (com ok)**

Pedir ok. Aplicar, nesta ordem, com `execute_sql`: migration `20261105120000` → o passo 1 (constraint) da `20261105120100` → o resto da `20261105120100` → **`20261009210000_profiles_trava_role.sql`** (revisão final: trava de cargo nunca aplicada; fecha o consultor→admin antes de existir login externo). Rodar de novo `conversao_resumo_check.sql` e `agencia_acesso_check.sql` (agora só confere, as funções já existem) → `RESULTADO: OK`.

- [ ] **Step 4: Edge Functions (com ok)**

Publicar `quick-api` (entrypoint `create-user.ts`, `verify_jwt: true`) e as do grupo C da Task 6.

- [ ] **Step 5: Publicar o painel (com ok)**

Ritual da memória "Publicação do painel": baixar o painel do ar e comparar com o gerado (se o ar tiver algo que o repo não tem, juntar); backup + MD5 do ar no mesmo comando do envio; enviar; vigia `-Aceitar`. Abrir o painel no ar como admin: Meus leads → Conversão aparece; outra aba (Dashboard) continua normal.

- [ ] **Step 6: Gancho (Rafael)**

Pedir ao Rafael: Supabase → Authentication → Hooks → Custom Access Token → função `public.apex_token_hook` → ligar. Depois, ele e um consultor saem e entram de novo: tudo igual (o gancho não muda ninguém que não seja agência). Se alguém não entrar: desligar o gancho (volta atrás imediato) e investigar.

- [ ] **Step 7: Login da agência**

Rafael cria o usuário em Usuários → perfil **Agência**. Entrar com ele numa janela anônima: só Meus leads → Conversão; no console, `await sb.from('clientes').select('*').limit(1)` volta erro de permissão. Registrar o resultado (sem o usuário/senha) no ledger.

- [ ] **Step 8: REGRAS e push**

`REGRAS_NEGOCIO.md` §138.1: o que entrou (sub-aba, perfil, papel `agencia`, gancho, funções, Edge Functions travadas), MD5 do painel, como voltar atrás (desligar o gancho; backup do HTML), e os dois achados fora do escopo da spec 3.6. Sem nomes, valores ou UUID.

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): secao 138.1 publicada (Conversao + perfil Agencia)"
git fetch oficial && git merge --no-edit oficial/main && git push oficial HEAD:main
```
