import { describe, it, expect } from "vitest";
import {
  LIMITE_LINHAS,
  contarDigitos,
  rotuloDaLinha,
  temNumeroCompleto,
  validarSituacaoAtual,
  type LinhaAtual,
} from "./tipos";

const linha: LinhaAtual = {
  rotulo: "(17) ••••• 0001",
  quantidade: 1,
  planoGb: 10,
  valorUnitario: 48.49,
  consumoMb: 5120.5,
  origem: "fatura",
  proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
};

describe("rotuloDaLinha", () => {
  it("mostra só o DDD e os 4 últimos dígitos", () => {
    expect(rotuloDaLinha("17", "900000001")).toBe("(17) ••••• 0001");
    expect(rotuloDaLinha("11", "30000002")).toBe("(11) ••••• 0002");
  });

  it("o rótulo gerado nunca conta como número completo", () => {
    expect(temNumeroCompleto(rotuloDaLinha("17", "900000001"))).toBe(false);
  });
});

describe("temNumeroCompleto / contarDigitos", () => {
  it.each(["(17) 99219-9652", "17992199652", "Filial 12345678", "55 17 3000-0001"])(
    "%s conta como número completo (8 ou mais dígitos, ignorando separadores)",
    (texto) => {
      expect(temNumeroCompleto(texto)).toBe(true);
    }
  );

  it.each(["Escritório 2024", "(17) ••••• 9652", "Linhas do 2º andar", ""])("%s não conta", (texto) => {
    expect(temNumeroCompleto(texto)).toBe(false);
  });

  it("conta dígitos no total", () => {
    expect(contarDigitos("a1b22c333")).toBe(6);
  });
});

describe("validarSituacaoAtual", () => {
  it("aceita nulo (proposta sem fatura)", () => {
    expect(validarSituacaoAtual(null)).toEqual({ ok: true, valor: null });
    expect(validarSituacaoAtual(undefined)).toEqual({ ok: true, valor: null });
  });

  it("aceita uma situação válida e devolve uma cópia normalizada", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 2,
      linhas: [{ ...linha, rotulo: "  (17) ••••• 0001  ", valorUnitario: 48.494, consumoMb: 5120.504 }],
    });
    expect(resultado).toEqual({
      ok: true,
      valor: { faturasAnalisadas: 2, linhas: [{ ...linha, valorUnitario: 48.49, consumoMb: 5120.5 }] },
    });
  });

  it("aceita linha digitada, sem consumo, sem plano e sem proposto", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 0,
      linhas: [
        { rotulo: "Linhas do escritório", quantidade: 5, planoGb: null, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null },
      ],
    });
    expect(resultado.ok).toBe(true);
  });

  it.each([42, "texto", [], true])("recusa entrada que não é objeto (%s)", (entrada) => {
    expect(validarSituacaoAtual(entrada)).toMatchObject({ ok: false });
  });

  it("recusa situação sem nenhuma linha", () => {
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [] })).toMatchObject({
      ok: false,
      erro: expect.stringMatching(/pelo menos uma linha/),
    });
  });

  it("recusa mais linhas que o limite", () => {
    const linhas = Array.from({ length: LIMITE_LINHAS + 1 }, () => linha);
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas })).toMatchObject({
      ok: false,
      erro: expect.stringContaining(String(LIMITE_LINHAS)),
    });
  });

  it.each([-1, 7, 1.5, "2", null])("recusa faturasAnalisadas %s", (faturasAnalisadas) => {
    expect(validarSituacaoAtual({ faturasAnalisadas, linhas: [linha] })).toMatchObject({ ok: false });
  });

  it("recusa telefone completo no rótulo, digitado ou vindo de chamada forjada", () => {
    for (const rotulo of ["(17) 90000-0001", "17900000001", "Linha 55 17 9000 0001"]) {
      expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, rotulo }] })).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/número completo/),
      });
    }
  });

  const camposInvalidos: Array<[string, unknown]> = [
    ["rotulo", ""],
    ["rotulo", "   "],
    ["rotulo", "x".repeat(61)],
    ["rotulo", 5],
    ["quantidade", 0],
    ["quantidade", 1001],
    ["quantidade", 1.5],
    ["quantidade", "3"],
    ["planoGb", 0],
    ["planoGb", 1001],
    ["planoGb", 2.5],
    ["valorUnitario", 0],
    ["valorUnitario", -1],
    ["valorUnitario", Number.NaN],
    ["valorUnitario", Number.POSITIVE_INFINITY],
    ["valorUnitario", 1_000_001],
    ["valorUnitario", "48,49"],
    ["consumoMb", -1],
    ["consumoMb", 1_000_000_001],
    ["consumoMb", "10"],
    ["origem", "manual"],
    ["origem", undefined],
  ];

  it.each(camposInvalidos)("recusa %s = %s", (campo, valor) => {
    const resultado = validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, [campo]: valor }] });
    expect(resultado).toMatchObject({ ok: false });
  });

  it("aponta o número da linha com problema", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 1,
      linhas: [linha, { ...linha, valorUnitario: 0 }],
    });
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/^Linha 2:/) });
  });

  it.each([
    [{ descricao: "", valorUnitario: 10 }],
    [{ descricao: "x".repeat(301), valorUnitario: 10 }],
    [{ descricao: "Pós", valorUnitario: 0 }],
    [{ descricao: 5, valorUnitario: 10 }],
    ["texto"],
  ])("recusa plano proposto inválido (%j)", (proposto) => {
    expect(validarSituacaoAtual({ faturasAnalisadas: 1, linhas: [{ ...linha, proposto }] })).toMatchObject({ ok: false });
  });

  it("não deixa campos extras passarem para o banco", () => {
    const resultado = validarSituacaoAtual({
      faturasAnalisadas: 1,
      linhas: [{ ...linha, telefoneCompleto: "17900000001" }],
      extra: "x",
    });
    expect(resultado.ok).toBe(true);
    if (resultado.ok && resultado.valor) {
      expect(JSON.stringify(resultado.valor)).not.toContain("17900000001");
      expect(Object.keys(resultado.valor)).toEqual(["faturasAnalisadas", "linhas"]);
    }
  });
});
