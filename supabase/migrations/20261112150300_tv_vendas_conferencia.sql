-- §149 TV Vendas — parte 4: a NEO confere depois, sem tirar comemoração do ar.
-- A cada 30 min (8h–21h de SP): venda pendente com pedido no NEO no mesmo CNPJ, entre o dia da marcação e +3 dias úteis
-- (sem perdido/devolvido; GROSS já não entra, §49) → confirmada; passou do prazo → nao_encontrada. Nada é cancelado
-- sozinho: o gestor decide no bloco Conferência. Fora da sync-producao de propósito (§81 pendente).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/tv_vendas_conferencia_check.sql.
begin;

create index if not exists idx_producao_neo_cnpj on public.producao_pedidos_neo (cnpj);

create or replace function public.tv_dia_util_mais(p_dia date, p_n int)
 returns date language plpgsql immutable set search_path to 'public'
as $function$
declare d date := p_dia; k int := 0;
begin
  while k < p_n loop
    d := d + 1;
    if public.boletim_dia_util(d) then k := k + 1; end if;
  end loop;
  return d;
end $function$;

create or replace function public.vendas_conferir_neo()
 returns int language plpgsql security definer set search_path to 'public'
as $function$
declare v record; v_n int := 0; v_hoje date := public.tv_hoje(); v_prazo date;
        v_ped text; v_rec numeric; v_usu text;
begin
  for v in
    select x.id, x.cnpj, x.dia from public.vendas_marcadas x
     where x.neo_status = 'pendente' and x.cancelada_em is null
     order by x.id for update skip locked
  loop
    v_prazo := public.tv_dia_util_mais(v.dia, 3);
    v_ped := null; v_rec := null; v_usu := null;
    if v.cnpj is not null then
      select n.numero_pedido, round(sum(coalesce(n.valor, 0)), 2), min(n.usuario)
        into v_ped, v_rec, v_usu
        from public.producao_pedidos_neo n
       where n.cnpj = v.cnpj and n.numero_pedido is not null
         and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
         and (n.cadastro at time zone 'America/Sao_Paulo')::date between v.dia and v_prazo
       group by n.numero_pedido
       order by min(n.cadastro)
       limit 1;
    end if;
    if v_ped is not null then
      update public.vendas_marcadas set neo_status = 'confirmada', neo_pedido = v_ped, neo_receita = v_rec,
             neo_usuario = v_usu, neo_conferida_em = now() where id = v.id;
      v_n := v_n + 1;
    elsif v_hoje > v_prazo then
      update public.vendas_marcadas set neo_status = 'nao_encontrada', neo_conferida_em = now() where id = v.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $function$;

create or replace function public.tv_conferencia()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.dia desc, x.id desc) from (
      select v.id, v.dia, v.cnpj, v.receita, v.origem, v.neo_status, v.neo_pedido, v.neo_receita, v.neo_usuario, p.nome,
             case
               when v.neo_status = 'nao_encontrada' then 'Sem pedido na NEO em 3 dias úteis'
               when v.neo_receita is not null and v.receita > 0 and abs(v.neo_receita - v.receita) > 0.2 * v.receita
                 then 'Receita da NEO diferente (mais de 20%)'
               when v.neo_usuario is not null and position(lower(split_part(p.nome, ' ', 1)) in lower(v.neo_usuario)) = 0
                 then 'Pedido na NEO de outro usuário'
             end as aviso
        from public.vendas_marcadas v join public.profiles p on p.id = v.consultor_id
       where v.operacao = 'apex' and v.cancelada_em is null and v.neo_obs is null
         and v.neo_status in ('nao_encontrada', 'confirmada') and v.dia >= public.tv_hoje() - 45
    ) x where x.aviso is not null), '[]'::jsonb);
end $function$;

create or replace function public.vendas_conferencia_decidir(p_id bigint, p_acao text, p_motivo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v record;
begin
  if not public.tv_eh_gestor() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_acao is null or p_acao not in ('cancelar', 'ok') then raise exception 'ação inválida' using errcode = '22023'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023'; end if;
  select * into v from public.vendas_marcadas where id = p_id for update;
  if not found then raise exception 'venda não encontrada' using errcode = 'P0002'; end if;
  if p_acao = 'cancelar' then
    if v.origem = 'lead' then raise exception 'Venda de lead: mude o status do lead para tirar a venda.' using errcode = '22023'; end if;
    update public.vendas_marcadas set cancelada_em = now(), cancelada_por = auth.uid(), motivo_cancel = trim(p_motivo),
           neo_obs = trim(p_motivo) where id = p_id;
  else
    update public.vendas_marcadas
       set neo_status = case when neo_status = 'nao_encontrada' then 'ok_gestor' else neo_status end, neo_obs = trim(p_motivo)
     where id = p_id;
  end if;
end $function$;

revoke all on function public.tv_dia_util_mais(date, int) from public, anon, authenticated;
revoke all on function public.vendas_conferir_neo() from public, anon, authenticated;
revoke all on function public.tv_conferencia() from public, anon;
revoke all on function public.vendas_conferencia_decidir(bigint, text, text) from public, anon;
grant execute on function public.tv_conferencia() to authenticated;
grant execute on function public.vendas_conferencia_decidir(bigint, text, text) to authenticated;

-- 8h25–20h55 de SP (cron em UTC)
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'tv-vendas-conferir-neo') then
    perform cron.schedule('tv-vendas-conferir-neo', '25,55 11-23 * * *', 'select public.vendas_conferir_neo()');
  end if;
end $$;

commit;
