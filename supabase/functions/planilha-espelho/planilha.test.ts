import { test } from "node:test";
import assert from "node:assert/strict";
import { norm, guiaEntrada, guiasDoMes, escolherGuia, lerCabecalho, idsDaGuia, colLetra, formatarReceita, isoSP,
  escritasDaLinha, linhaNova, leadsDaEntrada } from "./planilha.ts";
import type { CfgPlanilha, Guia, LeadPlanilha } from "./planilha.ts";

const cfg: CfgPlanilha = { sheet_id: "zz", entrada_prefixo: "FORM-", guia_mes_contem: "CLARO B2B",
  guias_fixas: { AGOSTO: "FORM- LEADS CLARO B2B APEX - AGOSTO" } };
const guias: Guia[] = [
  { titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 },
  { titulo: "LEADS CLARO B2B APEX - SETEMBRO 26", indice: 1 },
  { titulo: "LEADS FIBRA CLARO APEX - SETEMBRO", indice: 2 },
  { titulo: "FORM- LEADS CLARO B2B APEX - AGOSTO", indice: 3 },
  { titulo: "Resumo Conversão", indice: 4 },
];
const CAB = ["", "created_time", "ad_id", "campaign_id", "full_name", "phone_number", "qual_o_seu_cnpj?", "lead_status", "VENDEDOR", "STATUS", "OBS", "CONVERTEU?", "RECEITA"];
const lead = (o: Partial<LeadPlanilha> = {}): LeadPlanilha => ({ aba: "OUTUBRO", id: "l:zz1", criado_em_lead: "2026-10-25T22:04:00+00:00",
  full_name: "Zz Empresa", phone_number: "11900000001", cnpj: "00000000000101", lead_status: "CREATED", campaign_id: "zzc",
  consultor: "ZZKCON", status: "EM NEGOCIAÇÂO", obs: "retornar", converteu: false, receita: 0, ...o });

test("norm tira acento, espaço repetido e caixa", () => {
  assert.equal(norm("  Em  negociação "), "EM NEGOCIACAO");
});
test("guia de entrada pelo prefixo", () => {
  assert.equal(guiaEntrada(guias, cfg)?.indice, 3);
});
test("guia do mês: ignora FORM-, Fibra e outros meses (Review Focus 1)", () => {
  assert.deepEqual(guiasDoMes(guias, "SETEMBRO", cfg).map((g) => g.titulo), ["LEADS CLARO B2B APEX - SETEMBRO 26"]);
  assert.deepEqual(guiasDoMes(guias, "OUTUBRO", cfg).map((g) => g.indice), [0]);
  assert.deepEqual(guiasDoMes(guias, "NOVEMBRO", cfg), []);
});
test("guia fixa: AGOSTO escreve na própria FORM- (Review Focus 5)", () => {
  assert.deepEqual(guiasDoMes(guias, "AGOSTO", cfg).map((g) => g.indice), [3]);
});
test("duas guias do mesmo mês: vale a que já tem o id; senão a primeira", () => {
  const dup: Guia[] = [{ titulo: "LEADS CLARO B2B APEX - OUTUBRO", indice: 0 }, { titulo: "LEADS CLARO B2B APEX - OUTUBRO 27", indice: 1 }];
  const ids = new Map([["LEADS CLARO B2B APEX - OUTUBRO 27", new Set(["l:zz1"])]]);
  assert.equal(escolherGuia(dup, ids, "l:zz1")?.indice, 1);
  assert.equal(escolherGuia(dup, ids, "l:outro")?.indice, 0);
  assert.equal(escolherGuia([], ids, "l:zz1"), null);
});
test("cabeçalho com linha extra antes, VENDEDOR como consultor", () => {
  const cab = lerCabecalho([["título solto"], CAB, ["l:zz1", "2026-10-25T19:04:00-03:00"]])!;
  assert.equal(cab.linha, 2);
  assert.deepEqual(cab.idx, { id: 0, consultor: 8, status: 9, obs: 10, converteu: 11, receita: 12 });
});
test("cabeçalho com consultor em branco antes de STATUS", () => {
  const semNome = [...CAB]; semNome[8] = "";
  assert.equal(lerCabecalho([semNome])!.idx.consultor, 8);
});
test("sem cabeçalho → null", () => {
  assert.equal(lerCabecalho([["a", "b"]]), null);
});
test("ids da guia viram nº de linha A1", () => {
  const cab = lerCabecalho([CAB, ["l:zz1"], [], ["l:zz2"]])!;
  assert.deepEqual([...idsDaGuia([CAB, ["l:zz1"], [], ["l:zz2"]], cab)], [["l:zz1", 2], ["l:zz2", 4]]);
});
test("colLetra", () => {
  assert.deepEqual([0, 25, 26, 51, 52].map(colLetra), ["A", "Z", "AA", "AZ", "BA"]);
});
test("receita no formato brasileiro; zero/nulo vazio", () => {
  assert.equal(formatarReceita(1234.5), "1.234,50");
  assert.equal(formatarReceita(0), "");
  assert.equal(formatarReceita(null), "");
});
test("isoSP", () => {
  assert.equal(isoSP("2026-10-25T22:04:00+00:00"), "2026-10-25T19:04:00-03:00");
  assert.equal(isoSP(null), "");
});
test("escritas só nas colunas de trabalho, com aspas no título", () => {
  const cab = lerCabecalho([CAB])!;
  const e = escritasDaLinha("LEADS D'OUTUBRO", cab, 7, lead({ converteu: true, receita: 99 }));
  assert.deepEqual(e.map((x) => x.range), ["'LEADS D''OUTUBRO'!I7", "'LEADS D''OUTUBRO'!J7", "'LEADS D''OUTUBRO'!K7", "'LEADS D''OUTUBRO'!L7", "'LEADS D''OUTUBRO'!M7"]);
  assert.deepEqual(e.map((x) => x.values[0][0]), ["ZZKCON", "EM NEGOCIAÇÂO", "retornar", "sim", "99,00"]);
});
test("linha nova na ordem do cabeçalho", () => {
  const cab = lerCabecalho([CAB])!;
  const l = linhaNova(cab, lead());
  assert.equal(l.length, CAB.length);
  assert.deepEqual([l[0], l[1], l[4], l[5], l[6], l[8], l[9]], ["l:zz1", "2026-10-25T19:04:00-03:00", "Zz Empresa", "11900000001", "00000000000101", "ZZKCON", "EM NEGOCIAÇÂO"]);
  assert.equal(l[11], "");
});
test("entrada: lê leads, pula sem id e data inválida", () => {
  const r = leadsDaEntrada([CAB, ["l:zz1", "2026-10-25T19:04:00-03:00", "", "zzc", "Zz Empresa", "11900000001", "00000000000101", "CREATED"],
    ["", "2026-10-25T19:05:00-03:00"], ["l:zz2", "ERRO - NUNCA EXCLUIR LINHAS"]]);
  assert.equal(r.leads.length, 1);
  assert.equal(r.invalidos, 1);
  assert.deepEqual([r.leads[0].id, r.leads[0].full_name, r.leads[0].cnpj, r.leads[0].campaign_id], ["l:zz1", "Zz Empresa", "00000000000101", "zzc"]);
});
