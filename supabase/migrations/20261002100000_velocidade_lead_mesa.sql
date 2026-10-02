-- 02/10/2026 — Velocidade do lead ("Atender agora") + Mesa do Supervisor. REGRAS_NEGOCIO.md §68. Aditiva.
-- Spec: docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md
-- O status da planilha NÃO conta como contato (os leads já chegam com status). Contato = clique no painel
-- (leads_contatos) ou ligação manual (ligacoes_manuais) a partir de 1 h antes da entrada do lead.

-- ---------------------------------------------------------------- 1) leads.primeira_sync_em
-- Duas etapas DE PROPÓSITO: add column com default now() preencheria as linhas antigas com a hora desta
-- migration. Assim as antigas ficam nulas e só os leads novos ganham a hora do 1º sync.
alter table public.leads add column if not exists primeira_sync_em timestamptz;
alter table public.leads alter column primeira_sync_em set default now();

-- ---------------------------------------------------------------- 2) leads_contatos (clique de contato no painel)
create table if not exists public.leads_contatos (
  id bigint generated always as identity primary key,
  lead_aba text not null,
  lead_id text not null,
  profile_id uuid not null,
  canal text not null check (canal in ('whatsapp', 'ligar', 'manual')),
  em timestamptz not null default now()
);
create index if not exists leads_contatos_lead_idx on public.leads_contatos (lead_aba, lead_id, em);
create index if not exists leads_contatos_profile_idx on public.leads_contatos (profile_id, em);
alter table public.leads_contatos enable row level security;
-- sem policies: ninguém lê nem grava direto; só pelas RPCs abaixo (security definer)
revoke all on public.leads_contatos from anon, authenticated;

-- ---------------------------------------------------------------- 3) configuração padrão
insert into public.config (chave, valor)
values ('velocidade_lead', '{"seg_sex":["08:00","18:00"],"sabado":["08:00","12:00"],"verde_min":5,"amarelo_min":15,"janela_dias":7}')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------- 4) registrar_contato_lead
create or replace function public.registrar_contato_lead(p_aba text, p_lead_id text, p_canal text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare v_consultor text;
begin
  if auth.uid() is null then
    raise exception 'sem login' using errcode = '42501';
  end if;
  if p_canal is null or p_canal not in ('whatsapp', 'ligar', 'manual') then
    raise exception 'canal inválido: %', p_canal using errcode = '22023';
  end if;
  select l.consultor into v_consultor from public.leads l where l.aba = p_aba and l.id = p_lead_id;
  if not found then
    raise exception 'lead não encontrado' using errcode = 'P0002';
  end if;
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor')
     and public.norm_nome(v_consultor) not in (select public.meus_leads_nomes()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  -- clique duplo: o mesmo lead/pessoa/canal em menos de 2 min não grava de novo
  if exists (select 1 from public.leads_contatos c
              where c.lead_aba = p_aba and c.lead_id = p_lead_id and c.profile_id = auth.uid()
                and c.canal = p_canal and c.em > now() - interval '2 minutes') then
    return;
  end if;
  insert into public.leads_contatos (lead_aba, lead_id, profile_id, canal) values (p_aba, p_lead_id, auth.uid(), p_canal);
end $$;
revoke all on function public.registrar_contato_lead(text, text, text) from public, anon;
grant execute on function public.registrar_contato_lead(text, text, text) to authenticated;

-- ---------------------------------------------------------------- 5) meus_leads_relogio (consultor)
-- Leads do login (qualquer categoria; o navegador decide quem está "esperando"), dos últimos janela_dias.
-- Devolve só o timestamp da 1ª ligação dos PRÓPRIOS leads; o consultor continua sem ler ligacoes_manuais.
create or replace function public.meus_leads_relogio()
returns table (aba text, lead_id text, nome text, telefone text, cidade text, qtd_linhas text, status text, categoria text,
               criado_em_lead timestamptz, primeiro_clique timestamptz, primeira_ligacao timestamptz)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(((select c.valor from public.config c where c.chave = 'velocidade_lead')::jsonb ->> 'janela_dias')::int, 7) as dias
  )
  select l.aba, l.id, l.full_name, l.phone_number, l.city, l.qtd_linhas, l.status, l.categoria, l.criado_em_lead,
         (select min(c.em) from public.leads_contatos c where c.lead_aba = l.aba and c.lead_id = l.id),
         (select min(m.gerada_em) from public.ligacoes_manuais m
           where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
             and m.gerada_em >= l.criado_em_lead - interval '1 hour')
    from public.leads l cross join cfg
   where public.norm_nome(l.consultor) in (select public.meus_leads_nomes())
     and coalesce(l.aba, '') <> 'REPIQUE'
     and l.criado_em_lead >= now() - make_interval(days => cfg.dias)
   order by l.criado_em_lead;
$$;
revoke all on function public.meus_leads_relogio() from public, anon;
grant execute on function public.meus_leads_relogio() to authenticated;

-- ---------------------------------------------------------------- 6) mesa_leads_relogio (admin/supervisor)
create or replace function public.mesa_leads_relogio(p_desde timestamptz)
returns table (aba text, lead_id text, consultor text, profile_id uuid, criado_em_lead timestamptz, primeira_sync_em timestamptz,
               categoria text, converteu boolean, primeiro_clique timestamptz, canal_clique text, primeira_ligacao timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  select l.aba, l.id, nullif(btrim(l.consultor), ''),
         (select e.profile_id from public.leads_equipe e
           where e.profile_id is not null and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor) limit 1),
         l.criado_em_lead, l.primeira_sync_em, l.categoria, l.converteu,
         pc.em, pc.canal,
         (select min(m.gerada_em) from public.ligacoes_manuais m
           where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
             and m.gerada_em >= l.criado_em_lead - interval '1 hour')
    from public.leads l
    left join lateral (select c.em, c.canal from public.leads_contatos c
                        where c.lead_aba = l.aba and c.lead_id = l.id order by c.em limit 1) pc on true
   where coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= p_desde
   order by l.criado_em_lead;
end $$;
revoke all on function public.mesa_leads_relogio(timestamptz) from public, anon;
grant execute on function public.mesa_leads_relogio(timestamptz) to authenticated;

-- ---------------------------------------------------------------- 7) mesa_pendencias (admin/supervisor)
-- Uma linha por item pendente + uma linha 'consultor' por perfil consultor (quem está em dia aparece verde).
-- pedido_risco devolve TODO pedido aberto com a data de entrada na etapa; o navegador calcula dias úteis/nível
-- (ppDiasUteisDesde/ppNivel, iguais ao Pedidos Parados) e descarta os abaixo de 3 dias úteis.
create or replace function public.mesa_pendencias(p_ref date)
returns table (profile_id uuid, nome text, tipo text, ref text, titulo text, desde timestamptz, extra jsonb)
language plpgsql stable security definer set search_path = public as $$
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
         coalesce((select max(h.em) from public.producao_etapa_historico h
                    where h.numero_pedido = x.numero_pedido and h.etapa_nova = x.etapa), x.atualizacao),
         jsonb_build_object('etapa', x.etapa, 'valor', x.valor)
    from (select n.numero_pedido, n.usuario_id, n.etapa, max(n.cliente) as cliente, max(n.atualizacao) as atualizacao, sum(n.valor) as valor
            from public.producao_pedidos_neo n
           where n.numero_pedido is not null
             and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'CONCLUIDO (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
           group by n.numero_pedido, n.usuario_id, n.etapa) x
    join public.consultor_neo cn on cn.neo_usuario_id = x.usuario_id
    join public.profiles p on p.id = cn.profile_id;
end $$;
revoke all on function public.mesa_pendencias(date) from public, anon;
grant execute on function public.mesa_pendencias(date) to authenticated;

-- ---------------------------------------------------------------- 8) mesa_ligacoes_hoje (admin/supervisor)
create or replace function public.mesa_ligacoes_hoje(p_ref date)
returns table (profile_id uuid, lig_lead bigint, lig_total bigint, ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with equipe as (
    select e.profile_id as pid, lower(btrim(e.usuario_telefonia)) as u from public.leads_equipe e
     where e.profile_id is not null and coalesce(btrim(e.usuario_telefonia), '') <> ''
  ),
  chaves as (select distinct public.chave_tel(ld.phone_number) as k from public.leads ld where ld.phone_number is not null)
  select q.pid, count(m.id) filter (where c.k is not null), count(m.id), max(m.gerada_em)
    from equipe q
    left join public.ligacoes_manuais m
           on lower(btrim(m.usuario)) = q.u and (m.gerada_em at time zone 'America/Sao_Paulo')::date = p_ref
    left join chaves c on c.k = m.chave_tel
   group by q.pid;
end $$;
revoke all on function public.mesa_ligacoes_hoje(date) from public, anon;
grant execute on function public.mesa_ligacoes_hoje(date) to authenticated;

-- ---------------------------------------------------------------- 9) mesa_vendas_mes (admin/supervisor)
-- Mesma data da matriz do Cadastro Diário (cadastro, §66); sem perdidos/devolvidos; GROSS já não entra (§49).
create or replace function public.mesa_vendas_mes(p_mes date)
returns table (profile_id uuid, pedidos bigint, receita numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  select cn.profile_id, count(distinct n.numero_pedido), coalesce(sum(n.valor), 0)
    from public.consultor_neo cn
    left join public.producao_pedidos_neo n
           on n.usuario_id = cn.neo_usuario_id
          and (n.cadastro at time zone 'America/Sao_Paulo')::date >= v_ini
          and (n.cadastro at time zone 'America/Sao_Paulo')::date < (v_ini + interval '1 month')::date
          and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
   group by cn.profile_id;
end $$;
revoke all on function public.mesa_vendas_mes(date) from public, anon;
grant execute on function public.mesa_vendas_mes(date) to authenticated;
