# §166 Movimentações dos pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar as APIs Movimentação e Atualizações de Pedidos da Xeotech para o Supabase e mostrar no painel a linha do tempo de cada pedido, a aba Movimentações (feed, tempo por etapa) e a auditoria das vendas perdidas.

**Architecture:** Uma Edge Function (`sync-pedidos-neo`, molde da `sync-exportacao`) chamada pelo pg_cron grava o **filme** (`pedido_movimentacoes`, uma linha por passagem em etapa) e o **diário** (`pedido_anotacoes`, só cresce). O painel lê só por RPCs `security definer` que conferem o cargo (`profiles.role`) e a operação. A gaveta é uma `aside.kbFicha` fora das abas, aberta também de dentro do iframe do Dashboard.

**Tech Stack:** Deno (Edge Function) + lógica pura em TS testada com `node --test` (Node 24 tira os tipos); Postgres/pg_cron/pg_net; painel em `_template.html` (JS puro) testado com jsdom pelo `renovacao_test_harness.js`.

**Spec:** `docs/superpowers/specs/2026-11-24-movimentacoes-pedidos-design.md` (commit 0090976)

## Global Constraints

- Repo **público**: nada de token, CPF/CNPJ, telefone, nome de cliente real em código, teste ou log. Dados de teste fictícios com prefixo `ZZ`.
- O token vai na URL: nenhuma mensagem que sai da função pode contê-lo (`ocultarToken`); erro de rede registra só o nome do erro.
- Tabelas novas: **sem** nome do cliente, CNPJ, `complementos`. RLS ligado, **sem policy**. Leitura só por RPC.
- Toda RPC nova: `security definer set search_path = public`, `revoke execute ... from public, anon` (o default do projeto dá execute para `anon`). Funções internas também `revoke ... from authenticated`.
- Cargos: `admin` vê tudo; `supervisor` só a operação dele (`profiles.operacao`); `consultor` só a gaveta dos pedidos com `usuario_id = meu_neo_usuario_id()`; `agencia` nada. Operação do pedido = operação do consultor; sem consultor ligado = `apex`.
- Horários da API são de São Paulo, sem fuso: viram `…-03:00`.
- Guarda da Xeotech: ≥ 120 s entre execuções; agenda fixa: Atualizações `:03 :13 :23 :33 :43 :53` 08–22 h SP e `:03` fora disso; Movimentação `:08 :38`.
- Painel: editar só `_template.html`; `python build_painel.py` gera o painel; nada no bloco de estilo "SISTEMA VISUAL SINAL DE ÁPICE" (seções 1–7); classes existentes (`.filterPill`, `.kpiGrid`, `table.tbl`, `.kbFicha`); cores só por variável; `<div>`/`</div>` balanceados; `_template.html` em LF.
- **Produção:** migration, dry-run com rollback, secret, deploy, cron e publicação só com ok explícito do Rafael **naquele momento**. Commit só depois de mostrar a mensagem. Sem assinatura de IA. Sem push sem ok.
- `REGRAS_NEGOCIO.md`: seção **§166**.

## Review Focus

1. **Dado gravado no NEO um pouco depois do horário dele** — a janela termina 2 min antes de agora, para não perder o que ainda não estava visível (teste em `proximaJanela`, Task 1).
2. **Mesma anotação vista de novo com `dataHoraAtualizacao` nova** (pedido mexido sem nota nova) — não duplica no diário (teste SQL, Task 3).
3. **Passagem que chega aberta e depois fecha; chave repetida na mesma resposta** — vira a mesma linha (dedupe em `linhasFilme`, Task 1; upsert pela chave, Task 2/3).
4. **Falha de rede ou HTTP 200 com erro no corpo** — log `ok=false`, janela não avança, token fora da mensagem (teste em `erroSeguro`/`ocultarToken`, Task 1).
5. **Pedido fora da `producao_pedidos_neo`, ou de outra operação** — admin abre sem cabeçalho; supervisor de outra operação recebe "sem permissão" (SQL Task 3/4, painel Task 9).

## Mudanças do spec decididas no plano (mostrar ao Rafael)

- Diário: além da chave única, só grava se o texto for **diferente da última anotação guardada** do pedido (a API repete a última nota quando o pedido é mexido por outro motivo).
- "Autor provável" só aparece quando houve passagem de etapa entre 10 min antes e 1 min depois da anotação; fora disso fica vazio (evita atribuir errado).
- "Parados agora" conta só a **última** passagem de cada pedido e ignora `CONCLUIDO` e `VENDA PERDIDA`.
- Etapa "de devolução" do 🔁 = `DEVOLVIDO` (no teste de 23/11, 8 de 12 VPs vieram direto dela).
- Na Movimentação a VP chega só como "Movimentado para VENDA PERDIDA": a categoria do consultor vem do diário (Atualizações) ou da `producao_atividades`.
- Carga inicial sem código novo: uma linha "ok" semente no log com `janela_fim = 2026-09-01` faz o cron da Movimentação andar 7 dias por execução (≈ 6,5 h, à noite).
- Aba nova usa `data-tab="movpedidos"` (já existe `movimentacao` = "Upload Dash").

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| Create `supabase/functions/sync-pedidos-neo/pedidos.ts` | lógica pura: janela, corpo da API, limpar/classificar texto, linhas do filme e do diário, erros sem token |
| Create `supabase/functions/sync-pedidos-neo/pedidos.test.ts` | `node --test`, exemplos fictícios |
| Create `supabase/functions/sync-pedidos-neo/index.ts` | HTTP/auth/log/fetch/gravar |
| Create `supabase/migrations/20261124120000_movimentacoes_pedidos.sql` | tabelas, gravação do diário, permissão, RPCs |
| Create `supabase/migrations/20261124120100_movimentacoes_pedidos_cron.sql` | 3 jobs pg_cron |
| Create `supabase/tests/movimentacoes_pedidos_check.sql` | asserts em transação desfeita |
| Modify `_template.html` | botão, painel, gaveta, CSS mínimo, módulo `mp*`, gancho na troca de aba, permissão no login, links no Dashboard (base64 via `dashboard_tpl.py`) |
| Create `test_movpedidos.js` | jsdom: permissão, feed, tempo, VP, gaveta, motivo real |
| Modify `test_vendas_perdidas.js` | um assert do link |
| Modify `REGRAS_NEGOCIO.md` | §166 |

---

### Task 1: Lógica pura da sync (`pedidos.ts`)

**Files:**
- Create: `supabase/functions/sync-pedidos-neo/pedidos.ts`
- Test: `supabase/functions/sync-pedidos-neo/pedidos.test.ts`

**Interfaces:**
- Produces: `type Api = "atualizacoes" | "movimentacao"`; `proximaJanela(api, ultimoFimMs: number|null, agoraMs: number): {ini:number; fim:number} | null`; `corpoDaApi(api, j): Record<string,unknown>`; `limparHtml(s: unknown): string`; `classificar(t: string): Classe | null`; `linhasFilme(dados: Record<string,unknown>[]): LinhaFilme[]`; `linhasAnotacao(dados): LinhaAnotacao[]`; `mensagemErro(status, corpo, retryAfter): string`; `ocultarToken(msg, token): string`; `erroSeguro(e: unknown, token: string): string`.

- [ ] **Step 1: Escrever os testes**

```ts
// supabase/functions/sync-pedidos-neo/pedidos.test.ts — §166. DADOS FICTÍCIOS (repo público).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificar, corpoDaApi, erroSeguro, limparHtml, linhasAnotacao, linhasFilme, ocultarToken, proximaJanela } from "./pedidos.ts";

const H = 3600_000;
const AGORA = Date.parse("2026-11-24T13:00:00Z"); // 10:00 em SP

test("proximaJanela: primeira vez = 1 h até agora−2 min; depois continua do último fim", () => {
  assert.deepEqual(proximaJanela("atualizacoes", null, AGORA), { ini: AGORA - 2 * 60_000 - H, fim: AGORA - 2 * 60_000 });
  const ult = AGORA - 10 * 60_000;
  assert.deepEqual(proximaJanela("atualizacoes", ult, AGORA), { ini: ult, fim: AGORA - 2 * 60_000 });
});

test("proximaJanela: limita a 1 dia (Atualizações) e 7 dias (Movimentação); nada a fazer = null", () => {
  const velho = AGORA - 30 * 24 * H;
  assert.equal(proximaJanela("atualizacoes", velho, AGORA)!.fim, velho + 24 * H);
  assert.equal(proximaJanela("movimentacao", velho, AGORA)!.fim, velho + 7 * 24 * H);
  assert.equal(proximaJanela("movimentacao", AGORA - 60_000, AGORA), null);
});

test("corpoDaApi: formatos diferentes por API, horário de SP", () => {
  const j = { ini: Date.parse("2026-11-24T12:00:00Z"), fim: Date.parse("2026-11-24T12:58:00Z") };
  assert.deepEqual(corpoDaApi("movimentacao", j), { dataHoraInicio: "2026-11-24 09:00:00", dataHoraFim: "2026-11-24 09:58:00", pedidoTipo: "COMERCIAL", formato: "json" });
  assert.deepEqual(corpoDaApi("atualizacoes", j), { dataHoraInicio: "2026-11-24T09:00:00", dataHoraFim: "2026-11-24T09:58:00", formato: "JSON" });
});

test("limparHtml: tira <B>/<BR> e entidades", () => {
  assert.equal(limparHtml("<B>Oi &amp; tchau</B><BR>linha 2<BR>"), "Oi & tchau\nlinha 2");
  assert.equal(limparHtml(null), "");
});

test("classificar: BKO, VP com categoria, categoria sozinha, movimento puro, livre", () => {
  assert.deepEqual(classificar("Status: CONSULTA NÃO APROVADA\n\nDescrição: REPROVADO TESTE"),
    { tipo: "bko_status", status: "CONSULTA NÃO APROVADA", descricao: "REPROVADO TESTE", vp_categoria: null });
  assert.deepEqual(classificar("cliente sumiu\nAlteração TAGS de [x]\n(Venda Perdida)\nCategoria Inserido Não responde"),
    { tipo: "venda_perdida", status: null, descricao: null, vp_categoria: "Não responde" });
  assert.equal(classificar("Categoria Inserido Desistência Demora")!.vp_categoria, "Desistência Demora");
  assert.equal(classificar("Movimentado para NEGOCIACAO"), null);
  assert.equal(classificar(""), null);
  assert.equal(classificar("Caixa postal, 3 tentativas")!.tipo, "livre");
});

const M = (o: Record<string, unknown>) => Object.assign({
  id: "x", pedidoId: 101, etapaId: 7, numeroAtividade: "ZZ101", nomeEtapa: "NEGOCIACAO", usuarioEntrou: "ZZ CONS",
  usuarioSaiu: "", dataHoraEntrou: "2026-11-20T09:00:00", dataHoraSaiu: null, tempo: "00:10:00", slaHoras: 24,
  tagsAtividade: "", movimentacao: "Movimentado para NEGOCIACAO", nomeConsultor: "ZZ CONS", total: 54.99,
  cpfCnpjCliente: "00000000000000", nomeCliente: "ZZ CLIENTE", pedidoTipo: "COMERCIAL",
}, o);

test("linhasFilme: sem dados do cliente, horário SP, dedupe pela chave (fica a última)", () => {
  const l = linhasFilme([M({}), M({ dataHoraSaiu: "2026-11-20T10:00:00", usuarioSaiu: "ZZ BKO" }), M({ pedidoId: null })]);
  assert.equal(l.length, 1);
  assert.equal(l[0].entrou_em, "2026-11-20T09:00:00-03:00");
  assert.equal(l[0].saiu_em, "2026-11-20T10:00:00-03:00");
  assert.equal(l[0].saiu_por, "ZZ BKO");
  assert.equal(l[0].numero_pedido, "ZZ101");
  assert.ok(!JSON.stringify(l[0]).includes("ZZ CLIENTE") && !JSON.stringify(l[0]).includes("00000000000000"));
});

test("linhasAnotacao: uma por pedido (a mais recente), descarta movimento puro, sem dados do cliente", () => {
  const A = (o: Record<string, unknown>) => Object.assign({ numeroAtividade: "ZZ1", cpfCnpjCliente: "0", nomeCliente: "ZZ CLIENTE", nomeEtapa: "CREDITO", dataHoraAtualizacao: "2026-11-23T08:00:00", descricaoUltimaMovimentacao: "" }, o);
  const l = linhasAnotacao([
    A({ descricaoUltimaMovimentacao: "<B>Status: OK</B>", dataHoraAtualizacao: "2026-11-23T08:00:00" }),
    A({ descricaoUltimaMovimentacao: "<B>Status: CONSULTA NÃO APROVADA\n\nDescrição: X</B><BR>", dataHoraAtualizacao: "2026-11-23T09:00:00" }),
    A({ numeroAtividade: "ZZ2", descricaoUltimaMovimentacao: "Movimentado para PEDIDO" }),
  ]);
  assert.equal(l.length, 1);
  assert.equal(l[0].status, "CONSULTA NÃO APROVADA");
  assert.equal(l[0].atualizado_em_neo, "2026-11-23T09:00:00-03:00");
  assert.ok(!JSON.stringify(l).includes("ZZ CLIENTE"));
});

test("erroSeguro/ocultarToken: rede vira só o nome; token some nas duas formas", () => {
  const tok = "ab/c+d";
  const e = new TypeError("error sending request for url (https://x/api/" + encodeURIComponent(tok) + ")");
  assert.equal(erroSeguro(e, tok), "Falha de rede: TypeError");
  assert.equal(erroSeguro(Object.assign(new Error("t"), { name: "TimeoutError" }), tok), "Falha de rede: TimeoutError");
  assert.equal(erroSeguro(new Error("falhou " + tok), tok), "falhou ***");
  assert.equal(ocultarToken("u=" + encodeURIComponent(tok), tok), "u=***");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/sync-pedidos-neo/pedidos.test.ts`
Expected: FAIL (`Cannot find module './pedidos.ts'`).

- [ ] **Step 3: Implementar**

```ts
// Lógica pura da sync-pedidos-neo (APIs Movimentação e Atualizações de Pedidos, Xeotech) — REGRAS_NEGOCIO.md §166.
// Sem Deno/rede/Supabase: testável com `node --test`. Nunca devolve nome/CPF/CNPJ do cliente.
// shortcut: paraTimestampSP/mensagemErro/ocultarToken copiados de ../sync-exportacao/exportacao.ts porque o deploy
// pelo conector envia só esta pasta; juntar num _shared/ se o deploy passar a ser pela CLI.
export type Api = "atualizacoes" | "movimentacao";
export type Classe = { tipo: "bko_status" | "venda_perdida" | "livre"; status: string | null; descricao: string | null; vp_categoria: string | null };
export type LinhaFilme = {
  pedido_id: number; numero_pedido: string; etapa_id: number; etapa: string; entrou_em: string; saiu_em: string | null;
  entrou_por: string | null; saiu_por: string | null; sla_horas: number | null; tempo: string | null; texto: string | null;
  vp_categoria: string | null; consultor: string | null; valor: number | null; tags: string | null;
};
export type LinhaAnotacao = Classe & { numero_pedido: string; atualizado_em_neo: string; texto: string; etapa: string | null };

const H = 3600_000;
const CAP_HORAS: Record<Api, number> = { atualizacoes: 24, movimentacao: 7 * 24 };
const ATRASO_MS = 2 * 60_000; // o NEO pode tornar visível um pouco depois do horário gravado

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}
function numOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
export function paraTimestampSP(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}-03:00` : null;
}

// ultimoFimMs = janela_fim da última execução ok (null = primeira vez: só a última hora).
export function proximaJanela(api: Api, ultimoFimMs: number | null, agoraMs: number): { ini: number; fim: number } | null {
  const limite = agoraMs - ATRASO_MS;
  const ini = ultimoFimMs ?? limite - H;
  const fim = Math.min(limite, ini + CAP_HORAS[api] * H);
  return fim > ini ? { ini, fim } : null;
}
function formatoSP(ms: number, api: Api): string {
  const s = new Date(ms - 3 * H).toISOString().slice(0, 19);
  return api === "movimentacao" ? s.replace("T", " ") : s;
}
export function corpoDaApi(api: Api, j: { ini: number; fim: number }): Record<string, unknown> {
  const base = { dataHoraInicio: formatoSP(j.ini, api), dataHoraFim: formatoSP(j.fim, api) };
  return api === "movimentacao" ? { ...base, pedidoTipo: "COMERCIAL", formato: "json" } : { ...base, formato: "JSON" };
}

export function limparHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/<BR\s*\/?>/gi, "\n").replace(/<\/?B>/gi, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// null = descartar (vazio ou só "Movimentado para X", que já está no filme).
export function classificar(t: string): Classe | null {
  const s = String(t ?? "").trim();
  if (!s || /^Movimentado para [^\n]*$/i.test(s)) return null;
  const st = /^Status:\s*([^\n]+)/im.exec(s);
  if (st) {
    const d = /Descri\S*o:\s*([\s\S]*)$/i.exec(s);
    return { tipo: "bko_status", status: st[1].trim(), descricao: d ? d[1].trim() || null : null, vp_categoria: null };
  }
  const cat = /Categoria Inserido\s+([^\n]+)/i.exec(s);
  if (cat || /\(Venda Perdida\)/i.test(s)) return { tipo: "venda_perdida", status: null, descricao: null, vp_categoria: cat ? cat[1].trim() : null };
  return { tipo: "livre", status: null, descricao: null, vp_categoria: null };
}

export function linhasFilme(dados: Record<string, unknown>[]): LinhaFilme[] {
  const por = new Map<string, LinhaFilme>();
  for (const r of dados) {
    const pedido_id = Number(r.pedidoId), etapa_id = Number(r.etapaId);
    const entrou_em = paraTimestampSP(r.dataHoraEntrou), numero = texto(r.numeroAtividade);
    if (!Number.isInteger(pedido_id) || pedido_id <= 0 || !Number.isInteger(etapa_id) || etapa_id <= 0 || !entrou_em || !numero) continue;
    const limpo = limparHtml(r.movimentacao);
    por.set(`${pedido_id}|${etapa_id}|${entrou_em}`, {
      pedido_id, numero_pedido: numero, etapa_id, etapa: texto(r.nomeEtapa) ?? "", entrou_em, saiu_em: paraTimestampSP(r.dataHoraSaiu),
      entrou_por: texto(r.usuarioEntrou), saiu_por: texto(r.usuarioSaiu), sla_horas: numOuNull(r.slaHoras), tempo: texto(r.tempo),
      texto: limpo || null, vp_categoria: classificar(limpo)?.vp_categoria ?? null, consultor: texto(r.nomeConsultor),
      valor: numOuNull(r.total), tags: texto(r.tagsAtividade),
    });
  }
  return [...por.values()];
}

export function linhasAnotacao(dados: Record<string, unknown>[]): LinhaAnotacao[] {
  const ult = new Map<string, Record<string, unknown>>();
  for (const r of dados) {
    const n = texto(r.numeroAtividade);
    if (!n) continue;
    const a = ult.get(n);
    if (!a || String(r.dataHoraAtualizacao ?? "") > String(a.dataHoraAtualizacao ?? "")) ult.set(n, r);
  }
  const saida: LinhaAnotacao[] = [];
  for (const [n, r] of ult) {
    const limpo = limparHtml(r.descricaoUltimaMovimentacao), em = paraTimestampSP(r.dataHoraAtualizacao), c = classificar(limpo);
    if (c && em) saida.push({ numero_pedido: n, atualizado_em_neo: em, texto: limpo, etapa: texto(r.nomeEtapa), ...c });
  }
  return saida;
}

export function mensagemErro(status: number, corpo: string, retryAfter: string | null): string {
  let msg = `HTTP ${status}`;
  let jsonOk = false;
  try {
    const j = JSON.parse(corpo);
    if (j && (j.codigo || j.mensagem)) { msg += ` ${j.codigo ?? ""}: ${j.mensagem ?? ""}`.replace(/\s+:/, ":").trimEnd(); jsonOk = true; }
  } catch { /* corpo não é JSON */ }
  if (!jsonOk) { const t = String(corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 200); if (t) msg += ` — ${t}`; }
  if (retryAfter) msg += ` (Retry-After ${retryAfter}s)`;
  return msg.slice(0, 500);
}
export function ocultarToken(msg: string, token: string): string {
  if (!token) return String(msg);
  let out = String(msg).split(token).join("***");
  const cod = encodeURIComponent(token);
  if (cod !== token) out = out.split(cod).join("***");
  return out;
}
// Erro de rede (fetch) carrega a URL com o token: registra só o nome.
export function erroSeguro(e: unknown, token: string): string {
  const nome = (e as Error)?.name;
  if (nome === "TypeError" || nome === "TimeoutError" || nome === "AbortError") return `Falha de rede: ${nome}`;
  return ocultarToken(String((e as Error)?.message ?? e), token).slice(0, 500);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test supabase/functions/sync-pedidos-neo/pedidos.test.ts`
Expected: `# pass 8`, `# fail 0`.

- [ ] **Step 5: Commit** (mostrar a mensagem ao Rafael antes)

```bash
git add supabase/functions/sync-pedidos-neo/pedidos.ts supabase/functions/sync-pedidos-neo/pedidos.test.ts
git commit -m "feat(sync-pedidos-neo): §166 lógica pura das APIs Movimentação e Atualizações"
```

---

### Task 2: Edge Function `sync-pedidos-neo` (`index.ts`)

**Files:**
- Create: `supabase/functions/sync-pedidos-neo/index.ts`

**Interfaces:**
- Consumes: `pedidos.ts` (Task 1); RPC `pedido_anotacoes_gravar(p_linhas jsonb) returns int` e tabelas `pedido_movimentacoes`, `neo_pedidos_sync_log` (Task 3).
- Produces: `POST /functions/v1/sync-pedidos-neo`, header `x-cron-secret`, corpo `{"api":"atualizacoes"|"movimentacao","modo"?:"teste"}` → `{ok, api, linhas, gravados}` | `{ok:true, nada:true}` | `{ok:false, erro}`.

- [ ] **Step 1: Implementar**

```ts
// Edge Function: sync-pedidos-neo — §166. Movimentação (filme por etapa) e Atualizações (diário de anotações) da Xeotech.
// Spec: docs/superpowers/specs/2026-11-24-movimentacoes-pedidos-design.md
// Chamada só pelo pg_cron (x-cron-secret). Token: secret NEO_PEDIDOS_TOKEN (nunca em log/resposta).
// Corpo {"api":"atualizacoes"|"movimentacao"}; {"modo":"teste"} faz tudo menos gravar e devolve só contagens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Api, corpoDaApi, erroSeguro, linhasAnotacao, linhasFilme, mensagemErro, ocultarToken, proximaJanela } from "./pedidos.ts";

const URL_API: Record<Api, string> = {
  movimentacao: "https://api.xeotech.com.br/api/v1/pedidos/movimentacao/",
  atualizacoes: "https://api.xeotech.com.br/api/v1/pedidos/atualizacoes/",
};
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
  let corpo: { api?: string; modo?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const api: Api | null = corpo.api === "movimentacao" || corpo.api === "atualizacoes" ? corpo.api : null;
  if (!api) return json({ error: "Informe api: movimentacao ou atualizacoes." }, 400);
  const teste = corpo.modo === "teste";
  const token = Deno.env.get("NEO_PEDIDOS_TOKEN") ?? "";
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  const { data: ult } = await admin.from("neo_pedidos_sync_log").select("janela_fim")
    .eq("api", api).eq("ok", true).order("janela_fim", { ascending: false }).limit(1).maybeSingle();
  const janela = proximaJanela(api, ult?.janela_fim ? Date.parse(ult.janela_fim as string) : null, Date.now());
  if (!janela) return json({ ok: true, nada: true }, 200);

  let logId: number | null = null;
  if (!teste) {
    const { data } = await admin.from("neo_pedidos_sync_log")
      .insert({ api, janela_ini: new Date(janela.ini).toISOString(), janela_fim: new Date(janela.fim).toISOString() }).select("id").single();
    logId = (data as { id: number } | null)?.id ?? null;
  }
  const fechar = async (campos: Record<string, unknown>) => {
    if (logId !== null) await admin.from("neo_pedidos_sync_log").update({ ...campos, terminou_em: new Date().toISOString() }).eq("id", logId);
  };

  try {
    if (!token) throw new Error("Secret NEO_PEDIDOS_TOKEN ausente.");
    const resp = await fetch(URL_API[api] + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(corpoDaApi(api, janela)),
      signal: AbortSignal.timeout(100_000),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = ocultarToken(mensagemErro(resp.status, texto, resp.headers.get("Retry-After")), token);
      await fechar({ ok: false, http: resp.status, erro });
      return json({ ok: false, erro }, 502);
    }
    let j: { dados?: unknown };
    try { j = JSON.parse(texto); } catch { throw new Error(`Resposta da API não é JSON (HTTP ${resp.status}).`); }
    if (!Array.isArray(j?.dados)) throw new Error(mensagemErro(resp.status, texto, null)); // HTTP 200 com erro no corpo
    const linhas = j.dados as Record<string, unknown>[];
    let gravados = 0;
    if (api === "movimentacao") {
      const filme = linhasFilme(linhas);
      if (teste) return json({ ok: true, teste: true, api, linhas: linhas.length, gravar: filme.length }, 200);
      const agora = new Date().toISOString();
      for (let i = 0; i < filme.length; i += LOTE) {
        const lote = filme.slice(i, i + LOTE).map((l) => ({ ...l, sincronizado_em: agora }));
        const { error } = await admin.from("pedido_movimentacoes").upsert(lote, { onConflict: "pedido_id,etapa_id,entrou_em" });
        if (error) throw new Error("Erro ao gravar pedido_movimentacoes: " + error.message);
        gravados += lote.length;
      }
    } else {
      const notas = linhasAnotacao(linhas);
      if (teste) return json({ ok: true, teste: true, api, linhas: linhas.length, gravar: notas.length }, 200);
      const { data, error } = await admin.rpc("pedido_anotacoes_gravar", { p_linhas: notas });
      if (error) throw new Error("Erro ao gravar pedido_anotacoes: " + error.message);
      gravados = (data as number | null) ?? 0;
    }
    await fechar({ ok: true, http: resp.status, linhas: linhas.length, gravados });
    return json({ ok: true, api, linhas: linhas.length, gravados }, 200);
  } catch (e) {
    const erro = erroSeguro(e, token);
    await fechar({ ok: false, erro });
    return json({ ok: false, erro }, 500);
  }
});
```

- [ ] **Step 2: Conferir que nada sensível vazou para o código**

Run: `grep -n -i -E "cpfCnpj|nomeCliente|complementos|console\.log" supabase/functions/sync-pedidos-neo/index.ts`
Expected: nenhuma linha.

- [ ] **Step 3:** `node --test supabase/functions/sync-pedidos-neo/pedidos.test.ts` → `# fail 0`.

- [ ] **Step 4: Commit** (mostrar a mensagem antes) — `feat(sync-pedidos-neo): §166 Edge Function (log, janela, filme e diário)`.

---

### Task 3: Migration — tabelas, gravação do diário e permissão

**Files:**
- Create: `supabase/migrations/20261124120000_movimentacoes_pedidos.sql`
- Create: `supabase/tests/movimentacoes_pedidos_check.sql`

**Interfaces:**
- Produces: tabelas `pedido_movimentacoes`, `pedido_anotacoes`, `neo_pedidos_sync_log`, `vp_motivo_equivalencia`, `venda_perdida_auditoria`; `pedido_anotacoes_gravar(jsonb) returns int` (só service_role); internas (sem execute para authenticated): `mp_pedidos() returns table(numero_pedido text, operacao text, cliente text, consultor text)`, `mp_escopo() returns text` ('todas' | operação | null), `pedido_pode_ver(text) returns boolean`.

- [ ] **Step 1: Escrever o check (falha enquanto não existir a migration)**

`supabase/tests/movimentacoes_pedidos_check.sql`:

```sql
-- §166 — rodar no execute_sql DEPOIS da migration 20261124120000 (ou com ela colada logo após o begin).
-- SEMPRE desfeito: termina com raise exception 'RESULTADO: ...'. Usuários e pedidos fictícios (ZZ).
-- Precisa de ok do Rafael para rodar (é escrita em produção, mesmo desfeita).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000dd01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpsupa@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpsupc@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpconsa@teste.invalid'),
  ('00000000-0000-0000-0000-00000000dd05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.mpconsc@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000dd01', 'Zz Adm', 'zz.mpadm', 'admin', 'apex'),
  ('00000000-0000-0000-0000-00000000dd02', 'Zz SupA', 'zz.mpsupa', 'supervisor', 'apex'),
  ('00000000-0000-0000-0000-00000000dd03', 'Zz SupC', 'zz.mpsupc', 'supervisor', 'campinas'),
  ('00000000-0000-0000-0000-00000000dd04', 'Zz ConsA', 'zz.mpconsa', 'consultor', 'apex'),
  ('00000000-0000-0000-0000-00000000dd05', 'Zz ConsC', 'zz.mpconsc', 'consultor', 'campinas')
on conflict (id) do update set role = excluded.role, operacao = excluded.operacao;
insert into public.consultor_neo (profile_id, neo_usuario_id) values
  ('00000000-0000-0000-0000-00000000dd04', 990000041), ('00000000-0000-0000-0000-00000000dd05', 990000051);
-- ZZM1 = pedido Apex (ConsA); ZZM2 = pedido Campinas (ConsC); ZZM3 = só no filme (fora da producao_pedidos_neo)
insert into public.producao_pedidos_neo (item_id, numero_pedido, usuario, usuario_id, etapa, cadastro, atualizacao, valor, quantidade, produto, cliente)
values (990000101, 'ZZM1', 'ZZ CONS A', 990000041, 'VENDA PERDIDA (NEOCRM)', now() - interval '5 days', now(), 100, 1, 'Produto Teste', 'Cliente Teste 1'),
       (990000102, 'ZZM2', 'ZZ CONS C', 990000051, 'NEGOCIACAO', now() - interval '5 days', now(), 50, 1, 'Produto Teste', 'Cliente Teste 2');

-- diário: grava 1x; mesma nota com horário novo não duplica; nota diferente entra
do $$ declare n int; begin
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T09:51:00-03:00","texto":"Status: CONSULTA NÃO APROVADA","tipo":"bko_status","status":"CONSULTA NÃO APROVADA","descricao":null,"vp_categoria":null,"etapa":"CREDITO"}]'::jsonb);
  assert n = 1, 'grava a primeira nota, veio ' || n;
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T10:30:00-03:00","texto":"Status: CONSULTA NÃO APROVADA","tipo":"bko_status","status":"CONSULTA NÃO APROVADA","descricao":null,"vp_categoria":null,"etapa":"CREDITO"}]'::jsonb);
  assert n = 0, 'mesma nota com horário novo não duplica, veio ' || n;
  n := public.pedido_anotacoes_gravar('[{"numero_pedido":"ZZM1","atualizado_em_neo":"2026-11-20T11:05:00-03:00","texto":"cliente sumiu\n(Venda Perdida)\nCategoria Inserido Restrição de Crédito","tipo":"venda_perdida","status":null,"descricao":null,"vp_categoria":"Restrição de Crédito","etapa":"VENDA PERDIDA"}]'::jsonb);
  assert n = 1, 'nota nova entra, veio ' || n;
end $$;

-- filme: ZZM1 NEGOCIACAO → CREDITO → DEVOLVIDO (BKO) → VENDA PERDIDA (consultor); ZZM2 parado em NEGOCIACAO
insert into public.pedido_movimentacoes (pedido_id, numero_pedido, etapa_id, etapa, entrou_em, saiu_em, entrou_por, saiu_por, sla_horas, consultor) values
  (99001, 'ZZM1', 1, 'NEGOCIACAO',    '2026-11-20 08:00-03', '2026-11-20 09:00-03', 'ZZ CONS A', 'ZZ CONS A', 24,   'ZZ CONS A'),
  (99001, 'ZZM1', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 09:52-03', 'ZZ CONS A', 'ZZ BKO',    8,    'ZZ CONS A'),
  (99001, 'ZZM1', 3, 'DEVOLVIDO',     '2026-11-20 09:52-03', '2026-11-20 11:05-03', 'ZZ BKO',    'ZZ CONS A', 24,   'ZZ CONS A'),
  (99001, 'ZZM1', 4, 'VENDA PERDIDA', '2026-11-20 11:05-03', null,                  'ZZ CONS A', null,        null, 'ZZ CONS A'),
  (99002, 'ZZM2', 1, 'NEGOCIACAO',    '2026-11-21 08:00-03', null,                  'ZZ CONS C', null,        24,   'ZZ CONS C'),
  (99003, 'ZZM3', 1, 'NEGOCIACAO',    '2026-11-21 08:00-03', null,                  'ZZ OUTRO',  null,        24,   'ZZ OUTRO');

-- permissão (funções internas: authenticated não executa; avaliadas como dono, com o sub de cada um)
do $$ begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  begin perform public.pedido_pode_ver('ZZM1'); assert false, 'authenticated chamou função interna';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd01', true);
  assert public.pedido_pode_ver('ZZM1') and public.pedido_pode_ver('ZZM2') and public.pedido_pode_ver('ZZM3'), 'admin vê tudo';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  assert public.pedido_pode_ver('ZZM1') and not public.pedido_pode_ver('ZZM2') and public.pedido_pode_ver('ZZM3'), 'sup Apex: Apex + sem consultor (=apex)';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  assert not public.pedido_pode_ver('ZZM1') and public.pedido_pode_ver('ZZM2'), 'sup Campinas só Campinas';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  assert public.pedido_pode_ver('ZZM1') and not public.pedido_pode_ver('ZZM2') and not public.pedido_pode_ver('ZZM3'), 'consultor só o dele';
  assert public.mp_escopo() is null, 'consultor sem aba';
end $$;
-- (Tasks 4 e 5 acrescentam blocos aqui, antes do RESULTADO)
do $$ begin raise exception 'RESULTADO: ok (§166)'; end $$;
```

- [ ] **Step 2: Escrever a migration (parte 1)**

`supabase/migrations/20261124120000_movimentacoes_pedidos.sql`:

```sql
-- 24/11/2026 — §166 Movimentações dos pedidos (APIs Movimentação + Atualizações da Xeotech).
-- Spec: docs/superpowers/specs/2026-11-24-movimentacoes-pedidos-design.md. Sem nome/CNPJ do cliente nas tabelas novas.
-- RLS ligado e SEM policy: o painel lê só pelas RPCs (security definer) desta migration.

create table if not exists public.pedido_movimentacoes (
  pedido_id bigint not null, numero_pedido text not null, etapa_id bigint not null, etapa text not null,
  entrou_em timestamptz not null, saiu_em timestamptz, entrou_por text, saiu_por text,
  sla_horas numeric, tempo text, texto text, vp_categoria text, consultor text, valor numeric, tags text,
  sincronizado_em timestamptz not null default now(),
  primary key (pedido_id, etapa_id, entrou_em)
);
create index if not exists pedido_mov_numero on public.pedido_movimentacoes (numero_pedido);
create index if not exists pedido_mov_entrou on public.pedido_movimentacoes (entrou_em);
create index if not exists pedido_mov_abertas on public.pedido_movimentacoes (etapa) where saiu_em is null;

create table if not exists public.pedido_anotacoes (
  id bigserial primary key, numero_pedido text not null, atualizado_em_neo timestamptz not null, texto text not null,
  tipo text not null check (tipo in ('bko_status', 'venda_perdida', 'livre')),
  status text, descricao text, vp_categoria text, etapa text, visto_em timestamptz not null default now()
);
create unique index if not exists pedido_anot_uk on public.pedido_anotacoes (numero_pedido, atualizado_em_neo, md5(texto));
create index if not exists pedido_anot_em on public.pedido_anotacoes (atualizado_em_neo);

create table if not exists public.neo_pedidos_sync_log (
  id bigserial primary key, api text not null check (api in ('atualizacoes', 'movimentacao')),
  janela_ini timestamptz, janela_fim timestamptz, http int, linhas int, gravados int, ok boolean, erro text,
  comecou_em timestamptz not null default now(), terminou_em timestamptz
);
create index if not exists neo_ped_log_ult on public.neo_pedidos_sync_log (api, ok, janela_fim desc);

create table if not exists public.vp_motivo_equivalencia (
  vp_categoria text not null, trecho_status text not null, primary key (vp_categoria, trecho_status)
);
insert into public.vp_motivo_equivalencia values ('Restrição de Crédito', 'NÃO APROVADA') on conflict do nothing;

create table if not exists public.venda_perdida_auditoria (
  numero_pedido text primary key, motivo_real text not null, obs text,
  decidido_por uuid not null, decidido_em timestamptz not null default now()
);

alter table public.pedido_movimentacoes enable row level security;
alter table public.pedido_anotacoes enable row level security;
alter table public.neo_pedidos_sync_log enable row level security;
alter table public.vp_motivo_equivalencia enable row level security;
alter table public.venda_perdida_auditoria enable row level security;

-- Diário: a API repete a última nota quando o pedido é mexido por outro motivo; só grava se o texto mudou.
create or replace function public.pedido_anotacoes_gravar(p_linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; ult text; n int := 0;
begin
  for r in select value from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) order by value->>'atualizado_em_neo' loop
    ult := null;
    select a.texto into ult from public.pedido_anotacoes a
     where a.numero_pedido = r->>'numero_pedido' order by a.atualizado_em_neo desc, a.id desc limit 1;
    continue when ult is not distinct from r->>'texto';
    insert into public.pedido_anotacoes (numero_pedido, atualizado_em_neo, texto, tipo, status, descricao, vp_categoria, etapa)
    values (r->>'numero_pedido', (r->>'atualizado_em_neo')::timestamptz, r->>'texto', r->>'tipo', r->>'status',
            r->>'descricao', r->>'vp_categoria', r->>'etapa')
    on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Operação de cada pedido = a do consultor (via consultor_neo); sem consultor ligado = 'apex'.
create or replace function public.mp_pedidos() returns table (numero_pedido text, operacao text, cliente text, consultor text)
language sql stable security definer set search_path = public as $$
  select distinct on (n.numero_pedido) n.numero_pedido, coalesce(pr.operacao, 'apex'), n.cliente, n.usuario
    from public.producao_pedidos_neo n
    left join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
    left join public.profiles pr on pr.id = c.profile_id
   order by n.numero_pedido, pr.operacao is null, n.atualizacao desc nulls last;
$$;

-- 'todas' (admin), a operação (supervisor) ou null (sem aba).
create or replace function public.mp_escopo() returns text
language sql stable security definer set search_path = public as $$
  select case p.role when 'admin' then 'todas' when 'supervisor' then coalesce(p.operacao, 'apex') end
    from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.pedido_pode_ver(p_numero text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.mp_escopo() = 'todas' then true
    when public.mp_escopo() is not null then
      coalesce((select o.operacao from public.mp_pedidos() o where o.numero_pedido = p_numero), 'apex') = public.mp_escopo()
    when (select role from public.profiles where id = auth.uid()) = 'consultor' then
      exists (select 1 from public.producao_pedidos_neo n where n.numero_pedido = p_numero and n.usuario_id = public.meu_neo_usuario_id())
    else false end;
$$;

revoke execute on function public.pedido_anotacoes_gravar(jsonb) from public, anon, authenticated;
grant execute on function public.pedido_anotacoes_gravar(jsonb) to service_role;
revoke execute on function public.mp_pedidos() from public, anon, authenticated;
revoke execute on function public.mp_escopo() from public, anon, authenticated;
revoke execute on function public.pedido_pode_ver(text) from public, anon, authenticated;
```

- [ ] **Step 3: Dry-run (precisa de ok do Rafael)** — um único `execute_sql` com o check, colando a migration logo depois do `begin;`. Sem `drop` no texto (memória "SQL grande no conector").
Expected: erro `RESULTADO: ok (§166)`. Qualquer outro erro = falha; corrigir e repetir.

- [ ] **Step 4: Commit** (mostrar a mensagem antes) — `feat(db): §166 tabelas do filme e do diário, gravação e permissão por operação`.

---

### Task 4: RPCs da gaveta, do feed e do tempo por etapa

**Files:**
- Modify: `supabase/migrations/20261124120000_movimentacoes_pedidos.sql` (acrescentar no fim)
- Modify: `supabase/tests/movimentacoes_pedidos_check.sql` (bloco antes do `RESULTADO`)

**Interfaces:**
- Produces (todas `returns jsonb`, execute só `authenticated`, erro `42501` sem permissão):
  - `pedido_linha_do_tempo(p_numero text)` → `{cabecalho:{numero,cliente,consultor,valor,etapa}|null, passagens:[{etapa,entrou_em,saiu_em,entrou_por,saiu_por,sla_horas,texto,vp_categoria}], anotacoes:[{em,tipo,status,descricao,vp_categoria,texto,autor_provavel}], motivo_real:{motivo,obs,em,por}|null, pode_decidir:bool, categorias:[text]|null}`.
  - `movimentacoes_feed(p_dia date, p_consultor text, p_etapa text, p_tipo text)` → `{itens:[{em,numero,cliente,consultor,tipo,etapa,quem,status,descricao,vp_categoria}], kpis:{movimentacoes,anotacoes_bko,entradas_vp}, atualizado_em, consultores:[text], etapas:[text]}`; `tipo` ∈ `etapa|bko_status|venda_perdida|livre`.
  - `movimentacoes_tempo_etapa(p_de date, p_ate date, p_consultor text)` → `{etapas:[{etapa,passagens,mediana_h,p90_h,fora_sla_pct,parados}], consultores:[text]}`.
  - `movimentacoes_parados(p_etapa text)` → `{itens:[{numero,cliente,consultor,desde,sla_horas}]}`.

- [ ] **Step 1: Asserts no check** (antes do `RESULTADO`)

```sql
do $$ declare j jsonb; begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd04', 'role', 'authenticated')::text, true);
  j := public.pedido_linha_do_tempo('ZZM1');
  assert jsonb_array_length(j->'passagens') = 4, 'consultor vê as 4 passagens do pedido dele';
  assert jsonb_array_length(j->'anotacoes') = 2 and j->'motivo_real' = 'null'::jsonb and not (j->>'pode_decidir')::boolean, 'consultor: notas sim, motivo real não';
  assert (j->'anotacoes'->0->>'autor_provavel') = 'ZZ BKO', 'autor provável da nota 09:51 = quem moveu às 09:52';
  begin perform public.pedido_linha_do_tempo('ZZM2'); assert false, 'consultor viu pedido de outro';
  exception when insufficient_privilege then null; end;
  begin perform public.movimentacoes_feed(date '2026-11-20', null, null, null); assert false, 'consultor abriu o feed';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd03', 'role', 'authenticated')::text, true);
  j := public.movimentacoes_feed(date '2026-11-20', null, null, null);
  assert not exists (select 1 from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1'), 'sup Campinas não vê ZZM1 no feed';
  j := public.movimentacoes_parados('NEGOCIACAO');
  assert exists (select 1 from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM2'), 'sup Campinas vê ZZM2 parado';

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd02', 'role', 'authenticated')::text, true);
  j := public.movimentacoes_feed(date '2026-11-20', null, null, null);
  assert (select count(*) from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1') = 6, 'sup Apex: 4 passagens + 2 notas de ZZM1 em 20/11';
  assert (j->'kpis'->>'entradas_vp')::int >= 1 and (j->'kpis'->>'anotacoes_bko')::int >= 1, 'kpis contam VP e BKO';
  j := public.movimentacoes_feed(date '2026-11-20', null, null, 'bko_status');
  assert (select count(*) from jsonb_array_elements(j->'itens') e where e->>'numero' = 'ZZM1') = 1, 'filtro tipo';
  j := public.movimentacoes_tempo_etapa(date '2026-11-19', date '2026-11-21', 'ZZ CONS A');
  assert exists (select 1 from jsonb_array_elements(j->'etapas') e where e->>'etapa' = 'CREDITO' and (e->>'fora_sla_pct')::numeric = 0 and (e->>'passagens')::int = 1), 'CREDITO: 52 min, dentro do SLA de 8 h';
  j := public.movimentacoes_parados('VENDA PERDIDA');
  assert jsonb_array_length(j->'itens') = 0, 'VENDA PERDIDA não conta como parado';
  j := public.pedido_linha_do_tempo('ZZM3');
  assert j->'cabecalho' = 'null'::jsonb and jsonb_array_length(j->'passagens') = 1, 'pedido fora da producao_pedidos_neo: sem cabeçalho, com filme';
end $$;
```

- [ ] **Step 2: RPCs na migration**

```sql
create or replace function public.pedido_linha_do_tempo(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_decide boolean := coalesce((select role from public.profiles where id = auth.uid()) in ('admin', 'supervisor'), false);
begin
  if not coalesce(public.pedido_pode_ver(p_numero), false) then
    raise exception 'sem permissão para ver este pedido' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cabecalho', (select jsonb_build_object('numero', p_numero,
                          'cliente', (array_agg(n.cliente order by n.atualizacao desc nulls last))[1],
                          'consultor', (array_agg(n.usuario order by n.atualizacao desc nulls last))[1],
                          'valor', sum(n.valor),
                          'etapa', (array_agg(n.etapa order by n.atualizacao desc nulls last))[1])
                    from public.producao_pedidos_neo n where n.numero_pedido = p_numero having count(*) > 0),
    'passagens', coalesce((select jsonb_agg(jsonb_build_object('etapa', m.etapa, 'entrou_em', m.entrou_em, 'saiu_em', m.saiu_em,
                    'entrou_por', m.entrou_por, 'saiu_por', m.saiu_por, 'sla_horas', m.sla_horas, 'texto', m.texto,
                    'vp_categoria', m.vp_categoria) order by m.entrou_em)
                  from public.pedido_movimentacoes m where m.numero_pedido = p_numero), '[]'::jsonb),
    'anotacoes', coalesce((select jsonb_agg(jsonb_build_object('em', a.atualizado_em_neo, 'tipo', a.tipo, 'status', a.status,
                    'descricao', a.descricao, 'vp_categoria', a.vp_categoria, 'texto', a.texto,
                    'autor_provavel', (select m.entrou_por from public.pedido_movimentacoes m
                                        where m.numero_pedido = a.numero_pedido
                                          and m.entrou_em between a.atualizado_em_neo - interval '10 minutes' and a.atualizado_em_neo + interval '1 minute'
                                        order by m.entrou_em desc limit 1)) order by a.atualizado_em_neo)
                  from public.pedido_anotacoes a where a.numero_pedido = p_numero), '[]'::jsonb),
    'motivo_real', case when v_decide then (select jsonb_build_object('motivo', v.motivo_real, 'obs', v.obs, 'em', v.decidido_em,
                        'por', (select p.nome from public.profiles p where p.id = v.decidido_por))
                      from public.venda_perdida_auditoria v where v.numero_pedido = p_numero) end,
    'pode_decidir', v_decide,
    'categorias', case when v_decide then coalesce((select jsonb_agg(x.c order by x.c)
                    from (select distinct categoria c from public.producao_atividades where categoria is not null) x), '[]'::jsonb) end);
end $$;

create or replace function public.movimentacoes_feed(p_dia date, p_consultor text default null, p_etapa text default null, p_tipo text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
        v_ini timestamptz := p_dia::timestamp at time zone 'America/Sao_Paulo';
        v_fim timestamptz := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
        r jsonb;
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  with ev as (
    select m.entrou_em em, m.numero_pedido, m.consultor, 'etapa'::text tipo, m.etapa, m.entrou_por quem,
           null::text status, null::text descricao, m.vp_categoria
      from public.pedido_movimentacoes m where m.entrou_em >= v_ini and m.entrou_em < v_fim
    union all
    select a.atualizado_em_neo, a.numero_pedido, null, a.tipo, a.etapa, null, a.status, a.descricao, a.vp_categoria
      from public.pedido_anotacoes a where a.atualizado_em_neo >= v_ini and a.atualizado_em_neo < v_fim
  ), e as (
    select ev.em, ev.numero_pedido, ev.tipo, ev.etapa, ev.quem, ev.status, ev.descricao, ev.vp_categoria, o.cliente,
           coalesce(o.consultor, ev.consultor,
             (select max(m2.consultor) from public.pedido_movimentacoes m2 where m2.numero_pedido = ev.numero_pedido)) consultor
      from ev left join public.mp_pedidos() o on o.numero_pedido = ev.numero_pedido
     where v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc
  ), f as (select * from e where p_consultor is null or consultor = p_consultor)
  select jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('em', x.em, 'numero', x.numero_pedido, 'cliente', x.cliente,
               'consultor', x.consultor, 'tipo', x.tipo, 'etapa', x.etapa, 'quem', x.quem, 'status', x.status,
               'descricao', x.descricao, 'vp_categoria', x.vp_categoria) order by x.em desc)
             from (select * from f where (p_etapa is null or etapa = p_etapa) and (p_tipo is null or tipo = p_tipo)
                    order by em desc limit 500) x), '[]'::jsonb),
    'kpis', jsonb_build_object(
      'movimentacoes', (select count(*) from f where tipo = 'etapa'),
      'anotacoes_bko', (select count(*) from f where tipo = 'bko_status'),
      'entradas_vp', (select count(*) from f where tipo = 'etapa' and etapa ilike 'VENDA PERDIDA%')),
    'atualizado_em', (select max(terminou_em) from public.neo_pedidos_sync_log where api = 'atualizacoes' and ok),
    'consultores', coalesce((select jsonb_agg(distinct consultor) from e where consultor is not null), '[]'::jsonb),
    'etapas', coalesce((select jsonb_agg(distinct etapa) from e where etapa is not null), '[]'::jsonb))
  into r;
  return r;
end $$;

-- Só a última passagem de cada pedido pode estar "parada"; CONCLUIDO e VENDA PERDIDA não contam.
create or replace function public.movimentacoes_parados(p_etapa text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return jsonb_build_object('itens', coalesce((select jsonb_agg(jsonb_build_object('numero', x.numero_pedido, 'cliente', x.cliente,
             'consultor', x.consultor, 'desde', x.entrou_em, 'sla_horas', x.sla_horas) order by x.entrou_em)
    from (select m.numero_pedido, o.cliente, coalesce(o.consultor, m.consultor) consultor, m.entrou_em, m.sla_horas
            from public.pedido_movimentacoes m left join public.mp_pedidos() o on o.numero_pedido = m.numero_pedido
           where m.etapa = p_etapa and m.saiu_em is null
             and m.etapa not ilike 'VENDA PERDIDA%' and m.etapa <> 'CONCLUIDO'
             and not exists (select 1 from public.pedido_movimentacoes m2 where m2.pedido_id = m.pedido_id and m2.entrou_em > m.entrou_em)
             and (v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc)
           order by m.entrou_em limit 300) x), '[]'::jsonb));
end $$;

create or replace function public.movimentacoes_tempo_etapa(p_de date, p_ate date, p_consultor text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
        v_ini timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
        v_fim timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (with p as (
    select m.*, coalesce(o.consultor, m.consultor) cons,
           extract(epoch from (m.saiu_em - m.entrou_em)) / 3600 horas,
           m.saiu_em is null and m.etapa not ilike 'VENDA PERDIDA%' and m.etapa <> 'CONCLUIDO'
             and not exists (select 1 from public.pedido_movimentacoes m2 where m2.pedido_id = m.pedido_id and m2.entrou_em > m.entrou_em) parado
      from public.pedido_movimentacoes m left join public.mp_pedidos() o on o.numero_pedido = m.numero_pedido
     where v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc
  ), f as (select * from p where p_consultor is null or cons = p_consultor),
  per as (
    select etapa, count(*) passagens,
           percentile_cont(0.5) within group (order by horas) filter (where horas is not null) mediana_h,
           percentile_cont(0.9) within group (order by horas) filter (where horas is not null) p90_h,
           round(100.0 * count(*) filter (where horas is not null and sla_horas > 0 and horas > sla_horas)
                 / nullif(count(*) filter (where horas is not null and sla_horas > 0), 0), 1) fora_sla_pct
      from f where entrou_em >= v_ini and entrou_em < v_fim group by etapa
  ), par as (select etapa, count(*) parados from f where parado group by etapa)
  select jsonb_build_object(
    'etapas', coalesce((select jsonb_agg(jsonb_build_object('etapa', coalesce(per.etapa, par.etapa), 'passagens', coalesce(per.passagens, 0),
                 'mediana_h', round(per.mediana_h::numeric, 1), 'p90_h', round(per.p90_h::numeric, 1),
                 'fora_sla_pct', per.fora_sla_pct, 'parados', coalesce(par.parados, 0))
               order by coalesce(per.passagens, 0) desc)
             from per full join par on par.etapa = per.etapa), '[]'::jsonb),
    'consultores', coalesce((select jsonb_agg(distinct cons) from p where cons is not null), '[]'::jsonb)));
end $$;

revoke execute on function public.pedido_linha_do_tempo(text) from public, anon;
revoke execute on function public.movimentacoes_feed(date, text, text, text) from public, anon;
revoke execute on function public.movimentacoes_parados(text) from public, anon;
revoke execute on function public.movimentacoes_tempo_etapa(date, date, text) from public, anon;
grant execute on function public.pedido_linha_do_tempo(text), public.movimentacoes_feed(date, text, text, text),
  public.movimentacoes_parados(text), public.movimentacoes_tempo_etapa(date, date, text) to authenticated;
```

- [ ] **Step 3: Dry-run (ok do Rafael)** → `RESULTADO: ok (§166)`.
- [ ] **Step 4: Commit** (mostrar) — `feat(db): §166 RPCs da linha do tempo, feed e tempo por etapa`.

---

### Task 5: RPCs da auditoria de vendas perdidas

**Files:** Modify a migration e o check (mesmos arquivos).

**Interfaces:**
- Produces: `vendas_perdidas_auditoria(p_de date, p_ate date) returns jsonb` → `{totais:{vp,saiu,devolvido,confere,diferente,sem,reais}, por_consultor:[{consultor,vps,alerta_pct,categorias:[text]}], pedidos:[{numero,cliente,consultor,entrou_em,categoria,bko_status,bko_descricao,bko_em,selo,motivo_real}]}`; `selo` ∈ `saiu|devolvido|confere|diferente|sem`.
- `venda_perdida_definir_motivo(p_numero text, p_motivo text, p_obs text) returns jsonb` → `{ok:true}`; `42501` sem permissão; `22023` motivo vazio.

- [ ] **Step 1: Asserts no check** (antes do `RESULTADO`)

```sql
-- ZZM4: VP sem nada antes (❔); ZZM5: entrou em VP e voltou (↩️); ZZM6: BKO reprovou crédito, consultor marcou crédito (✅);
-- ZZM7: BKO reprovou crédito, consultor marcou "Não responde" (⚠️); ZZM1 (Task 3) = devolvido sem nota nova depois (🔁).
-- ZZM4..7 estão fora da producao_pedidos_neo → contam como 'apex'.
insert into public.pedido_movimentacoes (pedido_id, numero_pedido, etapa_id, etapa, entrou_em, saiu_em, entrou_por, consultor) values
  (99004, 'ZZM4', 4, 'VENDA PERDIDA', '2026-11-20 12:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99005, 'ZZM5', 4, 'VENDA PERDIDA', '2026-11-20 12:00-03', '2026-11-20 15:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99005, 'ZZM5', 1, 'NEGOCIACAO',    '2026-11-20 15:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99006, 'ZZM6', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 10:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99006, 'ZZM6', 4, 'VENDA PERDIDA', '2026-11-20 10:00-03', null,                  'ZZ CONS A', 'ZZ CONS A'),
  (99007, 'ZZM7', 2, 'CREDITO',       '2026-11-20 09:00-03', '2026-11-20 10:00-03', 'ZZ CONS A', 'ZZ CONS A'),
  (99007, 'ZZM7', 4, 'VENDA PERDIDA', '2026-11-20 10:00-03', null,                  'ZZ CONS A', 'ZZ CONS A');
insert into public.pedido_anotacoes (numero_pedido, atualizado_em_neo, texto, tipo, status, vp_categoria) values
  ('ZZM6', '2026-11-20 09:30-03', 'Status: CONSULTA NÃO APROVADA', 'bko_status', 'CONSULTA NÃO APROVADA', null),
  ('ZZM6', '2026-11-20 10:00-03', '(Venda Perdida) Categoria Inserido Restrição de Crédito', 'venda_perdida', null, 'Restrição de Crédito'),
  ('ZZM7', '2026-11-20 09:30-03', 'Status: CONSULTA NÃO APROVADA', 'bko_status', 'CONSULTA NÃO APROVADA', null),
  ('ZZM7', '2026-11-20 10:00-03', '(Venda Perdida) Categoria Inserido Não responde', 'venda_perdida', null, 'Não responde');

do $$ declare j jsonb; s jsonb; begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd02', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd02', 'role', 'authenticated')::text, true);
  j := public.vendas_perdidas_auditoria(date '2026-11-20', date '2026-11-20');
  select jsonb_object_agg(e->>'numero', e->>'selo') into s from jsonb_array_elements(j->'pedidos') e where e->>'numero' like 'ZZM%';
  assert s = '{"ZZM1":"devolvido","ZZM4":"sem","ZZM5":"saiu","ZZM6":"confere","ZZM7":"diferente"}'::jsonb, 'selos: ' || s::text;
  assert (select e->>'categoria' from jsonb_array_elements(j->'pedidos') e where e->>'numero' = 'ZZM1') = 'Restrição de Crédito', 'categoria vem do diário';
  perform public.venda_perdida_definir_motivo('ZZM7', 'Restrição de Crédito', 'BKO reprovou');
  assert (public.pedido_linha_do_tempo('ZZM7')->'motivo_real'->>'motivo') = 'Restrição de Crédito', 'motivo real gravado';
  begin perform public.venda_perdida_definir_motivo('ZZM7', '  ', null); assert false, 'aceitou motivo vazio';
  exception when sqlstate '22023' then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd03', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd03', 'role', 'authenticated')::text, true);
  j := public.vendas_perdidas_auditoria(date '2026-11-20', date '2026-11-20');
  assert not exists (select 1 from jsonb_array_elements(j->'pedidos') e where e->>'numero' = 'ZZM6'), 'sup Campinas não vê VP da Apex';
  begin perform public.venda_perdida_definir_motivo('ZZM6', 'Não responde', null); assert false, 'sup Campinas decidiu pedido Apex';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000dd04', true);
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000dd04', 'role', 'authenticated')::text, true);
  begin perform public.venda_perdida_definir_motivo('ZZM1', 'Não responde', null); assert false, 'consultor decidiu motivo';
  exception when insufficient_privilege then null; end;
end $$;
```

- [ ] **Step 2: RPCs na migration**

```sql
-- Selo da VP, na ordem: saiu > devolvido > confere > diferente > sem (spec §6). Etapa de devolução = DEVOLVIDO.
create or replace function public.vendas_perdidas_auditoria(p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_esc text := public.mp_escopo();
        v_ini timestamptz := p_de::timestamp at time zone 'America/Sao_Paulo';
        v_fim timestamptz := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if v_esc is null then raise exception 'sem permissão' using errcode = '42501'; end if;
  return (with vp as (
    select distinct on (m.pedido_id) m.pedido_id, m.numero_pedido, m.entrou_em, m.consultor, m.vp_categoria
      from public.pedido_movimentacoes m
     where m.etapa ilike 'VENDA PERDIDA%' and m.entrou_em >= v_ini and m.entrou_em < v_fim
     order by m.pedido_id, m.entrou_em desc
  ), x as (
    select v.numero_pedido, v.entrou_em, o.cliente, coalesce(o.consultor, v.consultor) consultor, v.consultor cons_neo,
           coalesce(v.vp_categoria,
             (select a.vp_categoria from public.pedido_anotacoes a where a.numero_pedido = v.numero_pedido and a.vp_categoria is not null
                 and a.atualizado_em_neo >= v.entrou_em - interval '1 minute' order by a.atualizado_em_neo desc limit 1),
             (select pa.categoria from public.producao_atividades pa where pa.numero_pedido = v.numero_pedido)) categoria,
           b.status, b.descricao, b.bko_em, ant.ant_etapa, ant.ant_em, ant.ant_por, coalesce(dep.saiu, false) saiu,
           (select va.motivo_real from public.venda_perdida_auditoria va where va.numero_pedido = v.numero_pedido) motivo_real
      from vp v
      left join public.mp_pedidos() o on o.numero_pedido = v.numero_pedido
      left join lateral (select a.status, a.descricao, a.atualizado_em_neo bko_em from public.pedido_anotacoes a
                          where a.numero_pedido = v.numero_pedido and a.tipo = 'bko_status' and a.atualizado_em_neo < v.entrou_em
                          order by a.atualizado_em_neo desc limit 1) b on true
      left join lateral (select p.etapa ant_etapa, p.entrou_em ant_em, p.entrou_por ant_por from public.pedido_movimentacoes p
                          where p.pedido_id = v.pedido_id and p.entrou_em < v.entrou_em order by p.entrou_em desc limit 1) ant on true
      left join lateral (select true saiu from public.pedido_movimentacoes d
                          where d.pedido_id = v.pedido_id and d.entrou_em > v.entrou_em and d.etapa not ilike 'VENDA PERDIDA%' limit 1) dep on true
     where v_esc = 'todas' or coalesce(o.operacao, 'apex') = v_esc
  ), s as (
    select x.*, case
      when x.saiu then 'saiu'
      when x.ant_etapa = 'DEVOLVIDO' and coalesce(x.ant_por, '') <> coalesce(x.cons_neo, '') then 'devolvido'
      when x.status is not null and exists (select 1 from public.vp_motivo_equivalencia e
             where e.vp_categoria = x.categoria and x.status ilike '%' || e.trecho_status || '%') then 'confere'
      when x.status is not null and exists (select 1 from public.vp_motivo_equivalencia e
             where e.vp_categoria is distinct from x.categoria and x.status ilike '%' || e.trecho_status || '%') then 'diferente'
      else 'sem' end selo
      from x
  ), cat as (
    select consultor, jsonb_agg(categoria order by n desc) categorias
      from (select consultor, categoria, count(*) n, row_number() over (partition by consultor order by count(*) desc) rk
              from s where categoria is not null group by consultor, categoria) k
     where rk <= 3 group by consultor
  ), pc as (
    select s.consultor, count(*) vps,
           round(100.0 * count(*) filter (where selo in ('diferente', 'devolvido')) / count(*), 0) alerta_pct
      from s group by s.consultor
  )
  select jsonb_build_object(
    'totais', (select jsonb_build_object('vp', count(*), 'saiu', count(*) filter (where selo = 'saiu'),
       'devolvido', count(*) filter (where selo = 'devolvido'), 'confere', count(*) filter (where selo = 'confere'),
       'diferente', count(*) filter (where selo = 'diferente'), 'sem', count(*) filter (where selo = 'sem'),
       'reais', count(*) filter (where selo <> 'saiu')) from s),
    'por_consultor', coalesce((select jsonb_agg(jsonb_build_object('consultor', pc.consultor, 'vps', pc.vps, 'alerta_pct', pc.alerta_pct,
         'categorias', coalesce(cat.categorias, '[]'::jsonb)) order by pc.vps desc)
       from pc left join cat on cat.consultor is not distinct from pc.consultor), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object('numero', numero_pedido, 'cliente', cliente, 'consultor', consultor,
         'entrou_em', entrou_em, 'categoria', categoria, 'bko_status', status, 'bko_descricao', descricao, 'bko_em', bko_em,
         'selo', selo, 'motivo_real', motivo_real) order by entrou_em desc) from s), '[]'::jsonb)));
end $$;

create or replace function public.venda_perdida_definir_motivo(p_numero text, p_motivo text, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.profiles where id = auth.uid()), '') not in ('admin', 'supervisor')
     or not coalesce(public.pedido_pode_ver(p_numero), false) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'escolha o motivo real' using errcode = '22023'; end if;
  insert into public.venda_perdida_auditoria (numero_pedido, motivo_real, obs, decidido_por, decidido_em)
  values (p_numero, left(trim(p_motivo), 80), nullif(left(trim(coalesce(p_obs, '')), 500), ''), auth.uid(), now())
  on conflict (numero_pedido) do update set motivo_real = excluded.motivo_real, obs = excluded.obs,
    decidido_por = excluded.decidido_por, decidido_em = excluded.decidido_em;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.vendas_perdidas_auditoria(date, date) from public, anon;
revoke execute on function public.venda_perdida_definir_motivo(text, text, text) from public, anon;
grant execute on function public.vendas_perdidas_auditoria(date, date), public.venda_perdida_definir_motivo(text, text, text) to authenticated;
```

- [ ] **Step 3: Dry-run (ok do Rafael)** → `RESULTADO: ok (§166)`.
- [ ] **Step 4: Commit** (mostrar) — `feat(db): §166 auditoria das vendas perdidas (selos e motivo real)`.

---

### Task 6: Painel — aba, permissão e Feed do dia

**Files:**
- Modify: `_template.html`:
  - botão no `nav#tabsNav` logo depois do botão `data-tab="discador"`;
  - `<section id="panel-movpedidos">` + `<aside id="mpFicha">` logo antes de `<section class="panel" id="panel-socios">`;
  - acrescentar `#panel-movpedidos,#mpFicha` à lista de seletores da linha que começa com `#prospecOverlay,#panel-meusleads,` (variáveis `--ml-*`, como o §157 fez com `#panel-socios`);
  - CSS `.mp*` logo depois da última regra `#panel-socios …`;
  - módulo JS logo antes de `function scAplicarPermissao(){`;
  - gancho na troca de aba; `mpAplicarPermissao();` depois de `scAplicarPermissao();` no login.
- Create: `test_movpedidos.js`

**Interfaces:**
- Produces (globais): `mpEstado`, `mpAplicarPermissao()`, `mpAbrir()`, `mpParar()`, `mpCarregar()`, `mpPintarFeed(d)`, `mpLinkPedido(numero) → html`, `mpOpcoes(lista, atual, rotulo) → html`, `mpHora(iso)`, `mpDuracao(h)`, `mpHoras(a, b)`.

- [ ] **Step 1: Teste** — `test_movpedidos.js`:

```js
// Testa a §166 — aba Movimentações (feed, tempo, VP) e gaveta do pedido. DADOS FICTÍCIOS.
require('./renovacao_test_harness.js').rodar(`
  const clicar = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const q = (s) => document.querySelector(s);
  const chamadas = (n) => window.__rpcCalls.filter(c => c.nome === n);
  const agoraIso = new Date().toISOString();
  window.__rpcRespostas.movimentacoes_feed = () => ({ data: { itens: [
      { em: '2026-11-20T12:51:00Z', numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', tipo: 'bko_status', etapa: 'CREDITO', quem: null, status: 'CONSULTA NÃO APROVADA', descricao: 'REPROVADO TESTE', vp_categoria: null },
      { em: '2026-11-20T12:00:00Z', numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', tipo: 'etapa', etapa: 'CREDITO', quem: 'ZZ BKO', status: null, descricao: null, vp_categoria: null } ],
    kpis: { movimentacoes: 4, anotacoes_bko: 1, entradas_vp: 1 }, atualizado_em: agoraIso, consultores: ['ZZ CONS A'], etapas: ['CREDITO'] }, error: null });

  // permissão
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'apex', equipe: null }; mpAplicarPermissao();
  eq(q('#tabBtnMovPedidos').style.display, 'none', 'consultor não vê a aba');
  currentUser = { id: 'u-s', nome: 'Zzs', role: 'supervisor', operacao: 'campinas', equipe: null }; mpAplicarPermissao();
  eq(q('#tabBtnMovPedidos').style.display, 'inline-block', 'supervisor vê a aba');

  // feed
  clicar(q('#tabsNav button[data-tab="movpedidos"]')); await espera(40);
  assert(q('#panel-movpedidos').classList.contains('active'), 'abre a aba');
  eq(chamadas('movimentacoes_feed')[0].args.p_tipo, null, 'feed sem filtro de tipo');
  const txt = q('#mpConteudo').textContent;
  assert(/CONSULTA NÃO APROVADA/.test(txt) && /ZZ BKO/.test(txt) && /ZZM1/.test(txt), 'lista do feed');
  assert(/4/.test(q('#mpConteudo .kpiGrid').textContent), 'kpis');
  assert(!q('#mpAtualizado').classList.contains('mpAtrasado'), 'sincronização recente não fica em alerta');
  assert(mpEstado.timer, 'agendou a releitura');

  // filtro de tipo chama de novo
  const sel = q('#mpFiltros [data-mp-filtro="tipo"]'); sel.value = 'bko_status'; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(30);
  eq(chamadas('movimentacoes_feed').at(-1).args.p_tipo, 'bko_status', 'filtro de tipo');

  // sincronização velha → alerta; feed vazio avisa
  window.__rpcRespostas.movimentacoes_feed = () => ({ data: { itens: [], kpis: { movimentacoes: 0, anotacoes_bko: 0, entradas_vp: 0 }, atualizado_em: '2026-11-20T00:00:00Z', consultores: [], etapas: [] }, error: null });
  await mpCarregar(); await espera(10);
  assert(q('#mpAtualizado').classList.contains('mpAtrasado'), 'sincronização de mais de 30 min fica em alerta');
  assert(/Nada neste dia/.test(q('#mpConteudo').textContent), 'feed vazio avisa');

  // sair da aba para a releitura
  clicar(q('#tabsNav button[data-tab="busca"]')); await espera(10);
  assert(!mpEstado.timer, 'parou ao sair da aba');
  // (Tasks 7, 8 e 9 acrescentam aqui)
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar** — `bash run_tests.sh test_movpedidos.js` → falha (`mpAplicarPermissao is not defined`).

- [ ] **Step 3: HTML e CSS.** Botão:

```html
      <!-- §166: Movimentações dos pedidos (APIs da Xeotech) — admin/supervisor; supervisor vê só a operação dele -->
      <button data-tab="movpedidos" id="tabBtnMovPedidos" style="display:none" data-sub="Movimentações no NEO, tempo por etapa e vendas perdidas"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4"/></svg><span class="sbLabel">Movimentações</span></button>
```

Painel e gaveta:

```html
    <!-- §166 Movimentações dos pedidos: Feed do dia / Tempo por etapa / Vendas perdidas -->
    <section class="panel" id="panel-movpedidos">
      <div class="mpTopo">
        <button type="button" class="filterPill active" data-mp-sub="feed">Feed do dia</button>
        <button type="button" class="filterPill" data-mp-sub="tempo">Tempo por etapa</button>
        <button type="button" class="filterPill" data-mp-sub="vp">Vendas perdidas</button>
        <span class="mpAtualizado" id="mpAtualizado"></span>
      </div>
      <div class="mpFiltros" id="mpFiltros"></div>
      <div id="mpConteudo"></div>
    </section>
    <aside class="kbFicha" id="mpFicha" aria-label="Linha do tempo do pedido"><div class="kbFichaCorpo" id="mpFichaCorpo"></div></aside>
```

CSS:

```css
  /* §166 Movimentações dos pedidos */
  .mpTopo,.mpFiltros{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-3);}
  .mpAtualizado{margin-left:auto;font-size:var(--fs-sm);color:var(--muted);}
  .mpAtualizado.mpAtrasado{color:var(--st-perdido);font-weight:600;}
  .mpFeed{list-style:none;margin:0;padding:0;}
  .mpFeed li{display:flex;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--c-linha);font-size:var(--fs-sm);}
  .mpFeed .mpHora{flex:0 0 92px;color:var(--muted);font-variant-numeric:tabular-nums;}
  .mpAlerta{color:var(--st-perdido);font-weight:600;}
  #mpFicha .kbFichaCorpo{padding:var(--space-4);overflow-y:auto;gap:var(--space-3);}
  .mpBarra{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--ml-surface-3);}
  .mpBarra i{display:block;height:100%;background:var(--ml-ink-3);border-right:1px solid var(--ml-surface);}
  .mpBarra i.fora{background:var(--st-perdido);}
```

- [ ] **Step 4: JS** (antes de `function scAplicarPermissao(){`):

```js
/* ============ §166 MOVIMENTAÇÕES DOS PEDIDOS ============
   Aba (admin/supervisor; o banco filtra a operação do supervisor) + gaveta "Linha do tempo do pedido" (também para o
   consultor, só pedidos dele). Tudo vem das RPCs movimentacoes_* / pedido_linha_do_tempo; o navegador nunca chama o NEO. */
const mpEstado = { sub: 'feed', dia: null, de: null, ate: null, consultor: '', etapa: '', tipo: '', selo: '', timer: null, geracao: 0, dados: null, fichaNumero: null, ficha: null };
const MP_ICONE = { bko_status: '🔵', etapa: '⚪', venda_perdida: '🟠', livre: '✎' };
const MP_TIPO = { '': 'Todos os tipos', etapa: 'Mudança de etapa', bko_status: 'Anotação da BKO', venda_perdida: 'Venda perdida', livre: 'Outras anotações' };
const MP_SELO = { saiu: '↩️ Saiu da VP', devolvido: '🔁 Devolvido e perdido', confere: '✅ Confere', diferente: '⚠️ Motivo diferente', sem: '❔ Sem como conferir' };
function mpPodeAba(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function mpAplicarPermissao(){
  mpParar(); mpEstado.geracao++; mpEstado.dados = null;
  if(typeof mpFecharPedido === 'function') mpFecharPedido();
  const b = document.getElementById('tabBtnMovPedidos'); if(b) b.style.display = mpPodeAba() ? 'inline-block' : 'none';
  const c = document.getElementById('mpConteudo'); if(c) c.innerHTML = '';
}
function mpParar(){ clearInterval(mpEstado.timer); mpEstado.timer = null; }
function mpHora(iso){ return iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'; }
function mpDuracao(h){
  if(h == null || !isFinite(h)) return '—';
  if(h < 1) return Math.max(1, Math.round(h * 60)) + ' min';
  if(h < 24) return Math.round(h) + ' h';
  const d = Math.floor(h / 24); return d + ' d ' + Math.round(h - d * 24) + ' h';
}
function mpHoras(a, b){ return ((b ? new Date(b) : new Date()) - new Date(a)) / 3600000; }
function mpLinkPedido(n){ return `<a href="#" data-mp-pedido="${escapeHtml(n)}">${escapeHtml(n)}</a>`; }
function mpOpcoes(lista, atual, rotuloTodos){
  return `<option value="">${escapeHtml(rotuloTodos)}</option>` + (lista || []).map(v => `<option value="${escapeHtml(v)}"${v === atual ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}
async function mpAbrir(){
  if(!mpEstado.dia){ mpEstado.dia = hojeSP(); mpEstado.ate = hojeSP(); mpEstado.de = somaDiasStr(hojeSP(), -30); }
  mpParar(); await mpCarregar();
  mpEstado.timer = setInterval(() => { if(mpEstado.sub === 'feed') mpCarregar(); }, 300000);
}
async function mpCarregar(){
  const g = ++mpEstado.geracao, el = document.getElementById('mpConteudo'), s = mpEstado.sub;
  document.querySelectorAll('#panel-movpedidos [data-mp-sub]').forEach(b => b.classList.toggle('active', b.dataset.mpSub === s));
  if(!mpEstado.dados) el.innerHTML = '<p class="kbMeta">Carregando…</p>';
  const r = await ppSeguro(() => s === 'feed'
    ? sb.rpc('movimentacoes_feed', { p_dia: mpEstado.dia, p_consultor: mpEstado.consultor || null, p_etapa: mpEstado.etapa || null, p_tipo: mpEstado.tipo || null })
    : s === 'tempo'
      ? sb.rpc('movimentacoes_tempo_etapa', { p_de: mpEstado.de, p_ate: mpEstado.ate, p_consultor: mpEstado.consultor || null })
      : sb.rpc('vendas_perdidas_auditoria', { p_de: mpEstado.de, p_ate: mpEstado.ate }));
  if(g !== mpEstado.geracao) return;
  if(r.error || !r.data){ el.innerHTML = `<p class="rnErro">Não foi possível carregar: ${escapeHtml((r.error && r.error.message) || 'sem resposta')}</p>`; return; }
  mpEstado.dados = r.data;
  if(s === 'feed') mpPintarFeed(r.data); else if(s === 'tempo') mpPintarTempo(r.data); else mpPintarVP(r.data);
}
function mpPintarFeed(d){
  const at = document.getElementById('mpAtualizado');
  at.textContent = d.atualizado_em ? 'Atualizado às ' + mpHora(d.atualizado_em) : 'Ainda sem sincronização';
  at.classList.toggle('mpAtrasado', !d.atualizado_em || Date.now() - new Date(d.atualizado_em) > 30 * 60000);
  document.getElementById('mpFiltros').innerHTML =
    `<input type="date" class="rnSel" data-mp-filtro="dia" value="${escapeHtml(mpEstado.dia)}">`
    + `<select class="rnSel" data-mp-filtro="consultor">${mpOpcoes(d.consultores, mpEstado.consultor, 'Todos os consultores')}</select>`
    + `<select class="rnSel" data-mp-filtro="etapa">${mpOpcoes(d.etapas, mpEstado.etapa, 'Todas as etapas')}</select>`
    + `<select class="rnSel" data-mp-filtro="tipo">${Object.entries(MP_TIPO).map(([v, t]) => `<option value="${v}"${v === mpEstado.tipo ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  const k = d.kpis || {};
  const kpis = `<div class="kpiGrid"><div class="kpiCard"><b class="rnN">${k.movimentacoes || 0}</b><span>Movimentações</span></div>`
    + `<div class="kpiCard"><b class="rnN">${k.anotacoes_bko || 0}</b><span>Anotações da BKO</span></div>`
    + `<div class="kpiCard"><b class="rnN">${k.entradas_vp || 0}</b><span>Entradas em Venda Perdida</span></div></div>`;
  const linha = (e) => {
    const o = e.tipo === 'etapa' ? `→ ${escapeHtml(e.etapa || '')}${e.quem ? ' · por ' + escapeHtml(e.quem) : ''}`
      : e.tipo === 'bko_status' ? `<b>${escapeHtml(e.status || '')}</b>${e.descricao ? ' · ' + escapeHtml(e.descricao) : ''}`
      : e.tipo === 'venda_perdida' ? `Venda Perdida${e.vp_categoria ? ' · "' + escapeHtml(e.vp_categoria) + '"' : ''}`
      : escapeHtml(e.etapa || '');
    const icone = e.tipo === 'etapa' && /^VENDA PERDIDA/i.test(e.etapa || '') ? MP_ICONE.venda_perdida : (MP_ICONE[e.tipo] || '');
    return `<li><span class="mpHora">${mpHora(e.em)}</span><span>${icone} ${mpLinkPedido(e.numero)} · ${escapeHtml(e.cliente || '')} · ${escapeHtml(e.consultor || '')} · ${o}</span></li>`;
  };
  const itens = d.itens || [];
  document.getElementById('mpConteudo').innerHTML = kpis
    + (itens.length ? `<ul class="mpFeed">${itens.map(linha).join('')}</ul>` : '<p class="rnVazio">Nada neste dia com esses filtros.</p>');
}
document.addEventListener('change', (ev) => {
  const f = ev.target.closest && ev.target.closest('#mpFiltros [data-mp-filtro]');
  if(!f) return;
  mpEstado[f.dataset.mpFiltro] = f.value; mpEstado.dados = null; mpCarregar();
});
document.addEventListener('click', (ev) => {
  const sub = ev.target.closest && ev.target.closest('#panel-movpedidos [data-mp-sub]');
  if(sub){ mpEstado.sub = sub.dataset.mpSub; mpEstado.consultor = ''; mpEstado.etapa = ''; mpEstado.tipo = ''; mpEstado.selo = ''; mpEstado.dados = null; mpCarregar(); return; }
  const ped = ev.target.closest && ev.target.closest('[data-mp-pedido]');
  if(ped){ ev.preventDefault(); if(typeof mpAbrirPedido === 'function') mpAbrirPedido(ped.dataset.mpPedido); }
});
```

Até as Tasks 7/8 existirem, `mpPintarTempo`/`mpPintarVP` não são chamadas (o teste da Task 6 só usa o feed).

Gancho na troca de aba (logo depois da linha `if(btn.dataset.tab === 'socios') scAbrir(); else scParar(); // §157`):

```js
  if(btn.dataset.tab === 'movpedidos') mpAbrir(); else mpParar(); // §166
```

Login (logo depois de `scAplicarPermissao(); // §157 …`):

```js
    mpAplicarPermissao(); // §166 Movimentações (admin/supervisor)
```

- [ ] **Step 5: Rodar** — `bash run_tests.sh test_movpedidos.js` → `0 falharam`; depois `bash run_tests.sh test_socios_aba.js` → `0 falharam`.
- [ ] **Step 6: Divs** — `python -c "t=open('_template.html',encoding='utf-8').read();print(t.count('<div'),t.count('</div>'))"` antes e depois: a diferença entre os dois números não muda.
- [ ] **Step 7: Commit** (mostrar) — `feat(painel): §166 aba Movimentações com o feed do dia`.

---

### Task 7: Painel — Tempo por etapa e parados

**Files:** Modify `_template.html` (módulo §166), `test_movpedidos.js`.

**Interfaces:** Consumes `movimentacoes_tempo_etapa`, `movimentacoes_parados` (Task 4); helpers da Task 6. Produces `mpPintarTempo(d)`, `mpCarregarParados(etapa)`.

- [ ] **Step 1: Teste** (em `test_movpedidos.js`, antes de `fim()`):

```js
  window.__rpcRespostas.movimentacoes_tempo_etapa = () => ({ data: { etapas: [
    { etapa: 'CREDITO', passagens: 12, mediana_h: 6, p90_h: 26, fora_sla_pct: 18, parados: 3 } ], consultores: ['ZZ CONS A'] }, error: null });
  window.__rpcRespostas.movimentacoes_parados = () => ({ data: { itens: [{ numero: 'ZZM2', cliente: 'ZZ CLIENTE 2', consultor: 'ZZ CONS C', desde: '2026-11-21T11:00:00Z', sla_horas: 8 }] }, error: null });
  clicar(q('#tabsNav button[data-tab="movpedidos"]')); await espera(30);
  clicar(q('#panel-movpedidos [data-mp-sub="tempo"]')); await espera(30);
  const t = q('#mpConteudo').textContent;
  assert(/CREDITO/.test(t) && /6 h/.test(t) && /1 d 2 h/.test(t) && /18%/.test(t), 'tabela do tempo por etapa');
  clicar(q('#mpConteudo [data-mp-parados="CREDITO"]')); await espera(30);
  eq(chamadas('movimentacoes_parados').at(-1).args, { p_etapa: 'CREDITO' }, 'parados da etapa');
  assert(/ZZM2/.test(q('#mpParados').textContent) && q('#mpParados .mpAlerta'), 'lista de parados com alerta de SLA');
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (no módulo §166):

```js
function mpPintarTempo(d){
  document.getElementById('mpFiltros').innerHTML =
    `<input type="date" class="rnSel" data-mp-filtro="de" value="${escapeHtml(mpEstado.de)}"> até `
    + `<input type="date" class="rnSel" data-mp-filtro="ate" value="${escapeHtml(mpEstado.ate)}">`
    + `<select class="rnSel" data-mp-filtro="consultor">${mpOpcoes(d.consultores, mpEstado.consultor, 'Todos os consultores')}</select>`;
  const linhas = (d.etapas || []).map(e => `<tr><td>${escapeHtml(e.etapa)}</td><td class="num">${e.passagens}</td>`
    + `<td class="num">${mpDuracao(e.mediana_h)}</td><td class="num">${mpDuracao(e.p90_h)}</td>`
    + `<td class="num">${e.fora_sla_pct == null ? '—' : e.fora_sla_pct + '%'}</td>`
    + `<td class="num">${e.parados ? `<a href="#" data-mp-parados="${escapeHtml(e.etapa)}">${e.parados}</a>` : '0'}</td></tr>`).join('');
  document.getElementById('mpConteudo').innerHTML = linhas
    ? `<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Etapa</th><th>Passagens</th><th>Tempo típico</th><th>9 em cada 10 até</th><th>Fora do SLA</th><th>Parados agora</th></tr></thead><tbody>${linhas}</tbody></table></div><div id="mpParados"></div>`
    : '<p class="rnVazio">Nenhuma passagem neste período.</p>';
}
async function mpCarregarParados(etapa){
  const el = document.getElementById('mpParados'); if(!el) return;
  el.innerHTML = '<p class="kbMeta">Carregando…</p>';
  const r = await ppSeguro(() => sb.rpc('movimentacoes_parados', { p_etapa: etapa }));
  if(r.error || !r.data){ el.innerHTML = '<p class="rnErro">Não foi possível carregar os parados.</p>'; return; }
  const itens = r.data.itens || [];
  el.innerHTML = `<h3>Parados agora em ${escapeHtml(etapa)}</h3>` + (itens.length ? `<ul class="mpFeed">${itens.map(p => {
    const h = mpHoras(p.desde), fora = p.sla_horas > 0 && h > p.sla_horas;
    return `<li><span class="mpHora">${mpHora(p.desde)}</span><span>${mpLinkPedido(p.numero)} · ${escapeHtml(p.cliente || '')} · ${escapeHtml(p.consultor || '')} · <span class="${fora ? 'mpAlerta' : ''}">${mpDuracao(h)}${fora ? ' ⚠ SLA ' + p.sla_horas + ' h' : ''}</span></span></li>`;
  }).join('')}</ul>` : '<p class="rnVazio">Nenhum pedido parado.</p>');
}
document.addEventListener('click', (ev) => {
  const p = ev.target.closest && ev.target.closest('[data-mp-parados]');
  if(p){ ev.preventDefault(); mpCarregarParados(p.dataset.mpParados); }
});
```

- [ ] **Step 4: Rodar** → `0 falharam`. **Step 5: Commit** (mostrar) — `feat(painel): §166 tempo por etapa e pedidos parados`.

---

### Task 8: Painel — sub-aba Vendas perdidas

**Files:** Modify `_template.html` (módulo §166), `test_movpedidos.js`.

**Interfaces:** Consumes `vendas_perdidas_auditoria` (Task 5); `MP_SELO`, helpers (Task 6). Produces `mpPintarVP(d)`.

- [ ] **Step 1: Teste**

```js
  window.__rpcRespostas.vendas_perdidas_auditoria = () => ({ data: {
    totais: { vp: 3, saiu: 1, devolvido: 1, confere: 1, diferente: 0, sem: 0, reais: 2 },
    por_consultor: [{ consultor: 'ZZ CONS A', vps: 3, alerta_pct: 33, categorias: ['Restrição de Crédito'] }],
    pedidos: [
      { numero: 'ZZM1', cliente: 'ZZ C1', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T14:05:00Z', categoria: 'Restrição de Crédito', bko_status: null, bko_descricao: null, bko_em: null, selo: 'devolvido', motivo_real: null },
      { numero: 'ZZM5', cliente: 'ZZ C5', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T15:00:00Z', categoria: null, bko_status: null, bko_descricao: null, bko_em: null, selo: 'saiu', motivo_real: null },
      { numero: 'ZZM6', cliente: 'ZZ C6', consultor: 'ZZ CONS A', entrou_em: '2026-11-20T13:00:00Z', categoria: 'Restrição de Crédito', bko_status: 'CONSULTA NÃO APROVADA', bko_descricao: 'X', bko_em: '2026-11-20T12:30:00Z', selo: 'confere', motivo_real: 'Restrição de Crédito' } ] }, error: null });
  clicar(q('#panel-movpedidos [data-mp-sub="vp"]')); await espera(30);
  const v = q('#mpConteudo').textContent;
  assert(/VP reais/.test(v) && /ZZ CONS A/.test(v) && /33%/.test(v), 'totais e por consultor');
  eq(q('#mpConteudo').querySelectorAll('tbody tr[data-mp-linha]').length, 3, 'três pedidos');
  clicar(q('#mpConteudo [data-mp-selo="devolvido"]')); await espera(10);
  eq(q('#mpConteudo').querySelectorAll('tbody tr[data-mp-linha]').length, 1, 'filtra pelo selo clicado');
  assert(/Devolvido e perdido/.test(q('#mpConteudo tbody tr[data-mp-linha]').textContent), 'linha do selo');
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar**

```js
function mpPintarVP(d){
  document.getElementById('mpFiltros').innerHTML =
    `<input type="date" class="rnSel" data-mp-filtro="de" value="${escapeHtml(mpEstado.de)}"> até `
    + `<input type="date" class="rnSel" data-mp-filtro="ate" value="${escapeHtml(mpEstado.ate)}">`;
  const t = d.totais || {};
  const pill = (selo, n) => `<button type="button" class="filterPill${mpEstado.selo === selo ? ' active' : ''}" data-mp-selo="${selo}">${MP_SELO[selo]} ${n || 0}</button>`;
  const topo = `<div class="mpTopo"><b>VP no período: ${t.vp || 0}</b> · VP reais (sem ↩️): <b>${t.reais || 0}</b>`
    + ['confere', 'diferente', 'saiu', 'devolvido', 'sem'].map(s => pill(s, t[s])).join('')
    + (mpEstado.selo ? '<button type="button" class="filterPill" data-mp-selo="">Todos</button>' : '') + '</div>';
  const cons = (d.por_consultor || []).map(c => `<tr><td>${escapeHtml(c.consultor || '—')}</td><td class="num">${c.vps}</td>`
    + `<td class="num${c.alerta_pct >= 30 ? ' mpAlerta' : ''}">${c.alerta_pct}%</td><td>${escapeHtml((c.categorias || []).join(', '))}</td></tr>`).join('');
  const peds = (d.pedidos || []).filter(p => !mpEstado.selo || p.selo === mpEstado.selo).map(p => '<tr data-mp-linha>'
    + `<td>${mpLinkPedido(p.numero)}</td><td>${escapeHtml(p.cliente || '')}</td><td>${escapeHtml(p.consultor || '')}</td><td>${mpHora(p.entrou_em)}</td>`
    + `<td>${escapeHtml(p.categoria || '—')}</td><td>${escapeHtml(p.bko_status || '—')}</td><td>${MP_SELO[p.selo] || ''}</td>`
    + `<td>${escapeHtml(p.motivo_real || '—')}</td></tr>`).join('');
  document.getElementById('mpConteudo').innerHTML = topo
    + `<h3>Por consultor</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Consultor</th><th>VPs</th><th>⚠️ + 🔁</th><th>Motivos mais usados</th></tr></thead><tbody>${cons}</tbody></table></div>`
    + `<h3>Pedidos</h3><div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Pedido</th><th>Cliente</th><th>Consultor</th><th>Entrou em VP</th><th>Motivo do consultor</th><th>Última anotação da BKO</th><th>Selo</th><th>Motivo real</th></tr></thead><tbody>${peds || '<tr><td colspan="8">Nenhum pedido.</td></tr>'}</tbody></table></div>`
    + '<p class="kbMeta">VPs anteriores à entrada no ar ficam quase todas em ❔: a API só mostra a última anotação de cada pedido.</p>';
}
document.addEventListener('click', (ev) => {
  const s = ev.target.closest && ev.target.closest('#mpConteudo [data-mp-selo]');
  if(s){ mpEstado.selo = s.dataset.mpSelo; if(mpEstado.dados) mpPintarVP(mpEstado.dados); }
});
```

- [ ] **Step 4: Rodar** → `0 falharam`. **Step 5: Commit** (mostrar) — `feat(painel): §166 auditoria das vendas perdidas`.

---

### Task 9: Painel — gaveta "Linha do tempo do pedido" e Motivo real

**Files:** Modify `_template.html` (módulo §166), `test_movpedidos.js`.

**Interfaces:** Consumes `pedido_linha_do_tempo`, `venda_perdida_definir_motivo` (Tasks 4/5); helpers (Task 6). Produces `mpAbrirPedido(numero)` (global, usada também pelo iframe do Dashboard), `mpFecharPedido()`, `mpPintarPedido(aviso?)`, `mpSalvarMotivo()`.

- [ ] **Step 1: Teste**

```js
  window.__rpcRespostas.pedido_linha_do_tempo = (a) => a.p_numero === 'ZZM9'
    ? { data: null, error: { message: 'sem permissão para ver este pedido', code: '42501' } }
    : { data: { cabecalho: a.p_numero === 'ZZM3' ? null : { numero: 'ZZM1', cliente: 'ZZ CLIENTE', consultor: 'ZZ CONS A', valor: 100, etapa: 'VENDA PERDIDA (NEOCRM)' },
      passagens: a.p_numero === 'ZZM3' ? [] : [
        { etapa: 'CREDITO', entrou_em: '2026-11-20T12:00:00Z', saiu_em: '2026-11-20T23:00:00Z', entrou_por: 'ZZ CONS A', saiu_por: 'ZZ BKO', sla_horas: 8, texto: null, vp_categoria: null },
        { etapa: 'VENDA PERDIDA', entrou_em: '2026-11-21T14:05:00Z', saiu_em: null, entrou_por: 'ZZ CONS A', saiu_por: null, sla_horas: null, texto: null, vp_categoria: null } ],
      anotacoes: a.p_numero === 'ZZM3' ? [] : [{ em: '2026-11-20T22:51:00Z', tipo: 'bko_status', status: 'CONSULTA NÃO APROVADA', descricao: 'REPROVADO TESTE', vp_categoria: null, texto: 'x', autor_provavel: 'ZZ BKO' }],
      motivo_real: null, pode_decidir: true, categorias: ['Não responde', 'Restrição de Crédito'] }, error: null };
  window.__rpcRespostas.venda_perdida_definir_motivo = () => ({ data: { ok: true }, error: null });
  clicar(q('#mpConteudo [data-mp-pedido="ZZM1"]')); await espera(40);
  assert(q('#mpFicha').classList.contains('aberta'), 'abre a gaveta');
  const f = q('#mpFichaCorpo').textContent;
  assert(/ZZ CLIENTE/.test(f) && /provável: ZZ BKO/.test(f) && /CONSULTA NÃO APROVADA/.test(f) && /SLA 8 h/.test(f), 'cabeçalho, nota com autor provável e SLA estourado');
  eq(q('#mpFichaCorpo .mpBarra').querySelectorAll('i.fora').length, 1, 'barra marca a etapa fora do SLA');
  q('#mpMotivo').value = 'Restrição de Crédito'; q('#mpObs').value = 'BKO reprovou';
  clicar(q('[data-mp-salvar]')); await espera(30);
  eq(chamadas('venda_perdida_definir_motivo').at(-1).args, { p_numero: 'ZZM1', p_motivo: 'Restrição de Crédito', p_obs: 'BKO reprovou' }, 'salva o motivo real');
  mpAbrirPedido('ZZM3'); await espera(30);
  assert(/ZZM3/.test(q('#mpFichaCorpo').textContent) && /Histórico começa em 01/.test(q('#mpFichaCorpo').textContent), 'pedido sem histórico abre com o número e o aviso');
  mpAbrirPedido('ZZM9'); await espera(30);
  assert(/sem permissão/.test(q('#mpFichaCorpo').textContent), 'sem permissão avisa na gaveta');
  clicar(q('[data-mp-fechar]')); await espera(10);
  assert(!q('#mpFicha').classList.contains('aberta'), 'fecha');
  currentUser = { id: 'u-c', nome: 'Zzc', role: 'consultor', operacao: 'apex', equipe: null };
  mpAbrirPedido('ZZM1'); await espera(30);
  assert(q('#mpFicha').classList.contains('aberta'), 'consultor também abre a gaveta (a RPC decide)');
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar**

```js
async function mpAbrirPedido(numero){
  numero = String(numero || '').trim(); if(!numero) return;
  mpEstado.fichaNumero = numero; mpEstado.ficha = null;
  document.getElementById('mpFicha').classList.add('aberta');
  mpPintarPedido('Carregando…');
  const r = await ppSeguro(() => sb.rpc('pedido_linha_do_tempo', { p_numero: numero }));
  if(mpEstado.fichaNumero !== numero) return;
  if(r.error || !r.data){ mpPintarPedido(r.error && /permiss/i.test(r.error.message || '') ? 'Você não tem permissão para ver este pedido (sem permissão).' : 'Não foi possível carregar o pedido.'); return; }
  mpEstado.ficha = r.data; mpPintarPedido();
}
function mpFecharPedido(){ mpEstado.fichaNumero = null; mpEstado.ficha = null; const f = document.getElementById('mpFicha'); if(f) f.classList.remove('aberta'); }
function mpPintarPedido(aviso){
  const el = document.getElementById('mpFichaCorpo'), n = mpEstado.fichaNumero, d = mpEstado.ficha;
  const topo = `<div class="mpTopo"><h3 style="margin:0">Pedido ${escapeHtml(n || '')}</h3><button type="button" class="btn btn-sm btn-outline" data-mp-fechar style="margin-left:auto">Fechar</button></div>`;
  if(!d){ el.innerHTML = topo + `<p class="kbMeta">${escapeHtml(aviso || '')}</p>`; return; }
  const c = d.cabecalho;
  const cab = c ? `<p class="kbMeta">${escapeHtml(c.cliente || '')} · ${escapeHtml(c.consultor || '')} · ${fmtBRL(Number(c.valor) || 0)} · <b>${escapeHtml(c.etapa || '')}</b></p>` : '';
  const ps = d.passagens || [];
  const total = ps.reduce((s, p) => s + Math.max(mpHoras(p.entrou_em, p.saiu_em), 0), 0) || 1;
  const barra = ps.length ? `<div class="mpBarra">${ps.map(p => { const h = Math.max(mpHoras(p.entrou_em, p.saiu_em), 0);
    return `<i class="${p.sla_horas > 0 && h > p.sla_horas ? 'fora' : ''}" style="width:${(100 * h / total).toFixed(2)}%" title="${escapeHtml(p.etapa)} · ${mpDuracao(h)}"></i>`; }).join('')}</div>` : '';
  const ev = ps.map(p => { const h = mpHoras(p.entrou_em, p.saiu_em), fora = p.sla_horas > 0 && h > p.sla_horas;
      return { em: p.entrou_em, html: `${/^VENDA PERDIDA/i.test(p.etapa) ? MP_ICONE.venda_perdida : MP_ICONE.etapa} Entrou em <b>${escapeHtml(p.etapa)}</b>${p.entrou_por ? ' (por ' + escapeHtml(p.entrou_por) + ')' : ''} · ficou <span class="${fora ? 'mpAlerta' : ''}">${mpDuracao(h)}${p.saiu_em ? '' : ' até agora'}${fora ? ' ⚠ SLA ' + p.sla_horas + ' h' : ''}</span>${p.vp_categoria ? ' · "' + escapeHtml(p.vp_categoria) + '"' : ''}` }; })
    .concat((d.anotacoes || []).map(a => ({ em: a.em, html: a.tipo === 'bko_status'
      ? `${MP_ICONE.bko_status} BKO${a.autor_provavel ? ' · provável: ' + escapeHtml(a.autor_provavel) : ''}<br><b>${escapeHtml(a.status || '')}</b>${a.descricao ? '<br>' + escapeHtml(a.descricao) : ''}`
      : a.tipo === 'venda_perdida' ? `${MP_ICONE.venda_perdida} Venda Perdida${a.vp_categoria ? ' · "' + escapeHtml(a.vp_categoria) + '"' : ''}`
      : `${MP_ICONE.livre} ${escapeHtml(a.texto || '')}` })))
    .sort((a, b) => new Date(b.em) - new Date(a.em));
  const linha = ev.length ? `<ul class="mpFeed">${ev.map(e => `<li><span class="mpHora">${mpHora(e.em)}</span><span>${e.html}</span></li>`).join('')}</ul>`
    : '<p class="rnVazio">Histórico começa em 01/09: este pedido ainda não tem movimentações guardadas.</p>';
  let motivo = '';
  if(d.pode_decidir){
    const m = d.motivo_real;
    motivo = `<div class="card"><h3>Motivo real</h3>${m ? `<p class="kbMeta">Definido: <b>${escapeHtml(m.motivo)}</b> por ${escapeHtml(m.por || '')} em ${mpHora(m.em)}${m.obs ? ' · ' + escapeHtml(m.obs) : ''}</p>` : ''}`
      + `<select class="rnSel" id="mpMotivo">${mpOpcoes(d.categorias, m ? m.motivo : '', 'Escolha o motivo')}</select>`
      + `<textarea class="rnSel" id="mpObs" rows="2" placeholder="Observação (opcional)" style="width:100%;height:auto;margin-top:8px">${escapeHtml((m && m.obs) || '')}</textarea>`
      + '<button type="button" class="btn btn-sm" data-mp-salvar style="margin-top:8px">Salvar motivo real</button></div>';
  }
  el.innerHTML = topo + cab + barra + linha + motivo;
}
async function mpSalvarMotivo(){
  const n = mpEstado.fichaNumero, motivo = (document.getElementById('mpMotivo') || {}).value || '';
  if(!motivo){ mostrarAviso('Escolha o motivo real.', 'erro'); return; }
  const r = await ppSeguro(() => sb.rpc('venda_perdida_definir_motivo', { p_numero: n, p_motivo: motivo, p_obs: (document.getElementById('mpObs') || {}).value || null }));
  if(r.error){ mostrarAviso('Não foi possível salvar: ' + (r.error.message || ''), 'erro'); return; }
  mostrarAviso('Motivo real salvo.', 'ok');
  await mpAbrirPedido(n);
  if(mpEstado.sub === 'vp' && document.getElementById('panel-movpedidos').classList.contains('active')) mpCarregar();
}
document.addEventListener('click', (ev) => {
  if(ev.target.closest && ev.target.closest('[data-mp-fechar]')){ mpFecharPedido(); return; }
  if(ev.target.closest && ev.target.closest('[data-mp-salvar]')) mpSalvarMotivo();
});
document.addEventListener('keydown', (ev) => { if(ev.key === 'Escape' && mpEstado.fichaNumero) mpFecharPedido(); });
```

- [ ] **Step 4: Rodar** `bash run_tests.sh test_movpedidos.js` → `0 falharam`; conferir divs. **Step 5: Commit** (mostrar) — `feat(painel): §166 gaveta com a linha do tempo do pedido e motivo real`.

---

### Task 10: Links do Dashboard (Pedidos em Alerta e Vendas Perdidas) abrem a gaveta

**Files:** Modify `_template.html` (só a constante `PRODUCAO_DASHBOARD_TPL_B64`, via `dashboard_tpl.py`); Modify `test_vendas_perdidas.js` (um assert).

**Interfaces:** Consumes `window.parent.mpAbrirPedido` (Task 9). O iframe `#producaoFrame` usa `srcdoc` sem `sandbox` → mesma origem.

- [ ] **Step 1: Extrair** — `python dashboard_tpl.py extrair` (gera `_dashboard_producao.html`, fora do git).
- [ ] **Step 2: Editar `_dashboard_producao.html`**
  - Vendas Perdidas (render de `perdBody`): trocar `<td>${txt(l.numero_pedido)}</td>` por `<td><a href="#" data-mp-pedido="${escAttr(String(l.numero_pedido ?? ''))}">${txt(l.numero_pedido)}</a></td>`.
  - Pedidos em Alerta (render de `alertaBody`): trocar `<td>${escHtml(p.numero_pedido)}</td>` por `<td><a href="#" data-mp-pedido="${escAttr(p.numero_pedido)}">${escHtml(p.numero_pedido)}</a></td>`.
  - No fim do último `<script>` do dashboard:

```js
// §166: número do pedido abre a gaveta "Linha do tempo" do painel (iframe srcdoc = mesma origem).
document.addEventListener('click', function(ev){
  var a = ev.target.closest && ev.target.closest('[data-mp-pedido]');
  if(!a) return;
  ev.preventDefault();
  try{ if(window.parent && typeof window.parent.mpAbrirPedido === 'function') window.parent.mpAbrirPedido(a.getAttribute('data-mp-pedido')); }catch(_e){ /* fora do painel */ }
});
```

- [ ] **Step 3: Empacotar** — `python dashboard_tpl.py empacotar` e `python build_painel.py`.
- [ ] **Step 4: Teste** — em `test_vendas_perdidas.js`, na Parte 1, logo depois do primeiro assert que já confere linhas em `#perdBody`, acrescentar (com a variável de documento que o teste já usa ali):

```js
assert(doc.querySelector('#perdBody a[data-mp-pedido]'), 'número do pedido em Vendas Perdidas vira link para a gaveta (§166)');
```

Rodar `bash run_tests.sh test_vendas_perdidas.js` e `bash run_tests.sh test_pedidos_alerta.js` → `0 falharam`.
- [ ] **Step 5: Commit** (mostrar) — `feat(dashboard): §166 número do pedido abre a linha do tempo`.

---

### Task 11: Cron e REGRAS_NEGOCIO §166

**Files:**
- Create: `supabase/migrations/20261124120100_movimentacoes_pedidos_cron.sql`
- Modify: `REGRAS_NEGOCIO.md` (seção nova no fim)

- [ ] **Step 1: Cron** (pg_cron roda em UTC: 08–22 h SP = 11–01 h UTC)

```sql
-- 24/11/2026 — §166 sync-pedidos-neo. Atualizações a cada 10 min das 08 às 22 h SP (:03…:53) e 1x/h fora disso (:03);
-- Movimentação :08 e :38. ≥ 5 min entre as duas (guarda de 120 s da Xeotech). Segredo no Vault, como as outras.
select cron.unschedule(jobid) from cron.job where jobname in ('neo-pedidos-atualizacoes-dia', 'neo-pedidos-atualizacoes-noite', 'neo-pedidos-movimentacao');
select cron.schedule('neo-pedidos-atualizacoes-dia', '3,13,23,33,43,53 0,1,11-23 * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"atualizacoes"}'::jsonb, timeout_milliseconds := 120000);
$job$);
select cron.schedule('neo-pedidos-atualizacoes-noite', '3 2-10 * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"atualizacoes"}'::jsonb, timeout_milliseconds := 120000);
$job$);
select cron.schedule('neo-pedidos-movimentacao', '8,38 * * * *', $job$
  select net.http_post(url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-pedidos-neo',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{"api":"movimentacao"}'::jsonb, timeout_milliseconds := 120000);
$job$);
```

- [ ] **Step 2: REGRAS** — `git fetch oficial` e conferir que §166 continua livre (`git show oficial/main:REGRAS_NEGOCIO.md | grep -n '^## §16'`). Escrever `## §166 Movimentações dos pedidos: APIs Movimentação + Atualizações da Xeotech (24/11/2026, pedido do Rafael)` com: objetivo (3 itens), tabelas e chaves, Edge Function e agenda, quem vê (tabela de cargos), selos da VP e motivo real, as "mudanças do spec decididas no plano", limites (diário só a partir da entrada no ar; a Atualizações mostra só a última nota), arquivos, testes (`pedidos.test.ts`, `movimentacoes_pedidos_check.sql`, `test_movpedidos.js`) e como desligar (`select cron.unschedule(jobid) from cron.job where jobname like 'neo-pedidos-%';`). Status: "implementado, não publicado".
- [ ] **Step 3: Suíte inteira** — `bash run_tests.sh` → só as falhas que já existem na `oficial/main` (conferir rodando o mesmo teste lá) e os pulados.
- [ ] **Step 4: Commit** (mostrar) — `docs(regras): §166 movimentações dos pedidos (+ cron)`.

---

### Task 12: Entrada no ar (cada passo com ok do Rafael naquele momento)

Sem código novo; é a ordem do spec §8. Registrar cada passo na §166.

- [ ] **1. Migration** — dry-run final (migration + check → `RESULTADO: ok`), depois aplicar a migration com `execute_sql` em `begin; … commit;` (sem `drop`). Conferir: `select count(*) from public.vp_motivo_equivalencia` = 1; `select has_function_privilege('anon', 'public.movimentacoes_feed(date,text,text,text)', 'execute')` = false.
- [ ] **2. Secret** — **o Rafael** cria `NEO_PEDIDOS_TOKEN` no Supabase (Edge Functions → Secrets). Eu não leio nem digito o token.
- [ ] **3. Deploy** — `deploy_edge_function` com `index.ts` + `pedidos.ts` (nome `sync-pedidos-neo`, `verify_jwt: false`, como a `sync-exportacao`). Chamada em **modo teste** de Atualizações via `execute_sql` com `net.http_post` (corpo `{"api":"atualizacoes","modo":"teste"}`, header do Vault) e leitura em `net._http_response`. Esperado: `ok:true`. Depois uma chamada real e conferir `neo_pedidos_sync_log` (ok, janela de ~1 h).
- [ ] **4. Carga + crons à noite (depois das 22 h)** — linha-semente: `insert into public.neo_pedidos_sync_log (api, janela_ini, janela_fim, ok, erro) values ('movimentacao', '2026-09-01 00:00-03', '2026-09-01 00:00-03', true, 'semente da carga inicial §166');` e aplicar a migration do cron. O job `:08/:38` anda 7 dias por vez (≈ 13 execuções). Na manhã seguinte: `select api, count(*) filter (where ok), count(*) filter (where not ok), max(janela_fim) from public.neo_pedidos_sync_log group by 1;`, `select pg_size_pretty(pg_total_relation_size('public.pedido_movimentacoes'));` e o tamanho do banco.
- [ ] **5. Painel** — processo de sempre (memória "Publicação do painel"): `bash run_tests.sh` completo, baixar o do ar e comparar com o gerado, backup, envio com MD5 no mesmo comando, abrir a aba com um supervisor e a gaveta com um consultor.
- [ ] **6. Oficial** — `git fetch oficial`, merge da `oficial/main` na branch, testes, push sem force (ok do Rafael).
- [ ] **7. Pedido à Xeotech** — rascunho meu (expor o log completo de `pedido_movimentacao` na API); **o Rafael envia**.
- [ ] **8. Equivalências** — depois de ~2 semanas: `select status, count(*) from public.pedido_anotacoes where tipo = 'bko_status' group by 1 order by 2 desc;` e montar com o Rafael as linhas de `vp_motivo_equivalencia` (insert com ok).
