// PDF para o cliente final (porta de generateFaturaAnalisePDF e de
// montarPdfPropostaCliente do painel): resumo de relance, com a economia em
// verde ou o aumento em âmbar, o comparativo por linha e as tabelas.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import {
  SUBTITULO_CONSULTOR,
  destaqueDoCliente,
  linhasDaTabela,
  moeda,
  rotuloTotalProposta,
  tituloDoCliente,
} from "./formato";
import type { Logos } from "./marca";
import {
  COR,
  LARGURA_UTIL,
  MARGEM,
  caixaDeDestaque,
  desenharBeneficios,
  desenharCabecalho,
  desenharRodape,
  desenharTabela,
  garantirEspaco,
  notaPequena,
  novoDocumento,
  tituloDeSecao,
  type RGB,
} from "./pdf-base";
import type { jsPDF } from "jspdf";

const CABECALHO = ["DESCRIÇÃO", "QTD", "VALOR", "SUBTOTAL"];
const ESTILO_TABELA = { larguras: { 1: 14, 2: 30, 3: 30 }, centro: [1], direita: [2, 3] };

function cartao(doc: jsPDF, x: number, y: number, largura: number, rotulo: string, valor: string, cor: RGB): void {
  doc.setFillColor(...COR.cinzaFundo);
  doc.setDrawColor(...COR.borda);
  doc.roundedRect(x, y, largura, 24, 2, 2, "FD");
  doc.setTextColor(...COR.cinzaTexto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(rotulo, x + 4, y + 8, { maxWidth: largura - 8 });
  doc.setTextColor(...cor);
  doc.setFontSize(13.5);
  doc.text(valor, x + 4, y + 18);
}

function corDoDestaque(cor: "verde" | "ambar" | "preto"): RGB {
  return cor === "verde" ? COR.verde : cor === "ambar" ? COR.ambar : COR.preto;
}

function desenharCartoes(doc: jsPDF, y: number, modelo: ModeloDocumento): number {
  const destaque = destaqueDoCliente(modelo);
  const cartoes: Array<[string, string, RGB]> =
    modelo.resumo.atual === null
      ? [["MENSALIDADE PROPOSTA", moeda(modelo.resumo.proposto), COR.preto]]
      : [
          ["MENSALIDADE ATUAL", moeda(modelo.resumo.atual), COR.cinzaTexto],
          ["NOVA MENSALIDADE", moeda(modelo.resumo.proposto), COR.preto],
          [destaque.titulo, destaque.valor, corDoDestaque(destaque.cor)],
        ];
  const folga = 4;
  const largura = (LARGURA_UTIL - folga * (cartoes.length - 1)) / cartoes.length;
  cartoes.forEach(([rotulo, valor, cor], i) => cartao(doc, MARGEM + i * (largura + folga), y, largura, rotulo, valor, cor));
  return y + 24 + 8;
}

export function gerarPdfCliente(modelo: ModeloDocumento, logos: Logos): Uint8Array {
  const doc = novoDocumento();
  desenharCabecalho(doc, tituloDoCliente(modelo), SUBTITULO_CONSULTOR, logos);

  doc.setTextColor(...COR.preto);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const linhasNome = doc.splitTextToSize(modelo.cliente.razaoSocial || "Cliente", LARGURA_UTIL - 50) as string[];
  doc.text(linhasNome, MARGEM, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COR.cinzaTexto);
  doc.text(`Emitido em ${modelo.emitidoEm}`, MARGEM + LARGURA_UTIL, 38, { align: "right" });
  doc.text(`CNPJ ${modelo.cliente.cnpj} · Consultor: ${modelo.consultor}`, MARGEM, 38 + linhasNome.length * 5 + 1);

  let y = desenharCartoes(doc, 38 + linhasNome.length * 5 + 6, modelo);

  if (modelo.situacaoAtual && modelo.situacaoAtual.itens.length > 0) {
    if (modelo.porLinha && modelo.porLinha.length > 0) {
      y = tituloDeSecao(doc, y, "COMPARATIVO POR LINHA");
      y = desenharTabela(
        doc,
        y,
        ["LINHA", "PLANO ATUAL", "CONSUMO", "PLANO PROPOSTO", "VALOR ATUAL", "VALOR PROPOSTO"],
        modelo.porLinha.map((linha) => [
          linha.rotulo,
          linha.planoAtual,
          linha.consumo,
          linha.planoProposto,
          moeda(linha.valorAtual),
          linha.valorProposto === null ? "-" : moeda(linha.valorProposto),
        ]),
        { larguras: { 0: 30, 1: 20, 2: 24, 4: 25, 5: 27 }, direita: [4, 5], centro: [1, 2] }
      );
      y += 8;
    }

    y = tituloDeSecao(doc, y, "SUA SITUAÇÃO ATUAL");
    y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.situacaoAtual.itens), {
      ...ESTILO_TABELA,
      linhaTotal: ["TOTAL ATUAL", "", "", moeda(modelo.situacaoAtual.total)],
    });
    y = notaPequena(doc, y + 1, modelo.situacaoAtual.nota) + 4;
  }

  y = tituloDeSecao(doc, y, "NOSSA PROPOSTA");
  y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.novaProposta.itens), {
    ...ESTILO_TABELA,
    linhaTotal: [rotuloTotalProposta(modelo), "", "", moeda(modelo.novaProposta.total)],
  });
  y += 8;

  if (modelo.beneficios.badges.length > 0) {
    y = tituloDeSecao(doc, y, "BENEFÍCIOS INCLUSOS");
    y = desenharBeneficios(doc, y, modelo.beneficios.badges);
  }

  const destaque = destaqueDoCliente(modelo);
  y = garantirEspaco(doc, y + 2, 30);
  caixaDeDestaque(doc, y, destaque.titulo, destaque.valor, corDoDestaque(destaque.cor));

  desenharRodape(doc, modelo.emitidoEm, modelo.validoAte);
  return new Uint8Array(doc.output("arraybuffer"));
}
