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
