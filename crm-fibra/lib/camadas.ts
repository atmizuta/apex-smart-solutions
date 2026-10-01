import type { ContagemCamadas, LeadSegmentado } from "./leads";

export type CamadaRenovacao = NonNullable<LeadSegmentado["camadaRenovacao"]>;

const ROTULOS: Record<CamadaRenovacao, string> = {
  apto_agora: "Apto agora",
  apto_1_mes: "Apto em 1 mês",
  apto_2_meses: "Apto em 2 meses",
};

const CORES: Record<CamadaRenovacao, string> = {
  apto_agora: "border-green-200 bg-green-100 text-green-800",
  apto_1_mes: "border-amber-200 bg-amber-100 text-amber-800",
  apto_2_meses: "border-orange-200 bg-orange-100 text-orange-800",
};

export function rotuloCamadaRenovacao(camada: CamadaRenovacao): string {
  return ROTULOS[camada];
}

export function corCamadaRenovacao(camada: CamadaRenovacao): string {
  return CORES[camada];
}

export interface FatiaRenovacao {
  nome: string;
  valor: number;
}

export function dadosDonutRenovacao(contagem: ContagemCamadas): FatiaRenovacao[] {
  const semElegibilidade = Math.max(
    contagem.total - contagem.aptoAgora - contagem.apto1Mes - contagem.apto2Meses,
    0
  );
  return [
    { nome: rotuloCamadaRenovacao("apto_agora"), valor: contagem.aptoAgora },
    { nome: rotuloCamadaRenovacao("apto_1_mes"), valor: contagem.apto1Mes },
    { nome: rotuloCamadaRenovacao("apto_2_meses"), valor: contagem.apto2Meses },
    { nome: "Sem elegibilidade", valor: semElegibilidade },
  ];
}
