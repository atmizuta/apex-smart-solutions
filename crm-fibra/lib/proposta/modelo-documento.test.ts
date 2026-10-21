import { describe, it, expect } from "vitest";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { somarValores, subtotalDaLinha, type NovoItemProposta } from "../propostas";
import { montarModeloDocumento, type EntradaModelo } from "./modelo-documento";

const agora = new Date("2026-10-19T15:00:00Z"); // 12h em Brasília
const cliente = { razaoSocial: "EMPRESA EXEMPLO LTDA", cnpjDigits: "11222333000181" };

function fatura(parcial: Partial<LinhaAtual> = {}): LinhaAtual {
  return {
    rotulo: "(17) ••••• 0001",
    quantidade: 1,
    planoGb: 10,
    valorUnitario: 48.49,
    consumoMb: 5120.5,
    origem: "fatura",
    proposto: null,
    ...parcial,
  };
}

function pos(descricao: string, gb: number, valorUnitario: number, quantidade: number): NovoItemProposta {
  return {
    catalogoPlanoId: `p${gb}`,
    descricao,
    valor: subtotalDaLinha(valorUnitario, quantidade),
    quantidade,
    franquiaGb: gb,
  };
}

const fibra: NovoItemProposta = {
  catalogoPlanoId: "f1",
  descricao: "800 Mega (todos os grupos)",
  valor: 109.9,
  quantidade: 1,
  franquiaGb: null,
};

const monitor = (quantidade = 1): NovoItemProposta => ({
  catalogoPlanoId: "m1",
  descricao: "Claro Monitor",
  valor: subtotalDaLinha(5, quantidade),
  quantidade,
  franquiaGb: null,
});

function entrada(parcial: Partial<EntradaModelo> = {}): EntradaModelo {
  return {
    cliente,
    consultor: "Ana Teste",
    situacaoAtual: null,
    itens: [pos("Pós 12GB — por linha", 12, 39.99, 2)],
    opcoes: { consolidar: false, vendedor: null },
    agora,
    ...parcial,
  };
}

const situacao: SituacaoAtual = {
  faturasAnalisadas: 1,
  linhas: [
    fatura({ rotulo: "(17) ••••• 0001" }),
    fatura({ rotulo: "(17) ••••• 0002" }),
    fatura({ rotulo: "(17) ••••• 0003", planoGb: 20, valorUnitario: 58.99 }),
  ],
};

describe("montarModeloDocumento — cabeçalho", () => {
  it("formata o CNPJ, as datas e usa o consultor informado", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.cliente).toEqual({ razaoSocial: "EMPRESA EXEMPLO LTDA", cnpj: "11.222.333/0001-81" });
    expect(m.consultor).toBe("Ana Teste");
    expect(m.emitidoEm).toBe("19/10/2026");
    expect(m.validoAte).toBe("20/10/2026");
  });

  it("usa a data de Brasília, não a de UTC (22h30 em Brasília ainda é o mesmo dia)", () => {
    const m = montarModeloDocumento(entrada({ agora: new Date("2026-10-20T01:30:00Z") }));
    expect(m.emitidoEm).toBe("19/10/2026");
    expect(m.validoAte).toBe("20/10/2026");
  });

  it("a validade é emissão + 1 dia, inclusive na virada do mês", () => {
    const m = montarModeloDocumento(entrada({ agora: new Date("2026-10-31T15:00:00Z") }));
    expect(m.validoAte).toBe("01/11/2026");
  });

  it("o vendedor editado vale no lugar do consultor logado; em branco volta ao logado", () => {
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: "Maria Vendedora" } })).consultor).toBe(
      "Maria Vendedora"
    );
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: "   " } })).consultor).toBe("Ana Teste");
    expect(montarModeloDocumento(entrada({ opcoes: { consolidar: false, vendedor: null } })).consultor).toBe("Ana Teste");
  });

  it("tira CPF/raiz de CNPJ do nome (MEI), mas mantém número curto que faz parte do nome", () => {
    const mei = montarModeloDocumento(entrada({ cliente: { razaoSocial: "FULANO DE TAL 123.456.789-00", cnpjDigits: "11222333000181" } }));
    expect(mei.cliente.razaoSocial).toBe("FULANO DE TAL");
    const curto = montarModeloDocumento(entrada({ cliente: { razaoSocial: "LOJA 24 HORAS LTDA", cnpjDigits: "11222333000181" } }));
    expect(curto.cliente.razaoSocial).toBe("LOJA 24 HORAS LTDA");
  });

  it("razão social longa passa inteira (quem desenha quebra a linha)", () => {
    const longa = "EMPRESA EXEMPLO DE COMERCIO E SERVICOS DE TELECOMUNICACOES E TECNOLOGIA DA INFORMACAO LTDA";
    expect(montarModeloDocumento(entrada({ cliente: { razaoSocial: longa, cnpjDigits: "11222333000181" } })).cliente.razaoSocial).toBe(longa);
  });
});

describe("montarModeloDocumento — situação atual", () => {
  it("sem situação atual: não há seção, nem comparativo por linha, nem resumo de diferença", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.situacaoAtual).toBeNull();
    expect(m.porLinha).toBeNull();
    expect(m.resumo).toMatchObject({ atual: null, diferenca: null, tipo: null });
  });

  it("agrupa por plano e valor, da maior franquia para a menor, com total", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.situacaoAtual?.itens).toEqual([
      { descricao: "Plano atual — 20GB", quantidade: 1, valorUnitario: 58.99, subtotal: 58.99 },
      { descricao: "Plano atual — 10GB", quantidade: 2, valorUnitario: 48.49, subtotal: 96.98 },
    ]);
    expect(m.situacaoAtual?.total).toBe(155.97);
    expect(m.resumo.atual).toBe(155.97);
  });

  it("linha digitada com quantidade N conta N, e a nota diz que o valor veio do consultor", () => {
    const digitada: SituacaoAtual = {
      faturasAnalisadas: 0,
      linhas: [{ rotulo: "Linhas do escritório", quantidade: 5, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null }],
    };
    const m = montarModeloDocumento(entrada({ situacaoAtual: digitada }));
    expect(m.situacaoAtual?.itens).toEqual([
      { descricao: "Plano atual — 10GB", quantidade: 5, valorUnitario: 50, subtotal: 250 },
    ]);
    expect(m.situacaoAtual?.nota).toBe("Valores informados pelo consultor.");
  });

  it("quando há linha de fatura, a nota fala em valor aproximado", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.situacaoAtual?.nota).toMatch(/aproximado/);
  });

  it("linha sem franquia conhecida vira 'Plano atual' sem GB", () => {
    const semGb: SituacaoAtual = { faturasAnalisadas: 1, linhas: [fatura({ planoGb: null })] };
    expect(montarModeloDocumento(entrada({ situacaoAtual: semGb })).situacaoAtual?.itens[0].descricao).toBe("Plano atual");
  });
});

describe("montarModeloDocumento — comparativo por linha", () => {
  it("só entram as linhas da fatura, com o plano proposto gravado em cada uma", () => {
    const comProposto: SituacaoAtual = {
      faturasAnalisadas: 1,
      linhas: [
        fatura({ consumoMb: 9728, proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 } }),
        fatura({ rotulo: "(17) ••••• 0002", proposto: null }),
        { rotulo: "Linhas extras", quantidade: 3, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null },
      ],
    };
    const m = montarModeloDocumento(entrada({ situacaoAtual: comProposto }));
    expect(m.porLinha).toEqual([
      {
        rotulo: "(17) ••••• 0001",
        planoAtual: "10GB",
        consumo: "9,5 GB",
        planoProposto: "Pós 12GB — por linha",
        valorAtual: 48.49,
        valorProposto: 39.99,
        diferenca: -8.5,
      },
      {
        rotulo: "(17) ••••• 0002",
        planoAtual: "10GB",
        consumo: "5,0 GB",
        planoProposto: "sem plano proposto",
        valorAtual: 48.49,
        valorProposto: null,
        diferenca: null,
      },
    ]);
  });

  it("sem nenhuma linha de fatura (só digitadas) não há comparativo por linha", () => {
    const digitada: SituacaoAtual = {
      faturasAnalisadas: 0,
      linhas: [{ rotulo: "Linhas", quantidade: 2, planoGb: 10, valorUnitario: 50, consumoMb: null, origem: "digitada", proposto: null }],
    };
    expect(montarModeloDocumento(entrada({ situacaoAtual: digitada })).porLinha).toBeNull();
  });

  it("consumo desconhecido e plano desconhecido viram traço", () => {
    const desconhecido: SituacaoAtual = {
      faturasAnalisadas: 1,
      linhas: [fatura({ planoGb: null, consumoMb: null })],
    };
    const [linha] = montarModeloDocumento(entrada({ situacaoAtual: desconhecido })).porLinha ?? [];
    expect(linha).toMatchObject({ planoAtual: "-", consumo: "-" });
  });
});

describe("montarModeloDocumento — nova proposta", () => {
  it("itemizada: descrição, quantidade, valor unitário e subtotal de cada item", () => {
    const m = montarModeloDocumento(entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 7), fibra] }));
    expect(m.novaProposta.consolidado).toBe(false);
    expect(m.novaProposta.itens).toEqual([
      { descricao: "Pós 12GB — por linha", quantidade: 7, valorUnitario: 39.99, subtotal: 279.93 },
      { descricao: "800 Mega (todos os grupos)", quantidade: 1, valorUnitario: 109.9, subtotal: 109.9 },
    ]);
    expect(m.novaProposta.total).toBe(389.83);
  });

  it("consolidar junta só os Pós numa linha, com as franquias da maior para a menor", () => {
    const m = montarModeloDocumento(
      entrada({
        itens: [pos("Pós 12GB — por linha", 12, 39.99, 4), pos("Pós 40GB — por linha", 40, 54.99, 2), fibra],
        opcoes: { consolidar: true, vendedor: null },
      })
    );
    expect(m.novaProposta.consolidado).toBe(true);
    expect(m.novaProposta.itens).toEqual([
      { descricao: "6 linha(s) — 2× 40GB, 4× 12GB — valor total consolidado", quantidade: 6, valorUnitario: null, subtotal: 269.94 },
      { descricao: "800 Mega (todos os grupos)", quantidade: 1, valorUnitario: 109.9, subtotal: 109.9 },
    ]);
    expect(m.novaProposta.total).toBe(379.84);
  });

  it("consolidar soma itens de mesma franquia numa entrada só (3× 12GB + 4× 12GB = 7× 12GB)", () => {
    const m = montarModeloDocumento(
      entrada({
        itens: [pos("Pós 12GB — por linha", 12, 39.99, 3), pos("Pós 12GB — por linha", 12, 39.99, 4)],
        opcoes: { consolidar: true, vendedor: null },
      })
    );
    expect(m.novaProposta.itens).toHaveLength(1);
    expect(m.novaProposta.itens[0].descricao).toBe("7 linha(s) — 7× 12GB — valor total consolidado");
  });

  it("consolidar sem nenhum Pós não muda nada e não marca como consolidado", () => {
    const m = montarModeloDocumento(entrada({ itens: [fibra], opcoes: { consolidar: true, vendedor: null } }));
    expect(m.novaProposta.consolidado).toBe(false);
    expect(m.novaProposta.itens).toHaveLength(1);
  });
});

describe("montarModeloDocumento — Claro Monitor e totais", () => {
  const combinacoes = [
    { consolidar: false, comMonitor: false },
    { consolidar: false, comMonitor: true },
    { consolidar: true, comMonitor: false },
    { consolidar: true, comMonitor: true },
  ];

  it.each(combinacoes)(
    "invariante: itens visíveis + Monitor = total = soma dos itens salvos (consolidar=$consolidar, monitor=$comMonitor)",
    ({ consolidar, comMonitor }) => {
      const itens = [
        pos("Pós 12GB — por linha", 12, 39.99, 4),
        pos("Pós 40GB — por linha", 40, 54.99, 2),
        fibra,
        ...(comMonitor ? [monitor(6)] : []),
      ];
      const m = montarModeloDocumento(entrada({ itens, opcoes: { consolidar, vendedor: null } }));
      const visiveis = somarValores(m.novaProposta.itens.map((l) => l.subtotal));
      const valorMonitor = comMonitor ? 30 : 0;
      expect(somarValores([visiveis, valorMonitor])).toBe(m.novaProposta.total);
      expect(m.novaProposta.total).toBe(somarValores(itens.map((i) => i.valor)));
      expect(m.resumo.proposto).toBe(m.novaProposta.total);
    }
  );

  it("o Claro Monitor nunca vira linha da tabela (qualquer variação do nome)", () => {
    const m = montarModeloDocumento(
      entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 2), { ...monitor(2), descricao: "claro monitor lite" }] })
    );
    expect(m.novaProposta.itens.map((l) => l.descricao)).toEqual(["Pós 12GB — por linha"]);
    expect(m.novaProposta.total).toBe(89.98);
  });
});

describe("montarModeloDocumento — benefícios", () => {
  it("com linha móvel traz ligações, WhatsApp e Waze ilimitados", () => {
    const m = montarModeloDocumento(entrada());
    expect(m.beneficios.movel).toBe(true);
    expect(m.beneficios.badges.map((b) => b.label)).toEqual(["Ligações ilimitadas", "WhatsApp ilimitado", "Waze ilimitado"]);
  });

  it("o Claro Monitor entra por último na lista de benefícios", () => {
    const m = montarModeloDocumento(entrada({ itens: [pos("Pós 12GB — por linha", 12, 39.99, 2), monitor(2)] }));
    expect(m.beneficios.badges.map((b) => b.label).at(-1)).toBe("Claro Monitor");
  });

  it("sem item de Pós não há os benefícios de linha móvel", () => {
    expect(montarModeloDocumento(entrada({ itens: [fibra] })).beneficios).toEqual({ movel: false, badges: [] });
  });

  it("só Claro Monitor (sem Pós) mostra apenas o benefício do Monitor", () => {
    const m = montarModeloDocumento(entrada({ itens: [monitor(1)] }));
    expect(m.beneficios.badges.map((b) => b.label)).toEqual(["Claro Monitor"]);
  });
});

describe("montarModeloDocumento — resumo", () => {
  const unica = (valorUnitario: number): SituacaoAtual => ({ faturasAnalisadas: 1, linhas: [fatura({ valorUnitario })] });

  it("economia: proposto menor que o atual", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: situacao }));
    expect(m.resumo).toEqual({ atual: 155.97, proposto: 79.98, diferenca: -75.99, tipo: "economia" });
  });

  it("aumento: proposto maior que o atual", () => {
    const m = montarModeloDocumento(
      entrada({ situacaoAtual: situacao, itens: [fibra, pos("Pós 12GB — por linha", 12, 39.99, 3)] })
    );
    expect(m.resumo).toEqual({ atual: 155.97, proposto: 229.87, diferenca: 73.9, tipo: "aumento" });
  });

  it("igual: mesma mensalidade", () => {
    const m = montarModeloDocumento(entrada({ situacaoAtual: unica(79.98) }));
    expect(m.resumo).toEqual({ atual: 79.98, proposto: 79.98, diferenca: 0, tipo: "igual" });
  });
});
