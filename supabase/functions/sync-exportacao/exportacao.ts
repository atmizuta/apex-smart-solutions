// Lógica pura da sync-exportacao (API do Relatório de Exportação Xeotech, painel 15455) — REGRAS_NEGOCIO.md §70.
// Sem Deno/rede/Supabase: testável com `node --test`. A API devolve 1 linha por ITEM; aqui vira 1 por PEDIDO.
export type LinhaExport = Record<string, unknown>;
export type Atividade = {
  numero_pedido: string; categoria: string | null; subcategoria: string | null; tags: string[]; etapa: string | null;
  usuario: string | null; cliente: string | null; produtos: string | null; valor: number; itens: number;
  data_cadastro: string | null; atualizado_em_neo: string | null;
};

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// Valor vem número ou texto ("6999,00", "1.234,56"); vazio/inválido = 0. Duas casas.
export function paraNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(normal.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && /\d/.test(normal) ? Math.round(n * 100) / 100 : 0;
}

// "2026-10-02T09:30:00[.fff]" (horário de SP) → "2026-10-02T09:30:00-03:00"; outro formato → null.
export function paraTimestampSP(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}-03:00` : null;
}

// Categoria do pedido: a não vazia mais frequente entre os itens; empate → a do item atualizado mais recentemente.
export function categoriaDoPedido(itens: LinhaExport[], campo: string): string | null {
  const cont = new Map<string, { n: number; ult: string }>();
  for (const r of itens) {
    const c = texto(r[campo]);
    if (!c) continue;
    const u = String(r.dataHoraAtualizacao ?? "");
    const x = cont.get(c) ?? { n: 0, ult: "" };
    x.n += 1;
    if (u > x.ult) x.ult = u;
    cont.set(c, x);
  }
  let melhor: string | null = null;
  let mn = 0;
  let mu = "";
  for (const [c, x] of cont) {
    if (x.n > mn || (x.n === mn && x.ult > mu)) { melhor = c; mn = x.n; mu = x.ult; }
  }
  return melhor;
}

export function agruparPorPedido(linhas: LinhaExport[]): Atividade[] {
  const por = new Map<string, LinhaExport[]>();
  for (const r of linhas) {
    const p = texto(r.numeroPedido);
    if (!p) continue;
    const lista = por.get(p) ?? [];
    lista.push(r);
    por.set(p, lista);
  }
  const saida: Atividade[] = [];
  for (const [pedido, itens] of por) {
    const recente = itens.reduce((a, b) => (String(b.dataHoraAtualizacao ?? "") > String(a.dataHoraAtualizacao ?? "") ? b : a));
    const tags = new Set<string>();
    for (const r of itens) {
      if (Array.isArray(r.tagsAtividade)) for (const t of r.tagsAtividade as unknown[]) { const s = texto(t); if (s) tags.add(s); }
    }
    const produtos = Array.from(new Set(itens.map((r) => texto(r.nomeProduto)).filter((x): x is string => x !== null))).sort();
    const cadastros = itens.map((r) => texto(r.dataCadastro)).filter((x): x is string => x !== null && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    saida.push({
      numero_pedido: pedido,
      categoria: categoriaDoPedido(itens, "categoriaAtividade"),
      subcategoria: categoriaDoPedido(itens, "subCategoriaAtividade"),
      tags: Array.from(tags).sort(),
      etapa: texto(recente.nomeEtapa),
      usuario: texto(recente.nomeUsuario),
      cliente: texto(recente.nomeCliente),
      produtos: produtos.length ? produtos.join(" + ") : null,
      valor: Math.round(itens.reduce((s, r) => s + paraNumero(r.valor), 0) * 100) / 100,
      itens: itens.length,
      data_cadastro: cadastros[0] ?? null,
      atualizado_em_neo: paraTimestampSP(recente.dataHoraAtualizacao),
    });
  }
  return saida;
}

// Período da consulta: hoje−90 dias até hoje, em São Paulo (a API hoje ignora o período e devolve o painel todo; isto
// cobre o caso de ela passar a filtrar).
export function periodoConsulta(agoraMs: number): { dataInicio: string; dataFim: string } {
  const fim = new Date(agoraMs - 3 * 3600000);
  const ini = new Date(fim.getTime() - 90 * 86400000);
  return { dataInicio: ini.toISOString().slice(0, 10), dataFim: fim.toISOString().slice(0, 10) };
}

// Mensagem curta para o log: "HTTP 401 TOKEN_INVALIDO: Token inválido" / "HTTP 502 — <corpo>" / "+ (Retry-After Ns)".
export function mensagemErro(status: number, corpo: string, retryAfter: string | null): string {
  let msg = `HTTP ${status}`;
  let jsonOk = false;
  try {
    const j = JSON.parse(corpo);
    if (j && (j.codigo || j.mensagem)) {
      msg += ` ${j.codigo ?? ""}: ${j.mensagem ?? ""}`.replace(/\s+:/, ":").trimEnd();
      jsonOk = true;
    }
  } catch { /* corpo não é JSON */ }
  if (!jsonOk) {
    const t = String(corpo ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (t) msg += ` — ${t}`;
  }
  if (retryAfter) msg += ` (Retry-After ${retryAfter}s)`;
  return msg.slice(0, 500);
}

// O token vai na URL da API (às vezes percent-encoded): nenhuma mensagem que sai da função pode contê-lo,
// em nenhuma das duas formas.
export function ocultarToken(msg: string, token: string): string {
  if (!token) return String(msg);
  let out = String(msg).split(token).join("***");
  const codificado = encodeURIComponent(token);
  if (codificado !== token) out = out.split(codificado).join("***");
  return out;
}
