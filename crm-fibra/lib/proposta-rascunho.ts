import type { PlanoCatalogo } from "./catalogo";
import { parseValorBRL } from "./formato";
import {
  LIMITE_QUANTIDADE_ITEM,
  somarValores,
  subtotalDaLinha,
  type NovoItemProposta,
} from "./propostas";

export interface LinhaRascunho {
  chave: string;
  catalogoPlanoId: string | null;
  descricao: string;
  quantidade: number;
  franquiaGb: number | null;
  valor: number; // subtotal: quantidade x valor unitário
}

export type Rascunho = LinhaRascunho[];

// A observação ("Por 3 meses, depois R$99,90") vai junto na descrição: quem
// lê a proposta depois precisa da condição, não só do número promocional.
export function descricaoDoPlano(plano: Pick<PlanoCatalogo, "nome" | "observacao">): string {
  return plano.observacao ? `${plano.nome} — ${plano.observacao}` : plano.nome;
}

// Quantidade digitada: só inteiro de 1 a 1000. "1,5", "1e2" e vazio são recusados.
export function lerQuantidade(texto: string): number | null {
  const limpo = texto.trim();
  if (!/^\d{1,4}$/.test(limpo)) return null;
  const quantidade = Number(limpo);
  return quantidade >= 1 && quantidade <= LIMITE_QUANTIDADE_ITEM ? quantidade : null;
}

export function adicionarLinhaCatalogo(
  rascunho: Rascunho,
  plano: PlanoCatalogo,
  chave: string,
  quantidade = 1
): Rascunho {
  return [
    ...rascunho,
    {
      chave,
      catalogoPlanoId: plano.id,
      descricao: descricaoDoPlano(plano),
      quantidade,
      franquiaGb: plano.franquiaGb,
      valor: subtotalDaLinha(plano.valor, quantidade),
    },
  ];
}

export type ResultadoLinhaAvulsa =
  | { ok: true; rascunho: Rascunho }
  | { ok: false; erro: string };

// O valor digitado é o UNITÁRIO; a linha guarda o subtotal (valor x quantidade).
export function adicionarLinhaAvulsa(
  rascunho: Rascunho,
  entrada: { descricao: string; valorTexto: string; quantidadeTexto?: string },
  chave: string
): ResultadoLinhaAvulsa {
  const descricao = entrada.descricao.trim();
  if (!descricao) return { ok: false, erro: "Descreva a oferta avulsa" };

  const valorUnitario = parseValorBRL(entrada.valorTexto);
  if (valorUnitario === null) return { ok: false, erro: "Informe um valor válido, por exemplo 149,90" };

  const quantidade = lerQuantidade(entrada.quantidadeTexto ?? "1");
  if (quantidade === null) {
    return { ok: false, erro: `Informe uma quantidade de 1 a ${LIMITE_QUANTIDADE_ITEM}` };
  }

  return {
    ok: true,
    rascunho: [
      ...rascunho,
      {
        chave,
        catalogoPlanoId: null,
        descricao,
        quantidade,
        franquiaGb: null,
        valor: subtotalDaLinha(valorUnitario, quantidade),
      },
    ],
  };
}

export function removerLinha(rascunho: Rascunho, chave: string): Rascunho {
  return rascunho.filter((linha) => linha.chave !== chave);
}

export function totalRascunho(rascunho: Rascunho): number {
  return somarValores(rascunho.map((linha) => linha.valor));
}

export function itensParaSalvar(rascunho: Rascunho): NovoItemProposta[] {
  return rascunho.map(({ catalogoPlanoId, descricao, valor, quantidade, franquiaGb }) => ({
    catalogoPlanoId,
    descricao,
    valor,
    quantidade,
    franquiaGb,
  }));
}
