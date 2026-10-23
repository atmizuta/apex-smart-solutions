// Lógica pura da Edge Function mailing-api: valida filtros e monta o SQL parametrizado (REGRAS_NEGOCIO.md seção 102).
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (seções 4, 5 e 6). Sem Deno/rede aqui: testada com node --test.
// Nunca concatenar texto vindo do navegador no SQL: todo valor vai como parâmetro ($n); só nomes de coluna fixos entram no texto.

export const MAX_QTD = 100_000;
export const MAX_ITENS = 500;
export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
  "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
export const SITUACOES = ["ATIVA", "BAIXADA", "INAPTA", "SUSPENSA", "NULA"];
export const PORTES = ["MEI", "MICRO", "PEQUENA", "DEMAIS", "NAO INFORMADO"];
export const OPERADORAS = ["VIVO", "CLARO", "TIM", "OUTRAS", "SEM"];
export const CLASSES = ["A", "B", "C", "D", "E", "X"];
// filtros do sócio (21/10, pedido do Rafael): só filtram, não vão no arquivo
export const SEXOS = ["M", "F", "I"];
export const GERACOES = ["Z", "Y", "X", "BOOMER", "VETERANO"];
export const RISCOS = ["MUITO BAIXO", "BAIXO", "MEDIO", "ALTO", "MUITO ALTO"];
const SINAIS: Record<string, string> = {
  deixou_mei: "l.sinal_deixou_mei", virou_mei: "l.sinal_virou_mei", porte_mudou: "l.sinal_porte_mudou",
};

export type SimNao = "sim" | "nao";
export type Filtros = {
  uf?: string[]; municipio?: number[]; ddd?: number[]; situacao?: string[]; porte?: string[]; mei?: SimNao;
  cnae?: number[]; abertura_de?: string; abertura_ate?: string; sinais?: ("deixou_mei" | "virou_mei" | "porte_mudou")[];
  classe?: string[]; excluir_obito?: boolean; tipo?: "CELULAR" | "FIXO"; operadora?: string[]; portado?: SimNao;
  whatsapp?: SimNao; procon?: "com" | "sem"; origem?: "MAILING" | "RECEITA"; nunca_extraida?: boolean;
  sem_extracao_dias?: number; sexo?: string[]; geracao?: string[]; risco?: string[]; extraida_antes_de?: string;
  ddd_cidade?: number[]; posicao?: number[];
};
export type SqlParte = { sql: string; params: unknown[] };
export type Validacao = { ok: true; filtros: Filtros } | { ok: false; erro: string };

const CHAVES = new Set(["uf", "municipio", "ddd", "situacao", "porte", "mei", "cnae", "abertura_de", "abertura_ate", "sinais",
  "classe", "excluir_obito", "tipo", "operadora", "portado", "whatsapp", "procon", "origem", "nunca_extraida", "sem_extracao_dias",
  "sexo", "geracao", "risco", "extraida_antes_de", "ddd_cidade", "posicao"]);

export function filtrosPadrao(): Filtros {
  return { situacao: ["ATIVA"], excluir_obito: true, tipo: "CELULAR", origem: "MAILING" };
}

const ehInt = (min: number, max: number) => (x: unknown) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const naLista = (lista: string[]) => (x: unknown) => typeof x === "string" && lista.includes(x);
function ehData(x: unknown): boolean {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const d = new Date(x + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
}

const LISTAS: [keyof Filtros, (x: unknown) => boolean][] = [
  ["uf", naLista(UFS)], ["municipio", ehInt(1, 99999)], ["ddd", ehInt(11, 99)], ["situacao", naLista(SITUACOES)],
  ["porte", naLista(PORTES)], ["cnae", ehInt(100000, 9999999)], ["classe", naLista(CLASSES)],
  ["operadora", naLista(OPERADORAS)], ["sinais", (x) => typeof x === "string" && Object.hasOwn(SINAIS, x)],
  ["sexo", naLista(SEXOS)], ["geracao", naLista(GERACOES)], ["risco", naLista(RISCOS)],
  // 21/10: DDD da cidade da empresa (Receita) e posição do telefone na planilha comprada (1 = o de mais contato)
  ["ddd_cidade", ehInt(11, 99)], ["posicao", ehInt(1, 10)],
];
const OPCOES: [keyof Filtros, unknown[]][] = [
  ["mei", ["sim", "nao"]], ["tipo", ["CELULAR", "FIXO"]], ["portado", ["sim", "nao"]], ["whatsapp", ["sim", "nao"]],
  ["procon", ["com", "sem"]], ["origem", ["MAILING", "RECEITA"]],
];

export function validarFiltros(raw: unknown): Validacao {
  if (raw === undefined || raw === null) return { ok: true, filtros: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, erro: "filtros inválidos" };
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!CHAVES.has(k)) return { ok: false, erro: `filtro desconhecido: ${k}` };
  const f: Record<string, unknown> = {};
  for (const [k, valido] of LISTAS) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v)) return { ok: false, erro: `${k}: esperado uma lista` };
    if (v.length > MAX_ITENS) return { ok: false, erro: `${k}: no máximo ${MAX_ITENS} itens` };
    if (!v.every(valido)) return { ok: false, erro: `${k}: valor inválido` };
    if (v.length) f[k] = [...new Set(v)];
  }
  for (const [k, aceitos] of OPCOES) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    if (!aceitos.includes(v)) return { ok: false, erro: `${k}: valor inválido` };
    f[k] = v;
  }
  for (const k of ["abertura_de", "abertura_ate"]) {
    const v = r[k];
    if (v === undefined || v === null || v === "") continue;
    if (!ehData(v)) return { ok: false, erro: `${k}: data inválida` };
    f[k] = v;
  }
  if (f.abertura_de && f.abertura_ate && (f.abertura_de as string) > (f.abertura_ate as string)) {
    return { ok: false, erro: "abertura: a data inicial é depois da final" };
  }
  for (const k of ["excluir_obito", "nunca_extraida"]) {
    const v = r[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "boolean") return { ok: false, erro: `${k}: use verdadeiro ou falso` };
    if (v) f[k] = true;
  }
  const dias = r.sem_extracao_dias;
  if (dias !== undefined && dias !== null) {
    if (!ehInt(1, 3650)(dias)) return { ok: false, erro: "sem_extracao_dias: de 1 a 3650" };
    f.sem_extracao_dias = dias;
  }
  // pedido em várias partes: data/hora (ISO, do navegador) do início do pedido
  const antes = r.extraida_antes_de;
  if (antes !== undefined && antes !== null) {
    const d = typeof antes === "string" ? new Date(antes) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString() !== antes) return { ok: false, erro: "extraida_antes_de: data/hora inválida" };
    f.extraida_antes_de = antes;
  }
  return { ok: true, filtros: f as Filtros };
}

export function montarWhere(f: Filtros): SqlParte {
  const conds: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.uf?.length) conds.push(`l.rf_uf = any(${p(f.uf)}::text[])`);
  if (f.municipio?.length) conds.push(`l.rf_municipio = any(${p(f.municipio)}::int[])`);
  if (f.ddd?.length) conds.push(`l.ddd = any(${p(f.ddd)}::smallint[])`);
  if (f.ddd_cidade?.length) conds.push(`l.rf_ddd_cidade = any(${p(f.ddd_cidade)}::smallint[])`);
  if (f.situacao?.length) conds.push(`l.rf_situacao = any(${p(f.situacao)}::text[])`);
  if (f.porte?.length) conds.push(`l.rf_porte_atual = any(${p(f.porte)}::text[])`);
  if (f.mei) conds.push(f.mei === "sim" ? "l.rf_mei" : "not coalesce(l.rf_mei, false)");
  if (f.cnae?.length) conds.push(`l.rf_cnae = any(${p(f.cnae)}::int[])`);
  if (f.abertura_de) conds.push(`l.rf_data_abertura >= ${p(f.abertura_de)}::date`);
  if (f.abertura_ate) conds.push(`l.rf_data_abertura <= ${p(f.abertura_ate)}::date`);
  for (const s of f.sinais ?? []) conds.push(SINAIS[s]);
  if (f.classe?.length) conds.push(`l.classe_economica = any(${p(f.classe)}::text[])`);
  if (f.sexo?.length) conds.push(`l.sexo = any(${p(f.sexo)}::text[])`);
  if (f.geracao?.length) conds.push(`l.geracao = any(${p(f.geracao)}::text[])`);
  if (f.risco?.length) conds.push(`l.faixa_risco = any(${p(f.risco)}::text[])`);
  if (f.posicao?.length) conds.push(`l.posicao = any(${p(f.posicao)}::smallint[])`);
  if (f.excluir_obito) conds.push("not l.socio_obito");
  if (f.tipo) conds.push(f.tipo === "CELULAR" ? "l.celular" : "not l.celular");
  if (f.operadora?.length) {
    const reais = f.operadora.filter((o) => o !== "SEM");
    const partes: string[] = [];
    if (reais.length) partes.push(`l.operadora = any(${p(reais)}::text[])`);
    if (f.operadora.includes("SEM")) partes.push("l.operadora is null");
    conds.push(partes.length > 1 ? `(${partes.join(" or ")})` : partes[0]);
  }
  if (f.portado) conds.push(f.portado === "sim" ? "l.portado" : "l.portado = false");
  if (f.whatsapp) conds.push(f.whatsapp === "sim" ? "l.whatsapp" : "not coalesce(l.whatsapp, false)");
  if (f.procon) conds.push(f.procon === "com" ? "l.procon" : "not coalesce(l.procon, false)");
  if (f.origem) conds.push(f.origem === "MAILING" ? "l.do_mailing" : "not l.do_mailing");
  if (f.nunca_extraida) conds.push("l.ultima_extracao is null");
  else if (f.sem_extracao_dias) {
    conds.push(`(l.ultima_extracao is null or l.ultima_extracao < now() - make_interval(days => ${p(f.sem_extracao_dias)}::int))`);
  }
  // pedido em várias partes: não repete o que saiu nas partes anteriores do mesmo pedido
  if (f.extraida_antes_de) conds.push(`(l.ultima_extracao is null or l.ultima_extracao < ${p(f.extraida_antes_de)}::timestamptz)`);
  return { sql: conds.length ? conds.join(" and ") : "true", params };
}

// 23/10 (seção 110): a tela agora pede a contagem completa (fila + job, no fim deste arquivo). Esta, pela amostra, fica só
// para a aba aberta antes da publicação (chamada "contar" sem "completa") e para o total do registro da extração.
// Contagem pela amostra (mailing.amostra), que cabe na memória do servidor Micro: contar a base inteira levava de 23 a
// 85 s (21/10). A amostra junta duas: todas as linhas de ~2% das EMPRESAS (na_empresa) e todas as linhas de ~2% dos
// NÚMEROS (no_fone). Linhas e empresas vêm da primeira, telefones distintos da segunda — certo com qualquer filtro,
// inclusive de telefone (antes, 1 linha marcada por empresa fazia "telefone 1" mostrar 2,5 mi empresas em vez de 4,0 mi).
// Os fatores (total / amostrado) vêm da última carga. A extração não usa amostra: é exata.
// 22/10: telefones = linhas × (telefones ÷ linhas na amostra de números). Antes era a amostra de números sozinha × fator:
// com erros independentes de ±2–3% nas duas amostras, saiu ≈ 94.693 telefones para ≈ 93.194 linhas (impossível; o arquivo
// tinha 92.313 números). A proporção vem de uma amostra só, então telefones nunca passam das linhas.
const FATOR = (k: string) =>
  `(select coalesce((contagens->>'${k}')::numeric, (contagens->>'amostra_fator')::numeric, 1) from mailing.carga order by carregado_em desc limit 1)`;
export function sqlTotais(w: SqlParte): string {
  return `select round(count(*) filter (where l.na_empresa) * ${FATOR("fator_linhas")})::bigint as linhas,
  round(count(distinct l.cnpj) filter (where l.na_empresa) * ${FATOR("fator_empresas")})::bigint as empresas,
  round(count(*) filter (where l.na_empresa) * ${FATOR("fator_linhas")}
    * coalesce(count(distinct l.fone) filter (where l.no_fone)::numeric / nullif(count(*) filter (where l.no_fone), 0), 1))::bigint as telefones
  from mailing.amostra l where (${w.sql})`;
}
export function sqlPorOperadora(w: SqlParte): string {
  return `select coalesce(l.operadora, 'SEM') as operadora, round(count(*) * ${FATOR("fator_linhas")})::bigint as linhas
  from mailing.amostra l where l.na_empresa and (${w.sql}) group by 1 order by 2 desc`;
}
export function sqlTotalFiltro(w: SqlParte): string {
  return `select round(count(*) * ${FATOR("fator_linhas")})::bigint as n from mailing.amostra l where l.na_empresa and (${w.sql})`;
}
// Menos usados primeiro (nunca extraídos, depois os mais antigos; sorteio fixo entre iguais). "skip locked" faz duas
// extrações simultâneas pegarem linhas diferentes. Marca o uso (também na amostra, pelo par CNPJ + telefone, para o
// filtro de uso contar certo) e devolve só as 8 colunas que o ProContact usa. Nome do sócio e razão social já estão na
// linha: buscar empresa e sócio para 100 mil linhas passava de 5 min no servidor Micro (21/10).
export function sqlExtrair(w: SqlParte): string {
  const q = `$${w.params.length + 1}`;
  return `with alvo as (
  select l.id from mailing.linha l where ${w.sql}
  order by l.ultima_extracao asc nulls first, l.sorteio
  limit ${q}::int
  for update of l skip locked
), marcadas as (
  update mailing.linha l set ultima_extracao = now(), vezes_extraida = l.vezes_extraida + 1
    from alvo where l.id = alvo.id
  returning l.cnpj, l.cpf, l.fone, l.socio_nome, l.razao_social, l.operadora_nome_id, l.rf_porte_atual, l.rf_municipio
), na_amostra as (
  update mailing.amostra a set ultima_extracao = now() from marcadas m where a.cnpj = m.cnpj and a.fone = m.fone
)
select coalesce(m.socio_nome, '') as nome, coalesce(m.razao_social, '') as descricao, coalesce(m.cpf, '') as documento1,
       m.cnpj as documento2, m.fone as fone1, coalesce(o.nome, '') as campo1, coalesce(m.rf_porte_atual, '') as campo2,
       coalesce(mu.nome, '') as campo3
  from marcadas m
  left join mailing.operadora_nome o on o.id = m.operadora_nome_id
  left join mailing.municipio mu on mu.codigo = m.rf_municipio
 order by m.cnpj, m.fone`;
}

// Extração em trechos (22/10, seção 102.10). Com filtro fino (0,8% da base), a consulta única acima lia a tabela inteira
// (~3 GB): 74–107 s quando dava certo, e 5 erros de 120 s no dia. No servidor Micro o disco cai para ~13 MB/s quando a cota
// diária acaba (medido 22/10: 256 MB em 19 s). Agora cada chamada lê um trecho limitado e o painel repete até completar.
// Fase 1: os nunca extraídos, por faixa de páginas da tabela. A carga grava a tabela na ordem do sorteio e uma linha só muda
// de lugar quando é extraída, então a ordem física dos nunca extraídos é a ordem do sorteio (correlação 1,0 em 22/10).
// Fase 2: os extraídos antes do início do pedido, do mais antigo para o mais novo, por janelas do índice de uso.
// Mesmo resultado da consulta única: menos usados primeiro, sorteio fixo entre iguais.
export const TRECHO_PAGINAS_MIN = 1024;
export const TRECHO_PAGINAS_MAX = 32768; // ~256 MB: ~19 s com o disco no mínimo
export const TRECHO_USADAS = 250_000; // linhas do índice de uso por chamada na fase 2
const MAX_PAGINA = 100_000_000;

export type Cursor = { ue: string; so: number };
export type Trecho = { fase: 1; pagina: number; paginas: number } | { fase: 2; apos: Cursor | null };
export type ProximoTrecho = { fase: 1; pagina: number } | { fase: 2; apos: Cursor | null };
export type ResultadoTrecho =
  | { fase: 1; tomadas: number; ultima_pagina: number | null; ate: number; paginas_total: number }
  | { fase: 2; tomadas: number; ultimo: Cursor | null; janela: { n: number; fim: Cursor | null } };

// timestamptz como o Postgres escreve em texto (com microssegundos): o cursor volta exatamente como saiu do banco
const RE_TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;
function ehCursor(x: unknown): x is Cursor {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  return typeof c.ue === "string" && RE_TS.test(c.ue) && Number.isInteger(c.so);
}

export function validarTrecho(raw: unknown): { ok: true; trecho: Trecho } | { ok: false; erro: string } {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (r?.fase === 1 && ehInt(0, MAX_PAGINA)(r.pagina) && ehInt(TRECHO_PAGINAS_MIN, TRECHO_PAGINAS_MAX)(r.paginas)) {
    return { ok: true, trecho: { fase: 1, pagina: r.pagina as number, paginas: r.paginas as number } };
  }
  if (r?.fase === 2 && (r.apos === null || ehCursor(r.apos))) {
    const a = r.apos as Cursor | null;
    return { ok: true, trecho: { fase: 2, apos: a ? { ue: a.ue, so: a.so } : null } };
  }
  return { ok: false, erro: "trecho inválido" };
}

// Marca o uso pelo ctid: a linha está travada pelo "for update" e não muda de lugar até o fim da transação.
// O cursor sai do próprio update (colunas de "alvo" no returning): juntar "alvo" de novo no fim virava laço de
// 100 mil × 100 mil quando o banco estimava 1 linha (EXPLAIN de 22/10).
function marcarEExportar(alvo: string, cursorAlvo: string[]): string {
  return `with alvo as (
  ${alvo}
), marcadas as (
  update mailing.linha l set ultima_extracao = now(), vezes_extraida = l.vezes_extraida + 1
    from alvo where l.ctid = alvo.t
  returning l.id, l.cnpj, l.cpf, l.fone, l.socio_nome, l.razao_social, l.operadora_nome_id, l.rf_porte_atual, l.rf_municipio,
    ${cursorAlvo.map((c) => `alvo.${c}`).join(", ")}
), na_amostra as (
  update mailing.amostra a set ultima_extracao = now() from marcadas m where a.cnpj = m.cnpj and a.fone = m.fone
)
select coalesce(m.socio_nome, '') as nome, coalesce(m.razao_social, '') as descricao, coalesce(m.cpf, '') as documento1,
       m.cnpj as documento2, m.fone as fone1, coalesce(o.nome, '') as campo1, coalesce(m.rf_porte_atual, '') as campo2,
       coalesce(mu.nome, '') as campo3, ${cursorAlvo.map((c) => `m.${c.split(" as ").pop()}`).join(", ")}
  from marcadas m
  left join mailing.operadora_nome o on o.id = m.operadora_nome_id
  left join mailing.municipio mu on mu.codigo = m.rf_municipio
 order by m.cnpj, m.fone`;
}

export function sqlTrechoNovos(w: SqlParte, de: number, ate: number, quantidade: number): SqlParte {
  const n = w.params.length;
  return {
    sql: marcarEExportar(`select l.id, l.ctid as t, (l.ctid::text::point)[0]::int as pagina from mailing.linha l
  where l.ctid >= $${n + 1}::text::tid and l.ctid < $${n + 2}::text::tid and l.ultima_extracao is null and (${w.sql})
  order by l.ctid
  limit $${n + 3}::int
  for update of l skip locked`, ["pagina"]),
    params: [...w.params, `(${de},0)`, `(${ate},0)`, quantidade],
  };
}

// Limites da janela da fase 2: quantas linhas tem e qual é a última (só o índice de uso, sem filtro).
export function sqlJanelaUsadas(inicio: string, apos: Cursor | null): SqlParte {
  const params: unknown[] = [inicio];
  let depois = "";
  if (apos) { params.push(apos.ue, apos.so); depois = " and (l.ultima_extracao, l.sorteio) > ($2::timestamptz, $3::int)"; }
  params.push(TRECHO_USADAS);
  return {
    sql: `with j as (
  select l.ultima_extracao as ue, l.sorteio as so from mailing.linha l
  where l.ultima_extracao is not null and l.ultima_extracao < $1::timestamptz${depois}
  order by l.ultima_extracao nulls first, l.sorteio
  limit $${params.length}::int
)
select ue::text as ue, so, (count(*) over ())::int as n from j order by j.ue desc, j.so desc limit 1`,
    params,
  };
}

export function sqlTrechoUsadas(w: SqlParte, inicio: string, apos: Cursor | null, fim: Cursor, quantidade: number): SqlParte {
  const n = w.params.length;
  const params: unknown[] = [...w.params, inicio, fim.ue, fim.so];
  let depois = "";
  if (apos) { params.push(apos.ue, apos.so); depois = `\n    and (l.ultima_extracao, l.sorteio) > ($${n + 4}::timestamptz, $${n + 5}::int)`; }
  params.push(quantidade);
  return {
    sql: marcarEExportar(`select l.id, l.ctid as t, l.ultima_extracao::text as ue, l.sorteio as so,
         extract(epoch from l.ultima_extracao)::float8 as ordem from mailing.linha l
  where l.ultima_extracao is not null and l.ultima_extracao < $${n + 1}::timestamptz
    and (l.ultima_extracao, l.sorteio) <= ($${n + 2}::timestamptz, $${n + 3}::int)${depois}
    and (${w.sql})
  order by l.ultima_extracao nulls first, l.sorteio
  limit $${params.length}::int
  for update of l skip locked`, ["ue as cursor_ue", "so as cursor_so", "ordem as cursor_ordem"]),
    params,
  };
}

// De onde a próxima chamada continua; null = o filtro acabou. Completou a quantidade: continua de onde parou (o que saiu
// não volta: na fase 1 deixou de ser "nunca extraído", na fase 2 ficou com data depois do início do pedido).
export function proximoTrecho(r: ResultadoTrecho, quantidade: number, nuncaExtraida: boolean): ProximoTrecho | null {
  if (r.fase === 1) {
    if (r.tomadas >= quantidade && r.ultima_pagina !== null) return { fase: 1, pagina: r.ultima_pagina };
    if (r.ate < r.paginas_total) return { fase: 1, pagina: r.ate };
    return nuncaExtraida ? null : { fase: 2, apos: null };
  }
  if (r.tomadas >= quantidade && r.ultimo) return { fase: 2, apos: r.ultimo };
  if (r.janela.n >= TRECHO_USADAS && r.janela.fim) return { fase: 2, apos: r.janela.fim };
  return null;
}

// A saída vem na ordem do arquivo (CNPJ, telefone); o cursor é a linha que saiu por último na ordem de prioridade.
type ComCursor = { pagina?: unknown; cursor_ue?: unknown; cursor_so?: unknown; cursor_ordem?: unknown };
export function ultimaPagina(linhas: ComCursor[]): number | null {
  let m: number | null = null;
  for (const l of linhas) { const p = Number(l.pagina); if (m === null || p > m) m = p; }
  return m;
}
export function ultimoTomado(linhas: ComCursor[]): Cursor | null {
  let m: ComCursor | null = null;
  for (const l of linhas) {
    if (!m || Number(l.cursor_ordem) > Number(m.cursor_ordem)
      || (Number(l.cursor_ordem) === Number(m.cursor_ordem) && Number(l.cursor_so) > Number(m.cursor_so))) m = l;
  }
  return m ? { ue: String(m.cursor_ue), so: Number(m.cursor_so) } : null;
}

export const SQL_PAGINAS = `select (pg_relation_size('mailing.linha') / current_setting('block_size')::int)::int as n`;
// Um registro por arquivo do pedido (pedido + parte), somado a cada trecho — não um por chamada.
export const SQL_PARTE = `select id from mailing.extracao where pedido = $1::uuid and parte = $2 and user_id = $3::uuid`;
export const SQL_SOMAR_PARTE = `update mailing.extracao set quantidade_entregue = quantidade_entregue + $2 where id = $1`;
export const SQL_REGISTRAR_PARTE = `insert into mailing.extracao
  (user_id, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida, quantidade_entregue, pedido, parte)
  values ($1::uuid, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9, $10::uuid, $11)`;
// 22/10 (seção 102.12): empresas com pedido da Apex no NeoSales, em qualquer etapa — uma linha por CNPJ, com o último
// pedido. Só CNPJ de 14 dígitos: os pedidos não têm telefone, e os poucos feitos com CPF ficam de fora.
// 23/10 (seção 108): soma os pedidos da Eagle (mailing.neo_eagle, últimos 150 dias), só aqui — nunca no Dashboard.
// "origem" = Apex, Eagle ou "Apex + Eagle"; "origem_pedido" = de quem é o último pedido. A data da Eagle é só dia:
// vira meio-dia de SP para não cair no dia anterior no navegador.
export const SQL_NEO = `with p as (
  select regexp_replace(cnpj, '[^0-9]', '', 'g') as cnpj, numero_pedido, etapa, usuario, cadastro, 'Apex' as origem
    from public.producao_pedidos_neo
  union all
  select cnpj, numero_pedido, etapa, consultor, (cadastro + time '12:00') at time zone 'America/Sao_Paulo', 'Eagle'
    from mailing.neo_eagle
)
select cnpj, count(distinct origem || ':' || numero_pedido)::int as pedidos,
  (array_agg(numero_pedido order by cadastro desc nulls last))[1] as numero_pedido,
  (array_agg(etapa order by cadastro desc nulls last))[1] as etapa,
  (array_agg(usuario order by cadastro desc nulls last))[1] as consultor,
  max(cadastro) as cadastro,
  string_agg(distinct origem, ' + ' order by origem) as origem,
  (array_agg(origem order by cadastro desc nulls last))[1] as origem_pedido
  from p where length(cnpj) = 14 group by cnpj`;
// Ao fechar cada arquivo, o painel grava quantas linhas daquela parte removeu (só no registro do próprio usuário).
export const SQL_FECHAR_PARTE = `update mailing.extracao set removidos_neo = $4, removidos_repetidos = $5
  where pedido = $1::uuid and parte = $2 and user_id = $3::uuid returning id`;

export const SQL_REGISTRAR = `insert into mailing.extracao
  (user_id, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida, quantidade_entregue)
  values ($1::uuid, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9)`; // $6 já vem como texto JSON (sem dupla codificação)
export const SQL_OPCOES = `select tipo, valor, rotulo, uf from mailing.opcao order by tipo, ordem, rotulo`;
export const SQL_CARGA = `select carregado_em, receita_mes, neo_ate, tabela_prefixos from mailing.carga order by carregado_em desc limit 1`;
export const SQL_HISTORICO = `select criado_em, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida,
  quantidade_entregue, removidos_neo, removidos_repetidos from mailing.extracao order by criado_em desc limit 100`;
export const SQL_USUARIO = `select role, operacao, username from public.profiles where id = $1::uuid`;

// ===== 23/10 (seção 110, pedido do Rafael): contagem COMPLETA da base, não estimativa =====
// Contar a base inteira levou 126 s em 23/10 (3 GB lidos do disco) e passa dos 120 s da conexão. A mailing-api só põe o
// pedido na fila (mailing.contagem); o job mailing.contar_proxima() (pg_cron, a cada 10 s) conta um pedido por vez, sem
// limite de 120 s, e o painel acompanha até sair o número exato. Migration 20261023200000_mailing_contagem_exata.sql.
// O where vai para a fila com os valores num jsonb só ($1 no job): o $n de montarWhere vira o item n-1 dele. Lista vira
// text[] e o cast que montarWhere já põe (::int[], ::smallint[], ::date...) converte. Só texto fixo entra no SQL.
export function whereParaFila(w: SqlParte): { where_sql: string; params: unknown[] } {
  const where_sql = w.sql.replace(/\$(\d+)/g, (_m, n: string) => {
    const i = Number(n) - 1;
    return Array.isArray(w.params[i]) ? `array(select jsonb_array_elements_text($1->${i}))` : `($1->>${i})`;
  });
  return { where_sql, params: w.params };
}
// Filtro canônico (chaves e listas em ordem): o mesmo filtro marcado em outra ordem reaproveita a mesma contagem.
export function chaveContagem(f: Filtros): string {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(f).sort()) {
    const v = (f as Record<string, unknown>)[k];
    o[k] = Array.isArray(v) ? [...v].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : v;
  }
  return JSON.stringify(o);
}
// "Contando" = o job segura pg_advisory_xact_lock(110, id) enquanto conta (a linha só muda no fim, numa transação só).
export const CONTAGEM_TRAVA = 110;
const CONTANDO = (id: string) => `select a.pid from pg_locks a where a.locktype = 'advisory' and a.classid = ${CONTAGEM_TRAVA}::oid
    and a.objid = (${id})::oid and a.objsubid = 2 and a.granted`;
// Reaproveita: o mesmo filtro na fila com alguém olhando, ou pronto sem nada extraído nem carregado depois. A folga de
// 3 min cobre a extração que começou antes da contagem e terminou depois (o que ela marcou pode não ter entrado na conta).
// "Não extraídos há N dias" muda com o relógio: não reaproveita ($2 = false).
export const SQL_CONTAGEM_EXISTENTE = `select c.id from mailing.contagem c
 where c.chave = md5($1) and (
   (c.estado = 'fila' and c.visto_em > now() - interval '1 minute')
   or (c.estado = 'pronta' and $2::boolean
       and c.iniciado_em > coalesce((select max(l.ultima_extracao) from mailing.linha l), '-infinity'::timestamptz) + interval '3 minutes'
       and c.iniciado_em > coalesce((select max(g.carregado_em) from mailing.carga g), '-infinity'::timestamptz)))
 order by (c.estado = 'pronta') desc, c.id desc limit 1`;
export const SQL_CONTAGEM_NOVA = `insert into mailing.contagem (chave, filtros, where_sql, params, user_id, username)
  values (md5($1), $1::text::jsonb, $2, $3::text::jsonb, $4::uuid, $5) returning id`;
// O painel pergunta a cada poucos segundos: isso mantém o pedido vivo na fila (aba fechada = sai da fila em 1 min).
// "skip locked": a linha que o job está contando fica travada até o fim, e o painel não pode esperar por ela.
export const SQL_CONTAGEM_VISTA = `update mailing.contagem set visto_em = now()
 where id = (select id from mailing.contagem where id = $1::bigint and estado = 'fila' for update skip locked)`;
export const SQL_CONTAGEM_VER = `select c.estado, c.linhas, c.empresas, c.telefones, c.por_operadora, c.erro, c.terminado_em,
  k.pid, (select extract(epoch from now() - s.query_start)::int from pg_stat_activity s where s.pid = k.pid) as segundos,
  (select count(*)::int from mailing.contagem f where f.estado = 'fila' and f.id < c.id
     and (f.visto_em > now() - interval '1 minute' or exists (${CONTANDO("f.id")}))) as na_frente
 from mailing.contagem c left join lateral (${CONTANDO("c.id")} limit 1) k on true
 where c.id = $1::bigint`;
// Parar (só quem pediu): na fila, sai dela; contando, cancela a consulta e o job grava "cancelada".
export const SQL_CONTAGEM_PARAR = `with c as (select id from mailing.contagem where id = $1::bigint and user_id = $2::uuid),
 f as (
   update mailing.contagem m set estado = 'cancelada', terminado_em = now(), erro = 'parada'
    where m.id = (select x.id from mailing.contagem x join c on c.id = x.id where x.estado = 'fila' for update of x skip locked)
   returning m.id)
select (select count(*) from c)::int as achou, (select count(*) from f)::int as saiu_da_fila,
  coalesce((select bool_or(pg_cancel_backend(k.pid)) from c, lateral (${CONTANDO("c.id")}) k), false) as cancelou`;

export function validarQuantidade(v: unknown): number | null {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_QTD ? (n as number) : null;
}

export function sanitizarCarga(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 60);
  return s || null;
}

export function nomeArquivo(carga: string, hojeISO: string): string {
  return `${carga}_${hojeISO}.csv`;
}
