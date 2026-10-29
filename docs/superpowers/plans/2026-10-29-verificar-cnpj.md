# Verificar CNPJ na Receita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Verificar na Receita" na ficha do lead (Meus leads) que mostra a situação cadastral do CNPJ (selo + aviso), salvando o resultado para todos verem.

**Architecture:** Edge Function nova `verificar-cnpj` (lógica pura em `verificar.ts` com dependências injetadas + `index.ts` fino) consulta BrasilAPI com reserva publica.cnpj.ws e grava numa tabela nova `cnpj_consultas` (uma linha por CNPJ). O painel (`_template.html`) lê essa tabela ao abrir a ficha e chama a função no clique. Nada roda sozinho; `leads` e `sync-leads` não mudam.

**Tech Stack:** Supabase (Postgres + Edge Functions Deno, `npm:@supabase/supabase-js@2`), painel HTML único (`_template.html` → `build_painel.py`), testes `node` + `jsdom` (painel) e `node --test` em `.ts` (Edge Function).

**Spec:** `docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md`

## Global Constraints

- Repo público: nenhum CNPJ real, nome, telefone ou dado de cliente em código, teste ou log. Testes usam `00000000000131`/`00000000000132` e nomes `Zz …`.
- Log da Edge Function: só status, fonte e situação — nunca CNPJ, razão social, `aba` ou `lead_id`.
- Botão só nas colunas `novos`, `semlig`, `andamento`, `semresp` (de `kbColunaDoLead`); nunca em `convertido`, `perdido`, `livres`.
- Situações aceitas: `ATIVA`, `BAIXADA`, `INAPTA`, `SUSPENSA`, `NULA`, `NAO_ENCONTRADO`. Outra coisa = resposta inválida, não grava.
- Cache: consulta salva há menos de 10 minutos é devolvida sem consultar fora. Tempo limite por fonte: 8 s.
- Quem pode verificar: dono do lead (`leads.dono_id`), `supervisor` ou `admin` (`profiles.role`).
- Atalho "Classificar como CNPJ INAPTO" só preenche o status; nunca salva.
- Visual: só classes/variáveis existentes (`.kbTag.ok/.soon/.late`, `.kbFichaAviso`, `.kbBtn`, `.kbLink`, `.kbMeta`); nenhum hex novo; cantos 8px.
- Migration sem DROP. Banco, Edge Function e painel só vão ao ar com ok do Rafael, cada um.
- `_template.html` em LF. Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- CNPJ gravado com pontuação na `leads` (ex.: `00.000.000/0001-31`) → a função e o painel usam só os dígitos (teste na Task 1 e Task 3).
- BrasilAPI devolvendo 429 (limite) ou 5xx → cai na publica.cnpj.ws, não mostra erro (teste na Task 1).
- Consultor troca de lead enquanto a consulta roda → o resultado não aparece na ficha do lead errado (teste na Task 4).
- Tabela ou função ainda não publicadas (ou fora do ar) → a ficha abre normal, o botão fica e o clique mostra "Não foi possível consultar agora" (teste na Task 4).
- Ficha flutuante (janela por cima do ProContact) → o clique funciona porque o evento é delegado em `kbFichaNo()`; conferir à mão na prévia (Task 5).

---

### Task 1: Lógica da Edge Function (`verificar.ts`)

**Files:**
- Create: `supabase/functions/verificar-cnpj/verificar.ts`
- Test: `supabase/functions/verificar-cnpj/verificar.test.ts`

**Interfaces:**
- Produces (usado na Task 2):
  - `type Situacao = "ATIVA" | "BAIXADA" | "INAPTA" | "SUSPENSA" | "NULA" | "NAO_ENCONTRADO"`
  - `interface Consulta { cnpj: string; situacao: Situacao; situacao_desde: string | null; motivo: string | null; razao_social: string | null; fonte: "brasilapi" | "cnpjws"; consultado_em: string; consultado_por: string | null }`
  - `interface Lead { cnpj: string | null; dono_id: string | null; apagado_em: string | null }`
  - `interface Deps { usuario(auth: string | null): Promise<string | null>; papel(uid: string): Promise<string | null>; lead(aba: string, id: string): Promise<Lead | null>; consultaSalva(cnpj: string): Promise<Consulta | null>; salvar(c: Consulta): Promise<void>; buscar(url: string, ms: number): Promise<{ status: number; corpo: unknown }>; agora(): Date; log(msg: string): void }`
  - `verificar(entrada: { auth: string | null; aba: string; lead_id: string }, deps: Deps): Promise<{ status: number; corpo: Record<string, unknown> }>`
  - `normalizarSituacao(v: unknown): Situacao | null`, `lerBrasilApi(corpo: unknown)`, `lerCnpjWs(corpo: unknown)`, `CACHE_MS`, `TEMPO_LIMITE_MS`

- [ ] **Step 1: Write the failing test**

`supabase/functions/verificar-cnpj/verificar.test.ts`:

```ts
// Testa a lógica da Edge Function verificar-cnpj (REGRAS §127). Roda com: node --test verificar.test.ts
// DADOS FICTÍCIOS (repo público).
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificar, normalizarSituacao, lerBrasilApi, lerCnpjWs, CACHE_MS } from "./verificar.ts";
import type { Consulta, Deps, Lead } from "./verificar.ts";

const CNPJ = "00000000000131";
const BRASIL = { razao_social: "ZZ TESTE LTDA", descricao_situacao_cadastral: "BAIXADA", data_situacao_cadastral: "2024-03-12",
  descricao_motivo_situacao_cadastral: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA" };
const WS = { razao_social: "ZZ TESTE LTDA", estabelecimento: { situacao_cadastral: "Ativa", data_situacao_cadastral: "2020-01-02", motivo_situacao_cadastral: null } };
type Resp = { status: number; corpo: unknown } | "falha";

function criar(o: { usuario?: string | null; papel?: string | null; lead?: Lead | null; salva?: Consulta | null;
  respostas?: { brasilapi?: Resp; cnpjws?: Resp } } = {}) {
  const chamadas = { buscar: [] as string[], salvar: [] as Consulta[], log: [] as string[] };
  const respostas = o.respostas ?? { brasilapi: { status: 200, corpo: BRASIL } };
  const deps: Deps = {
    usuario: () => Promise.resolve(o.usuario === undefined ? "u-dono" : o.usuario),
    papel: () => Promise.resolve(o.papel === undefined ? "consultor" : o.papel),
    lead: () => Promise.resolve(o.lead === undefined ? { cnpj: "00.000.000/0001-31", dono_id: "u-dono", apagado_em: null } : o.lead),
    consultaSalva: () => Promise.resolve(o.salva ?? null),
    salvar: (c) => { chamadas.salvar.push(c); return Promise.resolve(); },
    buscar: (url) => {
      chamadas.buscar.push(url);
      const r = url.includes("brasilapi.com.br") ? respostas.brasilapi : respostas.cnpjws;
      if (!r || r === "falha") return Promise.reject(new Error("rede"));
      return Promise.resolve(r);
    },
    agora: () => new Date("2026-10-29T17:00:00Z"),
    log: (m) => { chamadas.log.push(m); },
  };
  return { deps, chamadas };
}
const pedir = (deps: Deps, over: Partial<{ auth: string | null; aba: string; lead_id: string }> = {}) =>
  verificar({ auth: "Bearer zz", aba: "OUTUBRO", lead_id: "l1", ...over }, deps);
const salva = (minAtras: number): Consulta => ({ cnpj: CNPJ, situacao: "ATIVA", situacao_desde: "2020-01-02", motivo: null,
  razao_social: "ZZ TESTE LTDA", fonte: "brasilapi", consultado_em: new Date(Date.parse("2026-10-29T17:00:00Z") - minAtras * 60000).toISOString(),
  consultado_por: "u-outro" });

test("normalizarSituacao aceita só as 5 situações da Receita", () => {
  assert.deepEqual(["Ativa", " BAIXADA ", "Inápta", "suspensa", "NULA", "XYZ", null].map(normalizarSituacao),
    ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA", null, null]);
});

test("lerBrasilApi e lerCnpjWs mapeiam os campos; SEM MOTIVO vira null", () => {
  assert.deepEqual(lerBrasilApi(BRASIL), { situacao: "BAIXADA", situacao_desde: "2024-03-12",
    motivo: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA", razao_social: "ZZ TESTE LTDA", fonte: "brasilapi" });
  assert.equal(lerBrasilApi({ ...BRASIL, descricao_motivo_situacao_cadastral: "SEM MOTIVO" })?.motivo, null);
  assert.deepEqual(lerCnpjWs(WS), { situacao: "ATIVA", situacao_desde: "2020-01-02", motivo: null, razao_social: "ZZ TESTE LTDA", fonte: "cnpjws" });
  assert.equal(lerCnpjWs({ ...WS, estabelecimento: { ...WS.estabelecimento, motivo_situacao_cadastral: { descricao: "Omissão de declarações" } } })?.motivo,
    "Omissão de declarações");
  assert.equal(lerBrasilApi({ descricao_situacao_cadastral: "XYZ" }), null);
  assert.equal(lerCnpjWs(null), null);
});

test("sem usuário → 401 e nada é consultado", async () => {
  const { deps, chamadas } = criar({ usuario: null });
  const r = await pedir(deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.buscar.length, 0);
});

test("sem aba ou lead_id → 400", async () => {
  const { deps } = criar();
  assert.equal((await pedir(deps, { aba: "" })).status, 400);
  assert.equal((await pedir(deps, { lead_id: "" })).status, 400);
});

test("lead inexistente ou apagado → 404", async () => {
  assert.equal((await pedir(criar({ lead: null }).deps)).status, 404);
  assert.equal((await pedir(criar({ lead: { cnpj: CNPJ, dono_id: "u-dono", apagado_em: "2026-10-28T10:00:00Z" } }).deps)).status, 404);
});

test("consultor que não é dono → 403 sem consultar; supervisor e admin podem", async () => {
  const outro = criar({ usuario: "u-outro" });
  assert.equal((await pedir(outro.deps)).status, 403);
  assert.equal(outro.chamadas.buscar.length, 0);
  assert.equal((await pedir(criar({ usuario: "u-sup", papel: "supervisor" }).deps)).status, 200);
  assert.equal((await pedir(criar({ usuario: "u-adm", papel: "admin" }).deps)).status, 200);
});

test("CNPJ sem 14 dígitos → 422", async () => {
  const r = await pedir(criar({ lead: { cnpj: "123.456", dono_id: "u-dono", apagado_em: null } }).deps);
  assert.equal(r.status, 422);
  assert.equal(r.corpo.erro, "cnpj_invalido");
});

test("consulta salva há menos de 10 min volta sem consultar fora; com 10 min ou mais consulta de novo", async () => {
  const novo = criar({ salva: salva(9) });
  const r = await pedir(novo.deps);
  assert.equal(r.status, 200);
  assert.equal((r.corpo.consulta as Consulta).situacao, "ATIVA");
  assert.equal(novo.chamadas.buscar.length, 0);
  assert.equal(CACHE_MS, 10 * 60 * 1000);
  const velho = criar({ salva: salva(10) });
  await pedir(velho.deps);
  assert.equal(velho.chamadas.buscar.length, 1);
});

test("BrasilAPI ok → grava e devolve a consulta com os dígitos, quem clicou e a hora", async () => {
  const { deps, chamadas } = criar();
  const r = await pedir(deps);
  const esperado: Consulta = { cnpj: CNPJ, situacao: "BAIXADA", situacao_desde: "2024-03-12", motivo: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA",
    razao_social: "ZZ TESTE LTDA", fonte: "brasilapi", consultado_em: "2026-10-29T17:00:00.000Z", consultado_por: "u-dono" };
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, consulta: esperado });
  assert.deepEqual(chamadas.salvar, [esperado]);
  assert.deepEqual(chamadas.buscar, [`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`]);
});

test("BrasilAPI com falha de rede, 500 ou 429 → usa a publica.cnpj.ws", async () => {
  for (const b of ["falha", { status: 500, corpo: null }, { status: 429, corpo: null }] as Resp[]) {
    const { deps, chamadas } = criar({ respostas: { brasilapi: b, cnpjws: { status: 200, corpo: WS } } });
    const r = await pedir(deps);
    assert.equal(r.status, 200);
    assert.equal(chamadas.salvar[0].fonte, "cnpjws");
    assert.equal(chamadas.salvar[0].situacao, "ATIVA");
    assert.equal(chamadas.buscar[1], `https://publica.cnpj.ws/cnpj/${CNPJ}`);
  }
});

test("BrasilAPI 404 → NAO_ENCONTRADO gravado, sem chamar a reserva", async () => {
  const { deps, chamadas } = criar({ respostas: { brasilapi: { status: 404, corpo: { message: "não encontrado" } } } });
  const r = await pedir(deps);
  assert.equal(r.status, 200);
  assert.equal(chamadas.salvar[0].situacao, "NAO_ENCONTRADO");
  assert.equal(chamadas.buscar.length, 1);
});

test("as duas fontes falham ou respondem situação desconhecida → 503 e nada é gravado", async () => {
  const a = criar({ respostas: { brasilapi: "falha", cnpjws: { status: 502, corpo: null } } });
  const r = await pedir(a.deps);
  assert.equal(r.status, 503);
  assert.equal(r.corpo.erro, "fora_do_ar");
  assert.equal(a.chamadas.salvar.length, 0);
  const b = criar({ respostas: { brasilapi: { status: 200, corpo: { descricao_situacao_cadastral: "XYZ" } },
    cnpjws: { status: 200, corpo: { estabelecimento: { situacao_cadastral: "??" } } } } });
  assert.equal((await pedir(b.deps)).status, 503);
  assert.equal(b.chamadas.salvar.length, 0);
});

test("log nunca leva CNPJ, razão social, aba ou lead", async () => {
  const casos = [criar(), criar({ respostas: { brasilapi: "falha", cnpjws: "falha" } }), criar({ salva: salva(1) })];
  for (const c of casos) await pedir(c.deps);
  const tudo = casos.flatMap((c) => c.chamadas.log).join("\n");
  assert.ok(tudo.length > 0);
  for (const proibido of [CNPJ, "0001-31", "ZZ TESTE", "OUTUBRO", "l1"]) assert.ok(!tudo.includes(proibido), proibido);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions/verificar-cnpj && node --test verificar.test.ts`
Expected: FAIL — `Cannot find module ... verificar.ts`

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/verificar-cnpj/verificar.ts`:

```ts
// Edge Function verificar-cnpj (REGRAS_NEGOCIO.md §127) — lógica pura, dependências injetadas.
// Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
// Log: só status, fonte e situação — nunca CNPJ, razão social, aba ou lead (repo e logs públicos).
export type Situacao = "ATIVA" | "BAIXADA" | "INAPTA" | "SUSPENSA" | "NULA" | "NAO_ENCONTRADO";
export type Fonte = "brasilapi" | "cnpjws";
export interface Consulta {
  cnpj: string; situacao: Situacao; situacao_desde: string | null; motivo: string | null; razao_social: string | null;
  fonte: Fonte; consultado_em: string; consultado_por: string | null;
}
export type Resultado = Omit<Consulta, "cnpj" | "consultado_em" | "consultado_por">;
export interface Lead { cnpj: string | null; dono_id: string | null; apagado_em: string | null }
export interface Deps {
  usuario(auth: string | null): Promise<string | null>;
  papel(uid: string): Promise<string | null>;
  lead(aba: string, id: string): Promise<Lead | null>;
  consultaSalva(cnpj: string): Promise<Consulta | null>;
  salvar(c: Consulta): Promise<void>;
  buscar(url: string, ms: number): Promise<{ status: number; corpo: unknown }>;   // rejeita em falha de rede ou tempo esgotado
  agora(): Date;
  log(msg: string): void;
}

export const CACHE_MS = 10 * 60 * 1000;
export const TEMPO_LIMITE_MS = 8000;
const SITUACOES_RECEITA = ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA"];
const GESTORES = ["admin", "supervisor"];

export function soDigitos(v: unknown): string { return String(v ?? "").replace(/\D/g, ""); }
export function normalizarSituacao(v: unknown): Situacao | null {
  const s = String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return SITUACOES_RECEITA.includes(s) ? s as Situacao : null;
}
function data(v: unknown): string | null { const s = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; }
function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s.toUpperCase() !== "SEM MOTIVO" ? s : null;
}
function obj(v: unknown): Record<string, unknown> { return v && typeof v === "object" ? v as Record<string, unknown> : {}; }

export function lerBrasilApi(corpo: unknown): Resultado | null {
  const c = obj(corpo), situacao = normalizarSituacao(c.descricao_situacao_cadastral);
  if (!situacao) return null;
  return { situacao, situacao_desde: data(c.data_situacao_cadastral), motivo: texto(c.descricao_motivo_situacao_cadastral),
    razao_social: texto(c.razao_social), fonte: "brasilapi" };
}
export function lerCnpjWs(corpo: unknown): Resultado | null {
  const c = obj(corpo), e = obj(c.estabelecimento), situacao = normalizarSituacao(e.situacao_cadastral);
  if (!situacao) return null;
  return { situacao, situacao_desde: data(e.data_situacao_cadastral), motivo: texto(obj(e.motivo_situacao_cadastral).descricao),
    razao_social: texto(c.razao_social), fonte: "cnpjws" };
}

const FONTES: { nome: Fonte; url: (cnpj: string) => string; ler: (corpo: unknown) => Resultado | null }[] = [
  { nome: "brasilapi", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, ler: lerBrasilApi },
  { nome: "cnpjws", url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, ler: lerCnpjWs },
];
const naoEncontrado = (fonte: Fonte): Resultado => ({ situacao: "NAO_ENCONTRADO", situacao_desde: null, motivo: null, razao_social: null, fonte });

// BrasilAPI primeiro; falha de rede, tempo, HTTP diferente de 200/404 ou situação desconhecida → tenta a próxima fonte.
async function consultarFora(cnpj: string, deps: Deps): Promise<Resultado | null> {
  for (const f of FONTES) {
    try {
      const r = await deps.buscar(f.url(cnpj), TEMPO_LIMITE_MS);
      if (r.status === 404) return naoEncontrado(f.nome);
      if (r.status === 200) {
        const lido = f.ler(r.corpo);
        if (lido) return lido;
        deps.log(`${f.nome}: resposta sem situação conhecida`);
      } else deps.log(`${f.nome}: HTTP ${r.status}`);
    } catch (_e) {
      deps.log(`${f.nome}: falha de rede ou tempo`);
    }
  }
  return null;
}

const resp = (status: number, corpo: Record<string, unknown>) => ({ status, corpo });

export async function verificar(entrada: { auth: string | null; aba: string; lead_id: string }, deps: Deps) {
  const uid = await deps.usuario(entrada.auth);
  if (!uid) return resp(401, { ok: false, erro: "nao_autenticado" });
  if (!entrada.aba || !entrada.lead_id) return resp(400, { ok: false, erro: "entrada_invalida" });
  const lead = await deps.lead(entrada.aba, entrada.lead_id);
  if (!lead || lead.apagado_em) return resp(404, { ok: false, erro: "lead_nao_encontrado" });
  if (lead.dono_id !== uid && !GESTORES.includes(String(await deps.papel(uid)))) return resp(403, { ok: false, erro: "sem_permissao" });
  const cnpj = soDigitos(lead.cnpj);
  if (cnpj.length !== 14) return resp(422, { ok: false, erro: "cnpj_invalido" });
  const salva = await deps.consultaSalva(cnpj);
  if (salva && deps.agora().getTime() - Date.parse(salva.consultado_em) < CACHE_MS) {
    deps.log(`cache ${salva.situacao}`);
    return resp(200, { ok: true, consulta: salva });
  }
  const r = await consultarFora(cnpj, deps);
  if (!r) { deps.log("fora do ar"); return resp(503, { ok: false, erro: "fora_do_ar" }); }
  const consulta: Consulta = { cnpj, ...r, consultado_em: deps.agora().toISOString(), consultado_por: uid };
  await deps.salvar(consulta);
  deps.log(`ok ${r.fonte} ${r.situacao}`);
  return resp(200, { ok: true, consulta });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions/verificar-cnpj && node --test verificar.test.ts`
Expected: PASS — `ℹ pass 13`, `ℹ fail 0`

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/verificar-cnpj/verificar.ts supabase/functions/verificar-cnpj/verificar.test.ts
git commit -m "feat(verificar-cnpj): logica da consulta na Receita com reserva, cache e permissao (secao 127)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `index.ts` da Edge Function e migration da tabela

**Files:**
- Create: `supabase/functions/verificar-cnpj/index.ts`
- Create: `supabase/migrations/20261029120000_cnpj_consultas.sql`

**Interfaces:**
- Consumes: `verificar`, `Deps`, `Consulta`, `Lead` da Task 1.
- Produces: endpoint `POST /functions/v1/verificar-cnpj` com corpo `{ aba: string, lead_id: string }` → `{ ok: true, consulta: Consulta }` (200) ou `{ ok: false, erro }` com 400/401/403/404/422/503/500. Tabela `public.cnpj_consultas` (colunas = `Consulta`).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261029120000_cnpj_consultas.sql`:

```sql
-- §127: última consulta da situação cadastral de cada CNPJ na Receita (Edge Function verificar-cnpj).
-- Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md. Só a Edge Function grava (service role); quem está logado lê.
-- Sem DROP; não mexe em tabela existente.
create table if not exists public.cnpj_consultas (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
  situacao text not null check (situacao in ('ATIVA','BAIXADA','INAPTA','SUSPENSA','NULA','NAO_ENCONTRADO')),
  situacao_desde date,
  motivo text,
  razao_social text,
  fonte text not null check (fonte in ('brasilapi','cnpjws')),
  consultado_em timestamptz not null default now(),
  consultado_por uuid references auth.users(id) on delete set null
);
alter table public.cnpj_consultas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cnpj_consultas' and policyname = 'cnpj_consultas_ler') then
    create policy cnpj_consultas_ler on public.cnpj_consultas for select to authenticated using (true);
  end if;
end $$;
grant select on public.cnpj_consultas to authenticated;
```

- [ ] **Step 2: Write `index.ts`**

`supabase/functions/verificar-cnpj/index.ts`:

```ts
// Edge Function: verificar-cnpj (REGRAS_NEGOCIO.md §127) — situação do CNPJ do lead na Receita, só quando alguém clica.
// Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md. Publicar com verify_jwt = true.
// Recebe { aba, lead_id }; nunca o CNPJ. Log: só status, fonte e situação.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verificar } from "./verificar.ts";
import type { Consulta, Deps, Lead } from "./verificar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

// O token é validado no Auth, além do verify_jwt do gateway (mesmo padrão da mailing-api).
async function usuario(auth: string | null): Promise<string | null> {
  const jwt = (auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  return error || !data?.user ? null : data.user.id;
}

const deps: Deps = {
  usuario,
  async papel(uid) {
    const { data, error } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
    if (error) throw error;
    return data?.role ?? null;
  },
  async lead(aba, id) {
    const { data, error } = await admin.from("leads").select("cnpj,dono_id,apagado_em").eq("aba", aba).eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as Lead | null) ?? null;
  },
  async consultaSalva(cnpj) {
    const { data, error } = await admin.from("cnpj_consultas").select("*").eq("cnpj", cnpj).maybeSingle();
    if (error) throw error;
    return (data as Consulta | null) ?? null;
  },
  async salvar(c) {
    const { error } = await admin.from("cnpj_consultas").upsert(c, { onConflict: "cnpj" });
    if (error) throw error;
  },
  async buscar(url, ms) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
    let corpo: unknown = null;
    try { corpo = await r.json(); } catch (_e) { corpo = null; }
    return { status: r.status, corpo };
  },
  agora: () => new Date(),
  log: (m) => console.log(`verificar-cnpj: ${m}`),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch (_e) { corpo = {}; }
  try {
    const r = await verificar({ auth: req.headers.get("Authorization"), aba: String(corpo.aba ?? ""), lead_id: String(corpo.lead_id ?? "") }, deps);
    return json(r.corpo, r.status);
  } catch (_e) {
    console.log("verificar-cnpj: erro interno");
    return json({ ok: false, erro: "interno" }, 500);
  }
});
```

- [ ] **Step 3: Check that nothing in the new files carries a real CNPJ and that the logic tests still pass**

Run: `grep -nE "[0-9]{2}\.?[0-9]{3}\.?[0-9]{3}/?[0-9]{4}-?[0-9]{2}" supabase/functions/verificar-cnpj/index.ts supabase/migrations/20261029120000_cnpj_consultas.sql; cd supabase/functions/verificar-cnpj && node --test verificar.test.ts`
Expected: grep sem saída; `ℹ fail 0`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/verificar-cnpj/index.ts supabase/migrations/20261029120000_cnpj_consultas.sql
git commit -m "feat(verificar-cnpj): endpoint da Edge Function e tabela cnpj_consultas (secao 127)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Funções puras do painel e lugar na ficha

**Files:**
- Modify: `_template.html` — funções novas logo depois de `kbFichaHtml` (termina antes de `const kbEstado = {`, hoje ~linha 4061); bloco `#kbCnpjRec` dentro de `kbFichaHtml` (linha do `kbFichaOutros`, ~4041); CSS logo depois de `.kbFichaOutros{…}` (~linha 1002).
- Create: `test_verificar_cnpj.js`
- Setup: junção `node_modules` no worktree.

**Interfaces:**
- Consumes: `kbColunaDoLead(f)`, `kbDataHoraBR(iso)`, `escapeHtml(s)` (existentes).
- Produces (usado na Task 4):
  - `kbCnpjDigitos(v) → string`
  - `kbCnpjMostra(f) → boolean`
  - `kbCnpjSelo(consulta) → { classe: 'ok'|'soon'|'late', texto: string } | null`
  - `kbCnpjAviso(consulta) → { titulo: string, motivo: string, texto: string } | null`
  - `kbCnpjMsgErro(status) → string`
  - `kbCnpjHtml(f, est) → string`, `est = { carregando?: boolean, consulta?: object|null, erro?: string, podeInapto?: boolean }`
  - No HTML: contêiner `id="kbCnpjRec"`, botões `data-kb-cnpj-verificar` e `data-kb-cnpj-inapto`.

- [ ] **Step 1: Create the node_modules junction (jsdom)**

Run: `cmd //c "mklink /J node_modules ..\\..\\node_modules"`
Expected: `Junção criada para node_modules <<===>> ..\..\node_modules` (ao remover o worktree no fim: `rmdir node_modules` antes).

- [ ] **Step 2: Write the failing test**

`test_verificar_cnpj.js`:

```js
// Testa o §127 (verificar CNPJ na Receita pela ficha do lead). Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
// DADOS FICTÍCIOS (repo público).
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
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
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
window.__alertas = [];
window.alert = (m) => window.__alertas.push(String(m));
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
  const OPC = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }, { status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 },
    { status: 'PEDIDO CONCLUIDO (VENDA)', grupo: 'convertido', ordem: 10 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  const F3 = { aba: 'OUTUBRO', lead_id: 'f3', nome: 'Zz Padaria', cidade: 'Campinas', uf: 'SP', qtd_linhas: '6', tipo_empresa: 'MEI', telefone: '11900000031',
    email: 'zz@teste.invalid', cnpj: '00.000.000/0001-31', status: 'AGENDADO RETORNO', categoria: 'andamento', obs: 'Zz ligar depois do almoço', campanha: 'Zz Campanha',
    criado_em_lead: '2026-10-24T09:14:00-03:00', livre: false, dono_nome: 'Zzkcon Teste', ligacoes: 3 };
  const BAIXADA = { situacao: 'BAIXADA', situacao_desde: '2024-03-12', motivo: 'EXTINCAO POR ENCERRAMENTO', consultado_em: '2026-10-29T14:32:00-03:00' };
  const ATIVA = { situacao: 'ATIVA', situacao_desde: '2020-01-02', motivo: null, consultado_em: '2026-10-29T14:32:00-03:00' };

  // ==== Task 3: funções puras ====
  eq(kbCnpjDigitos('00.000.000/0001-31'), '00000000000131', 'CNPJ só com dígitos');
  eq(['andamento', 'sem_contato', 'perdido', 'convertido'].map(c => kbCnpjMostra(Object.assign({}, F3, { categoria: c }))), [true, true, false, false],
     'botão em andamento e meus novos; não em perdido nem convertido');
  assert(kbCnpjMostra(Object.assign({}, F3, { categoria: 'andamento', ligacoes: 0 })), 'botão em Sem ligação');
  assert(!kbCnpjMostra(Object.assign({}, F3, { livre: true })) && !kbCnpjMostra(Object.assign({}, F3, { cnpj: '' })) && !kbCnpjMostra(Object.assign({}, F3, { venda_neo: true })),
     'sem botão em livre, sem CNPJ ou com venda no NEO');
  eq([ATIVA, { situacao: 'SUSPENSA' }, BAIXADA, { situacao: 'INAPTA' }, { situacao: 'NULA' }, { situacao: 'NAO_ENCONTRADO' }].map(c => (kbCnpjSelo(c) || {}).classe),
     ['ok', 'soon', 'late', 'late', 'late', 'late'], 'cor do selo por situação');
  assert(/^Ativa na Receita · consultado 29\\/10,? 14:32$/.test(kbCnpjSelo(ATIVA).texto), 'selo com a hora da consulta: ' + kbCnpjSelo(ATIVA).texto);
  eq(kbCnpjSelo({ situacao: 'NAO_ENCONTRADO' }).texto, 'CNPJ não existe na Receita: confira com o cliente', 'selo de não encontrado');
  eq([kbCnpjSelo(null), kbCnpjSelo({ situacao: 'XYZ' })], [null, null], 'sem consulta ou situação estranha: sem selo');
  eq(kbCnpjAviso(BAIXADA), { titulo: 'Empresa BAIXADA na Receita desde 12/03/2024', motivo: 'extincao por encerramento',
     texto: 'Confirme com o cliente se ele tem outro CNPJ ativo antes de seguir.' }, 'aviso de baixada com data e motivo');
  eq(kbCnpjAviso({ situacao: 'INAPTA', situacao_desde: null, motivo: null }).titulo, 'Empresa INAPTA na Receita', 'aviso sem data');
  eq([kbCnpjAviso(ATIVA), kbCnpjAviso({ situacao: 'SUSPENSA' }), kbCnpjAviso({ situacao: 'NAO_ENCONTRADO' }), kbCnpjAviso(null)], [null, null, null, null],
     'sem aviso para ativa, suspensa, não encontrado ou sem consulta');
  eq([kbCnpjMsgErro(403), kbCnpjMsgErro(422), kbCnpjMsgErro(503), kbCnpjMsgErro(undefined)],
     ['Só o dono do lead, o supervisor ou o admin podem verificar.', 'CNPJ inválido.',
      'Não foi possível consultar agora. Tente de novo em alguns minutos.', 'Não foi possível consultar agora. Tente de novo em alguns minutos.'], 'mensagens de erro');
  const h0 = kbCnpjHtml(F3, {});
  assert(h0.includes('data-kb-cnpj-verificar') && h0.includes('Verificar na Receita') && h0.includes('kbBtnP'), 'nunca verificado: botão destacado');
  assert(kbCnpjHtml(F3, { carregando: true }).includes('Consultando…') && !kbCnpjHtml(F3, { carregando: true }).includes('data-kb-cnpj-verificar'), 'consultando: sem botão clicável');
  const hB = kbCnpjHtml(F3, { consulta: BAIXADA, podeInapto: true });
  assert(hB.includes('kbTag late') && hB.includes('Verificar de novo') && hB.includes('kbFichaAviso') && hB.includes('desde 12/03/2024')
     && hB.includes('(motivo: extincao por encerramento)') && hB.includes('data-kb-cnpj-inapto'), 'baixada: selo vermelho, aviso e atalho');
  assert(!kbCnpjHtml(F3, { consulta: BAIXADA, podeInapto: false }).includes('data-kb-cnpj-inapto'), 'sem a opção CNPJ INAPTO: sem atalho');
  const hA = kbCnpjHtml(F3, { consulta: ATIVA, erro: kbCnpjMsgErro(503) });
  assert(hA.includes('kbTag ok') && !hA.includes('kbFichaAviso') && hA.includes('Não foi possível consultar agora'), 'erro ao reverificar mantém o selo e mostra a mensagem');
  eq(kbCnpjHtml(Object.assign({}, F3, { cnpj: '123.456.789-0' }), {}), '<span class="kbMeta">CNPJ inválido (10 dígitos)</span>', 'CNPJ sem 14 dígitos');
  eq(kbCnpjHtml(Object.assign({}, F3, { categoria: 'convertido' }), {}), '', 'convertido: nada');
  const hX = kbCnpjHtml(F3, { consulta: { situacao: 'BAIXADA', motivo: '<img src=x onerror=alert(1)>', situacao_desde: null, consultado_em: null } });
  assert(!hX.includes('<img'), 'motivo escapado');
  const fichaA = kbFichaHtml(F3, { gestor: false, agoraMs: Date.now(), opcoes: OPC });
  assert(fichaA.includes('id="kbCnpjRec"') && fichaA.includes('data-kb-cnpj-verificar'), 'ficha em andamento tem o bloco com o botão');
  assert(!kbFichaHtml(Object.assign({}, F3, { categoria: 'convertido' }), { gestor: false, agoraMs: Date.now(), opcoes: OPC }).includes('data-kb-cnpj-verificar'), 'ficha convertida sem botão');
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

- [ ] **Step 3: Run test to verify it fails**

Run: `node test_verificar_cnpj.js`
Expected: FAIL — `FALHA: ReferenceError: kbCnpjDigitos is not defined`

- [ ] **Step 4: Write minimal implementation**

In `_template.html`, CSS — right after the line `.kbFichaOutros{display:grid;…}`:

```css
  .kbCnpjRec{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);margin-top:var(--space-2);font-size:var(--fs-sm);}
  .kbCnpjRec:empty{display:none;}
  .kbCnpjRec .kbFichaAviso{flex-basis:100%;margin:0;}
```

In `kbFichaHtml`, replace:

```js
      <div class="kbFichaOutros">${copiar('E-mail', f.email)}${copiar('CNPJ', f.cnpj)}</div></div>`
```

with:

```js
      <div class="kbFichaOutros">${copiar('E-mail', f.email)}${copiar('CNPJ', f.cnpj)}</div><div class="kbCnpjRec" id="kbCnpjRec">${kbCnpjHtml(f, {})}</div></div>`
```

Right after the closing `}` of `kbFichaHtml` (before `const kbEstado = {`), add:

```js
// §127: situação do CNPJ do lead na Receita, só quando alguém clica (Edge Function verificar-cnpj; resultado em cnpj_consultas).
// Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
const KB_CNPJ_COLUNAS = ['novos', 'semlig', 'andamento', 'semresp'];
const KB_CNPJ_SELO = {
  ATIVA: ['ok', 'Ativa na Receita'], SUSPENSA: ['soon', 'Suspensa na Receita'], BAIXADA: ['late', 'Baixada na Receita'],
  INAPTA: ['late', 'Inapta na Receita'], NULA: ['late', 'Nula na Receita'], NAO_ENCONTRADO: ['late', 'CNPJ não existe na Receita: confira com o cliente'],
};
const KB_CNPJ_PROBLEMA = ['BAIXADA', 'INAPTA', 'NULA'];
function kbCnpjDigitos(v){ return String(v == null ? '' : v).replace(/\D/g, ''); }
function kbCnpjMostra(f){ return !!f && !f.livre && !!kbCnpjDigitos(f.cnpj) && KB_CNPJ_COLUNAS.includes(kbColunaDoLead(f)); }
function kbCnpjDataBR(iso){ const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; }
function kbCnpjSelo(c){
  const s = c && KB_CNPJ_SELO[c.situacao];
  if(!s) return null;
  const quando = c.situacao === 'NAO_ENCONTRADO' ? '' : kbDataHoraBR(c.consultado_em);
  return { classe: s[0], texto: s[1] + (quando ? ' · consultado ' + quando : '') };
}
function kbCnpjAviso(c){
  if(!c || !KB_CNPJ_PROBLEMA.includes(c.situacao)) return null;
  const desde = kbCnpjDataBR(c.situacao_desde);
  return { titulo: `Empresa ${c.situacao} na Receita${desde ? ' desde ' + desde : ''}`, motivo: c.motivo ? String(c.motivo).toLowerCase() : '',
    texto: 'Confirme com o cliente se ele tem outro CNPJ ativo antes de seguir.' };
}
function kbCnpjMsgErro(status){
  if(status === 403) return 'Só o dono do lead, o supervisor ou o admin podem verificar.';
  if(status === 422) return 'CNPJ inválido.';
  return 'Não foi possível consultar agora. Tente de novo em alguns minutos.';
}
function kbCnpjHtml(f, est){
  if(!kbCnpjMostra(f)) return '';
  const e = est || {}, dig = kbCnpjDigitos(f.cnpj);
  if(dig.length !== 14) return `<span class="kbMeta">CNPJ inválido (${dig.length} dígitos)</span>`;
  if(e.carregando) return '<button type="button" class="kbBtn kbBtnQ kbBtnSm" disabled>Consultando…</button>';
  const selo = kbCnpjSelo(e.consulta), aviso = kbCnpjAviso(e.consulta);
  const erro = e.erro ? `<span class="kbMeta">${escapeHtml(e.erro)}</span>` : '';
  if(!selo) return `<button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-cnpj-verificar>Verificar na Receita</button>${erro}`;
  const atalho = aviso && e.podeInapto ? ' <button type="button" class="kbLink" data-kb-cnpj-inapto>Classificar como CNPJ INAPTO</button>' : '';
  return `<span class="kbTag ${selo.classe}">${escapeHtml(selo.texto)}</span><button type="button" class="kbLink" data-kb-cnpj-verificar>Verificar de novo</button>${erro}`
    + (aviso ? `<p class="kbFichaAviso">⚠ <strong>${escapeHtml(aviso.titulo)}</strong>${aviso.motivo ? ' (motivo: ' + escapeHtml(aviso.motivo) + ')' : ''}. ${escapeHtml(aviso.texto)}${atalho}</p>` : '');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node test_verificar_cnpj.js && node test_meus_leads_redesign.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---` nos dois.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_verificar_cnpj.js
git commit -m "feat(meus-leads): selo e aviso do CNPJ na Receita na ficha (funcoes puras) (secao 127)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Ficha carrega o resultado salvo e o botão chama a função

**Files:**
- Modify: `_template.html` — `kbAbrirFicha` (~4436), listener de clique de `kbFichaNo()` (~4506), funções novas logo depois de `kbCnpjHtml` (Task 3).
- Test: `test_verificar_cnpj.js` (no marcador `// ==== mais testes entram aqui ====`)

**Interfaces:**
- Consumes: `kbCnpjMostra`, `kbCnpjDigitos`, `kbCnpjHtml`, `kbCnpjMsgErro` (Task 3); `kbFichaEl`, `kbFichaTrocarAba`, `kbClassEscolher`, `ppSeguro`, `sb`, `kbEstado.fichaAlvo/fichaLead/opcoes` (existentes); endpoint da Task 2.
- Produces: `kbCnpjPintar(est)`, `kbCnpjCarregar(aba, id) → Promise`, `kbCnpjVerificar(aba, id) → Promise`; `kbEstado.cnpjConsulta`.

- [ ] **Step 1: Write the failing test**

In `test_verificar_cnpj.js`, replace the line `  // ==== mais testes entram aqui ====` with:

```js
  // ==== Task 4: ficha de verdade ====
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = OPC;
  window.__tabelas.cnpj_consultas = [];
  window.__rpcRespostas.leads_kanban3 = { data: [Object.assign({}, F3), Object.assign({}, F3, { lead_id: 'f4', nome: 'Zz Segundo', cnpj: '00000000000132' })], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_ficha = (a) => ({ data: [Object.assign({}, F3, { lead_id: a.p_id, nome: a.p_id === 'f4' ? 'Zz Segundo' : 'Zz Padaria' })], error: null });
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: {}, resumo: { ligacoes: 3, atendidas: 1, cliques: 0, ultimo: null }, eventos: [] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  kbTrocarAba('quadro');
  await espera(60);
  const rec = () => document.getElementById('kbCnpjRec');
  const invocacoes = [];
  let resposta = { data: { ok: true, consulta: BAIXADA }, error: null };
  sb.functions.invoke = async (nome, op) => { invocacoes.push({ nome, body: op && op.body }); return typeof resposta === 'function' ? resposta() : resposta; };
  // nunca verificado: botão, e abrir a ficha não chama a função
  await kbAbrirFicha('OUTUBRO', 'f3', { forcar: true });
  await espera(40);
  assert(rec() && rec().querySelector('[data-kb-cnpj-verificar]') && rec().textContent.includes('Verificar na Receita'), 'ficha nova mostra o botão');
  eq(invocacoes.length, 0, 'abrir a ficha não consulta a Receita');
  // clique: chama a função com aba e lead, pinta selo e aviso
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  eq(invocacoes, [{ nome: 'verificar-cnpj', body: { aba: 'OUTUBRO', lead_id: 'f3' } }], 'clique chama verificar-cnpj com aba e lead_id (sem CNPJ)');
  assert(rec().textContent.includes('Baixada na Receita') && rec().textContent.includes('Empresa BAIXADA na Receita desde 12/03/2024'), 'selo e aviso de baixada');
  // atalho só preenche o status
  const nClass = window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length;
  rec().querySelector('[data-kb-cnpj-inapto]').click();
  eq(document.getElementById('kbClassStatus').value, 'CNPJ INAPTO', 'atalho escolhe CNPJ INAPTO');
  assert(!document.querySelector('#kbFicha [data-kb-ficha-pane="classificar"]').hidden, 'atalho mostra a aba Classificar');
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_classificar').length, nClass, 'atalho não salva');
  rec().querySelector('[data-kb-cnpj-inapto]').click();
  eq(document.getElementById('kbClassStatus').value, 'CNPJ INAPTO', 'clicar no atalho de novo não desfaz a escolha');
  // resultado salvo aparece ao abrir, sem consultar
  window.__tabelas.cnpj_consultas = [ATIVA];
  await kbAbrirFicha('OUTUBRO', 'f4', { forcar: true });
  await espera(40);
  assert(rec().textContent.includes('Ativa na Receita') && rec().textContent.includes('Verificar de novo'), 'consulta salva aparece ao abrir');
  eq(invocacoes.length, 1, 'abrir com consulta salva não chama a função');
  // erro ao verificar de novo: mantém o selo e mostra a mensagem
  resposta = { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 503 } } };
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  assert(rec().textContent.includes('Ativa na Receita') && rec().textContent.includes('Não foi possível consultar agora'), 'erro 503: selo fica e aparece a mensagem');
  resposta = { data: null, error: { message: 'x', context: { status: 403 } } };
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(40);
  assert(rec().textContent.includes('Só o dono do lead'), 'erro 403: mensagem de permissão');
  // trocar de lead durante a consulta: o resultado não vai para o lead errado
  window.__tabelas.cnpj_consultas = [];
  let soltar;
  resposta = () => new Promise(r => { soltar = () => r({ data: { ok: true, consulta: BAIXADA }, error: null }); });
  rec().querySelector('[data-kb-cnpj-verificar]').click();
  await espera(10);
  await kbAbrirFicha('OUTUBRO', 'f3', { forcar: true });
  await espera(40);
  soltar();
  await espera(40);
  assert(kbEstado.fichaAlvo.id === 'f3' && !rec().textContent.includes('Baixada') && rec().querySelector('[data-kb-cnpj-verificar]'), 'resposta atrasada do outro lead não pinta esta ficha');
  // tabela ainda não criada: ficha abre normal com o botão
  const fromOrig = sb.from;
  sb.from = (t) => t === 'cnpj_consultas'
    ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'relation "cnpj_consultas" does not exist' } }) }) }) }
    : fromOrig(t);
  await kbAbrirFicha('OUTUBRO', 'f4', { forcar: true });
  await espera(40);
  assert(rec().querySelector('[data-kb-cnpj-verificar]') && document.getElementById('kbFichaResumo'), 'sem a tabela: ficha abre e o botão fica');
  sb.from = fromOrig;
  kbFecharFicha(true);
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test_verificar_cnpj.js`
Expected: FAIL — `FALHOU: clique chama verificar-cnpj com aba e lead_id (sem CNPJ)` (o clique ainda não faz nada) e os seguintes.

- [ ] **Step 3: Write minimal implementation**

Right after `kbCnpjHtml` (Task 3), add:

```js
function kbCnpjMesmaFicha(aba, id){ return !!kbEstado.fichaAlvo && kbEstado.fichaAlvo.aba === aba && kbEstado.fichaAlvo.id === id; }
function kbCnpjPintar(est){
  const no = kbFichaEl('kbCnpjRec'), f = kbEstado.fichaLead;
  if(!no || !f) return;
  no.innerHTML = kbCnpjHtml(f, Object.assign({ podeInapto: (kbEstado.opcoes || []).some(o => o.status === 'CNPJ INAPTO') }, est));
}
// Ao abrir a ficha: mostra a última consulta salva daquele CNPJ (qualquer lead). Sem tabela ou com erro, fica o botão.
async function kbCnpjCarregar(aba, id){
  kbEstado.cnpjConsulta = null;
  const f = kbEstado.fichaLead, dig = kbCnpjDigitos(f && f.cnpj);
  if(!kbCnpjMostra(f) || dig.length !== 14) return;
  const r = await ppSeguro(() => sb.from('cnpj_consultas').select('situacao,situacao_desde,motivo,consultado_em').eq('cnpj', dig).maybeSingle());
  if(!kbCnpjMesmaFicha(aba, id) || !r || r.error || !r.data) return;
  kbEstado.cnpjConsulta = r.data;
  kbCnpjPintar({ consulta: r.data });
}
async function kbCnpjVerificar(aba, id){
  const antes = kbEstado.cnpjConsulta || null;
  kbCnpjPintar({ carregando: true });
  const r = await ppSeguro(() => sb.functions.invoke('verificar-cnpj', { body: { aba, lead_id: id } }));
  if(!kbCnpjMesmaFicha(aba, id)) return;   // trocou de lead no meio: não pinta o resultado no lead errado
  if(r && !r.error && r.data && r.data.ok && r.data.consulta){ kbEstado.cnpjConsulta = r.data.consulta; kbCnpjPintar({ consulta: r.data.consulta }); return; }
  const status = r && r.error && r.error.context ? r.error.context.status : null;
  kbCnpjPintar({ consulta: antes, erro: kbCnpjMsgErro(status) });
}
```

In `kbAbrirFicha`, replace:

```js
  if(sel) sel.addEventListener('change', kbClassAjustar);
```

with:

```js
  if(sel) sel.addEventListener('change', kbClassAjustar);
  kbCnpjCarregar(aba, id);   // §127: sem await — não atrasa o resumo e o histórico
```

In the `kbFichaNo().addEventListener('click', …)` handler, right after the line that starts with `  if(cp){ try {` (copiar), add:

```js
  if(e.target.closest('[data-kb-cnpj-verificar]')){ kbCnpjVerificar(alvo.aba, alvo.id); return; }
  if(e.target.closest('[data-kb-cnpj-inapto]')){
    kbFichaTrocarAba('classificar');
    const st = kbFichaEl('kbClassStatus');
    if(st && st.value !== 'CNPJ INAPTO') kbClassEscolher('CNPJ INAPTO');   // só preenche; quem salva é o consultor
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test_verificar_cnpj.js && node test_meus_leads_redesign.js`
Expected: `0 falharam` nos dois.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_verificar_cnpj.js
git commit -m "feat(meus-leads): botao Verificar na Receita na ficha e resultado salvo ao abrir (secao 127)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificação, prévia, ida ao ar e REGRAS §127

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (seção nova §127 no fim, depois da §126.3; e a linha no histórico de mudanças no mesmo formato das últimas)
- Generated: `painel_clientes_apex.html` (via `build_painel.py`)

Cada passo de ida ao ar (banco, função, painel, push) **só com ok do Rafael naquele momento**.

- [ ] **Step 1: Suíte completa**

Run: `bash run_tests.sh; (cd supabase/functions/verificar-cnpj && node --test verificar.test.ts)`
Expected: tudo ok, exceto os instáveis conhecidos por tempo (`test_leads_followups.js`, `test_conversao_vendas.js`) — se falharem, rodar isolados e confirmar que passam.

- [ ] **Step 2: Revisão de código do branch**

Usar superpowers:requesting-code-review no diff `oficial/main...HEAD`. Corrigir Critical/Important; registrar minors adiados no ledger `C:/Users/acer1/Downloads/apex-smart-solutions/.superpowers/verificar-cnpj/ledger.md`.

- [ ] **Step 3: Prévia para o Rafael**

Build (`python build_painel.py`), copiar `painel_clientes_apex.html` para o scratchpad, trocar o `<script src=…supabase.js>` pelo `previa_mock.js` de `C:/Users/acer1/Downloads/apex-smart-solutions/.superpowers/meus-leads-redesign/` e acrescentar ao mock `functions.invoke('verificar-cnpj')` devolvendo, por lead, ATIVA / SUSPENSA / BAIXADA / NAO_ENCONTRADO / erro 503. Abrir no navegador, capturar a ficha em cada estado (inclusive a ficha flutuante e tela estreita) e mostrar ao Rafael. Conferir `<div>`/`</div>` balanceadas no trecho mexido.

- [ ] **Step 4: Banco (com ok)**

Aplicar o conteúdo de `supabase/migrations/20261029120000_cnpj_consultas.sql` com `execute_sql` dentro de `begin; … commit;` (não usar `apply_migration`). Conferir:

```sql
select relrowsecurity from pg_class where relname = 'cnpj_consultas';
select policyname, cmd, roles from pg_policies where tablename = 'cnpj_consultas';
```

Expected: `true`; uma policy `cnpj_consultas_ler`, `SELECT`, `{authenticated}`.

- [ ] **Step 5: Edge Function (com ok)**

`deploy_edge_function` nome `verificar-cnpj`, `verify_jwt: true`, arquivos `index.ts` e `verificar.ts`. Teste de fumaça sem login:

Run: `curl -s -o /dev/null -w "%{http_code}" -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/verificar-cnpj`
Expected: `401`

- [ ] **Step 6: Painel (com ok)**

Seguir o procedimento da memória "Publicação do painel": comparar o painel do ar com o build da `oficial/main` (MD5 do ar deve ser `91def474…`, a §126.3, ou explicar a diferença), backup em `~/deploy_backups/painel_clientes_apex_<data>_antes_verificar_cnpj.html`, envio com MD5 do ar no mesmo comando, vigia `-Aceitar`.

- [ ] **Step 7: Teste real**

Com o Rafael (ou um consultor), abrir um lead em aberto no painel publicado e clicar em "Verificar na Receita". Conferir o selo, a linha em `cnpj_consultas` (`select situacao, fonte, consultado_em from cnpj_consultas order by consultado_em desc limit 1`) e o log da função (`get_logs` edge-function: só status/fonte/situação).

- [ ] **Step 8: REGRAS §127 e push**

Escrever a §127 no `REGRAS_NEGOCIO.md` (o que faz, onde aparece, quem pode, colunas com botão, tabela `cnpj_consultas`, função `verificar-cnpj`, fontes e cache, o que não faz — sem verificação automática nem selo no Quadro —, MD5 publicado e backup) e a linha no histórico. Depois:

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): verificar CNPJ na Receita pela ficha do lead (secao 127)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git fetch oficial && git rebase oficial/main && bash run_tests.sh test_verificar_cnpj.js && git push oficial HEAD:main
```

Expected: push sem force aceito. Se o rebase conflitar em `_template.html`, resolver juntando (nunca sobrescrever) e rodar os testes de novo.
