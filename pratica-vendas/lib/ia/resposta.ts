type BlocoConteudo = { type: string; text?: string; thinking?: string };

// Sonnet 5 roda "adaptive thinking" por padrão, mesmo sem o parâmetro `thinking`
// (confirmado via skill claude-api) — a resposta pode vir com um bloco `thinking`
// ANTES do bloco de texto. Ler só content[0] quebra tanto o roleplay quanto a
// avaliação sempre que isso acontece. Esta função ignora blocos que não são texto
// e junta todos os blocos de texto, não só o primeiro.
export function extrairTexto(content: BlocoConteudo[]): string | null {
  const textos = content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string);
  if (textos.length === 0) return null;
  return textos.join('');
}
