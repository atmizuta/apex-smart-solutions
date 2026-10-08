-- 08/10/2026 — Boletim da Manhã + Plano do dia com check (fase 1). REGRAS_NEGOCIO.md §76.
-- Spec: docs/superpowers/specs/2026-10-08-boletim-da-manha-design.md (seção 5). Aditiva e idempotente:
-- nada que o painel usa hoje muda de assinatura. Rollback: supabase/rollback/20261008100000_boletim_manha_rollback.sql.
-- Verificação: supabase/tests/boletim_manha_check.sql (transação com rollback).

-- 1) "Desde quando o pedido está nesta etapa" num lugar só (antes a mesma expressão estava em
--    producao_meus_pedidos e em mesa_pendencias). Último registro do histórico com a etapa atual; sem
--    histórico, a última atualização.
create or replace function public.producao_na_etapa_desde(p_numero text, p_etapa text, p_atualizacao timestamptz)
returns timestamptz language sql stable set search_path = public as $$
  select coalesce((select max(h.em) from public.producao_etapa_historico h
                    where h.numero_pedido = p_numero and h.etapa_nova = p_etapa), p_atualizacao)
$$;
revoke all on function public.producao_na_etapa_desde(text, text, timestamptz) from public, anon;
grant execute on function public.producao_na_etapa_desde(text, text, timestamptz) to authenticated;

create or replace function public.producao_meus_pedidos(p_consultor uuid default null::uuid)
 returns table(numero_pedido text, grupo text, usuario text, etapa text, cadastro timestamp with time zone, atualizacao timestamp with time zone, valor numeric, quantidade numeric, produto text, cliente text, cnpj text, tag text, data_portabilidade timestamp with time zone, data_instalacao timestamp with time zone, na_etapa_desde timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_neo bigint := public.producao_dono_neo(p_consultor);
begin
  if v_neo is null then return; end if;
  return query
    select n.numero_pedido, n.grupo, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade,
           n.produto, n.cliente, n.cnpj, n.tag, n.data_portabilidade, n.data_instalacao,
           public.producao_na_etapa_desde(n.numero_pedido, n.etapa, n.atualizacao)
      from public.producao_pedidos_neo n
     where n.usuario_id = v_neo
       and ( n.etapa not in ('VENDA PERDIDA (NEOCRM)','CONCLUIDO (NEOCRM)','DEVOLVIDO (NEOCRM)')
             or coalesce(n.atualizacao, n.cadastro) >= now() - interval '120 days' )
     order by n.numero_pedido, n.item_id;
end $function$;

create or replace function public.mesa_pendencias(p_ref date)
 returns table(profile_id uuid, nome text, tipo text, ref text, titulo text, desde timestamp with time zone, extra jsonb)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_ref_ts timestamptz := (p_ref::timestamp at time zone 'America/Sao_Paulo');
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  select p.id, p.nome, 'consultor'::text, null::text, null::text, null::timestamptz, null::jsonb
    from public.profiles p where p.role = 'consultor'
  union all
  select f.consultor_id, p.nome, 'retorno_atrasado'::text, f.lead_id, coalesce(ld.full_name, '(lead sem nome)'),
         (f.data_prevista::timestamp at time zone 'America/Sao_Paulo'), jsonb_build_object('tipo', f.tipo)
    from public.leads_followups f
    join public.profiles p on p.id = f.consultor_id
    left join lateral (select x.full_name from public.leads x where x.id = f.lead_id order by x.criado_em_lead desc limit 1) ld on true
   where not f.feito and f.data_prevista < p_ref
  union all
  select e.profile_id, p.nome, 'lead_esfriando'::text, l.aba || '|' || l.id, coalesce(l.full_name, '(lead sem nome)'),
         t.ultimo, jsonb_build_object('aba', l.aba, 'status', l.status)
    from public.leads l
    join public.leads_equipe e on e.profile_id is not null and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor)
    join public.profiles p on p.id = e.profile_id
    cross join lateral (select greatest(l.criado_em_lead,
             (select max(c.em) from public.leads_contatos c where c.lead_aba = l.aba and c.lead_id = l.id),
             (select max(m.gerada_em) from public.ligacoes_manuais m
               where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number))) as ultimo) t
   where coalesce(l.aba, '') <> 'REPIQUE' and l.categoria in ('andamento', 'sem_contato')
     and t.ultimo < v_ref_ts - interval '5 days'
  union all
  select pr.consultor_id, p.nome, 'proposta_parada'::text, pr.id::text, coalesce(pr.cliente_nome, '(sem nome)'),
         pr.estagio_entrada_em, jsonb_build_object('estagio', pr.estagio, 'valor', pr.valor_proposto)
    from public.propostas pr join public.profiles p on p.id = pr.consultor_id
   where pr.estagio in ('proposta_enviada', 'negociacao') and pr.estagio_entrada_em < v_ref_ts - interval '7 days'
  union all
  select cn.profile_id, p.nome, 'pedido_risco'::text, x.numero_pedido, coalesce(x.cliente, '(sem cliente)'),
         public.producao_na_etapa_desde(x.numero_pedido, x.etapa, x.atualizacao),
         jsonb_build_object('etapa', x.etapa, 'valor', x.valor)
    from (select n.numero_pedido, n.usuario_id, n.etapa, max(n.cliente) as cliente, max(n.atualizacao) as atualizacao, sum(n.valor) as valor
            from public.producao_pedidos_neo n
           where n.numero_pedido is not null
             and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'CONCLUIDO (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
           group by n.numero_pedido, n.usuario_id, n.etapa) x
    join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
    join public.profiles p on p.id = cn.profile_id;
end $function$;

-- 2) Dia útil = seg–sex sem feriado nacional (mesma lista de ppFeriados no painel; Páscoa pelo mesmo algoritmo).
create or replace function public.boletim_dia_util(p_dia date)
returns boolean language plpgsql immutable set search_path = public as $$
declare
  ano int := extract(year from p_dia)::int;
  a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; v_mes int; v_dia int; pascoa date;
begin
  if p_dia is null or extract(isodow from p_dia) > 5 then return false; end if;
  if to_char(p_dia, 'MM-DD') in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25') then return false; end if;
  a := ano % 19; b := ano / 100; c := ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25;
  g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  v_mes := (h + l - 7 * m + 114) / 31; v_dia := ((h + l - 7 * m + 114) % 31) + 1;
  pascoa := make_date(ano, v_mes, v_dia);
  -- mesmos deslocamentos de ppFeriados/getBrazilianHolidays (−47, −46, −2, +60): o banco não pode divergir do painel
  if p_dia in (pascoa - 47, pascoa - 46, pascoa - 2, pascoa + 60) then return false; end if;
  return true;
end $$;

-- 3) Tabelas. Escrita só pelas RPCs abaixo (nenhum insert/update/delete direto).
create table if not exists public.boletim_retratos (
  dia date primary key,
  periodo_de date not null,
  periodo_ate date not null,
  retrato jsonb not null,
  gerado_em timestamptz not null default now(),
  gerado_por uuid not null
);
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
alter table public.boletim_retratos enable row level security;
alter table public.boletim_acoes enable row level security;
revoke all on public.boletim_retratos, public.boletim_acoes from public, anon, authenticated;
grant select on public.boletim_retratos, public.boletim_acoes to authenticated;
drop policy if exists boletim_retratos_select on public.boletim_retratos;
create policy boletim_retratos_select on public.boletim_retratos for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));
drop policy if exists boletim_acoes_select on public.boletim_acoes;
create policy boletim_acoes_select on public.boletim_acoes for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));

-- 4) RPCs
-- Retrato + ações de um dia (p_dia), ou o mais recente antes de p_antes, ou o mais recente de todos.
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

-- Grava o boletim do dia: só hoje (SP), só em dia útil, só depois de config.boletim.hora. "Primeiro ganha":
-- se outra pessoa já gravou, nada muda e volta o dela.
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

-- Marca (feita / não deu) ou desfaz (aberta). Só ações do plano mais recente.
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

-- Conferência automática: só preenche quem ainda não foi resolvida (nunca sobrescreve).
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

-- Linhas de pedido de TODOS os consultores (mesmo formato de producao_meus_pedidos + usuario_id, criado_em, item_id).
create or replace function public.boletim_pedidos()
 returns table(numero_pedido text, grupo text, usuario text, etapa text, cadastro timestamptz, atualizacao timestamptz,
               valor numeric, quantidade numeric, produto text, cliente text, cnpj text, tag text,
               data_portabilidade timestamptz, data_instalacao timestamptz, na_etapa_desde timestamptz,
               usuario_id bigint, criado_em timestamptz, item_id bigint)
 language plpgsql stable security definer set search_path = public
as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select n.numero_pedido, n.grupo, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade,
           n.produto, n.cliente, n.cnpj, n.tag, n.data_portabilidade, n.data_instalacao,
           public.producao_na_etapa_desde(n.numero_pedido, n.etapa, n.atualizacao),
           n.usuario_id, n.criado_em, n.item_id
      from public.producao_pedidos_neo n
     where ( n.etapa not in ('VENDA PERDIDA (NEOCRM)','CONCLUIDO (NEOCRM)','DEVOLVIDO (NEOCRM)')
             or coalesce(n.atualizacao, n.cadastro) >= now() - interval '120 days' )
     order by n.numero_pedido, n.item_id;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['public.boletim_obter(date, date)', 'public.boletim_gravar(date, date, date, jsonb, jsonb)',
                            'public.boletim_marcar_acao(bigint, text, text)', 'public.boletim_resolver_acoes(jsonb)',
                            'public.boletim_pedidos()', 'public.boletim_dia_util(date)'] loop
    execute 'revoke all on function ' || fn || ' from public, anon';
    execute 'grant execute on function ' || fn || ' to authenticated';
  end loop;
end $$;

-- 5) Configuração. Os perfis que recebem o boletim sozinho entram em abre_sozinho por escrita separada (fora do repositório).
insert into public.config (chave, valor, atualizado_em)
values ('boletim', '{"hora":"10:00","pedido_grande":150,"queda_alerta":0.30,"ritmo_minimo":0.50,"ritmo_desde_dia_util":5,"dias_zerado":2,"dias_parado":2,"max_acoes_pagina1":8,"abre_sozinho":[],"retencao_meses":12}', now())
on conflict (chave) do nothing;
-- Expediente do relógio do lead: seg–sex 11h–21h, sábado sem expediente (decisão de 08/10/2026).
update public.config
   set valor = '{"seg_sex":["11:00","21:00"],"sabado":null,"verde_min":5,"amarelo_min":15,"janela_dias":7}', atualizado_em = now()
 where chave = 'velocidade_lead';

-- 6) Retenção: 12 meses (todo dia às 03:30 de São Paulo = 06:30 UTC). As ações vão junto (on delete cascade).
select cron.schedule('boletim-retencao', '30 6 * * *', $job$
  delete from public.boletim_retratos
   where dia < ((now() at time zone 'America/Sao_Paulo')::date - interval '12 months')
$job$);
