import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  FaturaIlegivelError,
  LIMITE_ARQUIVOS,
  LIMITE_BYTES,
  LeitorPdfIndisponivelError,
  extrairTextoDePaginas,
  validarArquivos,
  type PdfjsMinimo,
} from "./pdf-texto";

const require = createRequire(import.meta.url);
const FONTES = pathToFileURL(
  join(dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts") + sep
).href;
const pdfjsReal = pdfjs as unknown as PdfjsMinimo;
const OPCOES = { standardFontDataUrl: FONTES };

// Linhas curtas: uma linha mais larga que a página é cortada na borda e perde o final.
function pdfComPaginas(paginas: string[][]): Uint8Array {
  const doc = new jsPDF();
  doc.setFontSize(9);
  paginas.forEach((linhas, indice) => {
    if (indice > 0) doc.addPage();
    linhas.forEach((linha, i) => doc.text(linha, 10, 20 + i * 8));
  });
  return new Uint8Array(doc.output("arraybuffer"));
}

describe("extrairTextoDePaginas", () => {
  it("lê o texto de um PDF, com acentos", async () => {
    const dados = pdfComPaginas([["Mensalidades e Pacotes", "Oferta Conjunta Claro MIX 48,49", "Claro Pós 10GB -"]]);
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(texto).toContain("Mensalidades e Pacotes");
    expect(texto).toContain("Oferta Conjunta Claro MIX 48,49");
    expect(texto).toContain("Claro Pós 10GB -");
  });

  it("junta as páginas na ordem, separadas por quebra de linha", async () => {
    const dados = pdfComPaginas([["Pagina um"], ["Pagina dois"]]);
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(texto.indexOf("Pagina um")).toBeLessThan(texto.indexOf("Pagina dois"));
    expect(texto.split("\n")).toHaveLength(2);
  });

  it("PDF sem camada de texto (escaneado) devolve texto vazio, sem lançar", async () => {
    const doc = new jsPDF();
    doc.rect(10, 10, 50, 50);
    const dados = new Uint8Array(doc.output("arraybuffer"));
    const texto = await extrairTextoDePaginas(pdfjsReal, dados, "scan.pdf", OPCOES);
    expect(texto.trim()).toBe("");
  });

  it("bytes que não são um PDF viram FaturaIlegivelError com o nome do arquivo", async () => {
    const promessa = extrairTextoDePaginas(pdfjsReal, new Uint8Array([1, 2, 3]), "quebrado.pdf", OPCOES);
    await expect(promessa).rejects.toBeInstanceOf(FaturaIlegivelError);
    await expect(promessa).rejects.toMatchObject({ arquivo: "quebrado.pdf" });
  });

  it("falha do próprio leitor (não do PDF) vira LeitorPdfIndisponivelError, sem culpar o arquivo", async () => {
    const quebrado: PdfjsMinimo = {
      getDocument: () => ({ promise: Promise.reject(new TypeError("x.getOrInsertComputed is not a function")) }),
    };
    await expect(extrairTextoDePaginas(quebrado, new Uint8Array([1]), "fatura.pdf")).rejects.toBeInstanceOf(
      LeitorPdfIndisponivelError
    );
  });

  it("erro de documento do pdf.js (senha, PDF inválido) continua sendo FaturaIlegivelError", async () => {
    for (const nome of ["PasswordException", "InvalidPDFException", "FormatError"]) {
      const erro = Object.assign(new Error("x"), { name: nome });
      const falso: PdfjsMinimo = { getDocument: () => ({ promise: Promise.reject(erro) }) };
      await expect(extrairTextoDePaginas(falso, new Uint8Array([1]), "a.pdf")).rejects.toBeInstanceOf(
        FaturaIlegivelError
      );
    }
  });

  it("o navegador carrega a build legacy do pdf.js e o worker da mesma build (a moderna exige navegador novo)", () => {
    const fonte = readFileSync(new URL("./pdf-texto.ts", import.meta.url), "utf8");
    expect(fonte).toContain('import("pdfjs-dist/legacy/build/pdf.mjs")');
    expect(fonte).toContain('"pdfjs-dist/legacy/build/pdf.worker.min.mjs"');
    expect(fonte).not.toContain("pdfjs-dist/build/");
  });

  it("não consome o buffer que o chamador passou (o pdf.js destrói o que recebe)", async () => {
    const dados = pdfComPaginas([["Texto"]]);
    const tamanho = dados.byteLength;
    await extrairTextoDePaginas(pdfjsReal, dados, "a.pdf", OPCOES);
    expect(dados.byteLength).toBe(tamanho);
  });
});

describe("validarArquivos", () => {
  const pdf = { name: "fatura.pdf", size: 1000, type: "application/pdf" };

  it("aceita de 1 até o limite de PDFs", () => {
    expect(validarArquivos([pdf])).toBeNull();
    expect(validarArquivos(Array.from({ length: LIMITE_ARQUIVOS }, () => pdf))).toBeNull();
  });

  it("aceita PDF cujo navegador não informou o tipo, pela extensão", () => {
    expect(validarArquivos([{ name: "FATURA.PDF", size: 10, type: "" }])).toBeNull();
  });

  it("recusa lista vazia", () => {
    expect(validarArquivos([])).toMatch(/pelo menos um/i);
  });

  it("recusa mais PDFs que o limite", () => {
    const lista = Array.from({ length: LIMITE_ARQUIVOS + 1 }, () => pdf);
    expect(validarArquivos(lista)).toMatch(new RegExp(String(LIMITE_ARQUIVOS)));
  });

  it("recusa arquivo que não é PDF, citando o nome", () => {
    expect(validarArquivos([{ name: "foto.png", size: 10, type: "image/png" }])).toMatch(/foto\.png/);
  });

  it("recusa arquivo acima de 10 MB e arquivo vazio", () => {
    expect(validarArquivos([{ ...pdf, size: LIMITE_BYTES + 1 }])).toMatch(/10 MB/);
    expect(validarArquivos([{ ...pdf, size: 0 }])).toMatch(/vazio/);
  });
});
