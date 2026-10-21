import { describe, it, expect } from "vitest";
import {
  destaqueDoCliente,
  linhasDaTabela,
  moeda,
  nomeDeArquivo,
  reducaoDe,
  rotuloTotalProposta,
  textoReducao,
  tituloDoCliente,
} from "./formato";
import type { ModeloDocumento } from "../proposta/modelo-documento";

// Só os campos que estes utilitários leem.
function modelo(parcial: Partial<ModeloDocumento> = {}): ModeloDocumento {
  return {
    cliente: { razaoSocial: "X", cnpj: "11.222.333/0001-81" },
    consultor: "Ana",
    emitidoEm: "19/10/2026",
    validoAte: "20/10/2026",
    situacaoAtual: null,
    porLinha: null,
    novaProposta: { consolidado: false, itens: [], total: 100 },
    beneficios: { movel: false, badges: [] },
    resumo: { atual: null, proposto: 100, diferenca: null, tipo: null },
    ...parcial,
  };
}

const comSituacao = (atual: number, proposto: number): Partial<ModeloDocumento> => {
  const diferenca = Math.round((proposto - atual) * 100) / 100;
  return {
    situacaoAtual: { itens: [], total: atual, nota: "" },
    novaProposta: { consolidado: false, itens: [], total: proposto },
    resumo: {
      atual,
      proposto,
      diferenca,
      tipo: diferenca < 0 ? "economia" : diferenca > 0 ? "aumento" : "igual",
    },
  };
};

describe("moeda", () => {
  it("formata em reais com espaço comum (nada de espaço não separável nos PDFs)", () => {
    expect(moeda(1234.56)).toBe("R$ 1.234,56");
    expect(moeda(0)).toBe("R$ 0,00");
    expect(moeda(1234.56)).not.toContain(" ");
  });
});

describe("nomeDeArquivo", () => {
  it("monta prefixo_razão_social.extensão sem acento nem símbolo", () => {
    expect(nomeDeArquivo("proposta", "AÇÃO & CIA LTDA", "pdf")).toBe("proposta_ACAO_CIA_LTDA.pdf");
  });

  it("cai em 'cliente' quando não sobra nada do nome", () => {
    expect(nomeDeArquivo("comparativo", "  ///  ", "png")).toBe("comparativo_cliente.png");
    expect(nomeDeArquivo("comparativo", "", "png")).toBe("comparativo_cliente.png");
  });

  it("limita o nome a 60 caracteres", () => {
    const nome = nomeDeArquivo("proposta", "A".repeat(200), "docx");
    expect(nome).toBe(`proposta_${"A".repeat(60)}.docx`);
  });
});

describe("linhasDaTabela", () => {
  it("vira linhas de texto, com traço quando não há valor unitário (linha consolidada)", () => {
    expect(
      linhasDaTabela([
        { descricao: "Pós 12GB — por linha", quantidade: 7, valorUnitario: 39.99, subtotal: 279.93 },
        { descricao: "7 linha(s) — 7× 12GB — valor total consolidado", quantidade: 7, valorUnitario: null, subtotal: 279.93 },
      ])
    ).toEqual([
      ["Pós 12GB — por linha", "7", "R$ 39,99", "R$ 279,93"],
      ["7 linha(s) — 7× 12GB — valor total consolidado", "7", "-", "R$ 279,93"],
    ]);
  });
});

describe("rotuloTotalProposta", () => {
  it("avisa que o total inclui o Claro Monitor quando ele está nos benefícios", () => {
    expect(rotuloTotalProposta(modelo())).toBe("TOTAL");
    const comMonitor = modelo({
      beneficios: { movel: true, badges: [{ label: "Claro Monitor", desc: "", cor: "B3101F" }] },
    });
    expect(rotuloTotalProposta(comMonitor)).toBe("TOTAL (inclui Claro Monitor)");
  });
});

describe("reducaoDe / textoReducao (regra do painel: só mostra redução real)", () => {
  it("só existe quando o proposto é menor que o atual, com a porcentagem", () => {
    const reducao = reducaoDe(modelo(comSituacao(155.97, 79.98)));
    expect(reducao?.valor).toBe(75.99);
    expect(reducao?.pct).toBeCloseTo(48.72, 1);
  });

  it("aumento, igualdade e ausência de situação atual não têm redução", () => {
    expect(reducaoDe(modelo(comSituacao(100, 150)))).toBeNull();
    expect(reducaoDe(modelo(comSituacao(100, 100)))).toBeNull();
    expect(reducaoDe(modelo())).toBeNull();
  });

  it("escreve o valor e a porcentagem com vírgula", () => {
    expect(textoReducao({ valor: 75.99, pct: 48.72 })).toBe("Redução na fatura: R$ 75,99 (48,7%)");
    expect(textoReducao({ valor: 10, pct: null })).toBe("Redução na fatura: R$ 10,00");
  });
});

describe("tituloDoCliente / destaqueDoCliente", () => {
  it("o título muda com a existência da situação atual", () => {
    expect(tituloDoCliente(modelo())).toBe("RESUMO DA PROPOSTA");
    expect(tituloDoCliente(modelo(comSituacao(100, 80)))).toBe("COMPARATIVO DA SUA FATURA");
  });

  it("economia em verde, aumento em âmbar, igual e sem fatura em preto", () => {
    expect(destaqueDoCliente(modelo(comSituacao(155.97, 79.98)))).toEqual({
      titulo: "ECONOMIA MENSAL",
      valor: "R$ 75,99",
      cor: "verde",
    });
    expect(destaqueDoCliente(modelo(comSituacao(100, 173.9)))).toEqual({
      titulo: "AUMENTO MENSAL",
      valor: "R$ 73,90",
      cor: "ambar",
    });
    expect(destaqueDoCliente(modelo(comSituacao(100, 100)))).toEqual({
      titulo: "MESMA MENSALIDADE",
      valor: "R$ 100,00",
      cor: "preto",
    });
    expect(destaqueDoCliente(modelo())).toEqual({
      titulo: "MENSALIDADE PROPOSTA",
      valor: "R$ 100,00",
      cor: "preto",
    });
  });
});
