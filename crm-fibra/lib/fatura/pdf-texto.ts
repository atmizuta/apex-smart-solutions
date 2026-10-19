// Leitura do texto de um PDF de fatura, toda no navegador: o arquivo nunca
// vai ao servidor. `pdfjs-dist` só é carregado quando o consultor anexa algo.
export const LIMITE_ARQUIVOS = 6;
export const LIMITE_BYTES = 10 * 1024 * 1024;

export interface ArquivoInfo {
  name: string;
  size: number;
  type: string;
}

export function validarArquivos(arquivos: ArquivoInfo[]): string | null {
  if (arquivos.length === 0) return "Escolha pelo menos um PDF";
  if (arquivos.length > LIMITE_ARQUIVOS) {
    return `Anexe no máximo ${LIMITE_ARQUIVOS} faturas por vez`;
  }
  for (const arquivo of arquivos) {
    const ehPdf = arquivo.type === "application/pdf" || arquivo.name.toLowerCase().endsWith(".pdf");
    if (!ehPdf) return `"${arquivo.name}" não é PDF. A leitura automática só aceita PDF`;
    if (arquivo.size === 0) return `"${arquivo.name}" está vazio`;
    if (arquivo.size > LIMITE_BYTES) return `"${arquivo.name}" passa de 10 MB`;
  }
  return null;
}

export class FaturaIlegivelError extends Error {
  constructor(public readonly arquivo: string) {
    super(`Não foi possível ler "${arquivo}": o PDF está protegido, corrompido ou não é uma fatura.`);
    this.name = "FaturaIlegivelError";
  }
}

// O recorte de pdfjs-dist que usamos. Os testes injetam a build "legacy" (que
// roda em Node); o navegador injeta a build normal.
export interface PdfjsMinimo {
  getDocument(opcoes: { data: Uint8Array } & Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(numero: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
}

export async function extrairTextoDePaginas(
  pdfjs: PdfjsMinimo,
  dados: Uint8Array,
  nomeArquivo: string,
  opcoesExtras: Record<string, unknown> = {}
): Promise<string> {
  try {
    // O pdf.js destrói (transfere) o buffer que recebe: passa uma cópia.
    const pdf = await pdfjs.getDocument({ data: dados.slice(), isEvalSupported: false, ...opcoesExtras })
      .promise;
    const paginas: string[] = [];
    for (let numero = 1; numero <= pdf.numPages; numero++) {
      const pagina = await pdf.getPage(numero);
      const conteudo = await pagina.getTextContent();
      paginas.push(conteudo.items.map((item) => item.str ?? "").join(" "));
    }
    await pdf.destroy?.();
    return paginas.join("\n");
  } catch {
    throw new FaturaIlegivelError(nomeArquivo);
  }
}

// Só no navegador.
export async function lerTextoDoArquivo(arquivo: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  return extrairTextoDePaginas(pdfjs as unknown as PdfjsMinimo, dados, arquivo.name);
}
