// Sugestão de plano por consumo, portada de sugerirPlanoConsumo() do painel
// (REGRAS_NEGOCIO.md seção 23). Limiares em % da franquia contratada, confirmados
// com o usuário: a partir de 90% sugere upgrade, até 40% sugere downgrade; no
// meio, mantém. 1 GB = 1024 MB.
import type { PlanoCatalogo } from "../catalogo";

export const LIMIAR_UPGRADE_PCT = 90;
export const LIMIAR_DOWNGRADE_PCT = 40;
// O plano de downgrade ainda precisa cobrir o consumo com 20% de folga, para não
// sugerir um plano que o cliente estouraria de novo no mês seguinte.
export const MARGEM_DOWNGRADE = 0.8;

export interface PlanoPos {
  id: string;
  nome: string;
  valor: number;
  franquiaGb: number;
}

// Só Pós Nacional ativo com franquia entra na sugestão automática: o regional
// continua disponível como escolha manual do consultor.
export function planosPosNacional(catalogo: PlanoCatalogo[]): PlanoPos[] {
  return catalogo.flatMap((plano) =>
    plano.ativo && plano.categoria === "pos_nacional" && plano.franquiaGb !== null
      ? [{ id: plano.id, nome: plano.nome, valor: plano.valor, franquiaGb: plano.franquiaGb }]
      : []
  );
}

export type AcaoSugestao = "upgrade" | "downgrade" | "manter" | "indefinido";

export interface Sugestao {
  acao: AcaoSugestao;
  pctFranquia: number | null;
  plano: PlanoPos | null;
}

function maisBarato(lista: PlanoPos[]): PlanoPos {
  return [...lista].sort((a, b) => a.valor - b.valor)[0];
}

export function sugerirPlano(
  linha: { planoGb: number | null; consumoMb: number | null },
  planos: PlanoPos[]
): Sugestao {
  const planoAtual = linha.planoGb;
  if (planos.length === 0 || !planoAtual) {
    return { acao: "indefinido", pctFranquia: null, plano: null };
  }

  // Consumo desconhecido (linha digitada) não permite concluir nada: só mantém.
  const consumo = linha.consumoMb ?? 0;
  const pct = linha.consumoMb === null ? null : (consumo / (planoAtual * 1024)) * 100;

  if (pct !== null && pct >= LIMIAR_UPGRADE_PCT) {
    const acima = planos.filter((p) => p.franquiaGb > planoAtual);
    if (acima.length > 0) {
      const cobrem = acima.filter((p) => p.franquiaGb * 1024 >= consumo);
      const candidatos = cobrem.length > 0 ? cobrem : acima; // nem o maior cobre: sugere o maior
      const menor = Math.min(...candidatos.map((p) => p.franquiaGb));
      return {
        acao: "upgrade",
        pctFranquia: pct,
        plano: maisBarato(candidatos.filter((p) => p.franquiaGb === menor)),
      };
    }
  }

  if (pct !== null && pct <= LIMIAR_DOWNGRADE_PCT) {
    const abaixo = planos.filter(
      (p) => p.franquiaGb < planoAtual && p.franquiaGb * 1024 * MARGEM_DOWNGRADE >= consumo
    );
    if (abaixo.length > 0) {
      const maior = Math.max(...abaixo.map((p) => p.franquiaGb));
      return {
        acao: "downgrade",
        pctFranquia: pct,
        plano: maisBarato(abaixo.filter((p) => p.franquiaGb === maior)),
      };
    }
  }

  const igualOuMaior = planos.filter((p) => p.franquiaGb >= planoAtual);
  const alvo =
    igualOuMaior.length > 0
      ? Math.min(...igualOuMaior.map((p) => p.franquiaGb))
      : Math.max(...planos.map((p) => p.franquiaGb));
  return {
    acao: "manter",
    pctFranquia: pct,
    plano: maisBarato(planos.filter((p) => p.franquiaGb === alvo)),
  };
}
