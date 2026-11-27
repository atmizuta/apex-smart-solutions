// supabase/functions/consulta-pedido-neo/consulta.test.ts — §170. DADOS FICTÍCIOS (repo público).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagemRecusa, mensagemUsuario, recortar } from "./consulta.ts";

const PEDIDO = {
  id: 999, numero: "ZZ1", tipoNegociacao: "NOVO", total: "150.5", compromissoMensal: 99.9, tags: "#ZZ",
  observacao: "cliente pediu <B>urgência</B><BR>ligar", dataHoraUltimaMov: "2026-09-30T14:32:10",
  cliente: { cpfCnpj: "00000000000000", nome: "ZZ LTDA", logradouro: "RUA ZZ", cidade: "ZZCIDADE" },
  etapa: { id: 1, nome: "CRÉDITO", slaHoras: 8 },
  usuarioProprietario: { nome: "ZZ CONS", login: "zz", equipe: { nome: "ZZ EQUIPE" } },
  itens: [{
    numero: "11900000000", quantidade: 1, valorUnitario: 49.9, dataPortabilidade: "2026-09-30", dataInstalacao: null,
    cepInstalacao: "00000000", logradouroInstalacao: "RUA SEGREDO", cidadeInstalacao: "ZZCIDADE", estadoInstalacao: "SP",
    operadoraCedente: "ZZOP", nomeCedente: "FULANO SEGREDO", cpfCnpjCedente: "11111111111",
    telefoneCedente: "11988887777", emailCedente: "segredo@zz.test",
    produto: { nome: "ZZ 20GB", categoria: "MÓVEL", descricao: "PLANO ZZ" },
  }],
};

test("recortar: leva etapa, resumo e itens", () => {
  const r = recortar(PEDIDO);
  assert.equal(r.etapa_neo, "CRÉDITO");
  assert.deepEqual(r.resumo, { tipo_negociacao: "NOVO", total: 150.5, compromisso_mensal: 99.9, tags: "#ZZ",
    observacao: "cliente pediu urgência\nligar", dono: "ZZ CONS", equipe: "ZZ EQUIPE", ultima_mov: "2026-09-30T14:32:10" });
  assert.deepEqual(r.itens, [{ linha: "11900000000", quantidade: 1, valor: 49.9, produto: "ZZ 20GB", categoria: "MÓVEL",
    plano: "PLANO ZZ", portabilidade: "2026-09-30", instalacao: null, operadora_cedente: "ZZOP", cidade: "ZZCIDADE", uf: "SP" }]);
});

test("recortar: dado pessoal do cedente e endereço nunca passam", () => {
  const s = JSON.stringify(recortar(PEDIDO));
  for (const segredo of ["FULANO SEGREDO", "11111111111", "11988887777", "segredo@zz.test", "RUA SEGREDO", "RUA ZZ", "00000000000000", "ZZ LTDA"]) {
    assert.ok(!s.includes(segredo), `vazou: ${segredo}`);
  }
});

test("recortar: resposta vazia ou estranha não quebra", () => {
  assert.deepEqual(recortar(null).itens, []);
  assert.equal(recortar({ itens: "x" }).etapa_neo, null);
  assert.equal(recortar({ total: "abc" }).resumo.total, null);
});

test("mensagemUsuario: um texto por erro, 429 usa o Retry-After", () => {
  assert.match(mensagemUsuario(401, null), /token/);
  assert.match(mensagemUsuario(403, null), /token/);
  assert.match(mensagemUsuario(404, null), /não encontrado/);
  assert.match(mensagemUsuario(429, "300"), /5 min/);
  assert.match(mensagemUsuario(429, null), /2 min/);
  assert.match(mensagemUsuario(500, null), /não respondeu/);
  assert.match(mensagemUsuario(0, null), /não respondeu/);
});

test("mensagemRecusa: permissão, sem id e espera arredondada para cima", () => {
  assert.match(mensagemRecusa({ motivo: "permissao" }), /admin e supervisor/);
  assert.match(mensagemRecusa({ motivo: "sem_pedido_id" }), /id do NEO/);
  assert.match(mensagemRecusa({ motivo: "vaga", espera_s: 61 }), /2 min/);
  assert.match(mensagemRecusa({ motivo: "vaga", espera_s: 5 }), /1 min/);
});
