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
