import { CamadaBadges } from "@/components/camada-badges";
import { Card, CardContent } from "@/components/ui/card";
import { formatarBRL } from "@/lib/formato";
import type { LeadSegmentado } from "@/lib/leads";

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</div>
        <div className="mt-1 text-2xl font-semibold">{valor}</div>
      </CardContent>
    </Card>
  );
}

const numero = (valor: number | null) => (valor == null ? "-" : String(valor));
const moeda = (valor: number | null) => (valor == null ? "-" : formatarBRL(valor));

export function AbaLinhas({ lead }: { lead: LeadSegmentado }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Linhas fixas" valor={numero(lead.linhasFixas)} />
        <Resumo rotulo="Linhas de voz" valor={numero(lead.linhasVoz)} />
        <Resumo rotulo="Valor do contrato" valor={moeda(lead.valorContrato)} />
        <Resumo rotulo="ARPU" valor={moeda(lead.arpu)} />
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Segmentação</span>
          <CamadaBadges camadaFibra={lead.camadaFibra} camadaRenovacao={lead.camadaRenovacao} />
        </CardContent>
      </Card>
    </div>
  );
}
