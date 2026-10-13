import { describe, it, expect } from "vitest";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  descricaoDoPlano,
  itensParaSalvar,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "./proposta-rascunho";
import type { PlanoCatalogo } from "./catalogo";

const planoEscalonado: PlanoCatalogo = {
  id: "p3",
  categoria: "banda_larga",
  nome: "600 Mega (G1 Padrão)",
  valor: 59.9,
  observacao: "Por 3 meses, depois R$99,90",
  ativo: true,
};

const planoSimples: PlanoCatalogo = {
  id: "p9",
  categoria: "adicional",
  nome: "Claro Monitor",
  valor: 5,
  observacao: null,
  ativo: true,
};

describe("descricaoDoPlano", () => {
  it("a descrição da linha inclui a observação do plano (preço escalonado não se perde)", () => {
    expect(descricaoDoPlano(planoEscalonado)).toBe(
      "600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90"
    );
  });

  it("usa só o nome quando o plano não tem observação", () => {
    expect(descricaoDoPlano(planoSimples)).toBe("Claro Monitor");
  });
});

describe("adicionarLinhaCatalogo", () => {
  it("acrescenta a linha com id, descrição e valor do plano, sem mexer no rascunho original", () => {
    const original: Rascunho = [];
    const novo = adicionarLinhaCatalogo(original, planoEscalonado, "k1");
    expect(original).toEqual([]);
    expect(novo).toEqual([
      {
        chave: "k1",
        catalogoPlanoId: "p3",
        descricao: "600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90",
        valor: 59.9,
      },
    ]);
  });

  it("permite o mesmo plano mais de uma vez (várias linhas iguais)", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(rascunho).toHaveLength(2);
    expect(totalRascunho(rascunho)).toBe(10);
  });
});

describe("adicionarLinhaAvulsa", () => {
  it("acrescenta uma oferta avulsa sem plano de catálogo, aceitando valor em formato brasileiro", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo negociado", valorTexto: "1.299,90" }, "k1");
    expect(resultado).toEqual({
      ok: true,
      rascunho: [{ chave: "k1", catalogoPlanoId: null, descricao: "Combo negociado", valor: 1299.9 }],
    });
  });

  it("apara os espaços da descrição", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "  Combo  ", valorTexto: "10" }, "k1");
    expect(resultado.ok && resultado.rascunho[0].descricao).toBe("Combo");
  });

  it("recusa descrição em branco", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "   ", valorTexto: "10" }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Descreva a oferta avulsa" });
  });

  it.each(["", "abc", "0", "-3"])("recusa valor inválido %j", (valorTexto) => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo", valorTexto }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Informe um valor válido, por exemplo 149,90" });
  });
});

describe("removerLinha", () => {
  it("remove só a linha da chave pedida", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k2");
    expect(removerLinha(rascunho, "k1").map((l) => l.chave)).toEqual(["k2"]);
  });
});

describe("totalRascunho", () => {
  it("soma os valores em centavos", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(totalRascunho(rascunho)).toBe(64.9);
  });

  it("é 0 para um rascunho vazio", () => {
    expect(totalRascunho([])).toBe(0);
  });
});

describe("itensParaSalvar", () => {
  it("tira a chave de tela e mantém a ordem das linhas", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    const avulsa = adicionarLinhaAvulsa(rascunho, { descricao: "Combo", valorTexto: "10" }, "k2");
    expect(avulsa.ok && itensParaSalvar(avulsa.rascunho)).toEqual([
      { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 5 },
      { catalogoPlanoId: null, descricao: "Combo", valor: 10 },
    ]);
  });
});
