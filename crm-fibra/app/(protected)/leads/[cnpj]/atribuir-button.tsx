"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { atribuirLeadAction } from "./actions";

export function AtribuirButton({ cnpjDigits }: { cnpjDigits: string }) {
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const router = useRouter();

  function atribuir() {
    startTransition(async () => {
      const resultado = await atribuirLeadAction(cnpjDigits);
      if (resultado.erro) {
        setErro(resultado.erro);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={atribuir}
        disabled={pending}
        style={{ padding: "9px 16px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
      >
        {pending ? "Atribuindo..." : "Atribuir a mim"}
      </button>
      {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginTop: 6 }}>{erro}</p>}
    </div>
  );
}
