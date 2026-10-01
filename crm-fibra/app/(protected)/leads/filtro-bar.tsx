"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hrefCarteiraFiltrada } from "@/lib/leads-urls";
import type { FiltroCamada } from "@/lib/leads";

const OPCOES: { valor: FiltroCamada; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "fibra_candidato", rotulo: "Candidatos a fibra" },
  { valor: "apto_agora", rotulo: "Aptos agora" },
  { valor: "apto_1_mes", rotulo: "Aptos em 1 mês" },
  { valor: "apto_2_meses", rotulo: "Aptos em 2 meses" },
  { valor: "sem_dono", rotulo: "Sem dono" },
];

export function FiltroBar({
  filtroAtual,
  buscaAtual,
}: {
  filtroAtual: FiltroCamada;
  buscaAtual: string;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState(buscaAtual);

  function irPara(filtro: FiltroCamada, novaBusca: string) {
    router.push(hrefCarteiraFiltrada(filtro, novaBusca));
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {OPCOES.map((o) => (
        <Button
          key={o.valor}
          type="button"
          size="sm"
          variant={filtroAtual === o.valor ? "default" : "outline"}
          className="rounded-full"
          onClick={() => irPara(o.valor, busca)}
        >
          {o.rotulo}
        </Button>
      ))}
      <Input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") irPara(filtroAtual, busca);
        }}
        placeholder="Buscar por nome, cidade ou CNPJ"
        className="max-w-xs"
      />
      <Button type="button" size="sm" variant="secondary" onClick={() => irPara(filtroAtual, busca)}>
        Buscar
      </Button>
    </div>
  );
}
