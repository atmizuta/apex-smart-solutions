import type { LeadSegmentado } from "./leads";

export type ContatosDoLead = Pick<LeadSegmentado, "tel1" | "tel2" | "telefoneContato" | "email">;

// Telefones e e-mail só aparecem para o dono do lead: um consultor não pode
// copiar o contato de um lead que é de outro (ou que ninguém atribuiu a si).
export function contatosVisiveis(lead: ContatosDoLead, souODono: boolean): ContatosDoLead | null {
  if (!souODono) return null;
  return {
    tel1: lead.tel1,
    tel2: lead.tel2,
    telefoneContato: lead.telefoneContato,
    email: lead.email,
  };
}
