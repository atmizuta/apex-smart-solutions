import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcularJanela, dividirEmBlocos, formatoNeo, formatoPainel, inicioDoDia, janelaNoturna, parseFormatoNeo,
} from "./windows.ts";

const utc = (s: string) => new Date(s);

test("formatoNeo/parseFormatoNeo usam a hora de São Paulo", () => {
  assert.equal(formatoNeo(utc("2026-09-29T19:15:07Z")), "2026-09-29 16:15:07");
  assert.equal(parseFormatoNeo("2026-09-29 16:15:07").toISOString(), "2026-09-29T19:15:07.000Z");
  assert.throws(() => parseFormatoNeo("29/09/2026"), /formato/i);
});

test("formatoPainel imita o carimbo já usado em config.producao_atualizado_em", () => {
  assert.equal(formatoPainel(utc("2026-09-29T18:56:38Z")), "29/09/2026, 15:56:38");
});

test("janelaNoturna: 22:02–04:58 (SP), conservador nas bordas", () => {
  assert.equal(janelaNoturna(utc("2026-09-30T00:59:00Z")), false); // 21:59
  assert.equal(janelaNoturna(utc("2026-09-30T01:01:00Z")), false); // 22:01
  assert.equal(janelaNoturna(utc("2026-09-30T01:02:00Z")), true);  // 22:02
  assert.equal(janelaNoturna(utc("2026-09-30T06:00:00Z")), true);  // 03:00
  assert.equal(janelaNoturna(utc("2026-09-30T07:58:00Z")), true);  // 04:58
  assert.equal(janelaNoturna(utc("2026-09-30T07:59:00Z")), false); // 04:59
  assert.equal(janelaNoturna(utc("2026-09-30T09:00:00Z")), false); // 06:00
});

test("horario de dia com cursor recente: começa 15 min antes do cursor", () => {
  const j = calcularJanela({ modo: "horario", agora: utc("2026-09-29T19:07:00Z"), cursor: utc("2026-09-29T19:00:00Z") });
  assert.equal(j.ini.toISOString(), "2026-09-29T18:45:00.000Z");
  assert.equal(j.fim.toISOString(), "2026-09-29T19:07:00.000Z");
  assert.equal(j.observacao, null);
});

test("horario de dia com cursor antigo: reduz a 85 min e avisa (nunca pede janela que a API recusa)", () => {
  const agora = utc("2026-09-29T19:07:00Z");
  const j = calcularJanela({ modo: "horario", agora, cursor: utc("2026-09-29T16:00:00Z") });
  assert.equal(j.ini.getTime(), agora.getTime() - 85 * 60_000);
  assert.match(j.observacao ?? "", /Janela reduzida/);
});

test("horario sem cursor: última hora", () => {
  const agora = utc("2026-09-29T19:07:00Z");
  const j = calcularJanela({ modo: "horario", agora, cursor: null });
  assert.equal(j.ini.getTime(), agora.getTime() - 60 * 60_000);
});

test("horario de noite não tem limite: parte do cursor - 15 min mesmo 5 h depois", () => {
  const agora = utc("2026-09-30T06:00:00Z"); // 03:00 SP
  const cursor = new Date(agora.getTime() - 5 * 3_600_000);
  const j = calcularJanela({ modo: "horario", agora, cursor });
  assert.equal(j.ini.getTime(), cursor.getTime() - 15 * 60_000);
  assert.equal(j.observacao, null);
});

test("backfill de dia é recusado; à noite exige inicio", () => {
  assert.throws(() => calcularJanela({ modo: "backfill", agora: utc("2026-09-29T19:00:00Z"), cursor: null, inicio: utc("2026-05-01T03:00:00Z") }), /noturna|22:02/);
  assert.throws(() => calcularJanela({ modo: "backfill", agora: utc("2026-09-30T01:10:00Z"), cursor: null }), /inicio/);
  const j = calcularJanela({ modo: "backfill", agora: utc("2026-09-30T01:10:00Z"), cursor: null, inicio: utc("2026-05-01T03:00:00Z") });
  assert.equal(j.ini.toISOString(), "2026-05-01T03:00:00.000Z");
});

test("reconciliar à noite começa às 00:00 (SP) de 2 dias antes", () => {
  const j = calcularJanela({ modo: "reconciliar", agora: utc("2026-09-30T02:10:00Z"), cursor: null }); // 23:10 SP de 29/09
  assert.equal(j.ini.toISOString(), "2026-09-27T03:00:00.000Z");
  assert.equal(inicioDoDia(utc("2026-09-30T02:10:00Z"), 2).toISOString(), "2026-09-27T03:00:00.000Z");
});

test("dividirEmBlocos: contíguos, cobre tudo, vazio quando ini >= fim", () => {
  const ini = utc("2026-05-01T03:00:00Z");
  const fim = new Date(ini.getTime() + 7 * 24 * 3_600_000);
  const b = dividirEmBlocos(ini, fim);
  assert.equal(b.length, 3);
  assert.equal(b[0].ini.getTime(), ini.getTime());
  assert.equal(b[0].fim.getTime(), b[1].ini.getTime());
  assert.equal(b[2].fim.getTime(), fim.getTime());
  assert.deepEqual(dividirEmBlocos(fim, ini), []);
  assert.deepEqual(dividirEmBlocos(ini, ini), []);
});
