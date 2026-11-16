import { test } from "node:test";
import assert from "node:assert/strict";
import { processar, validarResultado } from "./ingest.ts";
import type { DepsSocios } from "./ingest.ts";

// DADOS FICTÍCIOS (repo público)
const socio = (o: Record<string, unknown> = {}) => ({
  nome: "ZZ SOCIA UM", cpf: "12345678909", participacao: 50, telefones_consultados: true,
  telefones: [{ tipo: "celular", numero: "11900000001", operadora: "CLARO", whatsapp: true }], ...o,
});
function deps(sobre: Partial<DepsSocios> = {}) {
  const reg = { pegar: [] as number[], concluir: [] as { id: number; patch: Record<string, unknown> }[] };
  const d: DepsSocios = {
    async pegar(max) { reg.pegar.push(max); return [{ id: 7, cnpj: "00000000000191" }]; },
    async concluir(id, patch) { reg.concluir.push({ id, patch }); return true; },
    ...sobre,
  };
  return { d, reg };
}

test("validarResultado: aceita o formato da spec", () => {
  assert.deepEqual(validarResultado({ socios: [socio()] }), { socios: [socio()] });
});
test("validarResultado: recusa CPF, telefone, tipo e participação fora do formato", () => {
  assert.equal(validarResultado({ socios: [socio({ cpf: "123" })] }), null);
  assert.equal(validarResultado({ socios: [socio({ participacao: 150 })] }), null);
  assert.equal(validarResultado({ socios: [socio({ telefones: [{ tipo: "fax", numero: "11900000001", operadora: null, whatsapp: false }] })] }), null);
  assert.equal(validarResultado({ socios: [socio({ telefones: [{ tipo: "fixo", numero: "123", operadora: null, whatsapp: false }] })] }), null);
  assert.equal(validarResultado({ socios: [] }), null);
  assert.equal(validarResultado(null), null);
});
test("validarResultado: participação nula e sócio sem telefone consultado passam", () => {
  const s = socio({ participacao: null, telefones_consultados: false, telefones: [] });
  assert.deepEqual(validarResultado({ socios: [s] }), { socios: [s] });
});
test("pegar: limita max entre 1 e 20 e devolve só id e cnpj", async () => {
  const { d, reg } = deps();
  const r = await processar({ acao: "pegar", max: 99 }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { pedidos: [{ id: 7, cnpj: "00000000000191" }] });
  assert.deepEqual(reg.pegar, [20]);
  await processar({ acao: "pegar" }, d);
  assert.equal(reg.pegar[1], 10);
});
test("resultado pronto: grava status, resultado e erro nulo", async () => {
  const { d, reg } = deps();
  const r = await processar({ acao: "resultado", id: 7, status: "pronto", resultado: { socios: [socio()] } }, d);
  assert.equal(r.status, 200);
  assert.deepEqual(reg.concluir[0], { id: 7, patch: { status: "pronto", resultado: { socios: [socio()] }, erro: null } });
});
test("resultado sem_socios: ignora resultado enviado", async () => {
  const { d, reg } = deps();
  await processar({ acao: "resultado", id: 7, status: "sem_socios", resultado: { socios: [socio()] } }, d);
  assert.deepEqual(reg.concluir[0].patch, { status: "sem_socios", resultado: null, erro: null });
});
test("resultado erro: mensagem curta; vazia vira a genérica", async () => {
  const { d, reg } = deps();
  await processar({ acao: "resultado", id: 7, status: "erro", erro: "x".repeat(500) }, d);
  assert.equal((reg.concluir[0].patch.erro as string).length, 200);
  await processar({ acao: "resultado", id: 7, status: "erro" }, d);
  assert.equal(reg.concluir[1].patch.erro, "A consulta na Nova Vida falhou.");
});
test("resultado: recusa status inválido, id ruim e pronto sem resultado válido", async () => {
  const { d, reg } = deps();
  assert.equal((await processar({ acao: "resultado", id: 7, status: "consultando" }, d)).status, 400);
  assert.equal((await processar({ acao: "resultado", id: "7", status: "erro" }, d)).status, 400);
  assert.equal((await processar({ acao: "resultado", id: 7, status: "pronto", resultado: { socios: [socio({ cpf: "1" })] } }, d)).status, 400);
  assert.equal(reg.concluir.length, 0);
});
test("resultado: pedido que não está consultando → 409", async () => {
  const { d } = deps({ async concluir() { return false; } });
  const r = await processar({ acao: "resultado", id: 7, status: "erro" }, d);
  assert.equal(r.status, 409);
});
test("ação desconhecida → 400; falha das dependências → 500 sem eco do corpo", async () => {
  const { d } = deps({ async pegar() { throw new Error("pegar pedidos (código 42P01)"); } });
  assert.equal((await processar({ acao: "apagar" }, d)).status, 400);
  const r = await processar({ acao: "pegar" }, d);
  assert.equal(r.status, 500);
  assert.match(String(r.corpo.error), /42P01/);
});
