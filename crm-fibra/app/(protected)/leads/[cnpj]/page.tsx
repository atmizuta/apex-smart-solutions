import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";
import { normalizarTelefone } from "@/lib/whatsapp";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { AtribuirButton } from "./atribuir-button";
import { NovaMensagemForm } from "./nova-mensagem-form";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ cnpj: string }>;
}) {
  const { cnpj } = await params;
  const admin = getSupabaseAdmin();

  const lead = await buscarLeadPorCnpj(admin, cnpj);
  if (!lead) notFound();

  const mensagens = await listarMensagens(admin, cnpj);
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
    <div>
      <h2>{lead.razaoSocial || lead.cnpjDigits}</h2>
      <div style={{ display: "flex", gap: 24, fontSize: 13, color: "var(--cinza)", marginBottom: 16, flexWrap: "wrap" }}>
        <span>CNPJ: {lead.cnpjDigits}</span>
        <span>Cidade: {lead.cidade ?? "-"}</span>
        <span>ARPU: {lead.arpu != null ? `R$ ${lead.arpu.toFixed(2)}` : "-"}</span>
        <span>{lead.cepCabeado ?? "-"}</span>
        <span>Renovação: {lead.aptoRenovacao ?? "-"}</span>
      </div>

      {!lead.donoConsultorId && <AtribuirButton cnpjDigits={lead.cnpjDigits} />}
      {lead.donoConsultorId && !souODono && (
        <p style={{ fontSize: 13, color: "var(--cinza)" }}>Este lead já está atribuído a outro consultor.</p>
      )}

      {souODono ? (
        telefone ? (
          <NovaMensagemForm cnpjDigits={lead.cnpjDigits} telefone={telefone} />
        ) : (
          <div style={{ fontSize: 13, color: "var(--sinal)", marginBottom: 16 }}>
            <p style={{ margin: "0 0 4px" }}>
              Nenhum telefone válido encontrado — contato precisa ser manual.
            </p>
            {(lead.tel1 || lead.tel2 || lead.telefoneContato || lead.email) && (
              <p style={{ margin: 0, color: "var(--cinza)" }}>
                {lead.tel1 && `Tel 1: ${lead.tel1} `}
                {lead.tel2 && `Tel 2: ${lead.tel2} `}
                {lead.telefoneContato && `Contato: ${lead.telefoneContato} `}
                {lead.email && `E-mail: ${lead.email}`}
              </p>
            )}
          </div>
        )
      ) : (
        !lead.donoConsultorId && (
          <p style={{ fontSize: 13, color: "var(--cinza)", marginBottom: 16 }}>
            Atribua este lead a você para poder registrar contato.
          </p>
        )
      )}

      <h3 style={{ marginTop: 24 }}>Histórico de mensagens</h3>
      {mensagens.length === 0 && (
        <p style={{ color: "var(--cinza)", fontSize: 13 }}>Nenhuma mensagem registrada ainda.</p>
      )}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {mensagens.map((m) => (
          <li key={m.id} style={{ borderLeft: "3px solid var(--sinal)", padding: "8px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "var(--cinza)", textTransform: "uppercase" }}>
              {m.canal} · {new Date(m.enviadoEm).toLocaleString("pt-BR")}
            </div>
            <div style={{ fontSize: 13 }}>{m.conteudo}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
