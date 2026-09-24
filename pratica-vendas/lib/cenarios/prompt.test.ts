import { describe, it, expect } from 'vitest';
import { construirPromptCliente } from './prompt';

describe('construirPromptCliente', () => {
  it('inclui o título e a descrição do cenário no prompt', () => {
    const prompt = construirPromptCliente({
      titulo: 'Cliente questionou o preço',
      descricao: 'Achou caro.',
      promptIaCliente: 'Reclame do preço.',
    });
    expect(prompt).toContain('Cliente questionou o preço');
    expect(prompt).toContain('Achou caro.');
    expect(prompt).toContain('Reclame do preço.');
  });

  it('instrui a IA a nunca sair do personagem', () => {
    const prompt = construirPromptCliente({
      titulo: 'X',
      descricao: 'Y',
      promptIaCliente: 'Z',
    });
    expect(prompt.toLowerCase()).toContain('nunca saia do personagem');
  });
});
