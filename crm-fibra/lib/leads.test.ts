import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarLeadsSegmentados,
  contarPorCamada,
  buscarLeadPorCnpj,
} from "./leads";

function makeQueryFake(terminal: () => Promise<{ data?: unknown; error?: unknown }>) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: any = {
    calls,
    schema: (...a: unknown[]) => { calls.push({ method: "schema", args: a }); return q; },
    from: (...a: unknown[]) => { calls.push({ method: "from", args: a }); return q; },
    select: (...a: unknown[]) => { calls.push({ method: "select", args: a }); return q; },
    eq: (...a: unknown[]) => { calls.push({ method: "eq", args: a }); return q; },
    is: (...a: unknown[]) => { calls.push({ method: "is", args: a }); return q; },
    or: (...a: unknown[]) => { calls.push({ method: "or", args: a }); return q; },
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return terminal(); },
    maybeSingle: () => terminal(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => terminal().then(resolve, reject),
  };
  return q;
}

const rowBase = {
  cnpj_digits: "00005087000190",
  razao_social: "NABAS & CAMARGO LTDA",
  cidade: "AMERICANA",
  ddd: "19",
  tel1: "1935737700",
  tel2: "",
  telefone_contato: "19991002213",
  email: "x@y.com",
  arpu: 50.97,
  apto_renovacao: "APTO",
  cep_cabeado: "CEP Cabeado",
  linhas_fixas: 0,
  camada_fibra: "fibra_candidato",
  camada_renovacao: "apto_agora",
  dono_consultor_id: null,
  status_contato: null,
  atribuido_em: null,
  ultimo_contato_em: null,
};

describe("listarLeadsSegmentados", () => {
  it("mapeia as linhas para o formato da aplicação", async () => {
    const client = makeQueryFake(async () => ({ data: [rowBase], error: null }));
    const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(result).toEqual([
      {
        cnpjDigits: "00005087000190",
        razaoSocial: "NABAS & CAMARGO LTDA",
        cidade: "AMERICANA",
        ddd: "19",
        tel1: "1935737700",
        tel2: "",
        telefoneContato: "19991002213",
        email: "x@y.com",
        arpu: 50.97,
        aptoRenovacao: "APTO",
        cepCabeado: "CEP Cabeado",
        linhasFixas: 0,
        camadaFibra: "fibra_candidato",
        camadaRenovacao: "apto_agora",
        donoConsultorId: null,
        statusContato: null,
        atribuidoEm: null,
        ultimoContatoEm: null,
      },
    ]);
  });

  it("filtra por camada_fibra quando filtro = fibra_candidato", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "fibra_candidato");
    expect(client.calls).toContainEqual({ method: "eq", args: ["camada_fibra", "fibra_candidato"] });
  });

  it("filtra por dono_consultor_id nulo quando filtro = sem_dono", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "sem_dono");
    expect(client.calls).toContainEqual({ method: "is", args: ["dono_consultor_id", null] });
  });

  it("sanitiza texto de busca removendo caracteres especiais do PostgREST antes do ilike", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", "Acme, (Ltda) 100%*");
    const orCall = client.calls.find((c: { method: string }) => c.method === "or");
    const filtro = orCall.args[0] as string;
    // The raw special characters from the search text must never survive
    // into the filter string...
    expect(filtro).not.toContain(",(");
    expect(filtro).not.toContain(")");
    expect(filtro).not.toContain("100%");
    expect(filtro).not.toContain("*");
    // ...while the actual search words still come through...
    expect(filtro).toContain("Acme");
    expect(filtro).toContain("Ltda");
    expect(filtro).toContain("100");
    // ...and the filter still has exactly 3 comma-separated ilike clauses
    // (one per column) — proving the user's own comma didn't add a 4th.
    expect(filtro.split(",")).toHaveLength(3);
  });

  it("não chama .or() quando não há texto de busca", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(client.calls.find((c: { method: string }) => c.method === "or")).toBeUndefined();
  });
});

describe("contarPorCamada", () => {
  it("conta cada camada e o total, sem contar por dono duplicado", async () => {
    const rows = [
      { camada_fibra: "fibra_candidato", camada_renovacao: null, dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: "apto_agora", dono_consultor_id: "c1" },
      { camada_fibra: null, camada_renovacao: "apto_1_mes", dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: "apto_2_meses", dono_consultor_id: null },
      { camada_fibra: null, camada_renovacao: null, dono_consultor_id: null },
    ];
    // No override needed here: contarPorCamada awaits the chain right
    // after .select(...) with no further method call, and the fake's
    // default .then() already resolves via `terminal()` for exactly that
    // shape — see the other describe blocks for chains that DO need an
    // override (they terminate on .insert()/.single() instead).
    const client = makeQueryFake(async () => ({ data: rows, error: null }));
    const result = await contarPorCamada(client as unknown as SupabaseClient);
    expect(result).toEqual({
      fibraCandidato: 1,
      aptoAgora: 1,
      apto1Mes: 1,
      apto2Meses: 1,
      semDono: 4,
      total: 5,
    });
  });
});

describe("buscarLeadPorCnpj", () => {
  it("retorna null quando não encontra o CNPJ", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00000000000000")
    ).toBeNull();
  });

  it("retorna o lead mapeado quando encontra", async () => {
    const client = makeQueryFake(async () => ({ data: rowBase, error: null }));
    const result = await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(result?.cnpjDigits).toBe("00005087000190");
    expect(result?.razaoSocial).toBe("NABAS & CAMARGO LTDA");
  });
});
