import { describe, it, expect } from "vitest";
import { formatarBRL, parseValorBRL, formatarDataHora, formatarCnpj } from "./formato";

const semNbsp = (texto: string) => texto.replace(/ /g, " ");

describe("formatarBRL", () => {
  it("formata em reais com vírgula decimal e ponto de milhar", () => {
    expect(semNbsp(formatarBRL(194.89))).toBe("R$ 194,89");
    expect(semNbsp(formatarBRL(1299.9))).toBe("R$ 1.299,90");
    expect(semNbsp(formatarBRL(0))).toBe("R$ 0,00");
  });
});

describe("parseValorBRL", () => {
  it.each([
    ["149,90", 149.9],
    ["1.299,90", 1299.9],
    ["1299,9", 1299.9],
    ["149.90", 149.9],
    ["R$ 89,99", 89.99],
    ["  5  ", 5],
    ["1.299", 1299],
  ])("aceita %s", (texto, esperado) => {
    expect(parseValorBRL(texto)).toBe(esperado);
  });

  it.each(["", "abc", "0", "0,00", "-5", "1,2,3", "12.5.6", "R$"])("recusa %j", (texto) => {
    expect(parseValorBRL(texto)).toBeNull();
  });
});

describe("formatarDataHora", () => {
  it("converte UTC para o horário de Brasília (UTC-3)", () => {
    expect(formatarDataHora("2026-10-08T17:32:00Z")).toBe("08/10/2026 14:32");
  });

  it("volta um dia quando a hora UTC é de madrugada", () => {
    expect(formatarDataHora("2026-10-09T01:05:00Z")).toBe("08/10/2026 22:05");
  });

  it("mostra 00:xx e não 24:xx à meia-noite de Brasília", () => {
    expect(formatarDataHora("2026-10-08T03:05:00Z")).toBe("08/10/2026 00:05");
  });
});

describe("formatarCnpj", () => {
  it("formata 14 dígitos como 00.000.000/0000-00", () => {
    expect(formatarCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });

  it("aceita o CNPJ já com pontuação", () => {
    expect(formatarCnpj("11.222.333/0001-81")).toBe("11.222.333/0001-81");
  });

  it("devolve o texto como veio quando não tem 14 dígitos", () => {
    expect(formatarCnpj("123")).toBe("123");
    expect(formatarCnpj("")).toBe("");
  });
});
