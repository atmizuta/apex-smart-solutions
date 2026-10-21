import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparativoCartao } from "./comparativo-cartao";
import { modeloDeTeste } from "@/lib/documentos/fixtures";

const html = (parcial = {}) => renderToStaticMarkup(createElement(ComparativoCartao, { modelo: modeloDeTeste(parcial) }));

describe("ComparativoCartao", () => {
  it("mostra título, cliente, CNPJ e os dois logos", () => {
    const h = html();
    expect(h).toContain("COMPARATIVO DA SUA FATURA");
    expect(h).toContain("EMPRESA EXEMPLO LTDA");
    expect(h).toContain("11.222.333/0001-81");
    expect(h).toContain("/marca/apex-logo.png");
    expect(h).toContain("/marca/claro-logo.jpg");
  });

  it("mostra situação atual agrupada, nova proposta e totais (agrupado por plano, não linha a linha)", () => {
    const h = html();
    expect(h).toContain("Plano atual — 10GB");
    expect(h).toContain("R$ 155,97");
    expect(h).toContain("Pós 12GB — por linha");
    expect(h).toContain("TOTAL (inclui Claro Monitor)");
    expect(h).not.toContain("(17) ••••• 0001"); // o cartão não lista linha a linha: fica curto para o WhatsApp
  });

  it("economia em verde com o valor; aumento em âmbar", () => {
    expect(html()).toContain("ECONOMIA MENSAL");
    const aumento = html({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento).toContain("AUMENTO MENSAL");
    expect(aumento).not.toContain("ECONOMIA MENSAL");
  });

  it("sem situação atual vira 'RESUMO DA PROPOSTA' com a mensalidade proposta", () => {
    const h = html({ situacaoAtual: null });
    expect(h).toContain("RESUMO DA PROPOSTA");
    expect(h).toContain("MENSALIDADE PROPOSTA");
    expect(h).not.toContain("MENSALIDADE ATUAL");
  });

  it("traz os benefícios e a validade", () => {
    const h = html();
    expect(h).toContain("Ligações ilimitadas");
    expect(h).toContain("Válida até 20/10/2026");
  });

  it("escapa o nome do cliente (nada de HTML solto vindo da razão social)", () => {
    const h = html({ cliente: { razaoSocial: "<b>X</b> & CIA", cnpjDigits: "11222333000181" } });
    expect(h).toContain("&lt;b&gt;X&lt;/b&gt; &amp; CIA");
    expect(h).not.toContain("<b>X</b>");
  });
});
