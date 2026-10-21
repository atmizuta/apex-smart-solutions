"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportarDocumento, type TipoExportacao } from "@/lib/documentos/exportar";
import type { Proposta } from "@/lib/propostas";
import { montarModeloDocumento } from "@/lib/proposta/modelo-documento";

const BOTOES: Array<{ tipo: TipoExportacao; rotulo: string }> = [
  { tipo: "docx", rotulo: "Word" },
  { tipo: "pdf-consultor", rotulo: "PDF consultor" },
  { tipo: "pdf-cliente", rotulo: "PDF cliente" },
  { tipo: "png", rotulo: "PNG" },
];

// Remonta os documentos a partir do retrato salvo; a data de emissão é a de hoje.
export function ExportarSalva({
  proposta,
  nomeConsultor,
  cliente,
}: {
  proposta: Proposta;
  nomeConsultor: string;
  cliente: { razaoSocial: string; cnpjDigits: string };
}) {
  const [consolidar, setConsolidar] = useState(false);
  const [ocupado, setOcupado] = useState<TipoExportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar(tipo: TipoExportacao) {
    setErro(null);
    setOcupado(tipo);
    try {
      const modelo = montarModeloDocumento({
        cliente,
        consultor: nomeConsultor,
        situacaoAtual: proposta.situacaoAtual,
        itens: proposta.itens,
        opcoes: { consolidar, vendedor: null },
        agora: new Date(),
      });
      await exportarDocumento(tipo, modelo);
    } catch {
      setErro("Não foi possível gerar o arquivo agora. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {BOTOES.map(({ tipo, rotulo }) => (
          <Button key={tipo} type="button" variant="outline" size="sm" disabled={ocupado !== null} onClick={() => void gerar(tipo)}>
            <Download />
            {ocupado === tipo ? "Gerando…" : rotulo}
          </Button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="size-4" checked={consolidar} onChange={(e) => setConsolidar(e.target.checked)} />
          Consolidar valores
        </label>
      </div>
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
