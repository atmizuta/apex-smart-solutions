import { test } from "node:test";
import assert from "node:assert/strict";
import { converter, horaIso, mesAba } from "./converter.ts";
import type { LeadMeta } from "./converter.ts";

const base = (o: Partial<LeadMeta> = {}): LeadMeta => ({
  id: "100200300", created_time: "2026-11-04T22:06:57+0000",
  ad_id: "111", ad_name: "Zz Anúncio", adset_id: "222", adset_name: "Zz Conjunto", campaign_id: "333", campaign_name: "Zz Campanha",
  form_id: "444", is_organic: false, platform: "fb",
  field_data: [
    { name: "qual_o_tipo_da_sua_empresa?", values: ["zz_mei"] },
    { name: "qual_a_quantidade_de_linhas?", values: ["zz_1_a_5"] },
    { name: "qual_o_seu_cnpj?", values: ["00000000000000"] },
    { name: "email", values: ["zz@zz.zz"] },
    { name: "full_name", values: ["Zz Fulano"] },
    { name: "city", values: ["Zz Cidade"] },
    { name: "state", values: ["ZZ"] },
    { name: "phone_number", values: ["+5500000000000"] },
  ],
  ...o,
});

test("converte no formato da planilha: prefixos, p: no telefone, perguntas, CREATED", () => {
  const { lead, desconhecidos } = converter(base(), "Zz Formulário");
  assert.deepEqual(desconhecidos, []);
  assert.deepEqual(lead, {
    id: "l:100200300", criado_em_lead: "2026-11-04T22:06:57.000Z",
    ad_id: "ag:111", ad_name: "Zz Anúncio", adset_id: "as:222", adset_name: "Zz Conjunto", campaign_id: "c:333", campaign_name: "Zz Campanha",
    form_id: "f:444", form_name: "Zz Formulário", is_organic: false, platform: "fb",
    tipo_empresa: "zz_mei", qtd_linhas: "zz_1_a_5", cnpj: "00000000000000", email: "zz@zz.zz", full_name: "Zz Fulano",
    city: "Zz Cidade", state: "ZZ", phone_number: "p:+5500000000000", lead_status: "CREATED",
  });
});

test("orgânico: sem anúncio e sem platform viram null", () => {
  const { lead } = converter(base({ ad_id: undefined, ad_name: undefined, adset_id: undefined, adset_name: undefined,
    campaign_id: undefined, campaign_name: undefined, platform: "", is_organic: true }), null);
  assert.equal(lead!.ad_id, null);
  assert.equal(lead!.campaign_name, null);
  assert.equal(lead!.platform, null);
  assert.equal(lead!.is_organic, true);
  assert.equal(lead!.form_name, null);
});

test("não põe prefixo duas vezes", () => {
  const { lead } = converter(base({ id: "l:100200300", form_id: "f:444" }), null);
  assert.equal(lead!.id, "l:100200300");
  assert.equal(lead!.form_id, "f:444");
  const t = converter(base({ field_data: [{ name: "phone_number", values: ["p:+5500000000000"] }] }), null);
  assert.equal(t.lead!.phone_number, "p:+5500000000000");
});

test("pergunta com nome levemente diferente (sem ?, maiúscula) cai no campo certo", () => {
  const { lead, desconhecidos } = converter(base({ field_data: [{ name: "Qual_o_seu_CNPJ", values: ["00000000000000"] }] }), null);
  assert.equal(lead!.cnpj, "00000000000000");
  assert.deepEqual(desconhecidos, []);
});

test("pergunta desconhecida é ignorada e listada", () => {
  const { lead, desconhecidos } = converter(base({ field_data: [{ name: "zz_pergunta_nova", values: ["x"] }] }), null);
  assert.ok(lead);
  assert.deepEqual(desconhecidos, ["zz_pergunta_nova"]);
});

test("sem id ou com hora inválida: lead null", () => {
  assert.equal(converter(base({ id: "" }), null).lead, null);
  assert.equal(converter(base({ created_time: "ontem" }), null).lead, null);
});

test("horaIso aceita +0000 e -05:00 e dá o mesmo instante", () => {
  assert.equal(horaIso("2026-11-04T22:06:57+0000"), "2026-11-04T22:06:57.000Z");
  assert.equal(horaIso("2026-11-04T17:06:57-05:00"), "2026-11-04T22:06:57.000Z");
  assert.equal(horaIso("zz"), null);
});

test("mesAba usa o horário de São Paulo (igual leads_mes_aba)", () => {
  assert.equal(mesAba("2026-11-04T22:06:57.000Z"), "NOVEMBRO");
  assert.equal(mesAba("2026-12-01T02:30:00.000Z"), "NOVEMBRO");   // 30/11 23:30 em SP
  assert.equal(mesAba("2026-12-01T04:30:00.000Z"), "DEZEMBRO");   // 01/12 01:30 em SP
  assert.equal(mesAba("2026-03-15T12:00:00.000Z"), "MARCO");
});
