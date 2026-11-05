// Receptor do webhook de leads da agência (§137). A agência manda cada lead no formato nativo da Meta;
// aqui confere o token, converte para o formato da planilha e grava (ou só registra, no ensaio).
// Regra da entrega: 200 só depois de gravado. Qualquer outra resposta = a agência reenvia.
// Sem rede e sem Deno: testado com `node --test`.
import { converter, mesAba } from "./converter.ts";
import type { LeadEntrada, LeadMeta } from "./converter.ts";

export type Modo = "desligado" | "ensaio" | "paralelo" | "principal";
export type ItemLog = { lead_id: string; aba: string; criado_em: string; modo: Modo; resultado: "novo" | "repetido" | "ensaio"; ja_existia: boolean };
export type DepsReceb = {
  modo: Modo;
  conferirToken(token: string): Promise<boolean>;   // compara com o token guardado no Vault (hash)
  idsExistentes(ids: string[]): Promise<Set<string>>;
  inserir(leads: LeadEntrada[], espelho: boolean): Promise<{ inseridos: number; vistos: number }>;
  registrar(itens: ItemLog[], campos: string[]): Promise<void>;   // log por lead (sem dado pessoal) + status
  registrarErro(msg: string): Promise<void>;
};
export type Pedido = { metodo: string; auth: string | null; corpo: string };
export type Resposta = { status: number; corpo: Record<string, unknown> };

export const MAX_CORPO = 1_000_000;

export async function receber(p: Pedido, d: DepsReceb): Promise<Resposta> {
  if (p.metodo !== "POST") return { status: 405, corpo: { error: "use POST" } };
  const m = /^Bearer (\S+)$/.exec((p.auth ?? "").trim());
  if (!m || !(await d.conferirToken(m[1]))) {
    await d.registrarErro("token inválido ou ausente (401)");
    return { status: 401, corpo: { error: "não autorizado" } };
  }
  if (d.modo !== "ensaio" && d.modo !== "paralelo" && d.modo !== "principal") {
    return { status: 503, corpo: { error: "recebimento desligado; reenviar depois" } };
  }
  if (p.corpo.length > MAX_CORPO) return { status: 413, corpo: { error: "corpo grande demais" } };
  let bruto: unknown;
  try { bruto = JSON.parse(p.corpo); } catch { bruto = undefined; }
  const lista = (Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" ? [bruto] : []) as LeadMeta[];
  if (!lista.length) {
    await d.registrarErro("JSON inválido ou sem lead (400)");
    return { status: 400, corpo: { error: "JSON inválido: mande um lead (objeto) ou uma lista de leads" } };
  }
  try {
    const leads: LeadEntrada[] = [];
    const campos = new Set<string>();
    let invalidos = 0;
    for (const b of lista) {
      const c = converter(b, null);
      c.desconhecidos.forEach((x) => campos.add(x));
      if (c.lead) leads.push(c.lead); else invalidos++;
    }
    const existentes = leads.length ? await d.idsExistentes(leads.map((l) => l.id)) : new Set<string>();
    let novos = 0;
    if (leads.length && d.modo !== "ensaio") novos = (await d.inserir(leads, d.modo === "principal")).inseridos;
    const itens: ItemLog[] = leads.map((l) => ({
      lead_id: l.id, aba: mesAba(l.criado_em_lead), criado_em: l.criado_em_lead, modo: d.modo,
      resultado: d.modo === "ensaio" ? "ensaio" : existentes.has(l.id) ? "repetido" : "novo", ja_existia: existentes.has(l.id),
    }));
    if (itens.length) await d.registrar(itens, [...campos]);
    const corpo = { ok: invalidos === 0, modo: d.modo, recebidos: leads.length, novos, ids: leads.map((l) => l.id) };
    if (invalidos) {
      await d.registrarErro(`${invalidos} lead(s) sem id ou com data inválida (400)`);
      return { status: 400, corpo: { ...corpo, invalidos, error: "lead sem id ou com created_time inválido" } };
    }
    return { status: 200, corpo };
  } catch (e) {
    // falha nossa (banco): 500 faz a agência reenviar; a mensagem nunca leva dado do lead
    const msg = (e as Error).message;
    await d.registrarErro(`falha ao gravar (500): ${msg}`).catch(() => null);
    return { status: 500, corpo: { error: "falha temporária; reenviar" } };
  }
}
