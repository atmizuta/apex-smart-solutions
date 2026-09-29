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
