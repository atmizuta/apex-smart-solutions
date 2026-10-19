import type { PlanoCatalogo } from "../catalogo";
import type { LinhaAtual } from "../fatura/tipos";
import { descricaoDoPlano } from "../proposta-rascunho";
import { subtotalDaLinha, type NovoItemProposta } from "../propostas";

// Uma linha da situação atual como a tela a edita: além dos dados que vão ao
// servidor, guarda o plano escolhido para a nova proposta e os avisos da leitura.
export type LinhaEditavel = Omit<LinhaAtual, "proposto"> & {
  chave: string; // identidade estável para a tela
  planoId: string | null; // plano do catálogo escolhido para esta linha
  avisos: string[]; // avisos da leitura (média de faturas, valor ausente...)
};

function indicePorId(catalogo: PlanoCatalogo[]): Map<string, PlanoCatalogo> {
  return new Map(catalogo.map((plano) => [plano.id, plano]));
}

// O que vai ao servidor: só os campos de LinhaAtual, com o retrato do plano
// escolhido. Nunca chave, planoId nem avisos.
export function linhasComProposto(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): LinhaAtual[] {
  const porId = indicePorId(catalogo);
  return linhas.map((linha) => {
    const plano = linha.planoId ? porId.get(linha.planoId) : undefined;
    return {
      rotulo: linha.rotulo,
      quantidade: linha.quantidade,
      planoGb: linha.planoGb,
      valorUnitario: linha.valorUnitario,
      consumoMb: linha.consumoMb,
      origem: linha.origem,
      proposto: plano ? { descricao: descricaoDoPlano(plano), valorUnitario: plano.valor } : null,
    };
  });
}

// Itens da nova proposta derivados das escolhas por linha: um item por plano,
// com a soma das quantidades. Recalculados a cada troca de plano e não editáveis
// à mão, o que garante que a tabela por linha e o total nunca divergem.
export function itensDasLinhas(linhas: LinhaEditavel[], catalogo: PlanoCatalogo[]): NovoItemProposta[] {
  const porId = indicePorId(catalogo);
  const quantidades = new Map<string, number>();
  for (const linha of linhas) {
    if (!linha.planoId || !porId.has(linha.planoId)) continue;
    quantidades.set(linha.planoId, (quantidades.get(linha.planoId) ?? 0) + linha.quantidade);
  }

  return [...quantidades.entries()]
    .map(([id, quantidade]) => ({ plano: porId.get(id) as PlanoCatalogo, quantidade }))
    .sort(
      (a, b) =>
        (b.plano.franquiaGb ?? 0) - (a.plano.franquiaGb ?? 0) || a.plano.nome.localeCompare(b.plano.nome)
    )
    .map(({ plano, quantidade }) => ({
      catalogoPlanoId: plano.id,
      descricao: descricaoDoPlano(plano),
      quantidade,
      franquiaGb: plano.franquiaGb,
      valor: subtotalDaLinha(plano.valor, quantidade),
    }));
}
