import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import { planosPosNacional, sugerirPlano, type PlanoPos } from "./sugestao";

const planos: PlanoPos[] = [
  { id: "p12", nome: "Pós 12GB", valor: 39.99, franquiaGb: 12 },
  { id: "p40", nome: "Pós 40GB", valor: 54.99, franquiaGb: 40 },
  { id: "p70", nome: "Pós 70GB", valor: 74.99, franquiaGb: 70 },
  { id: "p100", nome: "Pós 100GB", valor: 89.99, franquiaGb: 100 },
  { id: "p150", nome: "Pós 150GB", valor: 149.99, franquiaGb: 150 },
];

const mb = (gb: number) => gb * 1024;

describe("sugerirPlano — upgrade (consumo a partir de 90% da franquia)", () => {
  it("sugere o menor plano maior que cobre o consumo", () => {
    const s = sugerirPlano({ planoGb: 10, consumoMb: mb(9.5) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p12");
    expect(s.pctFranquia).toBeCloseTo(95, 5);
  });

  it("pula planos que não cobrem o consumo", () => {
    const s = sugerirPlano({ planoGb: 50, consumoMb: mb(50) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p70");
  });

  it("no limite exato de 90% já é upgrade", () => {
    expect(sugerirPlano({ planoGb: 10, consumoMb: 9216 }, planos).acao).toBe("upgrade");
  });

  it("se nem o maior plano cobre o consumo, sugere o maior", () => {
    const s = sugerirPlano({ planoGb: 100, consumoMb: mb(200) }, planos);
    expect(s.acao).toBe("upgrade");
    expect(s.plano?.id).toBe("p150");
  });

  it("no maior plano do catálogo não há para onde subir: mantém", () => {
    const s = sugerirPlano({ planoGb: 150, consumoMb: mb(149) }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p150");
  });

  it("desempata planos da mesma franquia pelo mais barato", () => {
    const duplicados: PlanoPos[] = [
      ...planos,
      { id: "p40b", nome: "Pós 40GB promo", valor: 49.99, franquiaGb: 40 },
    ];
    expect(sugerirPlano({ planoGb: 30, consumoMb: mb(29) }, duplicados).plano?.id).toBe("p40b");
  });
});

describe("sugerirPlano — downgrade (consumo até 40% da franquia)", () => {
  it("sugere o maior plano menor cuja franquia, com folga de 20%, ainda cobre o consumo", () => {
    const s = sugerirPlano({ planoGb: 70, consumoMb: 3000 }, planos);
    expect(s.acao).toBe("downgrade");
    expect(s.plano?.id).toBe("p40");
  });

  it("no limite exato de 40% já é downgrade", () => {
    const s = sugerirPlano({ planoGb: 100, consumoMb: 40960 }, planos);
    expect(s.acao).toBe("downgrade");
    expect(s.plano?.id).toBe("p70");
  });

  it("respeita a margem: se o plano menor ficaria apertado, mantém", () => {
    expect(sugerirPlano({ planoGb: 40, consumoMb: 9000 }, planos)).toMatchObject({ acao: "downgrade" });
    expect(sugerirPlano({ planoGb: 40, consumoMb: 10000 }, planos)).toMatchObject({ acao: "manter" });
  });

  it("no menor plano do catálogo não há para onde descer: mantém", () => {
    const s = sugerirPlano({ planoGb: 12, consumoMb: 1000 }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p12");
  });

  it("consumo zero (não usou internet) conta como 0% e permite downgrade", () => {
    expect(sugerirPlano({ planoGb: 70, consumoMb: 0 }, planos).acao).toBe("downgrade");
  });
});

describe("sugerirPlano — manter e indefinido", () => {
  it("entre 40% e 90% mantém, no plano de franquia igual ou maior mais próximo", () => {
    const s = sugerirPlano({ planoGb: 20, consumoMb: mb(10) }, planos);
    expect(s.acao).toBe("manter");
    expect(s.plano?.id).toBe("p40");
  });

  it("consumo desconhecido (linha digitada) nunca vira upgrade nem downgrade", () => {
    const s = sugerirPlano({ planoGb: 70, consumoMb: null }, planos);
    expect(s).toMatchObject({ acao: "manter", pctFranquia: null });
    expect(s.plano?.id).toBe("p70");
  });

  it("sem plano atual reconhecido é indefinido, sem plano sugerido", () => {
    expect(sugerirPlano({ planoGb: null, consumoMb: 1000 }, planos)).toEqual({
      acao: "indefinido",
      pctFranquia: null,
      plano: null,
    });
  });

  it("sem planos no catálogo é indefinido", () => {
    expect(sugerirPlano({ planoGb: 10, consumoMb: 1000 }, [])).toMatchObject({ acao: "indefinido", plano: null });
  });
});

describe("planosPosNacional", () => {
  const base: PlanoCatalogo = {
    id: "x",
    categoria: "pos_nacional",
    nome: "Pós 40GB",
    valor: 54.99,
    observacao: "por linha",
    ativo: true,
    franquiaGb: 40,
  };

  it("fica só com planos ativos, Pós Nacional e com franquia", () => {
    const catalogo: PlanoCatalogo[] = [
      base,
      { ...base, id: "inativo", ativo: false },
      { ...base, id: "regional", categoria: "pos_regional" },
      { ...base, id: "semfranquia", franquiaGb: null },
      { ...base, id: "banda", categoria: "banda_larga", franquiaGb: null },
    ];
    expect(planosPosNacional(catalogo)).toEqual([{ id: "x", nome: "Pós 40GB", valor: 54.99, franquiaGb: 40 }]);
  });
});
