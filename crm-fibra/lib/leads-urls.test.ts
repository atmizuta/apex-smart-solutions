import { describe, it, expect } from "vitest";
import { hrefCarteiraFiltrada, hrefCarteiraPagina, paginasParaExibir } from "./leads-urls";

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

describe("paginasParaExibir", () => {
  it("mostra todas as páginas quando são 7 ou menos", () => {
    expect(paginasParaExibir(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginasParaExibir(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("nunca retorna mais que 9 itens, mesmo com centenas de páginas (o bug que mandou 262 links pra tela)", () => {
    const resultado = paginasParaExibir(130, 262);
    expect(resultado.length).toBeLessThanOrEqual(9);
  });

  it("mostra primeira, última, e uma janela ao redor da página atual, com reticências entre os blocos", () => {
    expect(paginasParaExibir(10, 20)).toEqual([1, "reticencias", 8, 9, 10, 11, 12, "reticencias", 20]);
  });

  it("não usa reticências quando a janela já encosta no início", () => {
    expect(paginasParaExibir(2, 20)).toEqual([1, 2, 3, 4, "reticencias", 20]);
  });

  it("não usa reticências quando a janela já encosta no fim", () => {
    expect(paginasParaExibir(19, 20)).toEqual([1, "reticencias", 17, 18, 19, 20]);
  });
});
