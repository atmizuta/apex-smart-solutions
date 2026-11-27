-- §170 Consulta Pedido (Xeotech) sob demanda, na gaveta do pedido da §166.
-- Spec: docs/superpowers/specs/2026-11-27-consulta-pedido-design.md
-- Sem DROP (o conector do Supabase trava com drop). Aplicar com execute_sql em begin/commit.

-- Última consulta de cada pedido. Sem dado pessoal do cedente nem endereço completo (recorte em consulta.ts).
create table if not exists public.pedido_consulta_neo (
  numero_pedido text primary key,
  pedido_id bigint not null,
  consultado_em timestamptz not null default now(),
  consultado_por uuid,
  etapa_neo text,
  etapa_painel_antes text,
  etapa_painel text,                -- etapa do painel que bate com a do NEO; null = o painel não conhece
  corrigiu boolean not null default false,
  resumo jsonb not null default '{}'::jsonb,
  itens jsonb not null default '[]'::jsonb
);
-- Uma linha por chamada à Xeotech (gravada ANTES de chamar). Separada da neo_pedidos_sync_log, cujo check
-- de api só muda com drop constraint.
create table if not exists public.neo_consulta_log (
  id bigserial primary key, numero_pedido text not null, pedido_id bigint, usuario uuid,
  comecou_em timestamptz not null default now(), terminou_em timestamptz, http int, ok boolean, erro text
);
create index if not exists neo_consulta_log_em on public.neo_consulta_log (comecou_em desc);
alter table public.pedido_consulta_neo enable row level security;
alter table public.neo_consulta_log enable row level security;

-- Nome de etapa comparável: sem acento, sem " (NEOCRM)", maiúsculo, espaços simples.
create or replace function public.etapa_norm(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(trim(regexp_replace(regexp_replace(
           translate(upper(coalesce(p, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'),
           '\s*\(NEOCRM\)\s*$', ''), '\s+', ' ', 'g')), '');
$$;

-- Segundos até haver vaga para uma consulta (0 = livre). Divide o limite da Xeotech com a sync da §166:
-- 120 s depois de cada chamada, 3 por estrutura em 10 min, e a consulta não pode encostar num cron.
-- shortcut: horários do cron copiados de 20261124120100_movimentacoes_pedidos_cron.sql (UTC); se mudarem lá, mudar aqui.
create or replace function public.consulta_espera_s(p_agora timestamptz default now()) returns int
language plpgsql stable security definer set search_path = public as $$
declare v_fim timestamptz; v_2a timestamptz; m timestamptz; h int; mi int; espera numeric := 0;
begin
  with c as (
    -- chamada sem fim gravado (em andamento ou que caiu) conta até o timeout de 100 s
    select comecou_em, coalesce(terminou_em, comecou_em + interval '100 seconds') fim
      from public.neo_pedidos_sync_log where comecou_em > p_agora - interval '15 minutes'
    union all
    select comecou_em, coalesce(terminou_em, comecou_em + interval '100 seconds')
      from public.neo_consulta_log where comecou_em > p_agora - interval '15 minutes')
  select (select max(fim) from c),
         (select comecou_em from c where comecou_em > p_agora - interval '10 minutes' order by comecou_em desc offset 1 limit 1)
    into v_fim, v_2a;
  -- 120 s da Xeotech + 10 s de margem
  espera := greatest(espera, extract(epoch from v_fim + interval '130 seconds' - p_agora));
  -- com 2 chamadas nos últimos 10 min a consulta seria a 3ª e o cron seguinte levaria 429
  espera := greatest(espera, extract(epoch from v_2a + interval '10 minutes' - p_agora));
  -- cron que acabou de disparar (30 s, o log ainda pode não estar gravado) ou que dispara em até 150 s
  for m in select generate_series(date_trunc('minute', p_agora - interval '1 minute'), p_agora + interval '3 minutes', interval '1 minute') loop
    h := extract(hour from m at time zone 'UTC'); mi := extract(minute from m at time zone 'UTC');
    if (mi in (3, 8, 38) or (mi % 10 = 3 and (h <= 1 or h >= 11)))
       and m between p_agora - interval '30 seconds' and p_agora + interval '150 seconds' then
      espera := greatest(espera, extract(epoch from m + interval '160 seconds' - p_agora));
    end if;
  end loop;
  return greatest(0, ceil(espera))::int;
end $$;

-- Chamada pela Edge Function com o login de quem clicou. Recusa sem chamar a Xeotech; com vaga, grava a tentativa.
create or replace function public.consulta_pedido_preparar(p_numero text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pid bigint; v_espera int; v_log bigint;
begin
  if coalesce((select role from public.profiles where id = auth.uid()) not in ('admin', 'supervisor'), true)
     or not coalesce(public.pedido_pode_ver(p_numero), false) then
    return jsonb_build_object('ok', false, 'motivo', 'permissao');
  end if;
  select m.pedido_id into v_pid from public.pedido_movimentacoes m where m.numero_pedido = p_numero order by m.entrou_em desc limit 1;
  if v_pid is null then return jsonb_build_object('ok', false, 'motivo', 'sem_pedido_id'); end if;
  -- dois cliques no mesmo segundo: o segundo espera o primeiro gravar a reserva e então vê que não há vaga
  perform pg_advisory_xact_lock(hashtext('neo_pedidos_xeotech'));
  v_espera := public.consulta_espera_s(clock_timestamp());
  if v_espera > 0 then return jsonb_build_object('ok', false, 'motivo', 'vaga', 'espera_s', v_espera); end if;
  insert into public.neo_consulta_log (numero_pedido, pedido_id, usuario, comecou_em)
  values (p_numero, v_pid, auth.uid(), clock_timestamp()) returning id into v_log;
  return jsonb_build_object('ok', true, 'log_id', v_log, 'pedido_id', v_pid);
end $$;

-- Grava a consulta e corrige a etapa (todas as linhas do pedido) quando o nome do NEO bate com uma etapa
-- que o painel já usa. O gatilho trg_producao_neo_etapa registra a troca no histórico (origem 'sync').
create or replace function public.consulta_pedido_salvar(p_log_id bigint, p_etapa_neo text, p_resumo jsonb, p_itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l public.neo_consulta_log; v_antes text; v_painel text; v_n int := 0;
begin
  select * into l from public.neo_consulta_log where id = p_log_id;
  if l.id is null then raise exception 'consulta % não existe', p_log_id; end if;
  select n.etapa into v_antes from public.producao_pedidos_neo n
   where n.numero_pedido = l.numero_pedido order by n.atualizacao desc nulls last limit 1;
  select e.etapa into v_painel from (select distinct etapa from public.producao_pedidos_neo) e
   where public.etapa_norm(e.etapa) = public.etapa_norm(p_etapa_neo)
   order by e.etapa like '% (NEOCRM)' desc limit 1;
  if v_painel is not null then
    update public.producao_pedidos_neo set etapa = v_painel
     where numero_pedido = l.numero_pedido and etapa is distinct from v_painel;
    get diagnostics v_n = row_count;
  end if;
  insert into public.pedido_consulta_neo (numero_pedido, pedido_id, consultado_em, consultado_por, etapa_neo,
                                          etapa_painel_antes, etapa_painel, corrigiu, resumo, itens)
  values (l.numero_pedido, l.pedido_id, now(), l.usuario, p_etapa_neo, v_antes, v_painel, v_n > 0,
          coalesce(p_resumo, '{}'::jsonb), coalesce(p_itens, '[]'::jsonb))
  on conflict (numero_pedido) do update set pedido_id = excluded.pedido_id, consultado_em = excluded.consultado_em,
    consultado_por = excluded.consultado_por, etapa_neo = excluded.etapa_neo, etapa_painel_antes = excluded.etapa_painel_antes,
    etapa_painel = excluded.etapa_painel, corrigiu = excluded.corrigiu, resumo = excluded.resumo, itens = excluded.itens;
  update public.neo_consulta_log set ok = true, http = 200, terminou_em = clock_timestamp() where id = p_log_id;
  return jsonb_build_object('corrigiu', v_n > 0, 'etapa_antes', v_antes, 'etapa_painel', v_painel);
end $$;

revoke execute on function public.consulta_espera_s(timestamptz) from public, anon, authenticated;
revoke execute on function public.consulta_pedido_salvar(bigint, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.consulta_pedido_salvar(bigint, text, jsonb, jsonb) to service_role;
revoke execute on function public.consulta_pedido_preparar(text) from public, anon;
grant execute on function public.consulta_pedido_preparar(text) to authenticated;

-- Gaveta: a mesma RPC da §166 passa a trazer a última consulta, quem pode consultar e se há id do NEO.
create or replace function public.pedido_linha_do_tempo(p_numero text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_decide boolean := coalesce((select role from public.profiles where id = auth.uid()) in ('admin', 'supervisor'), false);
begin
  if not coalesce(public.pedido_pode_ver(p_numero), false) then
    raise exception 'sem permissão para ver este pedido' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'cabecalho', (select jsonb_build_object('numero', p_numero,
                          'cliente', (array_agg(n.cliente order by n.atualizacao desc nulls last))[1],
                          'consultor', (array_agg(n.usuario order by n.atualizacao desc nulls last))[1],
                          'valor', sum(n.valor),
                          'etapa', (array_agg(n.etapa order by n.atualizacao desc nulls last))[1])
                    from public.producao_pedidos_neo n where n.numero_pedido = p_numero having count(*) > 0),
    'passagens', coalesce((select jsonb_agg(jsonb_build_object('etapa', m.etapa, 'entrou_em', m.entrou_em, 'saiu_em', m.saiu_em,
                    'entrou_por', m.entrou_por, 'saiu_por', m.saiu_por, 'sla_horas', m.sla_horas, 'texto', m.texto,
                    'vp_categoria', m.vp_categoria) order by m.entrou_em)
                  from public.pedido_movimentacoes m where m.numero_pedido = p_numero), '[]'::jsonb),
    'anotacoes', coalesce((select jsonb_agg(jsonb_build_object('em', a.atualizado_em_neo, 'tipo', a.tipo, 'status', a.status,
                    'descricao', a.descricao, 'vp_categoria', a.vp_categoria, 'texto', a.texto,
                    'autor_provavel', (select m.entrou_por from public.pedido_movimentacoes m
                                        where m.numero_pedido = a.numero_pedido
                                          and m.entrou_em between a.atualizado_em_neo - interval '10 minutes' and a.atualizado_em_neo + interval '1 minute'
                                        order by m.entrou_em desc limit 1)) order by a.atualizado_em_neo)
                  from public.pedido_anotacoes a where a.numero_pedido = p_numero), '[]'::jsonb),
    'motivo_real', case when v_decide then (select jsonb_build_object('motivo', v.motivo_real, 'obs', v.obs, 'em', v.decidido_em,
                        'por', (select p.nome from public.profiles p where p.id = v.decidido_por))
                      from public.venda_perdida_auditoria v where v.numero_pedido = p_numero) end,
    'pode_decidir', v_decide,
    'categorias', case when v_decide then coalesce((select jsonb_agg(x.c order by x.c)
                    from (select distinct categoria c from public.producao_atividades where categoria is not null) x), '[]'::jsonb) end,
    -- §170
    'consulta_neo', (select to_jsonb(c) - 'consultado_por' - 'pedido_id'
                            || jsonb_build_object('por', (select p.nome from public.profiles p where p.id = c.consultado_por))
                       from public.pedido_consulta_neo c where c.numero_pedido = p_numero),
    'pode_consultar', v_decide,
    'tem_pedido_id', exists (select 1 from public.pedido_movimentacoes m where m.numero_pedido = p_numero));
end $$;
