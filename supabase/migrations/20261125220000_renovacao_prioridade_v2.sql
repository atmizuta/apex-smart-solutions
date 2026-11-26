-- §165 (25/11, Anderson): nova regra de prioridade P1–P6 (substitui a de fatura/fixa viável).
-- "Fixa nova" = fixa viável (HP cabeado e livre para venda) e SEM fixa hoje. Só entra em P1–P4 quem está APTO AGORA.
--   P1 apto agora + fixa nova + 4 ou mais linhas      P2 apto agora + fixa nova + 1 a 3 linhas
--   P3 apto agora sem fixa nova + 4 ou mais linhas    P4 apto agora sem fixa nova + 1 a 3 linhas
--   P5 apto em 1 ou 2 meses (com ou sem fixa)         P6 não apto com fixa nova      (resto: sem prioridade = null)
-- Sem DROP: a função antiga de 4 argumentos fica sem uso. Aplicar com execute_sql (begin/commit).
-- Conferência: supabase/tests/renovacao_prioridade_check.sql (desfaz tudo).
begin;

create or replace function public.renovacao_prioridade(p_apto text, p_fixa_viavel boolean, p_tem_fixa boolean, p_linhas int)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when p_apto = 'APTO' then
      case when coalesce(p_fixa_viavel, false) and not coalesce(p_tem_fixa, false)
             then case when coalesce(p_linhas, 0) >= 4 then 'P1' else 'P2' end
           else case when coalesce(p_linhas, 0) >= 4 then 'P3' else 'P4' end end
    when p_apto in ('1 MÊS PARA APTO', '2 MESES PARA APTO') then 'P5'
    when coalesce(p_fixa_viavel, false) and not coalesce(p_tem_fixa, false) then 'P6'
    else null end
$function$;
revoke all on function public.renovacao_prioridade(text, boolean, boolean, int) from public, anon;

create or replace function public.renovacao_carteira_validar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_mudou boolean := false; v_falha text;
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and v_role not in ('admin', 'supervisor') and (
         new.consultor_id is distinct from old.consultor_id or new.cnpj_digits is distinct from old.cnpj_digits
      or new.dados_claro is distinct from old.dados_claro or new.na_base is distinct from old.na_base
      or new.razao_social is distinct from old.razao_social or new.telefone is distinct from old.telefone
      or new.nome_adm is distinct from old.nome_adm or new.linhas_voz is distinct from old.linhas_voz
      or new.apto is distinct from old.apto or new.cidade is distinct from old.cidade or new.ddd is distinct from old.ddd
      or new.tempo_contrato_voz is distinct from old.tempo_contrato_voz or new.classificacao is distinct from old.classificacao
      or new.desconto_claro is distinct from old.desconto_claro or new.origem is distinct from old.origem
      or new.importado_em is distinct from old.importado_em
      or new.oportunidade is distinct from old.oportunidade or new.movimentacao is distinct from old.movimentacao
      or new.fatura is distinct from old.fatura or new.fixa_viavel is distinct from old.fixa_viavel
      or new.tem_fixa is distinct from old.tem_fixa or new.hist_origem is distinct from old.hist_origem
      or new.consultor_anterior is distinct from old.consultor_anterior) then
      raise exception 'consultor só altera o atendimento' using errcode = '42501';
    end if;
    new.a_completar := old.a_completar;
    v_mudou := new.status is distinct from old.status;
    new.status_desde := case when v_mudou then now() else old.status_desde end;
    if v_mudou and new.status >= 1 and new.data_contato is null then new.data_contato := v_hoje; end if;
    if v_mudou and new.status >= 6 and new.data_fechamento is null then new.data_fechamento := v_hoje; end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  if new.data_contato is not null and new.primeiro_contato is null then new.primeiro_contato := new.data_contato; end if;
  new.prioridade := public.renovacao_prioridade(new.apto, new.fixa_viavel, new.tem_fixa, new.linhas_voz);
  new.observacoes := nullif(trim(coalesce(new.observacoes, '')), '');
  v_falha := case
    when new.status = 8 and new.motivo_perda is null then 'Perdido precisa do motivo'
    when new.status in (6, 7) and coalesce(new.linhas_renovadas, 0) < 1 then 'Ganho precisa das linhas fechadas'
  end;
  if v_falha is null then
    new.a_completar := false;
  elsif not (new.a_completar and not v_mudou) then
    raise exception '%', v_falha using errcode = '23514';
  end if;
  return new;
end $function$;

-- Recalcula a prioridade de toda a carteira. Gatilhos de usuário desligados: não grava histórico nem mexe em atualizado_em/propostas.
alter table public.renovacao_carteira disable trigger user;
update public.renovacao_carteira set prioridade = public.renovacao_prioridade(apto, fixa_viavel, tem_fixa, linhas_voz)
 where prioridade is distinct from public.renovacao_prioridade(apto, fixa_viavel, tem_fixa, linhas_voz);
alter table public.renovacao_carteira enable trigger user;

commit;
