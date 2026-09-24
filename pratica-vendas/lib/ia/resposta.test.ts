import { describe, it, expect } from 'vitest';
import { extrairTexto } from './resposta';

describe('extrairTexto', () => {
  it('extrai o texto quando o primeiro bloco já é texto', () => {
    const texto = extrairTexto([{ type: 'text', text: 'Oi!' }]);
    expect(texto).toBe('Oi!');
  });

  it('pula um bloco de thinking antes do texto (Sonnet 5 pensa por padrão)', () => {
    const texto = extrairTexto([
      { type: 'thinking', thinking: 'processando...' },
      { type: 'text', text: 'Oi!' },
    ]);
    expect(texto).toBe('Oi!');
  });

  it('junta múltiplos blocos de texto', () => {
    const texto = extrairTexto([
      { type: 'text', text: 'parte 1 ' },
      { type: 'text', text: 'parte 2' },
    ]);
    expect(texto).toBe('parte 1 parte 2');
  });

  it('retorna null quando não há nenhum bloco de texto', () => {
    const texto = extrairTexto([{ type: 'thinking', thinking: 'só isso' }]);
    expect(texto).toBeNull();
  });

  it('retorna null pra lista vazia', () => {
    expect(extrairTexto([])).toBeNull();
  });
});
