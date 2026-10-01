"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    const params = new URLSearchParams();
    params.set("camada", filtro);
    if (novaBusca) params.set("busca", novaBusca);
    router.push(`/leads?${params.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      {OPCOES.map((o) => (
        <button
          key={o.valor}
          onClick={() => irPara(o.valor, busca)}
          style={{
            padding: "6px 14px",
            borderRadius: 20,
            border: "1px solid #e2e2e4",
            background: filtroAtual === o.valor ? "var(--sinal)" : "#fff",
            color: filtroAtual === o.valor ? "#fff" : "inherit",
            cursor: "pointer",
            fontSize: 12.5,
          }}
        >
          {o.rotulo}
        </button>
      ))}
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") irPara(filtroAtual, busca);
        }}
        placeholder="Buscar por nome, cidade ou CNPJ"
        style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", minWidth: 220 }}
      />
      <button onClick={() => irPara(filtroAtual, busca)} style={{ padding: "6px 12px" }}>
        Buscar
      </button>
    </div>
  );
}
