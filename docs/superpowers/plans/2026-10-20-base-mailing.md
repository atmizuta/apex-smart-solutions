# Base de Mailing — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colocar a base de mailing (empresas, sócios e telefones já enriquecidos com Receita e NEO) no Supabase, num schema fechado, e criar a aba "Mailing" do painel. Na aba, admin e supervisor filtram, contam e exportam até 100 mil linhas no layout de importação do ProContact.

**Architecture:**
- **Banco:** schema `mailing` no projeto `apex` (plano Pro), sem acesso pela API.
- **Edge Function `mailing-api`:** acessa o banco por conexão direta (`SUPABASE_DB_URL`) e oferece quatro ações: `opcoes`, `contar`, `extrair` e `historico`. A lógica pura (validação e SQL) fica em módulos TypeScript testados com `node --test`.
- **Carga:** um script Python do pipeline local, **fora do repositório** porque os dados são sigilosos.
- **Painel:** monta o CSV em Windows-1252 no navegador e baixa o arquivo.

**Tech Stack:** Postgres 17 (Supabase), Deno Edge Function com `npm:postgres@3.4.5`, Node 24 (`node --test` com remoção de tipos), jsdom (testes do painel), Python 3.12 + DuckDB 1.5 + psycopg 3 (carga).

**Spec:** `docs/superpowers/specs/2026-10-20-base-mailing-design.md` (aprovada em 20/10/2026).

## Global Constraints

**Limites e formato da exportação**
- Até **100.000** linhas por extração, com a quantidade escolhida pela pessoa (1 a 100.000).
- CSV de exportação:
  - separador `;`, codificação **Windows-1252** (caractere fora da tabela vira `?`), quebra de linha **CRLF**, também depois da última linha;
  - **20 colunas nesta ordem:** `nome;descricao;documento1;documento2;fone1;fone2;fone3;fone4;fone5;fone6;fone7;fone8;fone9;fone10;campo1;campo2;campo3;obs;integra1;integra2`;
  - uma linha por telefone;
  - campo com `;`, aspas ou quebra de linha vai entre aspas, com as aspas duplicadas.
- **Mapeamento:**
  - `nome` = sócio, `descricao` = razão social do fornecedor;
  - `documento1` = CPF, `documento2` = CNPJ, `fone1` = telefone;
  - `campo1` = nome da operadora (texto do NEO), `campo2` = porte atual pela Receita, `campo3` = cidade pela Receita;
  - as demais colunas ficam vazias.
- **Prioridade da extração:** `ultima_extracao nulls first, sorteio`. "Já extraído" **só registra**: pode repetir.

**Filtros e acesso**
- **Filtro padrão:** situação `ATIVA`, excluir sócio com óbito, tipo `CELULAR`, origem `MAILING`; Procon "todos".
- **Acesso:** só `admin` e `supervisor`, de qualquer operação (Apex e Campinas veem a base inteira). Consultor recebe 403 e não vê a aba.

**Dados e LGPD**
- **Colunas proibidas no banco:** nome da mãe, sexo, nascimento, idade, renda, score e faixas, persona de crédito, propensão de pagamento, valor presumido, fonte de renda, geração, perfil demográfico, profissão, Bolsa Família, FGTS, veículo, imóvel, saque, e-mails, endereço do sócio, latitude e longitude.
- **Repositório público:** nenhum dado real vai para ele. Testes só com dados fictícios (`00000000191`, `11900000001`, `EMPRESA TESTE`). O script de carga mora em `C:\Users\acer1\Documents\apex-mailing\pipeline`, fora do git.
- **Senha do banco:** só em `%USERPROFILE%\.apex\db_url.txt` (ou na variável `APEX_DB_URL`). Nunca no chat, no repositório nem na saída de comando.

**Tempos**
- Limites dentro da Edge Function: **30 s** para contar e **120 s** para extrair.
- Metas de desempenho (servidor Micro): contar **≤ 10 s**; extrair 100 mil **≤ 60 s**.

**Visual e produção**
- Visual "Sinal de Ápice": reaproveitar `.card`, `.kpiGrid`/`.kpiCard`/`.kpiLabel`/`.kpiValue`, `table.tbl`, `.btn`/`.btn-sm`/`.btn-outline`, `.field`, `.desc`. Cores só por variável, avisos só por `mostrarAviso`, nunca `alert()`. Não tocar no bloco "SISTEMA VISUAL SINAL DE ÁPICE".
- **Produção (migration, carga, deploy da função, publicação do painel, apagar cópias locais):** cada passo só com o **ok explícito do Rafael naquele momento**.
- REGRAS_NEGOCIO.md: **seção 102**.

## Review Focus

1. **Extração de 100 mil linhas.** A resposta JSON (~10 MB) pode estourar a função ou o navegador. Esperado: o arquivo sai completo, com 100.001 linhas (cabeçalho + 100.000). Teste na Tarefa 8, passo 6.
2. **Duas supervisoras exportando ao mesmo tempo com o mesmo filtro.** Esperado: lotes sem números em comum (`for update ... skip locked`). Teste na Tarefa 8, passo 7.
3. **Nome ou razão social com acento, `;` ou aspas.** Esperado: CSV válido e acento certo no ProContact. Testes nas Tarefas 4 e 9.
4. **Filtro que rende zero linhas.** Esperado: aviso "Nenhuma linha…", nenhum arquivo baixado e nada registrado. Testes nas Tarefas 3, 5 e 8.
5. **Filtro pesado que estoura o tempo.** Esperado: aviso "A consulta demorou demais…", sem travar a aba. Testes nas Tarefas 3 e 5.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261021090000_mailing_schema.sql` | schema `mailing`, tabelas e permissões (sem índices de filtro) |
| `supabase/migrations/20261021090100_mailing_indices.sql` | índices de filtro e prioridade + `analyze` (aplicado **depois** da carga) |
| `supabase/rollback/20261021090000_mailing_schema_rollback.sql` | `drop schema mailing cascade` |
| `supabase/rollback/20261021090100_mailing_indices_rollback.sql` | remove os índices |
| `test_mailing_sql.js` | trava de LGPD e de estrutura sobre o SQL das migrations |
| `supabase/functions/mailing-api/consulta.ts` | lógica pura: valida filtros, monta SQL parametrizado, quantidade e nome da carga |
| `supabase/functions/mailing-api/consulta.test.ts` | testes de `consulta.ts` (`node --test`) |
| `supabase/functions/mailing-api/api.ts` | lógica pura: permissão, roteamento das ações, respostas e erros (dependências injetadas) |
| `supabase/functions/mailing-api/api.test.ts` | testes de `api.ts` |
| `supabase/functions/mailing-api/index.ts` | entrada Deno: CORS, usuário do JWT, conexão `postgres`, dependências reais |
| `_template.html` | aba "Mailing": botão, `section#panel-mailing`, CSS `mb*` e funções `mb*` |
| `test_mailing.js` | testes da aba (jsdom, Supabase mockado) |
| `REGRAS_NEGOCIO.md` | seção 102 |
| *(fora do git)* `Documents\apex-mailing\pipeline\09_carga_supabase.py` | monta as tabelas locais com só as colunas permitidas, envia, confere e cria os índices |
| *(fora do git)* `Documents\apex-mailing\pipeline\test_09_carga.py` | testes do script de carga, com dados fictícios |

**Convenções:**
- `$WT` = `C:/Users/acer1/Downloads/apex-smart-solutions/.worktrees/base-mailing` (branch `feat/base-mailing`).
- `$PIPE` = `C:/Users/acer1/Documents/apex-mailing/pipeline`.
- Testes do painel: `cd $WT && bash run_tests.sh test_mailing.js`.
- Testes da função: `cd $WT/supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts`.

---

### Task 1: Migrations do schema `mailing` (estrutura e índices) + trava de LGPD

**Files:**
- Create: `supabase/migrations/20261021090000_mailing_schema.sql`
- Create: `supabase/migrations/20261021090100_mailing_indices.sql`
- Create: `supabase/rollback/20261021090000_mailing_schema_rollback.sql`
- Create: `supabase/rollback/20261021090100_mailing_indices_rollback.sql`
- Test: `test_mailing_sql.js`

**Interfaces:**
- **Consumes:** nada.
- **Produces:**
  - tabelas `mailing.empresa`, `mailing.socio`, `mailing.municipio`, `mailing.operadora_nome`, `mailing.linha`, `mailing.extracao`, `mailing.opcao` e `mailing.carga`, com as colunas exatas abaixo, usadas pelas Tarefas 2, 6 e 8;
  - índice parcial `linha_padrao_prioridade`.

- [ ] **Step 1: Write the failing test**

Criar `test_mailing_sql.js`:

```js
// Trava de estrutura e de LGPD das migrations da base de mailing (seção 102).
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (decisão 7: colunas que NÃO sobem).
const fs = require('fs');
let ok = 0, fail = 0;
function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
const ler = f => { try { return fs.readFileSync(f, 'utf8').toLowerCase(); } catch(e){ return ''; } };
const schema = ler('supabase/migrations/20261021090000_mailing_schema.sql');
const indices = ler('supabase/migrations/20261021090100_mailing_indices.sql');
const rbSchema = ler('supabase/rollback/20261021090000_mailing_schema_rollback.sql');
const rbIndices = ler('supabase/rollback/20261021090100_mailing_indices_rollback.sql');

assert(schema.length > 0, 'migration do schema existe');
for (const t of ['empresa', 'socio', 'municipio', 'operadora_nome', 'linha', 'extracao', 'opcao', 'carga']) {
  assert(schema.includes(`create table mailing.${t} (`), `tabela mailing.${t}`);
}
assert(schema.includes('revoke all on schema mailing from public, anon, authenticated'), 'schema fechado para anon/authenticated');
assert(schema.includes('revoke all on all tables in schema mailing from public, anon, authenticated'), 'tabelas fechadas');
assert(schema.includes('check (quantidade_pedida between 1 and 100000)'), 'limite de 100 mil no registro');
assert(schema.includes('socio_obito boolean not null default false'), 'socio_obito não nulo (índice parcial depende disso)');
assert(!/create index/.test(schema), 'índices de filtro ficam na migration de índices (carga rápida)');
// compara nomes (identificadores) do SQL sem comentários — trecho solto pegaria "quantidade"/"cidade" por causa de "idade"
const nomes = new Set(schema.replace(/--.*$/gm, '').match(/[a-z_][a-z0-9_]*/g));
const trechosProibidos = ['nome_mae', 'sexo', 'nascimento', 'renda', 'score', 'persona', 'propensao', 'presumido', 'geracao',
  'demografica', 'profissao', 'bolsa', 'fgts', 'veiculo', 'imovel', 'saque', 'email', 'logradouro', 'complemento', 'bairro',
  'latitude', 'longitude', 'area_risco'];
const nomesProibidos = ['idade', 'end_cep', 'end_numero', 'end_cidade', 'end_uf'];
for (const p of trechosProibidos) assert(![...nomes].some(n => n.includes(p)), `coluna proibida pela LGPD ausente: ${p}`);
for (const p of nomesProibidos) assert(!nomes.has(p), `coluna proibida pela LGPD ausente: ${p}`);
assert(indices.includes('create index if not exists linha_padrao_prioridade on mailing.linha (ultima_extracao nulls first, sorteio)'), 'índice de prioridade');
assert(indices.includes("where rf_situacao = 'ativa' and not socio_obito and celular and do_mailing"), 'índice parcial no filtro padrão');
assert(indices.includes('analyze mailing.linha'), 'analyze depois dos índices');
assert(rbSchema.includes('drop schema if exists mailing cascade'), 'rollback do schema');
assert(rbIndices.includes('drop index if exists mailing.linha_padrao_prioridade'), 'rollback dos índices');

console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
process.exit(fail > 0 ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $WT && node test_mailing_sql.js`
Expected: FAIL. Várias linhas `FALHOU:` (os arquivos ainda não existem) e saída 1.

- [ ] **Step 3: Write the migrations and rollbacks**

`supabase/migrations/20261021090000_mailing_schema.sql`:

```sql
-- Base de Mailing (REGRAS_NEGOCIO.md seção 102). Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md
-- Só estrutura: os dados entram pelo pipeline local (fora do repositório público). Só as PKs aqui; os índices de
-- filtro entram depois da carga (20261021090100_mailing_indices.sql) para a carga ser rápida.
-- Acesso só pela Edge Function mailing-api (conexão direta); nada exposto à API (anon/authenticated).
create schema if not exists mailing;
revoke all on schema mailing from public, anon, authenticated;

create table mailing.empresa (
  cnpj text primary key,
  razao_social text,
  rf_razao_social text,
  rf_situacao text,
  rf_porte_atual text,
  porte_fornecedor text,
  rf_mei boolean,
  rf_simples boolean,
  rf_cnae integer,
  rf_data_abertura date,
  rf_municipio integer,
  rf_uf text,
  rf_ddd_cidade smallint,
  sinal_deixou_mei boolean,
  sinal_virou_mei boolean,
  sinal_porte_mudou boolean,
  sinal_cidade_mudou boolean,
  algum_socio_obito boolean,
  rf_base text
);

create table mailing.socio (
  cnpj text not null,
  cpf text not null,
  nome text,
  classe_economica text,
  obito boolean,
  principal boolean,
  primary key (cnpj, cpf)
);

-- cidade pela Receita (código de município da Receita = SIAFI) e o nome usado no campo3
create table mailing.municipio (codigo integer primary key, nome text not null, uf text, ddd smallint);
-- texto da operadora para o campo1 (ex.: CLARO S.A.), guardado uma vez só
create table mailing.operadora_nome (id smallint primary key, nome text not null unique);

-- uma linha por CNPJ + telefone = a unidade do arquivo do ProContact; campos de filtro copiados da empresa/sócio
create table mailing.linha (
  id bigint generated always as identity primary key,
  cnpj text not null,
  cpf text,
  fone text not null,
  ddd smallint not null,
  celular boolean not null,
  do_mailing boolean not null,
  whatsapp boolean,
  procon boolean,
  operadora text,
  operadora_nome_id smallint,
  operadora_fonte text,
  portado boolean,
  rf_situacao text,
  rf_porte_atual text,
  rf_mei boolean,
  rf_cnae integer,
  rf_uf text,
  rf_municipio integer,
  rf_ddd_cidade smallint,
  rf_data_abertura date,
  sinal_deixou_mei boolean,
  sinal_virou_mei boolean,
  sinal_porte_mudou boolean,
  classe_economica text,
  socio_obito boolean not null default false,
  sorteio integer not null,
  ultima_extracao timestamptz,
  vezes_extraida integer not null default 0
);

create table mailing.extracao (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  user_id uuid not null,
  username text,
  role text not null,
  operacao text,
  nome_carga text not null,
  filtros jsonb not null,
  total_no_filtro bigint not null,
  quantidade_pedida integer not null check (quantidade_pedida between 1 and 100000),
  quantidade_entregue integer not null
);

-- listas dos filtros da aba (UF, cidade, DDD, CNAE...), montadas pela carga
create table mailing.opcao (tipo text not null, valor text not null, rotulo text not null, uf text, ordem integer not null default 0, primary key (tipo, valor));

create table mailing.carga (
  id bigint generated always as identity primary key,
  carregado_em timestamptz not null default now(),
  receita_mes text,
  neo_ate date,
  tabela_prefixos text,
  contagens jsonb not null
);

revoke all on all tables in schema mailing from public, anon, authenticated;
revoke all on all sequences in schema mailing from public, anon, authenticated;
alter default privileges in schema mailing revoke all on tables from public, anon, authenticated;
alter default privileges in schema mailing revoke all on sequences from public, anon, authenticated;
```

`supabase/migrations/20261021090100_mailing_indices.sql`:

```sql
-- Índices da base de mailing (seção 102), aplicados DEPOIS da carga. O conjunto final sai da medição da Tarefa 7
-- (meta: contar <= 10 s, extrair 100 mil <= 60 s no servidor Micro); só entra índice que provar ganho.
create index if not exists linha_padrao_prioridade on mailing.linha (ultima_extracao nulls first, sorteio)
  where rf_situacao = 'ATIVA' and not socio_obito and celular and do_mailing;
create index if not exists linha_operadora_ddd on mailing.linha (operadora, ddd);
create index if not exists extracao_criado on mailing.extracao (criado_em desc);
analyze mailing.empresa;
analyze mailing.socio;
analyze mailing.linha;
analyze mailing.opcao;
```

`supabase/rollback/20261021090000_mailing_schema_rollback.sql`:

```sql
-- Rollback da base de mailing (seção 102): remove o schema inteiro (dados e registro de extrações).
drop schema if exists mailing cascade;
```

`supabase/rollback/20261021090100_mailing_indices_rollback.sql`:

```sql
-- Rollback dos índices da base de mailing (seção 102).
drop index if exists mailing.linha_padrao_prioridade;
drop index if exists mailing.linha_operadora_ddd;
drop index if exists mailing.extracao_criado;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $WT && node test_mailing_sql.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---` e saída 0.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/migrations/20261021090000_mailing_schema.sql supabase/migrations/20261021090100_mailing_indices.sql supabase/rollback/20261021090000_mailing_schema_rollback.sql supabase/rollback/20261021090100_mailing_indices_rollback.sql test_mailing_sql.js
git commit -m "feat(mailing): migrations do schema mailing e dos índices, com trava de LGPD (seção 102)"
```

---

### Task 2: `consulta.ts` — validação dos filtros e SQL parametrizado

**Files:**
- Create: `supabase/functions/mailing-api/consulta.ts`
- Test: `supabase/functions/mailing-api/consulta.test.ts`

**Interfaces:**
- **Consumes:** colunas de `mailing.linha` (Tarefa 1).
- **Produces:**
  - **constantes:** `MAX_QTD = 100000`, `MAX_ITENS = 500`;
  - **tipos:** `type Filtros`, `type SqlParte = { sql: string; params: unknown[] }`;
  - **funções de filtro:**
    - `filtrosPadrao(): Filtros`;
    - `validarFiltros(raw: unknown): { ok: true; filtros: Filtros } | { ok: false; erro: string }`;
    - `montarWhere(f: Filtros): SqlParte`;
  - **funções de SQL:** `sqlTotais(w)`, `sqlPorOperadora(w)`, `sqlTotalFiltro(w)`, `sqlExtrair(w)`. O limite é o parâmetro `$n+1`;
  - **SQL fixo:** `SQL_REGISTRAR`, `SQL_OPCOES`, `SQL_CARGA`, `SQL_HISTORICO`, `SQL_USUARIO`;
  - **funções auxiliares:**
    - `validarQuantidade(v: unknown): number | null`;
    - `sanitizarCarga(v: unknown): string | null`;
    - `nomeArquivo(carga: string, hojeISO: string): string`.

- [ ] **Step 1: Write the failing test**

Criar `supabase/functions/mailing-api/consulta.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filtrosPadrao, validarFiltros, montarWhere, sqlTotais, sqlExtrair, validarQuantidade, sanitizarCarga, nomeArquivo,
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
  assert.match(sqlTotais(w), /from mailing\.linha l where l\.ddd = any\(\$1::smallint\[\]\)/);
  const x = sqlExtrair(w);
  assert.match(x, /where l\.ddd = any\(\$1::smallint\[\]\)/);
  assert.match(x, /order by l\.ultima_extracao asc nulls first, l\.sorteio/);
  assert.match(x, /limit \$2::int/);
  assert.match(x, /for update of l skip locked/);
  assert.match(x, /set ultima_extracao = now\(\), vezes_extraida = l\.vezes_extraida \+ 1/);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $WT/supabase/functions/mailing-api && node --test consulta.test.ts`
Expected: FAIL com `Cannot find module` / `ERR_MODULE_NOT_FOUND` para `./consulta.ts`.

- [ ] **Step 3: Write the implementation**

Criar `supabase/functions/mailing-api/consulta.ts`:

```ts
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
const SINAIS: Record<string, string> = {
  deixou_mei: "l.sinal_deixou_mei", virou_mei: "l.sinal_virou_mei", porte_mudou: "l.sinal_porte_mudou",
};

export type SimNao = "sim" | "nao";
export type Filtros = {
  uf?: string[]; municipio?: number[]; ddd?: number[]; situacao?: string[]; porte?: string[]; mei?: SimNao;
  cnae?: number[]; abertura_de?: string; abertura_ate?: string; sinais?: ("deixou_mei" | "virou_mei" | "porte_mudou")[];
  classe?: string[]; excluir_obito?: boolean; tipo?: "CELULAR" | "FIXO"; operadora?: string[]; portado?: SimNao;
  whatsapp?: SimNao; procon?: "com" | "sem"; origem?: "MAILING" | "RECEITA"; nunca_extraida?: boolean;
  sem_extracao_dias?: number;
};
export type SqlParte = { sql: string; params: unknown[] };
export type Validacao = { ok: true; filtros: Filtros } | { ok: false; erro: string };

const CHAVES = new Set(["uf", "municipio", "ddd", "situacao", "porte", "mei", "cnae", "abertura_de", "abertura_ate", "sinais",
  "classe", "excluir_obito", "tipo", "operadora", "portado", "whatsapp", "procon", "origem", "nunca_extraida", "sem_extracao_dias"]);

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
  return { sql: conds.length ? conds.join(" and ") : "true", params };
}

export function sqlTotais(w: SqlParte): string {
  return `select count(*)::bigint as linhas, count(distinct l.cnpj)::bigint as empresas, count(distinct l.fone)::bigint as telefones
  from mailing.linha l where ${w.sql}`;
}
export function sqlPorOperadora(w: SqlParte): string {
  return `select coalesce(l.operadora, 'SEM') as operadora, count(*)::bigint as linhas
  from mailing.linha l where ${w.sql} group by 1 order by 2 desc`;
}
export function sqlTotalFiltro(w: SqlParte): string {
  return `select count(*)::bigint as n from mailing.linha l where ${w.sql}`;
}
// Menos usados primeiro (nunca extraídos, depois os mais antigos; sorteio fixo entre iguais). "skip locked" faz duas
// extrações simultâneas pegarem linhas diferentes. Marca o uso e devolve só as 8 colunas que o ProContact usa.
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
  returning l.cnpj, l.cpf, l.fone, l.operadora_nome_id, l.rf_porte_atual, l.rf_municipio
)
select coalesce(s.nome, '') as nome, coalesce(e.razao_social, '') as descricao, coalesce(m.cpf, '') as documento1,
       m.cnpj as documento2, m.fone as fone1, coalesce(o.nome, '') as campo1, coalesce(m.rf_porte_atual, '') as campo2,
       coalesce(mu.nome, '') as campo3
  from marcadas m
  join mailing.empresa e on e.cnpj = m.cnpj
  left join mailing.socio s on s.cnpj = m.cnpj and s.cpf = m.cpf
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $WT/supabase/functions/mailing-api && node --test consulta.test.ts`
Expected: todos os testes `ok`, com `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/mailing-api/consulta.ts supabase/functions/mailing-api/consulta.test.ts
git commit -m "feat(mailing): validação de filtros e SQL parametrizado da mailing-api (seção 102)"
```

---

### Task 3: `api.ts` — permissão, ações e erros (dependências injetadas)

**Files:**
- Create: `supabase/functions/mailing-api/api.ts`
- Test: `supabase/functions/mailing-api/api.test.ts`

**Interfaces:**
- **Consumes:** de `consulta.ts`, as funções `validarFiltros`, `montarWhere`, `validarQuantidade`, `sanitizarCarga`, `nomeArquivo` e os tipos `Filtros`, `SqlParte`.
- **Produces** (o `index.ts` da Tarefa 8 implementa `DepsApi`; o painel da Tarefa 5 lê as respostas):
  - **tipos:** `type Usuario = { id; role; operacao; username }`, `type LinhaExport`, `type RegistroExtracao`, `type Contagem`, `type DepsApi`, `type Resposta = { status: number; body: Record<string, unknown> }`;
  - **constante:** `COLUNAS_EXPORT = ["nome","descricao","documento1","documento2","fone1","campo1","campo2","campo3"]`;
  - **função:** `processar(corpo: unknown, usuario: Usuario | null, deps: DepsApi): Promise<Resposta>`.
- **Respostas:**

| Ação | Corpo da resposta (status 200) |
|---|---|
| `opcoes` | `{ opcoes, carga }` |
| `historico` | `{ extracoes }` |
| `contar` | `{ linhas, empresas, telefones, por_operadora }` |
| `extrair` | `{ colunas, linhas: string[][], total_no_filtro, quantidade_entregue, nome_arquivo }` |

- **Erros:**
  - `403` para sem papel admin ou supervisor;
  - `400` para entrada inválida;
  - `504` para tempo esgotado (código `57014`);
  - `500` para os demais erros.

- [ ] **Step 1: Write the failing test**

Criar `supabase/functions/mailing-api/api.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { processar, COLUNAS_EXPORT } from "./api.ts";
import type { DepsApi, Usuario } from "./api.ts";

const admin: Usuario = { id: "00000000-0000-0000-0000-000000000001", role: "admin", operacao: "apex", username: "adm" };
const supCampinas: Usuario = { id: "00000000-0000-0000-0000-000000000002", role: "supervisor", operacao: "campinas", username: "supc" };
const consultor: Usuario = { id: "00000000-0000-0000-0000-000000000003", role: "consultor", operacao: "apex", username: "cons" };
const LINHA = {
  nome: "FULANO DE TAL", descricao: "EMPRESA TESTE LTDA", documento1: "00000000191", documento2: "00000000000191",
  fone1: "11900000001", campo1: "CLARO S.A.", campo2: "MEI", campo3: "SAO PAULO",
};

function criar(over: Partial<DepsApi> = {}) {
  const chamadas: unknown[][] = [];
  const deps: DepsApi = {
    async opcoes() { chamadas.push(["opcoes"]); return { opcoes: [{ tipo: "uf", valor: "SP", rotulo: "SP", uf: null }], carga: null }; },
    async historico() { chamadas.push(["historico"]); return []; },
    async contar(w) { chamadas.push(["contar", w]); return { linhas: 10, empresas: 5, telefones: 9, por_operadora: [] }; },
    async extrair(w, q, reg) { chamadas.push(["extrair", w, q, reg]); return { linhas: [LINHA], total_no_filtro: 50 }; },
    hojeISO: () => "2026-10-21",
    ...over,
  };
  return { deps, chamadas };
}

test("sem usuário ou consultor: 403 e nada é consultado", async () => {
  for (const u of [null, consultor]) {
    const { deps, chamadas } = criar();
    const r = await processar({ acao: "opcoes" }, u, deps);
    assert.equal(r.status, 403);
    assert.equal(chamadas.length, 0);
  }
});

test("supervisor de qualquer operação acessa", async () => {
  const { deps } = criar();
  const r = await processar({ acao: "opcoes" }, supCampinas, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { opcoes: [{ tipo: "uf", valor: "SP", rotulo: "SP", uf: null }], carga: null });
});

test("ação inválida ou corpo vazio: 400", async () => {
  const { deps } = criar();
  assert.equal((await processar({ acao: "apagar" }, admin, deps)).status, 400);
  assert.equal((await processar(null, admin, deps)).status, 400);
});

test("historico", async () => {
  const { deps } = criar();
  const r = await processar({ acao: "historico" }, admin, deps);
  assert.deepEqual(r, { status: 200, body: { extracoes: [] } });
});

test("contar: filtro inválido = 400 com a mensagem; válido chama deps com o where", async () => {
  const { deps, chamadas } = criar();
  const ruim = await processar({ acao: "contar", filtros: { situacao: ["ABERTA"] } }, admin, deps);
  assert.equal(ruim.status, 400);
  assert.match(String(ruim.body.erro), /situacao/);
  const bom = await processar({ acao: "contar", filtros: { ddd: [11] } }, admin, deps);
  assert.equal(bom.status, 200);
  assert.deepEqual(bom.body, { linhas: 10, empresas: 5, telefones: 9, por_operadora: [] });
  assert.deepEqual(chamadas.at(-1), ["contar", { sql: "l.ddd = any($1::smallint[])", params: [[11]] }]);
});

test("extrair: quantidade e nome da carga obrigatórios", async () => {
  const { deps, chamadas } = criar();
  const q = await processar({ acao: "extrair", filtros: {}, quantidade: 100001, nome_carga: "X" }, admin, deps);
  assert.equal(q.status, 400);
  assert.match(String(q.body.erro), /100\.000/);
  const c = await processar({ acao: "extrair", filtros: {}, quantidade: 10, nome_carga: "  " }, admin, deps);
  assert.equal(c.status, 400);
  assert.match(String(c.body.erro), /nome da carga/);
  assert.equal(chamadas.length, 0);
});

test("extrair: devolve colunas, linhas em lista, nome do arquivo e registro completo", async () => {
  const { deps, chamadas } = criar();
  const r = await processar({ acao: "extrair", filtros: { ddd: [11] }, quantidade: 1, nome_carga: "teste 1" }, supCampinas, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    colunas: [...COLUNAS_EXPORT],
    linhas: [["FULANO DE TAL", "EMPRESA TESTE LTDA", "00000000191", "00000000000191", "11900000001", "CLARO S.A.", "MEI", "SAO PAULO"]],
    total_no_filtro: 50, quantidade_entregue: 1, nome_arquivo: "TESTE-1_2026-10-21.csv",
  });
  const [, w, q, reg] = chamadas.at(-1) as [string, unknown, number, Record<string, unknown>];
  assert.deepEqual(w, { sql: "l.ddd = any($1::smallint[])", params: [[11]] });
  assert.equal(q, 1);
  assert.deepEqual(reg, {
    user_id: supCampinas.id, username: "supc", role: "supervisor", operacao: "campinas", nome_carga: "TESTE-1",
    filtros: { ddd: [11] }, quantidade_pedida: 1,
  });
});

test("extrair sem linhas: 200 com zero entregues", async () => {
  const { deps } = criar({ async extrair() { return { linhas: [], total_no_filtro: 0 }; } });
  const r = await processar({ acao: "extrair", filtros: {}, quantidade: 5, nome_carga: "VAZIO" }, admin, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.quantidade_entregue, 0);
  assert.deepEqual(r.body.linhas, []);
});

test("erros do banco: 57014 = 504 com orientação; outros = 500", async () => {
  const lento = criar({ async contar() { throw Object.assign(new Error("canceling statement"), { code: "57014" }); } });
  const r1 = await processar({ acao: "contar", filtros: {} }, admin, lento.deps);
  assert.equal(r1.status, 504);
  assert.match(String(r1.body.erro), /demorou demais/);
  const quebrado = criar({ async historico() { throw new Error("conexão caiu"); } });
  const r2 = await processar({ acao: "historico" }, admin, quebrado.deps);
  assert.equal(r2.status, 500);
  assert.equal(String(r2.body.erro).includes("conexão caiu"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $WT/supabase/functions/mailing-api && node --test api.test.ts`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `./api.ts`.

- [ ] **Step 3: Write the implementation**

Criar `supabase/functions/mailing-api/api.ts`:

```ts
// Orquestração pura da Edge Function mailing-api (REGRAS_NEGOCIO.md seção 102): permissão, ações e respostas.
// O acesso ao banco vem injetado (DepsApi) — o index.ts implementa com a conexão direta; os testes, com falsos.
import { validarFiltros, montarWhere, validarQuantidade, sanitizarCarga, nomeArquivo } from "./consulta.ts";
import type { Filtros, SqlParte } from "./consulta.ts";

export type Usuario = { id: string; role: string; operacao: string | null; username: string | null };
export type LinhaExport = {
  nome: string; descricao: string; documento1: string; documento2: string; fone1: string; campo1: string; campo2: string; campo3: string;
};
export type RegistroExtracao = {
  user_id: string; username: string | null; role: string; operacao: string | null; nome_carga: string; filtros: Filtros;
  quantidade_pedida: number;
};
export type Contagem = { linhas: number; empresas: number; telefones: number; por_operadora: { operadora: string; linhas: number }[] };
export type DepsApi = {
  opcoes(): Promise<{ opcoes: unknown[]; carga: unknown }>;
  historico(): Promise<unknown[]>;
  contar(w: SqlParte): Promise<Contagem>;
  extrair(w: SqlParte, quantidade: number, registro: RegistroExtracao): Promise<{ linhas: LinhaExport[]; total_no_filtro: number }>;
  hojeISO(): string;
};
export type Resposta = { status: number; body: Record<string, unknown> };

export const COLUNAS_EXPORT = ["nome", "descricao", "documento1", "documento2", "fone1", "campo1", "campo2", "campo3"] as const;
const PAPEIS = new Set(["admin", "supervisor"]);

function erroBanco(e: unknown): Resposta {
  if ((e as { code?: string } | null)?.code === "57014") {
    return { status: 504, body: { erro: "A consulta demorou demais. Refine os filtros e tente de novo." } };
  }
  return { status: 500, body: { erro: "Falha ao consultar a base de mailing." } };
}

export async function processar(corpo: unknown, usuario: Usuario | null, deps: DepsApi): Promise<Resposta> {
  if (!usuario || !PAPEIS.has(usuario.role)) return { status: 403, body: { erro: "Sem permissão para a base de mailing." } };
  const c = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo as Record<string, unknown> : {};
  const acao = c.acao;
  try {
    if (acao === "opcoes") return { status: 200, body: await deps.opcoes() };
    if (acao === "historico") return { status: 200, body: { extracoes: await deps.historico() } };
    if (acao !== "contar" && acao !== "extrair") return { status: 400, body: { erro: "Ação inválida." } };
    const v = validarFiltros(c.filtros);
    if (!v.ok) return { status: 400, body: { erro: v.erro } };
    const w = montarWhere(v.filtros);
    if (acao === "contar") return { status: 200, body: { ...(await deps.contar(w)) } };
    const quantidade = validarQuantidade(c.quantidade);
    if (quantidade === null) return { status: 400, body: { erro: "Quantidade deve ser um número inteiro de 1 a 100.000." } };
    const carga = sanitizarCarga(c.nome_carga);
    if (!carga) return { status: 400, body: { erro: "Informe o nome da carga." } };
    const registro: RegistroExtracao = {
      user_id: usuario.id, username: usuario.username, role: usuario.role, operacao: usuario.operacao,
      nome_carga: carga, filtros: v.filtros, quantidade_pedida: quantidade,
    };
    const r = await deps.extrair(w, quantidade, registro);
    return {
      status: 200,
      body: {
        colunas: [...COLUNAS_EXPORT],
        linhas: r.linhas.map((l) => COLUNAS_EXPORT.map((k) => l[k] ?? "")),
        total_no_filtro: r.total_no_filtro,
        quantidade_entregue: r.linhas.length,
        nome_arquivo: nomeArquivo(carga, deps.hojeISO()),
      },
    };
  } catch (e) {
    return erroBanco(e);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $WT/supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts`
Expected: todos `ok`, com `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add supabase/functions/mailing-api/api.ts supabase/functions/mailing-api/api.test.ts
git commit -m "feat(mailing): orquestração da mailing-api com permissão admin/supervisor e erros tratados (seção 102)"
```

---

### Task 4: Painel — funções puras da aba (CSV, Windows-1252, quantidade, resumo)

**Files:**
- Modify: `_template.html`. Bloco novo de JS logo **antes** de `function canSeeDiscador(){` (hoje na linha ~13578).
- Test: `test_mailing.js` (novo)

**Interfaces:**
- **Consumes:** nada.
- **Produces** (usadas pela Tarefa 5):
  - **constantes:** `MB_MAX_QTD`, `MB_CABECALHO` (as 20 colunas);
  - **permissão e padrões:** `canSeeMailing()`, `mbFiltrosPadrao()`;
  - **CSV e arquivo:** `mbCampoCsv(v)`, `mbMontarCsv(colunas, linhas)`, `mbParaCp1252(texto): Uint8Array`;
  - **validação e textos:** `mbValidarQuantidade(v)`, `mbResumoFiltros(f)`, `mbTextoCarga(c)`, `mbFmtNum(n)`.

- [ ] **Step 1: Write the failing test**

Criar `test_mailing.js`:

```js
// Testa a aba Mailing (seção 102). Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome, CPF ou CNPJ real).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.__fnCalls = [];
window.__fnRespostas = {};
function builder(){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => builder(),
  rpc: () => { const p = Promise.resolve({ data: [], error: null }); return { range: () => p, then: (ok, ko) => p.then(ok, ko) }; },
  functions: { invoke: async (nome, opts) => {
    const body = (opts && opts.body) || {};
    window.__fnCalls.push({ nome, body });
    const r = window.__fnRespostas[body.acao];
    return typeof r === 'function' ? r(body) : (r || { data: {}, error: null });
  } },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const avisos = [];
  mostrarAviso = (msg, tipo) => avisos.push([tipo, String(msg)]);

  // ==== TASK 4: funções puras ====
  eq(mbFiltrosPadrao(), { situacao: ['ATIVA'], excluir_obito: true, tipo: 'CELULAR', origem: 'MAILING' }, 'filtros padrão');
  eq(MB_MAX_QTD, 100000, 'limite de 100 mil');
  const cab = 'nome;descricao;documento1;documento2;fone1;fone2;fone3;fone4;fone5;fone6;fone7;fone8;fone9;fone10;campo1;campo2;campo3;obs;integra1;integra2';
  const cols = ['nome','descricao','documento1','documento2','fone1','campo1','campo2','campo3'];
  eq(mbMontarCsv(cols, []), cab + '\\r\\n', 'só o cabeçalho, terminando em CRLF');
  eq(mbMontarCsv(cols, [['FULANO DE TAL', 'EMPRESA TESTE LTDA', '00000000191', '00000000000191', '11900000001', 'CLARO S.A.', 'MEI', 'SAO PAULO']]),
     cab + '\\r\\nFULANO DE TAL;EMPRESA TESTE LTDA;00000000191;00000000000191;11900000001;;;;;;;;;;CLARO S.A.;MEI;SAO PAULO;;;\\r\\n',
     'linha nas 20 colunas, fone2..fone10 e finais vazios');
  eq(mbMontarCsv(['fone1', 'nome'], [['11900000001', 'FULANO']]).split('\\r\\n')[1].split(';').slice(0, 5),
     ['FULANO', '', '', '', '11900000001'], 'posiciona pelo nome da coluna, não pela ordem recebida');
  eq(mbCampoCsv('A;B'), '"A;B"', 'ponto e vírgula entre aspas');
  eq(mbCampoCsv('DIZ "OI"'), '"DIZ ""OI"""', 'aspas duplicadas');
  eq(mbCampoCsv('L1\\nL2'), '"L1\\nL2"', 'quebra de linha entre aspas');
  eq(mbCampoCsv(null), '', 'nulo vira vazio');
  eq(Array.from(mbParaCp1252('Ação')), [0x41, 0xE7, 0xE3, 0x6F], 'acentos em Windows-1252');
  eq(Array.from(mbParaCp1252('€–')), [0x80, 0x96], 'caracteres próprios do Windows-1252');
  eq(Array.from(mbParaCp1252('漢\\uFFFD😀')), [0x3F, 0x3F, 0x3F], 'fora da tabela vira ?');
  eq(Array.from(mbParaCp1252('\\r\\n')), [0x0D, 0x0A], 'CRLF preservado');
  eq(mbValidarQuantidade('20000'), 20000, 'quantidade simples');
  eq(mbValidarQuantidade('50.000'), 50000, 'aceita milhar com ponto');
  eq(mbValidarQuantidade('100000'), 100000, 'limite exato');
  for(const v of ['100001', '0', '12,5', 'abc', '', null]) eq(mbValidarQuantidade(v), null, 'quantidade inválida: ' + v);
  eq(mbResumoFiltros({ situacao: ['ATIVA'], tipo: 'CELULAR', operadora: ['VIVO', 'TIM'], ddd: [11], excluir_obito: true, origem: 'MAILING' }),
     'DDD 11 · ATIVA · sem óbito · celular · VIVO, TIM · só mailing', 'resumo dos filtros');
  eq(mbResumoFiltros({}), 'sem filtros', 'resumo vazio');
  eq(mbResumoFiltros({ nunca_extraida: true, sem_extracao_dias: 30 }), 'nunca extraídos', 'nunca extraídos vence dias');
  eq(mbTextoCarga({ receita_mes: '2026-09', neo_ate: '2026-10-19', carregado_em: '2026-10-21T12:00:00Z' }),
     'Receita de 2026-09 · operadora do NEO até 19/10/2026 · carregado em 21/10/2026', 'texto da carga');
  eq(mbTextoCarga(null), 'Base ainda não carregada.', 'sem carga');
  eq(mbFmtNum(1234567), '1.234.567', 'milhar pt-BR');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $WT && bash run_tests.sh test_mailing.js`
Expected: `Falharam: test_mailing.js(exit 1)`. O log mostra `ReferenceError: mbFiltrosPadrao is not defined`.

- [ ] **Step 3: Write the implementation**

Em `_template.html`, inserir **imediatamente antes** da linha `function canSeeDiscador(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }`:

```js
// ===================== BASE DE MAILING (20/10/2026, seção 102) =====================
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md. Só admin/supervisor (qualquer operação).
// A base fica no schema `mailing` (fechado à API); o painel fala só com a Edge Function mailing-api.
// O CSV é montado aqui, no layout de importação do ProContact: 20 colunas, ';', CRLF, Windows-1252.
const MB_MAX_QTD = 100000;
const MB_CABECALHO = ['nome', 'descricao', 'documento1', 'documento2', 'fone1', 'fone2', 'fone3', 'fone4', 'fone5', 'fone6',
  'fone7', 'fone8', 'fone9', 'fone10', 'campo1', 'campo2', 'campo3', 'obs', 'integra1', 'integra2'];
// Windows-1252: 0x00–0x7F e 0xA0–0xFF são iguais ao Unicode; 0x80–0x9F têm estes caracteres próprios.
const MB_CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
  0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const MB_ROTULO_OPERADORA = { VIVO: 'Vivo', CLARO: 'Claro', TIM: 'TIM', OUTRAS: 'Outras', SEM: 'Sem operadora' };
function canSeeMailing(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function mbFiltrosPadrao(){ return { situacao: ['ATIVA'], excluir_obito: true, tipo: 'CELULAR', origem: 'MAILING' }; }
function mbFmtNum(n){ return (Number(n) || 0).toLocaleString('pt-BR'); }
function mbCampoCsv(v){
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// colunas/linhas vêm da mailing-api (8 colunas nomeadas); cada uma vai para a sua posição nas 20 do ProContact
function mbMontarCsv(colunas, linhas){
  const idx = {};
  (colunas || []).forEach((c, i) => { idx[c] = i; });
  const saida = [MB_CABECALHO.join(';')];
  for(const l of (linhas || [])) saida.push(MB_CABECALHO.map(c => mbCampoCsv(c in idx ? l[idx[c]] : '')).join(';'));
  return saida.join('\r\n') + '\r\n';
}
function mbParaCp1252(texto){
  const s = String(texto);
  const out = new Uint8Array(s.length);
  let n = 0;
  for(const ch of s){
    const c = ch.codePointAt(0);
    out[n++] = (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) ? c : (MB_CP1252[c] !== undefined ? MB_CP1252[c] : 0x3F);
  }
  return out.subarray(0, n);
}
function mbValidarQuantidade(v){
  const s = String(v === null || v === undefined ? '' : v).trim().replace(/\./g, '');
  if(!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MB_MAX_QTD ? n : null;
}
function mbResumoFiltros(f){
  const p = [], j = a => a.join(', ');
  const SIN = { deixou_mei: 'deixou de ser MEI', virou_mei: 'virou MEI', porte_mudou: 'porte mudou' };
  if(f.uf && f.uf.length) p.push('UF ' + j(f.uf));
  if(f.municipio && f.municipio.length) p.push(f.municipio.length === 1 ? '1 cidade' : f.municipio.length + ' cidades');
  if(f.ddd && f.ddd.length) p.push('DDD ' + j(f.ddd));
  if(f.situacao && f.situacao.length) p.push(j(f.situacao));
  if(f.porte && f.porte.length) p.push(j(f.porte));
  if(f.mei) p.push('MEI: ' + (f.mei === 'sim' ? 'sim' : 'não'));
  if(f.cnae && f.cnae.length) p.push(f.cnae.length === 1 ? '1 CNAE' : f.cnae.length + ' CNAEs');
  if(f.abertura_de || f.abertura_ate) p.push('abertura ' + (f.abertura_de || '…') + ' a ' + (f.abertura_ate || '…'));
  (f.sinais || []).forEach(s => p.push(SIN[s] || s));
  if(f.classe && f.classe.length) p.push('classe ' + j(f.classe));
  if(f.excluir_obito) p.push('sem óbito');
  if(f.tipo) p.push(f.tipo === 'CELULAR' ? 'celular' : 'fixo');
  if(f.operadora && f.operadora.length) p.push(j(f.operadora));
  if(f.portado) p.push('portado: ' + (f.portado === 'sim' ? 'sim' : 'não'));
  if(f.whatsapp) p.push('WhatsApp: ' + (f.whatsapp === 'sim' ? 'sim' : 'não'));
  if(f.procon) p.push(f.procon === 'com' ? 'com flag Procon' : 'sem flag Procon');
  if(f.origem) p.push(f.origem === 'MAILING' ? 'só mailing' : 'só Receita');
  if(f.nunca_extraida) p.push('nunca extraídos');
  else if(f.sem_extracao_dias) p.push('sem extração há ' + f.sem_extracao_dias + ' dias');
  return p.length ? p.join(' · ') : 'sem filtros';
}
function mbTextoCarga(c){
  if(!c) return 'Base ainda não carregada.';
  const p = [];
  if(c.receita_mes) p.push('Receita de ' + c.receita_mes);
  if(c.neo_ate){ const [a, m, d] = String(c.neo_ate).slice(0, 10).split('-'); p.push('operadora do NEO até ' + d + '/' + m + '/' + a); }
  if(c.carregado_em) p.push('carregado em ' + new Date(c.carregado_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
  return p.join(' · ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $WT && bash run_tests.sh test_mailing.js`
Expected: `TOTAL: 1 passaram, 0 falharam, 0 pulados`.

- [ ] **Step 5: Commit**

```bash
cd $WT && git add _template.html test_mailing.js
git commit -m "feat(mailing): funções puras da aba — CSV ProContact em Windows-1252, quantidade e resumo (seção 102)"
```

---

### Task 5: Painel — aba "Mailing" (botão, tela, filtros, contar, exportar, histórico)

**Files:**
- Modify: `_template.html`:
  - botão no `nav#tabsNav`, logo depois de `tabBtnDiscador`;
  - `section#panel-mailing`, logo depois de `section#panel-discador`;
  - CSS antes do `</style>` que fecha o bloco da Agenda/Anotações (a linha do `@media (max-width:720px){ .agSemana...`);
  - dispatcher de abas (perto de `if(btn.dataset.tab === 'discador') dcCarregar();`);
  - `mbAplicarPermissao()` depois de `dcAplicarPermissao();` no login;
  - funções `mb*` depois do bloco da Tarefa 4.
- Modify: `test_reorganizacao_abas.js:95-96` (ordem fixa das abas do menu: entra `mailing` depois de `discador`)
- Test: `test_mailing.js` (acrescentar no marcador `// ==== mais testes entram aqui ====`)

**Interfaces:**
- **Consumes:**
  - da Tarefa 4: `MB_ROTULO_OPERADORA` e as funções puras;
  - do painel: `ppSeguro`, `mostrarAviso`, `escapeHtml`, `downloadBlob`, `ApexMotion.comCarregador`, `sb`, `currentUser`;
  - da Edge Function: `sb.functions.invoke('mailing-api', { body: { acao, ... } })`, com as respostas da Tarefa 3.
- **Produces:** `mbEstado`, `mbAplicarPermissao()`, `mbCarregar()`, `mbLerFiltros()`, `mbLimpar()`, `mbContar()`, `mbExportar()`, `mbChamar(acao, extra)`, `mbFiltrarMunicipios()`, `mbFiltrarCnae()`.

- [ ] **Step 1: Write the failing test**

Em `test_mailing.js`, substituir a linha `  // ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 5: aba ====
  const chamadas = window.__fnCalls;
  const sel = id => Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
  const opts = id => Array.from(document.getElementById(id).options).map(o => o.value);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor', operacao: 'apex' };
  mbAplicarPermissao();
  eq(document.getElementById('tabBtnMailing').style.display, 'none', 'consultor não vê a aba');
  chamadas.length = 0; await mbCarregar(); await espera(20);
  eq(chamadas.length, 0, 'consultor não chama a função');
  currentUser = { id: 's2', nome: 'Sup Campinas', username: 'supc', role: 'supervisor', operacao: 'campinas' };
  mbAplicarPermissao();
  eq(document.getElementById('tabBtnMailing').style.display, 'inline-block', 'supervisor de qualquer operação vê a aba');

  window.__fnRespostas.opcoes = { data: { opcoes: [
    { tipo: 'uf', valor: 'SP', rotulo: 'SP', uf: null }, { tipo: 'uf', valor: 'RJ', rotulo: 'RJ', uf: null },
    { tipo: 'municipio', valor: '7107', rotulo: 'SAO PAULO', uf: 'SP' }, { tipo: 'municipio', valor: '6001', rotulo: 'RIO DE JANEIRO', uf: 'RJ' },
    { tipo: 'ddd', valor: '11', rotulo: '11', uf: null },
    { tipo: 'situacao', valor: 'ATIVA', rotulo: 'ATIVA', uf: null }, { tipo: 'situacao', valor: 'BAIXADA', rotulo: 'BAIXADA', uf: null },
    { tipo: 'porte', valor: 'MEI', rotulo: 'MEI', uf: null }, { tipo: 'classe', valor: 'B', rotulo: 'B', uf: null },
    { tipo: 'cnae', valor: '9602501', rotulo: '9602501 — Cabeleireiros, manicure e pedicure', uf: null },
    { tipo: 'cnae', valor: '4781400', rotulo: '4781400 — Comércio varejista de vestuário', uf: null },
    { tipo: 'operadora', valor: 'VIVO', rotulo: 'Vivo', uf: null }, { tipo: 'operadora', valor: 'SEM', rotulo: 'Sem operadora', uf: null },
  ], carga: { receita_mes: '2026-09', neo_ate: '2026-10-19', carregado_em: '2026-10-21T12:00:00Z' } }, error: null };
  window.__fnRespostas.historico = { data: { extracoes: [ { criado_em: '2026-10-21T13:00:00Z', username: 'adm', role: 'admin', operacao: 'apex',
    nome_carga: 'TESTE-1', filtros: { situacao: ['ATIVA'] }, total_no_filtro: 5000, quantidade_pedida: 100, quantidade_entregue: 100 } ] }, error: null };
  chamadas.length = 0;
  await mbCarregar(); await espera(30);
  eq(chamadas.map(c => c.nome + ':' + c.body.acao).sort(), ['mailing-api:historico', 'mailing-api:opcoes'], 'abrir a aba busca opções e histórico');
  assert(document.getElementById('mbStatus').textContent.includes('Receita de 2026-09'), 'status mostra a data da carga');
  eq(opts('mbUf'), ['SP', 'RJ'], 'UFs preenchidas');
  eq(sel('mbSituacao'), ['ATIVA'], 'situação padrão ATIVA');
  assert(document.getElementById('mbHistorico').innerHTML.includes('TESTE-1'), 'histórico listado');
  chamadas.length = 0;
  await mbCarregar(); await espera(30);
  eq(chamadas.map(c => c.body.acao), ['historico'], 'reabrir a aba só atualiza o histórico');

  document.getElementById('mbUf').options[1].selected = true;
  document.getElementById('mbUf').dispatchEvent(new window.Event('change'));
  eq(opts('mbMunicipio'), ['6001'], 'cidades só da UF escolhida');
  const busca = document.getElementById('mbCnaeBusca');
  busca.value = 'cabel'; busca.dispatchEvent(new window.Event('input'));
  eq(opts('mbCnae'), ['9602501'], 'busca de CNAE pela descrição');
  document.getElementById('mbCnae').options[0].selected = true;
  document.getElementById('mbOperadora').options[0].selected = true;
  document.getElementById('mbUso').value = 'dias'; document.getElementById('mbUso').dispatchEvent(new window.Event('change'));
  eq(document.getElementById('mbUsoDias').style.display, '', 'escolher "não extraídos há…" mostra o campo de dias');
  document.getElementById('mbUsoDias').value = '45';
  eq(mbLerFiltros(), { uf: ['RJ'], situacao: ['ATIVA'], operadora: ['VIVO'], cnae: [9602501], excluir_obito: true, tipo: 'CELULAR', origem: 'MAILING', sem_extracao_dias: 45 }, 'filtros lidos da tela');

  window.__fnRespostas.contar = { data: { linhas: 1234567, empresas: 400000, telefones: 1200000,
    por_operadora: [{ operadora: 'VIVO', linhas: 700000 }, { operadora: 'SEM', linhas: 1000 }] }, error: null };
  chamadas.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq([chamadas[0] && chamadas[0].body.acao, chamadas[0] && chamadas[0].body.filtros.sem_extracao_dias], ['contar', 45], 'contar manda os filtros da tela');
  assert(document.getElementById('mbResultado').innerHTML.includes('1.234.567'), 'mostra o total de linhas');
  assert(document.getElementById('mbResultado').innerHTML.includes('Sem operadora'), 'operadora SEM com rótulo');

  const baixados = [];
  downloadBlob = (blob, nome) => baixados.push({ blob, nome });
  avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbCarga').value = ''; document.getElementById('mbQtd').value = '100';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'sem nome da carga: aviso e nada é chamado');
  avisos.length = 0;
  document.getElementById('mbCarga').value = 'TESTE'; document.getElementById('mbQtd').value = '100001';
  document.getElementById('btnMbExportar').click(); await espera(20);
  eq([chamadas.length, avisos[0] && avisos[0][0]], [0, 'erro'], 'quantidade acima de 100 mil: aviso');

  const colsExp = ['nome', 'descricao', 'documento1', 'documento2', 'fone1', 'campo1', 'campo2', 'campo3'];
  const linhasExp = [['FULANO DE TAL', 'EMPRESA; TESTE "LTDA"', '00000000191', '00000000000191', '11900000001', 'CLARO S.A.', 'MEI', 'SÃO PAULO']];
  window.__fnRespostas.extrair = { data: { colunas: colsExp, linhas: linhasExp, total_no_filtro: 5000, quantidade_entregue: 1, nome_arquivo: 'TESTE_2026-10-21.csv' }, error: null };
  avisos.length = 0; chamadas.length = 0;
  document.getElementById('mbQtd').value = '1';
  document.getElementById('btnMbExportar').click(); await espera(60);
  eq(chamadas[0] && chamadas[0].body, { acao: 'extrair', filtros: mbLerFiltros(), quantidade: 1, nome_carga: 'TESTE' }, 'extrair manda filtros, quantidade e carga');
  eq(baixados.map(b => b.nome), ['TESTE_2026-10-21.csv'], 'baixou um arquivo com o nome vindo da função');
  eq(baixados[0] && baixados[0].blob.size, mbParaCp1252(mbMontarCsv(colsExp, linhasExp)).length, 'arquivo em Windows-1252 com o tamanho certo');
  eq(avisos[0] && avisos[0][0], 'ok', 'aviso de sucesso');
  assert(chamadas.some(c => c.body.acao === 'historico'), 'recarrega o histórico depois de exportar');

  window.__fnRespostas.extrair = { data: { colunas: colsExp, linhas: [], total_no_filtro: 0, quantidade_entregue: 0, nome_arquivo: 'TESTE_2026-10-21.csv' }, error: null };
  baixados.length = 0; avisos.length = 0;
  document.getElementById('btnMbExportar').click(); await espera(40);
  eq([baixados.length, avisos[0] && avisos[0][0]], [0, 'info'], 'filtro vazio: aviso e nenhum arquivo');

  window.__fnRespostas.contar = { data: null, error: { context: { json: async () => ({ erro: 'A consulta demorou demais. Refine os filtros e tente de novo.' }) } } };
  avisos.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq(avisos[0], ['erro', 'A consulta demorou demais. Refine os filtros e tente de novo.'], 'erro da função vira aviso com a mensagem dela');
  window.__fnRespostas.contar = { data: null, error: { message: 'Failed to fetch' } };
  avisos.length = 0;
  document.getElementById('btnMbContar').click(); await espera(40);
  eq(avisos[0], ['erro', 'Não foi possível falar com a base de mailing.'], 'falha de rede: mensagem genérica');

  document.getElementById('btnMbLimpar').click();
  eq(mbLerFiltros(), mbFiltrosPadrao(), 'limpar volta ao padrão');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin', operacao: 'apex' };
  mbAplicarPermissao();
  eq([document.getElementById('mbResultado').innerHTML, mbEstado.opcoes], ['', null], 'trocar de usuário limpa a tela e as opções');
  // ==== mais testes entram aqui ====
```

Em `test_reorganizacao_abas.js`, trocar as linhas 95–96:

```js
  // NOTA (15/10/2026): incluída "discador" (aba Discador, só admin/supervisor), no grupo Visão geral logo depois de "boletim" (seção 87).
  const ordemEsperada = ['producao','mesa','boletim','discador','conversao','busca','proposta','funil','pedidosparados','agenda','anotacoes','biometria','config','basedados','movimentacao','consultores','fechamento'];
```

por:

```js
  // NOTA (15/10/2026): incluída "discador" (aba Discador, só admin/supervisor), no grupo Visão geral logo depois de "boletim" (seção 87).
  // NOTA (20/10/2026): incluída "mailing" (Base de Mailing, só admin/supervisor), logo depois de "discador" (seção 102).
  const ordemEsperada = ['producao','mesa','boletim','discador','mailing','conversao','busca','proposta','funil','pedidosparados','agenda','anotacoes','biometria','config','basedados','movimentacao','consultores','fechamento'];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd $WT && bash run_tests.sh "test_mailing.js test_reorganizacao_abas.js"`
Expected: os dois falham. O `test_mailing.js` acusa `mbAplicarPermissao is not defined` (os elementos ainda não existem); o `test_reorganizacao_abas.js` acusa a ordem (falta `mailing` no menu).

- [ ] **Step 3: Write the implementation**

3a. **Botão.** No `nav#tabsNav`, logo depois da linha do botão `tabBtnDiscador`:

```html
      <!-- 20/10/2026, seção 102: Base de Mailing — admin/supervisor -->
      <button data-tab="mailing" id="tabBtnMailing" style="display:none" data-sub="Filtrar e exportar mailing no layout do ProContact"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/></svg><span class="sbLabel">Mailing</span></button>
```

3b. **Tela.** Logo depois do `</section>` que fecha `section#panel-discador` (o que vem depois de `<div id="dcDetalhe"></div>`):

```html
    <!-- 20/10/2026, seção 102: Base de Mailing (admin/supervisor). Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md -->
    <section class="panel" id="panel-mailing">
      <div class="card">
        <h3 style="margin:0">Mailing</h3>
        <p class="desc" id="mbStatus" style="margin:4px 0 0"></p>
      </div>
      <div class="card">
        <h3 style="margin:0 0 var(--space-3)">Filtros</h3>
        <div class="mbGrade">
          <div class="field"><label for="mbUf">UF</label><select id="mbUf" multiple size="4"></select></div>
          <div class="field"><label for="mbMunicipio">Cidade</label><select id="mbMunicipio" multiple size="4"></select></div>
          <div class="field"><label for="mbDdd">DDD do telefone</label><select id="mbDdd" multiple size="4"></select></div>
          <div class="field"><label for="mbSituacao">Situação na Receita</label><select id="mbSituacao" multiple size="4"></select></div>
          <div class="field"><label for="mbPorte">Porte atual</label><select id="mbPorte" multiple size="4"></select></div>
          <div class="field"><label for="mbClasse">Classe econômica</label><select id="mbClasse" multiple size="4"></select></div>
          <div class="field"><label for="mbOperadora">Operadora</label><select id="mbOperadora" multiple size="4"></select></div>
          <div class="field"><label for="mbCnaeBusca">CNAE</label><input type="search" id="mbCnaeBusca" placeholder="Código ou descrição"><select id="mbCnae" multiple size="4"></select></div>
          <div class="field"><label for="mbMei">MEI</label><select id="mbMei"><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
          <div class="field"><label for="mbAberturaDe">Abertura de</label><input type="date" id="mbAberturaDe"></div>
          <div class="field"><label for="mbAberturaAte">Abertura até</label><input type="date" id="mbAberturaAte"></div>
          <div class="field"><label for="mbTipo">Tipo de telefone</label><select id="mbTipo"><option value="CELULAR">Celular</option><option value="FIXO">Fixo</option><option value="">Todos</option></select></div>
          <div class="field"><label for="mbPortado">Portado</label><select id="mbPortado"><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
          <div class="field"><label for="mbWhatsapp">WhatsApp</label><select id="mbWhatsapp"><option value="">Todos</option><option value="sim">Sim</option><option value="nao">Não</option></select></div>
          <div class="field"><label for="mbProcon">Flag Procon</label><select id="mbProcon"><option value="">Todos</option><option value="sem">Sem flag</option><option value="com">Com flag</option></select></div>
          <div class="field"><label for="mbOrigem">Origem do telefone</label><select id="mbOrigem"><option value="MAILING">Só do mailing</option><option value="RECEITA">Só da Receita</option><option value="">Todos</option></select></div>
          <div class="field"><label for="mbUso">Uso</label><select id="mbUso"><option value="">Todos</option><option value="nunca">Nunca extraídos</option><option value="dias">Não extraídos há…</option></select><input type="number" id="mbUsoDias" min="1" max="3650" value="30" aria-label="Dias sem extração" style="display:none"></div>
        </div>
        <div class="mbChecks">
          <label><input type="checkbox" id="mbExcluirObito" checked> Excluir sócio com óbito</label>
          <label><input type="checkbox" id="mbSinalDeixouMei"> Deixou de ser MEI</label>
          <label><input type="checkbox" id="mbSinalVirouMei"> Virou MEI</label>
          <label><input type="checkbox" id="mbSinalPorteMudou"> Porte mudou</label>
        </div>
        <div class="mbAcoes">
          <button type="button" class="btn btn-sm" id="btnMbContar" style="width:auto">Contar</button>
          <button type="button" class="btn btn-sm btn-outline" id="btnMbLimpar" style="width:auto">Limpar filtros</button>
        </div>
      </div>
      <div id="mbResultado"></div>
      <div class="card">
        <h3 style="margin:0 0 var(--space-3)">Exportar para o ProContact</h3>
        <div class="mbAcoes" style="align-items:flex-end">
          <div class="field" style="margin:0"><label for="mbCarga">Nome da carga</label><input type="text" id="mbCarga" maxlength="60" placeholder="ex.: ICP-D-MEI-VIVO-APEX"></div>
          <div class="field" style="margin:0"><label for="mbQtd">Quantidade (até 100.000)</label><input type="text" inputmode="numeric" id="mbQtd" placeholder="ex.: 20000"></div>
          <button type="button" class="btn btn-sm" id="btnMbExportar" style="width:auto">Exportar CSV</button>
        </div>
        <p class="desc" style="margin:var(--space-2) 0 0">Saem primeiro os números nunca extraídos; depois, os extraídos há mais tempo. O arquivo já vem no layout de importação do ProContact.</p>
      </div>
      <div class="card">
        <h3 style="margin:0 0 var(--space-3)">Histórico de extrações</h3>
        <div id="mbHistorico"></div>
      </div>
    </section>
```

3c. **CSS.** Antes do `</style>` que vem logo depois da linha `  @media (max-width:720px){ .agSemana,.agGrade{display:none;} .agLista{display:block;} .anCardTopo{flex-direction:column;align-items:flex-start;} }`:

```css
  /* Base de Mailing (seção 102) */
  .mbGrade{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:var(--space-3);}
  .mbGrade select[multiple]{min-height:96px;}
  .mbGrade input[type=search]{margin-bottom:var(--space-2);}
  .mbChecks{display:flex;gap:var(--space-4);flex-wrap:wrap;margin-top:var(--space-3);font-size:var(--fs-sm);}
  .mbAcoes{display:flex;gap:var(--space-3);flex-wrap:wrap;margin-top:var(--space-3);}
```

3d. **Dispatcher de abas.** Logo depois de `  if(btn.dataset.tab === 'discador') dcCarregar();`:

```js
  if(btn.dataset.tab === 'mailing') mbCarregar();
```

3e. **Login.** Logo depois de `    dcAplicarPermissao();` (dentro do bloco que aplica as permissões das abas):

```js
    // 20/10/2026 (seção 102): Base de Mailing — só admin/supervisor
    mbAplicarPermissao();
```

3f. **Funções.** Logo depois da função `mbTextoCarga` (Tarefa 4):

```js
const mbEstado = { geracao: 0, opcoes: null };
function mbResetar(){
  mbEstado.geracao++; mbEstado.opcoes = null;
  ['mbResultado', 'mbHistorico'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
  const st = document.getElementById('mbStatus'); if(st) st.textContent = '';
}
function mbAplicarPermissao(){
  document.getElementById('tabBtnMailing').style.display = canSeeMailing() ? 'inline-block' : 'none';
  mbResetar(); // troca de usuário no mesmo navegador não herda a tela nem as opções
}
async function mbChamar(acao, extra){
  const r = await ppSeguro(() => sb.functions.invoke('mailing-api', { body: Object.assign({ acao }, extra || {}) }));
  if(r.error){
    let msg = 'Não foi possível falar com a base de mailing.';
    try{
      const ctx = r.error.context;
      if(ctx && typeof ctx.json === 'function'){ const j = await ctx.json(); if(j && j.erro) msg = String(j.erro); }
    }catch(_){}
    return { erro: msg };
  }
  return { data: r.data || {} };
}
function mbOpcoesDo(tipo){ return (mbEstado.opcoes || []).filter(o => o.tipo === tipo); }
function mbSelecionados(id, numero){ return Array.from(document.getElementById(id).selectedOptions).map(o => numero ? Number(o.value) : o.value); }
function mbPreencherSelect(id, itens, marcados){
  const el = document.getElementById(id);
  const sel = new Set(marcados || Array.from(el.selectedOptions).map(o => o.value));
  el.innerHTML = itens.map(o => `<option value="${escapeHtml(String(o.valor))}"${sel.has(String(o.valor)) ? ' selected' : ''}>${escapeHtml(String(o.rotulo))}</option>`).join('');
}
function mbFiltrarMunicipios(){
  const ufs = new Set(mbSelecionados('mbUf'));
  mbPreencherSelect('mbMunicipio', mbOpcoesDo('municipio').filter(o => !ufs.size || ufs.has(o.uf)));
}
function mbFiltrarCnae(){
  const q = (document.getElementById('mbCnaeBusca').value || '').trim().toLowerCase();
  const sel = new Set(mbSelecionados('mbCnae'));
  const itens = mbOpcoesDo('cnae').filter(o => sel.has(String(o.valor)) || !q || String(o.rotulo).toLowerCase().includes(q));
  mbPreencherSelect('mbCnae', itens.slice(0, 300)); // ~1.300 CNAEs: sem busca, mostra os 300 primeiros
}
function mbPreencherOpcoes(){
  mbPreencherSelect('mbUf', mbOpcoesDo('uf'));
  mbPreencherSelect('mbDdd', mbOpcoesDo('ddd'));
  mbPreencherSelect('mbSituacao', mbOpcoesDo('situacao'), ['ATIVA']);
  mbPreencherSelect('mbPorte', mbOpcoesDo('porte'));
  mbPreencherSelect('mbClasse', mbOpcoesDo('classe'));
  mbPreencherSelect('mbOperadora', mbOpcoesDo('operadora'));
  mbFiltrarMunicipios(); mbFiltrarCnae();
}
function mbLerFiltros(){
  const f = {};
  for(const [k, id] of [['uf', 'mbUf'], ['situacao', 'mbSituacao'], ['porte', 'mbPorte'], ['classe', 'mbClasse'], ['operadora', 'mbOperadora']]){
    const v = mbSelecionados(id); if(v.length) f[k] = v;
  }
  for(const [k, id] of [['municipio', 'mbMunicipio'], ['ddd', 'mbDdd'], ['cnae', 'mbCnae']]){
    const v = mbSelecionados(id, true); if(v.length) f[k] = v;
  }
  const val = id => document.getElementById(id).value;
  if(val('mbMei')) f.mei = val('mbMei');
  if(val('mbAberturaDe')) f.abertura_de = val('mbAberturaDe');
  if(val('mbAberturaAte')) f.abertura_ate = val('mbAberturaAte');
  const sinais = [['deixou_mei', 'mbSinalDeixouMei'], ['virou_mei', 'mbSinalVirouMei'], ['porte_mudou', 'mbSinalPorteMudou']]
    .filter(([, id]) => document.getElementById(id).checked).map(([s]) => s);
  if(sinais.length) f.sinais = sinais;
  if(document.getElementById('mbExcluirObito').checked) f.excluir_obito = true;
  for(const [k, id] of [['tipo', 'mbTipo'], ['portado', 'mbPortado'], ['whatsapp', 'mbWhatsapp'], ['procon', 'mbProcon'], ['origem', 'mbOrigem']]){
    if(val(id)) f[k] = val(id);
  }
  if(val('mbUso') === 'nunca') f.nunca_extraida = true;
  if(val('mbUso') === 'dias'){ const d = parseInt(val('mbUsoDias'), 10); if(d >= 1) f.sem_extracao_dias = d; }
  return f;
}
function mbLimpar(){
  ['mbUf', 'mbMunicipio', 'mbDdd', 'mbPorte', 'mbClasse', 'mbOperadora', 'mbCnae']
    .forEach(id => Array.from(document.getElementById(id).options).forEach(o => { o.selected = false; }));
  Array.from(document.getElementById('mbSituacao').options).forEach(o => { o.selected = o.value === 'ATIVA'; });
  ['mbMei', 'mbPortado', 'mbWhatsapp', 'mbProcon', 'mbUso', 'mbAberturaDe', 'mbAberturaAte', 'mbCnaeBusca']
    .forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('mbTipo').value = 'CELULAR';
  document.getElementById('mbOrigem').value = 'MAILING';
  document.getElementById('mbUsoDias').value = '30';
  document.getElementById('mbUsoDias').style.display = 'none';
  ['mbSinalDeixouMei', 'mbSinalVirouMei', 'mbSinalPorteMudou'].forEach(id => { document.getElementById(id).checked = false; });
  document.getElementById('mbExcluirObito').checked = true;
  mbFiltrarMunicipios(); mbFiltrarCnae();
}
function mbRenderResultado(d){
  const e = escapeHtml;
  const ops = (d.por_operadora || []).map(o => `<tr><td>${e(MB_ROTULO_OPERADORA[o.operadora] || o.operadora)}</td><td style="text-align:right">${e(mbFmtNum(o.linhas))}</td></tr>`).join('');
  document.getElementById('mbResultado').innerHTML = `<div class="card"><h3 style="margin:0 0 var(--space-3)">Resultado do filtro</h3>
    <div class="kpiGrid">
      <div class="kpiCard"><div class="kpiLabel">Linhas (empresa + telefone)</div><div class="kpiValue">${e(mbFmtNum(d.linhas))}</div></div>
      <div class="kpiCard"><div class="kpiLabel">Empresas</div><div class="kpiValue">${e(mbFmtNum(d.empresas))}</div></div>
      <div class="kpiCard"><div class="kpiLabel">Telefones distintos</div><div class="kpiValue">${e(mbFmtNum(d.telefones))}</div></div>
    </div>
    ${ops ? `<table class="tbl" style="margin-top:var(--space-3)"><thead><tr><th>Operadora</th><th style="text-align:right">Linhas</th></tr></thead><tbody>${ops}</tbody></table>` : ''}
  </div>`;
}
function mbRenderHistorico(lista){
  const el = document.getElementById('mbHistorico');
  if(lista === null){ el.innerHTML = '<p class="desc">Não foi possível carregar o histórico.</p>'; return; }
  if(!lista.length){ el.innerHTML = '<p class="desc">Nenhuma extração ainda.</p>'; return; }
  const e = escapeHtml;
  const quando = s => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  el.innerHTML = `<table class="tbl"><thead><tr><th>Quando</th><th>Quem</th><th>Carga</th><th>Filtros</th><th style="text-align:right">Linhas</th></tr></thead><tbody>`
    + lista.map(x => `<tr><td>${e(quando(x.criado_em))}</td><td>${e(x.username || '')}</td><td>${e(x.nome_carga || '')}</td><td>${e(mbResumoFiltros(x.filtros || {}))}</td><td style="text-align:right">${e(mbFmtNum(x.quantidade_entregue))}</td></tr>`).join('')
    + '</tbody></table>';
}
async function mbCarregar(){
  if(!canSeeMailing()) return;
  const ger = ++mbEstado.geracao;
  const precisaOpcoes = !mbEstado.opcoes;
  if(precisaOpcoes) document.getElementById('mbStatus').textContent = 'Carregando…';
  const [op, hist] = await Promise.all([precisaOpcoes ? mbChamar('opcoes') : Promise.resolve(null), mbChamar('historico')]);
  if(ger !== mbEstado.geracao) return; // trocou de usuário no meio
  if(op){
    if(op.erro){ document.getElementById('mbStatus').textContent = op.erro; return; }
    mbEstado.opcoes = op.data.opcoes || [];
    mbPreencherOpcoes();
    document.getElementById('mbStatus').textContent = mbTextoCarga(op.data.carga);
  }
  mbRenderHistorico(hist.erro ? null : (hist.data.extracoes || []));
}
async function mbContar(){
  if(!canSeeMailing()) return;
  const r = await ApexMotion.comCarregador('Contando', () => mbChamar('contar', { filtros: mbLerFiltros() }));
  if(r.erro){ mostrarAviso(r.erro, 'erro'); return; }
  mbRenderResultado(r.data);
}
async function mbExportar(){
  if(!canSeeMailing()) return;
  const carga = document.getElementById('mbCarga').value.trim();
  if(!carga){ mostrarAviso('Informe o nome da carga (ex.: ICP-D-MEI-VIVO-APEX).', 'erro'); return; }
  const quantidade = mbValidarQuantidade(document.getElementById('mbQtd').value);
  if(!quantidade){ mostrarAviso('Quantidade deve ser um número inteiro de 1 a 100.000.', 'erro'); return; }
  const r = await ApexMotion.comCarregador('Gerando mailing', () => mbChamar('extrair', { filtros: mbLerFiltros(), quantidade, nome_carga: carga }));
  if(r.erro){ mostrarAviso(r.erro, 'erro'); return; }
  const d = r.data;
  if(!d.quantidade_entregue){ mostrarAviso('Nenhuma linha com esses filtros. Nada foi exportado.', 'info'); return; }
  const bytes = mbParaCp1252(mbMontarCsv(d.colunas, d.linhas));
  downloadBlob(new Blob([bytes], { type: 'text/csv;charset=windows-1252' }), d.nome_arquivo);
  mostrarAviso(mbFmtNum(d.quantidade_entregue) + ' linhas exportadas (' + mbFmtNum(d.total_no_filtro) + ' no filtro).', 'ok');
  const h = await mbChamar('historico');
  if(!h.erro) mbRenderHistorico(h.data.extracoes || []);
}
document.getElementById('btnMbContar').addEventListener('click', () => { mbContar(); });
document.getElementById('btnMbExportar').addEventListener('click', () => { mbExportar(); });
document.getElementById('btnMbLimpar').addEventListener('click', () => { mbLimpar(); });
document.getElementById('mbUf').addEventListener('change', () => { mbFiltrarMunicipios(); });
document.getElementById('mbCnaeBusca').addEventListener('input', () => { mbFiltrarCnae(); });
document.getElementById('mbUso').addEventListener('change', () => {
  document.getElementById('mbUsoDias').style.display = document.getElementById('mbUso').value === 'dias' ? '' : 'none';
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd $WT && bash run_tests.sh "test_mailing.js test_reorganizacao_abas.js test_discador.js"` (entre aspas: o script só lê o primeiro argumento)
Expected: `TOTAL: 3 passaram, 0 falharam, 0 pulados`. O `test_discador.js` confirma que a aba vizinha não quebrou.

- [ ] **Step 5: Run the whole suite**

Run: `cd $WT && bash run_tests.sh`
Expected: nenhuma falha nova. Medição de 20/10, numa cópia do worktree com o código deste plano: 64 passaram e falharam as mesmas 5 do original, todas anteriores a esta frente:
- `test_pedidos_alerta.js` e `test_projecao_ganho.js`: sem `exceljs`;
- `test_proposta_manual_docs.js` e `test_proposta_timbrada.js`: sem `docx`;
- `test_redesign_shell.js`: "cantos arredondados antigos", já falha no original.

Se o `node_modules` do Rafael tiver `exceljs` e `docx`, as quatro primeiras passam.

- [ ] **Step 6: Commit**

```bash
cd $WT && git add _template.html test_mailing.js test_reorganizacao_abas.js
git commit -m "feat(mailing): aba Mailing com filtros, contagem, exportação ProContact e histórico (seção 102)"
```

---

### Task 6: Script de carga (pipeline local, fora do git)

**Files:**
- Create: `$PIPE/09_carga_supabase.py`
- Create: `$PIPE/test_09_carga.py`
- **Consumes:**
  - `$PIPE/config.py` (`MAIL`, `SAIDA`, `RF`, `RF_MES`, `DDD_CSV`, `ANATEL`, `conectar()`);
  - `_saida/empresas.parquet`, `socios.parquet`, `telefones.parquet` e `operadoras.parquet`;
  - `RF/_tabelas/municipios.parquet` e `cnaes.parquet`;
  - as migrations da Tarefa 1.

**Interfaces:**
- **Produces** (usados pela Tarefa 7):
  - `COLUNAS` (dicionário tabela → colunas, na ordem da migration) e `PROIBIDAS`;
  - `sql_linha(tel, op, emp, soc) -> str`;
  - `montar(con, destino=CARGA) -> dict`, que devolve as contagens;
  - `enviar(con, destino=CARGA)`;
  - linha de comando: `python 09_carga_supabase.py [--enviar]`.

- [ ] **Step 1: Instalar o driver do Postgres**

Run: `pip install "psycopg[binary]==3.2.*"`
Expected: `Successfully installed psycopg-3.2.x psycopg-binary-3.2.x`. Biblioteca gratuita, usada só para o DDL e a conferência.

- [ ] **Step 2: Write the failing test**

Criar `$PIPE/test_09_carga.py`:

```python
# Testes do 09_carga_supabase.py com dados FICTICIOS (nenhum dado da base). Rodar: python test_09_carga.py
import importlib.util, os, re, duckdb

AQUI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('carga', os.path.join(AQUI, '09_carga_supabase.py'))
carga = importlib.util.module_from_spec(spec)
spec.loader.exec_module(carga)

ok = falhas = 0
def eq(a, b, msg):
    global ok, falhas
    if a == b: ok += 1
    else:
        falhas += 1; print('FALHOU:', msg, '- esperado', b, 'veio', a)

# 1) colunas do script = colunas da migration (o que o banco tem é o que o script envia)
sql = open(carga.MIGRATION_SCHEMA, encoding='utf-8').read()
def colunas_da_tabela(t):
    m = re.search(r'create table mailing\.' + t + r' \((.*?)\);', sql, re.S)
    assert m, t
    corpo, partes, nivel, atual = m.group(1), [], 0, ''
    for ch in corpo:
        if ch == '(': nivel += 1
        if ch == ')': nivel -= 1
        if ch == ',' and nivel == 0: partes.append(atual); atual = ''
        else: atual += ch
    partes.append(atual)
    nomes = [p.strip().split()[0] for p in partes if p.strip()]
    return [n for n in nomes if n not in ('primary', 'unique', 'check', 'constraint')]
AUTOMATICAS = {'linha': {'id', 'ultima_extracao', 'vezes_extraida'}}
for t, cols in carga.COLUNAS.items():
    eq(set(cols), set(colunas_da_tabela(t)) - AUTOMATICAS.get(t, set()), f'colunas de {t} batem com a migration')

# 2) nenhuma coluna proibida (LGPD) sobe
todas = {c for cols in carga.COLUNAS.values() for c in cols}
eq(todas & carga.PROIBIDAS, set(), 'nenhuma coluna proibida no envio')

# 3) sql_linha com dados ficticios
con = duckdb.connect()
con.execute("""create table tel as select * from (values
  ('00000000000191', '11900000001', 'MOVEL', '00000000191', true, 0, 'MAILING'),
  ('00000000000191', '11900000002', 'MOVEL', '00000000191', false, 1, 'MAILING'),
  ('00000000000191', '11900000003', 'MOVEL', null, null, null, 'RECEITA'),
  ('00000000000191', '1133334444', 'FIXO', null, null, null, 'RECEITA'),
  ('00000000000191', '11000000009', 'MOVEL', '00000000191', true, 0, 'MAILING')
) t(cnpj, fone, tipo, cpf_socio, whatsapp, procon, origem)""")
con.execute("""create table op as select * from (values
  ('11900000001', true, 'CLARO', 'NEO', 'CLARO S.A.', 'TELEFONICA BRASIL S.A.', false),
  ('11900000002', true, 'VIVO', 'FORNECEDOR', null, 'TIM S/A', null),
  ('11900000003', true, 'TIM', 'PREFIXO_ANATEL', null, 'TIM S/A', null),
  ('1133334444', true, null, null, null, null, null),
  ('11000000009', false, 'CLARO', 'NEO', 'CLARO S.A.', 'CLARO S.A.', false)
) t(fone, NUMERO_VALIDO, OPERADORA_ATUAL, OPERADORA_ATUAL_FONTE, NEO_OPERADORA, PRESTADORA_PREFIXO, NEO_PORTADO)""")
con.execute("""create table emp as select * from (values
  ('00000000000191', '00000000191', 'ATIVA', 'MEI', true, '9602501', 'SP', '7107', '11', date '2020-01-01', false, false, false)
) t(cnpj, cpf_socio_principal, RF_SITUACAO, RF_PORTE_ATUAL, RF_MEI, RF_CNAE, RF_UF, RF_CODIGO_MUNICIPIO, RF_DDD_CIDADE,
    RF_DATA_ABERTURA, SINAL_DEIXOU_DE_SER_MEI, SINAL_VIROU_MEI, SINAL_PORTE_MUDOU)""")
con.execute("""create table soc as select * from (values ('00000000000191', '00000000191', 'B', 1)) t(cnpj, cpf, classe_economica, flag_obito)""")
linhas = con.execute(f"select fone, cpf, celular, do_mailing, procon, operadora, operadora_nome, operadora_fonte, socio_obito, rf_cnae, rf_municipio from ({carga.sql_linha('tel', 'op', 'emp', 'soc')}) order by fone").fetchall()
eq([l[0] for l in linhas], ['1133334444', '11900000001', '11900000002', '11900000003'], 'número inválido fica de fora')
por = {l[0]: l for l in linhas}
eq(por['11900000001'][5:8], ('CLARO', 'CLARO S.A.', 'NEO'), 'NEO: texto do NEO')
eq(por['11900000002'][5:8], ('VIVO', 'TELEFONICA BRASIL S.A.', 'FORNECEDOR'), 'fornecedor: nome canônico da operadora')
eq(por['11900000003'][5:8], ('TIM', 'TIM S/A', 'PREFIXO'), 'prefixo: prestadora da tabela Anatel')
eq(por['1133334444'][5:8], (None, None, None), 'fixo sem operadora')
eq(por['11900000003'][1], '00000000191', 'telefone da Receita usa o sócio principal')
eq((por['11900000001'][2], por['1133334444'][2]), (True, False), 'celular x fixo')
eq((por['11900000001'][3], por['11900000003'][3]), (True, False), 'origem mailing x Receita')
eq((por['11900000001'][4], por['11900000002'][4]), (False, True), 'procon vira booleano')
eq(por['11900000001'][8], True, 'óbito do sócio vira socio_obito')
eq((por['11900000001'][9], por['11900000001'][10]), (9602501, 7107), 'CNAE e município viram inteiros')

print('--- RESULTADO:', ok, 'passaram,', falhas, 'falharam ---')
raise SystemExit(1 if falhas else 0)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd $PIPE && python test_09_carga.py`
Expected: FAIL com `FileNotFoundError`. O `09_carga_supabase.py` ainda não existe.

- [ ] **Step 4: Write the implementation**

Criar `$PIPE/09_carga_supabase.py`:

```python
# Etapa 9: carrega a base de mailing no Supabase (schema mailing) - REGRAS_NEGOCIO.md secao 102.
# Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (secoes 4 e 7). So imprime contagens; nunca dados.
#   python 09_carga_supabase.py            monta _carga/*.parquet (so as colunas permitidas) e mostra contagens
#   python 09_carga_supabase.py --enviar   aplica a migration (se faltar), envia, confere e cria os indices
# Conexao (Session pooler do Supabase, com senha): variavel APEX_DB_URL ou o arquivo %USERPROFILE%\.apex\db_url.txt.
# A senha nunca e impressa: erros passam por limpar_erro().
import argparse, json, time
from config import *

REPO = r'C:/Users/acer1/Downloads/apex-smart-solutions/.worktrees/base-mailing'
MIGRATION_SCHEMA = REPO + '/supabase/migrations/20261021090000_mailing_schema.sql'
MIGRATION_INDICES = REPO + '/supabase/migrations/20261021090100_mailing_indices.sql'
CARGA = MAIL + '/_carga'

# Colunas que sobem, na ordem da migration (decisao 7 da spec). test_09_carga.py confere contra o .sql.
COLUNAS = {
    'municipio': ['codigo', 'nome', 'uf', 'ddd'],
    'operadora_nome': ['id', 'nome'],
    'empresa': ['cnpj', 'razao_social', 'rf_razao_social', 'rf_situacao', 'rf_porte_atual', 'porte_fornecedor', 'rf_mei',
                'rf_simples', 'rf_cnae', 'rf_data_abertura', 'rf_municipio', 'rf_uf', 'rf_ddd_cidade', 'sinal_deixou_mei',
                'sinal_virou_mei', 'sinal_porte_mudou', 'sinal_cidade_mudou', 'algum_socio_obito', 'rf_base'],
    'socio': ['cnpj', 'cpf', 'nome', 'classe_economica', 'obito', 'principal'],
    'linha': ['cnpj', 'cpf', 'fone', 'ddd', 'celular', 'do_mailing', 'whatsapp', 'procon', 'operadora', 'operadora_nome_id',
              'operadora_fonte', 'portado', 'rf_situacao', 'rf_porte_atual', 'rf_mei', 'rf_cnae', 'rf_uf', 'rf_municipio',
              'rf_ddd_cidade', 'rf_data_abertura', 'sinal_deixou_mei', 'sinal_virou_mei', 'sinal_porte_mudou',
              'classe_economica', 'socio_obito', 'sorteio'],
    'opcao': ['tipo', 'valor', 'rotulo', 'uf', 'ordem'],
}
PROIBIDAS = {'nome_mae', 'sexo', 'nascimento', 'idade', 'renda', 'score', 'score_faixa', 'persona_credito', 'score_digital',
             'propensao_pagamento', 'valor_presumido', 'fonte_renda', 'geracao', 'demografica', 'possivel_profissao',
             'flag_bolsa_familia', 'flag_fgts', 'flag_veiculo', 'flag_imovel', 'saque', 'email1', 'email2', 'email3',
             'end_tipo', 'end_titulo', 'end_logradouro', 'end_numero', 'end_complemento', 'end_bairro', 'end_cidade',
             'end_uf', 'end_cep', 'latitude', 'longitude', 'area_risco'}


def sql_linha(tel, op, emp, soc):
    """Uma linha por CNPJ + telefone valido, com a operadora atual e os campos de filtro copiados da empresa/socio."""
    return f"""
select t.cnpj, coalesce(t.cpf_socio, e.cpf_socio_principal) as cpf, t.fone,
  cast(substr(t.fone, 1, 2) as smallint) as ddd, t.tipo = 'MOVEL' as celular, t.origem = 'MAILING' as do_mailing,
  t.whatsapp, t.procon = 1 as procon, o.OPERADORA_ATUAL as operadora,
  case o.OPERADORA_ATUAL_FONTE
    when 'NEO' then o.NEO_OPERADORA
    when 'PREFIXO_ANATEL' then o.PRESTADORA_PREFIXO
    when 'FORNECEDOR' then case o.OPERADORA_ATUAL when 'VIVO' then 'TELEFONICA BRASIL S.A.' when 'CLARO' then 'CLARO S.A.'
                                                  when 'TIM' then 'TIM S/A' else 'OUTRAS' end
  end as operadora_nome,
  case o.OPERADORA_ATUAL_FONTE when 'NEO' then 'NEO' when 'FORNECEDOR' then 'FORNECEDOR' when 'PREFIXO_ANATEL' then 'PREFIXO' end
    as operadora_fonte,
  o.NEO_PORTADO as portado, e.RF_SITUACAO as rf_situacao, e.RF_PORTE_ATUAL as rf_porte_atual, e.RF_MEI as rf_mei,
  try_cast(e.RF_CNAE as integer) as rf_cnae, e.RF_UF as rf_uf, try_cast(e.RF_CODIGO_MUNICIPIO as integer) as rf_municipio,
  try_cast(e.RF_DDD_CIDADE as smallint) as rf_ddd_cidade, e.RF_DATA_ABERTURA as rf_data_abertura,
  coalesce(e.SINAL_DEIXOU_DE_SER_MEI, false) as sinal_deixou_mei, coalesce(e.SINAL_VIROU_MEI, false) as sinal_virou_mei,
  coalesce(e.SINAL_PORTE_MUDOU, false) as sinal_porte_mudou, s.classe_economica,
  coalesce(s.flag_obito = 1, false) as socio_obito,
  cast(hash(t.cnpj || '|' || t.fone) % 2000000000 as integer) as sorteio
from {tel} t
join {op} o on o.fone = t.fone
join {emp} e on e.cnpj = t.cnpj
left join {soc} s on s.cnpj = t.cnpj and s.cpf = coalesce(t.cpf_socio, e.cpf_socio_principal)
where o.NUMERO_VALIDO"""


def montar(con, destino=CARGA):
    os.makedirs(destino, exist_ok=True)
    e, t, s, o = (f"read_parquet('{SAIDA}/{n}.parquet')" for n in ('empresas', 'telefones', 'socios', 'operadoras'))
    con.execute(f"create or replace temp table l0 as {sql_linha(t, o, e, s)}")
    con.execute("""create or replace temp table operadora_nome as
      select cast(row_number() over (order by operadora_nome) as smallint) as id, operadora_nome as nome
      from (select distinct operadora_nome from l0 where operadora_nome is not null)""")
    con.execute("""create or replace temp table linha as
      select l0.* exclude (operadora_nome), n.id as operadora_nome_id from l0 left join operadora_nome n on n.nome = l0.operadora_nome""")
    dup = con.execute("select count(*) - count(distinct cnpj || '|' || fone) from linha").fetchone()[0]
    assert dup == 0, f'{dup} linhas repetidas (cnpj + fone)'
    con.execute(f"""create or replace temp table empresa as select cnpj, razao as razao_social, RF_RAZAO_SOCIAL as rf_razao_social,
      RF_SITUACAO as rf_situacao, RF_PORTE_ATUAL as rf_porte_atual, porte as porte_fornecedor, RF_MEI as rf_mei,
      RF_SIMPLES as rf_simples, try_cast(RF_CNAE as integer) as rf_cnae, RF_DATA_ABERTURA as rf_data_abertura,
      try_cast(RF_CODIGO_MUNICIPIO as integer) as rf_municipio, RF_UF as rf_uf, try_cast(RF_DDD_CIDADE as smallint) as rf_ddd_cidade,
      SINAL_DEIXOU_DE_SER_MEI as sinal_deixou_mei, SINAL_VIROU_MEI as sinal_virou_mei, SINAL_PORTE_MUDOU as sinal_porte_mudou,
      SINAL_CIDADE_MUDOU as sinal_cidade_mudou, algum_socio_com_obito as algum_socio_obito, RF_BASE as rf_base from {e}""")
    con.execute(f"""create or replace temp table socio as select cnpj, cpf, nome, classe_economica, coalesce(flag_obito = 1, false) as obito,
      socio_principal as principal from {s}""")
    con.execute(f"""create or replace temp table municipio as
      with usados as (select rf_municipio as codigo, any_value(rf_uf) as uf from empresa where rf_municipio is not null group by 1),
      ddd as (select cast(siafi_id as integer) as siafi, cast(ddd as smallint) as ddd from read_csv('{DDD_CSV}', header=true, all_varchar=true))
      select u.codigo, m.descricao as nome, u.uf, d.ddd
      from usados u join read_parquet('{RF}/_tabelas/municipios.parquet') m on try_cast(m.codigo as integer) = u.codigo
      left join ddd d on d.siafi = u.codigo""")
    con.execute(f"""create or replace temp table opcao as
      select 'uf' as tipo, rf_uf as valor, rf_uf as rotulo, null as uf, cast(row_number() over (order by count(*) desc) as integer) as ordem
        from linha where rf_uf is not null group by rf_uf
      union all select 'municipio', cast(codigo as varchar), nome, uf, 0 from municipio
      union all select 'ddd', cast(ddd as varchar), cast(ddd as varchar), null, ddd from (select distinct ddd from linha)
      union all select 'situacao', v, v, null, i from (select unnest(['ATIVA','BAIXADA','INAPTA','SUSPENSA','NULA']) as v,
        unnest([1,2,3,4,5]) as i) where v in (select distinct rf_situacao from linha)
      union all select 'porte', v, v, null, i from (select unnest(['MEI','MICRO','PEQUENA','DEMAIS','NAO INFORMADO']) as v,
        unnest([1,2,3,4,5]) as i) where v in (select distinct rf_porte_atual from linha)
      union all select 'classe', v, v, null, i from (select unnest(['A','B','C','D','E','X']) as v, unnest([1,2,3,4,5,6]) as i)
        where v in (select distinct classe_economica from linha)
      union all select 'operadora', v, r, null, i from (select unnest(['VIVO','CLARO','TIM','OUTRAS','SEM']) as v,
        unnest(['Vivo','Claro','TIM','Outras','Sem operadora']) as r, unnest([1,2,3,4,5]) as i)
      union all select 'cnae', lpad(cast(rf_cnae as varchar), 7, '0'), lpad(cast(rf_cnae as varchar), 7, '0') || ' — ' || d, null, 0
        from (select try_cast(RF_CNAE as integer) as rf_cnae, any_value(RF_CNAE_DESCRICAO) as d from {e} where RF_CNAE is not null group by 1)""")
    contagens = {}
    for tab, cols in COLUNAS.items():
        con.execute(f"copy (select {', '.join(cols)} from {tab}) to '{destino}/{tab}.parquet' (format parquet, compression zstd)")
        contagens[tab] = con.execute(f"select count(*) from '{destino}/{tab}.parquet'").fetchone()[0]
    contagens['linha_por_operadora'] = dict(con.execute("select coalesce(operadora, 'SEM'), count(*) from linha group by 1").fetchall())
    contagens['linha_ativa_celular_mailing'] = con.execute(
        "select count(*) from linha where rf_situacao = 'ATIVA' and not socio_obito and celular and do_mailing").fetchone()[0]
    return contagens


def ler_url():
    url = os.environ.get('APEX_DB_URL')
    arq = os.path.join(os.path.expanduser('~'), '.apex', 'db_url.txt')
    if not url and os.path.exists(arq):
        url = open(arq, encoding='utf-8-sig').read().strip()  # -sig: aceita o arquivo salvo pelo Bloco de Notas com BOM
    if not url:
        raise SystemExit('Conexao nao configurada: crie %USERPROFILE%\\.apex\\db_url.txt (ver plano, Tarefa 7).')
    return url


def limpar_erro(e, url):
    msg = f'{type(e).__name__}: {e}'
    senha = url.split('@')[0].rsplit(':', 1)[-1] if '@' in url else ''
    return msg.replace(url, '<conexao>').replace(senha, '***') if senha else msg.replace(url, '<conexao>')


def agregados_pg(pg):
    r = {t: pg.execute(f'select count(*) from mailing.{t}').fetchone()[0] for t in COLUNAS}
    r['linha_por_operadora'] = dict(pg.execute("select coalesce(operadora, 'SEM'), count(*) from mailing.linha group by 1").fetchall())
    r['linha_ativa_celular_mailing'] = pg.execute(
        "select count(*) from mailing.linha where rf_situacao = 'ATIVA' and not socio_obito and celular and do_mailing").fetchone()[0]
    return r


def enviar(con, destino=CARGA):
    import psycopg
    url = ler_url()
    locais = json.load(open(f'{destino}/contagens.json', encoding='utf-8'))
    try:
        with psycopg.connect(url, autocommit=True) as pg:
            if not pg.execute("select to_regclass('mailing.linha') is not null").fetchone()[0]:
                pg.execute(open(MIGRATION_SCHEMA, encoding='utf-8').read())
                print('schema mailing criado')
            usados = pg.execute('select count(*) from mailing.linha where vezes_extraida > 0').fetchone()[0]
            if usados:
                raise SystemExit(f'{usados} linhas ja foram extraidas: recarga que preserva o uso ainda nao existe. Nada alterado.')
            pg.execute('truncate mailing.linha, mailing.socio, mailing.empresa, mailing.opcao, mailing.municipio, '
                       'mailing.operadora_nome restart identity')
        con.execute('INSTALL postgres; LOAD postgres;')
        con.execute(f"ATTACH '{url}' AS pg (TYPE postgres)")
        for tab in ['municipio', 'operadora_nome', 'empresa', 'socio', 'linha', 'opcao']:
            t0 = time.time()
            cols = ', '.join(COLUNAS[tab])
            con.execute(f"insert into pg.mailing.{tab} ({cols}) select {cols} from read_parquet('{destino}/{tab}.parquet')")
            print(f'{tab}: enviado em {round(time.time() - t0)} s', flush=True)
        con.execute('DETACH pg')
        with psycopg.connect(url, autocommit=True) as pg:
            remotos = agregados_pg(pg)
            for k, v in locais.items():
                assert remotos[k] == v, f'{k}: local {v} x banco {remotos[k]}'
            print('conferencia ok:', {k: v for k, v in remotos.items() if k != 'linha_por_operadora'})
            pg.execute(open(MIGRATION_INDICES, encoding='utf-8').read())
            neo_ate = con.execute(f"select max(NEO_CONSULTADO_EM) from read_parquet('{SAIDA}/operadoras.parquet')").fetchone()[0]
            prefixos = con.execute(f"select any_value(TABELA_PREFIXOS) from read_parquet('{SAIDA}/operadoras.parquet')").fetchone()[0]
            pg.execute('insert into mailing.carga (receita_mes, neo_ate, tabela_prefixos, contagens) values (%s, %s, %s, %s::jsonb)',
                       (RF_MES, neo_ate, prefixos, json.dumps(remotos)))
            for t, tam in pg.execute("""select c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'mailing' and c.relkind = 'r' order by 1""").fetchall():
                print('tamanho', t, tam)
            print('banco inteiro:', pg.execute('select pg_size_pretty(pg_database_size(current_database()))').fetchone()[0])
    except SystemExit:
        raise
    except Exception as e:
        raise SystemExit('Falhou: ' + limpar_erro(e, url))


if __name__ == '__main__':
    a = argparse.ArgumentParser()
    a.add_argument('--enviar', action='store_true')
    args = a.parse_args()
    con = conectar('1500MB')
    con.execute('SET threads=2')
    if not args.enviar:
        cont = montar(con)
        json.dump(cont, open(f'{CARGA}/contagens.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(json.dumps(cont, ensure_ascii=False, indent=1))
        tam = sum(os.path.getsize(f'{CARGA}/{t}.parquet') for t in COLUNAS) / 1e6
        print(f'parquet a enviar: {tam:.0f} MB')
    else:
        enviar(con)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd $PIPE && python test_09_carga.py`
Expected: `--- RESULTADO: N passaram, 0 falharam ---`.

- [ ] **Step 6: Montar as tabelas locais (ensaio, sem enviar nada)**

Run: `cd $PIPE && python 09_carga_supabase.py`
Expected: contagens próximas de:
- `empresa` ≈ 4.769.850;
- `socio` ≈ 5.345.562;
- `linha` ≈ 16 milhões, com os 28 mil números inválidos já fora;
- `opcao` com alguns milhares de itens;
- `parquet a enviar` de algumas centenas de MB.

Nenhum dado é impresso, só contagens. Rodar sozinho: o PC tem 8 GB, e dois processos DuckDB juntos caem.

- [ ] **Step 7: Guardar o script (fora do git)**

Os arquivos ficam em `$PIPE`, que **não é repositório**. Não há commit. Registrar no `$PIPE/README.md`:

```markdown
11. **`09_carga_supabase.py`** (seção 102): monta `_carga/*.parquet` só com as colunas permitidas (LGPD) e, com `--enviar`, aplica a migration, envia ao Supabase, confere as contagens e cria os índices. A conexão fica em `%USERPROFILE%\.apex\db_url.txt` (nunca no chat). Teste: `python test_09_carga.py`.
```

---

### Task 7: Aplicar, carregar e medir no Supabase (produção — com ok do Rafael)

**Files:** nenhum arquivo novo, salvo se a medição pedir índice extra (passo 6).

**Interfaces:**
- **Consumes:** Tarefas 1 e 6.
- **Produces:** schema `mailing` carregado e conferido, `mailing.carga` preenchida e índices criados. A Tarefa 8 depende disso.

- [ ] **Step 1: Pedir o ok do Rafael**

Mensagem: "Vou criar o schema `mailing` no banco do CRM e enviar a base (~16 milhões de linhas). Não mexe em nenhuma tabela existente. Posso?" **Não seguir sem um "sim" explícito.**

- [ ] **Step 2: Rafael configura a conexão no PC (sem passar pelo chat)**

Instruir o Rafael:
1. No Supabase, abrir o projeto `apex` → **Connect** → **Session pooler** → copiar a URI.
2. Trocar `[YOUR-PASSWORD]` pela senha do banco. Se não souber a senha, redefinir em *Project Settings → Database*: o painel e as Edge Functions não usam essa senha.
3. Salvar só a URI, numa linha, em `C:\Users\acer1\.apex\db_url.txt`, criando a pasta `.apex` se precisar.

Conferir **sem ler o conteúdo**: `test -s "$USERPROFILE/.apex/db_url.txt" && echo configurado`.

- [ ] **Step 3: Enviar**

Run: `cd $PIPE && python 09_carga_supabase.py --enviar`
Expected:
- `schema mailing criado`;
- um `<tabela>: enviado em N s` por tabela;
- `conferencia ok: {...}` com as mesmas contagens do passo 6 da Tarefa 6;
- `tamanho ...` por tabela e `banco inteiro: X GB`.

Se aparecer `Falhou:`, a mensagem já vem sem a senha. Se o pooler recusar `COPY`, trocar a URI pela **Direct connection** e repetir.

- [ ] **Step 4: Conferir permissões (só leitura)**

Rodar pelo conector Supabase (`execute_sql`, projeto `mdgfboijyqfkggcrhptn`):

```sql
select has_schema_privilege('anon', 'mailing', 'usage') as anon_usa,
       has_schema_privilege('authenticated', 'mailing', 'usage') as auth_usa,
       has_table_privilege('authenticated', 'mailing.linha', 'select') as auth_le_linha;
```

Expected: `false, false, false`.

- [ ] **Step 5: Medir o desempenho (só leitura)**

Pelo conector, um de cada vez:

```sql
explain (analyze, buffers) select count(*), count(distinct cnpj), count(distinct fone)
  from mailing.linha l where l.rf_situacao = any(array['ATIVA']) and not l.socio_obito and l.celular and l.do_mailing;
```

```sql
explain (analyze, buffers) select count(*) from mailing.linha l
  where l.rf_situacao = any(array['ATIVA']) and not l.socio_obito and l.celular and l.do_mailing
    and l.operadora = any(array['VIVO']) and l.ddd = any(array[11]::smallint[]);
```

```sql
explain (analyze, buffers) select l.id from mailing.linha l
  where l.rf_situacao = 'ATIVA' and not l.socio_obito and l.celular and l.do_mailing
  order by l.ultima_extracao asc nulls first, l.sorteio limit 100000;
```

**Metas:** as contagens com `Execution Time` ≤ 10.000 ms e a seleção de 100 mil ≤ 60.000 ms. Anotar os três tempos.

- [ ] **Step 6: Se alguma meta falhar**

Parar e reportar ao Rafael com os tempos. O próximo passo da spec (seção 9) é, nesta ordem:
1. índice que o plano do `explain` indicar, numa nova migration `20261021090200_mailing_indices_extra.sql` com o rollback correspondente;
2. contagens pré-calculadas (abordagem C, que precisa de um plano próprio);
3. servidor Small.

Não criar nada sem o ok.

- [ ] **Step 7: Commit (só se houve migration extra)**

```bash
cd $WT && git add supabase/migrations/20261021090200_mailing_indices_extra.sql supabase/rollback/20261021090200_mailing_indices_extra_rollback.sql
git commit -m "perf(mailing): índice extra medido na carga (seção 102)"
```

---

### Task 8: Edge Function `mailing-api` — entrada Deno, deploy e testes reais (produção — com ok)

**Files:**
- Create: `supabase/functions/mailing-api/index.ts`

**Interfaces:**
- **Consumes:**
  - de `api.ts`: `processar`, `DepsApi`, `Usuario`, `LinhaExport`, `RegistroExtracao`;
  - de `consulta.ts`: os SQLs;
  - o schema carregado na Tarefa 7.
- **Produces:**
  - endpoint `POST /functions/v1/mailing-api`, com `verify_jwt = true`, corpo `{ acao, ... }` e as respostas da Tarefa 3.
  - O painel (Tarefa 5) chama via `sb.functions.invoke('mailing-api', ...)`.

- [ ] **Step 1: Write the entry point**

Criar `supabase/functions/mailing-api/index.ts`:

```ts
// Edge Function: mailing-api (REGRAS_NEGOCIO.md seção 102) — opções, contagem, extração no layout do ProContact e histórico.
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (seção 5). Publicar com verify_jwt = true.
// Conexão direta ao banco (SUPABASE_DB_URL, disponível em toda Edge Function): o PostgREST corta em 8 s e 1.000 linhas.
// Log: só status e código de erro — nunca CPF, nome, telefone ou filtros.
import postgres from "npm:postgres@3.4.5";
import { processar } from "./api.ts";
import type { DepsApi, LinhaExport, RegistroExtracao, Usuario } from "./api.ts";
import {
  sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, SQL_REGISTRAR, SQL_OPCOES, SQL_CARGA, SQL_HISTORICO, SQL_USUARIO,
} from "./consulta.ts";
import type { SqlParte } from "./consulta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// verify_jwt = true: o gateway já validou a assinatura; aqui só lemos o "sub" (id do usuário).
function subDoJwt(auth: string | null): string | null {
  const partes = (auth ?? "").replace(/^Bearer\s+/i, "").split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function criarDeps(sql: postgres.Sql): DepsApi {
  const p = (w: SqlParte) => w.params as never[];
  return {
    async opcoes() {
      const [opcoes, carga] = await Promise.all([sql.unsafe(SQL_OPCOES), sql.unsafe(SQL_CARGA)]);
      return { opcoes: [...opcoes], carga: carga[0] ?? null };
    },
    async historico() {
      return [...(await sql.unsafe(SQL_HISTORICO))];
    },
    async contar(w) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '30s'");
        const [t] = await tx.unsafe(sqlTotais(w), p(w));
        const ops = await tx.unsafe(sqlPorOperadora(w), p(w));
        return {
          linhas: Number(t.linhas), empresas: Number(t.empresas), telefones: Number(t.telefones),
          por_operadora: ops.map((o) => ({ operadora: String(o.operadora), linhas: Number(o.linhas) })),
        };
      });
    },
    async extrair(w, quantidade, reg: RegistroExtracao) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '120s'");
        const [t] = await tx.unsafe(sqlTotalFiltro(w), p(w));
        const linhas = [...(await tx.unsafe(sqlExtrair(w), [...w.params, quantidade] as never[]))] as unknown as LinhaExport[];
        if (linhas.length) { // filtro vazio não vira registro
          await tx.unsafe(SQL_REGISTRAR, [reg.user_id, reg.username, reg.role, reg.operacao, reg.nome_carga,
            JSON.stringify(reg.filtros), Number(t.n), reg.quantidade_pedida, linhas.length] as never[]);
        }
        return { linhas, total_no_filtro: Number(t.n) };
      });
    },
    hojeISO: hojeSP,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const sub = subDoJwt(req.headers.get("Authorization"));
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
  try {
    let usuario: Usuario | null = null;
    if (sub) {
      const [perfil] = await sql.unsafe(SQL_USUARIO, [sub]);
      if (perfil) usuario = { id: sub, role: String(perfil.role), operacao: perfil.operacao ?? null, username: perfil.username ?? null };
    }
    const corpo = await req.json().catch(() => null);
    const r = await processar(corpo, usuario, criarDeps(sql));
    if (r.status >= 500) console.error("mailing-api", r.status);
    return json(r.body, r.status);
  } catch (e) {
    console.error("mailing-api falhou", (e as { code?: string })?.code ?? "sem código");
    return json({ erro: "Falha ao consultar a base de mailing." }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
```

- [ ] **Step 2: Rodar os testes puros de novo**

Run: `cd $WT/supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts`
Expected: todos `ok`, com `# fail 0`.

- [ ] **Step 3: Commit**

```bash
cd $WT && git add supabase/functions/mailing-api/index.ts
git commit -m "feat(mailing): entrada Deno da mailing-api com conexão direta e limites de tempo (seção 102)"
```

- [ ] **Step 4: Pedir o ok e publicar a função**

1. Pedir o ok: "Vou publicar a Edge Function `mailing-api` (só admin/supervisor conseguem usar). Posso?"
2. Com o ok, publicar pelo conector Supabase (`deploy_edge_function`):
   - projeto `mdgfboijyqfkggcrhptn`;
   - nome `mailing-api`;
   - `verify_jwt: true`;
   - arquivos `index.ts`, `api.ts` e `consulta.ts`, com o conteúdo exato do worktree.
3. Expected: versão 1 ativa (`list_edge_functions` mostra `mailing-api`, status `ACTIVE`).

- [ ] **Step 5: Teste real pelo painel local (Rafael, logado como admin)**

1. Gerar o painel local: `cd $WT && python build_painel.py`.
2. Abrir o `painel_clientes_apex.html` gerado no navegador, sem publicar, e entrar como admin.
3. Na aba **Mailing**, conferir:
   - as listas dos filtros aparecem e o status mostra "Receita de 2026-09 · operadora do NEO até …";
   - **Contar** com o padrão, depois com "Vivo + DDD 11": os números são coerentes com os da Tarefa 7;
   - **Exportar 100 linhas** com a carga `TESTE-PAINEL`: o arquivo baixa como `TESTE-PAINEL_<data>.csv`.
4. Abrir o arquivo no Bloco de Notas e conferir que o cabeçalho é exatamente `nome;descricao;...;integra2` e que os acentos aparecem certos.
5. Confirmar pelo conector (só leitura):

```sql
select count(*) filter (where vezes_extraida > 0) as marcadas, (select count(*) from mailing.extracao) as registros
  from mailing.linha;
```

Expected: `marcadas = 100`, `registros = 1`.

- [ ] **Step 6: Teste de 100 mil linhas (Review Focus 1)**

Exportar com a quantidade `100000` e a carga `TESTE-100MIL`.

Expected: o arquivo baixa. Conferir o número de linhas sem abrir os dados:

```bash
wc -l "<caminho do arquivo baixado>"   # Expected: 100001
```

Se a função ou o navegador falhar com 100 mil: reportar. A correção (paginar a extração em partes) é uma mudança de desenho e precisa de ok.

- [ ] **Step 7: Duas extrações ao mesmo tempo (Review Focus 2)**

Abrir o painel local em duas abas, com o mesmo filtro, quantidade `1000` e cargas `TESTE-A` e `TESTE-B`, e clicar **Exportar** nas duas quase juntas. Conferir:

```sql
select count(*) as repetidas from mailing.linha where vezes_extraida > 1;
```

Expected: `0`.

- [ ] **Step 8: Permissão real**

1. Entrar como um **consultor**: a aba Mailing não aparece.
2. No console do navegador desse consultor, rodar:

```js
await sb.functions.invoke('mailing-api', { body: { acao: 'opcoes' } })
```

Expected: `error` com status 403.

- [ ] **Step 9: Zerar o uso dos testes (com ok)**

Pedir o ok e rodar pelo conector:

```sql
begin;
update mailing.linha set ultima_extracao = null, vezes_extraida = 0 where vezes_extraida > 0;
delete from mailing.extracao where nome_carga like 'TESTE-%';
commit;
```

Expected: nenhuma linha marcada e nenhum registro de teste.

---

### Task 9: Aceite no ProContact, REGRAS_NEGOCIO, publicação e limpeza local (produção — com ok)

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova seção 102 no fim)

**Interfaces:**
- **Consumes:** tudo o que veio antes.
- **Produces:** aba no ar, seção 102 registrada e cópias locais apagadas.

- [ ] **Step 1: Aceite final, importar no ProContact (condição da spec)**

O Rafael exporta **~100 linhas** pelo painel local, com a carga `ACEITE-PROCONTACT`, e **importa numa campanha de teste do ProContact**.

Expected: a importação entra **sem nenhum ajuste**: nomes, documentos, telefone e `campo1–3` nas colunas certas, com acentos corretos. Se o ProContact recusar, anotar a mensagem exata e parar. Ajustar o formato exige voltar à Tarefa 4.

Depois, zerar o uso dessa extração como no passo 9 da Tarefa 8, com `nome_carga like 'ACEITE-%'`.

- [ ] **Step 2: Registrar no REGRAS_NEGOCIO.md**

Antes, rodar `cd $WT && git fetch oficial && git log oficial/main --oneline -3` e conferir que a 102 continua livre. Se não estiver, usar o próximo número livre e trocar "102" em todos os arquivos desta frente.

Acrescentar ao fim de `REGRAS_NEGOCIO.md`:

```markdown
## 102. Base de Mailing — aba "Mailing" com exportação no layout do ProContact (DD/10/2026)

- **O quê:** a base comprada de empresas, sócios e telefones agora pode ser filtrada, contada e exportada direto no painel, no layout de importação do ProContact. Já vem enriquecida com a Receita (set/2026) e a operadora do NEO (out/2026). Só **admin e supervisor**, de qualquer operação.
- **Onde fica:**
  - schema `mailing` no projeto `apex`, fechado à API: tabelas `empresa`, `socio`, `linha`, `extracao`, `opcao`, `carga`, `municipio` e `operadora_nome`;
  - acesso só pela Edge Function `mailing-api`, com conexão direta, 30 s para contar e 120 s para extrair.
- **Regras:**
  - até 100 mil linhas por extração, em quantidade escolhida;
  - saem primeiro os nunca extraídos, depois os mais antigos (sorteio fixo entre iguais);
  - "já extraído" só registra: pode repetir;
  - toda extração fica em `mailing.extracao` (quem, quando, filtros, carga e quantidade);
  - filtro padrão: ATIVA, sem óbito, celular, só mailing;
  - a flag Procon não impede ligar (é só filtro).
- **Arquivo:**
  - CSV com `;`, Windows-1252 e CRLF, 20 colunas: `nome` = sócio, `descricao` = razão social, `documento1` = CPF, `documento2` = CNPJ, `fone1`, `campo1` = operadora (NEO), `campo2` = porte (Receita), `campo3` = cidade (Receita);
  - nome do arquivo: `<CARGA>_<data>.csv`.
- **LGPD:** não sobem nome da mãe, nascimento, renda, scores, Bolsa Família, FGTS, e-mails nem o endereço do sócio. A carga é feita pelo pipeline local, fora do repositório, e as cópias locais foram apagadas depois da conferência.
- **Spec e plano:** `docs/superpowers/specs/2026-10-20-base-mailing-design.md` e `docs/superpowers/plans/2026-10-20-base-mailing.md`.
- **Medição (Tarefa 7):** contar padrão = X s; Vivo + DDD 11 = X s; seleção de 100 mil = X s; tamanho do schema = X GB.
- **Publicado:** DD/10/2026 HH:MM SP, MD5 `xxxxxxxx`, oficial `xxxxxxx`.
```

Preencher os `X` com os números reais da Tarefa 7 e a data e o MD5 no passo 4.

- [ ] **Step 3: Juntar com a oficial e rodar tudo**

```bash
cd $WT && git fetch oficial && git merge oficial/main
```

Se houver conflito em `_template.html`, juntar as duas versões (nunca descartar a da oficial). Se o conflito for na linha base64 do dashboard: `python dashboard_tpl.py extrair` → `git merge-file` → `empacotar`.

Run: `cd $WT && bash run_tests.sh && cd supabase/functions/mailing-api && node --test consulta.test.ts api.test.ts`
Expected: nenhuma falha nova (só as conhecidas) e `# fail 0`.

```bash
cd $WT && git add REGRAS_NEGOCIO.md && git commit -m "docs(regras): seção 102 Base de Mailing"
```

- [ ] **Step 4: Publicar o painel (com ok, procedimento padrão)**

Pedir o ok: "Posso publicar o painel com a aba Mailing?" Com o ok, seguir a memória `apex-publicacao-painel`:
1. `python build_painel.py`;
2. baixar o painel no ar e comparar: se houver algo no ar que o repositório não tem, **juntar, nunca sobrescrever**;
3. fazer backup no servidor (`~/deploy_backups/painel_clientes_apex_<data>_antes_mailing.html`);
4. enviar por `ssh hostinger`;
5. conferir o MD5;
6. preencher a data e o MD5 na seção 102 e fazer commit;
7. fazer `git fetch oficial` e `push` para `oficial/main`, sem force;
8. rodar `vigia/vigia_painel.ps1 -Aceitar`.

- [ ] **Step 5: Apagar as cópias locais da base (com ok)**

Pedir o ok: "A base está no banco e conferida. Posso apagar do PC as planilhas e todas as cópias?" Com o ok, apagar:
- `Downloads\mailingdados\*.xlsx` e `*.csv` (inclusive o modelo do ProContact, que tem dados reais);
- `Downloads\mailingdados\_parquet`, `_base`, `_saida`, `_carga`, `_neo` e `exportacoes`;
- os CSVs de teste baixados nas Tarefas 8 e 9;
- a lixeira, esvaziada no fim.

Ficam: `Documents\apex-mailing` (scripts e documentos, sem dados), `Downloads\receita_cnpj` (público) e `%USERPROFILE%\.apex\db_url.txt`. Sobre esse último, perguntar ao Rafael se mantém para recargas futuras ou apaga.

Conferir:

```bash
ls "C:/Users/acer1/Downloads/mailingdados" 2>/dev/null | wc -l   # Expected: 0 (ou a pasta não existe)
```

Atualizar a memória `apex-mailing-base`: cópias apagadas, a aba no ar e a seção 102.

---

## Self-review

**1. Cobertura da spec:**

| Seção da spec | Onde está no plano |
|---|---|
| 4.1–4.5 (tabelas) | Tarefa 1 |
| 5 (Edge Function e ações) | Tarefas 2, 3 e 8 |
| 6 (aba e filtros) | Tarefas 4 e 5 |
| 7 (carga) | Tarefas 6 e 7 |
| 8 (segurança) | Tarefas 1, 3, 7.4 e 8.8 |
| 9 (desempenho) | Tarefa 7.5–7.6 |
| 10 (testes) | todas |
| 11 (riscos) | Review Focus e Tarefas 7.6, 8.6 e 9.1 |
| 12 (entrega) | ordem das tarefas |

**Desvio de implementação (mesma intenção da spec):**
- A cidade (`rf_cidade`) virou `rf_municipio` (código), com o nome em `mailing.municipio`, para a linha ficar menor. O `campo3` continua sendo a cidade pela Receita.
- A unicidade de `cnpj + fone` é garantida pela carga (`assert`), não por índice, para economizar ~700 MB.

**2. Placeholders:** os únicos valores a preencher são os da seção 102 (medição, data e MD5). Eles dependem da execução e estão marcados para os passos 7.5 e 9.4.

**3. Consistência de nomes:**
- `COLUNAS_EXPORT` (`api.ts`) = colunas lidas por `mbMontarCsv` (painel) = `select` de `sqlExtrair` (nome, descricao, documento1, documento2, fone1, campo1, campo2, campo3).
- `Filtros` (`consulta.ts`) = chaves de `mbLerFiltros` (painel).
- `COLUNAS` (`09_carga_supabase.py`) = tabelas da migration, o que o `test_09_carga.py` confere.

**Verificação do próprio plano (20/10):** todos os blocos de código foram extraídos para uma pasta temporária e executados.
- SQL: 47 verificações.
- `consulta`/`api`: 26 testes.
- `test_09_carga.py`: 18 verificações, com dados fictícios.
- `test_mailing.js` sobre uma cópia do `_template.html` com as inserções: 56 verificações.
- Suíte inteira: nenhuma falha nova.

Dois ajustes vieram dessa execução:
- o prefixo `ml` já é da aba de Leads/Mailing (`mlEstado` na linha ~10087), então esta aba usa `mb`;
- a ordem fixa do menu em `test_reorganizacao_abas.js` ganhou `mailing`.

**4. Review Focus:** os 5 itens têm passo de teste:
1. → Tarefa 8, passo 6;
2. → Tarefa 8, passo 7;
3. → Tarefas 4 e 9.1;
4. → Tarefas 3, 5 e 8 (registro só se entregou);
5. → Tarefas 3 e 5.
