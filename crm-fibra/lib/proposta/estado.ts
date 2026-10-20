// Operações puras sobre as linhas da situação atual como a tela as edita. A tela
// só chama estas funções (e guarda o resultado em useState): assim a regra fica
// testada em Node e o React não precisa ser testado.
import type { PlanoCatalogo } from "../catalogo";
import { avisosDaLinha, paraLinhasAtuais, type LinhaMesclada } from "../fatura/mesclar";
import { planosPosNacional, sugerirPlano, type Sugestao } from "../fatura/sugestao";
import { LIMITE_LINHAS, validarSituacaoAtual, type SituacaoAtual } from "../fatura/tipos";
import { linhasComProposto, type LinhaEditavel } from "./agrupar";

export function linhaDigitada(chave: string): LinhaEditavel {
  return {
    chave,
    rotulo: "Linhas",
    quantidade: 1,
    planoGb: null,
    valorUnitario: 0, // a mensalidade fica pendente até o consultor preencher
    consumoMb: null,
    origem: "digitada",
    planoId: null,
    avisos: [],
  };
}

export function adicionarLinhaDigitada(linhas: LinhaEditavel[], chave: string): LinhaEditavel[] {
  return linhas.length >= LIMITE_LINHAS ? linhas : [...linhas, linhaDigitada(chave)];
}

export function sugestaoDaLinha(
  linha: Pick<LinhaEditavel, "planoGb" | "consumoMb">,
  catalogo: PlanoCatalogo[]
): Sugestao {
  return sugerirPlano(linha, planosPosNacional(catalogo));
}

function planoSugerido(
  linha: Pick<LinhaEditavel, "planoGb" | "consumoMb">,
  catalogo: PlanoCatalogo[]
): string | null {
  return sugestaoDaLinha(linha, catalogo).plano?.id ?? null;
}

// Cada linha lida da fatura já nasce com o plano sugerido escolhido ("deixar o
// plano sugerido setado", como no painel).
export function linhasDaFatura(
  mescladas: LinhaMesclada[],
  catalogo: PlanoCatalogo[],
  novaChave: () => string
): LinhaEditavel[] {
  const atuais = paraLinhasAtuais(mescladas);
  return mescladas.map((mesclada, indice) => {
    const atual = atuais[indice];
    return {
      chave: novaChave(),
      rotulo: atual.rotulo,
      quantidade: atual.quantidade,
      planoGb: atual.planoGb,
      valorUnitario: atual.valorUnitario,
      consumoMb: atual.consumoMb,
      origem: atual.origem,
      planoId: planoSugerido(atual, catalogo),
      avisos: avisosDaLinha(mesclada),
    };
  });
}

// Ler uma fatura nova troca as linhas que vieram de fatura e preserva o que o
// consultor digitou à mão.
export function substituirLinhasDaFatura(atuais: LinhaEditavel[], novas: LinhaEditavel[]): LinhaEditavel[] {
  return [...novas, ...atuais.filter((linha) => linha.origem === "digitada")];
}

export function atualizarLinha(
  linhas: LinhaEditavel[],
  chave: string,
  mudanca: Partial<Omit<LinhaEditavel, "chave">>,
  catalogo: PlanoCatalogo[]
): LinhaEditavel[] {
  return linhas.map((linha) => {
    if (linha.chave !== chave) return linha;
    const nova: LinhaEditavel = { ...linha, ...mudanca };
    const mudouABase = mudanca.planoGb !== undefined || mudanca.consumoMb !== undefined;
    // Só sugere quando a linha ainda não tem plano e o consultor não escolheu um
    // na mesma mudança: uma escolha manual nunca é trocada por baixo dele.
    if (mudouABase && mudanca.planoId === undefined && linha.planoId === null) {
      nova.planoId = planoSugerido(nova, catalogo);
    }
    return nova;
  });
}

export function removerLinhaEditavel(linhas: LinhaEditavel[], chave: string): LinhaEditavel[] {
  return linhas.filter((linha) => linha.chave !== chave);
}

export function refazerSugestoes(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): LinhaEditavel[] {
  return linhas.map((linha) => ({ ...linha, planoId: planoSugerido(linha, catalogo) }));
}

export type SituacaoDaTela = { ok: true; situacao: SituacaoAtual | null } | { ok: false; erro: string };

// O que a tela aceita é exatamente o que o servidor aceita: usa o mesmo validador.
export function validarSituacaoDaTela(
  linhas: LinhaEditavel[],
  faturasAnalisadas: number,
  catalogo: PlanoCatalogo[]
): SituacaoDaTela {
  if (linhas.length === 0) return { ok: true, situacao: null };
  const faturas = linhas.some((linha) => linha.origem === "fatura") ? faturasAnalisadas : 0;
  const resultado = validarSituacaoAtual({ faturasAnalisadas: faturas, linhas: linhasComProposto(linhas, catalogo) });
  return resultado.ok ? { ok: true, situacao: resultado.valor } : { ok: false, erro: resultado.erro };
}
