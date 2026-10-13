import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { CABECALHO, CORES, dataExcelSp, gerarPlanilha, nomeArquivo } from "./planilha.ts";
import type { Pedido } from "./regras.ts";

const pedido = (o: Partial<Pedido> = {}): Pedido => ({
  numero_pedido: "1001", etapa: "ANTIFRAUDE (NEOCRM)", operacao: "Apex", consultor: "FULANO DE TAL",
  cliente: "Empresa Teste", cnpj: "01234567000189", produtos: "Plano A + Plano B", qtd: 3, valor: 150.5,
  cadastro: "2026-10-01T08:00:00-03:00", na_etapa_desde: "2026-10-05T10:00:00-03:00",
  atualizacao: "2026-10-06T15:00:00-03:00", dias: 5, criticidade: "media", ...o,
});
const PEDIDOS: Pedido[] = [
  pedido({ numero_pedido: "7", etapa: "ENTREGA (NEOCRM)", dias: 9, criticidade: "alta", operacao: "Campinas" }),
  pedido(),
  pedido({ numero_pedido: "8", dias: 0, criticidade: "baixa" }),
];
const INFO = { diaRef: "2026-10-14", sincronizadoEm: new Date("2026-10-14T10:59:00Z") };

async function abrir(pedidos: Pedido[] = PEDIDOS) {
  const bytes = await gerarPlanilha(ExcelJS, pedidos, INFO);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b); // zip
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(bytes));
  return wb;
}
const argb = (cell: ExcelJS.Cell) => (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

test("nomeArquivo", () => {
  assert.equal(nomeArquivo("2026-10-14"), "PedidosParados_2026-10-14.xlsx");
});
test("dataExcelSp grava os números do horário de São Paulo", () => {
  assert.equal(dataExcelSp("2026-10-14T10:59:00Z")!.toISOString(), "2026-10-14T07:59:00.000Z");
  assert.equal(dataExcelSp(null), null);
  assert.equal(dataExcelSp("lixo"), null);
});
test("duas abas, cabeçalho na linha 3, congelado e com filtro", async () => {
  const wb = await abrir();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Pedidos Parados", "Resumo"]);
  const ws = wb.getWorksheet("Pedidos Parados")!;
  assert.deepEqual(CABECALHO, ["Criticidade", "Dias parados", "Etapa", "Nº do pedido", "Operação", "Consultor",
    "Cliente", "CNPJ", "Produto(s)", "Qtd.", "Valor (R$)", "Cadastro", "Na etapa desde", "Última atualização", "Retorno"]);
  assert.deepEqual((ws.getRow(3).values as unknown[]).slice(1), CABECALHO);
  assert.match(String(ws.getCell("A1").value), /Pedidos parados/);
  assert.match(String(ws.getCell("A2").value), /14\/10\/2026/);
  assert.match(String(ws.getCell("A2").value), /07:59/);
  assert.equal(ws.views[0].state, "frozen");
  assert.equal((ws.views[0] as { ySplit?: number }).ySplit, 3);
  assert.ok(ws.autoFilter, "filtro automático presente");
});
test("linhas na ordem recebida, coloridas pela criticidade", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  assert.equal(ws.getCell("A4").value, "ALTA");
  assert.equal(argb(ws.getCell("A4")), CORES.alta.forte);
  assert.equal(argb(ws.getCell("B4")), CORES.alta.claro);
  assert.equal(ws.getCell("C4").value, "ENTREGA");
  assert.equal(ws.getCell("E4").value, "Campinas");
  assert.equal(ws.getCell("A5").value, "MÉDIA");
  assert.equal(argb(ws.getCell("A5")), CORES.media.forte);
  assert.equal(argb(ws.getCell("N5")), CORES.media.claro);
  assert.equal(ws.getCell("A6").value, "BAIXA");
  assert.equal(argb(ws.getCell("A6")), CORES.baixa.forte);
  assert.equal(ws.getCell("B6").value, 0);
});
test("nº do pedido e CNPJ como texto (CNPJ mantém o zero inicial); valor e datas tipados", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  assert.equal(ws.getCell("D5").value, "1001");
  assert.equal(ws.getCell("H5").value, "01234567000189");
  assert.equal(ws.getCell("H5").numFmt, "@");
  assert.equal(ws.getCell("K5").value, 150.5);
  assert.ok(ws.getCell("L5").value instanceof Date);
  assert.ok(ws.getCell("M5").value instanceof Date);
  assert.ok(ws.getCell("N5").value instanceof Date);
});
test("coluna Retorno em branco, larga e com quebra de linha", async () => {
  const ws = (await abrir()).getWorksheet("Pedidos Parados")!;
  for (const r of [4, 5, 6]) {
    const v = ws.getCell(`O${r}`).value;
    assert.ok(v == null || v === "", `O${r} vazio`);
  }
  assert.ok((ws.getColumn(15).width ?? 0) >= 40);
  assert.equal(ws.getCell("O4").alignment?.wrapText, true);
});
test("aba Resumo: Etapa × Criticidade com total", async () => {
  const rs = (await abrir()).getWorksheet("Resumo")!;
  assert.deepEqual((rs.getRow(1).values as unknown[]).slice(1), ["Etapa", "Alta", "Média", "Baixa", "Total"]);
  assert.deepEqual((rs.getRow(2).values as unknown[]).slice(1), ["ANTIFRAUDE", 0, 1, 1, 2]);
  assert.deepEqual((rs.getRow(3).values as unknown[]).slice(1), ["ENTREGA", 1, 0, 0, 1]);
  assert.deepEqual((rs.getRow(4).values as unknown[]).slice(1), ["TOTAL", 1, 1, 1, 3]);
});
