import type { SupabaseClient } from "@supabase/supabase-js";
import { hashPassword } from "./auth/password";

export interface Consultor {
  id: string;
  nome: string;
  username: string;
  papel: "admin" | "consultor";
  ativo: boolean;
  criadoEm: string;
  ultimoLogin: string | null;
}

interface ConsultorRow {
  id: string;
  nome: string;
  username: string;
  password_hash: string;
  papel: "admin" | "consultor";
  ativo: boolean;
  criado_em: string;
  ultimo_login: string | null;
}

function toConsultor(row: ConsultorRow): Consultor {
  return {
    id: row.id,
    nome: row.nome,
    username: row.username,
    papel: row.papel,
    ativo: row.ativo,
    criadoEm: row.criado_em,
    ultimoLogin: row.ultimo_login,
  };
}

export class UsernameJaExisteError extends Error {
  constructor(username: string) {
    super(`Já existe um consultor com o usuário "${username}"`);
    this.name = "UsernameJaExisteError";
  }
}

export async function criarConsultor(
  client: SupabaseClient,
  input: { nome: string; username: string; senha: string; papel: "admin" | "consultor" }
): Promise<Consultor> {
  const passwordHash = await hashPassword(input.senha);
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .insert({
      nome: input.nome,
      username: input.username,
      password_hash: passwordHash,
      papel: input.papel,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new UsernameJaExisteError(input.username);
    }
    throw error;
  }
  return toConsultor(data as ConsultorRow);
}

export async function buscarConsultorPorUsername(
  client: SupabaseClient,
  username: string
): Promise<(Consultor & { passwordHash: string }) | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .eq("username", username)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as ConsultorRow;
  return { ...toConsultor(row), passwordHash: row.password_hash };
}

export async function buscarConsultorPorId(
  client: SupabaseClient,
  id: string
): Promise<Consultor | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data ? toConsultor(data as ConsultorRow) : null;
}

export async function listarConsultores(client: SupabaseClient): Promise<Consultor[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .select()
    .order("nome", { ascending: true });

  if (error) throw error;
  return (data as ConsultorRow[]).map(toConsultor);
}

export async function definirAtivo(
  client: SupabaseClient,
  id: string,
  ativo: boolean
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ ativo })
    .eq("id", id);
  if (error) throw error;
}

export async function redefinirSenha(
  client: SupabaseClient,
  id: string,
  novaSenha: string
): Promise<void> {
  const passwordHash = await hashPassword(novaSenha);
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ password_hash: passwordHash })
    .eq("id", id);
  if (error) throw error;
}

export async function registrarLogin(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("consultores")
    .update({ ultimo_login: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
