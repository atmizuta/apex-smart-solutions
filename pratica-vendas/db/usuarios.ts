import { sql } from './client';

export type Usuario = { id: string; nome: string; usuario: string; senhaHash: string; papel: 'consultor' | 'admin' };

export async function buscarUsuarioPorLogin(usuario: string): Promise<Usuario | null> {
  const linhas = await sql<{ id: string; nome: string; usuario: string; senha_hash: string; papel: string }[]>`
    select id, nome, usuario, senha_hash, papel from usuarios where usuario = ${usuario}
  `;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, nome: l.nome, usuario: l.usuario, senhaHash: l.senha_hash, papel: l.papel as 'consultor' | 'admin' };
}

export async function criarUsuario(nome: string, usuario: string, senhaHash: string, papel: 'consultor' | 'admin') {
  await sql`insert into usuarios (nome, usuario, senha_hash, papel) values (${nome}, ${usuario}, ${senhaHash}, ${papel})`;
}
