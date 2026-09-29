import { GoogleGenAI } from '@google/genai';

// Trocado de Anthropic pra Gemini (Google AI Studio) a pedido do Rafael —
// a API da Anthropic exige crédito pago, o Gemini tem nível gratuito sem
// cartão de crédito. As funções exportadas (responderComoCliente,
// avaliarConversa) mantêm a mesma assinatura, então nada mais no app
// precisou mudar.

function obterClienteGemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY não configurada — veja .env.example.');
  }
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

// O nível gratuito do Gemini retorna 503 "high demand" com frequência,
// mesmo em modelos "lite". Sem retry, qualquer pico momentâneo de carga
// da Google já aparece como falha pro consultor no meio da prática.
async function comRetry<T>(chamar: () => Promise<T>, tentativas = 4): Promise<T> {
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < tentativas; tentativa++) {
    try {
      return await chamar();
    } catch (erro) {
      ultimoErro = erro;
      const sobrecarregado =
        erro instanceof Error && /"code":503|UNAVAILABLE/.test(erro.message);
      if (!sobrecarregado || tentativa === tentativas - 1) throw erro;
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** tentativa));
    }
  }
  throw ultimoErro;
}

export async function responderComoCliente(
  promptSistema: string,
  historico: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ resposta: string; dica: string | null }> {
  const ai = obterClienteGemini();
  const contents = historico.map((m) => ({
    role: m.remetente === 'consultor' ? ('user' as const) : ('model' as const),
    parts: [{ text: m.texto }],
  }));

  const resposta = await comRetry(() =>
    ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents,
      config: {
        systemInstruction: promptSistema,
        maxOutputTokens: 400,
        thinkingConfig: { thinkingBudget: 0 },
      },
    })
  );

  const texto = resposta.text;
  if (!texto) {
    throw new Error('Resposta da IA sem texto (possível bloqueio de segurança do Gemini).');
  }

  // o prompt pede JSON com resposta+dica (pra dar dica em tempo real sem
  // gastar uma segunda chamada de IA — a quota gratuita já é curta). Se por
  // algum motivo vier fora do formato, trata o texto todo como a fala do
  // cliente e ignora dica, pro chat nunca quebrar por causa da dica.
  const textoLimpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    const dados = JSON.parse(textoLimpo);
    if (typeof dados.resposta === 'string') {
      const dica = typeof dados.dica === 'string' && dados.dica.trim() ? dados.dica.trim() : null;
      return { resposta: dados.resposta, dica };
    }
  } catch {
    // não era JSON — segue com o texto cru abaixo.
  }
  return { resposta: texto, dica: null };
}

export async function avaliarConversa(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ nota: number; feedback: string; dicas: string[] } | null> {
  try {
    const ai = obterClienteGemini();
    const { construirPromptAvaliacao } = await import('../avaliacao/rubrica');

    const resposta = await comRetry(() =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: construirPromptAvaliacao(transcricao),
        config: { maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } },
      })
    );

    const texto = resposta.text;
    if (!texto) return null;

    // o Gemini às vezes envolve o JSON em ```json ... ``` mesmo quando pedido
    // "só o JSON" — remove o cercado antes de tentar parsear.
    const textoLimpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const dados = JSON.parse(textoLimpo);
    if (typeof dados.nota !== 'number' || typeof dados.feedback !== 'string') return null;
    const notaArredondada = Math.round(dados.nota);
    const notaLimitada = Math.min(100, Math.max(0, notaArredondada));
    const dicas = Array.isArray(dados.dicas) ? dados.dicas.filter((d: unknown) => typeof d === 'string') : [];
    return { nota: notaLimitada, feedback: dados.feedback, dicas };
  } catch (erro) {
    console.error('Falha ao avaliar conversa:', erro);
    return null;
  }
}
