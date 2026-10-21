import { describe, it, expect } from "vitest";
import { MODELOS_MENSAGEM, preencherModelo } from "./mensagens-whatsapp";

describe("MODELOS_MENSAGEM", () => {
  it("tem dois modelos com id único e os dois campos a preencher", () => {
    expect(MODELOS_MENSAGEM.map((m) => m.id)).toEqual(["formal", "direto"]);
    for (const modelo of MODELOS_MENSAGEM) {
      expect(modelo.texto).toContain("{cliente}");
      expect(modelo.texto).toContain("{consultor}");
    }
  });

  it("nunca falam em economia, desconto ou aumento (o comparativo pode ser um aumento)", () => {
    for (const modelo of MODELOS_MENSAGEM) {
      expect(modelo.texto).not.toMatch(/econom|desconto|reduç|redução|aumento|barato|menos/i);
    }
  });
});

describe("preencherModelo", () => {
  const modelo = MODELOS_MENSAGEM[0].texto;

  it("troca {cliente} e {consultor}, todas as ocorrências", () => {
    const texto = preencherModelo("{cliente} / {cliente} / {consultor}", { cliente: "EMPRESA EXEMPLO LTDA", consultor: "Ana" });
    expect(texto).toBe("EMPRESA EXEMPLO LTDA / EMPRESA EXEMPLO LTDA / Ana");
  });

  it("tira CPF e raiz de CNPJ do nome do cliente (MEI)", () => {
    expect(preencherModelo(modelo, { cliente: "FULANO DE TAL 123.456.789-00", consultor: "Ana" })).toContain("Olá, FULANO DE TAL!");
  });

  it("cai em palavras neutras quando falta o nome do cliente ou do consultor", () => {
    const texto = preencherModelo(modelo, { cliente: "  ", consultor: "" });
    expect(texto).toContain("cliente");
    expect(texto).toContain("seu consultor");
    expect(texto).not.toContain("{");
  });
});
