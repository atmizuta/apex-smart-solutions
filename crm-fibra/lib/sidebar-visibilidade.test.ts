import { describe, it, expect } from "vitest";
import { deveMostrarAdministracao } from "./sidebar-visibilidade";

describe("deveMostrarAdministracao", () => {
  it("retorna true para admin", () => {
    expect(deveMostrarAdministracao("admin")).toBe(true);
  });

  it("retorna false para consultor", () => {
    expect(deveMostrarAdministracao("consultor")).toBe(false);
  });
});
