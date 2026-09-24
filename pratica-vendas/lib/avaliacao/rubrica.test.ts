import { describe, it, expect } from 'vitest';
import { construirPromptAvaliacao, CRITERIOS_RUBRICA } from './rubrica';

describe('rubrica', () => {
  it('tem exatamente os 6 critérios da spec', () => {
    expect(CRITERIOS_RUBRICA).toHaveLength(6);
  });

  it('construirPromptAvaliacao inclui todos os critérios', () => {
    const prompt = construirPromptAvaliacao([{ remetente: 'consultor', texto: 'Oi!' }]);
    CRITERIOS_RUBRICA.forEach((criterio) => {
      expect(prompt).toContain(criterio);
    });
  });

  it('construirPromptAvaliacao inclui a transcrição formatada', () => {
    const prompt = construirPromptAvaliacao([
      { remetente: 'consultor', texto: 'Oi, tudo bem?' },
      { remetente: 'ia', texto: 'Tudo sim.' },
    ]);
    expect(prompt).toContain('CONSULTOR: Oi, tudo bem?');
    expect(prompt).toContain('CLIENTE: Tudo sim.');
  });

  it('construirPromptAvaliacao pede nota de 0 a 100 em JSON', () => {
    const prompt = construirPromptAvaliacao([{ remetente: 'consultor', texto: 'Oi!' }]);
    expect(prompt).toContain('"nota"');
    expect(prompt).toContain('"feedback"');
  });
});
