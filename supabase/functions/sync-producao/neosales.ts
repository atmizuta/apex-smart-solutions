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

// Sem retry, de propósito: a NeoSales só aceita 1 consulta a cada ~2 min. Repetir logo depois de um timeout
// ou 5xx bateria nesse intervalo, esconderia a causa real ("Aguarde N segundos" no lugar do timeout) e
// estouraria o tempo da função. Quem "repete" é o próximo job (janela com sobreposição de 15 min).
export function criarBuscarNeo(
  cfg: ConfigNeo,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): (ini: string, fim: string) => Promise<NeoRow[]> {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 120_000; // abaixo do limite de 150 s da função

  return async (ini, fim) => {
    const res = await f(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        tokenEstrutura: cfg.tokenEstrutura, tokenUsuario: cfg.tokenUsuario, painelId: cfg.painelId,
        dataHoraInicioCarga: ini, dataHoraFimCarga: fim, outputFormat: "json",
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`NeoSales HTTP ${res.status}`);
    return parseRespostaNeo(new Uint8Array(await res.arrayBuffer()));
  };
}
