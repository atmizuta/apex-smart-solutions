import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "@google/genai";
import { gerarJson, MODELO_GEMINI, type ClienteGemini } from "./gemini";
import {
  IaCotaEsgotadaError,
  IaIndisponivelError,
  IaNaoConfiguradaError,
  IaRespostaInvalidaError,
} from "./erros";
import { CHAVES_ETAPA } from "./guia-apex";

type Resposta = { texto?: string } | Error;

// Cliente falso do SDK: devolve as respostas na ordem (a última se repete) e
// guarda os parâmetros de cada chamada.
function makeCliente(respostas: Resposta[]) {
  const chamadas: any[] = [];
  const cliente = {
    models: {
      generateContent: async (params: unknown) => {
        chamadas.push(params);
        const resposta = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
        if (resposta instanceof Error) throw resposta;
        return { text: resposta.texto };
      },
    },
  };
  return { cliente: cliente as unknown as ClienteGemini, chamadas };
}

function erroHttp(status: number) {
  return Object.assign(new Error(`{"error":{"code":${status}}}`), { status });
}

function esperaFalsa() {
  const esperas: number[] = [];
  return { esperas, esperar: async (ms: number) => void esperas.push(ms) };
}

const pedido = { sistema: "SISTEMA", usuario: "USUARIO" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("gerarJson — chamada ao modelo", () => {
  it("envia o modelo, a instrução de sistema, o texto do usuário e o schema com as cinco etapas", async () => {
    const { cliente, chamadas } = makeCliente([{ texto: "{}" }]);
    await gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar });

    const [chamada] = chamadas;
    expect(MODELO_GEMINI).toBe("gemini-3.1-flash-lite");
    expect(chamada.model).toBe(MODELO_GEMINI);
    expect(chamada.contents).toBe("USUARIO");
    expect(chamada.config.systemInstruction).toBe("SISTEMA");
    expect(chamada.config.responseMimeType).toBe("application/json");
    expect(chamada.config.thinkingConfig).toEqual({ thinkingBudget: 0 });

    const schema = chamada.config.responseSchema;
    expect(schema.type).toBe(Type.OBJECT);
    expect(schema.required).toEqual([...CHAVES_ETAPA]);
    expect(Object.keys(schema.properties)).toEqual([...CHAVES_ETAPA]);
    for (const propriedade of Object.values(schema.properties)) {
      expect(propriedade).toEqual({ type: Type.STRING });
    }
  });

  it("desliga a retentativa interna do SDK e limita o tempo de cada tentativa", async () => {
    const { cliente, chamadas } = makeCliente([{ texto: "{}" }]);
    await gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar });
    expect(chamadas[0].config.httpOptions).toEqual({ timeout: 15000, retryOptions: { attempts: 1 } });
  });

  it("devolve o texto da resposta", async () => {
    const { cliente } = makeCliente([{ texto: '{"ok":true}' }]);
    expect(await gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).toBe('{"ok":true}');
  });
});

describe("gerarJson — falhas", () => {
  it("tenta de novo quando o Gemini responde 503 e devolve a segunda tentativa", async () => {
    const { cliente, chamadas } = makeCliente([erroHttp(503), { texto: '{"ok":true}' }]);
    const { esperas, esperar } = esperaFalsa();

    expect(await gerarJson(pedido, { cliente, esperar })).toBe('{"ok":true}');
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([1000]);
  });

  it("desiste depois de 3 tentativas em 503 com IaIndisponivelError", async () => {
    const { cliente, chamadas } = makeCliente([erroHttp(503)]);
    const { esperas, esperar } = esperaFalsa();

    await expect(gerarJson(pedido, { cliente, esperar })).rejects.toThrow(IaIndisponivelError);
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([1000, 2000]);
  });

  it("não repete erro de cota (429): IaCotaEsgotadaError com uma chamada só", async () => {
    const { cliente, chamadas } = makeCliente([erroHttp(429)]);
    const { esperas, esperar } = esperaFalsa();

    await expect(gerarJson(pedido, { cliente, esperar })).rejects.toThrow(IaCotaEsgotadaError);
    expect(chamadas).toHaveLength(1);
    expect(esperas).toEqual([]);
  });

  it.each([
    [
      "sobrecarga",
      '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}',
      IaIndisponivelError,
    ],
    ["cota", '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}', IaCotaEsgotadaError],
  ])("reconhece %s pelo texto da mensagem quando o SDK não traz o status", async (_nome, mensagem, esperado) => {
    const { cliente } = makeCliente([new Error(mensagem)]);
    await expect(gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).rejects.toThrow(esperado);
  });

  it("estouro de tempo (AbortError) é tratado como sobrecarga: tenta de novo", async () => {
    const abortada = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    const { cliente, chamadas } = makeCliente([abortada, { texto: '{"ok":true}' }]);
    const { esperas, esperar } = esperaFalsa();

    expect(await gerarJson(pedido, { cliente, esperar })).toBe('{"ok":true}');
    expect(chamadas).toHaveLength(2);
    expect(esperas).toEqual([1000]);
  });

  it.each([500, 502, 504])("erro %s do servidor do Gemini é transitório: tenta de novo", async (status) => {
    const { cliente, chamadas } = makeCliente([erroHttp(status), { texto: '{"ok":true}' }]);

    expect(await gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).toBe('{"ok":true}');
    expect(chamadas).toHaveLength(2);
  });

  it("erro do cliente (400) não repete: o pedido em si está errado", async () => {
    const { cliente, chamadas } = makeCliente([erroHttp(400)]);
    await expect(gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).rejects.toMatchObject({
      status: 400,
    });
    expect(chamadas).toHaveLength(1);
  });

  it("propaga outros erros sem repetir", async () => {
    const { cliente, chamadas } = makeCliente([new Error("rede caiu")]);
    await expect(gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).rejects.toThrow("rede caiu");
    expect(chamadas).toHaveLength(1);
  });

  it.each([undefined, "   "])(
    "resposta vazia (%j) vira IaRespostaInvalidaError sem repetir",
    async (texto) => {
      const { cliente, chamadas } = makeCliente([{ texto }]);
      await expect(gerarJson(pedido, { cliente, esperar: esperaFalsa().esperar })).rejects.toThrow(
        IaRespostaInvalidaError
      );
      expect(chamadas).toHaveLength(1);
    }
  );

  it("sem GEMINI_API_KEY lança IaNaoConfiguradaError", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(gerarJson(pedido)).rejects.toThrow(IaNaoConfiguradaError);
  });
});
