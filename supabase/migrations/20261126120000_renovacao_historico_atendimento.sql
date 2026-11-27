-- §165 (26/11, Anderson): "Atividade do time" precisa mostrar tudo o que o consultor fez no dia. Até aqui o histórico só guardava
-- troca de etapa (status) e de consultor. Agora também registra cada atendimento salvo: um registro 'atendimento' por alteração,
-- com os campos que mudaram em `para` e a observação (até 500 caracteres) em `nota`. Troca de etapa continua em registro próprio.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_historico_check.sql (desfaz tudo).
begin;

-- o histórico passa a aceitar o campo 'atendimento'
alter table public.renovacao_historico drop constraint if exists renovacao_historico_campo_check;
alter table public.renovacao_historico add constraint renovacao_historico_campo_check check (campo in ('status', 'consultor', 'atendimento'));

create or replace function public.renovacao_carteira_historico()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_campos text[] := '{}'; v_nota text;
begin
  if new.status is distinct from old.status then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'status', old.status::text, new.status::text);
  end if;
  if new.consultor_id is distinct from old.consultor_id then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'consultor', old.consultor_id::text, new.consultor_id::text);
  end if;
  if new.prox_acao is distinct from old.prox_acao then v_campos := array_append(v_campos, 'próxima ação'); end if;
  if new.prox_retorno is distinct from old.prox_retorno or new.retorno_hora is distinct from old.retorno_hora then v_campos := array_append(v_campos, 'retorno'); end if;
  if new.canal is distinct from old.canal then v_campos := array_append(v_campos, 'canal'); end if;
  if new.tentativas is distinct from old.tentativas then v_campos := array_append(v_campos, 'tentativas'); end if;
  if new.falou_decisor is distinct from old.falou_decisor then v_campos := array_append(v_campos, 'falou com o decisor'); end if;
  if new.produto_ofertado is distinct from old.produto_ofertado then v_campos := array_append(v_campos, 'produto ofertado'); end if;
  if new.concorrente is distinct from old.concorrente then v_campos := array_append(v_campos, 'concorrente'); end if;
  if new.linhas_propostas is distinct from old.linhas_propostas or new.valor_proposta is distinct from old.valor_proposta then v_campos := array_append(v_campos, 'proposta'); end if;
  if new.melhor_horario is distinct from old.melhor_horario then v_campos := array_append(v_campos, 'melhor horário'); end if;
  if new.etiquetas is distinct from old.etiquetas then v_campos := array_append(v_campos, 'etiquetas'); end if;
  if new.motivo_perda is distinct from old.motivo_perda then v_campos := array_append(v_campos, 'motivo da perda'); end if;
  if new.linhas_renovadas is distinct from old.linhas_renovadas or new.numero_pedido is distinct from old.numero_pedido
     or new.bl_vendida is distinct from old.bl_vendida or new.sol_digitais is distinct from old.sol_digitais then v_campos := array_append(v_campos, 'fechamento'); end if;
  if new.observacoes is distinct from old.observacoes then
    v_campos := array_append(v_campos, 'observação'); v_nota := left(new.observacoes, 500);
  end if;
  if array_length(v_campos, 1) > 0 then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para, nota) values (new.id, auth.uid(), 'atendimento', null, array_to_string(v_campos, ', '), v_nota);
  end if;
  return null;
end $function$;

create index if not exists renovacao_historico_criado_idx on public.renovacao_historico (criado_em desc);

commit;
