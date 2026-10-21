export const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const TIPO_PDF = "application/pdf";
export const TIPO_PNG = "image/png";

// Só no navegador: baixa o arquivo por um link temporário.
export function baixarArquivo(conteudo: Blob | Uint8Array, nome: string, tipo: string): void {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([new Uint8Array(conteudo)], { type: tipo });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Copia a imagem para a área de transferência (para colar na conversa do
// WhatsApp Web). Recebe uma PROMESSA da imagem: o Safari só aceita o gesto do
// clique se o ClipboardItem for criado de forma síncrona, antes de a imagem
// ficar pronta. Devolve false quando o navegador não permite.
export async function copiarImagem(imagem: Promise<Blob>): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
      await imagem.catch(() => undefined);
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ [TIPO_PNG]: imagem })]);
    return true;
  } catch {
    return false;
  }
}
