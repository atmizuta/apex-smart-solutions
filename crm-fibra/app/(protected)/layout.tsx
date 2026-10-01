import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { TopBar } from "./top-bar";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    redirect("/login");
  }

  // Authoritative check: even a still-valid, correctly-signed JWT is
  // rejected if the consultor was deactivated since it was issued. This
  // runs on every request to a protected page, unlike the middleware
  // (Task 9), which only checks the token's signature/expiry for speed.
  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo) {
    redirect("/login");
  }

  return (
    <div>
      <TopBar nome={consultor.nome} papel={consultor.papel} />
      <main style={{ padding: "24px" }}>{children}</main>
    </div>
  );
}
