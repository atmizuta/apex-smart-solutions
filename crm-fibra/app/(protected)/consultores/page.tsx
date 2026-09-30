import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId, listarConsultores } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { NovoConsultorForm } from "./novo-consultor-form";
import { ConsultorRow } from "./consultor-row";

export default async function ConsultoresPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  const consultores = await listarConsultores(admin);

  return (
    <div>
      <h2>Consultores</h2>
      <NovoConsultorForm />
      <table style={{ width: "100%", marginTop: 24, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 12, color: "var(--cinza)" }}>
            <th>Nome</th>
            <th>Usuário</th>
            <th>Papel</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {consultores.map((c) => (
            <ConsultorRow key={c.id} consultor={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
