import { sql } from './client';

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
