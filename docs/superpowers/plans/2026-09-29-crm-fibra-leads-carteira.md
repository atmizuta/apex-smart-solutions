# CRM Fibra — Leads & Carteira Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give consultants a real "carteira" of leads inside `crm-fibra`: a live-segmented list pulled from `public.clientes`, a dashboard of counts per segment, a lead detail page where a consultant can claim a lead, log contact attempts, and send a WhatsApp message — with no AI-generated content yet (that's a later plan).

**Architecture:** Adds a `crm_fibra.leads_segmentados` SQL view that computes segmentation live from `public.clientes` (zero copying, always current) plus two new tables (`atribuicoes` for lead ownership, `mensagens` for contact history). A thin data-access module (`lib/leads.ts`) wraps the view/tables; three pages (dashboard, carteira, lead detail) and their server actions build on it, reusing Plan 1's auth (`getSupabaseAdmin`, session, `buscarConsultorPorId`).

**Tech Stack:** Same as Plan 1 — Next.js 16 App Router, `@supabase/supabase-js` (server-only), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-crm-leads-fibra-renovacao-design.md`

## Known limitation carried from planning (not fixed by this plan)

`public.clientes` (the Supabase mirror of the client base, already used by this and the existing painel) has fewer columns than the original source spreadsheet analyzed on 2026-09-25 — it has `cep_cabeado`, `linhas_fixas`, `apto_renovacao`, and `arpu`, but **not** `DSC_SITUACAO_COMERCIAL`, `HP LIVRE VENDA`, or `situacaoCadastral`. This means the segmentation this plan can build is coarser than the original 5-list breakdown: fibra candidates can only be split into "viable" (cabled + no broadband) vs. not — the finer readiness tiers (ready now / awaiting capacity check / awaiting status) and the CNPJ-irregular list are **not reproducible from live data today**. This plan does not attempt to fake that distinction; it segments on what actually exists. Extending `public.clientes`'s sync to carry the missing columns is out of scope here (it belongs to the existing painel's ingestion code, not `crm-fibra`).

Also carried from planning: as of 2026-09-29, `public.clientes` itself was found corrupted in production (a bad re-sync on 2026-09-28 replaced 6,532 good rows with 1,010 rows with shifted columns) — confirmed via `public.clientes_movimentacao`'s audit log, which still holds full correct snapshots of all 6,532 rows. The user asked to proceed with writing this plan without restoring the table yet. **This plan's automated tests never touch the live table** (they use a mocked Supabase client, same pattern as Plan 1), so they're unaffected either way — but the manual verification checklist (Task 10) requires the table to actually be restored to its correct state first, and this plan's migration (Task 1) should be applied only after that restoration, or its view will compute segmentation over corrupted rows. Flag this to the user before running Task 1's live migration step if the table hasn't been fixed by then.

## Global Constraints

- All new objects live in Postgres schema `crm_fibra` inside Supabase project `mdgfboijyqfkggcrhptn` — never in `public`. `public.clientes` is read-only from this plan's perspective (only ever `SELECT`ed via the view, never written).
- Every new `crm_fibra` table has RLS enabled with zero grants to `anon`/`authenticated`; `service_role` gets explicit `USAGE`/`SELECT`/`INSERT`/`UPDATE`/`DELETE` grants in the same migration that creates the objects — Plan 1's final review found a Critical bug (C1) from skipping this the first time; this plan does not repeat that mistake.
- All database access from application code goes through `getSupabaseAdmin()` (Plan 1, `lib/supabase-admin.ts`) — never a new client construction.
- All protected pages/actions re-derive the session via `verifySessionToken` + `buscarConsultorPorId` (Plan 1) — never trust a client-supplied identity.
- A lead can have at most one owner at a time (`atribuicoes.cnpj_digits` is `unique`) — a second consultant attempting to claim an already-owned lead must get a clear, catchable error, never a silent overwrite or a raw Postgres error.
- User-supplied search text must never be interpolated unescaped into a PostgREST filter string — it must be sanitized first.

## Review Focus

1. **Phone data that's blank, the literal string `"0"`, or missing an area code** (all seen in the real client base) — `normalizarTelefone` must return `null` rather than producing a broken `wa.me` link, so the UI can show a manual-contact fallback instead of a dead button.
2. **Two consultants claiming the same lead at nearly the same time** — the second `atribuirLead` call must fail with a specific, user-facing error (not a crash, not a silent double-assignment), because `atribuicoes.cnpj_digits` is unique.
3. **Search text containing PostgREST filter syntax characters** (`,`, `(`, `)`, `%`, `*`) — must not break the `.or(...)` filter or return unintended rows; must be sanitized before use.
4. **Submitting a blank or whitespace-only message** — must be rejected before any database write, with a clear inline error, not a row full of empty content.
5. **A lead with no phone number at all** — the detail page must show a manual-contact message instead of a WhatsApp button that opens a broken link.

---

## Task 1: Migration — `atribuicoes`, `mensagens`, `leads_segmentados` view

**Files:**
- Modify: `crm-fibra/db/schema.sql` (append; file is documented as idempotent, safe to re-run)

**Interfaces:**
- Produces: tables `crm_fibra.atribuicoes`, `crm_fibra.mensagens`, and view `crm_fibra.leads_segmentados` in Supabase project `mdgfboijyqfkggcrhptn` — consumed by every task from Task 3 onward.

**⚠️ This step writes to the same live Supabase project the production painel uses. Confirm with the user before running Step 2 against the live project — and confirm `public.clientes` has been restored to its correct 6,532-row state first (see "Known limitation" above), since this view computes segmentation directly from that table.**

- [ ] **Step 1: Append the migration SQL**

```sql
-- Task 2 (Leads & Carteira) additions — idempotent, safe to run again.

create table if not exists crm_fibra.atribuicoes (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null unique,
  consultor_id uuid not null references crm_fibra.consultores(id),
  status_contato text not null default 'nao_contatado'
    check (status_contato in ('nao_contatado','tentativa_1','tentativa_2','tentativa_3','respondeu','sem_resposta')),
  atribuido_em timestamptz not null default now(),
  ultimo_contato_em timestamptz
);

alter table crm_fibra.atribuicoes enable row level security;

create table if not exists crm_fibra.mensagens (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','ligacao','email')),
  conteudo text not null,
  gerado_por_ia boolean not null default false,
  abordagem_tipo text,
  enviado_em timestamptz not null default now()
);

alter table crm_fibra.mensagens enable row level security;

create or replace view crm_fibra.leads_segmentados as
select
  c.cnpj_digits,
  c.razao_social,
  c.cidade,
  c.ddd,
  c.tel1,
  c.tel2,
  c.telefone_contato,
  c.email,
  c.arpu,
  c.apto_renovacao,
  c.cep_cabeado,
  c.linhas_fixas,
  case
    when c.cep_cabeado = 'CEP Cabeado' and coalesce(c.linhas_fixas, 0) = 0
      then 'fibra_candidato'
    else null
  end as camada_fibra,
  case
    when c.apto_renovacao = 'APTO' then 'apto_agora'
    when c.apto_renovacao = '1 MÊS PARA APTO' then 'apto_1_mes'
    when c.apto_renovacao = '2 MESES PARA APTO' then 'apto_2_meses'
    else null
  end as camada_renovacao,
  a.consultor_id as dono_consultor_id,
  a.status_contato,
  a.atribuido_em,
  a.ultimo_contato_em
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits
where c.cnpj_digits is not null and c.cnpj_digits <> '';

-- Explicit grants: Plan 1's final review found that Supabase's automatic
-- grants only cover the public schema, and `alter default privileges` only
-- auto-applies to objects created afterward by the *same* role — grant
-- explicitly here too so this migration is correct regardless of which
-- role applies it.
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;
grant select on crm_fibra.leads_segmentados to service_role;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the Supabase MCP tool `apply_migration` with `project_id: "mdgfboijyqfkggcrhptn"`, `name: "crm_fibra_leads_carteira"`, and `query` set to the SQL above. Confirm with the user first, and confirm `public.clientes` is in its correct (non-corrupted) state before running this.

- [ ] **Step 3: Verify live**

Use `list_tables` with `project_id: "mdgfboijyqfkggcrhptn"`, `schemas: ["crm_fibra"]`, `verbose: true` — expect `atribuicoes` and `mensagens` with `rls_enabled: true`. Then run this read-only check via `execute_sql` to confirm the view and grants work end to end:

```sql
select
  has_schema_privilege('service_role','crm_fibra','USAGE') as usage_ok,
  has_table_privilege('service_role','crm_fibra.leads_segmentados','SELECT') as view_select_ok,
  (select count(*) from crm_fibra.leads_segmentados) as total_leads,
  (select count(*) from crm_fibra.leads_segmentados where camada_fibra = 'fibra_candidato') as fibra_candidatos,
  (select count(*) from crm_fibra.leads_segmentados where camada_renovacao = 'apto_agora') as apto_agora;
```

Expected: `usage_ok`/`view_select_ok` both `true`; `total_leads` around 6,235 (active clients); `fibra_candidatos` and `apto_agora` roughly matching the 2026-09-25 analysis (191–451 and 1,047 respectively, depending on exact live state) — wildly different numbers (e.g. `total_leads` near 1,010) mean the table wasn't actually restored yet, and this migration's view is now computing over corrupted data; stop and tell the user rather than proceeding.

- [ ] **Step 4: Commit**

```bash
git add crm-fibra/db/schema.sql
git commit -m "feat(crm-fibra): add atribuicoes, mensagens tables and leads_segmentados view"
```

---

## Task 2: Phone normalization and WhatsApp link module

**Files:**
- Create: `crm-fibra/lib/whatsapp.ts`
- Test: `crm-fibra/lib/whatsapp.test.ts`

**Interfaces:**
- Produces: `normalizarTelefone(input: { ddd?, tel1?, tel2?, telefoneContato? }): string | null`, `montarLinkWhatsapp(telefoneE164: string, mensagem: string): string` — consumed by Task 7 (lead detail page) and Task 9 (message form).

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/lib/whatsapp.test.ts
import { describe, it, expect } from "vitest";
import { normalizarTelefone, montarLinkWhatsapp } from "./whatsapp";

describe("normalizarTelefone", () => {
  it("usa telefoneContato quando já tem DDD (11 dígitos)", () => {
    expect(normalizarTelefone({ telefoneContato: "19991002213" })).toBe("5519991002213");
  });

  it("usa tel1 com 10 dígitos (fixo com DDD)", () => {
    expect(normalizarTelefone({ tel1: "1733224002" })).toBe("551733224002");
  });

  it("ignora telefoneContato = '0' e cai pro tel1", () => {
    expect(normalizarTelefone({ telefoneContato: "0", tel1: "19991002213" })).toBe("5519991002213");
  });

  it("ignora campos vazios e cai pro próximo candidato", () => {
    expect(normalizarTelefone({ telefoneContato: "", tel1: "", tel2: "1233023106" })).toBe("551233023106");
  });

  it("combina ddd + número de 8-9 dígitos quando não há DDD embutido", () => {
    expect(normalizarTelefone({ ddd: "19", tel1: "35737700" })).toBe("551935737700");
  });

  it("não combina número sem DDD quando o campo ddd também está vazio", () => {
    expect(normalizarTelefone({ ddd: "", tel1: "35737700" })).toBeNull();
  });

  it("aceita número que já vem com código do país 55", () => {
    expect(normalizarTelefone({ telefoneContato: "5519991002213" })).toBe("5519991002213");
  });

  it("retorna null quando nenhum campo tem telefone utilizável", () => {
    expect(normalizarTelefone({ ddd: "", tel1: "0", tel2: "", telefoneContato: "" })).toBeNull();
  });

  it("remove caracteres não numéricos antes de avaliar o tamanho", () => {
    expect(normalizarTelefone({ telefoneContato: "(17) 99229-3873" })).toBe("5517992293873");
  });
});

describe("montarLinkWhatsapp", () => {
  it("monta o link wa.me com o texto codificado", () => {
    const link = montarLinkWhatsapp("5519991002213", "Olá, tudo bem?");
    expect(link).toBe("https://wa.me/5519991002213?text=Ol%C3%A1%2C%20tudo%20bem%3F");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run lib/whatsapp.test.ts`
Expected: FAIL — `Cannot find module './whatsapp'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/lib/whatsapp.ts

// Normalizes messy Brazilian phone data from public.clientes (blank
// fields, a literal "0" placeholder, numbers with or without area code,
// numbers already carrying the 55 country code) into a wa.me-ready
// international number (digits only) — or null when nothing usable is
// found, so the caller can show a manual-contact fallback instead of a
// broken link.
export function normalizarTelefone(input: {
  ddd?: string | null;
  tel1?: string | null;
  tel2?: string | null;
  telefoneContato?: string | null;
}): string | null {
  const candidatos = [input.telefoneContato, input.tel1, input.tel2];

  for (const candidato of candidatos) {
    const digitos = somenteDigitos(candidato);
    if (!digitos || digitos === "0") continue;

    if (digitos.length >= 12 && digitos.startsWith("55")) {
      return digitos;
    }

    if (digitos.length === 10 || digitos.length === 11) {
      return `55${digitos}`;
    }

    if (digitos.length === 8 || digitos.length === 9) {
      const ddd = somenteDigitos(input.ddd);
      if (ddd.length === 2) {
        return `55${ddd}${digitos}`;
      }
    }
  }

  return null;
}

function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

export function montarLinkWhatsapp(telefoneE164: string, mensagem: string): string {
  return `https://wa.me/${telefoneE164}?text=${encodeURIComponent(mensagem)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run lib/whatsapp.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/whatsapp.ts crm-fibra/lib/whatsapp.test.ts
git commit -m "feat(crm-fibra): add phone normalization and WhatsApp link helper"
```

---

## Task 3: Leads data-access module — read functions

**Files:**
- Create: `crm-fibra/lib/leads.ts`
- Test: `crm-fibra/lib/leads.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks besides types (this task defines its own).
- Produces: `interface LeadSegmentado { cnpjDigits, razaoSocial, cidade, ddd, tel1, tel2, telefoneContato, email, arpu, aptoRenovacao, cepCabeado, linhasFixas, camadaFibra, camadaRenovacao, donoConsultorId, statusContato, atribuidoEm, ultimoContatoEm }`, `type FiltroCamada = "fibra_candidato" | "apto_agora" | "apto_1_mes" | "apto_2_meses" | "sem_dono" | "todos"`, `listarLeadsSegmentados(client, filtro, busca?): Promise<LeadSegmentado[]>`, `contarPorCamada(client): Promise<ContagemCamadas>`, `buscarLeadPorCnpj(client, cnpjDigits): Promise<LeadSegmentado | null>` — consumed by Task 5 (dashboard), Task 6 (carteira), Task 7 (lead detail). Task 4 adds write functions to this same file.

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/lib/leads.test.ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarLeadsSegmentados,
  contarPorCamada,
  buscarLeadPorCnpj,
} from "./leads";

function makeQueryFake(terminal: () => Promise<{ data?: unknown; error?: unknown }>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: any = {
    calls,
    schema: (...a: unknown[]) => { calls.push({ method: "schema", args: a }); return q; },
    from: (...a: unknown[]) => { calls.push({ method: "from", args: a }); return q; },
    select: (...a: unknown[]) => { calls.push({ method: "select", args: a }); return q; },
    eq: (...a: unknown[]) => { calls.push({ method: "eq", args: a }); return q; },
    is: (...a: unknown[]) => { calls.push({ method: "is", args: a }); return q; },
    or: (...a: unknown[]) => { calls.push({ method: "or", args: a }); return q; },
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return terminal(); },
    maybeSingle: () => terminal(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => terminal().then(resolve, reject),
  };
  return q;
}

const rowBase = {
  cnpj_digits: "00005087000190",
  razao_social: "NABAS & CAMARGO LTDA",
  cidade: "AMERICANA",
  ddd: "19",
  tel1: "1935737700",
  tel2: "",
  telefone_contato: "19991002213",
  email: "x@y.com",
  arpu: 50.97,
  apto_renovacao: "APTO",
  cep_cabeado: "CEP Cabeado",
  linhas_fixas: 0,
  camada_fibra: "fibra_candidato",
  camada_renovacao: "apto_agora",
  dono_consultor_id: null,
  status_contato: null,
  atribuido_em: null,
  ultimo_contato_em: null,
};

describe("listarLeadsSegmentados", () => {
  it("mapeia as linhas para o formato da aplicação", async () => {
    const client = makeQueryFake(async () => ({ data: [rowBase], error: null }));
    const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(result).toEqual([
      {
        cnpjDigits: "00005087000190",
        razaoSocial: "NABAS & CAMARGO LTDA",
        cidade: "AMERICANA",
        ddd: "19",
        tel1: "1935737700",
        tel2: "",
        telefoneContato: "19991002213",
        email: "x@y.com",
        arpu: 50.97,
        aptoRenovacao: "APTO",
        cepCabeado: "CEP Cabeado",
        linhasFixas: 0,
        camadaFibra: "fibra_candidato",
        camadaRenovacao: "apto_agora",
        donoConsultorId: null,
        statusContato: null,
        atribuidoEm: null,
        ultimoContatoEm: null,
      },
    ]);
  });

  it("filtra por camada_fibra quando filtro = fibra_candidato", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "fibra_candidato");
    expect(client.calls).toContainEqual({ method: "eq", args: ["camada_fibra", "fibra_candidato"] });
  });

  it("filtra por dono_consultor_id nulo quando filtro = sem_dono", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "sem_dono");
    expect(client.calls).toContainEqual({ method: "is", args: ["dono_consultor_id", null] });
  });

  it("sanitiza texto de busca removendo caracteres especiais do PostgREST antes do ilike", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", "Acme, (Ltda) 100%*");
    const orCall = client.calls.find((c: { method: string }) => c.method === "or");
    const filtro = orCall.args[0] as string;
    // The raw special characters from the search text must never survive
    // into the filter string...
    expect(filtro).not.toContain(",(");
    expect(filtro).not.toContain(")");
    expect(filtro).not.toContain("100%");
    expect(filtro).not.toContain("*");
    // ...while the actual search words still come through...
    expect(filtro).toContain("Acme");
    expect(filtro).toContain("Ltda");
    expect(filtro).toContain("100");
    // ...and the filter still has exactly 3 comma-separated ilike clauses
    // (one per column) — proving the user's own comma didn't add a 4th.
    expect(filtro.split(",")).toHaveLength(3);
  });

  it("não chama .or() quando não há texto de busca", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(client.calls.find((c: { method: string }) => c.method === "or")).toBeUndefined();
  });
});

describe("contarPorCamada", () => {
  it("conta cada camada e o total, sem contar por dono duplicado", async () => {
    const rows = [
      { camada_fibra: "fibra_candidato", camada_renovacao: null, dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: "apto_agora", dono_consultor_id: "c1" },
      { camada_fibra: null, camada_renovacao: "apto_1_mes", dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: "apto_2_meses", dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: null, dono_consultor_id: null },
    ];
    // No override needed here: contarPorCamada awaits the chain right
    // after .select(...) with no further method call, and the fake's
    // default .then() already resolves via `terminal()` for exactly that
    // shape — see the other describe blocks for chains that DO need an
    // override (they terminate on .insert()/.single() instead).
    const client = makeQueryFake(async () => ({ data: rows, error: null }));
    const result = await contarPorCamada(client as unknown as SupabaseClient);
    expect(result).toEqual({
      fibraCandidato: 1,
      aptoAgora: 1,
      apto1Mes: 1,
      apto2Meses: 1,
      semDono: 4,
      total: 5,
    });
  });
});

describe("buscarLeadPorCnpj", () => {
  it("retorna null quando não encontra o CNPJ", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00000000000000")
    ).toBeNull();
  });

  it("retorna o lead mapeado quando encontra", async () => {
    const client = makeQueryFake(async () => ({ data: rowBase, error: null }));
    const result = await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(result?.cnpjDigits).toBe("00005087000190");
    expect(result?.razaoSocial).toBe("NABAS & CAMARGO LTDA");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run lib/leads.test.ts`
Expected: FAIL — `Cannot find module './leads'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/lib/leads.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadSegmentado {
  cnpjDigits: string;
  razaoSocial: string;
  cidade: string | null;
  ddd: string | null;
  tel1: string | null;
  tel2: string | null;
  telefoneContato: string | null;
  email: string | null;
  arpu: number | null;
  aptoRenovacao: string | null;
  cepCabeado: string | null;
  linhasFixas: number | null;
  camadaFibra: "fibra_candidato" | null;
  camadaRenovacao: "apto_agora" | "apto_1_mes" | "apto_2_meses" | null;
  donoConsultorId: string | null;
  statusContato: string | null;
  atribuidoEm: string | null;
  ultimoContatoEm: string | null;
}

interface LeadRow {
  cnpj_digits: string;
  razao_social: string;
  cidade: string | null;
  ddd: string | null;
  tel1: string | null;
  tel2: string | null;
  telefone_contato: string | null;
  email: string | null;
  arpu: number | null;
  apto_renovacao: string | null;
  cep_cabeado: string | null;
  linhas_fixas: number | null;
  camada_fibra: "fibra_candidato" | null;
  camada_renovacao: "apto_agora" | "apto_1_mes" | "apto_2_meses" | null;
  dono_consultor_id: string | null;
  status_contato: string | null;
  atribuido_em: string | null;
  ultimo_contato_em: string | null;
}

function toLead(row: LeadRow): LeadSegmentado {
  return {
    cnpjDigits: row.cnpj_digits,
    razaoSocial: row.razao_social,
    cidade: row.cidade,
    ddd: row.ddd,
    tel1: row.tel1,
    tel2: row.tel2,
    telefoneContato: row.telefone_contato,
    email: row.email,
    arpu: row.arpu,
    aptoRenovacao: row.apto_renovacao,
    cepCabeado: row.cep_cabeado,
    linhasFixas: row.linhas_fixas,
    camadaFibra: row.camada_fibra,
    camadaRenovacao: row.camada_renovacao,
    donoConsultorId: row.dono_consultor_id,
    statusContato: row.status_contato,
    atribuidoEm: row.atribuido_em,
    ultimoContatoEm: row.ultimo_contato_em,
  };
}

export type FiltroCamada =
  | "fibra_candidato"
  | "apto_agora"
  | "apto_1_mes"
  | "apto_2_meses"
  | "sem_dono"
  | "todos";

// Strips characters PostgREST's filter grammar treats specially (comma
// separates filters, parens group them, % and * are ILIKE/wildcard
// tokens) so user-typed search text can never restructure the .or()
// filter or inject unintended wildcards.
function sanitizarBusca(busca: string): string {
  return busca.replace(/[,()%*]/g, " ").trim();
}

export async function listarLeadsSegmentados(
  client: SupabaseClient,
  filtro: FiltroCamada,
  busca?: string
): Promise<LeadSegmentado[]> {
  let query = client.schema("crm_fibra").from("leads_segmentados").select();

  if (filtro === "fibra_candidato") {
    query = query.eq("camada_fibra", "fibra_candidato");
  } else if (filtro === "apto_agora" || filtro === "apto_1_mes" || filtro === "apto_2_meses") {
    query = query.eq("camada_renovacao", filtro);
  } else if (filtro === "sem_dono") {
    query = query.is("dono_consultor_id", null);
  }

  const buscaLimpa = busca ? sanitizarBusca(busca) : "";
  if (buscaLimpa) {
    query = query.or(
      `razao_social.ilike.%${buscaLimpa}%,cidade.ilike.%${buscaLimpa}%,cnpj_digits.ilike.%${buscaLimpa}%`
    );
  }

  const { data, error } = await query.order("razao_social", { ascending: true });
  if (error) throw error;
  return (data as LeadRow[]).map(toLead);
}

export interface ContagemCamadas {
  fibraCandidato: number;
  aptoAgora: number;
  apto1Mes: number;
  apto2Meses: number;
  semDono: number;
  total: number;
}

export async function contarPorCamada(client: SupabaseClient): Promise<ContagemCamadas> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("leads_segmentados")
    .select("camada_fibra, camada_renovacao, dono_consultor_id");

  if (error) throw error;
  const rows = data as Array<{
    camada_fibra: string | null;
    camada_renovacao: string | null;
    dono_consultor_id: string | null;
  }>;

  return {
    fibraCandidato: rows.filter((r) => r.camada_fibra === "fibra_candidato").length,
    aptoAgora: rows.filter((r) => r.camada_renovacao === "apto_agora").length,
    apto1Mes: rows.filter((r) => r.camada_renovacao === "apto_1_mes").length,
    apto2Meses: rows.filter((r) => r.camada_renovacao === "apto_2_meses").length,
    semDono: rows.filter((r) => !r.dono_consultor_id).length,
    total: rows.length,
  };
}

export async function buscarLeadPorCnpj(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<LeadSegmentado | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("leads_segmentados")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .maybeSingle();

  if (error) throw error;
  return data ? toLead(data as LeadRow) : null;
}
```

Note: the `contarPorCamada` test overrides `client.select`/`client.then` directly because that function's query has no `.order()` (its only terminal call is the initial `.select(...)` being awaited directly) — this differs from `listarLeadsSegmentados`/`buscarLeadPorCnpj`, which both terminate in `.order()`/`.maybeSingle()`. This is intentional, not a bug in the fake.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run lib/leads.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/leads.ts crm-fibra/lib/leads.test.ts
git commit -m "feat(crm-fibra): add leads read functions with search sanitization"
```

---

## Task 4: Leads data-access module — write functions

**Files:**
- Modify: `crm-fibra/lib/leads.ts` (append)
- Modify: `crm-fibra/lib/leads.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `class LeadJaAtribuidoError extends Error`, `atribuirLead(client, cnpjDigits, consultorId): Promise<void>`, `interface Mensagem { id, cnpjDigits, consultorId, canal, conteudo, geradoPorIa, abordagemTipo, enviadoEm }`, `listarMensagens(client, cnpjDigits): Promise<Mensagem[]>`, `registrarMensagem(client, input): Promise<Mensagem>` — consumed by Task 7 (lead detail, read side) and Task 8 (server actions, write side).

- [ ] **Step 1: Extend the shared fake, then write the failing tests (append to leads.test.ts)**

Task 3's `makeQueryFake` only covers the read-side chain (`schema/from/select/eq/is/or/order/maybeSingle`). The write functions in this task also call `.insert(...)` and, for `registrarMensagem`, `.select().single()` — extend the helper with both, following the exact same capture pattern Plan 1's `consultores.test.ts` used for its own `insert`. Find this block inside `makeQueryFake`:

```ts
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return terminal(); },
    maybeSingle: () => terminal(),
```

and change it to:

```ts
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return terminal(); },
    maybeSingle: () => terminal(),
    single: () => terminal(),
    insert: (payload: unknown) => { q.__inserted = payload; return q; },
```

Now append the new tests, which rely on those defaults rather than re-overriding methods per test:

```ts
// append to crm-fibra/lib/leads.test.ts — add this import to the existing import line:
// import { listarLeadsSegmentados, contarPorCamada, buscarLeadPorCnpj, atribuirLead, LeadJaAtribuidoError, listarMensagens, registrarMensagem } from "./leads";

describe("atribuirLead", () => {
  it("insere a atribuição com o cnpj e o consultor", async () => {
    const client = makeQueryFake(async () => ({ error: null }));
    await atribuirLead(client as unknown as SupabaseClient, "00005087000190", "consultor-1");
    expect(client.__inserted).toEqual({ cnpj_digits: "00005087000190", consultor_id: "consultor-1" });
  });

  it("lança LeadJaAtribuidoError em conflito (código 23505)", async () => {
    const client = makeQueryFake(async () => ({ error: { code: "23505", message: "duplicate key" } }));
    await expect(
      atribuirLead(client as unknown as SupabaseClient, "00005087000190", "consultor-1")
    ).rejects.toThrow(LeadJaAtribuidoError);
  });
});

describe("listarMensagens", () => {
  it("mapeia mensagens em ordem decrescente de envio", async () => {
    const row = {
      id: "m1",
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Oi, tudo bem?",
      gerado_por_ia: false,
      abordagem_tipo: null,
      enviado_em: "2026-09-29T10:00:00Z",
    };
    const client = makeQueryFake(async () => ({ data: [row], error: null }));
    const result = await listarMensagens(client as unknown as SupabaseClient, "00005087000190");
    expect(result).toEqual([
      {
        id: "m1",
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        canal: "whatsapp",
        conteudo: "Oi, tudo bem?",
        geradoPorIa: false,
        abordagemTipo: null,
        enviadoEm: "2026-09-29T10:00:00Z",
      },
    ]);
  });
});

describe("registrarMensagem", () => {
  it("insere a mensagem e retorna a linha criada", async () => {
    const rowCriada = {
      id: "m2",
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
      gerado_por_ia: false,
      abordagem_tipo: null,
      enviado_em: "2026-09-29T11:00:00Z",
    };
    const client = makeQueryFake(async () => ({ data: rowCriada, error: null }));

    const result = await registrarMensagem(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
    });

    expect(result.id).toBe("m2");
    expect(client.__inserted).toEqual({
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
      gerado_por_ia: false,
      abordagem_tipo: null,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run lib/leads.test.ts`
Expected: FAIL — `atribuirLead is not a function` (or similar) for the new tests; Task 3's tests still pass.

- [ ] **Step 3: Write the implementation (append to leads.ts)**

```ts
// append to crm-fibra/lib/leads.ts

export class LeadJaAtribuidoError extends Error {
  constructor(cnpjDigits: string) {
    super(`O lead ${cnpjDigits} já foi atribuído a outro consultor`);
    this.name = "LeadJaAtribuidoError";
  }
}

export async function atribuirLead(
  client: SupabaseClient,
  cnpjDigits: string,
  consultorId: string
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("atribuicoes")
    .insert({ cnpj_digits: cnpjDigits, consultor_id: consultorId });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new LeadJaAtribuidoError(cnpjDigits);
    }
    throw error;
  }
}

export interface Mensagem {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  canal: "whatsapp" | "ligacao" | "email";
  conteudo: string;
  geradoPorIa: boolean;
  abordagemTipo: string | null;
  enviadoEm: string;
}

interface MensagemRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  canal: "whatsapp" | "ligacao" | "email";
  conteudo: string;
  gerado_por_ia: boolean;
  abordagem_tipo: string | null;
  enviado_em: string;
}

function toMensagem(row: MensagemRow): Mensagem {
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    canal: row.canal,
    conteudo: row.conteudo,
    geradoPorIa: row.gerado_por_ia,
    abordagemTipo: row.abordagem_tipo,
    enviadoEm: row.enviado_em,
  };
}

export async function listarMensagens(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Mensagem[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("mensagens")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("enviado_em", { ascending: false });

  if (error) throw error;
  return (data as MensagemRow[]).map(toMensagem);
}

export async function registrarMensagem(
  client: SupabaseClient,
  input: {
    cnpjDigits: string;
    consultorId: string;
    canal: "whatsapp" | "ligacao" | "email";
    conteudo: string;
    geradoPorIa?: boolean;
    abordagemTipo?: string;
  }
): Promise<Mensagem> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("mensagens")
    .insert({
      cnpj_digits: input.cnpjDigits,
      consultor_id: input.consultorId,
      canal: input.canal,
      conteudo: input.conteudo,
      gerado_por_ia: input.geradoPorIa ?? false,
      abordagem_tipo: input.abordagemTipo ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return toMensagem(data as MensagemRow);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run lib/leads.test.ts`
Expected: PASS (12 tests total: 8 from Task 3 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/leads.ts crm-fibra/lib/leads.test.ts
git commit -m "feat(crm-fibra): add lead assignment and message log functions"
```

---

## Task 5: Dashboard — live KPIs

**Files:**
- Modify: `crm-fibra/app/(protected)/dashboard/page.tsx` (replaces Plan 1's stub entirely)

**Interfaces:**
- Consumes: `contarPorCamada` (Task 3), `getSupabaseAdmin` (Plan 1).
- Produces: the dashboard screen every consultant sees first after login.

This task has no automated test — it's a Server Component composing an already-tested function (`contarPorCamada`) with plain rendering; Task 10's manual checklist verifies it renders against live data.

- [ ] **Step 1: Replace app/(protected)/dashboard/page.tsx**

```tsx
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { contarPorCamada } from "@/lib/leads";

export default async function DashboardPage() {
  const contagem = await contarPorCamada(getSupabaseAdmin());

  const cards = [
    { label: "Candidatos a fibra", valor: contagem.fibraCandidato, href: "/leads?camada=fibra_candidato" },
    { label: "Aptos a renovar agora", valor: contagem.aptoAgora, href: "/leads?camada=apto_agora" },
    { label: "Aptos em 1 mês", valor: contagem.apto1Mes, href: "/leads?camada=apto_1_mes" },
    { label: "Aptos em 2 meses", valor: contagem.apto2Meses, href: "/leads?camada=apto_2_meses" },
    { label: "Sem consultor atribuído", valor: contagem.semDono, href: "/leads?camada=sem_dono" },
    { label: "Total de clientes na base", valor: contagem.total, href: "/leads?camada=todos" },
  ];

  return (
    <div>
      <h2>Dashboard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 20 }}>
        {cards.map((c) => (
          <a
            key={c.label}
            href={c.href}
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #e2e2e4",
              borderRadius: 8,
              padding: "16px 18px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontFamily: "var(--font-head)", fontSize: 30, fontWeight: 600, color: "var(--sinal)" }}>
              {c.valor}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--cinza)", marginTop: 4 }}>{c.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add "crm-fibra/app/(protected)/dashboard/page.tsx"
git commit -m "feat(crm-fibra): replace dashboard stub with live segment counts"
```

---

## Task 6: Carteira de leads screen

**Files:**
- Create: `crm-fibra/app/(protected)/leads/page.tsx`
- Create: `crm-fibra/app/(protected)/leads/filtro-bar.tsx`

**Interfaces:**
- Consumes: `listarLeadsSegmentados`, `type FiltroCamada` (Task 3), `getSupabaseAdmin` (Plan 1).
- Produces: the `/leads` screen — consumed by Task 5's dashboard links and Task 9's "back to list" flow.

No automated test (Server + Client Component composing already-tested data functions with plain rendering); covered by Task 10's manual checklist.

- [ ] **Step 1: Create app/(protected)/leads/filtro-bar.tsx**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FiltroCamada } from "@/lib/leads";

const OPCOES: { valor: FiltroCamada; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "fibra_candidato", rotulo: "Candidatos a fibra" },
  { valor: "apto_agora", rotulo: "Aptos agora" },
  { valor: "apto_1_mes", rotulo: "Aptos em 1 mês" },
  { valor: "apto_2_meses", rotulo: "Aptos em 2 meses" },
  { valor: "sem_dono", rotulo: "Sem dono" },
];

export function FiltroBar({
  filtroAtual,
  buscaAtual,
}: {
  filtroAtual: FiltroCamada;
  buscaAtual: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState(buscaAtual);

  function irPara(filtro: FiltroCamada, novaBusca: string) {
    const params = new URLSearchParams();
    params.set("camada", filtro);
    if (novaBusca) params.set("busca", novaBusca);
    router.push(`/leads?${params.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          onClick={() => irPara(o.valor, busca)}
          style={{
            padding: "6px 14px",
            borderRadius: 20,
            border: "1px solid #e2e2e4",
            background: filtroAtual === o.valor ? "var(--sinal)" : "#fff",
            color: filtroAtual === o.valor ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: 12.5,
          }}
        >
          {o.rotulo}
        </button>
      ))}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") irPara(filtroAtual, busca);
        }}
        placeholder="Buscar por nome, cidade ou CNPJ"
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", minWidth: 220 }}
      />
      <button onClick={() => irPara(filtroAtual, busca)} style={{ padding: "6px 12px" }}>
        Buscar
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create app/(protected)/leads/page.tsx**

```tsx
import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listarLeadsSegmentados, type FiltroCamada } from "@/lib/leads";
import { FiltroBar } from "./filtro-bar";

const CAMADAS_VALIDAS: FiltroCamada[] = [
  "fibra_candidato",
  "apto_agora",
  "apto_1_mes",
  "apto_2_meses",
  "sem_dono",
  "todos",
];

function normalizarFiltro(valor: string | undefined): FiltroCamada {
  return CAMADAS_VALIDAS.includes(valor as FiltroCamada) ? (valor as FiltroCamada) : "todos";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ camada?: string; busca?: string }>;
}) {
  const params = await searchParams;
  const filtro = normalizarFiltro(params.camada);
  const busca = params.busca ?? "";

  const leads = await listarLeadsSegmentados(getSupabaseAdmin(), filtro, busca || undefined);

  return (
    <div>
      <h2>Carteira de leads</h2>
      <FiltroBar filtroAtual={filtro} buscaAtual={busca} />
      <p style={{ color: "var(--cinza)", fontSize: 13 }}>{leads.length} resultado(s)</p>
      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 12, color: "var(--cinza)" }}>
            <th>Razão Social</th>
            <th>Cidade</th>
            <th>ARPU</th>
            <th>Dono</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.cnpjDigits}>
              <td>
                <Link href={`/leads/${l.cnpjDigits}`}>{l.razaoSocial || l.cnpjDigits}</Link>
              </td>
              <td>{l.cidade ?? "-"}</td>
              <td>{l.arpu != null ? `R$ ${l.arpu.toFixed(2)}` : "-"}</td>
              <td>{l.donoConsultorId ? "Atribuído" : "Sem dono"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/page.tsx" "crm-fibra/app/(protected)/leads/filtro-bar.tsx"
git commit -m "feat(crm-fibra): add carteira de leads screen with filters and search"
```

---

## Task 7: Lead detail screen (read-only)

**Files:**
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/page.tsx`

**Interfaces:**
- Consumes: `buscarLeadPorCnpj`, `listarMensagens` (Task 3/4), `normalizarTelefone` (Task 2), `verifySessionToken`/`SESSION_COOKIE_NAME` (Plan 1), `getSupabaseAdmin` (Plan 1).
- Produces: the lead detail page shell — Task 9 adds the interactive assign button and message form as children of this page.

No automated test (Server Component composing already-tested functions); Task 10's checklist covers it live.

- [ ] **Step 1: Create app/(protected)/leads/[cnpj]/page.tsx**

```tsx
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";
import { normalizarTelefone } from "@/lib/whatsapp";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { AtribuirButton } from "./atribuir-button";
import { NovaMensagemForm } from "./nova-mensagem-form";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ cnpj: string }>;
}) {
  const { cnpj } = await params;
  const admin = getSupabaseAdmin();

  const lead = await buscarLeadPorCnpj(admin, cnpj);
  if (!lead) notFound();

  const mensagens = await listarMensagens(admin, cnpj);
  const telefone = normalizarTelefone({
    ddd: lead.ddd,
    tel1: lead.tel1,
    tel2: lead.tel2,
    telefoneContato: lead.telefoneContato,
  });

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const souODono = session != null && lead.donoConsultorId === session.consultorId;

  return (
    <div>
      <h2>{lead.razaoSocial || lead.cnpjDigits}</h2>
      <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--cinza)", marginBottom: 16, flexWrap: "wrap" }}>
        <span>CNPJ: {lead.cnpjDigits}</span>
        <span>Cidade: {lead.cidade ?? "-"}</span>
        <span>ARPU: {lead.arpu != null ? `R$ ${lead.arpu.toFixed(2)}` : "-"}</span>
        <span>{lead.cepCabeado ?? "-"}</span>
        <span>Renovação: {lead.aptoRenovacao ?? "-"}</span>
      </div>

      {!lead.donoConsultorId && <AtribuirButton cnpjDigits={lead.cnpjDigits} />}
      {lead.donoConsultorId && !souODono && (
        <p style={{ fontSize: 13, color: "var(--cinza)" }}>Este lead já está atribuído a outro consultor.</p>
      )}

      {telefone ? (
        <NovaMensagemForm cnpjDigits={lead.cnpjDigits} telefone={telefone} />
      ) : (
        <p style={{ fontSize: 13, color: "var(--sinal)" }}>
          Nenhum telefone válido encontrado para este cliente — contato precisa ser manual.
        </p>
      )}

      <h3 style={{ marginTop: 24 }}>Histórico de mensagens</h3>
      {mensagens.length === 0 && (
        <p style={{ color: "var(--cinza)", fontSize: 13 }}>Nenhuma mensagem registrada ainda.</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {mensagens.map((m) => (
          <li key={m.id} style={{ borderLeft: "3px solid var(--sinal)", padding: "8px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--cinza)", textTransform: "uppercase" }}>
              {m.canal} · {new Date(m.enviadoEm).toLocaleString("pt-BR")}
            </div>
            <div style={{ fontSize: 13 }}>{m.conteudo}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Note: this file imports `AtribuirButton` and `NovaMensagemForm` from files Task 9 creates. Do not run this page (or any test that renders it) until Task 9 is complete — Task 7 alone will fail to compile if run in isolation, and that's expected; commit it as-is and let Task 8/9 finish the slice.

- [ ] **Step 2: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/[cnpj]/page.tsx"
git commit -m "feat(crm-fibra): add lead detail page shell"
```

---

## Task 8: Lead actions — assign and log message

**Files:**
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/actions.ts`
- Test: `crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts`

**Interfaces:**
- Consumes: `atribuirLead`, `LeadJaAtribuidoError`, `registrarMensagem` (Task 4), `getSupabaseAdmin`, `verifySessionToken`/`SESSION_COOKIE_NAME`, `buscarConsultorPorId` (Plan 1).
- Produces: `atribuirLeadAction(cnpjDigits): Promise<{ erro?: string }>`, `registrarMensagemAction(cnpjDigits, conteudo, canal): Promise<{ erro?: string }>` — consumed by Task 9's UI components.

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
}));

const atribuirLead = vi.fn();
const registrarMensagem = vi.fn();
vi.mock("@/lib/leads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/leads")>("@/lib/leads");
  return {
    ...actual,
    atribuirLead: (...args: unknown[]) => atribuirLead(...args),
    registrarMensagem: (...args: unknown[]) => registrarMensagem(...args),
  };
});

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const verifySessionToken = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
  SESSION_COOKIE_NAME: "crm_fibra_session",
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import { atribuirLeadAction, registrarMensagemAction } from "./actions";
import { LeadJaAtribuidoError } from "@/lib/leads";

const consultorAtivo = {
  id: "c1",
  nome: "Ana",
  username: "ana",
  papel: "consultor" as const,
  ativo: true,
  criadoEm: "x",
  ultimoLogin: null,
};

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  atribuirLead.mockReset();
  registrarMensagem.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

function sessaoValida() {
  cookieGet.mockReturnValue({ value: "token" });
  verifySessionToken.mockResolvedValue({ consultorId: "c1", papel: "consultor" });
  buscarConsultorPorId.mockResolvedValue(consultorAtivo);
}

describe("atribuirLeadAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(atribuirLeadAction("00005087000190")).rejects.toThrow("REDIRECT:/login");
    expect(atribuirLead).not.toHaveBeenCalled();
  });

  it("chama atribuirLead com o consultor da sessão", async () => {
    sessaoValida();
    atribuirLead.mockResolvedValue(undefined);
    const resultado = await atribuirLeadAction("00005087000190");
    expect(resultado).toEqual({});
    expect(atribuirLead).toHaveBeenCalledWith({}, "00005087000190", "c1");
  });

  it("retorna erro amigável quando o lead já foi atribuído", async () => {
    sessaoValida();
    atribuirLead.mockRejectedValue(new LeadJaAtribuidoError("00005087000190"));
    const resultado = await atribuirLeadAction("00005087000190");
    expect(resultado.erro).toMatch(/já foi atribuído/);
  });
});

describe("registrarMensagemAction", () => {
  it("rejeita mensagem em branco sem chamar registrarMensagem", async () => {
    sessaoValida();
    const resultado = await registrarMensagemAction("00005087000190", "   ", "whatsapp");
    expect(resultado.erro).toBeDefined();
    expect(registrarMensagem).not.toHaveBeenCalled();
  });

  it("registra a mensagem com o texto já sem espaços nas pontas", async () => {
    sessaoValida();
    registrarMensagem.mockResolvedValue({
      id: "m1",
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Oi!",
      geradoPorIa: false,
      abordagemTipo: null,
      enviadoEm: "x",
    });
    const resultado = await registrarMensagemAction("00005087000190", "  Oi!  ", "whatsapp");
    expect(resultado).toEqual({});
    expect(registrarMensagem).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Oi!",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts"`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/app/(protected)/leads/[cnpj]/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { atribuirLead, registrarMensagem, LeadJaAtribuidoError } from "@/lib/leads";

async function sessaoAtiva() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo) redirect("/login");
  return consultor;
}

export async function atribuirLeadAction(cnpjDigits: string): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();
  try {
    await atribuirLead(getSupabaseAdmin(), cnpjDigits, consultor.id);
  } catch (err) {
    if (err instanceof LeadJaAtribuidoError) {
      return { erro: err.message };
    }
    throw err;
  }
  revalidatePath(`/leads/${cnpjDigits}`);
  revalidatePath("/leads");
  return {};
}

export async function registrarMensagemAction(
  cnpjDigits: string,
  conteudo: string,
  canal: "whatsapp" | "ligacao" | "email"
): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();

  if (!conteudo.trim()) {
    return { erro: "A mensagem não pode ficar em branco" };
  }

  await registrarMensagem(getSupabaseAdmin(), {
    cnpjDigits,
    consultorId: consultor.id,
    canal,
    conteudo: conteudo.trim(),
  });

  revalidatePath(`/leads/${cnpjDigits}`);
  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/[cnpj]/actions.ts" "crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts"
git commit -m "feat(crm-fibra): add lead assignment and message-logging actions"
```

---

## Task 9: Lead detail screen — interactive assign button and message form

**Files:**
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/atribuir-button.tsx`
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/nova-mensagem-form.tsx`

**Interfaces:**
- Consumes: `atribuirLeadAction`, `registrarMensagemAction` (Task 8), `montarLinkWhatsapp` (Task 2).
- Produces: the two interactive pieces Task 7's page already imports — completes the lead detail screen.

No automated test (thin Client Components wiring already-tested server actions); Task 10's checklist exercises them live, including Review Focus #4 (blank message) and #2 (double-assign race, tested manually by opening two sessions).

- [ ] **Step 1: Create app/(protected)/leads/[cnpj]/atribuir-button.tsx**

```tsx
"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { atribuirLeadAction } from "./actions";

export function AtribuirButton({ cnpjDigits }: { cnpjDigits: string }) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  function atribuir() {
    startTransition(async () => {
      const resultado = await atribuirLeadAction(cnpjDigits);
      if (resultado.erro) {
        setErro(resultado.erro);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={atribuir}
        disabled={pending}
        style={{ padding: "9px 16px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
      >
        {pending ? "Atribuindo..." : "Atribuir a mim"}
      </button>
      {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginTop: 6 }}>{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create app/(protected)/leads/[cnpj]/nova-mensagem-form.tsx**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { montarLinkWhatsapp } from "@/lib/whatsapp";
import { registrarMensagemAction } from "./actions";

export function NovaMensagemForm({
  cnpjDigits,
  telefone,
}: {
  cnpjDigits: string;
  telefone: string;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function enviarPeloWhatsapp() {
    if (!texto.trim()) {
      setErro("Escreva uma mensagem antes de enviar");
      return;
    }
    // Open the WhatsApp link synchronously from the click handler — awaiting
    // the log write first would make this a non-user-gesture-triggered
    // window.open, which browsers block as a popup.
    window.open(montarLinkWhatsapp(telefone, texto), "_blank");
    registrarELimpar("whatsapp");
  }

  function registrarELimpar(canal: "whatsapp" | "ligacao" | "email") {
    startTransition(async () => {
      const resultado = await registrarMensagemAction(cnpjDigits, texto, canal);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setTexto("");
      setErro(null);
      router.refresh();
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escreva a mensagem para o cliente..."
        rows={3}
        style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ddd" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={enviarPeloWhatsapp}
          disabled={pending}
          style={{ padding: "8px 14px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
        >
          Enviar pelo WhatsApp
        </button>
        <button onClick={() => registrarELimpar("ligacao")} disabled={pending} style={{ padding: "8px 14px" }}>
          Registrar ligação
        </button>
      </div>
      {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginTop: 6 }}>{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Run the full test suite once to confirm the whole slice compiles and passes together**

Run: `cd crm-fibra && npm test`
Expected: all tests across Plan 1 and Plan 2's Tasks 1-9 pass (this is the first point since Task 7 that the lead detail page's imports all resolve).

- [ ] **Step 4: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/[cnpj]/atribuir-button.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/nova-mensagem-form.tsx"
git commit -m "feat(crm-fibra): wire up lead assignment button and message form"
```

---

## Task 10: README update and manual verification checklist

**Files:**
- Modify: `crm-fibra/README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: an updated setup guide and a checklist exercising this plan's Review Focus items end to end, including the two that have no automated test (#1 phone fallback, #2 assignment race).

- [ ] **Step 1: Append a new section to crm-fibra/README.md**

```md

## Leads & Carteira (Plano 2)

A segmentação (`crm_fibra.leads_segmentados`) lê `public.clientes` ao vivo —
não há cópia de dado. Se a base de clientes parecer errada (poucos
resultados, números estranhos), confirme com o time se `public.clientes`
está na sua versão correta antes de desconfiar do CRM Fibra.

### Checklist de verificação manual (além do checklist do Plano 1)

1. Logado como consultor, abra `/dashboard` → os 6 cartões devem mostrar
   números plausíveis (não zero, a menos que a base realmente esteja vazia).
2. Clique em qualquer cartão → deve ir para `/leads` já filtrado pela
   camada certa.
3. Em `/leads`, digite um texto de busca com vírgula e parênteses, por
   exemplo `Acme, (Ltda)` → a lista não deve quebrar nem retornar todos os
   resultados sem filtro.
4. Clique em um lead sem dono → deve aparecer o botão "Atribuir a mim".
   Clique nele → deve sumir o botão e aparecer o formulário de mensagem.
5. **Teste a disputa de atribuição:** com dois logins de consultor
   diferentes (duas abas anônimas), abram o mesmo lead sem dono e cliquem
   em "Atribuir a mim" quase ao mesmo tempo nas duas — um deve conseguir,
   o outro deve ver uma mensagem de erro clara (não travar, não duplicar
   o dono).
6. Escreva uma mensagem em branco (só espaços) e tente enviar pelo
   WhatsApp ou registrar ligação → deve aparecer erro, nada deve ser
   salvo.
7. Escreva uma mensagem de verdade e clique "Enviar pelo WhatsApp" → deve
   abrir uma aba nova do WhatsApp com o número e o texto certos, e a
   mensagem deve aparecer no histórico da página ao voltar.
8. Abra um lead cujo cliente não tenha telefone válido na base → deve
   aparecer o aviso de contato manual, não um botão de WhatsApp quebrado.
```

- [ ] **Step 2: Run the full test suite once more**

Run: `cd crm-fibra && npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add crm-fibra/README.md
git commit -m "docs(crm-fibra): add leads/carteira setup notes and verification checklist"
```
