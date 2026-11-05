import { test } from "node:test";
import assert from "node:assert/strict";
import { receber } from "./recebimento.ts";
import type { DepsReceb, ItemLog, Modo } from "./recebimento.ts";
import type { LeadEntrada } from "./converter.ts";

const TOKEN = "zz-token-de-teste-123";
const lead = (id: string, o: Record<string, unknown> = {}) => ({
  id, created_time: "2026-11-05T14:30:00+0000", form_id: "444", form_name: "Zz Formulário", platform: "fb",
  field_data: [{ name: "full_name", values: ["Zz " + id] }, { name: "phone_number", values: ["+5500000000000"] }], ...o,
});
const pedido = (corpo: unknown, auth: string | null = `Bearer ${TOKEN}`, metodo = "POST") =>
  ({ metodo, auth, corpo: typeof corpo === "string" ? corpo : JSON.stringify(corpo) });

function deps(o: { modo?: Modo; existentes?: string[]; falharInserir?: boolean } = {}) {
  const log = { inseridos: [] as { leads: LeadEntrada[]; espelho: boolean }[], registros: [] as { itens: ItemLog[]; campos: string[] }[], erros: [] as string[], conferidos: [] as string[] };
  const d: DepsReceb = {
    modo: o.modo ?? "paralelo",
    async conferirToken(t) { log.conferidos.push(t); return t === TOKEN; },
    async idsExistentes(ids) { return new Set(ids.filter((i) => (o.existentes ?? []).includes(i))); },
    async inserir(leads, espelho) {
      if (o.falharInserir) throw new Error("gravar leads (código 57014)");
      log.inseridos.push({ leads, espelho });
      return { inseridos: leads.filter((l) => !(o.existentes ?? []).includes(l.id)).length, vistos: 0 };
    },
    async registrar(itens, campos) { log.registros.push({ itens, campos }); },
    async registrarErro(msg) { log.erros.push(msg); },
  };
  return { d, log };
}

test("só POST", async () => {
  const { d } = deps();
  assert.equal((await receber(pedido({}, `Bearer ${TOKEN}`, "GET"), d)).status, 405);
});

test("token errado ou ausente: 401 e registra o erro, sem gravar", async () => {
  for (const auth of [null, "Bearer outro", TOKEN, `Bearer ${TOKEN}x`]) {
    const { d, log } = deps();
    const r = await receber(pedido(lead("1"), auth), d);
    assert.equal(r.status, 401);
    assert.equal(log.inseridos.length + log.registros.length, 0);
    assert.match(log.erros[0], /token/);
  }
});

test("desligado: 503 para a agência reenviar depois", async () => {
  const { d, log } = deps({ modo: "desligado" });
  const r = await receber(pedido(lead("1")), d);
  assert.equal(r.status, 503);
  assert.equal(log.inseridos.length, 0);
});

test("JSON inválido ou vazio: 400", async () => {
  for (const corpo of ["{nao é json", "[]", "null", "123"]) {
    const { d, log } = deps();
    assert.equal((await receber(pedido(corpo), d)).status, 400, corpo);
    assert.equal(log.inseridos.length, 0);
    assert.equal(log.erros.length, 1);
  }
});

test("paralelo: grava sem espelho, 200 com o id, registra novo", async () => {
  const { d, log } = deps();
  const r = await receber(pedido(lead("100")), d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, modo: "paralelo", recebidos: 1, novos: 1, ids: ["l:100"] });
  assert.equal(log.inseridos[0].espelho, false);
  assert.equal(log.inseridos[0].leads[0].id, "l:100");
  assert.equal(log.inseridos[0].leads[0].form_name, "Zz Formulário");
  assert.equal(log.inseridos[0].leads[0].phone_number, "p:+5500000000000");
  assert.deepEqual(log.registros[0].itens, [{ lead_id: "l:100", aba: "NOVEMBRO", criado_em: "2026-11-05T14:30:00.000Z", modo: "paralelo", resultado: "novo", ja_existia: false }]);
});

test("principal: grava com espelho", async () => {
  const { d, log } = deps({ modo: "principal" });
  await receber(pedido(lead("100")), d);
  assert.equal(log.inseridos[0].espelho, true);
});

test("reenvio do mesmo id: 200, marcado repetido, sem duplicar", async () => {
  const { d, log } = deps({ existentes: ["l:100"] });
  const r = await receber(pedido(lead("100")), d);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.novos, 0);
  assert.equal(log.registros[0].itens[0].resultado, "repetido");
  assert.equal(log.registros[0].itens[0].ja_existia, true);
});

test("ensaio: não grava em leads, registra resultado ensaio e ja_existia", async () => {
  const { d, log } = deps({ modo: "ensaio", existentes: ["l:1"] });
  const r = await receber(pedido([lead("1"), lead("2")]), d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { ok: true, modo: "ensaio", recebidos: 2, novos: 0, ids: ["l:1", "l:2"] });
  assert.equal(log.inseridos.length, 0);
  assert.deepEqual(log.registros[0].itens.map((i) => [i.lead_id, i.resultado, i.ja_existia]), [["l:1", "ensaio", true], ["l:2", "ensaio", false]]);
});

test("lista com um lead inválido: grava os válidos e responde 400 dizendo qual", async () => {
  const { d, log } = deps();
  const r = await receber(pedido([lead("1"), lead("", { created_time: "ontem" })]), d);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.invalidos, 1);
  assert.deepEqual(log.inseridos[0].leads.map((l) => l.id), ["l:1"]);
  assert.equal(log.erros.length, 1);
});

test("pergunta desconhecida vai para o registro (o ensaio mostra campos fora do padrão)", async () => {
  const { d, log } = deps({ modo: "ensaio" });
  await receber(pedido(lead("1", { field_data: [{ name: "nome_da_empresa", values: ["Zz"] }] })), d);
  assert.deepEqual(log.registros[0].campos, ["nome_da_empresa"]);
});

test("falha no banco: 500 (a agência reenvia), erro registrado sem dado pessoal", async () => {
  const { d, log } = deps({ falharInserir: true });
  const r = await receber(pedido(lead("1")), d);
  assert.equal(r.status, 500);
  assert.equal(log.registros.length, 0);
  assert.match(log.erros[0], /57014/);
  assert.ok(!log.erros[0].includes("Zz"));
});

test("corpo grande demais: 413", async () => {
  const { d } = deps();
  assert.equal((await receber(pedido("x".repeat(1_000_001)), d)).status, 413);
});

test("token: só o que vem depois de 'Bearer ' vai para a conferência; sem Bearer nem chama", async () => {
  const a = deps();
  await receber(pedido(lead("1")), a.d);
  assert.deepEqual(a.log.conferidos, [TOKEN]);
  const b = deps();
  assert.equal((await receber(pedido(lead("1"), "Basic xyz"), b.d)).status, 401);
  assert.deepEqual(b.log.conferidos, []);
});
