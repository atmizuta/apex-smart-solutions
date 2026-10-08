# CRM Fibra — Card de Lead + Construtor de Proposta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reestruturar `/leads/[cnpj]` em três abas (Cliente, Linhas, Proposta) e entregar o construtor de proposta por linha, apoiado num catálogo de planos Claro-empresas editável pelo admin.

**Architecture:** A rota existente `/leads/[cnpj]` vira uma página com abas (shadcn `Tabs`, conteúdo sempre montado). Três tabelas novas no schema `crm_fibra` (`catalogo_planos`, `propostas`, `proposta_itens`) e duas colunas novas no fim da view `leads_segmentados`. Toda a lógica testável vive em funções puras / camada `lib/*` com fakes do Supabase; os componentes React ficam finos. Admin ganha `/catalogo` para editar preço/observação e ativar/desativar planos.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Tailwind 3 + shadcn/ui (new-york), Supabase JS (service role, schema `crm_fibra`), Vitest (ambiente node, sem DOM), `@radix-ui/react-tabs` (única dependência nova).

**Spec:** `docs/superpowers/specs/2026-10-01-crm-fibra-lead-card-design.md` (já alinhado com as correções abaixo).

**Correções do spec aplicadas junto com este plano** (achadas ao ler o código real):
1. `linhas_voz`/`valor_contrato` entram **no fim** da lista de colunas da view — o `create or replace view` do Postgres rejeita colunas novas no meio.
2. "a ativa destacada" → a proposta **mais recente** ganha o selo "Mais recente" (propostas são imutáveis; não existe "ativa").
3. O projeto não tem infra de teste de DOM: a lógica do construtor vive em `lib/proposta-rascunho.ts` (funções puras) e o componente só a liga ao estado.
4. Qualquer consultor ativo pode salvar proposta para qualquer lead (sem exigir ser o dono); o criador fica em `consultor_id`.
5. Salvar = cabeçalho + itens com limpeza compensatória se os itens falharem (cliente Supabase não tem transação multi-tabela).

## Setup (o executor faz antes da Task 1)

- Worktree: `.worktrees/crm-fibra-fundacao`, branch `feature/crm-fibra-lead-card` (já criada; spec commitado). Comandos `git` rodam na raiz do worktree; comandos `npm`/`npx` rodam em `crm-fibra/`.
- O worktree foi recriado e **não tem `node_modules`**: `cd crm-fibra && npm ci`.
- Baseline: `npm test` deve mostrar `14 passed (14)` arquivos e `87 passed (87)` testes antes de qualquer mudança.
- `oficial/main` andou ~135 commits (outras sessões), **nenhum em `crm-fibra/`** (verificado com `git diff --stat main oficial/main -- crm-fibra`, vazio). A integração com `oficial/main` acontece no fim, em `finishing-a-development-branch` (`git fetch oficial` imediatamente antes do merge/push).

## Global Constraints

- Schema `crm_fibra` do mesmo projeto Supabase "apex" (`mdgfboijyqfkggcrhptn`). **É produção:** nenhuma escrita/DDL lá sem ok explícito do usuário na conversa — a Task 11 tem uma parada obrigatória.
- Tabelas novas com RLS ligado e **zero policies** para `anon`/`authenticated`; acesso só pelo cliente service-role do servidor (mesmo padrão de `consultores`, `atribuicoes`, `mensagens`).
- `catalogo_planos.categoria` ∈ `convergente | pos_nacional | pos_regional | banda_larga | adicional`.
- Catálogo inicial = **exatamente 22 itens** (6 convergente, 5 pos_nacional, 1 pos_regional, 9 banda_larga, 1 adicional). O "Pós 15GB regional — R$44,90" está **excluído** (pedido explícito do usuário).
- Itens de catálogo **nunca** são apagados fisicamente — só desativados. Só `valor` e `observacao` são editáveis.
- Propostas são imutáveis depois de salvas e sempre linhas novas (nunca update/upsert em `propostas`). `proposta_itens` guarda a própria cópia de `descricao` e `valor`.
- Nenhuma aba placeholder de Abordagem (IA) ou Exportar — sub-projetos 3 e 5.
- Gate de admin = `papel === "admin"` (mesmo padrão de `/consultores`).
- Copy em português do Brasil; moeda sempre via `formatarBRL`; datas em horário de Brasília via `formatarDataHora`.
- Stack visual = Tailwind + shadcn já instalados, tokens HSL da marca Apex. Única dependência nova: `@radix-ui/react-tabs`.
- Todo commit termina com a linha `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (mensagem via heredoc).
- Nunca `--no-verify`, nunca `--force`. Nada de segredo ou dado real de cliente no repositório.

## Review Focus

Entradas/condições que o spec implica mas que os testes "óbvios" não exercitariam, mais prováveis primeiro. Cada uma tem um teste fixado na task dona do código:

1. **CNPJ sem nenhuma proposta ainda** → a aba abre com o construtor pronto, sem erro; a camada de dados devolve `[]` sem nem consultar itens. *(Task 4: "retorna lista vazia sem consultar itens quando o CNPJ não tem proposta")*
2. **Categoria do catálogo sem nenhum item ativo** → agrupar devolve sempre as 5 categorias (vazias incluídas) em vez de quebrar. *(Task 3: "devolve sempre as 5 categorias, na ordem do catálogo, mesmo vazias")*
3. **Item com preço escalonado** ("por 3 meses, depois R$99,90") → a descrição salva na proposta carrega a observação completa, não só o número. *(Task 5: "a descrição da linha inclui a observação do plano")*
4. **Dois consultores salvando para o mesmo CNPJ** → cada um cria sua própria proposta; salvar nunca atualiza/sobrescreve linha de `propostas`, e o criador vem da sessão, não do cliente. *(Task 4: "só insere — nunca atualiza propostas existentes"; Task 6: "usa o consultor da sessão e permite salvar em lead de outro consultor")*
5. **Admin edita o preço de um item depois que existem propostas com ele** → a proposta antiga não muda: `criarProposta` copia descrição/valor do input e nunca lê o catálogo; `atualizarPlano` só toca `catalogo_planos`. *(Task 4: "não lê o catálogo e grava a própria cópia"; Task 3: "atualiza só valor e observação")*

Além dessas, ficam pinados: formatos de valor digitados ("149,90", "1.299,90", "R$ 89,99"), soma em centavos (sem erro de ponto flutuante) e a virada de dia no fuso de Brasília.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `crm-fibra/db/schema.sql` (modificar) | tabelas novas, seed do catálogo, 2 colunas novas no fim da view |
| `crm-fibra/db/rollback-lead-card.sql` (criar) | desfaz tudo isso |
| `crm-fibra/db/schema.test.ts` (criar) | guarda estática do SQL (22 itens, ordem das colunas, RLS) |
| `crm-fibra/lib/leads.ts` (modificar) | `linhasVoz`, `valorContrato` no lead |
| `crm-fibra/lib/formato.ts` (criar) | `formatarBRL`, `parseValorBRL`, `formatarDataHora` |
| `crm-fibra/lib/catalogo.ts` (criar) | leitura/escrita do catálogo + agrupamento |
| `crm-fibra/lib/propostas.ts` (criar) | criar/listar propostas, soma em centavos, validação |
| `crm-fibra/lib/proposta-rascunho.ts` (criar) | lógica pura do construtor (estado do rascunho) |
| `crm-fibra/app/(protected)/leads/[cnpj]/actions.ts` (modificar) | `salvarPropostaAction` |
| `crm-fibra/app/(protected)/catalogo/{actions,page,plano-row,novo-plano-form}.ts(x)` (criar) | admin do catálogo |
| `crm-fibra/components/ui/tabs.tsx` (criar) | primitivo de abas (shadcn) |
| `crm-fibra/app/(protected)/leads/[cnpj]/{page,aba-cliente,aba-linhas,aba-proposta,proposta-builder,propostas-salvas}.tsx` | página em abas |
| `crm-fibra/components/app-sidebar.tsx` (modificar) | item "Catálogo" no grupo Administração |
| `crm-fibra/README.md` (modificar) | migração + checklist manual |

---

### Task 1: Schema — catálogo, propostas, colunas novas na view, seed e rollback

**Files:**
- Modify: `crm-fibra/db/schema.sql` (view em `:60-98`; nova seção no fim do arquivo)
- Create: `crm-fibra/db/rollback-lead-card.sql`
- Test: `crm-fibra/db/schema.test.ts`

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: tabelas `crm_fibra.catalogo_planos(id, categoria, nome, valor, observacao, ativo, criado_em)`, `crm_fibra.propostas(id, cnpj_digits, consultor_id, criado_em)`, `crm_fibra.proposta_itens(id, proposta_id, catalogo_plano_id, descricao, valor, ordem)`; view `crm_fibra.leads_segmentados` com `linhas_voz` e `valor_contrato` como últimas colunas. As Tasks 2–4 e 10 assumem esses nomes exatos.

- [ ] **Step 0: Instalar dependências e conferir o baseline**

Run (em `crm-fibra/`): `npm ci && npm test`
Expected: instalação sem erro; `Test Files 14 passed (14)`, `Tests 87 passed (87)`.

- [ ] **Step 1: Escrever o teste que falha**

Create `crm-fibra/db/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function ler(arquivo: string): string {
  return readFileSync(fileURLToPath(new URL(`./${arquivo}`, import.meta.url)), "utf8");
}

function secaoDaView(sql: string): string {
  const inicio = sql.indexOf("view crm_fibra.leads_segmentados as");
  const fim = sql.indexOf("from public.clientes c", inicio);
  return sql.slice(inicio, fim);
}

function linhasDoSeed(sql: string): string[] {
  const inicio = sql.indexOf("insert into crm_fibra.catalogo_planos");
  const fim = sql.indexOf("on conflict (categoria, nome) do nothing", inicio);
  return sql
    .slice(inicio, fim)
    .split("\n")
    .filter((linha) => /^\s*\('/.test(linha));
}

describe("db/schema.sql — card de lead e propostas", () => {
  it("cria as três tabelas novas", () => {
    const sql = ler("schema.sql");
    expect(sql).toContain("create table if not exists crm_fibra.catalogo_planos");
    expect(sql).toContain("create table if not exists crm_fibra.propostas");
    expect(sql).toContain("create table if not exists crm_fibra.proposta_itens");
  });

  it("liga RLS nas três tabelas novas e não cria nenhuma policy (só o service role acessa)", () => {
    const sql = ler("schema.sql");
    for (const tabela of ["catalogo_planos", "propostas", "proposta_itens"]) {
      expect(sql).toContain(`alter table crm_fibra.${tabela} enable row level security;`);
    }
    expect(sql).not.toMatch(/create policy/i);
  });

  it("garante nome único por categoria, que é a base do seed idempotente", () => {
    expect(ler("schema.sql")).toContain(
      "create unique index if not exists catalogo_planos_categoria_nome_key on crm_fibra.catalogo_planos (categoria, nome);"
    );
  });

  it("semeia exatamente 22 planos, na distribuição combinada por categoria", () => {
    const linhas = linhasDoSeed(ler("schema.sql"));
    const por = (categoria: string) => linhas.filter((l) => l.includes(`('${categoria}'`)).length;
    expect(linhas).toHaveLength(22);
    expect(por("convergente")).toBe(6);
    expect(por("pos_nacional")).toBe(5);
    expect(por("pos_regional")).toBe(1);
    expect(por("banda_larga")).toBe(9);
    expect(por("adicional")).toBe(1);
  });

  it("não semeia o Pós 15GB regional de R$44,90 (excluído a pedido do usuário)", () => {
    const seed = linhasDoSeed(ler("schema.sql")).join("\n");
    expect(seed).not.toMatch(/15GB/);
    expect(seed).not.toContain("44.90");
  });

  it("semeia o Claro Monitor a R$5,00", () => {
    const seed = linhasDoSeed(ler("schema.sql")).join("\n");
    expect(seed).toContain("('adicional', 'Claro Monitor', 5.00, null)");
  });

  it("expõe linhas_voz e valor_contrato no FIM da view (create or replace view não aceita colunas no meio)", () => {
    const view = secaoDaView(ler("schema.sql"));
    const ultimo = view.indexOf("a.ultimo_contato_em");
    const voz = view.indexOf("c.linhas_voz");
    const valor = view.indexOf("c.valor_contrato");
    expect(ultimo).toBeGreaterThan(-1);
    expect(voz).toBeGreaterThan(ultimo);
    expect(valor).toBeGreaterThan(voz);
  });

  it("deixa catalogo_plano_id nulo em proposta_itens (oferta avulsa)", () => {
    const sql = ler("schema.sql");
    const inicio = sql.indexOf("create table if not exists crm_fibra.proposta_itens");
    const bloco = sql.slice(inicio, sql.indexOf(");", inicio));
    const linha = bloco.split("\n").find((l) => l.includes("catalogo_plano_id")) ?? "";
    expect(linha).toContain("references crm_fibra.catalogo_planos(id)");
    expect(linha).not.toContain("not null");
  });
});

describe("db/rollback-lead-card.sql", () => {
  it("derruba as três tabelas novas", () => {
    const sql = ler("rollback-lead-card.sql");
    expect(sql).toContain("drop table if exists crm_fibra.proposta_itens;");
    expect(sql).toContain("drop table if exists crm_fibra.propostas;");
    expect(sql).toContain("drop table if exists crm_fibra.catalogo_planos;");
  });

  it("recria a view sem as colunas novas e mantendo a regra de renovação atual", () => {
    const view = secaoDaView(ler("rollback-lead-card.sql"));
    expect(view).not.toContain("linhas_voz");
    expect(view).not.toContain("valor_contrato");
    expect(view).toContain("c.tempo_contrato_voz > 15");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run db/schema.test.ts`
Expected: FAIL — os testes de `schema.sql` falham por asserção (tabelas/seed/colunas ausentes) e os de rollback por `ENOENT ... rollback-lead-card.sql`.

- [ ] **Step 3: Implementar — editar a view em `schema.sql`**

Em `crm-fibra/db/schema.sql`, trocar (dentro do `create or replace view crm_fibra.leads_segmentados`):

```sql
  a.atribuido_em,
  a.ultimo_contato_em
from public.clientes c
```

por:

```sql
  a.atribuido_em,
  a.ultimo_contato_em,
  -- Appended at the end on purpose: `create or replace view` only accepts
  -- new columns after the existing ones (same names/order/types before).
  c.linhas_voz,
  c.valor_contrato
from public.clientes c
```

- [ ] **Step 4: Implementar — acrescentar a nova seção no fim de `schema.sql`**

Acrescentar ao final do arquivo (depois do último `grant select on crm_fibra.leads_segmentados to service_role;`):

```sql

-- Lead card + proposal builder (sub-project 2) — idempotent, safe to run again.

create table if not exists crm_fibra.catalogo_planos (
  id uuid primary key default gen_random_uuid(),
  categoria text not null
    check (categoria in ('convergente', 'pos_nacional', 'pos_regional', 'banda_larga', 'adicional')),
  nome text not null,
  valor numeric not null,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create unique index if not exists catalogo_planos_categoria_nome_key on crm_fibra.catalogo_planos (categoria, nome);

create table if not exists crm_fibra.propostas (
  id uuid primary key default gen_random_uuid(),
  cnpj_digits text not null,
  consultor_id uuid not null references crm_fibra.consultores(id),
  criado_em timestamptz not null default now()
);

create index if not exists idx_propostas_cnpj on crm_fibra.propostas(cnpj_digits);

create table if not exists crm_fibra.proposta_itens (
  id uuid primary key default gen_random_uuid(),
  proposta_id uuid not null references crm_fibra.propostas(id) on delete cascade,
  catalogo_plano_id uuid references crm_fibra.catalogo_planos(id),
  descricao text not null,
  valor numeric not null,
  ordem integer not null default 0
);

create index if not exists idx_proposta_itens_proposta on crm_fibra.proposta_itens(proposta_id);

alter table crm_fibra.catalogo_planos enable row level security;
alter table crm_fibra.propostas enable row level security;
alter table crm_fibra.proposta_itens enable row level security;

-- `on conflict do nothing` keeps any price an admin edited later: re-running
-- this file never overwrites the catalog.
insert into crm_fibra.catalogo_planos (categoria, nome, valor, observacao) values
  ('convergente', 'Fibra 1 Giga + Pós 65GB (regional RSC/RSI/RRS/RRE/RCO/RNO)', 194.89, null),
  ('convergente', 'Fibra 1 Giga + Pós 80GB (regional RMG/RPS/RBS/RNE + DDDs 55,27,62,64,98,19)', 194.89, null),
  ('convergente', 'Fibra 800 Mega + Pós 62GB', 149.89, null),
  ('convergente', 'Fibra 800 Mega + Pós 90GB', 164.89, null),
  ('convergente', 'Fibra 600 Mega + Pós 71GB (Grupos Padrão Especial/Especial+)', 99.89, 'Por 3 meses, depois R$129,89 (boleto) / R$124,89 (DCC)'),
  ('convergente', 'Fibra 600 Mega + Pós 71GB (Mercados em Desenvolvimento/Redes Neutras)', 94.89, 'Por 6 meses, depois R$124,89 (boleto) / R$119,89 (DCC)'),
  ('pos_nacional', 'Pós 12GB', 39.99, 'por linha'),
  ('pos_nacional', 'Pós 40GB', 54.99, 'por linha'),
  ('pos_nacional', 'Pós 70GB', 74.99, 'por linha'),
  ('pos_nacional', 'Pós 100GB', 89.99, 'por linha'),
  ('pos_nacional', 'Pós 150GB', 149.99, 'por linha'),
  ('pos_regional', 'Pós 30GB (regional RMG/RPS/RBS/RRS/RRE/RCO/RNO + DDDs 55,27,62,64,98,19)', 44.99, 'por linha'),
  ('banda_larga', '400 Mega (G1 Padrão)', 79.90, 'single/combinado/convergência'),
  ('banda_larga', '400 Mega (G4 Especial+)', 84.90, 'single'),
  ('banda_larga', '600 Mega (G1 Padrão)', 59.90, 'Por 3 meses, depois R$99,90'),
  ('banda_larga', '600 Mega (G3A Especial+ com oferta)', 59.90, 'Por 3 meses, depois R$89,90'),
  ('banda_larga', '600 Mega (G4, single)', 64.90, 'Por 6 meses, depois R$104,90'),
  ('banda_larga', '600 Mega (G4, combinado/convergência)', 54.90, 'Por 6 meses, depois R$84,90'),
  ('banda_larga', '800 Mega (todos os grupos)', 109.90, 'single/combinado/convergência'),
  ('banda_larga', '1 Giga (single/combinado)', 199.90, null),
  ('banda_larga', '1 Giga (convergência)', 149.90, null),
  ('adicional', 'Claro Monitor', 5.00, null)
on conflict (categoria, nome) do nothing;

-- Re-grant after the new tables exist (see the grants note above: default
-- privileges only cover objects created by the same role).
grant usage on schema crm_fibra to service_role;
grant select, insert, update, delete on all tables in schema crm_fibra to service_role;
```

- [ ] **Step 5: Implementar — criar o rollback**

Create `crm-fibra/db/rollback-lead-card.sql` (a view abaixo é a definição anterior a esta entrega, copiada do `schema.sql` sem as duas colunas novas):

```sql
-- crm-fibra/db/rollback-lead-card.sql
-- Desfaz a entrega "card de lead + proposta": apaga as três tabelas novas
-- (e, com elas, todas as propostas salvas) e devolve a view ao formato anterior.
-- `create or replace view` não consegue remover colunas, por isso drop + create.

drop table if exists crm_fibra.proposta_itens;
drop table if exists crm_fibra.propostas;
drop table if exists crm_fibra.catalogo_planos;

drop view if exists crm_fibra.leads_segmentados;

create view crm_fibra.leads_segmentados as
select
  c.cnpj_digits,
  c.razao_social,
  c.cidade,
  c.ddd,
  c.tel1,
  c.tel2,
  c.telefone_contato,
  c.email,
  c.arpu,
  c.apto_renovacao,
  c.cep_cabeado,
  c.linhas_fixas,
  case
    when c.cep_cabeado = 'CEP Cabeado' and coalesce(c.linhas_fixas, 0) = 0
      then 'fibra_candidato'
    else null
  end as camada_fibra,
  case
    when c.tempo_contrato_voz > 15 then 'apto_agora'
    when c.tempo_contrato_voz = 15 then 'apto_1_mes'
    when c.tempo_contrato_voz = 14 then 'apto_2_meses'
    else null
  end as camada_renovacao,
  a.consultor_id as dono_consultor_id,
  a.status_contato,
  a.atribuido_em,
  a.ultimo_contato_em
from public.clientes c
left join crm_fibra.atribuicoes a on a.cnpj_digits = c.cnpj_digits
where c.cnpj_digits is not null and c.cnpj_digits <> '';

grant select on crm_fibra.leads_segmentados to service_role;
```

- [ ] **Step 6: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run db/schema.test.ts`
Expected: PASS — `Tests 10 passed (10)`.

- [ ] **Step 7: Commit**

```bash
git add crm-fibra/db/schema.sql crm-fibra/db/rollback-lead-card.sql crm-fibra/db/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(crm-fibra): schema for plan catalog, proposals and lead line/value columns

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Campos novos do lead + helpers de formatação (`lib/formato.ts`)

**Files:**
- Modify: `crm-fibra/lib/leads.ts` (interfaces `LeadSegmentado` e `LeadRow`, função `toLead`)
- Modify: `crm-fibra/lib/leads.test.ts` (`rowBase` e `leadEsperado`)
- Create: `crm-fibra/lib/formato.ts`
- Test: `crm-fibra/lib/formato.test.ts`

**Interfaces:**
- Consumes: colunas `linhas_voz`, `valor_contrato` da view (Task 1).
- Produces: `LeadSegmentado.linhasVoz: number | null`, `LeadSegmentado.valorContrato: number | null`; `formatarBRL(valor: number): string`; `parseValorBRL(texto: string): number | null`; `formatarDataHora(iso: string): string`. Tasks 5, 7, 8, 9, 10 usam esses nomes.

- [ ] **Step 1: Escrever os testes que falham**

Em `crm-fibra/lib/leads.test.ts`, trocar em `rowBase`:

```ts
  linhas_fixas: 0,
  camada_fibra: "fibra_candidato",
```

por:

```ts
  linhas_fixas: 0,
  linhas_voz: 3,
  valor_contrato: 299.9,
  camada_fibra: "fibra_candidato",
```

e em `leadEsperado`, trocar:

```ts
  linhasFixas: 0,
  camadaFibra: "fibra_candidato",
```

por:

```ts
  linhasFixas: 0,
  linhasVoz: 3,
  valorContrato: 299.9,
  camadaFibra: "fibra_candidato",
```

Create `crm-fibra/lib/formato.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatarBRL, parseValorBRL, formatarDataHora } from "./formato";

const semNbsp = (texto: string) => texto.replace(/ /g, " ");

describe("formatarBRL", () => {
  it("formata em reais com vírgula decimal e ponto de milhar", () => {
    expect(semNbsp(formatarBRL(194.89))).toBe("R$ 194,89");
    expect(semNbsp(formatarBRL(1299.9))).toBe("R$ 1.299,90");
    expect(semNbsp(formatarBRL(0))).toBe("R$ 0,00");
  });
});

describe("parseValorBRL", () => {
  it.each([
    ["149,90", 149.9],
    ["1.299,90", 1299.9],
    ["1299,9", 1299.9],
    ["149.90", 149.9],
    ["R$ 89,99", 89.99],
    ["  5  ", 5],
    ["1.299", 1299],
  ])("aceita %s", (texto, esperado) => {
    expect(parseValorBRL(texto)).toBe(esperado);
  });

  it.each(["", "abc", "0", "0,00", "-5", "1,2,3", "12.5.6", "R$"])("recusa %j", (texto) => {
    expect(parseValorBRL(texto)).toBeNull();
  });
});

describe("formatarDataHora", () => {
  it("converte UTC para o horário de Brasília (UTC-3)", () => {
    expect(formatarDataHora("2026-10-08T17:32:00Z")).toBe("08/10/2026 14:32");
  });

  it("volta um dia quando a hora UTC é de madrugada", () => {
    expect(formatarDataHora("2026-10-09T01:05:00Z")).toBe("08/10/2026 22:05");
  });

  it("mostra 00:xx e não 24:xx à meia-noite de Brasília", () => {
    expect(formatarDataHora("2026-10-08T03:05:00Z")).toBe("08/10/2026 00:05");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run lib/leads.test.ts lib/formato.test.ts`
Expected: FAIL — `lib/leads.test.ts`: os testes "mapeia as linhas para o formato da aplicação" e "retorna o lead mapeado quando encontra uma linha" falham no `toEqual` (faltam `linhasVoz`/`valorContrato`); `lib/formato.test.ts`: `Failed to resolve import "./formato"`.

- [ ] **Step 3: Implementar `lib/leads.ts`**

Em `crm-fibra/lib/leads.ts`:

1. Na interface `LeadSegmentado`, trocar `  linhasFixas: number | null;\n  camadaFibra:` por:

```ts
  linhasFixas: number | null;
  linhasVoz: number | null;
  valorContrato: number | null;
  camadaFibra:
```

(mantendo o resto da linha original `"fibra_candidato" | null;`).

2. Na interface `LeadRow`, trocar `  linhas_fixas: number | null;\n  camada_fibra:` por:

```ts
  linhas_fixas: number | null;
  linhas_voz: number | null;
  valor_contrato: number | null;
  camada_fibra:
```

3. Em `toLead`, trocar `    linhasFixas: row.linhas_fixas,` por:

```ts
    linhasFixas: row.linhas_fixas,
    linhasVoz: row.linhas_voz,
    valorContrato: row.valor_contrato,
```

- [ ] **Step 4: Implementar `lib/formato.ts`**

Create `crm-fibra/lib/formato.ts`:

```ts
const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarBRL(valor: number): string {
  return moeda.format(valor);
}

// Aceita o que um consultor digita de verdade: "149,90", "1.299,90",
// "R$ 89,99" e também "149.90". Retorna null para qualquer coisa que não
// seja um valor positivo — nunca adivinha.
export function parseValorBRL(texto: string): number | null {
  const limpo = texto.replace(/^R\$\s*/i, "").trim();
  let normalizado: string;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpo)) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(,\d{1,2})?$/.test(limpo)) {
    normalizado = limpo.replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(limpo)) {
    normalizado = limpo;
  } else {
    return null;
  }
  const valor = Number(normalizado);
  return valor > 0 ? valor : null;
}

const dataHoraBrasilia = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Sao_Paulo",
});

// O servidor roda em UTC; sem fixar o fuso, a proposta salva às 22h de
// Brasília apareceria com a data do dia seguinte.
export function formatarDataHora(iso: string): string {
  const partes = Object.fromEntries(
    dataHoraBrasilia.formatToParts(new Date(iso)).map((parte) => [parte.type, parte.value])
  );
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run lib/leads.test.ts lib/formato.test.ts && npx tsc --noEmit`
Expected: PASS nos dois arquivos (`lib/formato.test.ts`: 19 testes) e `tsc` sem erros.

- [ ] **Step 6: Commit**

```bash
git add crm-fibra/lib/leads.ts crm-fibra/lib/leads.test.ts crm-fibra/lib/formato.ts crm-fibra/lib/formato.test.ts
git commit -m "feat(crm-fibra): expose linhas_voz/valor_contrato on leads and add BRL/date helpers"
```

(Mensagem com a linha `Co-Authored-By` dos Global Constraints, via heredoc.)

---

### Task 3: Catálogo de planos (`lib/catalogo.ts`)

**Files:**
- Create: `crm-fibra/lib/catalogo.ts`
- Test: `crm-fibra/lib/catalogo.test.ts`

**Interfaces:**
- Consumes: tabela `crm_fibra.catalogo_planos` (Task 1).
- Produces:
  - `type CategoriaCatalogo = "convergente" | "pos_nacional" | "pos_regional" | "banda_larga" | "adicional"`
  - `const CATEGORIAS_CATALOGO: readonly CategoriaCatalogo[]`, `const ROTULO_CATEGORIA: Record<CategoriaCatalogo, string>`
  - `interface PlanoCatalogo { id: string; categoria: CategoriaCatalogo; nome: string; valor: number; observacao: string | null; ativo: boolean }`
  - `interface GrupoCatalogo { categoria: CategoriaCatalogo; rotulo: string; planos: PlanoCatalogo[] }`
  - `class PlanoJaExisteError extends Error`
  - `listarCatalogo(client: SupabaseClient, opcoes: { apenasAtivos: boolean }): Promise<PlanoCatalogo[]>`
  - `agruparPorCategoria(planos: PlanoCatalogo[]): GrupoCatalogo[]`
  - `criarPlano(client, input: { categoria: CategoriaCatalogo; nome: string; valor: number; observacao?: string | null }): Promise<PlanoCatalogo>`
  - `atualizarPlano(client, id: string, campos: { valor: number; observacao: string | null }): Promise<void>`
  - `definirPlanoAtivo(client, id: string, ativo: boolean): Promise<void>`

- [ ] **Step 1: Escrever o teste que falha**

Create `crm-fibra/lib/catalogo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarCatalogo,
  agruparPorCategoria,
  criarPlano,
  atualizarPlano,
  definirPlanoAtivo,
  PlanoJaExisteError,
  CATEGORIAS_CATALOGO,
  type PlanoCatalogo,
} from "./catalogo";

// Fake encadeável do query builder do Supabase; é "await-ável" como o real.
function makeQueryFake(resposta: { data?: unknown; error?: unknown }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const q: any = { calls };
  for (const metodo of ["schema", "from", "select", "eq", "order"]) {
    q[metodo] = (...args: unknown[]) => {
      calls.push({ method: metodo, args });
      return q;
    };
  }
  q.insert = (payload: unknown) => {
    q.__inserted = payload;
    return q;
  };
  q.update = (payload: unknown) => {
    q.__updated = payload;
    return q;
  };
  q.single = () => Promise.resolve(resposta);
  q.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(resposta).then(resolve, reject);
  return q;
}

const row = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
};

const plano: PlanoCatalogo = {
  id: "p1",
  categoria: "banda_larga",
  nome: "400 Mega (G1 Padrão)",
  valor: 79.9,
  observacao: "single/combinado/convergência",
  ativo: true,
};

describe("listarCatalogo", () => {
  it("mapeia as linhas e ordena por valor e depois por nome", async () => {
    const client = makeQueryFake({ data: [row], error: null });
    const resultado = await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: false });
    expect(resultado).toEqual([plano]);
    expect(client.calls).toContainEqual({ method: "schema", args: ["crm_fibra"] });
    expect(client.calls).toContainEqual({ method: "from", args: ["catalogo_planos"] });
    expect(client.calls).toContainEqual({ method: "order", args: ["valor", { ascending: true }] });
    expect(client.calls).toContainEqual({ method: "order", args: ["nome", { ascending: true }] });
  });

  it("com apenasAtivos filtra ativo = true", async () => {
    const client = makeQueryFake({ data: [], error: null });
    await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true });
    expect(client.calls).toContainEqual({ method: "eq", args: ["ativo", true] });
  });

  it("sem apenasAtivos não filtra por ativo (o admin vê os desativados)", async () => {
    const client = makeQueryFake({ data: [], error: null });
    await listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: false });
    expect(client.calls.find((c: { method: string }) => c.method === "eq")).toBeUndefined();
  });

  it("propaga o erro do banco", async () => {
    const client = makeQueryFake({ data: null, error: { message: "boom" } });
    await expect(
      listarCatalogo(client as unknown as SupabaseClient, { apenasAtivos: true })
    ).rejects.toMatchObject({ message: "boom" });
  });
});

describe("agruparPorCategoria", () => {
  it("devolve sempre as 5 categorias, na ordem do catálogo, mesmo vazias", () => {
    const grupos = agruparPorCategoria([plano]);
    expect(grupos.map((g) => g.categoria)).toEqual([...CATEGORIAS_CATALOGO]);
    expect(grupos.find((g) => g.categoria === "convergente")?.planos).toEqual([]);
    expect(grupos.find((g) => g.categoria === "banda_larga")?.planos).toEqual([plano]);
  });

  it("devolve as 5 categorias vazias quando não há nenhum plano", () => {
    const grupos = agruparPorCategoria([]);
    expect(grupos).toHaveLength(5);
    expect(grupos.every((g) => g.planos.length === 0)).toBe(true);
  });

  it("dá a cada grupo um rótulo legível em português", () => {
    const grupos = agruparPorCategoria([]);
    expect(grupos.find((g) => g.categoria === "convergente")?.rotulo).toBe("Convergentes (Fibra + Pós)");
    expect(grupos.find((g) => g.categoria === "banda_larga")?.rotulo).toBe("Banda Larga");
  });
});

describe("criarPlano", () => {
  it("insere os campos do plano e devolve o plano criado", async () => {
    const client = makeQueryFake({ data: row, error: null });
    const criado = await criarPlano(client as unknown as SupabaseClient, {
      categoria: "banda_larga",
      nome: "400 Mega (G1 Padrão)",
      valor: 79.9,
      observacao: "single/combinado/convergência",
    });
    expect(client.__inserted).toEqual({
      categoria: "banda_larga",
      nome: "400 Mega (G1 Padrão)",
      valor: 79.9,
      observacao: "single/combinado/convergência",
    });
    expect(criado).toEqual(plano);
  });

  it("grava observação nula quando ela é omitida", async () => {
    const client = makeQueryFake({ data: { ...row, observacao: null }, error: null });
    await criarPlano(client as unknown as SupabaseClient, {
      categoria: "adicional",
      nome: "Claro Monitor",
      valor: 5,
    });
    expect(client.__inserted.observacao).toBeNull();
  });

  it("lança PlanoJaExisteError em conflito de categoria + nome (código 23505)", async () => {
    const client = makeQueryFake({ data: null, error: { code: "23505", message: "duplicate key" } });
    await expect(
      criarPlano(client as unknown as SupabaseClient, {
        categoria: "adicional",
        nome: "Claro Monitor",
        valor: 5,
      })
    ).rejects.toThrow(PlanoJaExisteError);
  });
});

describe("atualizarPlano", () => {
  it("atualiza só valor e observação, e só na tabela do catálogo", async () => {
    const client = makeQueryFake({ error: null });
    await atualizarPlano(client as unknown as SupabaseClient, "p1", { valor: 89.9, observacao: null });
    expect(client.__updated).toEqual({ valor: 89.9, observacao: null });
    expect(client.calls).toContainEqual({ method: "eq", args: ["id", "p1"] });
    const tabelas = client.calls
      .filter((c: { method: string }) => c.method === "from")
      .map((c: { args: unknown[] }) => c.args[0]);
    expect(tabelas).toEqual(["catalogo_planos"]);
  });
});

describe("definirPlanoAtivo", () => {
  it("atualiza apenas o campo ativo", async () => {
    const client = makeQueryFake({ error: null });
    await definirPlanoAtivo(client as unknown as SupabaseClient, "p1", false);
    expect(client.__updated).toEqual({ ativo: false });
    expect(client.calls).toContainEqual({ method: "eq", args: ["id", "p1"] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run lib/catalogo.test.ts`
Expected: FAIL — `Failed to resolve import "./catalogo"`.

- [ ] **Step 3: Implementar**

Create `crm-fibra/lib/catalogo.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoriaCatalogo =
  | "convergente"
  | "pos_nacional"
  | "pos_regional"
  | "banda_larga"
  | "adicional";

export const CATEGORIAS_CATALOGO: readonly CategoriaCatalogo[] = [
  "convergente",
  "pos_nacional",
  "pos_regional",
  "banda_larga",
  "adicional",
];

export const ROTULO_CATEGORIA: Record<CategoriaCatalogo, string> = {
  convergente: "Convergentes (Fibra + Pós)",
  pos_nacional: "Claro Pós — Nacional",
  pos_regional: "Claro Pós — Regional",
  banda_larga: "Banda Larga",
  adicional: "Adicionais",
};

export interface PlanoCatalogo {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
}

interface PlanoRow {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
}

function toPlano(row: PlanoRow): PlanoCatalogo {
  return {
    id: row.id,
    categoria: row.categoria,
    nome: row.nome,
    valor: row.valor,
    observacao: row.observacao,
    ativo: row.ativo,
  };
}

export class PlanoJaExisteError extends Error {
  constructor(nome: string) {
    super(`Já existe um plano "${nome}" nesta categoria`);
    this.name = "PlanoJaExisteError";
  }
}

export async function listarCatalogo(
  client: SupabaseClient,
  opcoes: { apenasAtivos: boolean }
): Promise<PlanoCatalogo[]> {
  let query = client.schema("crm_fibra").from("catalogo_planos").select();
  if (opcoes.apenasAtivos) {
    query = query.eq("ativo", true);
  }
  const { data, error } = await query
    .order("valor", { ascending: true })
    .order("nome", { ascending: true });

  if (error) throw error;
  return ((data as PlanoRow[] | null) ?? []).map(toPlano);
}

export interface GrupoCatalogo {
  categoria: CategoriaCatalogo;
  rotulo: string;
  planos: PlanoCatalogo[];
}

// Sempre as 5 categorias, mesmo vazias: um admin que desativa todos os
// itens de uma categoria não pode quebrar a tela de ninguém.
export function agruparPorCategoria(planos: PlanoCatalogo[]): GrupoCatalogo[] {
  return CATEGORIAS_CATALOGO.map((categoria) => ({
    categoria,
    rotulo: ROTULO_CATEGORIA[categoria],
    planos: planos.filter((plano) => plano.categoria === categoria),
  }));
}

export async function criarPlano(
  client: SupabaseClient,
  input: { categoria: CategoriaCatalogo; nome: string; valor: number; observacao?: string | null }
): Promise<PlanoCatalogo> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .insert({
      categoria: input.categoria,
      nome: input.nome,
      valor: input.valor,
      observacao: input.observacao ?? null,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new PlanoJaExisteError(input.nome);
    }
    throw error;
  }
  return toPlano(data as PlanoRow);
}

export async function atualizarPlano(
  client: SupabaseClient,
  id: string,
  campos: { valor: number; observacao: string | null }
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .update({ valor: campos.valor, observacao: campos.observacao })
    .eq("id", id);
  if (error) throw error;
}

export async function definirPlanoAtivo(
  client: SupabaseClient,
  id: string,
  ativo: boolean
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .update({ ativo })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run lib/catalogo.test.ts && npx tsc --noEmit`
Expected: PASS (`Tests 12 passed (12)`) e `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/catalogo.ts crm-fibra/lib/catalogo.test.ts
git commit -m "feat(crm-fibra): add plan catalog data layer"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 4: Propostas (`lib/propostas.ts`)

**Files:**
- Create: `crm-fibra/lib/propostas.ts`
- Test: `crm-fibra/lib/propostas.test.ts`

**Interfaces:**
- Consumes: tabelas `crm_fibra.propostas` e `crm_fibra.proposta_itens` (Task 1).
- Produces:
  - `interface NovoItemProposta { catalogoPlanoId: string | null; descricao: string; valor: number }`
  - `interface ItemProposta extends NovoItemProposta { id: string; ordem: number }`
  - `interface Proposta { id: string; cnpjDigits: string; consultorId: string; criadoEm: string; itens: ItemProposta[]; total: number }`
  - `const LIMITE_DESCRICAO = 300`
  - `somarValores(valores: number[]): number` (soma em centavos)
  - `validarItensProposta(itens: NovoItemProposta[]): string | null` (mensagem de erro ou `null`)
  - `criarProposta(client: SupabaseClient, input: { cnpjDigits: string; consultorId: string; itens: NovoItemProposta[] }): Promise<Proposta>`
  - `listarPropostasPorCnpj(client: SupabaseClient, cnpjDigits: string): Promise<Proposta[]>` (mais recente primeiro)

- [ ] **Step 1: Escrever o teste que falha**

Create `crm-fibra/lib/propostas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  somarValores,
  validarItensProposta,
  criarProposta,
  listarPropostasPorCnpj,
  LIMITE_DESCRICAO,
  type NovoItemProposta,
} from "./propostas";

type Operacao = {
  tabela: string;
  tipo: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filtros: Array<[string, unknown]>;
  ordens: unknown[][];
};

// Registra cada operação por tabela; o `responder` do teste decide o que o
// "banco" devolve. É "await-ável" em qualquer ponto da cadeia, como o real.
function makeClientFake(responder: (op: Operacao) => { data?: unknown; error?: unknown }) {
  const operacoes: Operacao[] = [];
  const client: any = {
    operacoes,
    schema: () => client,
    from: (tabela: string) => {
      const op: Operacao = { tabela, tipo: "select", filtros: [], ordens: [] };
      operacoes.push(op);
      const q: any = {
        select: () => q,
        insert: (payload: unknown) => {
          op.tipo = "insert";
          op.payload = payload;
          return q;
        },
        update: (payload: unknown) => {
          op.tipo = "update";
          op.payload = payload;
          return q;
        },
        delete: () => {
          op.tipo = "delete";
          return q;
        },
        eq: (coluna: string, valor: unknown) => {
          op.filtros.push([coluna, valor]);
          return q;
        },
        in: (coluna: string, valores: unknown) => {
          op.filtros.push([coluna, valores]);
          return q;
        },
        order: (...args: unknown[]) => {
          op.ordens.push(args);
          return q;
        },
        single: () => Promise.resolve(responder(op)),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          Promise.resolve(responder(op)).then(resolve, reject),
      };
      return q;
    },
  };
  return client;
}

const propostaRow = {
  id: "prop1",
  cnpj_digits: "00005087000190",
  consultor_id: "c1",
  criado_em: "2026-10-08T17:32:00Z",
};

const itensEntrada: NovoItemProposta[] = [
  { catalogoPlanoId: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9 },
  { catalogoPlanoId: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9 },
  { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 5 },
];

function bancoQueAceitaTudo() {
  return makeClientFake((op) => {
    if (op.tabela === "propostas" && op.tipo === "insert") return { data: propostaRow, error: null };
    if (op.tabela === "proposta_itens" && op.tipo === "insert") {
      const linhas = op.payload as Record<string, unknown>[];
      return { data: linhas.map((linha, i) => ({ id: `i${i}`, ...linha })), error: null };
    }
    return { data: null, error: null };
  });
}

describe("somarValores", () => {
  it("soma em centavos, sem erro de ponto flutuante", () => {
    expect(somarValores([59.9, 79.9, 5])).toBe(144.8);
    expect(somarValores([0.1, 0.2])).toBe(0.3);
  });

  it("devolve 0 para lista vazia", () => {
    expect(somarValores([])).toBe(0);
  });
});

describe("validarItensProposta", () => {
  const ok: NovoItemProposta = { catalogoPlanoId: null, descricao: "Oferta", valor: 10 };

  it("aceita uma lista válida", () => {
    expect(validarItensProposta([ok])).toBeNull();
  });

  it("recusa proposta sem nenhuma linha", () => {
    expect(validarItensProposta([])).toMatch(/pelo menos uma linha/);
  });

  it("recusa descrição em branco", () => {
    expect(validarItensProposta([{ ...ok, descricao: "   " }])).toMatch(/descrição/);
  });

  it("recusa descrição acima do limite", () => {
    expect(validarItensProposta([{ ...ok, descricao: "x".repeat(LIMITE_DESCRICAO + 1) }])).toMatch(
      new RegExp(String(LIMITE_DESCRICAO))
    );
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])("recusa valor %s", (valor) => {
    expect(validarItensProposta([{ ...ok, valor }])).toMatch(/maior que zero/);
  });
});

describe("criarProposta", () => {
  it("grava o cabeçalho e depois os itens, com ordem sequencial e a própria cópia de descrição/valor", async () => {
    const client = bancoQueAceitaTudo();
    const proposta = await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
    });

    const [cabecalho, itens] = client.operacoes;
    expect(cabecalho).toMatchObject({
      tabela: "propostas",
      tipo: "insert",
      payload: { cnpj_digits: "00005087000190", consultor_id: "c1" },
    });
    expect(itens.payload).toEqual([
      { proposta_id: "prop1", catalogo_plano_id: "p1", descricao: "400 Mega (G1 Padrão) — single/combinado/convergência", valor: 79.9, ordem: 0 },
      { proposta_id: "prop1", catalogo_plano_id: null, descricao: "Oferta avulsa combinada por telefone", valor: 59.9, ordem: 1 },
      { proposta_id: "prop1", catalogo_plano_id: "p9", descricao: "Claro Monitor", valor: 5, ordem: 2 },
    ]);
    expect(proposta.id).toBe("prop1");
    expect(proposta.total).toBe(144.8);
    expect(proposta.itens.map((i) => i.ordem)).toEqual([0, 1, 2]);
  });

  it("só insere — nunca atualiza propostas existentes (dois consultores não se sobrescrevem)", async () => {
    const client = bancoQueAceitaTudo();
    await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c2",
      itens: itensEntrada,
    });
    const tiposEmPropostas = client.operacoes
      .filter((op: Operacao) => op.tabela === "propostas")
      .map((op: Operacao) => op.tipo);
    expect(tiposEmPropostas).toEqual(["insert"]);
    expect(client.operacoes.some((op: Operacao) => op.tipo === "update")).toBe(false);
  });

  it("não lê o catálogo e grava a própria cópia (preço editado depois não muda proposta antiga)", async () => {
    const client = bancoQueAceitaTudo();
    await criarProposta(client as unknown as SupabaseClient, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: itensEntrada,
    });
    expect(client.operacoes.some((op: Operacao) => op.tabela === "catalogo_planos")).toBe(false);
  });

  it("se gravar os itens falhar, apaga o cabeçalho recém-criado e propaga o erro", async () => {
    const client = makeClientFake((op) => {
      if (op.tabela === "propostas" && op.tipo === "insert") return { data: propostaRow, error: null };
      if (op.tabela === "proposta_itens") return { data: null, error: { message: "boom" } };
      return { data: null, error: null };
    });

    await expect(
      criarProposta(client as unknown as SupabaseClient, {
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        itens: itensEntrada,
      })
    ).rejects.toMatchObject({ message: "boom" });

    expect(client.operacoes).toContainEqual(
      expect.objectContaining({ tabela: "propostas", tipo: "delete", filtros: [["id", "prop1"]] })
    );
  });

  it("propaga o erro do cabeçalho sem tentar gravar itens", async () => {
    const client = makeClientFake(() => ({ data: null, error: { message: "sem cabeçalho" } }));
    await expect(
      criarProposta(client as unknown as SupabaseClient, {
        cnpjDigits: "00005087000190",
        consultorId: "c1",
        itens: itensEntrada,
      })
    ).rejects.toMatchObject({ message: "sem cabeçalho" });
    expect(client.operacoes).toHaveLength(1);
  });
});

describe("listarPropostasPorCnpj", () => {
  it("retorna lista vazia sem consultar itens quando o CNPJ não tem proposta", async () => {
    const client = makeClientFake(() => ({ data: [], error: null }));
    const resultado = await listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190");
    expect(resultado).toEqual([]);
    expect(client.operacoes.map((op: Operacao) => op.tabela)).toEqual(["propostas"]);
  });

  it("devolve a mais recente primeiro, com itens em ordem e total calculado", async () => {
    const nova = { id: "nova", cnpj_digits: "00005087000190", consultor_id: "c1", criado_em: "2026-10-08T17:32:00Z" };
    const antiga = { id: "antiga", cnpj_digits: "00005087000190", consultor_id: "c2", criado_em: "2026-10-01T12:00:00Z" };
    const client = makeClientFake((op) => {
      if (op.tabela === "propostas") return { data: [nova, antiga], error: null };
      return {
        data: [
          { id: "i2", proposta_id: "nova", catalogo_plano_id: null, descricao: "B", valor: 59.9, ordem: 1 },
          { id: "i1", proposta_id: "nova", catalogo_plano_id: "p1", descricao: "A", valor: 79.9, ordem: 0 },
          { id: "i3", proposta_id: "antiga", catalogo_plano_id: null, descricao: "C", valor: 10, ordem: 0 },
        ],
        error: null,
      };
    });

    const resultado = await listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190");

    expect(resultado.map((p) => p.id)).toEqual(["nova", "antiga"]);
    expect(resultado[0].itens.map((i) => i.descricao)).toEqual(["A", "B"]);
    expect(resultado[0].total).toBe(139.8);
    expect(resultado[1].total).toBe(10);
    expect(client.operacoes[0].filtros).toContainEqual(["cnpj_digits", "00005087000190"]);
    expect(client.operacoes[0].ordens).toContainEqual(["criado_em", { ascending: false }]);
    expect(client.operacoes[1].filtros).toContainEqual(["proposta_id", ["nova", "antiga"]]);
  });

  it("propaga erro do banco", async () => {
    const client = makeClientFake(() => ({ data: null, error: { message: "boom" } }));
    await expect(
      listarPropostasPorCnpj(client as unknown as SupabaseClient, "00005087000190")
    ).rejects.toMatchObject({ message: "boom" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run lib/propostas.test.ts`
Expected: FAIL — `Failed to resolve import "./propostas"`.

- [ ] **Step 3: Implementar**

Create `crm-fibra/lib/propostas.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NovoItemProposta {
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number;
}

export interface ItemProposta extends NovoItemProposta {
  id: string;
  ordem: number;
}

export interface Proposta {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  criadoEm: string;
  itens: ItemProposta[];
  total: number;
}

interface PropostaRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  criado_em: string;
}

interface ItemRow {
  id: string;
  proposta_id: string;
  catalogo_plano_id: string | null;
  descricao: string;
  valor: number;
  ordem: number;
}

export const LIMITE_DESCRICAO = 300;

// Soma em centavos inteiros: 0.1 + 0.2 em ponto flutuante não dá 0.3.
export function somarValores(valores: number[]): number {
  const centavos = valores.reduce((soma, valor) => soma + Math.round(valor * 100), 0);
  return centavos / 100;
}

export function validarItensProposta(itens: NovoItemProposta[]): string | null {
  if (itens.length === 0) return "Adicione pelo menos uma linha à proposta";
  for (const item of itens) {
    if (!item.descricao.trim()) return "Toda linha precisa de uma descrição";
    if (item.descricao.length > LIMITE_DESCRICAO) {
      return `A descrição de uma linha passou de ${LIMITE_DESCRICAO} caracteres`;
    }
    if (!Number.isFinite(item.valor) || item.valor <= 0) {
      return "Toda linha precisa de um valor maior que zero";
    }
  }
  return null;
}

function toProposta(row: PropostaRow, itensRows: ItemRow[]): Proposta {
  const itens: ItemProposta[] = [...itensRows]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => ({
      id: item.id,
      catalogoPlanoId: item.catalogo_plano_id,
      descricao: item.descricao,
      valor: item.valor,
      ordem: item.ordem,
    }));
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    criadoEm: row.criado_em,
    itens,
    total: somarValores(itens.map((item) => item.valor)),
  };
}

export async function criarProposta(
  client: SupabaseClient,
  input: { cnpjDigits: string; consultorId: string; itens: NovoItemProposta[] }
): Promise<Proposta> {
  const { data: cabecalho, error: erroCabecalho } = await client
    .schema("crm_fibra")
    .from("propostas")
    .insert({ cnpj_digits: input.cnpjDigits, consultor_id: input.consultorId })
    .select()
    .single();
  if (erroCabecalho) throw erroCabecalho;
  const propostaRow = cabecalho as PropostaRow;

  const linhas = input.itens.map((item, ordem) => ({
    proposta_id: propostaRow.id,
    catalogo_plano_id: item.catalogoPlanoId,
    descricao: item.descricao,
    valor: item.valor,
    ordem,
  }));
  const { data: itensRows, error: erroItens } = await client
    .schema("crm_fibra")
    .from("proposta_itens")
    .insert(linhas)
    .select();

  if (erroItens) {
    // Sem transação multi-tabela no cliente Supabase: desfaz o cabeçalho
    // para não deixar uma proposta vazia no histórico do cliente.
    await client.schema("crm_fibra").from("propostas").delete().eq("id", propostaRow.id);
    throw erroItens;
  }

  return toProposta(propostaRow, (itensRows as ItemRow[] | null) ?? []);
}

export async function listarPropostasPorCnpj(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Proposta[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("propostas")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const propostas = (data as PropostaRow[] | null) ?? [];
  if (propostas.length === 0) return [];

  const { data: itensData, error: erroItens } = await client
    .schema("crm_fibra")
    .from("proposta_itens")
    .select()
    .in(
      "proposta_id",
      propostas.map((proposta) => proposta.id)
    )
    .order("ordem", { ascending: true });
  if (erroItens) throw erroItens;

  const itens = (itensData as ItemRow[] | null) ?? [];
  return propostas.map((proposta) =>
    toProposta(
      proposta,
      itens.filter((item) => item.proposta_id === proposta.id)
    )
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run lib/propostas.test.ts && npx tsc --noEmit`
Expected: PASS (`Tests 18 passed (18)`) e `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/propostas.ts crm-fibra/lib/propostas.test.ts
git commit -m "feat(crm-fibra): add proposals data layer with centavo-safe totals"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

### Task 5: Lógica pura do construtor de proposta (`lib/proposta-rascunho.ts`)

**Files:**
- Create: `crm-fibra/lib/proposta-rascunho.ts`
- Test: `crm-fibra/lib/proposta-rascunho.test.ts`

**Interfaces:**
- Consumes: `PlanoCatalogo` (Task 3); `parseValorBRL` (Task 2); `somarValores`, `NovoItemProposta` (Task 4).
- Produces:
  - `interface LinhaRascunho { chave: string; catalogoPlanoId: string | null; descricao: string; valor: number }`, `type Rascunho = LinhaRascunho[]`
  - `descricaoDoPlano(plano: Pick<PlanoCatalogo, "nome" | "observacao">): string`
  - `adicionarLinhaCatalogo(rascunho: Rascunho, plano: PlanoCatalogo, chave: string): Rascunho`
  - `adicionarLinhaAvulsa(rascunho: Rascunho, entrada: { descricao: string; valorTexto: string }, chave: string): { ok: true; rascunho: Rascunho } | { ok: false; erro: string }`
  - `removerLinha(rascunho: Rascunho, chave: string): Rascunho`
  - `totalRascunho(rascunho: Rascunho): number`
  - `itensParaSalvar(rascunho: Rascunho): NovoItemProposta[]`

- [ ] **Step 1: Escrever o teste que falha**

Create `crm-fibra/lib/proposta-rascunho.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  descricaoDoPlano,
  itensParaSalvar,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "./proposta-rascunho";
import type { PlanoCatalogo } from "./catalogo";

const planoEscalonado: PlanoCatalogo = {
  id: "p3",
  categoria: "banda_larga",
  nome: "600 Mega (G1 Padrão)",
  valor: 59.9,
  observacao: "Por 3 meses, depois R$99,90",
  ativo: true,
};

const planoSimples: PlanoCatalogo = {
  id: "p9",
  categoria: "adicional",
  nome: "Claro Monitor",
  valor: 5,
  observacao: null,
  ativo: true,
};

describe("descricaoDoPlano", () => {
  it("a descrição da linha inclui a observação do plano (preço escalonado não se perde)", () => {
    expect(descricaoDoPlano(planoEscalonado)).toBe(
      "600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90"
    );
  });

  it("usa só o nome quando o plano não tem observação", () => {
    expect(descricaoDoPlano(planoSimples)).toBe("Claro Monitor");
  });
});

describe("adicionarLinhaCatalogo", () => {
  it("acrescenta a linha com id, descrição e valor do plano, sem mexer no rascunho original", () => {
    const original: Rascunho = [];
    const novo = adicionarLinhaCatalogo(original, planoEscalonado, "k1");
    expect(original).toEqual([]);
    expect(novo).toEqual([
      {
        chave: "k1",
        catalogoPlanoId: "p3",
        descricao: "600 Mega (G1 Padrão) — Por 3 meses, depois R$99,90",
        valor: 59.9,
      },
    ]);
  });

  it("permite o mesmo plano mais de uma vez (várias linhas iguais)", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(rascunho).toHaveLength(2);
    expect(totalRascunho(rascunho)).toBe(10);
  });
});

describe("adicionarLinhaAvulsa", () => {
  it("acrescenta uma oferta avulsa sem plano de catálogo, aceitando valor em formato brasileiro", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo negociado", valorTexto: "1.299,90" }, "k1");
    expect(resultado).toEqual({
      ok: true,
      rascunho: [{ chave: "k1", catalogoPlanoId: null, descricao: "Combo negociado", valor: 1299.9 }],
    });
  });

  it("apara os espaços da descrição", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "  Combo  ", valorTexto: "10" }, "k1");
    expect(resultado.ok && resultado.rascunho[0].descricao).toBe("Combo");
  });

  it("recusa descrição em branco", () => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "   ", valorTexto: "10" }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Descreva a oferta avulsa" });
  });

  it.each(["", "abc", "0", "-3"])("recusa valor inválido %j", (valorTexto) => {
    const resultado = adicionarLinhaAvulsa([], { descricao: "Combo", valorTexto }, "k1");
    expect(resultado).toEqual({ ok: false, erro: "Informe um valor válido, por exemplo 149,90" });
  });
});

describe("removerLinha", () => {
  it("remove só a linha da chave pedida", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k2");
    expect(removerLinha(rascunho, "k1").map((l) => l.chave)).toEqual(["k2"]);
  });
});

describe("totalRascunho", () => {
  it("soma os valores em centavos", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoEscalonado, "k1");
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k2");
    expect(totalRascunho(rascunho)).toBe(64.9);
  });

  it("é 0 para um rascunho vazio", () => {
    expect(totalRascunho([])).toBe(0);
  });
});

describe("itensParaSalvar", () => {
  it("tira a chave de tela e mantém a ordem das linhas", () => {
    let rascunho: Rascunho = [];
    rascunho = adicionarLinhaCatalogo(rascunho, planoSimples, "k1");
    const avulsa = adicionarLinhaAvulsa(rascunho, { descricao: "Combo", valorTexto: "10" }, "k2");
    expect(avulsa.ok && itensParaSalvar(avulsa.rascunho)).toEqual([
      { catalogoPlanoId: "p9", descricao: "Claro Monitor", valor: 5 },
      { catalogoPlanoId: null, descricao: "Combo", valor: 10 },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run lib/proposta-rascunho.test.ts`
Expected: FAIL — `Failed to resolve import "./proposta-rascunho"`.

- [ ] **Step 3: Implementar**

Create `crm-fibra/lib/proposta-rascunho.ts`:

```ts
import type { PlanoCatalogo } from "./catalogo";
import { parseValorBRL } from "./formato";
import { somarValores, type NovoItemProposta } from "./propostas";

export interface LinhaRascunho {
  chave: string;
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number;
}

export type Rascunho = LinhaRascunho[];

// A observação ("Por 3 meses, depois R$99,90") vai junto na descrição: quem
// lê a proposta depois precisa da condição, não só do número promocional.
export function descricaoDoPlano(plano: Pick<PlanoCatalogo, "nome" | "observacao">): string {
  return plano.observacao ? `${plano.nome} — ${plano.observacao}` : plano.nome;
}

export function adicionarLinhaCatalogo(rascunho: Rascunho, plano: PlanoCatalogo, chave: string): Rascunho {
  return [
    ...rascunho,
    { chave, catalogoPlanoId: plano.id, descricao: descricaoDoPlano(plano), valor: plano.valor },
  ];
}

export type ResultadoLinhaAvulsa =
  | { ok: true; rascunho: Rascunho }
  | { ok: false; erro: string };

export function adicionarLinhaAvulsa(
  rascunho: Rascunho,
  entrada: { descricao: string; valorTexto: string },
  chave: string
): ResultadoLinhaAvulsa {
  const descricao = entrada.descricao.trim();
  if (!descricao) return { ok: false, erro: "Descreva a oferta avulsa" };

  const valor = parseValorBRL(entrada.valorTexto);
  if (valor === null) return { ok: false, erro: "Informe um valor válido, por exemplo 149,90" };

  return { ok: true, rascunho: [...rascunho, { chave, catalogoPlanoId: null, descricao, valor }] };
}

export function removerLinha(rascunho: Rascunho, chave: string): Rascunho {
  return rascunho.filter((linha) => linha.chave !== chave);
}

export function totalRascunho(rascunho: Rascunho): number {
  return somarValores(rascunho.map((linha) => linha.valor));
}

export function itensParaSalvar(rascunho: Rascunho): NovoItemProposta[] {
  return rascunho.map(({ catalogoPlanoId, descricao, valor }) => ({ catalogoPlanoId, descricao, valor }));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run lib/proposta-rascunho.test.ts && npx tsc --noEmit`
Expected: PASS (`Tests 15 passed (15)`) e `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add crm-fibra/lib/proposta-rascunho.ts crm-fibra/lib/proposta-rascunho.test.ts
git commit -m "feat(crm-fibra): add pure proposal-draft logic for the proposal builder"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 6: Server Action para salvar proposta

**Files:**
- Modify: `crm-fibra/app/(protected)/leads/[cnpj]/actions.ts`
- Test: `crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts`

**Interfaces:**
- Consumes: `criarProposta`, `validarItensProposta`, `NovoItemProposta` (Task 4); `buscarLeadPorCnpj` (já existe); `sessaoAtiva` (função local já existente em `actions.ts`, devolve o consultor da sessão ou redireciona para `/login`).
- Produces: `salvarPropostaAction(cnpjDigits: string, itens: NovoItemProposta[]): Promise<{ erro?: string }>` — usada pela Task 9.

- [ ] **Step 1: Escrever os testes que falham**

Em `crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts`:

1. Trocar a linha `const cookieGet = vi.fn();` por:

```ts
const criarProposta = vi.fn();
vi.mock("@/lib/propostas", async () => {
  const actual = await vi.importActual<typeof import("@/lib/propostas")>("@/lib/propostas");
  return {
    ...actual,
    criarProposta: (...args: unknown[]) => criarProposta(...args),
  };
});

const cookieGet = vi.fn();
```

2. Trocar `import { atribuirLeadAction, registrarMensagemAction } from "./actions";` por:

```ts
import { atribuirLeadAction, registrarMensagemAction, salvarPropostaAction } from "./actions";
```

3. No `beforeEach`, trocar `  buscarLeadPorCnpj.mockReset();\n  cookieGet.mockReset();` por:

```ts
  buscarLeadPorCnpj.mockReset();
  criarProposta.mockReset();
  cookieGet.mockReset();
```

4. No fim do arquivo, trocar:

```ts
    expect(resultado.erro).toMatch(/dono/);
    expect(registrarMensagem).not.toHaveBeenCalled();
  });
});
```

por:

```ts
    expect(resultado.erro).toMatch(/dono/);
    expect(registrarMensagem).not.toHaveBeenCalled();
  });
});

describe("salvarPropostaAction", () => {
  const itensValidos = [
    { catalogoPlanoId: "p1", descricao: "  400 Mega (G1 Padrão)  ", valor: 79.9 },
    { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9 },
  ];

  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(salvarPropostaAction("00005087000190", itensValidos)).rejects.toThrow("REDIRECT:/login");
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa proposta sem nenhuma linha, sem gravar nada", async () => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", []);
    expect(resultado.erro).toMatch(/pelo menos uma linha/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it.each([
    ["descrição em branco", { catalogoPlanoId: null, descricao: "   ", valor: 10 }],
    ["valor zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 0 }],
    ["valor NaN", { catalogoPlanoId: null, descricao: "Oferta", valor: Number.NaN }],
    ["valor que não é número", { catalogoPlanoId: null, descricao: "Oferta", valor: "abc" as unknown as number }],
  ])("recusa linha inválida (%s) sem gravar nada", async (_nome, item) => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", [item]);
    expect(resultado.erro).toBeDefined();
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa CNPJ que não existe na base", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue(null);
    const resultado = await salvarPropostaAction("99999999999999", itensValidos);
    expect(resultado.erro).toMatch(/não encontrado/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("usa o consultor da sessão e permite salvar em lead de outro consultor", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: "outro-consultor" });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: [
        { catalogoPlanoId: "p1", descricao: "400 Mega (G1 Padrão)", valor: 79.9 },
        { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9 },
      ],
    });
  });

  it("trata um catalogoPlanoId que não é texto como oferta avulsa", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });

    await salvarPropostaAction("00005087000190", [
      { catalogoPlanoId: 123 as unknown as string, descricao: "Oferta", valor: 10 },
    ]);

    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({
      itens: [{ catalogoPlanoId: null, descricao: "Oferta", valor: 10 }],
    }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts"`
Expected: FAIL — os testes de `salvarPropostaAction` falham com `salvarPropostaAction is not a function` (o export ainda não existe); os testes antigos de `atribuirLeadAction`/`registrarMensagemAction` continuam passando.

- [ ] **Step 3: Implementar**

Em `crm-fibra/app/(protected)/leads/[cnpj]/actions.ts`:

1. Trocar a linha de import de `@/lib/leads` por ela mesma seguida do import novo:

```ts
import { atribuirLead, registrarMensagem, buscarLeadPorCnpj, LeadJaAtribuidoError } from "@/lib/leads";
import { criarProposta, validarItensProposta, type NovoItemProposta } from "@/lib/propostas";
```

2. Acrescentar ao fim do arquivo:

```ts

export async function salvarPropostaAction(
  cnpjDigits: string,
  itens: NovoItemProposta[]
): Promise<{ erro?: string }> {
  const consultor = await sessaoAtiva();

  // Argumentos de Server Action vêm do navegador: normaliza antes de confiar.
  const itensLimpos: NovoItemProposta[] = (Array.isArray(itens) ? itens : []).map((item) => ({
    catalogoPlanoId: typeof item?.catalogoPlanoId === "string" ? item.catalogoPlanoId : null,
    descricao: String(item?.descricao ?? "").trim(),
    valor: Number(item?.valor),
  }));

  const erro = validarItensProposta(itensLimpos);
  if (erro) return { erro };

  const lead = await buscarLeadPorCnpj(getSupabaseAdmin(), cnpjDigits);
  if (!lead) return { erro: "Lead não encontrado" };

  await criarProposta(getSupabaseAdmin(), {
    cnpjDigits,
    consultorId: consultor.id,
    itens: itensLimpos,
  });

  revalidatePath(`/leads/${cnpjDigits}`);
  return {};
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run "app/(protected)/leads/[cnpj]/actions.test.ts" && npx tsc --noEmit`
Expected: PASS — 6 testes antigos + 9 novos (`Tests 15 passed (15)`) e `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/[cnpj]/actions.ts" "crm-fibra/app/(protected)/leads/[cnpj]/actions.test.ts"
git commit -m "feat(crm-fibra): add salvarPropostaAction"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 7: Server Actions do admin do catálogo

**Files:**
- Create: `crm-fibra/app/(protected)/catalogo/actions.ts`
- Test: `crm-fibra/app/(protected)/catalogo/actions.test.ts`

**Interfaces:**
- Consumes: `criarPlano`, `atualizarPlano`, `definirPlanoAtivo`, `PlanoJaExisteError`, `CATEGORIAS_CATALOGO`, `CategoriaCatalogo` (Task 3); `parseValorBRL` (Task 2); `buscarConsultorPorId` (existente).
- Produces: `type CriarPlanoState = { erro?: string; sucesso?: boolean }`; `criarPlanoAction(_prev: CriarPlanoState, formData: FormData): Promise<CriarPlanoState>`; `atualizarPlanoAction(id: string, valorTexto: string, observacao: string): Promise<{ erro?: string }>`; `definirPlanoAtivoAction(id: string, ativo: boolean): Promise<{ erro?: string }>` — usadas pela Task 10.

- [ ] **Step 1: Escrever o teste que falha**

Create `crm-fibra/app/(protected)/catalogo/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
}));

const criarPlano = vi.fn();
const atualizarPlano = vi.fn();
const definirPlanoAtivo = vi.fn();
vi.mock("@/lib/catalogo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalogo")>("@/lib/catalogo");
  return {
    ...actual,
    criarPlano: (...args: unknown[]) => criarPlano(...args),
    atualizarPlano: (...args: unknown[]) => atualizarPlano(...args),
    definirPlanoAtivo: (...args: unknown[]) => definirPlanoAtivo(...args),
  };
});

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const verifySessionToken = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
  SESSION_COOKIE_NAME: "crm_fibra_session",
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { criarPlanoAction, atualizarPlanoAction, definirPlanoAtivoAction } from "./actions";
import { PlanoJaExisteError } from "@/lib/catalogo";

const admin = {
  id: "1",
  nome: "Admin",
  username: "admin",
  papel: "admin" as const,
  ativo: true,
  criadoEm: "x",
  ultimoLogin: null,
};

const consultorComum = { ...admin, id: "2", nome: "Ana", username: "ana", papel: "consultor" as const };

function logarComo(consultor: typeof admin | typeof consultorComum) {
  cookieGet.mockReturnValue({ value: "token" });
  verifySessionToken.mockResolvedValue({ consultorId: consultor.id, papel: consultor.papel });
  buscarConsultorPorId.mockResolvedValue(consultor);
}

function formData(campos: Record<string, string>) {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const camposValidos = { categoria: "adicional", nome: "Claro Monitor 2", valor: "149,90", observacao: "" };

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  criarPlano.mockReset();
  atualizarPlano.mockReset();
  definirPlanoAtivo.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

describe("criarPlanoAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(criarPlanoAction({}, formData(camposValidos))).rejects.toThrow("REDIRECT:/login");
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(criarPlanoAction({}, formData(camposValidos))).rejects.toThrow("Apenas administradores");
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa categoria fora da lista", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, categoria: "inexistente" }));
    expect(resultado.erro).toMatch(/categoria/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa nome em branco", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, nome: "   " }));
    expect(resultado.erro).toMatch(/nome/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa valor inválido", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, valor: "abc" }));
    expect(resultado.erro).toMatch(/valor/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("cria o plano com valor em formato brasileiro e observação em branco virando null", async () => {
    logarComo(admin);
    criarPlano.mockResolvedValue({ id: "p1" });
    const resultado = await criarPlanoAction(
      {},
      formData({ ...camposValidos, nome: "  Claro Monitor 2  ", observacao: "   " })
    );
    expect(resultado).toEqual({ sucesso: true });
    expect(criarPlano).toHaveBeenCalledWith({}, {
      categoria: "adicional",
      nome: "Claro Monitor 2",
      valor: 149.9,
      observacao: null,
    });
  });

  it("devolve a mensagem amigável quando o plano já existe", async () => {
    logarComo(admin);
    criarPlano.mockRejectedValue(new PlanoJaExisteError("Claro Monitor 2"));
    const resultado = await criarPlanoAction({}, formData(camposValidos));
    expect(resultado.erro).toMatch(/Já existe um plano/);
  });
});

describe("atualizarPlanoAction", () => {
  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(atualizarPlanoAction("p1", "89,90", "")).rejects.toThrow("Apenas administradores");
    expect(atualizarPlano).not.toHaveBeenCalled();
  });

  it("recusa valor inválido sem tocar no banco", async () => {
    logarComo(admin);
    const resultado = await atualizarPlanoAction("p1", "abc", "");
    expect(resultado.erro).toMatch(/valor/i);
    expect(atualizarPlano).not.toHaveBeenCalled();
  });

  it("atualiza valor e observação (já sem espaços nas pontas)", async () => {
    logarComo(admin);
    const resultado = await atualizarPlanoAction("p1", "89,90", "  promo  ");
    expect(resultado).toEqual({});
    expect(atualizarPlano).toHaveBeenCalledWith({}, "p1", { valor: 89.9, observacao: "promo" });
  });

  it("grava observação nula quando ela fica em branco", async () => {
    logarComo(admin);
    await atualizarPlanoAction("p1", "89,90", "   ");
    expect(atualizarPlano).toHaveBeenCalledWith({}, "p1", { valor: 89.9, observacao: null });
  });
});

describe("definirPlanoAtivoAction", () => {
  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(definirPlanoAtivoAction("p1", false)).rejects.toThrow("Apenas administradores");
    expect(definirPlanoAtivo).not.toHaveBeenCalled();
  });

  it("ativa/desativa o plano pedido", async () => {
    logarComo(admin);
    const resultado = await definirPlanoAtivoAction("p1", false);
    expect(resultado).toEqual({});
    expect(definirPlanoAtivo).toHaveBeenCalledWith({}, "p1", false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run (em `crm-fibra/`): `npx vitest run "app/(protected)/catalogo/actions.test.ts"`
Expected: FAIL — `Failed to resolve import "./actions"`.

- [ ] **Step 3: Implementar**

Create `crm-fibra/app/(protected)/catalogo/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarConsultorPorId } from "@/lib/consultores";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import {
  CATEGORIAS_CATALOGO,
  PlanoJaExisteError,
  atualizarPlano,
  criarPlano,
  definirPlanoAtivo,
  type CategoriaCatalogo,
} from "@/lib/catalogo";
import { parseValorBRL } from "@/lib/formato";

async function exigirAdmin() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const consultor = await buscarConsultorPorId(getSupabaseAdmin(), session.consultorId);
  if (!consultor || !consultor.ativo || consultor.papel !== "admin") {
    throw new Error("Apenas administradores podem gerenciar o catálogo");
  }
  return consultor;
}

const ERRO_VALOR = "Informe um valor válido, por exemplo 149,90";

export type CriarPlanoState = { erro?: string; sucesso?: boolean };

export async function criarPlanoAction(
  _prev: CriarPlanoState,
  formData: FormData
): Promise<CriarPlanoState> {
  await exigirAdmin();

  const categoria = String(formData.get("categoria") ?? "");
  const nome = String(formData.get("nome") ?? "").trim();
  const valor = parseValorBRL(String(formData.get("valor") ?? ""));
  const observacao = String(formData.get("observacao") ?? "").trim() || null;

  if (!(CATEGORIAS_CATALOGO as readonly string[]).includes(categoria)) {
    return { erro: "Escolha uma categoria" };
  }
  if (!nome) return { erro: "Informe o nome do plano" };
  if (valor === null) return { erro: ERRO_VALOR };

  try {
    await criarPlano(getSupabaseAdmin(), {
      categoria: categoria as CategoriaCatalogo,
      nome,
      valor,
      observacao,
    });
  } catch (err) {
    if (err instanceof PlanoJaExisteError) {
      return { erro: err.message };
    }
    throw err;
  }

  revalidatePath("/catalogo");
  return { sucesso: true };
}

export async function atualizarPlanoAction(
  id: string,
  valorTexto: string,
  observacao: string
): Promise<{ erro?: string }> {
  await exigirAdmin();

  const valor = parseValorBRL(valorTexto);
  if (valor === null) return { erro: ERRO_VALOR };

  await atualizarPlano(getSupabaseAdmin(), id, {
    valor,
    observacao: observacao.trim() || null,
  });
  revalidatePath("/catalogo");
  return {};
}

export async function definirPlanoAtivoAction(
  id: string,
  ativo: boolean
): Promise<{ erro?: string }> {
  await exigirAdmin();
  await definirPlanoAtivo(getSupabaseAdmin(), id, ativo);
  revalidatePath("/catalogo");
  return {};
}
```

- [ ] **Step 4: Rodar e ver passar**

Run (em `crm-fibra/`): `npx vitest run "app/(protected)/catalogo/actions.test.ts" && npx tsc --noEmit`
Expected: PASS (`Tests 13 passed (13)`) e `tsc` sem erros.

- [ ] **Step 5: Commit**

```bash
git add "crm-fibra/app/(protected)/catalogo/actions.ts" "crm-fibra/app/(protected)/catalogo/actions.test.ts"
git commit -m "feat(crm-fibra): add admin server actions for the plan catalog"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

### Task 8: Página em abas — primitivo `Tabs`, aba Cliente e aba Linhas

**Files:**
- Modify: `crm-fibra/package.json`, `crm-fibra/package-lock.json` (via `npm install`)
- Create: `crm-fibra/components/ui/tabs.tsx`
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/aba-cliente.tsx`
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/aba-linhas.tsx`
- Modify (reescrever): `crm-fibra/app/(protected)/leads/[cnpj]/page.tsx`

**Interfaces:**
- Consumes: `LeadSegmentado` com `linhasVoz`/`valorContrato` e `Mensagem` (`lib/leads.ts`, Task 2); `formatarBRL`, `formatarDataHora` (Task 2); `CamadaBadges` (existente); `AtribuirButton`, `NovaMensagemForm` (existentes, sem mudança).
- Produces: `AbaCliente({ lead, mensagens, telefone, souODono })`, `AbaLinhas({ lead })`, e a estrutura de `page.tsx` com `<Tabs>` que a Task 9 estende com a terceira aba. `TabsContent` sempre usa `forceMount` + `data-[state=inactive]:hidden`, para o estado local (formulários, rascunho da proposta) sobreviver à troca de aba.

Esta task é apresentação pura: o comportamento (atribuir, registrar mensagem, histórico) é o mesmo, só reorganizado — e já está coberto por `actions.test.ts`. O projeto não tem infra de teste de DOM, então não há teste de renderização; a verificação é `tsc` + build, e o checklist manual da Task 11.

- [ ] **Step 1: Instalar a dependência das abas**

Run (em `crm-fibra/`): `npm install @radix-ui/react-tabs`
Expected: `added 1 package` (ou similar) e `@radix-ui/react-tabs` em `dependencies` do `package.json`.

- [ ] **Step 2: Criar o primitivo `Tabs`**

Create `crm-fibra/components/ui/tabs.tsx`:

```tsx
"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

- [ ] **Step 3: Criar a aba Cliente**

Create `crm-fibra/app/(protected)/leads/[cnpj]/aba-cliente.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarBRL, formatarDataHora } from "@/lib/formato";
import { CamadaBadges } from "@/components/camada-badges";
import type { LeadSegmentado, Mensagem } from "@/lib/leads";
import { AtribuirButton } from "./atribuir-button";
import { NovaMensagemForm } from "./nova-mensagem-form";

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{valor}</dd>
    </div>
  );
}

export function AbaCliente({
  lead,
  mensagens,
  telefone,
  souODono,
}: {
  lead: LeadSegmentado;
  mensagens: Mensagem[];
  telefone: string | null;
  souODono: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Campo rotulo="CNPJ" valor={lead.cnpjDigits} />
            <Campo rotulo="Cidade" valor={lead.cidade ?? "-"} />
            <Campo rotulo="ARPU" valor={lead.arpu != null ? formatarBRL(lead.arpu) : "-"} />
            <Campo rotulo="CEP" valor={lead.cepCabeado ?? "-"} />
            <Campo rotulo="Telefone 1" valor={lead.tel1 || "-"} />
            <Campo rotulo="Telefone 2" valor={lead.tel2 || "-"} />
            <Campo rotulo="Contato" valor={lead.telefoneContato || "-"} />
            <Campo rotulo="E-mail" valor={lead.email || "-"} />
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Segmentação</span>
            <CamadaBadges camadaFibra={lead.camadaFibra} camadaRenovacao={lead.camadaRenovacao} />
          </div>
        </CardContent>
      </Card>

      {!lead.donoConsultorId && <AtribuirButton cnpjDigits={lead.cnpjDigits} />}
      {lead.donoConsultorId && !souODono && (
        <p className="text-sm text-muted-foreground">Este lead já está atribuído a outro consultor.</p>
      )}

      {souODono ? (
        telefone ? (
          <NovaMensagemForm cnpjDigits={lead.cnpjDigits} telefone={telefone} />
        ) : (
          <p className="text-sm text-primary">
            Nenhum telefone válido encontrado — contato precisa ser manual.
          </p>
        )
      ) : (
        !lead.donoConsultorId && (
          <p className="text-sm text-muted-foreground">
            Atribua este lead a você para poder registrar contato.
          </p>
        )
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Histórico de mensagens</CardTitle>
        </CardHeader>
        <CardContent>
          {mensagens.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma mensagem registrada ainda.</p>
          )}
          <ul className="space-y-2">
            {mensagens.map((m) => (
              <li key={m.id} className="border-l-4 border-primary px-3 py-2">
                <div className="text-xs uppercase text-muted-foreground">
                  {m.canal} · {formatarDataHora(m.enviadoEm)}
                </div>
                <div className="text-sm">{m.conteudo}</div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Criar a aba Linhas**

Create `crm-fibra/app/(protected)/leads/[cnpj]/aba-linhas.tsx`:

```tsx
import { CamadaBadges } from "@/components/camada-badges";
import { Card, CardContent } from "@/components/ui/card";
import { formatarBRL } from "@/lib/formato";
import type { LeadSegmentado } from "@/lib/leads";

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</div>
        <div className="mt-1 text-2xl font-semibold">{valor}</div>
      </CardContent>
    </Card>
  );
}

const numero = (valor: number | null) => (valor == null ? "-" : String(valor));
const moeda = (valor: number | null) => (valor == null ? "-" : formatarBRL(valor));

export function AbaLinhas({ lead }: { lead: LeadSegmentado }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Resumo rotulo="Linhas fixas" valor={numero(lead.linhasFixas)} />
        <Resumo rotulo="Linhas de voz" valor={numero(lead.linhasVoz)} />
        <Resumo rotulo="Valor do contrato" valor={moeda(lead.valorContrato)} />
        <Resumo rotulo="ARPU" valor={moeda(lead.arpu)} />
      </div>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-muted-foreground">Segmentação</span>
          <CamadaBadges camadaFibra={lead.camadaFibra} camadaRenovacao={lead.camadaRenovacao} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Reescrever `page.tsx`**

Replace the whole content of `crm-fibra/app/(protected)/leads/[cnpj]/page.tsx` with:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";
import { normalizarTelefone } from "@/lib/whatsapp";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AbaCliente } from "./aba-cliente";
import { AbaLinhas } from "./aba-linhas";

// forceMount mantém as três abas montadas: o rascunho de proposta e os
// formulários não podem perder o que foi digitado ao trocar de aba.
const CONTEUDO_DA_ABA = "data-[state=inactive]:hidden";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ cnpj: string }>;
}) {
  const { cnpj } = await params;
  const admin = getSupabaseAdmin();

  const lead = await buscarLeadPorCnpj(admin, cnpj);
  if (!lead) notFound();

  const mensagens = await listarMensagens(admin, cnpj);
  const telefone = normalizarTelefone({
    ddd: lead.ddd,
    tel1: lead.tel1,
    tel2: lead.tel2,
    telefoneContato: lead.telefoneContato,
  });

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  const souODono = session != null && lead.donoConsultorId === session.consultorId;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Carteira de Leads
        </Link>
        <h2 className="mt-2">{lead.razaoSocial || lead.cnpjDigits}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          CNPJ {lead.cnpjDigits}
          {lead.cidade ? ` · ${lead.cidade}` : ""}
        </p>
      </div>

      <Tabs defaultValue="cliente">
        <TabsList>
          <TabsTrigger value="cliente">Cliente</TabsTrigger>
          <TabsTrigger value="linhas">Linhas</TabsTrigger>
        </TabsList>
        <TabsContent value="cliente" forceMount className={CONTEUDO_DA_ABA}>
          <AbaCliente lead={lead} mensagens={mensagens} telefone={telefone} souODono={souODono} />
        </TabsContent>
        <TabsContent value="linhas" forceMount className={CONTEUDO_DA_ABA}>
          <AbaLinhas lead={lead} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 6: Verificar tipos, testes e build**

Run (em `crm-fibra/`): `npx tsc --noEmit && npm test && npm run build`
Expected: `tsc` sem erros; todos os testes passando; build termina com `✓ Compiled successfully` e a rota `ƒ /leads/[cnpj]` na lista. (Se o build falhar com `memory allocation ... failed`, é pressão de memória da máquina — rode de novo uma vez antes de investigar.)

- [ ] **Step 7: Commit**

```bash
git add crm-fibra/package.json crm-fibra/package-lock.json crm-fibra/components/ui/tabs.tsx "crm-fibra/app/(protected)/leads/[cnpj]/aba-cliente.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/aba-linhas.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/page.tsx"
git commit -m "feat(crm-fibra): tabbed lead page with Cliente and Linhas tabs"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 9: Aba Proposta — construtor e lista de propostas salvas

**Files:**
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/proposta-builder.tsx`
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/propostas-salvas.tsx`
- Create: `crm-fibra/app/(protected)/leads/[cnpj]/aba-proposta.tsx`
- Modify: `crm-fibra/app/(protected)/leads/[cnpj]/page.tsx`

**Interfaces:**
- Consumes: `agruparPorCategoria`, `listarCatalogo`, `GrupoCatalogo`, `PlanoCatalogo` (Task 3); `Proposta`, `listarPropostasPorCnpj`, `validarItensProposta` (Task 4); toda a API de `proposta-rascunho.ts` (Task 5); `salvarPropostaAction` (Task 6); `formatarBRL`, `formatarDataHora` (Task 2); `listarConsultores` (existente) para os nomes; estrutura de `page.tsx` da Task 8.
- Produces: `PropostaBuilder({ cnpjDigits, grupos })` (client), `PropostasSalvas({ propostas, nomesConsultores })`, `AbaProposta({ cnpjDigits, catalogo, propostas, nomesConsultores })`, e a terceira aba em `page.tsx`.

Apresentação pura sobre lógica já testada (Tasks 4–6); mesma justificativa de verificação da Task 8.

- [ ] **Step 1: Criar o construtor (componente cliente fino)**

Create `crm-fibra/app/(protected)/leads/[cnpj]/proposta-builder.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GrupoCatalogo } from "@/lib/catalogo";
import { formatarBRL } from "@/lib/formato";
import { validarItensProposta } from "@/lib/propostas";
import {
  adicionarLinhaAvulsa,
  adicionarLinhaCatalogo,
  itensParaSalvar,
  removerLinha,
  totalRascunho,
  type Rascunho,
} from "@/lib/proposta-rascunho";
import { salvarPropostaAction } from "./actions";

const OFERTA_AVULSA = "__avulsa__";

export function PropostaBuilder({
  cnpjDigits,
  grupos,
}: {
  cnpjDigits: string;
  grupos: GrupoCatalogo[];
}) {
  const [rascunho, setRascunho] = useState<Rascunho>([]);
  const [selecao, setSelecao] = useState("");
  const [descricaoAvulsa, setDescricaoAvulsa] = useState("");
  const [valorAvulso, setValorAvulso] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const gruposComPlanos = grupos.filter((grupo) => grupo.planos.length > 0);

  function adicionar() {
    setSucesso(false);
    const chave = crypto.randomUUID();

    if (selecao === OFERTA_AVULSA) {
      const resultado = adicionarLinhaAvulsa(
        rascunho,
        { descricao: descricaoAvulsa, valorTexto: valorAvulso },
        chave
      );
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setRascunho(resultado.rascunho);
      setDescricaoAvulsa("");
      setValorAvulso("");
    } else {
      const plano = grupos.flatMap((grupo) => grupo.planos).find((p) => p.id === selecao);
      if (!plano) {
        setErro('Escolha um plano do catálogo ou "Oferta avulsa"');
        return;
      }
      setRascunho(adicionarLinhaCatalogo(rascunho, plano, chave));
    }

    setSelecao("");
    setErro(null);
  }

  function remover(chave: string) {
    setRascunho(removerLinha(rascunho, chave));
    setSucesso(false);
  }

  function salvar() {
    const itens = itensParaSalvar(rascunho);
    const erroValidacao = validarItensProposta(itens);
    if (erroValidacao) {
      setErro(erroValidacao);
      return;
    }

    startTransition(async () => {
      const resultado = await salvarPropostaAction(cnpjDigits, itens);
      if (resultado.erro) {
        setErro(resultado.erro);
        setSucesso(false);
        return;
      }
      setRascunho([]);
      setErro(null);
      setSucesso(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Montar proposta</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Plano do catálogo"
            value={selecao}
            onChange={(e) => setSelecao(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Escolha um plano do catálogo…</option>
            {gruposComPlanos.map((grupo) => (
              <optgroup key={grupo.categoria} label={grupo.rotulo}>
                {grupo.planos.map((plano) => (
                  <option key={plano.id} value={plano.id}>
                    {plano.nome} — {formatarBRL(plano.valor)}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OFERTA_AVULSA}>Oferta avulsa (digitar)</option>
          </select>
          <Button type="button" onClick={adicionar} disabled={!selecao}>
            <Plus />
            Adicionar linha
          </Button>
        </div>

        {selecao === OFERTA_AVULSA && (
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
            <Input
              placeholder="Descrição da oferta"
              value={descricaoAvulsa}
              onChange={(e) => setDescricaoAvulsa(e.target.value)}
              aria-label="Descrição da oferta avulsa"
            />
            <Input
              placeholder="Valor (ex.: 149,90)"
              inputMode="decimal"
              value={valorAvulso}
              onChange={(e) => setValorAvulso(e.target.value)}
              aria-label="Valor da oferta avulsa"
            />
          </div>
        )}

        {rascunho.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma linha adicionada ainda.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-32 text-right">Valor</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rascunho.map((linha) => (
                <TableRow key={linha.chave}>
                  <TableCell className="whitespace-normal">{linha.descricao}</TableCell>
                  <TableCell className="text-right">{formatarBRL(linha.valor)}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${linha.descricao}`}
                      onClick={() => remover(linha.chave)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-semibold">Total: {formatarBRL(totalRascunho(rascunho))}</span>
          <Button type="button" onClick={salvar} disabled={pending || rascunho.length === 0}>
            {pending ? "Salvando..." : "Salvar proposta"}
          </Button>
        </div>

        {erro && (
          <p className="text-sm text-destructive" role="alert">
            {erro}
          </p>
        )}
        {sucesso && (
          <p className="text-sm text-green-700" role="status">
            Proposta salva.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Criar a lista de propostas salvas**

Create `crm-fibra/app/(protected)/leads/[cnpj]/propostas-salvas.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatarBRL, formatarDataHora } from "@/lib/formato";
import type { Proposta } from "@/lib/propostas";

export function PropostasSalvas({
  propostas,
  nomesConsultores,
}: {
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
}) {
  if (propostas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma proposta salva para este cliente ainda.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      <h3>Propostas salvas</h3>
      {propostas.map((proposta, indice) => (
        <Card key={proposta.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {nomesConsultores[proposta.consultorId] ?? "Consultor desconhecido"} ·{" "}
              {formatarDataHora(proposta.criadoEm)}
            </CardTitle>
            {indice === 0 && <Badge>Mais recente</Badge>}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-32 text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {proposta.itens.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-normal">{item.descricao}</TableCell>
                    <TableCell className="text-right">{formatarBRL(item.valor)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-3 text-right text-sm font-semibold">
              Total: {formatarBRL(proposta.total)}
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Criar a aba**

Create `crm-fibra/app/(protected)/leads/[cnpj]/aba-proposta.tsx`:

```tsx
import { agruparPorCategoria, type PlanoCatalogo } from "@/lib/catalogo";
import type { Proposta } from "@/lib/propostas";
import { PropostaBuilder } from "./proposta-builder";
import { PropostasSalvas } from "./propostas-salvas";

export function AbaProposta({
  cnpjDigits,
  catalogo,
  propostas,
  nomesConsultores,
}: {
  cnpjDigits: string;
  catalogo: PlanoCatalogo[];
  propostas: Proposta[];
  nomesConsultores: Record<string, string>;
}) {
  return (
    <div className="space-y-6">
      <PropostaBuilder cnpjDigits={cnpjDigits} grupos={agruparPorCategoria(catalogo)} />
      <PropostasSalvas propostas={propostas} nomesConsultores={nomesConsultores} />
    </div>
  );
}
```

- [ ] **Step 4: Ligar a terceira aba em `page.tsx`**

Em `crm-fibra/app/(protected)/leads/[cnpj]/page.tsx`, fazer estas quatro trocas:

1. Trocar `import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";` por:

```tsx
import { buscarLeadPorCnpj, listarMensagens } from "@/lib/leads";
import { listarCatalogo } from "@/lib/catalogo";
import { listarConsultores } from "@/lib/consultores";
import { listarPropostasPorCnpj } from "@/lib/propostas";
```

2. Trocar `import { AbaLinhas } from "./aba-linhas";` por:

```tsx
import { AbaLinhas } from "./aba-linhas";
import { AbaProposta } from "./aba-proposta";
```

3. Trocar `  const mensagens = await listarMensagens(admin, cnpj);` por:

```tsx
  const [mensagens, propostas, catalogo, consultores] = await Promise.all([
    listarMensagens(admin, cnpj),
    listarPropostasPorCnpj(admin, cnpj),
    listarCatalogo(admin, { apenasAtivos: true }),
    listarConsultores(admin),
  ]);
  const nomesConsultores = Object.fromEntries(consultores.map((c) => [c.id, c.nome]));
```

4. Trocar `<TabsTrigger value="linhas">Linhas</TabsTrigger>` por:

```tsx
<TabsTrigger value="linhas">Linhas</TabsTrigger>
          <TabsTrigger value="proposta">Proposta</TabsTrigger>
```

e trocar:

```tsx
          <AbaLinhas lead={lead} />
        </TabsContent>
```

por:

```tsx
          <AbaLinhas lead={lead} />
        </TabsContent>
        <TabsContent value="proposta" forceMount className={CONTEUDO_DA_ABA}>
          <AbaProposta
            cnpjDigits={lead.cnpjDigits}
            catalogo={catalogo}
            propostas={propostas}
            nomesConsultores={nomesConsultores}
          />
        </TabsContent>
```

- [ ] **Step 5: Verificar tipos, testes e build**

Run (em `crm-fibra/`): `npx tsc --noEmit && npm test && npm run build`
Expected: `tsc` sem erros; todos os testes passando; build com `✓ Compiled successfully` e `ƒ /leads/[cnpj]` na lista de rotas.

- [ ] **Step 6: Commit**

```bash
git add "crm-fibra/app/(protected)/leads/[cnpj]/proposta-builder.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/propostas-salvas.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/aba-proposta.tsx" "crm-fibra/app/(protected)/leads/[cnpj]/page.tsx"
git commit -m "feat(crm-fibra): add Proposta tab with draft builder and saved proposals"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 10: Admin do catálogo — página `/catalogo` e item na sidebar

**Files:**
- Create: `crm-fibra/app/(protected)/catalogo/page.tsx`
- Create: `crm-fibra/app/(protected)/catalogo/plano-row.tsx`
- Create: `crm-fibra/app/(protected)/catalogo/novo-plano-form.tsx`
- Modify: `crm-fibra/components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `listarCatalogo`, `agruparPorCategoria`, `PlanoCatalogo`, `CATEGORIAS_CATALOGO`, `ROTULO_CATEGORIA` (Task 3); `criarPlanoAction`, `CriarPlanoState`, `atualizarPlanoAction`, `definirPlanoAtivoAction` (Task 7); `buscarConsultorPorId` (existente).
- Produces: rota `/catalogo` (só admin) e o item "Catálogo" no grupo Administração da sidebar.

Apresentação pura sobre actions já testadas (Task 7); mesma justificativa de verificação da Task 8. A rota já é protegida pelo `middleware.ts` (que só deixa `/login` e `/api/login` públicos) e a página repete o gate de admin igual a `/consultores`.

- [ ] **Step 1: Criar a linha editável de um plano**

Create `crm-fibra/app/(protected)/catalogo/plano-row.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { PlanoCatalogo } from "@/lib/catalogo";
import { atualizarPlanoAction, definirPlanoAtivoAction } from "./actions";

function valorParaInput(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

export function PlanoRow({ plano }: { plano: PlanoCatalogo }) {
  const [valor, setValor] = useState(valorParaInput(plano.valor));
  const [observacao, setObservacao] = useState(plano.observacao ?? "");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const alterado =
    valor !== valorParaInput(plano.valor) || observacao !== (plano.observacao ?? "");

  function salvar() {
    startTransition(async () => {
      const resultado = await atualizarPlanoAction(plano.id, valor, observacao);
      setMensagem(resultado.erro ?? "Salvo");
    });
  }

  function alternarAtivo() {
    startTransition(async () => {
      const resultado = await definirPlanoAtivoAction(plano.id, !plano.ativo);
      if (resultado.erro) setMensagem(resultado.erro);
    });
  }

  return (
    <TableRow className={plano.ativo ? undefined : "opacity-60"}>
      <TableCell className="whitespace-normal font-medium">{plano.nome}</TableCell>
      <TableCell>
        <Input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          aria-label={`Valor de ${plano.nome}`}
        />
      </TableCell>
      <TableCell>
        <Input
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          aria-label={`Observação de ${plano.nome}`}
        />
      </TableCell>
      <TableCell>
        {plano.ativo ? <Badge>Ativo</Badge> : <Badge variant="secondary">Desativado</Badge>}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {alterado && (
            <Button size="sm" onClick={salvar} disabled={pending}>
              Salvar
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={alternarAtivo} disabled={pending}>
            {plano.ativo ? "Desativar" : "Reativar"}
          </Button>
          {mensagem && <span className="text-xs text-muted-foreground">{mensagem}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
```

- [ ] **Step 2: Criar o formulário de novo plano**

Create `crm-fibra/app/(protected)/catalogo/novo-plano-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORIAS_CATALOGO, ROTULO_CATEGORIA } from "@/lib/catalogo";
import { criarPlanoAction, type CriarPlanoState } from "./actions";

const estadoInicial: CriarPlanoState = {};

export function NovoPlanoForm() {
  const [estado, formAction, pending] = useActionState(criarPlanoAction, estadoInicial);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <div className="space-y-1">
        <label htmlFor="novo-plano-categoria" className="text-xs text-muted-foreground">
          Categoria
        </label>
        <select
          id="novo-plano-categoria"
          name="categoria"
          required
          className="flex h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {CATEGORIAS_CATALOGO.map((categoria) => (
            <option key={categoria} value={categoria}>
              {ROTULO_CATEGORIA[categoria]}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-nome" className="text-xs text-muted-foreground">
          Nome
        </label>
        <Input id="novo-plano-nome" name="nome" required className="w-72" />
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-valor" className="text-xs text-muted-foreground">
          Valor (R$)
        </label>
        <Input
          id="novo-plano-valor"
          name="valor"
          required
          inputMode="decimal"
          placeholder="149,90"
          className="w-32"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="novo-plano-observacao" className="text-xs text-muted-foreground">
          Observação
        </label>
        <Input id="novo-plano-observacao" name="observacao" className="w-72" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Adicionando..." : "Adicionar plano"}
      </Button>
      {estado.erro && <span className="text-sm text-destructive">{estado.erro}</span>}
      {estado.sucesso && <span className="text-sm text-green-700">Plano adicionado!</span>}
    </form>
  );
}
```

- [ ] **Step 3: Criar a página**

Create `crm-fibra/app/(protected)/catalogo/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { buscarConsultorPorId } from "@/lib/consultores";
import { agruparPorCategoria, listarCatalogo } from "@/lib/catalogo";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NovoPlanoForm } from "./novo-plano-form";
import { PlanoRow } from "./plano-row";

export default async function CatalogoPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) redirect("/login");

  const admin = getSupabaseAdmin();
  const consultorLogado = await buscarConsultorPorId(admin, session.consultorId);
  if (!consultorLogado || !consultorLogado.ativo || consultorLogado.papel !== "admin") {
    redirect("/dashboard");
  }

  const planos = await listarCatalogo(admin, { apenasAtivos: false });
  const grupos = agruparPorCategoria(planos);

  return (
    <div className="space-y-8">
      <div>
        <h2>Catálogo de planos</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Planos que os consultores escolhem ao montar uma proposta. Editar o valor aqui não altera
          propostas já salvas; desativar um plano só tira ele da lista de escolha.
        </p>
      </div>

      <NovoPlanoForm />

      {grupos.map((grupo) => (
        <section key={grupo.categoria} className="space-y-2">
          <h3>{grupo.rotulo}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plano</TableHead>
                <TableHead className="w-36">Valor (R$)</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupo.planos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Nenhum plano nesta categoria.
                  </TableCell>
                </TableRow>
              )}
              {grupo.planos.map((plano) => (
                <PlanoRow key={plano.id} plano={plano} />
              ))}
            </TableBody>
          </Table>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Adicionar o item na sidebar**

Em `crm-fibra/components/app-sidebar.tsx`:

1. Trocar `import { LayoutDashboard, Users2, UserCog, UploadCloud, LogOut } from "lucide-react";` por:

```tsx
import { LayoutDashboard, Users2, UserCog, UploadCloud, LogOut, Tags } from "lucide-react";
```

2. Trocar:

```tsx
  { href: "/consultores", rotulo: "Consultores", Icone: UserCog },
  { href: "/atualizar-base", rotulo: "Atualizar base", Icone: UploadCloud },
```

por:

```tsx
  { href: "/consultores", rotulo: "Consultores", Icone: UserCog },
  { href: "/catalogo", rotulo: "Catálogo", Icone: Tags },
  { href: "/atualizar-base", rotulo: "Atualizar base", Icone: UploadCloud },
```

- [ ] **Step 5: Verificar tipos, testes e build**

Run (em `crm-fibra/`): `npx tsc --noEmit && npm test && npm run build`
Expected: `tsc` sem erros (se `Tags` não existir no `lucide-react` instalado, é aqui que aparece — troque por `Tag`); todos os testes passando; build com a rota `ƒ /catalogo` listada.

- [ ] **Step 6: Commit**

```bash
git add "crm-fibra/app/(protected)/catalogo/page.tsx" "crm-fibra/app/(protected)/catalogo/plano-row.tsx" "crm-fibra/app/(protected)/catalogo/novo-plano-form.tsx" crm-fibra/components/app-sidebar.tsx
git commit -m "feat(crm-fibra): add admin catalog page and sidebar entry"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

---

### Task 11: Aplicar a migração em produção, verificar no banco e documentar

**Files:**
- Modify: `crm-fibra/README.md`

**Interfaces:**
- Consumes: `crm-fibra/db/schema.sql` e `crm-fibra/db/rollback-lead-card.sql` (Task 1).
- Produces: banco de produção com as 3 tabelas, 22 itens de catálogo e a view com 20 colunas; README com a migração registrada e o checklist manual.

**Esta task escreve DDL em produção (projeto Supabase "apex", `mdgfboijyqfkggcrhptn`): há uma parada obrigatória no Step 2.** Nada de deploy da aplicação faz parte deste plano — publicar o código na Vercel é um passo à parte, que precisa de autorização própria do usuário e deve acontecer **depois** desta migração (o código novo lê tabelas que só existem depois dela; o código antigo ignora as colunas novas, então a ordem inversa é a que quebraria).

- [ ] **Step 1: Baseline somente-leitura na produção**

Carregue as ferramentas: `ToolSearch` com `select:mcp__supabase__execute_sql`. Se a ferramenta não estiver disponível (MCP desconectado), **pare** e avise o usuário em vez de improvisar outro caminho.

Rode, no projeto `mdgfboijyqfkggcrhptn`, estas consultas (todas leitura):

```sql
select count(*) as total from crm_fibra.leads_segmentados;
```

```sql
select column_name, ordinal_position
from information_schema.columns
where table_schema = 'crm_fibra' and table_name = 'leads_segmentados'
order by ordinal_position;
```

```sql
select table_name from information_schema.tables
where table_schema = 'crm_fibra' order by table_name;
```

```sql
select pg_get_viewdef('crm_fibra.leads_segmentados'::regclass, true) as definicao;
```

Expected: a segunda consulta lista **18 colunas** terminando em `ultimo_contato_em`, na mesma ordem do `create or replace view` antigo do `schema.sql`; a terceira lista `atribuicoes`, `consultores`, `leads_segmentados`, `mensagens` (sem `catalogo_planos`, `propostas`, `proposta_itens`); a quarta contém `tempo_contrato_voz > 15`. **Anote o `total`** da primeira. Se a lista de colunas ou a definição da view for diferente do esperado, **pare** e mostre a diferença ao usuário — o `create or replace view` falharia ou desfaria uma mudança manual.

- [ ] **Step 2: PARADA — pedir autorização ao usuário**

Não aplique nada ainda. Diga ao usuário, em português e sem jargão: o que será criado (3 tabelas novas vazias + 22 planos de catálogo + 2 colunas novas no fim da view que os leads já usam), que o script é idempotente e só soma (não altera nem apaga dado existente), que existe `db/rollback-lead-card.sql` para desfazer, e que nenhum deploy do app acontece. Pergunte se pode aplicar. **Espere um "sim" explícito no chat.** Um "sim" vale só para esta aplicação.

- [ ] **Step 3: Aplicar**

Com o "sim" em mãos, rode o **conteúdo inteiro** de `crm-fibra/db/schema.sql` (é idempotente por desenho: `if not exists`, `create or replace`, `on conflict do nothing`) com `mcp__supabase__execute_sql` no projeto `mdgfboijyqfkggcrhptn`.
Expected: sem erro. Se houver erro, **pare**, mostre a mensagem e não tente "consertar" direto na produção — conserte o `schema.sql` num commit novo e peça novo "sim" antes de rodar de novo.

- [ ] **Step 4: Verificar no banco (somente leitura)**

```sql
select count(*) as total from crm_fibra.leads_segmentados;
```

Expected: igual ao `total` anotado no Step 1 (a view não ganhou nem perdeu linhas).

```sql
select column_name from information_schema.columns
where table_schema = 'crm_fibra' and table_name = 'leads_segmentados'
order by ordinal_position desc limit 2;
```

Expected: `valor_contrato` e depois `linhas_voz` (as duas últimas), 20 colunas no total.

```sql
select categoria, count(*) from crm_fibra.catalogo_planos group by categoria order by categoria;
```

Expected: `adicional 1`, `banda_larga 9`, `convergente 6`, `pos_nacional 5`, `pos_regional 1` (soma 22).

```sql
select count(*) from crm_fibra.catalogo_planos where nome ilike '%15GB%';
```

Expected: `0`.

```sql
select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'crm_fibra' and relname in ('catalogo_planos', 'propostas', 'proposta_itens')
order by relname;
```

Expected: as três com `relrowsecurity = true`.

```sql
select
  has_table_privilege('service_role', 'crm_fibra.catalogo_planos', 'select,insert,update,delete') as sr_catalogo,
  has_table_privilege('service_role', 'crm_fibra.propostas', 'select,insert,update,delete') as sr_propostas,
  has_table_privilege('service_role', 'crm_fibra.proposta_itens', 'select,insert,update,delete') as sr_itens,
  has_table_privilege('anon', 'crm_fibra.catalogo_planos', 'select') as anon_catalogo,
  has_table_privilege('anon', 'crm_fibra.propostas', 'select') as anon_propostas;
```

Expected: `sr_*` todos `true`; `anon_*` ambos `false`.

```sql
select linhas_voz, valor_contrato from crm_fibra.leads_segmentados limit 3;
```

Expected: 3 linhas sem erro (valores podem ser nulos para clientes sem esses dados).

- [ ] **Step 5: Documentar no README**

Acrescentar ao fim de `crm-fibra/README.md` (troque `<DATA>` pela saída de `date +%F` rodado agora):

```md

## Card de lead + propostas (Plano 3)

A página `/leads/[cnpj]` tem três abas (Cliente, Linhas, Proposta). A aba Proposta monta uma
proposta linha a linha a partir do catálogo de planos Claro-empresas
(`crm_fibra.catalogo_planos`, 22 itens iniciais), que o admin edita em `/catalogo`.

**Migração aplicada em produção (<DATA>):** `db/schema.sql` (idempotente) criou
`catalogo_planos`, `propostas` e `proposta_itens`, semeou o catálogo e acrescentou
`linhas_voz`/`valor_contrato` ao **fim** da view `leads_segmentados`. `db/rollback-lead-card.sql`
desfaz tudo (e apaga as propostas salvas). **Ordem de publicação:** aplicar a migração ANTES de
publicar o código — o código novo lê tabelas que só existem depois dela.

### Checklist de verificação manual (Plano 3)

1. Em `/leads`, clique num lead → a página abre com as abas Cliente, Linhas e Proposta; a aba
   Cliente mostra os mesmos dados e o histórico de mensagens de antes.
2. Aba Linhas → linhas fixas, linhas de voz, valor do contrato e ARPU preenchidos (ou "-" quando a
   base não tem) e os selos de camada.
3. Aba Proposta → escolha "600 Mega (G1 Padrão)" e adicione; depois adicione "Claro Monitor" →
   total R$ 64,90; remova uma linha → o total atualiza.
4. Escolha "Oferta avulsa", digite uma descrição e "149,90" → a linha entra com R$ 149,90; digite
   "abc" no valor → aparece erro e nada entra.
5. Salvar proposta → mensagem "Proposta salva.", o construtor esvazia e a proposta aparece em
   "Propostas salvas" com o selo "Mais recente", o seu nome e a hora de Brasília.
6. Salve uma segunda proposta com outra combinação → as duas ficam listadas, a nova primeiro.
7. Como admin em `/catalogo`: mude o valor de um plano e salve → a proposta antiga continua com o
   valor antigo; desative um plano → ele some do seletor da aba Proposta; reative → ele volta.
8. Como consultor comum, abra `/catalogo` → redireciona para `/dashboard`.
9. Troque de aba no meio de uma proposta ainda não salva → as linhas continuam lá ao voltar.
```

- [ ] **Step 6: Rodar tudo uma última vez e commitar**

Run (em `crm-fibra/`): `npx tsc --noEmit && npm test`
Expected: `tsc` sem erros; todos os testes passando.

```bash
git add crm-fibra/README.md
git commit -m "docs(crm-fibra): record lead card migration and manual checklist"
```

(Com o trailer `Co-Authored-By` dos Global Constraints.)

