// Excel do relatório diário de pedidos parados (spec §4.2). Mesmo padrão visual do Excel de Pedidos em Alerta
// (REGRAS §48.4). A ExcelJS chega por parâmetro: no Deno vem de npm:exceljs@4.4.0; no teste, do node_modules.
import { ETAPAS, CRITICIDADES, ROTULO, etapaCurta, fmtDataHoraSp, fmtDiaBr, resumir } from "./regras.ts";
import type { Criticidade, Pedido } from "./regras.ts";

// deno-lint-ignore no-explicit-any
export type ExcelJSLike = { Workbook: new () => any };
export interface InfoPlanilha { diaRef: string; sincronizadoEm: Date | null }

export const CABECALHO = ["Criticidade", "Dias parados", "Etapa", "Nº do pedido", "Operação", "Consultor", "Cliente",
  "CNPJ", "Produto(s)", "Qtd.", "Valor (R$)", "Cadastro", "Na etapa desde", "Última atualização", "Retorno"];
const COL_RETORNO = 15;
const LARGURA_RETORNO = 50;

// ARGB, as mesmas cores do Excel de Pedidos em Alerta (alta = máximo, média = médio, baixa = mínimo).
export const CORES: Record<Criticidade, { forte: string; claro: string; texto: string }> & { cabecalho: { fundo: string; texto: string } } = {
  alta: { forte: "FFC1050F", claro: "FFFFC7CE", texto: "FFFFFFFF" },
  media: { forte: "FFF97316", claro: "FFFFD8B0", texto: "FFFFFFFF" },
  baixa: { forte: "FFEAB308", claro: "FFFFF2A8", texto: "FF000000" },
  cabecalho: { fundo: "FF1D1F20", texto: "FFFFFFFF" },
};

export function nomeArquivo(diaRef: string): string {
  return `PedidosParados_${diaRef}.xlsx`;
}

// O Excel não tem fuso: grava uma Date "UTC" com os números do horário de São Paulo.
const FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function dataExcelSp(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, parseInt(p.hour, 10) % 24, +p.minute));
}

export async function gerarPlanilha(ExcelJS: ExcelJSLike, pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Apex Smart Solutions";
  // deno-lint-ignore no-explicit-any
  const pintar = (cell: any, cor: string) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cor } }; };
  // deno-lint-ignore no-explicit-any
  const cabecalho = (row: any, textos: string[]) => textos.forEach((t, i) => {
    const c = row.getCell(i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: CORES.cabecalho.texto } };
    pintar(c, CORES.cabecalho.fundo);
  });

  const ws = wb.addWorksheet("Pedidos Parados", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.getCell("A1").value = "Pedidos parados em Antifraude e Entrega — Apex / Claro";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells(1, 1, 1, CABECALHO.length);
  const sinc = info.sincronizadoEm ? fmtDataHoraSp(info.sincronizadoEm) : "não informada";
  ws.getCell("A2").value = `Referência ${fmtDiaBr(info.diaRef)} · dados do NeoCRM sincronizados em ${sinc}`
    + " · dias úteis na etapa atual · Baixa 0–3 · Média 4–6 · Alta 7+";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };
  ws.mergeCells(2, 1, 2, CABECALHO.length);
  cabecalho(ws.getRow(3), CABECALHO);
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: CABECALHO.length } };

  pedidos.forEach((p, i) => {
    const row = ws.getRow(4 + i);
    const cor = CORES[p.criticidade];
    [ROTULO[p.criticidade], p.dias, etapaCurta(p.etapa), p.numero_pedido, p.operacao, p.consultor, p.cliente, p.cnpj,
      p.produtos, p.qtd, p.valor, dataExcelSp(p.cadastro), dataExcelSp(p.na_etapa_desde), dataExcelSp(p.atualizacao), null]
      .forEach((v, c) => {
        const cell = row.getCell(c + 1);
        cell.value = v;
        pintar(cell, c === 0 ? cor.forte : cor.claro);
      });
    row.getCell(1).font = { bold: true, color: { argb: cor.texto } };
    row.getCell(4).numFmt = "@";
    row.getCell(8).numFmt = "@";
    row.getCell(11).numFmt = '"R$" #,##0.00';
    row.getCell(12).numFmt = "dd/mm/yyyy";
    row.getCell(13).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(14).numFmt = "dd/mm/yyyy hh:mm";
    row.getCell(COL_RETORNO).alignment = { wrapText: true, vertical: "top" };
  });

  // largura pelo maior conteúdo (limitada a 60); Retorno fixa e larga para a executiva escrever
  CABECALHO.forEach((t, i) => {
    if (i + 1 === COL_RETORNO) { ws.getColumn(i + 1).width = LARGURA_RETORNO; return; }
    let max = t.length;
    for (let r = 4; r < 4 + pedidos.length; r++) {
      const v = ws.getRow(r).getCell(i + 1).value;
      const len = v instanceof Date ? 16 : String(v ?? "").length;
      if (len > max) max = len;
    }
    ws.getColumn(i + 1).width = Math.min(60, max + 2);
  });

  const rs = wb.addWorksheet("Resumo");
  const resumo = resumir(pedidos);
  cabecalho(rs.getRow(1), ["Etapa", ...CRITICIDADES.map((c) => ROTULO[c].charAt(0) + ROTULO[c].slice(1).toLowerCase()), "Total"]);
  ETAPAS.forEach((e, i) => {
    const r = resumo.porEtapa[e];
    rs.getRow(2 + i).values = [etapaCurta(e), ...CRITICIDADES.map((c) => r[c]), r.total];
  });
  const tot = rs.getRow(2 + ETAPAS.length);
  tot.values = ["TOTAL", ...CRITICIDADES.map((c) => resumo.total[c]), resumo.total.total];
  tot.font = { bold: true };
  rs.getColumn(1).width = 20;
  [2, 3, 4, 5].forEach((c) => { rs.getColumn(c).width = 12; });

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
