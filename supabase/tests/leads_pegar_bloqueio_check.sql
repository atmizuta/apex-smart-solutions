-- §132: conferência da migration 20261103180000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'.

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

do $$
declare
  v_admin uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_cons uuid := (select profile_id from public.leads_equipe where pode_pegar order by id limit 1);
  v_l1 record; v_l2 record; v_out text := ''; r jsonb;
begin
  select aba, id into v_l1 from public.leads where dono_id is null and categoria = 'sem_contato' and apagado_em is null order by criado_em_lead desc limit 1;
  select aba, id into v_l2 from public.leads where dono_id is null and categoria = 'sem_contato' and apagado_em is null order by criado_em_lead desc offset 1 limit 1;
  -- 1. consultor não bloqueia
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.leads_pegar_bloquear(true); v_out := v_out || '1 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1 ok; ' else '1 FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_definir_pode_pegar(v_cons, false); v_out := v_out || '1b FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1b ok; ' else '1b FALHOU ' || sqlerrm || '; ' end; end;
  -- 2. admin bloqueia
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  r := public.leads_pegar_bloquear(true);
  v_out := v_out || case when public.leads_pegar_bloqueado() and (r ->> 'por') is not null then '2 ok; ' else '2 FALHOU; ' end;
  -- 3. consultor liberado não pega com o bloqueio
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.leads_pegar(v_l1.aba, v_l1.id); v_out := v_out || '3 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm like '%pausado%' then '3 ok; ' else '3 FALHOU ' || sqlerrm || '; ' end; end;
  -- 4. gestor redistribui com o bloqueio ligado
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.leads_redistribuir(v_l2.aba, v_l2.id, v_cons);
  v_out := v_out || case when (select dono_id from public.leads where aba = v_l2.aba and id = v_l2.id) = v_cons then '4 ok; ' else '4 FALHOU; ' end;
  -- 5. libera e o consultor pega
  perform public.leads_pegar_bloquear(false);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  r := public.leads_pegar(v_l1.aba, v_l1.id);
  v_out := v_out || case when (r ->> 'ok')::boolean then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. tirar o pode_pegar de um consultor
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.leads_definir_pode_pegar(v_cons, false);
  v_out := v_out || case when not (select bool_or(pode_pegar) from public.leads_equipe where profile_id = v_cons) then '6 ok; ' else '6 FALHOU; ' end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.leads_pegar(v_l2.aba, v_l2.id); v_out := v_out || '6b FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm like '%não está liberado%' then '6b ok; ' else '6b FALHOU ' || sqlerrm || '; ' end; end;
  -- 7. consultor fora da equipe
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin perform public.leads_definir_pode_pegar(gen_random_uuid(), true); v_out := v_out || '7 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm like '%fora da equipe%' then '7 ok' else '7 FALHOU ' || sqlerrm end; end;
  raise exception 'RESULTADO: %', v_out;
end $$;
