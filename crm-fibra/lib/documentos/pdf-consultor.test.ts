import { describe, it, expect } from "vitest";
import { gerarPdfConsultor } from "./pdf-consultor";
import { itensDoPdf, logosDeTeste, modeloDeTeste, paginasDoPdf, textoDoPdf } from "./fixtures";

const texto = async (parcial = {}) => textoDoPdf(gerarPdfConsultor(modeloDeTeste(parcial), logosDeTeste()));

describe("gerarPdfConsultor", () => {
  it("gera um PDF de verdade", () => {
    const bytes = gerarPdfConsultor(modeloDeTeste(), logosDeTeste());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("traz título, cliente, CNPJ, consultor, datas e rodapé", async () => {
    const t = await texto();
    for (const trecho of [
      "PROPOSTA COMERCIAL",
      "EMPRESA EXEMPLO LTDA",
      "11.222.333/0001-81",
      "Ana Teste",
      "19/10/2026",
      "Válida até 20/10/2026",
      "Agente Autorizado Claro Empresas",
    ]) {
      expect(t).toContain(trecho);
    }
  });

  it("mostra a situação atual agrupada e a nova proposta, com os totais", async () => {
    const t = await texto();
    expect(t).toContain("SITUAÇÃO ATUAL");
    expect(t).toContain("Plano atual — 10GB");
    expect(t).toContain("R$ 155,97");
    expect(t).toContain("NOVA PROPOSTA");
    expect(t).toContain("Pós 12GB — por linha");
    expect(t).toContain("TOTAL (inclui Claro Monitor)");
  });

  it("o Claro Monitor é benefício, não linha, e os benefícios aparecem", async () => {
    const t = await texto();
    expect(t).toContain("BENEFÍCIOS INCLUSOS");
    expect(t).toContain("Ligações ilimitadas");
    expect(t).toContain("Claro Monitor");
    expect(t).not.toContain("R$ 15,00");
  });

  it("a redução só aparece quando há redução real", async () => {
    expect(await texto()).toContain("Redução na fatura");
    const aumento = await texto({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(aumento).not.toContain("Redução na fatura");
    expect(aumento).toContain("R$ 1.949,90");
  });

  it("sem situação atual não há a seção", async () => {
    const t = await texto({ situacaoAtual: null });
    expect(t).not.toContain("SITUAÇÃO ATUAL");
    expect(t).toContain("NOVA PROPOSTA");
  });

  it("proposta grande quebra em várias páginas e o rodapé aparece em todas", async () => {
    const itens = Array.from({ length: 60 }, (_, i) => ({
      catalogoPlanoId: null,
      descricao: `Oferta avulsa número ${i + 1} com uma descrição bem longa para forçar a quebra de linha`,
      valor: 10,
      quantidade: 1,
      franquiaGb: null,
    }));
    const bytes = gerarPdfConsultor(modeloDeTeste({ itens }), logosDeTeste());
    expect(await paginasDoPdf(bytes)).toBeGreaterThan(1);
    const t = await textoDoPdf(bytes);
    expect((t.match(/Válida até 20\/10\/2026/g) ?? []).length).toBe(await paginasDoPdf(bytes));
    expect(t).toContain("Oferta avulsa número 60");
  });

  it("razão social muito longa quebra a linha sem perder nenhuma palavra", async () => {
    const longa = "EMPRESA EXEMPLO DE COMERCIO E SERVICOS DE TELECOMUNICACOES E TECNOLOGIA DA INFORMACAO LTDA";
    const t = await texto({ cliente: { razaoSocial: longa, cnpjDigits: "11222333000181" } });
    for (const palavra of longa.split(" ")) expect(t).toContain(palavra);
  });

  it("o vendedor editado aparece no lugar do consultor logado", async () => {
    const t = await texto({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } });
    expect(t).toContain("Maria Vendedora");
    expect(t).not.toContain("Ana Teste");
  });

  it("a descrição de cada benefício começa depois do nome dele, sem sobrepor", async () => {
    const itens = await itensDoPdf(gerarPdfConsultor(modeloDeTeste(), logosDeTeste()));
    const rotulo = itens.find((i) => i.str === "Ligações ilimitadas");
    const descricao = itens.find((i) => i.str.startsWith("Fixo e celular"));
    expect(rotulo).toBeDefined();
    expect(descricao).toBeDefined();
    expect((descricao as { x: number }).x).toBeGreaterThanOrEqual(
      (rotulo as { x: number; largura: number }).x + (rotulo as { largura: number }).largura
    );
  });
});
