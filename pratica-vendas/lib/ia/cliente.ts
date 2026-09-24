import Anthropic from '@anthropic-ai/sdk';

function obterClienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada — veja .env.example.');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

export async function responderComoCliente(
  promptSistema: string,
  historico: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<string> {
  const anthropic = obterClienteAnthropic();
  const mensagens = historico.map((m) => ({
    role: (m.remetente === 'consultor' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.texto,
  }));

  const resposta = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 300,
    system: promptSistema,
    messages: mensagens,
  });

  const bloco = resposta.content[0];
  return bloco.type === 'text' ? bloco.text : '';
}

export async function avaliarConversa(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ nota: number; feedback: string } | null> {
  const anthropic = obterClienteAnthropic();
  const { construirPromptAvaliacao } = await import('../avaliacao/rubrica');

  try {
    const resposta = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: construirPromptAvaliacao(transcricao) }],
    });
    const bloco = resposta.content[0];
    if (bloco.type !== 'text') return null;
    const dados = JSON.parse(bloco.text);
    if (typeof dados.nota !== 'number' || typeof dados.feedback !== 'string') return null;
    return { nota: dados.nota, feedback: dados.feedback };
  } catch (erro) {
    console.error('Falha ao avaliar conversa:', erro);
    return null;
  }
}
