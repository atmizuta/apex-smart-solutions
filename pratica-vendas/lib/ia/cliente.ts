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

export async function responderComoCliente(
  promptSistema: string,
  historico: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<string> {
  const ai = obterClienteGemini();
  const contents = historico.map((m) => ({
    role: m.remetente === 'consultor' ? ('user' as const) : ('model' as const),
    parts: [{ text: m.texto }],
  }));

  const resposta = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents,
    config: {
      systemInstruction: promptSistema,
      maxOutputTokens: 300,
    },
  });

  const texto = resposta.text;
  if (!texto) {
    throw new Error('Resposta da IA sem texto (possível bloqueio de segurança do Gemini).');
  }
  return texto;
}

export async function avaliarConversa(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ nota: number; feedback: string } | null> {
  try {
    const ai = obterClienteGemini();
    const { construirPromptAvaliacao } = await import('../avaliacao/rubrica');

    const resposta = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: construirPromptAvaliacao(transcricao),
      config: { maxOutputTokens: 500 },
    });

    const texto = resposta.text;
    if (!texto) return null;

    // o Gemini às vezes envolve o JSON em ```json ... ``` mesmo quando pedido
    // "só o JSON" — remove o cercado antes de tentar parsear.
    const textoLimpo = texto.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const dados = JSON.parse(textoLimpo);
    if (typeof dados.nota !== 'number' || typeof dados.feedback !== 'string') return null;
    const notaArredondada = Math.round(dados.nota);
    const notaLimitada = Math.min(100, Math.max(0, notaArredondada));
    return { nota: notaLimitada, feedback: dados.feedback };
  } catch (erro) {
    console.error('Falha ao avaliar conversa:', erro);
    return null;
  }
}
