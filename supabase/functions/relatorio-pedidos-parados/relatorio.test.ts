import { test } from "node:test";
import assert from "node:assert/strict";
import { comPrazo, executarRelatorio, lerTodasPaginas, ocultarSegredo, validarEmails } from "./relatorio.ts";
import type { Deps, Mensagem, RegistroEnvio } from "./relatorio.ts";
import type { Linha } from "./regras.ts";

const LINHA: Linha = {
  numero_pedido: "1001", usuario: "FULANO DE TAL", etapa: "ANTIFRAUDE (NEOCRM)", cadastro: "2026-10-01T12:00:00-03:00",
  atualizacao: "2026-10-05T10:00:00-03:00", valor: 100, quantidade: 1, produto: "Plano A", cliente: "Empresa Teste",
  cnpj: "01234567000189", na_etapa_desde: "2026-10-05T10:00:00-03:00", operacao: "apex",
};

function fakes(o: Partial<Deps> = {}) {
  const enviados: Mensagem[] = [];
  const registros: RegistroEnvio[] = [];
  const chamadas = { planilha: 0, destinatarios: 0, jaEnviou: 0 };
  const deps: Deps = {
    agora: () => new Date("2026-10-14T11:00:00Z"), // quarta, 08:00 SP
    lerDestinatarios: async () => { chamadas.destinatarios++; return { para: ["executiva@exemplo.com"], cc: [], ativo: true }; },
    jaEnviouHoje: async () => { chamadas.jaEnviou++; return false; },
    lerLinhas: async () => [LINHA],
    ultimaSincronizacao: async () => new Date("2026-10-14T10:59:00Z"),
    gerarPlanilha: async () => { chamadas.planilha++; return new Uint8Array([0x50, 0x4b]); },
    enviar: async (m) => { enviados.push(m); },
    registrar: async (r) => { registros.push(r); },
    ...o,
  };
  return { deps, enviados, registros, chamadas };
}

test("envio agendado normal: envia com anexo e registra 'enviado'", async () => {
  const f = fakes();
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "enviado");
  assert.equal(r.qtd_pedidos, 1);
  assert.equal(r.data_ref, "2026-10-14");
  assert.deepEqual(r.destinatarios, ["executiva@exemplo.com"]);
  assert.equal(f.enviados.length, 1);
  assert.deepEqual(f.enviados[0].para, ["executiva@exemplo.com"]);
  assert.equal(f.enviados[0].anexo?.nome, "PedidosParados_2026-10-14.xlsx");
  assert.match(f.enviados[0].assunto, /^Pedidos parados/);
  assert.deepEqual(f.registros, [r]);
});
test("agendado em feriado de dia útil (02/11/2026, segunda): pulado, nada enviado", async () => {
  const f = fakes({ agora: () => new Date("2026-11-02T11:00:00Z") });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "pulado");
  assert.match(r.motivo!, /feriado/);
  assert.equal(f.enviados.length, 0);
  assert.equal(f.registros.length, 1);
});
test("teste em feriado: envia só para os endereços do body, com [TESTE], sem ler destinatários nem duplicidade", async () => {
  const f = fakes({ agora: () => new Date("2026-11-02T11:00:00Z") });
  const r = await executarRelatorio(f.deps, { modo: "teste", paraTeste: [" rafael@exemplo.com "] });
  assert.equal(r.status, "enviado");
  assert.equal(r.modo, "teste");
  assert.deepEqual(f.enviados[0].para, ["rafael@exemplo.com"]);
  assert.deepEqual(f.enviados[0].cc, []);
  assert.match(f.enviados[0].assunto, /^\[TESTE\]/);
  assert.equal(f.chamadas.destinatarios, 0);
  assert.equal(f.chamadas.jaEnviou, 0);
});
test("teste sem endereço válido: erro, nada enviado", async () => {
  for (const paraTeste of [undefined, [], ["sem-arroba"], "rafael@exemplo.com"]) {
    const f = fakes();
    const r = await executarRelatorio(f.deps, { modo: "teste", paraTeste });
    assert.equal(r.status, "erro", JSON.stringify(paraTeste));
    assert.equal(f.enviados.length, 0);
  }
});
test("já enviado hoje: agendado pula; reenviar envia mesmo assim", async () => {
  const a = fakes({ jaEnviouHoje: async () => true });
  const r1 = await executarRelatorio(a.deps, { modo: "agendado" });
  assert.equal(r1.status, "pulado");
  assert.match(r1.motivo!, /já enviado/);
  assert.equal(a.enviados.length, 0);
  const b = fakes({ jaEnviouHoje: async () => true });
  const r2 = await executarRelatorio(b.deps, { modo: "reenviar" });
  assert.equal(r2.status, "enviado");
  assert.equal(b.enviados.length, 1);
});
test("sem destinatário cadastrado ou lista vazia: erro", async () => {
  for (const d of [null, { para: [], cc: [], ativo: true }]) {
    const f = fakes({ lerDestinatarios: async () => d });
    const r = await executarRelatorio(f.deps, { modo: "agendado" });
    assert.equal(r.status, "erro");
    assert.match(r.motivo!, /sem destinatário/);
    assert.equal(f.enviados.length, 0);
  }
});
test("destinatários inativos: pulado (envio pausado)", async () => {
  const f = fakes({ lerDestinatarios: async () => ({ para: ["executiva@exemplo.com"], cc: [], ativo: false }) });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "pulado");
  assert.match(r.motivo!, /pausado/);
});
test("cópia (cc) vai junto e entra na lista de destinatários do log", async () => {
  const f = fakes({ lerDestinatarios: async () => ({ para: ["a@exemplo.com"], cc: ["b@exemplo.com"], ativo: true }) });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.deepEqual(f.enviados[0].cc, ["b@exemplo.com"]);
  assert.deepEqual(r.destinatarios, ["a@exemplo.com", "b@exemplo.com"]);
});
test("falha ao ler a configuração: erro registrado (não estoura)", async () => {
  const f = fakes({ lerDestinatarios: async () => { throw new Error("banco fora"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.erro!, /banco fora/);
  assert.equal(f.registros.length, 1);
});
test("falha ao ler os pedidos: erro, nada enviado (nunca um Excel vazio por engano)", async () => {
  const f = fakes({ lerLinhas: async () => { throw new Error("timeout"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /ler os pedidos/);
  assert.equal(f.enviados.length, 0);
});
test("falha ao gerar a planilha: erro, nada enviado", async () => {
  const f = fakes({ gerarPlanilha: async () => { throw new Error("exceljs quebrou"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /planilha/);
  assert.equal(f.enviados.length, 0);
});
test("SMTP falha: erro registrado com a mensagem", async () => {
  const f = fakes({ enviar: async () => { throw new Error("535 authentication failed"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "erro");
  assert.match(r.motivo!, /SMTP/);
  assert.match(r.erro!, /535/);
  assert.equal(f.registros.length, 1);
});
test("sem pedidos parados: envia sem anexo e sem gerar planilha", async () => {
  const f = fakes({ lerLinhas: async () => [] });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "enviado");
  assert.equal(r.qtd_pedidos, 0);
  assert.equal(f.enviados[0].anexo, null);
  assert.equal(f.chamadas.planilha, 0);
});

test("lerTodasPaginas: junta páginas até vir uma incompleta", async () => {
  const pedidos: Array<[number, number]> = [];
  const r = await lerTodasPaginas(async (de, ate) => {
    pedidos.push([de, ate]);
    return de < 2000 ? Array(1000).fill(0) : Array(5).fill(0);
  });
  assert.equal(r.length, 2005);
  assert.deepEqual(pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});
test("lerTodasPaginas: página exata de 1000 seguida de vazia", async () => {
  let n = 0;
  const r = await lerTodasPaginas(async () => (n++ === 0 ? Array(1000).fill(0) : []));
  assert.equal(r.length, 1000);
  assert.equal(n, 2);
});
test("validarEmails", () => {
  assert.deepEqual(validarEmails([" a@exemplo.com ", "b@exemplo.com"]), ["a@exemplo.com", "b@exemplo.com"]);
  assert.equal(validarEmails([]), null);
  assert.equal(validarEmails(["x"]), null);
  assert.equal(validarEmails("a@exemplo.com"), null);
  assert.equal(validarEmails(Array(11).fill("a@exemplo.com")), null);
});
test("ocultarSegredo troca a senha por ***", () => {
  assert.equal(ocultarSegredo("falhou com senha S3nh@ no login", "S3nh@"), "falhou com senha *** no login");
  assert.equal(ocultarSegredo("sem segredo", undefined), "sem segredo");
  assert.equal(ocultarSegredo("sem segredo", ""), "sem segredo");
});

// Revisão final: falha só ao ler a hora da sincronização não pode cancelar o envio (§4.1: sai com aviso).
test("falha ao ler a hora da sincronização: envia mesmo assim, com o aviso de hora não confirmada", async () => {
  const f = fakes({ ultimaSincronizacao: async () => { throw new Error("config fora"); } });
  const r = await executarRelatorio(f.deps, { modo: "agendado" });
  assert.equal(r.status, "enviado");
  assert.match(f.enviados[0].texto, /não foi possível confirmar a hora da última sincronização/);
});
// Revisão final: a denomailer não tem timeout; SMTP travado mataria a função sem log.
test("comPrazo: rejeita com mensagem de tempo esgotado quando a promessa não termina", async () => {
  await assert.rejects(comPrazo(new Promise(() => {}), 20, "envio SMTP"), /envio SMTP: tempo esgotado \(20 ms\)/);
});
test("comPrazo: devolve o valor quando termina antes do prazo", async () => {
  assert.equal(await comPrazo(Promise.resolve(7), 1000, "x"), 7);
});
