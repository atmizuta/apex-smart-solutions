// Uma rodada da planilha-espelho (§112): (1) guia de entrada → banco; (2) fila → guia do mês; (3) aviso.
// Dependências injetadas: aqui não há rede nem banco (testado com node --test).
import type { Sheets } from "./google.ts";
import type { CfgPlanilha, Guia, LeadPlanilha } from "./planilha.ts";
import { MESES, escolherGuia, escritasDaLinha, guiaEntrada, guiasDoMes, idsDaGuia, leadsDaEntrada, lerCabecalho, linhaNova } from "./planilha.ts";

export type ItemFila = { lead_aba: string; lead_id: string; pedido_em: string; tentativas: number };
export type DepsEspelho = {
  sheets: Sheets; cfg: CfgPlanilha; modo: string;
  pegarFila(limite: number): Promise<ItemFila[]>;
  leadsDaAba(aba: string): Promise<LeadPlanilha[]>;
  buscarLeads(chaves: { aba: string; id: string }[]): Promise<LeadPlanilha[]>;
  marcarFeito(itens: ItemFila[], guiaPorLead: Record<string, string>): Promise<void>;
  marcarFalha(itens: ItemFila[], erro: string): Promise<void>;
  adiar(itens: ItemFila[], motivo: string): Promise<void>;
  inserirEntrada(leads: Record<string, unknown>[]): Promise<{ inseridos: number; atualizados: number }>;
  registrarEntrada(erro: string | null): Promise<void>;
  atrasoMin(): Promise<number | null>;
  avisar(msg: string): Promise<void>;
  // revisão final: uma rodada por vez (cron de 10 s). travar() = false → outra rodada está trabalhando.
  travar(): Promise<boolean>;
  destravar(): Promise<void>;
  idsExistentes(ids: string[]): Promise<Set<string>>;   // quais ids o banco já tem (entrada e ensaio)
};
export type Resultado = {
  ok: boolean; modo: string; entrada?: { inseridos: number; atualizados: number; invalidos: number };
  escritos: number; criados: number; adiados: number; falhas: number; aviso: string;
  ensaio?: Record<string, { atualizar: number; criar: number }>;
  ensaioEntrada?: { lidos: number; novos: Record<string, number>; exemplos: string[] };
  ocupado?: boolean;
};

const LOTE = 100;
const ATRASO_AVISO_MIN = 15;
const chave = (aba: string, id: string) => `${aba}|${id}`;

// Leads da guia de entrada a partir de cfg.entrada_desde (na virada: só o que chegou depois dela).
function filtrarDesde(leads: Record<string, unknown>[], desde?: string): Record<string, unknown>[] {
  const t0 = Date.parse(desde || "");
  if (isNaN(t0)) return leads;
  return leads.filter((l) => { const t = Date.parse(String(l.criado_em_lead || "")); return !isNaN(t) && t >= t0; });
}
// Onde lead novo pode cair: a guia de entrada antiga (FORM-) e as guias do mês atual e do anterior.
// 27/10: o formulário do Facebook passou a escrever direto na guia OUTUBRO — o painel olha todas elas (pedido do Rafael:
// "caiu lead novo na planilha, vai direto para o painel").
function guiasDeEntrada(guias: Guia[], cfg: CfgPlanilha, agoraMs: number): Guia[] {
  const m = new Date(agoraMs - 3 * 3600000).getUTCMonth();
  const lista = [guiaEntrada(guias, cfg), ...guiasDoMes(guias, MESES[m], cfg), ...guiasDoMes(guias, MESES[(m + 11) % 12], cfg)];
  const vistos = new Set<string>();
  return lista.filter((g): g is Guia => !!g && !vistos.has(g.titulo) && !!vistos.add(g.titulo));
}
function mesSP(iso: string): string {
  const t = Date.parse(iso || "");
  return MESES[new Date((isNaN(t) ? Date.now() : t) - 3 * 3600000).getUTCMonth()];
}

export async function rodar(deps: DepsEspelho, op: { ensaioAba?: string; agoraMs?: number }): Promise<Resultado> {
  const res: Resultado = { ok: true, modo: deps.modo, escritos: 0, criados: 0, adiados: 0, falhas: 0, aviso: "" };
  const ensaio = !!op.ensaioAba;
  if (deps.modo !== "painel" && !ensaio) return res;
  if (!ensaio && !(await deps.travar())) { res.ocupado = true; return res; }
  try {
    await rodada(deps, op, res, ensaio);
  } catch (e) {
    // erro geral (sem acesso à planilha, Google fora, cabeçalho de entrada sumiu...): aparece para admin/supervisor
    res.ok = false;
    if (ensaio) throw e;
    await deps.registrarEntrada(`planilha-espelho: ${(e as Error).message}`);
  } finally {
    if (!ensaio) await deps.destravar();
  }
  return res;
}

async function rodada(deps: DepsEspelho, op: { ensaioAba?: string; agoraMs?: number }, res: Resultado, ensaio: boolean): Promise<void> {
  const guias = await deps.sheets.guias();
  const cache = new Map<string, string[][]>();
  const ler = async (t: string) => { if (!cache.has(t)) cache.set(t, await deps.sheets.ler(t)); return cache.get(t)!; };

  // (1) entrada (no ensaio: só conta o que seria criado, por mês, com alguns ids de exemplo)
  try {
    const fontes = guiasDeEntrada(guias, deps.cfg, op.agoraMs ?? Date.now());
    if (!fontes.length) throw new Error("nenhuma guia de leads encontrada na planilha (nem FORM- nem a do mês)");
    const porId = new Map<string, Record<string, unknown>>();
    let invalidos = 0;
    for (const g of fontes) {
      const v = await ler(g.titulo);
      if (!lerCabecalho(v)) continue;   // guia sem o cabeçalho do formulário: ignora
      const l = leadsDaEntrada(v);
      invalidos += l.invalidos;
      for (const x of l.leads) if (!porId.has(String(x.id))) porId.set(String(x.id), x);
    }
    const lidos = { leads: [...porId.values()], invalidos };
    const leadsEntrada = filtrarDesde(lidos.leads, deps.cfg.entrada_desde);
    if (ensaio) {
      const existem = await deps.idsExistentes(leadsEntrada.map((l) => String(l.id)));
      const novos = leadsEntrada.filter((l) => !existem.has(String(l.id)));
      const porMes: Record<string, number> = {};
      for (const l of novos) { const m = mesSP(String(l.criado_em_lead || "")); porMes[m] = (porMes[m] || 0) + 1; }
      res.ensaioEntrada = { lidos: leadsEntrada.length, novos: porMes, exemplos: novos.slice(0, 5).map((l) => String(l.id)) };
    } else {
      // só manda ao banco o que ele ainda não tem (as guias somam ~1.600 leads; normalmente chegam 0 ou 1 novos)
      const existem = await deps.idsExistentes(leadsEntrada.map((l) => String(l.id)));
      const novos = leadsEntrada.filter((l) => !existem.has(String(l.id)));
      const r = novos.length ? await deps.inserirEntrada(novos) : { inseridos: 0, atualizados: 0 };
      res.entrada = { ...r, invalidos: lidos.invalidos };
      await deps.registrarEntrada(null);
    }
  } catch (e) {
    res.ok = false;
    if (ensaio) throw e;
    await deps.registrarEntrada((e as Error).message);
  }

  // (2) fila (ou, no ensaio, todos os leads da aba pedida)
  let itens: ItemFila[];
  let leads: LeadPlanilha[];
  if (ensaio) {
    leads = await deps.leadsDaAba(op.ensaioAba!);
    itens = leads.map((l) => ({ lead_aba: l.aba, lead_id: l.id, pedido_em: "", tentativas: 0 }));
  } else {
    const brutos = await deps.pegarFila(LOTE);
    const vistos = new Set<string>();
    itens = brutos.filter((i) => { const k = chave(i.lead_aba, i.lead_id); if (vistos.has(k)) return false; vistos.add(k); return true; });
    leads = itens.length ? await deps.buscarLeads(itens.map((i) => ({ aba: i.lead_aba, id: i.lead_id }))) : [];
  }
  const porLead = new Map(leads.map((l) => [chave(l.aba, l.id), l]));
  const porAba = new Map<string, ItemFila[]>();
  for (const i of itens) porAba.set(i.lead_aba, [...(porAba.get(i.lead_aba) ?? []), i]);

  const faltando: string[] = [];
  const contagem: Record<string, { atualizar: number; criar: number }> = {};
  for (const [aba, doMes] of porAba) {
    const cands = guiasDoMes(guias, aba, deps.cfg);
    if (!cands.length) {
      faltando.push(aba);
      if (!ensaio) { await deps.adiar(doMes, `guia do mês ${aba} não existe na planilha`); res.adiados += doMes.length; }
      continue;
    }
    try {
      const idsPorGuia = new Map<string, Set<string>>();
      const info = new Map<string, { cab: NonNullable<ReturnType<typeof lerCabecalho>>; linhas: Map<string, number> }>();
      for (const g of cands) {
        const v = await ler(g.titulo);
        const cab = lerCabecalho(v);
        if (!cab || cab.idx.status < 0) throw new Error(`guia "${g.titulo}": cabeçalho ou coluna STATUS não encontrado`);
        const linhas = idsDaGuia(v, cab);
        info.set(g.titulo, { cab, linhas });
        idsPorGuia.set(g.titulo, new Set(linhas.keys()));
      }
      const escritas: { range: string; values: string[][] }[] = [];
      const novas = new Map<string, string[][]>();
      const guiaPorLead: Record<string, string> = {};
      const prontos: ItemFila[] = [];
      for (const i of doMes) {
        const l = porLead.get(chave(i.lead_aba, i.lead_id));
        if (!l) { prontos.push(i); continue; }   // lead apagado do banco: nada a espelhar
        const g = escolherGuia(cands, idsPorGuia, l.id) as Guia;
        const { cab, linhas } = info.get(g.titulo)!;
        const n = linhas.get(l.id);
        contagem[g.titulo] = contagem[g.titulo] ?? { atualizar: 0, criar: 0 };
        if (n) { escritas.push(...escritasDaLinha(g.titulo, cab, n, l)); contagem[g.titulo].atualizar++; res.escritos++; }
        else { novas.set(g.titulo, [...(novas.get(g.titulo) ?? []), linhaNova(cab, l)]); contagem[g.titulo].criar++; res.criados++; }
        guiaPorLead[chave(l.aba, l.id)] = g.titulo;
        prontos.push(i);
      }
      if (!ensaio) {
        for (let k = 0; k < escritas.length; k += 500) await deps.sheets.escrever(escritas.slice(k, k + 500));
        for (const [t, linhas] of novas) await deps.sheets.acrescentar(t, linhas);
        await deps.marcarFeito(prontos, guiaPorLead);
      }
    } catch (e) {
      res.ok = false;
      res.escritos = 0; res.criados = 0;
      res.falhas += doMes.length;
      if (!ensaio) await deps.marcarFalha(doMes, (e as Error).message);
      else throw e;
    }
  }
  if (ensaio) { res.ensaio = contagem; return; }

  // (3) aviso para admin/supervisor
  if (faltando.length) res.aviso = `Crie a guia de ${faltando.join(", ")} na planilha — os leads desse mês estão esperando para ser escritos.`;
  else {
    const atraso = await deps.atrasoMin();
    if (atraso !== null && atraso > ATRASO_AVISO_MIN) res.aviso = `A planilha está atrasada há ${Math.round(atraso)} min (o painel funciona normal; a escrita tenta de novo sozinha).`;
  }
  await deps.avisar(res.aviso);
}
