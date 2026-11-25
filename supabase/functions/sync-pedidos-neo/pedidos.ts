// Lógica pura da sync-pedidos-neo (APIs Movimentação e Atualizações de Pedidos, Xeotech) — REGRAS_NEGOCIO.md §166.
// Sem Deno/rede/Supabase: testável com `node --test`. Nunca devolve nome/CPF/CNPJ do cliente.
// shortcut: paraTimestampSP/mensagemErro/ocultarToken copiados de ../sync-exportacao/exportacao.ts porque o deploy
// pelo conector envia só esta pasta; juntar num _shared/ se o deploy passar a ser pela CLI.
export type Api = "atualizacoes" | "movimentacao";
export type Classe = { tipo: "bko_status" | "venda_perdida" | "livre"; status: string | null; descricao: string | null; vp_categoria: string | null };
export type LinhaFilme = {
  pedido_id: number; numero_pedido: string; etapa_id: number; etapa: string; entrou_em: string; saiu_em: string | null;
  entrou_por: string | null; saiu_por: string | null; sla_horas: number | null; tempo: string | null; texto: string | null;
  vp_categoria: string | null; consultor: string | null; valor: number | null; tags: string | null;
};
export type LinhaAnotacao = Classe & { numero_pedido: string; atualizado_em_neo: string; texto: string; etapa: string | null };

const H = 3600_000;
const CAP_HORAS: Record<Api, number> = { atualizacoes: 24, movimentacao: 7 * 24 };
const ATRASO_MS = 2 * 60_000; // o NEO pode tornar visível um pouco depois do horário gravado

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}
function numOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
export function paraTimestampSP(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}-03:00` : null;
}

// ultimoFimMs = janela_fim da última execução ok (null = primeira vez: só a última hora).
export function proximaJanela(api: Api, ultimoFimMs: number | null, agoraMs: number): { ini: number; fim: number } | null {
  const limite = agoraMs - ATRASO_MS;
  const ini = ultimoFimMs ?? limite - H;
  const fim = Math.min(limite, ini + CAP_HORAS[api] * H);
  return fim > ini ? { ini, fim } : null;
}
function formatoSP(ms: number, api: Api): string {
  const s = new Date(ms - 3 * H).toISOString().slice(0, 19);
  return api === "movimentacao" ? s.replace("T", " ") : s;
}
export function corpoDaApi(api: Api, j: { ini: number; fim: number }): Record<string, unknown> {
  const base = { dataHoraInicio: formatoSP(j.ini, api), dataHoraFim: formatoSP(j.fim, api) };
  return api === "movimentacao" ? { ...base, pedidoTipo: "COMERCIAL", formato: "json" } : { ...base, formato: "JSON" };
}

export function limparHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/<BR\s*\/?>/gi, "\n").replace(/<\/?B>/gi, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// null = descartar (vazio ou só "Movimentado para X", que já está no filme).
export function classificar(t: string): Classe | null {
  const s = String(t ?? "").trim();
  if (!s || /^Movimentado para [^\n]*$/i.test(s)) return null;
  const st = /^Status:\s*([^\n]+)/im.exec(s);
  if (st) {
    const d = /Descri\S*o:\s*([\s\S]*)$/i.exec(s);
    return { tipo: "bko_status", status: st[1].trim(), descricao: d ? d[1].trim() || null : null, vp_categoria: null };
  }
  const cat = /Categoria Inserido\s+([^\n]+)/i.exec(s);
  if (cat || /\(Venda Perdida\)/i.test(s)) return { tipo: "venda_perdida", status: null, descricao: null, vp_categoria: cat ? cat[1].trim() : null };
  return { tipo: "livre", status: null, descricao: null, vp_categoria: null };
}

export function linhasFilme(dados: Record<string, unknown>[]): LinhaFilme[] {
  const por = new Map<string, LinhaFilme>();
  for (const r of dados) {
    const pedido_id = Number(r.pedidoId), etapa_id = Number(r.etapaId);
    const entrou_em = paraTimestampSP(r.dataHoraEntrou), numero = texto(r.numeroAtividade);
    if (!Number.isInteger(pedido_id) || pedido_id <= 0 || !Number.isInteger(etapa_id) || etapa_id <= 0 || !entrou_em || !numero) continue;
    const limpo = limparHtml(r.movimentacao);
    por.set(`${pedido_id}|${etapa_id}|${entrou_em}`, {
      pedido_id, numero_pedido: numero, etapa_id, etapa: texto(r.nomeEtapa) ?? "", entrou_em, saiu_em: paraTimestampSP(r.dataHoraSaiu),
      entrou_por: texto(r.usuarioEntrou), saiu_por: texto(r.usuarioSaiu), sla_horas: numOuNull(r.slaHoras), tempo: texto(r.tempo),
      texto: limpo || null, vp_categoria: classificar(limpo)?.vp_categoria ?? null, consultor: texto(r.nomeConsultor),
      valor: numOuNull(r.total), tags: texto(r.tagsAtividade),
    });
  }
  return [...por.values()];
}

export function linhasAnotacao(dados: Record<string, unknown>[]): LinhaAnotacao[] {
  const ult = new Map<string, Record<string, unknown>>();
  for (const r of dados) {
    const n = texto(r.numeroAtividade);
    if (!n) continue;
    const a = ult.get(n);
    if (!a || String(r.dataHoraAtualizacao ?? "") > String(a.dataHoraAtualizacao ?? "")) ult.set(n, r);
  }
  const saida: LinhaAnotacao[] = [];
  for (const [n, r] of ult) {
    const limpo = limparHtml(r.descricaoUltimaMovimentacao), em = paraTimestampSP(r.dataHoraAtualizacao), c = classificar(limpo);
    if (c && em) saida.push({ numero_pedido: n, atualizado_em_neo: em, texto: limpo, etapa: texto(r.nomeEtapa), ...c });
  }
  return saida;
}

export function mensagemErro(status: number, corpo: string, retryAfter: string | null): string {
  let msg = `HTTP ${status}`;
  let jsonOk = false;
  try {
    const j = JSON.parse(corpo);
    if (j && (j.codigo || j.mensagem)) { msg += ` ${j.codigo ?? ""}: ${j.mensagem ?? ""}`.replace(/\s+:/, ":").trimEnd(); jsonOk = true; }
  } catch { /* corpo não é JSON */ }
  if (!jsonOk) { const t = String(corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 200); if (t) msg += ` — ${t}`; }
  if (retryAfter) msg += ` (Retry-After ${retryAfter}s)`;
  return msg.slice(0, 500);
}
export function ocultarToken(msg: string, token: string): string {
  if (!token) return String(msg);
  let out = String(msg).split(token).join("***");
  const cod = encodeURIComponent(token);
  if (cod !== token) out = out.split(cod).join("***");
  return out;
}
// Erro de rede (fetch) carrega a URL com o token: registra só o nome.
export function erroSeguro(e: unknown, token: string): string {
  const nome = (e as Error)?.name;
  if (nome === "TypeError" || nome === "TimeoutError" || nome === "AbortError") return `Falha de rede: ${nome}`;
  return ocultarToken(String((e as Error)?.message ?? e), token).slice(0, 500);
}
