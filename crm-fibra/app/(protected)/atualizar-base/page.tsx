import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export default async function AtualizarBasePage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div>
      <h2>Atualizar base</h2>
      <p className="mt-3 max-w-prose text-sm text-muted-foreground">
        Em breve: upload de planilha para atualizar a base de clientes
        diretamente por aqui, com validação e preview antes de confirmar.
      </p>
    </div>
  );
}
