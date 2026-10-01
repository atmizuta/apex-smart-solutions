"use client";

import { useActionState } from "react";
import { criarConsultorAction, type CriarConsultorState } from "./actions";

const initialState: CriarConsultorState = {};

export function NovoConsultorForm() {
  const [state, formAction, pending] = useActionState(criarConsultorAction, initialState);

  return (
    <form action={formAction} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Nome</label>
        <input name="nome" required style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Usuário</label>
        <input name="username" required style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Senha</label>
        <input name="senha" type="password" required minLength={8} style={{ padding: 8 }} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 12 }}>Papel</label>
        <select name="papel" style={{ padding: 8 }}>
          <option value="consultor">Consultor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        style={{ padding: "9px 16px", background: "var(--sinal)", color: "#fff", border: "none", borderRadius: 6 }}
      >
        {pending ? "Criando..." : "Criar login"}
      </button>
      {state.erro && <span style={{ color: "var(--sinal)", fontSize: 13 }}>{state.erro}</span>}
      {state.sucesso && <span style={{ color: "green", fontSize: 13 }}>Criado!</span>}
    </form>
  );
}
