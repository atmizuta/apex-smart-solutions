import type { FiltroCamada } from "./leads";

export function hrefCarteiraFiltrada(filtro: FiltroCamada, busca: string): string {
  const params = new URLSearchParams();
  params.set("camada", filtro);
  if (busca) params.set("busca", busca);
  return `/leads?${params.toString()}`;
}

export function hrefCarteiraPagina(filtro: FiltroCamada, busca: string, pagina: number): string {
  const params = new URLSearchParams();
  params.set("camada", filtro);
  if (busca) params.set("busca", busca);
  params.set("pagina", String(pagina));
  return `/leads?${params.toString()}`;
}

export type ItemPaginacao = number | "reticencias";

// Mostrar um link por página quebra a tela com centenas de páginas (foi um
// achado Critical da revisão: 262 links numa linha só empurram o conteúdo
// pra fora da tela). Mostra só primeira, última, e uma janela em volta da
// página atual, com reticências nos buracos — nunca mais que ~9 itens.
export function paginasParaExibir(paginaAtual: number, totalPaginas: number): ItemPaginacao[] {
  if (totalPaginas <= 7) {
    return Array.from({ length: totalPaginas }, (_, i) => i + 1);
  }

  const paginas = new Set<number>([1, totalPaginas]);
  for (let p = paginaAtual - 2; p <= paginaAtual + 2; p++) {
    if (p >= 1 && p <= totalPaginas) paginas.add(p);
  }

  const ordenadas = Array.from(paginas).sort((a, b) => a - b);
  const resultado: ItemPaginacao[] = [];
  for (let i = 0; i < ordenadas.length; i++) {
    if (i > 0 && ordenadas[i] - ordenadas[i - 1] > 1) {
      resultado.push("reticencias");
    }
    resultado.push(ordenadas[i]);
  }
  return resultado;
}
