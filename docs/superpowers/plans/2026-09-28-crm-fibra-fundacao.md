# CRM Fibra — Fundação (schema, autenticação, admin de consultores) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new, standalone Next.js app (`crm-fibra/`) with its own login (separate from the existing painel's Supabase Auth), a `crm_fibra` schema in the same "apex" Supabase project holding a `consultores` table, and an admin screen to create/deactivate/reset-password consultor logins. This is Plan 1 of several — it is the foundation every later plan (leads/segmentation, AI approach engine, proposals + PDF, kanban, dashboard) builds on.

**Architecture:** Next.js 16 App Router app, TypeScript, deployed independently of the existing HTML painel. Auth is fully custom (bcrypt + signed JWT in an httpOnly cookie) — no Supabase Auth involved, so this system's logins never overlap with the painel's `profiles`/`auth.users`. Data lives in a new `crm_fibra` Postgres schema inside the *same* Supabase project the painel already uses (`apex`, ref `mdgfboijyqfkggcrhptn`), isolated by schema and by only ever being reached through a server-side Supabase client using the service role key — nothing in this plan touches the `public` schema.

**Tech Stack:** Next.js 16 (App Router, React 19, TypeScript), `@supabase/supabase-js` (service-role, server-only), `bcryptjs`, `jose` (JWT), Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-09-25-crm-leads-fibra-renovacao-design.md`

## Global Constraints

- Login is completely separate from the existing painel's Supabase Auth — no shared users, no shared session mechanism (spec §5, §7).
- All new data lives in Postgres schema `crm_fibra` inside Supabase project `mdgfboijyqfkggcrhptn` ("apex") — never in `public`, never a new Supabase project (spec §5, §6).
- No existing table, RLS policy, or screen in the painel is modified (spec §3, §5).
- Every `crm_fibra` table has RLS enabled; the real access boundary is the server-side service-role client, not RLS policies granted to `anon`/`authenticated` (spec §6 note, §7).
- Login must use a precomputed dummy password hash so a nonexistent username takes the same code path (and comparable time) as a wrong password (spec §7).
- A consultor deactivated (`ativo = false`) must be locked out on their very next request even if their JWT has not expired — this must be a live database check, not just JWT validity (spec §7).
- Plain-text passwords are never logged, stored, or returned by any API/action — only `password_hash` is persisted (spec §6).

## Review Focus

1. **Login with a nonexistent username** — must return the same generic 401 as a wrong password, and must still run a bcrypt compare (against the dummy hash) so no early return skips it.
2. **Deactivated consultor with a still-valid JWT** — the protected layout's server-side check must reject them even though the token itself verifies fine.
3. **Duplicate username on consultor creation** — must surface a clear, specific error (`UsernameJaExisteError`), not a raw Postgres error or a silent overwrite.
4. **Missing/blank credentials on login** — must be rejected with 400 before touching the database, not passed through to bcrypt with empty strings.
5. **Non-admin (or unauthenticated) hitting the consultores admin actions directly** — `criarConsultorAction`/`definirAtivoAction`/`redefinirSenhaAction` must refuse even if someone calls them without going through the UI.

---

## Task 1: Project scaffold and brand foundations

**Files:**
- Create: `crm-fibra/package.json`
- Create: `crm-fibra/tsconfig.json`
- Create: `crm-fibra/next.config.ts`
- Create: `crm-fibra/vitest.config.ts`
- Create: `crm-fibra/.env.example`
- Create: `crm-fibra/.gitignore`
- Create: `crm-fibra/app/globals.css`
- Create: `crm-fibra/app/layout.tsx`
- Create: `crm-fibra/next-env.d.ts`

**Interfaces:**
- Produces: the `crm-fibra/` app skeleton every later task writes into; the `@/*` path alias resolving to `crm-fibra/`; brand CSS variables (`--sinal`, `--bordo`, `--carmim`, `--grafite`, `--cinza`, `--papel`, `--rosa`, `--font-head`, `--font-body`) available globally.

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "crm-fibra",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "seed:admin": "tsx db/seed.ts"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "bcryptjs": "^2.4.3",
    "jose": "^5.9.6"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/bcryptjs": "^2.4.6",
    "vitest": "^2.1.0",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 5: Create .env.example**

```
SUPABASE_URL=https://mdgfboijyqfkggcrhptn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
CRM_FIBRA_SESSION_SECRET=
SEED_ADMIN_NOME=
SEED_ADMIN_USERNAME=
SEED_ADMIN_SENHA=
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
.next/
.env.local
*.tsbuildinfo
```

- [ ] **Step 7: Create app/globals.css with the "Sinal de Ápice" brand tokens**

```css
:root {
  --sinal: #E30613;
  --carmim: #8E0B1B;
  --bordo: #520C07;
  --grafite: #1D1F20;
  --cinza: #666666;
  --papel: #F2F2F3;
  --rosa: #FBE3E4;
  --font-head: "Barlow Condensed", system-ui, sans-serif;
  --font-body: "Barlow", system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--papel);
  color: var(--grafite);
  font-family: var(--font-body);
}

h1, h2, h3 {
  font-family: var(--font-head);
  font-weight: 600;
  text-transform: uppercase;
  margin: 0;
}

button {
  font-family: inherit;
}

table {
  font-size: 14px;
}

th, td {
  padding: 8px 10px;
  border-bottom: 1px solid #e2e2e4;
  text-align: left;
}
```

- [ ] **Step 8: Create app/layout.tsx**

```tsx
import "./globals.css";

export const metadata = {
  title: "CRM Fibra — Apex Smart Solutions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 9: Create next-env.d.ts**

```ts
/// <reference types="next" />
/// <reference types="next/image-types/global" />
```

- [ ] **Step 10: Install dependencies**

Run: `cd crm-fibra && npm install`
Expected: installs without errors, creates `package-lock.json` and `node_modules/`.

- [ ] **Step 11: Commit**

```bash
git add crm-fibra/package.json crm-fibra/package-lock.json crm-fibra/tsconfig.json crm-fibra/next.config.ts crm-fibra/vitest.config.ts crm-fibra/.env.example crm-fibra/.gitignore crm-fibra/app/globals.css crm-fibra/app/layout.tsx crm-fibra/next-env.d.ts
git commit -m "chore(crm-fibra): scaffold Next.js app with brand tokens"
```

---

## Task 2: Password hashing module

**Files:**
- Create: `crm-fibra/lib/auth/password.ts`
- Test: `crm-fibra/lib/auth/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`, `DUMMY_HASH: string` — consumed by Task 6 (`consultores.ts`) and Task 7 (login route).

- [ ] **Step 1: Generate a real dummy bcrypt hash to hardcode**

Run: `cd crm-fibra && npx tsx -e "import bcrypt from 'bcryptjs'; bcrypt.hash('nao-corresponde-a-nenhuma-senha-real', 12).then(h => console.log(h))"`
Expected: prints a single line starting with `$2a$12$` or `$2b$12$` — copy this exact string, it is used in Step 2.

- [ ] **Step 2: Write the failing test**

```ts
// crm-fibra/lib/auth/password.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, DUMMY_HASH } from "./password";

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("minhaSenha123");
    expect(hash).not.toBe("minhaSenha123");
    expect(await verifyPassword("minhaSenha123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("minhaSenha123");
    expect(await verifyPassword("senhaErrada", hash)).toBe(false);
  });

  it("DUMMY_HASH never verifies against any real password", async () => {
    expect(await verifyPassword("qualquerCoisa", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });

  it("DUMMY_HASH is a well-formed bcrypt hash (so compare() never throws)", () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd crm-fibra && npx vitest run lib/auth/password.test.ts`
Expected: FAIL — `Cannot find module './password'`.

- [ ] **Step 4: Write the implementation**

Paste the exact hash string printed in Step 1 in place of `PASTE_HASH_FROM_STEP_1_HERE` below.

```ts
// crm-fibra/lib/auth/password.ts
import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

// Precomputed hash of a string that is not a real password. Comparing
// against this when a username doesn't exist keeps a "user not found"
// login attempt on the same code path (one bcrypt.compare call) as a
// "wrong password" attempt, instead of returning early.
export const DUMMY_HASH = "PASTE_HASH_FROM_STEP_1_HERE";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd crm-fibra && npx vitest run lib/auth/password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add crm-fibra/lib/auth/password.ts crm-fibra/lib/auth/password.test.ts
git commit -m "feat(crm-fibra): add password hashing with timing-safe dummy hash"
```

---

## Task 3: Session (JWT) module

**Files:**
- Create: `crm-fibra/lib/auth/session.ts`
- Test: `crm-fibra/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createSessionToken(payload: SessionPayload): Promise<string>`, `verifySessionToken(token: string): Promise<SessionPayload | null>`, `SESSION_COOKIE_NAME: string`, `SESSION_MAX_AGE: number`, `interface SessionPayload { consultorId: string; papel: "admin" | "consultor" }` — consumed by Task 7 (login), Task 8 (logout), Task 9 (middleware), Task 10 (protected layout), Task 12 (consultores actions).

- [ ] **Step 1: Write the failing test**

```ts
// crm-fibra/lib/auth/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

beforeEach(() => {
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

describe("session tokens", () => {
  it("creates a token that verifies back to the same payload", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.consultorId).toBe("abc-123");
    expect(payload?.papel).toBe("consultor");
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    process.env.CRM_FIBRA_SESSION_SECRET =
      "a-completely-different-secret-of-32-chars!!";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects garbage input instead of throwing", async () => {
    expect(await verifySessionToken("not-a-jwt-at-all")).toBeNull();
  });

  it("throws a clear error at signing time if the secret is missing", async () => {
    delete process.env.CRM_FIBRA_SESSION_SECRET;
    await expect(
      createSessionToken({ consultorId: "x", papel: "admin" })
    ).rejects.toThrow("CRM_FIBRA_SESSION_SECRET");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crm-fibra && npx vitest run lib/auth/session.test.ts`
Expected: FAIL — `Cannot find module './session'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/lib/auth/session.ts
import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "crm_fibra_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 8; // 8 hours

function getSecretKey(): Uint8Array {
  const secret = process.env.CRM_FIBRA_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "CRM_FIBRA_SESSION_SECRET must be set and at least 32 characters long"
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  consultorId: string;
  papel: "admin" | "consultor";
}

export async function createSessionToken(
  payload: SessionPayload
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.consultorId !== "string" ||
      (payload.papel !== "admin" && payload.papel !== "consultor")
    ) {
      return null;
    }
    return {
      consultorId: payload.consultorId,
      papel: payload.papel,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE = SESSION_DURATION_SECONDS;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crm-fibra && npx vitest run lib/auth/session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/auth/session.ts crm-fibra/lib/auth/session.test.ts
git commit -m "feat(crm-fibra): add signed JWT session tokens"
```

---

## Task 4: Supabase schema migration (`crm_fibra` + `consultores`)

**Files:**
- Create: `crm-fibra/db/schema.sql`

**Interfaces:**
- Produces: Postgres schema `crm_fibra` and table `crm_fibra.consultores` in Supabase project `mdgfboijyqfkggcrhptn`, consumed by every task from Task 5 onward.

**⚠️ This step writes to the same live Supabase project the production painel uses (`apex`, ref `mdgfboijyqfkggcrhptn`). It is additive-only (new schema, new table) and reversible (`drop schema crm_fibra cascade`), but confirm with the user before running Step 2 against the live project — do not apply it silently.**

- [ ] **Step 1: Write the migration SQL**

```sql
-- crm-fibra/db/schema.sql
-- Idempotent: safe to run again.

create schema if not exists crm_fibra;

create table if not exists crm_fibra.consultores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  username text not null unique,
  password_hash text not null,
  papel text not null default 'consultor' check (papel in ('admin', 'consultor')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_login timestamptz
);

alter table crm_fibra.consultores enable row level security;

-- Deliberately no policies granted to `anon` or `authenticated`: this table
-- is only ever read/written by the Next.js server using the service role
-- key (see spec §7). RLS being enabled with zero policies means even a
-- leaked anon key cannot read or write this table.
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the Supabase MCP tool `apply_migration` with `project_id: "mdgfboijyqfkggcrhptn"`, `name: "crm_fibra_consultores"`, and `query` set to the contents of `crm-fibra/db/schema.sql` above. Confirm with the user before running this against the shared project.

- [ ] **Step 3: Verify the table exists**

Use the Supabase MCP tool `list_tables` with `project_id: "mdgfboijyqfkggcrhptn"`, `schemas: ["crm_fibra"]`, `verbose: true`.
Expected: returns `crm_fibra.consultores` with the columns defined above, `rls_enabled: true`.

- [ ] **Step 4: Commit**

```bash
git add crm-fibra/db/schema.sql
git commit -m "feat(crm-fibra): add crm_fibra schema migration for consultores"
```

---

## Task 5: Supabase admin client wrapper

**Files:**
- Create: `crm-fibra/lib/supabase-admin.ts`
- Test: `crm-fibra/lib/supabase-admin.test.ts`

**Interfaces:**
- Consumes: env vars `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Produces: `getSupabaseAdmin(): SupabaseClient` — consumed by Task 7, Task 10, Task 12, Task 13. Server-only; never imported from a Client Component.

- [ ] **Step 1: Write the failing test**

```ts
// crm-fibra/lib/supabase-admin.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getSupabaseAdmin", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("throws a clear error when env vars are missing", async () => {
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(() => getSupabaseAdmin()).toThrow(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  });

  it("returns a client once env vars are set", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key-for-test";
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(getSupabaseAdmin()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crm-fibra && npx vitest run lib/supabase-admin.test.ts`
Expected: FAIL — `Cannot find module './supabase-admin'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/lib/supabase-admin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

// Server-only. Never import this from a Client Component or expose its
// result to the browser — it holds the Supabase service role key, which
// bypasses Row Level Security entirely.
export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
  return cachedClient;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crm-fibra && npx vitest run lib/supabase-admin.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/supabase-admin.ts crm-fibra/lib/supabase-admin.test.ts
git commit -m "feat(crm-fibra): add server-only Supabase admin client"
```

---

## Task 6: Consultores data-access module

**Files:**
- Create: `crm-fibra/lib/consultores.ts`
- Test: `crm-fibra/lib/consultores.test.ts`

**Interfaces:**
- Consumes: `hashPassword` from Task 2 (`lib/auth/password.ts`).
- Produces: `interface Consultor { id, nome, username, papel, ativo, criadoEm, ultimoLogin }`, `class UsernameJaExisteError extends Error`, `criarConsultor(client, input): Promise<Consultor>`, `buscarConsultorPorUsername(client, username): Promise<(Consultor & { passwordHash: string }) | null>`, `buscarConsultorPorId(client, id): Promise<Consultor | null>`, `listarConsultores(client): Promise<Consultor[]>`, `definirAtivo(client, id, ativo): Promise<void>`, `redefinirSenha(client, id, novaSenha): Promise<void>`, `registrarLogin(client, id): Promise<void>` — consumed by Task 7, Task 10, Task 12, Task 13.

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/lib/consultores.test.ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  criarConsultor,
  buscarConsultorPorUsername,
  buscarConsultorPorId,
  listarConsultores,
  definirAtivo,
  UsernameJaExisteError,
} from "./consultores";

// A minimal fake that mimics the chained shape of the Supabase query
// builder (schema().from().select()/.insert()/.update() ... .eq()
// .single()/.maybeSingle()/.order(), and is itself awaitable — matching
// how `await client.update(...).eq(...)` works against the real client).
function makeQueryFake(terminal: () => Promise<{ data?: unknown; error?: unknown }>) {
  const q: any = {
    schema: () => q,
    from: () => q,
    select: () => q,
    insert: (payload: unknown) => {
      q.__inserted = payload;
      return q;
    },
    update: (payload: unknown) => {
      q.__updated = payload;
      return q;
    },
    eq: () => q,
    order: () => terminal(),
    single: () => terminal(),
    maybeSingle: () => terminal(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  };
  return q;
}

const row = {
  id: "1",
  nome: "Ana",
  username: "ana",
  password_hash: "hash-fake",
  papel: "consultor" as const,
  ativo: true,
  criado_em: "2026-09-28T00:00:00Z",
  ultimo_login: null,
};

describe("criarConsultor", () => {
  it("grava o hash da senha, nunca a senha em texto puro", async () => {
    const client = makeQueryFake(async () => ({ data: row, error: null }));

    const consultor = await criarConsultor(client as unknown as SupabaseClient, {
      nome: "Ana",
      username: "ana",
      senha: "senha123",
      papel: "consultor",
    });

    expect(consultor.username).toBe("ana");
    expect(client.__inserted.password_hash).toBeDefined();
    expect(client.__inserted.password_hash).not.toBe("senha123");
    expect(client.__inserted).not.toHaveProperty("senha");
  });

  it("lança UsernameJaExisteError em conflito de username (código 23505)", async () => {
    const client = makeQueryFake(async () => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    }));

    await expect(
      criarConsultor(client as unknown as SupabaseClient, {
        nome: "Ana",
        username: "ana",
        senha: "x12345678",
        papel: "consultor",
      })
    ).rejects.toThrow(UsernameJaExisteError);
  });
});

describe("buscarConsultorPorUsername", () => {
  it("retorna null quando não encontra ninguém", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarConsultorPorUsername(client as unknown as SupabaseClient, "fantasma")
    ).toBeNull();
  });

  it("inclui passwordHash no retorno, para o login comparar", async () => {
    const client = makeQueryFake(async () => ({ data: row, error: null }));
    const result = await buscarConsultorPorUsername(client as unknown as SupabaseClient, "ana");
    expect(result?.passwordHash).toBe("hash-fake");
  });
});

describe("buscarConsultorPorId", () => {
  it("retorna null quando o id não existe", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarConsultorPorId(client as unknown as SupabaseClient, "inexistente")
    ).toBeNull();
  });
});

describe("listarConsultores", () => {
  it("mapeia todas as linhas do banco para o formato da aplicação", async () => {
    const client = makeQueryFake(async () => ({ data: [row], error: null }));
    const result = await listarConsultores(client as unknown as SupabaseClient);
    expect(result).toEqual([
      {
        id: "1",
        nome: "Ana",
        username: "ana",
        papel: "consultor",
        ativo: true,
        criadoEm: "2026-09-28T00:00:00Z",
        ultimoLogin: null,
      },
    ]);
  });
});

describe("definirAtivo", () => {
  it("atualiza apenas o campo ativo", async () => {
    const client = makeQueryFake(async () => ({ error: null }));
    await definirAtivo(client as unknown as SupabaseClient, "1", false);
    expect(client.__updated).toEqual({ ativo: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run lib/consultores.test.ts`
Expected: FAIL — `Cannot find module './consultores'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/lib/consultores.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPassword } from "./auth/password";

export interface Consultor {
  id: string;
  nome: string;
  username: string;
  papel: "admin" | "consultor";
  ativo: boolean;
  criadoEm: string;
  ultimoLogin: string | null;
}

interface ConsultorRow {
  id: string;
  nome: string;
  username: string;
  password_hash: string;
  papel: "admin" | "consultor";
  ativo: boolean;
  criado_em: string;
  ultimo_login: string | null;
}

function toConsultor(row: ConsultorRow): Consultor {
  return {
    id: row.id,
    nome: row.nome,
    username: row.username,
    papel: row.papel,
    ativo: row.ativo,
    criadoEm: row.criado_em,
    ultimoLogin: row.ultimo_login,
  };
}

export class UsernameJaExisteError extends Error {
  constructor(username: string) {
    super(`Já existe um consultor com o usuário "${username}"`);
    this.name = "UsernameJaExisteError";
  }
}

export async function criarConsultor(
  client: SupabaseClient,
  input: { nome: string; username: string; senha: string; papel: "admin" | "consultor" }
): Promise<Consultor> {
  const passwordHash = await hashPassword(input.senha);
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .insert({
      nome: input.nome,
      username: input.username,
      password_hash: passwordHash,
      papel: input.papel,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new UsernameJaExisteError(input.username);
    }
    throw error;
  }
  return toConsultor(data as ConsultorRow);
}

export async function buscarConsultorPorUsername(
  client: SupabaseClient,
  username: string
): Promise<(Consultor & { passwordHash: string }) | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .eq("username", username)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as ConsultorRow;
  return { ...toConsultor(row), passwordHash: row.password_hash };
}

export async function buscarConsultorPorId(
  client: SupabaseClient,
  id: string
): Promise<Consultor | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toConsultor(data as ConsultorRow) : null;
}

export async function listarConsultores(client: SupabaseClient): Promise<Consultor[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .order("nome", { ascending: true });

  if (error) throw error;
  return (data as ConsultorRow[]).map(toConsultor);
}

export async function definirAtivo(
  client: SupabaseClient,
  id: string,
  ativo: boolean
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ ativo })
    .eq("id", id);
  if (error) throw error;
}

export async function redefinirSenha(
  client: SupabaseClient,
  id: string,
  novaSenha: string
): Promise<void> {
  const passwordHash = await hashPassword(novaSenha);
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ password_hash: passwordHash })
    .eq("id", id);
  if (error) throw error;
}

export async function registrarLogin(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ ultimo_login: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run lib/consultores.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/consultores.ts crm-fibra/lib/consultores.test.ts
git commit -m "feat(crm-fibra): add consultores data-access module"
```

---

## Task 7: Login API route

**Files:**
- Create: `crm-fibra/app/api/login/route.ts`
- Test: `crm-fibra/app/api/login/route.test.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin` (Task 5), `buscarConsultorPorUsername`/`registrarLogin` (Task 6), `verifyPassword`/`DUMMY_HASH` (Task 2), `createSessionToken`/`SESSION_COOKIE_NAME`/`SESSION_MAX_AGE` (Task 3).
- Produces: `POST /api/login` — consumed by Task 11 (login page).

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/app/api/login/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorUsername = vi.fn();
const registrarLogin = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorUsername: (...args: unknown[]) =>
    buscarConsultorPorUsername(...args),
  registrarLogin: (...args: unknown[]) => registrarLogin(...args),
}));

import { hashPassword } from "@/lib/auth/password";
import { POST } from "./route";

beforeEach(() => {
  buscarConsultorPorUsername.mockReset();
  registrarLogin.mockReset();
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

function req(body: unknown) {
  return new Request("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/login", () => {
  it("retorna 400 quando faltam credenciais", async () => {
    const res = await POST(req({ username: "", senha: "" }));
    expect(res.status).toBe(400);
    expect(buscarConsultorPorUsername).not.toHaveBeenCalled();
  });

  it("retorna 401 para usuário inexistente", async () => {
    buscarConsultorPorUsername.mockResolvedValue(null);
    const res = await POST(req({ username: "fantasma", senha: "qualquer" }));
    expect(res.status).toBe(401);
  });

  it("retorna 401 para senha errada", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    const res = await POST(req({ username: "ana", senha: "senhaErrada" }));
    expect(res.status).toBe(401);
  });

  it("retorna 401 para consultor desativado mesmo com senha certa", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: false,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    const res = await POST(req({ username: "ana", senha: "senhaCorreta" }));
    expect(res.status).toBe(401);
  });

  it("retorna 200, seta cookie de sessão e registra o login para credenciais corretas", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    registrarLogin.mockResolvedValue(undefined);

    const res = await POST(req({ username: "ana", senha: "senhaCorreta" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("crm_fibra_session=");
    expect(registrarLogin).toHaveBeenCalledWith(expect.anything(), "1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run app/api/login/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/app/api/login/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarConsultorPorUsername, registrarLogin } from "@/lib/consultores";
import { verifyPassword, DUMMY_HASH } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";

  if (!username || !senha) {
    return NextResponse.json(
      { erro: "Usuário e senha são obrigatórios" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin();
  const consultor = await buscarConsultorPorUsername(client, username);

  // Always run a bcrypt compare, even when the user doesn't exist, so a
  // "usuário não encontrado" response takes the same code path as a
  // "senha errada" response.
  const senhaCorreta = await verifyPassword(senha, consultor?.passwordHash ?? DUMMY_HASH);

  if (!consultor || !senhaCorreta || !consultor.ativo) {
    return NextResponse.json({ erro: "Usuário ou senha inválidos" }, { status: 401 });
  }

  await registrarLogin(client, consultor.id);

  const token = await createSessionToken({
    consultorId: consultor.id,
    papel: consultor.papel,
  });

  const response = NextResponse.json({
    id: consultor.id,
    nome: consultor.nome,
    papel: consultor.papel,
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run app/api/login/route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/app/api/login/route.ts crm-fibra/app/api/login/route.test.ts
git commit -m "feat(crm-fibra): add login API route"
```

---

## Task 8: Logout API route

**Files:**
- Create: `crm-fibra/app/api/logout/route.ts`
- Test: `crm-fibra/app/api/logout/route.test.ts`

**Interfaces:**
- Consumes: `SESSION_COOKIE_NAME` (Task 3).
- Produces: `POST /api/logout` — consumed by Task 10 (`TopBar`).

- [ ] **Step 1: Write the failing test**

```ts
// crm-fibra/app/api/logout/route.test.ts
import { describe, it, expect } from "vitest";
import { POST } from "./route";

describe("POST /api/logout", () => {
  it("limpa o cookie de sessão", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("crm_fibra_session=");
    expect(setCookie).toMatch(/max-age=0/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd crm-fibra && npx vitest run app/api/logout/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/app/api/logout/route.ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return response;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd crm-fibra && npx vitest run app/api/logout/route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/app/api/logout/route.ts crm-fibra/app/api/logout/route.test.ts
git commit -m "feat(crm-fibra): add logout API route"
```

---

## Task 9: Middleware (fast unauthenticated-request gate)

**Files:**
- Create: `crm-fibra/middleware.ts`
- Test: `crm-fibra/middleware.test.ts`

**Interfaces:**
- Consumes: `verifySessionToken`, `SESSION_COOKIE_NAME` (Task 3).
- Produces: request gating for every route except `/login` and `/api/login`. Note: this only checks JWT validity, not the live `ativo` flag — that authoritative check happens in Task 10's protected layout, which runs on every protected page request regardless of middleware (see Task 10 note).

- [ ] **Step 1: Write the failing tests**

```ts
// crm-fibra/middleware.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { createSessionToken } from "@/lib/auth/session";

beforeEach(() => {
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

describe("middleware", () => {
  it("deixa /login passar sem sessão", async () => {
    const req = new NextRequest("http://localhost/login");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("redireciona pra /login quando não há cookie de sessão", async () => {
    const req = new NextRequest("http://localhost/dashboard");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redireciona pra /login quando o cookie é inválido", async () => {
    const req = new NextRequest("http://localhost/dashboard", {
      headers: { cookie: "crm_fibra_session=token-invalido" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("deixa passar quando o cookie tem um token válido", async () => {
    const token = await createSessionToken({ consultorId: "1", papel: "consultor" });
    const req = new NextRequest("http://localhost/dashboard", {
      headers: { cookie: `crm_fibra_session=${token}` },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run middleware.test.ts`
Expected: FAIL — `Cannot find module './middleware'`.

- [ ] **Step 3: Write the implementation**

```ts
// crm-fibra/middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/login).*)"],
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run middleware.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/middleware.ts crm-fibra/middleware.test.ts
git commit -m "feat(crm-fibra): add auth middleware gate"
```

---

## Task 10: Protected layout with live `ativo` check, and TopBar

**Files:**
- Create: `crm-fibra/app/(protected)/layout.tsx`
- Create: `crm-fibra/app/(protected)/top-bar.tsx`
- Create: `crm-fibra/app/(protected)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `verifySessionToken`, `SESSION_COOKIE_NAME` (Task 3), `buscarConsultorPorId` (Task 6), `getSupabaseAdmin` (Task 5).
- Produces: the `(protected)` route group every future screen (dashboard, leads, propostas, consultores) renders inside; satisfies the spec's requirement that a deactivated consultor is locked out even with a still-valid JWT (Review Focus #2) — this is a server component that re-checks the database on every request, not just the token.

This task has no isolated unit test: it is a Next.js layout that composes already-tested pieces (`verifySessionToken`, `buscarConsultorPorId`) with `redirect()`, which requires a rendered-route test harness this plan doesn't set up. Task 14's manual verification checklist explicitly exercises the deactivation case end-to-end.

- [ ] **Step 1: Write app/(protected)/top-bar.tsx**

```tsx
"use client";

import { useRouter } from "next/navigation";

export function TopBar({
  nome,
  papel,
}: {
  nome: string;
  papel: "admin" | "consultor";
}) {
  const router = useRouter();

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      style={{
        background: "var(--bordo)",
        color: "#fff",
        padding: "14px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <strong style={{ fontFamily: "var(--font-head)", textTransform: "uppercase" }}>
        CRM Fibra
      </strong>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
        <span>
          {nome} · {papel}
        </span>
        <button
          onClick={sair}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,.4)",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Sair
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Write app/(protected)/layout.tsx**

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { TopBar } from "./top-bar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    redirect("/login");
  }

  // Authoritative check: even a still-valid, correctly-signed JWT is
  // rejected if the consultor was deactivated since it was issued. This
  // runs on every request to a protected page, unlike the middleware
  // (Task 9), which only checks the token's signature/expiry for speed.
  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo) {
    redirect("/login");
  }

  return (
    <div>
      <TopBar nome={consultor.nome} papel={consultor.papel} />
      <main style={{ padding: "24px" }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Write app/(protected)/dashboard/page.tsx (stub — filled in by the next plan)**

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h2>Dashboard</h2>
      <p style={{ color: "var(--cinza)" }}>
        As métricas ao vivo (leads segmentados, funil, ranking) chegam no
        próximo plano, depois que a segmentação de leads existir.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Start the dev server and manually verify the redirect**

Run: `cd crm-fibra && npm run dev`, then open `http://localhost:3000/dashboard` in a browser with no cookie set.
Expected: redirected to `/login` (confirms Task 9's middleware is wired correctly ahead of this layout).

- [ ] **Step 5: Commit**

```bash
git add "crm-fibra/app/(protected)/layout.tsx" "crm-fibra/app/(protected)/top-bar.tsx" "crm-fibra/app/(protected)/dashboard/page.tsx"
git commit -m "feat(crm-fibra): add protected layout with live ativo check"
```

---

## Task 11: Login page UI

**Files:**
- Create: `crm-fibra/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/login` (Task 7).
- Produces: the `/login` screen — this is the entry point a consultor actually uses; verified manually in Task 14.

- [ ] **Step 1: Write app/login/page.tsx**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, senha }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.erro ?? "Não foi possível entrar");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bordo)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ background: "#fff", padding: "40px 36px", borderRadius: 10, width: 360 }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>CRM Fibra</h1>
        <p style={{ color: "var(--cinza)", fontSize: 13, marginBottom: 24 }}>
          Apex Smart Solutions
        </p>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Usuário</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 14, borderRadius: 6, border: "1px solid #ddd" }}
          autoFocus
        />
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 18, borderRadius: 6, border: "1px solid #ddd" }}
        />
        {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginBottom: 14 }}>{erro}</p>}
        <button
          type="submit"
          disabled={carregando}
          style={{
            width: "100%",
            padding: 12,
            background: "var(--sinal)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add crm-fibra/app/login/page.tsx
git commit -m "feat(crm-fibra): add branded login page"
```

---

## Task 12: Consultores admin screen (actions + UI)

**Files:**
- Create: `crm-fibra/app/(protected)/consultores/actions.ts`
- Test: `crm-fibra/app/(protected)/consultores/actions.test.ts`
- Create: `crm-fibra/app/(protected)/consultores/page.tsx`
- Create: `crm-fibra/app/(protected)/consultores/novo-consultor-form.tsx`
- Create: `crm-fibra/app/(protected)/consultores/consultor-row.tsx`

**Interfaces:**
- Consumes: `criarConsultor`, `definirAtivo`, `redefinirSenha`, `buscarConsultorPorId`, `UsernameJaExisteError`, `Consultor` (Task 6), `verifySessionToken`, `SESSION_COOKIE_NAME` (Task 3), `getSupabaseAdmin` (Task 5).
- Produces: `criarConsultorAction`, `definirAtivoAction`, `redefinirSenhaAction` server actions and the `/consultores` admin screen — satisfies Review Focus #5 (non-admin cannot manage consultores even calling the action directly).

- [ ] **Step 1: Write the failing tests for the actions' authorization and validation**

```ts
// crm-fibra/app/(protected)/consultores/actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
const criarConsultor = vi.fn();
const definirAtivo = vi.fn();
vi.mock("@/lib/consultores", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consultores")>(
    "@/lib/consultores"
  );
  return {
    ...actual,
    buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
    criarConsultor: (...args: unknown[]) => criarConsultor(...args),
    definirAtivo: (...args: unknown[]) => definirAtivo(...args),
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

import { criarConsultorAction, definirAtivoAction } from "./actions";

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  criarConsultor.mockReset();
  definirAtivo.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("criarConsultorAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(
      criarConsultorAction({}, formData({ nome: "A", username: "a", senha: "12345678" }))
    ).rejects.toThrow("REDIRECT:/login");
  });

  it("rejeita quando o consultor logado não é admin", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "consultor" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    await expect(
      criarConsultorAction({}, formData({ nome: "A", username: "a", senha: "12345678" }))
    ).rejects.toThrow("Apenas administradores");
    expect(criarConsultor).not.toHaveBeenCalled();
  });

  it("valida senha curta antes de chamar o banco", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "admin" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Admin",
      username: "admin",
      papel: "admin",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    const result = await criarConsultorAction(
      {},
      formData({ nome: "A", username: "a", senha: "123" })
    );

    expect(result.erro).toMatch(/mín/i);
    expect(criarConsultor).not.toHaveBeenCalled();
  });

  it("admin ativo consegue criar consultor", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "admin" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Admin",
      username: "admin",
      papel: "admin",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });
    criarConsultor.mockResolvedValue({
      id: "2",
      nome: "Novo",
      username: "novo",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    const result = await criarConsultorAction(
      {},
      formData({ nome: "Novo", username: "novo", senha: "senha1234", papel: "consultor" })
    );

    expect(result.sucesso).toBe(true);
    expect(criarConsultor).toHaveBeenCalledWith(
      {},
      { nome: "Novo", username: "novo", senha: "senha1234", papel: "consultor" }
    );
  });
});

describe("definirAtivoAction", () => {
  it("rejeita quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(definirAtivoAction("2", false)).rejects.toThrow("REDIRECT:/login");
    expect(definirAtivo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd crm-fibra && npx vitest run "app/(protected)/consultores/actions.test.ts"`
Expected: FAIL — `Cannot find module './actions'`.

- [ ] **Step 3: Write app/(protected)/consultores/actions.ts**

```tsx
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  criarConsultor,
  definirAtivo,
  redefinirSenha,
  UsernameJaExisteError,
  buscarConsultorPorId,
} from "@/lib/consultores";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

async function exigirAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo || consultor.papel !== "admin") {
    throw new Error("Apenas administradores podem gerenciar consultores");
  }
}

export type CriarConsultorState = { erro?: string; sucesso?: boolean };

export async function criarConsultorAction(
  _prev: CriarConsultorState,
  formData: FormData
): Promise<CriarConsultorState> {
  await exigirAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const papel = formData.get("papel") === "admin" ? "admin" : "consultor";

  if (!nome || !username || senha.length < 8) {
    return { erro: "Nome, usuário e senha (mín. 8 caracteres) são obrigatórios" };
  }

  try {
    await criarConsultor(getSupabaseAdmin(), { nome, username, senha, papel });
  } catch (err) {
    if (err instanceof UsernameJaExisteError) {
      return { erro: err.message };
    }
    throw err;
  }

  revalidatePath("/consultores");
  return { sucesso: true };
}

export async function definirAtivoAction(id: string, ativo: boolean): Promise<void> {
  await exigirAdmin();
  await definirAtivo(getSupabaseAdmin(), id, ativo);
  revalidatePath("/consultores");
}

export async function redefinirSenhaAction(
  id: string,
  novaSenha: string
): Promise<{ erro?: string }> {
  await exigirAdmin();
  if (novaSenha.length < 8) {
    return { erro: "A senha precisa ter pelo menos 8 caracteres" };
  }
  await redefinirSenha(getSupabaseAdmin(), id, novaSenha);
  return {};
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd crm-fibra && npx vitest run "app/(protected)/consultores/actions.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 5: Write app/(protected)/consultores/novo-consultor-form.tsx**

```tsx
"use client";

import { useActionState } from "react";
import { criarConsultorAction, type CriarConsultorState } from "./actions";

const initialState: CriarConsultorState = {};

export function NovoConsultorForm() {
  const [state, formAction, pending] = useActionState(criarConsultorAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Nome</label>
        <input name="nome" required style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Usuário</label>
        <input name="username" required style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Senha</label>
        <input name="senha" type="password" required minLength={8} style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Papel</label>
        <select name="papel" style={{ padding: 8 }}>
          <option value="consultor">Consultor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        style={{ padding: "9px 16px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
      >
        {pending ? "Criando..." : "Criar login"}
      </button>
      {state.erro && <span style={{ color: "var(--sinal)", fontSize: 13 }}>{state.erro}</span>}
      {state.sucesso && <span style={{ color: "green", fontSize: 13 }}>Criado!</span>}
    </form>
  );
}
```

- [ ] **Step 6: Write app/(protected)/consultores/consultor-row.tsx**

```tsx
"use client";

import { useState, useTransition } from "react";
import { definirAtivoAction, redefinirSenhaAction } from "./actions";
import type { Consultor } from "@/lib/consultores";

export function ConsultorRow({ consultor }: { consultor: Consultor }) {
  const [pending, startTransition] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);

  function alternarAtivo() {
    startTransition(async () => {
      await definirAtivoAction(consultor.id, !consultor.ativo);
    });
  }

  function redefinirSenha() {
    const nova = window.prompt("Nova senha (mínimo 8 caracteres):");
    if (!nova) return;
    startTransition(async () => {
      const resultado = await redefinirSenhaAction(consultor.id, nova);
      setMensagem(resultado.erro ?? "Senha redefinida");
    });
  }

  return (
    <tr>
      <td>{consultor.nome}</td>
      <td>{consultor.username}</td>
      <td>{consultor.papel}</td>
      <td>{consultor.ativo ? "Ativo" : "Desativado"}</td>
      <td style={{ display: "flex", gap: 8 }}>
        <button onClick={alternarAtivo} disabled={pending}>
          {consultor.ativo ? "Desativar" : "Reativar"}
        </button>
        <button onClick={redefinirSenha} disabled={pending}>
          Redefinir senha
        </button>
        {mensagem && <span style={{ fontSize: 12 }}>{mensagem}</span>}
      </td>
    </tr>
  );
}
```

- [ ] **Step 7: Write app/(protected)/consultores/page.tsx**

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId, listarConsultores } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { NovoConsultorForm } from "./novo-consultor-form";
import { ConsultorRow } from "./consultor-row";

export default async function ConsultoresPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  const consultores = await listarConsultores(admin);

  return (
    <div>
      <h2>Consultores</h2>
      <NovoConsultorForm />
      <table style={{ width: "100%", marginTop: 24, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 12, color: "var(--cinza)" }}>
            <th>Nome</th>
            <th>Usuário</th>
            <th>Papel</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {consultores.map((c) => (
            <ConsultorRow key={c.id} consultor={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Commit**

```bash
git add "crm-fibra/app/(protected)/consultores"
git commit -m "feat(crm-fibra): add consultores admin screen"
```

---

## Task 13: Bootstrap seed script for the first admin

**Files:**
- Create: `crm-fibra/db/seed.ts`

**Interfaces:**
- Consumes: `criarConsultor`, `UsernameJaExisteError` (Task 6), `getSupabaseAdmin` (Task 5).
- Produces: `npm run seed:admin` — the only way to create the very first login, since there is no public signup screen (by design — spec §7 only allows admin-created logins).

- [ ] **Step 1: Write db/seed.ts**

```ts
// crm-fibra/db/seed.ts
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { criarConsultor, UsernameJaExisteError } from "../lib/consultores";

async function main() {
  const nome = process.env.SEED_ADMIN_NOME ?? "Administrador";
  const username = process.env.SEED_ADMIN_USERNAME;
  const senha = process.env.SEED_ADMIN_SENHA;

  if (!username || !senha) {
    console.error(
      "Defina SEED_ADMIN_USERNAME e SEED_ADMIN_SENHA no ambiente antes de rodar o seed."
    );
    process.exit(1);
  }

  try {
    const consultor = await criarConsultor(getSupabaseAdmin(), {
      nome,
      username,
      senha,
      papel: "admin",
    });
    console.log(`Admin criado: ${consultor.username} (${consultor.id})`);
  } catch (err) {
    if (err instanceof UsernameJaExisteError) {
      console.log("Admin já existe, nada a fazer.");
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the real project (after Task 4 has been applied)**

Run: `cd crm-fibra && SUPABASE_URL=<from .env.local> SUPABASE_SERVICE_ROLE_KEY=<from .env.local> SEED_ADMIN_NOME="Seu Nome" SEED_ADMIN_USERNAME=admin SEED_ADMIN_SENHA=<escolha uma senha forte> npm run seed:admin`
Expected: prints `Admin criado: admin (<uuid>)`.

- [ ] **Step 3: Commit**

```bash
git add crm-fibra/db/seed.ts
git commit -m "feat(crm-fibra): add bootstrap seed script for first admin"
```

---

## Task 14: README and manual verification checklist

**Files:**
- Create: `crm-fibra/README.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: setup instructions and the manual verification checklist that exercises Review Focus #2 (deactivation lockout) end-to-end, which is not covered by an automated test in this plan.

- [ ] **Step 1: Write crm-fibra/README.md**

```md
# CRM Fibra

App separado do painel de clientes existente, para consultores selecionados
trabalharem os segmentos de fibra e renovação. Ver
`docs/superpowers/specs/2026-09-25-crm-leads-fibra-renovacao-design.md` para
o desenho completo.

## Setup

1. `npm install`
2. Copie `.env.example` para `.env.local` e preencha:
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: do projeto Supabase
     "apex" (`mdgfboijyqfkggcrhptn`) — a **service role key**, não a anon key.
   - `CRM_FIBRA_SESSION_SECRET`: uma string aleatória de pelo menos 32
     caracteres.
3. Rode a migração (`db/schema.sql`) contra o projeto Supabase — ver Task 4
   do plano de implementação.
4. Crie o primeiro admin: `SEED_ADMIN_USERNAME=... SEED_ADMIN_SENHA=... npm run seed:admin`
5. `npm run dev` e abra `http://localhost:3000/login`

## Testes

`npm test` roda todos os testes automatizados (Vitest).

## Checklist de verificação manual

Depois de rodar as migrações e o seed:

1. Abra `/dashboard` sem estar logado → deve redirecionar para `/login`.
2. Faça login com usuário/senha errados → mensagem de erro genérica, sem
   dizer se o usuário existe ou não.
3. Faça login com as credenciais do admin criado pelo seed → deve entrar em
   `/dashboard` e ver a topbar com seu nome e papel `admin`.
4. Vá em `/consultores`, crie um novo consultor (papel `consultor`).
5. Em outra aba/navegador anônimo, faça login com o novo consultor → deve
   entrar normalmente.
6. Volte pro admin, desative esse consultor em `/consultores`.
7. Na aba onde o consultor estava logado, recarregue qualquer página
   protegida (ex: `/dashboard`) **sem fazer logout manual** → deve
   redirecionar para `/login`, mesmo que o cookie de sessão dele ainda não
   tenha expirado. Isso confirma a checagem viva de `ativo` no banco
   (Task 10), não só a validade do token.
8. Tente acessar `/consultores` logado como um consultor comum (não admin)
   → deve redirecionar para `/dashboard`.
9. Clique em "Sair" → deve voltar para `/login` e qualquer página protegida
   volta a redirecionar.
```

- [ ] **Step 2: Run the full test suite once more**

Run: `cd crm-fibra && npm test`
Expected: all tests across every task pass.

- [ ] **Step 3: Commit**

```bash
git add crm-fibra/README.md
git commit -m "docs(crm-fibra): add setup guide and manual verification checklist"
```
