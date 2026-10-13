"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { PlanoCatalogo } from "@/lib/catalogo";
import { atualizarPlanoAction, definirPlanoAtivoAction } from "./actions";

function valorParaInput(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

export function PlanoRow({ plano }: { plano: PlanoCatalogo }) {
  const [valor, setValor] = useState(valorParaInput(plano.valor));
  const [observacao, setObservacao] = useState(plano.observacao ?? "");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alterado =
    valor !== valorParaInput(plano.valor) || observacao !== (plano.observacao ?? "");

  function salvar() {
    startTransition(async () => {
      const resultado = await atualizarPlanoAction(plano.id, valor, observacao);
      setMensagem(resultado.erro ?? "Salvo");
    });
  }

  function alternarAtivo() {
    startTransition(async () => {
      const resultado = await definirPlanoAtivoAction(plano.id, !plano.ativo);
      if (resultado.erro) setMensagem(resultado.erro);
    });
  }

  return (
    <TableRow className={plano.ativo ? undefined : "opacity-60"}>
      <TableCell className="whitespace-normal font-medium">{plano.nome}</TableCell>
      <TableCell>
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          aria-label={`Valor de ${plano.nome}`}
        />
      </TableCell>
      <TableCell>
        <Input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          aria-label={`Observação de ${plano.nome}`}
        />
      </TableCell>
      <TableCell>
        {plano.ativo ? <Badge>Ativo</Badge> : <Badge variant="secondary">Desativado</Badge>}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {alterado && (
            <Button size="sm" onClick={salvar} disabled={pending}>
              Salvar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={alternarAtivo} disabled={pending}>
            {plano.ativo ? "Desativar" : "Reativar"}
          </Button>
          {mensagem && <span className="text-xs text-muted-foreground">{mensagem}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
