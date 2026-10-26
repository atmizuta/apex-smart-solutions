import { test } from "node:test";
import assert from "node:assert/strict";
import { rodar } from "./espelho.ts";
import type { DepsEspelho, ItemFila } from "./espelho.ts";
import type { LeadPlanilha } from "./planilha.ts";

const CAB = ["", "created_time", "full_name", "VENDEDOR", "STATUS", "OBS", "CONVERTEU?", "RECEITA"];
const lead = (id: string, o: Partial<LeadPlanilha> = {}): LeadPlanilha => ({ aba: "OUTUBRO", id, criado_em_lead: "2026-10-25T22:00:00+00:00",
  full_name: "Zz " + id, consultor: "ZZKCON", status: "EM NEGOCIAÇÂO", obs: "", converteu: false, receita: 0, ...o });
const item = (id: string, aba = "OUTUBRO"): ItemFila => ({ lead_aba: aba, lead_id: id, pedido_em: "2026-10-26T10:00:00Z", tentativas: 0 });

function deps(o: { fila?: ItemFila[]; leads?: LeadPlanilha[]; guias?: { titulo: string; indice: number }[]; valores?: Record<string, string[][]>;
  modo?: string; falharEscrita?: boolean; atraso?: number | null; livre?: boolean; falharGuias?: boolean;
  desde?: string; existentes?: string[] } = {}) {
  const log = { escritas: [] as unknown[], acrescentadas: [] as unknown[], feitos: [] as unknown[], falhas: [] as unknown[], adiados: [] as unknown[],
    avisos: [] as string[], entrada: [] as unknown[], travas: 0, destravas: 0, erroEntrada: [] as (string | null)[], filaLida: 0 };
  const valores = o.valores ?? {
    "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB, ["l:novo", "2026-10-26T08:00:00-03:00", "Zz Novo"]],
    "LEADS CLARO B2B APEX - OUTUBRO": [CAB, ["l:1", "2026-10-25T19:00:00-03:00", "Zz l:1"]],
  };
  const d: DepsEspelho = {
    sheets: {
      async guias() { if (o.falharGuias) throw new Error("Sheets 403: sem permissão"); return o.guias ?? [{ titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 }, { titulo: "FORM- LEADS CLARO B2B APEX - AGOSTO", indice: 1 }]; },
      async ler(t) { return valores[t] ?? []; },
      async escrever(x) { if (o.falharEscrita) throw new Error("Sheets 503: indisponível"); log.escritas.push(...x); },
      async acrescentar(t, l) { if (o.falharEscrita) throw new Error("Sheets 503: indisponível"); log.acrescentadas.push({ t, l }); },
    },
    cfg: { sheet_id: "zz", entrada_prefixo: "FORM-", guia_mes_contem: "CLARO B2B", guias_fixas: { AGOSTO: "FORM- LEADS CLARO B2B APEX - AGOSTO" }, entrada_desde: o.desde },
    modo: o.modo ?? "painel",
    async pegarFila() { log.filaLida++; return o.fila ?? []; },
    async travar() { log.travas++; return o.livre ?? true; },
    async destravar() { log.destravas++; },
    async idsExistentes(ids) { return new Set(ids.filter((i) => (o.existentes ?? []).includes(i))); },
    async leadsDaAba(aba) { return (o.leads ?? []).filter((l) => l.aba === aba); },
    async buscarLeads(ch) { return (o.leads ?? []).filter((l) => ch.some((c) => c.aba === l.aba && c.id === l.id)); },
    async marcarFeito(i, g) { log.feitos.push({ i, g }); },
    async marcarFalha(i, e) { log.falhas.push({ i, e }); },
    async adiar(i, m) { log.adiados.push({ i, m }); },
    async inserirEntrada(l) { log.entrada.push(...l); return { inseridos: 1, atualizados: 0 }; },
    async registrarEntrada(e) { log.erroEntrada.push(e); },
    async atrasoMin() { return o.atraso ?? null; },
    async avisar(m) { log.avisos.push(m); },
  };
  return { d, log };
}

test("modo planilha não faz nada (exceto ensaio)", async () => {
  const { d, log } = deps({ modo: "planilha", fila: [item("l:1")], leads: [lead("l:1")] });
  const r = await rodar(d, {});
  assert.equal(r.escritos + r.criados, 0);
  assert.equal(log.entrada.length, 0);
});

test("entrada: manda os leads da guia FORM- para o banco", async () => {
  const { d, log } = deps();
  const r = await rodar(d, {});
  assert.deepEqual(r.entrada, { inseridos: 1, atualizados: 0, invalidos: 0 });
  assert.equal((log.entrada[0] as { id: string }).id, "l:novo");
});

test("linha existente: escreve; linha que não existe: acrescenta; marca feito com a guia", async () => {
  const { d, log } = deps({ fila: [item("l:1"), item("l:2")], leads: [lead("l:1", { status: "CNPJ INAPTO" }), lead("l:2")] });
  const r = await rodar(d, {});
  assert.equal(r.escritos, 1);
  assert.equal(r.criados, 1);
  assert.ok((log.escritas as { range: string }[]).some((e) => e.range === "'LEADS CLARO B2B APEX - OUTUBRO'!E2"));
  assert.equal((log.acrescentadas[0] as { l: string[][] }).l[0][0], "l:2");
  assert.deepEqual((log.feitos[0] as { g: Record<string, string> }).g, { "OUTUBRO|l:1": "LEADS CLARO B2B APEX - OUTUBRO", "OUTUBRO|l:2": "LEADS CLARO B2B APEX - OUTUBRO" });
});

test("guia do mês não existe: adia sem falhar e avisa para criar", async () => {
  const { d, log } = deps({ fila: [item("l:9", "NOVEMBRO")], leads: [lead("l:9", { aba: "NOVEMBRO" })] });
  const r = await rodar(d, {});
  assert.equal(r.adiados, 1);
  assert.equal(log.falhas.length, 0);
  assert.match(log.avisos.at(-1)!, /Crie a guia de NOVEMBRO/);
});

test("Google fora do ar: marca falha, não marca feito", async () => {
  const { d, log } = deps({ fila: [item("l:1")], leads: [lead("l:1")], falharEscrita: true });
  const r = await rodar(d, {});
  assert.equal(r.falhas, 1);
  assert.equal(log.feitos.length, 0);
  assert.match((log.falhas[0] as { e: string }).e, /Sheets 503/);
});

test("guia sem coluna STATUS: falha com mensagem clara e não escreve nada nela", async () => {
  const { d, log } = deps({ fila: [item("l:1")], leads: [lead("l:1")], valores: { "LEADS CLARO B2B APEX - OUTUBRO": [["", "created_time", "full_name"]], "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB] } });
  await rodar(d, {});
  assert.equal(log.escritas.length + log.acrescentadas.length, 0);
  assert.match((log.falhas[0] as { e: string }).e, /coluna STATUS/);
});

test("atraso > 15 min vira aviso; fila ok limpa o aviso", async () => {
  const a = deps({ atraso: 22 });
  await rodar(a.d, {});
  assert.match(a.log.avisos.at(-1)!, /atrasada há 22 min/);
  const b = deps({ atraso: 3 });
  await rodar(b.d, {});
  assert.equal(b.log.avisos.at(-1), "");
});

test("ensaio: calcula por guia sem escrever, sem entrada e sem mexer na fila", async () => {
  const { d, log } = deps({ modo: "planilha", leads: [lead("l:1"), lead("l:2")] });
  const r = await rodar(d, { ensaioAba: "OUTUBRO" });
  assert.deepEqual(r.ensaio, { "LEADS CLARO B2B APEX - OUTUBRO": { atualizar: 1, criar: 1 } });
  assert.equal(log.escritas.length + log.acrescentadas.length + log.feitos.length + log.entrada.length, 0);
});

test("mesmo lead novo 2x no lote: acrescenta 1 linha só (Review Focus 2)", async () => {
  const { d, log } = deps({ fila: [item("l:2"), item("l:2")], leads: [lead("l:2")] });
  await rodar(d, {});
  assert.equal((log.acrescentadas[0] as { l: string[][] }).l.length, 1);
});

test("outra rodada em andamento: esta não faz nada (Review Focus 2/3, revisão final)", async () => {
  const { d, log } = deps({ livre: false, fila: [item("l:1")], leads: [lead("l:1")] });
  const r = await rodar(d, {});
  assert.equal(r.ocupado, true);
  assert.equal(log.filaLida + log.entrada.length + log.escritas.length, 0);
  assert.equal(log.destravas, 0);
});

test("a trava é liberada mesmo quando a escrita falha", async () => {
  const { d, log } = deps({ fila: [item("l:1")], leads: [lead("l:1")], falharEscrita: true });
  await rodar(d, {});
  assert.equal(log.destravas, 1);
});

test("erro geral (sem acesso à planilha) vira aviso em leads_sync_erro, sem estourar", async () => {
  const { d, log } = deps({ falharGuias: true });
  const r = await rodar(d, {});
  assert.equal(r.ok, false);
  assert.match(String(log.erroEntrada.at(-1)), /Sheets 403/);
  assert.equal(log.destravas, 1);
});

test("entrada_desde: só entra lead criado a partir da data da virada", async () => {
  const valores = { "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB, ["l:velho", "2026-10-20T08:00:00-03:00", "Zz Velho"], ["l:novo", "2026-10-26T08:00:00-03:00", "Zz Novo"]],
    "LEADS CLARO B2B APEX - OUTUBRO": [CAB] };
  const { d, log } = deps({ valores, desde: "2026-10-26T00:00:00-03:00" });
  await rodar(d, {});
  assert.deepEqual(log.entrada.map((x) => (x as { id: string }).id), ["l:novo"]);
});

test("ensaio conta o que a entrada criaria, por mês, com exemplos de id", async () => {
  const valores = { "FORM- LEADS CLARO B2B APEX - AGOSTO": [CAB, ["l:a", "2026-08-10T08:00:00-03:00"], ["l:b", "2026-10-25T08:00:00-03:00"], ["l:c", "2026-10-26T08:00:00-03:00"]],
    "LEADS CLARO B2B APEX - OUTUBRO": [CAB] };
  const { d, log } = deps({ valores, modo: "planilha", existentes: ["l:a"] });
  const r = await rodar(d, { ensaioAba: "OUTUBRO" });
  assert.deepEqual(r.ensaioEntrada, { lidos: 3, novos: { OUTUBRO: 2 }, exemplos: ["l:b", "l:c"] });
  assert.equal(log.entrada.length, 0);
});
