"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GrupoCatalogo } from "@/lib/catalogo";
import { formatarBRL } from "@/lib/formato";
import { validarItensProposta } from "@/lib/propostas";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  itensParaSalvar,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "@/lib/proposta-rascunho";
import { salvarPropostaAction } from "./actions";

const OFERTA_AVULSA = "__avulsa__";

export function PropostaBuilder({
  cnpjDigits,
  grupos,
}: {
  cnpjDigits: string;
  grupos: GrupoCatalogo[];
}) {
  const [rascunho, setRascunho] = useState<Rascunho>([]);
  const [selecao, setSelecao] = useState("");
  const [descricaoAvulsa, setDescricaoAvulsa] = useState("");
  const [valorAvulso, setValorAvulso] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const gruposComPlanos = grupos.filter((grupo) => grupo.planos.length > 0);

  function adicionar() {
    setSucesso(false);
    const chave = crypto.randomUUID();

    if (selecao === OFERTA_AVULSA) {
      const resultado = adicionarLinhaAvulsa(
        rascunho,
        { descricao: descricaoAvulsa, valorTexto: valorAvulso },
        chave
      );
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setRascunho(resultado.rascunho);
      setDescricaoAvulsa("");
      setValorAvulso("");
    } else {
      const plano = grupos.flatMap((grupo) => grupo.planos).find((p) => p.id === selecao);
      if (!plano) {
        setErro('Escolha um plano do catálogo ou "Oferta avulsa"');
        return;
      }
      setRascunho(adicionarLinhaCatalogo(rascunho, plano, chave));
    }

    setSelecao("");
    setErro(null);
  }

  function remover(chave: string) {
    setRascunho(removerLinha(rascunho, chave));
    setSucesso(false);
  }

  function salvar() {
    const itens = itensParaSalvar(rascunho);
    const erroValidacao = validarItensProposta(itens);
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    startTransition(async () => {
      const resultado = await salvarPropostaAction(cnpjDigits, itens);
      if (resultado.erro) {
        setErro(resultado.erro);
        setSucesso(false);
        return;
      }
      setRascunho([]);
      setErro(null);
      setSucesso(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Montar proposta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Plano do catálogo"
            value={selecao}
            onChange={(e) => setSelecao(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Escolha um plano do catálogo…</option>
            {gruposComPlanos.map((grupo) => (
              <optgroup key={grupo.categoria} label={grupo.rotulo}>
                {grupo.planos.map((plano) => (
                  <option key={plano.id} value={plano.id}>
                    {plano.nome} — {formatarBRL(plano.valor)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OFERTA_AVULSA}>Oferta avulsa (digitar)</option>
          </select>
          <Button type="button" onClick={adicionar} disabled={!selecao}>
            <Plus />
            Adicionar linha
          </Button>
        </div>

        {selecao === OFERTA_AVULSA && (
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input
              placeholder="Descrição da oferta"
              value={descricaoAvulsa}
              onChange={(e) => setDescricaoAvulsa(e.target.value)}
              aria-label="Descrição da oferta avulsa"
            />
            <Input
              placeholder="Valor (ex.: 149,90)"
              inputMode="decimal"
              value={valorAvulso}
              onChange={(e) => setValorAvulso(e.target.value)}
              aria-label="Valor da oferta avulsa"
            />
          </div>
        )}

        {rascunho.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma linha adicionada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rascunho.map((linha) => (
                <TableRow key={linha.chave}>
                  <TableCell className="whitespace-normal">{linha.descricao}</TableCell>
                  <TableCell className="text-right">{formatarBRL(linha.valor)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${linha.descricao}`}
                      onClick={() => remover(linha.chave)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">Total: {formatarBRL(totalRascunho(rascunho))}</span>
          <Button type="button" onClick={salvar} disabled={pending || rascunho.length === 0}>
            {pending ? "Salvando..." : "Salvar proposta"}
          </Button>
        </div>

        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}
        {sucesso && (
          <p className="text-sm text-green-700" role="status">
            Proposta salva.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
