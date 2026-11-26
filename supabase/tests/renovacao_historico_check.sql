-- Conferência da §165 (histórico de atendimento). Roda tudo e DESFAZ (rollback). Esperado: nenhum erro.
begin;
do $$
declare v_id bigint; v_n int;
begin
  select id into v_id from public.renovacao_carteira where na_base and status = 0 limit 1;
  update public.renovacao_carteira set canal = 'WhatsApp', prox_acao = 'Ligar', observacoes = 'Zz teste do histórico' where id = v_id;
  select count(*) into v_n from public.renovacao_historico where carteira_id = v_id and campo = 'atendimento' and para like '%canal%' and para like '%observação%' and nota = 'Zz teste do histórico';
  assert v_n = 1, 'registra o atendimento com os campos e a observação';
  update public.renovacao_carteira set canal = 'WhatsApp' where id = v_id;
  select count(*) into v_n from public.renovacao_historico where carteira_id = v_id and campo = 'atendimento';
  assert v_n = 1, 'sem mudança não registra';
  update public.renovacao_carteira set status = 1 where id = v_id;
  select count(*) into v_n from public.renovacao_historico where carteira_id = v_id and campo = 'status';
  assert v_n >= 1, 'troca de etapa continua registrada';
end $$;
rollback;
