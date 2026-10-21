import { describe, it, expect } from "vitest";
import {
  extrairLinhasFatura,
  interpretarLeitura,
  mensagemDeLeitura,
  normalizarAcentosPdf,
} from "./extrair";

interface OpcoesBloco {
  ddd: string;
  parte1: string;
  parte2: string;
  valor?: string;
  gb?: number;
  mb?: string;
  monitor?: boolean;
  apps?: boolean;
}

// Fixture SINTÉTICA no formato da fatura Claro, com o artefato do pdf.js
// (espaço colado em cada caractere acentuado: "LIGA ÇÕ ES"). Nenhum número real.
function bloco(o: OpcoesBloco): string {
  return [
    "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR",
    `(${o.ddd}) ${o.parte1}-${o.parte2}`,
    "Mensalidades e Pacotes Promocionais",
    o.valor ? `Oferta Conjunta Claro MIX ${o.valor}` : "",
    o.gb ? `Claro P ó s ${o.gb}GB -` : "",
    o.monitor ? "Claro Monitor lite -" : "",
    o.apps ? "Aplicativos Digitais -" : "",
    "Liga çõ es Locais 0,00",
    o.mb ? `Internet (MB) Descri çã o Subtotal ${o.mb} 0,0000` : "",
    "TOTAL 99,99",
  ]
    .filter(Boolean)
    .join(" ");
}

const CAPA = "Fatura Claro Empresas Resumo da conta 1.234,56 ";

describe("normalizarAcentosPdf", () => {
  it("cola de volta as palavras que o pdf.js separou nos acentos", () => {
    expect(normalizarAcentosPdf("LIGA ÇÕ ES")).toBe("LIGAÇÕES");
    expect(normalizarAcentosPdf("Descri çã o")).toBe("Descrição");
    expect(normalizarAcentosPdf("P ó s")).toBe("Pós");
  });

  it("não mexe nos espaços entre palavras sem acento nem nos números", () => {
    expect(normalizarAcentosPdf("Oferta Conjunta Claro MIX 48,49")).toBe("Oferta Conjunta Claro MIX 48,49");
  });
});

describe("extrairLinhasFatura", () => {
  it("extrai telefone, valor, plano, consumo e Claro Monitor de cada linha", () => {
    const texto =
      CAPA +
      bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10, mb: "5.120,50", monitor: true }) +
      " " +
      bloco({ ddd: "11", parte1: "3000", parte2: "0002", valor: "58,99", gb: 20, mb: "800,00" });
    expect(extrairLinhasFatura(texto)).toEqual([
      { ddd: "17", numero: "900000001", valorMensal: 48.49, planoGb: 10, temMonitor: true, consumoMb: 5120.5 },
      { ddd: "11", numero: "30000002", valorMensal: 58.99, planoGb: 20, temMonitor: false, consumoMb: 800 },
    ]);
  });

  it("linha sem a seção Internet (MB) tem consumo zero, não 'sem dado'", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10 }));
    expect(linha.consumoMb).toBe(0);
  });

  it("lê valor com separador de milhar", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "1.234,56", gb: 10 }));
    expect(linha.valorMensal).toBe(1234.56);
  });

  it("devolve valorMensal nulo quando só o plano foi reconhecido", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", gb: 10 }));
    expect(linha.valorMensal).toBeNull();
    expect(linha.planoGb).toBe(10);
  });

  it("devolve planoGb nulo quando só o valor foi reconhecido", () => {
    const [linha] = extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49" }));
    expect(linha.planoGb).toBeNull();
    expect(linha.valorMensal).toBe(48.49);
  });

  it("ignora o bloco sem plano nem valor (linha sem uso no período)", () => {
    expect(extrairLinhasFatura(bloco({ ddd: "17", parte1: "90000", parte2: "0001" }))).toEqual([]);
  });

  it("ignora o bloco sem telefone reconhecível", () => {
    const texto = "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR sem numero Mensalidades e Pacotes Promocionais Oferta Conjunta Claro MIX 10,00 TOTAL 1";
    expect(extrairLinhasFatura(texto)).toEqual([]);
  });

  it("outro layout de fatura (sem o título do detalhamento) devolve lista vazia", () => {
    expect(extrairLinhasFatura("Fatura de outra operadora Plano Controle 30GB R$ 49,90")).toEqual([]);
  });

  it("texto vazio devolve lista vazia", () => {
    expect(extrairLinhasFatura("")).toEqual([]);
  });

  it("aceita telefone de 8 dígitos (fixo) e de 9 (celular)", () => {
    const texto =
      bloco({ ddd: "17", parte1: "3000", parte2: "0001", valor: "10,00", gb: 5 }) +
      " " +
      bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "10,00", gb: 5 });
    expect(extrairLinhasFatura(texto).map((l) => l.numero)).toEqual(["30000001", "900000001"]);
  });
});

describe("interpretarLeitura", () => {
  it("texto vazio ou só espaço é PDF sem texto (escaneado)", () => {
    expect(interpretarLeitura("")).toEqual({ tipo: "sem_texto" });
    expect(interpretarLeitura(" \n \n")).toEqual({ tipo: "sem_texto" });
  });

  it("texto sem nenhuma linha reconhecida é 'sem_linhas'", () => {
    expect(interpretarLeitura("Fatura de outra operadora")).toEqual({ tipo: "sem_linhas" });
  });

  it("texto com linhas é 'ok' e traz as linhas", () => {
    const leitura = interpretarLeitura(bloco({ ddd: "17", parte1: "90000", parte2: "0001", valor: "48,49", gb: 10 }));
    expect(leitura.tipo).toBe("ok");
    if (leitura.tipo === "ok") expect(leitura.linhas).toHaveLength(1);
  });
});

describe("mensagemDeLeitura", () => {
  it("cita o arquivo e manda digitar, nos dois casos", () => {
    expect(mensagemDeLeitura("fatura.pdf", { tipo: "sem_texto" })).toMatch(/fatura\.pdf.*escaneado/i);
    expect(mensagemDeLeitura("fatura.pdf", { tipo: "sem_linhas" })).toMatch(/fatura\.pdf.*digite/i);
  });

  it("aponta o botão que existe (Adicionar linha), não uma tabela que ainda não está na tela", () => {
    for (const tipo of ["sem_texto", "sem_linhas"] as const) {
      const mensagem = mensagemDeLeitura("fatura.pdf", { tipo });
      expect(mensagem).toMatch(/adicionar linha/i);
      expect(mensagem).not.toMatch(/tabela abaixo/i);
    }
  });
});
