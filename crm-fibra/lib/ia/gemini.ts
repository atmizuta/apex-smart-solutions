import { GoogleGenAI, Type } from "@google/genai";
import {
  IaCotaEsgotadaError,
  IaIndisponivelError,
  IaNaoConfiguradaError,
  IaRespostaInvalidaError,
} from "./erros";
import { CHAVES_ETAPA } from "./guia-apex";

// Mesmo modelo do app de prática (pratica-vendas/lib/ia/cliente.ts).
export const MODELO_GEMINI = "gemini-3.1-flash-lite";

export type ClienteGemini = Pick<GoogleGenAI, "models">;

// 3 tentativas no total. Com 15 s por tentativa e as esperas abaixo, o pior
// caso fica em ~48 s, dentro do maxDuration = 60 da página.
const ESPERAS_ENTRE_TENTATIVAS_MS = [1000, 2000];
const TEMPO_POR_TENTATIVA_MS = 15_000;

const SCHEMA_ETAPAS = {
  type: Type.OBJECT,
  properties: Object.fromEntries(CHAVES_ETAPA.map((chave) => [chave, { type: Type.STRING }])),
  required: [...CHAVES_ETAPA],
};

function criarCliente(): ClienteGemini {
  const chave = process.env.GEMINI_API_KEY;
  if (!chave) throw new IaNaoConfiguradaError();
  return new GoogleGenAI({ apiKey: chave });
}

type Falha = "sobrecarga" | "cota" | "outra";

// O ApiError do SDK traz `status`; o texto da mensagem é o plano B, como no
// app de prática, caso o erro chegue embrulhado. Erro 5xx e estouro do tempo
// da tentativa (AbortError) são transitórios no Gemini — a chamada real mostrou
// os dois, além do 503 — e se tratam como sobrecarga. Erro 4xx não: o pedido em
// si está errado e repetir só gastaria tempo e cota.
function classificar(erro: unknown): Falha {
  const status = (erro as { status?: unknown } | null)?.status;
  const nome = erro instanceof Error ? erro.name : "";
  const mensagem = erro instanceof Error ? erro.message : "";
  if (
    (typeof status === "number" && status >= 500) ||
    /UNAVAILABLE|"code":\s*5\d\d/.test(mensagem) ||
    nome === "AbortError" ||
    nome === "TimeoutError"
  ) {
    return "sobrecarga";
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|"code":\s*429/.test(mensagem)) return "cota";
  return "outra";
}

const esperarPadrao = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function gerarJson(
  pedido: { sistema: string; usuario: string },
  dependencias: { cliente?: ClienteGemini; esperar?: (ms: number) => Promise<void> } = {}
): Promise<string> {
  const cliente = dependencias.cliente ?? criarCliente();
  const esperar = dependencias.esperar ?? esperarPadrao;

  for (let tentativa = 0; ; tentativa++) {
    try {
      const resposta = await cliente.models.generateContent({
        model: MODELO_GEMINI,
        contents: pedido.usuario,
        config: {
          systemInstruction: pedido.sistema,
          responseMimeType: "application/json",
          responseSchema: SCHEMA_ETAPAS,
          maxOutputTokens: 1500,
          thinkingConfig: { thinkingBudget: 0 },
          // O SDK repetiria sozinho; aqui o controle (e o tempo total) é nosso.
          httpOptions: { timeout: TEMPO_POR_TENTATIVA_MS, retryOptions: { attempts: 1 } },
        },
      });

      const texto = resposta.text;
      if (!texto || !texto.trim()) {
        throw new IaRespostaInvalidaError("resposta vazia ou bloqueada");
      }
      return texto;
    } catch (erro) {
      if (erro instanceof IaRespostaInvalidaError) throw erro;

      const falha = classificar(erro);
      if (falha === "sobrecarga") {
        if (tentativa < ESPERAS_ENTRE_TENTATIVAS_MS.length) {
          await esperar(ESPERAS_ENTRE_TENTATIVAS_MS[tentativa]);
          continue;
        }
        throw new IaIndisponivelError();
      }
      if (falha === "cota") throw new IaCotaEsgotadaError();
      throw erro;
    }
  }
}
