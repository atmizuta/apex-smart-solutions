import { test } from "node:test";
import assert from "node:assert/strict";
import { validarLote, processar, MAX_LOTE } from "./ingest.ts";
import type { DepsIngest, LinhaDiscador } from "./ingest.ts";

const base = {
  id: 244000001, gerada_em: "2026-10-02T15:14:20-03:00", conectada_em: "2026-10-02T15:14:30-03:00",
  atendida_em: "2026-10-02T15:14:32-03:00", fim_em: "2026-10-02T15:16:00-03:00", status: "ANSWERED", agente_id: 189,
  seg_espera: 2, seg_falados: 88, seg_total: 100, tabulacao: "SEM AVANÇO", carga_id: 14162, carga: "ZZ-CARGA",
  campanha: "ZZ-CAMPANHA", cnpj: "00000000000101", telefone: "11900000001", operadora_base: "ZZ-OPERADORA",
  cidade: "ZZCIDADE", regiao: "SUDESTE", gravacao: "1003/2026/10/02/DIALER-1",
};

function depsFalsas() {
  const gravadas: LinhaDiscador[][] = [];
  const logs: unknown[] = [];
  const deps: DepsIngest = {
    async gravarChamadas(l) { gravadas.push(l); },
    async gravarLog(l) { logs.push(l); },
    async contarPeriodo() { return 42; },
  };
  return { deps, gravadas, logs };
}

test("validarLote: linha completa vira LinhaDiscador com chave_tel", () => {
  const r = validarLote([base]);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas[0], { ...base, chave_tel: "1100000001" });
});
test("validarLote: linha mínima (só id, gerada_em, status) é válida; resto vira null", () => {
  const r = validarLote([{ id: 5, gerada_em: base.gerada_em, status: "BUSY" }]);
  assert.equal(r.invalidas, 0);
  const l = r.linhas[0];
  assert.equal(l.agente_id, null);
  assert.equal(l.seg_falados, null);
  assert.equal(l.cnpj, null);
  assert.equal(l.chave_tel, null);
});
test("validarLote: campos fora da lista (nome, cpf) nunca passam", () => {
  const r = validarLote([{ ...base, nome: "FULANO", cpf: "00000000000", documento_1: "x" }]);
  assert.equal(r.invalidas, 0);
  assert.equal("nome" in r.linhas[0], false);
  assert.equal("cpf" in r.linhas[0], false);
  assert.equal("documento_1" in r.linhas[0], false);
});
test("validarLote: só id, gerada_em e status inválidos derrubam a linha", () => {
  const ruins = [
    { ...base, id: 0 }, { ...base, id: "12" }, { ...base, id: 1.5 },
    { ...base, id: 11, gerada_em: "02/10/2026 15:14:20" },
    { ...base, id: 12, gerada_em: "2026-02-30T10:00:00-03:00" },
    { ...base, id: 13, status: "" }, { ...base, id: 14, status: "answered; drop" },
    null, [1], "texto",
  ];
  const r = validarLote(ruins);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.invalidas, ruins.length);
});
test("validarLote: campo opcional inválido vira null e a linha entra (spec §5: o resto pode ser nulo)", () => {
  const r = validarLote([{
    ...base, agente_id: 0, carga_id: -3, seg_falados: 90000, cnpj: "123", telefone: "abc", fim_em: "ontem",
    tabulacao: "x".repeat(201), cidade: { a: 1 },
  }]);
  assert.equal(r.invalidas, 0);
  const l = r.linhas[0];
  assert.deepEqual(
    [l.agente_id, l.carga_id, l.seg_falados, l.cnpj, l.telefone, l.chave_tel, l.fim_em, l.tabulacao, l.cidade],
    [null, null, null, null, null, null, null, null, null],
  );
  assert.equal(l.status, "ANSWERED");
  assert.equal(l.carga, base.carga);
});
test("validarLote: id repetido no lote entra uma vez", () => {
  const r = validarLote([base, { ...base, tabulacao: "RETORNO" }]);
  assert.equal(r.linhas.length, 1);
});
test("validarLote: mais de 500 → erro; não-lista → erro", () => {
  assert.throws(() => validarLote(Array.from({ length: MAX_LOTE + 1 }, (_, i) => ({ ...base, id: i + 1 }))), /lote/);
  assert.throws(() => validarLote({}), /lote/);
});
test("processar lote: grava e devolve só contagens", async () => {
  const { deps, gravadas } = depsFalsas();
  const r = await processar({ acao: "lote", execucao_id: "00000000-0000-0000-0000-000000000001", lote: [base, { id: 0 }] }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { recebidas: 2, gravadas: 1, invalidas: 1 });
  assert.equal(gravadas.length, 1);
  assert.equal(JSON.stringify(r.corpo).includes("11900000001"), false);
});
test("processar lote vazio: não chama o banco", async () => {
  const { deps, gravadas } = depsFalsas();
  const r = await processar({ acao: "lote", lote: [] }, deps);
  assert.equal(r.status, 200);
  assert.equal(gravadas.length, 0);
});
test("processar final: grava log validado; resumo ruim → 400", async () => {
  const { deps, logs } = depsFalsas();
  const ok = await processar({
    acao: "final", execucao_id: "00000000-0000-0000-0000-000000000001", iniciou_em: "2026-10-14T19:00:00Z", ok: true,
    lidas: 10, enviadas: 9, invalidas: 1, periodo_de: "2026-10-13T00:00:00-03:00", periodo_ate: "2026-10-14T23:59:59-03:00", erro: null,
  }, deps);
  assert.equal(ok.status, 200);
  assert.equal(logs.length, 1);
  const ruim = await processar({ acao: "final", execucao_id: "x", iniciou_em: "agora", ok: true, lidas: 1, enviadas: 1, invalidas: 0 }, deps);
  assert.equal(ruim.status, 400);
});
test("processar contar e ação desconhecida", async () => {
  const { deps } = depsFalsas();
  const c = await processar({ acao: "contar", de: "2026-10-13T00:00:00-03:00", ate: "2026-10-14T23:59:59-03:00" }, deps);
  assert.deepEqual(c, { status: 200, corpo: { total: 42 } });
  assert.equal((await processar({ acao: "apagar" }, deps)).status, 400);
  assert.equal((await processar(null, deps)).status, 400);
});
test("processar: erro do banco vira 500 sem ecoar dados", async () => {
  const deps: DepsIngest = {
    async gravarChamadas() { throw new Error("falhou 11900000001"); },
    async gravarLog() {}, async contarPeriodo() { return 0; },
  };
  const r = await processar({ acao: "lote", lote: [base] }, deps);
  assert.deepEqual(r, { status: 500, corpo: { error: "erro interno" } });
});
