"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  criarConsultor,
  definirAtivo,
  redefinirSenha,
  UsernameJaExisteError,
  buscarConsultorPorId,
} from "@/lib/consultores";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

async function exigirAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo || consultor.papel !== "admin") {
    throw new Error("Apenas administradores podem gerenciar consultores");
  }
}

export type CriarConsultorState = { erro?: string; sucesso?: boolean };

export async function criarConsultorAction(
  _prev: CriarConsultorState,
  formData: FormData
): Promise<CriarConsultorState> {
  await exigirAdmin();

  const nome = String(formData.get("nome") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const senha = String(formData.get("senha") ?? "");
  const papel = formData.get("papel") === "admin" ? "admin" : "consultor";

  if (!nome || !username || senha.length < 8) {
    return { erro: "Nome, usuário e senha (mín. 8 caracteres) são obrigatórios" };
  }

  try {
    await criarConsultor(getSupabaseAdmin(), { nome, username, senha, papel });
  } catch (err) {
    if (err instanceof UsernameJaExisteError) {
      return { erro: err.message };
    }
    throw err;
  }

  revalidatePath("/consultores");
  return { sucesso: true };
}

export async function definirAtivoAction(id: string, ativo: boolean): Promise<void> {
  await exigirAdmin();
  await definirAtivo(getSupabaseAdmin(), id, ativo);
  revalidatePath("/consultores");
}

export async function redefinirSenhaAction(
  id: string,
  novaSenha: string
): Promise<{ erro?: string }> {
  await exigirAdmin();
  if (novaSenha.length < 8) {
    return { erro: "A senha precisa ter pelo menos 8 caracteres" };
  }
  await redefinirSenha(getSupabaseAdmin(), id, novaSenha);
  return {};
}
