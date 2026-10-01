import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { listarLeadsSegmentados, TAMANHO_PAGINA_PADRAO, type FiltroCamada } from "@/lib/leads";
import { listarConsultores } from "@/lib/consultores";
import { hrefCarteiraPagina, paginasParaExibir } from "@/lib/leads-urls";
import { FiltroBar } from "./filtro-bar";
import { CamadaBadges } from "@/components/camada-badges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

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

function normalizarPagina(valor: string | undefined): number {
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
}

function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ camada?: string; busca?: string; pagina?: string }>;
}) {
  const params = await searchParams;
  const filtro = normalizarFiltro(params.camada);
  const busca = params.busca ?? "";
  const pagina = normalizarPagina(params.pagina);

  const admin = getSupabaseAdmin();
  const [{ leads, total }, consultores] = await Promise.all([
    listarLeadsSegmentados(admin, filtro, busca || undefined, pagina),
    listarConsultores(admin),
  ]);
  const nomePorConsultorId = new Map(consultores.map((c) => [c.id, c.nome]));
  const totalPaginas = Math.max(Math.ceil(total / TAMANHO_PAGINA_PADRAO), 1);

  return (
    <div>
      <h2>Carteira de leads</h2>
      <FiltroBar filtroAtual={filtro} buscaAtual={busca} />
      <p className="text-sm text-muted-foreground">{total} resultado(s)</p>
      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>Razão Social</TableHead>
            <TableHead>Cidade</TableHead>
            <TableHead>ARPU</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dono</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((l) => (
            <TableRow key={l.cnpjDigits}>
              <TableCell>
                <Link href={`/leads/${l.cnpjDigits}`} className="font-medium hover:underline">
                  {l.razaoSocial || l.cnpjDigits}
                </Link>
              </TableCell>
              <TableCell>{l.cidade ?? "-"}</TableCell>
              <TableCell>{l.arpu != null ? `R$ ${l.arpu.toFixed(2)}` : "-"}</TableCell>
              <TableCell>
                <CamadaBadges camadaFibra={l.camadaFibra} camadaRenovacao={l.camadaRenovacao} />
              </TableCell>
              <TableCell>
                {l.donoConsultorId ? (
                  <span
                    title={nomePorConsultorId.get(l.donoConsultorId) ?? "Consultor"}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary"
                  >
                    {iniciais(nomePorConsultorId.get(l.donoConsultorId) ?? "?")}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Sem dono</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPaginas > 1 && (
        <Pagination className="mt-4">
          <PaginationContent className="flex-wrap">
            <PaginationItem>
              <PaginationPrevious
                href={hrefCarteiraPagina(filtro, busca, Math.max(pagina - 1, 1))}
                className={pagina <= 1 ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
            {paginasParaExibir(pagina, totalPaginas).map((item, index) =>
              item === "reticencias" ? (
                <PaginationItem key={`reticencias-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink href={hrefCarteiraPagina(filtro, busca, item)} isActive={item === pagina}>
                    {item}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                href={hrefCarteiraPagina(filtro, busca, Math.min(pagina + 1, totalPaginas))}
                className={pagina >= totalPaginas ? "pointer-events-none opacity-50" : undefined}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
