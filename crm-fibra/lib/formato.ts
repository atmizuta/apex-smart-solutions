const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarBRL(valor: number): string {
  return moeda.format(valor);
}

// Aceita o que um consultor digita de verdade: "149,90", "1.299,90",
// "R$ 89,99" e também "149.90". Retorna null para qualquer coisa que não
// seja um valor positivo — nunca adivinha.
export function parseValorBRL(texto: string): number | null {
  const limpo = texto.replace(/^R\$\s*/i, "").trim();
  let normalizado: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpo)) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(,\d{1,2})?$/.test(limpo)) {
    normalizado = limpo.replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(limpo)) {
    normalizado = limpo;
  } else {
    return null;
  }
  const valor = Number(normalizado);
  return valor > 0 ? valor : null;
}

const dataHoraBrasilia = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

// O servidor roda em UTC; sem fixar o fuso, a proposta salva às 22h de
// Brasília apareceria com a data do dia seguinte.
export function formatarDataHora(iso: string): string {
  const partes = Object.fromEntries(
    dataHoraBrasilia.formatToParts(new Date(iso)).map((parte) => [parte.type, parte.value])
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}
