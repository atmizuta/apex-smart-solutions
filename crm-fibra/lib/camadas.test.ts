import { describe, it, expect } from "vitest";
import { rotuloCamadaRenovacao, corCamadaRenovacao, dadosDonutRenovacao } from "./camadas";

describe("rotuloCamadaRenovacao", () => {
  it("traduz cada camada pro rótulo em português", () => {
    expect(rotuloCamadaRenovacao("apto_agora")).toBe("Apto agora");
    expect(rotuloCamadaRenovacao("apto_1_mes")).toBe("Apto em 1 mês");
    expect(rotuloCamadaRenovacao("apto_2_meses")).toBe("Apto em 2 meses");
  });
});

describe("corCamadaRenovacao", () => {
  it("retorna uma classe de cor diferente para cada camada", () => {
    const cores = [
      corCamadaRenovacao("apto_agora"),
      corCamadaRenovacao("apto_1_mes"),
      corCamadaRenovacao("apto_2_meses"),
    ];
    expect(new Set(cores).size).toBe(3);
  });
});

describe("dadosDonutRenovacao", () => {
  it("calcula sem elegibilidade como o restante do total", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 10,
      apto1Mes: 2,
      apto2Meses: 3,
      semDono: 0,
      total: 20,
    });
    expect(resultado).toEqual([
      { nome: "Apto agora", valor: 10 },
      { nome: "Apto em 1 mês", valor: 2 },
      { nome: "Apto em 2 meses", valor: 3 },
      { nome: "Sem elegibilidade", valor: 5 },
    ]);
  });

  it("nunca retorna sem elegibilidade negativo quando total é 0", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 0,
      apto1Mes: 0,
      apto2Meses: 0,
      semDono: 0,
      total: 0,
    });
    expect(resultado.find((f) => f.nome === "Sem elegibilidade")?.valor).toBe(0);
  });

  it("nunca retorna sem elegibilidade negativo mesmo se os números de entrada forem inconsistentes", () => {
    const resultado = dadosDonutRenovacao({
      fibraCandidato: 0,
      aptoAgora: 100,
      apto1Mes: 100,
      apto2Meses: 100,
      semDono: 0,
      total: 50,
    });
    expect(resultado.find((f) => f.nome === "Sem elegibilidade")?.valor).toBe(0);
  });
});
