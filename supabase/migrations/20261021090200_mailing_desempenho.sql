-- Base de Mailing (seção 102): desempenho no servidor Micro (21/10/2026).
-- Medido com a base carregada: contar a base inteira levou 23–85 s, porque a linha (2,4 GB) não cabe nos 224 MB de cache.
-- Buscar empresa e sócio para 100 mil linhas passou de 5 min (leituras soltas no disco).
-- 1) A exportação lê só a linha: nome do sócio e razão social ficam nela. A carga grava as linhas na ordem de
--    prioridade (sorteio), então pegar as próximas 100 mil vira leitura em sequência.
-- 2) A contagem usa uma amostra fixa de ~2% (sorteio % 50 = 0), que cabe na memória. O resultado é escalado pelo
--    fator da carga (mailing.carga.contagens->>'amostra_fator'). primeira_da_empresa/primeira_do_fone marcam uma
--    linha por empresa e por telefone para estimar os distintos. A carga monta a amostra; a extração atualiza o uso dela.
alter table mailing.linha
  add column socio_nome text,
  add column razao_social text,
  add column primeira_da_empresa boolean not null default false,
  add column primeira_do_fone boolean not null default false;

create table mailing.amostra (
  linha_id bigint primary key,
  cnpj text not null,
  fone text not null,
  ddd smallint not null,
  celular boolean not null,
  do_mailing boolean not null,
  whatsapp boolean,
  procon boolean,
  operadora text,
  portado boolean,
  rf_situacao text,
  rf_porte_atual text,
  rf_mei boolean,
  rf_cnae integer,
  rf_uf text,
  rf_municipio integer,
  rf_data_abertura date,
  sinal_deixou_mei boolean,
  sinal_virou_mei boolean,
  sinal_porte_mudou boolean,
  classe_economica text,
  socio_obito boolean not null,
  ultima_extracao timestamptz,
  primeira_da_empresa boolean not null,
  primeira_do_fone boolean not null
);

revoke all on mailing.amostra from public, anon, authenticated;
