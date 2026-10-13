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
