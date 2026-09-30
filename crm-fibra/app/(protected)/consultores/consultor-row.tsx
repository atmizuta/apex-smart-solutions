"use client";

import { useState, useTransition } from "react";
import { definirAtivoAction, redefinirSenhaAction } from "./actions";
import type { Consultor } from "@/lib/consultores";

export function ConsultorRow({ consultor }: { consultor: Consultor }) {
  const [pending, startTransition] = useTransition();
  const [mensagem, setMensagem] = useState<string | null>(null);

  function alternarAtivo() {
    if (consultor.ativo && !window.confirm(`Desativar o acesso de ${consultor.nome}?`)) {
      return;
    }
    startTransition(async () => {
      const resultado = await definirAtivoAction(consultor.id, !consultor.ativo);
      if (resultado?.erro) {
        setMensagem(resultado.erro);
      }
    });
  }

  function redefinirSenha() {
    const nova = window.prompt("Nova senha (mínimo 8 caracteres):");
    if (!nova) return;
    startTransition(async () => {
      const resultado = await redefinirSenhaAction(consultor.id, nova);
      setMensagem(resultado.erro ?? "Senha redefinida");
    });
  }

  return (
    <tr>
      <td>{consultor.nome}</td>
      <td>{consultor.username}</td>
      <td>{consultor.papel}</td>
      <td>{consultor.ativo ? "Ativo" : "Desativado"}</td>
      <td style={{ display: "flex", gap: 8 }}>
        <button onClick={alternarAtivo} disabled={pending}>
          {consultor.ativo ? "Desativar" : "Reativar"}
        </button>
        <button onClick={redefinirSenha} disabled={pending}>
          Redefinir senha
        </button>
        {mensagem && <span style={{ fontSize: 12 }}>{mensagem}</span>}
      </td>
    </tr>
  );
}
