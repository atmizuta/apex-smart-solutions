import { describe, it, expect, beforeEach } from 'vitest';
import { SignJWT } from 'jose';
import { verificarTokenSso } from './ssoToken';

const SEGREDO_TESTE = 'segredo-de-teste-com-pelo-menos-32-bytes-aa';

async function assinarTokenTeste(payload: Record<string, unknown>, opts?: { expiraEm?: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(opts?.expiraEm ?? '60s')
    .sign(new TextEncoder().encode(SEGREDO_TESTE));
}

describe('verificarTokenSso', () => {
  beforeEach(() => {
    process.env.SSO_SHARED_SECRET = SEGREDO_TESTE;
  });

  it('retorna os dados do payload pra um token válido', async () => {
    const token = await assinarTokenTeste({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
    const dados = await verificarTokenSso(token);
    expect(dados).toEqual({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
  });

  it('retorna null pra token expirado', async () => {
    const token = await assinarTokenTeste(
      { sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' },
      { expiraEm: '-1s' }
    );
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('retorna null pra token assinado com segredo errado', async () => {
    const token = await new SignJWT({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('60s')
      .sign(new TextEncoder().encode('outro-segredo-completamente-diferente-aa'));
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('retorna null se o payload não tiver os campos esperados', async () => {
    const token = await assinarTokenTeste({ sub: 'joao' }); // falta nome, papel, jti
    const dados = await verificarTokenSso(token);
    expect(dados).toBeNull();
  });

  it('lança erro se SSO_SHARED_SECRET não estiver configurada', async () => {
    delete process.env.SSO_SHARED_SECRET;
    const token = await assinarTokenTeste({ sub: 'joao', nome: 'João', papel: 'consultor', jti: 'abc-123' });
    await expect(verificarTokenSso(token)).rejects.toThrow('SSO_SHARED_SECRET');
  });
});
