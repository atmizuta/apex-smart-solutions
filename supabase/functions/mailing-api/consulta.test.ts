import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtrosPadrao, validarFiltros, montarWhere, sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, validarQuantidade, sanitizarCarga, nomeArquivo,
  MAX_ITENS,
} from "./consulta.ts";

test("filtrosPadrao: ativa, sem óbito, celular, só mailing", () => {
  assert.deepEqual(filtrosPadrao(), { situacao: ["ATIVA"], excluir_obito: true, tipo: "CELULAR", origem: "MAILING" });
});

test("validarFiltros: nulo ou vazio = sem filtro", () => {
  assert.deepEqual(validarFiltros(null), { ok: true, filtros: {} });
  assert.deepEqual(validarFiltros({}), { ok: true, filtros: {} });
});

test("validarFiltros: aceita o padrão e tira repetidos", () => {
  const v = validarFiltros({ situacao: ["ATIVA", "ATIVA"], excluir_obito: true, tipo: "CELULAR", origem: "MAILING", ddd: [11, 11, 19] });
  assert.deepEqual(v, { ok: true, filtros: { situacao: ["ATIVA"], ddd: [11, 19], tipo: "CELULAR", origem: "MAILING", excluir_obito: true } });
});

test("validarFiltros: false nos booleanos é o mesmo que não filtrar", () => {
  assert.deepEqual(validarFiltros({ excluir_obito: false, nunca_extraida: false }), { ok: true, filtros: {} });
});

test("validarFiltros: recusa chave desconhecida", () => {
  const v = validarFiltros({ cidade: ["SAO PAULO"] });
  assert.equal(v.ok, false);
  assert.match((v as { erro: string }).erro, /filtro desconhecido: cidade/);
});

test("validarFiltros: recusa valores fora da lista ou do formato", () => {
  const casos: [Record<string, unknown>, RegExp][] = [
    [{ situacao: ["ABERTA"] }, /situacao/],
    [{ uf: ["XX"] }, /uf/],
    [{ uf: "SP" }, /uf/],
    [{ ddd: [10] }, /ddd/],
    [{ cnae: ["4781400"] }, /cnae/],
    [{ municipio: [0] }, /municipio/],
    [{ operadora: ["OI"] }, /operadora/],
    [{ sinais: ["fechou"] }, /sinais/],
    [{ sinais: ["toString"] }, /sinais/],
    [{ mei: "talvez" }, /mei/],
    [{ tipo: "RADIO" }, /tipo/],
    [{ origem: "OUTRA" }, /origem/],
    [{ procon: "sim" }, /procon/],
    [{ abertura_de: "2026-02-30" }, /abertura_de/],
    [{ sem_extracao_dias: 0 }, /sem_extracao_dias/],
    [{ excluir_obito: "sim" }, /excluir_obito/],
  ];
  for (const [f, msg] of casos) {
    const v = validarFiltros(f);
    assert.equal(v.ok, false, JSON.stringify(f));
    assert.match((v as { erro: string }).erro, msg);
  }
});

test("validarFiltros: no máximo MAX_ITENS por lista", () => {
  const v = validarFiltros({ municipio: Array.from({ length: MAX_ITENS + 1 }, (_, i) => i + 1) });
  assert.equal(v.ok, false);
  assert.match((v as { erro: string }).erro, /municipio: no máximo 500 itens/);
});

test("validarFiltros: datas de abertura invertidas", () => {
  const v = validarFiltros({ abertura_de: "2024-01-01", abertura_ate: "2023-01-01" });
  assert.equal(v.ok, false);
  assert.match((v as { erro: string }).erro, /abertura/);
});

test("montarWhere: sem filtro = true", () => {
  assert.deepEqual(montarWhere({}), { sql: "true", params: [] });
});

test("montarWhere: filtro padrão", () => {
  assert.deepEqual(montarWhere(filtrosPadrao()), {
    sql: "l.rf_situacao = any($1::text[]) and not l.socio_obito and l.celular and l.do_mailing",
    params: [["ATIVA"]],
  });
});

test("montarWhere: operadora SEM vira 'is null'", () => {
  assert.deepEqual(montarWhere({ operadora: ["VIVO", "SEM"] }), {
    sql: "(l.operadora = any($1::text[]) or l.operadora is null)", params: [["VIVO"]],
  });
  assert.deepEqual(montarWhere({ operadora: ["SEM"] }), { sql: "l.operadora is null", params: [] });
});

test("montarWhere: todos os filtros, na ordem, com parâmetros", () => {
  const f = {
    uf: ["SP"], municipio: [7107], ddd: [11, 19], situacao: ["ATIVA"], porte: ["MEI", "MICRO"], mei: "nao" as const,
    cnae: [4781400], abertura_de: "2020-01-01", abertura_ate: "2024-12-31", sinais: ["deixou_mei" as const],
    classe: ["B", "C"], excluir_obito: true, tipo: "FIXO" as const, operadora: ["TIM"], portado: "sim" as const,
    whatsapp: "nao" as const, procon: "sem" as const, origem: "RECEITA" as const, sem_extracao_dias: 30,
  };
  assert.deepEqual(montarWhere(f), {
    sql: "l.rf_uf = any($1::text[]) and l.rf_municipio = any($2::int[]) and l.ddd = any($3::smallint[])"
      + " and l.rf_situacao = any($4::text[]) and l.rf_porte_atual = any($5::text[]) and not coalesce(l.rf_mei, false)"
      + " and l.rf_cnae = any($6::int[]) and l.rf_data_abertura >= $7::date and l.rf_data_abertura <= $8::date"
      + " and l.sinal_deixou_mei and l.classe_economica = any($9::text[]) and not l.socio_obito and not l.celular"
      + " and l.operadora = any($10::text[]) and l.portado and not coalesce(l.whatsapp, false)"
      + " and not coalesce(l.procon, false) and not l.do_mailing"
      + " and (l.ultima_extracao is null or l.ultima_extracao < now() - make_interval(days => $11::int))",
    params: [["SP"], [7107], [11, 19], ["ATIVA"], ["MEI", "MICRO"], [4781400], "2020-01-01", "2024-12-31", ["B", "C"], ["TIM"], 30],
  });
});

test("montarWhere: nunca_extraida vence sem_extracao_dias", () => {
  assert.deepEqual(montarWhere({ nunca_extraida: true, sem_extracao_dias: 30 }), { sql: "l.ultima_extracao is null", params: [] });
});

test("sqlTotais e sqlExtrair usam o where e o próximo parâmetro para o limite", () => {
  const w = { sql: "l.ddd = any($1::smallint[])", params: [[11]] };
  const x = sqlExtrair(w);
  assert.match(x, /where l\.ddd = any\(\$1::smallint\[\]\)/);
  assert.match(x, /order by l\.ultima_extracao asc nulls first, l\.sorteio/);
  assert.match(x, /limit \$2::int/);
  assert.match(x, /for update of l skip locked/);
  assert.match(x, /set ultima_extracao = now\(\), vezes_extraida = l\.vezes_extraida \+ 1/);
});

// 21/10: no servidor Micro, contar a base inteira levou 23–85 s e buscar empresa/sócio para 100 mil linhas passou de 5 min
test("contagens vêm da amostra fixa, escaladas pelo fator da última carga", () => {
  const w = { sql: "l.ddd = any($1::smallint[])", params: [[11]] };
  for (const sql of [sqlTotais(w), sqlPorOperadora(w), sqlTotalFiltro(w)]) {
    assert.match(sql, /from mailing\.amostra l where l\.ddd = any\(\$1::smallint\[\]\)/);
    assert.doesNotMatch(sql, /mailing\.linha/);
    assert.match(sql, /contagens->>'amostra_fator'/);
  }
  assert.match(sqlTotais(w), /count\(\*\) filter \(where l\.primeira_da_empresa\)/);
  assert.match(sqlTotais(w), /count\(\*\) filter \(where l\.primeira_do_fone\)/);
});

test("extração não busca empresa nem sócio e marca o uso também na amostra", () => {
  const x = sqlExtrair({ sql: "true", params: [] });
  assert.doesNotMatch(x, /mailing\.empresa|mailing\.socio/);
  assert.match(x, /coalesce\(m\.socio_nome, ''\) as nome/);
  assert.match(x, /coalesce\(m\.razao_social, ''\) as descricao/);
  assert.match(x, /update mailing\.amostra a set ultima_extracao = now\(\) from alvo where a\.linha_id = alvo\.id/);
});

test("validarQuantidade: inteiro de 1 a 100.000", () => {
  assert.equal(validarQuantidade(1), 1);
  assert.equal(validarQuantidade(100000), 100000);
  assert.equal(validarQuantidade("20000"), 20000);
  for (const v of [0, 100001, 1.5, "abc", "", null, undefined, -3]) assert.equal(validarQuantidade(v), null, String(v));
});

test("sanitizarCarga: maiúsculas, sem acento, só A-Z 0-9 - _", () => {
  assert.equal(sanitizarCarga("icp 2 bcd/micro"), "ICP-2-BCD-MICRO");
  assert.equal(sanitizarCarga("Ação Vivo"), "ACAO-VIVO");
  assert.equal(sanitizarCarga("--TESTE__"), "TESTE");
  assert.equal(sanitizarCarga("   "), null);
  assert.equal(sanitizarCarga(123), null);
  assert.equal(sanitizarCarga("A".repeat(70))?.length, 60);
});

test("nomeArquivo: carga + data", () => {
  assert.equal(nomeArquivo("TESTE-1", "2026-10-21"), "TESTE-1_2026-10-21.csv");
});

// 21/10 (pedido do Rafael): filtros do sócio — sexo, geração e faixa de risco do score (só filtro, não vão no arquivo)
test("filtros do sócio: sexo, geração e faixa de risco", () => {
  const v = validarFiltros({ sexo: ["F"], geracao: ["Y", "Z"], risco: ["BAIXO", "MUITO BAIXO"] });
  assert.deepEqual(v, { ok: true, filtros: { sexo: ["F"], geracao: ["Y", "Z"], risco: ["BAIXO", "MUITO BAIXO"] } });
  const casos: [Record<string, unknown>, RegExp][] = [[{ sexo: ["X"] }, /sexo/], [{ geracao: ["MILLENNIAL"] }, /geracao/], [{ risco: ["MEDIO ALTO"] }, /risco/]];
  for (const [f, msg] of casos) {
    const r = validarFiltros(f);
    assert.equal(r.ok, false, JSON.stringify(f));
    assert.match((r as { erro: string }).erro, msg);
  }
  assert.deepEqual(montarWhere({ sexo: ["F"], geracao: ["Y"], risco: ["ALTO"] }), {
    sql: "l.sexo = any($1::text[]) and l.geracao = any($2::text[]) and l.faixa_risco = any($3::text[])",
    params: [["F"], ["Y"], ["ALTO"]],
  });
});

// 21/10: pedido acima de 100 mil sai em várias partes; cada parte não pode repetir o que saiu nas anteriores
test("extraida_antes_de: só linhas não extraídas desde o início do pedido", () => {
  const iso = "2026-10-21T20:00:00.000Z";
  assert.deepEqual(validarFiltros({ extraida_antes_de: iso }), { ok: true, filtros: { extraida_antes_de: iso } });
  for (const ruim of ["ontem", "2026-10-21", "2026-13-01T00:00:00.000Z", 5]) {
    assert.equal(validarFiltros({ extraida_antes_de: ruim }).ok, false, String(ruim));
  }
  assert.deepEqual(montarWhere({ nunca_extraida: true, extraida_antes_de: iso }), {
    sql: "l.ultima_extracao is null and (l.ultima_extracao is null or l.ultima_extracao < $1::timestamptz)", params: [iso],
  });
});

// 21/10 (pedido do Rafael): DDD da cidade da empresa (não do telefone) e posição do telefone na planilha (1 = mais contato)
test("DDD da cidade e posição do telefone na planilha", () => {
  assert.deepEqual(validarFiltros({ ddd_cidade: [11, 19], posicao: [1] }), { ok: true, filtros: { ddd_cidade: [11, 19], posicao: [1] } });
  for (const ruim of [{ ddd_cidade: [5] }, { posicao: [0] }, { posicao: ["1"] }, { posicao: [11] }]) {
    assert.equal(validarFiltros(ruim).ok, false, JSON.stringify(ruim));
  }
  assert.deepEqual(montarWhere({ ddd_cidade: [11], posicao: [1, 2] }), {
    sql: "l.rf_ddd_cidade = any($1::smallint[]) and l.posicao = any($2::smallint[])", params: [[11], [1, 2]],
  });
});
