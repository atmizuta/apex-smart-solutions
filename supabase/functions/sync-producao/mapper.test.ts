import { test } from "node:test";
import assert from "node:assert/strict";
import { mapResponse, parseDataHoraSP, parseValorBR } from "./mapper.ts";

function linha(o: Record<string, unknown> = {}) {
  return {
    itemId: 1001, numeroPedido: "50000001", numeroLinha: "VOZ - Novo",
    nomeUsuario: "  maria souza ", nomeEtapa: "CONCLUIDO (NEOCRM)",
    dataCadastro: "23/09/2026", dataHoraAtualizacao: "29/09/2026 15:30:56",
    valor: "39,99", quantidade: 1, nomeProduto: "CLARO POS 10GB",
    nomeCliente: "EMPRESA TESTE LTDA", cpfCnpj: "00000000000191",
    tagPedido: "", dataPortabilidade: "", dataInstalacao: "", ...o,
  };
}

test("parseDataHoraSP: data+hora e só data ganham offset -03:00", () => {
  assert.equal(parseDataHoraSP("29/09/2026 15:30:56"), "2026-09-29T15:30:56-03:00");
  assert.equal(parseDataHoraSP("23/09/2026"), "2026-09-23T00:00:00-03:00");
});
test("parseDataHoraSP: vazio, nulo e lixo viram null", () => {
  assert.equal(parseDataHoraSP(""), null);
  assert.equal(parseDataHoraSP(null), null);
  assert.equal(parseDataHoraSP("ontem"), null);
});
test("parseValorBR: formatos brasileiros, número e vazio", () => {
  assert.equal(parseValorBR("39,99"), 39.99);
  assert.equal(parseValorBR("1.234,56"), 1234.56);
  assert.equal(parseValorBR(5), 5);
  assert.equal(parseValorBR("39.99"), 39.99);
  assert.equal(parseValorBR(""), 0);
  assert.equal(parseValorBR(undefined), 0);
});

test("mapeia um item para o formato de producao_pedidos", () => {
  const m = mapResponse([linha()]);
  assert.deepEqual(m.registros, [{
    item_id: 1001, numero_pedido: "50000001", grupo: "VOZ - Novo", usuario: "MARIA SOUZA",
    etapa: "CONCLUIDO (NEOCRM)", cadastro: "2026-09-23T00:00:00-03:00",
    atualizacao: "2026-09-29T15:30:56-03:00", valor: 39.99, quantidade: 1,
    produto: "CLARO POS 10GB", cliente: "EMPRESA TESTE LTDA", cnpj: "00000000000191",
    tag: null, data_portabilidade: null, data_instalacao: null,
  }]);
  assert.equal(m.raws[0].item_id, 1001);
});

test("GROSS é descartado para o valor não dobrar", () => {
  const m = mapResponse([linha({ numeroLinha: "GROSS" }), linha()]);
  assert.equal(m.registros.length, 1);
  assert.equal(m.registros[0].grupo, "VOZ - Novo");
  assert.equal(m.descartes.gross, 1);
  assert.equal(m.descartes.grossOrfaos, 0);
});

test("item que só tem linha GROSS é contado como órfão (alerta de integridade)", () => {
  const m = mapResponse([linha({ numeroLinha: "GROSS" })]);
  assert.equal(m.registros.length, 0);
  assert.equal(m.descartes.grossOrfaos, 1);
});

test("ARQUIVADO sai dos registros mas o itemId é devolvido para remoção", () => {
  const m = mapResponse([linha({ nomeEtapa: "ARQUIVADO (NEOCRM)" })]);
  assert.equal(m.registros.length, 0);
  assert.deepEqual(m.arquivadosItemIds, [1001]);
  assert.equal(m.descartes.arquivado, 1);
});

test("sem grupo e sem itemId são descartados e contados", () => {
  const m = mapResponse([linha({ numeroLinha: "" }), linha({ itemId: null, numeroLinha: "VOZ - Novo" })]);
  assert.equal(m.registros.length, 0);
  assert.equal(m.descartes.semGrupo, 1);
  assert.equal(m.descartes.semItemId, 1);
});

test("mesmo itemId repetido no lote: mantém o mais recente, em qualquer ordem, e conta", () => {
  const velho = linha({ dataHoraAtualizacao: "29/09/2026 15:00:00", valor: "10,00" });
  const novo = linha({ dataHoraAtualizacao: "29/09/2026 16:00:00", valor: "20,00" });
  for (const ordem of [[velho, novo], [novo, velho]]) {
    const m = mapResponse(ordem);
    assert.equal(m.registros.length, 1);
    assert.equal(m.registros[0].valor, 20);
    assert.equal(m.descartes.duplicados, 1);
  }
});

test("usuário ausente vira (SEM USUÁRIO), como no painel; quantidade ausente vira 1; tag preservada", () => {
  const m = mapResponse([linha({ nomeUsuario: "", quantidade: undefined, tagPedido: "#HOTLEAD,#ESIM" })]);
  assert.equal(m.registros[0].usuario, "(SEM USUÁRIO)");
  assert.equal(m.registros[0].quantidade, 1);
  assert.equal(m.registros[0].tag, "#HOTLEAD,#ESIM");
});

test("etapa vazia vira (Sem etapa) e datas de ativação são convertidas", () => {
  const m = mapResponse([linha({ nomeEtapa: "", dataPortabilidade: "30/09/2026", dataInstalacao: "01/10/2026 08:00:00" })]);
  assert.equal(m.registros[0].etapa, "(Sem etapa)");
  assert.equal(m.registros[0].data_portabilidade, "2026-09-30T00:00:00-03:00");
  assert.equal(m.registros[0].data_instalacao, "2026-10-01T08:00:00-03:00");
});
