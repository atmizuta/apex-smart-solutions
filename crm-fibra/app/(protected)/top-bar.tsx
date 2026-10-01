"use client";

import { useRouter } from "next/navigation";

export function TopBar({
  nome,
  papel,
}: {
  nome: string;
  papel: "admin" | "consultor";
}) {
  const router = useRouter();

  async function sair() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header
      style={{
        background: "var(--bordo)",
        color: "#fff",
        padding: "14px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <strong style={{ fontFamily: "var(--font-head)", textTransform: "uppercase" }}>
        CRM Fibra
      </strong>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
        <span>
          {nome} · {papel}
        </span>
        <button
          onClick={sair}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,.4)",
            color: "#fff",
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Sair
        </button>
      </div>
    </header>
  );
}
