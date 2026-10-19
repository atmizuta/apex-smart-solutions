import { describe, it, expect, vi } from "vitest";
import { chamarAcaoComSeguranca, ERRO_DE_TRANSPORTE } from "./chamar-acao";

describe("chamarAcaoComSeguranca", () => {
  it("devolve o resultado da ação quando o servidor responde", async () => {
    const repassar = vi.fn();
    expect(await chamarAcaoComSeguranca(async () => ({}), repassar)).toEqual({});
    expect(await chamarAcaoComSeguranca(async () => ({ erro: "Lead não encontrado" }), repassar)).toEqual({
      erro: "Lead não encontrado",
    });
    expect(repassar).not.toHaveBeenCalled();
  });

  it("falha de transporte (rede, 504, aba velha) vira mensagem amigável em vez de estourar a página", async () => {
    const resultado = await chamarAcaoComSeguranca(
      async () => {
        throw new Error("An unexpected response was received from the server.");
      },
      () => {}
    );
    expect(resultado).toEqual({ erro: ERRO_DE_TRANSPORTE });
    expect(ERRO_DE_TRANSPORTE).toMatch(/Recarregue a página/);
  });

  it("entrega o erro ao Next antes de engolir", async () => {
    const falha = new Error("rede caiu");
    const repassar = vi.fn();

    await chamarAcaoComSeguranca(async () => Promise.reject(falha), repassar);

    expect(repassar).toHaveBeenCalledTimes(1);
    expect(repassar).toHaveBeenCalledWith(falha);
  });

  it("não engole redirect/notFound: se o Next relança, o erro segue adiante", async () => {
    const redirecionamento = new Error("NEXT_REDIRECT");
    const relancar = (erro: unknown) => {
      throw erro;
    };

    await expect(
      chamarAcaoComSeguranca(async () => Promise.reject(redirecionamento), relancar)
    ).rejects.toBe(redirecionamento);
  });
});
