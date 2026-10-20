"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ComparativoCartao } from "@/components/documento/comparativo-cartao";
import { destaqueDoCliente, moeda } from "@/lib/documentos/formato";
import type { ModeloDocumento } from "@/lib/proposta/modelo-documento";

function Indicador({ rotulo, valor, classe }: { rotulo: string; valor: string; classe?: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold ${classe ?? ""}`}>{valor}</div>
    </div>
  );
}

const CLASSE_DA_COR = { verde: "text-green-700", ambar: "text-amber-700", preto: "" } as const;

export function ComparativoCard({
  modelo,
  pendencia,
  consolidar,
  vendedor,
  aoMudarConsolidar,
  aoMudarVendedor,
}: {
  modelo: ModeloDocumento | null;
  pendencia: string | null;
  consolidar: boolean;
  vendedor: string;
  aoMudarConsolidar: (valor: boolean) => void;
  aoMudarVendedor: (valor: string) => void;
}) {
  const destaque = modelo ? destaqueDoCliente(modelo) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">3. Comparativo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!modelo || !destaque ? (
          <p className="text-sm text-muted-foreground">
            {pendencia ?? "Monte a situação atual e a nova proposta para ver o comparativo."}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {modelo.resumo.atual === null ? (
                <Indicador rotulo="Mensalidade proposta" valor={moeda(modelo.resumo.proposto)} />
              ) : (
                <>
                  <Indicador rotulo="Mensalidade atual" valor={moeda(modelo.resumo.atual)} classe="text-muted-foreground" />
                  <Indicador rotulo="Nova mensalidade" valor={moeda(modelo.resumo.proposto)} />
                  <Indicador rotulo={destaque.titulo} valor={destaque.valor} classe={CLASSE_DA_COR[destaque.cor]} />
                </>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={consolidar}
                  onChange={(e) => aoMudarConsolidar(e.target.checked)}
                />
                Consolidar valores (uma linha só para os planos, sem preço por linha)
              </label>
              <div className="space-y-1">
                <label htmlFor="proposta-vendedor" className="text-xs text-muted-foreground">
                  Vendedor que aparece nos documentos
                </label>
                <Input id="proposta-vendedor" value={vendedor} onChange={(e) => aoMudarVendedor(e.target.value)} />
              </div>
            </div>

            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Ver prévia da imagem (PNG)</summary>
              <div className="mt-3 overflow-auto">
                {/* `zoom` reduz só a prévia na tela; a imagem baixada sai em 1080 px (2×). */}
                <div style={{ zoom: 0.5 }}>
                  <ComparativoCartao modelo={modelo} />
                </div>
              </div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
