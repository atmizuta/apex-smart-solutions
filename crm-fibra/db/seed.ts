import { getSupabaseAdmin } from "../lib/supabase-admin";
import { criarConsultor, UsernameJaExisteError } from "../lib/consultores";

async function main() {
  const nome = process.env.SEED_ADMIN_NOME || "Administrador";
  const username = process.env.SEED_ADMIN_USERNAME;
  const senha = process.env.SEED_ADMIN_SENHA;

  if (!username || !senha) {
    console.error(
      "Defina SEED_ADMIN_USERNAME e SEED_ADMIN_SENHA no ambiente antes de rodar o seed."
    );
    process.exit(1);
  }

  try {
    const consultor = await criarConsultor(getSupabaseAdmin(), {
      nome,
      username,
      senha,
      papel: "admin",
    });
    console.log(`Admin criado: ${consultor.username} (${consultor.id})`);
  } catch (err) {
    if (err instanceof UsernameJaExisteError) {
      console.log("Admin já existe, nada a fazer.");
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});