// Leitor da fatura Claro Empresas, portado de extractFaturaLinhas() do painel
// (REGRAS_NEGOCIO.md seção 22). Regra confirmada com o usuário: cada linha móvel
// tem um bloco "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR (DDD) NÚMERO";
// o plano é o "Claro Pós <N>GB" com traço em "Mensalidades e Pacotes
// Promocionais", a mensalidade é a "Oferta Conjunta Claro MIX" e o consumo é o
// "Subtotal" depois de "Internet (MB)".

// `numero` é o telefone completo (sem DDD). Ele só pode existir dentro do leitor
// e da média (mesclar.ts), que o descarta ao mascarar o rótulo.
export interface LinhaLida {
  ddd: string;
  numero: string;
  valorMensal: number | null;
  planoGb: number | null;
  temMonitor: boolean;
  consumoMb: number;
}

// O pdf.js extrai cada glifo acentuado como um item de texto à parte, e o join
// com espaço deixa um espaço de sobra colado ao acento ("LIGAÇÕES" vira
// "LIGA ÇÕ ES", "Pós" vira "P ó s"). Remove o espaço dos dois lados de cada
// caractere acentuado latino, o que reconstrói a palavra sem afetar o espaço
// entre palavras sem acento.
export function normalizarAcentosPdf(texto: string): string {
  return texto.replace(/\s+(?=[À-ÖØ-öø-ÿ])/g, "").replace(/(?<=[À-ÖØ-öø-ÿ])\s+/g, "");
}

// Formato brasileiro: "1.234,56" vira 1234.56. Vazio ou ilegível vira 0.
function lerNumeroBR(texto: string): number {
  const limpo = texto.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return 0;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const numero = parseFloat(normalizado);
  return Number.isFinite(numero) ? numero : 0;
}

const TITULO_DO_BLOCO = "DETALHAMENTO DE LIGAÇÕES E SERVIÇOS DO CELULAR";

export function extrairLinhasFatura(textoBruto: string): LinhaLida[] {
  if (!textoBruto) return [];
  const texto = normalizarAcentosPdf(textoBruto);
  const blocos = texto.split(TITULO_DO_BLOCO).slice(1);

  const linhas: LinhaLida[] = [];
  for (const bloco of blocos) {
    const cabecalho = bloco.match(/\((\d{2})\)\s*(\d{4,5})[\s-]*(\d{4})/);
    if (!cabecalho) continue;

    const trechoMatch = bloco.match(
      /Mensalidades e Pacotes Promocionais([\s\S]*?)(?:Interurbanas|Ligações Locais|Serviços \(Torpedos|TOTAL\s)/
    );
    const trecho = trechoMatch ? trechoMatch[1] : bloco.slice(0, 1000);
    const oferta = trecho.match(/Oferta Conjunta Claro MIX\s+([\d.,]+)/);
    const plano = trecho.match(/Claro P[oó]s\s+(\d+)\s*GB\s*-/i);
    if (!oferta && !plano) continue; // linha sem uso no período

    // O primeiro "Subtotal" depois de "Internet (MB)" é o total de MB da linha,
    // porque o bloco já termina no próximo "DETALHAMENTO...". Sem a seção, o
    // consumo é zero (não usou internet), não "sem dado".
    const internet = bloco.match(/Internet \(MB\)[\s\S]*?Subtotal\s+([\d.,]+)/);

    linhas.push({
      ddd: cabecalho[1],
      numero: cabecalho[2] + cabecalho[3],
      valorMensal: oferta ? lerNumeroBR(oferta[1]) : null,
      planoGb: plano ? parseInt(plano[1], 10) : null,
      temMonitor: /Claro Monitor(?: lite)?\s*-/i.test(trecho),
      consumoMb: internet ? lerNumeroBR(internet[1]) : 0,
    });
  }
  return linhas;
}

export type Leitura =
  | { tipo: "sem_texto" }
  | { tipo: "sem_linhas" }
  | { tipo: "ok"; linhas: LinhaLida[] };

// Separa "o PDF não tem texto" (escaneado ou foto) de "tem texto, mas não é o
// layout que o leitor conhece": as duas mandam o consultor digitar, com avisos
// diferentes.
export function interpretarLeitura(texto: string): Leitura {
  if (!texto.trim()) return { tipo: "sem_texto" };
  const linhas = extrairLinhasFatura(texto);
  return linhas.length > 0 ? { tipo: "ok", linhas } : { tipo: "sem_linhas" };
}

export function mensagemDeLeitura(
  nomeArquivo: string,
  leitura: { tipo: "sem_texto" } | { tipo: "sem_linhas" }
): string {
  if (leitura.tipo === "sem_texto") {
    return `"${nomeArquivo}" não tem texto (parece escaneado ou foto). Clique em Adicionar linha e digite as linhas.`;
  }
  return `Não encontrei linhas de celular em "${nomeArquivo}". O leitor só conhece a fatura Claro com detalhamento por linha; clique em Adicionar linha e digite as linhas.`;
}
