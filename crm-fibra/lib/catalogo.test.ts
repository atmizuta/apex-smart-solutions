import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarCatalogo,
  agruparPorCategoria,
  criarPlano,
  atualizarPlano,
  definirPlanoAtivo,
  categoriaTemFranquia,
  PlanoJaExisteError,
  CATEGORIAS_CATALOGO,
  type PlanoCatalogo,
} from "./catalogo";

// Fake encadeável do query builder do Supabase; é "await-ável" como o real.
function makeQueryFake(resposta: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: any = { calls };
  for (const metodo of ["schema", "from", "select", "eq", "order"]) {
    q[metodo] = (...args: unknown[]) => {
      calls.push({ method: metodo, args });
      return q;
    };
  }
  q.insert = (payload: unknown) => {
    q.__inserted = payload;
    return q;
  };
  q.update = (payload: unknown) => {
    q.__updated = payload;
    return q;
  };
  q.single = () => Promise.resolve(resposta);
  q.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resposta).then(resolve, reject);
  return q;
}

const row = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
  franquia_gb: null,
};

const plano: PlanoCatalogo = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
  franquiaGb: null,
};

describe("listarCatalogo", () => {
  it("mapeia as linhas e ordena por valor e depois por nome", async () => {
    const client = makeQueryFake({ data: [row], error: null });
    const resultado = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: false });
    expect(resultado).toEqual([plano]);
    expect(client.calls).toContainEqual({ method: "schema", args: ["crm_fibra"] });
    expect(client.calls).toContainEqual({ method: "from", args: ["catalogo_planos"] });
    expect(client.calls).toContainEqual({ method: "order", args: ["valor", { ascending: true }] });
    expect(client.calls).toContainEqual({ method: "order", args: ["nome", { ascending: true }] });
  });

  it("com apenasAtivos filtra ativo = true", async () => {
    const client = makeQueryFake({ data: [], error: null });
    await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(client.calls).toContainEqual({ method: "eq", args: ["ativo", true] });
  });

  it("sem apenasAtivos não filtra por ativo (o admin vê os desativados)", async () => {
    const client = makeQueryFake({ data: [], error: null });
    await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: false });
    expect(client.calls.find((c: { method: string }) => c.method === "eq")).toBeUndefined();
  });

  it("propaga o erro do banco", async () => {
    const client = makeQueryFake({ data: null, error: { message: "boom" } });
    await expect(
      listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true })
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("agruparPorCategoria", () => {
  it("devolve sempre as 5 categorias, na ordem do catálogo, mesmo vazias", () => {
    const grupos = agruparPorCategoria([plano]);
    expect(grupos.map((g) => g.categoria)).toEqual([...CATEGORIAS_CATALOGO]);
    expect(grupos.find((g) => g.categoria === "convergente")?.planos).toEqual([]);
    expect(grupos.find((g) => g.categoria === "banda_larga")?.planos).toEqual([plano]);
  });

  it("devolve as 5 categorias vazias quando não há nenhum plano", () => {
    const grupos = agruparPorCategoria([]);
    expect(grupos).toHaveLength(5);
    expect(grupos.every((g) => g.planos.length === 0)).toBe(true);
  });

  it("dá a cada grupo um rótulo legível em português", () => {
    const grupos = agruparPorCategoria([]);
    expect(grupos.find((g) => g.categoria === "convergente")?.rotulo).toBe("Convergentes (Fibra + Pós)");
    expect(grupos.find((g) => g.categoria === "banda_larga")?.rotulo).toBe("Banda Larga");
  });
});

describe("criarPlano", () => {
  it("insere os campos do plano e devolve o plano criado", async () => {
    const client = makeQueryFake({ data: row, error: null });
    const criado = await criarPlano(client as unknown as SupabaseClient, {
      categoria: "banda_larga",
      nome: "400 Mega (G1 Padrão)",
      valor: 79.9,
      observacao: "single/combinado/convergência",
    });
    expect(client.__inserted).toEqual({
      categoria: "banda_larga",
      nome: "400 Mega (G1 Padrão)",
      valor: 79.9,
      observacao: "single/combinado/convergência",
      franquia_gb: null,
    });
    expect(criado).toEqual(plano);
  });

  it("grava observação nula quando ela é omitida", async () => {
    const client = makeQueryFake({ data: { ...row, observacao: null }, error: null });
    await criarPlano(client as unknown as SupabaseClient, {
      categoria: "adicional",
      nome: "Claro Monitor",
      valor: 5,
    });
    expect(client.__inserted.observacao).toBeNull();
  });

  it("lança PlanoJaExisteError em conflito de categoria + nome (código 23505)", async () => {
    const client = makeQueryFake({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(
      criarPlano(client as unknown as SupabaseClient, {
        categoria: "adicional",
        nome: "Claro Monitor",
        valor: 5,
      })
    ).rejects.toThrow(PlanoJaExisteError);
  });
});

describe("atualizarPlano", () => {
  it("atualiza só valor e observação, e só na tabela do catálogo", async () => {
    const client = makeQueryFake({ error: null });
    await atualizarPlano(client as unknown as SupabaseClient, "p1", { valor: 89.9, observacao: null });
    expect(client.__updated).toEqual({ valor: 89.9, observacao: null });
    expect(client.calls).toContainEqual({ method: "eq", args: ["id", "p1"] });
    const tabelas = client.calls
      .filter((c: { method: string }) => c.method === "from")
      .map((c: { args: unknown[] }) => c.args[0]);
    expect(tabelas).toEqual(["catalogo_planos"]);
  });
});

describe("definirPlanoAtivo", () => {
  it("atualiza apenas o campo ativo", async () => {
    const client = makeQueryFake({ error: null });
    await definirPlanoAtivo(client as unknown as SupabaseClient, "p1", false);
    expect(client.__updated).toEqual({ ativo: false });
    expect(client.calls).toContainEqual({ method: "eq", args: ["id", "p1"] });
  });
});

describe("franquia dos planos Pós", () => {
  const rowPos = { ...row, categoria: "pos_nacional", nome: "Pós 40GB", franquia_gb: 40 };

  it("mapeia franquia_gb para franquiaGb", async () => {
    const client = makeQueryFake({ data: [rowPos], error: null });
    const [lido] = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(lido.franquiaGb).toBe(40);
  });

  it("linha sem franquia_gb (ou nula) vira franquiaGb nulo", async () => {
    const { franquia_gb: _removida, ...semFranquia } = row;
    const client = makeQueryFake({ data: [semFranquia], error: null });
    const [lido] = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(lido.franquiaGb).toBeNull();
  });

  it("criarPlano grava franquia_gb quando informada", async () => {
    const client = makeQueryFake({ data: rowPos, error: null });
    const criado = await criarPlano(client as unknown as SupabaseClient, {
      categoria: "pos_nacional",
      nome: "Pós 40GB",
      valor: 54.99,
      franquiaGb: 40,
    });
    expect(client.__inserted.franquia_gb).toBe(40);
    expect(criado.franquiaGb).toBe(40);
  });

  it("criarPlano grava franquia_gb nula quando omitida", async () => {
    const client = makeQueryFake({ data: row, error: null });
    await criarPlano(client as unknown as SupabaseClient, { categoria: "adicional", nome: "X", valor: 5 });
    expect(client.__inserted.franquia_gb).toBeNull();
  });

  it("só as categorias Pós têm franquia", () => {
    expect(categoriaTemFranquia("pos_nacional")).toBe(true);
    expect(categoriaTemFranquia("pos_regional")).toBe(true);
    for (const categoria of ["convergente", "banda_larga", "adicional"] as const) {
      expect(categoriaTemFranquia(categoria)).toBe(false);
    }
  });
});
