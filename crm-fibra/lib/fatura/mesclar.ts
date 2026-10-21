// Média de 1 a 6 faturas por linha, portada de mesclarLinhasFaturas() do painel
// (REGRAS_NEGOCIO.md seção 29): o consumo de um único mês pode ser atípico, então
// valor e consumo viram a média do período, com a faixa observada.
import type { LinhaLida } from "./extrair";
import { rotuloDaLinha, type LinhaAtual } from "./tipos";

export interface LinhaMesclada {
  ddd: string;
  numero: string; // completo: só vive aqui dentro, paraLinhasAtuais() o descarta
  planoGb: number | null;
  planoGbDistintos: number[];
  valorMensal: number | null;
  valorMensalMin: number | null;
  valorMensalMax: number | null;
  consumoMb: number;
  consumoMbMin: number;
  consumoMbMax: number;
  temMonitor: boolean;
  faturasEncontradas: number;
  totalFaturas: number;
}

const arredondar = (valor: number) => Math.round(valor * 100) / 100;
const media = (valores: number[]) => valores.reduce((soma, valor) => soma + valor, 0) / valores.length;

// Plano mais frequente; no empate vale o da fatura anexada por último (a mais
// recente, se os arquivos foram anexados em ordem cronológica).
function planoMaisFrequente(gbs: number[]): number | null {
  if (gbs.length === 0) return null;
  const contagem = new Map<number, number>();
  for (const gb of gbs) contagem.set(gb, (contagem.get(gb) ?? 0) + 1);
  let melhor = gbs[gbs.length - 1];
  let maior = 0;
  for (const gb of gbs) {
    const quantas = contagem.get(gb) ?? 0;
    if (quantas >= maior) {
      maior = quantas;
      melhor = gb;
    }
  }
  return melhor;
}

export function mesclarFaturas(listas: LinhaLida[][]): LinhaMesclada[] {
  const totalFaturas = listas.length;
  const grupos = new Map<string, LinhaLida[]>();
  for (const linhas of listas) {
    for (const linha of linhas) {
      const chave = `${linha.ddd}${linha.numero}`;
      grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
    }
  }

  return [...grupos.values()].map((ocorrencias) => {
    const valores = ocorrencias.map((o) => o.valorMensal).filter((v): v is number => v !== null);
    const consumos = ocorrencias.map((o) => o.consumoMb);
    const gbs = ocorrencias.map((o) => o.planoGb).filter((v): v is number => v !== null);
    return {
      ddd: ocorrencias[0].ddd,
      numero: ocorrencias[0].numero,
      planoGb: planoMaisFrequente(gbs),
      planoGbDistintos: gbs.filter((gb, indice) => gbs.indexOf(gb) === indice),
      valorMensal: valores.length ? arredondar(media(valores)) : null,
      valorMensalMin: valores.length ? Math.min(...valores) : null,
      valorMensalMax: valores.length ? Math.max(...valores) : null,
      consumoMb: arredondar(media(consumos)),
      consumoMbMin: Math.min(...consumos),
      consumoMbMax: Math.max(...consumos),
      temMonitor: ocorrencias.some((o) => o.temMonitor),
      faturasEncontradas: ocorrencias.length,
      totalFaturas,
    };
  });
}

export function avisosDaLinha(linha: LinhaMesclada): string[] {
  const avisos: string[] = [];
  if (linha.valorMensal === null) avisos.push("Mensalidade não encontrada na fatura: preencha o valor.");
  if (linha.planoGb === null) {
    avisos.push("Plano atual não identificado: a sugestão por consumo fica indisponível.");
  }
  if (linha.totalFaturas > 1 && linha.faturasEncontradas < linha.totalFaturas) {
    avisos.push(`Linha achada em ${linha.faturasEncontradas} de ${linha.totalFaturas} faturas.`);
  }
  if (linha.planoGbDistintos.length > 1) {
    avisos.push(`Plano mudou no período (${linha.planoGbDistintos.map((gb) => `${gb}GB`).join(", ")}).`);
  }
  return avisos;
}

// Aqui o número completo é descartado: só o rótulo mascarado segue adiante.
export function paraLinhasAtuais(linhas: LinhaMesclada[]): LinhaAtual[] {
  return linhas.map((linha) => ({
    rotulo: rotuloDaLinha(linha.ddd, linha.numero),
    quantidade: 1,
    planoGb: linha.planoGb,
    valorUnitario: linha.valorMensal ?? 0,
    consumoMb: linha.consumoMb,
    origem: "fatura" as const,
    proposto: null,
  }));
}
