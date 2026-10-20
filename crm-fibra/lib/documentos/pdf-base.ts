// Peças comuns dos dois PDFs (consultor e cliente): faixa preta com os logos,
// tabelas com cabeçalho vermelho, caixa de destaque e rodapé em todas as páginas.
// jspdf-autotable cuida da quebra de linha e de página das tabelas.
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Badge, ModeloDocumento } from "../proposta/modelo-documento";
import { RODAPE_EMPRESA } from "./formato";
import { LOGO_APEX, LOGO_CLARO, type Logos } from "./marca";

export type RGB = [number, number, number];

export const COR = {
  preto: [13, 13, 13] as RGB,
  vermelho: [179, 16, 31] as RGB,
  cinzaFundo: [243, 244, 246] as RGB,
  borda: [209, 213, 219] as RGB,
  cinzaTexto: [107, 114, 128] as RGB,
  branco: [255, 255, 255] as RGB,
  verde: [22, 163, 74] as RGB,
  ambar: [180, 83, 9] as RGB,
};

export const LARGURA_PAGINA = 210;
export const MARGEM = 14;
export const LARGURA_UTIL = LARGURA_PAGINA - 2 * MARGEM;
export const ALTURA_RODAPE = 14;

export function novoDocumento(): jsPDF {
  return new jsPDF({ unit: "mm", format: "a4" });
}

export function hexParaRgb(hex: string): RGB {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// Mantém a proporção do logo dentro de uma caixa.
function caber(logo: { largura: number; altura: number }, larguraMax: number, alturaMax: number) {
  const escala = Math.min(larguraMax / logo.largura, alturaMax / logo.altura);
  return { w: logo.largura * escala, h: logo.altura * escala };
}

export function desenharCabecalho(doc: jsPDF, titulo: string, subtitulo: string, logos: Logos): void {
  doc.setFillColor(...COR.preto);
  doc.rect(0, 0, LARGURA_PAGINA, 30, "F");

  doc.setFillColor(...COR.branco);
  doc.roundedRect(12, 6, 20, 18, 2, 2, "F");
  const apex = caber(LOGO_APEX, 16, 14);
  doc.addImage(logos.apex, LOGO_APEX.formato, 12 + (20 - apex.w) / 2, 6 + (18 - apex.h) / 2, apex.w, apex.h, "logo-apex", "FAST");

  doc.setFillColor(...COR.branco);
  doc.roundedRect(178, 6, 20, 18, 2, 2, "F");
  const claro = caber(LOGO_CLARO, 16, 14);
  doc.addImage(logos.claro, LOGO_CLARO.formato, 178 + (20 - claro.w) / 2, 6 + (18 - claro.h) / 2, claro.w, claro.h, "logo-claro", "FAST");

  doc.setTextColor(...COR.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(titulo, LARGURA_PAGINA / 2, 14, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(subtitulo, LARGURA_PAGINA / 2, 21, { align: "center", maxWidth: 130 });
}

export function desenharRodape(doc: jsPDF, emitidoEm: string, validoAte: string): void {
  const total = doc.getNumberOfPages();
  const altura = doc.internal.pageSize.getHeight();
  for (let pagina = 1; pagina <= total; pagina++) {
    doc.setPage(pagina);
    doc.setFillColor(...COR.preto);
    doc.rect(0, altura - ALTURA_RODAPE, LARGURA_PAGINA, ALTURA_RODAPE, "F");
    doc.setTextColor(...COR.branco);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.text(RODAPE_EMPRESA, MARGEM, altura - 8);
    doc.setFont("helvetica", "normal");
    doc.text(`Emitido em ${emitidoEm} · Válida até ${validoAte}`, MARGEM, altura - 4);
    doc.text(`Página ${pagina} de ${total}`, LARGURA_PAGINA - MARGEM, altura - 4, { align: "right" });
  }
}

export function finalDaUltimaTabela(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
}

// Se não couber `altura` mm antes do rodapé, abre uma página nova.
export function garantirEspaco(doc: jsPDF, y: number, altura: number): number {
  const limite = doc.internal.pageSize.getHeight() - ALTURA_RODAPE - 4;
  if (y + altura > limite) {
    doc.addPage();
    return 16;
  }
  return y;
}

export function tituloDeSecao(doc: jsPDF, y: number, titulo: string): number {
  const posicao = garantirEspaco(doc, y, 20);
  doc.setTextColor(...COR.vermelho);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(titulo, MARGEM, posicao + 4);
  return posicao + 7;
}

export function notaPequena(doc: jsPDF, y: number, texto: string): number {
  const linhas = doc.splitTextToSize(texto, LARGURA_UTIL) as string[];
  const posicao = garantirEspaco(doc, y, linhas.length * 3.5 + 2);
  doc.setTextColor(...COR.cinzaTexto);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.text(linhas, MARGEM, posicao + 3);
  return posicao + linhas.length * 3.5 + 3;
}

interface OpcoesTabela {
  larguras?: Record<number, number>; // largura fixa (mm) por coluna
  direita?: number[]; // colunas alinhadas à direita
  centro?: number[];
  linhaTotal?: string[]; // última linha, em negrito
  corCabecalho?: RGB;
}

export function desenharTabela(
  doc: jsPDF,
  inicioY: number,
  cabecalho: string[],
  corpo: string[][],
  opcoes: OpcoesTabela = {}
): number {
  // O autotable indexa as colunas por texto ("0", "1"...).
  const colunas: Record<string, { halign?: "right" | "center"; cellWidth?: number }> = {};
  cabecalho.forEach((_, i) => {
    colunas[String(i)] = {
      ...(opcoes.direita?.includes(i) ? { halign: "right" as const } : {}),
      ...(opcoes.centro?.includes(i) ? { halign: "center" as const } : {}),
      ...(opcoes.larguras?.[i] ? { cellWidth: opcoes.larguras[i] } : {}),
    };
  });
  const indiceTotal = corpo.length;
  autoTable(doc, {
    startY: inicioY,
    head: [cabecalho],
    body: opcoes.linhaTotal ? [...corpo, opcoes.linhaTotal] : corpo,
    margin: { left: MARGEM, right: MARGEM, top: 16, bottom: ALTURA_RODAPE + 4 },
    theme: "grid",
    styles: { fontSize: 8.5, textColor: COR.preto, lineColor: COR.borda, lineWidth: 0.2, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: opcoes.corCabecalho ?? COR.vermelho, textColor: COR.branco, fontStyle: "bold" },
    alternateRowStyles: { fillColor: COR.cinzaFundo },
    columnStyles: colunas,
    didParseCell: (dados) => {
      if (opcoes.linhaTotal && dados.section === "body" && dados.row.index === indiceTotal) {
        dados.cell.styles.fontStyle = "bold";
        dados.cell.styles.fillColor = COR.cinzaFundo;
      }
    },
  });
  return finalDaUltimaTabela(doc);
}

// Cliente, CNPJ, emissão e consultor numa tabela de uma linha: a altura acompanha
// a razão social, por mais longa que seja.
export function desenharDadosDoCliente(doc: jsPDF, inicioY: number, modelo: ModeloDocumento): number {
  autoTable(doc, {
    startY: inicioY,
    head: [["CLIENTE", "CNPJ", "DATA DE EMISSÃO", "CONSULTOR"]],
    body: [[modelo.cliente.razaoSocial, modelo.cliente.cnpj, modelo.emitidoEm, modelo.consultor]],
    margin: { left: MARGEM, right: MARGEM, top: 16, bottom: ALTURA_RODAPE + 4 },
    theme: "grid",
    styles: { fontSize: 9.5, textColor: COR.preto, lineColor: COR.borda, lineWidth: 0.2, cellPadding: 2.5, fontStyle: "bold", overflow: "linebreak" },
    headStyles: { fillColor: COR.cinzaFundo, textColor: COR.cinzaTexto, fontSize: 7, fontStyle: "bold" },
    columnStyles: { 1: { cellWidth: 38 }, 2: { cellWidth: 30 }, 3: { cellWidth: 38 } },
  });
  return finalDaUltimaTabela(doc);
}

export function caixaDeDestaque(
  doc: jsPDF,
  y: number,
  titulo: string,
  valor: string,
  cor: RGB,
  linhaExtra?: string
): number {
  const altura = linhaExtra ? 28 : 22;
  const posicao = garantirEspaco(doc, y, altura + 2);
  doc.setFillColor(...cor);
  doc.roundedRect(MARGEM, posicao, LARGURA_UTIL, altura, 2, 2, "F");
  doc.setTextColor(...COR.branco);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(titulo, MARGEM + 6, posicao + 7);
  doc.setFontSize(18);
  doc.text(valor, MARGEM + 6, posicao + 17);
  if (linhaExtra) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(linhaExtra, MARGEM + 6, posicao + 24);
  }
  return posicao + altura + 6;
}

export function desenharBeneficios(doc: jsPDF, y: number, badges: Badge[]): number {
  let atual = y;
  for (const badge of badges) {
    atual = garantirEspaco(doc, atual, 8);
    doc.setFillColor(...hexParaRgb(badge.cor));
    doc.roundedRect(MARGEM, atual, 3.5, 3.5, 0.8, 0.8, "F");
    doc.setTextColor(...COR.preto);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(badge.label, MARGEM + 6, atual + 3);
    // Mede o nome AINDA em negrito 9: medir depois de trocar para a fonte da
    // descrição (menor) faria as duas se sobreporem.
    const larguraDoNome = doc.getTextWidth(badge.label);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...COR.cinzaTexto);
    doc.setFontSize(8);
    doc.text(badge.desc, MARGEM + 6 + larguraDoNome + 3, atual + 3, {
      maxWidth: LARGURA_UTIL - 6 - larguraDoNome - 3,
    });
    atual += 6;
  }
  return atual + 2;
}
