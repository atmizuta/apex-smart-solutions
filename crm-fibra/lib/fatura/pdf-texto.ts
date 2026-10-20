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

// A falha é do leitor (navegador antigo sem uma API que o pdf.js usa, worker que
// não carregou), não do arquivo: a tela não pode culpar o PDF do cliente.
export class LeitorPdfIndisponivelError extends Error {
  constructor(public readonly arquivo: string) {
    super(
      `Não foi possível ler "${arquivo}" neste navegador. Clique em Adicionar linha e digite as linhas, ou tente outro navegador.`
    );
    this.name = "LeitorPdfIndisponivelError";
  }
}

// Erros que o pdf.js lança por causa do DOCUMENTO (senha, PDF inválido ou corrompido).
const ERROS_DE_DOCUMENTO = new Set([
  "PasswordException",
  "InvalidPDFException",
  "MissingPDFException",
  "FormatError",
  "XRefParseException",
  "XRefEntryException",
  "ParserEOFException",
]);

// O recorte de pdfjs-dist que usamos. Os testes e o navegador usam a mesma build
// "legacy", que traz polyfills e roda em Node e em navegadores mais antigos.
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
  } catch (err) {
    if (err instanceof Error && ERROS_DE_DOCUMENTO.has(err.name)) throw new FaturaIlegivelError(nomeArquivo);
    throw new LeitorPdfIndisponivelError(nomeArquivo);
  }
}

// Só no navegador. Build "legacy": a moderna usa APIs muito novas (Map.getOrInsertComputed,
// Math.sumPrecise) sem polyfill e falharia em navegadores de consultores com versão antiga.
export async function lerTextoDoArquivo(arquivo: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
  }
  const dados = new Uint8Array(await arquivo.arrayBuffer());
  return extrairTextoDePaginas(pdfjs as unknown as PdfjsMinimo, dados, arquivo.name);
}
