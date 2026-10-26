-- §112 Meus leads (Kanban) com espelho na planilha — estrutura base.
-- Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
begin;

alter table public.leads
  add column if not exists dono_id uuid references public.profiles(id) on delete set null,
  add column if not exists pego_em timestamptz,
  add column if not exists classificado_em timestamptz,
  add column if not exists classificado_por uuid references public.profiles(id) on delete set null,
  add column if not exists retorno_em date,
  add column if not exists aba_planilha text;
create index if not exists idx_leads_dono on public.leads (dono_id);
create index if not exists idx_leads_livres on public.leads (criado_em_lead desc) where dono_id is null;
create index if not exists idx_leads_id on public.leads (id);

-- Tabulações (texto EXATO da planilha). grupo = categoria do funil.
create table if not exists public.leads_status_opcoes (
  status text primary key,
  grupo text not null check (grupo in ('andamento', 'convertido', 'perdido')),
  ordem int not null,
  ativo boolean not null default true
);
insert into public.leads_status_opcoes (status, grupo, ordem) values
  ('EM NEGOCIAÇÂO', 'andamento', 1),
  ('AGENDADO RETORNO', 'andamento', 2),
  ('AGUARDANDO DOCUMENTAÇÃO', 'andamento', 3),
  ('AGUARDANDO CLIENTE DECIDIR', 'andamento', 4),
  ('PEDIDO EM ANÁLISE', 'andamento', 5),
  ('PROPOSTA ENVIADA', 'andamento', 6),          -- em uso na planilha (10 leads em 26/10), fora da lista antiga do código
  ('PROBLEMA SISTÊMICO', 'andamento', 7),        -- idem (7 leads)
  ('PEDIDO CONCLUIDO (VENDA)', 'convertido', 10),
  ('CLIENTE NÃO RESPONDE', 'perdido', 20),
  ('CLIENTE NÃO ACEITOU VALORES', 'perdido', 21),
  ('CLIENTE SEM INTERESSE NO PLANO', 'perdido', 22),
  ('LEAD PAROU DE RESPONDER', 'perdido', 23),
  ('CNPJ INAPTO', 'perdido', 24),
  ('TELEFONE ERRADO ou  SEM WHATSAPP', 'perdido', 25),   -- grafia exata da planilha ("ou" minúsculo, 2 espaços)
  ('LEAD FORA DO PERFIL', 'perdido', 26),
  ('CLIENTE SO QUERIA APARELHO', 'perdido', 27),
  ('CLIENTE SÓ QUERIA FIBRA', 'perdido', 28),
  ('CNPJ REPROVADO', 'perdido', 29),
  ('SUSPEITA DE FRAUDE', 'perdido', 30),
  ('CLIENTE NÃO QUER NO CNPJ', 'perdido', 31)
on conflict (status) do nothing;
alter table public.leads_status_opcoes enable row level security;
do $$ begin   -- cria só se não existir (o conector do Supabase trava em comando destrutivo)
  if not exists (select 1 from pg_policies where tablename = 'leads_status_opcoes' and policyname = 'leads_status_opcoes_select') then
    create policy leads_status_opcoes_select on public.leads_status_opcoes for select to authenticated using (true);
  end if;
end $$;
do $$ begin   -- cria só se não existir (o conector do Supabase trava em comando destrutivo)
  if not exists (select 1 from pg_policies where tablename = 'leads_status_opcoes' and policyname = 'leads_status_opcoes_write') then
    create policy leads_status_opcoes_write on public.leads_status_opcoes for all to authenticated
      using (public.get_my_role() = 'admin') with check (public.get_my_role() = 'admin');
  end if;
end $$;

-- Histórico de pegar/classificar/redistribuir/devolver (só as RPCs escrevem).
create table if not exists public.leads_historico (
  id bigint generated always as identity primary key,
  lead_aba text not null,
  lead_id text not null,
  acao text not null check (acao in ('pegar', 'classificar', 'redistribuir', 'devolver')),
  por uuid references public.profiles(id) on delete set null,
  em timestamptz not null default now(),
  antes jsonb,
  depois jsonb
);
create index if not exists idx_leads_historico_lead on public.leads_historico (lead_aba, lead_id, em desc);
alter table public.leads_historico enable row level security;
do $$ begin   -- cria só se não existir (o conector do Supabase trava em comando destrutivo)
  if not exists (select 1 from pg_policies where tablename = 'leads_historico' and policyname = 'leads_historico_select') then
    create policy leads_historico_select on public.leads_historico for select to authenticated
      using (por = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
  end if;
end $$;

-- Fila do espelho: no máximo 1 item por lead (repetir só atualiza pedido_em).
create table if not exists public.leads_espelho (
  lead_aba text not null,
  lead_id text not null,
  pedido_em timestamptz not null default now(),
  tentativas int not null default 0,
  proxima_em timestamptz not null default now(),
  ultimo_erro text,
  feito_em timestamptz,
  primary key (lead_aba, lead_id)
);
create index if not exists idx_leads_espelho_pendente on public.leads_espelho (proxima_em) where feito_em is null;
alter table public.leads_espelho enable row level security;
do $$ begin   -- cria só se não existir (o conector do Supabase trava em comando destrutivo)
  if not exists (select 1 from pg_policies where tablename = 'leads_espelho' and policyname = 'leads_espelho_select') then
    create policy leads_espelho_select on public.leads_espelho for select to authenticated
      using (public.get_my_role() in ('admin', 'supervisor'));
  end if;
end $$;

-- Nome da aba (mês) de um lead pela data de criação em São Paulo; sem data = mês corrente. Igual às abas: MARCO sem cedilha.
create or replace function public.leads_mes_aba(p_ts timestamptz) returns text
language sql stable set search_path = public as $$
  select (array['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'])
         [extract(month from coalesce(p_ts, now()) at time zone 'America/Sao_Paulo')::int];
$$;

create or replace function public.leads_espelho_enfileirar(p_aba text, p_id text) returns void
language sql security definer set search_path = public as $$
  insert into public.leads_espelho (lead_aba, lead_id) values (p_aba, p_id)
  on conflict (lead_aba, lead_id) do update
    set pedido_em = now(), proxima_em = now(), tentativas = 0, ultimo_erro = null, feito_em = null;
$$;
revoke all on function public.leads_espelho_enfileirar(text, text) from public, anon, authenticated;

insert into public.config (chave, valor) values
  ('leads_modo', 'planilha'),
  ('leads_planilha', '{"sheet_id":"1nu3yNLedr3ier2f7S6dI95XX6gxyJpsg4dtpi66AP5w","entrada_prefixo":"FORM-","guia_mes_contem":"CLARO B2B","guias_fixas":{"AGOSTO":"FORM- LEADS CLARO B2B APEX - AGOSTO"}}'),
  ('leads_espelho_aviso', '')
on conflict (chave) do nothing;

commit;
