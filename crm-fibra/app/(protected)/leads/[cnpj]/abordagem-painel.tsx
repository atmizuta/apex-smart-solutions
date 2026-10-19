"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ETAPAS, type ChaveEtapa, type EtapasAbordagem } from "@/lib/ia/guia-apex";
import { gerarAbordagemAction } from "./actions";

export function AbordagemPainel({
  cnpjDigits,
  etapas,
  status,
  desatualizada,
}: {
  cnpjDigits: string;
  etapas: EtapasAbordagem | null;
  status: string | null;
  desatualizada: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<ChaveEtapa | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function gerar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await gerarAbordagemAction(cnpjDigits);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    });
  }

  async function copiar(chave: ChaveEtapa, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setErro(null);
      setCopiado(chave);
      setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 2000);
    } catch {
      setErro("Não foi possível copiar automaticamente. Clique no texto para selecioná-lo e copie.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">Roteiro de abordagem por IA</p>
            <p className="text-xs text-muted-foreground">
              {status ??
                "Ainda não foi gerado. São cinco mensagens de WhatsApp prontas para copiar, personalizadas com os dados deste cliente e com a proposta mais recente."}
            </p>
            {desatualizada && (
              <p className="text-xs text-amber-700">
                Há uma proposta mais nova — gere de novo para incluir os planos.
              </p>
            )}
          </div>
          <Button type="button" onClick={gerar} disabled={pending}>
            <Sparkles />
            {pending ? "Gerando…" : etapas ? "Gerar de novo" : "Gerar abordagem"}
          </Button>
        </CardContent>
      </Card>

      {pending && (
        <p className="text-sm text-muted-foreground" role="status">
          Gerando… pode levar alguns segundos.
        </p>
      )}
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}

      {etapas && (
        <div className="space-y-3">
          {ETAPAS.map((etapa, indice) => (
            <Card key={etapa.chave}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {indice + 1}. {etapa.rotulo}
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => copiar(etapa.chave, etapas[etapa.chave])}
                >
                  {copiado === etapa.chave ? <Check /> : <Copy />}
                  {copiado === etapa.chave ? "Copiado" : "Copiar"}
                </Button>
              </CardHeader>
              <CardContent>
                <p className="select-all whitespace-pre-wrap text-sm">{etapas[etapa.chave]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
