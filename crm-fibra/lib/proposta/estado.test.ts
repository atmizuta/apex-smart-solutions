import { describe, it, expect } from "vitest";
import type { PlanoCatalogo } from "../catalogo";
import type { LinhaMesclada } from "../fatura/mesclar";
import { LIMITE_LINHAS } from "../fatura/tipos";
import type { LinhaEditavel } from "./agrupar";
import {
  adicionarLinhaDigitada,
  atualizarLinha,
  linhaDigitada,
  linhasDaFatura,
  refazerSugestoes,
  removerLinhaEditavel,
  substituirLinhasDaFatura,
  sugestaoDaLinha,
  validarSituacaoDaTela,
} from "./estado";

function plano(id: string, categoria: PlanoCatalogo["categoria"], nome: string, valor: number, franquiaGb: number | null): PlanoCatalogo {
  return { id, categoria, nome, valor, observacao: "por linha", ativo: true, franquiaGb };
}

const catalogo: PlanoCatalogo[] = [
  plano("p12", "pos_nacional", "Pós 12GB", 39.99, 12),
  plano("p40", "pos_nacional", "Pós 40GB", 54.99, 40),
  plano("p70", "pos_nacional", "Pós 70GB", 74.99, 70),
  plano("reg30", "pos_regional", "Pós 30GB regional", 44.99, 30),
];

function mesclada(parcial: Partial<LinhaMesclada> = {}): LinhaMesclada {
  return {
    ddd: "17",
    numero: "900000001",
    planoGb: 10,
    planoGbDistintos: [10],
    valorMensal: 48.49,
    valorMensalMin: 48.49,
    valorMensalMax: 48.49,
    consumoMb: 1000,
    consumoMbMin: 1000,
    consumoMbMax: 1000,
    temMonitor: false,
    faturasEncontradas: 1,
    totalFaturas: 1,
    ...parcial,
  };
}

function geradorDeChaves() {
  let n = 0;
  return () => `k${++n}`;
}

function linha(parcial: Partial<LinhaEditavel> & { chave: string }): LinhaEditavel {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 1000,
    origem: "fatura",
    planoId: null,
    avisos: [],
    ...parcial,
  };
}

describe("linhasDaFatura", () => {
  const linhas = linhasDaFatura(
    [
      mesclada({ consumoMb: 9728 }), // 10GB a 95% da franquia: upgrade para o Pós 12GB
      mesclada({ numero: "900000002", planoGb: 20, consumoMb: 2048, valorMensal: 58.99 }), // 20GB a 10%: downgrade para o 12GB
      mesclada({ numero: "900000003", planoGb: 20, consumoMb: 12288, valorMensal: null }), // 20GB a 60%: mantém, no 40GB
    ],
    catalogo,
    geradorDeChaves()
  );

  it("gera uma linha editável por linha da fatura, com chave própria e o plano sugerido já escolhido", () => {
    expect(linhas.map((l) => l.chave)).toEqual(["k1", "k2", "k3"]);
    expect(linhas.map((l) => l.planoId)).toEqual(["p12", "p12", "p40"]);
  });

  it("o rótulo vem mascarado e a origem é fatura", () => {
    expect(linhas[0]).toMatchObject({ rotulo: "(17) ••••• 0001", origem: "fatura", quantidade: 1, valorUnitario: 48.49 });
    expect(JSON.stringify(linhas)).not.toContain("900000001");
  });

  it("mensalidade não encontrada vira 0 com aviso para o consultor preencher", () => {
    expect(linhas[2].valorUnitario).toBe(0);
    expect(linhas[2].avisos).toContain("Mensalidade não encontrada na fatura: preencha o valor.");
  });

  it("a sugestão só usa o Pós Nacional (o regional fica para escolha manual)", () => {
    const [l] = linhasDaFatura([mesclada({ planoGb: 25, consumoMb: 12000 })], catalogo, geradorDeChaves());
    expect(l.planoId).not.toBe("reg30");
  });
});

describe("linhaDigitada / adicionarLinhaDigitada", () => {
  it("nasce como uma linha digitada pendente de valor", () => {
    expect(linhaDigitada("k9")).toEqual({
      chave: "k9",
      rotulo: "Linhas",
      quantidade: 1,
      planoGb: null,
      valorUnitario: 0,
      consumoMb: null,
      origem: "digitada",
      planoId: null,
      avisos: [],
    });
  });

  it("acrescenta no fim, sem mexer na lista original", () => {
    const original = [linha({ chave: "a" })];
    const nova = adicionarLinhaDigitada(original, "b");
    expect(original).toHaveLength(1);
    expect(nova.map((l) => l.chave)).toEqual(["a", "b"]);
  });

  it("não passa do limite de linhas", () => {
    const cheia = Array.from({ length: LIMITE_LINHAS }, (_, i) => linha({ chave: `k${i}` }));
    expect(adicionarLinhaDigitada(cheia, "extra")).toBe(cheia);
  });
});

describe("substituirLinhasDaFatura", () => {
  it("troca as linhas lidas de fatura e mantém as digitadas, que ficam no fim", () => {
    const atuais = [linha({ chave: "velha" }), linha({ chave: "digitada", origem: "digitada" })];
    const novas = [linha({ chave: "n1" }), linha({ chave: "n2" })];
    expect(substituirLinhasDaFatura(atuais, novas).map((l) => l.chave)).toEqual(["n1", "n2", "digitada"]);
  });
});

describe("atualizarLinha", () => {
  it("muda só a linha da chave pedida", () => {
    const linhas = [linha({ chave: "a" }), linha({ chave: "b" })];
    const resultado = atualizarLinha(linhas, "b", { quantidade: 5 }, catalogo);
    expect(resultado.map((l) => l.quantidade)).toEqual([1, 5]);
  });

  it("linha sem plano proposto ganha a sugestão quando o plano atual ou o consumo mudam", () => {
    const linhas = [linha({ chave: "a", origem: "digitada", planoGb: null, consumoMb: null, planoId: null })];
    const resultado = atualizarLinha(linhas, "a", { planoGb: 10 }, catalogo);
    expect(resultado[0].planoId).toBe("p12");
  });

  it("não troca uma escolha que o consultor já fez", () => {
    const linhas = [linha({ chave: "a", planoGb: 10, planoId: "p70" })];
    expect(atualizarLinha(linhas, "a", { planoGb: 12 }, catalogo)[0].planoId).toBe("p70");
  });

  it("respeita o planoId explícito, mesmo junto da mudança de plano atual", () => {
    const linhas = [linha({ chave: "a", planoGb: null, planoId: null })];
    expect(atualizarLinha(linhas, "a", { planoGb: 10, planoId: null }, catalogo)[0].planoId).toBeNull();
  });

  it("trocar só a quantidade ou o valor não refaz a sugestão", () => {
    const linhas = [linha({ chave: "a", planoId: null })];
    expect(atualizarLinha(linhas, "a", { valorUnitario: 60 }, catalogo)[0].planoId).toBeNull();
  });
});

describe("removerLinhaEditavel / refazerSugestoes / sugestaoDaLinha", () => {
  it("remove só a linha da chave pedida", () => {
    expect(removerLinhaEditavel([linha({ chave: "a" }), linha({ chave: "b" })], "a").map((l) => l.chave)).toEqual(["b"]);
  });

  it("refazer sugestões sobrescreve as escolhas com o plano sugerido", () => {
    const linhas = [linha({ chave: "a", planoGb: 10, consumoMb: 9728, planoId: "p70" })];
    expect(refazerSugestoes(linhas, catalogo)[0].planoId).toBe("p12");
  });

  it("devolve a sugestão da linha (upgrade a partir de 90% da franquia)", () => {
    const s = sugestaoDaLinha(linha({ chave: "a", planoGb: 10, consumoMb: 9728 }), catalogo);
    expect(s).toMatchObject({ acao: "upgrade", plano: { id: "p12" } });
  });
});

describe("validarSituacaoDaTela", () => {
  it("sem nenhuma linha não há situação atual (proposta sem fatura)", () => {
    expect(validarSituacaoDaTela([], 0, catalogo)).toEqual({ ok: true, situacao: null });
  });

  it("linhas completas viram a situação atual com o plano proposto gravado", () => {
    const linhas = [linha({ chave: "a", planoId: "p12" })];
    const resultado = validarSituacaoDaTela(linhas, 2, catalogo);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.situacao?.faturasAnalisadas).toBe(2);
      expect(resultado.situacao?.linhas[0].proposto).toEqual({ descricao: "Pós 12GB — por linha", valorUnitario: 39.99 });
    }
  });

  it("linha sem mensalidade bloqueia, com a mesma mensagem que o servidor daria", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", valorUnitario: 0 })], 1, catalogo);
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/mensalidade/) });
  });

  it("só linhas digitadas contam como zero faturas analisadas, mesmo que o estado diga outra coisa", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", origem: "digitada" })], 3, catalogo);
    expect(resultado.ok && resultado.situacao?.faturasAnalisadas).toBe(0);
  });

  it("recusa mais linhas que o limite", () => {
    const linhas = Array.from({ length: LIMITE_LINHAS + 1 }, (_, i) => linha({ chave: `k${i}` }));
    expect(validarSituacaoDaTela(linhas, 1, catalogo)).toMatchObject({ ok: false, erro: expect.stringContaining(String(LIMITE_LINHAS)) });
  });

  it("recusa telefone completo digitado no nome da linha", () => {
    const resultado = validarSituacaoDaTela([linha({ chave: "a", rotulo: "(17) 90000-0001" })], 0, catalogo);
    expect(resultado).toMatchObject({ ok: false, erro: expect.stringMatching(/número completo/) });
  });
});
