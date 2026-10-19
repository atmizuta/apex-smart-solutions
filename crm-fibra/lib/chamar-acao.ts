export const ERRO_DE_TRANSPORTE =
  "Não foi possível falar com o servidor. Recarregue a página e tente de novo.";

// Chamar uma Server Action pode falhar antes de chegar no código dela: rede
// que cai, 504 da Vercel, aba aberta de um deploy antigo. A promessa então é
// rejeitada e, dentro de um startTransition, o React manda isso para o error
// boundary — a página inteira vira "Application error" e o consultor perde o
// que estava na tela. `repassarErroDoNext` (unstable_rethrow) relança só os
// erros de fluxo do Next (redirect, notFound); o resto vira mensagem.
export async function chamarAcaoComSeguranca(
  chamar: () => Promise<{ erro?: string }>,
  repassarErroDoNext: (erro: unknown) => void
): Promise<{ erro?: string }> {
  try {
    return await chamar();
  } catch (erro) {
    repassarErroDoNext(erro);
    return { erro: ERRO_DE_TRANSPORTE };
  }
}
