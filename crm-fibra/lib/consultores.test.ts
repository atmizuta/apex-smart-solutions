import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  criarConsultor,
  buscarConsultorPorUsername,
  buscarConsultorPorId,
  listarConsultores,
  definirAtivo,
  UsernameJaExisteError,
} from "./consultores";

// A minimal fake that mimics the chained shape of the Supabase query
// builder (schema().from().select()/.insert()/.update() ... .eq()
// .single()/.maybeSingle()/.order(), and is itself awaitable — matching
// how `await client.update(...).eq(...)` works against the real client).
function makeQueryFake(terminal: () => Promise<{ data?: unknown; error?: unknown }>) {
  const q: any = {
    schema: () => q,
    from: () => q,
    select: () => q,
    insert: (payload: unknown) => {
      q.__inserted = payload;
      return q;
    },
    update: (payload: unknown) => {
      q.__updated = payload;
      return q;
    },
    eq: () => q,
    order: () => terminal(),
    single: () => terminal(),
    maybeSingle: () => terminal(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  };
  return q;
}

const row = {
  id: "1",
  nome: "Ana",
  username: "ana",
  password_hash: "hash-fake",
  papel: "consultor" as const,
  ativo: true,
  criado_em: "2026-09-28T00:00:00Z",
  ultimo_login: null,
};

describe("criarConsultor", () => {
  it("grava o hash da senha, nunca a senha em texto puro", async () => {
    const client = makeQueryFake(async () => ({ data: row, error: null }));

    const consultor = await criarConsultor(client as unknown as SupabaseClient, {
      nome: "Ana",
      username: "ana",
      senha: "senha123",
      papel: "consultor",
    });

    expect(consultor.username).toBe("ana");
    expect(client.__inserted.password_hash).toBeDefined();
    expect(client.__inserted.password_hash).not.toBe("senha123");
    expect(client.__inserted).not.toHaveProperty("senha");
  });

  it("lança UsernameJaExisteError em conflito de username (código 23505)", async () => {
    const client = makeQueryFake(async () => ({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    }));

    await expect(
      criarConsultor(client as unknown as SupabaseClient, {
        nome: "Ana",
        username: "ana",
        senha: "x12345678",
        papel: "consultor",
      })
    ).rejects.toThrow(UsernameJaExisteError);
  });
});

describe("buscarConsultorPorUsername", () => {
  it("retorna null quando não encontra ninguém", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarConsultorPorUsername(client as unknown as SupabaseClient, "fantasma")
    ).toBeNull();
  });

  it("inclui passwordHash no retorno, para o login comparar", async () => {
    const client = makeQueryFake(async () => ({ data: row, error: null }));
    const result = await buscarConsultorPorUsername(client as unknown as SupabaseClient, "ana");
    expect(result?.passwordHash).toBe("hash-fake");
  });
});

describe("buscarConsultorPorId", () => {
  it("retorna null quando o id não existe", async () => {
    const client = makeQueryFake(async () => ({ data: null, error: null }));
    expect(
      await buscarConsultorPorId(client as unknown as SupabaseClient, "inexistente")
    ).toBeNull();
  });
});

describe("listarConsultores", () => {
  it("mapeia todas as linhas do banco para o formato da aplicação", async () => {
    const client = makeQueryFake(async () => ({ data: [row], error: null }));
    const result = await listarConsultores(client as unknown as SupabaseClient);
    expect(result).toEqual([
      {
        id: "1",
        nome: "Ana",
        username: "ana",
        papel: "consultor",
        ativo: true,
        criadoEm: "2026-09-28T00:00:00Z",
        ultimoLogin: null,
      },
    ]);
  });
});

describe("definirAtivo", () => {
  it("atualiza apenas o campo ativo", async () => {
    const client = makeQueryFake(async () => ({ error: null }));
    await definirAtivo(client as unknown as SupabaseClient, "1", false);
    expect(client.__updated).toEqual({ ativo: false });
  });
});
