// Gera e entrega um documento. Só no navegador. As bibliotecas pesadas (docx,
// jspdf, html-to-image) entram por import() dinâmico: só pesam quando alguém
// clica. Usado pela proposta em andamento e pelas propostas salvas.
import type { ModeloDocumento } from "../proposta/modelo-documento";
import { TIPO_DOCX, TIPO_PDF, TIPO_PNG, baixarArquivo, copiarImagem } from "./baixar";
import { nomeDeArquivo } from "./formato";
import { carregarLogos } from "./marca";

export type TipoExportacao = "docx" | "pdf-consultor" | "pdf-cliente" | "png" | "copiar-imagem";

// Devolve um aviso para mostrar ao consultor (ou null). Chame sem nenhum `await`
// antes: no caso "copiar-imagem" a imagem tem de ser pedida no mesmo instante do
// clique, senão o navegador recusa a cópia.
export async function exportarDocumento(tipo: TipoExportacao, modelo: ModeloDocumento): Promise<string | null> {
  const razao = modelo.cliente.razaoSocial;

  if (tipo === "copiar-imagem") {
    const imagem = import("./png").then(({ gerarPng }) => gerarPng(modelo));
    const copiou = await copiarImagem(imagem);
    return copiou
      ? "Imagem copiada. Cole na conversa do WhatsApp."
      : 'Este navegador não deixou copiar a imagem. Use "Baixar PNG" e anexe o arquivo.';
  }

  if (tipo === "png") {
    const { gerarPng } = await import("./png");
    baixarArquivo(await gerarPng(modelo), nomeDeArquivo("comparativo", razao, "png"), TIPO_PNG);
    return null;
  }

  const logos = await carregarLogos();
  if (tipo === "docx") {
    const { gerarDocx } = await import("./docx");
    baixarArquivo(await gerarDocx(modelo, logos), nomeDeArquivo("proposta", razao, "docx"), TIPO_DOCX);
  } else if (tipo === "pdf-consultor") {
    const { gerarPdfConsultor } = await import("./pdf-consultor");
    baixarArquivo(gerarPdfConsultor(modelo, logos), nomeDeArquivo("proposta", razao, "pdf"), TIPO_PDF);
  } else {
    const { gerarPdfCliente } = await import("./pdf-cliente");
    baixarArquivo(gerarPdfCliente(modelo, logos), nomeDeArquivo("proposta_cliente", razao, "pdf"), TIPO_PDF);
  }
  return null;
}
