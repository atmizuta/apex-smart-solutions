import { describe, it, expect } from "vitest";
import { normalizarTelefone, montarLinkWhatsapp } from "./whatsapp";

describe("normalizarTelefone", () => {
  it("usa telefoneContato quando já tem DDD (11 dígitos)", () => {
    expect(normalizarTelefone({ telefoneContato: "19991002213" })).toBe("5519991002213");
  });

  it("usa tel1 com 10 dígitos (fixo com DDD)", () => {
    expect(normalizarTelefone({ tel1: "1733224002" })).toBe("551733224002");
  });

  it("ignora telefoneContato = '0' e cai pro tel1", () => {
    expect(normalizarTelefone({ telefoneContato: "0", tel1: "19991002213" })).toBe("5519991002213");
  });

  it("ignora campos vazios e cai pro próximo candidato", () => {
    expect(normalizarTelefone({ telefoneContato: "", tel1: "", tel2: "1233023106" })).toBe("551233023106");
  });

  it("combina ddd + número de 8-9 dígitos quando não há DDD embutido", () => {
    expect(normalizarTelefone({ ddd: "19", tel1: "35737700" })).toBe("551935737700");
  });

  it("não combina número sem DDD quando o campo ddd também está vazio", () => {
    expect(normalizarTelefone({ ddd: "", tel1: "35737700" })).toBeNull();
  });

  it("aceita número que já vem com código do país 55", () => {
    expect(normalizarTelefone({ telefoneContato: "5519991002213" })).toBe("5519991002213");
  });

  it("retorna null quando nenhum campo tem telefone utilizável", () => {
    expect(normalizarTelefone({ ddd: "", tel1: "0", tel2: "", telefoneContato: "" })).toBeNull();
  });

  it("remove caracteres não numéricos antes de avaliar o tamanho", () => {
    expect(normalizarTelefone({ telefoneContato: "(17) 99229-3873" })).toBe("5517992293873");
  });

  it("rejeita um número com código do país mas dígitos demais (ex.: dois telefones concatenados por erro de digitação)", () => {
    expect(normalizarTelefone({ telefoneContato: "551999100221355119876543" })).toBeNull();
  });
});

describe("montarLinkWhatsapp", () => {
  it("monta o link wa.me com o texto codificado", () => {
    const link = montarLinkWhatsapp("5519991002213", "Olá, tudo bem?");
    expect(link).toBe("https://wa.me/5519991002213?text=Ol%C3%A1%2C%20tudo%20bem%3F");
  });
});
