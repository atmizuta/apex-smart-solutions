import { test } from "node:test";
import assert from "node:assert/strict";
import { mascarar, validarEntrada, montarPrompt, lerRespostaIA, responder, LIMITE_CHAMADAS } from "./ia.ts";
import type { DepsIA } from "./ia.ts";

test("mascarar: CPF, CNPJ, telefone, CEP e e-mail viram marcadores; texto comercial fica", () => {
  const t = "cnpj 11.222.333/0001-81, cpf 123.456.789-09, tel (19) 99000-0001, cep 13010-000, a@b.com.br. 12 linhas na Vivo";
  const m = mascarar(t);
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(m) && m.includes("[CPF]"));
  assert.ok(m.includes("[CNPJ]") && m.includes("[TELEFONE]") && m.includes("[CEP]") && m.includes("[EMAIL]"));
  assert.ok(m.includes("12 linhas na Vivo"));
  assert.equal(mascarar("11987654321 e 12345678909"), "[TELEFONE] e [CPF]");
  assert.equal(mascarar(""), "");
});

test("mascarar: cobre formatos livres de CPF/CEP/telefone sem vazar dado pessoal", () => {
  assert.ok(!mascarar("13010000").includes("13010000") && mascarar("13010000").includes("[CEP]"));
  assert.ok(mascarar("123 456 789-09").includes("[CPF]") && !mascarar("123 456 789-09").includes("456"));
  assert.ok(mascarar("123.456.789 09").includes("[CPF]") && !mascarar("123.456.789 09").includes("456"));
  assert.ok(mascarar("019 99000-0001").includes("[TELEFONE]") && !mascarar("019 99000-0001").includes("99000"));
  assert.ok(mascarar("123456789-09").includes("[CPF]") && !mascarar("123456789-09").includes("456789"));
  assert.equal(mascarar("(19) 3254-1000"), "[TELEFONE]");
  assert.equal(mascarar("+55 19 99000-0001"), "[TELEFONE]");
  assert.equal(mascarar("06/10/2026"), "06/10/2026");
  assert.equal(mascarar("R$ 1.234,56"), "R$ 1.234,56");
  const merge = mascarar("11987654321 12345678909");
  assert.ok(!merge.includes("11987654321") && !merge.includes("12345678909"));
});

test("validarEntrada: exige chave OU texto livre; limita tamanhos; contexto só com campos permitidos", () => {
  assert.equal(validarEntrada(null).ok, false);
  assert.equal(validarEntrada({ contexto: {} }).ok, false);
  const r = validarEntrada({ objecao_chave: "caro", contexto: { qtd_linhas: "12", nome: "Fulano", cpf: "123", texto: "x".repeat(5000) } });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.dados.contexto.qtd_linhas, 12);
    assert.equal(r.dados.contexto.texto.length, 2000);
    assert.ok(!("nome" in r.dados.contexto) && !("cpf" in r.dados.contexto));
  }
  assert.equal(validarEntrada({ objecao_chave: "CARO!", contexto: {} }).ok, false);
  const livre = validarEntrada({ objecao_livre: "  meu contador cuida disso  ", contexto: {} });
  assert.ok(livre.ok && livre.dados.objecao_livre === "meu contador cuida disso");
});

test("validarEntrada: valor_plano numérico ou string não infla (num não trata '.' como milhar sem vírgula)", () => {
  const a = validarEntrada({ objecao_chave: "caro", contexto: { valor_plano: 99.9 } });
  assert.ok(a.ok && a.dados.contexto.valor_plano === 99.9);
  const b = validarEntrada({ objecao_chave: "caro", contexto: { valor_plano: "99.90" } });
  assert.ok(b.ok && b.dados.contexto.valor_plano === 99.9);
  const c = validarEntrada({ objecao_chave: "caro", contexto: { valor_plano: "1.234,56" } });
  assert.ok(c.ok && c.dados.contexto.valor_plano === 1234.56);
});

test("montarPrompt: traz a base, as franquias, proíbe preço e já vem mascarado", () => {
  const base = { chave: "caro", rotulo: "Tá caro", fala: "Fala base", pergunta: "Pergunta base", alternativa: "Alt base" };
  const r = validarEntrada({ objecao_chave: "caro", contexto: { qtd_linhas: 12, operadora_atual: "Vivo", texto: "tel 19990000001" } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = montarPrompt(r.dados, base, [base]);
  assert.ok(p.includes("Fala base") && p.includes("12GB, 40GB, 70GB, 100GB e 150GB"));
  assert.ok(/nunca cite preço em R\$/i.test(p));
  assert.ok(/no máximo 3 frases no total \(fala \+ pergunta\)/i.test(p));
  assert.ok(p.includes("[TELEFONE]") && !p.includes("19990000001"));
  assert.ok(p.includes('{"fala"'));
});

test("lerRespostaIA: JSON puro, dentro de ```json```, inválido e corta em 3 frases no total (fala + pergunta)", () => {
  assert.deepEqual(lerRespostaIA('{"fala":"A.","pergunta":"B?"}'), { fala: "A.", pergunta: "B?" });
  assert.deepEqual(lerRespostaIA('```json\n{"fala":"A.","pergunta":""}\n```'), { fala: "A.", pergunta: "" });
  assert.equal(lerRespostaIA("não é json"), null);
  assert.equal(lerRespostaIA('{"pergunta":"só"}'), null);
  const longa = lerRespostaIA('{"fala":"Um. Dois. Três. Quatro. Cinco.","pergunta":"P?"}');
  assert.equal(longa?.fala, "Um. Dois.");
  assert.equal(longa?.pergunta, "P?");
  const semPergunta = lerRespostaIA('{"fala":"Um. Dois. Três. Quatro.","pergunta":""}');
  assert.equal(semPergunta?.fala, "Um. Dois. Três.");
  const perguntaLonga = lerRespostaIA('{"fala":"Fala.","pergunta":"Uma? Duas?"}');
  assert.equal(perguntaLonga?.pergunta, "Uma?");
});

function deps(extra: Partial<DepsIA> = {}): DepsIA & { log: unknown[]; prompts: string[] } {
  const log: unknown[] = []; const prompts: string[] = [];
  return Object.assign({
    log, prompts,
    buscarObjecao: async (c: string) => (c === "caro" ? { chave: "caro", rotulo: "Tá caro", fala: "F", pergunta: "P", alternativa: "A" } : null),
    listarObjecoes: async () => [],
    contarChamadas: async () => 0,
    registrarChamada: async (r: unknown) => { log.push(r); },
    chamarGemini: async (p: string) => { prompts.push(p); return '{"fala":"Resposta.","pergunta":"Pergunta?"}'; },
    agora: () => 1_000_000,
  }, extra);
}

test("responder: caminho feliz grava log sem texto e devolve fala/pergunta", async () => {
  const d = deps();
  const r = await responder({ objecao_chave: "caro", contexto: { texto: "cpf 123.456.789-09" } }, "u1", d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { fala: "Resposta.", pergunta: "Pergunta?" });
  assert.equal((d.log[0] as { status: string }).status, "ok");
  assert.ok(!JSON.stringify(d.log).includes("123.456"));
  assert.ok(!d.prompts[0].includes("123.456.789-09"));
});

test("responder: entrada inválida 400, objeção inexistente 404, limite 429, IA quebrada 503", async () => {
  assert.equal((await responder({}, "u1", deps())).status, 400);
  assert.equal((await responder({ objecao_chave: "nao_existe", contexto: {} }, "u1", deps())).status, 404);
  const cheio = deps({ contarChamadas: async () => LIMITE_CHAMADAS });
  const r429 = await responder({ objecao_chave: "caro", contexto: {} }, "u1", cheio);
  assert.equal(r429.status, 429);
  assert.equal(cheio.prompts.length, 0);
  const quebrada = deps({ chamarGemini: async () => { throw new Error("503 high demand"); } });
  const r503 = await responder({ objecao_chave: "caro", contexto: {} }, "u1", quebrada);
  assert.equal(r503.status, 503);
  assert.equal((quebrada.log[0] as { status: string }).status, "erro_ia");
  const lixo = deps({ chamarGemini: async () => "sem json" });
  assert.equal((await responder({ objecao_chave: "caro", contexto: {} }, "u1", lixo)).status, 503);
});
