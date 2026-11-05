import { test } from "node:test";
import assert from "node:assert/strict";
import { rodar } from "./rodada.ts";
import type { CfgMeta, DepsMeta, StatusMeta } from "./rodada.ts";
import type { LeadEntrada, LeadMeta } from "./converter.ts";
import type { FormMeta } from "./meta.ts";

const AGORA = new Date("2026-11-04T22:10:00Z");
const lm = (id: string, t = "2026-11-04T22:06:57+0000", campos: LeadMeta["field_data"] = [{ name: "full_name", values: ["Zz " + id] }]): LeadMeta =>
  ({ id, created_time: t, form_id: "444", platform: "fb", field_data: campos });

function deps(o: { cfg?: Partial<CfgMeta>; status?: StatusMeta; leads?: Record<string, LeadMeta[]>; existentes?: string[];
  falharLeads?: boolean; falharForms?: boolean; forms?: FormMeta[] } = {}) {
  const log = { inseridos: [] as { leads: LeadEntrada[]; espelho: boolean }[], cursores: [] as string[], status: [] as StatusMeta[],
    desde: [] as number[], formsChamado: 0 };
  const d: DepsMeta = {
    meta: {
      async leadsDesde(formId, desde) { log.desde.push(desde); if (o.falharLeads) throw new Error("Graph 401 (190): zz"); return o.leads?.[formId] ?? []; },
      async nomeForm() { return "Zz Formulário"; },
      async forms() { log.formsChamado++; if (o.falharForms) throw new Error("Graph 403 (10): zz"); return o.forms ?? [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }]; },
    },
    cfg: { modo: "paralelo", page_id: "999", form_ids: ["444"], cursor: "2026-11-04T22:00:00.000Z", ...o.cfg },
    status: o.status ?? {},
    agora: AGORA,
    async idsExistentes(ids) { return new Set(ids.filter((i) => (o.existentes ?? []).includes(i))); },
    async inserir(leads, espelho) { log.inseridos.push({ leads, espelho }); return { inseridos: leads.length, vistos: 0 }; },
    async salvarCursor(iso) { log.cursores.push(iso); },
    async salvarStatus(s) { log.status.push(s); },
  };
  return { d, log };
}

test("desligado: não chama a Meta nem grava nada", async () => {
  const { d, log } = deps({ cfg: { modo: "desligado" } });
  const r = await rodar(d);
  assert.deepEqual(r, { ok: true, modo: "desligado", buscados: 0, inseridos: 0, vistos: 0, invalidos: 0 });
  assert.equal(log.desde.length + log.inseridos.length + log.cursores.length + log.status.length, 0);
});

test("paralelo: grava sem espelho, cursor = maior created_time, status ok", async () => {
  const { d, log } = deps({ leads: { "444": [lm("1", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:06:57+0000")] } });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 1);
  assert.equal(log.inseridos[0].espelho, false);
  assert.deepEqual(log.inseridos[0].leads.map((l) => l.id), ["l:1", "l:2"]);
  assert.equal(log.inseridos[0].leads[0].form_name, "Zz Formulário");
  assert.deepEqual(log.cursores, ["2026-11-04T22:06:57.000Z"]);
  const s = log.status.at(-1)!;
  assert.equal(s.ultima_ok, AGORA.toISOString());
  assert.equal(s.ultimo_erro, "");
  assert.equal(s.inseridos, 2);
});

test("principal: grava com espelho", async () => {
  const { d, log } = deps({ cfg: { modo: "principal" }, leads: { "444": [lm("1")] } });
  await rodar(d);
  assert.equal(log.inseridos[0].espelho, true);
});

test("busca volta 15 min antes do cursor; sem cursor, últimas 24 h", async () => {
  const a = deps();
  await rodar(a.d);
  assert.equal(a.log.desde[0], Date.parse("2026-11-04T21:45:00Z") / 1000);
  const b = deps({ cfg: { cursor: null } });
  await rodar(b.d);
  assert.equal(b.log.desde[0], Date.parse("2026-11-03T22:10:00Z") / 1000);
});

test("cursor não volta e não é gravado sem lead novo", async () => {
  const { d, log } = deps({ leads: { "444": [lm("1", "2026-11-04T21:50:00+0000")] } });
  await rodar(d);
  assert.deepEqual(log.cursores, []);
});

test("erro na Meta: cursor parado, nada gravado, status com erro e ultima_ok preservada", async () => {
  const { d, log } = deps({ falharLeads: true, status: { ultima_ok: "2026-11-04T22:00:00.000Z" } });
  const r = await rodar(d);
  assert.equal(r.ok, false);
  assert.match(r.erro!, /Graph 401/);
  assert.equal(log.inseridos.length + log.cursores.length, 0);
  const s = log.status.at(-1)!;
  assert.match(s.ultimo_erro!, /Graph 401/);
  assert.equal(s.erro_em, AGORA.toISOString());
  assert.equal(s.ultima_ok, "2026-11-04T22:00:00.000Z");
});

test("ensaio: não grava e guarda id/aba/criado_em/ja_existia sem dado pessoal", async () => {
  const { d, log } = deps({ cfg: { modo: "ensaio" }, leads: { "444": [lm("1", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:02:00+0000")] }, existentes: ["l:1"] });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 0);
  assert.deepEqual(log.status.at(-1)!.ensaio, [
    { id: "l:2", aba: "NOVEMBRO", criado_em: "2026-11-04T22:02:00.000Z", ja_existia: false },
    { id: "l:1", aba: "NOVEMBRO", criado_em: "2026-11-04T22:01:00.000Z", ja_existia: true },
  ]);
  assert.ok(!JSON.stringify(log.status).includes("Zz "));
  assert.equal(log.cursores.length, 1);
});

test("revisão: ensaio acumula entre rodadas (não some no minuto seguinte) e ja_existia não volta a false", async () => {
  const antigo = { id: "l:velho", aba: "NOVEMBRO", criado_em: "2026-11-04T10:00:00.000Z", ja_existia: true };
  const a = deps({ cfg: { modo: "ensaio" }, status: { ensaio: [antigo, { id: "l:1", aba: "NOVEMBRO", criado_em: "2026-11-04T22:01:00.000Z", ja_existia: true }] },
    leads: { "444": [lm("1", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:02:00+0000")] } });
  await rodar(a.d);
  assert.deepEqual(a.log.status.at(-1)!.ensaio!.map((x) => [x.id, x.ja_existia]), [["l:2", false], ["l:1", true], ["l:velho", true]]);
  const b = deps({ cfg: { modo: "ensaio" }, status: { ensaio: [antigo] } });   // rodada sem lead
  await rodar(b.d);
  assert.deepEqual(b.log.status.at(-1)!.ensaio, [antigo]);
});

test("revisão: ensaio guarda até 300, os mais novos", async () => {
  const muitos = Array.from({ length: 310 }, (_, i) => lm(String(i), new Date(Date.parse("2026-11-04T00:00:00Z") + i * 60_000).toISOString()));
  const { d, log } = deps({ cfg: { modo: "ensaio", cursor: null }, leads: { "444": muitos } });
  await rodar(d);
  const e = log.status.at(-1)!.ensaio!;
  assert.equal(e.length, 300);
  assert.equal(e[0].id, "l:309");
  assert.equal(e.at(-1)!.id, "l:10");
});

test("revisão: formulário incluído depois é buscado desde 24 h na 1ª vez; os já buscados seguem o cursor", async () => {
  const { d, log } = deps({ cfg: { form_ids: ["444", "f:777"] }, status: { forms_buscados: ["444"] } });
  await rodar(d);
  assert.equal(log.desde[0], Date.parse("2026-11-04T21:45:00Z") / 1000);
  assert.equal(log.desde[1], Date.parse("2026-11-03T22:10:00Z") / 1000);
  assert.deepEqual(log.status.at(-1)!.forms_buscados, ["444", "777"]);
});

test("lead inválido é contado e os outros seguem; pergunta nova vai para o status", async () => {
  const { d, log } = deps({ leads: { "444": [lm("", "2026-11-04T22:01:00+0000"), lm("2", "2026-11-04T22:02:00+0000", [{ name: "zz_nova", values: ["x"] }])] } });
  const r = await rodar(d);
  assert.equal(r.invalidos, 1);
  assert.deepEqual(log.inseridos[0].leads.map((l) => l.id), ["l:2"]);
  assert.deepEqual(log.status.at(-1)!.campos_desconhecidos, ["zz_nova"]);
});

test("checagem de formulários: 1 vez por hora, avisa ativo fora da lista", async () => {
  const a = deps({ forms: [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "777", name: "Zz Novo", status: "ACTIVE" }, { id: "888", name: "Zz Velho", status: "ARCHIVED" }] });
  await rodar(a.d);
  assert.equal(a.log.formsChamado, 1);
  assert.deepEqual(a.log.status.at(-1)!.forms_fora, [{ id: "777", name: "Zz Novo" }]);
  const b = deps({ status: { forms_checado_em: "2026-11-04T21:30:00.000Z", forms_fora: [] } });
  await rodar(b.d);
  assert.equal(b.log.formsChamado, 0);
});

test("form_ids com prefixo f: também casam na checagem", async () => {
  const { d, log } = deps({ cfg: { form_ids: ["f:444"] } });
  await rodar(d);
  assert.deepEqual(log.status.at(-1)!.forms_fora, []);
});

test("falha só na checagem de formulários não para a entrada", async () => {
  const { d, log } = deps({ falharForms: true, leads: { "444": [lm("1")] } });
  const r = await rodar(d);
  assert.equal(r.ok, true);
  assert.equal(log.inseridos.length, 1);
  const s = log.status.at(-1)!;
  assert.match(s.forms_erro!, /Graph 403/);
  assert.equal(s.ultimo_erro, "");
});
