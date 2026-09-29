# Sincronização automática da Produção (NeoSales) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alimentar sozinho, de hora em hora, uma tabela `producao_pedidos_neo` espelhando o NeoCRM via API NeoSales, eliminando a exportação manual do relatório de produção.

**Architecture:** Uma Edge Function (`sync-producao`) busca a API por janelas, mapeia para o formato de `producao_pedidos`, faz upsert por `item_id` e registra cada execução em `producao_sync_log`. `pg_cron` + `pg_net` a chamam de hora em hora, reconciliam à noite e fazem uma carga inicial única. A lógica é pura (mapper/janelas/orquestração com dependências injetadas) e testada com `node --test`.

**Tech Stack:** Supabase (Postgres 17, Edge Functions/Deno, pg_cron, pg_net, Vault), Supabase CLI via `npx`, TypeScript testado com o test runner nativo do Node 24 (type stripping).

**Spec:** `docs/superpowers/specs/2026-09-29-sync-producao-neosales-design.md`

## Global Constraints

- Projeto Supabase: `apex`, ref `mdgfboijyqfkggcrhptn`. Sempre passar `--project-ref mdgfboijyqfkggcrhptn` (e `--linked` em `db query`). Nunca tocar `apex-pratica-vendas`.
- Tudo pelo terminal com `npx supabase` (v2.118.0), executado a partir da raiz do worktree (onde está `supabase/`). Login já feito pelo usuário.
- **Não alterar `producao_pedidos`** nem o dashboard nesta fase. A tabela nova é separada.
- Tokens do NeoSales só como secrets da Edge Function; **nunca** em arquivo versionado, em HTML ou em log. Arquivos temporários com segredos ficam no scratchpad e são apagados ao final da Task 7.
- Fuso: horários da API são de São Paulo (UTC-3, sem horário de verão). Gravar `timestamptz` com offset `-03:00`.
- **A API só aceita uma consulta a cada ~2 min** (resposta HTTP 200 `{"erro":"Integração de produção executada recentemente. Aguarde N segundos…"}`): no máximo UMA consulta à API por execução da função, jobs do cron com ≥ 5 min de folga, e testes manuais reais espaçados de ≥ 130 s.
- A API responde em ISO-8859-1; erros vêm com **HTTP 200** e `{"erro": "...", "success": false}`; janela vazia = `[]`.
- Janela diurna máx. 90 min (usar 85). Modo sem limite (`backfill`/`reconciliar`) só entre 22:02 e 04:58 (SP) — margem conservadora entre "05:00" (mensagem da API) e "05:59" (doc).
- Código TypeScript das Edge Functions: só sintaxe apagável (sem `enum`, sem parameter properties); usar `import type` para tipos; imports relativos com extensão `.ts`. Assim roda igual no Node (testes) e no Deno (produção).
- Commits só dos caminhos da tarefa (`git add <paths>`), nunca `git add -A` (há arquivos não relacionados sem commit no repositório). Trabalhar na branch `feat/sync-producao-neosales`, no worktree `.worktrees/sync-producao` criado a partir de `oficial/main` (repositório PÚBLICO do CRM, arquivos na raiz, sem `crm/`); o link do Supabase vive em `supabase/.temp`, ignorado pelo git.
- Comandos `npx supabase ...` rodam a partir da raiz do worktree; comandos `node --test` rodam a partir de `supabase/functions/sync-producao/`. Convenções dos comandos deste plano: `$WT` = raiz do worktree; `$SP` = pasta temporária fora do repositório (onde ficam os segredos durante a execução).

## Review Focus

- Erro da NeoSales com HTTP 200 (`{"erro":…}`), ex.: token vencido → deve virar falha registrada, **não** "0 pedidos" (Task 4).
- Resposta com o mesmo `itemId` repetido no mesmo lote → não pode quebrar o upsert nem sumir em silêncio (Task 2).
- Item que depois vira `ARQUIVADO (NEOCRM)` → tem de sair da tabela (Tasks 2 e 5).
- Consulta dentro do intervalo de espera da API (~2 min) ou falha ao gravar → log `ok=false`, cursor **não** avança, a próxima execução recupera (Task 5). Janela que exigiria mais de uma consulta é recusada antes de chamar a API (Task 5).
- Janela diurna maior que 90 min (queda prolongada) → reduzir e avisar, nunca pedir janela que a API recusa (Task 3).
- Reexecutar a mesma janela não pode duplicar linhas (Task 6, verificação em produção).
- Acentos (ISO-8859-1) e valores em formato BR (`"1.234,56"`) (Tasks 2 e 4).

---

### Task 1: Tabelas, RLS e extensões

**Files:**
- Create: `supabase/migrations/20260929_producao_neo.sql`
- Modify: `supabase_schema.sql` (acrescentar seção 11 apontando para a migration)
- Modify: `.gitignore` (ignorar `supabase/.temp/`)

**Interfaces:**
- Produces: tabelas `public.producao_pedidos_neo` (PK `id`, `item_id bigint unique`), `public.producao_neo_raw` (PK `item_id`), `public.producao_sync_log` (colunas `id, modo, iniciou_em, terminou_em, janela_ini, janela_fim, linhas_api, gravadas, removidas, descartes jsonb, observacao, ok, erro`); extensões `pg_net`, `pg_cron`. `config.chave` é PK (já confirmado) — usado com upsert.

- [ ] **Step 1: Criar a branch**

```bash
cd $WT && git checkout -b feat/sync-producao-neosales
```
Expected: `Switched to a new branch 'feat/sync-producao-neosales'`

- [ ] **Step 2: Escrever a migration (idempotente)**

Criar `supabase/migrations/20260929_producao_neo.sql`:

```sql
-- Sincronização automática da produção via API NeoSales (29/09/2026).
-- Tabela SEPARADA de producao_pedidos: o dashboard só troca de fonte depois que a paridade for provada.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.producao_pedidos_neo (
  id bigint generated always as identity primary key,
  item_id bigint not null unique,            -- itemId do NeoSales: chave de upsert (1 linha por item)
  numero_pedido text,
  grupo text,                                 -- numeroLinha da API (= coluna GRUPO do export manual)
  usuario text,
  etapa text,
  cadastro timestamptz,
  atualizacao timestamptz,
  valor numeric not null default 0,
  quantidade numeric,
  produto text,
  cliente text,
  cnpj text,
  tag text,                                   -- tagPedido da API
  criado_em timestamptz not null default now(),
  data_portabilidade timestamptz,
  data_instalacao timestamptz,
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_producao_neo_pedido on public.producao_pedidos_neo(numero_pedido);
create index if not exists idx_producao_neo_etapa on public.producao_pedidos_neo(etapa);
create index if not exists idx_producao_neo_usuario on public.producao_pedidos_neo(usuario);
create index if not exists idx_producao_neo_atualizacao on public.producao_pedidos_neo(atualizacao);

alter table public.producao_pedidos_neo enable row level security;
-- mesma regra de producao_pedidos: select p/ qualquer logado (o painel decide se pede cliente/cnpj).
-- Sem policy de escrita: só a Edge Function (service_role, ignora RLS) grava.
drop policy if exists "producao_neo_select" on public.producao_pedidos_neo;
create policy "producao_neo_select" on public.producao_pedidos_neo for select
  using ( auth.role() = 'authenticated' );

-- JSON cru de cada item (contém nome/CNPJ do cliente): só admin lê — LGPD.
create table if not exists public.producao_neo_raw (
  item_id bigint primary key,
  raw jsonb not null,
  sincronizado_em timestamptz not null default now()
);
alter table public.producao_neo_raw enable row level security;
drop policy if exists "producao_neo_raw_select" on public.producao_neo_raw;
create policy "producao_neo_raw_select" on public.producao_neo_raw for select
  using ( public.get_my_role() = 'admin' );

-- Uma linha por execução da sincronização. O cursor é o janela_fim da última execução ok.
create table if not exists public.producao_sync_log (
  id bigint generated always as identity primary key,
  modo text not null check (modo in ('horario','reconciliar','backfill','manual')),
  iniciou_em timestamptz not null default now(),
  terminou_em timestamptz,
  janela_ini timestamptz,
  janela_fim timestamptz,
  linhas_api integer,
  gravadas integer,
  removidas integer,
  descartes jsonb,
  observacao text,
  ok boolean,
  erro text
);
create index if not exists idx_producao_sync_log_cursor on public.producao_sync_log(ok, modo, janela_fim desc);
alter table public.producao_sync_log enable row level security;
drop policy if exists "producao_sync_log_select" on public.producao_sync_log;
create policy "producao_sync_log_select" on public.producao_sync_log for select
  using ( public.get_my_role() in ('admin','supervisor') );
```

- [ ] **Step 3: Aplicar no banco**

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn -f supabase/migrations/20260929_producao_neo.sql
```
Expected: sem erro (saída vazia ou `"rows": []`).

- [ ] **Step 4: Verificar tabelas, RLS e extensões**

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select c.relname, c.relrowsecurity as rls from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('producao_pedidos_neo','producao_neo_raw','producao_sync_log') order by 1; select extname from pg_extension where extname in ('pg_cron','pg_net','supabase_vault') order by 1" -o json
```
Expected: 3 tabelas com `"rls": true`; extensões `pg_cron`, `pg_net`, `supabase_vault`.

- [ ] **Step 5: Documentar no schema e ignorar o estado do link**

Acrescentar ao fim de `supabase_schema.sql`:

```sql

-- 11) SINCRONIZAÇÃO AUTOMÁTICA DA PRODUÇÃO (API NeoSales, 29/09/2026)
-- Definida em supabase/migrations/20260929_producao_neo.sql (+ ..._cron.sql). Tabelas
-- producao_pedidos_neo / producao_neo_raw / producao_sync_log, preenchidas pela Edge Function
-- sync-producao (supabase/functions/sync-producao). Ver REGRAS_NEGOCIO.md seção 50.
```
Acrescentar ao `.gitignore` (raiz do repo) a linha `supabase/.temp/`.

- [ ] **Step 6: Commit**

```bash
cd $WT && git add supabase/migrations/20260929_producao_neo.sql supabase_schema.sql .gitignore docs/superpowers/specs/2026-09-29-sync-producao-neosales-design.md docs/superpowers/plans/2026-09-29-sync-producao-neosales.md && git commit -m "feat(producao): tabelas e log da sincronização NeoSales

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Mapper (resposta da API → registro do painel)

**Files:**
- Create: `supabase/functions/sync-producao/mapper.ts`
- Test: `supabase/functions/sync-producao/mapper.test.ts`

**Interfaces:**
- Produces (usadas pelas Tasks 4–6):
  - `type NeoRow = Record<string, unknown>`
  - `interface Registro { item_id:number; numero_pedido:string|null; grupo:string; usuario:string; etapa:string; cadastro:string|null; atualizacao:string|null; valor:number; quantidade:number; produto:string|null; cliente:string|null; cnpj:string|null; tag:string|null; data_portabilidade:string|null; data_instalacao:string|null }`
  - `interface Descartes { gross:number; grossOrfaos:number; arquivado:number; semGrupo:number; semItemId:number; duplicados:number }`
  - `interface Mapeado { registros: Registro[]; raws: {item_id:number; raw:NeoRow}[]; arquivadosItemIds: number[]; descartes: Descartes }`
  - `parseDataHoraSP(v: unknown): string|null`, `parseValorBR(v: unknown): number`, `mapResponse(rows: NeoRow[]): Mapeado`, `zerarDescartes(): Descartes`

- [ ] **Step 1: Escrever os testes que falham**

Criar `mapper.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapResponse, parseDataHoraSP, parseValorBR } from "./mapper.ts";

function linha(o: Record<string, unknown> = {}) {
  return {
    itemId: 1001, numeroPedido: "50000001", numeroLinha: "VOZ - Novo",
    nomeUsuario: "  maria souza ", nomeEtapa: "CONCLUIDO (NEOCRM)",
    dataCadastro: "23/09/2026", dataHoraAtualizacao: "29/09/2026 15:30:56",
    valor: "39,99", quantidade: 1, nomeProduto: "CLARO POS 10GB",
    nomeCliente: "EMPRESA TESTE LTDA", cpfCnpj: "00000000000191",
    tagPedido: "", dataPortabilidade: "", dataInstalacao: "", ...o,
  };
}

test("parseDataHoraSP: data+hora e só data ganham offset -03:00", () => {
  assert.equal(parseDataHoraSP("29/09/2026 15:30:56"), "2026-09-29T15:30:56-03:00");
  assert.equal(parseDataHoraSP("23/09/2026"), "2026-09-23T00:00:00-03:00");
});
test("parseDataHoraSP: vazio, nulo e lixo viram null", () => {
  assert.equal(parseDataHoraSP(""), null);
  assert.equal(parseDataHoraSP(null), null);
  assert.equal(parseDataHoraSP("ontem"), null);
});
test("parseValorBR: formatos brasileiros, número e vazio", () => {
  assert.equal(parseValorBR("39,99"), 39.99);
  assert.equal(parseValorBR("1.234,56"), 1234.56);
  assert.equal(parseValorBR(5), 5);
  assert.equal(parseValorBR("39.99"), 39.99);
  assert.equal(parseValorBR(""), 0);
  assert.equal(parseValorBR(undefined), 0);
});

test("mapeia um item para o formato de producao_pedidos", () => {
  const m = mapResponse([linha()]);
  assert.deepEqual(m.registros, [{
    item_id: 1001, numero_pedido: "50000001", grupo: "VOZ - Novo", usuario: "MARIA SOUZA",
    etapa: "CONCLUIDO (NEOCRM)", cadastro: "2026-09-23T00:00:00-03:00",
    atualizacao: "2026-09-29T15:30:56-03:00", valor: 39.99, quantidade: 1,
    produto: "CLARO POS 10GB", cliente: "EMPRESA TESTE LTDA", cnpj: "00000000000191",
    tag: null, data_portabilidade: null, data_instalacao: null,
  }]);
  assert.equal(m.raws[0].item_id, 1001);
});

test("GROSS é descartado para o valor não dobrar", () => {
  const m = mapResponse([linha({ numeroLinha: "GROSS" }), linha()]);
  assert.equal(m.registros.length, 1);
  assert.equal(m.registros[0].grupo, "VOZ - Novo");
  assert.equal(m.descartes.gross, 1);
  assert.equal(m.descartes.grossOrfaos, 0);
});

test("item que só tem linha GROSS é contado como órfão (alerta de integridade)", () => {
  const m = mapResponse([linha({ numeroLinha: "GROSS" })]);
  assert.equal(m.registros.length, 0);
  assert.equal(m.descartes.grossOrfaos, 1);
});

test("ARQUIVADO sai dos registros mas o itemId é devolvido para remoção", () => {
  const m = mapResponse([linha({ nomeEtapa: "ARQUIVADO (NEOCRM)" })]);
  assert.equal(m.registros.length, 0);
  assert.deepEqual(m.arquivadosItemIds, [1001]);
  assert.equal(m.descartes.arquivado, 1);
});

test("sem grupo e sem itemId são descartados e contados", () => {
  const m = mapResponse([linha({ numeroLinha: "" }), linha({ itemId: null, numeroLinha: "VOZ - Novo" })]);
  assert.equal(m.registros.length, 0);
  assert.equal(m.descartes.semGrupo, 1);
  assert.equal(m.descartes.semItemId, 1);
});

test("mesmo itemId repetido no lote: mantém o mais recente, em qualquer ordem, e conta", () => {
  const velho = linha({ dataHoraAtualizacao: "29/09/2026 15:00:00", valor: "10,00" });
  const novo = linha({ dataHoraAtualizacao: "29/09/2026 16:00:00", valor: "20,00" });
  for (const ordem of [[velho, novo], [novo, velho]]) {
    const m = mapResponse(ordem);
    assert.equal(m.registros.length, 1);
    assert.equal(m.registros[0].valor, 20);
    assert.equal(m.descartes.duplicados, 1);
  }
});

test("usuário ausente vira (SEM USUÁRIO), como no painel; quantidade ausente vira 1; tag preservada", () => {
  const m = mapResponse([linha({ nomeUsuario: "", quantidade: undefined, tagPedido: "#HOTLEAD,#ESIM" })]);
  assert.equal(m.registros[0].usuario, "(SEM USUÁRIO)");
  assert.equal(m.registros[0].quantidade, 1);
  assert.equal(m.registros[0].tag, "#HOTLEAD,#ESIM");
});

test("etapa vazia vira (Sem etapa) e datas de ativação são convertidas", () => {
  const m = mapResponse([linha({ nomeEtapa: "", dataPortabilidade: "30/09/2026", dataInstalacao: "01/10/2026 08:00:00" })]);
  assert.equal(m.registros[0].etapa, "(Sem etapa)");
  assert.equal(m.registros[0].data_portabilidade, "2026-09-30T00:00:00-03:00");
  assert.equal(m.registros[0].data_instalacao, "2026-10-01T08:00:00-03:00");
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd $WT/supabase/functions/sync-producao && node --test mapper.test.ts
```
Expected: FAIL (`Cannot find module './mapper.ts'` / arquivo inexistente).

- [ ] **Step 3: Implementar**

Criar `mapper.ts`:

```ts
// Converte a resposta da API de produção do NeoSales (1 linha por item, mais uma linha duplicada
// "GROSS" por item) no formato da tabela producao_pedidos. Regras espelham extractProducaoRecords()
// do painel (_template.html): descarta ARQUIVADO e linhas sem GRUPO; usuário em maiúsculas.
export type NeoRow = Record<string, unknown>;

export interface Registro {
  item_id: number;
  numero_pedido: string | null;
  grupo: string;
  usuario: string;
  etapa: string;
  cadastro: string | null;
  atualizacao: string | null;
  valor: number;
  quantidade: number;
  produto: string | null;
  cliente: string | null;
  cnpj: string | null;
  tag: string | null;
  data_portabilidade: string | null;
  data_instalacao: string | null;
}

export interface Descartes {
  gross: number;
  grossOrfaos: number;
  arquivado: number;
  semGrupo: number;
  semItemId: number;
  duplicados: number;
}

export interface Mapeado {
  registros: Registro[];
  raws: { item_id: number; raw: NeoRow }[];
  arquivadosItemIds: number[];
  descartes: Descartes;
}

const FUSO_SP = "-03:00"; // sem horário de verão desde 2019

export function zerarDescartes(): Descartes {
  return { gross: 0, grossOrfaos: 0, arquivado: 0, semGrupo: 0, semItemId: 0, duplicados: 0 };
}

export function parseDataHoraSP(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${FUSO_SP}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T00:00:00${FUSO_SP}`;
  return null;
}

export function parseValorBR(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = parseFloat(normal);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function idDoItem(v: unknown): number {
  if (typeof v === "number") return v;
  return parseInt(String(v), 10); // null/undefined viram "null"/"undefined" -> NaN
}

export function mapResponse(rows: NeoRow[]): Mapeado {
  const descartes = zerarDescartes();
  const grossIds = new Set<number>();
  const arquivados = new Set<number>();
  const porItem = new Map<number, { reg: Registro; raw: NeoRow }>();

  for (const r of rows) {
    const itemId = idDoItem(r.itemId);
    const grupo = texto(r.numeroLinha);

    if (grupo !== null && grupo.toUpperCase() === "GROSS") {
      descartes.gross++;
      if (Number.isFinite(itemId)) grossIds.add(itemId);
      continue;
    }
    if (grupo === null) { descartes.semGrupo++; continue; }
    if (!Number.isFinite(itemId)) { descartes.semItemId++; continue; }

    const etapa = texto(r.nomeEtapa) ?? "(Sem etapa)";
    if (etapa === "ARQUIVADO (NEOCRM)") {
      descartes.arquivado++;
      arquivados.add(itemId);
      continue;
    }

    const qtd = Number(r.quantidade);
    const reg: Registro = {
      item_id: itemId,
      numero_pedido: texto(r.numeroPedido),
      grupo,
      usuario: (texto(r.nomeUsuario) ?? "(Sem usuário)").toUpperCase(),
      etapa,
      cadastro: parseDataHoraSP(r.dataCadastro),
      atualizacao: parseDataHoraSP(r.dataHoraAtualizacao),
      valor: parseValorBR(r.valor),
      quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
      produto: texto(r.nomeProduto),
      cliente: texto(r.nomeCliente),
      cnpj: texto(r.cpfCnpj),
      tag: texto(r.tagPedido),
      data_portabilidade: parseDataHoraSP(r.dataPortabilidade),
      data_instalacao: parseDataHoraSP(r.dataInstalacao),
    };

    const anterior = porItem.get(itemId);
    if (anterior) {
      descartes.duplicados++;
      if ((reg.atualizacao ?? "") < (anterior.reg.atualizacao ?? "")) continue;
    }
    porItem.set(itemId, { reg, raw: r });
  }

  for (const id of grossIds) {
    if (!porItem.has(id) && !arquivados.has(id)) descartes.grossOrfaos++;
  }

  const itens = [...porItem.values()];
  return {
    registros: itens.map((i) => i.reg),
    raws: itens.map((i) => ({ item_id: i.reg.item_id, raw: i.raw })),
    arquivadosItemIds: [...arquivados],
    descartes,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd $WT/supabase/functions/sync-producao && node --test mapper.test.ts
```
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/sync-producao/mapper.ts supabase/functions/sync-producao/mapper.test.ts && git commit -m "feat(producao): mapper da resposta NeoSales (descarta GROSS/ARQUIVADO, dedup por item)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Janelas de consulta e formatação de datas

**Files:**
- Create: `supabase/functions/sync-producao/windows.ts`
- Test: `supabase/functions/sync-producao/windows.test.ts`

**Interfaces:**
- Produces (usadas pelas Tasks 5–6):
  - `type Modo = "horario" | "reconciliar" | "backfill" | "manual"`
  - `interface Janela { ini: Date; fim: Date; observacao: string | null }`
  - `calcularJanela(p: { modo: Modo; agora: Date; cursor: Date | null; inicio?: Date; fim?: Date }): Janela` (lança `Error` se modo noturno fora da noite ou backfill sem `inicio`)
  - `dividirEmBlocos(ini: Date, fim: Date, ms?: number): { ini: Date; fim: Date }[]` (padrão 35 dias — uma janela normal cabe num bloco só)
  - `formatoNeo(d: Date): string` (`YYYY-MM-DD HH:mm:ss` em SP), `parseFormatoNeo(s: string): Date`, `formatoPainel(d: Date): string` (`dd/mm/aaaa, HH:MM:SS` em SP), `janelaNoturna(d: Date): boolean`, `inicioDoDia(d: Date, diasAtras?: number): Date`

- [ ] **Step 1: Escrever os testes que falham**

Criar `windows.test.ts` (instantes em UTC; SP = UTC-3):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularJanela, dividirEmBlocos, formatoNeo, formatoPainel, inicioDoDia, janelaNoturna, parseFormatoNeo,
} from "./windows.ts";

const utc = (s: string) => new Date(s);

test("formatoNeo/parseFormatoNeo usam a hora de São Paulo", () => {
  assert.equal(formatoNeo(utc("2026-09-29T19:15:07Z")), "2026-09-29 16:15:07");
  assert.equal(parseFormatoNeo("2026-09-29 16:15:07").toISOString(), "2026-09-29T19:15:07.000Z");
  assert.throws(() => parseFormatoNeo("29/09/2026"), /formato/i);
});

test("formatoPainel imita o carimbo já usado em config.producao_atualizado_em", () => {
  assert.equal(formatoPainel(utc("2026-09-29T18:56:38Z")), "29/09/2026, 15:56:38");
});

test("janelaNoturna: 22:02–04:58 (SP), conservador nas bordas", () => {
  assert.equal(janelaNoturna(utc("2026-09-30T00:59:00Z")), false); // 21:59
  assert.equal(janelaNoturna(utc("2026-09-30T01:01:00Z")), false); // 22:01
  assert.equal(janelaNoturna(utc("2026-09-30T01:02:00Z")), true);  // 22:02
  assert.equal(janelaNoturna(utc("2026-09-30T06:00:00Z")), true);  // 03:00
  assert.equal(janelaNoturna(utc("2026-09-30T07:58:00Z")), true);  // 04:58
  assert.equal(janelaNoturna(utc("2026-09-30T07:59:00Z")), false); // 04:59
  assert.equal(janelaNoturna(utc("2026-09-30T09:00:00Z")), false); // 06:00
});

test("horario de dia com cursor recente: começa 15 min antes do cursor", () => {
  const j = calcularJanela({ modo: "horario", agora: utc("2026-09-29T19:07:00Z"), cursor: utc("2026-09-29T19:00:00Z") });
  assert.equal(j.ini.toISOString(), "2026-09-29T18:45:00.000Z");
  assert.equal(j.fim.toISOString(), "2026-09-29T19:07:00.000Z");
  assert.equal(j.observacao, null);
});

test("horario de dia com cursor antigo: reduz a 85 min e avisa (nunca pede janela que a API recusa)", () => {
  const agora = utc("2026-09-29T19:07:00Z");
  const j = calcularJanela({ modo: "horario", agora, cursor: utc("2026-09-29T16:00:00Z") });
  assert.equal(j.ini.getTime(), agora.getTime() - 85 * 60_000);
  assert.match(j.observacao ?? "", /Janela reduzida/);
});

test("horario sem cursor: última hora", () => {
  const agora = utc("2026-09-29T19:07:00Z");
  const j = calcularJanela({ modo: "horario", agora, cursor: null });
  assert.equal(j.ini.getTime(), agora.getTime() - 60 * 60_000);
});

test("horario de noite não tem limite: parte do cursor - 15 min mesmo 5 h depois", () => {
  const agora = utc("2026-09-30T06:00:00Z"); // 03:00 SP
  const cursor = new Date(agora.getTime() - 5 * 3_600_000);
  const j = calcularJanela({ modo: "horario", agora, cursor });
  assert.equal(j.ini.getTime(), cursor.getTime() - 15 * 60_000);
  assert.equal(j.observacao, null);
});

test("backfill de dia é recusado; à noite exige inicio", () => {
  assert.throws(() => calcularJanela({ modo: "backfill", agora: utc("2026-09-29T19:00:00Z"), cursor: null, inicio: utc("2026-05-01T03:00:00Z") }), /noturna|22:02/);
  assert.throws(() => calcularJanela({ modo: "backfill", agora: utc("2026-09-30T01:10:00Z"), cursor: null }), /inicio/);
  const j = calcularJanela({ modo: "backfill", agora: utc("2026-09-30T01:10:00Z"), cursor: null, inicio: utc("2026-05-01T03:00:00Z") });
  assert.equal(j.ini.toISOString(), "2026-05-01T03:00:00.000Z");
});

test("reconciliar à noite começa às 00:00 (SP) de 2 dias antes", () => {
  const j = calcularJanela({ modo: "reconciliar", agora: utc("2026-09-30T02:10:00Z"), cursor: null }); // 23:10 SP de 29/09
  assert.equal(j.ini.toISOString(), "2026-09-27T03:00:00.000Z");
  assert.equal(inicioDoDia(utc("2026-09-30T02:10:00Z"), 2).toISOString(), "2026-09-27T03:00:00.000Z");
});

test("dividirEmBlocos: contíguos, cobre tudo, vazio quando ini >= fim", () => {
  const ini = utc("2026-05-01T03:00:00Z");
  const fim = new Date(ini.getTime() + 7 * 24 * 3_600_000);
  const b = dividirEmBlocos(ini, fim, 3 * 24 * 3_600_000);
  assert.equal(b.length, 3);
  assert.equal(b[0].ini.getTime(), ini.getTime());
  assert.equal(b[0].fim.getTime(), b[1].ini.getTime());
  assert.equal(b[2].fim.getTime(), fim.getTime());
  assert.deepEqual(dividirEmBlocos(fim, ini), []);
  assert.deepEqual(dividirEmBlocos(ini, ini), []);
});

test("dividirEmBlocos: o bloco padrão é de 35 dias (a API só aceita 1 consulta a cada ~2 min)", () => {
  const ini = utc("2026-05-01T03:00:00Z");
  assert.equal(dividirEmBlocos(ini, new Date(ini.getTime() + 34 * 24 * 3_600_000)).length, 1);
  assert.equal(dividirEmBlocos(ini, new Date(ini.getTime() + 50 * 24 * 3_600_000)).length, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd $WT/supabase/functions/sync-producao && node --test windows.test.ts
```
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Criar `windows.ts`:

```ts
// Janelas de consulta da API de produção do NeoSales. Horário de São Paulo = UTC-3 fixo.
// Regra da API: de dia (a mensagem de erro diz 05:00–22:00, a doc diz 06:00–22:00) a janela pode ter
// no máximo 90 min; de madrugada (22:01–05:59 segundo a doc) não há limite. Somos conservadores nas duas bordas.
export type Modo = "horario" | "reconciliar" | "backfill" | "manual";
export interface Janela { ini: Date; fim: Date; observacao: string | null }

const MIN = 60_000;
const HORA = 60 * MIN;
export const OVERLAP_MS = 15 * MIN;       // sobreposição entre execuções, cobre atraso de atualização
export const DIA_MAX_MS = 85 * MIN;       // margem sobre os 90 min da API
export const SEM_CURSOR_MS = 60 * MIN;

function sp(d: Date): Date { return new Date(d.getTime() - 3 * HORA); } // campos UTC do resultado = hora de SP
function pad(n: number): string { return String(n).padStart(2, "0"); }

export function formatoNeo(d: Date): string {
  const s = sp(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

export function parseFormatoNeo(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Data fora do formato 'YYYY-MM-DD HH:mm:ss': ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +m[6]));
}

export function formatoPainel(d: Date): string {
  const s = sp(d);
  return `${pad(s.getUTCDate())}/${pad(s.getUTCMonth() + 1)}/${s.getUTCFullYear()}, ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

export function janelaNoturna(d: Date): boolean {
  const s = sp(d);
  const min = s.getUTCHours() * 60 + s.getUTCMinutes();
  return min >= 22 * 60 + 2 || min <= 4 * 60 + 58;
}

export function inicioDoDia(d: Date, diasAtras = 0): Date {
  const s = sp(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - diasAtras, 3, 0, 0));
}

export function calcularJanela(p: { modo: Modo; agora: Date; cursor: Date | null; inicio?: Date; fim?: Date }): Janela {
  const fim = p.fim && p.fim < p.agora ? p.fim : p.agora;
  const noite = janelaNoturna(p.agora);

  if (p.modo === "backfill" || p.modo === "reconciliar") {
    if (!noite) throw new Error("Este modo (sem limite de janela) só pode rodar na janela noturna, entre 22:02 e 04:58 (horário de SP).");
    const ini = p.modo === "backfill" ? p.inicio : (p.inicio ?? inicioDoDia(p.agora, 2));
    if (!ini) throw new Error("O modo backfill exige 'inicio'.");
    return { ini, fim, observacao: null };
  }

  const base = p.inicio ??
    (p.cursor ? new Date(p.cursor.getTime() - OVERLAP_MS) : new Date(p.agora.getTime() - SEM_CURSOR_MS));
  if (noite) return { ini: base, fim, observacao: null };

  const minimo = new Date(p.agora.getTime() - DIA_MAX_MS);
  if (base < minimo) {
    return {
      ini: minimo, fim,
      observacao: `Janela reduzida a 85 min (limite diurno da API); a lacuna desde ${base.toISOString()} será coberta pelo reconciliar noturno.`,
    };
  }
  return { ini: base, fim, observacao: null };
}

export function dividirEmBlocos(ini: Date, fim: Date, ms = 35 * 24 * HORA): { ini: Date; fim: Date }[] {
  const out: { ini: Date; fim: Date }[] = [];
  let a = ini.getTime();
  const f = fim.getTime();
  while (a < f) {
    const b = Math.min(a + ms, f);
    out.push({ ini: new Date(a), fim: new Date(b) });
    a = b;
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd $WT/supabase/functions/sync-producao && node --test windows.test.ts
```
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/sync-producao/windows.ts supabase/functions/sync-producao/windows.test.ts && git commit -m "feat(producao): cálculo de janelas da API (limite diurno de 90 min, blocos, fuso SP)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Cliente HTTP da NeoSales (encoding, erro com HTTP 200, retry)

**Files:**
- Create: `supabase/functions/sync-producao/neosales.ts`
- Test: `supabase/functions/sync-producao/neosales.test.ts`

**Interfaces:**
- Consumes: `NeoRow` de `./mapper.ts`.
- Produces: `decodificar(bytes: Uint8Array): string`; `parseRespostaNeo(bytes: Uint8Array): NeoRow[]` (lança `Error` para erro da API, corpo vazio, JSON inválido ou objeto inesperado); `interface ConfigNeo { url: string; tokenEstrutura: string; tokenUsuario: string; painelId: string }`; `criarBuscarNeo(cfg: ConfigNeo, opts?: { fetchImpl?: typeof fetch; esperar?: (ms: number) => Promise<void>; tentativas?: number }): (ini: string, fim: string) => Promise<NeoRow[]>` (`ini`/`fim` no formato `YYYY-MM-DD HH:mm:ss`).

- [ ] **Step 1: Escrever os testes que falham**

Criar `neosales.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarBuscarNeo, decodificar, parseRespostaNeo } from "./neosales.ts";

const enc = new TextEncoder();
const bytes = (...partes: (string | number)[]) =>
  Uint8Array.from(partes.flatMap((p) => (typeof p === "number" ? [p] : [...enc.encode(p)])));

test("decodifica ISO-8859-1 (a resposta real da API não é UTF-8)", () => {
  const r = parseRespostaNeo(bytes('[{"nomeProduto":"CLARO P', 0xd3, 'S"}]'));
  assert.equal(r[0].nomeProduto, "CLARO PÓS");
});
test("também aceita UTF-8 válido", () => {
  assert.equal(decodificar(enc.encode("PÓS")), "PÓS");
});
test("janela vazia ([]) devolve lista vazia", () => {
  assert.deepEqual(parseRespostaNeo(enc.encode("[]")), []);
});
test("erro da API com HTTP 200 vira exceção com a mensagem (não pode virar '0 pedidos')", () => {
  const corpo = bytes('{"erro":"Token Estrutura Inv', 0xe1, 'lido","success":false}');
  assert.throws(() => parseRespostaNeo(corpo), /Token Estrutura Inválido/);
});
test("corpo vazio, não-JSON e objeto sem erro também lançam", () => {
  assert.throws(() => parseRespostaNeo(enc.encode("")), /vazi/i);
  assert.throws(() => parseRespostaNeo(enc.encode("<html>")), /JSON/);
  assert.throws(() => parseRespostaNeo(enc.encode('{"x":1}')), /inesperada/i);
});

const cfg = { url: "https://exemplo.test/api", tokenEstrutura: "TE", tokenUsuario: "TU", painelId: "15455" };
const semEspera = () => Promise.resolve();

test("envia o corpo esperado como text/plain", async () => {
  let visto: { init?: RequestInit } = {};
  const fetchImpl = (_u: unknown, init?: RequestInit) => { visto = { init }; return Promise.resolve(new Response("[]")); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as typeof fetch, esperar: semEspera });
  assert.deepEqual(await buscar("2026-09-29 10:00:00", "2026-09-29 11:00:00"), []);
  assert.equal((visto.init!.headers as Record<string, string>)["Content-Type"], "text/plain");
  assert.deepEqual(JSON.parse(String(visto.init!.body)), {
    tokenEstrutura: "TE", tokenUsuario: "TU", painelId: "15455", outputFormat: "json",
    dataHoraInicioCarga: "2026-09-29 10:00:00", dataHoraFimCarga: "2026-09-29 11:00:00",
  });
});

test("HTTP 5xx: tenta de novo e se recupera", async () => {
  let n = 0;
  const fetchImpl = () => Promise.resolve(++n < 3 ? new Response("boom", { status: 500 }) : new Response("[]"));
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch, esperar: semEspera });
  assert.deepEqual(await buscar("a", "b"), []);
  assert.equal(n, 3);
});

test("HTTP 5xx persistente: desiste após 3 tentativas", async () => {
  let n = 0;
  const fetchImpl = () => { n++; return Promise.resolve(new Response("boom", { status: 502 })); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch, esperar: semEspera });
  await assert.rejects(buscar("a", "b"), /HTTP 502/);
  assert.equal(n, 3);
});

test("erro da API (token vencido) não é repetido: falha na primeira", async () => {
  let n = 0;
  const fetchImpl = () => { n++; return Promise.resolve(new Response('{"erro":"Token Usuário Inválido","success":false}')); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch, esperar: semEspera });
  await assert.rejects(buscar("a", "b"), /Token Usu/);
  assert.equal(n, 1);
});

test("falha de rede (TypeError) é repetida", async () => {
  let n = 0;
  const fetchImpl = () => (++n < 2 ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(new Response("[]")));
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch, esperar: semEspera });
  assert.deepEqual(await buscar("a", "b"), []);
  assert.equal(n, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd $WT/supabase/functions/sync-producao && node --test neosales.test.ts
```
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Criar `neosales.ts`:

```ts
import type { NeoRow } from "./mapper.ts";

export interface ConfigNeo { url: string; tokenEstrutura: string; tokenUsuario: string; painelId: string }

// A API declara "ISO-8859-1" (e o corpo real é mesmo latin-1). Tentamos UTF-8 estrito primeiro só
// para não corromper caso o fornecedor passe a devolver UTF-8.
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ATENÇÃO: a API devolve erros com HTTP 200 e corpo {"erro":"...","success":false}. Se só o status
// HTTP fosse checado, um token vencido pareceria "nenhum pedido novo" e a sincronização pararia calada.
export function parseRespostaNeo(bytes: Uint8Array): NeoRow[] {
  const texto = decodificar(bytes).replace(/^﻿/, "").trim();
  if (texto === "") throw new Error("Resposta vazia da NeoSales (esperava [] ou uma lista).");
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error(`Resposta da NeoSales não é JSON: ${texto.slice(0, 200)}`);
  }
  if (Array.isArray(dados)) return dados as NeoRow[];
  if (dados && typeof dados === "object" && "erro" in dados) {
    throw new Error(`NeoSales recusou a consulta: ${String((dados as { erro: unknown }).erro)}`);
  }
  throw new Error(`Resposta inesperada da NeoSales: ${texto.slice(0, 200)}`);
}

class ErroTransitorio extends Error {}

export function criarBuscarNeo(
  cfg: ConfigNeo,
  opts: { fetchImpl?: typeof fetch; esperar?: (ms: number) => Promise<void>; tentativas?: number } = {},
): (ini: string, fim: string) => Promise<NeoRow[]> {
  const f = opts.fetchImpl ?? fetch;
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = opts.tentativas ?? 3;

  return async (ini, fim) => {
    let ultimo: unknown;
    for (let t = 1; t <= max; t++) {
      try {
        const res = await f(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            tokenEstrutura: cfg.tokenEstrutura, tokenUsuario: cfg.tokenUsuario, painelId: cfg.painelId,
            dataHoraInicioCarga: ini, dataHoraFimCarga: fim, outputFormat: "json",
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status >= 500) throw new ErroTransitorio(`NeoSales HTTP ${res.status}`);
        if (!res.ok) throw new Error(`NeoSales HTTP ${res.status}`);
        return parseRespostaNeo(new Uint8Array(await res.arrayBuffer()));
      } catch (e) {
        const nome = (e as { name?: string }).name;
        const repetivel = e instanceof ErroTransitorio || e instanceof TypeError || nome === "TimeoutError" || nome === "AbortError";
        if (!repetivel) throw e;
        ultimo = e;
        if (t < max) await esperar(1000 * 2 ** (t - 1));
      }
    }
    throw ultimo;
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd $WT/supabase/functions/sync-producao && node --test neosales.test.ts
```
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/sync-producao/neosales.ts supabase/functions/sync-producao/neosales.test.ts && git commit -m "feat(producao): cliente NeoSales (latin-1, erro com HTTP 200, retry só em falha transitória)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orquestração da sincronização (dependências injetadas)

**Files:**
- Create: `supabase/functions/sync-producao/sync.ts`
- Test: `supabase/functions/sync-producao/sync.test.ts`

**Interfaces:**
- Consumes: `mapResponse`, `zerarDescartes`, `NeoRow`, `Registro`, `Descartes` (`./mapper.ts`); `calcularJanela`, `dividirEmBlocos`, `formatoNeo`, `Modo`, `Janela` (`./windows.ts`).
- Produces:
  - `interface FechamentoLog { ok: boolean; linhasApi: number; gravadas: number; removidas: number; descartes: Descartes; erro: string | null }`
  - `interface Deps { agora(): Date; buscarNeo(ini: string, fim: string): Promise<NeoRow[]>; ultimoCursor(): Promise<Date | null>; gravar(itens: { reg: Registro; raw: NeoRow }[]): Promise<void>; remover(itemIds: number[]): Promise<void>; abrirLog(modo: Modo, ini: Date, fim: Date, observacao: string | null): Promise<number>; fecharLog(id: number, r: FechamentoLog): Promise<void>; marcarAtualizado(quando: Date): Promise<void> }`
  - `interface ParamsSync { modo: Modo; inicio?: Date; fim?: Date }`
  - `interface ResultadoSync extends FechamentoLog { janelaIni: Date; janelaFim: Date; observacao: string | null }`
  - `executarSync(deps: Deps, p: ParamsSync): Promise<ResultadoSync>` — nunca lança: falhas viram `ok:false` com log fechado.

- [ ] **Step 1: Escrever os testes que falham**

Criar `sync.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarSync } from "./sync.ts";
import type { Deps, FechamentoLog } from "./sync.ts";
import type { NeoRow } from "./mapper.ts";

const linha = (o: Record<string, unknown> = {}): NeoRow => ({
  itemId: 1, numeroPedido: "9", numeroLinha: "VOZ - Novo", nomeUsuario: "ANA", nomeEtapa: "CONCLUIDO (NEOCRM)",
  dataCadastro: "29/09/2026", dataHoraAtualizacao: "29/09/2026 15:30:56", valor: "39,99", quantidade: 1, ...o,
});

function criar(over: Partial<Deps> = {}, agora = "2026-09-29T19:07:00Z") {
  const chamadas = {
    buscar: [] as [string, string][], gravar: [] as unknown[][], remover: [] as number[][],
    abrir: [] as unknown[][], fechar: [] as FechamentoLog[], atualizado: 0,
  };
  const deps: Deps = {
    agora: () => new Date(agora),
    buscarNeo: (a, b) => { chamadas.buscar.push([a, b]); return Promise.resolve([]); },
    ultimoCursor: () => Promise.resolve(new Date("2026-09-29T19:00:00Z")),
    gravar: (i) => { chamadas.gravar.push(i); return Promise.resolve(); },
    remover: (ids) => { chamadas.remover.push(ids); return Promise.resolve(); },
    abrirLog: (...a) => { chamadas.abrir.push(a); return Promise.resolve(42); },
    fecharLog: (_id, r) => { chamadas.fechar.push(r); return Promise.resolve(); },
    marcarAtualizado: () => { chamadas.atualizado++; return Promise.resolve(); },
    ...over,
  };
  return { deps, chamadas };
}

test("caminho feliz: GROSS descartado, 1 item gravado, log ok e carimbo atualizado", async () => {
  const { deps, chamadas } = criar({
    buscarNeo: (a, b) => { chamadas.buscar.push([a, b]); return Promise.resolve([linha({ numeroLinha: "GROSS" }), linha()]); },
  });
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, true);
  assert.equal(r.linhasApi, 2);
  assert.equal(r.gravadas, 1);
  assert.equal(chamadas.gravar.length, 1);
  assert.equal(chamadas.fechar[0].ok, true);
  assert.equal(chamadas.atualizado, 1);
  assert.deepEqual(chamadas.buscar, [["2026-09-29 15:45:00", "2026-09-29 16:07:00"]]); // cursor 16:00 SP - 15 min
});

test("resposta vazia: ok, nada gravado, cursor avança (log ok)", async () => {
  const { deps, chamadas } = criar();
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, true);
  assert.equal(r.gravadas, 0);
  assert.equal(chamadas.gravar.length, 0);
  assert.equal(chamadas.fechar[0].ok, true);
});

test("falha da API: log ok=false com a mensagem, nada gravado, carimbo NÃO atualizado", async () => {
  const { deps, chamadas } = criar({ buscarNeo: () => Promise.reject(new Error("NeoSales recusou a consulta: Token Estrutura Inválido")) });
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /Token Estrutura/);
  assert.equal(chamadas.fechar[0].ok, false);
  assert.equal(chamadas.gravar.length, 0);
  assert.equal(chamadas.atualizado, 0);
});

test("item arquivado é removido e não é gravado", async () => {
  const { deps, chamadas } = criar({
    buscarNeo: () => Promise.resolve([linha({ itemId: 77, nomeEtapa: "ARQUIVADO (NEOCRM)" })]),
  });
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, true);
  assert.equal(r.removidas, 1);
  assert.deepEqual(chamadas.remover, [[77]]);
  assert.equal(chamadas.gravar.length, 0);
});

test("backfill de 30 dias à noite: uma única consulta à API cobrindo a janela toda", async () => {
  const { deps, chamadas } = criar({}, "2026-09-30T01:10:00Z"); // 22:10 SP
  const r = await executarSync(deps, { modo: "backfill", inicio: new Date("2026-08-31T01:10:00Z") });
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas.buscar, [["2026-08-30 22:10:00", "2026-09-29 22:10:00"]]);
});

test("janela que exigiria mais de uma consulta é recusada sem chamar a API (a NeoSales só aceita 1 consulta a cada ~2 min)", async () => {
  const { deps, chamadas } = criar({}, "2026-09-30T01:10:00Z");
  const r = await executarSync(deps, { modo: "backfill", inicio: new Date("2026-05-01T03:00:00Z") });
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /35 dias/);
  assert.equal(chamadas.buscar.length, 0);
  assert.equal(chamadas.fechar[0].ok, false);
});

test("API em intervalo de espera: falha registrada com a mensagem da NeoSales, nada gravado", async () => {
  const { deps, chamadas } = criar({
    buscarNeo: () => Promise.reject(new Error("NeoSales recusou a consulta: Integração de produção executada recentemente. Aguarde 119 segundos para tentar novamente.")),
  });
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /Aguarde 119 segundos/);
  assert.equal(chamadas.gravar.length, 0);
  assert.equal(chamadas.atualizado, 0);
});

test("falha ao gravar: log ok=false, carimbo não atualizado (cursor não avança)", async () => {
  const { deps, chamadas } = criar({
    buscarNeo: () => Promise.resolve([linha()]),
    gravar: () => Promise.reject(new Error("banco fora do ar")),
  });
  const r = await executarSync(deps, { modo: "horario" });
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /banco fora do ar/);
  assert.equal(chamadas.fechar[0].ok, false);
  assert.equal(chamadas.atualizado, 0);
});

test("de dia com cursor antigo: janela reduzida vai para o log como observação", async () => {
  const { deps, chamadas } = criar({ ultimoCursor: () => Promise.resolve(new Date("2026-09-29T16:00:00Z")) });
  await executarSync(deps, { modo: "horario" });
  assert.match(String(chamadas.abrir[0][3]), /Janela reduzida/);
});

test("backfill fora da janela noturna: falha registrada, a API nunca é chamada", async () => {
  const { deps, chamadas } = criar();
  const r = await executarSync(deps, { modo: "backfill", inicio: new Date("2026-05-01T03:00:00Z") });
  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /noturna/);
  assert.equal(chamadas.buscar.length, 0);
  assert.equal(chamadas.abrir.length, 1);
  assert.equal(chamadas.fechar[0].ok, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd $WT/supabase/functions/sync-producao && node --test sync.test.ts
```
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

Criar `sync.ts`:

```ts
import { mapResponse, zerarDescartes } from "./mapper.ts";
import type { Descartes, NeoRow, Registro } from "./mapper.ts";
import { calcularJanela, dividirEmBlocos, formatoNeo } from "./windows.ts";
import type { Janela, Modo } from "./windows.ts";

export interface FechamentoLog {
  ok: boolean;
  linhasApi: number;
  gravadas: number;
  removidas: number;
  descartes: Descartes;
  erro: string | null;
}

export interface Deps {
  agora(): Date;
  buscarNeo(ini: string, fim: string): Promise<NeoRow[]>;
  ultimoCursor(): Promise<Date | null>;
  gravar(itens: { reg: Registro; raw: NeoRow }[]): Promise<void>;
  remover(itemIds: number[]): Promise<void>;
  abrirLog(modo: Modo, ini: Date, fim: Date, observacao: string | null): Promise<number>;
  fecharLog(id: number, r: FechamentoLog): Promise<void>;
  marcarAtualizado(quando: Date): Promise<void>;
}

export interface ParamsSync { modo: Modo; inicio?: Date; fim?: Date }
export interface ResultadoSync extends FechamentoLog { janelaIni: Date; janelaFim: Date; observacao: string | null }

function mensagem(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// Nunca lança: qualquer falha vira um log ok=false (o cursor só avança com logs ok=true).
// O upsert por item_id é idempotente: repetir uma janela é seguro.
export async function executarSync(deps: Deps, p: ParamsSync): Promise<ResultadoSync> {
  const agora = deps.agora();
  const total = zerarDescartes();
  let linhasApi = 0, gravadas = 0, removidas = 0;

  let janela: Janela;
  try {
    janela = calcularJanela({ modo: p.modo, agora, cursor: await deps.ultimoCursor(), inicio: p.inicio, fim: p.fim });
  } catch (e) {
    const id = await deps.abrirLog(p.modo, agora, agora, null);
    const r: FechamentoLog = { ok: false, linhasApi, gravadas, removidas, descartes: total, erro: mensagem(e) };
    await deps.fecharLog(id, r);
    return { ...r, janelaIni: agora, janelaFim: agora, observacao: null };
  }

  const logId = await deps.abrirLog(p.modo, janela.ini, janela.fim, janela.observacao);
  try {
    const blocos = dividirEmBlocos(janela.ini, janela.fim);
    // A NeoSales só aceita 1 consulta a cada ~2 min e esperar entre blocos estouraria o tempo da função:
    // janelas grandes (carga inicial) são divididas em várias chamadas, uma por job do cron.
    if (blocos.length > 1) {
      throw new Error("Janela maior que 35 dias: a NeoSales só aceita uma consulta a cada ~2 min, então cada execução faz uma única consulta. Divida a janela em chamadas separadas.");
    }
    for (const bloco of blocos) {
      const rows = await deps.buscarNeo(formatoNeo(bloco.ini), formatoNeo(bloco.fim));
      linhasApi += rows.length;
      const m = mapResponse(rows);
      for (const k of Object.keys(total) as (keyof Descartes)[]) total[k] += m.descartes[k];
      if (m.registros.length > 0) {
        await deps.gravar(m.registros.map((reg, i) => ({ reg, raw: m.raws[i].raw })));
        gravadas += m.registros.length;
      }
      if (m.arquivadosItemIds.length > 0) {
        await deps.remover(m.arquivadosItemIds);
        removidas += m.arquivadosItemIds.length;
      }
    }
    const r: FechamentoLog = { ok: true, linhasApi, gravadas, removidas, descartes: total, erro: null };
    await deps.fecharLog(logId, r);
    await deps.marcarAtualizado(agora);
    return { ...r, janelaIni: janela.ini, janelaFim: janela.fim, observacao: janela.observacao };
  } catch (e) {
    const r: FechamentoLog = { ok: false, linhasApi, gravadas, removidas, descartes: total, erro: mensagem(e) };
    await deps.fecharLog(logId, r);
    return { ...r, janelaIni: janela.ini, janelaFim: janela.fim, observacao: janela.observacao };
  }
}
```

- [ ] **Step 4: Rodar todos os testes**

```bash
cd $WT/supabase/functions/sync-producao && node --test mapper.test.ts windows.test.ts neosales.test.ts sync.test.ts
```
Expected: PASS em todos (38 testes), 0 falhas.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/sync-producao/sync.ts supabase/functions/sync-producao/sync.test.ts && git commit -m "feat(producao): orquestração da sincronização (blocos, log, cursor só avança com sucesso)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Edge Function, secrets, deploy e verificação em produção

**Files:**
- Create: `supabase/functions/sync-producao/index.ts`
- Temp (fora do repo, NÃO versionar): `$SP/neosales.env` (scratchpad)

**Interfaces:**
- Consumes: `executarSync`, `Deps` (`./sync.ts`); `criarBuscarNeo` (`./neosales.ts`); `parseFormatoNeo`, `formatoPainel`, `Modo` (`./windows.ts`).
- Produces: endpoint `POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao` com header `x-cron-secret` e corpo `{"modo":"horario|reconciliar|backfill|manual","inicio?":"YYYY-MM-DD HH:mm:ss","fim?":"…"}`; responde `202 {"aceito":true,"modo":…}` (o resultado fica em `producao_sync_log`), `401` sem segredo correto, `400` para corpo inválido. Secrets: `NEOSALES_URL`, `NEOSALES_TOKEN_ESTRUTURA`, `NEOSALES_TOKEN_USUARIO`, `NEOSALES_PAINEL_ID`, `SYNC_CRON_SECRET`.

- [ ] **Step 1: Escrever a Edge Function**

Criar `index.ts`:

```ts
// Edge Function: sync-producao — espelha a produção do NeoCRM (API NeoSales) em producao_pedidos_neo.
// Chamada só pelo pg_cron (header x-cron-secret); por isso roda sem JWT (--no-verify-jwt).
// Publicar: cd crm && npx supabase functions deploy sync-producao --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { executarSync } from "./sync.ts";
import type { Deps } from "./sync.ts";
import { criarBuscarNeo } from "./neosales.ts";
import { formatoPainel, parseFormatoNeo } from "./windows.ts";
import type { Modo } from "./windows.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const MODOS: Modo[] = ["horario", "reconciliar", "backfill", "manual"];
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
function lotes<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) out.push(xs.slice(i, i + LOTE));
  return out;
}

function criarDeps(): Deps {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const buscarNeo = criarBuscarNeo({
    url: Deno.env.get("NEOSALES_URL") ?? "https://apex.neosales.com.br/producao-painel-integration-v2",
    tokenEstrutura: env("NEOSALES_TOKEN_ESTRUTURA"),
    tokenUsuario: env("NEOSALES_TOKEN_USUARIO"),
    painelId: env("NEOSALES_PAINEL_ID"),
  });
  const falha = (ctx: string, error: { message: string } | null) => { if (error) throw new Error(`${ctx}: ${error.message}`); };

  return {
    agora: () => new Date(),
    buscarNeo,
    async ultimoCursor() {
      const { data, error } = await sb.from("producao_sync_log").select("janela_fim")
        .eq("ok", true).neq("modo", "manual").order("janela_fim", { ascending: false }).limit(1);
      falha("ler cursor", error);
      return data && data.length > 0 && data[0].janela_fim ? new Date(data[0].janela_fim) : null;
    },
    async gravar(itens) {
      const agora = new Date().toISOString();
      for (const lote of lotes(itens)) {
        const a = await sb.from("producao_pedidos_neo")
          .upsert(lote.map((i) => ({ ...i.reg, sincronizado_em: agora })), { onConflict: "item_id" });
        falha("gravar pedidos", a.error);
        const b = await sb.from("producao_neo_raw")
          .upsert(lote.map((i) => ({ item_id: i.reg.item_id, raw: i.raw, sincronizado_em: agora })), { onConflict: "item_id" });
        falha("gravar raw", b.error);
      }
    },
    async remover(ids) {
      for (const lote of lotes(ids)) {
        const a = await sb.from("producao_pedidos_neo").delete().in("item_id", lote);
        falha("remover pedidos", a.error);
        const b = await sb.from("producao_neo_raw").delete().in("item_id", lote);
        falha("remover raw", b.error);
      }
    },
    async abrirLog(modo, ini, fim, observacao) {
      const { data, error } = await sb.from("producao_sync_log")
        .insert({ modo, janela_ini: ini.toISOString(), janela_fim: fim.toISOString(), observacao }).select("id").single();
      falha("abrir log", error);
      return data!.id as number;
    },
    async fecharLog(id, r) {
      const { error } = await sb.from("producao_sync_log").update({
        terminou_em: new Date().toISOString(), ok: r.ok, linhas_api: r.linhasApi, gravadas: r.gravadas,
        removidas: r.removidas, descartes: r.descartes, erro: r.erro,
      }).eq("id", id);
      falha("fechar log", error);
    },
    async marcarAtualizado(quando) {
      const { error } = await sb.from("config").upsert(
        { chave: "producao_neo_atualizado_em", valor: formatoPainel(quando), atualizado_em: quando.toISOString() },
        { onConflict: "chave" },
      );
      falha("carimbar atualização", error);
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!iguais(req.headers.get("x-cron-secret") ?? "", env("SYNC_CRON_SECRET"))) return json({ error: "Não autorizado" }, 401);

  let corpo: { modo?: string; inicio?: string; fim?: string };
  try { corpo = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const modo = corpo.modo as Modo;
  if (!MODOS.includes(modo)) return json({ error: `modo deve ser um de: ${MODOS.join(", ")}` }, 400);

  let inicio: Date | undefined, fim: Date | undefined;
  try {
    inicio = corpo.inicio ? parseFormatoNeo(corpo.inicio) : undefined;
    fim = corpo.fim ? parseFormatoNeo(corpo.fim) : undefined;
  } catch (e) { return json({ error: (e as Error).message }, 400); }

  // Responde já (o pg_net não espera) e trabalha em background; o resultado fica em producao_sync_log.
  EdgeRuntime.waitUntil(
    executarSync(criarDeps(), { modo, inicio, fim })
      .then((r) => console.log(JSON.stringify({ modo, ok: r.ok, linhasApi: r.linhasApi, gravadas: r.gravadas, removidas: r.removidas, erro: r.erro })))
      .catch((e) => console.error("sync-producao falhou fora do log:", e)),
  );
  return json({ aceito: true, modo }, 202);
});
```

- [ ] **Step 2: Gerar os secrets num arquivo temporário (fora do repo)** — substituir os dois `__TOKEN_…__` pelos valores que o usuário passou no chat, ao executar; **nunca gravar os tokens no repositório (ele é público)**

```bash
SP="<pasta temporária fora do repositório>"
umask 077
cat > "$SP/neosales.env" <<EOF
NEOSALES_URL=https://apex.neosales.com.br/producao-painel-integration-v2
NEOSALES_TOKEN_ESTRUTURA=__TOKEN_ESTRUTURA_INFORMADO_NO_CHAT__
NEOSALES_TOKEN_USUARIO=__TOKEN_USUARIO_INFORMADO_NO_CHAT__
NEOSALES_PAINEL_ID=15455
SYNC_CRON_SECRET=$(openssl rand -hex 32)
EOF
grep -c "=" "$SP/neosales.env"
```
Expected: `5`

- [ ] **Step 3: Enviar os secrets e publicar a função**

```bash
SP="<pasta temporária fora do repositório>"
cd $WT
npx supabase secrets set --env-file "$SP/neosales.env" --project-ref mdgfboijyqfkggcrhptn
npx supabase functions deploy sync-producao --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
```
Expected: `Finished supabase secrets set` e `Deployed Functions … sync-producao`. Se o deploy reclamar de tipo/`Deno` no bundle, corrigir o erro apontado e repetir.

- [ ] **Step 4: Segurança — sem segredo correto deve dar 401**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao -H "x-cron-secret: errado" -H "Content-Type: application/json" -d '{"modo":"horario"}'
```
Expected: `401`

- [ ] **Step 5: Execução real (modo horario, janela de ~1 h) e leitura do log**

```bash
SP="<pasta temporária fora do repositório>"
SECRET=$(grep '^SYNC_CRON_SECRET=' "$SP/neosales.env" | cut -d= -f2)
curl -s -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"modo":"horario"}'; echo
sleep 25
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select id, modo, ok, linhas_api, gravadas, removidas, descartes, observacao, erro, janela_ini, janela_fim from public.producao_sync_log order by id desc limit 3; select count(*) as itens, count(distinct numero_pedido) as pedidos from public.producao_pedidos_neo" -o json
```
Expected: resposta `{"aceito":true,"modo":"horario"}`; log com `ok: true`, `linhas_api > 0`, `gravadas > 0`, `erro: null`; `descartes.gross ≈ gravadas` (uma linha GROSS por item) e `grossOrfaos: 0`.

- [ ] **Step 6: Idempotência — repetir a mesma janela não duplica**

```bash
SP="<pasta temporária fora do repositório>"
SECRET=$(grep '^SYNC_CRON_SECRET=' "$SP/neosales.env" | cut -d= -f2)
cd $WT
Q(){ npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select count(*) as itens, count(distinct item_id) as itens_unicos from public.producao_pedidos_neo" -o json | grep -E '"itens'; }
echo antes; Q
sleep 130   # a API só aceita 1 consulta a cada ~2 min
curl -s -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao -H "x-cron-secret: $SECRET" -H "Content-Type: application/json" -d '{"modo":"horario"}' >/dev/null; sleep 25
echo depois; Q
```
Expected: `itens` e `itens_unicos` **iguais** antes e depois (ou crescendo só se surgiu pedido novo no intervalo), e `itens == itens_unicos`.

- [ ] **Step 7: Commit**

```bash
cd $WT && git add supabase/functions/sync-producao/index.ts && git commit -m "feat(producao): Edge Function sync-producao (cron secret, background, upsert por item)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Agendamento (pg_cron) — hora em hora, reconciliação noturna, carga inicial única

**Files:**
- Create: `supabase/migrations/20260929_producao_neo_cron.sql`

**Interfaces:**
- Consumes: endpoint e `SYNC_CRON_SECRET` da Task 6; extensões `pg_cron`, `pg_net`, Vault (Task 1).
- Produces: jobs `sync-producao-horario` (`7 * * * *`), `sync-producao-reconciliar` (`37 2 * * *` UTC = 23:37 SP), `sync-producao-backfill-1` … `-5` (uma janela mensal cada, de 01/05 até agora; `12/17/22/27/32 1 30 9 *` UTC = 22:12…22:32 SP de 29/09; cada um se desagenda). Segredo no Vault com nome `sync_producao_cron_secret`.

- [ ] **Step 1: Guardar o segredo no Vault (valor vem do arquivo temporário, não do repo)**

```bash
SP="<pasta temporária fora do repositório>"
SECRET=$(grep '^SYNC_CRON_SECRET=' "$SP/neosales.env" | cut -d= -f2)
cd $WT
npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select vault.create_secret('$SECRET', 'sync_producao_cron_secret', 'Segredo do cron chamar a Edge Function sync-producao') as id" -o json | grep -c '"id"'
```
Expected: `1`. (Se já existir de tentativa anterior: `select vault.update_secret(id, '<novo>') from vault.secrets where name='sync_producao_cron_secret'`.)

- [ ] **Step 2: Escrever a migration dos jobs (sem nenhum segredo dentro)**

Criar `supabase/migrations/20260929_producao_neo_cron.sql`:

```sql
-- Agendamento da sincronização da produção (NeoSales). Idempotente: remove o job antigo e recria.
-- O segredo NÃO está aqui: é lido do Vault (sync_producao_cron_secret) em tempo de execução.
-- pg_cron roda em UTC; São Paulo = UTC-3 (sem horário de verão).

select cron.unschedule(jobid) from cron.job
 where jobname like 'sync-producao-%';

-- De hora em hora (minuto 7): janela desde o último sucesso - 15 min (no máx. 85 min de dia).
select cron.schedule('sync-producao-horario', '7 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"horario"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);

-- 23:37 (SP), fora da janela diurna e longe do job horário (minuto 7): refaz os últimos 2 dias — cura qualquer lacuna.
select cron.schedule('sync-producao-reconciliar', '37 2 * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"reconciliar"}'::jsonb,
    timeout_milliseconds := 10000);
$job$);

-- Carga inicial ÚNICA, uma consulta por job: a NeoSales só aceita 1 consulta a cada ~2 min e a função faz
-- só uma por execução. 5 janelas mensais, uma a cada 5 min a partir das 22:12 (SP) de 29/09/2026 (= 01:12 UTC
-- de 30/09), sempre longe do job horário (minuto 7). Cada job se desagenda (o cron de 30/09 repetiria todo ano).
do $do$
declare
  r record;
begin
  for r in
    select * from (values
      (1, '2026-05-01 00:00:00', '2026-06-01 00:00:00'),
      (2, '2026-06-01 00:00:00', '2026-07-01 00:00:00'),
      (3, '2026-07-01 00:00:00', '2026-08-01 00:00:00'),
      (4, '2026-08-01 00:00:00', '2026-09-01 00:00:00'),
      (5, '2026-09-01 00:00:00', null)            -- sem "fim": vai até o momento da execução
    ) as t(n, ini, fim) order by n
  loop
    perform cron.schedule(
      'sync-producao-backfill-' || r.n,
      (12 + (r.n - 1) * 5) || ' 1 30 9 *',
      format($job$
        select net.http_post(
          url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao',
          headers := jsonb_build_object('Content-Type','application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
          body := %L::jsonb,
          timeout_milliseconds := 10000);
        select cron.unschedule('sync-producao-backfill-%s');
      $job$,
      (jsonb_build_object('modo','backfill','inicio', r.ini)
        || case when r.fim is null then '{}'::jsonb else jsonb_build_object('fim', r.fim) end)::text,
      r.n)
    );
  end loop;
end
$do$;
```

- [ ] **Step 3: Aplicar e conferir os 3 jobs**

```bash
cd $WT
npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn -f supabase/migrations/20260929_producao_neo_cron.sql
npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select jobname, schedule, active from cron.job where jobname like 'sync-producao%' order by 1" -o json
```
Expected: 7 jobs, todos `active: true`: `sync-producao-horario` (`7 * * * *`), `sync-producao-reconciliar` (`37 2 * * *`) e `sync-producao-backfill-1` … `-5` (`12 1 30 9 *`, `17 1 30 9 *`, `22 1 30 9 *`, `27 1 30 9 *`, `32 1 30 9 *`).

- [ ] **Step 4: Provar que o cron autentica (dispara o job horário agora, sem esperar o minuto 7)**

```bash
cd $WT
sleep 130   # a API só aceita 1 consulta a cada ~2 min (última consulta real: Task 6, Step 6)
npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='sync_producao_cron_secret')), body := '{\"modo\":\"horario\"}'::jsonb, timeout_milliseconds := 10000) as req" -o json | grep -c '"req"'
sleep 30
npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select status_code, left(content::text, 80) as corpo from net._http_response order by id desc limit 1; select id, modo, ok, gravadas, erro from public.producao_sync_log order by id desc limit 2" -o json
```
Expected: `status_code: 202`; novo log `modo: horario`, `ok: true`. (Isso prova Vault + pg_net + segredo, o mesmo caminho do cron.)

- [ ] **Step 5: Apagar o arquivo temporário de segredos e commitar**

```bash
SP="<pasta temporária fora do repositório>"
rm -f "$SP/neosales.env" && ls "$SP" | grep -c neosales.env
cd $WT && git add supabase/migrations/20260929_producao_neo_cron.sql && git commit -m "feat(producao): agendamento pg_cron (horário, reconciliação noturna, carga inicial única)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: `0` (arquivo apagado). Os secrets seguem guardados no Supabase (secrets da função + Vault).

---

### Task 8: Carga inicial, prova de paridade e documentação

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova seção 50 antes do changelog + linha no changelog)
- (Somente leitura no banco: `producao_pedidos` × `producao_pedidos_neo`)

**Interfaces:**
- Consumes: jobs da Task 7 (a carga inicial dispara sozinha a partir das 22:12 SP de 29/09 (5 jobs mensais); se algum falhar, reexecutar só aquela janela à noite).
- Produces: relatório de paridade (números) que autoriza — ou não — a Fase 2.

- [ ] **Step 1: Após 22:40 SP, conferir a carga inicial (5 jobs mensais)**

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select id, modo, ok, linhas_api, gravadas, removidas, descartes, erro, janela_ini, janela_fim from public.producao_sync_log where modo='backfill' order by id limit 10" -o json
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select count(*) itens, count(distinct numero_pedido) pedidos, min(cadastro) primeiro, max(atualizacao) ultimo from public.producao_pedidos_neo" -o json
```
Expected: 5 logs `backfill` com `ok: true` (um por mês); `descartes.grossOrfaos: 0` em todos; `descartes.duplicados` baixo (se `> 0`, investigar antes de seguir).

**Se algum mês falhou** (`ok: false`; ex.: "Aguarde N segundos" por dois jobs colados, ou timeout), reexecutar só aquela janela, à mão, entre 22:02 e 04:58 SP, **uma por vez, com ≥ 3 min entre elas** (o upsert é idempotente, repetir é seguro). Exemplo para junho:

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-producao', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='sync_producao_cron_secret')), body := '{\"modo\":\"backfill\",\"inicio\":\"2026-06-01 00:00:00\",\"fim\":\"2026-07-01 00:00:00\"}'::jsonb, timeout_milliseconds := 10000) as req" -o json
```

- [ ] **Step 2: Paridade com o painel atual (apenas pedidos não alterados depois do último upload manual)**

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "
with corte as (select max(atualizacao) c from public.producao_pedidos),
n as (select numero_pedido, count(*) itens, sum(valor) v, sum(coalesce(quantidade,1)) q, max(atualizacao) ult
      from public.producao_pedidos_neo group by 1),
m as (select numero_pedido, count(*) itens, sum(valor) v, sum(coalesce(quantidade,1)) q
      from public.producao_pedidos group by 1),
comp as (select coalesce(m.numero_pedido, n.numero_pedido) ped, m.itens mi, n.itens ni, m.v mv, n.v nv, m.q mq, n.q nq, n.ult
         from m full join n using (numero_pedido))
select count(*) filter (where mi is not null and ni is not null and mi=ni and abs(mv-nv)<0.01 and mq=nq) as iguais,
       count(*) filter (where mi is not null and ni is not null and not (mi=ni and abs(mv-nv)<0.01 and mq=nq) and ult <= (select c from corte)) as divergentes_estaveis,
       count(*) filter (where mi is not null and ni is not null and not (mi=ni and abs(mv-nv)<0.01 and mq=nq) and ult > (select c from corte)) as divergentes_por_atualizacao_posterior,
       count(*) filter (where ni is null) as so_no_manual,
       count(*) filter (where mi is null) as so_na_api
from comp" -o json
```
Expected: `divergentes_estaveis = 0` (é o número que decide). `divergentes_por_atualizacao_posterior` são pedidos que mudaram depois do upload manual (esperado, é movimentação real). `so_no_manual` deve ser ~0 (se `> 0`, listar e entender: pedidos arquivados/sem grupo no manual?). `so_na_api` = pedidos novos desde o upload.

- [ ] **Step 3: Investigar o motivo de perda (risco em aberto do spec)**

```bash
cd $WT && npx supabase db query --linked --project-ref mdgfboijyqfkggcrhptn "select coalesce(nullif(r.raw->>'tagPedido',''),'(vazio)') as tag_pedido, count(*) n from public.producao_pedidos_neo p join public.producao_neo_raw r using (item_id) where p.etapa = 'VENDA PERDIDA (NEOCRM)' group by 1 order by 2 desc limit 15; select coalesce(p.tag,'(vazio)') as tag_painel_atual, count(*) n from public.producao_pedidos p where p.etapa='VENDA PERDIDA (NEOCRM)' group by 1 order by 2 desc limit 15" -o json
```
Decisão: se a 1ª lista trouxer `#SEMINTERESSE`, `#SEMCREDITO`, `#RESTRICAOOPERADORA`… → o motivo de perda vem na API e a Fase 2 pode seguir. Se vier só `#HOTLEAD`/vazio → o motivo **não** vem na API: registrar e pedir ao suporte do NeoSales para expor "TAGS ATIVIDADE" antes da Fase 2 (senão o diagnóstico de perdas fica vazio). Na dúvida, listar as chaves do JSON cru de um pedido perdido: `select distinct jsonb_object_keys(r.raw) from producao_neo_raw r join producao_pedidos_neo p using (item_id) where p.etapa='VENDA PERDIDA (NEOCRM)' limit 80`.

- [ ] **Step 4: Documentar (regra do projeto: REGRAS_NEGOCIO.md é um documento vivo)**

O changelog é a seção `## 14. Changelog` (lista de bullets datados, no meio do arquivo); as seções vão até a 49. Acrescentar a seção 50 ao FIM do arquivo, um bullet ao fim da lista da seção 14, e atualizar "Última atualização" (topo do arquivo):

```markdown
## 50. Sincronização automática da produção (API NeoSales) — 29/09/2026

Objetivo: acabar com o ciclo "exportar relatório do NeoCRM → Upload Dash". A produção é espelhada sozinha por uma Edge Function (`sync-producao`, em `supabase/functions/sync-producao/`) chamada pelo pg_cron.

- **Fonte**: API "Produção v2" do NeoSales (tokens só como secrets da Edge Function; nunca no HTML). Devolve só pedidos criados/atualizados na janela consultada. De dia a janela máxima é de 90 min; à noite (22:01–05:59) não há limite. Erros da API vêm com HTTP 200 e `{"erro":…}` — tratados como falha.
- **Tabela nova, separada**: `producao_pedidos_neo` (mesmas colunas de `producao_pedidos` + `item_id` único). Enquanto a paridade não foi aprovada, o dashboard continua lendo `producao_pedidos`.
- **Mapeamento**: `numeroLinha` = GRUPO; linhas `GROSS` são duplicatas da API e são descartadas (senão o valor dobra); `ARQUIVADO (NEOCRM)` e linhas sem grupo saem, como no upload manual; usuário em maiúsculas; datas gravadas com offset -03:00.
- **Agenda**: de hora em hora (minuto 7); reconciliação às 23:37 refazendo os últimos 2 dias (cura lacunas); carga inicial em 29/09 a partir das 22:12, um job por mês desde 01/05/2026. A NeoSales só aceita 1 consulta a cada ~2 min (descoberto em teste real, não consta na documentação): por isso cada execução faz uma única consulta.
- **Observabilidade**: `producao_sync_log` guarda cada execução (janela, contagens, erro); o cursor só avança em execução bem-sucedida. `producao_neo_raw` (só admin) guarda o JSON cru de cada item.
- **Pendências (Fase 2, exige aprovação)**: trocar o dashboard para a tabela nova, neutralizar "Upload Dash", exibir "última sincronização" e publicar. Motivo de perda: conferir se `tagPedido` traz as tags de "TAGS ATIVIDADE" (resultado da verificação de 29/09 registrado no changelog).
```
Changelog: `- **29/09/2026** — Criada a sincronização automática da produção via API NeoSales (tabela separada `producao_pedidos_neo`, Edge Function `sync-producao`, pg_cron). Ver seção 50.`

- [ ] **Step 5: Commit e relatório ao usuário**

```bash
cd $WT && git add REGRAS_NEGOCIO.md && git commit -m "docs(producao): regras de negócio da sincronização automática NeoSales (seção 50)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Reportar ao usuário: números do Step 1 (itens/pedidos), do Step 2 (iguais / divergentes_estaveis) e a resposta do Step 3 (motivo de perda vem ou não), e pedir aprovação para a Fase 2.

---

## Self-Review

**Spec coverage:** tabela separada + raw + log (Task 1); mapeamento/GROSS/ARQUIVADO/dedup (Task 2); janelas e limite diurno (Task 3); encoding + erro HTTP 200 + retry (Task 4); cursor/log/blocos/falha parcial (Task 5); Edge Function com auth por segredo, background, secrets, deploy, idempotência (Task 6); horário + reconciliação + carga inicial (Task 7); paridade e risco do motivo de perda + docs (Task 8). Fase 2 (trocar dashboard, neutralizar Upload Dash) está fora de escopo por decisão explícita do spec.

**Placeholder scan:** sem TBD/TODO; todo passo de código tem o código. Os únicos trechos condicionais (reexecutar carga; investigar chaves do JSON) trazem o comando exato.

**Type consistency:** `Registro`, `Descartes`, `Mapeado`, `NeoRow` (Task 2) usados igual nas Tasks 5–6; `Modo`/`Janela` (Task 3) idem; `Deps`/`FechamentoLog` (Task 5) implementados por `criarDeps()` (Task 6) com as mesmas assinaturas; `criarBuscarNeo(cfg)` devolve `(ini, fim) => Promise<NeoRow[]>` = `Deps.buscarNeo`.
