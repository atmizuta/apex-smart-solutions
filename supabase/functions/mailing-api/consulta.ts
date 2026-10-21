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
};
export type SqlParte = { sql: string; params: unknown[] };
export type Validacao = { ok: true; filtros: Filtros } | { ok: false; erro: string };

const CHAVES = new Set(["uf", "municipio", "ddd", "situacao", "porte", "mei", "cnae", "abertura_de", "abertura_ate", "sinais",
  "classe", "excluir_obito", "tipo", "operadora", "portado", "whatsapp", "procon", "origem", "nunca_extraida", "sem_extracao_dias",
  "sexo", "geracao", "risco", "extraida_antes_de"]);

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

// Contagem pela amostra fixa (~2%, mailing.amostra), que cabe na memória do servidor Micro. A base inteira levava de
// 23 a 85 s para contar (21/10). Escala pelo fator da última carga. empresas e telefones contam uma linha marcada por
// empresa/telefone: é exato em expectativa com filtros de empresa e aproximado com filtros de telefone. A extração é exata.
const FATOR = `(select coalesce((contagens->>'amostra_fator')::numeric, 1) from mailing.carga order by carregado_em desc limit 1)`;
export function sqlTotais(w: SqlParte): string {
  return `select round(count(*) * ${FATOR})::bigint as linhas,
  round(count(*) filter (where l.primeira_da_empresa) * ${FATOR})::bigint as empresas,
  round(count(*) filter (where l.primeira_do_fone) * ${FATOR})::bigint as telefones
  from mailing.amostra l where ${w.sql}`;
}
export function sqlPorOperadora(w: SqlParte): string {
  return `select coalesce(l.operadora, 'SEM') as operadora, round(count(*) * ${FATOR})::bigint as linhas
  from mailing.amostra l where ${w.sql} group by 1 order by 2 desc`;
}
export function sqlTotalFiltro(w: SqlParte): string {
  return `select round(count(*) * ${FATOR})::bigint as n from mailing.amostra l where ${w.sql}`;
}
// Menos usados primeiro (nunca extraídos, depois os mais antigos; sorteio fixo entre iguais). "skip locked" faz duas
// extrações simultâneas pegarem linhas diferentes. Marca o uso (também na amostra, para o filtro de uso contar certo)
// e devolve só as 8 colunas que o ProContact usa. Nome do sócio e razão social já estão na linha: buscar empresa e
// sócio para 100 mil linhas passava de 5 min no servidor Micro (21/10).
export function sqlExtrair(w: SqlParte): string {
  const q = `$${w.params.length + 1}`;
  return `with alvo as (
  select l.id from mailing.linha l where ${w.sql}
  order by l.ultima_extracao asc nulls first, l.sorteio
  limit ${q}::int
  for update of l skip locked
), na_amostra as (
  update mailing.amostra a set ultima_extracao = now() from alvo where a.linha_id = alvo.id
), marcadas as (
  update mailing.linha l set ultima_extracao = now(), vezes_extraida = l.vezes_extraida + 1
    from alvo where l.id = alvo.id
  returning l.cnpj, l.cpf, l.fone, l.socio_nome, l.razao_social, l.operadora_nome_id, l.rf_porte_atual, l.rf_municipio
)
select coalesce(m.socio_nome, '') as nome, coalesce(m.razao_social, '') as descricao, coalesce(m.cpf, '') as documento1,
       m.cnpj as documento2, m.fone as fone1, coalesce(o.nome, '') as campo1, coalesce(m.rf_porte_atual, '') as campo2,
       coalesce(mu.nome, '') as campo3
  from marcadas m
  left join mailing.operadora_nome o on o.id = m.operadora_nome_id
  left join mailing.municipio mu on mu.codigo = m.rf_municipio
 order by m.cnpj, m.fone`;
}

export const SQL_REGISTRAR = `insert into mailing.extracao
  (user_id, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida, quantidade_entregue)
  values ($1::uuid, $2, $3, $4, $5, $6::text::jsonb, $7, $8, $9)`; // $6 já vem como texto JSON (sem dupla codificação)
export const SQL_OPCOES = `select tipo, valor, rotulo, uf from mailing.opcao order by tipo, ordem, rotulo`;
export const SQL_CARGA = `select carregado_em, receita_mes, neo_ate, tabela_prefixos from mailing.carga order by carregado_em desc limit 1`;
export const SQL_HISTORICO = `select criado_em, username, role, operacao, nome_carga, filtros, total_no_filtro, quantidade_pedida,
  quantidade_entregue from mailing.extracao order by criado_em desc limit 100`;
export const SQL_USUARIO = `select role, operacao, username from public.profiles where id = $1::uuid`;

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
