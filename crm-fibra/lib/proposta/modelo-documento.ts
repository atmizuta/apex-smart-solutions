// Camada de dado puro dos documentos (Word, PDF consultor, PDF cliente, PNG): tudo
// que vai no papel é calculado aqui, em Node, sem biblioteca gráfica. Os
// desenhistas só pintam o que este modelo já trouxe pronto, então um erro de
// total ou de arredondamento aparece num teste rápido, não num arquivo aberto à mão.
import { formatarCnpj } from "../formato";
import type { LinhaAtual, SituacaoAtual } from "../fatura/tipos";
import { limparRazaoSocial } from "../ia/abordagem";
import { somarValores, subtotalDaLinha, valorUnitarioDoItem, type NovoItemProposta } from "../propostas";

export interface LinhaTabela {
  descricao: string;
  quantidade: number;
  valorUnitario: number | null; // nulo na linha consolidada
  subtotal: number;
}

export interface LinhaComparada {
  rotulo: string;
  planoAtual: string;
  consumo: string;
  planoProposto: string;
  valorAtual: number;
  valorProposto: number | null;
  diferenca: number | null;
}

export interface Badge {
  label: string;
  desc: string;
  cor: string; // hex sem "#"
}

export type TipoResumo = "economia" | "aumento" | "igual";

export interface ModeloDocumento {
  cliente: { razaoSocial: string; cnpj: string };
  consultor: string;
  emitidoEm: string;
  validoAte: string;
  situacaoAtual: { itens: LinhaTabela[]; total: number; nota: string } | null;
  porLinha: LinhaComparada[] | null;
  novaProposta: { consolidado: boolean; itens: LinhaTabela[]; total: number };
  beneficios: { movel: boolean; badges: Badge[] };
  resumo: { atual: number | null; proposto: number; diferenca: number | null; tipo: TipoResumo | null };
}

export interface EntradaModelo {
  cliente: { razaoSocial: string; cnpjDigits: string };
  consultor: string;
  situacaoAtual: SituacaoAtual | null;
  itens: NovoItemProposta[];
  opcoes: { consolidar: boolean; vendedor: string | null };
  agora: Date;
}

const BENEFICIOS_MOVEL: Badge[] = [
  { label: "Ligações ilimitadas", desc: "Fixo e celular, qualquer operadora do Brasil, usando o 21", cor: "0D0D0D" },
  { label: "WhatsApp ilimitado", desc: "Chamadas de voz, vídeo e mensagens, sem descontar da franquia", cor: "25D366" },
  { label: "Waze ilimitado", desc: "Sem descontar da franquia", cor: "05C3DD" },
];

const BENEFICIO_MONITOR: Badge = {
  label: "Claro Monitor",
  desc: "Localização, bloqueio remoto e proteção do aparelho incluídos",
  cor: "B3101F",
};

const NOTA_FATURA =
  "Valor aproximado, pode conter variações devido a utilização ou encargos financeiros do período";
const NOTA_DIGITADA = "Valores informados pelo consultor.";

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
const FORMATO_GB = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const UM_DIA_MS = 24 * 60 * 60 * 1000;

const centavos = (valor: number) => Math.round(valor * 100) / 100;

// Claro Monitor não vira linha da tabela: o valor soma no total e ele aparece
// como benefício (regra do painel, REGRAS_NEGOCIO.md seção 31.3).
const ehMonitor = (item: NovoItemProposta) => /^claro monitor/i.test(item.descricao.trim());

function agruparSituacao(linhas: LinhaAtual[]): LinhaTabela[] {
  const grupos = new Map<string, { planoGb: number | null; valorUnitario: number; quantidade: number }>();
  for (const linha of linhas) {
    const chave = `${linha.planoGb ?? "sem"}|${Math.round(linha.valorUnitario * 100)}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.quantidade += linha.quantidade;
    else grupos.set(chave, { planoGb: linha.planoGb, valorUnitario: linha.valorUnitario, quantidade: linha.quantidade });
  }
  return [...grupos.values()]
    .sort((a, b) => (b.planoGb ?? 0) - (a.planoGb ?? 0) || b.valorUnitario - a.valorUnitario)
    .map((grupo) => ({
      descricao: grupo.planoGb ? `Plano atual — ${grupo.planoGb}GB` : "Plano atual",
      quantidade: grupo.quantidade,
      valorUnitario: grupo.valorUnitario,
      subtotal: subtotalDaLinha(grupo.valorUnitario, grupo.quantidade),
    }));
}

function consumoEmGb(consumoMb: number | null): string {
  return consumoMb === null ? "-" : `${FORMATO_GB.format(consumoMb / 1024)} GB`;
}

function compararPorLinha(linhas: LinhaAtual[]): LinhaComparada[] | null {
  const daFatura = linhas.filter((linha) => linha.origem === "fatura");
  if (daFatura.length === 0) return null;
  return daFatura.map((linha) => {
    const valorAtual = subtotalDaLinha(linha.valorUnitario, linha.quantidade);
    const valorProposto = linha.proposto ? subtotalDaLinha(linha.proposto.valorUnitario, linha.quantidade) : null;
    return {
      rotulo: linha.rotulo,
      planoAtual: linha.planoGb ? `${linha.planoGb}GB` : "-",
      consumo: consumoEmGb(linha.consumoMb),
      planoProposto: linha.proposto ? linha.proposto.descricao : "sem plano proposto",
      valorAtual,
      valorProposto,
      diferenca: valorProposto === null ? null : centavos(valorProposto - valorAtual),
    };
  });
}

function montarNovaProposta(itens: NovoItemProposta[], consolidar: boolean) {
  const monitores = itens.filter(ehMonitor);
  const demais = itens.filter((item) => !ehMonitor(item));
  const moveis = demais.filter((item) => item.franquiaGb !== null);
  const valorMonitor = somarValores(monitores.map((item) => item.valor));

  const paraLinha = (item: NovoItemProposta): LinhaTabela => ({
    descricao: item.descricao,
    quantidade: item.quantidade,
    valorUnitario: valorUnitarioDoItem(item),
    subtotal: item.valor,
  });

  let linhas: LinhaTabela[];
  const consolidado = consolidar && moveis.length > 0;
  if (consolidado) {
    const porGb = new Map<number, number>();
    for (const item of moveis) {
      const gb = item.franquiaGb as number;
      porGb.set(gb, (porGb.get(gb) ?? 0) + item.quantidade);
    }
    const planos = [...porGb.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([gb, quantidade]) => `${quantidade}× ${gb}GB`)
      .join(", ");
    const quantidade = moveis.reduce((soma, item) => soma + item.quantidade, 0);
    linhas = [
      {
        descricao: `${quantidade} linha(s) — ${planos} — valor total consolidado`,
        quantidade,
        valorUnitario: null,
        subtotal: somarValores(moveis.map((item) => item.valor)),
      },
      ...demais.filter((item) => item.franquiaGb === null).map(paraLinha),
    ];
  } else {
    linhas = demais.map(paraLinha);
  }

  return {
    consolidado,
    itens: linhas,
    total: somarValores([...linhas.map((linha) => linha.subtotal), valorMonitor]),
    movel: moveis.length > 0,
    temMonitor: monitores.length > 0,
  };
}

export function montarModeloDocumento(entrada: EntradaModelo): ModeloDocumento {
  const nova = montarNovaProposta(entrada.itens, entrada.opcoes.consolidar);

  const linhasAtuais = entrada.situacaoAtual?.linhas ?? null;
  const itensAtuais = linhasAtuais ? agruparSituacao(linhasAtuais) : null;
  const totalAtual = itensAtuais ? somarValores(itensAtuais.map((linha) => linha.subtotal)) : null;

  const diferenca = totalAtual === null ? null : centavos(nova.total - totalAtual);
  const tipo: TipoResumo | null =
    diferenca === null ? null : diferenca < 0 ? "economia" : diferenca > 0 ? "aumento" : "igual";

  return {
    cliente: {
      razaoSocial: limparRazaoSocial(entrada.cliente.razaoSocial) || entrada.cliente.razaoSocial,
      cnpj: formatarCnpj(entrada.cliente.cnpjDigits),
    },
    consultor: (entrada.opcoes.vendedor ?? "").trim() || entrada.consultor,
    emitidoEm: FORMATO_DATA.format(entrada.agora),
    validoAte: FORMATO_DATA.format(new Date(entrada.agora.getTime() + UM_DIA_MS)),
    situacaoAtual:
      itensAtuais && totalAtual !== null && linhasAtuais
        ? {
            itens: itensAtuais,
            total: totalAtual,
            nota: linhasAtuais.some((linha) => linha.origem === "fatura") ? NOTA_FATURA : NOTA_DIGITADA,
          }
        : null,
    porLinha: linhasAtuais ? compararPorLinha(linhasAtuais) : null,
    novaProposta: { consolidado: nova.consolidado, itens: nova.itens, total: nova.total },
    beneficios: {
      movel: nova.movel,
      badges: [...(nova.movel ? BENEFICIOS_MOVEL : []), ...(nova.temMonitor ? [BENEFICIO_MONITOR] : [])],
    },
    resumo: { atual: totalAtual, proposto: nova.total, diferenca, tipo },
  };
}
