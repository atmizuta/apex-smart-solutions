import type { Abordagem } from "@/lib/abordagens";
import { formatarDataHora } from "@/lib/formato";
import { abordagemDesatualizada } from "@/lib/ia/abordagem";
import type { Proposta } from "@/lib/propostas";
import { AbordagemPainel } from "./abordagem-painel";

export function AbaAbordagem({
  cnpjDigits,
  abordagem,
  propostas,
  nomesConsultores,
}: {
  cnpjDigits: string;
  abordagem: Abordagem | null;
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
}) {
  const ultimaProposta = propostas[0] ?? null;
  const propostaUsada = abordagem?.propostaId
    ? (propostas.find((proposta) => proposta.id === abordagem.propostaId) ?? null)
    : null;

  const autor = abordagem ? (nomesConsultores[abordagem.consultorId] ?? "consultor desconhecido") : "";
  const status = abordagem
    ? `Gerado por ${autor} em ${formatarDataHora(abordagem.criadoEm)}, ${
        propostaUsada ? `com a proposta de ${formatarDataHora(propostaUsada.criadoEm)}` : "sem proposta"
      }`
    : null;

  return (
    <AbordagemPainel
      cnpjDigits={cnpjDigits}
      etapas={abordagem?.etapas ?? null}
      status={status}
      desatualizada={abordagemDesatualizada(abordagem, ultimaProposta)}
    />
  );
}
