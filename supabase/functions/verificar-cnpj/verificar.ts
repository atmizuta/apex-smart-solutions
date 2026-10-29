// Edge Function verificar-cnpj (REGRAS_NEGOCIO.md §127) — lógica pura, dependências injetadas.
// Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md.
// Log: só status, fonte e situação — nunca CNPJ, razão social, aba ou lead (repo e logs públicos).
export type Situacao = "ATIVA" | "BAIXADA" | "INAPTA" | "SUSPENSA" | "NULA" | "NAO_ENCONTRADO";
export type Fonte = "brasilapi" | "cnpjws";
export interface Consulta {
  cnpj: string; situacao: Situacao; situacao_desde: string | null; motivo: string | null; razao_social: string | null;
  fonte: Fonte; consultado_em: string; consultado_por: string | null;
}
export type Resultado = Omit<Consulta, "cnpj" | "consultado_em" | "consultado_por">;
export interface Lead { cnpj: string | null; dono_id: string | null; apagado_em: string | null }
export interface Deps {
  usuario(auth: string | null): Promise<string | null>;
  papel(uid: string): Promise<string | null>;
  lead(aba: string, id: string): Promise<Lead | null>;
  consultaSalva(cnpj: string): Promise<Consulta | null>;
  salvar(c: Consulta): Promise<void>;
  buscar(url: string, ms: number): Promise<{ status: number; corpo: unknown }>;   // rejeita em falha de rede ou tempo esgotado
  agora(): Date;
  log(msg: string): void;
}

export const CACHE_MS = 10 * 60 * 1000;
export const TEMPO_LIMITE_MS = 8000;
const SITUACOES_RECEITA = ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA"];
const GESTORES = ["admin", "supervisor"];

export function soDigitos(v: unknown): string { return String(v ?? "").replace(/\D/g, ""); }
export function normalizarSituacao(v: unknown): Situacao | null {
  const s = String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return SITUACOES_RECEITA.includes(s) ? s as Situacao : null;
}
function data(v: unknown): string | null { const s = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; }
function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s && s.toUpperCase() !== "SEM MOTIVO" ? s : null;
}
function obj(v: unknown): Record<string, unknown> { return v && typeof v === "object" ? v as Record<string, unknown> : {}; }

export function lerBrasilApi(corpo: unknown): Resultado | null {
  const c = obj(corpo), situacao = normalizarSituacao(c.descricao_situacao_cadastral);
  if (!situacao) return null;
  return { situacao, situacao_desde: data(c.data_situacao_cadastral), motivo: texto(c.descricao_motivo_situacao_cadastral),
    razao_social: texto(c.razao_social), fonte: "brasilapi" };
}
export function lerCnpjWs(corpo: unknown): Resultado | null {
  const c = obj(corpo), e = obj(c.estabelecimento), situacao = normalizarSituacao(e.situacao_cadastral);
  if (!situacao) return null;
  return { situacao, situacao_desde: data(e.data_situacao_cadastral), motivo: texto(obj(e.motivo_situacao_cadastral).descricao),
    razao_social: texto(c.razao_social), fonte: "cnpjws" };
}

const FONTES: { nome: Fonte; url: (cnpj: string) => string; ler: (corpo: unknown) => Resultado | null }[] = [
  { nome: "brasilapi", url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, ler: lerBrasilApi },
  { nome: "cnpjws", url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, ler: lerCnpjWs },
];
const naoEncontrado = (fonte: Fonte): Resultado => ({ situacao: "NAO_ENCONTRADO", situacao_desde: null, motivo: null, razao_social: null, fonte });

// BrasilAPI primeiro; falha de rede, tempo, HTTP diferente de 200/404 ou situação desconhecida → tenta a próxima fonte.
async function consultarFora(cnpj: string, deps: Deps): Promise<Resultado | null> {
  for (const f of FONTES) {
    try {
      const r = await deps.buscar(f.url(cnpj), TEMPO_LIMITE_MS);
      if (r.status === 404) return naoEncontrado(f.nome);
      if (r.status === 200) {
        const lido = f.ler(r.corpo);
        if (lido) return lido;
        deps.log(`${f.nome}: resposta sem situação conhecida`);
      } else deps.log(`${f.nome}: HTTP ${r.status}`);
    } catch (_e) {
      deps.log(`${f.nome}: falha de rede ou tempo`);
    }
  }
  return null;
}

const resp = (status: number, corpo: Record<string, unknown>) => ({ status, corpo });

export async function verificar(entrada: { auth: string | null; aba: string; lead_id: string }, deps: Deps) {
  const uid = await deps.usuario(entrada.auth);
  if (!uid) return resp(401, { ok: false, erro: "nao_autenticado" });
  if (!entrada.aba || !entrada.lead_id) return resp(400, { ok: false, erro: "entrada_invalida" });
  const lead = await deps.lead(entrada.aba, entrada.lead_id);
  if (!lead || lead.apagado_em) return resp(404, { ok: false, erro: "lead_nao_encontrado" });
  if (lead.dono_id !== uid && !GESTORES.includes(String(await deps.papel(uid)))) return resp(403, { ok: false, erro: "sem_permissao" });
  const cnpj = soDigitos(lead.cnpj);
  if (cnpj.length !== 14) return resp(422, { ok: false, erro: "cnpj_invalido" });
  const salva = await deps.consultaSalva(cnpj);
  if (salva && deps.agora().getTime() - Date.parse(salva.consultado_em) < CACHE_MS) {
    deps.log(`cache ${salva.situacao}`);
    return resp(200, { ok: true, consulta: salva });
  }
  const r = await consultarFora(cnpj, deps);
  if (!r) { deps.log("fora do ar"); return resp(503, { ok: false, erro: "fora_do_ar" }); }
  const consulta: Consulta = { cnpj, ...r, consultado_em: deps.agora().toISOString(), consultado_por: uid };
  await deps.salvar(consulta);
  deps.log(`ok ${r.fonte} ${r.situacao}`);
  return resp(200, { ok: true, consulta });
}
