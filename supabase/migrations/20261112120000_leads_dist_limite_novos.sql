-- §146.4 (12/11, Rafael): "aplica o limite de até 2 em meus novos". Com a regra da §146.3 (qualquer lead em Meus novos tira
-- da vez) a fila travou: todos tinham ao menos 1 lead sem status. Agora o consultor recebe enquanto tiver MENOS que
-- config.leads_distribuicao.max_meus_novos (padrão 2) leads em Meus novos; com 2 fica fora da vez até tabular.
-- Sem DROP. Check: supabase/tests/leads_dist_limite_novos_check.sql.
begin;

create or replace function public.leads_dist_escolher(p_excluir uuid[], p_agora timestamptz default now())
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare c jsonb := public.leads_dist_cfg();
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_atender interval := make_interval(mins => (c ->> 'prazo_atender_min')::int);
  v_sombra boolean := c ->> 'modo' = 'sombra';
  v_total int; v_lista jsonb; v_id uuid; v_nome text;
begin
  select coalesce(sum(n.recebidos_hoje), 0) into v_total from public.leads_dist_notas(p_agora) n where n.ativo;
  with n as (select * from public.leads_dist_notas(p_agora) x where x.ativo),
  est as (
    select n.consultor_id, n.nome, n.fatia, n.recebidos_hoje, n.ultimo_recebido,
      case
        when n.consultor_id = any(coalesce(p_excluir, '{}'::uuid[])) then 'perdeu_este'
        when p.visto_em is null or p.visto_em < p_agora - v_pres then 'offline'
        when p.pausa_ate > p_agora then 'pausa'
        when exists (select 1 from public.leads_distribuicao d
                      where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                        and d.atendido_em is null and d.recebido_em > p_agora - v_dev)
          or (select count(*) from public.leads l2 where l2.dono_id = n.consultor_id and l2.categoria = 'sem_contato' and l2.apagado_em is null) >= coalesce((c ->> 'max_meus_novos')::int, 2)   -- §146.4: limite de leads em Meus novos (padrão 2)
          or (v_sombra and exists (select 1 from public.leads_dist_sombra s
                                    where s.escolhido = n.consultor_id and s.em > p_agora - v_atender)) then 'pendente'
        else 'na_vez' end estado,
      n.fatia * (v_total + 1) - n.recebidos_hoje deficit
    from n left join public.leads_presenca p on p.profile_id = n.consultor_id)
  select jsonb_agg(jsonb_build_object('consultor_id', est.consultor_id, 'nome', est.nome, 'estado', est.estado, 'fatia', est.fatia,
                     'recebidos_hoje', est.recebidos_hoje, 'deficit', round(est.deficit, 3)) order by est.deficit desc),
         (array_agg(est.consultor_id order by est.deficit desc, est.ultimo_recebido asc nulls first) filter (where est.estado = 'na_vez'))[1]
    into v_lista, v_id from est;
  if v_id is not null then select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = v_id order by e.id limit 1; end if;
  return jsonb_build_object('escolhido', v_id, 'nome', v_nome, 'total_hoje', v_total, 'consultores', coalesce(v_lista, '[]'::jsonb));
end $function$;

create or replace function public.leads_dist_meu()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); n record; p public.leads_presenca;
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_total int; v_estado text;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into n from public.leads_dist_notas() x where x.consultor_id = auth.uid();
  if not found then return jsonb_build_object('grupo', false, 'modo', c ->> 'modo'); end if;
  select * into p from public.leads_presenca where profile_id = auth.uid();
  select coalesce(sum(x.recebidos_hoje), 0) into v_total from public.leads_dist_notas() x where x.ativo;
  v_estado := case when not public.leads_dist_no_expediente(now()) then 'fora'
                   when p.pausa_ate > now() then 'pausa'
                   when exists (select 1 from public.leads_distribuicao d
                                 where d.consultor_id = auth.uid() and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                                   and d.atendido_em is null and d.recebido_em > now() - v_dev)
                   or (select count(*) from public.leads l2 where l2.dono_id = auth.uid() and l2.categoria = 'sem_contato' and l2.apagado_em is null) >= coalesce((c ->> 'max_meus_novos')::int, 2) then 'pendente'   -- §146.4: limite de leads em Meus novos (padrão 2)
                   when p.visto_em is null or p.visto_em < now() - v_pres then 'offline'
                   else 'na_vez' end;
  return jsonb_build_object('grupo', true, 'modo', c ->> 'modo', 'estado', v_estado,
    'pausa_ate', case when p.pausa_ate > now() then p.pausa_ate end,
    'rapidos_ok', n.vel_ok, 'rapidos_n', n.vel_n, 'conv', n.conv, 'fatia', n.fatia, 'recebidos_hoje', n.recebidos_hoje,
    'alvo_hoje', case when n.fatia is null then null else round(n.fatia * greatest(v_total, n.recebidos_hoje))::int end,
    'entrega', public.leads_dist_entrega_aberta(auth.uid()));
end $function$;

create or replace function public.leads_dist_equipe(p_dias int default 1)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg();
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini_hoje timestamptz := v_hoje::timestamp at time zone 'America/Sao_Paulo';
  v_desde timestamptz := (v_hoje - (greatest(coalesce(p_dias, 1), 1) - 1))::timestamp at time zone 'America/Sao_Paulo';
  v_exp boolean := public.leads_dist_no_expediente(now());
  v_cons jsonb; v_aviso jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(cf.valor::jsonb, '{}'::jsonb) into v_aviso from public.config cf where cf.chave = 'leads_distribuicao_aviso';
  select jsonb_agg(jsonb_build_object(
      'consultor_id', n.consultor_id, 'nome', n.nome, 'ativo', n.ativo,
      'estado', case when not v_exp then 'fora'
                     when p.visto_em is null or p.visto_em < now() - v_pres then 'offline'
                     when p.pausa_ate > now() then 'pausa'
                     when exists (select 1 from public.leads_distribuicao d
                                   where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                                     and d.atendido_em is null and d.recebido_em > now() - v_dev)
                     or (select count(*) from public.leads l2 where l2.dono_id = n.consultor_id and l2.categoria = 'sem_contato' and l2.apagado_em is null) >= coalesce((c ->> 'max_meus_novos')::int, 2) then 'pendente'   -- §146.4: limite de leads em Meus novos (padrão 2)
                     else 'na_vez' end,
      'pausa_ate', case when p.pausa_ate > now() then p.pausa_ate end,
      'conv', n.conv, 'vel', n.vel, 'nota', n.nota, 'fatia', n.fatia, 'recebidos_hoje', n.recebidos_hoje,
      'vel_n', n.vel_n, 'vel_ok', n.vel_ok,
      'devolvidos_hoje', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.devolvido_em >= v_ini_hoje),
      'clicou_nao_ligou', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.confirmado = false
                             and d.atendido_em >= now() - interval '14 days'),
      'teria', (select count(*) from public.leads_dist_sombra s where s.escolhido = n.consultor_id and s.em >= v_desde),
      'recebeu', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou')
                    and d.recebido_em >= v_desde)
    ) order by n.nome) into v_cons
    from public.leads_dist_notas() n left join public.leads_presenca p on p.profile_id = n.consultor_id;
  return jsonb_build_object('cfg', c, 'aviso', coalesce(v_aviso, '{}'::jsonb), 'no_expediente', v_exp,
    'fila', (select count(*) from public.leads_distribuicao d where d.consultor_id is null and d.fechado_em is null),
    'consultores', coalesce(v_cons, '[]'::jsonb));
end $function$;

commit;
