import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarUltimaAbordagem, criarAbordagem } from "./abordagens";
import type { EtapasAbordagem } from "./ia/guia-apex";

// Fake encadeável do query builder do Supabase, "await-ável" como o real.
// Registra todas as chamadas para provar o que NÃO foi feito (update/delete).
function makeQueryFake(resposta: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: any = { calls };
  for (const metodo of ["schema", "from", "select", "eq", "order", "limit", "update", "delete", "upsert"]) {
    q[metodo] = (...args: unknown[]) => {
      calls.push({ method: metodo, args });
      return q;
    };
  }
  q.insert = (payload: unknown) => {
    calls.push({ method: "insert", args: [payload] });
    q.__inserted = payload;
    return q;
  };
  q.single = () => Promise.resolve(resposta);
  q.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resposta).then(resolve, reject);
  return q;
}

const etapas: EtapasAbordagem = {
  abordagem: "Olá! Aqui é da Apex, revenda Claro Empresas.",
  sondagem: "Hoje quantas linhas a empresa usa?",
  maleficios: "A renovação já está liberada e ainda não foi aproveitada.",
  beneficios: "Com a proposta, a empresa passa para planos maiores.",
  finalizacao: "Posso fechar hoje?",
};

const row = {
  id: "a1",
  cnpj_digits: "11222333000181",
  consultor_id: "c1",
  proposta_id: "p1",
  etapas,
  modelo: "gemini-3.1-flash-lite",
  criado_em: "2026-10-13T12:00:00Z",
};

const esperada = {
  id: "a1",
  cnpjDigits: "11222333000181",
  consultorId: "c1",
  propostaId: "p1",
  etapas,
  modelo: "gemini-3.1-flash-lite",
  criadoEm: "2026-10-13T12:00:00Z",
};

const entrada = {
  cnpjDigits: "11222333000181",
  consultorId: "c1",
  propostaId: "p1",
  etapas,
  modelo: "gemini-3.1-flash-lite",
};

describe("criarAbordagem", () => {
  it("insere a linha completa e devolve a abordagem mapeada", async () => {
    const client = makeQueryFake({ data: row, error: null });
    const criada = await criarAbordagem(client as unknown as SupabaseClient, entrada);

    expect(client.__inserted).toEqual({
      cnpj_digits: "11222333000181",
      consultor_id: "c1",
      proposta_id: "p1",
      etapas,
      modelo: "gemini-3.1-flash-lite",
    });
    expect(criada).toEqual(esperada);
  });

  it("grava proposta_id nulo quando o roteiro foi gerado sem proposta", async () => {
    const client = makeQueryFake({ data: { ...row, proposta_id: null }, error: null });
    const criada = await criarAbordagem(client as unknown as SupabaseClient, { ...entrada, propostaId: null });

    expect(client.__inserted.proposta_id).toBeNull();
    expect(criada.propostaId).toBeNull();
  });

  it("só insere — nunca atualiza nem apaga (dois consultores não se sobrescrevem)", async () => {
    const client = makeQueryFake({ data: row, error: null });
    await criarAbordagem(client as unknown as SupabaseClient, entrada);

    const metodos = client.calls.map((c: { method: string }) => c.method);
    expect(metodos).toContain("insert");
    for (const proibido of ["update", "delete", "upsert"]) {
      expect(metodos).not.toContain(proibido);
    }
    const tabelas = client.calls
      .filter((c: { method: string }) => c.method === "from")
      .map((c: { args: unknown[] }) => c.args[0]);
    expect(tabelas).toEqual(["abordagens"]);
  });

  it("propaga o erro do banco", async () => {
    const client = makeQueryFake({ data: null, error: { message: "boom" } });
    await expect(criarAbordagem(client as unknown as SupabaseClient, entrada)).rejects.toMatchObject({
      message: "boom",
    });
  });
});

describe("buscarUltimaAbordagem", () => {
  it("busca a mais recente do lead: filtra pelo CNPJ, ordena por data decrescente, uma só", async () => {
    const client = makeQueryFake({ data: [row], error: null });
    const ultima = await buscarUltimaAbordagem(client as unknown as SupabaseClient, "11222333000181");

    expect(ultima).toEqual(esperada);
    expect(client.calls).toContainEqual({ method: "eq", args: ["cnpj_digits", "11222333000181"] });
    expect(client.calls).toContainEqual({ method: "order", args: ["criado_em", { ascending: false }] });
    expect(client.calls).toContainEqual({ method: "limit", args: [1] });
  });

  it("devolve null quando o lead ainda não tem abordagem", async () => {
    const client = makeQueryFake({ data: [], error: null });
    expect(await buscarUltimaAbordagem(client as unknown as SupabaseClient, "11222333000181")).toBeNull();
  });

  it("propaga o erro do banco", async () => {
    const client = makeQueryFake({ data: null, error: { message: "boom" } });
    await expect(
      buscarUltimaAbordagem(client as unknown as SupabaseClient, "11222333000181")
    ).rejects.toMatchObject({ message: "boom" });
  });
});
