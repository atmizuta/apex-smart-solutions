import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarConsultorPorUsername, registrarLogin } from "@/lib/consultores";
import { verifyPassword, DUMMY_HASH } from "@/lib/auth/password";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const senha = typeof body?.senha === "string" ? body.senha : "";

  if (!username || !senha) {
    return NextResponse.json(
      { erro: "Usuário e senha são obrigatórios" },
      { status: 400 }
    );
  }

  const client = getSupabaseAdmin();
  const consultor = await buscarConsultorPorUsername(client, username);

  // Always run a bcrypt compare, even when the user doesn't exist, so a
  // "usuário não encontrado" response takes the same code path as a
  // "senha errada" response.
  const senhaCorreta = await verifyPassword(senha, consultor?.passwordHash ?? DUMMY_HASH);

  if (!consultor || !senhaCorreta || !consultor.ativo) {
    return NextResponse.json({ erro: "Usuário ou senha inválidos" }, { status: 401 });
  }

  await registrarLogin(client, consultor.id);

  const token = await createSessionToken({
    consultorId: consultor.id,
    papel: consultor.papel,
  });

  const response = NextResponse.json({
    id: consultor.id,
    nome: consultor.nome,
    papel: consultor.papel,
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
  return response;
}
