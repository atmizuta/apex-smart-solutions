-- Painel do Consultor (30/09/2026) — ver docs/superpowers/specs/2026-09-30-painel-do-consultor-design.md
-- Tudo aditivo: nada aqui muda as colunas, policies ou views que o painel atual usa.
--   1) producao_pedidos_neo.usuario_id (estruturaUsuarioId do NeoCRM) + gatilho que o mantém sincronizado
--   2) consultor_neo: vínculo perfil do painel x ID do consultor no NeoCRM
--   3) producao_etapa_historico: quando cada pedido mudou de etapa (gatilho)
--   4) metas_consultor: meta mensal em R$ por consultor
--   5) RPCs da aba "Pedidos Parados" (só devolvem os pedidos do próprio consultor)

-- ---------------------------------------------------------------- 1) usuario_id
alter table public.producao_pedidos_neo add column if not exists usuario_id bigint;
create index if not exists idx_producao_neo_usuario_id on public.producao_pedidos_neo (usuario_id);
create index if not exists idx_producao_neo_numero_pedido on public.producao_pedidos_neo (numero_pedido);

-- histórico: o JSON bruto já guarda o ID; nenhuma chamada à API
update public.producao_pedidos_neo n
   set usuario_id = nullif(r.raw->>'estruturaUsuarioId', '')::bigint
  from public.producao_neo_raw r
 where r.item_id = n.item_id
   and n.usuario_id is distinct from nullif(r.raw->>'estruturaUsuarioId', '')::bigint;

-- daqui em diante: a sync grava o pedido e depois o raw; o gatilho do raw completa o usuario_id.
-- (evita mexer e republicar a Edge Function sync-producao)
create or replace function public.producao_neo_raw_sync_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.producao_pedidos_neo
     set usuario_id = nullif(new.raw->>'estruturaUsuarioId', '')::bigint
   where item_id = new.item_id
     and usuario_id is distinct from nullif(new.raw->>'estruturaUsuarioId', '')::bigint;
  return new;
end $$;
drop trigger if exists trg_producao_neo_raw_usuario on public.producao_neo_raw;
create trigger trg_producao_neo_raw_usuario
  after insert or update of raw on public.producao_neo_raw
  for each row execute function public.producao_neo_raw_sync_usuario();

-- ---------------------------------------------------------------- 2) vínculo consultor x NeoCRM
create table if not exists public.consultor_neo (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  neo_usuario_id bigint not null unique,           -- 1 ID do NeoCRM <-> 1 perfil
  atualizado_em timestamptz not null default now()
);
alter table public.consultor_neo enable row level security;
drop policy if exists consultor_neo_select on public.consultor_neo;
create policy consultor_neo_select on public.consultor_neo for select
  using ( profile_id = auth.uid() or public.get_my_role() in ('admin','supervisor') );
drop policy if exists consultor_neo_write on public.consultor_neo;
create policy consultor_neo_write on public.consultor_neo for all
  using ( public.get_my_role() = 'admin' ) with check ( public.get_my_role() = 'admin' );

-- ID do NeoCRM do usuário logado (ou null se ainda não vinculado)
create or replace function public.meu_neo_usuario_id() returns bigint
language sql stable security definer set search_path = public as $$
  select neo_usuario_id from public.consultor_neo where profile_id = auth.uid();
$$;

-- lista os IDs do NeoCRM vistos nos pedidos, com nome e nº de pedidos, para o admin conferir o vínculo
create or replace function public.neo_usuarios_detectados()
returns table (usuario_id bigint, nome text, pedidos bigint, ultimo_pedido timestamptz, profile_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() not in ('admin','supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select n.usuario_id,
           (array_agg(n.usuario order by n.atualizacao desc nulls last))[1],
           count(distinct n.numero_pedido),
           max(n.atualizacao),
           c.profile_id
      from public.producao_pedidos_neo n
      left join public.consultor_neo c on c.neo_usuario_id = n.usuario_id
     where n.usuario_id is not null
     group by n.usuario_id, c.profile_id
     order by 3 desc;
end $$;

-- ---------------------------------------------------------------- 3) histórico de etapas
create table if not exists public.producao_etapa_historico (
  id bigint generated always as identity primary key,
  item_id bigint not null,
  numero_pedido text,
  etapa_anterior text,
  etapa_nova text,
  em timestamptz not null default now(),
  origem text not null default 'sync' check (origem in ('carga','sync'))
);
create index if not exists idx_etapa_hist_pedido on public.producao_etapa_historico (numero_pedido, em desc);
create index if not exists idx_etapa_hist_em on public.producao_etapa_historico (em desc);
alter table public.producao_etapa_historico enable row level security;
drop policy if exists etapa_hist_select on public.producao_etapa_historico;
create policy etapa_hist_select on public.producao_etapa_historico for select
  using ( public.get_my_role() in ('admin','supervisor') );
-- consultores leem só pelas RPCs abaixo (security definer).

-- estado inicial: uma linha por item, com a data da última atualização como melhor estimativa
insert into public.producao_etapa_historico (item_id, numero_pedido, etapa_anterior, etapa_nova, em, origem)
select n.item_id, n.numero_pedido, null, n.etapa, coalesce(n.atualizacao, n.sincronizado_em, now()), 'carga'
  from public.producao_pedidos_neo n
 where not exists (select 1 from public.producao_etapa_historico h where h.item_id = n.item_id);

create or replace function public.producao_neo_registra_etapa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.producao_etapa_historico (item_id, numero_pedido, etapa_anterior, etapa_nova, em, origem)
    values (new.item_id, new.numero_pedido, null, new.etapa, now(), 'sync');
  elsif new.etapa is distinct from old.etapa then
    insert into public.producao_etapa_historico (item_id, numero_pedido, etapa_anterior, etapa_nova, em, origem)
    values (new.item_id, new.numero_pedido, old.etapa, new.etapa, now(), 'sync');
  end if;
  return new;
end $$;
drop trigger if exists trg_producao_neo_etapa on public.producao_pedidos_neo;
create trigger trg_producao_neo_etapa
  after insert or update of etapa on public.producao_pedidos_neo
  for each row execute function public.producao_neo_registra_etapa();

-- ---------------------------------------------------------------- 4) metas
create table if not exists public.metas_consultor (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),   -- sempre o dia 1
  meta_receita numeric not null default 0 check (meta_receita >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (profile_id, mes)
);
alter table public.metas_consultor enable row level security;
drop policy if exists metas_select on public.metas_consultor;
create policy metas_select on public.metas_consultor for select
  using ( profile_id = auth.uid() or public.get_my_role() in ('admin','supervisor') );
drop policy if exists metas_write on public.metas_consultor;
create policy metas_write on public.metas_consultor for all
  using ( public.get_my_role() = 'admin' ) with check ( public.get_my_role() = 'admin' );

-- ---------------------------------------------------------------- 5) RPCs da aba Pedidos Parados
-- Dono efetivo: o próprio usuário; admin/supervisor podem pedir "ver como" outro perfil.
create or replace function public.producao_dono_neo(p_consultor uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_alvo uuid := coalesce(p_consultor, auth.uid());
begin
  if v_alvo is distinct from auth.uid() and public.get_my_role() not in ('admin','supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return (select neo_usuario_id from public.consultor_neo where profile_id = v_alvo);
end $$;

-- Pedidos do consultor: todos os abertos + os fechados dos últimos 120 dias (perdidos, devolvidos, concluídos).
create or replace function public.producao_meus_pedidos(p_consultor uuid default null)
returns table (numero_pedido text, grupo text, usuario text, etapa text, cadastro timestamptz,
               atualizacao timestamptz, valor numeric, quantidade numeric, produto text, cliente text,
               cnpj text, tag text, data_portabilidade timestamptz, data_instalacao timestamptz,
               na_etapa_desde timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_neo bigint := public.producao_dono_neo(p_consultor);
begin
  if v_neo is null then return; end if;
  return query
    select n.numero_pedido, n.grupo, n.usuario, n.etapa, n.cadastro, n.atualizacao, n.valor, n.quantidade,
           n.produto, n.cliente, n.cnpj, n.tag, n.data_portabilidade, n.data_instalacao,
           coalesce((select max(h.em) from public.producao_etapa_historico h
                      where h.numero_pedido = n.numero_pedido and h.etapa_nova = n.etapa), n.atualizacao)
      from public.producao_pedidos_neo n
     where n.usuario_id = v_neo
       and ( n.etapa not in ('VENDA PERDIDA (NEOCRM)','CONCLUIDO (NEOCRM)','DEVOLVIDO (NEOCRM)')
             or coalesce(n.atualizacao, n.cadastro) >= now() - interval '120 days' )
     order by n.numero_pedido, n.item_id;
end $$;

-- Mudanças de etapa recentes dos pedidos do consultor.
create or replace function public.minhas_movimentacoes(p_dias int default 2, p_consultor uuid default null)
returns table (numero_pedido text, cliente text, etapa_anterior text, etapa_nova text, em timestamptz, valor numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_neo bigint := public.producao_dono_neo(p_consultor);
begin
  if v_neo is null then return; end if;
  return query
    select h.numero_pedido,
           (select max(n.cliente) from public.producao_pedidos_neo n where n.numero_pedido = h.numero_pedido),
           h.etapa_anterior, h.etapa_nova, max(h.em),
           (select coalesce(sum(n.valor), 0) from public.producao_pedidos_neo n where n.numero_pedido = h.numero_pedido)
      from public.producao_etapa_historico h
     where h.origem = 'sync' and h.etapa_anterior is not null
       and h.em >= now() - make_interval(days => greatest(1, least(p_dias, 30)))
       and exists (select 1 from public.producao_pedidos_neo n
                    where n.numero_pedido = h.numero_pedido and n.usuario_id = v_neo)
     group by h.numero_pedido, h.etapa_anterior, h.etapa_nova
     order by max(h.em) desc
     limit 100;
end $$;

-- Anti-duplicidade: dos CNPJs informados, quais já têm pedido ABERTO de OUTRO consultor (só o CNPJ, nunca o dono).
create or replace function public.cnpjs_com_pedido_aberto_de_outros(p_cnpjs text[])
returns setof text
language plpgsql stable security definer set search_path = public as $$
declare v_neo bigint := public.meu_neo_usuario_id();
begin
  if coalesce(array_length(p_cnpjs, 1), 0) > 500 then raise exception 'lista grande demais'; end if;
  return query
    select distinct regexp_replace(n.cnpj, '\D', '', 'g')
      from public.producao_pedidos_neo n
     where regexp_replace(coalesce(n.cnpj, ''), '\D', '', 'g') = any (
             select regexp_replace(c, '\D', '', 'g') from unnest(p_cnpjs) c)
       and n.usuario_id is distinct from v_neo
       and n.etapa not in ('VENDA PERDIDA (NEOCRM)','CONCLUIDO (NEOCRM)','DEVOLVIDO (NEOCRM)');
end $$;

revoke all on function public.meu_neo_usuario_id(), public.neo_usuarios_detectados(),
  public.producao_dono_neo(uuid), public.producao_meus_pedidos(uuid), public.minhas_movimentacoes(int, uuid),
  public.cnpjs_com_pedido_aberto_de_outros(text[]) from public, anon;
grant execute on function public.meu_neo_usuario_id(), public.neo_usuarios_detectados(),
  public.producao_dono_neo(uuid), public.producao_meus_pedidos(uuid), public.minhas_movimentacoes(int, uuid),
  public.cnpjs_com_pedido_aberto_de_outros(text[]) to authenticated;
