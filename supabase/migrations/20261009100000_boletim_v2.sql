-- 09/10/2026 — Boletim da Manhã v2 (§77): resumo do dia anterior, sem a lista de ações com check.
-- Spec: docs/superpowers/specs/2026-10-09-boletim-da-manha-v2-design.md. Rollback: supabase/rollback/20261009100000_boletim_v2_rollback.sql.
-- Verificação: supabase/tests/boletim_v2_check.sql (transação com rollback).

-- 1) Sai a lista de ações (tabela e RPCs de marcar/conferir).
drop function if exists public.boletim_marcar_acao(bigint, text, text);
drop function if exists public.boletim_resolver_acoes(jsonb);
drop function if exists public.boletim_gravar(date, date, date, jsonb, jsonb);
drop table if exists public.boletim_acoes;

-- 2) Retrato do dia (p_dia), ou o mais recente antes de p_antes, ou o mais recente de todos — sem ações.
create or replace function public.boletim_obter(p_dia date default null, p_antes date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_dia date;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_dia := case when p_dia is not null then p_dia
                when p_antes is not null then (select max(r.dia) from public.boletim_retratos r where r.dia < p_antes)
                else (select max(r.dia) from public.boletim_retratos r) end;
  if v_dia is null then return null; end if;
  return (
    select jsonb_build_object('dia', b.dia, 'periodo_de', b.periodo_de, 'periodo_ate', b.periodo_ate, 'gerado_em', b.gerado_em,
      'gerado_por_nome', (select pf.nome from public.profiles pf where pf.id = b.gerado_por), 'retrato', b.retrato)
      from public.boletim_retratos b where b.dia = v_dia);
end $$;

-- 3) Grava o boletim do dia: só hoje (SP), só em dia útil, só depois de config.boletim.hora. "Primeiro ganha".
create or replace function public.boletim_gravar(p_dia date, p_de date, p_ate date, p_retrato jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_cfg jsonb;
  v_hora time;
  n int;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  begin
    v_cfg := (select c.valor::jsonb from public.config c where c.chave = 'boletim');
  exception when others then v_cfg := null;
  end;
  v_hora := coalesce(nullif(v_cfg ->> 'hora', '')::time, time '10:00');
  if p_dia is distinct from v_agora::date then
    raise exception 'o boletim só pode ser gravado no próprio dia' using errcode = '22023';
  end if;
  if not public.boletim_dia_util(p_dia) then
    raise exception 'hoje não é dia útil' using errcode = '22023';
  end if;
  if v_agora::time < v_hora then
    raise exception 'o boletim de hoje sai às %', to_char(v_hora, 'HH24:MI') using errcode = '22023';
  end if;
  if p_retrato is null or jsonb_typeof(p_retrato) <> 'object' or p_de is null or p_ate is null then
    raise exception 'retrato inválido' using errcode = '22023';
  end if;
  insert into public.boletim_retratos (dia, periodo_de, periodo_ate, retrato, gerado_por)
    values (p_dia, p_de, p_ate, p_retrato, auth.uid())
    on conflict (dia) do nothing;
  get diagnostics n = row_count;
  return public.boletim_obter(p_dia, null) || jsonb_build_object('gravou', n > 0);
end $$;
revoke all on function public.boletim_gravar(date, date, date, jsonb) from public, anon;
grant execute on function public.boletim_gravar(date, date, date, jsonb) to authenticated;
revoke all on function public.boletim_obter(date, date) from public, anon;
grant execute on function public.boletim_obter(date, date) to authenticated;
