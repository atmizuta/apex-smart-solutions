import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { contarPorCamada } from "@/lib/leads";

export default async function DashboardPage() {
  const contagem = await contarPorCamada(getSupabaseAdmin());

  const cards = [
    { label: "Candidatos a fibra", valor: contagem.fibraCandidato, href: "/leads?camada=fibra_candidato" },
    { label: "Aptos a renovar agora", valor: contagem.aptoAgora, href: "/leads?camada=apto_agora" },
    { label: "Aptos em 1 mês", valor: contagem.apto1Mes, href: "/leads?camada=apto_1_mes" },
    { label: "Aptos em 2 meses", valor: contagem.apto2Meses, href: "/leads?camada=apto_2_meses" },
    { label: "Sem consultor atribuído", valor: contagem.semDono, href: "/leads?camada=sem_dono" },
    { label: "Total de clientes na base", valor: contagem.total, href: "/leads?camada=todos" },
  ];

  return (
    <div>
      <h2>Dashboard</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 20 }}>
        {cards.map((c) => (
          <a
            key={c.label}
            href={c.href}
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #e2e2e4",
              borderRadius: 8,
              padding: "16px 18px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ fontFamily: "var(--font-head)", fontSize: 30, fontWeight: 600, color: "var(--sinal)" }}>
              {c.valor}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--cinza)", marginTop: 4 }}>{c.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
