import { sql } from './client';
import { gerarHashSenha } from '../lib/auth/senha';

export type Usuario = { id: string; nome: string; usuario: string; senhaHash: string; papel: 'consultor' | 'admin' };

type LinhaUsuario = { id: string; nome: string; usuario: string; senha_hash: string; papel: string };

function mapearUsuario(l: LinhaUsuario): Usuario {
  return { id: l.id, nome: l.nome, usuario: l.usuario, senhaHash: l.senha_hash, papel: l.papel as 'consultor' | 'admin' };
}

export async function buscarUsuarioPorLogin(usuario: string): Promise<Usuario | null> {
  const linhas = await sql<LinhaUsuario[]>`
    select id, nome, usuario, senha_hash, papel from usuarios where usuario = ${usuario}
  `;
  if (linhas.length === 0) return null;
  return mapearUsuario(linhas[0]);
}

export async function buscarUsuarioPorId(id: string): Promise<Usuario | null> {
  const linhas = await sql<LinhaUsuario[]>`
    select id, nome, usuario, senha_hash, papel from usuarios where id = ${id}
  `;
  if (linhas.length === 0) return null;
  return mapearUsuario(linhas[0]);
}

export async function criarUsuario(nome: string, usuario: string, senhaHash: string, papel: 'consultor' | 'admin') {
  await sql`insert into usuarios (nome, usuario, senha_hash, papel) values (${nome}, ${usuario}, ${senhaHash}, ${papel})`;
}

// Usado pelo login automático via SSO (painel -> pratica-vendas): acha a
// conta existente pelo mesmo "usuario" do painel, ou cria uma nova na
// primeira vez. A senha gerada é aleatória e nunca é informada a ninguém —
// essa conta só entra via SSO, não por usuário/senha manual.
export async function buscarOuCriarUsuarioPorUsername(
  usuario: string,
  nome: string,
  papel: 'consultor' | 'admin'
): Promise<Usuario> {
  const existente = await buscarUsuarioPorLogin(usuario);
  if (existente) return existente;

  const senhaAleatoriaInutilizavel = await gerarHashSenha(crypto.randomUUID());
  const linhas = await sql<LinhaUsuario[]>`
    insert into usuarios (nome, usuario, senha_hash, papel)
    values (${nome}, ${usuario}, ${senhaAleatoriaInutilizavel}, ${papel})
    returning id, nome, usuario, senha_hash, papel
  `;
  return mapearUsuario(linhas[0]);
}
