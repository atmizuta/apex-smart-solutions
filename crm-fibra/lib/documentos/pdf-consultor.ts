// PDF da proposta comercial para o consultor (negociação): mesmo conteúdo do Word.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import { SUBTITULO_CONSULTOR, linhasDaTabela, moeda, reducaoDe, rotuloTotalProposta, textoReducao } from "./formato";
import type { Logos } from "./marca";
import {
  COR,
  caixaDeDestaque,
  desenharBeneficios,
  desenharCabecalho,
  desenharDadosDoCliente,
  desenharRodape,
  desenharTabela,
  notaPequena,
  novoDocumento,
  tituloDeSecao,
} from "./pdf-base";

const CABECALHO = ["DESCRIÇÃO", "QTD", "VALOR UNIT.", "SUBTOTAL"];
const ESTILO_TABELA = { larguras: { 1: 14, 2: 30, 3: 30 }, centro: [1], direita: [2, 3] };

export function gerarPdfConsultor(modelo: ModeloDocumento, logos: Logos): Uint8Array {
  const doc = novoDocumento();
  desenharCabecalho(doc, "PROPOSTA COMERCIAL", SUBTITULO_CONSULTOR, logos);

  let y = desenharDadosDoCliente(doc, 36, modelo) + 8;

  if (modelo.situacaoAtual) {
    y = tituloDeSecao(doc, y, "SITUAÇÃO ATUAL");
    y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.situacaoAtual.itens), {
      ...ESTILO_TABELA,
      linhaTotal: ["TOTAL ATUAL", "", "", moeda(modelo.situacaoAtual.total)],
    });
    y = notaPequena(doc, y + 1, modelo.situacaoAtual.nota) + 4;
  }

  y = tituloDeSecao(doc, y, "NOVA PROPOSTA");
  y = desenharTabela(doc, y, CABECALHO, linhasDaTabela(modelo.novaProposta.itens), {
    ...ESTILO_TABELA,
    linhaTotal: [rotuloTotalProposta(modelo), "", "", moeda(modelo.novaProposta.total)],
  });
  y += 8;

  if (modelo.beneficios.badges.length > 0) {
    y = tituloDeSecao(doc, y, "BENEFÍCIOS INCLUSOS");
    y = desenharBeneficios(doc, y, modelo.beneficios.badges);
  }

  const reducao = reducaoDe(modelo);
  caixaDeDestaque(
    doc,
    y + 2,
    "VALOR PROPOSTO (MENSAL)",
    moeda(modelo.resumo.proposto),
    COR.vermelho,
    reducao ? textoReducao(reducao) : undefined
  );

  desenharRodape(doc, modelo.emitidoEm, modelo.validoAte);
  return new Uint8Array(doc.output("arraybuffer"));
}
