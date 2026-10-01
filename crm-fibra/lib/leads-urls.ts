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
