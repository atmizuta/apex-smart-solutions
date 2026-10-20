"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIAS_CATALOGO, ROTULO_CATEGORIA } from "@/lib/catalogo";
import { criarPlanoAction, type CriarPlanoState } from "./actions";

const estadoInicial: CriarPlanoState = {};

export function NovoPlanoForm() {
  const [estado, formAction, pending] = useActionState(criarPlanoAction, estadoInicial);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <div className="space-y-1">
        <label htmlFor="novo-plano-categoria" className="text-xs text-muted-foreground">
          Categoria
        </label>
        <select
          id="novo-plano-categoria"
          name="categoria"
          required
          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {CATEGORIAS_CATALOGO.map((categoria) => (
            <option key={categoria} value={categoria}>
              {ROTULO_CATEGORIA[categoria]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-nome" className="text-xs text-muted-foreground">
          Nome
        </label>
        <Input id="novo-plano-nome" name="nome" required className="w-72" />
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-valor" className="text-xs text-muted-foreground">
          Valor (R$)
        </label>
        <Input
          id="novo-plano-valor"
          name="valor"
          required
          inputMode="decimal"
          placeholder="149,90"
          className="w-32"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-franquia" className="text-xs text-muted-foreground">
          Franquia (GB)
        </label>
        <Input
          id="novo-plano-franquia"
          name="franquia"
          inputMode="numeric"
          placeholder="40"
          className="w-24"
        />
        <p className="text-[11px] text-muted-foreground">Obrigatória nos planos Pós</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-observacao" className="text-xs text-muted-foreground">
          Observação
        </label>
        <Input id="novo-plano-observacao" name="observacao" className="w-72" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adicionando..." : "Adicionar plano"}
      </Button>
      {estado.erro && <span className="text-sm text-destructive">{estado.erro}</span>}
      {estado.sucesso && <span className="text-sm text-green-700">Plano adicionado!</span>}
    </form>
  );
}
