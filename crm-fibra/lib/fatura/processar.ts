// Lê várias faturas, UMA POR VEZ (seis PDFs grandes lidos em paralelo travariam a
// aba) e devolve o resultado por arquivo, para a tela dizer qual deu certo e qual
// não. Uma fatura ilegível não derruba as outras. `lerTexto` é injetado: no
// navegador é lerTextoDoArquivo; nos testes, um texto pronto.
import { interpretarLeitura, mensagemDeLeitura, type LinhaLida } from "./extrair";
import { mesclarFaturas, type LinhaMesclada } from "./mesclar";
import { FaturaIlegivelError, validarArquivos, type ArquivoInfo } from "./pdf-texto";

export type StatusArquivo = "ok" | "sem_texto" | "sem_linhas" | "ilegivel";

export interface ResultadoArquivo {
  nome: string;
  status: StatusArquivo;
  linhas: number;
  mensagem: string | null;
}

export interface ResultadoFaturas {
  arquivos: ResultadoArquivo[];
  // O número completo das linhas só existe aqui dentro: quem recebe converte logo
  // com paraLinhasAtuais() e o descarta.
  mescladas: LinhaMesclada[];
  faturasLidas: number;
  erro: string | null;
}

export async function processarFaturas<A extends ArquivoInfo>(
  arquivos: A[],
  lerTexto: (arquivo: A) => Promise<string>,
  aoIniciar?: (indice: number, total: number, nome: string) => void
): Promise<ResultadoFaturas> {
  const erro = validarArquivos(arquivos);
  if (erro) return { arquivos: [], mescladas: [], faturasLidas: 0, erro };

  const resultados: ResultadoArquivo[] = [];
  const listas: LinhaLida[][] = [];

  for (const [indice, arquivo] of arquivos.entries()) {
    aoIniciar?.(indice + 1, arquivos.length, arquivo.name);
    try {
      const leitura = interpretarLeitura(await lerTexto(arquivo));
      if (leitura.tipo === "ok") {
        listas.push(leitura.linhas);
        resultados.push({ nome: arquivo.name, status: "ok", linhas: leitura.linhas.length, mensagem: null });
      } else {
        resultados.push({
          nome: arquivo.name,
          status: leitura.tipo,
          linhas: 0,
          mensagem: mensagemDeLeitura(arquivo.name, leitura),
        });
      }
    } catch (err) {
      resultados.push({
        nome: arquivo.name,
        status: "ilegivel",
        linhas: 0,
        // Só a mensagem do nosso próprio erro; qualquer outro detalhe pode ter dado do cliente.
        mensagem: err instanceof FaturaIlegivelError ? err.message : `Não foi possível ler "${arquivo.name}".`,
      });
    }
  }

  return { arquivos: resultados, mescladas: mesclarFaturas(listas), faturasLidas: listas.length, erro: null };
}
