import type { NeoRow } from "./mapper.ts";

export interface ConfigNeo { url: string; tokenEstrutura: string; tokenUsuario: string; painelId: string }

// A API declara "ISO-8859-1" (e o corpo real é mesmo latin-1). Tentamos UTF-8 estrito primeiro só
// para não corromper caso o fornecedor passe a devolver UTF-8.
export function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ATENÇÃO: a API devolve erros com HTTP 200 e corpo {"erro":"...","success":false}. Se só o status
// HTTP fosse checado, um token vencido pareceria "nenhum pedido novo" e a sincronização pararia calada.
export function parseRespostaNeo(bytes: Uint8Array): NeoRow[] {
  const texto = decodificar(bytes).replace(/^﻿/, "").trim();
  if (texto === "") throw new Error("Resposta vazia da NeoSales (esperava [] ou uma lista).");
  let dados: unknown;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error(`Resposta da NeoSales não é JSON: ${texto.slice(0, 200)}`);
  }
  if (Array.isArray(dados)) return dados as NeoRow[];
  if (dados && typeof dados === "object" && "erro" in dados) {
    throw new Error(`NeoSales recusou a consulta: ${String((dados as { erro: unknown }).erro)}`);
  }
  throw new Error(`Resposta inesperada da NeoSales: ${texto.slice(0, 200)}`);
}

class ErroTransitorio extends Error {}

export function criarBuscarNeo(
  cfg: ConfigNeo,
  opts: { fetchImpl?: typeof fetch; esperar?: (ms: number) => Promise<void>; tentativas?: number } = {},
): (ini: string, fim: string) => Promise<NeoRow[]> {
  const f = opts.fetchImpl ?? fetch;
  const esperar = opts.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = opts.tentativas ?? 3;

  return async (ini, fim) => {
    let ultimo: unknown;
    for (let t = 1; t <= max; t++) {
      try {
        const res = await f(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            tokenEstrutura: cfg.tokenEstrutura, tokenUsuario: cfg.tokenUsuario, painelId: cfg.painelId,
            dataHoraInicioCarga: ini, dataHoraFimCarga: fim, outputFormat: "json",
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (res.status >= 500) throw new ErroTransitorio(`NeoSales HTTP ${res.status}`);
        if (!res.ok) throw new Error(`NeoSales HTTP ${res.status}`);
        return parseRespostaNeo(new Uint8Array(await res.arrayBuffer()));
      } catch (e) {
        const nome = (e as { name?: string }).name;
        const repetivel = e instanceof ErroTransitorio || e instanceof TypeError || nome === "TimeoutError" || nome === "AbortError";
        if (!repetivel) throw e;
        ultimo = e;
        if (t < max) await esperar(1000 * 2 ** (t - 1));
      }
    }
    throw ultimo;
  };
}
