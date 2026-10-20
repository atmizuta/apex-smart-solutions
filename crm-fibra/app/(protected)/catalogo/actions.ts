"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarConsultorPorId } from "@/lib/consultores";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  CATEGORIAS_CATALOGO,
  PlanoJaExisteError,
  atualizarPlano,
  categoriaTemFranquia,
  criarPlano,
  definirPlanoAtivo,
  type CategoriaCatalogo,
} from "@/lib/catalogo";
import { parseValorBRL } from "@/lib/formato";

async function exigirAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo || consultor.papel !== "admin") {
    throw new Error("Apenas administradores podem gerenciar o catálogo");
  }
  return consultor;
}

const ERRO_VALOR = "Informe um valor válido, por exemplo 149,90";
const ERRO_FRANQUIA = "Informe a franquia em GB (número inteiro de 1 a 1000)";

// Funções privadas: arquivo "use server" só pode exportar funções assíncronas.
function lerFranquia(categoria: CategoriaCatalogo, texto: string): number | null | "erro" {
  if (!categoriaTemFranquia(categoria)) return null;
  const limpo = texto.trim();
  if (!/^\d{1,4}$/.test(limpo)) return "erro";
  const numero = Number(limpo);
  return numero >= 1 && numero <= 1000 ? numero : "erro";
}

export type CriarPlanoState = { erro?: string; sucesso?: boolean };

export async function criarPlanoAction(
  _prev: CriarPlanoState,
  formData: FormData
): Promise<CriarPlanoState> {
  await exigirAdmin();

  const categoria = String(formData.get("categoria") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const valor = parseValorBRL(String(formData.get("valor") ?? ""));
  const observacao = String(formData.get("observacao") ?? "").trim() || null;

  if (!(CATEGORIAS_CATALOGO as readonly string[]).includes(categoria)) {
    return { erro: "Escolha uma categoria" };
  }
  if (!nome) return { erro: "Informe o nome do plano" };
  if (valor === null) return { erro: ERRO_VALOR };
  const franquiaGb = lerFranquia(categoria as CategoriaCatalogo, String(formData.get("franquia") ?? ""));
  if (franquiaGb === "erro") return { erro: ERRO_FRANQUIA };

  try {
    await criarPlano(getSupabaseAdmin(), {
      categoria: categoria as CategoriaCatalogo,
      nome,
      valor,
      observacao,
      franquiaGb,
    });
  } catch (err) {
    if (err instanceof PlanoJaExisteError) {
      return { erro: err.message };
    }
    throw err;
  }

  revalidatePath("/catalogo");
  return { sucesso: true };
}

export async function atualizarPlanoAction(
  id: string,
  valorTexto: string,
  observacao: string
): Promise<{ erro?: string }> {
  await exigirAdmin();

  const valor = parseValorBRL(valorTexto);
  if (valor === null) return { erro: ERRO_VALOR };

  await atualizarPlano(getSupabaseAdmin(), id, {
    valor,
    observacao: observacao.trim() || null,
  });
  revalidatePath("/catalogo");
  return {};
}

export async function definirPlanoAtivoAction(
  id: string,
  ativo: boolean
): Promise<{ erro?: string }> {
  await exigirAdmin();
  await definirPlanoAtivo(getSupabaseAdmin(), id, ativo);
  revalidatePath("/catalogo");
  return {};
}
