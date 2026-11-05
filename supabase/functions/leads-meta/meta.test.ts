import { test } from "node:test";
import assert from "node:assert/strict";
import { criarMeta, GRAPH_VERSAO, MAX_PAGINAS } from "./meta.ts";

type Chamada = { url: string; init?: RequestInit };
function falso(respostas: (Chamada & { status?: number; corpo: unknown })[] | ((c: Chamada) => { status?: number; corpo: unknown })) {
  const chamadas: Chamada[] = [];
  let i = 0;
  const f = async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    const r = typeof respostas === "function" ? respostas({ url, init }) : respostas[i++];
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  };
  return { f, chamadas };
}
const G = `https://graph.facebook.com/${GRAPH_VERSAO}`;

test("leadsDesde: monta URL com campos e filtro, token só no cabeçalho, segue paginação", async () => {
  const { f, chamadas } = falso([
    { url: "", corpo: { data: [{ id: "1", created_time: "2026-11-04T22:00:00+0000" }], paging: { next: `${G}/444/leads?after=zz` } } },
    { url: "", corpo: { data: [{ id: "2", created_time: "2026-11-04T22:01:00+0000" }] } },
  ]);
  const leads = await criarMeta("tokzz", f).leadsDesde("444", 1762293000);
  assert.deepEqual(leads.map((l) => l.id), ["1", "2"]);
  const u = new URL(chamadas[0].url);
  assert.equal(u.origin + u.pathname, `${G}/444/leads`);
  assert.equal(u.searchParams.get("fields"), "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data");
  assert.deepEqual(JSON.parse(u.searchParams.get("filtering")!), [{ field: "time_created", operator: "GREATER_THAN", value: 1762293000 }]);
  assert.equal(u.searchParams.get("limit"), "100");
  assert.equal(u.searchParams.get("access_token"), null);
  assert.equal((chamadas[0].init?.headers as Record<string, string>).Authorization, "Bearer tokzz");
  assert.equal(chamadas[1].url, `${G}/444/leads?after=zz`);
  assert.equal((chamadas[1].init?.headers as Record<string, string>).Authorization, "Bearer tokzz");
});

test("leadsDesde: para em MAX_PAGINAS com erro claro (next em loop)", async () => {
  const { f, chamadas } = falso(() => ({ corpo: { data: [], paging: { next: `${G}/444/leads?after=loop` } } }));
  await assert.rejects(criarMeta("tokzz", f).leadsDesde("444", 0), /mais de 50 páginas/);
  assert.equal(chamadas.length, MAX_PAGINAS);
});

test("erro HTTP vira exceção com status e mensagem da Meta, sem o token", async () => {
  const { f } = falso([{ url: "", status: 401, corpo: { error: { message: "Error validating access token tokzz", code: 190 } } }]);
  await assert.rejects(criarMeta("tokzz", f).leadsDesde("444", 0), (e: Error) => {
    assert.match(e.message, /^Graph 401 \(190\): Error validating access token/);
    assert.doesNotMatch(e.message, /tokzz/);
    return true;
  });
});

test("erro no corpo com HTTP 200 também vira exceção", async () => {
  const { f } = falso([{ url: "", corpo: { error: { message: "zz", code: 100 } } }]);
  await assert.rejects(criarMeta("tokzz", f).nomeForm("444"), /Graph 200 \(100\): zz/);
});

test("nomeForm e forms", async () => {
  const { f, chamadas } = falso([
    { url: "", corpo: { id: "444", name: "Zz Formulário" } },
    { url: "", corpo: { data: [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "555", name: "Zz Velho", status: "ARCHIVED" }] } },
  ]);
  const m = criarMeta("tokzz", f);
  assert.equal(await m.nomeForm("444"), "Zz Formulário");
  assert.deepEqual(await m.forms("999"), [{ id: "444", name: "Zz Formulário", status: "ACTIVE" }, { id: "555", name: "Zz Velho", status: "ARCHIVED" }]);
  assert.equal(chamadas[0].url, `${G}/444?fields=name`);
  assert.equal(chamadas[1].url, `${G}/999/leadgen_forms?fields=id%2Cname%2Cstatus&limit=100`);
});

test("revisão: next com access_token é limpo antes de seguir", async () => {
  const { f, chamadas } = falso([
    { url: "", corpo: { data: [], paging: { next: `${G}/444/leads?access_token=tokzz&after=zz` } } },
    { url: "", corpo: { data: [] } },
  ]);
  await criarMeta("tokzz", f).leadsDesde("444", 0);
  assert.doesNotMatch(chamadas[1].url, /tokzz|access_token/);
  assert.match(chamadas[1].url, /after=zz/);
});

test("revisão: erro de rede com a URL na mensagem não leva o token", async () => {
  const f = async (url: string) => { throw new Error(`error sending request for url (${url}?access_token=tokzz): dns error`); };
  await assert.rejects(criarMeta("tokzz", f).nomeForm("444"), (e: Error) => {
    assert.doesNotMatch(e.message, /tokzz/);
    assert.match(e.message, /^Graph rede: /);
    return true;
  });
});
