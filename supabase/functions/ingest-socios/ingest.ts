// Regras da Edge Function ingest-socios (§155). Puro: sem Supabase, testável com node --test.
export type Telefone = { tipo: "fixo" | "celular"; numero: string; operadora: string | null; whatsapp: boolean };
export type Socio = { nome: string; cpf: string; participacao: number | null; telefones_consultados: boolean; telefones: Telefone[] };
export type Resultado = { socios: Socio[] };
export type DepsSocios = {
  pegar(max: number): Promise<{ id: number; cnpj: string }[]>;
  concluir(id: number, patch: Record<string, unknown>): Promise<boolean>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const STATUS_FINAIS = ["pronto", "sem_socios", "erro"];
const ERRO_PADRAO = "A consulta na Nova Vida falhou.";

function telefoneOk(t: unknown): t is Telefone {
  if (!t || typeof t !== "object") return false;
  const x = t as Record<string, unknown>;
  return (x.tipo === "fixo" || x.tipo === "celular")
    && typeof x.numero === "string" && /^\d{10,11}$/.test(x.numero)
    && (x.operadora === null || (typeof x.operadora === "string" && /^[A-Z ]{2,20}$/.test(x.operadora)))
    && typeof x.whatsapp === "boolean";
}
function socioOk(s: unknown): s is Socio {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return typeof x.nome === "string" && x.nome.trim().length >= 1 && x.nome.length <= 200
    && typeof x.cpf === "string" && /^\d{11}$/.test(x.cpf)
    && (x.participacao === null || (typeof x.participacao === "number" && x.participacao >= 0 && x.participacao <= 100))
    && typeof x.telefones_consultados === "boolean"
    && Array.isArray(x.telefones) && x.telefones.length <= 20 && x.telefones.every(telefoneOk);
}
export function validarResultado(r: unknown): Resultado | null {
  if (!r || typeof r !== "object") return null;
  const socios = (r as Record<string, unknown>).socios;
  if (!Array.isArray(socios) || socios.length < 1 || socios.length > 50 || !socios.every(socioOk)) return null;
  return { socios: socios as Socio[] };
}

export async function processar(corpo: unknown, deps: DepsSocios): Promise<Resposta> {
  const c = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  try {
    if (c.acao === "pegar") {
      const n = Number(c.max);
      const max = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 10;
      const pedidos = await deps.pegar(max);
      return { status: 200, corpo: { pedidos: pedidos.map((p) => ({ id: p.id, cnpj: p.cnpj })) } };
    }
    if (c.acao === "resultado") {
      if (typeof c.id !== "number" || !Number.isInteger(c.id) || c.id < 1) return { status: 400, corpo: { error: "id inválido" } };
      if (typeof c.status !== "string" || !STATUS_FINAIS.includes(c.status)) return { status: 400, corpo: { error: "status inválido" } };
      let patch: Record<string, unknown>;
      if (c.status === "pronto") {
        const r = validarResultado(c.resultado);
        if (!r) return { status: 400, corpo: { error: "resultado fora do formato" } };
        patch = { status: "pronto", resultado: r, erro: null };
      } else if (c.status === "sem_socios") {
        patch = { status: "sem_socios", resultado: null, erro: null };
      } else {
        const e = typeof c.erro === "string" && c.erro.trim() ? c.erro.trim().slice(0, 200) : ERRO_PADRAO;
        patch = { status: "erro", resultado: null, erro: e };
      }
      const ok = await deps.concluir(c.id, patch);
      return ok ? { status: 200, corpo: { ok: true } } : { status: 409, corpo: { error: "pedido não está em consulta" } };
    }
    return { status: 400, corpo: { error: "ação desconhecida" } };
  } catch (e) {
    return { status: 500, corpo: { error: String((e as Error)?.message ?? e).slice(0, 200) } };
  }
}
