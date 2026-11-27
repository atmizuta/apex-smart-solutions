import { test } from "node:test";
import assert from "node:assert/strict";
import { adicionarDocumento, alertas, aplicar, cnpjValido, cpfValido, faltando } from "./ficha.ts";
import type { Ficha } from "./ficha.ts";

const CNPJ = "11222333000181", CPF = "52998224725";

test("DV de CPF e CNPJ", () => {
  assert.deepEqual([CPF, "529.982.247-25", "52998224724", "11111111111", "123"].map(cpfValido), [true, true, false, false, false]);
  assert.deepEqual([CNPJ, "11.222.333/0001-81", "11444777000161", "11222333000182", "00000000000000", ""].map(cnpjValido), [true, true, true, false, false, false]);
});

test("aplicar guarda o válido, recusa o inválido e o campo desconhecido", () => {
  const r = aplicar({}, { nome: "  Zz   Teste ", cpf: "529.982.247-25", cnpj: "11222333000182", senha: "x" });
  assert.equal(r.ficha.nome, "Zz Teste");
  assert.equal(r.ficha.cpf, CPF);
  assert.equal(r.ficha.cnpj, undefined);
  assert.equal(r.erros.length, 2);
  assert.match(r.erros.join(" "), /cnpj/);
  assert.match(r.erros.join(" "), /desconhecido: senha/);
  assert.match(aplicar({}, { nome: "Zz" }).erros[0], /sobrenome/);
  assert.deepEqual(aplicar({}, "texto").erros, ["campos deve ser um objeto"]);
});

test("trocar o CNPJ apaga a situação antiga", () => {
  const r = aplicar({ cnpj: CNPJ, cnpj_situacao: "BAIXADA" }, { cnpj: "11444777000161" });
  assert.equal(r.ficha.cnpj_situacao, undefined);
});

test("linhas móveis: total, partes e números", () => {
  const r = aplicar({}, { servicos: ["moveis"], moveis_total: 3, partes: [{ modalidade: "portabilidade", quantidade: 2, numeros: ["(00) 90000-0001", "0090000002"] }, { modalidade: "nova", quantidade: 1 }] });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.ficha.moveis, { total: 3, partes: [{ modalidade: "portabilidade", quantidade: 2, numeros: ["00900000001", "0090000002"] }, { modalidade: "nova", quantidade: 1 }] });
  assert.equal(aplicar({}, { moveis_total: 0 }).erros.length, 1);
  assert.equal(aplicar({}, { moveis_total: 101 }).erros.length, 1);
  assert.equal(aplicar({}, { partes: [{ modalidade: "pre-pago", quantidade: 1 }] }).erros.length, 1);
  assert.equal(aplicar({}, { partes: [{ modalidade: "portabilidade", quantidade: 1, numeros: ["123"] }] }).erros.length, 1);
  assert.equal(aplicar({}, { servicos: ["tv"] }).erros.length, 1);
});

test("faltando: base", () => {
  assert.deepEqual(faltando({}), ["nome completo", "CNPJ", "CPF", "tipo de serviço"]);
});

const base: Ficha = { nome: "Zz Teste", cpf: CPF, cnpj: CNPJ };

test("faltando: portabilidade pede números e fatura; linha nova pede endereço", () => {
  const f = aplicar(base, { servicos: ["moveis"], moveis_total: 3, partes: [{ modalidade: "portabilidade", quantidade: 2, numeros: ["00900000001"] }, { modalidade: "nova", quantidade: 1 }] }).ficha;
  assert.deepEqual(faltando(f), ["números das linhas de portabilidade", "fatura das linhas da portabilidade", "CEP e número do endereço"]);
  const g = adicionarDocumento(aplicar(f, { partes: [{ modalidade: "portabilidade", quantidade: 2, numeros: ["00900000001", "00900000002"] }, { modalidade: "nova", quantidade: 1 }], cep: "00000-000", numero_endereco: "10" }).ficha, { mensagem_id: "w1", tipo: "fatura" });
  assert.deepEqual(faltando(g), []);
});

test("faltando: soma das partes diferente do total", () => {
  const f = aplicar(base, { servicos: ["moveis"], moveis_total: 5, partes: [{ modalidade: "nova", quantidade: 2 }], cep: "00000000", numero_endereco: "1" }).ficha;
  assert.deepEqual(faltando(f), ["modalidade de todas as linhas (informado 2 de 5)"]);
});

test("migração: sem comprovante segue com alerta", () => {
  const f = aplicar(base, { servicos: ["moveis"], moveis_total: 1, partes: [{ modalidade: "migracao", quantidade: 1, numeros: ["00900000001"] }] }).ficha;
  assert.deepEqual(faltando(f), ["fatura ou comprovante de recarga da migração"]);
  const g = aplicar(f, { sem_comprovante: true }).ficha;
  assert.deepEqual(faltando(g), []);
  assert.deepEqual(alertas(g), ["Migração sem fatura nem comprovante de recarga"]);
});

test("fibra: velocidade, endereço e CNH obrigatória", () => {
  const f = aplicar(base, { servicos: ["fibra"], velocidade: "800" }).ficha;
  assert.deepEqual(faltando(f), ["CEP e número do endereço", "CNH (foto ou digital)"]);
  const g = adicionarDocumento(aplicar(f, { cep: "00000000", numero_endereco: "10A" }).ficha, { mensagem_id: "w9", tipo: "cnh" });
  assert.deepEqual(faltando(g), []);
  assert.equal(aplicar(f, { velocidade: "500" }).erros.length, 1);
  assert.equal(aplicar(f, { cep: "1234" }).erros.length, 1);
});

test("outro interesse pede descrição; alertas de CNPJ", () => {
  assert.deepEqual(faltando({ ...base, servicos: ["outro"] }), ["descrição do interesse"]);
  assert.deepEqual(alertas({ ...base, cnpj_situacao: "BAIXADA" }), ["CNPJ BAIXADA na Receita"]);
  assert.deepEqual(alertas({ ...base, cnpj_situacao: "NAO_ENCONTRADO" }), ["CNPJ não encontrado na Receita"]);
  assert.deepEqual(alertas({ ...base, cnpj_situacao: "ATIVA" }), []);
});

test("adicionarDocumento troca o mesmo id e não muda a ficha original", () => {
  const f = adicionarDocumento(base, { mensagem_id: "w1", tipo: "fatura" });
  const g = adicionarDocumento(f, { mensagem_id: "w1", tipo: "cnh" });
  assert.deepEqual(g.documentos, [{ mensagem_id: "w1", tipo: "cnh" }]);
  assert.equal(base.documentos, undefined);
});
