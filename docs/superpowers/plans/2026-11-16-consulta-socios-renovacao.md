# Consulta de sócios na Renovação (§155) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ficha da Renovação ganha a aba "Sócios": mostra na hora nome e CPF da base da Receita (`mailing.socio`) e,
com um clique, busca na Nova Vida (robô Playwright no GitHub Actions) os sócios com participação e telefones.

**Architecture:** O painel lê a base por uma RPC `security definer`; o botão chama a RPC `socios_pedir`, que grava o
pedido em `socios_consultas` e dispara o workflow `socios.yml` do repo do robô via `net.http_post` (token no Vault). O
robô pega a fila na Edge Function `ingest-socios` (só ele, `x-robo-token`), consulta a Nova Vida e devolve o resultado;
o painel relê o pedido a cada 5 s.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql, pg_net, Vault), Edge Function Deno/TypeScript, Node 24 + Playwright
(robô), HTML/JS único `_template.html` + jsdom (testes do painel).

**Spec:** `docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md` (ler junto; este plano argumenta a partir dela)

## Global Constraints

- **Dois repositórios públicos.** Nenhum CPF, CNPJ, nome de pessoa, telefone, usuário ou senha real em código, teste,
  fixture, log, commit ou mensagem de erro. Dados de teste sempre fictícios (nomes "ZZ …", CPF `12345678909`, telefones
  `119000000xx`).
- Painel/banco/Edge Function: worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\consulta-socios`,
  branch `feat/consulta-socios` (partiu do `oficial/main` 0b403ed). Robô: `C:\Users\acer1\.graphify\repos\rafaangelao\apex-robo-procontact`,
  branch nova `feat/socios` a partir de `origin/main` (conferir `git remote -v` = `rafaangelao/apex-robo-procontact`).
- **Push no repo do robô é bloqueado para o Claude**: o Rafael roda com `! …`. Push no oficial, deploy de Edge Function,
  DDL no Supabase (projeto `mdgfboijyqfkggcrhptn`, produção) e publicação do painel: **só com ok explícito do Rafael naquele momento.**
- SQL no Supabase pelo conector: `execute_sql` com `begin; … commit;` (o `apply_migration` falha neste projeto); policy
  dentro de `do $$ … if not exists … $$`.
- Painel: editar só `_template.html`; gerar com `python build_painel.py`; manter LF (`core.autocrlf false`); design
  Sinal de Ápice intocado: **nenhuma regra CSS nova**, só classes que já existem (`kbBtn`, `kbBtnP`, `kbBtnQ`, `kbBtnG`,
  `kbMeta`, `rnHist`, `rnGrupo`, `rnErro`, `rnVazio`); avisos com `mostrarAviso`, nunca `alert()`.
- Números da spec: limite **20** pedidos por pessoa por dia (data de São Paulo); **5** sócios com telefone; releitura a
  cada **5 s**; "Tentar de novo" após **3 min** pendente; `consultando` abandonado após **10 min**; **60 s** por CNPJ;
  rodada do robô até **8 min**; workflow `timeout-minutes: 10`; `concurrency: novavida`.
- Nomes fixos: tabela `socios_consultas`; RPCs `socios_pedir(bigint)`, `socios_da_base(bigint)`; internas
  `socios_cnpj_visivel(bigint)`, `socios_disparar_robo()`, `socios_robo_pegar(int)`; Edge Function `ingest-socios`
  (secret `INGEST_SOCIOS_TOKEN`); workflow `.github/workflows/socios.yml`; segredos do robô `NOVAVIDA_USUARIO`,
  `NOVAVIDA_SENHA`, `NOVAVIDA_EMPRESA`, `INGEST_SOCIOS_URL`, `INGEST_SOCIOS_TOKEN`; Vault `github_robo_token`.
- Log do robô só com contagens; erros passam por `limparErro` com usuário, senha, empresa **e o CNPJ da vez** como segredos.

## Review Focus

1. **Polling apagando o que o consultor digita**: a releitura de 5 s não pode re-renderizar a ficha inteira (o
   formulário de atendimento perderia a observação em digitação). Só a `<section data-rn-ficha-sec="socios">` é
   repintada. Teste na Task 7 ("releitura não apaga o atendimento").
2. **Resposta atrasada de outro cliente**: o consultor troca de ficha enquanto uma leitura/releitura está no ar; a
   resposta velha não pode pintar os sócios do cliente anterior na ficha nova. Teste na Task 7 (caso 7).
3. **Dois cliques quase juntos no mesmo CNPJ** (dois consultores, ou duplo clique): não pode criar dois pedidos nem
   gastar limite duas vezes (trava `pg_advisory_xact_lock` + "devolve o pedido em andamento"). Teste na Task 1 (CASO 4).
4. **Erro do Playwright vazando o CNPJ/senha no log público** (mensagens com "Call log" e valores digitados): `limparErro`
   recebe o CNPJ da vez. Teste na Task 5 ("não vaza o CNPJ no log").
5. **Consulta que estoura os 60 s continua rodando na mesma página** e atrapalha o CNPJ seguinte: depois do timeout a
   página é descartada e outra é aberta no mesmo contexto (sessão mantida). Teste na Task 5 ("estoura o tempo").

---

## File Structure

**Oficial (worktree `consulta-socios`):**
| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20261116200000_socios_consultas.sql` (novo) | tabela, índices, RLS, 5 funções e grants |
| `supabase/tests/socios_consultas_verificar.sql` (novo) | verificação no banco em transação com `rollback` |
| `supabase/functions/ingest-socios/ingest.ts` (novo) | validação do corpo e regras (puro, testável) |
| `supabase/functions/ingest-socios/ingest.test.ts` (novo) | testes `node --test` |
| `supabase/functions/ingest-socios/index.ts` (novo) | HTTP, token, dependências Supabase |
| `_template.html` (modificar ~linhas 3950–4440) | aba Sócios na ficha da Renovação |
| `test_renovacao_socios.js` (novo) | testes jsdom da aba |
| `REGRAS_NEGOCIO.md` (modificar, fim do arquivo) | §155 |

**Robô (`apex-robo-procontact`, branch `feat/socios`):**
| arquivo | responsabilidade |
|---|---|
| `src/socios/novavida.js` (novo) | navegação no Congonhas; devolve texto bruto |
| `scripts/mapear-novavida.js` (novo) | roda local (Rafael), grava texto **mascarado** em `recon/` (já no `.gitignore`) |
| `src/socios/ler-socios.js` (novo) | funções puras texto → sócios/telefones, ordenação, teto 5 |
| `src/socios/main.js` (novo) | ciclo pegar → consultar → resultado; `executar(cfg, io)` testável |
| `test/socios-ler.test.js`, `test/socios-main.test.js` (novos) | testes `node --test` (rodam no `npm test`) |
| `.github/workflows/socios.yml` (novo) | disparo, concorrência, cache do Chromium |
| `package.json` (modificar `scripts`) | `"socios": "node src/socios/main.js"` |

---

### Task 1: Banco — tabela, RLS e funções (`socios_consultas`)

**Files:**
- Create: `supabase/migrations/20261116200000_socios_consultas.sql`
- Create: `supabase/tests/socios_consultas_verificar.sql`

**Interfaces:**
- Produces:
  - `socios_pedir(p_carteira_id bigint) → jsonb`: `{ok:true,id,status}` | `{ok:false,motivo:'sem_permissao'|'limite'}`
  - `socios_da_base(p_carteira_id bigint) → jsonb`: `{ok:true,receita_mes:text,socios:[{nome,cpf,principal,obito}]}` | `{ok:false,motivo:'sem_permissao'}`
  - `socios_robo_pegar(p_max int) → table(id bigint, cnpj text)` (só `service_role`)
  - tabela `socios_consultas(id, cnpj_digits, carteira_id, origem, pedido_por, pedido_em, status, iniciado_em, concluido_em, disparado_em, resultado, erro)`

- [ ] **Step 1: Escrever a verificação (o "teste que falha")**

`supabase/tests/socios_consultas_verificar.sql` — roda inteira numa transação e termina em `rollback` (nada fica gravado;
o `net.http_post` do pg_net também é desfeito, então nada é disparado no GitHub). Cada falha dá `raise exception`.

```sql
-- Verificação da §155 no banco. Roda tudo em transação e desfaz no fim (rollback). Sem dados pessoais na saída:
-- só 'OK' ou a exceção com o nome do caso. Pré-requisito: a migration 20261116200000 aplicada.
begin;
-- atores reais escolhidos pelo banco (só ids em GUCs locais; nada é impresso)
do $prep$
declare v_c bigint; v_dono uuid; v_outro uuid; v_sup uuid; v_cnpj text;
begin
  select c.id, c.consultor_id, c.cnpj_digits into v_c, v_dono, v_cnpj
    from public.renovacao_carteira c
   where c.consultor_id is not null and c.cnpj_digits ~ '^[0-9]{14}$' order by c.id limit 1;
  select p.id into v_outro from public.profiles p where p.role = 'consultor' and p.id <> v_dono order by p.id limit 1;
  select p.id into v_sup from public.profiles p where p.role in ('admin','supervisor') order by p.id limit 1;
  if v_c is null or v_outro is null or v_sup is null then raise exception 'PREP: faltam atores para o teste'; end if;
  perform set_config('teste.carteira', v_c::text, true);
  perform set_config('teste.cnpj', v_cnpj, true);
  perform set_config('teste.dono', v_dono::text, true);
  perform set_config('teste.outro', v_outro::text, true);
  perform set_config('teste.sup', v_sup::text, true);
end $prep$;

do $t$
declare r jsonb; r2 jsonb; n int; c bigint := current_setting('teste.carteira')::bigint;
  como text := '{"role":"authenticated","sub":"%s"}';
begin
  -- 1. outro consultor: sem permissão nas duas RPCs
  perform set_config('request.jwt.claims', format(como, current_setting('teste.outro')), true);
  r := public.socios_pedir(c);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1a: outro consultor pediu: %', r; end if;
  r := public.socios_da_base(c);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1b: outro consultor leu a base'; end if;

  -- 2. dono: base devolve ok com lista (pode ser vazia) e não grava nada
  perform set_config('request.jwt.claims', format(como, current_setting('teste.dono')), true);
  r := public.socios_da_base(c);
  if (r->>'ok')::boolean is not true or jsonb_typeof(r->'socios') <> 'array' then raise exception 'CASO 2: base do dono'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 0 then raise exception 'CASO 2b: socios_da_base gravou pedido'; end if;

  -- 3. dono pede: cria pendente com disparado_em
  r := public.socios_pedir(c);
  if (r->>'ok')::boolean is not true or r->>'status' <> 'pendente' then raise exception 'CASO 3: pedido do dono: %', r; end if;
  if not exists (select 1 from public.socios_consultas where id = (r->>'id')::bigint and disparado_em is not null and pedido_por = current_setting('teste.dono')::uuid)
    then raise exception 'CASO 3b: pedido sem disparado_em/pedido_por'; end if;

  -- 4. pedir de novo com pedido em andamento: devolve o mesmo, não cria outro
  r2 := public.socios_pedir(c);
  if r2->>'id' <> r->>'id' then raise exception 'CASO 4: criou pedido duplicado'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 1 then raise exception 'CASO 4b: % pedidos para o CNPJ', n; end if;

  -- 5. pendente há mais de 3 min: redispara e atualiza disparado_em
  update public.socios_consultas set disparado_em = now() - interval '4 minutes' where id = (r->>'id')::bigint;
  perform public.socios_pedir(c);
  if (select disparado_em from public.socios_consultas where id = (r->>'id')::bigint) < now() - interval '1 minute'
    then raise exception 'CASO 5: não redisparou'; end if;

  -- 6. consultando há mais de 10 min vira erro e libera novo pedido
  update public.socios_consultas set status = 'consultando', iniciado_em = now() - interval '11 minutes' where id = (r->>'id')::bigint;
  r2 := public.socios_pedir(c);
  if (select status from public.socios_consultas where id = (r->>'id')::bigint) <> 'erro' then raise exception 'CASO 6: abandonado não virou erro'; end if;
  if r2->>'id' = r->>'id' or r2->>'status' <> 'pendente' then raise exception 'CASO 6b: não criou novo pedido'; end if;

  -- 7. limite: com 20 pedidos hoje, o 21º é barrado (os de cima já contam 2)
  update public.socios_consultas set status = 'pronto' where cnpj_digits = current_setting('teste.cnpj') and status = 'pendente';
  insert into public.socios_consultas (cnpj_digits, pedido_por, status)
    select '00000000000191', current_setting('teste.dono')::uuid, 'pronto' from generate_series(1, 18);
  r := public.socios_pedir(c);
  if r->>'motivo' is distinct from 'limite' then raise exception 'CASO 7: 21º pedido não foi barrado: %', r; end if;

  -- 8. supervisor pode pedir (não tem limite estourado)
  perform set_config('request.jwt.claims', format(como, current_setting('teste.sup')), true);
  r := public.socios_pedir(c);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 8: supervisor barrado: %', r; end if;

  -- 9. robô pega: marca consultando e devolve só id+cnpj
  select count(*) into n from public.socios_robo_pegar(10);
  if n < 1 then raise exception 'CASO 9: robô não pegou'; end if;
  if exists (select 1 from public.socios_consultas where status = 'pendente' and cnpj_digits = current_setting('teste.cnpj'))
    then raise exception 'CASO 9b: ficou pendente'; end if;
end $t$;

-- 10. RLS: como authenticated, o outro consultor não vê; o dono vê
set local role authenticated;
do $rls$
declare n int;
begin
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('teste.outro')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 0 then raise exception 'CASO 10a: outro consultor vê % pedidos', n; end if;
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('teste.dono')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n < 1 then raise exception 'CASO 10b: dono não vê os pedidos'; end if;
  begin
    insert into public.socios_consultas (cnpj_digits, pedido_por) values (current_setting('teste.cnpj'), auth.uid());
    raise exception 'CASO 10c: authenticated conseguiu inserir';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from mailing.socio limit 1;
    raise exception 'CASO 10d: authenticated lê mailing.socio direto';
  exception when insufficient_privilege then null;
  end;
end $rls$;
reset role;
select 'OK' as verificacao;
rollback;
```

- [ ] **Step 2: Rodar a verificação e confirmar que falha**

Rodar o conteúdo do arquivo com `mcp__supabase__execute_sql` (projeto `mdgfboijyqfkggcrhptn`). É só leitura na prática
(tudo desfeito), mas é produção: avisar o Rafael antes.
Expected: erro `function public.socios_da_base(bigint) does not exist` (ou `relation "public.socios_consultas" does not exist`).

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261116200000_socios_consultas.sql`:

```sql
-- §155 (16/11/2026, pedido do Rafael): consulta de sócios na ficha da Renovação.
-- Spec: docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md (seção 4)
begin;

create table if not exists public.socios_consultas (
  id            bigserial primary key,
  cnpj_digits   text not null check (cnpj_digits ~ '^[0-9]{14}$'),
  carteira_id   bigint references public.renovacao_carteira(id) on delete set null,
  origem        text not null default 'renovacao',
  pedido_por    uuid not null,
  pedido_em     timestamptz not null default now(),
  status        text not null default 'pendente'
                check (status in ('pendente','consultando','pronto','sem_socios','erro')),
  iniciado_em   timestamptz,
  concluido_em  timestamptz,
  disparado_em  timestamptz,
  resultado     jsonb,
  erro          text
);
create index if not exists socios_consultas_cnpj on public.socios_consultas (cnpj_digits, pedido_em desc);
create index if not exists socios_consultas_quem on public.socios_consultas (pedido_por, pedido_em);
create index if not exists socios_consultas_fila on public.socios_consultas (status) where status in ('pendente','consultando');

alter table public.socios_consultas enable row level security;
revoke all on public.socios_consultas from anon, authenticated;
grant select on public.socios_consultas to authenticated;
revoke all on sequence public.socios_consultas_id_seq from anon, authenticated;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'socios_consultas' and policyname = 'socios_consultas_select') then
    create policy socios_consultas_select on public.socios_consultas for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c
                      where c.cnpj_digits = socios_consultas.cnpj_digits
                        and (c.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'))));
  end if;
end $pol$;

-- CNPJ do cliente se quem chama pode ver a ficha (mesma regra da renovacao_carteira_select); null se não pode.
create or replace function public.socios_cnpj_visivel(p_carteira_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select c.cnpj_digits from public.renovacao_carteira c
   where c.id = p_carteira_id and c.cnpj_digits ~ '^[0-9]{14}$'
     and (c.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'));
$$;

-- Dispara o workflow socios.yml do robô (mesmo token do Vault dos jobs robo-procontact-*).
create or replace function public.socios_disparar_robo() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://api.github.com/repos/rafaangelao/apex-robo-procontact/actions/workflows/socios.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_robo_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'apex-supabase-socios',
      'Content-Type', 'application/json'),
    body := '{"ref":"main"}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

create or replace function public.socios_da_base(p_carteira_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cnpj text;
begin
  v_cnpj := public.socios_cnpj_visivel(p_carteira_id);
  if v_cnpj is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  return jsonb_build_object(
    'ok', true,
    'receita_mes', (select k.receita_mes from mailing.carga k order by k.carregado_em desc limit 1),
    'socios', coalesce((
      select jsonb_agg(jsonb_build_object('nome', s.nome, 'cpf', s.cpf,
                                          'principal', coalesce(s.principal, false), 'obito', coalesce(s.obito, false))
                       order by coalesce(s.principal, false) desc, s.nome)
        from mailing.socio s where s.cnpj = v_cnpj), '[]'::jsonb));
end $$;

create or replace function public.socios_pedir(p_carteira_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cnpj text; v_ped public.socios_consultas; v_hoje int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  v_cnpj := public.socios_cnpj_visivel(p_carteira_id);
  if v_cnpj is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  -- dois cliques quase juntos no mesmo CNPJ: um espera o outro (não duplica pedido nem limite)
  perform pg_advisory_xact_lock(hashtext('socios:' || v_cnpj));

  update public.socios_consultas set status = 'erro', erro = 'A consulta não terminou.', concluido_em = now()
   where cnpj_digits = v_cnpj and status = 'consultando' and iniciado_em < now() - interval '10 minutes';

  select * into v_ped from public.socios_consultas
   where cnpj_digits = v_cnpj and status in ('pendente','consultando')
   order by pedido_em desc limit 1;
  if found then
    if v_ped.status = 'pendente' and (v_ped.disparado_em is null or v_ped.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where id = v_ped.id;
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status);
  end if;

  select count(*) into v_hoje from public.socios_consultas
   where pedido_por = auth.uid()
     and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_hoje >= 20 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;

  insert into public.socios_consultas (cnpj_digits, carteira_id, pedido_por, disparado_em)
       values (v_cnpj, p_carteira_id, auth.uid(), now())
    returning * into v_ped;
  perform public.socios_disparar_robo();
  return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status);
end $$;

-- Só o robô (via Edge Function ingest-socios, service_role): pega até p_max pendentes e marca consultando.
create or replace function public.socios_robo_pegar(p_max int) returns table(id bigint, cnpj text)
language sql security definer set search_path = public as $$
  update public.socios_consultas s set status = 'consultando', iniciado_em = now()
   where s.id in (select q.id from public.socios_consultas q where q.status = 'pendente'
                   order by q.pedido_em limit greatest(1, least(coalesce(p_max, 10), 20))
                   for update skip locked)
  returning s.id, s.cnpj_digits;
$$;

revoke all on function public.socios_cnpj_visivel(bigint), public.socios_disparar_robo(), public.socios_robo_pegar(int)
  from public, anon, authenticated;
grant execute on function public.socios_robo_pegar(int) to service_role;
revoke all on function public.socios_pedir(bigint), public.socios_da_base(bigint) from public, anon;
grant execute on function public.socios_pedir(bigint), public.socios_da_base(bigint) to authenticated;

commit;
```

- [ ] **Step 4: Pedir ok e aplicar**

Mostrar ao Rafael o resumo ("cria tabela `socios_consultas` + 5 funções; não altera nada existente") e **esperar o ok**.
Aplicar o conteúdo do arquivo com `mcp__supabase__execute_sql`. Expected: sucesso, sem linhas.

- [ ] **Step 5: Rodar a verificação e confirmar que passa**

Rodar de novo `supabase/tests/socios_consultas_verificar.sql`. Expected: uma linha `verificacao = OK` (e o `rollback`
desfaz tudo). Conferir que não sobrou nada: `select count(*) from public.socios_consultas;` → `0`.

- [ ] **Step 6: Commit (local, no worktree)**

```bash
git add supabase/migrations/20261116200000_socios_consultas.sql supabase/tests/socios_consultas_verificar.sql
git commit -m "feat(socios): tabela socios_consultas, RLS e RPCs da consulta de sócios (§155)"
```

---

### Task 2: Edge Function `ingest-socios`

**Files:**
- Create: `supabase/functions/ingest-socios/ingest.ts`
- Create: `supabase/functions/ingest-socios/ingest.test.ts`
- Create: `supabase/functions/ingest-socios/index.ts`

**Interfaces:**
- Consumes: `socios_robo_pegar(p_max int)`; tabela `socios_consultas` (Task 1).
- Produces (HTTP POST, header `x-robo-token`):
  - `{acao:'pegar', max?:number}` → `200 {pedidos:[{id:number, cnpj:string}]}`
  - `{acao:'resultado', id:number, status:'pronto'|'sem_socios'|'erro', resultado?:{socios:Socio[]}, erro?:string}` → `200 {ok:true}` | `400 {error}` | `409 {error:'pedido não está em consulta'}`
  - `Socio = {nome:string, cpf:string(11 díg.), participacao:number|null, telefones_consultados:boolean, telefones:Telefone[]}`
  - `Telefone = {tipo:'fixo'|'celular', numero:string(10–11 díg.), operadora:string|null, whatsapp:boolean}`

- [ ] **Step 1: Escrever os testes**

`supabase/functions/ingest-socios/ingest.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { processar, validarResultado } from "./ingest.ts";
import type { DepsSocios } from "./ingest.ts";

// DADOS FICTÍCIOS (repo público)
const socio = (o: Record<string, unknown> = {}) => ({
  nome: "ZZ SOCIA UM", cpf: "12345678909", participacao: 50, telefones_consultados: true,
  telefones: [{ tipo: "celular", numero: "11900000001", operadora: "CLARO", whatsapp: true }], ...o,
});
function deps(sobre: Partial<DepsSocios> = {}) {
  const reg = { pegar: [] as number[], concluir: [] as { id: number; patch: Record<string, unknown> }[] };
  const d: DepsSocios = {
    async pegar(max) { reg.pegar.push(max); return [{ id: 7, cnpj: "00000000000191" }]; },
    async concluir(id, patch) { reg.concluir.push({ id, patch }); return true; },
    ...sobre,
  };
  return { d, reg };
}

test("validarResultado: aceita o formato da spec", () => {
  assert.deepEqual(validarResultado({ socios: [socio()] }), { socios: [socio()] });
});
test("validarResultado: recusa CPF, telefone, tipo e participação fora do formato", () => {
  assert.equal(validarResultado({ socios: [socio({ cpf: "123" })] }), null);
  assert.equal(validarResultado({ socios: [socio({ participacao: 150 })] }), null);
  assert.equal(validarResultado({ socios: [socio({ telefones: [{ tipo: "fax", numero: "11900000001", operadora: null, whatsapp: false }] })] }), null);
  assert.equal(validarResultado({ socios: [socio({ telefones: [{ tipo: "fixo", numero: "123", operadora: null, whatsapp: false }] })] }), null);
  assert.equal(validarResultado({ socios: [] }), null);
  assert.equal(validarResultado(null), null);
});
test("validarResultado: participação nula e sócio sem telefone consultado passam", () => {
  const s = socio({ participacao: null, telefones_consultados: false, telefones: [] });
  assert.deepEqual(validarResultado({ socios: [s] }), { socios: [s] });
});
test("pegar: limita max entre 1 e 20 e devolve só id e cnpj", async () => {
  const { d, reg } = deps();
  const r = await processar({ acao: "pegar", max: 99 }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { pedidos: [{ id: 7, cnpj: "00000000000191" }] });
  assert.deepEqual(reg.pegar, [20]);
  await processar({ acao: "pegar" }, d);
  assert.equal(reg.pegar[1], 10);
});
test("resultado pronto: grava status, resultado e erro nulo", async () => {
  const { d, reg } = deps();
  const r = await processar({ acao: "resultado", id: 7, status: "pronto", resultado: { socios: [socio()] } }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(reg.concluir[0], { id: 7, patch: { status: "pronto", resultado: { socios: [socio()] }, erro: null } });
});
test("resultado sem_socios: ignora resultado enviado", async () => {
  const { d, reg } = deps();
  await processar({ acao: "resultado", id: 7, status: "sem_socios", resultado: { socios: [socio()] } }, d);
  assert.deepEqual(reg.concluir[0].patch, { status: "sem_socios", resultado: null, erro: null });
});
test("resultado erro: mensagem curta; vazia vira a genérica", async () => {
  const { d, reg } = deps();
  await processar({ acao: "resultado", id: 7, status: "erro", erro: "x".repeat(500) }, d);
  assert.equal((reg.concluir[0].patch.erro as string).length, 200);
  await processar({ acao: "resultado", id: 7, status: "erro" }, d);
  assert.equal(reg.concluir[1].patch.erro, "A consulta na Nova Vida falhou.");
});
test("resultado: recusa status inválido, id ruim e pronto sem resultado válido", async () => {
  const { d, reg } = deps();
  assert.equal((await processar({ acao: "resultado", id: 7, status: "consultando" }, d)).status, 400);
  assert.equal((await processar({ acao: "resultado", id: "7", status: "erro" }, d)).status, 400);
  assert.equal((await processar({ acao: "resultado", id: 7, status: "pronto", resultado: { socios: [socio({ cpf: "1" })] } }, d)).status, 400);
  assert.equal(reg.concluir.length, 0);
});
test("resultado: pedido que não está consultando → 409", async () => {
  const { d } = deps({ async concluir() { return false; } });
  const r = await processar({ acao: "resultado", id: 7, status: "erro" }, d);
  assert.equal(r.status, 409);
});
test("ação desconhecida → 400; falha das dependências → 500 sem eco do corpo", async () => {
  const { d } = deps({ async pegar() { throw new Error("pegar pedidos (código 42P01)"); } });
  assert.equal((await processar({ acao: "apagar" }, d)).status, 400);
  const r = await processar({ acao: "pegar" }, d);
  assert.equal(r.status, 500);
  assert.match(String(r.corpo.error), /42P01/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test supabase/functions/ingest-socios/ingest.test.ts`
Expected: FAIL com `Cannot find module './ingest.ts'`.

- [ ] **Step 3: Implementar `ingest.ts`**

```ts
// Regras da Edge Function ingest-socios (§155). Puro: sem Supabase, testável com node --test.
export type Telefone = { tipo: "fixo" | "celular"; numero: string; operadora: string | null; whatsapp: boolean };
export type Socio = { nome: string; cpf: string; participacao: number | null; telefones_consultados: boolean; telefones: Telefone[] };
export type Resultado = { socios: Socio[] };
export type DepsSocios = {
  pegar(max: number): Promise<{ id: number; cnpj: string }[]>;
  concluir(id: number, patch: Record<string, unknown>): Promise<boolean>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const STATUS_FINAIS = ["pronto", "sem_socios", "erro"];
const ERRO_PADRAO = "A consulta na Nova Vida falhou.";

function telefoneOk(t: unknown): t is Telefone {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
  return (x.tipo === "fixo" || x.tipo === "celular")
    && typeof x.numero === "string" && /^\d{10,11}$/.test(x.numero)
    && (x.operadora === null || (typeof x.operadora === "string" && /^[A-Z ]{2,20}$/.test(x.operadora)))
    && typeof x.whatsapp === "boolean";
}
function socioOk(s: unknown): s is Socio {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return typeof x.nome === "string" && x.nome.trim().length >= 1 && x.nome.length <= 200
    && typeof x.cpf === "string" && /^\d{11}$/.test(x.cpf)
    && (x.participacao === null || (typeof x.participacao === "number" && x.participacao >= 0 && x.participacao <= 100))
    && typeof x.telefones_consultados === "boolean"
    && Array.isArray(x.telefones) && x.telefones.length <= 20 && x.telefones.every(telefoneOk);
}
export function validarResultado(r: unknown): Resultado | null {
  if (!r || typeof r !== "object") return null;
  const socios = (r as Record<string, unknown>).socios;
  if (!Array.isArray(socios) || socios.length < 1 || socios.length > 50 || !socios.every(socioOk)) return null;
  return { socios: socios as Socio[] };
}

export async function processar(corpo: unknown, deps: DepsSocios): Promise<Resposta> {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  try {
    if (c.acao === "pegar") {
      const n = Number(c.max);
      const max = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 10;
      const pedidos = await deps.pegar(max);
      return { status: 200, corpo: { pedidos: pedidos.map((p) => ({ id: p.id, cnpj: p.cnpj })) } };
    }
    if (c.acao === "resultado") {
      if (typeof c.id !== "number" || !Number.isInteger(c.id) || c.id < 1) return { status: 400, corpo: { error: "id inválido" } };
      if (typeof c.status !== "string" || !STATUS_FINAIS.includes(c.status)) return { status: 400, corpo: { error: "status inválido" } };
      let patch: Record<string, unknown>;
      if (c.status === "pronto") {
        const r = validarResultado(c.resultado);
        if (!r) return { status: 400, corpo: { error: "resultado fora do formato" } };
        patch = { status: "pronto", resultado: r, erro: null };
      } else if (c.status === "sem_socios") {
        patch = { status: "sem_socios", resultado: null, erro: null };
      } else {
        const e = typeof c.erro === "string" && c.erro.trim() ? c.erro.trim().slice(0, 200) : ERRO_PADRAO;
        patch = { status: "erro", resultado: null, erro: e };
      }
      const ok = await deps.concluir(c.id, patch);
      return ok ? { status: 200, corpo: { ok: true } } : { status: 409, corpo: { error: "pedido não está em consulta" } };
    }
    return { status: 400, corpo: { error: "ação desconhecida" } };
  } catch (e) {
    return { status: 500, corpo: { error: String((e as Error)?.message ?? e).slice(0, 200) } };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test supabase/functions/ingest-socios/ingest.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: Escrever `index.ts`** (mesmo esqueleto da `ingest-ligacoes`)

```ts
// Edge Function: ingest-socios — fila da consulta de sócios na Nova Vida (§155). Chamada só pelo robô
// (header x-robo-token = secret INGEST_SOCIOS_TOKEN); por isso roda sem JWT (--no-verify-jwt).
// Spec: docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md (4.6)
// Publicar: npx supabase functions deploy ingest-socios --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./ingest.ts";
import type { DepsSocios } from "./ingest.ts";

const MAX_BYTES = 200_000;

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function criarDeps(): DepsSocios {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // a mensagem do PostgREST pode citar valores; guardamos só o código e o contexto
  const falha = (ctx: string, error: { code?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  return {
    async pegar(max) {
      const { data, error } = await sb.rpc("socios_robo_pegar", { p_max: max });
      falha("pegar pedidos", error);
      return (data ?? []) as { id: number; cnpj: string }[];
    },
    async concluir(id, patch) {
      const { data, error } = await sb.from("socios_consultas")
        .update({ ...patch, concluido_em: new Date().toISOString() })
        .eq("id", id).eq("status", "consultando").select("id");
      falha("gravar resultado", error);
      return (data ?? []).length === 1;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let esperado: string;
  try { esperado = env("INGEST_SOCIOS_TOKEN"); } catch { return json({ error: "Não autorizado" }, 401); }
  const recebido = req.headers.get("x-robo-token") ?? "";
  if (!recebido || !iguais(recebido, esperado)) return json({ error: "Não autorizado" }, 401);

  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  const texto = await req.text();
  if (texto.length > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  let corpo: unknown;
  try { corpo = JSON.parse(texto); } catch { return json({ error: "JSON inválido" }, 400); }

  const r = await processar(corpo, criarDeps());
  return json(r.corpo, r.status);
});
```

- [ ] **Step 6: Commit (local)**

```bash
git add supabase/functions/ingest-socios
git commit -m "feat(socios): Edge Function ingest-socios (fila do robô da Nova Vida, §155)"
```

- [ ] **Step 7: Segredo + deploy (com ok do Rafael)**

1. O **Rafael** gera um token aleatório longo (ex.: gerenciador de senhas, 40+ caracteres) e o cadastra **em dois lugares**,
   sem colar no chat: Supabase → Project Settings → Edge Functions → Secrets → `INGEST_SOCIOS_TOKEN`; GitHub do robô →
   Settings → Secrets → Actions → `INGEST_SOCIOS_TOKEN`. No GitHub também `INGEST_SOCIOS_URL` =
   `https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-socios`.
2. Com ok: `npx supabase functions deploy ingest-socios --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`
3. Teste de fumaça sem token: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-socios -d '{}'`
   Expected: `401`.

---

### Task 3: Robô — navegação na Nova Vida + mapeamento local mascarado

**Files:**
- Create: `src/socios/novavida.js`
- Create: `scripts/mapear-novavida.js`

**Interfaces:**
- Produces: `criarNavegador(context) → Promise<Nav>` com
  `Nav = { entrar({usuario,senha,cliente}): Promise<void>, buscarCnpj(cnpj:string): Promise<boolean>, abrirSocios(): Promise<boolean>, lerCartoes(): Promise<string[]>, lerPessoa(indice:number): Promise<{fixos:string|null, celulares:string|null}>, reiniciar(): Promise<void> }`.
  `lerCartoes` devolve o `innerText` de cada cartão de sócio, na ordem da página (o índice do array é o `indice` usado em `lerPessoa`).
  `lerPessoa` abre o sócio, lê as duas seções e **volta** para a página de Sócios.

Esta task não tem teste automático (é navegação real); a validação é o mapeamento do Step 3, rodado pelo Rafael.

- [ ] **Step 1: Criar a branch do robô**

```bash
cd ~/.graphify/repos/rafaangelao/apex-robo-procontact && git fetch -q origin && git switch -c feat/socios origin/main
```

- [ ] **Step 2: Escrever `src/socios/novavida.js`**

```js
// src/socios/novavida.js — navegação no Congonhas (Nova Vida TI). §155, spec seções 3 e 5.3.
// Só navega e devolve TEXTO BRUTO; quem interpreta é ler-socios.js. Nunca loga nada.
const INICIO = 'https://congonhas.novavidatec.com.br/';
const HOST = 'congonhas.novavidatec.com.br';
const BUSCA = 'Digite o CPF ou CNPJ';

// Roda no navegador: marca os cartões de sócio (menor elemento com CPF de 11 dígitos numa linha e "Participação").
function marcarCartoesNaPagina() {
  const temCpf = (t) => /(^|\n)\s*\d{11}\s*(\n|$)/.test(t);
  const todos = [...document.querySelectorAll('body *')]
    .filter((e) => { const t = e.innerText || ''; return t.includes('Participação') && temCpf(t); });
  const minimos = todos.filter((e) => !todos.some((o) => o !== e && e.contains(o)));
  document.querySelectorAll('[data-apex-socio]').forEach((e) => e.removeAttribute('data-apex-socio'));
  return minimos.map((e, i) => { e.setAttribute('data-apex-socio', String(i)); return e.innerText; });
}
// Roda no navegador: texto da seção cujo título é exatamente `titulo` (sobe até antes de englobar `outro`).
function secaoNaPagina([titulo, outro]) {
  const h = [...document.querySelectorAll('body *')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === titulo);
  if (!h) return null;
  let el = h;
  while (el.parentElement && el.parentElement !== document.body && !(el.parentElement.innerText || '').includes(outro)) el = el.parentElement;
  return el.innerText;
}

export async function criarNavegador(context) {
  let page = await context.newPage();
  const nav = {
    async entrar({ usuario, senha, cliente }) {
      // Entrar pelo Congonhas: ele redireciona ao login com o token p=… (direto no /Auth/Login dá "Sessão expirada")
      await page.goto(INICIO, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForSelector('#sUsuario', { timeout: 20000 });
      await page.fill('#sUsuario', usuario);
      await page.fill('#sSenha', senha);
      await page.fill('#sCliente', cliente);
      await page.mouse.move(400, 300);
      await page.waitForTimeout(2500); // o reCAPTCHA v3 dá nota melhor a quem "fica" na página
      await page.click('#submitEntrar');
      await page.waitForURL((u) => u.hostname === HOST, { timeout: 30000 });
      await page.getByPlaceholder(BUSCA).first().waitFor({ state: 'visible', timeout: 20000 });
    },
    async buscarCnpj(cnpj) {
      const antes = page.url();
      const caixa = page.getByPlaceholder(BUSCA).first();
      await caixa.fill('');
      await caixa.pressSequentially(cnpj, { delay: 30 }); // a máscara do campo formata sozinha
      await caixa.press('Enter');
      try {
        await page.waitForURL((u) => u.href !== antes && /\/Pj\/Cadastro/i.test(u.pathname), { timeout: 20000 });
        return true;
      } catch { return false; }
    },
    async abrirSocios() {
      await page.locator('a', { hasText: /^\s*Sócios\s*$/ }).first().click({ timeout: 10000 });
      try { await page.waitForURL(/\/Pj\/Socios/i, { timeout: 15000 }); } catch { return false; }
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      return true;
    },
    async lerCartoes() {
      return page.evaluate(marcarCartoesNaPagina);
    },
    async lerPessoa(indice) {
      const socios = page.url();
      await page.evaluate(marcarCartoesNaPagina); // a página pode ter sido redesenhada ao voltar
      await page.locator(`[data-apex-socio="${indice}"]`).locator('button, a').first().click({ timeout: 10000 });
      await page.waitForURL(/\/Pf\/Cadastro/i, { timeout: 20000 });
      await page.getByText('Celulares', { exact: true }).first().waitFor({ timeout: 15000 }).catch(() => {});
      const fixos = await page.evaluate(secaoNaPagina, ['Telefones fixos', 'Celulares']);
      const celulares = await page.evaluate(secaoNaPagina, ['Celulares', 'Telefones fixos']);
      await page.goBack({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      if (!/\/Pj\/Socios/i.test(page.url())) await page.goto(socios, { waitUntil: 'networkidle', timeout: 20000 });
      return { fixos, celulares };
    },
    // Depois de um timeout: descarta a página (a consulta velha pode continuar rodando nela) e abre outra na mesma sessão.
    async reiniciar() {
      await page.close().catch(() => {});
      page = await context.newPage();
      await page.goto(INICIO, { waitUntil: 'networkidle', timeout: 45000 });
      await page.getByPlaceholder(BUSCA).first().waitFor({ state: 'visible', timeout: 20000 });
    },
  };
  return nav;
}
```

- [ ] **Step 3: Escrever `scripts/mapear-novavida.js`** (roda só no PC do Rafael; saída mascarada em `recon/`, que já está no `.gitignore`)

```js
// scripts/mapear-novavida.js — RODAR SÓ LOCALMENTE. Confere se a navegação acha cartões e telefones e grava o TEXTO
// MASCARADO (letras viram x/X, dígitos viram 0; rótulos do site preservados) em recon/socios-mascarado.txt para
// montar fixtures fictícias. Lê .env.novavida (ignorado pelo git): NOVAVIDA_USUARIO, NOVAVIDA_SENHA,
// NOVAVIDA_EMPRESA, MAPEAR_CNPJ. Não imprime nenhum dado: só contagens.
import fs from 'node:fs';
import { chromium } from 'playwright';
import { criarNavegador } from '../src/socios/novavida.js';

const MANTER = new Set(['Participação', 'em', 'empresas', 'Telefones', 'fixos', 'Celulares', 'Mobilidade', 'cadastral',
  'MEDIA', 'BAIXA', 'ALTA', 'WHATSAPP', 'PROCON', 'CLARO', 'VIVO', 'TIM', 'OI', 'NEXTEL', 'ALGAR', 'SERCOMTEL', 'Sócios']);
export function mascarar(t) {
  return String(t ?? '').replace(/[A-Za-zÀ-ÿ]+/g, (w) => (MANTER.has(w) ? w : w.replace(/[a-zß-ÿ]/g, 'x').replace(/[A-ZÀ-Þ]/g, 'X')))
    .replace(/\d/g, '0');
}
const env = Object.fromEntries(fs.readFileSync('.env.novavida', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
  const nav = await criarNavegador(context);
  await nav.entrar({ usuario: env.NOVAVIDA_USUARIO, senha: env.NOVAVIDA_SENHA, cliente: env.NOVAVIDA_EMPRESA });
  console.log('login: ok');
  console.log('busca:', await nav.buscarCnpj(env.MAPEAR_CNPJ) ? 'ok' : 'NÃO ACHOU');
  console.log('sócios:', await nav.abrirSocios() ? 'ok' : 'NÃO ABRIU');
  const cartoes = await nav.lerCartoes();
  console.log('cartões de sócio:', cartoes.length);
  const saida = ['=== CARTÕES ===', ...cartoes.map((c, i) => `--- cartão ${i} ---\n${mascarar(c)}`)];
  if (cartoes.length) {
    const p = await nav.lerPessoa(0);
    console.log('pessoa 0: fixos', p.fixos ? 'achou' : 'NÃO ACHOU', '· celulares', p.celulares ? 'achou' : 'NÃO ACHOU');
    saida.push('=== FIXOS (sócio 0) ===', mascarar(p.fixos), '=== CELULARES (sócio 0) ===', mascarar(p.celulares));
    console.log('voltou para Sócios:', (await nav.lerCartoes()).length === cartoes.length ? 'ok' : 'NÃO');
  }
  fs.mkdirSync('recon', { recursive: true });
  fs.writeFileSync('recon/socios-mascarado.txt', saida.join('\n') + '\n');
  console.log('gravado: recon/socios-mascarado.txt');
} finally {
  await browser.close();
}
```

- [ ] **Step 4: Rafael roda o mapeamento**

Pedir ao Rafael que crie `.env.novavida` na raiz do robô (ignorado por `.env*` no `.gitignore`) com
`NOVAVIDA_USUARIO=…`, `NOVAVIDA_SENHA=…`, `NOVAVIDA_EMPRESA=…`, `MAPEAR_CNPJ=<um CNPJ da carteira com 2+ sócios>` e rode:
`! cd ~/.graphify/repos/rafaangelao/apex-robo-procontact && node scripts/mapear-novavida.js`
Expected: `login: ok`, `busca: ok`, `sócios: ok`, `cartões de sócio: N` (N ≥ 1), `pessoa 0: fixos achou · celulares achou`,
`voltou para Sócios: ok`. Se alguma linha disser NÃO: ajustar o seletor correspondente em `novavida.js` (ex.: o menu
"Sócios" não é `<a>` → trocar o locator por `page.getByText('Sócios', { exact: true }).first()`) e repetir.

- [ ] **Step 5: Ler `recon/socios-mascarado.txt` e anotar o formato**

Ler o arquivo (já está mascarado). Anotar para a Task 4: em que linha vem o CPF (só dígitos? com pontos?), se há linhas de
ícone (palavras minúsculas com `_`, ex.: `xxxxxx_xxxxxx`), o formato da participação (`00.00%`), e como aparecem
telefone, `WHATSAPP`, `PROCON` e a operadora nas seções. **Não commitar nada de `recon/`.**

- [ ] **Step 6: Commit (local; push é do Rafael no fim da Task 7)**

```bash
git add src/socios/novavida.js scripts/mapear-novavida.js
git commit -m "feat(socios): navegação na Nova Vida e mapeamento local mascarado (§155)"
```

---

### Task 4: Robô — leitura pura dos sócios e telefones (`ler-socios.js`)

**Files:**
- Create: `src/socios/ler-socios.js`
- Test: `test/socios-ler.test.js`

**Interfaces:**
- Consumes: os textos de `Nav.lerCartoes()` e `Nav.lerPessoa()` (Task 3).
- Produces:
  - `TETO_TELEFONES = 5`
  - `lerCartaoSocio(texto:string, indice:number) → {indice, nome, cpf, participacao:number|null} | null`
  - `ordenarSocios(lista) → lista` (participação desc, nulos no fim, empate pelo `indice`)
  - `lerTelefones(texto:string|null, tipo:'fixo'|'celular') → Telefone[]` (no máx. 10)
  - `paraResultado(socio) → {nome, cpf, participacao, telefones_consultados, telefones}` (tira o `indice`)

- [ ] **Step 1: Escrever os testes** (fixtures **fictícias** no formato visto no vídeo de 16/11 e no `recon/` da Task 3)

```js
// test/socios-ler.test.js — DADOS FICTÍCIOS (repo público)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerCartaoSocio, ordenarSocios, lerTelefones, paraResultado, TETO_TELEFONES } from '../src/socios/ler-socios.js';

const cartao = (nome, cpf, pct, extra = '') => `${extra}${nome}\n${cpf}\nParticipação\n${pct}\nParticipação em empresas`;

test('lerCartaoSocio: nome em duas linhas, CPF só dígitos, participação com ponto', () => {
  assert.deepEqual(lerCartaoSocio(cartao('ZZ SOCIA\nUM DE TAL', '12345678909', '50.00%'), 0),
    { indice: 0, nome: 'ZZ SOCIA UM DE TAL', cpf: '12345678909', participacao: 50 });
});
test('lerCartaoSocio: ignora linha de ícone e aceita CPF formatado e vírgula', () => {
  assert.deepEqual(lerCartaoSocio(cartao('ZZ SOCIO DOIS', '123.456.789-09', '33,33%', 'person_search\n'), 1),
    { indice: 1, nome: 'ZZ SOCIO DOIS', cpf: '12345678909', participacao: 33.33 });
});
test('lerCartaoSocio: sem participação → null; sem CPF ou sem nome → null', () => {
  assert.equal(lerCartaoSocio('ZZ SEM PCT\n12345678909\nParticipação\nParticipação em empresas', 2).participacao, null);
  assert.equal(lerCartaoSocio('ZZ SEM CPF\nParticipação\n10.00%', 3), null);
  assert.equal(lerCartaoSocio('12345678909\nParticipação\n10.00%', 4), null);
});
test('ordenarSocios: participação desc, nulos no fim, empate pela ordem da página', () => {
  const l = [
    { indice: 0, participacao: 10 }, { indice: 1, participacao: null }, { indice: 2, participacao: 50 }, { indice: 3, participacao: 10 },
  ];
  assert.deepEqual(ordenarSocios(l).map((s) => s.indice), [2, 0, 3, 1]);
});
test('lerTelefones: celular com WhatsApp e operadora em linhas separadas; ignora cabeçalho', () => {
  const t = 'Celulares\nMobilidade cadastral: MEDIA\n(11) 90000-0001\nWHATSAPP\nCLARO\n(11) 90000-0002\nWHATSAPP PROCON\nVIVO';
  assert.deepEqual(lerTelefones(t, 'celular'), [
    { tipo: 'celular', numero: '11900000001', operadora: 'CLARO', whatsapp: true },
    { tipo: 'celular', numero: '11900000002', operadora: 'VIVO', whatsapp: true },
  ]);
});
test('lerTelefones: fixo na mesma linha da operadora, sem WhatsApp', () => {
  assert.deepEqual(lerTelefones('Telefones fixos\nMobilidade cadastral: BAIXA\n(11) 3000-0001 VIVO', 'fixo'),
    [{ tipo: 'fixo', numero: '1130000001', operadora: 'VIVO', whatsapp: false }]);
});
test('lerTelefones: seção ausente ou sem número → []; corta em 10', () => {
  assert.deepEqual(lerTelefones(null, 'fixo'), []);
  assert.deepEqual(lerTelefones('Celulares\nNenhum registro', 'celular'), []);
  const muitos = Array.from({ length: 12 }, (_, i) => `(11) 90000-00${String(i).padStart(2, '0')}`).join('\n');
  assert.equal(lerTelefones(muitos, 'celular').length, 10);
});
test('paraResultado: tira o indice e mantém o formato da spec', () => {
  assert.deepEqual(paraResultado({ indice: 3, nome: 'ZZ', cpf: '12345678909', participacao: null, telefones_consultados: false, telefones: [] }),
    { nome: 'ZZ', cpf: '12345678909', participacao: null, telefones_consultados: false, telefones: [] });
  assert.equal(TETO_TELEFONES, 5);
});
```

Se o `recon/socios-mascarado.txt` da Task 3 mostrar um formato diferente destes (outra ordem de linhas, CPF com pontos no
cartão, telefone e etiquetas na mesma linha etc.), **acrescentar um teste com aquele formato**, trocando os `x`/`0`
mascarados por valores fictícios (nomes `ZZ …`, CPF `12345678909`, telefones `119000000xx`).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/socios-ler.test.js`
Expected: FAIL com `Cannot find module '../src/socios/ler-socios.js'`.

- [ ] **Step 3: Implementar `src/socios/ler-socios.js`**

```js
// src/socios/ler-socios.js — interpreta o texto das páginas da Nova Vida (§155). Funções puras, sem Playwright.
export const TETO_TELEFONES = 5;
const MAX_FONES = 10;
const OPERADORAS = new Set(['CLARO', 'VIVO', 'TIM', 'OI', 'NEXTEL', 'ALGAR', 'SERCOMTEL', 'CTBC', 'EMBRATEL', 'GVT']);
const ICONE = /^(?=.*[a-z])[a-z0-9_]+$/;            // ligadura de ícone (ex.: person_search); exige letra para não engolir o CPF
const LINHA_CPF = /^[\d.\-\s]+$/;
const FONE = /^\(?(\d{2})\)?\s*(\d{4,5})-?(\d{4})\b/;

const linhas = (t) => String(t ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !ICONE.test(l));

export function lerCartaoSocio(texto, indice) {
  const ls = linhas(texto);
  const iCpf = ls.findIndex((l) => LINHA_CPF.test(l) && l.replace(/\D/g, '').length === 11);
  if (iCpf < 1) return null;
  const nome = ls.slice(0, iCpf).join(' ').replace(/\s+/g, ' ').trim();
  if (!nome) return null;
  const pct = ls.slice(iCpf + 1).map((l) => l.match(/^(\d{1,3}(?:[.,]\d+)?)\s*%$/)).find(Boolean);
  return { indice, nome, cpf: ls[iCpf].replace(/\D/g, ''), participacao: pct ? Number(pct[1].replace(',', '.')) : null };
}

export function ordenarSocios(lista) {
  return [...lista].sort((a, b) => {
    const pa = a.participacao ?? -1, pb = b.participacao ?? -1;
    return pb - pa || a.indice - b.indice;
  });
}

function marcar(t, texto) {
  for (const tok of texto.toUpperCase().split(/[\s·|,]+/)) {
    if (tok === 'WHATSAPP') t.whatsapp = true;
    else if (!t.operadora && OPERADORAS.has(tok)) t.operadora = tok;
  }
}
export function lerTelefones(texto, tipo) {
  const out = [];
  for (const l of linhas(texto)) {
    const m = l.match(FONE);
    if (m) {
      if (out.length >= MAX_FONES) break;
      out.push({ tipo, numero: m[1] + m[2] + m[3], operadora: null, whatsapp: false });
      marcar(out[out.length - 1], l.slice(m[0].length));
    } else if (out.length) {
      marcar(out[out.length - 1], l);
    }
  }
  return out;
}

export function paraResultado(s) {
  return { nome: s.nome, cpf: s.cpf, participacao: s.participacao, telefones_consultados: !!s.telefones_consultados, telefones: s.telefones || [] };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/socios-ler.test.js` → PASS. Depois `npm test` (todos os testes do robô) → PASS.

- [ ] **Step 5: Commit (local)**

```bash
git add src/socios/ler-socios.js test/socios-ler.test.js
git commit -m "feat(socios): leitura dos cartões de sócio e dos telefones da Nova Vida (§155)"
```

---

### Task 5: Robô — ciclo da rodada (`src/socios/main.js`)

**Files:**
- Create: `src/socios/main.js`
- Modify: `package.json` (scripts)
- Test: `test/socios-main.test.js`

**Interfaces:**
- Consumes: `Nav` (Task 3), `lerCartaoSocio/ordenarSocios/lerTelefones/paraResultado/TETO_TELEFONES` (Task 4),
  `chamar` de `src/enviar.js`, `limparErro` de `src/erro.js`, Edge Function da Task 2.
- Produces:
  - `consultarUm(nav, cnpj) → Promise<{status:'pronto', resultado:{socios}} | {status:'sem_socios'}>`
  - `executar(cfg, io) → Promise<{codigo, pedidos, pronto, sem_socios, erro}>` com
    `cfg = {tetoRodadaMs, tempoPorCnpjMs, segredos:string[]}` e
    `io = {pegar(max), enviar(corpo), abrirSessao(): Promise<{nav, fechar()}>, agora(): number, log(msg)}`

- [ ] **Step 1: Escrever os testes**

```js
// test/socios-main.test.js — DADOS FICTÍCIOS (repo público)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executar, consultarUm } from '../src/socios/main.js';

const cartao = (n, cpf, pct) => `ZZ SOCIO ${n}\n${cpf}\nParticipação\n${pct}%\nParticipação em empresas`;
function navFalso(sobre = {}) {
  const reg = { pessoas: [], reiniciou: 0 };
  const nav = {
    async buscarCnpj() { return true; },
    async abrirSocios() { return true; },
    async lerCartoes() { return Array.from({ length: 7 }, (_, i) => cartao(i, '1234567890' + (i % 10), 10 + i)); },
    async lerPessoa(i) { reg.pessoas.push(i); return { fixos: null, celulares: `(11) 90000-000${i}\nWHATSAPP\nCLARO` }; },
    async reiniciar() { reg.reiniciou++; },
    ...sobre,
  };
  return { nav, reg };
}
function io(lotes, sobre = {}) {
  const reg = { enviados: [], logs: [], sessoes: 0, fechou: 0 };
  let t = 0;
  const { nav } = navFalso(sobre.nav);
  const o = {
    async pegar() { return lotes.shift() || []; },
    async enviar(c) { reg.enviados.push(c); },
    async abrirSessao() { reg.sessoes++; if (sobre.loginFalha) throw new Error('login falhou para usuario-secreto'); return { nav, async fechar() { reg.fechou++; } }; },
    agora: () => (t += 1000),
    log: (m) => reg.logs.push(m),
  };
  return { o, reg };
}
const cfg = { tetoRodadaMs: 8 * 60_000, tempoPorCnpjMs: 60_000, segredos: ['usuario-secreto', 'senha-secreta', 'EMPRESA'] };

test('consultarUm: abre telefones só dos 5 de maior participação; demais sem telefone', async () => {
  const { nav, reg } = navFalso();
  const r = await consultarUm(nav, '00000000000191');
  assert.equal(r.status, 'pronto');
  assert.equal(r.resultado.socios.length, 7);
  assert.deepEqual(reg.pessoas, [6, 5, 4, 3, 2]);
  assert.deepEqual(r.resultado.socios.map((s) => s.telefones_consultados), [true, true, true, true, true, false, false]);
  assert.deepEqual(r.resultado.socios[0].telefones, [{ tipo: 'celular', numero: '11900000006', operadora: 'CLARO', whatsapp: true }]);
  assert.equal('indice' in r.resultado.socios[0], false);
});
test('consultarUm: CNPJ não achado, Sócios não abre ou sem cartões → sem_socios', async () => {
  assert.equal((await consultarUm(navFalso({ async buscarCnpj() { return false; } }).nav, 'x')).status, 'sem_socios');
  assert.equal((await consultarUm(navFalso({ async abrirSocios() { return false; } }).nav, 'x')).status, 'sem_socios');
  assert.equal((await consultarUm(navFalso({ async lerCartoes() { return ['texto sem cpf']; } }).nav, 'x')).status, 'sem_socios');
});
test('fila vazia: não abre o navegador (sem login)', async () => {
  const { o, reg } = io([[]]);
  const r = await executar(cfg, o);
  assert.equal(r.codigo, 0);
  assert.equal(reg.sessoes, 0);
  assert.match(reg.logs.at(-1), /^socios: 0 pedidos · 0 prontos · 0 sem sócios · 0 erros · \d+ s$/);
});
test('um login para vários lotes; pega de novo até esvaziar; fecha o navegador', async () => {
  const { o, reg } = io([[{ id: 1, cnpj: '00000000000191' }], [{ id: 2, cnpj: '00000000000272' }], []]);
  const r = await executar(cfg, o);
  assert.deepEqual([r.pedidos, r.pronto, reg.sessoes, reg.fechou], [2, 2, 1, 1]);
  assert.deepEqual(reg.enviados.map((e) => [e.id, e.status]), [[1, 'pronto'], [2, 'pronto']]);
});
test('login falha: todos os pedidos do lote viram erro, código 1, log sem segredo', async () => {
  const { o, reg } = io([[{ id: 1, cnpj: '00000000000191' }, { id: 2, cnpj: '00000000000272' }]], { loginFalha: true });
  const r = await executar(cfg, o);
  assert.equal(r.codigo, 1);
  assert.deepEqual(reg.enviados, [
    { id: 1, status: 'erro', erro: 'Falha no login da Nova Vida.' }, { id: 2, status: 'erro', erro: 'Falha no login da Nova Vida.' },
  ]);
  assert.ok(reg.logs.every((l) => !l.includes('usuario-secreto')));
});
test('uma empresa estoura o tempo: só ela vira erro, a página é reiniciada e a próxima segue', async () => {
  let n = 0;
  const lento = { async buscarCnpj() { n++; if (n === 1) await new Promise(() => {}); return true; } };
  const { o, reg } = io([[{ id: 1, cnpj: '00000000000191' }, { id: 2, cnpj: '00000000000272' }], []], { nav: lento });
  const r = await executar({ ...cfg, tempoPorCnpjMs: 30 }, o);
  assert.deepEqual(reg.enviados.map((e) => [e.id, e.status]), [[1, 'erro'], [2, 'pronto']]);
  assert.equal(r.erro, 1);
});
test('erro do Playwright com o CNPJ na mensagem não vaza o CNPJ no log', async () => {
  const quebra = { async buscarCnpj(c) { throw new Error(`locator.pressSequentially: digitando "${c}"\nCall log: senha-secreta`); } };
  const { o, reg } = io([[{ id: 1, cnpj: '00000000000191' }], []], { nav: quebra });
  await executar(cfg, o);
  assert.deepEqual(reg.enviados[0], { id: 1, status: 'erro', erro: 'A consulta na Nova Vida falhou.' });
  assert.ok(reg.logs.every((l) => !l.includes('00000000000191') && !l.includes('senha-secreta')));
});
test('teto da rodada: não pega lote novo depois de 8 min', async () => {
  const { o, reg } = io([[{ id: 1, cnpj: '00000000000191' }], [{ id: 2, cnpj: '00000000000272' }]]);
  o.agora = (() => { let t = 0; return () => (t += 5 * 60_000); })();
  await executar(cfg, o);
  assert.deepEqual(reg.enviados.map((e) => e.id), [1]);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test test/socios-main.test.js`
Expected: FAIL com `Cannot find module '../src/socios/main.js'`.

- [ ] **Step 3: Implementar `src/socios/main.js`**

```js
// src/socios/main.js — rodada do robô de sócios (§155): pega a fila na ingest-socios, consulta a Nova Vida, devolve.
// Log público: só contagens. Disparado pelo workflow socios.yml (quem dispara é a RPC socios_pedir).
import { pathToFileURL } from 'node:url';
import { chamar } from '../enviar.js';
import { limparErro } from '../erro.js';
import { lerCartaoSocio, ordenarSocios, lerTelefones, paraResultado, TETO_TELEFONES } from './ler-socios.js';

const ERRO_LOGIN = 'Falha no login da Nova Vida.';
const ERRO_CONSULTA = 'A consulta na Nova Vida falhou.';

export async function consultarUm(nav, cnpj) {
  if (!(await nav.buscarCnpj(cnpj))) return { status: 'sem_socios' };
  if (!(await nav.abrirSocios())) return { status: 'sem_socios' };
  const socios = ordenarSocios((await nav.lerCartoes()).map((t, i) => lerCartaoSocio(t, i)).filter(Boolean));
  if (!socios.length) return { status: 'sem_socios' };
  for (const s of socios.slice(0, TETO_TELEFONES)) {
    const p = await nav.lerPessoa(s.indice);
    s.telefones = [...lerTelefones(p.fixos, 'fixo'), ...lerTelefones(p.celulares, 'celular')];
    s.telefones_consultados = true;
  }
  return { status: 'pronto', resultado: { socios: socios.map(paraResultado) } };
}

function comTempo(promessa, ms) {
  let timer;
  const limite = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('tempo esgotado')), ms); });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

export async function executar(cfg, io) {
  const t0 = io.agora();
  const cont = { pedidos: 0, pronto: 0, sem_socios: 0, erro: 0 };
  let sessao = null;
  let codigo = 0;
  try {
    while (io.agora() - t0 < cfg.tetoRodadaMs) {
      const lote = await io.pegar(10);
      if (!lote.length) break;
      cont.pedidos += lote.length;
      if (!sessao) {
        try { sessao = await io.abrirSessao(); } catch (e) {
          io.log('socios: falha no login: ' + limparErro(e, cfg.segredos));
          for (const p of lote) await io.enviar({ id: p.id, status: 'erro', erro: ERRO_LOGIN });
          cont.erro += lote.length;
          codigo = 1;
          break;
        }
      }
      for (const p of lote) {
        let r;
        try {
          r = await comTempo(consultarUm(sessao.nav, p.cnpj), cfg.tempoPorCnpjMs);
        } catch (e) {
          io.log('socios: uma consulta falhou: ' + limparErro(e, [...cfg.segredos, p.cnpj]));
          r = { status: 'erro', erro: ERRO_CONSULTA };
          await sessao.nav.reiniciar().catch(() => {});
        }
        await io.enviar({ id: p.id, ...r });
        cont[r.status]++;
      }
    }
  } finally {
    if (sessao) await sessao.fechar().catch(() => {});
  }
  io.log(`socios: ${cont.pedidos} pedidos · ${cont.pronto} prontos · ${cont.sem_socios} sem sócios · ${cont.erro} erros · ${Math.round((io.agora() - t0) / 1000)} s`);
  return { codigo, ...cont };
}

function env(k) {
  const v = process.env[k];
  if (!v) throw new Error(`variável de ambiente ausente: ${k}`);
  return v;
}

async function main() {
  const { chromium } = await import('playwright'); // import tardio: os testes não precisam do Playwright
  const { criarNavegador } = await import('./novavida.js');
  const cred = { usuario: env('NOVAVIDA_USUARIO'), senha: env('NOVAVIDA_SENHA'), cliente: env('NOVAVIDA_EMPRESA') };
  const ingest = { url: env('INGEST_SOCIOS_URL'), token: env('INGEST_SOCIOS_TOKEN') };
  const cfg = { tetoRodadaMs: 8 * 60_000, tempoPorCnpjMs: 60_000, segredos: [cred.usuario, cred.senha, cred.cliente, ingest.token] };
  const io = {
    pegar: async (max) => ((await chamar({ ...ingest, corpo: { acao: 'pegar', max } })).pedidos || []),
    enviar: (corpo) => chamar({ ...ingest, corpo: { acao: 'resultado', ...corpo } }),
    async abrirSessao() {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
        const nav = await criarNavegador(context);
        await nav.entrar(cred);
        return { nav, fechar: () => browser.close() };
      } catch (e) { await browser.close().catch(() => {}); throw e; }
    },
    agora: () => Date.now(),
    log: (m) => console.log(m),
  };
  const r = await executar(cfg, io);
  process.exit(r.codigo);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('ERRO: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
}
```

Observação: `chamar` (de `src/enviar.js`) já monta a mensagem de erro sem ecoar o corpo; o erro do `main()` final pode
citar `variável de ambiente ausente: X` (nome, não valor).

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test test/socios-main.test.js` → PASS (8 testes). Depois `npm test` → todos PASS.

- [ ] **Step 5: Script no `package.json`**

Em `"scripts"`, acrescentar `"socios": "node src/socios/main.js"` (mantendo `test` e `sincronizar`).

- [ ] **Step 6: Commit (local)**

```bash
git add src/socios/main.js test/socios-main.test.js package.json
git commit -m "feat(socios): rodada do robô (fila, um login, timeout por CNPJ, log só com contagens) (§155)"
```

---

### Task 6: Robô — workflow `socios.yml` e primeira rodada real

**Files:**
- Create: `.github/workflows/socios.yml`

**Interfaces:**
- Consumes: `src/socios/main.js` (Task 5); `socios_disparar_robo()` (Task 1) chama `workflows/socios.yml/dispatches` com `ref: main`.

- [ ] **Step 1: Escrever o workflow**

```yaml
name: Consultar sócios na Nova Vida

# Sem schedule: quem dispara é a RPC socios_pedir (Supabase, pg_net) via API, um disparo por pedido.
# §155 — spec docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md (repo oficial)
on:
  workflow_dispatch:

# Um por vez: dois logins simultâneos do mesmo usuário derrubam um ao outro. Cada rodada esvazia a fila,
# então o disparo que o GitHub descartar (máx. 1 rodando + 1 esperando) não perde pedido.
concurrency:
  group: novavida
  cancel-in-progress: false

jobs:
  socios:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Cache do Chromium do Playwright
        id: cache-pw
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Instalar o Chromium do Playwright
        if: steps.cache-pw.outputs.cache-hit != 'true'
        run: |
          timeout -k 10 120 npx playwright install --with-deps chromium \
            || { echo "::warning::apt falhou ou demorou; instalando só o Chromium"; npx playwright install chromium; }
      - name: Consultar a fila
        env:
          NOVAVIDA_USUARIO: ${{ secrets.NOVAVIDA_USUARIO }}
          NOVAVIDA_SENHA: ${{ secrets.NOVAVIDA_SENHA }}
          NOVAVIDA_EMPRESA: ${{ secrets.NOVAVIDA_EMPRESA }}
          INGEST_SOCIOS_URL: ${{ secrets.INGEST_SOCIOS_URL }}
          INGEST_SOCIOS_TOKEN: ${{ secrets.INGEST_SOCIOS_TOKEN }}
        run: node src/socios/main.js
```

- [ ] **Step 2: Conferir antes do push**

Run: `npm test` → PASS; `git diff origin/main --stat` mostra só `src/socios/*`, `scripts/mapear-novavida.js`,
`test/socios-*.test.js`, `package.json` e `.github/workflows/socios.yml`;
`git grep -nE "[0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}/[0-9]{4}" -- src scripts test .github` → nada.

- [ ] **Step 3: Commit e push (o Rafael roda)**

```bash
git add .github/workflows/socios.yml
git commit -m "feat(socios): workflow socios.yml (disparo pela RPC, um por vez, cache do Chromium) (§155)"
```
Pedir ao Rafael: `! cd ~/.graphify/repos/rafaangelao/apex-robo-procontact && git push -u origin feat/socios`
e depois o merge na `main` do robô (o dispatch usa `ref: main`):
`! cd ~/.graphify/repos/rafaangelao/apex-robo-procontact && git fetch origin && git switch main && git merge --ff-only origin/main && git merge --no-ff feat/socios -m "Merge feat/socios (§155)" && git push origin main`
O `sincronizar.yml` não muda (conferir no diff).

- [ ] **Step 4: Primeira rodada real (com ok do Rafael)**

Com Tasks 1, 2 e 6 no ar e o ok do Rafael: ele escolhe **um** cliente da carteira dele; como ele (logado no painel atual
ainda sem a aba), ou por SQL com `request.jwt.claims` do usuário dele numa transação **com commit**, chamar
`select public.socios_pedir(<carteira_id>);`. Acompanhar com `gh run list --workflow socios.yml --limit 1` e
`gh run watch <id>`. Expected no log: `socios: 1 pedidos · 1 prontos · 0 sem sócios · 0 erros · NN s`. Conferir no banco
**só formato**: `select status, jsonb_array_length(resultado->'socios') from socios_consultas order by id desc limit 1;`
→ `pronto`, N ≥ 1. O Rafael confere o conteúdo na tela na Task 8.

---

### Task 7: Painel — aba "Sócios" na ficha da Renovação

**Files:**
- Modify: `_template.html` (estado `rnEstado` ~linha 3950; `rnAplicarPermissao` ~3959; `rnAbrirFicha`/`rnFecharFicha` ~4301–4315; `rnRenderFicha` ~4318–4380; delegação de cliques ~4403–4416)
- Test: `test_renovacao_socios.js`

**Interfaces:**
- Consumes: `sb.rpc('socios_da_base', {p_carteira_id})`, `sb.rpc('socios_pedir', {p_carteira_id})` e `sb.from('socios_consultas')` (Task 1).
- Produces (globais do painel): `rnSociosCarregar(id)`, `rnSociosHtml()`, `rnSociosPintar()`, `rnSociosPedir()`,
  `rnSociosParar()`; estado `rnEstado.socios = {id, base, pedido, ultimo, aviso}` e `rnEstado.sociosTimer`.

- [ ] **Step 1: Escrever o teste** `test_renovacao_socios.js`

```js
// Testa a §155 — aba Sócios da ficha da Renovação (base da Receita + Nova Vida). DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  rnHoje = () => '2026-11-16'; rnHoraSP = () => '16:00';
  const L = (o) => Object.assign({ razao_social: 'Zz', telefone: '19900000001', linhas_voz: 1, apto: 'APTO', status: 3, na_base: true, consultor_id: 'u-a', prox_retorno: '2026-11-10' }, o);
  currentUser = { id: 'u-a', nome: 'Zza Teste', role: 'consultor', operacao: 'apex', equipe: 'renovacao' };
  rnAplicarPermissao();
  window.__tabelas.renovacao_carteira = [L({ id: 1, razao_social: 'Zz Um', cnpj_digits: '00000000000191' }), L({ id: 2, razao_social: 'Zz Dois', cnpj_digits: '00000000000272', prox_retorno: '2026-11-11' })];
  window.__tabelas.propostas = []; window.__tabelas.renovacao_historico = [];
  window.__tabelas.socios_consultas = [];
  const BASE = { ok: true, receita_mes: '2026-09', socios: [{ nome: 'ZZ SOCIA BASE', cpf: '12345678909', principal: true, obito: false }, { nome: 'ZZ SOCIO FALECIDO', cpf: '98765432100', principal: false, obito: true }] };
  window.__rpcRespostas.socios_da_base = (a) => ({ data: a.p_carteira_id === 1 ? BASE : { ok: true, receita_mes: '2026-09', socios: [] }, error: null });
  const sec = () => document.querySelector('#rnFichaCorpo [data-rn-ficha-sec="socios"]');
  const aba = (k) => document.querySelector('#rnFichaCorpo [data-rn-ficha-aba="' + k + '"]');
  const clicar = (sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await rnCarregar(); await espera(60);
  eq(rnEstado.fichaId, 1, 'ficha aberta no cliente 1');
  eq([...document.querySelectorAll('#rnFichaCorpo [data-rn-ficha-aba]')].map(b => b.dataset.rnFichaAba), ['atendimento', 'dados', 'propostas', 'historico', 'socios'], 'quinta aba Sócios');
  aba('socios').click();
  assert(!sec().hidden && document.querySelector('[data-rn-ficha-sec="atendimento"]').hidden, 'aba Sócios visível');

  // 1. base com sócio: nome, CPF formatado, principal, óbito, fonte e botão Consultar na Nova Vida
  const t1 = sec().textContent;
  assert(/ZZ SOCIA BASE/.test(t1) && /123\\.456\\.789-09/.test(t1), 'mostra nome e CPF da base');
  assert(/principal/i.test(t1) && /consta óbito/i.test(t1), 'etiquetas principal e óbito');
  assert(/Receita Federal, base de 09\\/2026/.test(t1) && /sem telefones/.test(t1), 'fonte da base com o mês');
  assert(/Consultar na Nova Vida/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'botão Consultar na Nova Vida');

  // copiar CPF
  let copiado = null; Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { copiado = t; } } });
  clicar('#rnFichaCorpo [data-rn-socios-copiar="12345678909"]'); await espera(10);
  eq(copiado, '12345678909', 'copia o CPF só com dígitos');

  // 2. pedir: chama a RPC com o id da carteira e entra em andamento
  window.__rpcRespostas.socios_pedir = () => ({ data: { ok: true, id: 50, status: 'pendente' }, error: null });
  window.__tabelas.socios_consultas = [{ id: 50, cnpj_digits: '00000000000191', status: 'pendente', pedido_por: 'u-a', pedido_em: new Date().toISOString(), concluido_em: null, resultado: null, erro: null }];
  clicar('#rnFichaCorpo [data-rn-socios-pedir]'); await espera(20);
  eq(window.__rpcCalls.filter(c => c.nome === 'socios_pedir').map(c => c.args), [{ p_carteira_id: 1 }], 'RPC socios_pedir com o id');
  assert(/Consultando na Nova Vida… 0:0\\d/.test(sec().textContent), 'mostra o relógio');
  assert(/ZZ SOCIA BASE/.test(sec().textContent), 'a base continua visível durante a consulta');
  assert(!sec().querySelector('[data-rn-socios-pedir]'), 'sem botão enquanto consulta (antes de 3 min)');
  assert(rnEstado.sociosTimer, 'agendou a releitura');

  // a releitura repinta só a seção: a observação em digitação não se perde
  aba('atendimento').click();
  document.getElementById('rnFichaForm').elements.observacoes.value = 'Zz digitando';
  window.__tabelas.socios_consultas[0].status = 'consultando';
  await rnSociosReler(); await espera(10);
  eq(document.getElementById('rnFichaForm').elements.observacoes.value, 'Zz digitando', 'releitura não apaga o atendimento');
  aba('socios').click();

  // 3. pendente há mais de 3 min: Tentar de novo
  window.__tabelas.socios_consultas[0].status = 'pendente';
  window.__tabelas.socios_consultas[0].pedido_em = new Date(Date.now() - 4 * 60000).toISOString();
  await rnSociosReler(); await espera(10);
  assert(/Tentar de novo/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'Tentar de novo após 3 min');

  // 4. pronto: cartões da Nova Vida têm prioridade sobre a base; telefones com WhatsApp/Ligar; rodapé com Atualizar
  Object.assign(window.__tabelas.socios_consultas[0], { status: 'pronto', concluido_em: '2026-11-16T18:40:00Z', resultado: { socios: [
    { nome: 'ZZ SOCIA NV', cpf: '12345678909', participacao: 50, telefones_consultados: true, telefones: [
      { tipo: 'celular', numero: '11900000001', operadora: 'CLARO', whatsapp: true }, { tipo: 'fixo', numero: '1130000001', operadora: 'VIVO', whatsapp: false }] },
    { nome: 'ZZ SOCIO SEXTO', cpf: '98765432100', participacao: null, telefones_consultados: false, telefones: [] }] } });
  await rnSociosReler(); await espera(10);
  const t4 = sec().textContent;
  assert(/ZZ SOCIA NV/.test(t4) && !/ZZ SOCIA BASE/.test(t4), 'resultado da Nova Vida substitui a base');
  assert(/50%/.test(t4) && /\\(11\\) 90000-0001/.test(t4) && /\\(11\\) 3000-0001/.test(t4), 'participação e telefones formatados');
  eq(sec().querySelector('a[href^="https://wa.me/"]').getAttribute('href'), 'https://wa.me/5511900000001', 'WhatsApp do celular');
  eq(sec().querySelectorAll('a[href^="https://wa.me/"]').length, 1, 'fixo não tem WhatsApp');
  assert(/Telefones não consultados/.test(t4), 'sexto sócio sem telefones');
  assert(/Consultado em 16\\/11 15:40 por Zza Teste/.test(t4), 'rodapé com data e quem pediu');
  assert(/Atualizar/.test(sec().querySelector('[data-rn-socios-pedir]').textContent), 'botão Atualizar');
  assert(!rnEstado.sociosTimer, 'parou a releitura ao terminar');
  clicar('#rnFichaCorpo [data-rn-ficha-sec="socios"] [data-rn-canal="WhatsApp"]');
  eq(document.getElementById('rnFichaForm').elements.canal.value, 'WhatsApp', 'WhatsApp do sócio marca o canal');

  // 5. erro: mensagem + Tentar de novo, e o resultado anterior continua
  window.__tabelas.socios_consultas.unshift({ id: 51, cnpj_digits: '00000000000191', status: 'erro', pedido_por: 'u-a', pedido_em: new Date().toISOString(), concluido_em: new Date().toISOString(), resultado: null, erro: 'A consulta na Nova Vida falhou.' });
  await rnSociosCarregar(1); await espera(10);
  assert(/A consulta na Nova Vida falhou/.test(sec().textContent) && /Tentar de novo/.test(sec().textContent), 'erro com Tentar de novo');
  assert(/ZZ SOCIA NV/.test(sec().textContent), 'resultado anterior continua no erro');

  // 6. limite
  window.__rpcRespostas.socios_pedir = () => ({ data: { ok: false, motivo: 'limite' }, error: null });
  clicar('#rnFichaCorpo [data-rn-socios-pedir]'); await espera(20);
  assert(/Você já fez 20 consultas hoje/.test(sec().textContent), 'aviso de limite');

  // 7. cliente 2: base sem sócio; resposta atrasada do cliente 1 não pinta a ficha do 2
  window.__tabelas.socios_consultas = [];
  await rnAbrirFicha(2); await espera(30);
  aba('socios').click();
  assert(/A base da Receita não tem os sócios deste CNPJ/.test(sec().textContent), 'sem sócio na base');
  await rnSociosCarregar(1); await espera(10);
  assert(/não tem os sócios/.test(sec().textContent), 'resposta de outro cliente não pinta esta ficha');

  // 8. sem_socios
  window.__tabelas.socios_consultas = [{ id: 60, cnpj_digits: '00000000000272', status: 'sem_socios', pedido_por: 'u-a', pedido_em: '2026-11-16T18:00:00Z', concluido_em: '2026-11-16T18:02:00Z', resultado: null, erro: null }];
  await rnSociosCarregar(2); await espera(10);
  assert(/A Nova Vida não mostra sócios para este CNPJ/.test(sec().textContent), 'sem_socios');

  // fechar a ficha e trocar de usuário param a releitura
  window.__tabelas.socios_consultas[0].status = 'pendente';
  await rnSociosCarregar(2); await espera(10);
  assert(rnEstado.sociosTimer, 'agendou');
  rnFecharFicha();
  assert(!rnEstado.sociosTimer, 'fechar a ficha para a releitura');
  await rnAbrirFicha(2); await espera(30);
  rnAplicarPermissao();
  assert(!rnEstado.sociosTimer && !rnEstado.socios, 'trocar de usuário limpa os sócios');
  fim();
`);
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bash run_tests.sh test_renovacao_socios.js`
Expected: FAIL (`quinta aba Sócios` — a aba ainda não existe).

- [ ] **Step 3: Estado e limpeza**

Em `rnEstado` (linha ~3950) acrescentar `socios: null, sociosTimer: null`. Em `rnAplicarPermissao`, logo antes do
`Object.assign(rnEstado, …)`, chamar `rnSociosParar();` e incluir `socios: null` no `Object.assign`.
Em `rnFecharFicha` (linha ~4315) trocar por:

```js
function rnFecharFicha(){ rnSociosParar(); rnEstado.fichaId = null; rnEstado.ficha = null; rnEstado.socios = null; document.getElementById('rnFicha').classList.remove('aberta'); }
```

Em `rnAbrirFicha`, logo depois de `rnEstado.fichaStatus = null; rnEstado.fichaAba = 'atendimento';` acrescentar
`rnSociosParar(); rnEstado.socios = null; rnSociosCarregar(id);` (sem `await`: corre em paralelo com a leitura de
`dados_claro`/histórico e confere `rnEstado.fichaId` ao voltar).

- [ ] **Step 4: Funções da aba** (inserir logo depois de `rnHistoricoTexto`, ~linha 4300)

```js
// §155 — aba Sócios: base da Receita (mailing.socio, via RPC) + consulta na Nova Vida (fila socios_consultas + robô).
const RN_SOCIOS_MOTIVO = { limite: 'Você já fez 20 consultas hoje. Amanhã libera de novo.', sem_permissao: 'Você não tem acesso a este cliente.' };
const RN_SOCIOS_COLS = 'id,status,pedido_por,pedido_em,concluido_em,resultado,erro';
function rnCpfFmt(c){ return String(c || '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'); }
function rnFoneFmt(n){ const d = onlyDigits(n); return d.length === 11 ? d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3') : d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3'); }
function rnSociosParar(){ if(rnEstado.sociosTimer){ clearTimeout(rnEstado.sociosTimer); rnEstado.sociosTimer = null; } }
function rnSociosEmAndamento(p){ return !!p && (p.status === 'pendente' || p.status === 'consultando'); }
async function rnSociosCarregar(id){
  const r = rnEstado.lista.find(x => x.id === id);
  if(!r) return;
  const [b, p] = await Promise.all([
    ppSeguro(() => sb.rpc('socios_da_base', { p_carteira_id: id })),
    ppSeguro(() => sb.from('socios_consultas').select(RN_SOCIOS_COLS).eq('cnpj_digits', r.cnpj_digits).order('pedido_em', { ascending: false }).limit(10)),
  ]);
  if(rnEstado.fichaId !== id) return;            // trocou de cliente enquanto lia
  const lista = p && !p.error ? (p.data || []) : [];
  rnEstado.socios = {
    id, aviso: '',
    base: b && !b.error && b.data && b.data.ok ? b.data : null,
    pedido: lista[0] || null,
    ultimo: lista.find(x => x.status === 'pronto' || x.status === 'sem_socios') || null,
  };
  rnSociosPintar(); rnSociosAgendar();
}
function rnSociosAgendar(){
  rnSociosParar();
  const s = rnEstado.socios;
  if(s && rnSociosEmAndamento(s.pedido)) rnEstado.sociosTimer = setTimeout(rnSociosReler, 5000);
}
async function rnSociosReler(){
  rnSociosParar();                               // chamada à mão (ou pelo próprio timer): nunca dois timers vivos
  const s = rnEstado.socios;
  if(!s || !s.pedido || rnEstado.fichaId !== s.id) return;
  const id = s.id, pedidoId = s.pedido.id;
  const r = await ppSeguro(() => sb.from('socios_consultas').select(RN_SOCIOS_COLS).eq('id', pedidoId).maybeSingle());
  if(rnEstado.fichaId !== id || !rnEstado.socios || rnEstado.socios.id !== id) return;
  if(r && !r.error && r.data){
    rnEstado.socios.pedido = r.data;
    if(r.data.status === 'pronto' || r.data.status === 'sem_socios') rnEstado.socios.ultimo = r.data;
  }
  rnSociosPintar(); rnSociosAgendar();
}
async function rnSociosPedir(){
  const s = rnEstado.socios;
  if(!s || rnEstado.fichaId !== s.id) return;
  const id = s.id;
  const r = await ppSeguro(() => sb.rpc('socios_pedir', { p_carteira_id: id }));
  if(!rnEstado.socios || rnEstado.socios.id !== id) return;
  const d = r && !r.error ? r.data : null;
  if(!d || !d.ok){
    rnEstado.socios.aviso = (d && RN_SOCIOS_MOTIVO[d.motivo]) || 'Não foi possível pedir a consulta. Tente de novo.';
  } else {
    rnEstado.socios.aviso = '';
    const atual = rnEstado.socios.pedido;
    rnEstado.socios.pedido = atual && atual.id === d.id ? Object.assign({}, atual, { status: d.status })
      : { id: d.id, status: d.status, pedido_por: currentUser && currentUser.id, pedido_em: new Date().toISOString(), concluido_em: null, resultado: null, erro: null };
  }
  rnSociosPintar(); rnSociosAgendar();
}
function rnSocioCartaoHtml(x){
  const tels = !x.telefones_consultados ? '<p class="kbMeta">Telefones não consultados.</p>'
    : !(x.telefones || []).length ? '<p class="kbMeta">Sem telefones na Nova Vida.</p>'
    : '<ul class="rnHist">' + x.telefones.map(t => {
        const d = onlyDigits(t.numero);
        const meta = [t.tipo === 'celular' ? 'celular' : 'fixo', t.operadora, t.whatsapp ? 'WhatsApp' : ''].filter(Boolean).join(' · ');
        return `<li>${escapeHtml(rnFoneFmt(d))} <span class="kbMeta">${escapeHtml(meta)}</span> `
          + (t.tipo === 'celular' ? `<a class="kbBtn kbBtnP" data-rn-canal="WhatsApp" target="_blank" rel="noopener" href="https://wa.me/55${escapeHtml(d)}">WhatsApp</a> ` : '')
          + `<a class="kbBtn kbBtnQ" data-rn-canal="Ligação" href="tel:${escapeHtml(d)}">Ligar</a></li>`;
      }).join('') + '</ul>';
  return `<div class="rnGrupo"><strong>${escapeHtml(x.nome)}</strong>${x.participacao != null ? ` <span class="kbMeta">${escapeHtml(String(x.participacao).replace('.', ','))}%</span>` : ''}
    <div class="kbMeta">CPF ${escapeHtml(rnCpfFmt(x.cpf))} <button type="button" class="kbBtn kbBtnG" data-rn-socios-copiar="${escapeHtml(x.cpf)}">Copiar</button></div>${tels}</div>`;
}
function rnSocioBaseHtml(x){
  const tags = [x.principal ? 'principal' : '', x.obito ? 'consta óbito' : ''].filter(Boolean).join(' · ');
  return `<div class="rnGrupo"><strong>${escapeHtml(x.nome)}</strong>${tags ? ` <span class="kbMeta">${escapeHtml(tags)}</span>` : ''}
    <div class="kbMeta">CPF ${escapeHtml(rnCpfFmt(x.cpf))} <button type="button" class="kbBtn kbBtnG" data-rn-socios-copiar="${escapeHtml(x.cpf)}">Copiar</button></div></div>`;
}
function rnSociosHtml(){
  const s = rnEstado.socios;
  if(!s || s.id !== rnEstado.fichaId) return '<p class="kbMeta">Carregando sócios…</p>';
  const p = s.pedido, u = s.ultimo, andamento = rnSociosEmAndamento(p);
  const botao = (txt) => `<button type="button" class="kbBtn kbBtnP" data-rn-socios-pedir>${escapeHtml(txt)}</button>`;
  const partes = [];
  if(s.aviso) partes.push(`<p class="rnErro" role="alert">${escapeHtml(s.aviso)}</p>`);
  if(andamento){
    const seg = Math.max(0, Math.floor((Date.now() - new Date(p.pedido_em).getTime()) / 1000));
    partes.push(`<p class="kbMeta">Consultando na Nova Vida… ${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}</p>`);
    if(p.status === 'pendente' && seg >= 180) partes.push(botao('Tentar de novo'));
  } else if(p && p.status === 'erro'){
    partes.push(`<p class="rnErro">${escapeHtml(p.erro || 'A consulta na Nova Vida falhou.')}</p>${botao('Tentar de novo')}`);
  }
  if(u){
    const quando = u.concluido_em ? new Date(u.concluido_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
    partes.push(u.status === 'pronto' && u.resultado && Array.isArray(u.resultado.socios)
      ? u.resultado.socios.map(rnSocioCartaoHtml).join('')
      : '<p class="rnVazio">A Nova Vida não mostra sócios para este CNPJ.</p>');
    partes.push(`<p class="kbMeta">Consultado em ${escapeHtml(quando)} por ${escapeHtml(rnNomeConsultor(u.pedido_por))}${andamento || (p && p.status === 'erro') ? '' : ' · ' + botao('Atualizar')}</p>`);
  } else {
    const lista = s.base && Array.isArray(s.base.socios) ? s.base.socios : [];
    const mes = s.base && s.base.receita_mes ? String(s.base.receita_mes).replace(/^(\d{4})-(\d{2})$/, '$2/$1') : '';
    partes.push(lista.length
      ? lista.map(rnSocioBaseHtml).join('') + `<p class="kbMeta">Fonte: Receita Federal, base de ${escapeHtml(mes)} · sem telefones</p>`
      : '<p class="rnVazio">A base da Receita não tem os sócios deste CNPJ.</p>');
    if(!andamento && !(p && p.status === 'erro')) partes.push(`${botao('Consultar na Nova Vida')} <span class="kbMeta">${lista.length ? 'traz os telefones, leva cerca de 2 min' : 'leva cerca de 2 min'}</span>`);
  }
  return partes.join('');
}
function rnSociosPintar(){
  const sec = document.querySelector('#rnFichaCorpo [data-rn-ficha-sec="socios"]');
  if(sec) sec.innerHTML = rnSociosHtml();      // só a seção: não toca no formulário de atendimento
}
```

Observação para o teste do rodapé: `16/11 15:40` vem de `2026-11-16T18:40:00Z` em São Paulo; se o `toLocaleString` do
Node/jsdom formatar como `16/11 15:40` (sem vírgula, depois do `replace`) o teste passa; se vier em outro formato, ajustar
o `replace` (não o teste).

- [ ] **Step 5: Aba e seção no `rnRenderFicha`**

Na lista de abas (linha ~4343) acrescentar `['socios', 'Sócios']` depois de `['historico', 'Histórico']`. No fim do
template, depois da `<section data-rn-ficha-sec="historico"…>…</section>`, acrescentar:

```js
    <section data-rn-ficha-sec="socios"${esconde(aba === 'socios')}>${rnSociosHtml()}</section>
```

- [ ] **Step 6: Cliques** — no listener que trata `[data-rn-gerar]` (linha ~4417), antes do `const g = …`:

```js
  const sp = e.target.closest('[data-rn-socios-pedir]');
  if(sp){ rnSociosPedir(); return; }
  const cp = e.target.closest('[data-rn-socios-copiar]');
  if(cp){ (navigator.clipboard ? navigator.clipboard.writeText(cp.dataset.rnSociosCopiar) : Promise.reject()).then(() => mostrarAviso('CPF copiado.', 'ok'), () => mostrarAviso('Não foi possível copiar.', 'erro')); return; }
```

O `data-rn-canal` dos telefones dos sócios já é tratado pelo listener existente (linha ~4413).

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `bash run_tests.sh test_renovacao_socios.js` → PASS. Depois `bash run_tests.sh test_renovacao_*.js` → todos PASS
(as quatro abas antigas continuam funcionando). Por fim `bash run_tests.sh` (suíte inteira) → `0 falharam`.

- [ ] **Step 8: Conferir HTML e design**

`git diff --stat` mostra só `_template.html` e `test_renovacao_socios.js`; nenhuma linha nova dentro de `<style>`
(`git diff _template.html | grep -n "^+.*{.*:.*}" | grep -v "=>"` não mostra regra CSS); contar `<div`/`</div>` no trecho
novo de `rnSocioCartaoHtml`/`rnSocioBaseHtml` (devem bater — ver memória "HTML: divs balanceadas").

- [ ] **Step 9: Commit (local)**

```bash
git add _template.html test_renovacao_socios.js
git commit -m "feat(renovacao): aba Sócios na ficha — base da Receita + consulta na Nova Vida (§155)"
```

---

### Task 8: Regras, ponta a ponta e publicação

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (fim do arquivo)

- [ ] **Step 1: Seção §155** — `git fetch oficial` e confirmar que a última seção ainda é §154.x (se alguém usou a 155,
renumerar para a próxima livre em tudo: spec, plano, comentários). Acrescentar ao fim do `REGRAS_NEGOCIO.md`:

```markdown
## §155 Consulta de sócios na ficha da Renovação (16/11/2026, pedido do Rafael)

- Aba **Sócios** na ficha da Renovação. Abre com nome e CPF dos sócios da **base da Receita** (`mailing.socio`, via RPC
  `socios_da_base`) quando houver, com "principal" e "consta óbito".
- **Consultar na Nova Vida** (ou **Atualizar**): RPC `socios_pedir` grava o pedido em `socios_consultas` e dispara o
  workflow `socios.yml` do robô (`rafaangelao/apex-robo-procontact`) pelo pg_net com o token do Vault `github_robo_token`.
  O robô entra no Congonhas, lê os sócios (nome, CPF, participação) e os telefones de até **5** sócios (maior
  participação), e devolve pela Edge Function `ingest-socios` (`x-robo-token` = `INGEST_SOCIOS_TOKEN`). ~1–2 min.
- Quem pode: o dono do cliente ou admin/supervisor (mesma regra da `renovacao_carteira`); **20 pedidos por pessoa por
  dia**; pedido repetido do mesmo CNPJ em andamento não conta; `consultando` há mais de 10 min vira erro; "Tentar de novo"
  após 3 min pendente redispara.
- O usuário da Nova Vida é **só do robô** (sessão única: duas pessoas logadas derrubam uma à outra).
- Spec: `docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md`.
```

Commit local: `git add REGRAS_NEGOCIO.md && git commit -m "docs(regras): §155 consulta de sócios na Renovação"`

- [ ] **Step 2: Ponta a ponta local (com ok do Rafael)**

`python build_painel.py`; abrir o `painel_clientes_apex.html` gerado localmente logado como o Rafael (admin), ir à
Renovação, abrir um cliente da Task 6 Step 4 → aba Sócios mostra o resultado "pronto" e o rodapé; abrir outro cliente com
sócio na base → lista da base; clicar **Consultar na Nova Vida** → relógio, e em ~2 min os cartões. O Rafael confere
CPF e telefones com o que o site da Nova Vida mostra para o mesmo CNPJ.

- [ ] **Step 3: Revisão final do branch**

Usar superpowers:requesting-code-review no branch `feat/consulta-socios` (oficial) e `feat/socios` (robô, já na main),
com a spec e este plano. Corrigir o que for confirmado.

- [ ] **Step 4: Publicar (só com ok do Rafael; seguir a memória "Publicação do painel")**

`git fetch oficial` → merge de `oficial/main` no branch (juntar, nunca sobrescrever) → `bash run_tests.sh` → baixar o
painel do ar e comparar com o gerado → publicar pelo procedimento da memória (backup, MD5 do ar no mesmo comando do
envio, vigia) → push do branch e merge na `main` do oficial sem force. Atualizar a memória `apex-consulta-socios`
(no ar, MD5, commit) e o índice `MEMORY.md`.

- [ ] **Step 5: Avisar o time**

Lembrar o Rafael de: (1) mandar o time parar de usar o usuário compartilhado da Nova Vida; (2) apagar o branch de teste
do robô (`! cd ~/.graphify/repos/rafaangelao/apex-robo-procontact && git push origin --delete teste/login-novavida`);
(3) perguntar à Nova Vida sobre API/termos de uso (risco da spec §9).
