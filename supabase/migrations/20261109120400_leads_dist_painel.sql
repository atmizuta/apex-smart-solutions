-- §146.1: Equipe — leitura (leads_dist_equipe) e configuração (leads_dist_config) da distribuição. Só admin e supervisor.
-- Spec §10–§11. Sem DROP. Check: supabase/tests/leads_dist_painel_check.sql.
begin;

-- Recusa configuração impossível (22023, mensagem curta para o painel mostrar).
create or replace function public.leads_dist_validar(p jsonb)
 returns void language plpgsql immutable set search_path to 'public'
as $function$
declare d jsonb := p -> 'expediente'; x text;
begin
  if coalesce(p ->> 'modo', '') not in ('manual', 'sombra', 'automatico') then raise exception 'modo inválido' using errcode = '22023'; end if;
  if (p ->> 'peso_conversao')::numeric not between 0 and 1 then raise exception 'peso da conversão entre 0 e 100%%' using errcode = '22023'; end if;
  if (p ->> 'piso')::numeric not between 0 and 0.30 then raise exception 'piso entre 0 e 30%%' using errcode = '22023'; end if;
  if (p ->> 'teto')::numeric not between 0.20 and 1 then raise exception 'teto entre 20%% e 100%%' using errcode = '22023'; end if;
  if (p ->> 'piso')::numeric >= (p ->> 'teto')::numeric then raise exception 'piso precisa ser menor que o teto' using errcode = '22023'; end if;
  if (p ->> 'prazo_atender_min')::int not between 1 and 60 then raise exception 'prazo para atender entre 1 e 60 min' using errcode = '22023'; end if;
  if (p ->> 'prazo_devolver_min')::int <= (p ->> 'prazo_atender_min')::int or (p ->> 'prazo_devolver_min')::int > 120 then
    raise exception 'prazo para devolver maior que o de atender e até 120 min' using errcode = '22023'; end if;
  if (p ->> 'confirmar_min')::int not between 5 and 120 then raise exception 'confirmação entre 5 e 120 min' using errcode = '22023'; end if;
  if (p ->> 'janela_dias')::int not between 3 and 60 then raise exception 'janela entre 3 e 60 dias' using errcode = '22023'; end if;
  if (p ->> 'maturacao_dias')::int not between 0 and 7 then raise exception 'maturação entre 0 e 7 dias' using errcode = '22023'; end if;
  if (p ->> 'pausa_min')::int not between 5 and 240 then raise exception 'pausa entre 5 e 240 min' using errcode = '22023'; end if;
  if (p ->> 'presenca_min')::int not between 2 and 30 then raise exception 'presença entre 2 e 30 min' using errcode = '22023'; end if;
  if (p ->> 'max_devolucoes')::int not between 1 and 5 then raise exception 'devoluções entre 1 e 5' using errcode = '22023'; end if;
  if jsonb_typeof(d -> 'dias') <> 'array' then raise exception 'dias do expediente inválidos' using errcode = '22023'; end if;
  for x in select jsonb_array_elements_text(d -> 'dias') loop
    if x !~ '^[1-7]$' then raise exception 'dias do expediente vão de 1 (seg) a 7 (dom)' using errcode = '22023'; end if;
  end loop;
  if (d ->> 'inicio')::time >= (d ->> 'fim')::time and d ->> 'fim' <> '24:00' then raise exception 'início do expediente antes do fim' using errcode = '22023'; end if;
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'valor inválido na configuração' using errcode = '22023';
end $function$;

create or replace function public.leads_dist_config(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare k text; v jsonb; v_antes text := public.leads_dist_cfg() ->> 'modo';
  permitidas text[] := array['modo', 'peso_conversao', 'piso', 'teto', 'prazo_atender_min', 'prazo_devolver_min', 'confirmar_min',
                             'janela_dias', 'maturacao_dias', 'pausa_min', 'presenca_min', 'max_devolucoes', 'expediente'];
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then raise exception 'configuração inválida' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if not (k = any(permitidas)) then raise exception 'parâmetro desconhecido: %', k using errcode = '22023'; end if;
  end loop;
  perform public.leads_dist_validar(public.leads_dist_cfg() || p);
  select coalesce(c.valor::jsonb, '{}'::jsonb) into v from public.config c where c.chave = 'leads_distribuicao';
  v := coalesce(v, '{}'::jsonb) || p || jsonb_build_object('alterado_por', (select pr.nome from public.profiles pr where pr.id = auth.uid()), 'alterado_em', now());
  update public.config set valor = v::text, atualizado_em = now() where chave = 'leads_distribuicao';
  if not found then insert into public.config (chave, valor) values ('leads_distribuicao', v::text); end if;
  if p ? 'modo' and p ->> 'modo' is distinct from v_antes then
    update public.leads_distribuicao set fechado_em = now() where consultor_id is null and fechado_em is null;
  end if;
  return public.leads_dist_cfg();
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
                                     and d.atendido_em is null and d.recebido_em > now() - v_dev) then 'pendente'
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

revoke execute on function public.leads_dist_validar(jsonb) from public, anon, authenticated;
revoke execute on function public.leads_dist_config(jsonb) from public, anon;
revoke execute on function public.leads_dist_equipe(int) from public, anon;
grant execute on function public.leads_dist_config(jsonb) to authenticated;
grant execute on function public.leads_dist_equipe(int) to authenticated;

commit;
