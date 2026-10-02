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
