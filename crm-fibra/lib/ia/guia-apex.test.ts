import { describe, it, expect } from "vitest";
import {
  CHAVES_ETAPA,
  ETAPAS,
  LIMITE_MENSAGEM,
  LIMITE_SUGERIDO,
  REGRAS_GUIA_APEX,
} from "./guia-apex";

describe("ETAPAS", () => {
  it("são as cinco etapas, na ordem do roteiro", () => {
    expect(CHAVES_ETAPA).toEqual(["abordagem", "sondagem", "maleficios", "beneficios", "finalizacao"]);
  });

  it("cada etapa tem rótulo e objetivo preenchidos", () => {
    for (const etapa of ETAPAS) {
      expect(etapa.rotulo.trim()).not.toBe("");
      expect(etapa.objetivo.trim()).not.toBe("");
    }
  });

  it("a sondagem pede uma única pergunta e a finalização pede pergunta de fechamento", () => {
    const objetivo = (chave: string) => ETAPAS.find((e) => e.chave === chave)?.objetivo ?? "";
    expect(objetivo("sondagem")).toContain("UMA única pergunta");
    expect(objetivo("finalizacao")).toContain("pergunta de fechamento");
  });
});

describe("REGRAS_GUIA_APEX", () => {
  it("traz as quatro regras do guia de atendimento da Apex", () => {
    const texto = REGRAS_GUIA_APEX.join("\n");
    expect(REGRAS_GUIA_APEX).toHaveLength(4);
    expect(texto).toContain("100GB");
    expect(texto).toContain("questionar o preço");
    expect(texto).toContain("R$ 44,99");
    expect(texto).toContain("linha móvel");
  });
});

describe("limites", () => {
  it("o limite duro de uma mensagem é maior que o sugerido ao modelo", () => {
    expect(LIMITE_SUGERIDO).toBe(320);
    expect(LIMITE_MENSAGEM).toBe(1200);
    expect(LIMITE_MENSAGEM).toBeGreaterThan(LIMITE_SUGERIDO);
  });
});
