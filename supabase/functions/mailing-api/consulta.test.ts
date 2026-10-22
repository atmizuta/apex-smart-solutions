import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtrosPadrao, validarFiltros, montarWhere, sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, validarQuantidade, sanitizarCarga, nomeArquivo,
  MAX_ITENS, validarTrecho, sqlTrechoNovos, sqlJanelaUsadas, sqlTrechoUsadas, proximoTrecho, TRECHO_PAGINAS_MIN, TRECHO_PAGINAS_MAX,
  TRECHO_USADAS, ultimaPagina, ultimoTomado,
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
// 21/10 (revisão do Rafael): marcar 1 linha por empresa subestimava empresas com filtro de telefone (telefone 1 dava
// 2,5 mi em vez de 4,0 mi). Agora: amostra POR EMPRESA (todas as linhas de 2% das empresas) para linhas e empresas,
// e amostra POR TELEFONE (todas as linhas de 2% dos números) para telefones distintos.
test("contagens vêm da amostra por empresa (linhas, empresas) e por telefone (telefones)", () => {
  const w = { sql: "l.ddd = any($1::smallint[]) or l.posicao = 1", params: [[11]] };
  const t = sqlTotais(w);
  assert.match(t, /from mailing\.amostra l where \(l\.ddd = any\(\$1::smallint\[\]\) or l\.posicao = 1\)/);
  assert.match(t, /count\(\*\) filter \(where l\.na_empresa\)/);
  assert.match(t, /count\(distinct l\.cnpj\) filter \(where l\.na_empresa\)/);
  assert.match(t, /count\(distinct l\.fone\) filter \(where l\.no_fone\)/);
  for (const k of ["fator_linhas", "fator_empresas"]) assert.match(t, new RegExp(`contagens->>'${k}'`));
  for (const sql of [sqlPorOperadora(w), sqlTotalFiltro(w)]) {
    assert.match(sql, /from mailing\.amostra l where l\.na_empresa and \(l\.ddd = any\(\$1::smallint\[\]\) or l\.posicao = 1\)/);
    assert.match(sql, /contagens->>'fator_linhas'/);
  }
  for (const sql of [t, sqlPorOperadora(w), sqlTotalFiltro(w)]) {
    assert.doesNotMatch(sql, /mailing\.linha|primeira_d/);
  }
});

// 22/10 (Rafael): a tela mostrou ≈ 94.693 telefones distintos e ≈ 93.194 linhas — impossível. Linhas vinham da amostra
// de empresas e telefones da amostra de números, com erros independentes de ±2–3%; com ~1% de telefone repetido, a ordem
// se inverteu. Agora telefones = linhas × (telefones ÷ linhas na amostra de números): nunca passa das linhas.
test("telefones distintos = linhas × proporção da amostra de números (nunca acima das linhas)", () => {
  const t = sqlTotais({ sql: "true", params: [] }).replace(/\s+/g, " ");
  const fatorLinhas = "(select coalesce((contagens->>'fator_linhas')::numeric, (contagens->>'amostra_fator')::numeric, 1) from mailing.carga order by carregado_em desc limit 1)";
  assert.ok(t.includes("round(count(*) filter (where l.na_empresa) * " + fatorLinhas
    + " * coalesce(count(distinct l.fone) filter (where l.no_fone)::numeric / nullif(count(*) filter (where l.no_fone), 0), 1))::bigint as telefones"), t);
  assert.doesNotMatch(t, /fator_fones/);
});

test("extração não busca empresa nem sócio e marca o uso também na amostra", () => {
  const x = sqlExtrair({ sql: "true", params: [] });
  assert.doesNotMatch(x, /mailing\.empresa|mailing\.socio/);
  assert.match(x, /coalesce\(m\.socio_nome, ''\) as nome/);
  assert.match(x, /coalesce\(m\.razao_social, ''\) as descricao/);
  // a amostra não depende mais do id da linha: marca o uso pelo par CNPJ + telefone que saiu
  assert.match(x, /update mailing\.amostra a set ultima_extracao = now\(\) from marcadas m where a\.cnpj = m\.cnpj and a\.fone = m\.fone/);
  assert.ok(x.indexOf("marcadas as (") < x.indexOf("na_amostra as ("), "na_amostra vem depois de marcadas");
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

// 22/10 (Guilherme): com filtro fino (CLARO + portado + telefone 1 + classe + risco = 0,8% da base) a extração lia a tabela
// inteira (~3 GB) numa consulta só: 74–107 s quando dava certo e 5 erros de 120 s. Agora cada chamada lê um TRECHO limitado.
// Fase 1: os nunca extraídos, por faixa de páginas da tabela (que está na ordem do sorteio). Fase 2: os já extraídos antes
// do pedido, do mais antigo para o mais novo, por janelas do índice de uso.
test("validarTrecho: fase 1 com página e tamanho; fase 2 com cursor ou do começo", () => {
  assert.deepEqual(validarTrecho({ fase: 1, pagina: 0, paginas: 2048 }), { ok: true, trecho: { fase: 1, pagina: 0, paginas: 2048 } });
  assert.deepEqual(validarTrecho({ fase: 2, apos: null }), { ok: true, trecho: { fase: 2, apos: null } });
  const ue = "2026-10-22 14:29:07.821456+00";
  assert.deepEqual(validarTrecho({ fase: 2, apos: { ue, so: 6358 } }), { ok: true, trecho: { fase: 2, apos: { ue, so: 6358 } } });
  const ruins = [
    "x", [], { fase: 3 }, { fase: 1, pagina: -1, paginas: 2048 }, { fase: 1, pagina: 1.5, paginas: 2048 },
    { fase: 1, pagina: 0, paginas: TRECHO_PAGINAS_MIN - 1 }, { fase: 1, pagina: 0, paginas: TRECHO_PAGINAS_MAX + 1 },
    { fase: 1, pagina: "0", paginas: 2048 }, { fase: 2 }, { fase: 2, apos: { ue: "ontem", so: 1 } },
    { fase: 2, apos: { ue, so: "1" } }, { fase: 2, apos: { ue: ue + "'; drop", so: 1 } },
  ];
  for (const r of ruins) assert.equal(validarTrecho(r).ok, false, JSON.stringify(r));
});

test("sqlTrechoNovos: só a faixa de páginas, só nunca extraídos, na ordem física, com limite e trava", () => {
  const w = { sql: "l.operadora = any($1::text[]) and l.portado", params: [["CLARO"]] };
  const q = sqlTrechoNovos(w, 2048, 4096, 500);
  assert.deepEqual(q.params, [["CLARO"], "(2048,0)", "(4096,0)", 500]);
  assert.match(q.sql, /l\.ctid >= \$2::text::tid and l\.ctid < \$3::text::tid and l\.ultima_extracao is null/);
  assert.match(q.sql, /and \(l\.operadora = any\(\$1::text\[\]\) and l\.portado\)/);
  assert.match(q.sql, /order by l\.ctid\s+limit \$4::int\s+for update of l skip locked/);
  assert.match(q.sql, /\(l\.ctid::text::point\)\[0\]::int as pagina/);
  // marca pelo ctid (a linha está travada): o update não procura a linha pelo id em 264 MB de índice
  assert.match(q.sql, /set ultima_extracao = now\(\), vezes_extraida = l\.vezes_extraida \+ 1\s+from alvo where l\.ctid = alvo\.t/);
  assert.match(q.sql, /update mailing\.amostra a set ultima_extracao = now\(\) from marcadas m where a\.cnpj = m\.cnpj and a\.fone = m\.fone/);
  assert.match(q.sql, /coalesce\(m\.socio_nome, ''\) as nome/);
  // o cursor sai do próprio update: juntar com "alvo" de novo virava laço de 100 mil × 100 mil (estimativa de 1 linha)
  assert.match(q.sql, /returning l\.id, [^)]*,\s*alvo\.pagina\s*\)/);
  assert.match(q.sql, /m\.pagina/);
  assert.doesNotMatch(q.sql, /join alvo/);
  assert.doesNotMatch(q.sql, /mailing\.empresa|mailing\.socio/);
});

test("sqlJanelaUsadas: até TRECHO_USADAS linhas do índice de uso, antes do início do pedido, depois do cursor", () => {
  const sem = sqlJanelaUsadas("2026-10-22T14:00:00.000Z", null);
  assert.deepEqual(sem.params, ["2026-10-22T14:00:00.000Z", TRECHO_USADAS]);
  assert.match(sem.sql, /l\.ultima_extracao is not null and l\.ultima_extracao < \$1::timestamptz/);
  assert.match(sem.sql, /order by l\.ultima_extracao nulls first, l\.sorteio\s+limit \$2::int/);
  assert.doesNotMatch(sem.sql, /> \(/);
  // o cursor volta como texto (microssegundos): com milissegundos do JavaScript a janela não andaria
  assert.match(sem.sql, /ue::text as ue/);
  const com = sqlJanelaUsadas("2026-10-22T14:00:00.000Z", { ue: "2026-10-22 14:29:07.821456+00", so: 77 });
  assert.deepEqual(com.params, ["2026-10-22T14:00:00.000Z", "2026-10-22 14:29:07.821456+00", 77, TRECHO_USADAS]);
  assert.match(com.sql, /\(l\.ultima_extracao, l\.sorteio\) > \(\$2::timestamptz, \$3::int\)/);
  assert.match(com.sql, /limit \$4::int/);
});

test("sqlTrechoUsadas: dentro da janela, com filtro, do mais antigo para o mais novo", () => {
  const w = { sql: "l.portado", params: [] };
  const fim = { ue: "2026-10-22 14:29:07.821456+00", so: 999 };
  const q = sqlTrechoUsadas(w, "2026-10-22T15:00:00.000Z", null, fim, 100);
  assert.deepEqual(q.params, ["2026-10-22T15:00:00.000Z", fim.ue, 999, 100]);
  assert.match(q.sql, /l\.ultima_extracao is not null and l\.ultima_extracao < \$1::timestamptz/);
  assert.match(q.sql, /\(l\.ultima_extracao, l\.sorteio\) <= \(\$2::timestamptz, \$3::int\)/);
  assert.match(q.sql, /and \(l\.portado\)/);
  assert.match(q.sql, /order by l\.ultima_extracao nulls first, l\.sorteio\s+limit \$4::int\s+for update of l skip locked/);
  assert.match(q.sql, /alvo\.ue as cursor_ue, alvo\.so as cursor_so, alvo\.ordem as cursor_ordem\s*\)/);
  assert.match(q.sql, /m\.cursor_ue, m\.cursor_so, m\.cursor_ordem/);
  assert.doesNotMatch(q.sql, /join alvo/);
  const com = sqlTrechoUsadas({ sql: "true", params: [] }, "2026-10-22T15:00:00.000Z", { ue: "2026-10-22 10:00:00+00", so: 5 }, fim, 100);
  assert.deepEqual(com.params, ["2026-10-22T15:00:00.000Z", fim.ue, 999, "2026-10-22 10:00:00+00", 5, 100]);
  assert.match(com.sql, /\(l\.ultima_extracao, l\.sorteio\) > \(\$4::timestamptz, \$5::int\)/);
  assert.match(com.sql, /limit \$6::int/);
});

test("proximoTrecho fase 1: continua da página da última linha, avança a faixa ou passa para os já usados", () => {
  // completou a quantidade: volta à página da última linha (as que saíram já não são "nunca extraídas")
  assert.deepEqual(proximoTrecho({ fase: 1, tomadas: 10, ultima_pagina: 3000, ate: 4096, paginas_total: 380000 }, 10, false),
    { fase: 1, pagina: 3000 });
  assert.deepEqual(proximoTrecho({ fase: 1, tomadas: 3, ultima_pagina: 3000, ate: 4096, paginas_total: 380000 }, 10, false),
    { fase: 1, pagina: 4096 });
  assert.deepEqual(proximoTrecho({ fase: 1, tomadas: 3, ultima_pagina: 3000, ate: 380000, paginas_total: 380000 }, 10, false),
    { fase: 2, apos: null });
  // "nunca extraídas": não há fase 2
  assert.equal(proximoTrecho({ fase: 1, tomadas: 0, ultima_pagina: null, ate: 380000, paginas_total: 380000 }, 10, true), null);
});

test("cursor: maior página da fase 1; na fase 2, a última na ordem de uso (data, depois sorteio)", () => {
  assert.equal(ultimaPagina([]), null);
  assert.equal(ultimaPagina([{ pagina: 7 }, { pagina: 30 }, { pagina: 12 }]), 30);
  assert.equal(ultimoTomado([]), null);
  const linhas = [
    { cursor_ue: "2026-10-22 11:00:00.5+00", cursor_so: 900, cursor_ordem: 1761130800.5 },
    { cursor_ue: "2026-10-22 11:00:00.5+00", cursor_so: 950, cursor_ordem: 1761130800.5 },
    { cursor_ue: "2026-10-22 10:00:00+00", cursor_so: 99999, cursor_ordem: 1761127200 },
  ];
  assert.deepEqual(ultimoTomado(linhas), { ue: "2026-10-22 11:00:00.5+00", so: 950 });
});

test("proximoTrecho fase 2: continua do último que saiu, da ponta da janela ou acaba", () => {
  const ultimo = { ue: "2026-10-22 10:00:00+00", so: 5 }, fimJanela = { ue: "2026-10-22 11:00:00+00", so: 9 };
  assert.deepEqual(proximoTrecho({ fase: 2, tomadas: 10, ultimo, janela: { n: TRECHO_USADAS, fim: fimJanela } }, 10, false),
    { fase: 2, apos: ultimo });
  assert.deepEqual(proximoTrecho({ fase: 2, tomadas: 2, ultimo, janela: { n: TRECHO_USADAS, fim: fimJanela } }, 10, false),
    { fase: 2, apos: fimJanela });
  assert.equal(proximoTrecho({ fase: 2, tomadas: 2, ultimo, janela: { n: 50, fim: fimJanela } }, 10, false), null);
  assert.equal(proximoTrecho({ fase: 2, tomadas: 0, ultimo: null, janela: { n: 0, fim: null } }, 10, false), null);
});
