export type ChaveEtapa = "abordagem" | "sondagem" | "maleficios" | "beneficios" | "finalizacao";

export type EtapasAbordagem = Record<ChaveEtapa, string>;

export interface DefinicaoEtapa {
  chave: ChaveEtapa;
  rotulo: string;
  objetivo: string;
}

export const ETAPAS: readonly DefinicaoEtapa[] = [
  {
    chave: "abordagem",
    rotulo: "Abordagem",
    objetivo:
      "Abertura personalizada com a razão social e a cidade do cliente, apresentando-se. Sem preço.",
  },
  {
    chave: "sondagem",
    rotulo: "Sondagem",
    objetivo:
      "UMA única pergunta para descobrir o uso atual do cliente (quantas linhas, qual operadora, qual a dor).",
  },
  {
    chave: "maleficios",
    rotulo: "Malefícios",
    objetivo:
      "O que o cliente perde ou deixa de aproveitar se ficar como está, usando só fatos dos dados e sem número de economia.",
  },
  {
    chave: "beneficios",
    rotulo: "Benefícios",
    objetivo:
      "A solução. Havendo proposta, cite os planos e o total dela; sem proposta, benefícios gerais, sem preço.",
  },
  {
    chave: "finalizacao",
    rotulo: "Finalização",
    objetivo:
      "Termine com uma pergunta de fechamento de resposta curta (sim/não ou escolha entre duas opções), nunca uma pergunta aberta.",
  },
];

export const CHAVES_ETAPA: readonly ChaveEtapa[] = ETAPAS.map((etapa) => etapa.chave);

// Fonte: guia de atendimento da Apex, como o app de prática o aplica
// (pratica-vendas/lib/avaliacao/rubrica.ts). Os dois apps são projetos
// separados, então as regras são copiadas aqui, num único lugar.
export const REGRAS_GUIA_APEX: readonly string[] = [
  "Abra a oferta pelos planos maiores (100GB ou 70GB), não pelo plano de entrada.",
  "Só desça de plano se o cliente questionar o preço — nunca de primeira.",
  "Nunca ofereça o plano regional de R$ 44,99 com 15GB.",
  'Se o endereço do cliente não tem cobertura de fibra, isso não é um "não": redirecione para a linha móvel empresarial.',
];

// Sugerido ao modelo no prompt; o limite duro recusa respostas fora de controle.
export const LIMITE_SUGERIDO = 320;
export const LIMITE_MENSAGEM = 1200;
