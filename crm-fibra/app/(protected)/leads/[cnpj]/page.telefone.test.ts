import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("page.tsx do lead — telefone na aba Proposta", () => {
  const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
  const inicio = fonte.indexOf("<AbaProposta");
  const uso = fonte.slice(inicio, fonte.indexOf("/>", inicio));

  it("só entrega o telefone à aba Proposta (componente de cliente) quando o usuário é o dono", () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(uso).toContain("telefone={souODono ? telefone : null}");
    expect(uso).not.toMatch(/telefone=\{telefone\}/);
  });

  it("passa à aba o nome do consultor logado e se ele é o dono", () => {
    expect(uso).toContain("nomeConsultor=");
    expect(uso).toContain("souODono={souODono}");
  });
});
