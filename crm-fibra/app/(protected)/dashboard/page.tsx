import { Clock3, Clock9, LayoutGrid, RefreshCw, UserX, Wifi } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { contarPorCamada } from "@/lib/leads";
import { dadosDonutRenovacao } from "@/lib/camadas";
import { KpiCard } from "@/components/kpi-card";
import { RenovacaoDonut } from "@/components/renovacao-donut";

export default async function DashboardPage() {
  const contagem = await contarPorCamada(getSupabaseAdmin());

  const cards = [
    { rotulo: "Candidatos a fibra", valor: contagem.fibraCandidato, href: "/leads?camada=fibra_candidato", Icone: Wifi },
    { rotulo: "Aptos a renovar agora", valor: contagem.aptoAgora, href: "/leads?camada=apto_agora", Icone: RefreshCw },
    { rotulo: "Aptos em 1 mês", valor: contagem.apto1Mes, href: "/leads?camada=apto_1_mes", Icone: Clock3 },
    { rotulo: "Aptos em 2 meses", valor: contagem.apto2Meses, href: "/leads?camada=apto_2_meses", Icone: Clock9 },
    { rotulo: "Sem consultor atribuído", valor: contagem.semDono, href: "/leads?camada=sem_dono", Icone: UserX },
    { rotulo: "Total de clientes na base", valor: contagem.total, href: "/leads?camada=todos", Icone: LayoutGrid },
  ];

  return (
    <div className="space-y-6">
      <h2>Dashboard</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.rotulo} rotulo={c.rotulo} valor={c.valor} href={c.href} Icone={c.Icone} />
        ))}
      </div>
      <RenovacaoDonut dados={dadosDonutRenovacao(contagem)} />
    </div>
  );
}
