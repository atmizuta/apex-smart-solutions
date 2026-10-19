import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("page.tsx do lead", () => {
  it("define maxDuration = 60: gerar a abordagem com tentativas passa dos 10 s padrão da função", () => {
    const fonte = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf8");
    expect(fonte).toMatch(/export const maxDuration = 60;/);
  });
});
