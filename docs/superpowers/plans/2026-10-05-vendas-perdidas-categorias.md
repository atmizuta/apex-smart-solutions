# Vendas Perdidas por categoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer a categoria da venda perdida (API de Exportação Xeotech) para o banco de hora em hora e criar a aba "Vendas Perdidas" (admin/supervisor) com motivos, preenchimento por consultor e pedidos.

**Architecture:** Edge Function `sync-exportacao` (lógica pura em `exportacao.ts`, testada com `node --test`) grava `producao_atividades` (1 linha por pedido) e `exportacao_sync_log`; pg_cron no minuto 41. A RPC `vendas_perdidas(p_de, p_ate)` junta `producao_pedidos_neo` (etapa/valor/consultor, verdade) com `producao_atividades` (categoria). A aba é JS puro no `_template.html` (funções `vp*` testáveis no jsdom).

**Tech Stack:** Supabase (Postgres 15, pg_cron, pg_net, Edge Functions Deno), Node 24 (`node --test` com type-stripping), HTML/JS único `_template.html`, jsdom, SheetJS.

**Spec:** `docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md`

## Global Constraints
- Worktree `.worktrees/vendas-perdidas`, branch `feat/vendas-perdidas-categorias`; nunca trocar branch na pasta principal; sem stash; sem push.
- Painel: editar só `_template.html`; `painel_clientes_apex.html` é gerado por `python build_painel.py`.
- Design "Sinal de Ápice": não mexer em `<style>`, `aside.sidebar`/`nav#tabsNav` (além do botão novo no formato existente), `#pageHead`, `ApexMotion`, `mostrarAviso`, `fecharOverlay`; **nenhuma cor em hex**; reaproveitar `.card`, `.kpiGrid`/`.kpiCard`, `table.tbl`, `.mlTabelaWrap`, `.btn*`, `.badge`, `.filterPill`, `.field`, `.ppNivel` (`ok`/`medio`/`maximo`), `.retornoLeadSub`.
- Repositório **público**: testes só com dados fictícios; token `NEO_EXPORT_TOKEN` nunca em arquivo, log, resposta ou mensagem de erro.
- Supabase `apex` é produção: aplicar migration/deploy só o controlador (ok do Rafael dado em 05/10 para a integração); publicar o painel só com ok no momento.
- Horário de São Paulo = UTC−3 fixo.
- Painel da API: `painelId 15455`; endpoint `https://api.xeotech.com.br/api/v1/producao/exportacao/{token}`; corpo `{painelId, dataInicio, dataFim, formato:"json"}`.
- Etapa perdida: `'VENDA PERDIDA (NEOCRM)'`. Rótulo de pedido sem categoria: `'Sem categoria'`.
- Falhas antigas conhecidas de `run_tests.sh` (não são regressão): `test_conversao_vendas.js`, `test_pedidos_alerta.js`.
- REGRAS_NEGOCIO.md: próxima seção **§70**.

## Review Focus
1. **Valor em texto com vírgula** ("6999,00", "1.234,56") vindo da API: somar errado distorce o "valor perdido". Teste em Task 2 (`paraNumero`).
2. **Erro da API (401/403/429) não pode apagar nem sobrescrever dados**: a função grava só o log e sai. Teste em Task 2 (`mensagemErro`) e verificação manual no Task 3.
3. **Token vazando em mensagem de erro** (a URL leva o token): `ocultarToken` em toda mensagem. Teste em Task 2.
4. **Pedido perdido que ainda não veio pela exportação**: aparece na aba como "Sem categoria", não some. Teste em Task 4/5 (linha com `categoria: null`).
5. **"Mês passado" em janeiro e mês de 30/31 dias**: período errado esconde perdas. Teste em Task 4 (`vpPeriodo`).

---

## Parte A — Integração

### Task 1: Migration (tabelas, RLS, RPC) + rollback + verificação SQL

**Files:**
- Create: `supabase/migrations/20261005100000_vendas_perdidas_categorias.sql`
- Create: `supabase/rollback/20261005100000_vendas_perdidas_categorias_rollback.sql`
- Create: `supabase/tests/vendas_perdidas_check.sql`

**Interfaces — Produces:** tabelas `producao_atividades(numero_pedido PK, categoria, subcategoria, tags text[], etapa, usuario, cliente, produtos, valor numeric, itens int, data_cadastro date, atualizado_em_neo timestamptz, sincronizado_em timestamptz)`, `exportacao_sync_log(id, iniciou_em, terminou_em, ok, http, linhas, pedidos, gravados, erro)`; RPC `vendas_perdidas(p_de date, p_ate date) → (numero_pedido, usuario, profile_id, cliente, produtos, valor, perdido_em, categoria, subcategoria, tags, tag_pedido)`.

- [ ] **Step 1: Migration**

```sql
-- 05/10/2026 — Vendas Perdidas por categoria (API de Exportação Xeotech). REGRAS_NEGOCIO.md §70. Aditiva.
-- Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md

-- 1) Categoria da venda perdida por pedido (gravada pela Edge Function sync-exportacao; sem CPF/CNPJ)
create table if not exists public.producao_atividades (
  numero_pedido text primary key,
  categoria text,
  subcategoria text,
  tags text[] not null default '{}',
  etapa text,
  usuario text,
  cliente text,
  produtos text,
  valor numeric not null default 0,
  itens int not null default 0,
  data_cadastro date,
  atualizado_em_neo timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index if not exists producao_atividades_etapa_idx on public.producao_atividades (etapa);
create index if not exists producao_atividades_categoria_idx on public.producao_atividades (categoria);
alter table public.producao_atividades enable row level security;
drop policy if exists producao_atividades_select on public.producao_atividades;
create policy producao_atividades_select on public.producao_atividades
  for select to authenticated using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.producao_atividades from anon, authenticated;

-- 2) Log de execuções da sincronização
create table if not exists public.exportacao_sync_log (
  id bigint generated always as identity primary key,
  iniciou_em timestamptz not null default now(),
  terminou_em timestamptz,
  ok boolean,
  http int,
  linhas int,
  pedidos int,
  gravados int,
  erro text
);
create index if not exists exportacao_sync_log_ok_idx on public.exportacao_sync_log (ok, terminou_em desc);
alter table public.exportacao_sync_log enable row level security;
drop policy if exists exportacao_sync_log_select on public.exportacao_sync_log;
create policy exportacao_sync_log_select on public.exportacao_sync_log
  for select to authenticated using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.exportacao_sync_log from anon, authenticated;

-- 3) Vendas perdidas no período (etapa e valor de producao_pedidos_neo; categoria de producao_atividades)
create or replace function public.vendas_perdidas(p_de date, p_ate date)
returns table (numero_pedido text, usuario text, profile_id uuid, cliente text, produtos text, valor numeric,
               perdido_em timestamptz, categoria text, subcategoria text, tags text[], tag_pedido text)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with p as (
    select n.numero_pedido as np, max(n.usuario) as usu, max(n.usuario_id) as uid, max(n.cliente) as cli,
           string_agg(distinct n.produto, ' + ') as prods, coalesce(sum(n.valor), 0) as val,
           max(coalesce(n.atualizacao, n.cadastro)) as atu,
           string_agg(distinct nullif(btrim(n.tag), ''), ',') as tg
      from public.producao_pedidos_neo n
     where n.etapa = 'VENDA PERDIDA (NEOCRM)' and n.numero_pedido is not null
     group by n.numero_pedido
  ),
  q as (
    select p.*, coalesce((select max(h.em) from public.producao_etapa_historico h
                           where h.numero_pedido = p.np and h.etapa_nova = 'VENDA PERDIDA (NEOCRM)'), p.atu) as perd
      from p
  )
  select q.np, q.usu,
         (select cn.profile_id from public.consultor_neo cn where cn.neo_usuario_id = q.uid),
         coalesce(a.cliente, q.cli), coalesce(q.prods, a.produtos), q.val, q.perd,
         a.categoria, a.subcategoria, a.tags, q.tg
    from q left join public.producao_atividades a on a.numero_pedido = q.np
   where (q.perd at time zone 'America/Sao_Paulo')::date between p_de and p_ate
   order by q.perd desc;
end $$;
revoke all on function public.vendas_perdidas(date, date) from public, anon;
grant execute on function public.vendas_perdidas(date, date) to authenticated;
```

- [ ] **Step 2: Rollback**

```sql
-- Rollback de 20261005100000_vendas_perdidas_categorias.sql. Reverter o painel antes (sem a RPC a aba só mostra
-- "não foi possível carregar"). Apaga as categorias sincronizadas (podem ser trazidas de novo pela sync-exportacao).
drop function if exists public.vendas_perdidas(date, date);
drop table if exists public.exportacao_sync_log;
drop table if exists public.producao_atividades;
```

- [ ] **Step 3: Verificação SQL (sempre ROLLBACK)**

```sql
-- Verificação de 20261005100000_vendas_perdidas_categorias.sql. Rodar SÓ depois da migration; SEMPRE termina em ROLLBACK.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vpsem@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000cc01', 'Zzvpsup Teste', 'zz.vpsup', 'supervisor'),
  ('00000000-0000-0000-0000-00000000cc02', 'Zzvpcons Teste', 'zz.vpcons', 'consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;
-- pedidos fictícios: P1 perdido hoje com categoria; P2 perdido hoje sem atividade; P3 perdido há 400 dias; P4 concluído
insert into public.producao_pedidos_neo (item_id, numero_pedido, usuario, etapa, cadastro, atualizacao, valor, quantidade, produto, cliente)
values (990000001, 'ZZP1', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 100, 1, 'Produto Teste', 'Cliente Teste 1'),
       (990000002, 'ZZP1', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 50, 1, 'Produto Teste 2', 'Cliente Teste 1'),
       (990000003, 'ZZP2', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '3 days', now(), 70, 1, 'Produto Teste', 'Cliente Teste 2'),
       (990000004, 'ZZP3', 'ZZ CONSULTOR', 'VENDA PERDIDA (NEOCRM)', now() - interval '500 days', now() - interval '400 days', 10, 1, 'Produto Teste', 'Cliente Teste 3'),
       (990000005, 'ZZP4', 'ZZ CONSULTOR', 'CONCLUIDO (NEOCRM)', now() - interval '3 days', now(), 99, 1, 'Produto Teste', 'Cliente Teste 4');
insert into public.producao_atividades (numero_pedido, categoria, tags, etapa, usuario, valor, itens)
values ('ZZP1', 'Não responde', '{#SEMINTERESSE}', 'VENDA PERDIDA (NEOCRM)', 'ZZ CONSULTOR', 150, 2);

do $$
declare n int; v numeric; c text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc01', true);
  select count(*) into n from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido like 'ZZP%';
  assert n = 2, 'vendas_perdidas: só P1 e P2 (P3 fora do período, P4 não é perdido), veio ' || n;
  select valor, categoria into v, c from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido = 'ZZP1';
  assert v = 150 and c = 'Não responde', 'P1: valor somado dos itens (150) e categoria da atividade';
  assert (select categoria from public.vendas_perdidas(current_date - 30, current_date) where numero_pedido = 'ZZP2') is null, 'P2 sem atividade: categoria null (não some)';
  assert exists (select 1 from public.producao_atividades where numero_pedido = 'ZZP1'), 'supervisor lê producao_atividades';

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc02', true);
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'consultor chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
  assert not exists (select 1 from public.producao_atividades where numero_pedido = 'ZZP1'), 'consultor não lê producao_atividades (RLS)';

  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc03', true);
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'sem perfil chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.vendas_perdidas(current_date - 30, current_date); assert false, 'anon chamou vendas_perdidas';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
```

- [ ] **Step 4: Revisão estática**
Run: `grep -c "security definer set search_path = public" supabase/migrations/20261005100000_vendas_perdidas_categorias.sql` → `1`; `grep -c "coalesce(public.get_my_role(), '')" …` → `1`; `grep -ci "cpf\|cnpj" supabase/migrations/20261005100000_vendas_perdidas_categorias.sql` → only the comment line (`1`).

- [ ] **Step 5: Commit** (sem aplicar — o controlador aplica)
```bash
git add supabase/migrations/20261005100000_vendas_perdidas_categorias.sql supabase/rollback/20261005100000_vendas_perdidas_categorias_rollback.sql supabase/tests/vendas_perdidas_check.sql
git commit -m "feat(banco): producao_atividades, exportacao_sync_log e RPC vendas_perdidas (seção 70)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Lógica pura da sincronização (`exportacao.ts`) + testes

**Files:**
- Create: `supabase/functions/sync-exportacao/exportacao.ts`
- Create: `supabase/functions/sync-exportacao/exportacao.test.ts`

**Interfaces — Produces:** `paraNumero(v): number`, `paraTimestampSP(v): string|null`, `categoriaDoPedido(itens, campo): string|null`, `agruparPorPedido(linhas): Atividade[]`, `periodoConsulta(agoraMs): {dataInicio, dataFim}`, `mensagemErro(status, corpo, retryAfter): string`, `ocultarToken(msg, token): string`; type `Atividade` with exactly the columns of `producao_atividades` except `sincronizado_em`.

- [ ] **Step 1: Teste (falha)** — `supabase/functions/sync-exportacao/exportacao.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorPedido, categoriaDoPedido, mensagemErro, ocultarToken, paraNumero, paraTimestampSP, periodoConsulta } from "./exportacao.ts";

const L = (extra: Record<string, unknown>) => Object.assign({
  numeroPedido: "P1", nomeEtapa: "VENDA PERDIDA (NEOCRM)", categoriaAtividade: "", subCategoriaAtividade: null,
  tagsAtividade: [], nomeUsuario: "CONSULTOR TESTE", nomeCliente: "Cliente Teste", nomeProduto: "Produto Teste",
  valor: 10, quantidade: 1, dataCadastro: "2026-10-01", dataHoraAtualizacao: "2026-10-02T10:00:00",
}, extra);

test("paraNumero: número, vírgula decimal, milhar com ponto, vazio", () => {
  assert.equal(paraNumero(149.9), 149.9);
  assert.equal(paraNumero("6999,00"), 6999);
  assert.equal(paraNumero("1.234,56"), 1234.56);
  assert.equal(paraNumero("39.99"), 39.99);
  assert.equal(paraNumero(""), 0);
  assert.equal(paraNumero(null), 0);
  assert.equal(paraNumero("abc"), 0);
});

test("paraTimestampSP: yyyy-MM-ddTHH:mm:ss vira ISO -03:00; inválido null", () => {
  assert.equal(paraTimestampSP("2026-10-02T09:30:00"), "2026-10-02T09:30:00-03:00");
  assert.equal(paraTimestampSP("2026-10-02T09:30:00.123"), "2026-10-02T09:30:00-03:00");
  assert.equal(paraTimestampSP(""), null);
  assert.equal(paraTimestampSP("02/10/2026"), null);
});

test("categoriaDoPedido: mais frequente; empate pelo item mais recente; vazio null", () => {
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "A" }), L({ categoriaAtividade: "B" }), L({ categoriaAtividade: "B" })], "categoriaAtividade"), "B");
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "A", dataHoraAtualizacao: "2026-10-01T10:00:00" }), L({ categoriaAtividade: "B", dataHoraAtualizacao: "2026-10-03T10:00:00" })], "categoriaAtividade"), "B");
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "" }), L({ categoriaAtividade: null })], "categoriaAtividade"), null);
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "  Não responde " })], "categoriaAtividade"), "Não responde");
});

test("agruparPorPedido: 1 por pedido, soma valor, conta itens, une produtos e tags, datas", () => {
  const out = agruparPorPedido([
    L({ valor: "6999,00", nomeProduto: "Aparelho Teste", tagsAtividade: ["#HOTLEAD"], categoriaAtividade: "Não responde", dataCadastro: "2026-09-30" }),
    L({ valor: 39.99, tagsAtividade: ["#SEMINTERESSE", "#HOTLEAD"], dataHoraAtualizacao: "2026-10-04T08:00:00", nomeEtapa: "VENDA PERDIDA (NEOCRM)" }),
    L({ numeroPedido: "P2", valor: 5, categoriaAtividade: "" }),
    L({ numeroPedido: "", valor: 1 }),
  ]);
  assert.equal(out.length, 2);
  const p1 = out.find((x) => x.numero_pedido === "P1")!;
  assert.equal(p1.valor, 7038.99);
  assert.equal(p1.itens, 2);
  assert.equal(p1.categoria, "Não responde");
  assert.equal(p1.subcategoria, null);
  assert.deepEqual(p1.tags, ["#HOTLEAD", "#SEMINTERESSE"]);
  assert.equal(p1.produtos, "Aparelho Teste + Produto Teste");
  assert.equal(p1.data_cadastro, "2026-09-30");
  assert.equal(p1.atualizado_em_neo, "2026-10-04T08:00:00-03:00");
  assert.equal(out.find((x) => x.numero_pedido === "P2")!.categoria, null);
});

test("periodoConsulta: hoje−90 → hoje em São Paulo", () => {
  assert.deepEqual(periodoConsulta(Date.parse("2026-10-05T02:00:00Z")), { dataInicio: "2026-07-06", dataFim: "2026-10-04" });
  assert.deepEqual(periodoConsulta(Date.parse("2026-10-05T15:00:00Z")), { dataInicio: "2026-07-07", dataFim: "2026-10-05" });
});

test("mensagemErro: JSON da API, texto puro, 429 com Retry-After", () => {
  assert.equal(mensagemErro(401, '{"codigo":"TOKEN_INVALIDO","mensagem":"Token inválido","requestId":"r1"}', null), "HTTP 401 TOKEN_INVALIDO: Token inválido");
  assert.equal(mensagemErro(502, "<html>Bad Gateway</html>", null), "HTTP 502 — <html>Bad Gateway</html>");
  assert.equal(mensagemErro(429, '{"codigo":"LIMITE_API","mensagem":"Aguarde"}', "120"), "HTTP 429 LIMITE_API: Aguarde (Retry-After 120s)");
  assert.equal(mensagemErro(500, "", null), "HTTP 500");
});

test("ocultarToken: remove o token de qualquer mensagem", () => {
  assert.equal(ocultarToken("falhou https://api/x/abc123secret/y", "abc123secret"), "falhou https://api/x/***/y");
  assert.equal(ocultarToken("sem token aqui", "abc123secret"), "sem token aqui");
  assert.equal(ocultarToken("qualquer", ""), "qualquer");
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test supabase/functions/sync-exportacao/exportacao.test.ts` → falha de import (`Cannot find module './exportacao.ts'`).

- [ ] **Step 3: Implementar** — `supabase/functions/sync-exportacao/exportacao.ts`:

```ts
// Lógica pura da sync-exportacao (API do Relatório de Exportação Xeotech, painel 15455) — REGRAS_NEGOCIO.md §70.
// Sem Deno/rede/Supabase: testável com `node --test`. A API devolve 1 linha por ITEM; aqui vira 1 por PEDIDO.
export type LinhaExport = Record<string, unknown>;
export type Atividade = {
  numero_pedido: string; categoria: string | null; subcategoria: string | null; tags: string[]; etapa: string | null;
  usuario: string | null; cliente: string | null; produtos: string | null; valor: number; itens: number;
  data_cadastro: string | null; atualizado_em_neo: string | null;
};

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// Valor vem número ou texto ("6999,00", "1.234,56"); vazio/inválido = 0. Duas casas.
export function paraNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && /\d/.test(normal) ? Math.round(n * 100) / 100 : 0;
}

// "2026-10-02T09:30:00[.fff]" (horário de SP) → "2026-10-02T09:30:00-03:00"; outro formato → null.
export function paraTimestampSP(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}-03:00` : null;
}

// Categoria do pedido: a não vazia mais frequente entre os itens; empate → a do item atualizado mais recentemente.
export function categoriaDoPedido(itens: LinhaExport[], campo: string): string | null {
  const cont = new Map<string, { n: number; ult: string }>();
  for (const r of itens) {
    const c = texto(r[campo]);
    if (!c) continue;
    const u = String(r.dataHoraAtualizacao ?? "");
    const x = cont.get(c) ?? { n: 0, ult: "" };
    x.n += 1;
    if (u > x.ult) x.ult = u;
    cont.set(c, x);
  }
  let melhor: string | null = null;
  let mn = 0;
  let mu = "";
  for (const [c, x] of cont) {
    if (x.n > mn || (x.n === mn && x.ult > mu)) { melhor = c; mn = x.n; mu = x.ult; }
  }
  return melhor;
}

export function agruparPorPedido(linhas: LinhaExport[]): Atividade[] {
  const por = new Map<string, LinhaExport[]>();
  for (const r of linhas) {
    const p = texto(r.numeroPedido);
    if (!p) continue;
    const lista = por.get(p) ?? [];
    lista.push(r);
    por.set(p, lista);
  }
  const saida: Atividade[] = [];
  for (const [pedido, itens] of por) {
    const recente = itens.reduce((a, b) => (String(b.dataHoraAtualizacao ?? "") > String(a.dataHoraAtualizacao ?? "") ? b : a));
    const tags = new Set<string>();
    for (const r of itens) {
      if (Array.isArray(r.tagsAtividade)) for (const t of r.tagsAtividade as unknown[]) { const s = texto(t); if (s) tags.add(s); }
    }
    const produtos = Array.from(new Set(itens.map((r) => texto(r.nomeProduto)).filter((x): x is string => x !== null))).sort();
    const cadastros = itens.map((r) => texto(r.dataCadastro)).filter((x): x is string => x !== null && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    saida.push({
      numero_pedido: pedido,
      categoria: categoriaDoPedido(itens, "categoriaAtividade"),
      subcategoria: categoriaDoPedido(itens, "subCategoriaAtividade"),
      tags: Array.from(tags).sort(),
      etapa: texto(recente.nomeEtapa),
      usuario: texto(recente.nomeUsuario),
      cliente: texto(recente.nomeCliente),
      produtos: produtos.length ? produtos.join(" + ") : null,
      valor: Math.round(itens.reduce((s, r) => s + paraNumero(r.valor), 0) * 100) / 100,
      itens: itens.length,
      data_cadastro: cadastros[0] ?? null,
      atualizado_em_neo: paraTimestampSP(recente.dataHoraAtualizacao),
    });
  }
  return saida;
}

// Período da consulta: hoje−90 dias até hoje, em São Paulo (a API hoje ignora o período e devolve o painel todo; isto
// cobre o caso de ela passar a filtrar).
export function periodoConsulta(agoraMs: number): { dataInicio: string; dataFim: string } {
  const fim = new Date(agoraMs - 3 * 3600000);
  const ini = new Date(fim.getTime() - 90 * 86400000);
  return { dataInicio: ini.toISOString().slice(0, 10), dataFim: fim.toISOString().slice(0, 10) };
}

// Mensagem curta para o log: "HTTP 401 TOKEN_INVALIDO: Token inválido" / "HTTP 502 — <corpo>" / "+ (Retry-After Ns)".
export function mensagemErro(status: number, corpo: string, retryAfter: string | null): string {
  let msg = `HTTP ${status}`;
  let jsonOk = false;
  try {
    const j = JSON.parse(corpo);
    if (j && (j.codigo || j.mensagem)) {
      msg += ` ${j.codigo ?? ""}: ${j.mensagem ?? ""}`.replace(/\s+:/, ":").trimEnd();
      jsonOk = true;
    }
  } catch { /* corpo não é JSON */ }
  if (!jsonOk) {
    const t = String(corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (t) msg += ` — ${t}`;
  }
  if (retryAfter) msg += ` (Retry-After ${retryAfter}s)`;
  return msg.slice(0, 500);
}

// O token vai na URL da API: nenhuma mensagem que sai da função pode contê-lo.
export function ocultarToken(msg: string, token: string): string {
  return token ? String(msg).split(token).join("***") : String(msg);
}
```

- [ ] **Step 4: Rodar e ver passar** — `node --test supabase/functions/sync-exportacao/exportacao.test.ts` → `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit**
```bash
git add supabase/functions/sync-exportacao/exportacao.ts supabase/functions/sync-exportacao/exportacao.test.ts
git commit -m "feat(sync-exportacao): agrupamento por pedido, conversões e mensagens de erro sem token (seção 70)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: `index.ts` da Edge Function + migration do cron

**Files:**
- Create: `supabase/functions/sync-exportacao/index.ts`
- Create: `supabase/migrations/20261005100100_sync_exportacao_cron.sql`
- Create: `supabase/rollback/20261005100100_sync_exportacao_cron_rollback.sql`

**Interfaces — Consumes:** Task 2 exports; tables from Task 1; secrets `SYNC_CRON_SECRET`, `NEO_EXPORT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 1: `index.ts`**

```ts
// Edge Function: sync-exportacao — categoria da venda perdida (API do Relatório de Exportação Xeotech) em
// producao_atividades, 1 linha por pedido. Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md
// Chamada só pelo pg_cron (header x-cron-secret); sem JWT. Token da API: secret NEO_EXPORT_TOKEN (nunca em log/resposta).
// Corpo opcional {"modo":"teste"}: faz tudo menos gravar e devolve só contagens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { agruparPorPedido, mensagemErro, ocultarToken, periodoConsulta } from "./exportacao.ts";

const API = "https://api.xeotech.com.br/api/v1/producao/exportacao/";
const PAINEL_ID = 15455;
const LOTE = 500;

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

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!cronSecret || !iguais(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Não autorizado." }, 401);
  let corpo: { modo?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const teste = corpo.modo === "teste";
  const token = Deno.env.get("NEO_EXPORT_TOKEN") ?? "";
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  let logId: number | null = null;
  if (!teste) {
    const { data } = await admin.from("exportacao_sync_log").insert({}).select("id").single();
    logId = (data as { id: number } | null)?.id ?? null;
  }
  const fechar = async (campos: Record<string, unknown>) => {
    if (logId !== null) await admin.from("exportacao_sync_log").update({ ...campos, terminou_em: new Date().toISOString() }).eq("id", logId);
  };

  try {
    if (!token) throw new Error("Secret NEO_EXPORT_TOKEN ausente.");
    const periodo = periodoConsulta(Date.now());
    const resp = await fetch(API + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ painelId: PAINEL_ID, ...periodo, formato: "json" }),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = ocultarToken(mensagemErro(resp.status, texto, resp.headers.get("Retry-After")), token);
      await fechar({ ok: false, http: resp.status, erro });
      return json({ ok: false, erro }, 502);
    }
    const j = JSON.parse(texto) as { dados?: Record<string, unknown>[] };
    const linhas = Array.isArray(j.dados) ? j.dados : [];
    const pedidos = agruparPorPedido(linhas);
    if (teste) return json({ ok: true, teste: true, linhas: linhas.length, pedidos: pedidos.length, comCategoria: pedidos.filter((p) => p.categoria).length }, 200);
    let gravados = 0;
    const agora = new Date().toISOString();
    for (let i = 0; i < pedidos.length; i += LOTE) {
      const lote = pedidos.slice(i, i + LOTE).map((p) => ({ ...p, sincronizado_em: agora }));
      const { error } = await admin.from("producao_atividades").upsert(lote, { onConflict: "numero_pedido" });
      if (error) throw new Error("Erro ao gravar producao_atividades: " + error.message);
      gravados += lote.length;
    }
    await fechar({ ok: true, http: resp.status, linhas: linhas.length, pedidos: pedidos.length, gravados });
    return json({ ok: true, linhas: linhas.length, pedidos: pedidos.length, gravados }, 200);
  } catch (e) {
    const erro = ocultarToken(String((e as Error)?.message ?? e), token).slice(0, 500);
    await fechar({ ok: false, erro });
    return json({ ok: false, erro }, 500);
  }
});
```

- [ ] **Step 2: Cron migration**

```sql
-- 05/10/2026 — sync-exportacao (categoria da venda perdida) de hora em hora, no minuto 41. REGRAS_NEGOCIO.md §70.
-- Minuto 41: longe do 59 (produção), do 17 (robô) e dos múltiplos de 15 (alerta). Segredo no Vault, como as outras.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-exportacao-horario';

select cron.schedule('sync-exportacao-horario', '41 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-exportacao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$job$);
```

Rollback:
```sql
-- Rollback de 20261005100100_sync_exportacao_cron.sql.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-exportacao-horario';
```

- [ ] **Step 3: Checagem local** — `node --test supabase/functions/sync-exportacao/exportacao.test.ts` (continua 7/7) e `grep -n "console.log\|token" supabase/functions/sync-exportacao/index.ts` (o token só aparece em `Deno.env.get`, `encodeURIComponent(token)` e `ocultarToken(..., token)`).

- [ ] **Step 4: Commit** (o controlador faz deploy e aplica o cron)
```bash
git add supabase/functions/sync-exportacao/index.ts supabase/migrations/20261005100100_sync_exportacao_cron.sql supabase/rollback/20261005100100_sync_exportacao_cron_rollback.sql
git commit -m "feat(sync-exportacao): Edge Function (log, upsert por pedido, modo teste) e cron no minuto 41 (seção 70)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5 (controlador):** aplicar migration do Task 1 → rodar `supabase/tests/vendas_perdidas_check.sql` → deploy `sync-exportacao` (files `index.ts` + `exportacao.ts`, `verify_jwt=false`) → chamada `{"modo":"teste"}` (espera ≈613 pedidos) → ≥2 min depois chamada real → conferir `exportacao_sync_log` ok e `select count(*) from producao_atividades` ≈ pedidos → aplicar migration do cron.

---

## Parte B — Aba "Vendas Perdidas"

### Task 4: Funções puras da aba (`vp*`) + testes

**Files:**
- Modify: `_template.html` — bloco novo no **fim do último `<script>`** (antes do `</script>` que precede `</body>`).
- Create: `test_vendas_perdidas.js`

**Interfaces — Consumes:** `somaDiasStr`, `plNormStatus` (existentes). **Produces:** `VP_SEM_CATEGORIA`, `canSeeVendasPerdidas()`, `vpPeriodo(tipo, hoje, de, ate) → {de, ate}`, `vpCategoria(linha)`, `vpFiltrar(linhas, fConsultor, fCategoria)`, `vpMotivos(linhas) → [{motivo, pedidos, valor, pct}]`, `vpKpis(linhas) → {total, valor, pctComCategoria, maiorMotivo, maiorMotivoPct}`, `vpConsultores(linhas) → [{usuario, perdas, comCategoria, pct, maiorMotivo}]`, `vpNivelPreenchimento(pct) → 'ok'|'medio'|'maximo'`, `vpSyncAtrasada(sync, agoraMs) → bool`.

- [ ] **Step 1: Teste (falha)** — crie `test_vendas_perdidas.js` com o mesmo cabeçalho de `test_mesa_supervisor.js` (tudo até a linha `const testScript = \`` inclusive; troque só os 2 comentários iniciais por `// Testa a aba Vendas Perdidas (05/10/2026) — REGRAS_NEGOCIO.md §70.` e `// Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md`) e o corpo:

```js
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const V = (np, extra) => Object.assign({ numero_pedido: np, usuario: 'CONSULTOR A', profile_id: 'p-a', cliente: 'Cliente Teste', produtos: 'Produto Teste', valor: 100, perdido_em: '2026-10-03T15:00:00Z', categoria: 'Não responde', subcategoria: null, tags: [], tag_pedido: null }, extra || {});

  // ==== TASK 4: funções puras ====
  eq(vpPeriodo('mes', '2026-10-05'), { de: '2026-10-01', ate: '2026-10-05' }, 'este mês');
  eq(vpPeriodo('mespassado', '2026-10-05'), { de: '2026-09-01', ate: '2026-09-30' }, 'mês passado (30 dias)');
  eq(vpPeriodo('mespassado', '2026-01-15'), { de: '2025-12-01', ate: '2025-12-31' }, 'mês passado em janeiro');
  eq(vpPeriodo('mespassado', '2026-03-10'), { de: '2026-02-01', ate: '2026-02-28' }, 'mês passado fevereiro');
  eq(vpPeriodo('90d', '2026-10-05'), { de: '2026-07-08', ate: '2026-10-05' }, 'últimos 90 dias (contando hoje)');
  eq(vpPeriodo('custom', '2026-10-05', '2026-09-10', '2026-09-20'), { de: '2026-09-10', ate: '2026-09-20' }, 'personalizado');
  eq(vpPeriodo('custom', '2026-10-05', '', ''), { de: '2026-10-05', ate: '2026-10-05' }, 'personalizado vazio = hoje');

  eq(vpCategoria(V('1', { categoria: null })), 'Sem categoria', 'categoria null');
  eq(vpCategoria(V('1', { categoria: '  ' })), 'Sem categoria', 'categoria em branco');
  eq(vpCategoria(V('1')), 'Não responde', 'categoria preenchida');

  const linhas = [
    V('1'), V('2', { valor: 50 }), V('3', { categoria: 'Restrição de Crédito', valor: 300 }),
    V('4', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b' }), V('5', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b', valor: '20' }),
    V('6', { categoria: 'Desconfiança', usuario: 'CONSULTOR B', profile_id: 'p-b' }),
  ];
  const mot = vpMotivos(linhas);
  eq(mot.map(m => m.motivo), ['Não responde', 'Desconfiança', 'Restrição de Crédito', 'Sem categoria'], 'motivos: mais pedidos primeiro, empate alfabético, Sem categoria por último');
  eq([mot[0].pedidos, mot[0].valor], [2, 150], 'Não responde: 2 pedidos, R$ 150');
  eq(mot[3].valor, 120, 'valor em texto somado');
  assert(Math.abs(mot.reduce((s, m) => s + m.pct, 0) - 1) < 1e-9, 'percentuais somam 100%');

  const k = vpKpis(linhas);
  eq([k.total, k.valor], [6, 670], 'KPIs: 6 pedidos, R$ 670');
  eq(k.pctComCategoria, 4 / 6, '% com categoria');
  eq([k.maiorMotivo, k.maiorMotivoPct], ['Não responde', 2 / 4], 'maior motivo entre os com categoria');
  eq(vpKpis([]), { total: 0, valor: 0, pctComCategoria: null, maiorMotivo: null, maiorMotivoPct: null }, 'KPIs vazios');

  const cons = vpConsultores(linhas);
  eq(cons.map(c => [c.usuario, c.perdas, c.comCategoria]), [['CONSULTOR B', 3, 1], ['CONSULTOR A', 3, 3]], 'preenchimento: pior primeiro');
  eq(cons[0].maiorMotivo, 'Desconfiança', 'maior motivo do consultor');
  eq([vpNivelPreenchimento(0.9), vpNivelPreenchimento(0.89), vpNivelPreenchimento(0.5), vpNivelPreenchimento(0.49)], ['ok', 'medio', 'medio', 'maximo'], 'selos de preenchimento');

  eq(vpFiltrar(linhas, 'CONSULTOR B', '').length, 3, 'filtro consultor');
  eq(vpFiltrar(linhas, '', 'Sem categoria').map(l => l.numero_pedido), ['4', '5'], 'filtro Sem categoria');
  eq(vpFiltrar(linhas, 'CONSULTOR B', 'Desconfiança').map(l => l.numero_pedido), ['6'], 'filtros combinados');

  const agoraT = Date.parse('2026-10-05T15:00:00Z');
  assert(vpSyncAtrasada(null, agoraT), 'nunca sincronizou = atrasada');
  assert(!vpSyncAtrasada({ ok_em: '2026-10-05T13:00:00Z' }, agoraT), '2 h atrás = em dia');
  assert(vpSyncAtrasada({ ok_em: '2026-10-05T11:30:00Z' }, agoraT), '3h30 atrás = atrasada');

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

- [ ] **Step 2: Rodar e ver falhar** — `node test_vendas_perdidas.js` → `ReferenceError: vpPeriodo is not defined`.

- [ ] **Step 3: Implementar** (fim do último `<script>`):

```js
/* ============ VENDAS PERDIDAS POR CATEGORIA — 05/10/2026, REGRAS_NEGOCIO.md §70 ============
   Categoria que o consultor escolhe no NEO ao perder a venda (API de Exportação Xeotech → producao_atividades),
   juntada às vendas perdidas de producao_pedidos_neo pela RPC vendas_perdidas. Só admin/supervisor. */
const VP_SEM_CATEGORIA = 'Sem categoria';
function canSeeVendasPerdidas(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function vpPeriodo(tipo, hoje, de, ate){
  const [y, m] = hoje.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  if(tipo === 'mespassado'){
    const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1;
    const ultimo = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return { de: `${yy}-${pad(mm)}-01`, ate: `${yy}-${pad(mm)}-${pad(ultimo)}` };
  }
  if(tipo === '90d') return { de: somaDiasStr(hoje, -89), ate: hoje };
  if(tipo === 'custom') return { de: de || hoje, ate: ate || hoje };
  return { de: `${y}-${pad(m)}-01`, ate: hoje };
}
function vpCategoria(l){ const c = String((l && l.categoria) || '').trim(); return c || VP_SEM_CATEGORIA; }
function vpFiltrar(linhas, fConsultor, fCategoria){
  return (linhas || []).filter(l => (!fConsultor || (l.usuario || '') === fConsultor) && (!fCategoria || vpCategoria(l) === fCategoria));
}
function vpMotivos(linhas){
  const m = new Map();
  (linhas || []).forEach(l => {
    const k = vpCategoria(l);
    const x = m.get(k) || { motivo: k, pedidos: 0, valor: 0 };
    x.pedidos++; x.valor += Number(l.valor) || 0;
    m.set(k, x);
  });
  const total = (linhas || []).length;
  return [...m.values()].map(x => Object.assign(x, { valor: Math.round(x.valor * 100) / 100, pct: total ? x.pedidos / total : 0 }))
    .sort((a, b) => (Number(a.motivo === VP_SEM_CATEGORIA) - Number(b.motivo === VP_SEM_CATEGORIA)) || (b.pedidos - a.pedidos) || a.motivo.localeCompare(b.motivo, 'pt-BR'));
}
function vpKpis(linhas){
  const ls = linhas || [];
  const total = ls.length, valor = Math.round(ls.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
  const com = ls.filter(l => vpCategoria(l) !== VP_SEM_CATEGORIA);
  const top = vpMotivos(com)[0] || null;
  return { total, valor, pctComCategoria: total ? com.length / total : null, maiorMotivo: top ? top.motivo : null, maiorMotivoPct: top ? top.pedidos / com.length : null };
}
function vpConsultores(linhas){
  const m = new Map();
  (linhas || []).forEach(l => {
    const k = l.usuario || '(sem consultor)';
    const x = m.get(k) || { usuario: k, perdas: 0, comCategoria: 0, itens: [] };
    x.perdas++; if(vpCategoria(l) !== VP_SEM_CATEGORIA) x.comCategoria++;
    x.itens.push(l); m.set(k, x);
  });
  return [...m.values()].map(x => {
    const top = vpMotivos(x.itens.filter(l => vpCategoria(l) !== VP_SEM_CATEGORIA))[0];
    return { usuario: x.usuario, perdas: x.perdas, comCategoria: x.comCategoria, pct: x.comCategoria / x.perdas, maiorMotivo: top ? top.motivo : null };
  }).sort((a, b) => (a.pct - b.pct) || (b.perdas - a.perdas) || a.usuario.localeCompare(b.usuario, 'pt-BR'));
}
function vpNivelPreenchimento(pct){ return pct >= 0.9 ? 'ok' : (pct >= 0.5 ? 'medio' : 'maximo'); }
function vpSyncAtrasada(sync, agoraMs){
  if(!sync || !sync.ok_em) return true;
  const t = new Date(sync.ok_em).getTime();
  return isNaN(t) || agoraMs - t > 3 * 3600000;
}
```

- [ ] **Step 4: Rodar e ver passar** — `node test_vendas_perdidas.js` → `0 falharam`.

- [ ] **Step 5: Commit**
```bash
git add _template.html test_vendas_perdidas.js painel_clientes_apex.html
git commit -m "feat(painel): regras da aba Vendas Perdidas (período, motivos, KPIs, preenchimento) (seção 70)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(inclua `painel_clientes_apex.html` só se `python build_painel.py` o alterar.)

### Task 5: Aba — botão, painel, carga, tabelas, filtros, Excel, permissões

**Files:**
- Modify: `_template.html` (botão logo depois de `data-tab="funil"`; `<section id="panel-vendasperdidas">` logo antes de `<section class="panel" id="panel-funil">`; `enterApp()`; listener de `#tabsNav`; JS depois das funções do Task 4)
- Modify: `test_vendas_perdidas.js`, `test_reorganizacao_abas.js`

**Interfaces — Consumes:** Task 4; `ppSeguro`, `fetchAllRows`, `vlPartesSP`, `ppFmtDia`, `mesaKpiHtml`, `fmtBRL`, `fmtPctConversao`, `escapeHtml`, `mlBaixarXlsx`. **Produces:** `vpEstado`, `vpAgora()`, `loadVendasPerdidas()`, `vpRender()`, `vpResetar()`, `vpAplicarPermissao()`.

- [ ] **Step 1: Teste (falha)** — troque `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 5: aba ====
  const nowReal = Date.now;
  Date.now = () => Date.parse('2026-10-05T15:00:00Z');
  window.__rpcRespostas.vendas_perdidas = { data: linhas, error: null };
  window.__tabelas.exportacao_sync_log = [{ ok: true, terminou_em: '2026-10-05T14:41:30Z' }];
  window.__xlsx = [];
  window.XLSX.writeFile = (wb, nome) => window.__xlsx.push({ wb, nome });

  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  vpAplicarPermissao();
  assert(document.getElementById('tabBtnVendasPerdidas').style.display === 'none', 'consultor não vê o botão');
  window.__rpcCalls.length = 0;
  await loadVendasPerdidas();
  assert(!window.__rpcCalls.some(c => c.nome === 'vendas_perdidas'), 'consultor não chama a RPC');

  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  vpAplicarPermissao();
  assert(document.getElementById('tabBtnVendasPerdidas').style.display !== 'none', 'supervisor vê o botão');
  document.querySelector('#tabsNav button[data-tab="vendasperdidas"]').click();
  await espera(60);
  assert(document.getElementById('panel-vendasperdidas').classList.contains('active'), 'clique abre a aba');
  eq((window.__rpcCalls.filter(c => c.nome === 'vendas_perdidas').pop() || {}).args, { p_de: '2026-10-01', p_ate: '2026-10-05' }, 'período padrão: este mês (SP)');
  const kt = document.getElementById('vpKpis').textContent;
  assert(kt.includes('6') && kt.includes('R$') && kt.includes('66,7%') && kt.includes('Não responde'), 'KPIs na tela: ' + kt);
  eq([...document.querySelectorAll('#vpMotivosTbody tr[data-vp-motivo]')].map(t => t.dataset.vpMotivo), ['Não responde', 'Desconfiança', 'Restrição de Crédito', 'Sem categoria'], 'tabela de motivos na ordem');
  eq([...document.querySelectorAll('#vpConsultoresTbody tr[data-vp-consultor]')].map(t => t.dataset.vpConsultor), ['CONSULTOR B', 'CONSULTOR A'], 'preenchimento: pior primeiro');
  assert(document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR B"] .ppNivel.maximo'), 'selo vermelho para 33%');
  assert(document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR A"] .ppNivel.ok'), 'selo verde para 100%');
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, '6 pedidos na lista');
  assert(document.getElementById('vpAvisoSync').style.display === 'none', 'sync em dia: sem aviso');
  assert(!/NaN|undefined/.test(document.getElementById('panel-vendasperdidas').textContent), 'nada de NaN/undefined');

  // clique no motivo filtra a lista; clicar de novo limpa
  document.querySelector('#vpMotivosTbody tr[data-vp-motivo="Sem categoria"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 2, 'filtro por motivo (Sem categoria)');
  assert(document.getElementById('vpFiltroCategoria').value === 'Sem categoria', 'select acompanha o clique');
  document.querySelector('#vpMotivosTbody tr[data-vp-motivo="Sem categoria"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, 'clicar de novo limpa');
  // clique no consultor filtra
  document.querySelector('#vpConsultoresTbody tr[data-vp-consultor="CONSULTOR B"]').click();
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 3, 'filtro por consultor');
  assert(document.getElementById('vpKpis').textContent.includes('3'), 'KPIs acompanham o filtro');
  document.getElementById('vpFiltroConsultor').value = '';
  document.getElementById('vpFiltroConsultor').dispatchEvent(new window.Event('change'));
  await espera(20);
  eq(document.querySelectorAll('#vpPedidosTbody tr').length, 6, 'select limpa o filtro');

  // período mês passado recarrega com as datas certas
  document.querySelector('#vpPeriodoPills [data-vp-periodo="mespassado"]').click();
  await espera(40);
  eq(window.__rpcCalls.filter(c => c.nome === 'vendas_perdidas').pop().args, { p_de: '2026-09-01', p_ate: '2026-09-30' }, 'mês passado');
  document.querySelector('#vpPeriodoPills [data-vp-periodo="mes"]').click();
  await espera(40);

  // Excel
  document.getElementById('btnVpExportar').click();
  await espera(20);
  const x = window.__xlsx.pop();
  assert(x && x.nome === 'VendasPerdidas_2026-10-01_2026-10-05.xlsx', 'nome do Excel');
  eq(x.wb.SheetNames, ['Motivos', 'Preenchimento', 'Pedidos'], 'abas do Excel');

  // aviso de sync atrasada e erro de carga
  window.__tabelas.exportacao_sync_log = [{ ok: true, terminou_em: '2026-10-05T10:00:00Z' }];
  await loadVendasPerdidas();
  assert(document.getElementById('vpAvisoSync').style.display !== 'none' && document.getElementById('vpAvisoSync').textContent.includes('05/10'), 'aviso de sync atrasada com a data');
  window.__tabelas.exportacao_sync_log = [];
  await loadVendasPerdidas();
  assert(document.getElementById('vpAvisoSync').textContent.includes('ainda não sincronizaram'), 'aviso de nunca sincronizou');
  window.__rpcRespostas.vendas_perdidas = { data: null, error: { message: 'x' } };
  await loadVendasPerdidas();
  assert(document.getElementById('vpMotivosTbody').textContent.includes('Não foi possível carregar'), 'erro de carga');
  window.__rpcRespostas.vendas_perdidas = { data: linhas, error: null };

  // troca para consultor limpa
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  vpAplicarPermissao();
  assert(document.getElementById('vpPedidosTbody').innerHTML === '' && document.getElementById('vpKpis').innerHTML === '', 'troca para consultor limpa a aba');
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar** — `node test_vendas_perdidas.js` → `ReferenceError: vpAplicarPermissao is not defined`.

- [ ] **Step 3: Implementar**

**Botão** (logo depois do botão `data-tab="funil"`):
```html
      <button data-tab="vendasperdidas" id="tabBtnVendasPerdidas" style="display:none" data-sub="Motivos das vendas perdidas, por categoria"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 9 4 4 3-3 5 6"/></svg><span class="sbLabel">Vendas Perdidas</span></button>
```

**Painel** (logo antes de `<section class="panel" id="panel-funil">`):
```html
    <!-- VENDAS PERDIDAS (05/10/2026, seção 70) — admin/supervisor: motivos das vendas perdidas pela categoria do NEO -->
    <section class="panel" id="panel-vendasperdidas">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Vendas Perdidas</h3>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span id="vpStatus" style="font-size:12px;color:var(--muted)"></span>
            <button type="button" class="btn btn-sm btn-outline" id="btnVpAtualizar" style="width:auto">Atualizar</button>
            <button type="button" class="btn btn-sm btn-outline" id="btnVpExportar" style="width:auto">Exportar Excel</button>
          </div>
        </div>
        <p class="desc">Motivos das vendas perdidas segundo a categoria que o consultor escolhe no NEO ao perder a venda.</p>
        <p class="desc" id="vpAvisoSync" style="display:none;color:var(--c-sinal)"></p>
        <div class="filterPills" id="vpPeriodoPills" style="margin:10px 0">
          <button type="button" class="filterPill active" data-vp-periodo="mes">Este mês</button>
          <button type="button" class="filterPill" data-vp-periodo="mespassado">Mês passado</button>
          <button type="button" class="filterPill" data-vp-periodo="90d">Últimos 90 dias</button>
          <button type="button" class="filterPill" data-vp-periodo="custom">Personalizado</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <div class="field" id="vpCustomDatas" style="display:none"><label for="vpDe">De</label><input type="date" id="vpDe"></div>
          <div class="field" id="vpCustomDatasAte" style="display:none"><label for="vpAte">Até</label><input type="date" id="vpAte"></div>
          <div class="field"><label for="vpFiltroConsultor">Consultor</label><select id="vpFiltroConsultor"></select></div>
          <div class="field"><label for="vpFiltroCategoria">Categoria</label><select id="vpFiltroCategoria"></select></div>
        </div>
        <div class="kpiGrid" id="vpKpis" style="margin-top:14px"></div>
      </div>
      <div class="card">
        <h3>Motivos</h3>
        <p class="desc">Clique num motivo para ver só os pedidos dele (clique de novo para limpar).</p>
        <div class="mlTabelaWrap"><table class="tbl">
          <thead><tr><th>Motivo</th><th>Pedidos</th><th>% das perdas</th><th>Valor</th></tr></thead>
          <tbody id="vpMotivosTbody"></tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Preenchimento por consultor</h3>
        <p class="desc">Quantas perdas de cada consultor têm categoria. Clique para ver só as dele.</p>
        <div class="mlTabelaWrap"><table class="tbl">
          <thead><tr><th>Consultor</th><th>Perdas</th><th>Com categoria</th><th>Preenchido</th><th>Maior motivo</th></tr></thead>
          <tbody id="vpConsultoresTbody"></tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Pedidos</h3>
        <p class="desc" id="vpPedidosResumo"></p>
        <div class="mlTabelaWrap"><table class="tbl">
          <thead><tr><th>Pedido</th><th>Perdido em</th><th>Consultor</th><th>Cliente</th><th>Produtos</th><th>Valor</th><th>Categoria</th></tr></thead>
          <tbody id="vpPedidosTbody"></tbody>
        </table></div>
      </div>
    </section>
```

**`enterApp()`**: depois de `mesaAplicarPermissao();`, acrescente:
```js
    // 05/10/2026 (seção 70): Vendas Perdidas por categoria — só admin/supervisor
    vpAplicarPermissao();
```

**Listener de `#tabsNav`**: depois de `if(btn.dataset.tab === 'mesa') loadMesa(true);`:
```js
  if(btn.dataset.tab === 'vendasperdidas') loadVendasPerdidas();
```

**JS** (depois das funções do Task 4):
```js
const vpEstado = { geracao: 0, periodo: 'mes', de: '', ate: '', linhas: [], erro: false, sync: null, agora: 0, fConsultor: '', fCategoria: '' };
function vpAgora(){ return Date.now(); }
function vpResetar(){
  vpEstado.geracao++;
  Object.assign(vpEstado, { periodo: 'mes', de: '', ate: '', linhas: [], erro: false, sync: null, fConsultor: '', fCategoria: '' });
  ['vpKpis', 'vpMotivosTbody', 'vpConsultoresTbody', 'vpPedidosTbody', 'vpPedidosResumo', 'vpStatus', 'vpFiltroConsultor', 'vpFiltroCategoria'].forEach(id => { document.getElementById(id).innerHTML = ''; });
  document.getElementById('vpAvisoSync').style.display = 'none';
  document.querySelectorAll('#vpPeriodoPills [data-vp-periodo]').forEach(b => b.classList.toggle('active', b.dataset.vpPeriodo === 'mes'));
  ['vpCustomDatas', 'vpCustomDatasAte'].forEach(id => { document.getElementById(id).style.display = 'none'; });
}
function vpAplicarPermissao(){
  const vis = canSeeVendasPerdidas();
  document.getElementById('tabBtnVendasPerdidas').style.display = vis ? 'inline-block' : 'none';
  if(!vis) vpResetar();
}
async function loadVendasPerdidas(){
  if(!canSeeVendasPerdidas()) return;
  const geracao = ++vpEstado.geracao;
  const agora = vpAgora(), hoje = vlPartesSP(agora).dia;
  const p = vpPeriodo(vpEstado.periodo, hoje, document.getElementById('vpDe').value, document.getElementById('vpAte').value);
  document.getElementById('vpStatus').textContent = 'Carregando…';
  const [res, sync] = await Promise.all([
    ppSeguro(() => fetchAllRows(() => sb.rpc('vendas_perdidas', { p_de: p.de, p_ate: p.ate }))),
    ppSeguro(() => sb.from('exportacao_sync_log').select('terminou_em').eq('ok', true).order('terminou_em', { ascending: false }).limit(1).maybeSingle()),
  ]);
  if(geracao !== vpEstado.geracao || !canSeeVendasPerdidas()) return;
  vpEstado.erro = !!(res && res.error);
  if(vpEstado.erro) console.error(res.error);
  vpEstado.linhas = vpEstado.erro ? [] : ((res && res.data) || []);
  vpEstado.sync = sync && !sync.error && sync.data && sync.data.terminou_em ? { ok_em: sync.data.terminou_em } : null;
  Object.assign(vpEstado, { agora, de: p.de, ate: p.ate });
  document.getElementById('vpStatus').textContent = `Período ${ppFmtDia(p.de)} a ${ppFmtDia(p.ate)}`;
  vpRender();
}
function vpOpcoes(el, valores, rotuloTodos, atual){
  el.innerHTML = `<option value="">${escapeHtml(rotuloTodos)}</option>` + valores.map(v => `<option value="${escapeHtml(v)}"${v === atual ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  el.value = valores.includes(atual) ? atual : '';
}
function vpRender(){
  const aviso = document.getElementById('vpAvisoSync');
  if(vpSyncAtrasada(vpEstado.sync, vpEstado.agora)){
    aviso.textContent = vpEstado.sync ? `As categorias do NEO não sincronizam desde ${mlFmtDiaHora(vpEstado.sync.ok_em)} — os motivos podem estar desatualizados.` : 'As categorias do NEO ainda não sincronizaram — os pedidos aparecem como "Sem categoria".';
    aviso.style.display = '';
  } else aviso.style.display = 'none';
  const todos = vpEstado.linhas;
  const consultores = [...new Set(todos.map(l => l.usuario || '(sem consultor)'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const categorias = vpMotivos(todos).map(m => m.motivo);
  if(vpEstado.fConsultor && !consultores.includes(vpEstado.fConsultor)) vpEstado.fConsultor = '';
  if(vpEstado.fCategoria && !categorias.includes(vpEstado.fCategoria)) vpEstado.fCategoria = '';
  vpOpcoes(document.getElementById('vpFiltroConsultor'), consultores, 'Todos', vpEstado.fConsultor);
  vpOpcoes(document.getElementById('vpFiltroCategoria'), categorias, 'Todas', vpEstado.fCategoria);
  const erroHtml = '<tr><td colspan="7">Não foi possível carregar as vendas perdidas agora.</td></tr>';
  if(vpEstado.erro){
    document.getElementById('vpKpis').innerHTML = '';
    ['vpMotivosTbody', 'vpConsultoresTbody', 'vpPedidosTbody'].forEach(id => { document.getElementById(id).innerHTML = erroHtml; });
    document.getElementById('vpPedidosResumo').textContent = '';
    return;
  }
  const filtradas = vpFiltrar(todos, vpEstado.fConsultor, vpEstado.fCategoria);
  const k = vpKpis(filtradas);
  document.getElementById('vpKpis').innerHTML = [
    mesaKpiHtml('Pedidos perdidos', k.total),
    mesaKpiHtml('Valor perdido', fmtBRL(k.valor)),
    mesaKpiHtml('Com categoria', k.pctComCategoria === null ? '—' : fmtPctConversao(k.pctComCategoria)),
    mesaKpiHtml('Maior motivo', k.maiorMotivo || '—', k.maiorMotivo ? fmtPctConversao(k.maiorMotivoPct) + ' das perdas com categoria' : ''),
  ].join('');
  const porConsultor = vpFiltrar(todos, vpEstado.fConsultor, '');
  const motivos = vpMotivos(porConsultor);
  document.getElementById('vpMotivosTbody').innerHTML = motivos.length ? motivos.map(m => `<tr data-vp-motivo="${escapeHtml(m.motivo)}" style="cursor:pointer"${m.motivo === vpEstado.fCategoria ? ' class="active"' : ''}>
      <td>${m.motivo === VP_SEM_CATEGORIA ? `<span class="badge">${escapeHtml(m.motivo)}</span>` : escapeHtml(m.motivo)}</td><td>${m.pedidos}</td><td>${fmtPctConversao(m.pct)}</td><td>${fmtBRL(m.valor)}</td></tr>`).join('')
    : '<tr><td colspan="4">Nenhuma venda perdida no período.</td></tr>';
  const cons = vpConsultores(todos);   // "quem não está preenchendo": sempre todos do período, sem os filtros
  document.getElementById('vpConsultoresTbody').innerHTML = cons.length ? cons.map(c => `<tr data-vp-consultor="${escapeHtml(c.usuario)}" style="cursor:pointer">
      <td>${escapeHtml(c.usuario)}</td><td>${c.perdas}</td><td>${c.comCategoria}</td>
      <td><span class="ppNivel ${vpNivelPreenchimento(c.pct)}">${escapeHtml(fmtPctConversao(c.pct))}</span></td><td>${escapeHtml(c.maiorMotivo || '—')}</td></tr>`).join('')
    : '<tr><td colspan="5">Nenhuma venda perdida no período.</td></tr>';
  document.getElementById('vpPedidosResumo').textContent = `${filtradas.length} ${filtradas.length === 1 ? 'pedido' : 'pedidos'}` + (vpEstado.fConsultor || vpEstado.fCategoria ? ' (filtrado)' : '');
  document.getElementById('vpPedidosTbody').innerHTML = filtradas.length ? filtradas.map(l => `<tr>
      <td>${escapeHtml(l.numero_pedido)}</td><td>${escapeHtml(mlFmtDiaHora(l.perdido_em))}</td><td>${escapeHtml(l.usuario || '—')}</td>
      <td>${escapeHtml(l.cliente || '—')}</td><td>${escapeHtml(l.produtos || '—')}</td><td>${fmtBRL(Number(l.valor) || 0)}</td>
      <td>${vpCategoria(l) === VP_SEM_CATEGORIA ? `<span class="badge">${VP_SEM_CATEGORIA}</span>` : escapeHtml(vpCategoria(l))}${(l.tags && l.tags.length) ? `<span class="retornoLeadSub">${escapeHtml(l.tags.join(' '))}</span>` : ''}</td></tr>`).join('')
    : '<tr><td colspan="7">Nenhum pedido para os filtros escolhidos.</td></tr>';
}
document.getElementById('panel-vendasperdidas').addEventListener('click', function(ev){
  const pill = ev.target.closest('[data-vp-periodo]');
  if(pill){
    vpEstado.periodo = pill.dataset.vpPeriodo;
    document.querySelectorAll('#vpPeriodoPills [data-vp-periodo]').forEach(b => b.classList.toggle('active', b === pill));
    const custom = vpEstado.periodo === 'custom';
    ['vpCustomDatas', 'vpCustomDatasAte'].forEach(id => { document.getElementById(id).style.display = custom ? '' : 'none'; });
    loadVendasPerdidas().catch(err => console.error(err));
    return;
  }
  const mot = ev.target.closest('tr[data-vp-motivo]');
  if(mot){ vpEstado.fCategoria = vpEstado.fCategoria === mot.dataset.vpMotivo ? '' : mot.dataset.vpMotivo; vpRender(); return; }
  const con = ev.target.closest('tr[data-vp-consultor]');
  if(con){ vpEstado.fConsultor = vpEstado.fConsultor === con.dataset.vpConsultor ? '' : con.dataset.vpConsultor; vpRender(); }
});
document.getElementById('vpFiltroConsultor').addEventListener('change', function(){ vpEstado.fConsultor = this.value; vpRender(); });
document.getElementById('vpFiltroCategoria').addEventListener('change', function(){ vpEstado.fCategoria = this.value; vpRender(); });
['vpDe', 'vpAte'].forEach(id => document.getElementById(id).addEventListener('change', () => { if(vpEstado.periodo === 'custom') loadVendasPerdidas().catch(err => console.error(err)); }));
document.getElementById('btnVpAtualizar').addEventListener('click', () => loadVendasPerdidas().catch(err => console.error(err)));
document.getElementById('btnVpExportar').addEventListener('click', function(){
  const filtradas = vpFiltrar(vpEstado.linhas, vpEstado.fConsultor, vpEstado.fCategoria);
  mlBaixarXlsx(`VendasPerdidas_${vpEstado.de}_${vpEstado.ate}.xlsx`, [
    { nome: 'Motivos', linhas: vpMotivos(filtradas).map(m => ({ Motivo: m.motivo, Pedidos: m.pedidos, '% das perdas': Math.round(m.pct * 1000) / 10, 'Valor (R$)': m.valor })) },
    { nome: 'Preenchimento', linhas: vpConsultores(vpFiltrar(vpEstado.linhas, vpEstado.fConsultor, '')).map(c => ({ Consultor: c.usuario, Perdas: c.perdas, 'Com categoria': c.comCategoria, '% preenchido': Math.round(c.pct * 1000) / 10, 'Maior motivo': c.maiorMotivo || '' })) },
    { nome: 'Pedidos', linhas: filtradas.map(l => ({ Pedido: l.numero_pedido, 'Perdido em': mlFmtDiaHora(l.perdido_em), Consultor: l.usuario || '', Cliente: l.cliente || '', Produtos: l.produtos || '', 'Valor (R$)': Number(l.valor) || 0, Categoria: vpCategoria(l), Tags: (l.tags || []).join(' ') })) },
  ]);
});
```
Também em `test_reorganizacao_abas.js`, troque a `ordemEsperada` para incluir `'vendasperdidas'` logo depois de `'funil'`, com o comentário `// NOTA (05/10/2026): incluída "vendasperdidas" (Vendas Perdidas, só admin/supervisor), no grupo Vendas logo depois de "funil" (seção 70).`

Confira antes de usar (`grep -n`): `function mlFmtDiaHora`, `function mesaKpiHtml`, `const ppFmtDia`, `function mlBaixarXlsx`, `function vlPartesSP`.

- [ ] **Step 4: Rodar e ver passar** — `node test_vendas_perdidas.js && node test_reorganizacao_abas.js && node test_mesa_supervisor.js` → `0 falharam` nos três; `bash run_tests.sh` sem falha nova.

- [ ] **Step 5: Commit**
```bash
git add _template.html painel_clientes_apex.html test_vendas_perdidas.js test_reorganizacao_abas.js
git commit -m "feat(painel): aba Vendas Perdidas — motivos por categoria, preenchimento por consultor, pedidos e Excel (seção 70)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: REGRAS §70 + bateria

**Files:** Modify `REGRAS_NEGOCIO.md` (seção nova no fim).

- [ ] **Step 1:** `git fetch oficial && git show oficial/main:REGRAS_NEGOCIO.md | grep -E '^## [0-9]+\.' | tail -2` (última deve ser §69; use §70).
- [ ] **Step 2:** escrever `## 70. Vendas Perdidas por categoria (API de Exportação Xeotech) (05/10/2026)` com: pedido do usuário; 70.1 a API e o que o teste mostrou (período ignorado, 1.574 linhas/613 pedidos, categorias em uso, subcategoria vazia); 70.2 banco (tabelas, RLS, RPC, cron 41); 70.3 Edge Function (fluxo, erros, token oculto, modo teste); 70.4 aba (filtros, blocos, Excel, permissões); 70.5 testes; 70.6 status (banco/função aplicados pelo controlador com ok de 05/10; painel aguardando publicação) e como reverter (rollbacks). Sem token, sem dado real.
- [ ] **Step 3:** `bash run_tests.sh` (só as 2 falhas antigas) e `node --test supabase/functions/sync-exportacao/exportacao.test.ts`.
- [ ] **Step 4: Commit**
```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): seção 70 — vendas perdidas por categoria

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
