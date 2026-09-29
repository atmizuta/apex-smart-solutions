import { sql } from './client';

// jti = "JWT ID", um identificador aleatório único por token de SSO emitido
// pela Edge Function do painel. Sem essa checagem, copiar/reabrir a mesma
// URL de login automático (ex.: histórico do navegador) logaria de novo
// silenciosamente, mesmo com o token ainda dentro dos 60s de validade.
export async function jtiJaUsado(jti: string): Promise<boolean> {
  const linhas = await sql<{ jti: string }[]>`select jti from sso_tokens_usados where jti = ${jti}`;
  return linhas.length > 0;
}

export async function registrarJtiUsado(jti: string): Promise<void> {
  await sql`insert into sso_tokens_usados (jti) values (${jti}) on conflict (jti) do nothing`;
}
