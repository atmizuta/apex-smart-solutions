import { describe, it, expect } from "vitest";
import { gerarPdfCliente } from "./pdf-cliente";
import { itensDoPdf, logosDeTeste, modeloDeTeste, paginasDoPdf, textoDoPdf } from "./fixtures";

const texto = async (parcial = {}) => textoDoPdf(gerarPdfCliente(modeloDeTeste(parcial), logosDeTeste()));

describe("gerarPdfCliente", () => {
  it("gera um PDF de verdade", () => {
    const bytes = gerarPdfCliente(modeloDeTeste(), logosDeTeste());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("com situação atual o título é 'COMPARATIVO DA SUA FATURA', com os três cartões", async () => {
    const t = await texto();
    expect(t).toContain("COMPARATIVO DA SUA FATURA");
    expect(t).toContain("MENSALIDADE ATUAL");
    expect(t).toContain("NOVA MENSALIDADE");
    expect(t).toContain("EMPRESA EXEMPLO LTDA");
    expect(t).toContain("Emitido em 19/10/2026");
  });

  it("economia aparece como economia, com o valor", async () => {
    const t = await texto();
    expect(t).toContain("ECONOMIA MENSAL");
    expect(t).not.toContain("AUMENTO MENSAL");
  });

  it("aumento aparece como aumento (nunca escondido atrás de 'economia')", async () => {
    const t = await texto({
      itens: [{ catalogoPlanoId: "f1", descricao: "10 Giga", valor: 1949.9, quantidade: 1, franquiaGb: null }],
    });
    expect(t).toContain("AUMENTO MENSAL");
    expect(t).not.toContain("ECONOMIA MENSAL");
  });

  it("traz o comparativo por linha com o rótulo mascarado e os planos", async () => {
    const t = await texto();
    expect(t).toContain("COMPARATIVO POR LINHA");
    expect(t).toContain("(17) ••••• 0001");
    expect(t).toContain("Pós 12GB — por linha");
    expect(t).toContain("9,5 GB");
  });

  it("sem situação atual o título é 'RESUMO DA PROPOSTA' e não há comparativo", async () => {
    const t = await texto({ situacaoAtual: null });
    expect(t).toContain("RESUMO DA PROPOSTA");
    expect(t).toContain("MENSALIDADE PROPOSTA");
    expect(t).not.toContain("COMPARATIVO POR LINHA");
    expect(t).not.toContain("MENSALIDADE ATUAL");
  });

  it("nunca imprime um telefone completo", async () => {
    const t = await texto();
    expect(t).not.toMatch(/\d{5}[-\s]?\d{4}/);
  });

  it("muitas linhas de fatura quebram em páginas sem perder linha", async () => {
    const linhas = Array.from({ length: 80 }, (_, i) => ({
      rotulo: `(17) ••••• ${String(i).padStart(4, "0")}`,
      quantidade: 1,
      planoGb: 10,
      valorUnitario: 48.49,
      consumoMb: 5120,
      origem: "fatura" as const,
      proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
    }));
    const bytes = gerarPdfCliente(modeloDeTeste({ situacaoAtual: { faturasAnalisadas: 1, linhas } }), logosDeTeste());
    expect(await paginasDoPdf(bytes)).toBeGreaterThan(1);
    const t = await textoDoPdf(bytes);
    expect(t).toContain("(17) ••••• 0079");
  });

  it("consolidar mostra uma linha só para os planos, sem preço por linha", async () => {
    const t = await texto({ opcoes: { consolidar: true, vendedor: null } });
    expect(t).toContain("valor total consolidado");
  });

  it("traz o rodapé com a validade", async () => {
    expect(await texto()).toContain("Válida até 20/10/2026");
  });

  it("a descrição de cada benefício começa depois do nome dele, sem sobrepor", async () => {
    const itens = await itensDoPdf(gerarPdfCliente(modeloDeTeste(), logosDeTeste()));
    const rotulo = itens.find((i) => i.str === "Ligações ilimitadas");
    const descricao = itens.find((i) => i.str.startsWith("Fixo e celular"));
    expect(rotulo).toBeDefined();
    expect(descricao).toBeDefined();
    expect((descricao as { x: number }).x).toBeGreaterThanOrEqual(
      (rotulo as { x: number; largura: number }).x + (rotulo as { largura: number }).largura
    );
  });
});
