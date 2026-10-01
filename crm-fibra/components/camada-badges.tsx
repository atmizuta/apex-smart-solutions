import { Badge } from "@/components/ui/badge";
import { corCamadaRenovacao, rotuloCamadaRenovacao } from "@/lib/camadas";
import type { LeadSegmentado } from "@/lib/leads";

export function CamadaBadges({
  camadaFibra,
  camadaRenovacao,
}: {
  camadaFibra: LeadSegmentado["camadaFibra"];
  camadaRenovacao: LeadSegmentado["camadaRenovacao"];
}) {
  if (!camadaFibra && !camadaRenovacao) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {camadaFibra === "fibra_candidato" && (
        <Badge variant="outline" className="border-sky-200 bg-sky-100 text-sky-800">
          Fibra
        </Badge>
      )}
      {camadaRenovacao && (
        <Badge variant="outline" className={corCamadaRenovacao(camadaRenovacao)}>
          {rotuloCamadaRenovacao(camadaRenovacao)}
        </Badge>
      )}
    </div>
  );
}
