// Logos que vão no cabeçalho dos documentos (Word, PDF e PNG). Os arquivos
// vêm do painel publicado e ficam em public/marca; as dimensões abaixo são
// conferidas por marca.test.ts para ninguém trocar a imagem sem querer.
export const LOGO_APEX = {
  arquivo: "/marca/apex-logo.png",
  formato: "PNG" as const,
  largura: 300,
  altura: 327,
};

export const LOGO_CLARO = {
  arquivo: "/marca/claro-logo.jpg",
  formato: "JPEG" as const,
  largura: 260,
  altura: 260,
};

export interface Logos {
  apex: Uint8Array;
  claro: Uint8Array;
}

async function baixar(arquivo: string): Promise<Uint8Array> {
  const resposta = await fetch(arquivo);
  if (!resposta.ok) throw new Error(`Não foi possível carregar ${arquivo}`);
  return new Uint8Array(await resposta.arrayBuffer());
}

// Só no navegador: o mesmo domínio serve os arquivos, sem bloqueio de CORS.
export async function carregarLogos(): Promise<Logos> {
  const [apex, claro] = await Promise.all([baixar(LOGO_APEX.arquivo), baixar(LOGO_CLARO.arquivo)]);
  return { apex, claro };
}
