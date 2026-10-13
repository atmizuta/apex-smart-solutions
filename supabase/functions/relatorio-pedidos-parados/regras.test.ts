import { test } from "node:test";
import assert from "node:assert/strict";
import {
  criticidade, diaSp, diasUteisDesde, ehDiaUtil, etapaCurta, feriadosNacionais, fmtDataHoraSp, fmtDiaBr,
  montarPedidos, resumir,
} from "./regras.ts";
import type { Linha } from "./regras.ts";

const linha = (o: Partial<Linha> = {}): Linha => ({
  numero_pedido: "1001", usuario: "FULANO DE TAL", etapa: "ANTIFRAUDE (NEOCRM)",
  cadastro: "2026-10-01T12:00:00-03:00", atualizacao: "2026-10-05T10:00:00-03:00",
  valor: 100, quantidade: 1, produto: "Plano A", cliente: "Empresa Teste", cnpj: "01234567000189",
  na_etapa_desde: "2026-10-05T10:00:00-03:00", operacao: "apex", ...o,
});

// ---------------------------------------------------------------- feriados e dias úteis
test("feriados 2026: fixos e móveis (Carnaval = segunda e terça)", () => {
  const f = feriadosNacionais(2026);
  for (const d of ["2026-01-01", "2026-02-16", "2026-02-17", "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04",
    "2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"]) assert.ok(f.has(d), d);
  assert.ok(!f.has("2026-02-18"), "Quarta-feira de Cinzas não é feriado");
});
test("feriados 2027: móveis", () => {
  const f = feriadosNacionais(2027);
  for (const d of ["2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27"]) assert.ok(f.has(d), d);
});
test("ehDiaUtil: terça comum sim; feriado, sábado e domingo não", () => {
  assert.equal(ehDiaUtil("2026-10-13"), true);
  assert.equal(ehDiaUtil("2026-10-12"), false);
  assert.equal(ehDiaUtil("2026-10-17"), false);
  assert.equal(ehDiaUtil("2026-10-18"), false);
});
test("diasUteisDesde: sexta → segunda = 1; mesmo dia = 0; referência antes = 0", () => {
  assert.equal(diasUteisDesde("2026-10-02", "2026-10-05"), 1);
  assert.equal(diasUteisDesde("2026-10-13", "2026-10-13"), 0);
  assert.equal(diasUteisDesde("2026-10-14", "2026-10-13"), 0);
});
test("diasUteisDesde: pula o feriado de segunda (sexta 09/10 → terça 13/10 = 1)", () => {
  assert.equal(diasUteisDesde("2026-10-09", "2026-10-13"), 1);
});
test("diasUteisDesde: 01/10 → 13/10 = 7 (sem fins de semana nem 12/10)", () => {
  assert.equal(diasUteisDesde("2026-10-01", "2026-10-13"), 7);
});

// ---------------------------------------------------------------- datas em São Paulo
test("diaSp: 23:30 de São Paulo (02:30 UTC do dia seguinte) fica no dia de São Paulo", () => {
  assert.equal(diaSp("2026-10-09T02:30:00Z"), "2026-10-08");
  assert.equal(diaSp(new Date("2026-10-14T11:00:00Z")), "2026-10-14");
});
test("diaSp: vazio ou inválido → null", () => {
  assert.equal(diaSp(null), null);
  assert.equal(diaSp(""), null);
  assert.equal(diaSp("lixo"), null);
});
test("fmtDiaBr e fmtDataHoraSp", () => {
  assert.equal(fmtDiaBr("2026-10-14"), "14/10/2026");
  assert.equal(fmtDataHoraSp(new Date("2026-10-14T10:59:00Z")), "14/10/2026 07:59");
});

// ---------------------------------------------------------------- criticidade
test("criticidade nas fronteiras 3/4 e 6/7", () => {
  assert.equal(criticidade(0), "baixa");
  assert.equal(criticidade(3), "baixa");
  assert.equal(criticidade(4), "media");
  assert.equal(criticidade(6), "media");
  assert.equal(criticidade(7), "alta");
  assert.equal(criticidade(40), "alta");
});
test("etapaCurta tira o sufixo (NEOCRM)", () => {
  assert.equal(etapaCurta("ANTIFRAUDE (NEOCRM)"), "ANTIFRAUDE");
  assert.equal(etapaCurta("ENTREGA (NEOCRM)"), "ENTREGA");
});

// ---------------------------------------------------------------- agrupamento
test("montarPedidos: agrupa as linhas do mesmo pedido", () => {
  const [p, ...resto] = montarPedidos([
    linha({ valor: 100, quantidade: 1, produto: "Plano B", cadastro: "2026-10-02T09:00:00-03:00" }),
    linha({ valor: "50.5", quantidade: 2, produto: "Plano A", cadastro: "2026-10-01T08:00:00-03:00",
      atualizacao: "2026-10-06T15:00:00-03:00" }),
    linha({ valor: 0, quantidade: 0, produto: "Plano A" }),
  ], "2026-10-13");
  assert.equal(resto.length, 0);
  assert.equal(p.numero_pedido, "1001");
  assert.equal(p.valor, 150.5);
  assert.equal(p.qtd, 3);
  assert.equal(p.produtos, "Plano A + Plano B");
  assert.equal(p.cadastro, "2026-10-01T08:00:00-03:00");
  assert.equal(p.atualizacao, "2026-10-06T15:00:00-03:00");
  assert.equal(p.dias, 5); // na etapa desde 05/10 → 06, 07, 08, 09, 13
  assert.equal(p.criticidade, "media");
  assert.equal(p.consultor, "FULANO DE TAL");
  assert.equal(p.cnpj, "01234567000189");
});
test("montarPedidos: ignora outras etapas e pedido sem número", () => {
  const r = montarPedidos([
    linha({ numero_pedido: "1", etapa: "BIOMETRIA (NEOCRM)" }),
    linha({ numero_pedido: "  " }),
    linha({ numero_pedido: null }),
    linha({ numero_pedido: "2", etapa: "ENTREGA (NEOCRM)" }),
  ], "2026-10-13");
  assert.deepEqual(r.map((p) => p.numero_pedido), ["2"]);
});
test("montarPedidos: operação campinas → Campinas; nula ou apex → Apex", () => {
  const r = montarPedidos([
    linha({ numero_pedido: "1", operacao: "campinas" }),
    linha({ numero_pedido: "2", operacao: null }),
    linha({ numero_pedido: "3", operacao: "apex" }),
  ], "2026-10-13");
  const op = Object.fromEntries(r.map((p) => [p.numero_pedido, p.operacao]));
  assert.deepEqual(op, { "1": "Campinas", "2": "Apex", "3": "Apex" });
});
test("montarPedidos: sem na_etapa_desde usa a última atualização", () => {
  const [p] = montarPedidos([linha({ na_etapa_desde: null, atualizacao: "2026-10-09T10:00:00-03:00" })], "2026-10-13");
  assert.equal(p.dias, 1);
  assert.equal(p.na_etapa_desde, "2026-10-09T10:00:00-03:00");
});
test("montarPedidos: pedido sem nenhuma data entra com 0 dias e Baixa (não some)", () => {
  const r = montarPedidos([linha({ na_etapa_desde: null, atualizacao: null, cadastro: null })], "2026-10-13");
  assert.equal(r.length, 1);
  assert.equal(r[0].dias, 0);
  assert.equal(r[0].criticidade, "baixa");
});
test("montarPedidos: ordem = dias desc, depois Antifraude antes de Entrega, depois número numérico", () => {
  const velho = "2026-09-01T10:00:00-03:00";
  const r = montarPedidos([
    linha({ numero_pedido: "1000", etapa: "ENTREGA (NEOCRM)" }),
    linha({ numero_pedido: "900", etapa: "ENTREGA (NEOCRM)" }),
    linha({ numero_pedido: "5", etapa: "ANTIFRAUDE (NEOCRM)" }),
    linha({ numero_pedido: "7", etapa: "ENTREGA (NEOCRM)", na_etapa_desde: velho }),
  ], "2026-10-13");
  assert.deepEqual(r.map((p) => p.numero_pedido), ["7", "5", "900", "1000"]);
});

// ---------------------------------------------------------------- resumo
test("resumir: conta por etapa e criticidade, com as duas etapas sempre presentes", () => {
  const r = resumir(montarPedidos([
    linha({ numero_pedido: "1", na_etapa_desde: "2026-09-01T10:00:00-03:00" }), // alta
    linha({ numero_pedido: "2" }), // média (5)
    linha({ numero_pedido: "3", na_etapa_desde: "2026-10-13T08:00:00-03:00" }), // baixa (0)
  ], "2026-10-13"));
  assert.deepEqual(r.porEtapa["ANTIFRAUDE (NEOCRM)"], { alta: 1, media: 1, baixa: 1, total: 3 });
  assert.deepEqual(r.porEtapa["ENTREGA (NEOCRM)"], { alta: 0, media: 0, baixa: 0, total: 0 });
  assert.deepEqual(r.total, { alta: 1, media: 1, baixa: 1, total: 3 });
});
