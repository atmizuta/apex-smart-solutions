import { test } from "node:test";
import assert from "node:assert/strict";
import { montarEmail } from "./email.ts";
import type { Resumo } from "./regras.ts";

const AGORA = new Date("2026-10-14T11:00:00Z"); // 08:00 SP
const resumo = (a: number[], e: number[]): Resumo => {
  const c = (x: number[]) => ({ alta: x[0], media: x[1], baixa: x[2], total: x[0] + x[1] + x[2] });
  const t = c([a[0] + e[0], a[1] + e[1], a[2] + e[2]]);
  return { porEtapa: { "ANTIFRAUDE (NEOCRM)": c(a), "ENTREGA (NEOCRM)": c(e) }, total: t };
};
const base = { diaRef: "2026-10-14", agora: AGORA, sincronizadoEm: new Date("2026-10-14T10:59:00Z"), teste: false };

test("assunto com total e quantos em alta", () => {
  const m = montarEmail({ ...base, resumo: resumo([1, 1, 0], [0, 0, 1]) });
  assert.equal(m.assunto, "Pedidos parados - Antifraude e Entrega - 14/10/2026 (3 pedidos, 1 em alta)");
});
test("assunto no singular com 1 pedido", () => {
  const m = montarEmail({ ...base, resumo: resumo([0, 0, 1], [0, 0, 0]) });
  assert.equal(m.assunto, "Pedidos parados - Antifraude e Entrega - 14/10/2026 (1 pedido, 0 em alta)");
});
test("modo teste ganha o prefixo [TESTE]", () => {
  const m = montarEmail({ ...base, teste: true, resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(m.assunto, /^\[TESTE\] Pedidos parados/);
});
test("texto e HTML trazem a linha de cada etapa, o total e a hora da sincronização", () => {
  const m = montarEmail({ ...base, resumo: resumo([1, 1, 0], [0, 0, 1]) });
  assert.match(m.texto, /Antifraude: 2 \(Alta 1 · Média 1 · Baixa 0\)/);
  assert.match(m.texto, /Entrega: 1 \(Alta 0 · Média 0 · Baixa 1\)/);
  assert.match(m.texto, /Total: 3/);
  assert.match(m.texto, /sincronizados em 14\/10\/2026 07:59/);
  assert.match(m.texto, /coluna Retorno/);
  assert.match(m.html, /<table/);
  assert.match(m.html, /Antifraude/);
  assert.doesNotMatch(m.texto, /Atenção/);
});
test("sem pedidos: assunto e texto dizem que não há pedidos parados", () => {
  const m = montarEmail({ ...base, resumo: resumo([0, 0, 0], [0, 0, 0]) });
  assert.match(m.assunto, /\(nenhum pedido parado\)$/);
  assert.match(m.texto, /não há pedidos parados/);
  assert.doesNotMatch(m.texto, /coluna Retorno/);
});
test("dados com mais de 3 h: aviso; até 3 h: sem aviso; sem hora: aviso de não confirmado", () => {
  const velho = montarEmail({ ...base, sincronizadoEm: new Date("2026-10-14T06:59:00Z"), resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(velho.texto, /Atenção: a última sincronização com o NeoCRM foi em 14\/10\/2026 03:59/);
  assert.match(velho.html, /Atenção/);
  const ok = montarEmail({ ...base, sincronizadoEm: new Date("2026-10-14T08:00:00Z"), resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.doesNotMatch(ok.texto, /Atenção/);
  const nulo = montarEmail({ ...base, sincronizadoEm: null, resumo: resumo([1, 0, 0], [0, 0, 0]) });
  assert.match(nulo.texto, /não foi possível confirmar a hora da última sincronização/);
});

// A denomailer 1.6.0 codifica assunto com caractere não-ASCII em quoted-printable e quebra a linha a cada 74
// caracteres com "=CRLF" DENTRO do cabeçalho: o leitor entende que o cabeçalho acabou ali e mostra o e-mail
// cru, com o anexo como texto (envio de teste de 13/10/2026). O assunto precisa ser ASCII puro.
test("assunto é sempre ASCII puro (a denomailer quebra o cabeçalho de assunto com acento ou travessão)", () => {
  for (const teste of [false, true]) {
    for (const r of [resumo([1, 1, 0], [27, 9, 19]), resumo([0, 0, 0], [0, 0, 0]), resumo([0, 0, 1], [0, 0, 0])]) {
      const m = montarEmail({ ...base, teste, resumo: r });
      assert.match(m.assunto, /^[ -~]+$/, m.assunto);
      assert.ok(!m.assunto.startsWith("=?"), m.assunto);
    }
  }
});
