"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, senha }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErro(data.erro ?? "Não foi possível entrar");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bordo)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{ background: "#fff", padding: "40px 36px", borderRadius: 10, width: 360 }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>CRM Fibra</h1>
        <p style={{ color: "var(--cinza)", fontSize: 13, marginBottom: 24 }}>
          Apex Smart Solutions
        </p>
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Usuário</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 14, borderRadius: 6, border: "1px solid #ddd" }}
          autoFocus
        />
        <label style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Senha</label>
        <input
          type="password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 18, borderRadius: 6, border: "1px solid #ddd" }}
        />
        {erro && <p style={{ color: "var(--sinal)", fontSize: 13, marginBottom: 14 }}>{erro}</p>}
        <button
          type="submit"
          disabled={carregando}
          style={{
            width: "100%",
            padding: 12,
            background: "var(--sinal)",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
