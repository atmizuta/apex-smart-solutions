// Apoio dos testes dos desenhistas de arquivo (Word, PDF): dados SINTÉTICOS e
// leitores de volta (o que está dentro do arquivo gerado). Não é teste.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import JSZip from "jszip";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extrairTextoDePaginas, type PdfjsMinimo } from "../fatura/pdf-texto";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { subtotalDaLinha, type NovoItemProposta } from "../propostas";
import {
  montarModeloDocumento,
  type EntradaModelo,
  type ModeloDocumento,
} from "../proposta/modelo-documento";
import type { Logos } from "./marca";

export const AGORA_TESTE = new Date("2026-10-19T15:00:00Z"); // 12h em Brasília

function lerMarca(arquivo: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../public/marca/${arquivo}`, import.meta.url))));
}

export function logosDeTeste(): Logos {
  return { apex: lerMarca("apex-logo.png"), claro: lerMarca("claro-logo.jpg") };
}

function fatura(parcial: Partial<LinhaAtual>): LinhaAtual {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 9728,
    origem: "fatura",
    proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
    ...parcial,
  };
}

export const SITUACAO_TESTE: SituacaoAtual = {
  faturasAnalisadas: 2,
  linhas: [
    fatura({ rotulo: "(17) ••••• 0001" }),
    fatura({ rotulo: "(17) ••••• 0002" }),
    fatura({ rotulo: "(17) ••••• 0003", planoGb: 20, valorUnitario: 58.99, consumoMb: 2048 }),
  ],
};

// Padrão dos testes: situação atual de R$ 155,97 contra uma proposta de R$ 134,97
// (119,97 de Pós + 15,00 de Claro Monitor), ou seja, uma economia de R$ 21,00.
export const ITENS_TESTE: NovoItemProposta[] = [
  { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: subtotalDaLinha(39.99, 3), quantidade: 3, franquiaGb: 12 },
  { catalogoPlanoId: "m1", descricao: "Claro Monitor", valor: subtotalDaLinha(5, 3), quantidade: 3, franquiaGb: null },
];

export function entradaDeTeste(parcial: Partial<EntradaModelo> = {}): EntradaModelo {
  return {
    cliente: { razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" },
    consultor: "Ana Teste",
    situacaoAtual: SITUACAO_TESTE,
    itens: ITENS_TESTE,
    opcoes: { consolidar: false, vendedor: null },
    agora: AGORA_TESTE,
    ...parcial,
  };
}

export function modeloDeTeste(parcial: Partial<EntradaModelo> = {}): ModeloDocumento {
  return montarModeloDocumento(entradaDeTeste(parcial));
}

const require = createRequire(import.meta.url);
const OPCOES_PDFJS = {
  standardFontDataUrl: pathToFileURL(join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + sep).href,
};

export async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  return extrairTextoDePaginas(pdfjs as unknown as PdfjsMinimo, bytes, "teste.pdf", OPCOES_PDFJS);
}

export async function paginasDoPdf(bytes: Uint8Array): Promise<number> {
  return (await textoDoPdf(bytes)).split("\n").length;
}

export async function textoDoDocx(bytes: Uint8Array): Promise<{ xml: string; imagens: number }> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await (zip.file("word/document.xml") as JSZip.JSZipObject).async("string");
  // O zip também traz a própria pasta "word/media/" como uma entrada: só contam arquivos.
  const imagens = Object.values(zip.files).filter((entrada) => !entrada.dir && entrada.name.startsWith("word/media/")).length;
  return { xml, imagens };
}
