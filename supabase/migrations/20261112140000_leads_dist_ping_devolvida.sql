-- §146.5 (12/11, Rafael): o aviso "voltou aos Livres" passa a vir do banco. A presença devolve também a entrega do consultor
-- devolvida nos últimos 3 minutos ('devolvida'), e o painel avisa uma vez por lead. Sem DROP.
-- Check: supabase/tests/leads_dist_ping_devolvida_check.sql.
begin;

create or replace function public.leads_presenca_ping(p_acao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pausa timestamptz; v_min int := (public.leads_dist_cfg() ->> 'pausa_min')::int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if coalesce(p_acao, '') not in ('', 'pausa', 'voltar') then raise exception 'ação inválida: %', p_acao using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    return jsonb_build_object('equipe', false, 'pausa_ate', null, 'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', null, 'devolvida', null);
  end if;
  insert into public.leads_presenca as p (profile_id, visto_em, pausa_ate)
  values (auth.uid(), now(), case when p_acao = 'pausa' then now() + make_interval(mins => v_min) end)
  on conflict (profile_id) do update set visto_em = now(),
    pausa_ate = case when p_acao = 'pausa' then now() + make_interval(mins => v_min)
                     when p_acao = 'voltar' then null else p.pausa_ate end
  returning p.pausa_ate into v_pausa;
  return jsonb_build_object('equipe', true, 'pausa_ate', case when v_pausa > now() then v_pausa end,
                            'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', public.leads_dist_entrega_aberta(auth.uid()),
                            'devolvida', (select jsonb_build_object('aba', d.lead_aba, 'lead_id', d.lead_id, 'nome', l.full_name, 'devolvido_em', d.devolvido_em)
                                            from public.leads_distribuicao d join public.leads l on l.aba = d.lead_aba and l.id = d.lead_id
                                           where d.consultor_id = auth.uid() and d.devolvido_em > now() - interval '3 minutes'
                                           order by d.devolvido_em desc limit 1));
end $function$;

commit;
