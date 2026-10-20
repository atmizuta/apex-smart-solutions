import type { PlanoCatalogo } from "@/lib/catalogo";
import type { Proposta } from "@/lib/propostas";
import { PropostaWorkspace } from "./proposta-workspace";
import { PropostasSalvas } from "./propostas-salvas";

export function AbaProposta({
  cnpjDigits,
  cliente,
  catalogo,
  propostas,
  nomesConsultores,
  nomeConsultor,
  telefone,
  souODono,
}: {
  cnpjDigits: string;
  cliente: { razaoSocial: string; cnpjDigits: string };
  catalogo: PlanoCatalogo[];
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
  nomeConsultor: string;
  telefone: string | null;
  souODono: boolean;
}) {
  return (
    <div className="space-y-6">
      <PropostaWorkspace
        cnpjDigits={cnpjDigits}
        cliente={cliente}
        catalogo={catalogo}
        nomeConsultor={nomeConsultor}
        telefone={telefone}
        souODono={souODono}
      />
      <PropostasSalvas propostas={propostas} nomesConsultores={nomesConsultores} cliente={cliente} />
    </div>
  );
}
