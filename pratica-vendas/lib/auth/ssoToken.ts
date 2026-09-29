import { jwtVerify } from 'jose';

function obterSegredo(): Uint8Array {
  const segredo = process.env.SSO_SHARED_SECRET;
  if (!segredo) throw new Error('SSO_SHARED_SECRET não configurada — veja .env.example.');
  return new TextEncoder().encode(segredo);
}

export type DadosTokenSso = { sub: string; nome: string; papel: 'consultor' | 'admin'; jti: string };

// Verifica o token de handoff emitido pela Edge Function do painel. jwtVerify
// já rejeita token expirado (baseado no "exp" do JWT) e assinatura inválida —
// só precisamos validar o formato do payload por cima.
export async function verificarTokenSso(token: string): Promise<DadosTokenSso | null> {
  try {
    const { payload } = await jwtVerify(token, obterSegredo());
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.nome !== 'string' ||
      (payload.papel !== 'consultor' && payload.papel !== 'admin') ||
      typeof payload.jti !== 'string'
    ) {
      return null;
    }
    return { sub: payload.sub, nome: payload.nome, papel: payload.papel, jti: payload.jti };
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes('SSO_SHARED_SECRET')) throw erro;
    return null;
  }
}
