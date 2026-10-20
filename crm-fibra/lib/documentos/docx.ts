// Word editável da proposta comercial (consultor). Só desenha o ModeloDocumento:
// nenhuma conta de negócio aqui.
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { LinhaTabela, ModeloDocumento } from "../proposta/modelo-documento";
import {
  RODAPE_EMPRESA,
  SUBTITULO_CONSULTOR,
  linhasDaTabela,
  moeda,
  reducaoDe,
  rotuloTotalProposta,
  textoReducao,
} from "./formato";
import { LOGO_APEX, LOGO_CLARO, type Logos } from "./marca";

const PRETO = "0D0D0D";
const VERMELHO = "B3101F";
const CINZA_FUNDO = "F3F4F6";
const CINZA_TEXTO = "6B7280";
const BORDA = { style: BorderStyle.SINGLE, size: 4, color: "D1D5DB" };
const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };
const SEM_BORDA = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const SEM_BORDAS = { top: SEM_BORDA, bottom: SEM_BORDA, left: SEM_BORDA, right: SEM_BORDA };

// Mantém a proporção do logo dentro de um quadrado de `lado` pixels.
function tamanhoDoLogo(logo: { largura: number; altura: number }, lado: number) {
  const escala = Math.min(lado / logo.largura, lado / logo.altura);
  return { width: Math.round(logo.largura * escala), height: Math.round(logo.altura * escala) };
}

function texto(conteudo: string, opcoes: { negrito?: boolean; cor?: string; tamanho?: number } = {}): TextRun {
  return new TextRun({ text: conteudo, bold: opcoes.negrito, color: opcoes.cor, size: (opcoes.tamanho ?? 10) * 2 });
}

function celula(
  conteudo: string,
  opcoes: { largura: number; fundo?: string; cor?: string; negrito?: boolean; direita?: boolean; tamanho?: number }
): TableCell {
  return new TableCell({
    width: { size: opcoes.largura, type: WidthType.PERCENTAGE },
    borders: BORDAS,
    shading: opcoes.fundo ? { type: ShadingType.CLEAR, color: "auto", fill: opcoes.fundo } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: opcoes.direita ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [texto(conteudo, { negrito: opcoes.negrito, cor: opcoes.cor, tamanho: opcoes.tamanho })],
      }),
    ],
  });
}

const LARGURAS = [52, 10, 19, 19];

function tabelaDeItens(itens: LinhaTabela[], total: number, rotuloTotal: string): Table {
  const cabecalho = new TableRow({
    tableHeader: true,
    children: ["DESCRIÇÃO", "QTD", "VALOR UNIT.", "SUBTOTAL"].map((nome, i) =>
      celula(nome, { largura: LARGURAS[i], fundo: VERMELHO, cor: "FFFFFF", negrito: true, direita: i > 0, tamanho: 8.5 })
    ),
  });
  const corpo = linhasDaTabela(itens).map(
    (colunas, indice) =>
      new TableRow({
        children: colunas.map((valor, i) =>
          celula(valor, { largura: LARGURAS[i], fundo: indice % 2 ? CINZA_FUNDO : undefined, direita: i > 0 })
        ),
      })
  );
  const linhaTotal = new TableRow({
    children: [
      celula(rotuloTotal, { largura: LARGURAS[0] + LARGURAS[1] + LARGURAS[2], fundo: CINZA_FUNDO, negrito: true }),
      celula(moeda(total), { largura: LARGURAS[3], fundo: CINZA_FUNDO, negrito: true, direita: true }),
    ],
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [cabecalho, ...corpo, linhaTotal] });
}

function secao(titulo: string): Paragraph {
  return new Paragraph({
    spacing: { before: 280, after: 100 },
    children: [texto(titulo, { negrito: true, cor: VERMELHO, tamanho: 11 })],
  });
}

function cabecalhoComLogos(logos: Logos): Table {
  const apex = tamanhoDoLogo(LOGO_APEX, 48);
  const claro = tamanhoDoLogo(LOGO_CLARO, 48);
  const fundo = { type: ShadingType.CLEAR, color: "auto", fill: PRETO } as const;
  const centro = (linhas: Paragraph[]) =>
    new TableCell({ width: { size: 70, type: WidthType.PERCENTAGE }, borders: SEM_BORDAS, shading: fundo, verticalAlign: VerticalAlign.CENTER, children: linhas });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: fundo,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 100, bottom: 100, left: 150, right: 100 },
            children: [new Paragraph({ children: [new ImageRun({ type: "png", data: logos.apex, transformation: apex })] })],
          }),
          centro([
            new Paragraph({ alignment: AlignmentType.CENTER, children: [texto("PROPOSTA COMERCIAL", { negrito: true, cor: "FFFFFF", tamanho: 16 })] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [texto(SUBTITULO_CONSULTOR, { cor: "FFFFFF", tamanho: 8.5 })] }),
          ]),
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: fundo,
            verticalAlign: VerticalAlign.CENTER,
            margins: { top: 100, bottom: 100, left: 100, right: 150 },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: "jpg", data: logos.claro, transformation: claro })] })],
          }),
        ],
      }),
    ],
  });
}

function dadosDoCliente(modelo: ModeloDocumento): Table {
  const rotulo = (nome: string, largura: number) =>
    celula(nome, { largura, fundo: CINZA_FUNDO, cor: CINZA_TEXTO, negrito: true, tamanho: 7.5 });
  const valor = (conteudo: string, largura: number) => celula(conteudo, { largura, negrito: true, tamanho: 10.5 });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [rotulo("CLIENTE", 40), rotulo("CNPJ", 20), rotulo("DATA DE EMISSÃO", 15), rotulo("CONSULTOR", 25)] }),
      new TableRow({
        children: [
          valor(modelo.cliente.razaoSocial, 40),
          valor(modelo.cliente.cnpj, 20),
          valor(modelo.emitidoEm, 15),
          valor(modelo.consultor, 25),
        ],
      }),
    ],
  });
}

function caixaDeDestaque(modelo: ModeloDocumento): Table {
  const reducao = reducaoDe(modelo);
  const linhas = [
    new Paragraph({ children: [texto("VALOR PROPOSTO (MENSAL)", { negrito: true, cor: "FFFFFF", tamanho: 8.5 })] }),
    new Paragraph({ children: [texto(moeda(modelo.resumo.proposto), { negrito: true, cor: "FFFFFF", tamanho: 20 })] }),
    ...(reducao
      ? [new Paragraph({ children: [texto(textoReducao(reducao), { cor: "FFFFFF", tamanho: 10 })] })]
      : []),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: SEM_BORDAS,
            shading: { type: ShadingType.CLEAR, color: "auto", fill: VERMELHO },
            margins: { top: 160, bottom: 160, left: 240, right: 240 },
            children: linhas,
          }),
        ],
      }),
    ],
  });
}

export async function gerarDocx(modelo: ModeloDocumento, logos: Logos): Promise<Uint8Array> {
  const filhos: Array<Paragraph | Table> = [
    cabecalhoComLogos(logos),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
    dadosDoCliente(modelo),
  ];

  if (modelo.situacaoAtual) {
    filhos.push(
      secao("SITUAÇÃO ATUAL"),
      tabelaDeItens(modelo.situacaoAtual.itens, modelo.situacaoAtual.total, "TOTAL ATUAL"),
      new Paragraph({ spacing: { before: 60 }, children: [texto(modelo.situacaoAtual.nota, { cor: CINZA_TEXTO, tamanho: 7.5 })] })
    );
  }

  filhos.push(
    secao("NOVA PROPOSTA"),
    tabelaDeItens(modelo.novaProposta.itens, modelo.novaProposta.total, rotuloTotalProposta(modelo))
  );

  if (modelo.beneficios.badges.length > 0) {
    filhos.push(secao("BENEFÍCIOS INCLUSOS"));
    for (const badge of modelo.beneficios.badges) {
      filhos.push(
        new Paragraph({
          spacing: { after: 60 },
          children: [texto(`${badge.label}: `, { negrito: true, cor: badge.cor, tamanho: 9.5 }), texto(badge.desc, { tamanho: 9.5 })],
        })
      );
    }
  }

  filhos.push(new Paragraph({ spacing: { after: 160 }, children: [] }), caixaDeDestaque(modelo));
  filhos.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 280 },
      children: [texto(RODAPE_EMPRESA, { cor: CINZA_TEXTO, tamanho: 8 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [texto(`Emitido em ${modelo.emitidoEm} · Válida até ${modelo.validoAte}`, { cor: CINZA_TEXTO, tamanho: 8 })],
    })
  );

  const documento = new Document({ sections: [{ children: filhos }] });
  return new Uint8Array(await Packer.toArrayBuffer(documento));
}
