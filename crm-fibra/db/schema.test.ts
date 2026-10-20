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

function blocoDaTabela(sql: string, nome: string): string {
  const inicio = sql.indexOf(`create table if not exists crm_fibra.${nome}`);
  return sql.slice(inicio, sql.indexOf(");", inicio));
}

describe("db/schema.sql — abordagens por IA", () => {
  it("cria a tabela abordagens", () => {
    expect(ler("schema.sql")).toContain("create table if not exists crm_fibra.abordagens");
  });

  it("liga RLS em abordagens (sem policy: só o service role acessa)", () => {
    expect(ler("schema.sql")).toContain("alter table crm_fibra.abordagens enable row level security;");
  });

  it("guarda as etapas em jsonb obrigatório e o modelo usado", () => {
    const bloco = blocoDaTabela(ler("schema.sql"), "abordagens");
    expect(bloco).toContain("etapas jsonb not null");
    expect(bloco).toContain("modelo text not null");
  });

  it("deixa proposta_id nulo e solta o vínculo se a proposta for apagada", () => {
    const bloco = blocoDaTabela(ler("schema.sql"), "abordagens");
    const linha = bloco.split("\n").find((l) => l.includes("proposta_id")) ?? "";
    expect(linha).toContain("references crm_fibra.propostas(id) on delete set null");
    expect(linha).not.toContain("not null");
  });

  it("indexa por lead e data decrescente (a aba lê só a mais recente)", () => {
    expect(ler("schema.sql")).toContain(
      "create index if not exists idx_abordagens_cnpj_criado on crm_fibra.abordagens (cnpj_digits, criado_em desc);"
    );
  });
});

describe("db/rollback-abordagens.sql", () => {
  it("derruba só a tabela abordagens", () => {
    const sql = ler("rollback-abordagens.sql");
    expect(sql).toContain("drop table if exists crm_fibra.abordagens;");
    expect(sql).not.toContain("drop table if exists crm_fibra.propostas");
    expect(sql).not.toContain("drop table if exists crm_fibra.catalogo_planos");
  });
});

const MARCADOR_FATURA = "-- Proposta com fatura (sub-projeto 5)";

function blocoDaFatura(sql: string): string {
  const inicio = sql.indexOf(MARCADOR_FATURA);
  return inicio === -1 ? "" : sql.slice(inicio);
}

describe("db/schema.sql — proposta com fatura", () => {
  it("tem o bloco do sub-projeto 5", () => {
    expect(blocoDaFatura(ler("schema.sql"))).not.toBe("");
  });

  it("dá franquia_gb ao catálogo, nula ou positiva", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.catalogo_planos");
    expect(bloco).toMatch(/add column if not exists franquia_gb integer check \(franquia_gb is null or franquia_gb > 0\)/);
  });

  it("preenche a franquia dos Pós a partir do nome, sem sobrescrever o que já existe", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("update crm_fibra.catalogo_planos");
    expect(bloco).toContain("substring(nome from '^Pós ([0-9]+)GB')");
    expect(bloco).toContain("categoria in ('pos_nacional', 'pos_regional')");
    expect(bloco).toContain("franquia_gb is null");
  });

  it("dá quantidade (1 a 1000, padrão 1) e franquia_gb aos itens da proposta", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.proposta_itens");
    expect(bloco).toMatch(
      /add column if not exists quantidade integer not null default 1 check \(quantidade between 1 and 1000\)/
    );
    expect(bloco).toMatch(/add column if not exists franquia_gb integer check \(franquia_gb is null or franquia_gb > 0\)/);
  });

  it("guarda a situação atual em jsonb opcional", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    expect(bloco).toContain("alter table crm_fibra.propostas add column if not exists situacao_atual jsonb;");
  });

  it("é idempotente: toda coluna nova usa if not exists", () => {
    const bloco = blocoDaFatura(ler("schema.sql"));
    const todas = bloco.match(/add column/g) ?? [];
    const seguras = bloco.match(/add column if not exists/g) ?? [];
    expect(todas.length).toBe(4);
    expect(seguras.length).toBe(todas.length);
  });

  it("não cria policy nem mexe nos 22 planos semeados", () => {
    const sql = ler("schema.sql");
    expect(sql).not.toMatch(/create policy/i);
    expect(linhasDoSeed(sql)).toHaveLength(22);
  });
});

describe("db/rollback-proposta-fatura.sql", () => {
  it("remove as quatro colunas e só elas", () => {
    const sql = ler("rollback-proposta-fatura.sql");
    expect(sql).toContain("alter table crm_fibra.propostas drop column if exists situacao_atual;");
    expect(sql).toContain("alter table crm_fibra.proposta_itens drop column if exists franquia_gb;");
    expect(sql).toContain("alter table crm_fibra.proposta_itens drop column if exists quantidade;");
    expect(sql).toContain("alter table crm_fibra.catalogo_planos drop column if exists franquia_gb;");
    expect(sql).not.toMatch(/drop table/i);
  });
});
