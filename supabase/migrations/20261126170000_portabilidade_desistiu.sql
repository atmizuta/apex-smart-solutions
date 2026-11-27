-- Portabilidade: coluna manual "Desistiu / Perdida" com motivo; venda perdida/devolvida do Neo aparece nela (origem 'neo', escondida por filtro no painel).
begin;

alter table public.portabilidade_controle drop constraint if exists portabilidade_controle_etapa_check;
alter table public.portabilidade_controle add constraint portabilidade_controle_etapa_check
  check (etapa in ('aguardando_sms', 'sms_reenviado', 'sem_resposta', 'confirmou', 'desistiu'));
alter table public.portabilidade_controle add column if not exists motivo text check (motivo is null or length(motivo) <= 100);

create or replace function public.portabilidade_quadro(p_mes date default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_ini date := coalesce(date_trunc('month', p_mes)::date, date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date); v_res jsonb;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  with l as (
    select p.item_id, p.numero_pedido, p.cnpj, p.cliente, p.usuario_id, p.usuario, p.etapa, p.cadastro, p.data_portabilidade,
           r.raw->>'numeroTelefoneItem' as tel_item, r.raw->>'ddd' as ddd,
           case when p.etapa ilike 'CONCLUIDO%' then 'portada' when p.etapa ilike 'VENDA PERDIDA%' or p.etapa ilike 'DEVOLVIDO%' then 'encerrada' else 'aberta' end as situacao
      from public.producao_pedidos_neo p left join public.producao_neo_raw r on r.item_id = p.item_id
     where p.grupo = 'VOZ - Portabilidade' and p.cadastro >= v_ini and p.cadastro < (v_ini + interval '1 month')
       and p.cnpj is not null and p.usuario_id is not null and public.portab_pode(p.usuario_id::bigint)
  ), g as (
    select l.cnpj, l.usuario_id::bigint usuario_id, max(l.cliente) cliente, max(l.usuario) usuario, count(*) total,
           count(*) filter (where situacao='aberta') abertas, count(*) filter (where situacao='portada') portadas, count(*) filter (where situacao='encerrada') encerradas,
           min(l.cadastro) primeiro_cadastro,
           jsonb_agg(jsonb_build_object('item_id', l.item_id, 'pedido', l.numero_pedido, 'etapa', l.etapa, 'situacao', l.situacao,
                     'ddd', l.ddd, 'telefone', l.tel_item, 'cadastro', l.cadastro, 'data_portabilidade', l.data_portabilidade) order by l.cadastro, l.item_id) linhas
      from l group by l.cnpj, l.usuario_id)
  select coalesce(jsonb_agg(jsonb_build_object('cnpj', g.cnpj, 'usuario_id', g.usuario_id, 'cliente', g.cliente, 'usuario', g.usuario,
      'total', g.total, 'abertas', g.abertas, 'portadas', g.portadas, 'encerradas', g.encerradas, 'primeiro_cadastro', g.primeiro_cadastro, 'linhas', g.linhas,
      'etapa', case when g.abertas = 0 and g.portadas > 0 then 'portado' when g.abertas = 0 then 'desistiu' else coalesce(c.etapa, 'aguardando_sms') end,
      'origem', case when g.abertas = 0 and g.portadas = 0 then 'neo' else null end,
      'motivo', case when g.abertas = 0 and g.portadas = 0 then 'Venda perdida/devolvida no Neo' else c.motivo end,
      'reenvios', coalesce(c.reenvios, 0), 'proximo_retorno', c.proximo_retorno, 'observacao', c.observacao, 'atualizado_em', c.atualizado_em) order by g.primeiro_cadastro), '[]'::jsonb)
    into v_res from g left join public.portabilidade_controle c on c.cnpj = g.cnpj and c.usuario_id = g.usuario_id;
  return v_res;
end $$;

drop function if exists public.portabilidade_registrar(text, bigint, text, boolean, date, boolean, text);
create or replace function public.portabilidade_registrar(
  p_cnpj text, p_usuario bigint, p_etapa text default null, p_reenviou boolean default false,
  p_retorno date default null, p_limpar_retorno boolean default false, p_observacao text default null, p_motivo text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_old public.portabilidade_controle%rowtype; v_new public.portabilidade_controle%rowtype;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if not public.portab_pode(p_usuario) then raise exception 'sem acesso a este cliente'; end if;
  if p_etapa is not null and p_etapa not in ('aguardando_sms', 'sms_reenviado', 'sem_resposta', 'confirmou', 'desistiu') then raise exception 'etapa inválida'; end if;
  if not exists (select 1 from public.producao_pedidos_neo p where p.cnpj = p_cnpj and p.usuario_id = p_usuario and p.grupo = 'VOZ - Portabilidade') then raise exception 'cliente sem portabilidade'; end if;
  if not exists (select 1 from public.producao_pedidos_neo p where p.cnpj = p_cnpj and p.usuario_id = p_usuario and p.grupo = 'VOZ - Portabilidade'
                    and p.etapa not ilike 'CONCLUIDO%' and p.etapa not ilike 'VENDA PERDIDA%' and p.etapa not ilike 'DEVOLVIDO%') then
    raise exception 'pedido já encerrado no Neo'; end if;
  if p_etapa = 'desistiu' and nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'informe o motivo da desistência'; end if;

  select * into v_old from public.portabilidade_controle where cnpj = p_cnpj and usuario_id = p_usuario;
  if not found then v_old.etapa := 'aguardando_sms'; v_old.reenvios := 0; end if;

  v_new.etapa := coalesce(p_etapa, v_old.etapa);
  v_new.reenvios := v_old.reenvios + case when p_reenviou then 1 else 0 end;
  if p_reenviou and p_etapa is null and v_old.etapa = 'aguardando_sms' then v_new.etapa := 'sms_reenviado'; end if;
  v_new.motivo := case when v_new.etapa = 'desistiu' then coalesce(nullif(btrim(p_motivo), ''), v_old.motivo) else null end;
  v_new.proximo_retorno := case when p_limpar_retorno then null else coalesce(p_retorno, v_old.proximo_retorno) end;
  v_new.observacao := coalesce(nullif(btrim(p_observacao), ''), v_old.observacao);

  insert into public.portabilidade_controle as c (cnpj, usuario_id, etapa, reenvios, proximo_retorno, observacao, motivo, atualizado_em, atualizado_por)
  values (p_cnpj, p_usuario, v_new.etapa, v_new.reenvios, v_new.proximo_retorno, v_new.observacao, v_new.motivo, now(), auth.uid())
  on conflict (cnpj, usuario_id) do update
    set etapa = excluded.etapa, reenvios = excluded.reenvios, proximo_retorno = excluded.proximo_retorno,
        observacao = excluded.observacao, motivo = excluded.motivo, atualizado_em = now(), atualizado_por = auth.uid();

  if v_new.etapa is distinct from v_old.etapa then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, de, para, texto) values (p_cnpj, p_usuario, 'etapa', v_old.etapa, v_new.etapa, v_new.motivo);
  end if;
  if p_reenviou then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto) values (p_cnpj, p_usuario, 'reenvio', 'SMS reenviado (' || v_new.reenvios || 'º)');
  end if;
  if v_new.proximo_retorno is distinct from v_old.proximo_retorno then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto) values (p_cnpj, p_usuario, 'retorno', coalesce(to_char(v_new.proximo_retorno, 'DD/MM/YYYY'), 'removido'));
  end if;
  if v_new.observacao is distinct from v_old.observacao then
    insert into public.portabilidade_historico (cnpj, usuario_id, tipo, texto) values (p_cnpj, p_usuario, 'observacao', v_new.observacao);
  end if;
  return jsonb_build_object('etapa', v_new.etapa, 'reenvios', v_new.reenvios, 'proximo_retorno', v_new.proximo_retorno, 'observacao', v_new.observacao, 'motivo', v_new.motivo);
end $$;

revoke all on function public.portabilidade_registrar(text, bigint, text, boolean, date, boolean, text, text) from public, anon;
grant execute on function public.portabilidade_registrar(text, bigint, text, boolean, date, boolean, text, text) to authenticated;

commit;
