-- §132 (03/11, Rafael): botão para bloquear todos de pegarem leads e chave por consultor de quem pega.
-- O bloqueio é uma chave à parte (config leads_pegar_bloqueado): não mexe no leads_equipe.pode_pegar, então ao liberar
-- volta a valer a mesma lista. Redistribuir (leads_redistribuir) continua funcionando com o bloqueio ligado.
-- Só admin e supervisor mudam (pelas funções abaixo; a policy de escrita da config e do leads_equipe é só admin).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_pegar_bloqueio_check.sql (ROLLBACK).
begin;

insert into public.config (chave, valor)
select 'leads_pegar_bloqueado', '{"bloqueado":false}'
 where not exists (select 1 from public.config where chave = 'leads_pegar_bloqueado');

create or replace function public.leads_pegar_bloqueado()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((select (c.valor::jsonb ->> 'bloqueado')::boolean from public.config c where c.chave = 'leads_pegar_bloqueado'), false)
$function$;

create or replace function public.leads_pegar_bloquear(p_bloqueado boolean)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v := jsonb_build_object('bloqueado', coalesce(p_bloqueado, false), 'por', (select p.nome from public.profiles p where p.id = auth.uid()), 'em', now());
  update public.config set valor = v::text, atualizado_em = now() where chave = 'leads_pegar_bloqueado';
  if not found then insert into public.config (chave, valor) values ('leads_pegar_bloqueado', v::text); end if;
  return v;
end $function$;

create or replace function public.leads_definir_pode_pegar(p_profile uuid, p_pode boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.leads_equipe set pode_pegar = coalesce(p_pode, false), atualizado_em = now() where profile_id = p_profile;
  if not found then raise exception 'consultor fora da equipe de leads' using errcode = '22023'; end if;
end $function$;

-- leads_pegar igual à §122, mais a trava do bloqueio geral (vale também para aba aberta com o painel antigo).
create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_pode boolean; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha, e.pode_pegar into v_nome, v_pode from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  if not coalesce(v_pode, false) then raise exception 'você não está liberado para pegar leads' using errcode = '42501'; end if;
  if public.leads_pegar_bloqueado() then raise exception 'pegar leads está pausado pelo supervisor' using errcode = '42501'; end if;
  update public.leads l set dono_id = auth.uid(), consultor = v_nome, pego_em = now()
   where l.aba = p_aba and l.id = p_id and l.dono_id is null and l.categoria = 'sem_contato' and l.apagado_em is null;
  get diagnostics n = row_count;
  if n = 0 then
    select coalesce(p.nome, l.consultor) into v_dono
      from public.leads l left join public.profiles p on p.id = l.dono_id
     where l.aba = p_aba and l.id = p_id;
    if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', false, 'dono', coalesce(v_dono, 'outra pessoa'));
  end if;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'pegar', auth.uid(), jsonb_build_object('consultor', v_nome));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor', v_nome);
end $function$;

revoke execute on function public.leads_pegar_bloqueado() from public, anon;
revoke execute on function public.leads_pegar_bloquear(boolean) from public, anon;
revoke execute on function public.leads_definir_pode_pegar(uuid, boolean) from public, anon;
grant execute on function public.leads_pegar_bloqueado() to authenticated;
grant execute on function public.leads_pegar_bloquear(boolean) to authenticated;
grant execute on function public.leads_definir_pode_pegar(uuid, boolean) to authenticated;

commit;
