import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import { itensDasLinhas, linhasComProposto, type LinhaEditavel } from "./agrupar";
import { somarValores } from "../propostas";

const catalogo: PlanoCatalogo[] = [
  { id: "p12", categoria: "pos_nacional", nome: "Pós 12GB", valor: 39.99, observacao: "por linha", ativo: true, franquiaGb: 12 },
  { id: "p40", categoria: "pos_nacional", nome: "Pós 40GB", valor: 54.99, observacao: "por linha", ativo: true, franquiaGb: 40 },
  { id: "p70", categoria: "pos_nacional", nome: "Pós 70GB", valor: 74.99, observacao: null, ativo: true, franquiaGb: 70 },
];

function linha(parcial: Partial<LinhaEditavel> & { chave: string }): LinhaEditavel {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 1000,
    origem: "fatura",
    planoId: null,
    avisos: [],
    ...parcial,
  };
}

describe("itensDasLinhas", () => {
  it("soma as linhas que escolheram o mesmo plano num item só (10× Pós 12GB)", () => {
    const linhas = Array.from({ length: 10 }, (_, i) => linha({ chave: `k${i}`, planoId: "p12" }));
    expect(itensDasLinhas(linhas, catalogo)).toEqual([
      { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", quantidade: 10, franquiaGb: 12, valor: 399.9 },
    ]);
  });

  it("linha com quantidade N conta N", () => {
    const linhas = [linha({ chave: "a", planoId: "p40", quantidade: 5 }), linha({ chave: "b", planoId: "p40" })];
    expect(itensDasLinhas(linhas, catalogo)[0]).toMatchObject({ quantidade: 6, valor: 329.94 });
  });

  it("subtotal em centavos, sem erro de ponto flutuante (39,99 × 7)", () => {
    const linhas = Array.from({ length: 7 }, (_, i) => linha({ chave: `k${i}`, planoId: "p12" }));
    expect(itensDasLinhas(linhas, catalogo)[0].valor).toBe(279.93);
  });

  it("ordena da maior franquia para a menor e dá um item por plano", () => {
    const linhas = [
      linha({ chave: "a", planoId: "p12" }),
      linha({ chave: "b", planoId: "p70" }),
      linha({ chave: "c", planoId: "p40" }),
    ];
    expect(itensDasLinhas(linhas, catalogo).map((i) => i.catalogoPlanoId)).toEqual(["p70", "p40", "p12"]);
  });

  it("linha sem plano proposto, ou com plano que não está no catálogo, não gera item", () => {
    const linhas = [linha({ chave: "a", planoId: null }), linha({ chave: "b", planoId: "apagado" })];
    expect(itensDasLinhas(linhas, catalogo)).toEqual([]);
  });

  it("o total dos itens é a soma dos subtotais", () => {
    const linhas = [
      ...Array.from({ length: 7 }, (_, i) => linha({ chave: `a${i}`, planoId: "p12" })),
      linha({ chave: "b", planoId: "p70" }),
    ];
    expect(somarValores(itensDasLinhas(linhas, catalogo).map((i) => i.valor))).toBe(354.92);
  });
});

describe("linhasComProposto", () => {
  it("grava o retrato do plano escolhido (descrição e valor unitário) em cada linha", () => {
    const [resultado] = linhasComProposto([linha({ chave: "a", planoId: "p12" })], catalogo);
    expect(resultado.proposto).toEqual({ descricao: "Pós 12GB — por linha", valorUnitario: 39.99 });
  });

  it("linha sem plano, ou com plano que saiu do catálogo, fica com proposto nulo", () => {
    const resultado = linhasComProposto(
      [linha({ chave: "a", planoId: null }), linha({ chave: "b", planoId: "apagado" })],
      catalogo
    );
    expect(resultado.map((l) => l.proposto)).toEqual([null, null]);
  });

  it("não deixa campos de tela (chave, planoId, avisos) vazarem para o que vai ao servidor", () => {
    const [resultado] = linhasComProposto([linha({ chave: "a", planoId: "p12", avisos: ["x"] })], catalogo);
    expect(Object.keys(resultado).sort()).toEqual(
      ["consumoMb", "origem", "planoGb", "proposto", "quantidade", "rotulo", "valorUnitario"].sort()
    );
  });
});
