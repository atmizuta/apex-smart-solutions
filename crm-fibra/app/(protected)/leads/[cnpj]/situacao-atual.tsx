"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PlanoCatalogo } from "@/lib/catalogo";
import { LIMITE_ARQUIVOS, lerTextoDoArquivo } from "@/lib/fatura/pdf-texto";
import { processarFaturas, type ResultadoArquivo } from "@/lib/fatura/processar";
import { LIMITE_FRANQUIA_GB, LIMITE_LINHAS, LIMITE_ROTULO } from "@/lib/fatura/tipos";
import { parseValorBRL } from "@/lib/formato";
import { lerQuantidade } from "@/lib/proposta-rascunho";
import type { LinhaEditavel } from "@/lib/proposta/agrupar";
import {
  adicionarLinhaDigitada,
  atualizarLinha,
  linhasDaFatura,
  removerLinhaEditavel,
  substituirLinhasDaFatura,
} from "@/lib/proposta/estado";

// Campo que só confirma ao sair (blur/Enter): o consultor pode digitar "48,49"
// sem a tela reescrever o texto a cada tecla. `aoConfirmar` devolve false para
// recusar o texto, e o campo volta ao valor anterior.
function Campo({
  rotulo,
  valorInicial,
  aoConfirmar,
  className,
  inputMode,
  maxLength,
  desabilitado,
}: {
  rotulo: string;
  valorInicial: string;
  aoConfirmar: (texto: string) => boolean;
  className?: string;
  inputMode?: "numeric" | "decimal";
  maxLength?: number;
  desabilitado?: boolean;
}) {
  return (
    <Input
      aria-label={rotulo}
      defaultValue={valorInicial}
      inputMode={inputMode}
      maxLength={maxLength}
      disabled={desabilitado}
      className={className}
      onBlur={(e) => {
        if (!aoConfirmar(e.target.value)) e.target.value = valorInicial;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

const formatarValor = (valor: number) => (valor > 0 ? valor.toFixed(2).replace(".", ",") : "");
const formatarConsumo = (mb: number | null) => (mb === null ? "-" : `${(mb / 1024).toFixed(1).replace(".", ",")} GB`);

export function SituacaoAtualCard({
  linhas,
  catalogo,
  setLinhas,
  aoLerFaturas,
}: {
  linhas: LinhaEditavel[];
  catalogo: PlanoCatalogo[];
  setLinhas: Dispatch<SetStateAction<LinhaEditavel[]>>;
  aoLerFaturas: (quantidade: number) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoArquivo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const lendo = progresso !== null;

  async function lerFaturas(arquivos: File[]) {
    if (arquivos.length === 0) return;
    setErro(null);
    setResultados([]);
    setProgresso(`Lendo fatura 1 de ${arquivos.length}…`);
    try {
      const resultado = await processarFaturas(arquivos, lerTextoDoArquivo, (indice, total, nome) =>
        setProgresso(`Lendo fatura ${indice} de ${total}: ${nome}`)
      );
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setResultados(resultado.arquivos);
      if (resultado.mescladas.length > 0) {
        const novas = linhasDaFatura(resultado.mescladas, catalogo, () => crypto.randomUUID());
        // Atualização funcional: o que o consultor digitou enquanto a leitura rodava não se perde.
        setLinhas((atuais) => substituirLinhasDaFatura(atuais, novas));
        aoLerFaturas(resultado.faturasLidas);
      }
    } catch {
      setErro("Não foi possível ler as faturas agora. Digite as linhas na tabela abaixo.");
    } finally {
      setProgresso(null);
    }
  }

  const mudar = (chave: string, mudanca: Partial<Omit<LinhaEditavel, "chave">>) =>
    setLinhas((atuais) => atualizarLinha(atuais, chave, mudanca, catalogo));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">1. Situação atual do cliente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Anexe a fatura Claro em PDF (até {LIMITE_ARQUIVOS}; com mais de uma vale a média do período) ou digite as
          linhas. A fatura é lida no seu navegador: ela não é enviada a ninguém e o telefone completo nunca é salvo.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            data-testid="fatura-arquivos"
            onChange={(e) => {
              const arquivos = Array.from(e.target.files ?? []);
              e.target.value = "";
              void lerFaturas(arquivos);
            }}
          />
          <Button type="button" onClick={() => entrada.current?.click()} disabled={lendo}>
            <Upload />
            Anexar fatura(s) em PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={lendo || linhas.length >= LIMITE_LINHAS}
            onClick={() => setLinhas((atuais) => adicionarLinhaDigitada(atuais, crypto.randomUUID()))}
          >
            <Plus />
            Adicionar linha
          </Button>
          {progresso && (
            <span className="text-sm text-muted-foreground" role="status">
              {progresso}
            </span>
          )}
        </div>

        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}
        {resultados.length > 0 && (
          <ul className="space-y-1 text-sm" aria-label="Resultado da leitura">
            {resultados.map((r) => (
              <li key={r.nome} className={r.status === "ok" ? "text-green-700" : "text-amber-700"}>
                {r.status === "ok" ? `${r.nome}: ${r.linhas} linha(s) lida(s)` : r.mensagem}
              </li>
            ))}
          </ul>
        )}

        {linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma linha ainda. Sem situação atual, a proposta sai sem comparativo.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Linha</TableHead>
                <TableHead className="w-20">Qtd</TableHead>
                <TableHead className="w-24">Plano (GB)</TableHead>
                <TableHead className="w-32">Mensalidade (R$)</TableHead>
                <TableHead className="w-24">Consumo</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => (
                <TableRow key={linha.chave}>
                  <TableCell className="whitespace-normal">
                    <Campo
                      rotulo={`Nome da linha ${linha.rotulo}`}
                      valorInicial={linha.rotulo}
                      maxLength={LIMITE_ROTULO}
                      desabilitado={linha.origem === "fatura"}
                      aoConfirmar={(texto) => {
                        if (!texto.trim()) return false;
                        mudar(linha.chave, { rotulo: texto.trim() });
                        return true;
                      }}
                    />
                    {linha.avisos.map((aviso) => (
                      <p key={aviso} className="mt-1 text-xs text-amber-700">
                        {aviso}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Quantidade de ${linha.rotulo}`}
                      valorInicial={String(linha.quantidade)}
                      inputMode="numeric"
                      aoConfirmar={(texto) => {
                        const quantidade = lerQuantidade(texto);
                        if (quantidade === null) return false;
                        mudar(linha.chave, { quantidade });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Franquia em GB de ${linha.rotulo}`}
                      valorInicial={linha.planoGb === null ? "" : String(linha.planoGb)}
                      inputMode="numeric"
                      aoConfirmar={(texto) => {
                        const limpo = texto.trim();
                        if (!limpo) {
                          mudar(linha.chave, { planoGb: null });
                          return true;
                        }
                        const gb = /^\d{1,4}$/.test(limpo) ? Number(limpo) : 0;
                        if (gb < 1 || gb > LIMITE_FRANQUIA_GB) return false;
                        mudar(linha.chave, { planoGb: gb });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Campo
                      rotulo={`Mensalidade de ${linha.rotulo}`}
                      valorInicial={formatarValor(linha.valorUnitario)}
                      inputMode="decimal"
                      className={linha.valorUnitario > 0 ? undefined : "border-amber-400"}
                      aoConfirmar={(texto) => {
                        if (!texto.trim()) {
                          mudar(linha.chave, { valorUnitario: 0 });
                          return true;
                        }
                        const valor = parseValorBRL(texto);
                        if (valor === null) return false;
                        mudar(linha.chave, { valorUnitario: valor });
                        return true;
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatarConsumo(linha.consumoMb)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${linha.rotulo}`}
                      onClick={() => setLinhas((atuais) => removerLinhaEditavel(atuais, linha.chave))}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
