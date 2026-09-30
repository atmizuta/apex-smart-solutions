import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listarLeadsSegmentados, type FiltroCamada } from "@/lib/leads";
import { FiltroBar } from "./filtro-bar";

const CAMADAS_VALIDAS: FiltroCamada[] = [
  "fibra_candidato",
  "apto_agora",
  "apto_1_mes",
  "apto_2_meses",
  "sem_dono",
  "todos",
];

function normalizarFiltro(valor: string | undefined): FiltroCamada {
  return CAMADAS_VALIDAS.includes(valor as FiltroCamada) ? (valor as FiltroCamada) : "todos";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ camada?: string; busca?: string }>;
}) {
  const params = await searchParams;
  const filtro = normalizarFiltro(params.camada);
  const busca = params.busca ?? "";

  const leads = await listarLeadsSegmentados(getSupabaseAdmin(), filtro, busca || undefined);

  return (
    <div>
      <h2>Carteira de leads</h2>
      <FiltroBar filtroAtual={filtro} buscaAtual={busca} />
      <p style={{ color: "var(--cinza)", fontSize: 13 }}>{leads.length} resultado(s)</p>
      <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 12, color: "var(--cinza)" }}>
            <th>Razão Social</th>
            <th>Cidade</th>
            <th>ARPU</th>
            <th>Dono</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.cnpjDigits}>
              <td>
                <Link href={`/leads/${l.cnpjDigits}`}>{l.razaoSocial || l.cnpjDigits}</Link>
              </td>
              <td>{l.cidade ?? "-"}</td>
              <td>{l.arpu != null ? `R$ ${l.arpu.toFixed(2)}` : "-"}</td>
              <td>{l.donoConsultorId ? "Atribuído" : "Sem dono"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
