-- §149.2 (12/11, Rafael): "não estou conseguindo colocar o motivo quando clico em desfazer". O Desfazer manda sem motivo
-- e o banco tratava admin/supervisor sempre como gestor (motivo obrigatório), mesmo desfazendo a própria venda.
-- Agora: quem marcou desfaz em até 10 min sem precisar de motivo (opcional, guardado se vier); depois disso, ou venda de
-- outra pessoa, só gestor e com motivo. Nova tv_vendas_hoje(): lista do dia para o gestor cancelar venda errada.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_vendas_desfazer_check.sql.
begin;

create or replace function public.vendi_cancelar(p_id bigint, p_motivo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v record; v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into v from public.vendas_marcadas where id = p_id for update;
  if not found then raise exception 'venda não encontrada' using errcode = 'P0002'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada.' using errcode = '22023'; end if;
  if v.origem = 'lead' then raise exception 'Venda de lead: mude o status do lead para tirar a venda.' using errcode = '22023'; end if;
  if v.consultor_id = auth.uid() and now() - v.marcada_em <= interval '10 minutes' then
    null;   -- quem marcou, dentro dos 10 min: motivo opcional
  elsif public.tv_eh_gestor() then
    if length(coalesce(v_motivo, '')) < 3 then raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023'; end if;
  elsif v.consultor_id = auth.uid() then
    raise exception 'Passou de 10 minutos: peça ao gestor para cancelar.' using errcode = '42501';
  else
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.vendas_marcadas
     set cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancel = coalesce(v_motivo, 'desfeito pelo consultor')
   where id = p_id;
end $function$;

create or replace function public.tv_vendas_hoje()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', v.id, 'em', v.marcada_em, 'nome', p.nome, 'origem', v.origem, 'cnpj', v.cnpj,
             'linhas', v.linhas, 'receita', v.receita, 'cancelada', v.cancelada_em is not null, 'motivo', v.motivo_cancel)
             order by v.id desc)
      from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
     where v.operacao = 'apex' and v.dia = public.tv_hoje()), '[]'::jsonb);
end $function$;

revoke all on function public.tv_vendas_hoje() from public, anon;
grant execute on function public.tv_vendas_hoje() to authenticated;

commit;
