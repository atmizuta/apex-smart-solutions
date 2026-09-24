import { describe, it, expect } from 'vitest';
import { podeIniciarSessao, LIMITE_SESSOES_POR_DIA } from './limiteSessoes';

describe('podeIniciarSessao', () => {
  it('permite quando está abaixo do limite', () => {
    expect(podeIniciarSessao(0)).toBe(true);
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA - 1)).toBe(true);
  });

  it('bloqueia quando atinge o limite', () => {
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA)).toBe(false);
  });

  it('bloqueia quando passa do limite', () => {
    expect(podeIniciarSessao(LIMITE_SESSOES_POR_DIA + 5)).toBe(false);
  });
});
