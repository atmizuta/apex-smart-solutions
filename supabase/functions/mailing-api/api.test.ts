import { test } from "node:test";
import assert from "node:assert/strict";
import { processar, COLUNAS_EXPORT } from "./api.ts";
import type { DepsApi, Usuario } from "./api.ts";

const admin: Usuario = { id: "00000000-0000-0000-0000-000000000001", role: "admin", operacao: "apex", username: "adm" };
const supCampinas: Usuario = { id: "00000000-0000-0000-0000-000000000002", role: "supervisor", operacao: "campinas", username: "supc" };
const consultor: Usuario = { id: "00000000-0000-0000-0000-000000000003", role: "consultor", operacao: "apex", username: "cons" };
const LINHA = {
  nome: "FULANO DE TAL", descricao: "EMPRESA TESTE LTDA", documento1: "00000000191", documento2: "00000000000191",
  fone1: "11900000001", campo1: "CLARO S.A.", campo2: "MEI", campo3: "SAO PAULO",
};

function criar(over: Partial<DepsApi> = {}) {
  const chamadas: unknown[][] = [];
  const deps: DepsApi = {
    async opcoes() { chamadas.push(["opcoes"]); return { opcoes: [{ tipo: "uf", valor: "SP", rotulo: "SP", uf: null }], carga: null }; },
    async historico() { chamadas.push(["historico"]); return []; },
    async contar(w) { chamadas.push(["contar", w]); return { linhas: 10, empresas: 5, telefones: 9, por_operadora: [] }; },
    async extrair(w, q, reg) { chamadas.push(["extrair", w, q, reg]); return { linhas: [LINHA], total_no_filtro: 50 }; },
    hojeISO: () => "2026-10-21",
    ...over,
  };
  return { deps, chamadas };
}

test("sem usuário ou consultor: 403 e nada é consultado", async () => {
  for (const u of [null, consultor]) {
    const { deps, chamadas } = criar();
    const r = await processar({ acao: "opcoes" }, u, deps);
    assert.equal(r.status, 403);
    assert.equal(chamadas.length, 0);
  }
});

test("supervisor de qualquer operação acessa", async () => {
  const { deps } = criar();
  const r = await processar({ acao: "opcoes" }, supCampinas, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { opcoes: [{ tipo: "uf", valor: "SP", rotulo: "SP", uf: null }], carga: null });
});

test("ação inválida ou corpo vazio: 400", async () => {
  const { deps } = criar();
  assert.equal((await processar({ acao: "apagar" }, admin, deps)).status, 400);
  assert.equal((await processar(null, admin, deps)).status, 400);
});

test("historico", async () => {
  const { deps } = criar();
  const r = await processar({ acao: "historico" }, admin, deps);
  assert.deepEqual(r, { status: 200, body: { extracoes: [] } });
});

test("contar: filtro inválido = 400 com a mensagem; válido chama deps com o where", async () => {
  const { deps, chamadas } = criar();
  const ruim = await processar({ acao: "contar", filtros: { situacao: ["ABERTA"] } }, admin, deps);
  assert.equal(ruim.status, 400);
  assert.match(String(ruim.body.erro), /situacao/);
  const bom = await processar({ acao: "contar", filtros: { ddd: [11] } }, admin, deps);
  assert.equal(bom.status, 200);
  assert.deepEqual(bom.body, { linhas: 10, empresas: 5, telefones: 9, por_operadora: [] });
  assert.deepEqual(chamadas.at(-1), ["contar", { sql: "l.ddd = any($1::smallint[])", params: [[11]] }]);
});

test("extrair: quantidade e nome da carga obrigatórios", async () => {
  const { deps, chamadas } = criar();
  const q = await processar({ acao: "extrair", filtros: {}, quantidade: 100001, nome_carga: "X" }, admin, deps);
  assert.equal(q.status, 400);
  assert.match(String(q.body.erro), /100\.000/);
  const c = await processar({ acao: "extrair", filtros: {}, quantidade: 10, nome_carga: "  " }, admin, deps);
  assert.equal(c.status, 400);
  assert.match(String(c.body.erro), /nome da carga/);
  assert.equal(chamadas.length, 0);
});

test("extrair: devolve colunas, linhas em lista, nome do arquivo e registro completo", async () => {
  const { deps, chamadas } = criar();
  const r = await processar({ acao: "extrair", filtros: { ddd: [11] }, quantidade: 1, nome_carga: "teste 1" }, supCampinas, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    colunas: [...COLUNAS_EXPORT],
    linhas: [["FULANO DE TAL", "EMPRESA TESTE LTDA", "00000000191", "00000000000191", "11900000001", "CLARO S.A.", "MEI", "SAO PAULO"]],
    total_no_filtro: 50, quantidade_entregue: 1, nome_arquivo: "TESTE-1_2026-10-21.csv",
  });
  const [, w, q, reg] = chamadas.at(-1) as [string, unknown, number, Record<string, unknown>];
  assert.deepEqual(w, { sql: "l.ddd = any($1::smallint[])", params: [[11]] });
  assert.equal(q, 1);
  assert.deepEqual(reg, {
    user_id: supCampinas.id, username: "supc", role: "supervisor", operacao: "campinas", nome_carga: "TESTE-1",
    filtros: { ddd: [11] }, quantidade_pedida: 1,
  });
});

test("extrair sem linhas: 200 com zero entregues", async () => {
  const { deps } = criar({ async extrair() { return { linhas: [], total_no_filtro: 0 }; } });
  const r = await processar({ acao: "extrair", filtros: {}, quantidade: 5, nome_carga: "VAZIO" }, admin, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.quantidade_entregue, 0);
  assert.deepEqual(r.body.linhas, []);
});

test("erros do banco: 57014 = 504 com orientação; outros = 500", async () => {
  const lento = criar({ async contar() { throw Object.assign(new Error("canceling statement"), { code: "57014" }); } });
  const r1 = await processar({ acao: "contar", filtros: {} }, admin, lento.deps);
  assert.equal(r1.status, 504);
  assert.match(String(r1.body.erro), /demorou demais/);
  const quebrado = criar({ async historico() { throw new Error("conexão caiu"); } });
  const r2 = await processar({ acao: "historico" }, admin, quebrado.deps);
  assert.equal(r2.status, 500);
  assert.equal(String(r2.body.erro).includes("conexão caiu"), false);
});
