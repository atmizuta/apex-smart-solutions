import { describe, it, expect } from 'vitest';
import { gerarHashSenha, verificarSenha } from './senha';

describe('senha', () => {
  it('gerarHashSenha produz um hash diferente do texto original', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(hash).not.toBe('minhaSenha123');
  });

  it('verificarSenha retorna true pra senha correta', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(await verificarSenha('minhaSenha123', hash)).toBe(true);
  });

  it('verificarSenha retorna false pra senha errada', async () => {
    const hash = await gerarHashSenha('minhaSenha123');
    expect(await verificarSenha('outraSenha', hash)).toBe(false);
  });
});
