-- §142 (07/11, Rafael): "Conferir com NEO" — cada consultor vê os leads dele em que o painel e o NEO não batem e arruma.
-- Lead ↔ pedido pelo CNPJ (só dígitos, 11+), valendo o pedido MAIS RECENTE do CNPJ (atualizacao, depois cadastro).
-- NEO ganho = Concluído, Entrega, Faturamento, Portabilidade em andamento, Validação eSIM (mesma regra da reconciliacao_neocrm);
-- NEO perdido = PERDID|DEVOLVID|CANCELAD (mesma regex da leads_kanban3); o resto = andamento.
-- Painel: venda = converteu; aberto = sem_contato/andamento; perdido = categoria perdido. Repique fora (como no Quadro).
-- Tipos (um por lead, nesta ordem): venda_neo_perdido, venda_sem_neo, perdido_neo_ganho, perdido_neo_andamento,
-- aberto_neo_ganho, aberto_neo_perdido, venda_status (converteu marcado mas o status não é de venda).
-- "Está certo" (leads_neo_ok) vale só para o mesmo tipo + pedido + etapa: se o NEO mudar, o lead volta para a lista.
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_conferir_neo_check.sql (desfaz tudo).
begin;

create table if not exists public.leads_neo_ok (
  lead_aba   text not null,
  lead_id    text not null,
  tipo       text not null,
  neo_pedido text,
  neo_etapa  text,
  motivo     text not null check (length(trim(motivo)) >= 3),
  marcado_por uuid,
  marcado_em timestamptz not null default now(),
  primary key (lead_aba, lead_id)
);
alter table public.leads_neo_ok enable row level security;   -- sem policy: só pelas funções abaixo
revoke all on table public.leads_neo_ok from public, anon, authenticated;

-- Classificação pura (testável sem auth): painel × NEO → tipo ou null.
create or replace function public.leads_neo_tipo(p_converteu boolean, p_categoria text, p_grupo_neo text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when coalesce(p_converteu, false) and p_grupo_neo = 'perdido' then 'venda_neo_perdido'
    when coalesce(p_converteu, false) and p_grupo_neo = 'sem'     then 'venda_sem_neo'
    when not coalesce(p_converteu, false) and p_categoria = 'perdido' and p_grupo_neo = 'ganho'     then 'perdido_neo_ganho'
    when not coalesce(p_converteu, false) and p_categoria = 'perdido' and p_grupo_neo = 'andamento' then 'perdido_neo_andamento'
    when not coalesce(p_converteu, false) and coalesce(p_categoria, 'sem_contato') in ('sem_contato', 'andamento') and p_grupo_neo = 'ganho'   then 'aberto_neo_ganho'
    when not coalesce(p_converteu, false) and coalesce(p_categoria, 'sem_contato') in ('sem_contato', 'andamento') and p_grupo_neo = 'perdido' then 'aberto_neo_perdido'
    when coalesce(p_converteu, false) and coalesce(p_categoria, '') <> 'convertido' then 'venda_status'
  end
$function$;

create or replace function public.leads_neo_grupo(p_etapa text)
 returns text language sql immutable set search_path to 'public'
as $function$
  select case
    when p_etapa is null then 'sem'
    when p_etapa ~* '(PERDID|DEVOLVID|CANCELAD)' then 'perdido'
    when p_etapa in ('CONCLUIDO (NEOCRM)', 'ENTREGA (NEOCRM)', 'FATURAMENTO (NEOCRM)',
                     'PORTABILIDADE EM ANDAMENTO (NEOCRM)', 'VALIDAÇÃO ESIM (NEOCRM)') then 'ganho'
    else 'andamento'
  end
$function$;

-- Lista de divergências. Consultor: só os dele. Admin/supervisor: todos (p_dono null, inclui sem consultor) ou de um dono.
-- Devolve também os já marcados "Está certo" (ok_*), para o gestor ver quem marcou e por quê; o painel esconde do consultor.
create or replace function public.leads_conferir_neo(p_dono uuid default null)
 returns table(aba text, lead_id text, nome text, dono_id uuid, dono_nome text, status text, converteu boolean, receita numeric,
               criado_em_lead timestamptz, tipo text, sem_cnpj boolean, neo_pedido text, neo_etapa text,
               neo_atualizacao timestamptz, neo_valor numeric, neo_pedidos int,
               ok_motivo text, ok_por_nome text, ok_em timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  return query
  with base as (
    select l.aba, l.id, l.full_name, l.dono_id, l.status, l.categoria, coalesce(l.converteu, false) as conv, l.receita, l.criado_em_lead,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (v_alvo is null or l.dono_id = v_alvo)
       and (v_gestor or l.dono_id is not null)
  ), ped as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, p.numero_pedido, p.etapa, p.atualizacao, p.cadastro, p.valor
      from public.producao_pedidos p
     where p.cnpj is not null
       and regexp_replace(p.cnpj, '[^0-9]', '', 'g') in (select b.doc from base b where length(b.doc) >= 11)
  ), ult as (
    select distinct on (doc) doc, numero_pedido, etapa, coalesce(atualizacao, cadastro) as em
      from ped
     order by doc, atualizacao desc nulls last, cadastro desc nulls last
  ), tot as (
    select doc, count(distinct numero_pedido)::int as n from ped group by doc
  ), cruzado as (
    select b.*, u.numero_pedido, u.etapa, u.em, t.n,
           (select sum(coalesce(x.valor, 0)) from ped x where x.doc = u.doc and x.numero_pedido = u.numero_pedido) as valor,
           public.leads_neo_tipo(b.conv, b.categoria,
             public.leads_neo_grupo(case when length(b.doc) >= 11 then u.etapa end)) as tipo
      from base b
      left join ult u on length(b.doc) >= 11 and u.doc = b.doc
      left join tot t on t.doc = u.doc
  )
  select c.aba, c.id, c.full_name, c.dono_id, pr.nome, c.status, c.conv, c.receita, c.criado_em_lead,
         c.tipo, coalesce(length(c.doc), 0) < 11, c.numero_pedido, c.etapa, c.em, c.valor, coalesce(c.n, 0),
         ok.motivo, po.nome, ok.marcado_em
    from cruzado c
    left join public.profiles pr on pr.id = c.dono_id
    left join public.leads_neo_ok ok on ok.lead_aba = c.aba and ok.lead_id = c.id
          and ok.tipo = c.tipo and ok.neo_pedido is not distinct from c.numero_pedido and ok.neo_etapa is not distinct from c.etapa
    left join public.profiles po on po.id = ok.marcado_por
   where c.tipo is not null
   order by pr.nome nulls last, c.tipo, c.criado_em_lead desc;
end $function$;

-- "Está certo assim": grava a exceção para a situação atual (tipo + pedido + etapa). Consultor só nos leads dele.
create or replace function public.leads_neo_marcar_ok(p_aba text, p_id text, p_motivo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_dono uuid; r record;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023';
  end if;
  select l.dono_id into v_dono from public.leads l where l.aba = p_aba and l.id = p_id and l.apagado_em is null;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if not v_gestor and (v_dono is null or v_dono <> auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select c.tipo, c.neo_pedido, c.neo_etapa into r
    from public.leads_conferir_neo(case when v_gestor then v_dono end) c
   where c.aba = p_aba and c.lead_id = p_id;
  if r.tipo is null then raise exception 'Este lead já bate com o NEO.' using errcode = '22023'; end if;
  insert into public.leads_neo_ok (lead_aba, lead_id, tipo, neo_pedido, neo_etapa, motivo, marcado_por, marcado_em)
  values (p_aba, p_id, r.tipo, r.neo_pedido, r.neo_etapa, trim(p_motivo), auth.uid(), now())
  on conflict (lead_aba, lead_id) do update
     set tipo = excluded.tipo, neo_pedido = excluded.neo_pedido, neo_etapa = excluded.neo_etapa,
         motivo = excluded.motivo, marcado_por = excluded.marcado_por, marcado_em = excluded.marcado_em;
end $function$;

revoke all on function public.leads_neo_tipo(boolean, text, text) from public, anon;
revoke all on function public.leads_neo_grupo(text) from public, anon;
revoke all on function public.leads_conferir_neo(uuid) from public, anon;
revoke all on function public.leads_neo_marcar_ok(text, text, text) from public, anon;
grant execute on function public.leads_neo_tipo(boolean, text, text) to authenticated, service_role;
grant execute on function public.leads_neo_grupo(text) to authenticated, service_role;
grant execute on function public.leads_conferir_neo(uuid) to authenticated, service_role;
grant execute on function public.leads_neo_marcar_ok(text, text, text) to authenticated, service_role;

commit;
