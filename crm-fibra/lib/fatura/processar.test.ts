import { describe, it, expect, vi } from "vitest";
import { FaturaIlegivelError, LIMITE_ARQUIVOS } from "./pdf-texto";
import { processarFaturas } from "./processar";

const pdf = (name: string, size = 1000) => ({ name, size, type: "application/pdf" });

// Fixture sintética no formato da fatura Claro, com o artefato do pdf.js nos acentos.
function bloco(numero: string, valor: string, gb: number, mb: string): string {
  return [
    "DETALHAMENTO DE LIGA ÇÕ ES E SERVI ÇOS DO CELULAR",
    `(17) 90000-${numero}`,
    "Mensalidades e Pacotes Promocionais",
    `Oferta Conjunta Claro MIX ${valor}`,
    `Claro P ó s ${gb}GB -`,
    "Liga çõ es Locais 0,00",
    `Internet (MB) Descri çã o Subtotal ${mb} 0,0000`,
    "TOTAL 99,99",
  ].join(" ");
}

describe("processarFaturas", () => {
  it("lê um arquivo por vez, na ordem em que foram anexados", async () => {
    const eventos: string[] = [];
    const lerTexto = async (arquivo: { name: string }) => {
      eventos.push(`inicio ${arquivo.name}`);
      await Promise.resolve();
      eventos.push(`fim ${arquivo.name}`);
      return bloco("0001", "48,49", 10, "1.000,00");
    };
    await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], lerTexto);
    expect(eventos).toEqual(["inicio a.pdf", "fim a.pdf", "inicio b.pdf", "fim b.pdf"]);
  });

  it("avisa o início de cada leitura (para o indicador de progresso)", async () => {
    const aoIniciar = vi.fn();
    await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], async () => bloco("0001", "48,49", 10, "1.000,00"), aoIniciar);
    expect(aoIniciar.mock.calls).toEqual([
      [1, 2, "a.pdf"],
      [2, 2, "b.pdf"],
    ]);
  });

  it("com duas faturas devolve a média da linha e conta as faturas lidas", async () => {
    const textos: Record<string, string> = {
      "a.pdf": bloco("0001", "48,50", 10, "1.000,00"),
      "b.pdf": bloco("0001", "50,50", 10, "3.001,00"),
    };
    const resultado = await processarFaturas([pdf("a.pdf"), pdf("b.pdf")], async (a) => textos[a.name]);
    expect(resultado.erro).toBeNull();
    expect(resultado.faturasLidas).toBe(2);
    expect(resultado.arquivos.map((a) => [a.nome, a.status, a.linhas])).toEqual([
      ["a.pdf", "ok", 1],
      ["b.pdf", "ok", 1],
    ]);
    expect(resultado.mescladas).toHaveLength(1);
    expect(resultado.mescladas[0]).toMatchObject({ valorMensal: 49.5, consumoMb: 2000.5, faturasEncontradas: 2, totalFaturas: 2 });
  });

  it("um arquivo ilegível não derruba os outros, e a média só conta as faturas lidas", async () => {
    const lerTexto = async (a: { name: string }) => {
      if (a.name === "b.pdf") throw new FaturaIlegivelError("b.pdf");
      return bloco("0001", "48,49", 10, "1.000,00");
    };
    const resultado = await processarFaturas([pdf("a.pdf"), pdf("b.pdf"), pdf("c.pdf")], lerTexto);
    expect(resultado.arquivos.map((a) => a.status)).toEqual(["ok", "ilegivel", "ok"]);
    expect(resultado.arquivos[1].mensagem).toContain("b.pdf");
    expect(resultado.faturasLidas).toBe(2);
    expect(resultado.mescladas[0].totalFaturas).toBe(2);
  });

  it("erro inesperado vira mensagem genérica com o nome do arquivo, sem vazar o detalhe", async () => {
    const lerTexto = async () => {
      throw new Error("falha interna com 17900000001");
    };
    const resultado = await processarFaturas([pdf("x.pdf")], lerTexto);
    expect(resultado.arquivos[0]).toMatchObject({ status: "ilegivel", mensagem: 'Não foi possível ler "x.pdf".' });
    expect(JSON.stringify(resultado.arquivos)).not.toContain("17900000001");
  });

  it("PDF sem texto e PDF sem linhas reconhecidas têm status e mensagem próprios", async () => {
    const textos: Record<string, string> = { "scan.pdf": "   ", "outra.pdf": "Fatura de outra operadora" };
    const resultado = await processarFaturas([pdf("scan.pdf"), pdf("outra.pdf")], async (a) => textos[a.name]);
    expect(resultado.arquivos.map((a) => a.status)).toEqual(["sem_texto", "sem_linhas"]);
    expect(resultado.arquivos[0].mensagem).toMatch(/escaneado/i);
    expect(resultado.arquivos[1].mensagem).toMatch(/digite/i);
    expect(resultado.mescladas).toEqual([]);
    expect(resultado.faturasLidas).toBe(0);
    expect(resultado.erro).toBeNull();
  });

  it("recusa a lista inteira (sem ler nada) quando passa do limite de arquivos", async () => {
    const lerTexto = vi.fn();
    const lista = Array.from({ length: LIMITE_ARQUIVOS + 1 }, (_, i) => pdf(`f${i}.pdf`));
    const resultado = await processarFaturas(lista, lerTexto);
    expect(resultado.erro).toMatch(new RegExp(String(LIMITE_ARQUIVOS)));
    expect(resultado.arquivos).toEqual([]);
    expect(lerTexto).not.toHaveBeenCalled();
  });

  it("recusa arquivo que não é PDF, grande demais ou vazio, sem ler nada", async () => {
    const lerTexto = vi.fn();
    expect((await processarFaturas([{ name: "foto.png", size: 10, type: "image/png" }], lerTexto)).erro).toMatch(/foto\.png/);
    expect((await processarFaturas([pdf("g.pdf", 11 * 1024 * 1024)], lerTexto)).erro).toMatch(/10 MB/);
    expect((await processarFaturas([pdf("v.pdf", 0)], lerTexto)).erro).toMatch(/vazio/);
    expect(lerTexto).not.toHaveBeenCalled();
  });
});
