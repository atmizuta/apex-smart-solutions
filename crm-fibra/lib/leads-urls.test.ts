import { describe, it, expect } from "vitest";
import { hrefCarteiraFiltrada, hrefCarteiraPagina } from "./leads-urls";

describe("hrefCarteiraFiltrada", () => {
  it("nunca inclui o parâmetro pagina — trocar filtro ou busca sempre volta pra página 1", () => {
    const href = hrefCarteiraFiltrada("apto_agora", "acme");
    expect(href).not.toContain("pagina=");
  });

  it("monta camada e busca", () => {
    expect(hrefCarteiraFiltrada("apto_agora", "acme")).toBe("/leads?camada=apto_agora&busca=acme");
  });

  it("omite busca quando vazia", () => {
    expect(hrefCarteiraFiltrada("todos", "")).toBe("/leads?camada=todos");
  });
});

describe("hrefCarteiraPagina", () => {
  it("inclui filtro, busca e página", () => {
    expect(hrefCarteiraPagina("apto_agora", "acme", 3)).toBe(
      "/leads?camada=apto_agora&busca=acme&pagina=3"
    );
  });

  it("omite busca quando vazia", () => {
    expect(hrefCarteiraPagina("todos", "", 1)).toBe("/leads?camada=todos&pagina=1");
  });
});
