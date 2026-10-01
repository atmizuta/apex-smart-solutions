-- Monitoramento Leads (01/10/2026) — ver docs/superpowers/specs/2026-10-01-monitoramento-leads-design.md
-- Aditivo: nada que o painel atual usa é alterado.
--   1) funções chave_tel / norm_nome
--   2) ligacoes_manuais (relatório de chamadas manuais da telefonia, por upload)
--   3) leads_equipe (quem recebe leads: planilha x telefonia x login do painel)
--   4) RPCs do monitoramento (admin/supervisor) e dos leads do consultor

-- ---------------------------------------------------------------- 1) funções
-- Telefone -> DDD + 8 últimos dígitos (ignora o 9º dígito e o 55). null se curto demais.
create or replace function public.chave_tel(p text) returns text
language sql immutable as $$
  select case when length(d) >= 10 then substr(d, 1, 2) || right(d, 8) end
    from (select case when regexp_replace(coalesce(p, ''), '\D', '', 'g') ~ '^55'
                       and length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 12
                      then substr(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 3)
                      else regexp_replace(coalesce(p, ''), '\D', '', 'g') end as d) t;
$$;

-- Nome sem acento, minúsculo, sem espaços repetidos (mesma ideia de normalizarNomeConsultor do painel).
create or replace function public.norm_nome(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
    '\s+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------- 2) ligacoes_manuais
create table if not exists public.ligacoes_manuais (
  id bigint primary key,                 -- coluna ID do relatório da telefonia (único por ligação)
  usuario text not null,                 -- ex.: apex.caiocosta
  telefone text,
  chave_tel text,
  gerada_em timestamptz not null,        -- DataHora_Geracao (horário de São Paulo)
  atendida boolean not null default false,
  seg_falados int not null default 0,    -- Tempo_Chamada em segundos
  tabulacao text,
  transferido text,
  gravacao text,
  importado_em timestamptz not null default now(),
  importado_por uuid
);
create index if not exists idx_ligacoes_chave_tel on public.ligacoes_manuais (chave_tel);
create index if not exists idx_ligacoes_usuario_data on public.ligacoes_manuais (usuario, gerada_em);
create index if not exists idx_ligacoes_data on public.ligacoes_manuais (gerada_em);

alter table public.ligacoes_manuais enable row level security;
drop policy if exists ligacoes_manuais_all on public.ligacoes_manuais;
create policy ligacoes_manuais_all on public.ligacoes_manuais for all
  using ( public.get_my_role() in ('admin', 'supervisor') )
  with check ( public.get_my_role() in ('admin', 'supervisor') );

-- ---------------------------------------------------------------- 3) leads_equipe
create table if not exists public.leads_equipe (
  id bigint generated always as identity primary key,
  nome_planilha text not null,           -- como aparece em leads.consultor
  usuario_telefonia text,                -- como aparece em ligacoes_manuais.usuario
  profile_id uuid references public.profiles(id) on delete set null,
  monitorar boolean not null default true,
  desde date,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists uq_leads_equipe_nome on public.leads_equipe (public.norm_nome(nome_planilha));
create unique index if not exists uq_leads_equipe_profile on public.leads_equipe (profile_id) where profile_id is not null;

alter table public.leads_equipe enable row level security;
drop policy if exists leads_equipe_select on public.leads_equipe;
create policy leads_equipe_select on public.leads_equipe for select
  using ( profile_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor') );
drop policy if exists leads_equipe_write on public.leads_equipe;
create policy leads_equipe_write on public.leads_equipe for all
  using ( public.get_my_role() = 'admin' ) with check ( public.get_my_role() = 'admin' );

-- Equipe de leads de outubro/2026 (o admin liga cada pessoa ao perfil no editor da própria página).
insert into public.leads_equipe (nome_planilha, usuario_telefonia, monitorar, desde) values
  ('Caio',    'apex.caiocosta', true, '2026-10-01'),
  ('Gabriel', 'apex.gabrielM',  true, '2026-10-01'),
  ('Luria',   'Apex.luria',     true, '2026-10-01'),
  ('Mariana', 'apex.mariana',   true, '2026-10-01')
on conflict do nothing;

-- ---------------------------------------------------------------- 4) RPCs
-- Leads da aba (só de quem é monitorado) com tentativas de ligação. Admin/supervisor.
create or replace function public.monitor_leads_leads(p_aba text)
returns table (lead_id text, nome text, telefone text, consultor text, status text, categoria text,
               receita numeric, criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  select l.id, l.full_name, l.phone_number, l.consultor, l.status, l.categoria, l.receita, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u
    from public.leads l
    join public.leads_equipe e on e.monitorar and public.norm_nome(e.nome_planilha) = public.norm_nome(l.consultor)
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where l.aba = p_aba
   order by l.criado_em_lead;
end $$;

-- Ligações por usuário da telefonia. p_ref = hoje (SP, vindo do navegador); p_de/p_ate = período (null = sem limite).
create or replace function public.monitor_ligacoes_por_usuario(p_ref date, p_de date, p_ate date)
returns table (usuario text, total bigint, lig_leads bigint, atend_leads bigint, leads_distintos bigint,
               seg_leads bigint, boas_leads bigint, atend_sem_contato bigint,
               h_hoje bigint, h_ontem bigint, h_7 bigint, h_30 bigint,
               hoje_atend bigint, hoje_leads bigint, hoje_seg bigint, hoje_ultima timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_boa int := coalesce((select (cfg.valor::jsonb ->> 'conversa_boa_seg')::int
                           from public.config cfg where cfg.chave = 'monitor_leads_metas'), 60);
begin
  if public.get_my_role() not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with chaves as (
    select distinct public.chave_tel(ld.phone_number) as k from public.leads ld where ld.phone_number is not null
  ),
  b as (
    select m.usuario as u, m.chave_tel as ck, m.atendida as at, m.seg_falados as sg, m.gerada_em as ge,
           upper(coalesce(m.tabulacao, '')) as tb,
           (m.gerada_em at time zone 'America/Sao_Paulo')::date as dia,
           (c.k is not null) as eh_lead
      from public.ligacoes_manuais m
      left join chaves c on c.k = m.chave_tel
  ),
  p as (
    select b.*, ((p_de is null or b.dia >= p_de) and (p_ate is null or b.dia <= p_ate)) as no_per from b
  )
  select p.u,
         count(*) filter (where p.no_per),
         count(*) filter (where p.no_per and p.eh_lead),
         count(*) filter (where p.no_per and p.eh_lead and p.at),
         count(distinct p.ck) filter (where p.no_per and p.eh_lead),
         coalesce(sum(p.sg) filter (where p.no_per and p.eh_lead), 0)::bigint,
         count(*) filter (where p.no_per and p.eh_lead and p.sg >= v_boa),
         count(*) filter (where p.no_per and p.eh_lead and p.at and p.tb = 'SEM CONTATO'),
         count(*) filter (where p.eh_lead and p.dia = p_ref),
         count(*) filter (where p.eh_lead and p.dia = p_ref - 1),
         count(*) filter (where p.eh_lead and p.dia between p_ref - 6 and p_ref),
         count(*) filter (where p.eh_lead and p.dia between p_ref - 29 and p_ref),
         count(*) filter (where p.eh_lead and p.at and p.dia = p_ref),
         count(distinct p.ck) filter (where p.eh_lead and p.dia = p_ref),
         coalesce(sum(p.sg) filter (where p.eh_lead and p.dia = p_ref), 0)::bigint,
         max(p.ge) filter (where p.eh_lead and p.dia = p_ref)
    from p
   group by p.u
   order by 3 desc nulls last;
end $$;

-- Cabeçalho da página: quanto há guardado e até quando.
create or replace function public.monitor_ligacoes_resumo()
returns table (total bigint, primeira timestamptz, ultima timestamptz, ultima_importacao timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.get_my_role() not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query select count(*), min(m.gerada_em), max(m.gerada_em), max(m.importado_em) from public.ligacoes_manuais m;
end $$;

-- Leads em aberto do consultor logado (por leads_equipe.profile_id), com tentativas. Não expõe ligações de ninguém.
create or replace function public.meus_leads_para_tratar()
returns table (aba text, lead_id text, nome text, telefone text, status text, categoria text,
               criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)
language sql stable security definer set search_path = public as $$
  select l.aba, l.id, l.full_name, l.phone_number, l.status, l.categoria, l.criado_em_lead,
         coalesce(c.t, 0)::int, coalesce(c.a, 0)::int, c.u
    from public.leads_equipe e
    join public.leads l on public.norm_nome(l.consultor) = public.norm_nome(e.nome_planilha)
    left join lateral (
      select count(*) as t, count(*) filter (where m.atendida) as a, max(m.gerada_em) as u
        from public.ligacoes_manuais m
       where m.chave_tel is not null and m.chave_tel = public.chave_tel(l.phone_number)
    ) c on true
   where e.profile_id = auth.uid() and l.categoria in ('andamento', 'sem_contato')
   order by l.criado_em_lead;
$$;

revoke all on function public.monitor_leads_leads(text), public.monitor_ligacoes_por_usuario(date, date, date),
  public.monitor_ligacoes_resumo(), public.meus_leads_para_tratar() from public, anon;
grant execute on function public.monitor_leads_leads(text), public.monitor_ligacoes_por_usuario(date, date, date),
  public.monitor_ligacoes_resumo(), public.meus_leads_para_tratar() to authenticated;
