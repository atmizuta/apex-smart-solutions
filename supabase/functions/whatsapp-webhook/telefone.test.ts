import { test } from "node:test";
import assert from "node:assert/strict";
import { chaveTelefone, soDigitos } from "./telefone.ts";

test("com e sem 55, com e sem nono dígito, com máscara: mesma chave", () => {
  for (const t of ["5511987654321", "551187654321", "11987654321", "1187654321", "+55 (11) 98765-4321"]) {
    assert.equal(chaveTelefone(t), "1187654321", t);
  }
});
test("DDD 55 (RS) não perde o DDD", () => {
  assert.equal(chaveTelefone("55991234567"), "5591234567");
  assert.equal(chaveTelefone("5555991234567"), "5591234567");
});
test("curto, longo ou vazio: null", () => {
  for (const t of ["", null, undefined, "123", "551198765432100"]) assert.equal(chaveTelefone(t), null, String(t));
});
test("soDigitos", () => assert.equal(soDigitos(" +55 (11) 9.8765-4321 "), "5511987654321"));
