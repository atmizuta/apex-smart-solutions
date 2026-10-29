// Testa a lógica da Edge Function verificar-cnpj (REGRAS §127). Roda com: node --test verificar.test.ts
// DADOS FICTÍCIOS (repo público).
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificar, normalizarSituacao, lerBrasilApi, lerCnpjWs, CACHE_MS } from "./verificar.ts";
import type { Consulta, Deps, Lead } from "./verificar.ts";

const CNPJ = "00000000000131";
const BRASIL = { razao_social: "ZZ TESTE LTDA", descricao_situacao_cadastral: "BAIXADA", data_situacao_cadastral: "2024-03-12",
  descricao_motivo_situacao_cadastral: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA" };
const WS = { razao_social: "ZZ TESTE LTDA", estabelecimento: { situacao_cadastral: "Ativa", data_situacao_cadastral: "2020-01-02", motivo_situacao_cadastral: null } };
type Resp = { status: number; corpo: unknown } | "falha";

function criar(o: { usuario?: string | null; papel?: string | null; lead?: Lead | null; salva?: Consulta | null;
  respostas?: { brasilapi?: Resp; cnpjws?: Resp } } = {}) {
  const chamadas = { buscar: [] as string[], salvar: [] as Consulta[], log: [] as string[] };
  const respostas = o.respostas ?? { brasilapi: { status: 200, corpo: BRASIL } };
  const deps: Deps = {
    usuario: () => Promise.resolve(o.usuario === undefined ? "u-dono" : o.usuario),
    papel: () => Promise.resolve(o.papel === undefined ? "consultor" : o.papel),
    lead: () => Promise.resolve(o.lead === undefined ? { cnpj: "00.000.000/0001-31", dono_id: "u-dono", apagado_em: null } : o.lead),
    consultaSalva: () => Promise.resolve(o.salva ?? null),
    salvar: (c) => { chamadas.salvar.push(c); return Promise.resolve(); },
    buscar: (url) => {
      chamadas.buscar.push(url);
      const r = url.includes("brasilapi.com.br") ? respostas.brasilapi : respostas.cnpjws;
      if (!r || r === "falha") return Promise.reject(new Error("rede"));
      return Promise.resolve(r);
    },
    agora: () => new Date("2026-10-29T17:00:00Z"),
    log: (m) => { chamadas.log.push(m); },
  };
  return { deps, chamadas };
}
const pedir = (deps: Deps, over: Partial<{ auth: string | null; aba: string; lead_id: string }> = {}) =>
  verificar({ auth: "Bearer zz", aba: "OUTUBRO", lead_id: "l1", ...over }, deps);
const salva = (minAtras: number): Consulta => ({ cnpj: CNPJ, situacao: "ATIVA", situacao_desde: "2020-01-02", motivo: null,
  razao_social: "ZZ TESTE LTDA", fonte: "brasilapi", consultado_em: new Date(Date.parse("2026-10-29T17:00:00Z") - minAtras * 60000).toISOString(),
  consultado_por: "u-outro" });

test("normalizarSituacao aceita só as 5 situações da Receita", () => {
  assert.deepEqual(["Ativa", " BAIXADA ", "Inápta", "suspensa", "NULA", "XYZ", null].map(normalizarSituacao),
    ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA", null, null]);
});

test("lerBrasilApi e lerCnpjWs mapeiam os campos; SEM MOTIVO vira null", () => {
  assert.deepEqual(lerBrasilApi(BRASIL), { situacao: "BAIXADA", situacao_desde: "2024-03-12",
    motivo: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA", razao_social: "ZZ TESTE LTDA", fonte: "brasilapi" });
  assert.equal(lerBrasilApi({ ...BRASIL, descricao_motivo_situacao_cadastral: "SEM MOTIVO" })?.motivo, null);
  assert.deepEqual(lerCnpjWs(WS), { situacao: "ATIVA", situacao_desde: "2020-01-02", motivo: null, razao_social: "ZZ TESTE LTDA", fonte: "cnpjws" });
  assert.equal(lerCnpjWs({ ...WS, estabelecimento: { ...WS.estabelecimento, motivo_situacao_cadastral: { descricao: "Omissão de declarações" } } })?.motivo,
    "Omissão de declarações");
  assert.equal(lerBrasilApi({ descricao_situacao_cadastral: "XYZ" }), null);
  assert.equal(lerCnpjWs(null), null);
});

test("sem usuário → 401 e nada é consultado", async () => {
  const { deps, chamadas } = criar({ usuario: null });
  const r = await pedir(deps);
  assert.equal(r.status, 401);
  assert.equal(chamadas.buscar.length, 0);
});

test("sem aba ou lead_id → 400", async () => {
  const { deps } = criar();
  assert.equal((await pedir(deps, { aba: "" })).status, 400);
  assert.equal((await pedir(deps, { lead_id: "" })).status, 400);
});

test("lead inexistente ou apagado → 404", async () => {
  assert.equal((await pedir(criar({ lead: null }).deps)).status, 404);
  assert.equal((await pedir(criar({ lead: { cnpj: CNPJ, dono_id: "u-dono", apagado_em: "2026-10-28T10:00:00Z" } }).deps)).status, 404);
});

test("consultor que não é dono → 403 sem consultar; supervisor e admin podem", async () => {
  const outro = criar({ usuario: "u-outro" });
  assert.equal((await pedir(outro.deps)).status, 403);
  assert.equal(outro.chamadas.buscar.length, 0);
  assert.equal((await pedir(criar({ usuario: "u-sup", papel: "supervisor" }).deps)).status, 200);
  assert.equal((await pedir(criar({ usuario: "u-adm", papel: "admin" }).deps)).status, 200);
});

test("CNPJ sem 14 dígitos → 422", async () => {
  const r = await pedir(criar({ lead: { cnpj: "123.456", dono_id: "u-dono", apagado_em: null } }).deps);
  assert.equal(r.status, 422);
  assert.equal(r.corpo.erro, "cnpj_invalido");
});

test("consulta salva há menos de 10 min volta sem consultar fora; com 10 min ou mais consulta de novo", async () => {
  const novo = criar({ salva: salva(9) });
  const r = await pedir(novo.deps);
  assert.equal(r.status, 200);
  assert.equal((r.corpo.consulta as Consulta).situacao, "ATIVA");
  assert.equal(novo.chamadas.buscar.length, 0);
  assert.equal(CACHE_MS, 10 * 60 * 1000);
  const velho = criar({ salva: salva(10) });
  await pedir(velho.deps);
  assert.equal(velho.chamadas.buscar.length, 1);
});

test("BrasilAPI ok → grava e devolve a consulta com os dígitos, quem clicou e a hora", async () => {
  const { deps, chamadas } = criar();
  const r = await pedir(deps);
  const esperado: Consulta = { cnpj: CNPJ, situacao: "BAIXADA", situacao_desde: "2024-03-12", motivo: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA",
    razao_social: "ZZ TESTE LTDA", fonte: "brasilapi", consultado_em: "2026-10-29T17:00:00.000Z", consultado_por: "u-dono" };
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, consulta: esperado });
  assert.deepEqual(chamadas.salvar, [esperado]);
  assert.deepEqual(chamadas.buscar, [`https://brasilapi.com.br/api/cnpj/v1/${CNPJ}`]);
});

test("BrasilAPI com falha de rede, 500 ou 429 → usa a publica.cnpj.ws", async () => {
  for (const b of ["falha", { status: 500, corpo: null }, { status: 429, corpo: null }] as Resp[]) {
    const { deps, chamadas } = criar({ respostas: { brasilapi: b, cnpjws: { status: 200, corpo: WS } } });
    const r = await pedir(deps);
    assert.equal(r.status, 200);
    assert.equal(chamadas.salvar[0].fonte, "cnpjws");
    assert.equal(chamadas.salvar[0].situacao, "ATIVA");
    assert.equal(chamadas.buscar[1], `https://publica.cnpj.ws/cnpj/${CNPJ}`);
  }
});

test("BrasilAPI 404 confirma na publica.cnpj.ws: NAO_ENCONTRADO só se as duas dizem 404", async () => {
  const ambas = criar({ respostas: { brasilapi: { status: 404, corpo: null }, cnpjws: { status: 404, corpo: null } } });
  const r = await pedir(ambas.deps);
  assert.equal(r.status, 200);
  assert.equal(ambas.chamadas.salvar[0].situacao, "NAO_ENCONTRADO");
  assert.equal(ambas.chamadas.buscar.length, 2);
  const nova = criar({ respostas: { brasilapi: { status: 404, corpo: null }, cnpjws: { status: 200, corpo: WS } } });
  await pedir(nova.deps);
  assert.equal(nova.chamadas.salvar[0].situacao, "ATIVA", "empresa nova que a BrasilAPI ainda não tem");
  const caiu = criar({ respostas: { brasilapi: { status: 404, corpo: null }, cnpjws: "falha" } });
  assert.equal((await pedir(caiu.deps)).status, 503, "404 de uma só não vira NAO_ENCONTRADO");
  assert.equal(caiu.chamadas.salvar.length, 0);
});

test("CNPJ com dígito errado (HTTP 400 da fonte) → 422 cnpj_invalido sem gravar", async () => {
  const a = criar({ respostas: { brasilapi: { status: 400, corpo: { message: "inválido" } } } });
  const r = await pedir(a.deps);
  assert.equal(r.status, 422);
  assert.equal(r.corpo.erro, "cnpj_invalido");
  assert.equal(a.chamadas.salvar.length, 0);
  assert.equal(a.chamadas.buscar.length, 1);
  const b = criar({ respostas: { brasilapi: "falha", cnpjws: { status: 400, corpo: null } } });
  assert.equal((await pedir(b.deps)).status, 422);
});

test("as duas fontes falham ou respondem situação desconhecida → 503 e nada é gravado", async () => {
  const a = criar({ respostas: { brasilapi: "falha", cnpjws: { status: 502, corpo: null } } });
  const r = await pedir(a.deps);
  assert.equal(r.status, 503);
  assert.equal(r.corpo.erro, "fora_do_ar");
  assert.equal(a.chamadas.salvar.length, 0);
  const b = criar({ respostas: { brasilapi: { status: 200, corpo: { descricao_situacao_cadastral: "XYZ" } },
    cnpjws: { status: 200, corpo: { estabelecimento: { situacao_cadastral: "??" } } } } });
  assert.equal((await pedir(b.deps)).status, 503);
  assert.equal(b.chamadas.salvar.length, 0);
});

test("log nunca leva CNPJ, razão social, aba ou lead", async () => {
  const casos = [criar(), criar({ respostas: { brasilapi: "falha", cnpjws: "falha" } }), criar({ salva: salva(1) })];
  for (const c of casos) await pedir(c.deps);
  const tudo = casos.flatMap((c) => c.chamadas.log).join("\n");
  assert.ok(tudo.length > 0);
  for (const proibido of [CNPJ, "0001-31", "ZZ TESTE", "OUTUBRO", "l1"]) assert.ok(!tudo.includes(proibido), proibido);
});
