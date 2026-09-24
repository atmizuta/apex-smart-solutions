import { describe, it, expect } from 'vitest';
import { obterHashDummy } from './hashDummy';

describe('obterHashDummy', () => {
  it('retorna o mesmo hash em chamadas repetidas (calculado uma vez só)', async () => {
    // bcrypt gera um salt novo a cada hash — se não fosse memoizado, duas
    // chamadas dariam hashes diferentes. Isso é o que fecha o vazamento de
    // tempo de resposta: comparar sempre contra o MESMO hash já calculado,
    // nunca gerar um novo na hora do login.
    const a = await obterHashDummy();
    const b = await obterHashDummy();
    expect(a).toBe(b);
  });
});
