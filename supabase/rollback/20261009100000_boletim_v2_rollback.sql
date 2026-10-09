-- Desfaz 20261009100000_boletim_v2.sql (§77): volta a lista de ações da fase 1 (§76), vazia.
drop function if exists public.boletim_gravar(date, date, date, jsonb);

create table if not exists public.boletim_acoes (
  id bigint generated always as identity primary key,
  dia date not null references public.boletim_retratos(dia) on delete cascade,
  ordem int not null,
  regra text not null,
  chave text not null,
  quem text not null,
  o_que text not null,
  valor numeric not null default 0,
  prazo text not null,
  dias_seguidos int not null default 1,
  status text not null default 'aberta' check (status in ('aberta', 'feita', 'nao_deu')),
  nota text,
  marcado_por uuid,
  marcado_em timestamptz,
  resolvida_em timestamptz,
  desfecho text,
  valor_recuperado numeric not null default 0,
  extra jsonb,                       -- o que a conferência automática precisa (pedido, etapa, chaves de lead etc.)
  unique (dia, regra, chave)
);
alter table public.boletim_acoes enable row level security;
revoke all on public.boletim_acoes from public, anon, authenticated;
grant select on public.boletim_acoes to authenticated;
drop policy if exists boletim_acoes_select on public.boletim_acoes;
create policy boletim_acoes_select on public.boletim_acoes for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));

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
    select jsonb_build_object(
      'dia', b.dia, 'periodo_de', b.periodo_de, 'periodo_ate', b.periodo_ate, 'gerado_em', b.gerado_em,
      'gerado_por_nome', (select pf.nome from public.profiles pf where pf.id = b.gerado_por),
      'retrato', b.retrato,
      'acoes', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'ordem', a.ordem, 'regra', a.regra, 'chave', a.chave, 'quem', a.quem, 'o_que', a.o_que,
          'valor', a.valor, 'prazo', a.prazo, 'dias_seguidos', a.dias_seguidos, 'status', a.status, 'nota', a.nota,
          'marcado_por_nome', (select pf.nome from public.profiles pf where pf.id = a.marcado_por), 'marcado_em', a.marcado_em,
          'resolvida_em', a.resolvida_em, 'desfecho', a.desfecho, 'valor_recuperado', a.valor_recuperado, 'extra', a.extra)
          order by a.ordem) from public.boletim_acoes a where a.dia = b.dia), '[]'::jsonb))
      from public.boletim_retratos b where b.dia = v_dia);
end $$;

create or replace function public.boletim_gravar(p_dia date, p_de date, p_ate date, p_retrato jsonb, p_acoes jsonb)
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
  if n > 0 and p_acoes is not null and jsonb_typeof(p_acoes) = 'array' then
    insert into public.boletim_acoes (dia, ordem, regra, chave, quem, o_que, valor, prazo, dias_seguidos, extra)
    select p_dia, x.ordem, x.regra, x.chave, x.quem, x.o_que, coalesce(x.valor, 0), coalesce(x.prazo, 'hoje'),
           greatest(coalesce(x.dias_seguidos, 1), 1), x.extra
      from jsonb_to_recordset(p_acoes) as x(ordem int, regra text, chave text, quem text, o_que text, valor numeric,
                                             prazo text, dias_seguidos int, extra jsonb);
  end if;
  return public.boletim_obter(p_dia, null) || jsonb_build_object('gravou', n > 0);
end $$;

create or replace function public.boletim_marcar_acao(p_id bigint, p_status text, p_nota text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('feita', 'nao_deu', 'aberta') then
    raise exception 'situação inválida' using errcode = '22023';
  end if;
  update public.boletim_acoes a
     set status = p_status,
         nota = case when p_status = 'aberta' then null else left(nullif(btrim(coalesce(p_nota, '')), ''), 500) end,
         marcado_por = case when p_status = 'aberta' then null else auth.uid() end,
         marcado_em = case when p_status = 'aberta' then null else now() end
   where a.id = p_id and a.dia = (select max(r.dia) from public.boletim_retratos r);
  if not found then
    raise exception 'ação não encontrada ou de um plano antigo' using errcode = '22023';
  end if;
end $$;

create or replace function public.boletim_resolver_acoes(p_itens jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then return; end if;
  update public.boletim_acoes a
     set resolvida_em = now(), desfecho = x.desfecho, valor_recuperado = coalesce(x.valor_recuperado, 0)
    from jsonb_to_recordset(p_itens) as x(id bigint, desfecho text, valor_recuperado numeric)
   where a.id = x.id and a.resolvida_em is null;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['public.boletim_obter(date, date)', 'public.boletim_gravar(date, date, date, jsonb, jsonb)',
                            'public.boletim_marcar_acao(bigint, text, text)', 'public.boletim_resolver_acoes(jsonb)'] loop
    execute 'revoke all on function ' || fn || ' from public, anon';
    execute 'grant execute on function ' || fn || ' to authenticated';
  end loop;
end $$;
