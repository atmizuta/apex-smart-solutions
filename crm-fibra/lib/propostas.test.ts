import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  somarValores,
  validarItensProposta,
  criarProposta,
  listarPropostasPorCnpj,
  LIMITE_DESCRICAO,
  type NovoItemProposta,
} from "./propostas";

type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filtros: Array<[string, unknown]>;
  ordens: unknown[][];
};

// Registra cada operação por tabela; o `responder` do teste decide o que o
// "banco" devolve. É "await-ável" em qualquer ponto da cadeia, como o real.
function makeClientFake(responder: (op: Operacao) => { data?: unknown; error?: unknown }) {
  const operacoes: Operacao[] = [];
  const client: any = {
    operacoes,
    schema: () => client,
    from: (tabela: string) => {
      const op: Operacao = { tabela, tipo: "select", filtros: [], ordens: [] };
      operacoes.push(op);
      const q: any = {
        select: () => q,
        insert: (payload: unknown) => {
          op.tipo = "insert";
          op.payload = payload;
          return q;
        },
        update: (payload: unknown) => {
          op.tipo = "update";
          op.payload = payload;
          return q;
        },
        delete: () => {
          op.tipo = "delete";
          return q;
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push([coluna, valor]);
          return q;
        },
        in: (coluna: string, valores: unknown) => {
          op.filtros.push([coluna, valores]);
          return q;
        },
        order: (...args: unknown[]) => {
          op.ordens.push(args);
          return q;
        },
        single: () => Promise.resolve(responder(op)),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(responder(op)).then(resolve, reject),
      };
      return q;
    },
  };
  return client;
}

const propostaRow = {
  id: "prop1",
  cnpj_digits: "00005087000190",
  consultor_id: "c1",
  criado_em: "2026-10-08T17:32:00Z",
};

const itensEntrada: NovoItemProposta[] = [
  { catalogoPlanoId: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9 },
  { catalogoPlanoId: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9 },
  { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 5 },
];

function bancoQueAceitaTudo() {
  return makeClientFake((op) => {
    if (op.tabela === "propostas" && op.tipo === "insert") return { data: propostaRow, error: null };
    if (op.tabela === "proposta_itens" && op.tipo === "insert") {
      const linhas = op.payload as Record<string, unknown>[];
      return { data: linhas.map((linha, i) => ({ id: `i${i}`, ...linha })), error: null };
    }
    return { data: null, error: null };
  });
}

describe("somarValores", () => {
  it("soma em centavos, sem erro de ponto flutuante", () => {
    expect(somarValores([59.9, 79.9, 5])).toBe(144.8);
    expect(somarValores([0.1, 0.2])).toBe(0.3);
  });

  it("devolve 0 para lista vazia", () => {
    expect(somarValores([])).toBe(0);
  });
});

describe("validarItensProposta", () => {
  const ok: NovoItemProposta = { catalogoPlanoId: null, descricao: "Oferta", valor: 10 };

  it("aceita uma lista válida", () => {
    expect(validarItensProposta([ok])).toBeNull();
  });

  it("recusa proposta sem nenhuma linha", () => {
    expect(validarItensProposta([])).toMatch(/pelo menos uma linha/);
  });

  it("recusa descrição em branco", () => {
    expect(validarItensProposta([{ ...ok, descricao: "   " }])).toMatch(/descrição/);
  });

  it("recusa descrição acima do limite", () => {
    expect(validarItensProposta([{ ...ok, descricao: "x".repeat(LIMITE_DESCRICAO + 1) }])).toMatch(
      new RegExp(String(LIMITE_DESCRICAO))
    );
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("recusa valor %s", (valor) => {
    expect(validarItensProposta([{ ...ok, valor }])).toMatch(/maior que zero/);
  });
});

describe("criarProposta", () => {
  it("grava o cabeçalho e depois os itens, com ordem sequencial e a própria cópia de descrição/valor", async () => {
    const client = bancoQueAceitaTudo();
    const proposta = await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
    });

    const [cabecalho, itens] = client.operacoes;
    expect(cabecalho).toMatchObject({
      tabela: "propostas",
      tipo: "insert",
      payload: { cnpj_digits: "00005087000190", consultor_id: "c1" },
    });
    expect(itens.payload).toEqual([
      { proposta_id: "prop1", catalogo_plano_id: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9, ordem: 0 },
      { proposta_id: "prop1", catalogo_plano_id: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9, ordem: 1 },
      { proposta_id: "prop1", catalogo_plano_id: "p9", descricao: "Claro Monitor", valor: 5, ordem: 2 },
    ]);
    expect(proposta.id).toBe("prop1");
    expect(proposta.total).toBe(144.8);
    expect(proposta.itens.map((i) => i.ordem)).toEqual([0, 1, 2]);
  });

  it("só insere — nunca atualiza propostas existentes (dois consultores não se sobrescrevem)", async () => {
    const client = bancoQueAceitaTudo();
    await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c2",
      itens: itensEntrada,
    });
    const tiposEmPropostas = client.operacoes
      .filter((op: Operacao) => op.tabela === "propostas")
      .map((op: Operacao) => op.tipo);
    expect(tiposEmPropostas).toEqual(["insert"]);
    expect(client.operacoes.some((op: Operacao) => op.tipo === "update")).toBe(false);
  });

  it("não lê o catálogo e grava a própria cópia (preço editado depois não muda proposta antiga)", async () => {
    const client = bancoQueAceitaTudo();
    await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
    });
    expect(client.operacoes.some((op: Operacao) => op.tabela === "catalogo_planos")).toBe(false);
  });

  it("se gravar os itens falhar, apaga o cabeçalho recém-criado e propaga o erro", async () => {
    const client = makeClientFake((op) => {
      if (op.tabela === "propostas" && op.tipo === "insert") return { data: propostaRow, error: null };
      if (op.tabela === "proposta_itens") return { data: null, error: { message: "boom" } };
      return { data: null, error: null };
    });

    await expect(
      criarProposta(client as unknown as SupabaseClient, {
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        itens: itensEntrada,
      })
    ).rejects.toMatchObject({ message: "boom" });

    expect(client.operacoes).toContainEqual(
      expect.objectContaining({ tabela: "propostas", tipo: "delete", filtros: [["id", "prop1"]] })
    );
  });

  it("propaga o erro do cabeçalho sem tentar gravar itens", async () => {
    const client = makeClientFake(() => ({ data: null, error: { message: "sem cabeçalho" } }));
    await expect(
      criarProposta(client as unknown as SupabaseClient, {
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        itens: itensEntrada,
      })
    ).rejects.toMatchObject({ message: "sem cabeçalho" });
    expect(client.operacoes).toHaveLength(1);
  });
});

describe("listarPropostasPorCnpj", () => {
  it("retorna lista vazia sem consultar itens quando o CNPJ não tem proposta", async () => {
    const client = makeClientFake(() => ({ data: [], error: null }));
    const resultado = await listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(resultado).toEqual([]);
    expect(client.operacoes.map((op: Operacao) => op.tabela)).toEqual(["propostas"]);
  });

  it("devolve a mais recente primeiro, com itens em ordem e total calculado", async () => {
    const nova = { id: "nova", cnpj_digits: "00005087000190", consultor_id: "c1", criado_em: "2026-10-08T17:32:00Z" };
    const antiga = { id: "antiga", cnpj_digits: "00005087000190", consultor_id: "c2", criado_em: "2026-10-01T12:00:00Z" };
    const client = makeClientFake((op) => {
      if (op.tabela === "propostas") return { data: [nova, antiga], error: null };
      return {
        data: [
          { id: "i2", proposta_id: "nova", catalogo_plano_id: null, descricao: "B", valor: 59.9, ordem: 1 },
          { id: "i1", proposta_id: "nova", catalogo_plano_id: "p1", descricao: "A", valor: 79.9, ordem: 0 },
          { id: "i3", proposta_id: "antiga", catalogo_plano_id: null, descricao: "C", valor: 10, ordem: 0 },
        ],
        error: null,
      };
    });

    const resultado = await listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190");

    expect(resultado.map((p) => p.id)).toEqual(["nova", "antiga"]);
    expect(resultado[0].itens.map((i) => i.descricao)).toEqual(["A", "B"]);
    expect(resultado[0].total).toBe(139.8);
    expect(resultado[1].total).toBe(10);
    expect(client.operacoes[0].filtros).toContainEqual(["cnpj_digits", "00005087000190"]);
    expect(client.operacoes[0].ordens).toContainEqual(["criado_em", { ascending: false }]);
    expect(client.operacoes[1].filtros).toContainEqual(["proposta_id", ["nova", "antiga"]]);
  });

  it("propaga erro do banco", async () => {
    const client = makeClientFake(() => ({ data: null, error: { message: "boom" } }));
    await expect(
      listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190")
    ).rejects.toMatchObject({ message: "boom" });
  });
});
