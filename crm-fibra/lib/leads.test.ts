import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarLeadsSegmentados,
  contarPorCamada,
  buscarLeadPorCnpj,
  atribuirLead,
  LeadJaAtribuidoError,
  listarMensagens,
  registrarMensagem,
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
    single: () => terminal(),
    insert: (payload: unknown) => { q.__inserted = payload; return q; },
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

  it("sanitiza texto de busca removendo caracteres especiais do PostgREST e preserva a busca por substring", async () => {
    const client = makeQueryFake(async () => ({ data: [], error: null }));
    const buscaOriginal = "Acme, (Ltda) 100%*";
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", buscaOriginal);
    const orCall = client.calls.find((c: { method: string }) => c.method === "or");
    const filtro = orCall.args[0] as string;

    // Compute the same sanitization the implementation is supposed to do,
    // so this test never has to hand-count spaces to know the expected
    // value.
    const termoEsperado = buscaOriginal.replace(/[,()%*]/g, " ").trim();

    expect(filtro).toBe(
      `razao_social.ilike.%${termoEsperado}%,cidade.ilike.%${termoEsperado}%,cnpj_digits.ilike.%${termoEsperado}%`
    );
    // The raw special characters must never survive as literal characters
    // from the user's input — only as the wrapper's own leading/trailing %.
    expect(termoEsperado).not.toMatch(/[,()%*]/);
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

describe("atribuirLead", () => {
  it("insere a atribuição com o cnpj e o consultor", async () => {
    const client = makeQueryFake(async () => ({ error: null }));
    await atribuirLead(client as unknown as SupabaseClient, "00005087000190", "consultor-1");
    expect(client.__inserted).toEqual({ cnpj_digits: "00005087000190", consultor_id: "consultor-1" });
  });

  it("lança LeadJaAtribuidoError em conflito (código 23505)", async () => {
    const client = makeQueryFake(async () => ({ error: { code: "23505", message: "duplicate key" } }));
    await expect(
      atribuirLead(client as unknown as SupabaseClient, "00005087000190", "consultor-1")
    ).rejects.toThrow(LeadJaAtribuidoError);
  });
});

describe("listarMensagens", () => {
  it("mapeia mensagens em ordem decrescente de envio", async () => {
    const row = {
      id: "m1",
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Oi, tudo bem?",
      gerado_por_ia: false,
      abordagem_tipo: null,
      enviado_em: "2026-09-29T10:00:00Z",
    };
    const client = makeQueryFake(async () => ({ data: [row], error: null }));
    const result = await listarMensagens(client as unknown as SupabaseClient, "00005087000190");
    expect(result).toEqual([
      {
        id: "m1",
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        canal: "whatsapp",
        conteudo: "Oi, tudo bem?",
        geradoPorIa: false,
        abordagemTipo: null,
        enviadoEm: "2026-09-29T10:00:00Z",
      },
    ]);
  });
});

describe("registrarMensagem", () => {
  it("insere a mensagem e retorna a linha criada", async () => {
    const rowCriada = {
      id: "m2",
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
      gerado_por_ia: false,
      abordagem_tipo: null,
      enviado_em: "2026-09-29T11:00:00Z",
    };
    const client = makeQueryFake(async () => ({ data: rowCriada, error: null }));

    const result = await registrarMensagem(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
    });

    expect(result.id).toBe("m2");
    expect(client.__inserted).toEqual({
      cnpj_digits: "00005087000190",
      consultor_id: "c1",
      canal: "whatsapp",
      conteudo: "Olá!",
      gerado_por_ia: false,
      abordagem_tipo: null,
    });
  });
});
