// §167: telefone do WhatsApp × phone_number do lead. O wa_id de celular antigo pode vir sem o nono dígito,
// então o casamento é DDD + últimos 8 dígitos. Mesma regra da função SQL wa_chave_tel (migration 20261124120000).
export function soDigitos(v: unknown): string { return String(v ?? "").replace(/\D/g, ""); }

export function chaveTelefone(v: unknown): string | null {
  let d = soDigitos(v);
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);   // tira o 55 do país; DDD 55 (RS) tem 10–11 dígitos e fica
  if (d.length !== 10 && d.length !== 11) return null;
  return d.slice(0, 2) + d.slice(-8);
}
