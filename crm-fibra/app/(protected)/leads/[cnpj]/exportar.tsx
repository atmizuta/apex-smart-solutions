"use client";

import { useMemo, useState, useTransition } from "react";
import { unstable_rethrow, useRouter } from "next/navigation";
import { Copy, Download, Save } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { chamarAcaoComSeguranca } from "@/lib/chamar-acao";
import { exportarDocumento, type TipoExportacao } from "@/lib/documentos/exportar";
import type { SituacaoAtual } from "@/lib/fatura/tipos";
import { validarItensProposta, type NovoItemProposta } from "@/lib/propostas";
import type { ModeloDocumento } from "@/lib/proposta/modelo-documento";
import { EnviarWhatsapp } from "./enviar-whatsapp";
import { salvarPropostaAction } from "./actions";

const BOTOES: Array<{ tipo: TipoExportacao; rotulo: string; Icone: LucideIcon }> = [
  { tipo: "docx", rotulo: "Word (editável)", Icone: Download },
  { tipo: "pdf-consultor", rotulo: "PDF consultor", Icone: Download },
  { tipo: "pdf-cliente", rotulo: "PDF cliente", Icone: Download },
  { tipo: "png", rotulo: "Baixar PNG", Icone: Download },
  { tipo: "copiar-imagem", rotulo: "Copiar imagem", Icone: Copy },
];

export function Exportar({
  cnpjDigits,
  obterModelo,
  itens,
  situacao,
  pendencia,
  telefone,
  souODono,
  razaoSocial,
  consultor,
}: {
  cnpjDigits: string;
  obterModelo: () => ModeloDocumento | null;
  itens: NovoItemProposta[];
  situacao: SituacaoAtual | null;
  pendencia: string | null;
  telefone: string | null;
  souODono: boolean;
  razaoSocial: string;
  consultor: string;
}) {
  const [ocupado, setOcupado] = useState<TipoExportacao | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [assinaturaSalva, setAssinaturaSalva] = useState<string | null>(null);
  const [salvando, startSalvando] = useTransition();
  const router = useRouter();

  // Impede salvar duas vezes a mesma proposta: o botão só volta quando algo muda.
  const assinatura = useMemo(() => JSON.stringify({ itens, situacao }), [itens, situacao]);
  const jaSalva = assinaturaSalva === assinatura;
  const bloqueado = pendencia !== null;

  async function gerar(tipo: TipoExportacao) {
    // O modelo é refeito no clique: a data de emissão é a de agora.
    const modelo = obterModelo();
    if (!modelo) return;
    setErro(null);
    setAviso(null);
    setOcupado(tipo);
    try {
      const mensagem = await exportarDocumento(tipo, modelo);
      if (mensagem) setAviso(mensagem);
    } catch {
      setErro("Não foi possível gerar o arquivo agora. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  function salvar() {
    const erroItens = validarItensProposta(itens);
    if (erroItens) {
      setErro(erroItens);
      return;
    }
    setErro(null);
    startSalvando(async () => {
      const resultado = await chamarAcaoComSeguranca(
        () => salvarPropostaAction(cnpjDigits, itens, situacao),
        unstable_rethrow
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setAssinaturaSalva(assinatura);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">4. Exportar e enviar</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bloqueado && <p className="text-sm text-muted-foreground">{pendencia}</p>}

        <div className="flex flex-wrap gap-2">
          {BOTOES.map(({ tipo, rotulo, Icone }) => (
            <Button
              key={tipo}
              type="button"
              variant="outline"
              disabled={bloqueado || ocupado !== null}
              onClick={() => void gerar(tipo)}
            >
              <Icone />
              {ocupado === tipo ? "Gerando…" : rotulo}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={salvar} disabled={bloqueado || salvando || jaSalva}>
            <Save />
            {salvando ? "Salvando..." : "Salvar proposta"}
          </Button>
          {jaSalva && (
            <span className="text-sm text-green-700" role="status">
              Proposta salva.
            </span>
          )}
        </div>

        {aviso && (
          <p className="text-sm text-green-700" role="status">
            {aviso}
          </p>
        )}
        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}

        <EnviarWhatsapp
          cnpjDigits={cnpjDigits}
          telefone={telefone}
          souODono={souODono}
          razaoSocial={razaoSocial}
          consultor={consultor}
        />
      </CardContent>
    </Card>
  );
}
