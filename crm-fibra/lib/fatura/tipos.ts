export const LIMITE_LINHAS = 500;
export const LIMITE_ROTULO = 60;
export const LIMITE_QUANTIDADE = 1000;
export const LIMITE_FRANQUIA_GB = 1000;
export const LIMITE_VALOR_UNITARIO = 1_000_000;
export const LIMITE_CONSUMO_MB = 1_000_000_000;
export const LIMITE_FATURAS = 6;
// Mesmo teto de descrição das linhas da proposta (LIMITE_DESCRICAO em propostas.ts).
export const LIMITE_DESCRICAO_PROPOSTO = 300;

// Retrato do plano escolhido para a linha: é o que permite remontar o
// comparativo por linha a partir de uma proposta salva.
export interface PlanoProposto {
  descricao: string;
  valorUnitario: number;
}

export interface LinhaAtual {
  rotulo: string; // "(17) ••••• 9652" ou texto digitado, até 60 caracteres
  quantidade: number; // 1 para linha de fatura; N para grupo digitado ("5 linhas")
  planoGb: number | null; // franquia atual
  valorUnitario: number; // mensalidade de UMA linha, maior que zero
  consumoMb: number | null; // média do período, quando veio da fatura
  origem: "fatura" | "digitada";
  proposto: PlanoProposto | null; // plano da nova proposta para esta linha
}

export interface SituacaoAtual {
  faturasAnalisadas: number; // 0 a 6
  linhas: LinhaAtual[]; // 1 a 500
}

export function contarDigitos(texto: string): number {
  return (texto.match(/\d/g) ?? []).length;
}

// Conta os dígitos no total, não só os seguidos: "(17) 99219-9652" tem no máximo
// 5 seguidos e passaria por uma checagem de 8 seguidos.
export function temNumeroCompleto(texto: string): boolean {
  return contarDigitos(texto) >= 8;
}

// Só DDD e os 4 últimos dígitos: o número completo existe apenas dentro do
// leitor e da média, nunca na tela, no banco ou nos documentos.
export function rotuloDaLinha(ddd: string, numero: string): string {
  const ultimos = numero.replace(/\D/g, "").slice(-4);
  return `(${ddd.replace(/\D/g, "").slice(0, 2)}) ••••• ${ultimos}`;
}

export type ResultadoSituacao =
  | { ok: true; valor: SituacaoAtual | null }
  | { ok: false; erro: string };

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

function inteiroEntre(valor: unknown, minimo: number, maximo: number): number | null {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
  return valor >= minimo && valor <= maximo ? valor : null;
}

function dinheiro(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return valor > 0 && valor <= LIMITE_VALOR_UNITARIO ? arredondar(valor) : null;
}

function ausente(valor: unknown): boolean {
  return valor === null || valor === undefined;
}

function validarProposto(valor: unknown, numero: number): PlanoProposto | null | string {
  if (ausente(valor)) return null;
  if (typeof valor !== "object" || Array.isArray(valor)) return `Linha ${numero}: plano proposto inválido`;
  const bruto = valor as Record<string, unknown>;
  const descricao = typeof bruto.descricao === "string" ? bruto.descricao.trim() : "";
  const valorUnitario = dinheiro(bruto.valorUnitario);
  if (!descricao || descricao.length > LIMITE_DESCRICAO_PROPOSTO || valorUnitario === null) {
    return `Linha ${numero}: plano proposto inválido`;
  }
  return { descricao, valorUnitario };
}

function validarLinha(item: unknown, numero: number): LinhaAtual | string {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return `Linha ${numero}: formato inválido`;
  }
  const bruto = item as Record<string, unknown>;

  const rotulo = typeof bruto.rotulo === "string" ? bruto.rotulo.trim() : "";
  if (!rotulo) return `Linha ${numero}: informe o nome da linha`;
  if (rotulo.length > LIMITE_ROTULO) return `Linha ${numero}: o nome passou de ${LIMITE_ROTULO} caracteres`;
  if (temNumeroCompleto(rotulo)) {
    return `Linha ${numero}: não use o número completo do telefone no nome da linha`;
  }

  const quantidade = inteiroEntre(bruto.quantidade, 1, LIMITE_QUANTIDADE);
  if (quantidade === null) return `Linha ${numero}: a quantidade deve ser um número de 1 a ${LIMITE_QUANTIDADE}`;

  const planoGb = ausente(bruto.planoGb) ? null : inteiroEntre(bruto.planoGb, 1, LIMITE_FRANQUIA_GB);
  if (!ausente(bruto.planoGb) && planoGb === null) {
    return `Linha ${numero}: a franquia deve ser um número de 1 a ${LIMITE_FRANQUIA_GB}`;
  }

  const valorUnitario = dinheiro(bruto.valorUnitario);
  if (valorUnitario === null) return `Linha ${numero}: informe a mensalidade (maior que zero)`;

  let consumoMb: number | null = null;
  if (!ausente(bruto.consumoMb)) {
    const consumo = bruto.consumoMb;
    if (typeof consumo !== "number" || !Number.isFinite(consumo) || consumo < 0 || consumo > LIMITE_CONSUMO_MB) {
      return `Linha ${numero}: consumo inválido`;
    }
    consumoMb = arredondar(consumo);
  }

  if (bruto.origem !== "fatura" && bruto.origem !== "digitada") return `Linha ${numero}: origem inválida`;

  const proposto = validarProposto(bruto.proposto, numero);
  if (typeof proposto === "string") return proposto;

  return { rotulo, quantidade, planoGb, valorUnitario, consumoMb, origem: bruto.origem, proposto };
}

// Tudo que chega do navegador passa por aqui antes de ir ao banco: devolve uma
// cópia só com os campos conhecidos (campos extras são descartados).
export function validarSituacaoAtual(entrada: unknown): ResultadoSituacao {
  if (ausente(entrada)) return { ok: true, valor: null };
  if (typeof entrada !== "object" || Array.isArray(entrada)) {
    return { ok: false, erro: "Situação atual em formato inválido" };
  }
  const bruto = entrada as Record<string, unknown>;

  const faturasAnalisadas = inteiroEntre(bruto.faturasAnalisadas, 0, LIMITE_FATURAS);
  if (faturasAnalisadas === null) {
    return { ok: false, erro: "Quantidade de faturas analisadas inválida" };
  }
  if (!Array.isArray(bruto.linhas) || bruto.linhas.length === 0) {
    return { ok: false, erro: "A situação atual precisa de pelo menos uma linha" };
  }
  if (bruto.linhas.length > LIMITE_LINHAS) {
    return { ok: false, erro: `A situação atual passou de ${LIMITE_LINHAS} linhas` };
  }

  const linhas: LinhaAtual[] = [];
  for (const [indice, item] of bruto.linhas.entries()) {
    const resultado = validarLinha(item, indice + 1);
    if (typeof resultado === "string") return { ok: false, erro: resultado };
    linhas.push(resultado);
  }
  return { ok: true, valor: { faturasAnalisadas, linhas } };
}
