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
