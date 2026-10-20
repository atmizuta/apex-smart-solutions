import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOGO_APEX, LOGO_CLARO } from "./marca";

function ler(arquivo: string): Buffer {
  return readFileSync(fileURLToPath(new URL(`../../public/marca/${arquivo}`, import.meta.url)));
}

// Percorre os marcadores JPEG até o primeiro SOF, onde ficam altura e largura.
function dimensoesJpeg(b: Buffer): { largura: number; altura: number } {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marcador = b[i + 1];
    if (marcador >= 0xc0 && marcador <= 0xc2) {
      return { altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("SOF não encontrado");
}

describe("logos da marca (public/marca)", () => {
  it("apex-logo.png é um PNG com as dimensões declaradas em LOGO_APEX", () => {
    const b = ler("apex-logo.png");
    expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(b.readUInt32BE(16)).toBe(LOGO_APEX.largura);
    expect(b.readUInt32BE(20)).toBe(LOGO_APEX.altura);
  });

  it("claro-logo.jpg é um JPEG com as dimensões declaradas em LOGO_CLARO", () => {
    const b = ler("claro-logo.jpg");
    expect(b[0]).toBe(0xff);
    expect(b[1]).toBe(0xd8);
    expect(dimensoesJpeg(b)).toEqual({ largura: LOGO_CLARO.largura, altura: LOGO_CLARO.altura });
  });
});
