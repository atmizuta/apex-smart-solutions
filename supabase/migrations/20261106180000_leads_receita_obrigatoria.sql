-- §140 (06/11/2026, Rafael): venda só com receita. leads_classificar recusa status de venda (grupo convertido)
-- ou converteu = true sem receita > 0. Igual à versão no ar (20261027100200) + a checagem nova; sem DROP.
create or replace function public.leads_classificar(p_aba text, p_id text, p_status text, p_obs text, p_converteu boolean, p_receita numeric, p_retorno date)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_grupo text; v_dono uuid; v_antes jsonb; v_role text := coalesce(public.get_my_role(), ''); v_manter boolean;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select l.dono_id, jsonb_build_object('status', l.status, 'obs', l.obs, 'converteu', l.converteu, 'receita', l.receita, 'retorno_em', l.retorno_em)
    into v_dono, v_antes
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_role not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select o.grupo into v_grupo from public.leads_status_opcoes o where o.status = p_status and o.ativo;
  if v_grupo is null then raise exception 'status inválido: %', p_status using errcode = '22023'; end if;
  if p_receita is not null and p_receita < 0 then raise exception 'receita negativa' using errcode = '22023'; end if;
  if (coalesce(p_converteu, false) or v_grupo = 'convertido') and coalesce(p_receita, 0) <= 0 then
    raise exception 'informe a receita da venda' using errcode = '22023';
  end if;
  if p_status = 'AGENDADO RETORNO' and p_retorno is null then raise exception 'informe a data do retorno' using errcode = '22023'; end if;
  v_manter := p_status <> 'AGENDADO RETORNO' and v_grupo = 'andamento'
              and exists (select 1 from public.agenda_retornos a where a.lead_aba = p_aba and a.lead_id = p_id and a.status = 'pendente' and a.quando > now());
  update public.leads set
      status = p_status,
      categoria = v_grupo,
      obs = nullif(btrim(coalesce(p_obs, '')), ''),
      converteu = coalesce(p_converteu, false) or v_grupo = 'convertido',
      receita = coalesce(p_receita, 0),
      retorno_em = case when p_status = 'AGENDADO RETORNO' then p_retorno when v_manter then retorno_em end,
      classificado_em = now(),
      classificado_por = auth.uid()
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, 'classificar', auth.uid(), v_antes,
            jsonb_build_object('status', p_status, 'obs', p_obs, 'converteu', coalesce(p_converteu, false) or v_grupo = 'convertido',
                               'receita', coalesce(p_receita, 0), 'retorno_em', p_retorno));
  if p_status = 'AGENDADO RETORNO' then
    perform public.leads_agenda_lead(p_aba, p_id, (p_retorno + time '10:00') at time zone 'America/Sao_Paulo');
  elsif not v_manter then
    update public.agenda_retornos set status = 'feito', feito_em = now(), atualizado_em = now()
     where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $function$;
