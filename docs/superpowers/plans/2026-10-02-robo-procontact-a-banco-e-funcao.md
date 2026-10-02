# Robô ProContact — Plano A: banco e Edge Function `ingest-ligacoes`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a tabela `ligacoes_sync_log` e a Edge Function `ingest-ligacoes`, que recebe do robô as linhas do relatório de Chamadas Manuais, valida, grava em `ligacoes_manuais` (upsert por `id`) e registra cada execução.

**Architecture:** O robô (Plano B) nunca vê a chave do banco: chama a função com um token próprio (`x-robo-token`). A função é dividida em lógica pura (`ingest.ts`, testada com `node --test`, sem rede) e uma casca fina (`index.ts`) que liga a lógica ao Supabase com a service role. Mesmo padrão de `alerta-sync-producao` e `sync-producao`.

**Tech Stack:** Deno (Supabase Edge Functions), TypeScript, `npm:@supabase/supabase-js@2`, `node:test` (Node 24 executa `.ts` direto), SQL/Postgres (RLS).

**Spec:** `docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md` (seções 4, 6, 7, 9, 10)

## Global Constraints

- Trabalhar no worktree `.worktrees/robo-procontact` (branch `feat/robo-procontact`, base `oficial/main`). `git fetch oficial` antes de qualquer merge/push. Push sem `--force`, **só com autorização explícita do Rafael**.
- Supabase `apex` (`mdgfboijyqfkggcrhptn`) é **produção**: escrita/DDL (aplicar migration, publicar função, criar secret) **só com ok explícito do Rafael, na hora**. Antes de aplicar, conferir que tabela e função não existem.
- Nenhum segredo, telefone, nome de cliente ou CNPJ em arquivo do repositório (repo público). Respostas e logs da função **nunca** contêm telefone.
- Regras herdadas do upload manual (REGRAS_NEGOCIO.md 59.3 e 65): `id` único por ligação; `chave_tel` = DDD + 8 últimos dígitos (tira `55` se houver 12+ dígitos); horário em São Paulo (`-03:00`); usuário começando por `eagle` (sem diferença de maiúsculas/espaços) é descartado; `tabulacao` é gravada como vem (inclusive `-`).
- Lote máximo: 500 linhas e 1 MB por requisição.
- `_template.html` fica em LF; não mexer em `_template.html` neste plano.

## Review Focus

1. Lote vazio (`lote: []`) → 200, `gravadas: 0`, sem chamar o banco.
2. Lote com 501 linhas → 400 e nada gravado.
3. Usuário `" EAGLE.Maria "` (maiúsculas e espaços) → contado como `ignoradasEagle`, não gravado; `apex.eagleton` → gravado.
4. Telefone vazio/nulo → linha **gravada** com `chave_tel` nulo (como no upload manual), não rejeitada.
5. Token ausente, vazio ou de tamanho diferente → 401 sem corpo informativo; método diferente de POST → 405.
6. `final` repetido com o mesmo `execucao_id` (retentativa do robô) → não cria segunda linha no log.
7. Corpo que não é JSON, `acao` desconhecida ou data fora do formato → 400 (nunca 500).
8. Erro do banco → 500 com mensagem genérica, sem eco das linhas recebidas.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261002000000_ligacoes_sync_log.sql` | Tabela `ligacoes_sync_log` + RLS (leitura admin/supervisor) |
| `supabase/rollback/20261002000000_ligacoes_sync_log_rollback.sql` | Desfaz a migration |
| `supabase/tests/ligacoes_sync_log_check.sql` | Verificação em transação com ROLLBACK |
| `supabase/functions/ingest-ligacoes/ingest.ts` | Lógica pura: `chaveTel`, `ehEagle`, `validarLote`, `validarFinal`, `processar` |
| `supabase/functions/ingest-ligacoes/ingest.test.ts` | Testes da lógica pura |
| `supabase/functions/ingest-ligacoes/index.ts` | `Deno.serve`: autenticação por token, limites, deps reais |

Comandos de teste rodam de dentro de `supabase/functions/ingest-ligacoes/`: `node --test ingest.test.ts`.

---

### Task 1: Migration `ligacoes_sync_log`

**Files:**
- Create: `supabase/migrations/20261002000000_ligacoes_sync_log.sql`
- Create: `supabase/rollback/20261002000000_ligacoes_sync_log_rollback.sql`
- Create: `supabase/tests/ligacoes_sync_log_check.sql`

**Interfaces:**
- Produces: tabela `public.ligacoes_sync_log(id, execucao_id uuid unique, iniciou_em, terminou_em, ok, lidas, enviadas, invalidas, ignoradas_eagle, periodo_de, periodo_ate, erro)`; leitura só para `admin`/`supervisor` (via `public.get_my_role()`); escrita só por service role.

- [ ] **Step 1: Escrever o teste SQL (falha enquanto a tabela não existe)**

`supabase/tests/ligacoes_sync_log_check.sql`:

```sql
-- Verificação de ligacoes_sync_log. Roda SOMENTE depois de a migration estar aplicada e SEMPRE termina em ROLLBACK.
begin;

do $$
declare n int;
begin
  assert to_regclass('public.ligacoes_sync_log') is not null, 'tabela ligacoes_sync_log existe';

  insert into public.ligacoes_sync_log (execucao_id, iniciou_em, ok, lidas, enviadas)
    values ('00000000-0000-0000-0000-000000000001', now() - interval '1 minute', true, 10, 8);

  -- execucao_id é único (retentativa do robô não duplica)
  begin
    insert into public.ligacoes_sync_log (execucao_id, iniciou_em, ok)
      values ('00000000-0000-0000-0000-000000000001', now(), true);
    assert false, 'execucao_id repetido deveria falhar';
  exception when unique_violation then null;
  end;

  -- RLS ligada e sem política de escrita
  assert (select relrowsecurity from pg_class where oid = 'public.ligacoes_sync_log'::regclass), 'RLS ligada';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ligacoes_sync_log' and cmd in ('INSERT','UPDATE','DELETE','ALL');
  assert n = 0, 'nenhuma política de escrita (só a service role grava)';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'ligacoes_sync_log' and cmd = 'SELECT';
  assert n = 1, 'uma política de leitura';
end $$;

rollback;
```

- [ ] **Step 2: Conferir que a tabela ainda não existe no banco**

Via MCP `mcp__supabase__execute_sql` (somente leitura) no projeto `mdgfboijyqfkggcrhptn`:

```sql
select to_regclass('public.ligacoes_sync_log') as existe;
```

Expected: `existe = null`. Se vier preenchido, **pare** e avise o Rafael.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261002000000_ligacoes_sync_log.sql`:

```sql
-- 02/10/2026 — Robô ProContact: registro de cada execução da sincronização automática de chamadas manuais.
-- A Edge Function ingest-ligacoes grava aqui (service role) ao fim de cada execução; o painel lê para avisar
-- quando a sincronização parar. Spec: docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md
create table if not exists public.ligacoes_sync_log (
  id bigint generated always as identity primary key,
  execucao_id uuid not null unique,        -- gerado pelo robô; um final repetido (retentativa) não duplica
  iniciou_em timestamptz not null,
  terminou_em timestamptz not null default now(),
  ok boolean not null,
  lidas int not null default 0,            -- linhas do arquivo exportado
  enviadas int not null default 0,         -- linhas válidas enviadas à função
  invalidas int not null default 0,
  ignoradas_eagle int not null default 0,
  periodo_de timestamptz,
  periodo_ate timestamptz,
  erro text                                -- mensagem curta, nunca dados de ligação
);
create index if not exists idx_ligacoes_sync_log_ok on public.ligacoes_sync_log (ok, terminou_em desc);

alter table public.ligacoes_sync_log enable row level security;
drop policy if exists ligacoes_sync_log_select on public.ligacoes_sync_log;
create policy ligacoes_sync_log_select on public.ligacoes_sync_log for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
-- sem política de escrita: só a Edge Function (service_role) grava.
```

`supabase/rollback/20261002000000_ligacoes_sync_log_rollback.sql`:

```sql
drop table if exists public.ligacoes_sync_log;
```

- [ ] **Step 4: Pedir autorização e aplicar a migration**

Perguntar ao Rafael: "Posso aplicar a migration `ligacoes_sync_log` (tabela nova, só adiciona) no Supabase `apex` de produção?" Só com "sim", aplicar via `mcp__supabase__apply_migration` (name `ligacoes_sync_log`, query = conteúdo do arquivo).

- [ ] **Step 5: Rodar a verificação**

Executar o conteúdo de `supabase/tests/ligacoes_sync_log_check.sql` via `mcp__supabase__execute_sql`.
Expected: sem exceção (o bloco termina em ROLLBACK, nada fica gravado).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261002000000_ligacoes_sync_log.sql supabase/rollback/20261002000000_ligacoes_sync_log_rollback.sql supabase/tests/ligacoes_sync_log_check.sql
git commit -m "feat(ligacoes): tabela ligacoes_sync_log (registro das execuções do robô ProContact)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Validação e mapeamento do lote (`ingest.ts`, parte 1)

**Files:**
- Create: `supabase/functions/ingest-ligacoes/ingest.ts`
- Create: `supabase/functions/ingest-ligacoes/ingest.test.ts`

**Interfaces:**
- Produces (exports de `ingest.ts`):
  - `MAX_LOTE = 500`
  - `type LinhaDb = { id: number; usuario: string; telefone: string | null; chave_tel: string | null; gerada_em: string; atendida: boolean; seg_falados: number; tabulacao: string | null; transferido: string | null; gravacao: string | null }`
  - `chaveTel(v: unknown): string | null`
  - `ehEagle(usuario: unknown): boolean`
  - `validarLote(lote: unknown): { linhas: LinhaDb[]; invalidas: number; ignoradasEagle: number }` — lança `Error` com mensagem curta se `lote` não for array ou tiver mais de 500 itens.

- [ ] **Step 1: Escrever os testes que falham**

`supabase/functions/ingest-ligacoes/ingest.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveTel, ehEagle, validarLote, MAX_LOTE } from "./ingest.ts";

const base = {
  id: 1001, usuario: "apex.caiocosta", telefone: "19999990001", gerada_em: "2026-10-01T12:20:59-03:00",
  atendida: true, seg_falados: 75, tabulacao: "RETORNO", transferido: null, gravacao: null,
};

test("chaveTel: DDD + 8 últimos dígitos, tira o 55 e ignora o 9º dígito", () => {
  assert.equal(chaveTel("19999990001"), "1999990001");
  assert.equal(chaveTel("5519999990001"), "1999990001");
  assert.equal(chaveTel("(19) 99999-0001"), "1999990001");
  assert.equal(chaveTel("1999990001"), "1999990001");
});
test("chaveTel: curto, vazio ou nulo → null", () => {
  assert.equal(chaveTel("12345"), null);
  assert.equal(chaveTel(""), null);
  assert.equal(chaveTel(null), null);
});
test("ehEagle: começa com eagle, sem diferença de caixa/espaços; eagleton não conta", () => {
  assert.equal(ehEagle("eagle.juliana"), true);
  assert.equal(ehEagle("  EAGLE.Maria "), true);
  assert.equal(ehEagle("apex.eagleton"), false);
  assert.equal(ehEagle(null), false);
});

test("validarLote: linha válida vira LinhaDb com chave_tel calculada", () => {
  const r = validarLote([base]);
  assert.equal(r.invalidas, 0);
  assert.equal(r.ignoradasEagle, 0);
  assert.deepEqual(r.linhas[0], { ...base, chave_tel: "1999990001" });
});
test("validarLote: lote vazio é válido", () => {
  assert.deepEqual(validarLote([]), { linhas: [], invalidas: 0, ignoradasEagle: 0 });
});
test("validarLote: mais de 500 itens → erro, nada processado", () => {
  assert.throws(() => validarLote(Array.from({ length: MAX_LOTE + 1 }, (_, i) => ({ ...base, id: i + 1 }))), /lote/i);
});
test("validarLote: não-array → erro", () => {
  assert.throws(() => validarLote({} as unknown), /lote/i);
  assert.throws(() => validarLote(null as unknown), /lote/i);
});
test("validarLote: usuário eagle é contado e não entra; apex.eagleton entra", () => {
  const r = validarLote([{ ...base, id: 1, usuario: " EAGLE.Maria " }, { ...base, id: 2, usuario: "apex.eagleton" }]);
  assert.equal(r.ignoradasEagle, 1);
  assert.deepEqual(r.linhas.map((l) => l.id), [2]);
});
test("validarLote: telefone vazio/nulo é gravado com chave_tel nula", () => {
  const r = validarLote([{ ...base, id: 3, telefone: null }, { ...base, id: 4, telefone: "" }]);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas.map((l) => [l.telefone, l.chave_tel]), [[null, null], [null, null]]);
});
test("validarLote: inválidas (id ruim, data fora do formato, data impossível, tipos errados)", () => {
  const ruins = [
    { ...base, id: 0 }, { ...base, id: -5 }, { ...base, id: 1.5 }, { ...base, id: "12" },
    { ...base, id: 5, gerada_em: "01/10/2026 12:20:59" },
    { ...base, id: 6, gerada_em: "2026-02-30T10:00:00-03:00" },
    { ...base, id: 7, gerada_em: "2026-10-01T25:00:00-03:00" },
    { ...base, id: 8, usuario: "" }, { ...base, id: 9, usuario: 5 },
    { ...base, id: 10, atendida: "sim" }, { ...base, id: 11, seg_falados: -1 }, { ...base, id: 12, seg_falados: 1.5 },
    { ...base, id: 13, seg_falados: 90000 }, { ...base, id: 14, tabulacao: 7 }, null, "texto", 42,
  ];
  const r = validarLote(ruins);
  assert.equal(r.invalidas, ruins.length);
  assert.equal(r.linhas.length, 0);
});
test("validarLote: id repetido no mesmo lote entra uma vez só", () => {
  const r = validarLote([base, { ...base, seg_falados: 99 }]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.linhas[0].seg_falados, 75);
});
test("validarLote: telefone só aceita dígitos (o robô já limpa) e texto longo é inválido", () => {
  const r = validarLote([{ ...base, id: 20, telefone: "19 9999-0001" }, { ...base, id: 21, tabulacao: "x".repeat(201) }]);
  assert.equal(r.invalidas, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/ingest-ligacoes && node --test ingest.test.ts`
Expected: FAIL (`Cannot find module './ingest.ts'` ou funções não definidas).

- [ ] **Step 3: Implementar**

`supabase/functions/ingest-ligacoes/ingest.ts`:

```ts
// Lógica pura da Edge Function ingest-ligacoes (sem rede, testada com node --test).
// Mesmas regras de mlParseRelatorio no _template.html (REGRAS_NEGOCIO.md 59.3 e 65): a função valida de novo o que o
// robô enviou, porque o robô é só um cliente — o banco não confia em ninguém.
export const MAX_LOTE = 500;

export type LinhaDb = {
  id: number;
  usuario: string;
  telefone: string | null;
  chave_tel: string | null;
  gerada_em: string; // ISO com -03:00 (São Paulo)
  atendida: boolean;
  seg_falados: number;
  tabulacao: string | null;
  transferido: string | null;
  gravacao: string | null;
};
export type LoteValidado = { linhas: LinhaDb[]; invalidas: number; ignoradasEagle: number };

// Telefone -> DDD + 8 últimos dígitos (ignora o 9º dígito e o 55 inicial). Igual a chaveTel() do painel e a public.chave_tel.
export function chaveTel(v: unknown): string | null {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}

// Usuários da Eagle não fazem parte da operação (REGRAS 65). O gatilho do banco também descarta.
export function ehEagle(usuario: unknown): boolean {
  return /^eagle/i.test(String(usuario ?? "").trim());
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})-03:00$/;
function dataValida(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || se > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// string curta ou nula; qualquer outro tipo (ou texto longo) devolve undefined = inválido
function textoOuNulo(v: unknown, max: number): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string" || v.length > max) return undefined;
  return v;
}

export function validarLote(lote: unknown): LoteValidado {
  if (!Array.isArray(lote)) throw new Error("lote inválido: esperado uma lista");
  if (lote.length > MAX_LOTE) throw new Error(`lote inválido: no máximo ${MAX_LOTE} linhas`);
  const out: LoteValidado = { linhas: [], invalidas: 0, ignoradasEagle: 0 };
  const vistos = new Set<number>();
  for (const r of lote as Record<string, unknown>[]) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) { out.invalidas++; continue; }
    const id = r.id;
    const usuario = typeof r.usuario === "string" ? r.usuario.trim() : "";
    const telefone = r.telefone == null || r.telefone === "" ? null : r.telefone;
    const tab = textoOuNulo(r.tabulacao, 200);
    const transf = textoOuNulo(r.transferido, 200);
    const grav = textoOuNulo(r.gravacao, 400);
    const seg = r.seg_falados;
    if (
      typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 ||
      !usuario || usuario.length > 80 ||
      !dataValida(r.gerada_em) ||
      typeof r.atendida !== "boolean" ||
      typeof seg !== "number" || !Number.isInteger(seg) || seg < 0 || seg > 86400 ||
      (telefone !== null && (typeof telefone !== "string" || !/^\d{1,20}$/.test(telefone))) ||
      tab === undefined || transf === undefined || grav === undefined
    ) { out.invalidas++; continue; }
    if (ehEagle(usuario)) { out.ignoradasEagle++; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.linhas.push({
      id, usuario, telefone: telefone as string | null, chave_tel: chaveTel(telefone), gerada_em: r.gerada_em as string,
      atendida: r.atendida, seg_falados: seg, tabulacao: tab, transferido: transf, gravacao: grav,
    });
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/ingest-ligacoes && node --test ingest.test.ts`
Expected: todos os testes PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-ligacoes/ingest.ts supabase/functions/ingest-ligacoes/ingest.test.ts
git commit -m "feat(ligacoes): validação e mapeamento do lote do robô (ingest.ts)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Ações `lote`, `final` e `contar` (`processar`)

**Files:**
- Modify: `supabase/functions/ingest-ligacoes/ingest.ts` (acrescentar ao final)
- Modify: `supabase/functions/ingest-ligacoes/ingest.test.ts` (acrescentar ao final)

**Interfaces:**
- Consumes: `validarLote`, `LinhaDb`, `MAX_LOTE` (Task 2).
- Produces:
  - `type LogExecucao = { execucao_id: string; iniciou_em: string; ok: boolean; lidas: number; enviadas: number; invalidas: number; ignoradas_eagle: number; periodo_de: string | null; periodo_ate: string | null; erro: string | null }`
  - `type DepsIngest = { gravarLigacoes(linhas: LinhaDb[]): Promise<void>; gravarLog(l: LogExecucao): Promise<void>; contarPeriodo(de: string, ate: string): Promise<number> }`
  - `processar(corpo: unknown, deps: DepsIngest): Promise<{ status: number; corpo: Record<string, unknown> }>`
  - Ações aceitas no corpo JSON: `{acao:"lote", lote:[...]}` → `{recebidas, gravadas, invalidas, ignoradasEagle}`; `{acao:"final", execucao_id, iniciou_em, ok, lidas, enviadas, invalidas, ignoradas_eagle, periodo_de?, periodo_ate?, erro?}` → `{ok:true}`; `{acao:"contar", de, ate}` → `{total}`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `ingest.test.ts` (e mudar o `import` da primeira linha para incluir `processar` e os tipos):

```ts
import { processar } from "./ingest.ts";
import type { DepsIngest, LinhaDb, LogExecucao } from "./ingest.ts";

function deps(sobre: Partial<DepsIngest> = {}) {
  const chamadas = { gravar: [] as LinhaDb[][], logs: [] as LogExecucao[], contar: [] as string[][] };
  const d: DepsIngest = {
    async gravarLigacoes(l) { chamadas.gravar.push(l); },
    async gravarLog(l) { chamadas.logs.push(l); },
    async contarPeriodo(de, ate) { chamadas.contar.push([de, ate]); return 42; },
    ...sobre,
  };
  return { d, chamadas };
}
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const finalOk = {
  acao: "final", execucao_id: UUID, iniciou_em: "2026-10-02T13:00:00Z", ok: true,
  lidas: 17498, enviadas: 8815, invalidas: 1, ignoradas_eagle: 8682,
  periodo_de: "2026-10-01T00:00:00-03:00", periodo_ate: "2026-10-02T23:59:00-03:00",
};

test("processar lote: grava só as válidas e devolve contagens (sem telefone)", async () => {
  const { d, chamadas } = deps();
  const r = await processar({ acao: "lote", lote: [base, { ...base, id: 2, usuario: "eagle.x" }, { ...base, id: 0 }] }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { recebidas: 3, gravadas: 1, invalidas: 1, ignoradasEagle: 1 });
  assert.equal(chamadas.gravar.length, 1);
  assert.equal(chamadas.gravar[0][0].id, 1001);
  assert.ok(!JSON.stringify(r.corpo).includes("19999990001"));
});
test("processar lote vazio: 200 e não chama o banco", async () => {
  const { d, chamadas } = deps();
  const r = await processar({ acao: "lote", lote: [] }, d);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.gravadas, 0);
  assert.equal(chamadas.gravar.length, 0);
});
test("processar lote com 501 linhas: 400 e nada gravado", async () => {
  const { d, chamadas } = deps();
  const r = await processar({ acao: "lote", lote: Array.from({ length: 501 }, (_, i) => ({ ...base, id: i + 1 })) }, d);
  assert.equal(r.status, 400);
  assert.equal(chamadas.gravar.length, 0);
});
test("processar lote: erro do banco → 500 genérico, sem eco das linhas", async () => {
  const { d } = deps({ async gravarLigacoes() { throw new Error("duplicate key 19999990001 violates ..."); } });
  const r = await processar({ acao: "lote", lote: [base] }, d);
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.corpo).includes("19999990001"));
});
test("processar final: grava o log com os campos validados", async () => {
  const { d, chamadas } = deps();
  const r = await processar(finalOk, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true });
  assert.equal(chamadas.logs.length, 1);
  assert.equal(chamadas.logs[0].execucao_id, UUID);
  assert.equal(chamadas.logs[0].lidas, 17498);
  assert.equal(chamadas.logs[0].erro, null);
});
test("processar final com erro: ok=false guarda o erro cortado em 300 caracteres", async () => {
  const { d, chamadas } = deps();
  await processar({ ...finalOk, ok: false, erro: "x".repeat(500) }, d);
  assert.equal(chamadas.logs[0].ok, false);
  assert.equal(chamadas.logs[0].erro?.length, 300);
});
test("processar final: execucao_id que não é uuid, contagem negativa ou data ruim → 400", async () => {
  const { d, chamadas } = deps();
  for (const ruim of [
    { ...finalOk, execucao_id: "abc" }, { ...finalOk, lidas: -1 }, { ...finalOk, lidas: 1.5 },
    { ...finalOk, iniciou_em: "ontem" }, { ...finalOk, ok: "sim" }, { ...finalOk, periodo_de: "01/10/2026" },
  ]) {
    assert.equal((await processar(ruim, d)).status, 400);
  }
  assert.equal(chamadas.logs.length, 0);
});
test("processar final repetido: delega a gravarLog (idempotência fica no upsert por execucao_id)", async () => {
  const { d, chamadas } = deps();
  await processar(finalOk, d);
  await processar(finalOk, d);
  assert.equal(chamadas.logs.length, 2);
  assert.equal(chamadas.logs[0].execucao_id, chamadas.logs[1].execucao_id);
});
test("processar contar: devolve o total do período e valida as datas", async () => {
  const { d, chamadas } = deps();
  const r = await processar({ acao: "contar", de: "2026-10-01T00:00:00-03:00", ate: "2026-10-01T23:59:59-03:00" }, d);
  assert.deepEqual(r, { status: 200, corpo: { total: 42 } });
  assert.deepEqual(chamadas.contar[0], ["2026-10-01T00:00:00-03:00", "2026-10-01T23:59:59-03:00"]);
  assert.equal((await processar({ acao: "contar", de: "x", ate: "y" }, d)).status, 400);
});
test("processar: corpo não-objeto ou acao desconhecida → 400", async () => {
  const { d } = deps();
  for (const ruim of [null, "texto", 7, [], {}, { acao: "apagar" }]) {
    assert.equal((await processar(ruim, d)).status, 400);
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/ingest-ligacoes && node --test ingest.test.ts`
Expected: FAIL (`processar` não exportado).

- [ ] **Step 3: Implementar**

Acrescentar ao final de `ingest.ts`:

```ts
export type LogExecucao = {
  execucao_id: string;
  iniciou_em: string;
  ok: boolean;
  lidas: number;
  enviadas: number;
  invalidas: number;
  ignoradas_eagle: number;
  periodo_de: string | null;
  periodo_ate: string | null;
  erro: string | null;
};
export type DepsIngest = {
  gravarLigacoes(linhas: LinhaDb[]): Promise<void>;
  gravarLog(l: LogExecucao): Promise<void>;
  contarPeriodo(de: string, ate: string): Promise<number>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ruim = (msg: string): Resposta => ({ status: 400, corpo: { error: msg } });
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isoUtcOuSP = (v: unknown): v is string =>
  typeof v === "string" && (dataValida(v) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))));

function validarFinal(c: Record<string, unknown>): LogExecucao | null {
  if (typeof c.execucao_id !== "string" || !RE_UUID.test(c.execucao_id)) return null;
  if (!isoUtcOuSP(c.iniciou_em) || typeof c.ok !== "boolean") return null;
  if (![c.lidas, c.enviadas, c.invalidas, c.ignoradas_eagle].every(inteiro)) return null;
  for (const k of ["periodo_de", "periodo_ate"] as const) {
    if (c[k] != null && !isoUtcOuSP(c[k])) return null;
  }
  const erro = c.erro == null ? null : typeof c.erro === "string" ? c.erro.slice(0, 300) : undefined;
  if (erro === undefined) return null;
  return {
    execucao_id: c.execucao_id, iniciou_em: c.iniciou_em, ok: c.ok,
    lidas: c.lidas as number, enviadas: c.enviadas as number, invalidas: c.invalidas as number,
    ignoradas_eagle: c.ignoradas_eagle as number,
    periodo_de: (c.periodo_de as string | null | undefined) ?? null,
    periodo_ate: (c.periodo_ate as string | null | undefined) ?? null,
    erro,
  };
}

export async function processar(corpo: unknown, deps: DepsIngest): Promise<Resposta> {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) return ruim("corpo inválido");
  const c = corpo as Record<string, unknown>;
  try {
    if (c.acao === "lote") {
      let v: LoteValidado;
      try { v = validarLote(c.lote); } catch (e) { return ruim((e as Error).message); }
      if (v.linhas.length) await deps.gravarLigacoes(v.linhas);
      return {
        status: 200,
        corpo: { recebidas: (c.lote as unknown[]).length, gravadas: v.linhas.length, invalidas: v.invalidas, ignoradasEagle: v.ignoradasEagle },
      };
    }
    if (c.acao === "final") {
      const log = validarFinal(c);
      if (!log) return ruim("resumo inválido");
      await deps.gravarLog(log);
      return { status: 200, corpo: { ok: true } };
    }
    if (c.acao === "contar") {
      if (!dataValida(c.de) || !dataValida(c.ate)) return ruim("período inválido");
      return { status: 200, corpo: { total: await deps.contarPeriodo(c.de, c.ate) } };
    }
    return ruim("ação desconhecida");
  } catch (e) {
    // o detalhe vai para o log do servidor (index.ts); a resposta nunca ecoa dados recebidos
    console.error("ingest-ligacoes:", (e as Error).message.slice(0, 200));
    return { status: 500, corpo: { error: "erro interno" } };
  }
}
```

Observação: o `console.error` acima pode registrar texto do erro do banco; o corte em 200 caracteres limita, e `gravarLigacoes` em `index.ts` converte o erro do PostgREST em mensagem **sem** os valores (Task 4).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/ingest-ligacoes && node --test ingest.test.ts`
Expected: todos PASS (Task 2 + Task 3).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-ligacoes/ingest.ts supabase/functions/ingest-ligacoes/ingest.test.ts
git commit -m "feat(ligacoes): ações lote, final e contar da função ingest-ligacoes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Casca `index.ts`, publicação e teste de fumaça

**Files:**
- Create: `supabase/functions/ingest-ligacoes/index.ts`

**Interfaces:**
- Consumes: `processar`, `DepsIngest`, `MAX_LOTE` (Tasks 2–3).
- Produces: endpoint `POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-ligacoes`, header `x-robo-token`, corpo JSON das três ações. Secrets: `INGEST_LIGACOES_TOKEN` (novo); `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente das funções.

- [ ] **Step 1: Escrever `index.ts`**

```ts
// Edge Function: ingest-ligacoes — recebe do robô ProContact (Plano B) as linhas do relatório de Chamadas Manuais
// e grava em ligacoes_manuais (upsert por id) e em ligacoes_sync_log. Spec: docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md
// Chamada só pelo robô (header x-robo-token = secret INGEST_LIGACOES_TOKEN); por isso roda sem JWT (--no-verify-jwt).
// Publicar: npx supabase functions deploy ingest-ligacoes --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./ingest.ts";
import type { DepsIngest } from "./ingest.ts";

const MAX_BYTES = 1_000_000;

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

function criarDeps(): DepsIngest {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // a mensagem do PostgREST pode citar valores da linha; guardamos só o código e o contexto
  const falha = (ctx: string, error: { code?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  return {
    async gravarLigacoes(linhas) {
      const { error } = await sb.from("ligacoes_manuais").upsert(linhas, { onConflict: "id" });
      falha("gravar ligações", error);
    },
    async gravarLog(l) {
      const { error } = await sb.from("ligacoes_sync_log").upsert(l, { onConflict: "execucao_id" });
      falha("gravar log da execução", error);
    },
    async contarPeriodo(de, ate) {
      const { count, error } = await sb.from("ligacoes_manuais").select("id", { count: "exact", head: true })
        .gte("gerada_em", de).lte("gerada_em", ate);
      falha("contar ligações", error);
      return count ?? 0;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let esperado: string;
  try { esperado = env("INGEST_LIGACOES_TOKEN"); } catch { return json({ error: "Não autorizado" }, 401); }
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

- [ ] **Step 2: Conferir que os testes continuam passando**

Run: `cd supabase/functions/ingest-ligacoes && node --test ingest.test.ts`
Expected: PASS (o `index.ts` não é importado pelos testes; só confirma que nada quebrou).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ingest-ligacoes/index.ts
git commit -m "feat(ligacoes): casca da Edge Function ingest-ligacoes (token do robô, limites, supabase)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Gerar o token e pedir autorização para publicar**

Pedir ao Rafael, em uma mensagem: "Posso publicar a função `ingest-ligacoes` no Supabase `apex` (função nova, não altera nenhuma existente)? Antes, você gera o token e cadastra o secret (eu não vejo o valor):"

```bash
# no terminal do Rafael — gera 64 caracteres aleatórios e cadastra no Supabase; NÃO colar o valor no chat
openssl rand -hex 32
npx supabase secrets set INGEST_LIGACOES_TOKEN=<valor-gerado> --project-ref mdgfboijyqfkggcrhptn
```

O Rafael guarda o mesmo valor para o Plano B (secret `INGEST_TOKEN` do GitHub). Sem o "sim" e sem o secret cadastrado, **não prosseguir**.

- [ ] **Step 5: Publicar (somente com o "sim")**

Run (da raiz do worktree): `npx supabase functions deploy ingest-ligacoes --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`
Expected: "Deployed Function ingest-ligacoes". Confirmar com `mcp__supabase__list_edge_functions` que ela aparece.

- [ ] **Step 6: Teste de fumaça (somente leitura — nada é gravado)**

O Rafael roda no terminal dele (o token vem da própria máquina dele):

```bash
# 1) sem token → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-ligacoes -d '{}'
# 2) com token, ação 'contar' do dia 01/10 → {"total": ...}
curl -s -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-ligacoes \
  -H "x-robo-token: $INGEST_LIGACOES_TOKEN" -H "content-type: application/json" \
  -d '{"acao":"contar","de":"2026-10-01T00:00:00-03:00","ate":"2026-10-01T23:59:59-03:00"}'
# 3) com token e lote vazio → gravadas 0
curl -s -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-ligacoes \
  -H "x-robo-token: $INGEST_LIGACOES_TOKEN" -H "content-type: application/json" -d '{"acao":"lote","lote":[]}'
```

Expected: `401`; depois `{"total":<número>}`; depois `{"recebidas":0,"gravadas":0,"invalidas":0,"ignoradasEagle":0}`.

- [ ] **Step 7: Registro e commit**

Anotar em `docs/superpowers/plans/` (este arquivo) nada; o registro oficial vai para `REGRAS_NEGOCIO.md` no Plano C (seção nova, próximo número livre depois de `git fetch oficial`). Não há commit nesta etapa se nada mudou.

**Critério de pronto do Plano A:** testes `node --test` passam; função publicada e respondendo 401/200 conforme acima; tabela `ligacoes_sync_log` criada e verificada; nenhuma linha de ligação gravada pelos testes de fumaça.
