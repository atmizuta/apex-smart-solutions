import { test } from "node:test";
import assert from "node:assert/strict";
import { diaSP, mensagemErro, ocultarToken, pedidosEagle, periodoDiario, periodoValido } from "./eagle.ts";

const L = (extra: Record<string, unknown>) => Object.assign({
  numeroPedido: "P1", cpfCnpj: "12.345.678/0001-90", nomeEtapa: "PEDIDO (NEOCRM)", nomeUsuario: "CONSULTOR TESTE",
  nomeCliente: "Cliente Teste", valor: 10, dataCadastro: "2026-10-01", dataHoraAtualizacao: "2026-10-02T10:00:00",
}, extra);

test("diaSP e periodoDiario: data de São Paulo (UTC−3), anteontem até hoje", () => {
  const t = Date.parse("2026-10-24T02:30:00Z"); // 23/10 23:30 em SP
  assert.equal(diaSP(t), "2026-10-23");
  assert.equal(diaSP(t, 150), "2026-05-26");
  assert.deepEqual(periodoDiario(t), { dataInicio: "2026-10-21", dataFim: "2026-10-23" });
});

test("periodoValido: datas aaaa-mm-dd, início ≤ fim, até 3 meses", () => {
  assert.equal(periodoValido({ dataInicio: "2026-05-26", dataFim: "2026-06-24" }), true);
  assert.equal(periodoValido({ dataInicio: "2026-06-24", dataFim: "2026-05-26" }), false);
  assert.equal(periodoValido({ dataInicio: "2026-01-01", dataFim: "2026-06-01" }), false);
  assert.equal(periodoValido({ dataInicio: "26/05/2026", dataFim: "2026-06-24" }), false);
  assert.equal(periodoValido({}), false);
});

test("pedidosEagle: um por pedido, CNPJ só dígitos, etapa e consultor do item mais recente", () => {
  const r = pedidosEagle([
    L({}),
    L({ nomeEtapa: "DEVOLVIDO (NEOCRM)", nomeUsuario: "OUTRO", dataHoraAtualizacao: "2026-10-05T08:00:00" }),
    L({ numeroPedido: "P2", cpfCnpj: "98765432000110", dataCadastro: "2026-09-10" }),
  ], "2026-05-26");
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    numero_pedido: "P1", cnpj: "12345678000190", etapa: "DEVOLVIDO (NEOCRM)", consultor: "OUTRO",
    cadastro: "2026-10-01", atualizado_em_neo: "2026-10-05T08:00:00-03:00",
  });
  // nada de nome do cliente nem valor no que vai para o banco
  assert.equal(Object.keys(r[0]).includes("cliente") || Object.keys(r[0]).includes("valor"), false);
});

test("pedidosEagle: fora CPF, sem pedido e cadastro antes do corte (150 dias)", () => {
  const r = pedidosEagle([
    L({ numeroPedido: "CPF", cpfCnpj: "123.456.789-01" }),
    L({ numeroPedido: "" }),
    L({ numeroPedido: "VELHO", dataCadastro: "2026-05-25" }),
    L({ numeroPedido: "NO_CORTE", dataCadastro: "2026-05-26" }),
    L({ numeroPedido: "SEM_DATA", dataCadastro: null }),
  ], "2026-05-26");
  assert.deepEqual(r.map((p) => p.numero_pedido), ["NO_CORTE"]);
});

test("mensagemErro e ocultarToken: erro curto e sem o token", () => {
  assert.equal(mensagemErro(429, '{"codigo":"LIMITE_API","mensagem":"Aguarde"}', "40"), "HTTP 429 LIMITE_API: Aguarde (Retry-After 40s)");
  assert.equal(mensagemErro(502, "<html> erro </html>", null), "HTTP 502 — <html> erro </html>");
  assert.equal(ocultarToken("falhou em /exportacao/abc-123 e abc-123", "abc-123"), "falhou em /exportacao/*** e ***");
  assert.equal(ocultarToken("x/a%2Fb", "a/b"), "x/***");
});
