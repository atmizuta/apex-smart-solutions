-- Índices da base de mailing (seção 102), aplicados DEPOIS da carga. Medido no servidor Micro em 21/10:
-- só entra índice que provou ganho.
-- Prioridade da extração (menos usados primeiro). Sem condição: com o índice parcial do filtro padrão, qualquer outro
-- filtro (óbito incluído, duas situações...) lia e ordenava a tabela inteira e estourava o tempo (revisão final, 21/10).
-- A carga grava a linha na ordem do sorteio, então ler por este índice é ler o disco em sequência.
create index if not exists linha_prioridade on mailing.linha (ultima_extracao nulls first, sorteio);
drop index if exists mailing.linha_padrao_prioridade;
create index if not exists extracao_criado on mailing.extracao (criado_em desc);
analyze mailing.empresa;
analyze mailing.socio;
analyze mailing.linha;
analyze mailing.opcao;
