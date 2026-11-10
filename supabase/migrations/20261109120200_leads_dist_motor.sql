-- §146.1: motor da distribuição (rodízio ponderado com trava de pendência) e modo sombra. Spec §5.
-- Sem DROP. Check: supabase/tests/leads_dist_motor_check.sql.
begin;

-- Quem está na vez e quem recebe: maior déficit = fatia × (recebidos de hoje + 1) − recebidos dele hoje.
-- Empate: quem recebeu o último há mais tempo. Só entre os ativos hoje (abriram o painel hoje).
create or replace function public.leads_dist_escolher(p_excluir uuid[], p_agora timestamptz default now())
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare c jsonb := public.leads_dist_cfg();
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
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
                        and d.atendido_em is null and d.recebido_em > p_agora - v_dev) then 'pendente'
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

-- Motor: chamado por leads_entrada2 (lead novo) e pelo tick (fila). Um lead por vez (trava de transação).
create or replace function public.leads_distribuir(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := c ->> 'modo';
  v_fila public.leads_distribuicao; v_esc jsonb; v_id uuid; v_nome text; n int;
begin
  if coalesce(v_modo, 'manual') not in ('sombra', 'automatico') then return jsonb_build_object('ok', false, 'motivo', 'manual'); end if;
  perform pg_advisory_xact_lock(hashtext('leads_distribuir'));
  select * into v_fila from public.leads_distribuicao d where d.lead_aba = p_aba and d.lead_id = p_id and d.fechado_em is null;
  if not exists (select 1 from public.leads l where l.aba = p_aba and l.id = p_id and l.dono_id is null
                    and l.apagado_em is null and l.categoria = 'sem_contato') then
    if v_fila.id is not null and v_fila.consultor_id is null then
      update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;   -- pego/apagado por fora: sai da fila
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel');
  end if;
  if v_fila.id is null then
    insert into public.leads_distribuicao (lead_aba, lead_id) values (p_aba, p_id) returning * into v_fila;
  end if;
  if not public.leads_dist_no_expediente(now()) then return jsonb_build_object('ok', false, 'motivo', 'fora_do_expediente'); end if;
  if public.leads_pegar_bloqueado() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  v_esc := public.leads_dist_escolher(v_fila.excluidos);
  v_id := (v_esc ->> 'escolhido')::uuid;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'ninguem_na_vez'); end if;
  if v_modo = 'sombra' then
    insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido, motivo) values (p_aba, p_id, v_id, v_esc)
    on conflict (lead_aba, lead_id) do nothing;
    return jsonb_build_object('ok', true, 'sombra', true, 'consultor_id', v_id);
  end if;
  v_nome := v_esc ->> 'nome';
  update public.leads set dono_id = v_id, consultor = v_nome, pego_em = now()
   where aba = p_aba and id = p_id and dono_id is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel'); end if;
  update public.leads_distribuicao set consultor_id = v_id, tipo = 'auto', recebido_em = now(), motivo = v_esc where id = v_fila.id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'redistribuir', null, jsonb_build_object('consultor', v_nome, 'dono_id', v_id, 'auto', true));   -- §146: a restrição de ação não tem 'distribuir'; por nulo + auto = motor
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor_id', v_id, 'consultor', v_nome);
end $function$;

revoke execute on function public.leads_dist_escolher(uuid[], timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_distribuir(text, text) from public, anon, authenticated;

commit;
