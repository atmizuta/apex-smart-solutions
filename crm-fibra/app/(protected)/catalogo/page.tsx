import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { agruparPorCategoria, listarCatalogo } from "@/lib/catalogo";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NovoPlanoForm } from "./novo-plano-form";
import { PlanoRow } from "./plano-row";

export default async function CatalogoPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  const planos = await listarCatalogo(admin, { apenasAtivos: false });
  const grupos = agruparPorCategoria(planos);

  return (
    <div className="space-y-8">
      <div>
        <h2>Catálogo de planos</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Planos que os consultores escolhem ao montar uma proposta. Editar o valor aqui não altera
          propostas já salvas; desativar um plano só tira ele da lista de escolha.
        </p>
      </div>

      <NovoPlanoForm />

      {grupos.map((grupo) => (
        <section key={grupo.categoria} className="space-y-2">
          <h3>{grupo.rotulo}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead className="w-36">Valor (R$)</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupo.planos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Nenhum plano nesta categoria.
                  </TableCell>
                </TableRow>
              )}
              {grupo.planos.map((plano) => (
                <PlanoRow key={plano.id} plano={plano} />
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
