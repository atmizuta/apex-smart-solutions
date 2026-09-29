import { test } from "node:test";
import assert from "node:assert/strict";
import { escolherCursor, executarSync } from "./sync.ts";
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

test("escolherCursor: só conta execuções ok, não-manuais e de janela completa (sem observação de redução)", () => {
  const logs = [
    { ok: true, modo: "horario", janela_fim: "2026-09-29T20:00:00Z", observacao: null },
    { ok: true, modo: "horario", janela_fim: "2026-09-29T21:00:00Z", observacao: "Janela reduzida a 85 min (limite diurno da API)" },
    { ok: true, modo: "manual", janela_fim: "2026-09-29T22:00:00Z", observacao: null },
    { ok: false, modo: "horario", janela_fim: "2026-09-29T23:00:00Z", observacao: null },
    { ok: null, modo: "horario", janela_fim: "2026-09-30T00:00:00Z", observacao: null },
  ];
  assert.equal(escolherCursor(logs)?.toISOString(), "2026-09-29T20:00:00.000Z");
  assert.equal(escolherCursor([]), null);
});
