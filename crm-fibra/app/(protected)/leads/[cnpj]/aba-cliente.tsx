import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarBRL, formatarDataHora } from "@/lib/formato";
import { CamadaBadges } from "@/components/camada-badges";
import { contatosVisiveis } from "@/lib/lead-contatos";
import type { LeadSegmentado, Mensagem } from "@/lib/leads";
import { AtribuirButton } from "./atribuir-button";
import { NovaMensagemForm } from "./nova-mensagem-form";

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{valor}</dd>
    </div>
  );
}

export function AbaCliente({
  lead,
  mensagens,
  telefone,
  souODono,
}: {
  lead: LeadSegmentado;
  mensagens: Mensagem[];
  telefone: string | null;
  souODono: boolean;
}) {
  const contatos = contatosVisiveis(lead, souODono);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Campo rotulo="CNPJ" valor={lead.cnpjDigits} />
            <Campo rotulo="Cidade" valor={lead.cidade ?? "-"} />
            <Campo rotulo="ARPU" valor={lead.arpu != null ? formatarBRL(lead.arpu) : "-"} />
            <Campo rotulo="CEP" valor={lead.cepCabeado ?? "-"} />
            {contatos && (
              <>
                <Campo rotulo="Telefone 1" valor={contatos.tel1 || "-"} />
                <Campo rotulo="Telefone 2" valor={contatos.tel2 || "-"} />
                <Campo rotulo="Contato" valor={contatos.telefoneContato || "-"} />
                <Campo rotulo="E-mail" valor={contatos.email || "-"} />
              </>
            )}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Segmentação</span>
            <CamadaBadges camadaFibra={lead.camadaFibra} camadaRenovacao={lead.camadaRenovacao} />
          </div>
        </CardContent>
      </Card>

      {!lead.donoConsultorId && <AtribuirButton cnpjDigits={lead.cnpjDigits} />}
      {lead.donoConsultorId && !souODono && (
        <p className="text-sm text-muted-foreground">Este lead já está atribuído a outro consultor.</p>
      )}

      {souODono ? (
        telefone ? (
          <NovaMensagemForm cnpjDigits={lead.cnpjDigits} telefone={telefone} />
        ) : (
          <p className="text-sm text-primary">
            Nenhum telefone válido encontrado — contato precisa ser manual.
          </p>
        )
      ) : (
        !lead.donoConsultorId && (
          <p className="text-sm text-muted-foreground">
            Atribua este lead a você para poder registrar contato.
          </p>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de mensagens</CardTitle>
        </CardHeader>
        <CardContent>
          {mensagens.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada ainda.</p>
          )}
          <ul className="space-y-2">
            {mensagens.map((m) => (
              <li key={m.id} className="border-l-4 border-primary px-3 py-2">
                <div className="text-xs uppercase text-muted-foreground">
                  {m.canal} · {formatarDataHora(m.enviadoEm)}
                </div>
                <div className="text-sm">{m.conteudo}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
