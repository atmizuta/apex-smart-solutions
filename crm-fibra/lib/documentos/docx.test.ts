import { describe, it, expect } from "vitest";
import { gerarDocx } from "./docx";
import { entradaDeTeste, logosDeTeste, modeloDeTeste, textoDoDocx } from "./fixtures";

describe("gerarDocx", () => {
  it("gera um .docx de verdade (zip) com os dois logos no cabeçalho", async () => {
    const bytes = await gerarDocx(modeloDeTeste(), logosDeTeste());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const { imagens } = await textoDoDocx(bytes);
    expect(imagens).toBe(2);
  });

  it("traz título, cliente, CNPJ, consultor, datas e rodapé da empresa", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    for (const texto of [
      "PROPOSTA COMERCIAL",
      "EMPRESA EXEMPLO LTDA",
      "11.222.333/0001-81",
      "Ana Teste",
      "19/10/2026",
      "20/10/2026",
      "Agente Autorizado Claro Empresas",
    ]) {
      expect(xml).toContain(texto);
    }
  });

  it("mostra a situação atual agrupada, a nova proposta e os totais", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(xml).toContain("SITUAÇÃO ATUAL");
    expect(xml).toContain("Plano atual — 10GB");
    expect(xml).toContain("R$ 155,97"); // total atual (2×48,49 + 58,99)
    expect(xml).toContain("NOVA PROPOSTA");
    expect(xml).toContain("Pós 12GB — por linha");
    expect(xml).toContain("R$ 119,97"); // 3 × R$ 39,99
    expect(xml).toContain("TOTAL (inclui Claro Monitor)");
    expect(xml).toContain("R$ 134,97"); // 119,97 de Pós + 15,00 de Claro Monitor
  });

  it("o Claro Monitor aparece como benefício e não como linha da tabela", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(xml).toContain("BENEFÍCIOS INCLUSOS");
    expect(xml).toContain("Ligações ilimitadas");
    expect(xml).toContain("Claro Monitor");
    expect(xml).not.toContain("R$ 15,00"); // subtotal do Monitor (3 × R$ 5,00) não vira linha
  });

  it("mostra a redução na fatura só quando o proposto é menor que o atual", async () => {
    const economia = await textoDoDocx(await gerarDocx(modeloDeTeste(), logosDeTeste()));
    expect(economia.xml).toContain("Redução na fatura");

    const aumento = modeloDeTeste({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento.resumo.tipo).toBe("aumento");
    const semReducao = await textoDoDocx(await gerarDocx(aumento, logosDeTeste()));
    expect(semReducao.xml).not.toContain("Redução na fatura");
  });

  it("sem situação atual não há a seção e o documento continua válido", async () => {
    const { xml } = await textoDoDocx(await gerarDocx(modeloDeTeste({ situacaoAtual: null }), logosDeTeste()));
    expect(xml).not.toContain("SITUAÇÃO ATUAL");
    expect(xml).toContain("NOVA PROPOSTA");
  });

  it("escapa símbolos do nome do cliente (E comercial) sem corromper o XML", async () => {
    const modelo = modeloDeTeste({
      cliente: { razaoSocial: "PADARIA & CIA <LTDA>", cnpjDigits: "11222333000181" },
    });
    const { xml } = await textoDoDocx(await gerarDocx(modelo, logosDeTeste()));
    expect(xml).toContain("PADARIA &amp; CIA &lt;LTDA&gt;");
  });

  it("o vendedor editado aparece no lugar do consultor logado", async () => {
    const modelo = modeloDeTeste({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } });
    const { xml } = await textoDoDocx(await gerarDocx(modelo, logosDeTeste()));
    expect(xml).toContain("Maria Vendedora");
    expect(xml).not.toContain("Ana Teste");
  });

  it("um documento com 60 linhas de proposta é gerado sem erro", async () => {
    const itens = Array.from({ length: 60 }, (_, i) => ({
      catalogoPlanoId: null,
      descricao: `Oferta avulsa número ${i + 1} com uma descrição bem longa para forçar a quebra de linha`,
      valor: 10,
      quantidade: 1,
      franquiaGb: null,
    }));
    const bytes = await gerarDocx(modeloDeTeste({ itens }), logosDeTeste());
    expect(bytes.byteLength).toBeGreaterThan(5000);
    expect(entradaDeTeste({ itens }).itens).toHaveLength(60);
  });
});
