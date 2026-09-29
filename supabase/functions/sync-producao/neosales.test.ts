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

test("envia o corpo esperado como text/plain", async () => {
  let visto: { init?: RequestInit } = {};
  const fetchImpl = (_u: unknown, init?: RequestInit) => { visto = { init }; return Promise.resolve(new Response("[]")); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as typeof fetch });
  assert.deepEqual(await buscar("2026-09-29 10:00:00", "2026-09-29 11:00:00"), []);
  assert.equal((visto.init!.headers as Record<string, string>)["Content-Type"], "text/plain");
  assert.deepEqual(JSON.parse(String(visto.init!.body)), {
    tokenEstrutura: "TE", tokenUsuario: "TU", painelId: "15455", outputFormat: "json",
    dataHoraInicioCarga: "2026-09-29 10:00:00", dataHoraFimCarga: "2026-09-29 11:00:00",
  });
});

// A NeoSales só aceita 1 consulta a cada ~2 min: repetir logo depois de uma falha bateria nesse intervalo,
// esconderia a causa real ("Aguarde N segundos" no lugar do timeout) e estouraria o tempo da função.
test("HTTP 5xx: NÃO repete e registra o status", async () => {
  let n = 0;
  const fetchImpl = () => { n++; return Promise.resolve(new Response("boom", { status: 502 })); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
  await assert.rejects(buscar("a", "b"), /HTTP 502/);
  assert.equal(n, 1);
});

test("erro da API (token vencido) falha na primeira, com a mensagem da NeoSales", async () => {
  let n = 0;
  const fetchImpl = () => { n++; return Promise.resolve(new Response('{"erro":"Token Usuário Inválido","success":false}')); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
  await assert.rejects(buscar("a", "b"), /Token Usu/);
  assert.equal(n, 1);
});

test("falha de rede (TypeError): NÃO repete, o erro original é o registrado", async () => {
  let n = 0;
  const fetchImpl = () => { n++; return Promise.reject(new TypeError("fetch failed")); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
  await assert.rejects(buscar("a", "b"), /fetch failed/);
  assert.equal(n, 1);
});

test("timeout: NÃO repete e a falha registrada é o timeout", async () => {
  let n = 0;
  const fetchImpl = () => { n++; const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; return Promise.reject(e); };
  const buscar = criarBuscarNeo(cfg, { fetchImpl: fetchImpl as unknown as typeof fetch });
  await assert.rejects(buscar("a", "b"), /timeout/);
  assert.equal(n, 1);
});
