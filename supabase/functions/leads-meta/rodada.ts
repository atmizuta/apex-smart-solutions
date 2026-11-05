// Uma rodada da leads-meta (§137): busca na Meta → converte → grava (ou só conta no ensaio) → cursor e status.
// Idempotente: a busca volta 15 min antes do cursor e a leads_entrada2 ignora id repetido.
import { converter, horaIso, mesAba } from "./converter.ts";
import type { LeadEntrada } from "./converter.ts";
import type { Meta } from "./meta.ts";

export type Modo = "desligado" | "ensaio" | "paralelo" | "principal";
export type CfgMeta = { modo: Modo; page_id: string; form_ids: string[]; cursor: string | null };
export type StatusMeta = {
  ultima_ok?: string; ultimo_erro?: string; erro_em?: string | null; buscados?: number; inseridos?: number; vistos?: number;
  invalidos?: number; campos_desconhecidos?: string[]; forms_fora?: { id: string; name: string }[]; forms_checado_em?: string;
  forms_erro?: string; forms_buscados?: string[]; ensaio?: ItemEnsaio[];
};
export type ItemEnsaio = { id: string; aba: string; criado_em: string; ja_existia: boolean };
export type DepsMeta = {
  meta: Meta; cfg: CfgMeta; status: StatusMeta; agora: Date;
  idsExistentes(ids: string[]): Promise<Set<string>>;
  inserir(leads: LeadEntrada[], espelho: boolean): Promise<{ inseridos: number; vistos: number }>;
  salvarCursor(iso: string): Promise<void>;
  salvarStatus(s: StatusMeta): Promise<void>;
};
export type ResultadoRodada = { ok: boolean; modo: Modo; buscados: number; inseridos: number; vistos: number; invalidos: number; erro?: string };

export const VOLTA_MIN = 15;
export const SEM_CURSOR_H = 24;
export const FORMS_A_CADA_MIN = 60;
export const ENSAIO_MAX = 300;   // ~30 leads/dia: cobre o ensaio inteiro (id/aba/hora não são dado pessoal)

const semF = (id: string) => id.replace(/^f:/, "");

async function checarForms(d: DepsMeta, st: StatusMeta): Promise<StatusMeta> {
  const ultima = st.forms_checado_em ? Date.parse(st.forms_checado_em) : 0;
  if (d.agora.getTime() - ultima < FORMS_A_CADA_MIN * 60_000) return st;
  try {
    const nossos = new Set(d.cfg.form_ids.map(semF));
    const fora = (await d.meta.forms(d.cfg.page_id)).filter((f) => f.status === "ACTIVE" && !nossos.has(semF(f.id))).map((f) => ({ id: f.id, name: f.name }));
    return { ...st, forms_fora: fora, forms_checado_em: d.agora.toISOString(), forms_erro: "" };
  } catch (e) {
    // sem permissão para listar formulários não pode parar a entrada de leads
    return { ...st, forms_checado_em: d.agora.toISOString(), forms_erro: (e as Error).message };
  }
}

export async function rodar(d: DepsMeta): Promise<ResultadoRodada> {
  const modo = d.cfg.modo;
  const r: ResultadoRodada = { ok: true, modo, buscados: 0, inseridos: 0, vistos: 0, invalidos: 0 };
  if (modo !== "ensaio" && modo !== "paralelo" && modo !== "principal") return r;
  const agoraIso = d.agora.toISOString();
  try {
    const base = d.cfg.cursor ? Date.parse(d.cfg.cursor) - VOLTA_MIN * 60_000 : d.agora.getTime() - SEM_CURSOR_H * 3600_000;
    const desdeSeg = Math.floor(base / 1000);
    // formulário incluído depois em form_ids: o cursor é de todos, então na 1ª vez ele busca as últimas 24 h (revisão final)
    const desde24h = Math.floor((d.agora.getTime() - SEM_CURSOR_H * 3600_000) / 1000);
    const jaBuscados = d.status.forms_buscados ? new Set(d.status.forms_buscados) : null;
    const leads: LeadEntrada[] = [];
    const desconhecidos = new Set<string>();
    for (const formId of d.cfg.form_ids) {
      const id = semF(formId);
      const brutos = await d.meta.leadsDesde(id, jaBuscados && !jaBuscados.has(id) ? Math.min(desdeSeg, desde24h) : desdeSeg);
      if (!brutos.length) continue;
      const nome = await d.meta.nomeForm(id);
      r.buscados += brutos.length;
      for (const b of brutos) {
        const c = converter(b, nome);
        c.desconhecidos.forEach((x) => desconhecidos.add(x));
        if (c.lead) leads.push(c.lead); else r.invalidos++;
      }
    }
    let ensaio: StatusMeta["ensaio"];
    if (modo === "ensaio") {
      const existentes = await d.idsExistentes(leads.map((l) => l.id));
      // acumula entre rodadas (cada rodada só vê ~15 min); ja_existia uma vez verdadeiro fica verdadeiro (revisão final)
      const junto = new Map((d.status.ensaio ?? []).map((x) => [x.id, x]));
      for (const l of leads) {
        const antes = junto.get(l.id);
        junto.set(l.id, { id: l.id, aba: mesAba(l.criado_em_lead), criado_em: l.criado_em_lead, ja_existia: existentes.has(l.id) || !!antes?.ja_existia });
      }
      ensaio = [...junto.values()].sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, ENSAIO_MAX);
    } else if (leads.length) {
      const g = await d.inserir(leads, modo === "principal");
      r.inseridos = g.inseridos;
      r.vistos = g.vistos;
    }
    const maior = leads.map((l) => l.criado_em_lead).sort().at(-1);
    if (maior && (!d.cfg.cursor || Date.parse(maior) > Date.parse(horaIso(d.cfg.cursor) ?? d.cfg.cursor))) await d.salvarCursor(maior);
    let st: StatusMeta = { ...d.status, ultima_ok: agoraIso, ultimo_erro: "", erro_em: null, buscados: r.buscados, inseridos: r.inseridos,
      vistos: r.vistos, invalidos: r.invalidos, campos_desconhecidos: [...desconhecidos], forms_buscados: d.cfg.form_ids.map(semF) };
    if (ensaio) st.ensaio = ensaio;
    st = await checarForms(d, st);
    await d.salvarStatus(st);
    return r;
  } catch (e) {
    const erro = (e as Error).message;
    await d.salvarStatus({ ...d.status, ultimo_erro: erro, erro_em: agoraIso });
    return { ...r, ok: false, erro };
  }
}
