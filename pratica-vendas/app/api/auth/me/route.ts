import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarUsuarioPorId } from '@/db/usuarios';

export async function GET(req: NextRequest) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const usuario = await buscarUsuarioPorId(dados.usuarioId);
  if (!usuario) return NextResponse.json({ erro: 'Usuário não encontrado.' }, { status: 404 });

  return NextResponse.json({ nome: usuario.nome, papel: usuario.papel });
}
