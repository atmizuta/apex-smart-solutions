import { test } from "node:test";
import assert from "node:assert/strict";
import { agruparPorPedido, categoriaDoPedido, mensagemErro, ocultarToken, paraNumero, paraTimestampSP, periodoConsulta } from "./exportacao.ts";

const L = (extra: Record<string, unknown>) => Object.assign({
  numeroPedido: "P1", nomeEtapa: "VENDA PERDIDA (NEOCRM)", categoriaAtividade: "", subCategoriaAtividade: null,
  tagsAtividade: [], nomeUsuario: "CONSULTOR TESTE", nomeCliente: "Cliente Teste", nomeProduto: "Produto Teste",
  valor: 10, quantidade: 1, dataCadastro: "2026-10-01", dataHoraAtualizacao: "2026-10-02T10:00:00",
}, extra);

test("paraNumero: número, vírgula decimal, milhar com ponto, vazio", () => {
  assert.equal(paraNumero(149.9), 149.9);
  assert.equal(paraNumero("6999,00"), 6999);
  assert.equal(paraNumero("1.234,56"), 1234.56);
  assert.equal(paraNumero("39.99"), 39.99);
  assert.equal(paraNumero(""), 0);
  assert.equal(paraNumero(null), 0);
  assert.equal(paraNumero("abc"), 0);
});

test("paraTimestampSP: yyyy-MM-ddTHH:mm:ss vira ISO -03:00; inválido null", () => {
  assert.equal(paraTimestampSP("2026-10-02T09:30:00"), "2026-10-02T09:30:00-03:00");
  assert.equal(paraTimestampSP("2026-10-02T09:30:00.123"), "2026-10-02T09:30:00-03:00");
  assert.equal(paraTimestampSP(""), null);
  assert.equal(paraTimestampSP("02/10/2026"), null);
});

test("categoriaDoPedido: mais frequente; empate pelo item mais recente; vazio null", () => {
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "A" }), L({ categoriaAtividade: "B" }), L({ categoriaAtividade: "B" })], "categoriaAtividade"), "B");
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "A", dataHoraAtualizacao: "2026-10-01T10:00:00" }), L({ categoriaAtividade: "B", dataHoraAtualizacao: "2026-10-03T10:00:00" })], "categoriaAtividade"), "B");
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "" }), L({ categoriaAtividade: null })], "categoriaAtividade"), null);
  assert.equal(categoriaDoPedido([L({ categoriaAtividade: "  Não responde " })], "categoriaAtividade"), "Não responde");
});

test("agruparPorPedido: 1 por pedido, soma valor, conta itens, une produtos e tags, datas", () => {
  const out = agruparPorPedido([
    L({ valor: "6999,00", nomeProduto: "Aparelho Teste", tagsAtividade: ["#HOTLEAD"], categoriaAtividade: "Não responde", dataCadastro: "2026-09-30" }),
    L({ valor: 39.99, tagsAtividade: ["#SEMINTERESSE", "#HOTLEAD"], dataHoraAtualizacao: "2026-10-04T08:00:00", nomeEtapa: "VENDA PERDIDA (NEOCRM)" }),
    L({ numeroPedido: "P2", valor: 5, categoriaAtividade: "" }),
    L({ numeroPedido: "", valor: 1 }),
  ]);
  assert.equal(out.length, 2);
  const p1 = out.find((x) => x.numero_pedido === "P1")!;
  assert.equal(p1.valor, 7038.99);
  assert.equal(p1.itens, 2);
  assert.equal(p1.categoria, "Não responde");
  assert.equal(p1.subcategoria, null);
  assert.deepEqual(p1.tags, ["#HOTLEAD", "#SEMINTERESSE"]);
  assert.equal(p1.produtos, "Aparelho Teste + Produto Teste");
  assert.equal(p1.data_cadastro, "2026-09-30");
  assert.equal(p1.atualizado_em_neo, "2026-10-04T08:00:00-03:00");
  assert.equal(out.find((x) => x.numero_pedido === "P2")!.categoria, null);
});

test("periodoConsulta: hoje−90 → hoje em São Paulo", () => {
  assert.deepEqual(periodoConsulta(Date.parse("2026-10-05T02:00:00Z")), { dataInicio: "2026-07-06", dataFim: "2026-10-04" });
  assert.deepEqual(periodoConsulta(Date.parse("2026-10-05T15:00:00Z")), { dataInicio: "2026-07-07", dataFim: "2026-10-05" });
});

test("mensagemErro: JSON da API, texto puro, 429 com Retry-After", () => {
  assert.equal(mensagemErro(401, '{"codigo":"TOKEN_INVALIDO","mensagem":"Token inválido","requestId":"r1"}', null), "HTTP 401 TOKEN_INVALIDO: Token inválido");
  assert.equal(mensagemErro(502, "<html>Bad Gateway</html>", null), "HTTP 502 — <html>Bad Gateway</html>");
  assert.equal(mensagemErro(429, '{"codigo":"LIMITE_API","mensagem":"Aguarde"}', "120"), "HTTP 429 LIMITE_API: Aguarde (Retry-After 120s)");
  assert.equal(mensagemErro(500, "", null), "HTTP 500");
});

test("ocultarToken: remove o token de qualquer mensagem", () => {
  assert.equal(ocultarToken("falhou https://api/x/abc123secret/y", "abc123secret"), "falhou https://api/x/***/y");
  assert.equal(ocultarToken("sem token aqui", "abc123secret"), "sem token aqui");
  assert.equal(ocultarToken("qualquer", ""), "qualquer");
});

test("ocultarToken: mascara também a forma URL-encoded do token", () => {
  const token = "ab+c/d=";
  const msg = "falhou https://api/x/ab%2Bc%2Fd%3D/y e também ab+c/d= no corpo";
  const saida = ocultarToken(msg, token);
  assert.ok(!saida.includes("ab%2Bc%2Fd%3D"));
  assert.ok(!saida.includes("ab+c/d="));
});
