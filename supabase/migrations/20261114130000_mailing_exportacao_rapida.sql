-- Seção 152.2 e 152.3 (14/11/2026): exportação do mailing mais rápida, sem custo.
-- Aplicada com statement_timeout = 0 (o índice lê a tabela inteira, 3,7 GB; o banco corta em 120 s por padrão).

-- 152.3: filtro cuja fase 1 (nunca extraídos) já foi lida até o fim desde a última carga. A chave é md5 do filtro
-- canônico (chaveContagem, sem o início do pedido). Só a mailing-api (conexão direta) usa: sem acesso pela API.
create table if not exists mailing.fase1_esgotada (
  chave text primary key,
  esgotada_em timestamptz not null default now()
);
alter table mailing.fase1_esgotada enable row level security;
revoke all on mailing.fase1_esgotada from anon, authenticated;

-- 152.2: índice das linhas já usadas, com toda coluna que um filtro pode usar (INDICE_USADAS_COLUNAS em consulta.ts).
-- O passo 1 da fase 2 filtra aqui sem ler a tabela. Sem "concurrently": só a exportação escreve em mailing.linha.
create index if not exists linha_usadas_filtro on mailing.linha (ultima_extracao, sorteio) include (id, rf_uf, rf_municipio, ddd, rf_ddd_cidade, rf_situacao, rf_porte_atual, rf_mei, rf_cnae, rf_data_abertura, sinal_deixou_mei, sinal_virou_mei, sinal_porte_mudou, classe_economica, sexo, geracao, faixa_risco, posicao, socio_obito, celular, operadora, portado, whatsapp, procon, do_mailing) where ultima_extracao is not null;
