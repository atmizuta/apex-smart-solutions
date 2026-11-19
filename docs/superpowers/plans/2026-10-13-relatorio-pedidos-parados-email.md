# Relatório diário de pedidos parados por e-mail — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo dia útil às 08:00 (São Paulo), uma Edge Function envia à executiva da Claro, pelo SMTP da Hostinger, um
Excel colorido com todos os pedidos parados em Antifraude e Entrega, cada um com a sua criticidade.

**Architecture:**
- **Quem dispara:** o `pg_cron` do Supabase chama a Edge Function `relatorio-pedidos-parados`, com o header
  `x-cron-secret`.
- **Divisão da função:**
  - lógica pura e testável: `regras.ts`, `planilha.ts`, `email.ts` e o orquestrador `relatorio.ts`, que recebe as
    dependências por injeção;
  - casca fina com Supabase e SMTP: `index.ts`.
- **Banco:** os dados vêm de uma função SQL `security definer` que só o `service_role` executa. Os destinatários e o
  log ficam em tabelas próprias, que só o admin lê.

**Tech Stack:**
- Deno (Supabase Edge Runtime);
- `npm:@supabase/supabase-js@2`, `npm:exceljs@4.4.0` e `https://deno.land/x/denomailer@1.6.0/mod.ts`;
- Postgres com `pg_cron`, `pg_net` e Vault;
- testes com `node --test` (Node 24, que executa TypeScript direto).

**Spec:** `docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md`

## Global Constraints

- **Repositório público:** nenhum e-mail pessoal (nem o da executiva nem o do Rafael), nenhuma senha e nenhum dado
  real de cliente em arquivo do repositório. Os testes usam só dados fictícios (`exemplo.com`, "Empresa Teste").
- **Etapas exatas:** `ANTIFRAUDE (NEOCRM)` e `ENTREGA (NEOCRM)`.
- **Criticidade, em dias úteis na etapa atual:**
  - `baixa`: 0–3;
  - `media`: 4–6;
  - `alta`: 7 ou mais.
  - Constante `FAIXAS = { media: 4, alta: 7 }`. Rótulos `BAIXA`, `MÉDIA`, `ALTA`.
- **Dias úteis:**
  - seg–sex, sem feriados nacionais;
  - contam os dias **depois** do dia (em São Paulo) da entrada na etapa até o dia do envio;
  - mesmo dia = 0.
- **Feriados nacionais:**
  - fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 e 25/12;
  - móveis: Carnaval (segunda = Páscoa − 48 e terça = Páscoa − 47), Sexta-feira Santa (Páscoa − 2) e
    Corpus Christi (Páscoa + 60).
- **Agenda:** cron `0 11 * * 1-5` (UTC), que dá 08:00 em São Paulo. São Paulo não tem horário de verão.
- **Remetente:** `Apex Smart Solutions <SMTP_USER>`, em `smtp.hostinger.com`, porta 465, TLS.
- **Versões fixas:** `exceljs@4.4.0`, `denomailer@1.6.0` e `supabase-js@2`.
- **TypeScript:**
  - só sintaxe que o Node consegue apagar (sem `enum`, sem parameter properties, sem `namespace`);
  - imports locais com a extensão `.ts`;
  - tipos importados com `import type`.
- **Projeto Supabase:** `mdgfboijyqfkggcrhptn`.
- **Segredo do cron:** reaproveita `SYNC_CRON_SECRET` (env da função) e `sync_producao_cron_secret` (Vault).
- **Ordem da planilha:** dias parados (maior primeiro), depois etapa (Antifraude antes de Entrega), depois número do
  pedido (numérico).
- **Onde trabalhar:** no worktree `.worktrees/relatorio-pedidos-parados`, branch `feat/relatorio-pedidos-parados`.
  - Antes de juntar: `git fetch oficial`.
  - O push vai para `oficial main`, sem force.
  - Toda mensagem de commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Estes casos não aparecem nos testes do caminho feliz e são os que mais podem atrapalhar quem usa. Cada um tem um teste
na tarefa dona do código.

- **Pedido sem nenhuma data** (`na_etapa_desde`, `atualizacao` e `cadastro` nulos): deve **aparecer** com 0 dias e
  criticidade Baixa, nunca sumir da planilha. Teste na Tarefa 2.
- **Entrada na etapa perto da meia-noite** (ex.: 23:30 em São Paulo = 02:30 UTC do dia seguinte): conta no dia de São
  Paulo. Teste na Tarefa 2.
- **Envio agendado caindo em feriado de dia útil** (ex.: segunda 02/11/2026, Finados): não envia, registra `pulado`. O
  modo `teste` envia mesmo assim. Teste na Tarefa 5.
- **CNPJ que começa com zero** (`01234567000189`): fica como texto no Excel, sem perder o zero. Teste na Tarefa 3.
- **Mais de 1.000 linhas** (limite padrão por chamada do PostgREST): a leitura pagina até acabar. Teste na Tarefa 5.
- **Mensagem de erro do SMTP contendo a senha:** a senha é trocada por `***` antes de ir para o log. Teste na
  Tarefa 5.

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/functions/relatorio-pedidos-parados/regras.ts` (novo) | Datas de SP, feriados, dias úteis, criticidade, agrupamento por pedido, resumo, formatação de datas. |
| `supabase/functions/relatorio-pedidos-parados/regras.test.ts` (novo) | Testes de `regras.ts`. |
| `supabase/functions/relatorio-pedidos-parados/planilha.ts` (novo) | Monta o `.xlsx` com a ExcelJS recebida por parâmetro (Deno usa `npm:`; o teste usa o `node_modules`). |
| `supabase/functions/relatorio-pedidos-parados/planilha.test.ts` (novo) | Gera e relê o arquivo. |
| `supabase/functions/relatorio-pedidos-parados/email.ts` (novo) | Assunto, HTML e texto. |
| `supabase/functions/relatorio-pedidos-parados/email.test.ts` (novo) | Testes de `email.ts`. |
| `supabase/functions/relatorio-pedidos-parados/relatorio.ts` (novo) | Orquestração (feriado, destinatários, duplicidade, leitura, planilha, envio, log), paginação, validação de e-mails, ocultar segredo. |
| `supabase/functions/relatorio-pedidos-parados/relatorio.test.ts` (novo) | Orquestração com dependências falsas. |
| `supabase/functions/relatorio-pedidos-parados/index.ts` (novo) | HTTP, segredo do cron, dependências reais (Supabase, ExcelJS, denomailer). |
| `supabase/migrations/20261013100000_relatorio_pedidos_parados.sql` (novo) | Tabelas, função SQL e job do cron. |
| `supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql` (novo) | Desfaz a migration. |
| `supabase/tests/relatorio_pedidos_parados_check.sql` (novo) | Conferência só de leitura depois de aplicar. |
| `docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md` (alterar) | Corrigir o Carnaval e o comando de teste (Tarefa 2). |
| `REGRAS_NEGOCIO.md` (alterar) | Nova seção 81 (Tarefa 8). |

---

### Task 1: Prova de que a ExcelJS e a denomailer rodam no Edge Runtime

É uma sonda descartável. Se falhar, **pare** e volte ao Rafael com o erro antes de seguir: a Tarefa 3 teria de usar o
plano B da spec §4.2 (XML + `fflate`), que exige um plano próprio.

**Files:**
- Create (temporário, substituído na Tarefa 7): `supabase/functions/relatorio-pedidos-parados/index.ts`

**Interfaces:**
- Consumes: secret `SYNC_CRON_SECRET`, que já existe no projeto.
- Produces: só a resposta da sonda. Nenhum código é reaproveitado.

- [ ] **Step 1: Escrever a sonda**

```ts
// SONDA TEMPORÁRIA (Tarefa 1 do plano 2026-10-13-relatorio-pedidos-parados-email): prova que a ExcelJS gera e relê
// um .xlsx colorido no Edge Runtime e que a denomailer importa. Será substituída pelo index.ts definitivo.
import ExcelJS from "npm:exceljs@4.4.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

Deno.serve(async (req: Request) => {
  if ((req.headers.get("x-cron-secret") ?? "") !== (Deno.env.get("SYNC_CRON_SECRET") ?? "x")) {
    return new Response("Não autorizado", { status: 401 });
  }
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sonda", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.getCell("A1").value = "ok";
    ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC1050F" } };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 2 } };
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const relido = new ExcelJS.Workbook();
    await relido.xlsx.load(bytes);
    const fill = relido.getWorksheet("Sonda")!.getCell("A1").fill as { fgColor?: { argb?: string } };
    return Response.json({ bytes: bytes.length, zip: bytes[0] === 0x50 && bytes[1] === 0x4b, cor: fill?.fgColor?.argb ?? null, smtp: typeof SMTPClient });
  } catch (e) {
    return Response.json({ erro: (e as Error).message, pilha: (e as Error).stack }, { status: 500 });
  }
});
```

- [ ] **Step 2: Publicar a sonda**

Run (dentro do worktree):
`npx supabase functions deploy relatorio-pedidos-parados --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`

Se a CLI não estiver autenticada, publique pela ferramenta MCP `deploy_edge_function` do Supabase, com
`name: relatorio-pedidos-parados`, `verify_jwt: false` e o arquivo `index.ts` acima.

Expected: a publicação termina com sucesso.

- [ ] **Step 3: Chamar a sonda pelo banco, sem expor o segredo**

Na ferramenta `execute_sql` do Supabase (projeto `mdgfboijyqfkggcrhptn`):

```sql
select net.http_post(
  url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/relatorio-pedidos-parados',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
  body := '{}'::jsonb, timeout_milliseconds := 60000) as id;
```

Uns 10 segundos depois, com o `id` devolvido:

```sql
select status_code, content::text from net._http_response where id = <id>;
```

Expected: `status_code = 200` e `content` igual a `{"bytes":<mais de 1000>,"zip":true,"cor":"FFC1050F","smtp":"function"}`.
Se vier 500 ou `cor` nula: **PARE** e reporte o `erro`/`pilha` ao Rafael.

- [ ] **Step 4: Commit da sonda**

```bash
git add supabase/functions/relatorio-pedidos-parados/index.ts
git commit -m "chore(relatorio-parados): sonda ExcelJS + denomailer no Edge Runtime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Regras puras (`regras.ts`)

**Files:**
- Create: `supabase/functions/relatorio-pedidos-parados/regras.ts`
- Test: `supabase/functions/relatorio-pedidos-parados/regras.test.ts`
- Modify: `docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md` (§2 e §7)

**Interfaces:**
- Consumes: nada.
- Produces (usado nas Tarefas 3, 4 e 5):
  - `ETAPAS: readonly ["ANTIFRAUDE (NEOCRM)", "ENTREGA (NEOCRM)"]`
  - `type Criticidade = "alta" | "media" | "baixa"`
  - `CRITICIDADES: Criticidade[]`, na ordem `["alta","media","baixa"]`
  - `FAIXAS = { media: 4, alta: 7 }`
  - `ROTULO: Record<Criticidade,string>`
  - `interface Linha`: `numero_pedido`, `usuario`, `etapa`, `cadastro`, `atualizacao`, `valor`, `quantidade`,
    `produto`, `cliente`, `cnpj`, `na_etapa_desde`, `operacao`
  - `interface Pedido`: `numero_pedido`, `etapa`, `operacao: "Apex"|"Campinas"`, `consultor`, `cliente`, `cnpj`,
    `produtos`, `qtd`, `valor`, `cadastro`, `na_etapa_desde`, `atualizacao`, `dias`, `criticidade`
  - `type Contagem = Record<Criticidade|"total", number>`
  - `interface Resumo { porEtapa: Record<string, Contagem>; total: Contagem }`
  - `diaSp(v: string|Date|null|undefined): string|null`, no formato `YYYY-MM-DD` de São Paulo
  - `feriadosNacionais(ano: number): Set<string>`
  - `ehDiaUtil(dia: string): boolean`
  - `diasUteisDesde(diaIni: string, diaRef: string): number`
  - `criticidade(dias: number): Criticidade`
  - `etapaCurta(etapa: string): string`
  - `montarPedidos(linhas: Linha[], diaRef: string): Pedido[]`, já ordenado
  - `resumir(pedidos: Pedido[]): Resumo`
  - `fmtDiaBr(dia: string): string`, saída `14/10/2026`
  - `fmtDataHoraSp(d: Date): string`, saída `14/10/2026 07:59`

- [ ] **Step 1: Escrever os testes que falham**

`supabase/functions/relatorio-pedidos-parados/regras.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criticidade, diaSp, diasUteisDesde, ehDiaUtil, etapaCurta, feriadosNacionais, fmtDataHoraSp, fmtDiaBr,
  montarPedidos, resumir,
} from "./regras.ts";
import type { Linha } from "./regras.ts";

const linha = (o: Partial<Linha> = {}): Linha => ({
  numero_pedido: "1001", usuario: "FULANO DE TAL", etapa: "ANTIFRAUDE (NEOCRM)",
  cadastro: "2026-10-01T12:00:00-03:00", atualizacao: "2026-10-05T10:00:00-03:00",
  valor: 100, quantidade: 1, produto: "Plano A", cliente: "Empresa Teste", cnpj: "01234567000189",
  na_etapa_desde: "2026-10-05T10:00:00-03:00", operacao: "apex", ...o,
});

// ---------------------------------------------------------------- feriados e dias úteis
test("feriados 2026: fixos e móveis (Carnaval = segunda e terça)", () => {
  const f = feriadosNacionais(2026);
  for (const d of ["2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04",
    "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"]) assert.ok(f.has(d), d);
  assert.ok(!f.has("2026-02-18"), "Quarta-feira de Cinzas não é feriado");
});
test("feriados 2027: móveis", () => {
  const f = feriadosNacionais(2027);
  for (const d of ["2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27"]) assert.ok(f.has(d), d);
});
test("ehDiaUtil: terça comum sim; feriado, sábado e domingo não", () => {
  assert.equal(ehDiaUtil("2026-10-13"), true);
  assert.equal(ehDiaUtil("2026-10-12"), false);
  assert.equal(ehDiaUtil("2026-10-17"), false);
  assert.equal(ehDiaUtil("2026-10-18"), false);
});
test("diasUteisDesde: sexta → segunda = 1; mesmo dia = 0; referência antes = 0", () => {
  assert.equal(diasUteisDesde("2026-10-02", "2026-10-05"), 1);
  assert.equal(diasUteisDesde("2026-10-13", "2026-10-13"), 0);
  assert.equal(diasUteisDesde("2026-10-14", "2026-10-13"), 0);
});
test("diasUteisDesde: pula o feriado de segunda (sexta 09/10 → terça 13/10 = 1)", () => {
  assert.equal(diasUteisDesde("2026-10-09", "2026-10-13"), 1);
});
test("diasUteisDesde: 01/10 → 13/10 = 7 (sem fins de semana nem 12/10)", () => {
  assert.equal(diasUteisDesde("2026-10-01", "2026-10-13"), 7);
});

// ---------------------------------------------------------------- datas em São Paulo
test("diaSp: 23:30 de São Paulo (02:30 UTC do dia seguinte) fica no dia de São Paulo", () => {
  assert.equal(diaSp("2026-10-09T02:30:00Z"), "2026-10-08");
  assert.equal(diaSp(new Date("2026-10-14T11:00:00Z")), "2026-10-14");
});
test("diaSp: vazio ou inválido → null", () => {
  assert.equal(diaSp(null), null);
  assert.equal(diaSp(""), null);
  assert.equal(diaSp("lixo"), null);
});
test("fmtDiaBr e fmtDataHoraSp", () => {
  assert.equal(fmtDiaBr("2026-10-14"), "14/10/2026");
  assert.equal(fmtDataHoraSp(new Date("2026-10-14T10:59:00Z")), "14/10/2026 07:59");
});

// ---------------------------------------------------------------- criticidade
test("criticidade nas fronteiras 3/4 e 6/7", () => {
  assert.equal(criticidade(0), "baixa");
  assert.equal(criticidade(3), "baixa");
  assert.equal(criticidade(4), "media");
  assert.equal(criticidade(6), "media");
  assert.equal(criticidade(7), "alta");
  assert.equal(criticidade(40), "alta");
});
test("etapaCurta tira o sufixo (NEOCRM)", () => {
  assert.equal(etapaCurta("ANTIFRAUDE (NEOCRM)"), "ANTIFRAUDE");
  assert.equal(etapaCurta("ENTREGA (NEOCRM)"), "ENTREGA");
});

// ---------------------------------------------------------------- agrupamento
test("montarPedidos: agrupa as linhas do mesmo pedido", () => {
  const [p, ...resto] = montarPedidos([
    linha({ valor: 100, quantidade: 1, produto: "Plano B", cadastro: "2026-10-02T09:00:00-03:00" }),
    linha({ valor: "50.5", quantidade: 2, produto: "Plano A", cadastro: "2026-10-01T08:00:00-03:00",
      atualizacao: "2026-10-06T15:00:00-03:00" }),
    linha({ valor: 0, quantidade: 0, produto: "Plano A" }),
  ], "2026-10-13");
  assert.equal(resto.length, 0);
  assert.equal(p.numero_pedido, "1001");
  assert.equal(p.valor, 150.5);
  assert.equal(p.qtd, 3);
  assert.equal(p.produtos, "Plano A + Plano B");
  assert.equal(p.cadastro, "2026-10-01T08:00:00-03:00");
  assert.equal(p.atualizacao, "2026-10-06T15:00:00-03:00");
  assert.equal(p.dias, 5); // na etapa desde 05/10 → 06, 07, 08, 09, 13
  assert.equal(p.criticidade, "media");
  assert.equal(p.consultor, "FULANO DE TAL");
  assert.equal(p.cnpj, "01234567000189");
});
test("montarPedidos: ignora outras etapas e pedido sem número", () => {
  const r = montarPedidos([
    linha({ numero_pedido: "1", etapa: "BIOMETRIA (NEOCRM)" }),
    linha({ numero_pedido: "  " }),
    linha({ numero_pedido: null }),
    linha({ numero_pedido: "2", etapa: "ENTREGA (NEOCRM)" }),
  ], "2026-10-13");
  assert.deepEqual(r.map((p) => p.numero_pedido), ["2"]);
});
test("montarPedidos: operação campinas → Campinas; nula ou apex → Apex", () => {
  const r = montarPedidos([
    linha({ numero_pedido: "1", operacao: "campinas" }),
    linha({ numero_pedido: "2", operacao: null }),
    linha({ numero_pedido: "3", operacao: "apex" }),
  ], "2026-10-13");
  const op = Object.fromEntries(r.map((p) => [p.numero_pedido, p.operacao]));
  assert.deepEqual(op, { "1": "Campinas", "2": "Apex", "3": "Apex" });
});
test("montarPedidos: sem na_etapa_desde usa a última atualização", () => {
  const [p] = montarPedidos([linha({ na_etapa_desde: null, atualizacao: "2026-10-09T10:00:00-03:00" })], "2026-10-13");
  assert.equal(p.dias, 1);
  assert.equal(p.na_etapa_desde, "2026-10-09T10:00:00-03:00");
});
test("montarPedidos: pedido sem nenhuma data entra com 0 dias e Baixa (não some)", () => {
  const r = montarPedidos([linha({ na_etapa_desde: null, atualizacao: null, cadastro: null })], "2026-10-13");
  assert.equal(r.length, 1);
  assert.equal(r[0].dias, 0);
  assert.equal(r[0].criticidade, "baixa");
});
test("montarPedidos: ordem = dias desc, depois Antifraude antes de Entrega, depois número numérico", () => {
  const velho = "2026-09-01T10:00:00-03:00";
  const r = montarPedidos([
    linha({ numero_pedido: "1000", etapa: "ENTREGA (NEOCRM)" }),
    linha({ numero_pedido: "900", etapa: "ENTREGA (NEOCRM)" }),
    linha({ numero_pedido: "5", etapa: "ANTIFRAUDE (NEOCRM)" }),
    linha({ numero_pedido: "7", etapa: "ENTREGA (NEOCRM)", na_etapa_desde: velho }),
  ], "2026-10-13");
  assert.deepEqual(r.map((p) => p.numero_pedido), ["7", "5", "900", "1000"]);
});

// ---------------------------------------------------------------- resumo
test("resumir: conta por etapa e criticidade, com as duas etapas sempre presentes", () => {
  const r = resumir(montarPedidos([
    linha({ numero_pedido: "1", na_etapa_desde: "2026-09-01T10:00:00-03:00" }), // alta
    linha({ numero_pedido: "2" }), // média (5)
    linha({ numero_pedido: "3", na_etapa_desde: "2026-10-13T08:00:00-03:00" }), // baixa (0)
  ], "2026-10-13"));
  assert.deepEqual(r.porEtapa["ANTIFRAUDE (NEOCRM)"], { alta: 1, media: 1, baixa: 1, total: 3 });
  assert.deepEqual(r.porEtapa["ENTREGA (NEOCRM)"], { alta: 0, media: 0, baixa: 0, total: 0 });
  assert.deepEqual(r.total, { alta: 1, media: 1, baixa: 1, total: 3 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/regras.test.ts"`
Expected: FAIL, com `Cannot find module ... regras.ts`.

- [ ] **Step 3: Implementar `regras.ts`**

```ts
// Regras puras do relatório diário de pedidos parados (Antifraude e Entrega). Spec:
// docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md (§3). REGRAS_NEGOCIO.md §81.
// Dias úteis e feriados seguem a regra do Dashboard de Produção (§48.2), copiada porque a Edge Function não
// enxerga o painel — com o Carnaval na segunda e terça (Páscoa − 48 e − 47).

export const ETAPAS = ["ANTIFRAUDE (NEOCRM)", "ENTREGA (NEOCRM)"] as const;
export type Criticidade = "alta" | "media" | "baixa";
export const CRITICIDADES: Criticidade[] = ["alta", "media", "baixa"];
export const FAIXAS = { media: 4, alta: 7 } as const;
export const ROTULO: Record<Criticidade, string> = { alta: "ALTA", media: "MÉDIA", baixa: "BAIXA" };

export interface Linha {
  numero_pedido: string | null;
  usuario: string | null;
  etapa: string;
  cadastro: string | null;
  atualizacao: string | null;
  valor: number | string | null;
  quantidade: number | string | null;
  produto: string | null;
  cliente: string | null;
  cnpj: string | null;
  na_etapa_desde: string | null;
  operacao: string | null;
}

export interface Pedido {
  numero_pedido: string;
  etapa: string;
  operacao: "Apex" | "Campinas";
  consultor: string;
  cliente: string;
  cnpj: string;
  produtos: string;
  qtd: number;
  valor: number;
  cadastro: string | null;
  na_etapa_desde: string | null;
  atualizacao: string | null;
  dias: number;
  criticidade: Criticidade;
}

export type Contagem = Record<Criticidade | "total", number>;
export interface Resumo { porEtapa: Record<string, Contagem>; total: Contagem }

const FMT_SP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function partesSp(d: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const x of FMT_SP.formatToParts(d)) p[x.type] = x.value;
  p.hour = String(parseInt(p.hour, 10) % 24).padStart(2, "0");
  return p;
}

export function diaSp(v: string | Date | null | undefined): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = partesSp(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtDiaBr(dia: string): string {
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtDataHoraSp(d: Date): string {
  const p = partesSp(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function somarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Páscoa pelo algoritmo de Meeus/Jones/Butcher (o mesmo do painel).
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const CACHE_FERIADOS = new Map<number, Set<string>>();
export function feriadosNacionais(ano: number): Set<string> {
  const pronto = CACHE_FERIADOS.get(ano);
  if (pronto) return pronto;
  const s = new Set<string>();
  for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]) s.add(`${ano}-${md}`);
  const p = pascoa(ano);
  for (const off of [-48, -47, -2, 60]) s.add(somarDias(p, off)); // Carnaval seg/ter, Sexta Santa, Corpus Christi
  CACHE_FERIADOS.set(ano, s);
  return s;
}

export function ehDiaUtil(dia: string): boolean {
  const [y, m, d] = dia.split("-").map(Number);
  const sem = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (sem === 0 || sem === 6) return false;
  return !feriadosNacionais(y).has(dia);
}

// Dias úteis DEPOIS de diaIni até diaRef (inclusive). Ex.: sexta → segunda = 1.
export function diasUteisDesde(diaIni: string, diaRef: string): number {
  if (!diaIni || !diaRef || diaRef <= diaIni) return 0;
  let n = 0;
  for (let d = somarDias(diaIni, 1); d <= diaRef; d = somarDias(d, 1)) if (ehDiaUtil(d)) n++;
  return n;
}

export function criticidade(dias: number): Criticidade {
  if (dias >= FAIXAS.alta) return "alta";
  if (dias >= FAIXAS.media) return "media";
  return "baixa";
}

export function etapaCurta(etapa: string): string {
  return String(etapa ?? "").replace(/\s*\(NEOCRM\)\s*$/i, "").trim();
}

const instante = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);
const numero = (v: number | string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function montarPedidos(linhas: Linha[], diaRef: string): Pedido[] {
  const porPedido = new Map<string, Linha[]>();
  for (const l of linhas ?? []) {
    if (!l || !(ETAPAS as readonly string[]).includes(l.etapa)) continue;
    const num = l.numero_pedido == null ? "" : String(l.numero_pedido).trim();
    if (!num) continue;
    const grupo = porPedido.get(num);
    if (grupo) grupo.push(l); else porPedido.set(num, [l]);
  }

  const lista: Pedido[] = [];
  for (const [num, ls] of porPedido) {
    // linha de referência = a de ATUALIZACAO mais recente (sem data vai para o fim)
    const ordenadas = [...ls].sort((a, b) => {
      const ta = instante(a.atualizacao), tb = instante(b.atualizacao);
      if (isNaN(ta)) return isNaN(tb) ? 0 : 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });
    const ref = ordenadas[0];
    const texto = (campo: keyof Linha): string => {
      const r = ls.find((x) => x[campo] != null && String(x[campo]).trim() !== "");
      return r ? String(r[campo]).trim() : "";
    };
    const cadastros = ls.map((x) => x.cadastro).filter((c): c is string => !!c && !isNaN(instante(c)))
      .sort((a, b) => instante(a) - instante(b));
    const desde = ref.na_etapa_desde || ref.atualizacao || cadastros[0] || null;
    const diaDesde = diaSp(desde);
    const dias = diaDesde ? diasUteisDesde(diaDesde, diaRef) : 0;
    const produtos = [...new Set(ls.map((x) => x.produto).filter((p) => p != null && String(p).trim() !== "")
      .map((p) => String(p).trim()))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    lista.push({
      numero_pedido: num,
      etapa: ref.etapa,
      operacao: texto("operacao").toLowerCase() === "campinas" ? "Campinas" : "Apex",
      consultor: texto("usuario"),
      cliente: texto("cliente"),
      cnpj: texto("cnpj"),
      produtos: produtos.join(" + "),
      qtd: ls.reduce((s, x) => s + numero(x.quantidade), 0),
      valor: Math.round(ls.reduce((s, x) => s + numero(x.valor), 0) * 100) / 100,
      cadastro: cadastros[0] ?? null,
      na_etapa_desde: desde,
      atualizacao: ref.atualizacao ?? null,
      dias,
      criticidade: criticidade(dias),
    });
  }

  const ordemEtapa = (e: string) => (ETAPAS as readonly string[]).indexOf(e);
  lista.sort((a, b) => (b.dias - a.dias) || (ordemEtapa(a.etapa) - ordemEtapa(b.etapa))
    || a.numero_pedido.localeCompare(b.numero_pedido, "pt-BR", { numeric: true }));
  return lista;
}

const zero = (): Contagem => ({ alta: 0, media: 0, baixa: 0, total: 0 });
export function resumir(pedidos: Pedido[]): Resumo {
  const porEtapa: Record<string, Contagem> = {};
  for (const e of ETAPAS) porEtapa[e] = zero();
  const total = zero();
  for (const p of pedidos) {
    const c = porEtapa[p.etapa] ?? (porEtapa[p.etapa] = zero());
    c[p.criticidade]++; c.total++;
    total[p.criticidade]++; total.total++;
  }
  return { porEtapa, total };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/regras.test.ts"`
Expected: PASS, com todos os testes `ok` e 0 falhas.

- [ ] **Step 5: Corrigir a spec**

Em `docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md`:

1. Em §2, troque a frase que começa com "Os feriados e a contagem de dias úteis seguem a mesma regra do Dashboard"
   por:

   > Os feriados e a contagem de dias úteis seguem a regra do Dashboard (seção 48.2 do REGRAS), **copiada** para
   > `regras.ts`, porque a Edge Function não enxerga o código do painel. Há uma diferença de propósito: o Carnaval fica na
   > segunda e na terça (Páscoa − 48 e − 47). O painel usa − 47 e − 46, que marca a terça e a Quarta de Cinzas, e
   > esse erro será corrigido à parte.

2. Em §7, troque `deno test supabase/functions/relatorio-pedidos-parados/` por
   `node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"` (o projeto roda os testes das Edge
   Functions com o Node 24, sem Deno).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/relatorio-pedidos-parados/regras.ts supabase/functions/relatorio-pedidos-parados/regras.test.ts docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md
git commit -m "feat(relatorio-parados): regras puras (dias uteis, feriados, criticidade, agrupamento)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Planilha (`planilha.ts`)

**Files:**
- Create: `supabase/functions/relatorio-pedidos-parados/planilha.ts`
- Test: `supabase/functions/relatorio-pedidos-parados/planilha.test.ts`

**Interfaces:**
- Consumes: de `regras.ts`, `Pedido`, `ETAPAS`, `CRITICIDADES`, `ROTULO`, `FAIXAS`, `etapaCurta`, `resumir`,
  `fmtDiaBr` e `fmtDataHoraSp`.
- Produces (usado nas Tarefas 5 e 7):
  - `CABECALHO: string[]`, com 15 colunas, na ordem da spec §4.2;
  - `CORES`;
  - `nomeArquivo(diaRef: string): string`, que devolve `PedidosParados_2026-10-14.xlsx`;
  - `dataExcelSp(iso: string|null): Date|null`;
  - `interface InfoPlanilha { diaRef: string; sincronizadoEm: Date | null }`;
  - `gerarPlanilha(ExcelJS: ExcelJSLike, pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array>`, em que
    `ExcelJSLike = { Workbook: new () => any }`.

- [ ] **Step 1: Instalar as dependências de teste no worktree**

Run: `npm install`
Expected: termina sem erro e cria `node_modules/exceljs`. O `node_modules/` já está no `.gitignore`.

- [ ] **Step 2: Escrever os testes que falham**

`supabase/functions/relatorio-pedidos-parados/planilha.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { CABECALHO, CORES, dataExcelSp, gerarPlanilha, nomeArquivo } from "./planilha.ts";
import type { Pedido } from "./regras.ts";

const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  numero_pedido: "1001", etapa: "ANTIFRAUDE (NEOCRM)", operacao: "Apex", consultor: "FULANO DE TAL",
  cliente: "Empresa Teste", cnpj: "01234567000189", produtos: "Plano A + Plano B", qtd: 3, valor: 150.5,
  cadastro: "2026-10-01T08:00:00-03:00", na_etapa_desde: "2026-10-05T10:00:00-03:00",
  atualizacao: "2026-10-06T15:00:00-03:00", dias: 5, criticidade: "media", ...o,
});
const PEDIDOS: Pedido[] = [
  pedido({ numero_pedido: "7", etapa: "ENTREGA (NEOCRM)", dias: 9, criticidade: "alta", operacao: "Campinas" }),
  pedido(),
  pedido({ numero_pedido: "8", dias: 0, criticidade: "baixa" }),
];
const INFO = { diaRef: "2026-10-14", sincronizadoEm: new Date("2026-10-14T10:59:00Z") };

async function abrir(pedidos: Pedido[] = PEDIDOS) {
  const bytes = await gerarPlanilha(ExcelJS, pedidos, INFO);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // zip
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  return wb;
}
const argb = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

test("nomeArquivo", () => {
  assert.equal(nomeArquivo("2026-10-14"), "PedidosParados_2026-10-14.xlsx");
});
test("dataExcelSp grava os números do horário de São Paulo", () => {
  assert.equal(dataExcelSp("2026-10-14T10:59:00Z")!.toISOString(), "2026-10-14T07:59:00.000Z");
  assert.equal(dataExcelSp(null), null);
  assert.equal(dataExcelSp("lixo"), null);
});
test("duas abas, cabeçalho na linha 3, congelado e com filtro", async () => {
  const wb = await abrir();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Pedidos Parados", "Resumo"]);
  const ws = wb.getWorksheet("Pedidos Parados")!;
  assert.deepEqual(CABECALHO, ["Criticidade", "Dias parados", "Etapa", "Nº do pedido", "Operação", "Consultor",
    "Cliente", "CNPJ", "Produto(s)", "Qtd.", "Valor (R$)", "Cadastro", "Na etapa desde", "Última atualização", "Retorno"]);
  assert.deepEqual((ws.getRow(3).values as unknown[]).slice(1), CABECALHO);
  assert.match(String(ws.getCell("A1").value), /Pedidos parados/);
  assert.match(String(ws.getCell("A2").value), /14\/10\/2026/);
  assert.match(String(ws.getCell("A2").value), /07:59/);
  assert.equal(ws.views[0].state, "frozen");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, 3);
  assert.ok(ws.autoFilter, "filtro automático presente");
});
test("linhas na ordem recebida, coloridas pela criticidade", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  assert.equal(ws.getCell("A4").value, "ALTA");
  assert.equal(argb(ws.getCell("A4")), CORES.alta.forte);
  assert.equal(argb(ws.getCell("B4")), CORES.alta.claro);
  assert.equal(ws.getCell("C4").value, "ENTREGA");
  assert.equal(ws.getCell("E4").value, "Campinas");
  assert.equal(ws.getCell("A5").value, "MÉDIA");
  assert.equal(argb(ws.getCell("A5")), CORES.media.forte);
  assert.equal(argb(ws.getCell("N5")), CORES.media.claro);
  assert.equal(ws.getCell("A6").value, "BAIXA");
  assert.equal(argb(ws.getCell("A6")), CORES.baixa.forte);
  assert.equal(ws.getCell("B6").value, 0);
});
test("nº do pedido e CNPJ como texto (CNPJ mantém o zero inicial); valor e datas tipados", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  assert.equal(ws.getCell("D5").value, "1001");
  assert.equal(ws.getCell("H5").value, "01234567000189");
  assert.equal(ws.getCell("H5").numFmt, "@");
  assert.equal(ws.getCell("K5").value, 150.5);
  assert.ok(ws.getCell("L5").value instanceof Date);
  assert.ok(ws.getCell("M5").value instanceof Date);
  assert.ok(ws.getCell("N5").value instanceof Date);
});
test("coluna Retorno em branco, larga e com quebra de linha", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  for (const r of [4, 5, 6]) {
    const v = ws.getCell(`O${r}`).value;
    assert.ok(v == null || v === "", `O${r} vazio`);
  }
  assert.ok((ws.getColumn(15).width ?? 0) >= 40);
  assert.equal(ws.getCell("O4").alignment?.wrapText, true);
});
test("aba Resumo: Etapa × Criticidade com total", async () => {
  const rs = (await abrir()).getWorksheet("Resumo")!;
  assert.deepEqual((rs.getRow(1).values as unknown[]).slice(1), ["Etapa", "Alta", "Média", "Baixa", "Total"]);
  assert.deepEqual((rs.getRow(2).values as unknown[]).slice(1), ["ANTIFRAUDE", 0, 1, 1, 2]);
  assert.deepEqual((rs.getRow(3).values as unknown[]).slice(1), ["ENTREGA", 1, 0, 0, 1]);
  assert.deepEqual((rs.getRow(4).values as unknown[]).slice(1), ["TOTAL", 1, 1, 1, 3]);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/planilha.test.ts"`
Expected: FAIL, com `Cannot find module ... planilha.ts`.

- [ ] **Step 4: Implementar `planilha.ts`**

```ts
// Excel do relatório diário de pedidos parados (spec §4.2). Mesmo padrão visual do Excel de Pedidos em Alerta
// (REGRAS §48.4). A ExcelJS chega por parâmetro: no Deno vem de npm:exceljs@4.4.0; no teste, do node_modules.
import { ETAPAS, CRITICIDADES, ROTULO, etapaCurta, fmtDataHoraSp, fmtDiaBr, resumir } from "./regras.ts";
import type { Criticidade, Pedido } from "./regras.ts";

// deno-lint-ignore no-explicit-any
export type ExcelJSLike = { Workbook: new () => any };
export interface InfoPlanilha { diaRef: string; sincronizadoEm: Date | null }

export const CABECALHO = ["Criticidade", "Dias parados", "Etapa", "Nº do pedido", "Operação", "Consultor", "Cliente",
  "CNPJ", "Produto(s)", "Qtd.", "Valor (R$)", "Cadastro", "Na etapa desde", "Última atualização", "Retorno"];
const COL_RETORNO = 15;
const LARGURA_RETORNO = 50;

// ARGB, as mesmas cores do Excel de Pedidos em Alerta (alta = máximo, média = médio, baixa = mínimo).
export const CORES: Record<Criticidade, { forte: string; claro: string; texto: string }> & { cabecalho: { fundo: string; texto: string } } = {
  alta: { forte: "FFC1050F", claro: "FFFFC7CE", texto: "FFFFFFFF" },
  media: { forte: "FFF97316", claro: "FFFFD8B0", texto: "FFFFFFFF" },
  baixa: { forte: "FFEAB308", claro: "FFFFF2A8", texto: "FF000000" },
  cabecalho: { fundo: "FF1D1F20", texto: "FFFFFFFF" },
};

export function nomeArquivo(diaRef: string): string {
  return `PedidosParados_${diaRef}.xlsx`;
}

// O Excel não tem fuso: grava uma Date "UTC" com os números do horário de São Paulo.
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function dataExcelSp(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, parseInt(p.hour, 10) % 24, +p.minute));
}

export async function gerarPlanilha(ExcelJS: ExcelJSLike, pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Apex Smart Solutions";
  // deno-lint-ignore no-explicit-any
  const pintar = (cell: any, cor: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } }; };
  // deno-lint-ignore no-explicit-any
  const cabecalho = (row: any, textos: string[]) => textos.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: CORES.cabecalho.texto } };
    pintar(c, CORES.cabecalho.fundo);
  });

  const ws = wb.addWorksheet("Pedidos Parados", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.getCell("A1").value = "Pedidos parados em Antifraude e Entrega — Apex / Claro";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, CABECALHO.length);
  const sinc = info.sincronizadoEm ? fmtDataHoraSp(info.sincronizadoEm) : "não informada";
  ws.getCell("A2").value = `Referência ${fmtDiaBr(info.diaRef)} · dados do NeoCRM sincronizados em ${sinc}`
    + " · dias úteis na etapa atual · Baixa 0–3 · Média 4–6 · Alta 7+";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, CABECALHO.length);
  cabecalho(ws.getRow(3), CABECALHO);
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: CABECALHO.length } };

  pedidos.forEach((p, i) => {
    const row = ws.getRow(4 + i);
    const cor = CORES[p.criticidade];
    [ROTULO[p.criticidade], p.dias, etapaCurta(p.etapa), p.numero_pedido, p.operacao, p.consultor, p.cliente, p.cnpj,
      p.produtos, p.qtd, p.valor, dataExcelSp(p.cadastro), dataExcelSp(p.na_etapa_desde), dataExcelSp(p.atualizacao), null]
      .forEach((v, c) => {
        const cell = row.getCell(c + 1);
        cell.value = v;
        pintar(cell, c === 0 ? cor.forte : cor.claro);
      });
    row.getCell(1).font = { bold: true, color: { argb: cor.texto } };
    row.getCell(4).numFmt = "@";
    row.getCell(8).numFmt = "@";
    row.getCell(11).numFmt = '"R$" #,##0.00';
    row.getCell(12).numFmt = "dd/mm/yyyy";
    row.getCell(13).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(14).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(COL_RETORNO).alignment = { wrapText: true, vertical: "top" };
  });

  // largura pelo maior conteúdo (limitada a 60); Retorno fixa e larga para a executiva escrever
  CABECALHO.forEach((t, i) => {
    if (i + 1 === COL_RETORNO) { ws.getColumn(i + 1).width = LARGURA_RETORNO; return; }
    let max = t.length;
    for (let r = 4; r < 4 + pedidos.length; r++) {
      const v = ws.getRow(r).getCell(i + 1).value;
      const len = v instanceof Date ? 16 : String(v ?? "").length;
      if (len > max) max = len;
    }
    ws.getColumn(i + 1).width = Math.min(60, max + 2);
  });

  const rs = wb.addWorksheet("Resumo");
  const resumo = resumir(pedidos);
  cabecalho(rs.getRow(1), ["Etapa", ...CRITICIDADES.map((c) => ROTULO[c].charAt(0) + ROTULO[c].slice(1).toLowerCase()), "Total"]);
  ETAPAS.forEach((e, i) => {
    const r = resumo.porEtapa[e];
    rs.getRow(2 + i).values = [etapaCurta(e), ...CRITICIDADES.map((c) => r[c]), r.total];
  });
  const tot = rs.getRow(2 + ETAPAS.length);
  tot.values = ["TOTAL", ...CRITICIDADES.map((c) => resumo.total[c]), resumo.total.total];
  tot.font = { bold: true };
  rs.getColumn(1).width = 20;
  [2, 3, 4, 5].forEach((c) => { rs.getColumn(c).width = 12; });

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
```

Nota: `ROTULO.media` é `"MÉDIA"`. Com a primeira letra mantida e o resto em minúsculas, o cabeçalho fica
`"Alta"`, `"Média"` e `"Baixa"`, que é o que o teste espera.

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/planilha.test.ts"`
Expected: PASS, com 0 falhas.

Se `ws.autoFilter` vier vazio na releitura (diferença de versão da ExcelJS), troque a verificação por
`assert.match(JSON.stringify(ws.model.autoFilter ?? ws.autoFilter), /A3/)` e rode de novo.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/relatorio-pedidos-parados/planilha.ts supabase/functions/relatorio-pedidos-parados/planilha.test.ts
git commit -m "feat(relatorio-parados): planilha Excel colorida por criticidade, com Resumo e coluna Retorno

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Texto do e-mail (`email.ts`)

**Files:**
- Create: `supabase/functions/relatorio-pedidos-parados/email.ts`
- Test: `supabase/functions/relatorio-pedidos-parados/email.test.ts`

**Interfaces:**
- Consumes: de `regras.ts`, `Resumo`, `ETAPAS`, `CRITICIDADES`, `ROTULO`, `etapaCurta`, `fmtDiaBr` e
  `fmtDataHoraSp`.
- Produces (usado na Tarefa 5):
  - `LIMITE_DADOS_VELHOS_H = 3`;
  - `interface DadosEmail { diaRef: string; resumo: Resumo; sincronizadoEm: Date | null; agora: Date; teste: boolean }`;
  - `montarEmail(d: DadosEmail): { assunto: string; html: string; texto: string }`.

- [ ] **Step 1: Escrever os testes que falham**

`supabase/functions/relatorio-pedidos-parados/email.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarEmail } from "./email.ts";
import type { Resumo } from "./regras.ts";

const AGORA = new Date("2026-10-14T11:00:00Z"); // 08:00 SP
const resumo = (a: number[], e: number[]): Resumo => {
  const c = (x: number[]) => ({ alta: x[0], media: x[1], baixa: x[2], total: x[0] + x[1] + x[2] });
  const t = c([a[0] + e[0], a[1] + e[1], a[2] + e[2]]);
  return { porEtapa: { "ANTIFRAUDE (NEOCRM)": c(a), "ENTREGA (NEOCRM)": c(e) }, total: t };
};
const base = { diaRef: "2026-10-14", agora: AGORA, sincronizadoEm: new Date("2026-10-14T10:59:00Z"), teste: false };

test("assunto com total e quantos em alta", () => {
  const m = montarEmail({ ...base, resumo: resumo([1, 1, 0], [0, 0, 1]) });
  assert.equal(m.assunto, "Pedidos parados — Antifraude e Entrega — 14/10/2026 (3 pedidos, 1 em alta)");
});
test("assunto no singular com 1 pedido", () => {
  const m = montarEmail({ ...base, resumo: resumo([0, 0, 1], [0, 0, 0]) });
  assert.equal(m.assunto, "Pedidos parados — Antifraude e Entrega — 14/10/2026 (1 pedido, 0 em alta)");
});
test("modo teste ganha o prefixo [TESTE]", () => {
  const m = montarEmail({ ...base, teste: true, resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(m.assunto, /^\[TESTE\] Pedidos parados/);
});
test("texto e HTML trazem a linha de cada etapa, o total e a hora da sincronização", () => {
  const m = montarEmail({ ...base, resumo: resumo([1, 1, 0], [0, 0, 1]) });
  assert.match(m.texto, /Antifraude: 2 \(Alta 1 · Média 1 · Baixa 0\)/);
  assert.match(m.texto, /Entrega: 1 \(Alta 0 · Média 0 · Baixa 1\)/);
  assert.match(m.texto, /Total: 3/);
  assert.match(m.texto, /sincronizados em 14\/10\/2026 07:59/);
  assert.match(m.texto, /coluna Retorno/);
  assert.match(m.html, /<table/);
  assert.match(m.html, /Antifraude/);
  assert.doesNotMatch(m.texto, /Atenção/);
});
test("sem pedidos: assunto e texto dizem que não há pedidos parados", () => {
  const m = montarEmail({ ...base, resumo: resumo([0, 0, 0], [0, 0, 0]) });
  assert.match(m.assunto, /\(nenhum pedido parado\)$/);
  assert.match(m.texto, /não há pedidos parados/);
  assert.doesNotMatch(m.texto, /coluna Retorno/);
});
test("dados com mais de 3 h: aviso; até 3 h: sem aviso; sem hora: aviso de não confirmado", () => {
  const velho = montarEmail({ ...base, sincronizadoEm: new Date("2026-10-14T06:59:00Z"), resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(velho.texto, /Atenção: a última sincronização com o NeoCRM foi em 14\/10\/2026 03:59/);
  assert.match(velho.html, /Atenção/);
  const ok = montarEmail({ ...base, sincronizadoEm: new Date("2026-10-14T08:00:00Z"), resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.doesNotMatch(ok.texto, /Atenção/);
  const nulo = montarEmail({ ...base, sincronizadoEm: null, resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(nulo.texto, /não foi possível confirmar a hora da última sincronização/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/email.test.ts"`
Expected: FAIL, com `Cannot find module ... email.ts`.

- [ ] **Step 3: Implementar `email.ts`**

```ts
// Assunto e corpo do e-mail diário de pedidos parados (spec §4.1). O corpo só leva contagens: os dados dos
// clientes vão no anexo.
import { CRITICIDADES, ETAPAS, ROTULO, etapaCurta, fmtDataHoraSp, fmtDiaBr } from "./regras.ts";
import type { Contagem, Resumo } from "./regras.ts";

export const LIMITE_DADOS_VELHOS_H = 3;
export interface DadosEmail { diaRef: string; resumo: Resumo; sincronizadoEm: Date | null; agora: Date; teste: boolean }

const titulo = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const detalhe = (c: Contagem) => CRITICIDADES.map((k) => `${titulo(ROTULO[k])} ${c[k]}`).join(" · ");

function avisoSincronizacao(d: DadosEmail): string | null {
  if (!d.sincronizadoEm) {
    return "Atenção: não foi possível confirmar a hora da última sincronização com o NeoCRM; a planilha pode não refletir as últimas movimentações.";
  }
  const horas = (d.agora.getTime() - d.sincronizadoEm.getTime()) / 3_600_000;
  if (horas <= LIMITE_DADOS_VELHOS_H) return null;
  return `Atenção: a última sincronização com o NeoCRM foi em ${fmtDataHoraSp(d.sincronizadoEm)} (há mais de ${LIMITE_DADOS_VELHOS_H} horas); a planilha pode não refletir as últimas movimentações.`;
}

export function montarEmail(d: DadosEmail): { assunto: string; html: string; texto: string } {
  const total = d.resumo.total.total;
  const prefixo = d.teste ? "[TESTE] " : "";
  const qtd = total === 0 ? "nenhum pedido parado"
    : `${total} ${total === 1 ? "pedido" : "pedidos"}, ${d.resumo.total.alta} em alta`;
  const assunto = `${prefixo}Pedidos parados — Antifraude e Entrega — ${fmtDiaBr(d.diaRef)} (${qtd})`;

  const aviso = avisoSincronizacao(d);
  const sinc = d.sincronizadoEm ? `Dados do NeoCRM sincronizados em ${fmtDataHoraSp(d.sincronizadoEm)}.` : null;
  const linhasEtapa = ETAPAS.map((e) => {
    const c = d.resumo.porEtapa[e];
    return `${titulo(etapaCurta(e))}: ${c.total} (${detalhe(c)})`;
  });

  const texto = [
    "Bom dia!",
    "",
    total === 0
      ? "Hoje não há pedidos parados em Antifraude nem em Entrega."
      : "Segue em anexo a planilha com todos os pedidos parados em Antifraude e Entrega, com a criticidade de cada um (dias úteis na etapa): Baixa 0–3 · Média 4–6 · Alta 7+.",
    "",
    ...(total === 0 ? [] : [...linhasEtapa, `Total: ${total}`, ""]),
    ...(sinc ? [sinc] : []),
    ...(aviso ? [aviso] : []),
    ...(total === 0 ? [] : ["", "Na coluna Retorno da planilha, por favor registre o status de cada pedido para repassarmos ao back office."]),
    "",
    "Apex Smart Solutions",
  ].join("\n");

  const celula = "padding:6px 10px;border:1px solid #ddd;text-align:center";
  const tabela = total === 0 ? "" : `
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin:12px 0">
  <tr style="background:#1D1F20;color:#fff"><th style="${celula}">Etapa</th>${CRITICIDADES.map((k) => `<th style="${celula}">${titulo(ROTULO[k])}</th>`).join("")}<th style="${celula}">Total</th></tr>
  ${ETAPAS.map((e) => {
    const c = d.resumo.porEtapa[e];
    return `<tr><td style="${celula};text-align:left">${esc(titulo(etapaCurta(e)))}</td>${CRITICIDADES.map((k) => `<td style="${celula}">${c[k]}</td>`).join("")}<td style="${celula}"><b>${c.total}</b></td></tr>`;
  }).join("\n  ")}
  <tr><td style="${celula};text-align:left"><b>Total</b></td>${CRITICIDADES.map((k) => `<td style="${celula}"><b>${d.resumo.total[k]}</b></td>`).join("")}<td style="${celula}"><b>${total}</b></td></tr>
</table>`;

  const p = (s: string, estilo = "") => `<p style="font-family:Arial,sans-serif;font-size:14px;${estilo}">${esc(s)}</p>`;
  const html = [
    p("Bom dia!"),
    p(total === 0
      ? "Hoje não há pedidos parados em Antifraude nem em Entrega."
      : "Segue em anexo a planilha com todos os pedidos parados em Antifraude e Entrega, com a criticidade de cada um (dias úteis na etapa): Baixa 0–3 · Média 4–6 · Alta 7+."),
    tabela,
    sinc ? p(sinc, "color:#666") : "",
    aviso ? p(aviso, "color:#C1050F;font-weight:bold") : "",
    total === 0 ? "" : p("Na coluna Retorno da planilha, por favor registre o status de cada pedido para repassarmos ao back office."),
    p("Apex Smart Solutions", "font-weight:bold"),
  ].filter(Boolean).join("\n");

  return { assunto, html, texto };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/email.test.ts"`
Expected: PASS, com 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/relatorio-pedidos-parados/email.ts supabase/functions/relatorio-pedidos-parados/email.test.ts
git commit -m "feat(relatorio-parados): assunto e corpo do e-mail (resumo, aviso de dados velhos, modo teste)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Orquestração (`relatorio.ts`)

**Files:**
- Create: `supabase/functions/relatorio-pedidos-parados/relatorio.ts`
- Test: `supabase/functions/relatorio-pedidos-parados/relatorio.test.ts`

**Interfaces:**
- Consumes:
  - de `regras.ts`: `diaSp`, `ehDiaUtil`, `montarPedidos`, `resumir` e os tipos `Linha` e `Pedido`;
  - de `planilha.ts`: `nomeArquivo` e o tipo `InfoPlanilha`;
  - de `email.ts`: `montarEmail`.
- Produces (usado na Tarefa 7):
  - `type Modo = "agendado" | "teste" | "reenviar"`;
  - `MODOS: Modo[]`;
  - `interface Destinatarios { para: string[]; cc: string[]; ativo: boolean }`;
  - `interface Mensagem { para: string[]; cc: string[]; assunto: string; html: string; texto: string; anexo: { nome: string; bytes: Uint8Array } | null }`;
  - `interface RegistroEnvio { modo: Modo; data_ref: string; status: "enviado"|"pulado"|"erro"; motivo: string|null; qtd_pedidos: number|null; destinatarios: string[]; erro: string|null }`;
  - `interface Deps { agora(): Date; lerDestinatarios(): Promise<Destinatarios|null>; jaEnviouHoje(diaRef: string): Promise<boolean>; lerLinhas(): Promise<Linha[]>; ultimaSincronizacao(): Promise<Date|null>; gerarPlanilha(pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array>; enviar(m: Mensagem): Promise<void>; registrar(r: RegistroEnvio): Promise<void> }`;
  - `interface Opcoes { modo: Modo; paraTeste?: unknown }`;
  - `executarRelatorio(deps: Deps, op: Opcoes): Promise<RegistroEnvio>`;
  - `lerTodasPaginas<T>(buscar: (de: number, ate: number) => Promise<T[]>, tamanho?: number): Promise<T[]>`;
  - `validarEmails(lista: unknown): string[] | null`;
  - `ocultarSegredo(texto: string, segredo: string | undefined): string`.

- [ ] **Step 1: Escrever os testes que falham**

`supabase/functions/relatorio-pedidos-parados/relatorio.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarRelatorio, lerTodasPaginas, ocultarSegredo, validarEmails } from "./relatorio.ts";
import type { Deps, Mensagem, RegistroEnvio } from "./relatorio.ts";
import type { Linha } from "./regras.ts";

const LINHA: Linha = {
  numero_pedido: "1001", usuario: "FULANO DE TAL", etapa: "ANTIFRAUDE (NEOCRM)", cadastro: "2026-10-01T12:00:00-03:00",
  atualizacao: "2026-10-05T10:00:00-03:00", valor: 100, quantidade: 1, produto: "Plano A", cliente: "Empresa Teste",
  cnpj: "01234567000189", na_etapa_desde: "2026-10-05T10:00:00-03:00", operacao: "apex",
};

function fakes(o: Partial<Deps> = {}) {
  const enviados: Mensagem[] = [];
  const registros: RegistroEnvio[] = [];
  const chamadas = { planilha: 0, destinatarios: 0, jaEnviou: 0 };
  const deps: Deps = {
    agora: () => new Date("2026-10-14T11:00:00Z"), // quarta, 08:00 SP
    lerDestinatarios: async () => { chamadas.destinatarios++; return { para: ["executiva@exemplo.com"], cc: [], ativo: true }; },
    jaEnviouHoje: async () => { chamadas.jaEnviou++; return false; },
    lerLinhas: async () => [LINHA],
    ultimaSincronizacao: async () => new Date("2026-10-14T10:59:00Z"),
    gerarPlanilha: async () => { chamadas.planilha++; return new Uint8Array([0x50, 0x4b]); },
    enviar: async (m) => { enviados.push(m); },
    registrar: async (r) => { registros.push(r); },
    ...o,
  };
  return { deps, enviados, registros, chamadas };
}

test("envio agendado normal: envia com anexo e registra 'enviado'", async () => {
  const f = fakes();
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "enviado");
  assert.equal(r.qtd_pedidos, 1);
  assert.equal(r.data_ref, "2026-10-14");
  assert.deepEqual(r.destinatarios, ["executiva@exemplo.com"]);
  assert.equal(f.enviados.length, 1);
  assert.deepEqual(f.enviados[0].para, ["executiva@exemplo.com"]);
  assert.equal(f.enviados[0].anexo?.nome, "PedidosParados_2026-10-14.xlsx");
  assert.match(f.enviados[0].assunto, /^Pedidos parados/);
  assert.deepEqual(f.registros, [r]);
});
test("agendado em feriado de dia útil (02/11/2026, segunda): pulado, nada enviado", async () => {
  const f = fakes({ agora: () => new Date("2026-11-02T11:00:00Z") });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "pulado");
  assert.match(r.motivo!, /feriado/);
  assert.equal(f.enviados.length, 0);
  assert.equal(f.registros.length, 1);
});
test("teste em feriado: envia só para os endereços do body, com [TESTE], sem ler destinatários nem duplicidade", async () => {
  const f = fakes({ agora: () => new Date("2026-11-02T11:00:00Z") });
  const r = await executarRelatorio(f.deps, { modo: "teste", paraTeste: [" rafael@exemplo.com "] });
  assert.equal(r.status, "enviado");
  assert.equal(r.modo, "teste");
  assert.deepEqual(f.enviados[0].para, ["rafael@exemplo.com"]);
  assert.deepEqual(f.enviados[0].cc, []);
  assert.match(f.enviados[0].assunto, /^\[TESTE\]/);
  assert.equal(f.chamadas.destinatarios, 0);
  assert.equal(f.chamadas.jaEnviou, 0);
});
test("teste sem endereço válido: erro, nada enviado", async () => {
  for (const paraTeste of [undefined, [], ["sem-arroba"], "rafael@exemplo.com"]) {
    const f = fakes();
    const r = await executarRelatorio(f.deps, { modo: "teste", paraTeste });
    assert.equal(r.status, "erro", JSON.stringify(paraTeste));
    assert.equal(f.enviados.length, 0);
  }
});
test("já enviado hoje: agendado pula; reenviar envia mesmo assim", async () => {
  const a = fakes({ jaEnviouHoje: async () => true });
  const r1 = await executarRelatorio(a.deps, { modo: "agendado" });
  assert.equal(r1.status, "pulado");
  assert.match(r1.motivo!, /já enviado/);
  assert.equal(a.enviados.length, 0);
  const b = fakes({ jaEnviouHoje: async () => true });
  const r2 = await executarRelatorio(b.deps, { modo: "reenviar" });
  assert.equal(r2.status, "enviado");
  assert.equal(b.enviados.length, 1);
});
test("sem destinatário cadastrado ou lista vazia: erro", async () => {
  for (const d of [null, { para: [], cc: [], ativo: true }]) {
    const f = fakes({ lerDestinatarios: async () => d });
    const r = await executarRelatorio(f.deps, { modo: "agendado" });
    assert.equal(r.status, "erro");
    assert.match(r.motivo!, /sem destinatário/);
    assert.equal(f.enviados.length, 0);
  }
});
test("destinatários inativos: pulado (envio pausado)", async () => {
  const f = fakes({ lerDestinatarios: async () => ({ para: ["executiva@exemplo.com"], cc: [], ativo: false }) });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "pulado");
  assert.match(r.motivo!, /pausado/);
});
test("cópia (cc) vai junto e entra na lista de destinatários do log", async () => {
  const f = fakes({ lerDestinatarios: async () => ({ para: ["a@exemplo.com"], cc: ["b@exemplo.com"], ativo: true }) });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.deepEqual(f.enviados[0].cc, ["b@exemplo.com"]);
  assert.deepEqual(r.destinatarios, ["a@exemplo.com", "b@exemplo.com"]);
});
test("falha ao ler a configuração: erro registrado (não estoura)", async () => {
  const f = fakes({ lerDestinatarios: async () => { throw new Error("banco fora"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.erro!, /banco fora/);
  assert.equal(f.registros.length, 1);
});
test("falha ao ler os pedidos: erro, nada enviado (nunca um Excel vazio por engano)", async () => {
  const f = fakes({ lerLinhas: async () => { throw new Error("timeout"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /ler os pedidos/);
  assert.equal(f.enviados.length, 0);
});
test("falha ao gerar a planilha: erro, nada enviado", async () => {
  const f = fakes({ gerarPlanilha: async () => { throw new Error("exceljs quebrou"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /planilha/);
  assert.equal(f.enviados.length, 0);
});
test("SMTP falha: erro registrado com a mensagem", async () => {
  const f = fakes({ enviar: async () => { throw new Error("535 authentication failed"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /SMTP/);
  assert.match(r.erro!, /535/);
  assert.equal(f.registros.length, 1);
});
test("sem pedidos parados: envia sem anexo e sem gerar planilha", async () => {
  const f = fakes({ lerLinhas: async () => [] });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "enviado");
  assert.equal(r.qtd_pedidos, 0);
  assert.equal(f.enviados[0].anexo, null);
  assert.equal(f.chamadas.planilha, 0);
});

test("lerTodasPaginas: junta páginas até vir uma incompleta", async () => {
  const pedidos: Array<[number, number]> = [];
  const r = await lerTodasPaginas(async (de, ate) => {
    pedidos.push([de, ate]);
    return de < 2000 ? Array(1000).fill(0) : Array(5).fill(0);
  });
  assert.equal(r.length, 2005);
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});
test("lerTodasPaginas: página exata de 1000 seguida de vazia", async () => {
  let n = 0;
  const r = await lerTodasPaginas(async () => (n++ === 0 ? Array(1000).fill(0) : []));
  assert.equal(r.length, 1000);
  assert.equal(n, 2);
});
test("validarEmails", () => {
  assert.deepEqual(validarEmails([" a@exemplo.com ", "b@exemplo.com"]), ["a@exemplo.com", "b@exemplo.com"]);
  assert.equal(validarEmails([]), null);
  assert.equal(validarEmails(["x"]), null);
  assert.equal(validarEmails("a@exemplo.com"), null);
  assert.equal(validarEmails(Array(11).fill("a@exemplo.com")), null);
});
test("ocultarSegredo troca a senha por ***", () => {
  assert.equal(ocultarSegredo("falhou com senha S3nh@ no login", "S3nh@"), "falhou com senha *** no login");
  assert.equal(ocultarSegredo("sem segredo", undefined), "sem segredo");
  assert.equal(ocultarSegredo("sem segredo", ""), "sem segredo");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/relatorio.test.ts"`
Expected: FAIL, com `Cannot find module ... relatorio.ts`.

- [ ] **Step 3: Implementar `relatorio.ts`**

```ts
// Orquestração do relatório diário de pedidos parados (spec §2, §5 e §6). Tudo o que fala com o mundo chega
// por Deps, para testar sem banco nem SMTP. Toda execução grava exatamente um registro no log.
import { diaSp, ehDiaUtil, montarPedidos, resumir } from "./regras.ts";
import type { Linha, Pedido } from "./regras.ts";
import { nomeArquivo } from "./planilha.ts";
import type { InfoPlanilha } from "./planilha.ts";
import { montarEmail } from "./email.ts";

export type Modo = "agendado" | "teste" | "reenviar";
export const MODOS: Modo[] = ["agendado", "teste", "reenviar"];
export interface Destinatarios { para: string[]; cc: string[]; ativo: boolean }
export interface Mensagem {
  para: string[]; cc: string[]; assunto: string; html: string; texto: string;
  anexo: { nome: string; bytes: Uint8Array } | null;
}
export interface RegistroEnvio {
  modo: Modo; data_ref: string; status: "enviado" | "pulado" | "erro"; motivo: string | null;
  qtd_pedidos: number | null; destinatarios: string[]; erro: string | null;
}
export interface Deps {
  agora(): Date;
  lerDestinatarios(): Promise<Destinatarios | null>;
  jaEnviouHoje(diaRef: string): Promise<boolean>;
  lerLinhas(): Promise<Linha[]>;
  ultimaSincronizacao(): Promise<Date | null>;
  gerarPlanilha(pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array>;
  enviar(m: Mensagem): Promise<void>;
  registrar(r: RegistroEnvio): Promise<void>;
}
export interface Opcoes { modo: Modo; paraTeste?: unknown }

const MAX_ENDERECOS_TESTE = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function validarEmails(lista: unknown): string[] | null {
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_ENDERECOS_TESTE) return null;
  const limpos = lista.map((x) => (typeof x === "string" ? x.trim() : ""));
  return limpos.every((x) => EMAIL_RE.test(x)) ? limpos : null;
}

export function ocultarSegredo(texto: string, segredo: string | undefined): string {
  return segredo ? texto.split(segredo).join("***") : texto;
}

export const TAMANHO_PAGINA = 1000;
const MAX_PAGINAS = 100;
export async function lerTodasPaginas<T>(buscar: (de: number, ate: number) => Promise<T[]>, tamanho = TAMANHO_PAGINA): Promise<T[]> {
  const todas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * tamanho;
    const lote = await buscar(de, de + tamanho - 1);
    todas.push(...lote);
    if (lote.length < tamanho) return todas;
  }
  throw new Error(`leitura passou de ${MAX_PAGINAS} páginas — algo errado na consulta`);
}

export async function executarRelatorio(deps: Deps, op: Opcoes): Promise<RegistroEnvio> {
  const agora = deps.agora();
  const diaRef = diaSp(agora)!;
  const fim = async (r: Omit<RegistroEnvio, "modo" | "data_ref">): Promise<RegistroEnvio> => {
    const reg: RegistroEnvio = { modo: op.modo, data_ref: diaRef, ...r };
    await deps.registrar(reg);
    return reg;
  };
  const pulado = (motivo: string, destinatarios: string[] = []) =>
    fim({ status: "pulado", motivo, qtd_pedidos: null, destinatarios, erro: null });
  const erro = (motivo: string, msg: string, destinatarios: string[] = []) =>
    fim({ status: "erro", motivo, qtd_pedidos: null, destinatarios, erro: msg });

  if (op.modo !== "teste" && !ehDiaUtil(diaRef)) return pulado("feriado ou fim de semana");

  let para: string[];
  let cc: string[] = [];
  if (op.modo === "teste") {
    const lista = validarEmails(op.paraTeste);
    if (!lista) return erro("modo teste sem endereço válido", `informe "para" com 1 a ${MAX_ENDERECOS_TESTE} e-mails válidos`);
    para = lista;
  } else {
    let d: Destinatarios | null;
    try { d = await deps.lerDestinatarios(); } catch (e) { return erro("falha ao ler a configuração", mensagem(e)); }
    if (!d || d.para.length === 0) return erro("sem destinatário", "cadastre os destinatários em relatorio_destinatarios");
    if (!d.ativo) return pulado("envio pausado (ativo = false)", [...d.para, ...d.cc]);
    para = d.para;
    cc = d.cc;
    if (op.modo === "agendado") {
      let ja: boolean;
      try { ja = await deps.jaEnviouHoje(diaRef); } catch (e) { return erro("falha ao ler a configuração", mensagem(e), [...para, ...cc]); }
      if (ja) return pulado("já enviado hoje", [...para, ...cc]);
    }
  }
  const todos = [...para, ...cc];

  let linhas: Linha[];
  let sincronizadoEm: Date | null;
  try {
    [linhas, sincronizadoEm] = await Promise.all([deps.lerLinhas(), deps.ultimaSincronizacao()]);
  } catch (e) {
    return erro("falha ao ler os pedidos", mensagem(e), todos);
  }

  const pedidos = montarPedidos(linhas, diaRef);
  let anexo: Mensagem["anexo"] = null;
  if (pedidos.length > 0) {
    try {
      anexo = { nome: nomeArquivo(diaRef), bytes: await deps.gerarPlanilha(pedidos, { diaRef, sincronizadoEm }) };
    } catch (e) {
      return erro("falha ao gerar a planilha", mensagem(e), todos);
    }
  }

  const email = montarEmail({ diaRef, resumo: resumir(pedidos), sincronizadoEm, agora, teste: op.modo === "teste" });
  try {
    await deps.enviar({ para, cc, ...email, anexo });
  } catch (e) {
    return erro("falha no envio (SMTP)", mensagem(e), todos);
  }
  return fim({ status: "enviado", motivo: null, qtd_pedidos: pedidos.length, destinatarios: todos, erro: null });
}
```

- [ ] **Step 4: Rodar todos os testes da função**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"`
Expected: PASS nos quatro arquivos, com 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/relatorio-pedidos-parados/relatorio.ts supabase/functions/relatorio-pedidos-parados/relatorio.test.ts
git commit -m "feat(relatorio-parados): orquestracao (feriado, destinatarios, duplicidade, envio, log)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Banco — tabelas, função SQL e job do cron

**Files:**
- Create: `supabase/migrations/20261013100000_relatorio_pedidos_parados.sql`
- Create: `supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql`
- Create: `supabase/tests/relatorio_pedidos_parados_check.sql`

**Interfaces:**
- Consumes (já existem no banco):
  - `public.producao_pedidos_neo`;
  - `public.producao_na_etapa_desde(text, text, timestamptz)` (§76);
  - `public.consultor_neo(profile_id, neo_usuario_id)`;
  - `public.profiles(id, operacao)`;
  - `public.get_my_role()`;
  - o segredo `sync_producao_cron_secret` no Vault.
- Produces (usado na Tarefa 7):
  - `public.relatorio_pedidos_parados_linhas()`, que devolve as colunas `numero_pedido`, `usuario`, `etapa`,
    `cadastro`, `atualizacao`, `valor`, `quantidade`, `produto`, `cliente`, `cnpj`, `na_etapa_desde`, `operacao`
    (os mesmos nomes da `Linha`);
  - a tabela `public.relatorio_destinatarios(relatorio pk, para text[], cc text[], ativo, atualizado_em)`;
  - a tabela `public.relatorio_envio_log(id, relatorio, modo, executado_em, data_ref, status, motivo, qtd_pedidos, destinatarios, erro)`;
  - o job do cron `relatorio-pedidos-parados`.

- [ ] **Step 1: Escrever a migration**

`supabase/migrations/20261013100000_relatorio_pedidos_parados.sql`:

```sql
-- 13/10/2026 — Relatório diário de pedidos parados (Antifraude e Entrega) por e-mail. REGRAS_NEGOCIO.md §81.
-- Spec: docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md (§5). Aditiva e idempotente.
-- Rollback: supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql.
-- Verificação: supabase/tests/relatorio_pedidos_parados_check.sql.
-- Destinatários NÃO entram aqui (repositório público): são gravados direto no banco.

-- 1) Destinatários por relatório. Só admin lê/grava (a `config` é legível por qualquer usuário logado).
create table if not exists public.relatorio_destinatarios (
  relatorio     text primary key,
  para          text[] not null default '{}',
  cc            text[] not null default '{}',
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.relatorio_destinatarios enable row level security;
drop policy if exists relatorio_destinatarios_admin on public.relatorio_destinatarios;
create policy relatorio_destinatarios_admin on public.relatorio_destinatarios
  for all using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');

-- 2) Log: uma linha por execução da Edge Function. Só admin lê; só a função (service role) grava.
create table if not exists public.relatorio_envio_log (
  id            bigint generated always as identity primary key,
  relatorio     text not null,
  modo          text not null check (modo in ('agendado', 'teste', 'reenviar')),
  executado_em  timestamptz not null default now(),
  data_ref      date not null,
  status        text not null check (status in ('enviado', 'pulado', 'erro')),
  motivo        text,
  qtd_pedidos   integer,
  destinatarios text[] not null default '{}',
  erro          text
);
create index if not exists relatorio_envio_log_rel_dia on public.relatorio_envio_log (relatorio, data_ref);
alter table public.relatorio_envio_log enable row level security;
drop policy if exists relatorio_envio_log_admin_le on public.relatorio_envio_log;
create policy relatorio_envio_log_admin_le on public.relatorio_envio_log
  for select using (public.get_my_role() = 'admin');

-- 3) Linhas (itens) dos pedidos em ANTIFRAUDE e ENTREGA, com "na etapa desde" e a operação do vendedor
--    (sem vínculo = apex, §78). Só a Edge Function (service_role) executa.
create or replace function public.relatorio_pedidos_parados_linhas()
returns table (numero_pedido text, usuario text, etapa text, cadastro timestamptz, atualizacao timestamptz,
               valor numeric, quantidade numeric, produto text, cliente text, cnpj text,
               na_etapa_desde timestamptz, operacao text)
language sql stable security definer set search_path = public as $$
  select n.numero_pedido, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade, n.produto,
         n.cliente, n.cnpj,
         public.producao_na_etapa_desde(n.numero_pedido, n.etapa, n.atualizacao),
         coalesce(p.operacao, 'apex')
    from public.producao_pedidos_neo n
    left join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
    left join public.profiles p on p.id = c.profile_id
   where n.etapa in ('ANTIFRAUDE (NEOCRM)', 'ENTREGA (NEOCRM)')
   order by n.numero_pedido, n.item_id;
$$;
revoke all on function public.relatorio_pedidos_parados_linhas() from public, anon, authenticated;
grant execute on function public.relatorio_pedidos_parados_linhas() to service_role;

-- 4) Agenda: seg–sex 11:00 UTC = 08:00 São Paulo (sem horário de verão). O segredo é lido do Vault.
select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';
select cron.schedule('relatorio-pedidos-parados', '0 11 * * 1-5', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/relatorio-pedidos-parados',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"modo":"agendado"}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
```

- [ ] **Step 2: Escrever o rollback e a conferência**

`supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql`:

```sql
-- Desfaz 20261013100000_relatorio_pedidos_parados.sql (apaga destinatários e histórico de envios).
select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';
drop function if exists public.relatorio_pedidos_parados_linhas();
drop table if exists public.relatorio_envio_log;
drop table if exists public.relatorio_destinatarios;
```

`supabase/tests/relatorio_pedidos_parados_check.sql`:

```sql
-- Conferência (só leitura) da migration 20261013100000_relatorio_pedidos_parados.
select 'pedidos' as item, count(distinct numero_pedido)::text as valor from public.relatorio_pedidos_parados_linhas()
union all select 'linhas', count(*)::text from public.relatorio_pedidos_parados_linhas()
union all select 'etapas fora do esperado', count(*)::text from public.relatorio_pedidos_parados_linhas()
  where etapa not in ('ANTIFRAUDE (NEOCRM)', 'ENTREGA (NEOCRM)')
union all select 'sem na_etapa_desde', count(*)::text from public.relatorio_pedidos_parados_linhas() where na_etapa_desde is null
union all select 'linhas de Campinas', count(*)::text from public.relatorio_pedidos_parados_linhas() where operacao = 'campinas'
union all select 'agenda do job', (select schedule from cron.job where jobname = 'relatorio-pedidos-parados')
union all select 'anon executa?', has_function_privilege('anon', 'public.relatorio_pedidos_parados_linhas()', 'execute')::text
union all select 'authenticated executa?', has_function_privilege('authenticated', 'public.relatorio_pedidos_parados_linhas()', 'execute')::text
union all select 'RLS destinatários', (select relrowsecurity::text from pg_class where oid = 'public.relatorio_destinatarios'::regclass)
union all select 'RLS log', (select relrowsecurity::text from pg_class where oid = 'public.relatorio_envio_log'::regclass);
```

- [ ] **Step 3: Aplicar a migration no Supabase `apex`**

Use a ferramenta MCP `apply_migration` do Supabase, com `project_id: mdgfboijyqfkggcrhptn`,
`name: relatorio_pedidos_parados` e o conteúdo do Step 1.

Se a aplicação for bloqueada na sessão, entregue o arquivo ao Rafael para rodar no SQL Editor do Supabase e espere a
confirmação dele.

Expected: sucesso.

- [ ] **Step 4: Rodar a conferência**

Rode `supabase/tests/relatorio_pedidos_parados_check.sql` com `execute_sql`.

Expected:
- `pedidos` perto de 105 (o número muda com o dia);
- `etapas fora do esperado` = `0`;
- `agenda do job` = `0 11 * * 1-5`;
- `anon executa?` = `false`;
- `authenticated executa?` = `false`;
- `RLS destinatários` = `true`;
- `RLS log` = `true`.

`sem na_etapa_desde` pode ser maior que 0: são pedidos sem histórico e sem ATUALIZACAO, que a regra trata.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261013100000_relatorio_pedidos_parados.sql supabase/rollback/20261013100000_relatorio_pedidos_parados_rollback.sql supabase/tests/relatorio_pedidos_parados_check.sql
git commit -m "feat(relatorio-parados): tabelas de destinatarios e log, funcao de leitura e job pg_cron 08h seg-sex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Função definitiva (`index.ts`), publicação e envio de teste

**Files:**
- Modify (substitui a sonda inteira): `supabase/functions/relatorio-pedidos-parados/index.ts`

**Interfaces:**
- Consumes:
  - `executarRelatorio`, `lerTodasPaginas`, `ocultarSegredo`, `MODOS` e os tipos `Deps` e `Modo`, de `relatorio.ts`;
  - `gerarPlanilha`, de `planilha.ts`;
  - o tipo `Linha`, de `regras.ts`;
  - as tabelas e a função SQL da Tarefa 6.
- Produces: o endpoint `POST /functions/v1/relatorio-pedidos-parados`. Body:
  `{"modo":"agendado"|"teste"|"reenviar","para"?:string[]}`. Resposta: 200 com o `RegistroEnvio`, 502 se o
  status for `erro` e 401 sem o segredo.

- [ ] **Step 1: Escrever `index.ts`**

```ts
// Edge Function: relatorio-pedidos-parados — e-mail diário (seg–sex 08:00 SP) com o Excel dos pedidos parados em
// Antifraude e Entrega para a executiva da Claro. REGRAS_NEGOCIO.md §81; spec
// docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md.
// Chamada pelo pg_cron (header x-cron-secret = SYNC_CRON_SECRET), sem JWT.
// Body: {"modo":"agendado"} (padrão) | {"modo":"teste","para":["..."]} | {"modo":"reenviar"}.
// Secrets: SMTP_USER e SMTP_PASS (obrigatórios); SMTP_HOST e SMTP_PORT (opcionais; padrão smtp.hostinger.com:465).
// Publicar: npx supabase functions deploy relatorio-pedidos-parados --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { MODOS, executarRelatorio, lerTodasPaginas, ocultarSegredo } from "./relatorio.ts";
import type { Deps, Modo } from "./relatorio.ts";
import { gerarPlanilha } from "./planilha.ts";
import type { Linha } from "./regras.ts";

const RELATORIO = "pedidos_parados";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function criarDeps(): Deps {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const smtpUser = env("SMTP_USER");
  const smtpPass = env("SMTP_PASS");
  const falha = (ctx: string, error: { message: string } | null) => { if (error) throw new Error(`${ctx}: ${error.message}`); };

  return {
    agora: () => new Date(),
    async lerDestinatarios() {
      const { data, error } = await sb.from("relatorio_destinatarios").select("para, cc, ativo")
        .eq("relatorio", RELATORIO).maybeSingle();
      falha("ler destinatários", error);
      return data ? { para: data.para ?? [], cc: data.cc ?? [], ativo: data.ativo !== false } : null;
    },
    async jaEnviouHoje(diaRef) {
      const { count, error } = await sb.from("relatorio_envio_log").select("id", { count: "exact", head: true })
        .eq("relatorio", RELATORIO).eq("data_ref", diaRef).eq("status", "enviado").neq("modo", "teste");
      falha("ler envios de hoje", error);
      return (count ?? 0) > 0;
    },
    lerLinhas: () => lerTodasPaginas<Linha>(async (de, ate) => {
      const { data, error } = await sb.rpc("relatorio_pedidos_parados_linhas").range(de, ate);
      falha("ler pedidos", error);
      return (data ?? []) as Linha[];
    }),
    async ultimaSincronizacao() {
      const { data, error } = await sb.from("config").select("atualizado_em")
        .eq("chave", "producao_neo_atualizado_em").maybeSingle();
      falha("ler última sincronização", error);
      return data?.atualizado_em ? new Date(data.atualizado_em) : null;
    },
    gerarPlanilha: (pedidos, info) => gerarPlanilha(ExcelJS, pedidos, info),
    async enviar(m) {
      const client = new SMTPClient({
        connection: {
          hostname: Deno.env.get("SMTP_HOST") || "smtp.hostinger.com",
          port: Number(Deno.env.get("SMTP_PORT") || 465),
          tls: true,
          auth: { username: smtpUser, password: smtpPass },
        },
      });
      try {
        await client.send({
          from: `Apex Smart Solutions <${smtpUser}>`,
          to: m.para,
          ...(m.cc.length ? { cc: m.cc } : {}),
          subject: m.assunto,
          content: m.texto,
          html: m.html,
          attachments: m.anexo
            ? [{ filename: m.anexo.nome, content: m.anexo.bytes, encoding: "binary", contentType: XLSX_MIME }]
            : [],
        });
      } catch (e) {
        throw new Error(ocultarSegredo((e as Error).message, smtpPass));
      } finally {
        try { await client.close(); } catch { /* a conexão já pode ter caído */ }
      }
    },
    async registrar(r) {
      const { error } = await sb.from("relatorio_envio_log").insert({ relatorio: RELATORIO, ...r });
      falha("gravar log", error);
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!iguais(req.headers.get("x-cron-secret") ?? "", env("SYNC_CRON_SECRET"))) return json({ error: "Não autorizado" }, 401);

  let corpo: { modo?: unknown; para?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio = agendado */ }
  const modo = (corpo.modo ?? "agendado") as Modo;
  if (!MODOS.includes(modo)) return json({ error: `modo inválido: ${String(corpo.modo)}` }, 400);

  try {
    const r = await executarRelatorio(criarDeps(), { modo, paraTeste: corpo.para });
    console.log(JSON.stringify({ ...r, destinatarios: r.destinatarios.length }));
    return json(r, r.status === "erro" ? 502 : 200);
  } catch (e) {
    const msg = ocultarSegredo((e as Error).message, Deno.env.get("SMTP_PASS"));
    console.error("relatorio-pedidos-parados falhou:", msg);
    return json({ error: msg }, 500);
  }
});
```

- [ ] **Step 2: Rodar os testes de novo (nada quebrou)**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"`
Expected: PASS, com 0 falhas.

- [ ] **Step 3: Publicar a função e gravar `SMTP_USER`**

Run:
`npx supabase functions deploy relatorio-pedidos-parados --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`

Se a CLI não estiver autenticada, use a ferramenta MCP `deploy_edge_function` com `verify_jwt: false` e os cinco
arquivos `.ts` que não são de teste.

Depois grave o secret:
`npx supabase secrets set SMTP_USER=corporativo@apexsmart.com.br --project-ref mdgfboijyqfkggcrhptn`
(ou pela ferramenta MCP `create_edge_function_secret`).

Expected: publicação e secret com sucesso.

- [ ] **Step 4: Rafael grava a senha (passo dele, sem o Claude ver)**

Peça ao Rafael, sem pedir que cole a senha no chat:

> No Supabase, abra o projeto **apex** → **Edge Functions** → **Secrets** → **Add new secret**.
> Nome: `SMTP_PASS`. Valor: a senha da caixa `corporativo@apexsmart.com.br`. Salve e me avise.

Espere a confirmação dele antes do próximo passo.

- [ ] **Step 5: Envio de teste para o e-mail do Rafael**

Use `execute_sql`. O endereço aparece só nesta consulta, nunca num arquivo:

```sql
select net.http_post(
  url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/relatorio-pedidos-parados',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
  body := jsonb_build_object('modo','teste','para', jsonb_build_array('<e-mail do Rafael informado na conversa>')),
  timeout_milliseconds := 60000) as id;
```

Uns 20 segundos depois:

```sql
select status_code, content::text from net._http_response where id = <id>;
select modo, status, motivo, qtd_pedidos, erro from public.relatorio_envio_log order by id desc limit 1;
```

Expected: `status_code = 200`, e o log com `modo = teste`, `status = enviado` e `qtd_pedidos` perto de 105.

**Se vier `erro`:**
- `535`/`authentication`: senha errada; peça ao Rafael para conferir o `SMTP_PASS`.
- erro de conexão: confira host e porta.
- Corrija e repita o passo.

- [ ] **Step 6: Rafael confere o e-mail e o Excel (portão humano)**

Peça ao Rafael para abrir o e-mail `[TESTE] Pedidos parados…` (conferir também a caixa de spam) e o anexo, e confirmar:
- as cores;
- o filtro;
- as colunas;
- a coluna Retorno;
- a aba Resumo.

**Não siga para a Tarefa 8 sem o "aprovado" dele.** Ajustes pedidos voltam para a tarefa dona do código (layout =
Tarefa 3, texto = Tarefa 4), com teste, commit e um novo envio de teste.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/relatorio-pedidos-parados/index.ts
git commit -m "feat(relatorio-parados): Edge Function definitiva (Supabase, ExcelJS, SMTP Hostinger)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Ligar para a executiva, documentar e publicar no repositório oficial

**Files:**
- Modify: `REGRAS_NEGOCIO.md`, com uma seção nova no fim. Use o próximo número livre (81 se ninguém tiver usado).

**Interfaces:**
- Consumes: tudo o que foi feito acima e o "aprovado" do Rafael na Tarefa 7.
- Produces: o envio automático ligado e a documentação no `main` oficial.

- [ ] **Step 1: Cadastrar a executiva como destinatária**

Use `execute_sql`. O endereço é o informado pelo Rafael na conversa e nunca entra num arquivo:

```sql
insert into public.relatorio_destinatarios (relatorio, para, cc, ativo)
values ('pedidos_parados', array['<e-mail da executiva informado na conversa>'], '{}', true)
on conflict (relatorio) do update set para = excluded.para, cc = excluded.cc, ativo = true, atualizado_em = now();
select relatorio, array_length(para, 1) as qtd_para, ativo from public.relatorio_destinatarios;
```

Expected: uma linha `pedidos_parados`, com `qtd_para = 1` e `ativo = true`.

- [ ] **Step 2: Escrever a seção do REGRAS_NEGOCIO.md**

Antes, rode `git fetch oficial && git show oficial/main:REGRAS_NEGOCIO.md | grep -n "^## 8"` para descobrir o próximo
número livre. Depois acrescente no fim do arquivo (trocando `81` se for preciso):

```markdown
## 81. E-mail diário dos pedidos parados (Antifraude e Entrega) para a executiva da Claro (13/10/2026)

Pedido do Rafael: todo dia útil de manhã, a executiva da Claro que acompanha a operação recebe por e-mail um Excel com **todos os pedidos parados em Antifraude e Entrega**, com a criticidade de cada um, para conferir o status e repassar ao back office. Spec: `docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md`; plano: `docs/superpowers/plans/2026-10-13-relatorio-pedidos-parados-email.md`.

- **Quando:** seg–sex às 08:00 de São Paulo (`pg_cron` `relatorio-pedidos-parados`, `0 11 * * 1-5` UTC). Feriado nacional não envia (registra "pulado").
- **De/para:**
  - sai de `corporativo@apexsmart.com.br` (SMTP Hostinger, 465/TLS), com o nome "Apex Smart Solutions";
  - os destinatários ficam na tabela `relatorio_destinatarios` (só admin lê). **Não** ficam na `config`, que qualquer usuário logado lê, e nunca entram no repositório.
- **Quais pedidos:**
  - todos em `ANTIFRAUDE (NEOCRM)` e `ENTREGA (NEOCRM)` na hora do envio, sem corte de data, Apex e Campinas (coluna Operação);
  - uma linha por pedido, como na §48.2.
- **Dias parados:**
  - dias úteis desde a **entrada na etapa atual** (`producao_na_etapa_desde`, §76; sem histórico, a ATUALIZACAO) até o dia do envio;
  - **Baixa 0–3 · Média 4–6 · Alta 7+**. São faixas próprias do e-mail: a aba Pedidos em Alerta continua com 3–5 / 6–9 / 10+.
- **Carnaval:** a função conta segunda e terça (Páscoa − 48/− 47). O painel usa − 47/− 46 (terça e Quarta de Cinzas), erro a corrigir à parte.
- **Excel `PedidosParados_AAAA-MM-DD.xlsx`:**
  - aba "Pedidos Parados", colorida por criticidade, com filtro, cabeçalho congelado e a coluna **Retorno** em branco para a executiva preencher. É dela que sairão as categorias para o back office (próxima fase);
  - aba "Resumo" (Etapa × Criticidade).
- **Corpo do e-mail:** só contagens. Avisa se a última sincronização com o NeoCRM tiver mais de 3 h. Sem pedidos, sai sem anexo.
- **Código:** Edge Function `supabase/functions/relatorio-pedidos-parados/` (`regras.ts`, `planilha.ts`, `email.ts`, `relatorio.ts`, `index.ts`); testes `node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"`.
- **Banco:**
  - migration `20261013100000_relatorio_pedidos_parados.sql`: tabelas `relatorio_destinatarios` e `relatorio_envio_log`, função `relatorio_pedidos_parados_linhas()` (só `service_role`) e o job;
  - rollback em `supabase/rollback/`; conferência em `supabase/tests/relatorio_pedidos_parados_check.sql`.
- **Segredos (Edge Function):**
  - `SMTP_USER` e `SMTP_PASS`. O Rafael grava a senha no painel do Supabase; ela nunca aparece em conversa nem em arquivo;
  - o cron reaproveita `SYNC_CRON_SECRET` / `sync_producao_cron_secret`.
- **Acompanhar:** `select * from relatorio_envio_log order by id desc;`. Um envio por dia (`enviado`); duplicidade vira `pulado`.
- **Reenviar no mesmo dia:** chamar a função com `{"modo":"reenviar"}` (mesmo `net.http_post` do cron, trocando o body).
- **Teste para outro e-mail:** `{"modo":"teste","para":["..."]}` (assunto com `[TESTE]`).
- **Pausar:** `update relatorio_destinatarios set ativo = false where relatorio = 'pedidos_parados';`.
- **Desligar:** `select cron.unschedule(jobid) from cron.job where jobname = 'relatorio-pedidos-parados';`.
- **Trocar destinatário:** `update relatorio_destinatarios set para = array['novo@...'] where relatorio = 'pedidos_parados';`.
- **Entrada no ar:** envio de teste aprovado pelo Rafael em <data/hora do aprovado>; destinatário real cadastrado em <data/hora do Step 1>; primeiro envio automático em <próximo dia útil> às 08:00.
- **Fora de escopo (por ora):** categorias de retorno, leitura da planilha devolvida, tela no painel para destinatários/log, aviso de falha por Telegram, outras etapas.
```

Substitua os três `<...>` da linha "Entrada no ar" pelas datas reais antes do commit.

- [ ] **Step 3: Rodar os testes uma última vez**

Run: `node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"`
Expected: PASS, com 0 falhas.

O painel (`_template.html`) não muda nesta feature, então o `run_tests.sh` não precisa rodar. Se rodar, valem só as
falhas antigas conhecidas (`test_conversao_vendas.js` e `test_pedidos_alerta.js`).

- [ ] **Step 4: Commit, juntar com o main oficial e enviar**

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): secao 81 - e-mail diario dos pedidos parados (Antifraude/Entrega)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git fetch oficial
git merge --no-edit oficial/main
node --test "supabase/functions/relatorio-pedidos-parados/*.test.ts"
git push oficial HEAD:main
```

**Se o merge der conflito no `REGRAS_NEGOCIO.md`** (alguém usou o número 81):
1. renumere a seção para o próximo livre;
2. `git add REGRAS_NEGOCIO.md && git commit --no-edit`;
3. teste e faça o push de novo.

Push sem force. Se for recusado porque o main andou, repita `git fetch oficial && git merge --no-edit oficial/main` e o
push.

- [ ] **Step 5: Conferir no primeiro dia útil seguinte**

Depois das 08:00 do primeiro dia útil com a executiva cadastrada:

```sql
select executado_em, modo, status, motivo, qtd_pedidos, erro from public.relatorio_envio_log order by id desc limit 3;
```

Expected: uma linha `agendado` / `enviado` do dia. Avise o Rafael do resultado.
