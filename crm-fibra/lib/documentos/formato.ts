import { formatarBRL } from "../formato";
import type { LinhaTabela, ModeloDocumento } from "../proposta/modelo-documento";

export const RODAPE_EMPRESA =
  "Apex Smart Solutions — Agente Autorizado Claro Empresas · CNPJ 64.307.984/0001-30";
export const SUBTITULO_CONSULTOR = "Apex Smart Solutions — Parceiro autorizado Claro Empresas";

// O Intl usa espaço não separável depois do "R$"; nos PDFs ele atrapalharia a
// busca e a quebra de linha.
export function moeda(valor: number): string {
  return formatarBRL(valor).replace(/ /g, " ");
}

// Sem acento nem símbolo: o navegador e o Windows tratam nome de arquivo com mais
// cuidado do que a razão social merece.
export function nomeDeArquivo(prefixo: string, razaoSocial: string, extensao: string): string {
  const nome = razaoSocial
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${prefixo}_${nome || "cliente"}.${extensao}`;
}

export function linhasDaTabela(itens: LinhaTabela[]): string[][] {
  return itens.map((item) => [
    item.descricao,
    String(item.quantidade),
    item.valorUnitario === null ? "-" : moeda(item.valorUnitario),
    moeda(item.subtotal),
  ]);
}

// O Claro Monitor soma no total sem aparecer como linha; o rótulo avisa, para o
// cliente não achar que a conta não fecha.
export function rotuloTotalProposta(modelo: ModeloDocumento): string {
  return modelo.beneficios.badges.some((b) => b.label === "Claro Monitor")
    ? "TOTAL (inclui Claro Monitor)"
    : "TOTAL";
}

// Regra do painel (seção 7): nos documentos do consultor a diferença só aparece
// quando há redução real.
export function reducaoDe(modelo: ModeloDocumento): { valor: number; pct: number | null } | null {
  const { atual, diferenca, tipo } = modelo.resumo;
  if (tipo !== "economia" || atual === null || diferenca === null) return null;
  const valor = Math.abs(diferenca);
  return { valor, pct: atual > 0 ? (valor / atual) * 100 : null };
}

export function textoReducao(reducao: { valor: number; pct: number | null }): string {
  const pct = reducao.pct === null ? "" : ` (${reducao.pct.toFixed(1).replace(".", ",")}%)`;
  return `Redução na fatura: ${moeda(reducao.valor)}${pct}`;
}

export function tituloDoCliente(modelo: ModeloDocumento): string {
  return modelo.situacaoAtual ? "COMPARATIVO DA SUA FATURA" : "RESUMO DA PROPOSTA";
}

// Material do cliente: mostra a economia (verde) ou o aumento (âmbar), com o valor.
export function destaqueDoCliente(modelo: ModeloDocumento): {
  titulo: string;
  valor: string;
  cor: "verde" | "ambar" | "preto";
} {
  const { diferenca, tipo, proposto } = modelo.resumo;
  if (tipo === "economia" && diferenca !== null) {
    return { titulo: "ECONOMIA MENSAL", valor: moeda(Math.abs(diferenca)), cor: "verde" };
  }
  if (tipo === "aumento" && diferenca !== null) {
    return { titulo: "AUMENTO MENSAL", valor: moeda(diferenca), cor: "ambar" };
  }
  if (tipo === "igual") return { titulo: "MESMA MENSALIDADE", valor: moeda(proposto), cor: "preto" };
  return { titulo: "MENSALIDADE PROPOSTA", valor: moeda(proposto), cor: "preto" };
}
