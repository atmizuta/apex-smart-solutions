-- Base de Mailing (seção 102.9): amostra por empresa e por telefone (21/10/2026, revisão do Rafael).
-- Antes: 2% das LINHAS, com 1 linha marcada por empresa. Com filtro de telefone (posição, operadora…) a empresa sumia
-- da conta quando a linha marcada não passava ("telefone 1" mostrava 2,5 mi empresas; o certo é 4,0 mi).
-- Agora a carga monta no PC e sobe: todas as linhas de ~2% das empresas (na_empresa) → linhas e empresas;
-- todas as linhas de ~2% dos números (no_fone) → telefones distintos. Fatores em mailing.carga.contagens.
-- O uso (ultima_extracao) passa a ser marcado pelo par CNPJ + telefone; linha_id fica opcional (sem uso).
alter table mailing.amostra drop constraint amostra_pkey;
alter table mailing.amostra alter column linha_id drop not null;
alter table mailing.amostra
  add column na_empresa boolean not null default false,
  add column no_fone boolean not null default false;
alter table mailing.amostra add primary key (cnpj, fone);
