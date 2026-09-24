import Anthropic from '@anthropic-ai/sdk';
import { extrairTexto } from './resposta';

function obterClienteAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada — veja .env.example.');
  }
  // timeout/maxRetries explícitos: o padrão do SDK (10 min, 2 retries) estoura
  // o limite de execução de uma function serverless (Vercel) muito antes de
  // desistir, deixando o consultor esperando sem nenhuma resposta.
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 1 });
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
    // Sonnet 5 roda "adaptive thinking" por padrão mesmo sem este parâmetro —
    // desligado explicitamente: um roleplay curto de WhatsApp não precisa de
    // raciocínio estendido, e isso evita ter que filtrar blocos de thinking.
    thinking: { type: 'disabled' },
    system: promptSistema,
    messages: mensagens,
  });

  const texto = extrairTexto(resposta.content);
  if (texto === null) {
    throw new Error(`Resposta da IA sem nenhum bloco de texto (stop_reason: ${resposta.stop_reason}).`);
  }
  return texto;
}

export async function avaliarConversa(
  transcricao: { remetente: 'consultor' | 'ia'; texto: string }[]
): Promise<{ nota: number; feedback: string } | null> {
  try {
    const anthropic = obterClienteAnthropic();
    const { construirPromptAvaliacao } = await import('../avaliacao/rubrica');

    const resposta = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: construirPromptAvaliacao(transcricao) }],
    });
    const texto = extrairTexto(resposta.content);
    if (texto === null) return null;
    const dados = JSON.parse(texto);
    if (typeof dados.nota !== 'number' || typeof dados.feedback !== 'string') return null;
    const notaArredondada = Math.round(dados.nota);
    const notaLimitada = Math.min(100, Math.max(0, notaArredondada));
    return { nota: notaLimitada, feedback: dados.feedback };
  } catch (erro) {
    console.error('Falha ao avaliar conversa:', erro);
    return null;
  }
}
