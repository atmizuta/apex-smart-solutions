export class IaNaoConfiguradaError extends Error {
  constructor() {
    super("GEMINI_API_KEY não configurada");
    this.name = "IaNaoConfiguradaError";
  }
}

export class IaCotaEsgotadaError extends Error {
  constructor() {
    super("Cota da IA esgotada");
    this.name = "IaCotaEsgotadaError";
  }
}

export class IaIndisponivelError extends Error {
  constructor() {
    super("IA indisponível (503) depois das tentativas");
    this.name = "IaIndisponivelError";
  }
}

export class IaRespostaInvalidaError extends Error {
  constructor(detalhe: string) {
    super(`Resposta da IA inválida: ${detalhe}`);
    this.name = "IaRespostaInvalidaError";
  }
}

// O consultor só vê esta mensagem; o detalhe técnico fica no console.error do servidor.
export function mensagemDeErroIa(erro: unknown): string {
  if (erro instanceof IaNaoConfiguradaError) {
    return "A IA ainda não está configurada neste ambiente. Avise o administrador.";
  }
  if (erro instanceof IaCotaEsgotadaError) {
    return "O limite da IA foi atingido por agora. Tente de novo em alguns minutos.";
  }
  if (erro instanceof IaIndisponivelError) {
    return "A IA está sobrecarregada no momento. Tente de novo em instantes.";
  }
  if (erro instanceof IaRespostaInvalidaError) {
    return "A IA não devolveu um roteiro utilizável. Tente gerar de novo.";
  }
  return "Não foi possível gerar a abordagem agora. Tente de novo em instantes.";
}
