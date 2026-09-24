import { SignJWT, jwtVerify } from 'jose';

function obterSegredo(): Uint8Array {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error('SESSION_SECRET não configurada — veja .env.example.');
  return new TextEncoder().encode(segredo);
}

export type DadosSessao = { usuarioId: string; papel: 'consultor' | 'admin' };

export async function criarTokenSessao(dados: DadosSessao): Promise<string> {
  return new SignJWT({ ...dados })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(obterSegredo());
}

export async function verificarTokenSessao(token: string): Promise<DadosSessao | null> {
  try {
    const { payload } = await jwtVerify(token, obterSegredo());
    if (typeof payload.usuarioId !== 'string' || typeof payload.papel !== 'string') return null;
    return { usuarioId: payload.usuarioId, papel: payload.papel as DadosSessao['papel'] };
  } catch {
    return null;
  }
}
