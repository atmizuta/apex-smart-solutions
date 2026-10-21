-- Índices da base de mailing (seção 102), aplicados DEPOIS da carga. O conjunto final sai da medição da Tarefa 7
-- (meta: contar <= 10 s, extrair 100 mil <= 60 s no servidor Micro); só entra índice que provar ganho.
create index if not exists linha_padrao_prioridade on mailing.linha (ultima_extracao nulls first, sorteio)
  where rf_situacao = 'ATIVA' and not socio_obito and celular and do_mailing;
create index if not exists extracao_criado on mailing.extracao (criado_em desc);
analyze mailing.empresa;
analyze mailing.socio;
analyze mailing.linha;
analyze mailing.opcao;
