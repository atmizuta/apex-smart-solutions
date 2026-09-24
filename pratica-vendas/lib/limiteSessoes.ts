export const LIMITE_SESSOES_POR_DIA = 10;

export function podeIniciarSessao(sessoesHoje: number): boolean {
  return sessoesHoje < LIMITE_SESSOES_POR_DIA;
}
