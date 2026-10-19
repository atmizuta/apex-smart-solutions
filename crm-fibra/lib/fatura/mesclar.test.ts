import { describe, it, expect } from "vitest";
import type { LinhaLida } from "./extrair";
import { avisosDaLinha, mesclarFaturas, paraLinhasAtuais } from "./mesclar";
import { temNumeroCompleto } from "./tipos";

function lida(parcial: Partial<LinhaLida> = {}): LinhaLida {
  return { ddd: "17", numero: "900000001", valorMensal: 48.49, planoGb: 10, temMonitor: false, consumoMb: 1000, ...parcial };
}

describe("mesclarFaturas", () => {
  it("com uma fatura nada muda: média = valor, faixa = valor, 1 de 1", () => {
    expect(mesclarFaturas([[lida()]])).toEqual([
      {
        ddd: "17",
        numero: "900000001",
        planoGb: 10,
        planoGbDistintos: [10],
        valorMensal: 48.49,
        valorMensalMin: 48.49,
        valorMensalMax: 48.49,
        consumoMb: 1000,
        consumoMbMin: 1000,
        consumoMbMax: 1000,
        temMonitor: false,
        faturasEncontradas: 1,
        totalFaturas: 1,
      },
    ]);
  });

  it("com duas faturas calcula média e faixa de valor e de consumo", () => {
    const [m] = mesclarFaturas([
      [lida({ valorMensal: 48.5, consumoMb: 1000 })],
      [lida({ valorMensal: 50.5, consumoMb: 3001 })],
    ]);
    expect(m.valorMensal).toBe(49.5);
    expect(m.valorMensalMin).toBe(48.5);
    expect(m.valorMensalMax).toBe(50.5);
    expect(m.consumoMb).toBe(2000.5);
    expect(m.consumoMbMin).toBe(1000);
    expect(m.consumoMbMax).toBe(3001);
    expect(m.faturasEncontradas).toBe(2);
    expect(m.totalFaturas).toBe(2);
  });

  it("linha que aparece só em uma das faturas fica marcada (1 de 2)", () => {
    const resultado = mesclarFaturas([[lida(), lida({ numero: "900000002" })], [lida()]]);
    expect(resultado.map((l) => [l.numero, l.faturasEncontradas, l.totalFaturas])).toEqual([
      ["900000001", 2, 2],
      ["900000002", 1, 2],
    ]);
  });

  it("plano que mudou: vale o da fatura anexada por último e lista os distintos", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: 20 })], [lida({ planoGb: 30 })]]);
    expect(m.planoGb).toBe(30);
    expect(m.planoGbDistintos).toEqual([20, 30]);
  });

  it("plano mais frequente vence (20, 20, 30 → 20)", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: 20 })], [lida({ planoGb: 20 })], [lida({ planoGb: 30 })]]);
    expect(m.planoGb).toBe(20);
  });

  it("valor nulo em todas as faturas continua nulo; em uma só, a média usa as que têm valor", () => {
    expect(mesclarFaturas([[lida({ valorMensal: null })]])[0]).toMatchObject({
      valorMensal: null,
      valorMensalMin: null,
      valorMensalMax: null,
    });
    const [m] = mesclarFaturas([[lida({ valorMensal: null })], [lida({ valorMensal: 60 })]]);
    expect(m.valorMensal).toBe(60);
  });

  it("plano nulo em todas as faturas continua nulo", () => {
    const [m] = mesclarFaturas([[lida({ planoGb: null })]]);
    expect(m.planoGb).toBeNull();
    expect(m.planoGbDistintos).toEqual([]);
  });

  it("mesmo número com DDD diferente não se mistura", () => {
    expect(mesclarFaturas([[lida({ ddd: "17" }), lida({ ddd: "11" })]])).toHaveLength(2);
  });

  it("mantém a ordem da primeira aparição e soma o Claro Monitor se qualquer fatura tiver", () => {
    const resultado = mesclarFaturas([
      [lida({ numero: "900000002" }), lida({ numero: "900000001" })],
      [lida({ numero: "900000001", temMonitor: true })],
    ]);
    expect(resultado.map((l) => l.numero)).toEqual(["900000002", "900000001"]);
    expect(resultado[1].temMonitor).toBe(true);
    expect(resultado[0].temMonitor).toBe(false);
  });

  it("sem faturas devolve lista vazia", () => {
    expect(mesclarFaturas([])).toEqual([]);
    expect(mesclarFaturas([[]])).toEqual([]);
  });
});

describe("avisosDaLinha", () => {
  const base = mesclarFaturas([[lida()]])[0];

  it("linha normal de uma fatura não tem aviso", () => {
    expect(avisosDaLinha(base)).toEqual([]);
  });

  it("avisa quando a linha só apareceu em parte das faturas", () => {
    expect(avisosDaLinha({ ...base, faturasEncontradas: 1, totalFaturas: 2 })).toEqual(["Linha achada em 1 de 2 faturas."]);
  });

  it("avisa quando o plano mudou no período", () => {
    expect(avisosDaLinha({ ...base, planoGbDistintos: [20, 30] })).toEqual(["Plano mudou no período (20GB, 30GB)."]);
  });

  it("avisa quando a mensalidade ou o plano não foram encontrados", () => {
    expect(avisosDaLinha({ ...base, valorMensal: null })).toEqual(["Mensalidade não encontrada na fatura: preencha o valor."]);
    expect(avisosDaLinha({ ...base, planoGb: null })).toEqual([
      "Plano atual não identificado: a sugestão por consumo fica indisponível.",
    ]);
  });
});

describe("paraLinhasAtuais", () => {
  const mescladas = mesclarFaturas([[lida({ numero: "900000001" }), lida({ ddd: "11", numero: "30000002", valorMensal: null })]]);
  const linhas = paraLinhasAtuais(mescladas);

  it("vira linha da situação atual: quantidade 1, origem fatura, ainda sem plano proposto", () => {
    expect(linhas[0]).toEqual({
      rotulo: "(17) ••••• 0001",
      quantidade: 1,
      planoGb: 10,
      valorUnitario: 48.49,
      consumoMb: 1000,
      origem: "fatura",
      proposto: null,
    });
  });

  it("valor não encontrado vira 0, para o consultor preencher", () => {
    expect(linhas[1].valorUnitario).toBe(0);
    expect(linhas[1].rotulo).toBe("(11) ••••• 0002");
  });

  it("o número completo não sobrevive à conversão", () => {
    for (const linha of linhas) {
      expect(temNumeroCompleto(linha.rotulo)).toBe(false);
      expect(Object.keys(linha)).not.toContain("numero");
    }
    const json = JSON.stringify(linhas);
    expect(json).not.toContain("900000001");
    expect(json).not.toContain("30000002");
  });
});
