// Lógica pura da sync-neo-eagle (REGRAS_NEGOCIO.md §108): pedidos da Eagle no NeoSales (API do Relatório de Exportação
// Xeotech, painel 15216), SÓ para o "Cruzar com o NEO" da aba Base de Mailing — nunca para Dashboard/Fechamento/Boletim.
// Sem Deno/rede/banco: testável com `node --test`. A API devolve 1 linha por ITEM; aqui vira 1 por PEDIDO.
export type LinhaExport = Record<string, unknown>;
export type PedidoEagle = {
  numero_pedido: string; cnpj: string; etapa: string | null; consultor: string | null;
  cadastro: string; atualizado_em_neo: string | null;
};

export const DIAS_GUARDADOS = 150;
const DIA_MS = 86400000;

function texto(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// Data de hoje em São Paulo (aaaa-mm-dd), menos `dias`. Brasil sem horário de verão desde 2019: UTC−3 fixo.
export function diaSP(agoraMs: number, dias = 0): string {
  return new Date(agoraMs - 3 * 3600000 - dias * DIA_MS).toISOString().slice(0, 10);
}

// Rotina diária: anteontem até hoje (a API filtra por cadastro e atualização), pega pedido novo e mudança de etapa.
export function periodoDiario(agoraMs: number): { dataInicio: string; dataFim: string } {
  return { dataInicio: diaSP(agoraMs, 2), dataFim: diaSP(agoraMs) };
}

// Período pedido à mão (carga inicial): datas válidas, início ≤ fim, no máximo 3 meses (limite da API).
export function periodoValido(p: { dataInicio?: unknown; dataFim?: unknown }): boolean {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof p.dataInicio !== "string" || typeof p.dataFim !== "string" || !re.test(p.dataInicio) || !re.test(p.dataFim)) return false;
  const a = Date.parse(p.dataInicio + "T00:00:00Z"), b = Date.parse(p.dataFim + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) && a <= b && b - a <= 92 * DIA_MS;
}

// "2026-10-02T09:30:00[.fff]" (horário de SP) → "2026-10-02T09:30:00-03:00"; outro formato → null.
export function paraTimestampSP(v: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(String(v ?? "").trim());
  return m ? `${m[1]}T${m[2]}-03:00` : null;
}

// Um registro por pedido, só CNPJ de 14 dígitos (os poucos com CPF ficam fora, como na Apex) e só cadastro a partir
// de `corte` (aaaa-mm-dd). Etapa e consultor vêm do item atualizado mais recentemente.
export function pedidosEagle(linhas: LinhaExport[], corte: string): PedidoEagle[] {
  const por = new Map<string, LinhaExport[]>();
  for (const r of linhas) {
    const p = texto(r.numeroPedido);
    if (!p) continue;
    const lista = por.get(p) ?? [];
    lista.push(r);
    por.set(p, lista);
  }
  const saida: PedidoEagle[] = [];
  for (const [pedido, itens] of por) {
    const recente = itens.reduce((a, b) => (String(b.dataHoraAtualizacao ?? "") > String(a.dataHoraAtualizacao ?? "") ? b : a));
    const cnpj = itens.map((r) => String(r.cpfCnpj ?? "").replace(/\D/g, "")).find((d) => d.length === 14);
    const cadastro = itens.map((r) => String(r.dataCadastro ?? "").trim().slice(0, 10))
      .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort()[0];
    if (!cnpj || !cadastro || cadastro < corte) continue;
    saida.push({
      numero_pedido: pedido,
      cnpj,
      etapa: texto(recente.nomeEtapa),
      consultor: texto(recente.nomeUsuario),
      cadastro,
      atualizado_em_neo: paraTimestampSP(recente.dataHoraAtualizacao),
    });
  }
  return saida;
}

// Mensagem curta para o log: "HTTP 429 LIMITE_API: ..." / "HTTP 502 — <corpo>" / "+ (Retry-After Ns)".
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

// O token vai na URL da API (às vezes percent-encoded): nenhuma mensagem que sai da função pode contê-lo.
export function ocultarToken(msg: string, token: string): string {
  if (!token) return String(msg);
  let out = String(msg).split(token).join("***");
  const codificado = encodeURIComponent(token);
  if (codificado !== token) out = out.split(codificado).join("***");
  return out;
}
