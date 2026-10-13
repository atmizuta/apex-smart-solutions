import { agruparPorCategoria, type PlanoCatalogo } from "@/lib/catalogo";
import type { Proposta } from "@/lib/propostas";
import { PropostaBuilder } from "./proposta-builder";
import { PropostasSalvas } from "./propostas-salvas";

export function AbaProposta({
  cnpjDigits,
  catalogo,
  propostas,
  nomesConsultores,
}: {
  cnpjDigits: string;
  catalogo: PlanoCatalogo[];
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <PropostaBuilder cnpjDigits={cnpjDigits} grupos={agruparPorCategoria(catalogo)} />
      <PropostasSalvas propostas={propostas} nomesConsultores={nomesConsultores} />
    </div>
  );
}
