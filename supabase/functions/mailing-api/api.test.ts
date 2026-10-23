import { test } from "node:test";
import assert from "node:assert/strict";
import { processar, COLUNAS_EXPORT, situacaoContagem } from "./api.ts";
import type { DepsApi, LinhaContagem, Usuario } from "./api.ts";

const admin: Usuario = { id: "00000000-0000-0000-0000-000000000001", role: "admin", operacao: "apex", username: "adm" };
const supCampinas: Usuario = { id: "00000000-0000-0000-0000-000000000002", role: "supervisor", operacao: "campinas", username: "supc" };
const consultor: Usuario = { id: "00000000-0000-0000-0000-000000000003", role: "consultor", operacao: "apex", username: "cons" };
const LINHA = {
  nome: "FULANO DE TAL", descricao: "EMPRESA TESTE LTDA", documento1: "00000000191", documento2: "00000000000191",
  fone1: "11900000001", campo1: "CLARO S.A.", campo2: "MEI", campo3: "SAO PAULO",
};
const EMPRESA_NEO = { cnpj: "00000000000191", pedidos: 2, numero_pedido: "1", etapa: "CONCLUIDO (NEOCRM)", consultor: "fulano",
  cadastro: "2026-10-01T12:00:00.000Z" };

const FILA: LinhaContagem = { estado: "fila", linhas: null, empresas: null, telefones: null, por_operadora: null, erro: null,
  terminado_em: null, pid: null, segundos: null, na_frente: 0 };

function criar(over: Partial<DepsApi> = {}) {
  const chamadas: unknown[][] = [];
  const deps: DepsApi = {
    async opcoes() { chamadas.push(["opcoes"]); return { opcoes: [{ tipo: "uf", valor: "SP", rotulo: "SP", uf: null }], carga: null }; },
    async historico() { chamadas.push(["historico"]); return []; },
    async contar(w) { chamadas.push(["contar", w]); return { linhas: 10, empresas: 5, telefones: 9, por_operadora: [] }; },
    async extrair(w, q, reg) { chamadas.push(["extrair", w, q, reg]); return { linhas: [LINHA], total_no_filtro: 50 }; },
    async extrairTrecho(w, ped, reg) {
      chamadas.push(["extrairTrecho", w, ped, reg]);
      return { linhas: [], resultado: { fase: 1, tomadas: 0, ultima_pagina: null, ate: 2048, paginas_total: 2048 } };
    },
    async pedirContagem(...a) { chamadas.push(["pedirContagem", ...a]); return 7; },
    async verContagem(id) { chamadas.push(["verContagem", id]); return { ...FILA, na_frente: 1 }; },
    async pararContagem(...a) { chamadas.push(["pararContagem", ...a]); return true; },
    async neo() { chamadas.push(["neo"]); return [EMPRESA_NEO]; },
    async fecharParte(...a) { chamadas.push(["fecharParte", ...a]); return true; },
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

// 22/10: extração em trechos (seção 102.10) — cada chamada lê um pedaço limitado da base
const PEDIDO = "3f2a6c1e-8b4d-4e2a-9c1f-0a1b2c3d4e5f";
const INICIO = "2026-10-22T14:00:00.000Z";
function corpoTrecho(over: Record<string, unknown> = {}) {
  return {
    acao: "extrair", filtros: { operadora: ["CLARO"], extraida_antes_de: INICIO }, quantidade: 100, nome_carga: "icp 1",
    pedido: PEDIDO, parte: 1, trecho: { fase: 1, pagina: 0, paginas: 2048 }, ...over,
  };
}

test("extrair em trechos: valida trecho, pedido, parte e início do pedido antes de consultar", async () => {
  const { deps, chamadas } = criar();
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ trecho: { fase: 1, pagina: 0, paginas: 5 } }, /trecho/],
    [{ pedido: "abc" }, /pedido/],
    [{ parte: 0 }, /parte/],
    [{ filtros: { operadora: ["CLARO"] } }, /início do pedido/],
  ];
  for (const [over, msg] of casos) {
    const r = await processar(corpoTrecho(over), admin, deps);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(String(r.body.erro), msg);
  }
  assert.equal(chamadas.length, 0);
});

test("extrair em trechos fase 1: passa o pedido para o banco e devolve de onde continuar", async () => {
  const { deps, chamadas } = criar({
    async extrairTrecho(w, ped, reg) {
      chamadas.push(["extrairTrecho", w, ped, reg]);
      return { linhas: [{ ...LINHA, pagina: 900 }], resultado: { fase: 1, tomadas: 1, ultima_pagina: 900, ate: 2048, paginas_total: 380000 } };
    },
  });
  const r = await processar(corpoTrecho(), supCampinas, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    colunas: [...COLUNAS_EXPORT],
    linhas: [["FULANO DE TAL", "EMPRESA TESTE LTDA", "00000000191", "00000000000191", "11900000001", "CLARO S.A.", "MEI", "SAO PAULO"]],
    quantidade_entregue: 1, nome_arquivo: "ICP-1_2026-10-21.csv",
    proxima: { fase: 1, pagina: 2048 }, paginas_total: 380000, paginas_lidas: 2048,
  });
  const [, w, ped, reg] = chamadas.at(-1) as [string, { sql: string }, Record<string, unknown>, Record<string, unknown>];
  assert.match(w.sql, /l\.operadora = any/);
  assert.deepEqual(ped, { trecho: { fase: 1, pagina: 0, paginas: 2048 }, quantidade: 100, inicio: INICIO, nunca_extraida: false });
  assert.deepEqual(reg, {
    user_id: supCampinas.id, username: "supc", role: "supervisor", operacao: "campinas", nome_carga: "ICP-1",
    filtros: { operadora: ["CLARO"], extraida_antes_de: INICIO }, quantidade_pedida: 100, pedido: PEDIDO, parte: 1,
  });
});

test("extrair em trechos fase 2: o filtro acabou = proxima nula", async () => {
  const { deps } = criar({
    async extrairTrecho() {
      return { linhas: [], resultado: { fase: 2, tomadas: 0, ultimo: null, janela: { n: 10, fim: { ue: "2026-10-22 11:00:00+00", so: 3 } } } };
    },
  });
  const r = await processar(corpoTrecho({ trecho: { fase: 2, apos: null } }), admin, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.proxima, null);
  assert.equal(r.body.quantidade_entregue, 0);
  assert.equal("paginas_total" in r.body, false);
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

// 22/10 (seção 102.12): lista do NeoSales para cruzar; removidos de cada arquivo no histórico
test("neo: lista das empresas com pedido no NeoSales (só admin e supervisor)", async () => {
  const { deps, chamadas } = criar();
  assert.deepEqual(await processar({ acao: "neo" }, supCampinas, deps), { status: 200, body: { empresas: [EMPRESA_NEO] } });
  assert.deepEqual(chamadas.at(-1), ["neo"]);
  assert.equal((await processar({ acao: "neo" }, consultor, deps)).status, 403);
});

test("fechar_parte: valida e grava os removidos da parte do próprio usuário", async () => {
  const { deps, chamadas } = criar();
  const base = { acao: "fechar_parte", pedido: PEDIDO, parte: 2, neo: 3, repetidos: 40 };
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ pedido: "x" }, /pedido/], [{ parte: 0 }, /parte/], [{ neo: -1 }, /removidos/], [{ repetidos: 1.5 }, /removidos/],
    [{ neo: "3" }, /removidos/],
  ];
  for (const [over, msg] of casos) {
    const r = await processar({ ...base, ...over }, admin, deps);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.match(String(r.body.erro), msg);
  }
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await processar(base, admin, deps), { status: 200, body: { ok: true } });
  assert.deepEqual(chamadas.at(-1), ["fecharParte", PEDIDO, 2, admin.id, 3, 40]);
  const nao = criar({ async fecharParte() { return false; } });
  const r404 = await processar(base, admin, nao.deps);
  assert.equal(r404.status, 404);
  assert.match(String(r404.body.erro), /não encontrada/);
});

// ===== 23/10 (seção 110): contagem completa em segundo plano =====
test("contar completa: põe na fila com chave canônica e where do jsonb; devolve o andamento", async () => {
  const { deps, chamadas } = criar();
  const r = await processar({ acao: "contar", completa: true, filtros: { ddd: [19, 11], uf: ["SP"] } }, admin, deps);
  assert.deepEqual(r, { status: 200, body: { contagem: 7, estado: "fila", na_frente: 1 } });
  const [nome, chave, fila, reaproveitar, u] = chamadas[0] as [string, string, { where_sql: string; params: unknown[] }, boolean, Usuario];
  assert.equal(nome, "pedirContagem");
  assert.equal(chave, JSON.stringify({ ddd: [11, 19], uf: ["SP"] }));
  assert.match(fila.where_sql, /jsonb_array_elements_text\(\$1->0\)/);
  assert.deepEqual(fila.params, [["SP"], [19, 11]]);
  assert.equal(reaproveitar, true);
  assert.equal(u, admin);
  assert.deepEqual(chamadas[1], ["verContagem", 7]);
  assert.ok(!chamadas.some((c) => c[0] === "contar"), "não usa a amostra");
});

test("contar completa: 'não extraídos há N dias' não reaproveita; início de pedido não entra", async () => {
  const { deps, chamadas } = criar();
  await processar({ acao: "contar", completa: true, filtros: { sem_extracao_dias: 30, extraida_antes_de: "2026-10-23T12:00:00.000Z" } },
    admin, deps);
  const [, chave, fila, reaproveitar] = chamadas[0] as [string, string, { where_sql: string }, boolean];
  assert.equal(reaproveitar, false);
  assert.equal(chave, JSON.stringify({ sem_extracao_dias: 30 }));
  assert.ok(!fila.where_sql.includes("timestamptz"), "extraida_antes_de fora do where");
});

test("contar sem 'completa' (aba aberta antes da seção 110): contagem antiga", async () => {
  const { deps, chamadas } = criar();
  const r = await processar({ acao: "contar", filtros: {} }, admin, deps);
  assert.equal(r.status, 200);
  assert.equal(chamadas[0][0], "contar");
});

test("contagem e parar_contagem: id inteiro positivo; 404 se não achar; consultor 403", async () => {
  const { deps, chamadas } = criar();
  for (const id of [undefined, 0, -1, 1.5, "7"]) {
    assert.equal((await processar({ acao: "contagem", contagem: id }, admin, deps)).status, 400);
    assert.equal((await processar({ acao: "parar_contagem", contagem: id }, admin, deps)).status, 400);
  }
  assert.equal(chamadas.length, 0);
  assert.deepEqual(await processar({ acao: "contagem", contagem: 7 }, supCampinas, deps),
    { status: 200, body: { contagem: 7, estado: "fila", na_frente: 1 } });
  assert.deepEqual(await processar({ acao: "parar_contagem", contagem: 7 }, supCampinas, deps), { status: 200, body: { ok: true } });
  assert.deepEqual(chamadas.at(-1), ["pararContagem", 7, supCampinas.id]);
  const nada = criar({ async verContagem() { return null; }, async pararContagem() { return false; } }).deps;
  assert.equal((await processar({ acao: "contagem", contagem: 9 }, admin, nada)).status, 404);
  assert.equal((await processar({ acao: "parar_contagem", contagem: 9 }, admin, nada)).status, 404);
  assert.equal((await processar({ acao: "contagem", contagem: 7 }, consultor, deps)).status, 403);
});

test("situacaoContagem: fila, contando, pronta (números exatos) e motivos", () => {
  assert.deepEqual(situacaoContagem(3, { ...FILA, na_frente: 2 }), { contagem: 3, estado: "fila", na_frente: 2 });
  assert.deepEqual(situacaoContagem(3, { ...FILA, pid: 123, segundos: 75 }), { contagem: 3, estado: "contando", segundos: 75 });
  const fim = new Date("2026-10-23T18:00:00.000Z");
  assert.deepEqual(situacaoContagem(3, { ...FILA, estado: "pronta", linhas: "9092479", empresas: "3987960", telefones: "9000000",
    por_operadora: [{ operadora: "VIVO", linhas: 5 }], terminado_em: fim }), {
    contagem: 3, estado: "pronta", linhas: 9092479, empresas: 3987960, telefones: 9000000,
    por_operadora: [{ operadora: "VIVO", linhas: 5 }], contado_em: "2026-10-23T18:00:00.000Z",
  });
  assert.deepEqual(situacaoContagem(3, { ...FILA, estado: "cancelada", erro: "parada" }), { contagem: 3, estado: "cancelada", erro: "Contagem parada." });
  assert.match(String(situacaoContagem(3, { ...FILA, estado: "erro", erro: "disco" }).erro), /disco do banco está quase cheio/);
  assert.match(String(situacaoContagem(3, { ...FILA, estado: "cancelada", erro: "tempo" }).erro), /20 minutos/);
  assert.deepEqual(situacaoContagem(3, { ...FILA, estado: "erro", erro: "53100" }),
    { contagem: 3, estado: "erro", erro: "A contagem falhou (código 53100). Tente de novo." });
});
