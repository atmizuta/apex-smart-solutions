import type { PlanoCatalogo } from "./catalogo";
import { parseValorBRL } from "./formato";
import { somarValores, type NovoItemProposta } from "./propostas";

export interface LinhaRascunho {
  chave: string;
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number;
}

export type Rascunho = LinhaRascunho[];

// A observação ("Por 3 meses, depois R$99,90") vai junto na descrição: quem
// lê a proposta depois precisa da condição, não só do número promocional.
export function descricaoDoPlano(plano: Pick<PlanoCatalogo, "nome" | "observacao">): string {
  return plano.observacao ? `${plano.nome} — ${plano.observacao}` : plano.nome;
}

export function adicionarLinhaCatalogo(rascunho: Rascunho, plano: PlanoCatalogo, chave: string): Rascunho {
  return [
    ...rascunho,
    { chave, catalogoPlanoId: plano.id, descricao: descricaoDoPlano(plano), valor: plano.valor },
  ];
}

export type ResultadoLinhaAvulsa =
  | { ok: true; rascunho: Rascunho }
  | { ok: false; erro: string };

export function adicionarLinhaAvulsa(
  rascunho: Rascunho,
  entrada: { descricao: string; valorTexto: string },
  chave: string
): ResultadoLinhaAvulsa {
  const descricao = entrada.descricao.trim();
  if (!descricao) return { ok: false, erro: "Descreva a oferta avulsa" };

  const valor = parseValorBRL(entrada.valorTexto);
  if (valor === null) return { ok: false, erro: "Informe um valor válido, por exemplo 149,90" };

  return { ok: true, rascunho: [...rascunho, { chave, catalogoPlanoId: null, descricao, valor }] };
}

export function removerLinha(rascunho: Rascunho, chave: string): Rascunho {
  return rascunho.filter((linha) => linha.chave !== chave);
}

export function totalRascunho(rascunho: Rascunho): number {
  return somarValores(rascunho.map((linha) => linha.valor));
}

export function itensParaSalvar(rascunho: Rascunho): NovoItemProposta[] {
  return rascunho.map(({ catalogoPlanoId, descricao, valor }) => ({ catalogoPlanoId, descricao, valor }));
}
