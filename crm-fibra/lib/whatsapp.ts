// Normalizes messy Brazilian phone data from public.clientes (blank
// fields, a literal "0" placeholder, numbers with or without area code,
// numbers already carrying the 55 country code) into a wa.me-ready
// international number (digits only) — or null when nothing usable is
// found, so the caller can show a manual-contact fallback instead of a
// broken link.
export function normalizarTelefone(input: {
  ddd?: string | null;
  tel1?: string | null;
  tel2?: string | null;
  telefoneContato?: string | null;
}): string | null {
  const candidatos = [input.telefoneContato, input.tel1, input.tel2];

  for (const candidato of candidatos) {
    const digitos = somenteDigitos(candidato);
    if (!digitos || digitos === "0") continue;

    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) {
      return digitos;
    }

    if (digitos.length === 10 || digitos.length === 11) {
      return `55${digitos}`;
    }

    if (digitos.length === 8 || digitos.length === 9) {
      const ddd = somenteDigitos(input.ddd);
      if (ddd.length === 2) {
        return `55${ddd}${digitos}`;
      }
    }
  }

  return null;
}

function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

export function montarLinkWhatsapp(telefoneE164: string, mensagem: string): string {
  return `https://wa.me/${telefoneE164}?text=${encodeURIComponent(mensagem)}`;
}
