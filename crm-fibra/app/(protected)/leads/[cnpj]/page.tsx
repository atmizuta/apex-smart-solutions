import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";
import { listarCatalogo } from "@/lib/catalogo";
import { listarConsultores } from "@/lib/consultores";
import { listarPropostasPorCnpj } from "@/lib/propostas";
import { normalizarTelefone } from "@/lib/whatsapp";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AbaCliente } from "./aba-cliente";
import { AbaLinhas } from "./aba-linhas";
import { AbaProposta } from "./aba-proposta";

// forceMount mantém as três abas montadas: o rascunho de proposta e os
// formulários não podem perder o que foi digitado ao trocar de aba.
const CONTEUDO_DA_ABA = "data-[state=inactive]:hidden";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ cnpj: string }>;
}) {
  const { cnpj } = await params;
  const admin = getSupabaseAdmin();

  const lead = await buscarLeadPorCnpj(admin, cnpj);
  if (!lead) notFound();

  const [mensagens, propostas, catalogo, consultores] = await Promise.all([
    listarMensagens(admin, cnpj),
    listarPropostasPorCnpj(admin, cnpj),
    listarCatalogo(admin, { apenasAtivos: true }),
    listarConsultores(admin),
  ]);
  const nomesConsultores = Object.fromEntries(consultores.map((c) => [c.id, c.nome]));
  const telefone = normalizarTelefone({
    ddd: lead.ddd,
    tel1: lead.tel1,
    tel2: lead.tel2,
    telefoneContato: lead.telefoneContato,
  });

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const souODono = session != null && lead.donoConsultorId === session.consultorId;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Carteira de Leads
        </Link>
        <h2 className="mt-2">{lead.razaoSocial || lead.cnpjDigits}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          CNPJ {lead.cnpjDigits}
          {lead.cidade ? ` · ${lead.cidade}` : ""}
        </p>
      </div>

      <Tabs defaultValue="cliente">
        <TabsList>
          <TabsTrigger value="cliente">Cliente</TabsTrigger>
          <TabsTrigger value="linhas">Linhas</TabsTrigger>
          <TabsTrigger value="proposta">Proposta</TabsTrigger>
        </TabsList>
        <TabsContent value="cliente" forceMount className={CONTEUDO_DA_ABA}>
          <AbaCliente lead={lead} mensagens={mensagens} telefone={telefone} souODono={souODono} />
        </TabsContent>
        <TabsContent value="linhas" forceMount className={CONTEUDO_DA_ABA}>
          <AbaLinhas lead={lead} />
        </TabsContent>
        <TabsContent value="proposta" forceMount className={CONTEUDO_DA_ABA}>
          <AbaProposta
            cnpjDigits={lead.cnpjDigits}
            catalogo={catalogo}
            propostas={propostas}
            nomesConsultores={nomesConsultores}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
