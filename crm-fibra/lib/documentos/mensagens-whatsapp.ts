// Mensagens fixas (não são IA) que o consultor edita antes de enviar. Nenhuma
// fala em economia, desconto ou aumento: o comparativo pode ser um aumento, e a
// mensagem acompanha qualquer um dos casos.
import { limparRazaoSocial } from "../ia/abordagem";

export interface ModeloMensagem {
  id: string;
  rotulo: string;
  texto: string;
}

export const MODELOS_MENSAGEM: ModeloMensagem[] = [
  {
    id: "formal",
    rotulo: "Formal",
    texto:
      "Olá, {cliente}! Aqui é {consultor}, da Apex Smart Solutions, parceiro autorizado Claro Empresas. Preparei um comparativo da sua fatura com a nossa proposta e vou te enviar em seguida. Qualquer dúvida, fico à disposição.",
  },
  {
    id: "direto",
    rotulo: "Direto",
    texto:
      "Oi, {cliente}! {consultor}, da Apex, aqui. Fiz um comparativo da sua fatura com a nossa proposta e estou te enviando agora. Posso te explicar os detalhes?",
  },
];

export function preencherModelo(texto: string, vars: { cliente: string; consultor: string }): string {
  const cliente = limparRazaoSocial(vars.cliente) || "cliente";
  const consultor = vars.consultor.trim() || "seu consultor";
  return texto.replaceAll("{cliente}", cliente).replaceAll("{consultor}", consultor);
}
