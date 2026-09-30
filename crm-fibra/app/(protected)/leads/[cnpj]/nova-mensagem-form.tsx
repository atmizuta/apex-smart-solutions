"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { montarLinkWhatsapp } from "@/lib/whatsapp";
import { registrarMensagemAction } from "./actions";

export function NovaMensagemForm({
  cnpjDigits,
  telefone,
}: {
  cnpjDigits: string;
  telefone: string;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function enviarPeloWhatsapp() {
    if (!texto.trim()) {
      setErro("Escreva uma mensagem antes de enviar");
      return;
    }
    // Open the WhatsApp link synchronously from the click handler — awaiting
    // the log write first would make this a non-user-gesture-triggered
    // window.open, which browsers block as a popup.
    window.open(montarLinkWhatsapp(telefone, texto), "_blank");
    registrarELimpar("whatsapp");
  }

  function registrarELimpar(canal: "whatsapp" | "ligacao" | "email") {
    startTransition(async () => {
      const resultado = await registrarMensagemAction(cnpjDigits, texto, canal);
      if (resultado.erro) {
        setErro(resultado.erro);
        return;
      }
      setTexto("");
      setErro(null);
      router.refresh();
    });
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Escreva a mensagem para o cliente..."
        rows={3}
        style={{ width: "100%", padding: 10, borderRadius: 6, border: "1px solid #ddd" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          onClick={enviarPeloWhatsapp}
          disabled={pending}
          style={{ padding: "8px 14px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
        >
          Enviar pelo WhatsApp
        </button>
        <button onClick={() => registrarELimpar("ligacao")} disabled={pending} style={{ padding: "8px 14px" }}>
          Registrar ligação
        </button>
      </div>
      {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginTop: 6 }}>{erro}</p>}
    </div>
  );
}
