import { describe, it, expect } from "vitest";
import {
  IaCotaEsgotadaError,
  IaIndisponivelError,
  IaNaoConfiguradaError,
  IaRespostaInvalidaError,
  mensagemDeErroIa,
} from "./erros";

describe("mensagemDeErroIa", () => {
  it.each([
    ["chave ausente", new IaNaoConfiguradaError(), /não está configurada/],
    ["cota esgotada", new IaCotaEsgotadaError(), /limite da IA/],
    ["IA sobrecarregada", new IaIndisponivelError(), /sobrecarregada/],
    ["resposta inválida", new IaRespostaInvalidaError("vazia"), /roteiro utilizável/],
  ])("traduz %s em mensagem para o consultor", (_nome, erro, esperado) => {
    expect(mensagemDeErroIa(erro)).toMatch(esperado);
  });

  it("qualquer outro erro vira a mensagem genérica", () => {
    const generica = "Não foi possível gerar a abordagem agora. Tente de novo em instantes.";
    expect(mensagemDeErroIa(new Error("conexão recusada"))).toBe(generica);
    expect(mensagemDeErroIa("texto solto")).toBe(generica);
  });

  it("a mensagem do consultor nunca vaza o detalhe técnico", () => {
    expect(mensagemDeErroIa(new IaRespostaInvalidaError('etapa "sondagem" vazia'))).not.toContain("sondagem");
  });
});

describe("erros tipados", () => {
  it("são distinguíveis por instanceof e têm nome próprio", () => {
    const erro = new IaRespostaInvalidaError("sem texto");
    expect(erro).toBeInstanceOf(Error);
    expect(erro).toBeInstanceOf(IaRespostaInvalidaError);
    expect(erro).not.toBeInstanceOf(IaCotaEsgotadaError);
    expect(erro.name).toBe("IaRespostaInvalidaError");
    expect(erro.message).toContain("sem texto");
    expect(new IaCotaEsgotadaError().name).toBe("IaCotaEsgotadaError");
  });
});
