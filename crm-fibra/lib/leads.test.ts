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

// `paginas` is an array of { data, error } responses returned in order,
// one per call to a terminal method (.range()/.limit()/.single()). If
// there's only one entry, every terminal call gets that same response
// (covers the common single-page case without repeating it per test).
function makeQueryFake(paginas: Array<{ data?: unknown; error?: unknown }>) {
  const calls: { method: string; args: unknown[] }[] = [];
  let chamada = 0;

  const proxima = (): { data?: unknown; error?: unknown } => {
    const pagina = paginas[Math.min(chamada, paginas.length - 1)];
    chamada += 1;
    return pagina;
  };

  const q: any = {
    calls,
    schema: (...a: unknown[]) => { calls.push({ method: "schema", args: a }); return q; },
    from: (...a: unknown[]) => { calls.push({ method: "from", args: a }); return q; },
    select: (...a: unknown[]) => { calls.push({ method: "select", args: a }); return q; },
    eq: (...a: unknown[]) => { calls.push({ method: "eq", args: a }); return q; },
    is: (...a: unknown[]) => { calls.push({ method: "is", args: a }); return q; },
    or: (...a: unknown[]) => { calls.push({ method: "or", args: a }); return q; },
    order: (...a: unknown[]) => { calls.push({ method: "order", args: a }); return q; },
    range: (...a: unknown[]) => { calls.push({ method: "range", args: a }); return Promise.resolve(proxima()); },
    limit: (...a: unknown[]) => { calls.push({ method: "limit", args: a }); return Promise.resolve(proxima()); },
    single: () => Promise.resolve(proxima()),
    insert: (payload: unknown) => { q.__inserted = payload; return q; },
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(proxima()).then(resolve, reject),
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

const leadEsperado = {
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
};

describe("listarLeadsSegmentados", () => {
  it("mapeia as linhas para o formato da aplicação", async () => {
    const client = makeQueryFake([{ data: [rowBase], error: null }]);
    const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(result).toEqual([leadEsperado]);
  });

  it("filtra por camada_fibra quando filtro = fibra_candidato", async () => {
    const client = makeQueryFake([{ data: [], error: null }]);
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "fibra_candidato");
    expect(client.calls).toContainEqual({ method: "eq", args: ["camada_fibra", "fibra_candidato"] });
  });

  it("filtra por dono_consultor_id nulo quando filtro = sem_dono", async () => {
    const client = makeQueryFake([{ data: [], error: null }]);
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "sem_dono");
    expect(client.calls).toContainEqual({ method: "is", args: ["dono_consultor_id", null] });
  });

  it("sanitiza texto de busca removendo caracteres especiais do PostgREST e preserva a busca por substring", async () => {
    const client = makeQueryFake([{ data: [], error: null }]);
    const buscaOriginal = "Acme, (Ltda) 100%*";
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos", buscaOriginal);
    const orCall = client.calls.find((c: { method: string }) => c.method === "or");
    const filtro = orCall.args[0] as string;
    const termoEsperado = buscaOriginal.replace(/[,()%*]/g, " ").trim();
    expect(filtro).toBe(
      `razao_social.ilike.%${termoEsperado}%,cidade.ilike.%${termoEsperado}%,cnpj_digits.ilike.%${termoEsperado}%`
    );
    expect(termoEsperado).not.toMatch(/[,()%*]/);
  });

  it("não chama .or() quando não há texto de busca", async () => {
    const client = makeQueryFake([{ data: [], error: null }]);
    await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");
    expect(client.calls.find((c: { method: string }) => c.method === "or")).toBeUndefined();
  });

  it("busca todas as páginas quando a base tem mais de 1000 linhas (limite do PostgREST)", async () => {
    const paginaCheia = Array.from({ length: 1000 }, (_, i) => ({
      ...rowBase,
      cnpj_digits: String(i).padStart(14, "0"),
    }));
    const paginaFinal = [{ ...rowBase, cnpj_digits: "99999999999999" }];
    const client = makeQueryFake([
      { data: paginaCheia, error: null },
      { data: paginaFinal, error: null },
    ]);

    const result = await listarLeadsSegmentados(client as unknown as SupabaseClient, "todos");

    expect(result).toHaveLength(1001);
    const rangeCalls = client.calls.filter((c: { method: string }) => c.method === "range");
    expect(rangeCalls).toEqual([
      { method: "range", args: [0, 999] },
      { method: "range", args: [1000, 1999] },
    ]);
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
    const client = makeQueryFake([{ data: rows, error: null }]);
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

  it("também pagina além de 1000 linhas", async () => {
    const paginaCheia = Array.from({ length: 1000 }, () => ({
      camada_fibra: "fibra_candidato",
      camada_renovacao: null,
      dono_consultor_id: null,
    }));
    const paginaFinal = [{ camada_fibra: null, camada_renovacao: "apto_agora", dono_consultor_id: null }];
    const client = makeQueryFake([
      { data: paginaCheia, error: null },
      { data: paginaFinal, error: null },
    ]);

    const result = await contarPorCamada(client as unknown as SupabaseClient);

    expect(result.total).toBe(1001);
    expect(result.fibraCandidato).toBe(1000);
    expect(result.aptoAgora).toBe(1);
  });
});

describe("buscarLeadPorCnpj", () => {
  it("retorna null quando não encontra o CNPJ", async () => {
    const client = makeQueryFake([{ data: [], error: null }]);
    expect(
      await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00000000000000")
    ).toBeNull();
  });

  it("retorna o lead mapeado quando encontra uma linha", async () => {
    const client = makeQueryFake([{ data: [rowBase], error: null }]);
    const result = await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(result).toEqual(leadEsperado);
  });

  it("usa .limit(1) e retorna a primeira linha em vez de lançar erro quando há CNPJ duplicado", async () => {
    const segundaLinha = { ...rowBase, arpu: 999 };
    const client = makeQueryFake([{ data: [rowBase, segundaLinha], error: null }]);
    const result = await buscarLeadPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(result?.arpu).toBe(50.97);
    expect(client.calls).toContainEqual({ method: "limit", args: [1] });
    expect(client.calls.find((c: { method: string }) => c.method === "maybeSingle")).toBeUndefined();
  });
});

describe("atribuirLead", () => {
  it("insere a atribuição com o cnpj e o consultor", async () => {
    const client = makeQueryFake([{ error: null }]);
    await atribuirLead(client as unknown as SupabaseClient, "00005087000190", "consultor-1");
    expect(client.__inserted).toEqual({ cnpj_digits: "00005087000190", consultor_id: "consultor-1" });
  });

  it("lança LeadJaAtribuidoError em conflito (código 23505)", async () => {
    const client = makeQueryFake([{ error: { code: "23505", message: "duplicate key" } }]);
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
    const client = makeQueryFake([{ data: [row], error: null }]);
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
    const client = makeQueryFake([{ data: rowCriada, error: null }]);
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
