import { describe, it, expect, beforeAll } from 'vitest';
import { criarTokenSessao, verificarTokenSessao } from './sessao';

beforeAll(() => {
  process.env.SESSION_SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';
});

describe('sessao', () => {
  it('cria e verifica um token válido', async () => {
    const token = await criarTokenSessao({ usuarioId: 'abc-123', papel: 'consultor' });
    const dados = await verificarTokenSessao(token);
    expect(dados).toEqual({ usuarioId: 'abc-123', papel: 'consultor' });
  });

  it('rejeita um token inválido/corrompido', async () => {
    const dados = await verificarTokenSessao('token.invalido.aqui');
    expect(dados).toBeNull();
  });

  it('preserva o papel admin corretamente', async () => {
    const token = await criarTokenSessao({ usuarioId: 'xyz-789', papel: 'admin' });
    const dados = await verificarTokenSessao(token);
    expect(dados?.papel).toBe('admin');
  });
});
