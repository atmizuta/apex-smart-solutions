import { gerarHashSenha } from './senha';

let hashDummyPromise: Promise<string> | null = null;

// Calculado uma única vez (memoizado), não a cada login — ver login/route.ts.
// Gerar um hash novo por requisição fazia o tempo de resposta variar (bcrypt
// sempre custa o mesmo, mas o hash dummy computado na hora soma um custo que
// um usuário real nunca paga), revelando por timing se o usuário existe.
export function obterHashDummy(): Promise<string> {
  if (!hashDummyPromise) {
    hashDummyPromise = gerarHashSenha('senha-que-nunca-bate');
  }
  return hashDummyPromise;
}
