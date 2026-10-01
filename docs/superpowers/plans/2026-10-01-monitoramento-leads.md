# Monitoramento Leads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sub-aba "Monitoramento Leads" na aba Digital (admin/supervisor) que cruza o relatório de ligações manuais (upload) com os leads, e a seção "Meus leads para tratar" na aba Pedidos Parados do consultor.

**Architecture:** O relatório de telefonia é lido no navegador (SheetJS) e gravado por upsert na tabela `ligacoes_manuais`. O cruzamento com `leads` é feito pelo telefone normalizado (`chave_tel` = DDD + 8 últimos dígitos) em RPCs `security definer` (admin/supervisor) e numa RPC do consultor que só devolve os leads dele. A classificação (fila, cadência, inconsistências, cards) é feita por funções JS puras e testadas.

**Tech Stack:** Supabase (Postgres + RLS + RPC), `_template.html` (JS inline, sem framework), SheetJS (`XLSX`, já carregado), testes `node` + jsdom no padrão dos `test_*.js`.

**Spec:** `docs/superpowers/specs/2026-10-01-monitoramento-leads-design.md`

## Global Constraints

- Trabalhar só no worktree `.worktrees/monitoramento-leads` (branch `feat/monitoramento-leads`, base `oficial/main`). Nunca trocar de branch na pasta principal.
- Editar só `_template.html` (o `painel_clientes_apex.html` é gerado por `python build_painel.py`; nunca editar à mão).
- Cores só por variável CSS (`var(--...)`), nunca hex fixo novo; classes existentes: `.card`, `.kpiGrid`, `.kpiCard` (`.kpiLabel`, `.kpiValue`, `.kpiSub`, `.kpiBarTrack`, `.kpiBarFill`), `table.tbl`, `.btn` (`.btn-sm`, `.btn-outline`), `.field`, `.badge`, `.filterPills`/`.filterPill`.
- Não mexer em: bloco `<style>` do sistema visual, `aside.sidebar`/`nav#tabsNav`/`#pageHead`, `ApexMotion`, `mostrarAviso`, `fecharOverlay`.
- Avisos com `mostrarAviso(msg, 'ok'|'erro'|'info')`; nunca `alert()`.
- O repositório é público: nenhum telefone, nome, CNPJ ou relatório real em testes, migrations ou docs. Só dados fictícios.
- Padrões iniciais de meta: `min_tentativas` 3, `max_tentativas` 10, `meta_ligacoes_dia` 80, `conversa_boa_seg` 60, `sla_primeira_ligacao_h` 24.
- "Número de lead" = telefone presente em qualquer aba de `leads`. `chave_tel` = DDD + 8 últimos dígitos (tira o `55` inicial quando há 12+ dígitos).
- Horário das ligações = São Paulo (`-03:00`). Janelas hoje/ontem/7/30 dias calculadas com `hojeSP()`.
- Monitoramento Leads só admin/supervisor; consultor nunca lê `ligacoes_manuais` (só a RPC `meus_leads_para_tratar`).
- **Escrita no Supabase `apex` (migration) e publicação só com OK explícito do Rafael.** Nenhuma tarefa deste plano aplica migration em produção ou publica; isso é a Task 10, sob autorização.
- Testes de jsdom: sempre `window.eval(jsCode + testScript)` numa única chamada.
- Todo commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Telefone em formatos diferentes (`p:+5519...`, `(19) 98128-0203`, com/sem 55, com/sem 9º dígito) tem que gerar a mesma chave; telefone vazio/curto não pode casar com ninguém. (Task 2)
- Relatório com cabeçalho diferente (acento, caixa, espaço) ou sem colunas obrigatórias: aceitar o primeiro, recusar o segundo com mensagem clara; linha com ID repetido ou data inválida não pode quebrar o upload. (Task 2, 4)
- Reenviar o mesmo arquivo não pode duplicar nem inflar contagens ("novas" = 0). (Task 4)
- Consultor logado nunca vê o monitoramento nem chama as RPCs de admin; consultor sem vínculo em `leads_equipe` não vê a seção de leads, e isso não gera aviso nem erro. (Tasks 3, 9)
- Lista vazia (sem leads na aba, sem ligações importadas, equipe sem ninguém monitorado) não pode quebrar a tela nem mostrar `NaN`/`undefined`. (Tasks 5, 6)
- Fronteiras: lead com exatamente `min_tentativas` ou `max_tentativas` tentativas; ligação às 23h59 no fuso de SP caindo no dia certo. (Tasks 2, 6, 1)

## Desvios deliberados da spec (decididos ao ler o código; avisar o Rafael na entrega)

- **Excel simples (SheetJS), sem cores:** o painel principal só carrega o SheetJS; a ExcelJS (colorida) existe apenas dentro do Dashboard de Produção. Trazê-la só para isso não compensa agora.
- **Sub-aba escondida em vez de removida do DOM:** trocar de login no mesmo navegador deixaria a aba sumida para o admin. A proteção real continua no banco (RPCs e RLS recusam não-admin).
- **Consultor sem vínculo não vê aviso:** quase todos os consultores não recebem lead; um aviso seria ruído.
- **Placar do dia mostra a hora da última ligação** em vez do alerta "parado há X h"; o link para a gravação fica para depois (o campo `gravacao` já é guardado).
- **"Data escolhida" = período De/Até da tabela por consultor** (padrão: mês corrente); as janelas hoje/ontem/7/30 dias são colunas fixas.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261001000000_monitoramento_leads.sql` | Tabelas `ligacoes_manuais`, `leads_equipe`; funções `chave_tel`, `norm_nome`; RPCs `monitor_leads_leads`, `monitor_ligacoes_por_usuario`, `monitor_ligacoes_resumo`, `meus_leads_para_tratar`; RLS e grants |
| `supabase/rollback/20261001000000_monitoramento_leads_rollback.sql` | Desfaz a migration |
| `supabase/tests/monitoramento_leads_check.sql` | Verificação com dados fictícios dentro de transação (`rollback` no fim) |
| `_template.html` | Sub-abas da Digital, painel Monitoramento Leads, seção Meus leads para tratar, todas as funções `ml*` e `pl*` |
| `test_monitoramento_leads.js` | Testes jsdom (dados fictícios) |
| `REGRAS_NEGOCIO.md` | Nova seção documentando regras, decisões e publicação |

---

### Task 1: Migration, rollback e verificação SQL

**Files:**
- Create: `supabase/migrations/20261001000000_monitoramento_leads.sql`
- Create: `supabase/rollback/20261001000000_monitoramento_leads_rollback.sql`
- Create: `supabase/tests/monitoramento_leads_check.sql`

**Interfaces:**
- Produces (RPCs, todas `authenticated`; as 3 primeiras exigem `get_my_role() in ('admin','supervisor')`, senão `raise exception 'sem permissão' using errcode '42501'`):
  - `monitor_leads_leads(p_aba text)` → `table(lead_id text, nome text, telefone text, consultor text, status text, categoria text, receita numeric, criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)` — só leads da aba cujo consultor é de `leads_equipe` com `monitorar`.
  - `monitor_ligacoes_por_usuario(p_ref date, p_de date, p_ate date)` → `table(usuario text, total bigint, lig_leads bigint, atend_leads bigint, leads_distintos bigint, seg_leads bigint, boas_leads bigint, atend_sem_contato bigint, h_hoje bigint, h_ontem bigint, h_7 bigint, h_30 bigint, hoje_atend bigint, hoje_leads bigint, hoje_seg bigint, hoje_ultima timestamptz)`
  - `monitor_ligacoes_resumo()` → `table(total bigint, primeira timestamptz, ultima timestamptz, ultima_importacao timestamptz)`
  - `meus_leads_para_tratar()` → `table(aba text, lead_id text, nome text, telefone text, status text, categoria text, criado_em_lead timestamptz, tentativas int, atendidas int, ultima_ligacao timestamptz)` — leads em `andamento`/`sem_contato` do consultor ligado por `leads_equipe.profile_id = auth.uid()`.
- Tabelas: `ligacoes_manuais(id bigint pk, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao, transferido, gravacao, importado_em, importado_por)`; `leads_equipe(id bigint identity pk, nome_planilha, usuario_telefonia, profile_id uuid null, monitorar bool, desde date)`.

- [ ] **Step 1: Escrever a migration**

Create `supabase/migrations/20261001000000_monitoramento_leads.sql`:

```sql
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
```

- [ ] **Step 2: Escrever o rollback**

Create `supabase/rollback/20261001000000_monitoramento_leads_rollback.sql`:

```sql
-- Desfaz 20261001000000_monitoramento_leads.sql. Reverta o PAINEL antes (o painel novo chama estas RPCs).
-- Apaga as ligações importadas e a lista da equipe de leads (as metas em config.monitor_leads_metas ficam).
drop function if exists public.meus_leads_para_tratar();
drop function if exists public.monitor_ligacoes_resumo();
drop function if exists public.monitor_ligacoes_por_usuario(date, date, date);
drop function if exists public.monitor_leads_leads(text);
drop table if exists public.leads_equipe;
drop table if exists public.ligacoes_manuais;
drop function if exists public.norm_nome(text);
drop function if exists public.chave_tel(text);
```

- [ ] **Step 3: Escrever a verificação com dados fictícios (transação com rollback)**

Create `supabase/tests/monitoramento_leads_check.sql`:

```sql
-- Verificação do Monitoramento Leads. Roda SOMENTE depois de a migration estar aplicada e SEMPRE termina em ROLLBACK
-- (os dados fictícios nunca ficam no banco). Falha = exceção com a mensagem do assert.
-- Usa 1 admin e 1 consultor reais APENAS pelo id (não lê nem grava nada neles).
begin;

insert into public.leads (id, aba, consultor, full_name, phone_number, categoria, status, criado_em_lead) values
  ('zz:1', 'ZZTESTE', 'Caio Teste', 'Lead Um',   'p:+5519900000001', 'sem_contato', '',                         now() - interval '2 days'),
  ('zz:2', 'ZZTESTE', 'Caio Teste', 'Lead Dois', 'p:+5511900000002', 'convertido',  'PEDIDO CONCLUIDO (VENDA)', now()),
  ('zz:3', 'ZZTESTE', 'Outro',      'Lead Tres', 'p:+5518900000003', 'andamento',   'EM NEGOCIACAO',            now());
insert into public.leads_equipe (nome_planilha, usuario_telefonia, monitorar, profile_id)
  values ('Caio Teste', 'apex.teste', true, (select id from public.profiles where role = 'consultor' limit 1));
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
  (-1, 'apex.teste', '19900000001',        public.chave_tel('19900000001'),        now(),                      true,  90, 'SEM CONTATO'),
  (-2, 'apex.teste', '(19) 90000-0001',    public.chave_tel('(19) 90000-0001'),    now() - interval '1 day',   false, 0,  null),
  (-3, 'apex.outro', '11900000002',        public.chave_tel('11900000002'),        now(),                      true,  10, null);

do $$
declare
  adm uuid := (select id from public.profiles where role = 'admin' limit 1);
  con uuid := (select profile_id from public.leads_equipe where nome_planilha = 'Caio Teste');
  n int; r record; ok boolean;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- 1) chave_tel: formatos diferentes, mesma chave; curto/vazio = null
  assert public.chave_tel('p:+5519900000001') = '1900000001', 'chave_tel com 55 e 9';
  assert public.chave_tel('(19) 90000-0001') = '1900000001', 'chave_tel formatado';
  assert public.chave_tel('1900000001') = '1900000001', 'chave_tel sem 9';
  assert public.chave_tel('123') is null and public.chave_tel(null) is null and public.chave_tel('') is null, 'chave_tel curto/vazio';
  assert public.norm_nome('  JOÃO   Álvaro ') = 'joao alvaro', 'norm_nome';

  -- 2) admin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.monitor_leads_leads('ZZTESTE');
  assert n = 2, 'admin vê só os 2 leads do consultor monitorado, veio ' || n;
  select * into r from public.monitor_leads_leads('ZZTESTE') where lead_id = 'zz:1';
  assert r.tentativas = 2 and r.atendidas = 1, 'zz:1 tem 2 tentativas e 1 atendida';
  select * into r from public.monitor_ligacoes_por_usuario(hoje, null, null) where usuario = 'apex.teste';
  assert r.lig_leads = 2 and r.leads_distintos = 1 and r.h_hoje = 1 and r.h_ontem = 1 and r.h_7 = 2, 'janelas do apex.teste';
  assert r.atend_sem_contato = 1 and r.boas_leads = 1, 'qualidade do apex.teste';
  select * into r from public.monitor_ligacoes_por_usuario(hoje, hoje, hoje) where usuario = 'apex.teste';
  assert r.lig_leads = 1, 'período de um dia só conta as de hoje';
  select total into n from public.monitor_ligacoes_resumo();
  assert n >= 3, 'resumo conta as ligações';
  execute 'reset role';

  -- 3) consultor vinculado: não chama RPC de admin, não lê ligações, vê só os leads dele em aberto
  perform set_config('request.jwt.claims', json_build_object('sub', con, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', con::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin perform * from public.monitor_leads_leads('ZZTESTE'); exception when others then ok := true; end;
  assert ok, 'consultor não pode chamar monitor_leads_leads';
  select count(*) into n from public.ligacoes_manuais;
  assert n = 0, 'consultor não lê ligacoes_manuais (RLS)';
  select count(*) into n from public.meus_leads_para_tratar();
  assert n = 1, 'consultor vê só zz:1 (zz:2 é venda), veio ' || n;
  select * into r from public.meus_leads_para_tratar() limit 1;
  assert r.lead_id = 'zz:1' and r.tentativas = 2, 'tentativas do lead dele';
  execute 'reset role';

  -- 4) anônimo: sem acesso às funções
  execute 'set local role anon';
  ok := false;
  begin perform * from public.meus_leads_para_tratar(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não executa meus_leads_para_tratar';
  execute 'reset role';
end $$;

rollback;
```

- [ ] **Step 4: Conferir sintaxe sem tocar em produção**

Run: `grep -c "create or replace function" supabase/migrations/20261001000000_monitoramento_leads.sql`
Expected: `6` (chave_tel, norm_nome, monitor_leads_leads, monitor_ligacoes_por_usuario, monitor_ligacoes_resumo, meus_leads_para_tratar).

A execução real (migration e `monitoramento_leads_check.sql`) só acontece na Task 10, com OK do Rafael.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261001000000_monitoramento_leads.sql supabase/rollback/20261001000000_monitoramento_leads_rollback.sql supabase/tests/monitoramento_leads_check.sql
git commit -m "feat(monitoramento-leads): migration, rollback e verificação SQL" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Funções puras (telefone, leitura do relatório, classificação, cards) + harness de teste

**Files:**
- Create: `test_monitoramento_leads.js`
- Modify: `_template.html` — inserir um bloco novo imediatamente antes da linha `// Pílulas de aba da planilha (Setembro/Agosto/Repique): só trocam a aba e re-renderizam, sem refetch.` (única no arquivo). O bloco termina com o marcador `/* ==== FIM MONITORAMENTO LEADS ==== */`; as tarefas seguintes inserem código sempre **imediatamente antes desse marcador**.

**Interfaces:**
- Produces (todas no escopo global do script):
  - `ML_METAS_PADRAO` = `{ min_tentativas:3, max_tentativas:10, meta_ligacoes_dia:80, conversa_boa_seg:60, sla_primeira_ligacao_h:24 }`
  - `chaveTel(v) → string|null`
  - `mlNormCol(s) → string` (sem acento/caixa/símbolos), `mlNormTexto(s) → string` (MAIÚSCULO sem acento)
  - `mlParseRelatorio(rows) → { linhas: Linha[], invalidas: number, faltando: string[] }` onde `Linha = { id:number, usuario:string, telefone:string|null, chave_tel:string|null, gerada_em:string(ISO -03:00), atendida:boolean, seg_falados:number, tabulacao:string|null, transferido:string|null, gravacao:string|null }`
  - `mlMetas(valorTexto) → metas` (JSON de `config` mesclado com `ML_METAS_PADRAO`; texto inválido/vazio → padrão)
  - `mlClassificarLeads(leads, metas, agoraMs) → { semLigacao, abaixoMin, acimaTeto, inconsistencias:{ planilhaDesatualizada, perdidoCedo, vendaSemLigacao } }` (itens = linha do lead + `horasDesdeEntrada`, `atrasadoSla`)
  - `mlCardsEquipe(equipe, leads) → [{ nome, usuario, leads, convertidos, perdidos, andamento, semContato, receita, ticket, taxa, semLigacao }]`
  - Lead (linha da RPC `monitor_leads_leads`) = `{ lead_id, nome, telefone, consultor, status, categoria, receita, criado_em_lead, tentativas, atendidas, ultima_ligacao }`; equipe = `{ id, nome_planilha, usuario_telefonia, profile_id, monitorar }`.

- [ ] **Step 1: Criar o harness e os testes que falham**

Create `test_monitoramento_leads.js` (cada tarefa seguinte adiciona asserts antes da linha `console.log('--- RESULTADO`):

```js
// Testa o Monitoramento Leads (ligações manuais x leads) e a seção "Meus leads para tratar" (01/10/2026).
// Ver REGRAS_NEGOCIO.md e docs/superpowers/specs/2026-10-01-monitoramento-leads-design.md.
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__rpcCalls = [];
window.__rpcRespostas = {};   // nome da rpc -> { data, error } | função(args)
window.__tabelas = {};        // tabela -> linhas
window.__escritas = [];       // upsert/insert/delete feitos pelo painel
window.__xlsx = [];           // arquivos que o painel mandou baixar
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: window.__erroEscrita || null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: (wb, nome) => window.__xlsx.push({ wb, nome }) });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));

  // ==== TASK 2: funções puras ====
  // telefone: formatos diferentes, mesma chave; curto/vazio = null
  eq(chaveTel('p:+5519900000001'), '1900000001', 'chaveTel com 55 e 9º dígito');
  eq(chaveTel('(19) 90000-0001'), '1900000001', 'chaveTel formatado');
  eq(chaveTel(19900000001), '1900000001', 'chaveTel numérico');
  eq(chaveTel('1900000001'), '1900000001', 'chaveTel sem 9º dígito');
  eq(chaveTel('5532221234'), '5532221234', 'DDD 55 (RS) com 10 dígitos não perde o 55');
  eq(chaveTel('123'), null, 'chaveTel curto');
  eq(chaveTel(null), null, 'chaveTel null');
  eq(chaveTel(''), null, 'chaveTel vazio');

  // relatório da telefonia
  const rel = [
    { 'ID': 1001, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': '08/09/2026 12:20:59', 'Tempo_Chamada': '00:01:30', 'Última Tabulação': 'SEM CONTATO', 'Transferido': null, 'Gravacao': 'g/1' },
    { 'ID': 1002, 'Usuario': 'apex.fulano', 'Telefone': '(19) 90000-0001', 'Status': 'FAILED', 'DataHora_Geracao': '08/09/2026 23:59:59', 'Tempo_Chamada': null, 'Última Tabulação': '-' },
    { 'ID': 1002, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'FAILED', 'DataHora_Geracao': '08/09/2026 13:00:00' },
    { 'ID': 1003, 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': 'data ruim' },
    { 'ID': '', 'Usuario': 'apex.fulano', 'Telefone': 19900000001, 'Status': 'ANSWERED', 'DataHora_Geracao': '08/09/2026 14:00:00' },
  ];
  const p = mlParseRelatorio(rel);
  eq(p.faltando, [], 'relatório completo não falta coluna');
  eq(p.linhas.length, 2, 'ID repetido conta uma vez; data ruim e ID vazio são inválidos');
  eq(p.invalidas, 2, 'duas linhas inválidas');
  eq(p.linhas[0], { id: 1001, usuario: 'apex.fulano', telefone: '19900000001', chave_tel: '1900000001', gerada_em: '2026-09-08T12:20:59-03:00', atendida: true, seg_falados: 90, tabulacao: 'SEM CONTATO', transferido: null, gravacao: 'g/1' }, 'linha 1 convertida');
  assert(p.linhas[1].atendida === false && p.linhas[1].seg_falados === 0 && p.linhas[1].gerada_em === '2026-09-08T23:59:59-03:00', 'linha 2: falhou, 0 s, 23:59 mantém o dia');
  // cabeçalho com outra grafia
  const p2 = mlParseRelatorio([{ ' id ': 5, 'USUÁRIO': 'x', 'telefone': 1, 'STATUS': 'ANSWERED', 'datahora geração': '01/10/2026 09:00' }]);
  eq(p2.faltando, [], 'cabeçalho com acento/caixa/espaço diferente é aceito');
  eq(p2.linhas.length, 1, 'e a linha entra');
  // sem colunas obrigatórias
  const p3 = mlParseRelatorio([{ 'Nome': 'a', 'Valor': 1 }]);
  assert(p3.faltando.length === 5 && p3.linhas.length === 0, 'arquivo errado: todas as obrigatórias faltando e nenhuma linha');
  eq(mlParseRelatorio([]).faltando.length, 5, 'arquivo vazio recusado');

  // metas
  eq(mlMetas(null), ML_METAS_PADRAO, 'sem config = padrão');
  eq(mlMetas('{ruim'), ML_METAS_PADRAO, 'JSON inválido = padrão');
  eq(mlMetas('{"min_tentativas":5}').min_tentativas, 5, 'config sobrescreve só o que veio');
  eq(mlMetas('{"min_tentativas":5}').max_tentativas, 10, 'e mantém o resto');

  // classificação (agora = 2026-10-03 12:00 UTC)
  const agora = Date.parse('2026-10-03T12:00:00Z');
  const L = (id, cat, tent, extra) => Object.assign({ lead_id: id, nome: 'Lead ' + id, telefone: '+55', consultor: 'Caio', status: '', categoria: cat, receita: 0,
    criado_em_lead: '2026-10-03T00:00:00Z', tentativas: tent, atendidas: 0, ultima_ligacao: null }, extra || {});
  const cl = mlClassificarLeads([
    L('a', 'sem_contato', 0, { criado_em_lead: '2026-10-01T00:00:00Z' }),   // 60 h sem ligação -> fila + SLA estourado
    L('b', 'sem_contato', 0, { criado_em_lead: '2026-10-03T08:00:00Z' }),   // 4 h sem ligação -> fila, dentro do SLA
    L('c', 'andamento', 2),                                                 // abaixo do mínimo (3)
    L('d', 'andamento', 3),                                                 // exatamente o mínimo: NÃO é abaixo
    L('e', 'andamento', 10),                                                // exatamente o teto: NÃO é acima
    L('f', 'andamento', 11),                                                // acima do teto
    L('g', 'sem_contato', 4),                                               // planilha desatualizada
    L('h', 'perdido', 1, { status: 'CLIENTE NÃO RESPONDE' }),               // perdido cedo
    L('i', 'perdido', 1, { status: 'CNPJ INAPTO' }),                        // perdido, mas não por "não responde"
    L('j', 'convertido', 0),                                                // venda sem ligação
    L('k', 'convertido', 5),
  ], ML_METAS_PADRAO, agora);
  eq(cl.semLigacao.map(x => x.lead_id), ['a', 'b'], 'fila: só em aberto sem ligação, mais antigo primeiro');
  assert(cl.semLigacao[0].atrasadoSla === true && cl.semLigacao[1].atrasadoSla === false, 'SLA de 24 h: a (60 h) estoura, b (4 h) não');
  eq(cl.abaixoMin.map(x => x.lead_id), ['c'], 'abaixo do mínimo: só o c (2 tentativas)');
  eq(cl.acimaTeto.map(x => x.lead_id), ['f'], 'acima do teto: só o f (11)');
  eq(cl.inconsistencias.planilhaDesatualizada.map(x => x.lead_id), ['g'], 'sem_contato com 4 ligações');
  eq(cl.inconsistencias.perdidoCedo.map(x => x.lead_id), ['h'], 'perdido por "não responde" com 1 tentativa');
  eq(cl.inconsistencias.vendaSemLigacao.map(x => x.lead_id), ['j'], 'venda sem nenhuma ligação');
  const vazio = mlClassificarLeads([], ML_METAS_PADRAO, agora);
  assert(vazio.semLigacao.length === 0 && vazio.inconsistencias.vendaSemLigacao.length === 0, 'lista vazia não quebra');
  assert(mlClassificarLeads(null, null, agora).semLigacao.length === 0, 'null não quebra');

  // cards da equipe
  const equipe = [{ id: 1, nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', monitorar: true }, { id: 2, nome_planilha: 'Zé', usuario_telefonia: null, monitorar: false }, { id: 3, nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', monitorar: true }];
  const cards = mlCardsEquipe(equipe, [
    L('1', 'convertido', 2, { receita: 100 }), L('2', 'convertido', 1, { receita: 50 }), L('3', 'perdido', 3), L('4', 'andamento', 0), L('5', 'sem_contato', 0),
    L('6', 'convertido', 1, { consultor: 'caio ' }),
  ]);
  eq(cards.map(c => c.nome), ['Caio', 'Luria'], 'só quem é monitorado, na ordem da equipe');
  eq(cards[0], { nome: 'Caio', usuario: 'apex.caiocosta', leads: 6, convertidos: 3, perdidos: 1, andamento: 1, semContato: 1, receita: 150, ticket: 50, taxa: 0.5, semLigacao: 2 }, 'card do Caio (nome da planilha sem acento/caixa/espaço)');
  eq(cards[1], { nome: 'Luria', usuario: 'Apex.luria', leads: 0, convertidos: 0, perdidos: 0, andamento: 0, semContato: 0, receita: 0, ticket: 0, taxa: 0, semLigacao: 0 }, 'quem não tem lead fica com zeros (sem NaN)');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHA: ReferenceError: chaveTel is not defined`

- [ ] **Step 3: Implementar o bloco no `_template.html`**

Inserir, imediatamente antes da linha `// Pílulas de aba da planilha (Setembro/Agosto/Repique): só trocam a aba e re-renderizam, sem refetch.`:

```js
/* ============ MONITORAMENTO LEADS (admin/supervisor) — 01/10/2026, REGRAS_NEGOCIO.md seção 59 ============
   Cruza o relatório de ligações manuais da telefonia (upload) com a tabela leads. Funções puras primeiro
   (testadas em test_monitoramento_leads.js), depois dados, telas e ações. */
const ML_METAS_PADRAO = { min_tentativas: 3, max_tentativas: 10, meta_ligacoes_dia: 80, conversa_boa_seg: 60, sla_primeira_ligacao_h: 24 };

// Telefone -> DDD + 8 últimos dígitos (ignora o 9º dígito e o 55 inicial). Mesma regra da função SQL chave_tel.
function chaveTel(v){
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if(d.startsWith('55') && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}
function mlNormCol(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function mlNormTexto(s){ return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim(); }

// Colunas do relatório da telefonia (nome já normalizado por mlNormCol).
const ML_COLUNAS = { id: 'id', usuario: 'usuario', telefone: 'telefone', gerada: 'datahorageracao', status: 'status', tempo: 'tempochamada', tab: 'ultimatabulacao', transf: 'transferido', grav: 'gravacao' };
const ML_OBRIGATORIAS = ['id', 'usuario', 'telefone', 'gerada', 'status'];
function mlSegundos(t){
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(t == null ? '' : t).trim());
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : 0;
}
// "08/09/2026 12:20:59" (ou ISO "2026-09-08 12:20:59") -> "2026-09-08T12:20:59-03:00"; qualquer outra coisa -> null
function mlDataHora(v){
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if(m) return m[3] + '-' + m[2] + '-' + m[1] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '-03:00';
  m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') + '-03:00' : null;
}
// rows = linhas do relatório como objetos {cabeçalho: valor} (XLSX.utils.sheet_to_json).
function mlParseRelatorio(rows){
  const out = { linhas: [], invalidas: 0, faltando: [] };
  if(!rows || !rows.length){ out.faltando = ML_OBRIGATORIAS.slice(); return out; }
  const mapa = {};
  Object.keys(rows[0]).forEach(k => {
    const n = mlNormCol(k);
    Object.keys(ML_COLUNAS).forEach(ch => { if(ML_COLUNAS[ch] === n && !(ch in mapa)) mapa[ch] = k; });
  });
  out.faltando = ML_OBRIGATORIAS.filter(ch => !(ch in mapa));
  if(out.faltando.length) return out;
  const txt = (r, ch) => (mapa[ch] && r[mapa[ch]] != null && String(r[mapa[ch]]).trim() !== '') ? String(r[mapa[ch]]).trim() : null;
  const vistos = new Set();
  rows.forEach(r => {
    const id = Number(txt(r, 'id'));
    const gerada = mlDataHora(txt(r, 'gerada'));
    const usuario = txt(r, 'usuario');
    if(!Number.isFinite(id) || id <= 0 || !gerada || !usuario){ out.invalidas++; return; }
    if(vistos.has(id)) return;
    vistos.add(id);
    const tel = (txt(r, 'telefone') || '').replace(/\D/g, '');
    out.linhas.push({
      id, usuario, telefone: tel || null, chave_tel: chaveTel(tel), gerada_em: gerada,
      atendida: String(txt(r, 'status') || '').toUpperCase() === 'ANSWERED',
      seg_falados: mlSegundos(txt(r, 'tempo')),
      tabulacao: txt(r, 'tab'), transferido: txt(r, 'transf'), gravacao: txt(r, 'grav'),
    });
  });
  return out;
}

// valor de config.monitor_leads_metas (texto JSON) -> metas completas
function mlMetas(valor){
  let o = {};
  try{ o = JSON.parse(valor || '{}') || {}; }catch(e){ o = {}; }
  const m = Object.assign({}, ML_METAS_PADRAO);
  Object.keys(ML_METAS_PADRAO).forEach(k => { const n = Number(o[k]); if(o[k] != null && Number.isFinite(n) && n >= 0) m[k] = n; });
  return m;
}

function mlEmAberto(l){ return l.categoria === 'andamento' || l.categoria === 'sem_contato'; }
// Fila de leads sem ligação, cadência (abaixo do mínimo / acima do teto) e inconsistências.
function mlClassificarLeads(leads, metas, agoraMs){
  const m = Object.assign({}, ML_METAS_PADRAO, metas || {});
  const out = { semLigacao: [], abaixoMin: [], acimaTeto: [], inconsistencias: { planilhaDesatualizada: [], perdidoCedo: [], vendaSemLigacao: [] } };
  (leads || []).forEach(l => {
    const t = Number(l.tentativas) || 0;
    const ms = new Date(l.criado_em_lead).getTime();
    const horas = isNaN(ms) ? null : (agoraMs - ms) / 3600000;
    const it = Object.assign({}, l, { tentativas: t, horasDesdeEntrada: horas, atrasadoSla: t === 0 && horas !== null && horas > m.sla_primeira_ligacao_h });
    const aberto = mlEmAberto(l);
    if(aberto && t === 0) out.semLigacao.push(it);
    else if(aberto && t < m.min_tentativas) out.abaixoMin.push(it);
    if(aberto && t > m.max_tentativas) out.acimaTeto.push(it);
    if(l.categoria === 'sem_contato' && t >= m.min_tentativas) out.inconsistencias.planilhaDesatualizada.push(it);
    if(l.categoria === 'perdido' && t < m.min_tentativas && mlNormTexto(l.status).includes('NAO RESPONDE')) out.inconsistencias.perdidoCedo.push(it);
    if(l.categoria === 'convertido' && t === 0) out.inconsistencias.vendaSemLigacao.push(it);
  });
  out.semLigacao.sort((a, b) => (b.horasDesdeEntrada || 0) - (a.horasDesdeEntrada || 0));   // mais antigo primeiro
  out.abaixoMin.sort((a, b) => a.tentativas - b.tentativas);
  out.acimaTeto.sort((a, b) => b.tentativas - a.tentativas);
  return out;
}

// Um card por pessoa monitorada da equipe: contagens do mês (aba) a partir das linhas da RPC monitor_leads_leads.
function mlCardsEquipe(equipe, leads){
  return (equipe || []).filter(e => e.monitorar).map(e => {
    const alvo = normalizarNomeConsultor(e.nome_planilha);
    const meus = (leads || []).filter(l => normalizarNomeConsultor(l.consultor) === alvo);
    const c = { convertido: 0, perdido: 0, andamento: 0, sem_contato: 0 };
    let receita = 0, semLigacao = 0;
    meus.forEach(l => {
      if(Object.prototype.hasOwnProperty.call(c, l.categoria)) c[l.categoria]++;
      if(l.categoria === 'convertido') receita += Number(l.receita) || 0;
      if(!(Number(l.tentativas) > 0)) semLigacao++;
    });
    const n = meus.length;
    return { nome: e.nome_planilha, usuario: e.usuario_telefonia, leads: n, convertidos: c.convertido, perdidos: c.perdido, andamento: c.andamento,
      semContato: c.sem_contato, receita, ticket: c.convertido ? receita / c.convertido : 0, taxa: n ? c.convertido / n : 0, semLigacao };
  });
}

/* ==== FIM MONITORAMENTO LEADS ==== */

```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---` (o total exato de N não importa; `0 falharam` é o critério).

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): funções puras (chave de telefone, leitura do relatório, classificação) e testes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sub-abas da Digital, esqueleto do painel, carga de dados e cards da equipe

**Files:**
- Modify: `_template.html` (CSS, HTML do painel, bloco JS)
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes (Task 2): `mlMetas`, `mlCardsEquipe`, `mlClassificarLeads`, `ML_METAS_PADRAO`. Já existentes no painel: `conversaoAbaAtual`, `conversaoLeadsCache`, `conversaoAbasDisponiveis(leads)`, `conversaoAbaRotulo(aba)`, `renderConversaoFiltrado()`, `leadDateSP(iso)`, `hojeSP()`, `somaDiasStr(d, n)`, `fetchAllRows(fabrica)`, `ppSeguro(fn)`, `fmtBRL`, `fmtPctConversao`, `escapeHtml`, `mostrarAviso`, `normalizarNomeConsultor`.
- Produces:
  - `canSeeMonitoramentoLeads() → bool` (admin ou supervisor)
  - `mlEstado` = `{ geracao, aba, sub, equipe, metas, leads, resumo, porUsuario, tabela:'equipe', de:null, ate:null, filtro:'', erro:false }`
  - `digitalSubPreparar()`, `digitalSubAtivar('leads'|'monitor')`
  - `mlCarregar() → Promise` (carrega equipe, metas, resumo, leads da aba e chama `mlRenderTudo()`)
  - `mlRenderTudo()`; `mlLeadsFiltrados() → Lead[]` (aplica `mlEstado.filtro`, que é o nome do consultor do card clicado)
  - `mlFmtDiaHora(iso) → 'dd/mm hh:mm'` (fuso SP)
  - IDs do DOM usados pelas tarefas seguintes (todos criados neste passo): `digitalSubTabs`, `digitalSubLeads`, `digitalSubMonitor`, `mlAbaPills`, `mlResumoRelatorio`, `mlErro`, `mlCardsMes`, `mlCards`, `btnMlArquivo`, `mlArquivo`, `mlUploadStatus`, `mlUploadResumo`, `mlFilaInfo`, `mlFilaTbody`, `btnMlExportFila`, `mlAbaixoInfo`, `mlAbaixoTbody`, `mlAcimaInfo`, `mlAcimaTbody`, `mlPlacarTbody`, `mlQualidadeTbody`, `mlInconsLista`, `mlTabelaPills`, `mlPeriodoDe`, `mlPeriodoAte`, `mlTabelaTbody`, `btnMlExportTabela`, `mlEquipeCard`, `mlEquipeTbody`, `btnMlEquipeAdd`, `btnMlEquipeSalvar`, `mlMetasCampos`, `btnMlMetasSalvar`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test_monitoramento_leads.js`, inserir **antes** da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 3: sub-abas, carga e cards ====
  const equipeBanco = [
    { id: 1, nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', profile_id: null, monitorar: true },
    { id: 2, nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', profile_id: null, monitorar: true },
    { id: 3, nome_planilha: 'Zé', usuario_telefonia: null, profile_id: null, monitorar: false },
  ];
  const leadsOut = [
    L('o1', 'convertido', 2, { receita: 200, consultor: 'Caio' }), L('o2', 'perdido', 3, { consultor: 'Caio' }),
    L('o3', 'andamento', 0, { consultor: 'Luria' }), L('o4', 'sem_contato', 0, { consultor: 'Luria' }),
  ];
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [{ total: 10, primeira: '2026-10-01T12:00:00Z', ultima: '2026-10-03T12:00:00Z', ultima_importacao: '2026-10-03T13:00:00Z' }], error: null };
  conversaoLeadsCache = [{ aba: 'OUTUBRO' }, { aba: 'OUTUBRO' }, { aba: 'SETEMBRO' }];
  conversaoAbaAtual = 'OUTUBRO';

  // consultor: sem barra, e pedir "monitor" cai em "leads" sem chamar a RPC de admin
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  digitalSubPreparar();
  assert(document.getElementById('digitalSubTabs').style.display === 'none', 'consultor não vê a barra de sub-abas');
  digitalSubAtivar('monitor');
  await espera(30);
  assert(document.getElementById('digitalSubMonitor').style.display === 'none' && document.getElementById('digitalSubLeads').style.display !== 'none', 'consultor continua em "Leads"');
  assert(!window.__rpcCalls.some(c => c.nome === 'monitor_leads_leads'), 'consultor não dispara a RPC de admin');
  await mlCarregar();
  assert(!window.__rpcCalls.some(c => c.nome === 'monitor_leads_leads'), 'mlCarregar não faz nada para consultor');

  // admin: barra aparece, abrir o monitoramento carrega e desenha os cards
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  digitalSubPreparar();
  assert(document.getElementById('digitalSubTabs').style.display !== 'none', 'admin vê a barra de sub-abas');
  document.querySelector('#digitalSubTabs [data-digital-sub="monitor"]').click();
  await espera(60);
  assert(document.getElementById('digitalSubMonitor').style.display !== 'none' && document.getElementById('digitalSubLeads').style.display === 'none', 'monitor visível, leads escondido');
  const chamada = window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').pop();
  assert(chamada && chamada.args.p_aba === 'OUTUBRO', 'busca os leads da aba escolhida (OUTUBRO)');
  const cs = [...document.querySelectorAll('#mlCards .mlCard')];
  eq(cs.map(c => c.dataset.mlCard), ['Caio', 'Luria'], 'um card por consultor monitorado (Zé não)');
  assert(cs[0].textContent.includes('50,0%') && cs[0].textContent.includes('1 venda') && cs[0].textContent.includes('R$'), 'card do Caio: 50,0%, 1 venda, receita');
  assert(cs[1].textContent.includes('0,0%') && cs[1].textContent.includes('Sem ligação 2'), 'card da Luria: 0,0% e 2 sem ligação');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'nada de NaN/undefined na tela');
  assert(document.getElementById('mlResumoRelatorio').textContent.includes('10 ligações'), 'cabeçalho mostra quantas ligações estão guardadas');
  eq([...document.querySelectorAll('#mlAbaPills .filterPill')].map(b => b.textContent.replace(/\s+/g, ' ').trim()), ['Outubro 2', 'Setembro 1'], 'pílulas de mês no monitoramento');

  // trocar o mês no monitoramento recarrega com a aba nova
  document.querySelector('#mlAbaPills [data-ml-aba="SETEMBRO"]').click();
  await espera(60);
  assert(conversaoAbaAtual === 'SETEMBRO' && window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').pop().args.p_aba === 'SETEMBRO', 'trocar a pílula recarrega com SETEMBRO');
  conversaoAbaAtual = 'OUTUBRO';
  await mlCarregar();

  // clicar num card filtra; clicar de novo limpa
  document.querySelector('#mlCards [data-ml-card="Caio"]').click();
  eq(mlLeadsFiltrados().map(l => l.lead_id), ['o1', 'o2'], 'filtro por consultor');
  assert(document.querySelector('#mlCards [data-ml-card="Caio"]').classList.contains('ativo'), 'card ativo marcado');
  document.querySelector('#mlCards [data-ml-card="Caio"]').click();
  eq(mlLeadsFiltrados().length, 4, 'segundo clique limpa o filtro');

  // vazio: sem equipe monitorada, sem leads, sem relatório
  window.__tabelas.leads_equipe = [];
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  await mlCarregar();
  assert(document.getElementById('mlCards').textContent.includes('Nenhum consultor'), 'sem equipe: mensagem em vez de cards');
  assert(document.getElementById('mlResumoRelatorio').textContent.includes('Nenhum relatório'), 'sem relatório: mensagem');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'vazio também sem NaN/undefined');

  // erro da RPC (migration ainda não aplicada): aviso, sem quebrar
  window.__rpcRespostas.monitor_leads_leads = { data: null, error: { message: 'function does not exist' } };
  await mlCarregar();
  assert(document.getElementById('mlErro').style.display !== 'none', 'erro mostra o aviso de que não foi possível carregar');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHA: ReferenceError: digitalSubPreparar is not defined`

- [ ] **Step 3: CSS**

Em `_template.html`, trocar a linha única
`  /* Pedidos Parados (30/09/2026) — só tokens do design; níveis usam as mesmas cores da seção 48 */`
por:

```css
  /* Monitoramento Leads (01/10/2026) — só tokens do design */
  .mlCard{cursor:pointer;}
  .mlCard.ativo{outline:2px solid var(--c-sinal);outline-offset:-2px;}
  .mlAtraso{color:var(--st-perdido);font-weight:600;}
  .mlTabelaWrap{overflow-x:auto;}
  /* Pedidos Parados (30/09/2026) — só tokens do design; níveis usam as mesmas cores da seção 48 */
```

- [ ] **Step 4: HTML — barra de sub-abas e esqueleto do painel**

(a) Trocar
```html
    <section class="panel" id="panel-conversao">
      <div class="card">
        <h3>Digital</h3>
```
por
```html
    <section class="panel" id="panel-conversao">
      <div class="filterPills" id="digitalSubTabs" style="display:none;margin-bottom:14px">
        <button type="button" class="filterPill active" data-digital-sub="leads">Leads</button>
        <button type="button" class="filterPill" data-digital-sub="monitor">Monitoramento Leads</button>
      </div>
      <div id="digitalSubLeads">
      <div class="card">
        <h3>Digital</h3>
```

(b) Trocar
```html
            <tbody id="vendaOrigemTbody"></tbody>
          </table>
        </div>
      </div>
    </section>
```
por
```html
            <tbody id="vendaOrigemTbody"></tbody>
          </table>
        </div>
      </div>
      </div><!-- /digitalSubLeads -->

      <!-- MONITORAMENTO LEADS (só admin/supervisor) — 01/10/2026, REGRAS_NEGOCIO.md seção 59 -->
      <div id="digitalSubMonitor" style="display:none">
        <div class="card">
          <h3>Monitoramento Leads</h3>
          <p class="desc">Acompanha se quem recebe leads está ligando, tratando e vendendo. As ligações vêm do relatório de chamadas manuais da telefonia, enviado por arquivo (a telefonia não tem API).</p>
          <div class="filterPills" id="mlAbaPills"></div>
          <p class="desc" id="mlResumoRelatorio" style="margin-top:10px"></p>
          <p class="desc mlAtraso" id="mlErro" style="display:none">Não foi possível carregar o monitoramento agora (a atualização do banco pode ainda não ter sido aplicada). Tente de novo em instantes.</p>
        </div>

        <div class="card">
          <h3>Consultores de leads — <span id="mlCardsMes"></span></h3>
          <p class="desc">Do mês escolhido. Clique num card para filtrar os blocos abaixo por aquela pessoa.</p>
          <div class="kpiGrid" id="mlCards"></div>
        </div>

        <div class="card" id="mlUploadCard">
          <h3>Enviar relatório de ligações manuais</h3>
          <p class="desc">Envie o arquivo exportado da telefonia (Excel). Pode enviar o mês inteiro de novo: o que já existe não é duplicado.</p>
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <input type="file" id="mlArquivo" accept=".xlsx,.xls,.csv" style="display:none">
            <button class="btn btn-sm" type="button" id="btnMlArquivo" style="width:auto">Escolher arquivo</button>
            <span id="mlUploadStatus" style="font-size:12px;color:var(--muted)"></span>
          </div>
          <div class="kpiGrid" id="mlUploadResumo" style="margin-top:10px"></div>
        </div>

        <div class="card">
          <h3>Leads sem nenhuma ligação</h3>
          <p class="desc" id="mlFilaInfo"></p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Lead</th><th>Telefone</th><th>Consultor</th><th>Status na planilha</th><th>Entrou há</th></tr></thead>
            <tbody id="mlFilaTbody"></tbody>
          </table></div>
          <button class="btn btn-sm btn-outline" type="button" id="btnMlExportFila" style="width:auto;margin-top:10px">Exportar Excel</button>
        </div>

        <div class="card">
          <h3>Cadência de tentativas</h3>
          <p class="desc" id="mlAbaixoInfo"></p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Lead</th><th>Consultor</th><th>Status</th><th>Tentativas</th><th>Última ligação</th></tr></thead>
            <tbody id="mlAbaixoTbody"></tbody>
          </table></div>
          <p class="desc" id="mlAcimaInfo" style="margin-top:14px"></p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Lead</th><th>Consultor</th><th>Status</th><th>Tentativas</th><th>Última ligação</th></tr></thead>
            <tbody id="mlAcimaTbody"></tbody>
          </table></div>
        </div>

        <div class="card">
          <h3>Placar do dia</h3>
          <p class="desc">Ligações para números de lead feitas hoje, contra a meta diária.</p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Consultor</th><th>Ligações hoje</th><th>% da meta</th><th>Atendidas</th><th>Leads tocados</th><th>Min. falados</th><th>Última ligação</th></tr></thead>
            <tbody id="mlPlacarTbody"></tbody>
          </table></div>
        </div>

        <div class="card">
          <h3>Qualidade das ligações</h3>
          <p class="desc">No período escolhido na tabela por consultor (abaixo). Atendida não é o mesmo que conversa: veja quanto tempo falaram.</p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Consultor</th><th>Para leads</th><th>Taxa de atendimento</th><th>Duração média falada</th><th>Conversas boas</th><th>Atendidas tabuladas "sem contato"</th></tr></thead>
            <tbody id="mlQualidadeTbody"></tbody>
          </table></div>
        </div>

        <div class="card">
          <h3>Inconsistências</h3>
          <p class="desc">Onde a planilha de leads e as ligações não batem.</p>
          <div id="mlInconsLista"></div>
        </div>

        <div class="card">
          <h3>Ligações por consultor</h3>
          <div class="filterPills" id="mlTabelaPills">
            <button type="button" class="filterPill active" data-ml-tabela="equipe">Os consultores de leads</button>
            <button type="button" class="filterPill" data-ml-tabela="todos">Todos os consultores</button>
          </div>
          <div style="display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:10px">
            <div class="field" style="margin:0;width:170px"><label>De</label><input type="date" id="mlPeriodoDe"></div>
            <div class="field" style="margin:0;width:170px"><label>Até</label><input type="date" id="mlPeriodoAte"></div>
          </div>
          <div class="mlTabelaWrap"><table class="tbl" style="margin-top:12px">
            <thead><tr><th>Consultor</th><th>Ligações manuais</th><th>Para leads</th><th>% do total</th><th>Atendidas</th><th>Leads diferentes</th><th>Tentativas por lead</th><th>Hoje</th><th>Ontem</th><th>7 dias</th><th>30 dias</th></tr></thead>
            <tbody id="mlTabelaTbody"></tbody>
          </table></div>
          <button class="btn btn-sm btn-outline" type="button" id="btnMlExportTabela" style="width:auto;margin-top:10px">Exportar Excel</button>
        </div>

        <div class="card" id="mlEquipeCard" style="display:none">
          <h3>Equipe de leads e metas</h3>
          <p class="desc">Quem recebe leads agora, como o nome aparece na planilha e na telefonia, e o perfil do painel (é o que mostra a cada consultor só os próprios leads). As metas valem para os blocos acima.</p>
          <div class="mlTabelaWrap"><table class="tbl">
            <thead><tr><th>Nome na planilha de leads</th><th>Usuário na telefonia</th><th>Perfil do painel</th><th>Monitorar</th><th></th></tr></thead>
            <tbody id="mlEquipeTbody"></tbody>
          </table></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-sm btn-outline" type="button" id="btnMlEquipeAdd" style="width:auto">Adicionar pessoa</button>
            <button class="btn btn-sm" type="button" id="btnMlEquipeSalvar" style="width:auto">Salvar equipe</button>
          </div>
          <div id="mlMetasCampos" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px"></div>
          <button class="btn btn-sm" type="button" id="btnMlMetasSalvar" style="width:auto;margin-top:10px">Salvar metas</button>
        </div>
      </div><!-- /digitalSubMonitor -->
    </section>
```

- [ ] **Step 5: JS — estado, carga, sub-abas e cards**

Inserir **imediatamente antes** de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: estado, carga e telas (admin/supervisor) ---- */
const mlEstado = { geracao: 0, aba: null, sub: 'leads', equipe: [], metas: Object.assign({}, ML_METAS_PADRAO), leads: [], resumo: null,
  porUsuario: [], tabela: 'equipe', de: null, ate: null, filtro: '', erro: false };
function canSeeMonitoramentoLeads(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function mlFmtDiaHora(iso){
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function mlLeadsFiltrados(){
  if(!mlEstado.filtro) return mlEstado.leads;
  const alvo = normalizarNomeConsultor(mlEstado.filtro);
  return mlEstado.leads.filter(l => normalizarNomeConsultor(l.consultor) === alvo);
}

// Barra de sub-abas da Digital: só admin/supervisor veem; para os demais a aba é a de sempre.
function digitalSubAtivar(nome){
  if(nome === 'monitor' && !canSeeMonitoramentoLeads()) nome = 'leads';
  mlEstado.sub = nome;
  document.getElementById('digitalSubLeads').style.display = nome === 'leads' ? '' : 'none';
  document.getElementById('digitalSubMonitor').style.display = nome === 'monitor' ? '' : 'none';
  document.querySelectorAll('#digitalSubTabs [data-digital-sub]').forEach(b => b.classList.toggle('active', b.dataset.digitalSub === nome));
  if(nome === 'monitor') mlCarregar();
}
function digitalSubPreparar(){
  const vis = canSeeMonitoramentoLeads();
  document.getElementById('digitalSubTabs').style.display = vis ? '' : 'none';
  if(!vis) digitalSubAtivar('leads');   // evita ficar preso no monitoramento ao trocar de login
}

async function mlCarregar(){
  if(!canSeeMonitoramentoLeads()) return;
  const geracao = ++mlEstado.geracao;
  mlEstado.aba = conversaoAbaAtual;
  const [eq, cfg, res, lds] = await Promise.all([
    ppSeguro(() => sb.from('leads_equipe').select('id,nome_planilha,usuario_telefonia,profile_id,monitorar').order('id')),
    ppSeguro(() => sb.from('config').select('valor').eq('chave', 'monitor_leads_metas').maybeSingle()),
    ppSeguro(() => sb.rpc('monitor_ligacoes_resumo')),
    mlEstado.aba ? ppSeguro(() => fetchAllRows(() => sb.rpc('monitor_leads_leads', { p_aba: mlEstado.aba }))) : Promise.resolve({ data: [], error: null }),
  ]);
  if(geracao !== mlEstado.geracao) return;   // chegou outra carga depois: esta já é velha
  const falhou = (eq && eq.error) || (lds && lds.error) || (res && res.error) || null;
  if(falhou) console.error(falhou);
  mlEstado.erro = !!falhou;
  mlEstado.equipe = (eq && eq.data) || [];
  mlEstado.metas = mlMetas(cfg && cfg.data && cfg.data.valor);
  mlEstado.resumo = (res && Array.isArray(res.data) && res.data[0]) || null;
  mlEstado.leads = (lds && lds.data) || [];
  // ==== mais cargas entram aqui ====
  if(geracao !== mlEstado.geracao) return;
  mlRenderTudo();
}

function mlRenderCabecalho(){
  const abas = conversaoAbasDisponiveis(conversaoLeadsCache);
  document.getElementById('mlAbaPills').innerHTML = abas.map(a => `<button type="button" class="filterPill${a.aba === mlEstado.aba ? ' active' : ''}" data-ml-aba="${escapeHtml(a.aba)}">${escapeHtml(conversaoAbaRotulo(a.aba))} <b>${a.n.toLocaleString('pt-BR')}</b></button>`).join('');
  const r = mlEstado.resumo, el = document.getElementById('mlResumoRelatorio');
  if(!r || !Number(r.total)){ el.textContent = 'Nenhum relatório de ligações foi enviado ainda. Envie o arquivo mais abaixo para começar.'; return; }
  const ultimoDia = leadDateSP(r.ultima);
  const velho = ultimoDia && ultimoDia < somaDiasStr(hojeSP(), -1);
  el.innerHTML = `Relatório de ligações até <b>${escapeHtml(mlFmtDiaHora(r.ultima))}</b> · ${Number(r.total).toLocaleString('pt-BR')} ligações guardadas (desde ${escapeHtml(mlFmtDiaHora(r.primeira))})`
    + (velho ? ' <span class="mlAtraso">— desatualizado: envie o relatório mais recente.</span>' : '');
}

function mlRenderCards(){
  document.getElementById('mlErro').style.display = mlEstado.erro ? '' : 'none';
  document.getElementById('mlCardsMes').textContent = mlEstado.aba ? conversaoAbaRotulo(mlEstado.aba) : '';
  const box = document.getElementById('mlCards');
  const cards = mlCardsEquipe(mlEstado.equipe, mlEstado.leads);
  if(!cards.length){
    box.innerHTML = '<p class="desc">Nenhum consultor de leads cadastrado. Cadastre a equipe no fim desta página, em "Equipe de leads e metas".</p>';
    return;
  }
  box.innerHTML = cards.map(c => `<div class="kpiCard mlCard${mlEstado.filtro === c.nome ? ' ativo' : ''}" data-ml-card="${escapeHtml(c.nome)}">
      <div class="kpiLabel">${escapeHtml(c.nome)}</div>
      <div class="kpiValue">${fmtPctConversao(c.taxa)}</div>
      <div class="kpiSub">${c.convertidos} ${c.convertidos === 1 ? 'venda' : 'vendas'} · ${c.leads} ${c.leads === 1 ? 'lead' : 'leads'}</div>
      <div class="kpiBarTrack"><div class="kpiBarFill" style="width:${Math.min(100, c.taxa * 100)}%"></div></div>
      <div class="kpiSub">Perdidos ${c.perdidos} · Em andamento ${c.andamento} · Sem contato ${c.semContato}</div>
      <div class="kpiSub">Receita ${fmtBRL(c.receita)}${c.convertidos ? ' (ticket ' + fmtBRL(c.ticket) + ')' : ''} · Sem ligação ${c.semLigacao}</div>
    </div>`).join('');
}

function mlRenderTudo(){
  mlRenderCabecalho();
  mlRenderCards();
  // ==== mais renders entram aqui ====
}

document.getElementById('digitalSubTabs').addEventListener('click', function(ev){
  const b = ev.target.closest('[data-digital-sub]');
  if(b) digitalSubAtivar(b.dataset.digitalSub);
});
document.getElementById('digitalSubMonitor').addEventListener('click', function(ev){
  const pa = ev.target.closest('[data-ml-aba]');
  if(pa){ conversaoAbaAtual = pa.dataset.mlAba; renderConversaoFiltrado(); mlCarregar(); return; }
  const cd = ev.target.closest('[data-ml-card]');
  if(cd){ mlEstado.filtro = mlEstado.filtro === cd.dataset.mlCard ? '' : cd.dataset.mlCard; mlRenderTudo(); }
});

```

- [ ] **Step 6: Ligar a barra ao carregamento da Digital**

(a) Em `loadConversaoVendas`, trocar
```js
async function loadConversaoVendas(){
  ApexMotion.skeleton(document.getElementById('conversaoResumoCards'), 'kpis');
```
por
```js
async function loadConversaoVendas(){
  digitalSubPreparar();
  ApexMotion.skeleton(document.getElementById('conversaoResumoCards'), 'kpis');
```
(b) No fim da mesma função, trocar
```js
    } else {
      cardVendaOrigem.style.display = 'none';
    }
  }
}
```
por
```js
    } else {
      cardVendaOrigem.style.display = 'none';
    }
  }
  if(mlEstado.sub === 'monitor') mlCarregar();   // voltou à Digital com o monitoramento aberto: recarrega com a aba atual
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`. Depois rodar a regressão da Digital: `node test_digital_abas.js && node test_conversao_vendas.js && node test_leads_followups.js && node test_reorganizacao_abas.js`
Expected: todos terminam sem `FALHOU`.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): sub-abas da Digital, esqueleto da página, carga e cards da equipe" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Upload do relatório de ligações

**Files:**
- Modify: `_template.html` (bloco JS antes do marcador FIM)
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes: `mlParseRelatorio`, `mlEstado.equipe`, `mlCarregar()`, `ppSeguro`, `leadDateSP`, `mostrarAviso`, `currentUser.id`.
- Produces: `mlLinhasDoWorkbook(wb) → objetos` (1ª planilha, cabeçalho na 1ª linha), `mlLerArquivo(file) → Promise<objetos>`, `mlImportarLinhas(rows) → Promise<{lidas, novas, existentes, invalidas, de, ate}|null>` (grava em lotes de 500 por `upsert(..., { onConflict: 'id' })` e redesenha tudo).

- [ ] **Step 1: Escrever os testes que falham**

Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 4: upload ====
  // o mock "guarda" os ids enviados por upsert; o RPC de resumo devolve o total guardado (base 5 + ids únicos enviados)
  const idsGuardados = () => new Set(window.__escritas.filter(e => e.tabela === 'ligacoes_manuais' && e.op === 'upsert').flatMap(e => e.rows.map(r => r.id)));
  window.__rpcRespostas.monitor_ligacoes_resumo = () => ({ data: [{ total: 5 + idsGuardados().size, primeira: '2026-10-01T12:00:00Z', ultima: '2026-10-03T12:00:00Z' }], error: null });
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__tabelas.leads_equipe = equipeBanco;
  window.__escritas.length = 0;
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  digitalSubAtivar('monitor');
  await espera(60);

  // arquivo de verdade (SheetJS): cabeçalho na 1ª linha, 1ª planilha
  const wbT = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbT, XLSX.utils.aoa_to_sheet([
    ['ID', 'Usuario', 'Telefone', 'Status', 'DataHora_Geracao', 'Tempo_Chamada', 'Última Tabulação'],
    [9001, 'apex.caiocosta', 19900000001, 'ANSWERED', '02/10/2026 10:00:00', '00:02:00', 'RETORNO'],
    [9002, 'apex.caiocosta', 19900000002, 'FAILED', '02/10/2026 10:05:00', null, '-'],
  ]), 'Plan1');
  const linhasWb = mlLinhasDoWorkbook(wbT);
  eq(linhasWb.length, 2, 'workbook: 2 linhas de dados');
  eq(mlParseRelatorio(linhasWb).linhas.map(l => l.id), [9001, 9002], 'workbook -> relatório -> 2 ligações');

  // arquivo errado: recusa e não grava
  let r = await mlImportarLinhas([{ Nome: 'x', Valor: 1 }]);
  assert(r === null && window.__escritas.length === 0, 'arquivo errado não grava nada');
  assert(document.getElementById('mlUploadStatus').textContent.includes('recusado'), 'mostra que recusou');

  // arquivo bom: grava, conta novas
  r = await mlImportarLinhas(linhasWb);
  const up = window.__escritas.filter(e => e.tabela === 'ligacoes_manuais' && e.op === 'upsert');
  assert(up.length === 1 && up[0].rows.length === 2 && up[0].opts.onConflict === 'id', 'um lote, 2 linhas, upsert por id');
  assert(up[0].rows.every(l => l.importado_por === 'a1'), 'registra quem importou');
  assert(r.lidas === 2 && r.novas === 2 && r.existentes === 0 && r.invalidas === 0, 'resumo: 2 lidas, 2 novas');
  assert(document.getElementById('mlUploadResumo').textContent.includes('2'), 'resumo aparece na tela');
  assert(window.__rpcCalls.filter(c => c.nome === 'monitor_leads_leads').length >= 2, 'depois de importar, recarrega o monitoramento');

  // reenviar o mesmo arquivo: 0 novas
  r = await mlImportarLinhas(linhasWb);
  assert(r.novas === 0 && r.existentes === 2, 'mesmo arquivo de novo: 0 novas, 2 já existiam');

  // lotes de 500
  window.__escritas.length = 0;
  const grande = []; for(let i = 0; i < 1203; i++) grande.push({ ID: 20000 + i, Usuario: 'apex.x', Telefone: 19900000000 + i, Status: 'FAILED', DataHora_Geracao: '03/10/2026 09:00:00' });
  grande.push({ ID: 'ruim', Usuario: 'apex.x', Telefone: 1, Status: 'FAILED', DataHora_Geracao: '03/10/2026 09:00:00' });
  r = await mlImportarLinhas(grande);
  eq(window.__escritas.filter(e => e.tabela === 'ligacoes_manuais').map(e => e.rows.length), [500, 500, 203], 'três lotes: 500, 500, 203');
  assert(r.lidas === 1203 && r.invalidas === 1, 'linha inválida contada, não enviada');

  // equipe sem ligação no arquivo é avisada
  assert(document.getElementById('mlUploadStatus').textContent.includes('Caio') && document.getElementById('mlUploadStatus').textContent.includes('Luria'), 'avisa quem da equipe não aparece no arquivo');

  // erro de gravação: avisa e não derruba
  window.__erroEscrita = { message: 'permission denied' };
  r = await mlImportarLinhas(linhasWb);
  assert(r === null && document.getElementById('mlUploadStatus').textContent.includes('Não foi possível'), 'erro de gravação mostra mensagem');
  window.__erroEscrita = null;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHA: ReferenceError: mlLinhasDoWorkbook is not defined`

- [ ] **Step 3: Implementar**

Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: upload do relatório de ligações ---- */
function mlLinhasDoWorkbook(wb){
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
}
function mlLerArquivo(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = evt => {
      try{ resolve(mlLinhasDoWorkbook(XLSX.read(new Uint8Array(evt.target.result), { type: 'array' }))); }
      catch(e){ reject(e); }
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler o arquivo'));
    reader.readAsArrayBuffer(file);
  });
}
async function mlTotalGuardado(){
  const r = await ppSeguro(() => sb.rpc('monitor_ligacoes_resumo'));
  return Number(r && r.data && r.data[0] && r.data[0].total) || 0;
}
function mlDiaBR(iso){ const d = leadDateSP(iso); return d ? d.split('-').reverse().join('/') : '—'; }

async function mlImportarLinhas(rows){
  const st = document.getElementById('mlUploadStatus'), box = document.getElementById('mlUploadResumo');
  box.innerHTML = '';
  const p = mlParseRelatorio(rows);
  if(p.faltando.length){
    st.textContent = 'Arquivo recusado: faltam as colunas ' + p.faltando.join(', ') + '.';
    mostrarAviso('Esse arquivo não parece o relatório de ligações manuais da telefonia.', 'erro');
    return null;
  }
  if(!p.linhas.length){
    st.textContent = 'Arquivo recusado: nenhuma ligação válida encontrada.';
    mostrarAviso('Nenhuma ligação válida encontrada no arquivo.', 'erro');
    return null;
  }
  const antes = await mlTotalGuardado();
  for(let i = 0; i < p.linhas.length; i += 500){
    const lote = p.linhas.slice(i, i + 500).map(l => Object.assign({}, l, { importado_por: currentUser.id }));
    const { error } = await sb.from('ligacoes_manuais').upsert(lote, { onConflict: 'id' });
    if(error){
      st.textContent = 'Não foi possível gravar as ligações: ' + error.message;
      mostrarAviso('Não foi possível gravar as ligações. Nada foi apagado; tente de novo.', 'erro');
      return null;
    }
    st.textContent = `Enviando... ${Math.min(i + 500, p.linhas.length)} de ${p.linhas.length}`;
  }
  const depois = await mlTotalGuardado();
  const novas = Math.max(0, depois - antes);
  const dias = p.linhas.map(l => l.gerada_em).sort();
  const res = { lidas: p.linhas.length, novas, existentes: p.linhas.length - novas, invalidas: p.invalidas, de: dias[0], ate: dias[dias.length - 1] };
  const usuarios = new Set(p.linhas.map(l => l.usuario.toLowerCase()));
  const ausentes = mlEstado.equipe.filter(e => e.monitorar && e.usuario_telefonia && !usuarios.has(String(e.usuario_telefonia).toLowerCase())).map(e => e.nome_planilha);
  const kpi = (rotulo, valor) => `<div class="kpiCard"><div class="kpiLabel">${rotulo}</div><div class="kpiValue">${valor.toLocaleString('pt-BR')}</div></div>`;
  box.innerHTML = kpi('Ligações lidas', res.lidas) + kpi('Novas', res.novas) + kpi('Já existiam', res.existentes) + kpi('Linhas inválidas', res.invalidas);
  st.textContent = `Período do arquivo: ${mlDiaBR(res.de)} a ${mlDiaBR(res.ate)}.` + (ausentes.length ? ' Sem ligações no arquivo: ' + ausentes.join(', ') + '.' : '');
  mostrarAviso(`Relatório enviado: ${res.novas} ligações novas.`, 'ok');
  await mlCarregar();
  return res;
}

document.getElementById('btnMlArquivo').addEventListener('click', () => document.getElementById('mlArquivo').click());
document.getElementById('mlArquivo').addEventListener('change', async function(ev){
  const file = ev.target.files[0];
  if(!file) return;
  document.getElementById('mlUploadStatus').textContent = 'Lendo o arquivo...';
  try{ await mlImportarLinhas(await mlLerArquivo(file)); }
  catch(e){ console.error(e); document.getElementById('mlUploadStatus').textContent = 'Não foi possível ler o arquivo.'; mostrarAviso('Não foi possível ler o arquivo. Confira se é o Excel da telefonia.', 'erro'); }
  ev.target.value = '';
});

```

Observação: `mlCarregar()` reescreve `mlUploadStatus`? Não — só `mlRenderTudo` mexe nas outras áreas; o texto do resumo do upload permanece.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): upload do relatório de ligações (lotes, sem duplicar, resumo)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fila sem ligação, cadência e inconsistências (telas)

**Files:**
- Modify: `_template.html` (bloco JS antes do marcador FIM; uma linha em `mlRenderTudo`)
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes: `mlClassificarLeads`, `mlLeadsFiltrados()`, `mlEstado.metas`, `mlFmtDiaHora`, `escapeHtml`, `mostrarAviso`.
- Produces: `mlRenderFila(cl)`, `mlRenderCadencia(cl)`, `mlRenderInconsistencias(cl)`, `mlTelBotao(tel)`, `mlHaTexto(horas)`; `mlEstado.classificado` (resultado de `mlClassificarLeads` da última renderização — a exportação da Task 8 usa).

- [ ] **Step 1: Escrever os testes que falham**

Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 5: fila, cadência, inconsistências ====
  const agoraIso = new Date().toISOString();
  const leadsFila = [
    L('f1', 'sem_contato', 0, { nome: 'Fila Antigo', consultor: 'Caio', telefone: 'p:+5519900000011', criado_em_lead: '2020-01-01T00:00:00Z' }),
    L('f2', 'sem_contato', 0, { nome: 'Fila Novo', consultor: 'Luria', criado_em_lead: agoraIso }),
    L('f3', 'andamento', 1, { nome: 'Abaixo Um', consultor: 'Caio', status: 'EM NEGOCIAÇÃO' }),
    L('f4', 'andamento', 12, { nome: 'Acima Um', consultor: 'Luria', status: 'AGUARDANDO CLIENTE', ultima_ligacao: '2026-10-03T15:00:00Z' }),
    L('f5', 'sem_contato', 5, { nome: 'Desatualizado Um', consultor: 'Caio' }),
    L('f6', 'perdido', 1, { nome: 'Perdido Cedo', consultor: 'Luria', status: 'CLIENTE NÃO RESPONDE' }),
    L('f7', 'convertido', 0, { nome: 'Venda Sem Ligacao', consultor: 'Caio', receita: 100 }),
  ];
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsFila, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  mlEstado.filtro = '';
  await mlCarregar();
  const linhasFila = [...document.querySelectorAll('#mlFilaTbody tr')];
  eq(linhasFila.map(tr => tr.children[0].textContent.trim()), ['Fila Antigo', 'Fila Novo'], 'fila: dois leads, o mais antigo primeiro');
  assert(linhasFila[0].children[4].classList.contains('mlAtraso') && !linhasFila[1].children[4].classList.contains('mlAtraso'), 'só o lead antigo estoura o SLA (vermelho)');
  assert(linhasFila[0].querySelector('[data-ml-copiar="+5519900000011"]'), 'botão de copiar o telefone (sem o prefixo p:)');
  assert(document.getElementById('mlFilaInfo').textContent.includes('2 leads') && document.getElementById('mlFilaInfo').textContent.includes('1 acima do SLA'), 'resumo da fila');
  eq([...document.querySelectorAll('#mlAbaixoTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Abaixo Um'], 'abaixo do mínimo');
  eq([...document.querySelectorAll('#mlAcimaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Acima Um'], 'acima do teto');
  const inc = document.getElementById('mlInconsLista').textContent;
  assert(inc.includes('Desatualizado Um') && inc.includes('Perdido Cedo') && inc.includes('Venda Sem Ligacao'), 'as três inconsistências aparecem');

  // filtro por consultor afeta os blocos
  mlEstado.filtro = 'Luria'; mlRenderTudo();
  eq([...document.querySelectorAll('#mlFilaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Fila Novo'], 'filtro Luria: só a fila dela');
  mlEstado.filtro = '';

  // vazio: mensagens, sem NaN
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  await mlCarregar();
  assert(document.getElementById('mlFilaTbody').textContent.includes('Nenhum lead') && document.getElementById('mlAbaixoTbody').textContent.includes('Nenhum') && document.getElementById('mlInconsLista').textContent.includes('Nenhuma'), 'listas vazias mostram mensagem');
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'listas vazias sem NaN/undefined');

  // inconsistências muito longas: mostra 10 e resume o resto
  window.__rpcRespostas.monitor_leads_leads = { data: Array.from({ length: 14 }, (_, i) => L('v' + i, 'convertido', 0, { nome: 'Venda ' + i })), error: null };
  await mlCarregar();
  assert(document.getElementById('mlInconsLista').textContent.includes('e mais 4'), 'inconsistência com 14 leads mostra 10 e "e mais 4"');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHOU: fila: dois leads, o mais antigo primeiro` (a tabela ainda está vazia).

- [ ] **Step 3: Implementar**

Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: fila sem ligação, cadência e inconsistências ---- */
function mlTelBotao(t){
  const s = String(t || '').replace(/^p:/, '');
  return s ? `<button type="button" class="btn btn-sm btn-outline" data-ml-copiar="${escapeHtml(s)}" style="width:auto">${escapeHtml(s)}</button>` : '—';
}
function mlHaTexto(horas){
  if(horas == null) return '—';
  return horas < 24 ? Math.max(1, Math.round(horas)) + ' h' : Math.floor(horas / 24) + ' d';
}
const mlLinhaVazia = (cols, msg) => `<tr><td colspan="${cols}" class="desc">${msg}</td></tr>`;

function mlRenderFila(cl){
  const m = mlEstado.metas, f = cl.semLigacao, atrasados = f.filter(x => x.atrasadoSla).length;
  document.getElementById('mlFilaInfo').textContent = f.length
    ? `${f.length} ${f.length === 1 ? 'lead' : 'leads'} em aberto sem nenhuma ligação manual, o mais antigo primeiro. ${atrasados} acima do SLA de ${m.sla_primeira_ligacao_h} h para a primeira ligação.`
    : 'Todo lead em aberto já recebeu pelo menos uma ligação.';
  document.getElementById('mlFilaTbody').innerHTML = f.length ? f.map(x => `<tr>
      <td>${escapeHtml(x.nome || '(sem nome)')}</td><td>${mlTelBotao(x.telefone)}</td><td>${escapeHtml(x.consultor || '')}</td>
      <td>${escapeHtml((x.status || '').trim() || 'sem status')}</td><td${x.atrasadoSla ? ' class="mlAtraso"' : ''}>${mlHaTexto(x.horasDesdeEntrada)}</td></tr>`).join('')
    : mlLinhaVazia(5, 'Nenhum lead sem ligação.');
}
function mlLinhasCadencia(lista){
  return lista.map(x => `<tr><td>${escapeHtml(x.nome || '(sem nome)')}</td><td>${escapeHtml(x.consultor || '')}</td>
      <td>${escapeHtml((x.status || '').trim() || 'sem status')}</td><td>${x.tentativas}</td><td>${x.ultima_ligacao ? escapeHtml(mlFmtDiaHora(x.ultima_ligacao)) : '—'}</td></tr>`).join('');
}
function mlRenderCadencia(cl){
  const m = mlEstado.metas;
  document.getElementById('mlAbaixoInfo').textContent = `Abaixo do mínimo: leads em aberto com 1 a ${m.min_tentativas - 1} tentativas (o mínimo combinado é ${m.min_tentativas} antes de desistir).`;
  document.getElementById('mlAbaixoTbody').innerHTML = cl.abaixoMin.length ? mlLinhasCadencia(cl.abaixoMin) : mlLinhaVazia(5, 'Nenhum lead abaixo do mínimo.');
  document.getElementById('mlAcimaInfo').textContent = `Acima do teto: leads ainda em aberto com mais de ${m.max_tentativas} tentativas — vale decidir se continua ou encerra.`;
  document.getElementById('mlAcimaTbody').innerHTML = cl.acimaTeto.length ? mlLinhasCadencia(cl.acimaTeto) : mlLinhaVazia(5, 'Nenhum lead acima do teto.');
}
function mlRenderInconsistencias(cl){
  const m = mlEstado.metas, i = cl.inconsistencias;
  const grupos = [
    [i.planilhaDesatualizada, 'Planilha desatualizada', `leads marcados "sem contato" que já têm ${m.min_tentativas} ou mais ligações`],
    [i.perdidoCedo, 'Perdido cedo demais', `leads marcados "cliente não responde" com menos de ${m.min_tentativas} tentativas`],
    [i.vendaSemLigacao, 'Venda sem ligação', 'vendas sem nenhuma ligação manual (pode ter vindo por WhatsApp; só confirmar)'],
  ];
  const nomes = l => l.slice(0, 10).map(x => `${escapeHtml(x.nome || '(sem nome)')} (${escapeHtml(x.consultor || '')}, ${x.tentativas} lig.)`).join('; ')
    + (l.length > 10 ? `; e mais ${l.length - 10}` : '');
  const html = grupos.filter(g => g[0].length).map(g => `<p><b>${g[1]} (${g[0].length})</b> — ${g[2]}.<br><span class="desc">${nomes(g[0])}</span></p>`).join('');
  document.getElementById('mlInconsLista').innerHTML = html || '<p class="desc">Nenhuma inconsistência encontrada.</p>';
}

document.getElementById('digitalSubMonitor').addEventListener('click', function(ev){
  const cp = ev.target.closest('[data-ml-copiar]');
  if(!cp) return;
  const txt = cp.dataset.mlCopiar;
  try{ navigator.clipboard.writeText(txt); mostrarAviso('Copiado: ' + txt, 'ok'); }catch(err){ mostrarAviso(txt, 'info'); }
});

```

E em `mlRenderTudo`, trocar
```js
  mlRenderCards();
  // ==== mais renders entram aqui ====
```
por
```js
  mlRenderCards();
  const cl = mlClassificarLeads(mlLeadsFiltrados(), mlEstado.metas, Date.now());
  mlEstado.classificado = cl;
  mlRenderFila(cl);
  mlRenderCadencia(cl);
  mlRenderInconsistencias(cl);
  // ==== mais renders entram aqui ====
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): fila sem ligação, cadência de tentativas e inconsistências" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ligações por consultor — placar do dia, qualidade e tabela (Todos / Os 4)

**Files:**
- Modify: `_template.html`
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes: RPC `monitor_ligacoes_por_usuario(p_ref, p_de, p_ate)` (colunas: `usuario,total,lig_leads,atend_leads,leads_distintos,seg_leads,boas_leads,atend_sem_contato,h_hoje,h_ontem,h_7,h_30,hoje_atend,hoje_leads,hoje_seg,hoje_ultima`), `mlEstado.equipe/metas`, `miniBarHtml(fracao)`, `fmtPctConversao`.
- Produces:
  - `mlPlacarLinhas(porUsuario, equipe, metas) → [{ nome, usuario, ligHoje, atendidasHoje, leadsHoje, minHoje, pctMeta|null, ultima|null }]`
  - `mlQualidadeLinhas(porUsuario, equipe) → [{ nome, ligLeads, taxaAtend, mediaSeg, boas, atendSemContato }]`
  - `mlTabelaLinhas(porUsuario, equipe, modo 'equipe'|'todos') → [{ usuario, nome, total, ligLeads, pctTotal, atendidas, leadsDistintos, tentativasPorLead, hoje, ontem, d7, d30 }]`
  - `mlCarregarPorUsuario() → Promise` (usa `mlEstado.de/ate`; padrão = 1º dia do mês até hoje)

- [ ] **Step 1: Escrever os testes que falham**

Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 6: ligações por consultor ====
  const U = (usuario, extra) => Object.assign({ usuario, total: 0, lig_leads: 0, atend_leads: 0, leads_distintos: 0, seg_leads: 0, boas_leads: 0, atend_sem_contato: 0,
    h_hoje: 0, h_ontem: 0, h_7: 0, h_30: 0, hoje_atend: 0, hoje_leads: 0, hoje_seg: 0, hoje_ultima: null }, extra || {});
  const porUsu = [
    U('apex.caiocosta', { total: 100, lig_leads: 40, atend_leads: 20, leads_distintos: 10, seg_leads: 1800, boas_leads: 5, atend_sem_contato: 3, h_hoje: 30, h_ontem: 25, h_7: 150, h_30: 300, hoje_atend: 12, hoje_leads: 9, hoje_seg: 600, hoje_ultima: '2026-10-03T15:00:00Z' }),
    U('apex.outro', { total: 50 }),
  ];
  const eqP = [{ nome_planilha: 'Caio', usuario_telefonia: 'apex.caiocosta', monitorar: true }, { nome_planilha: 'Luria', usuario_telefonia: 'Apex.luria', monitorar: true }, { nome_planilha: 'Zé', usuario_telefonia: 'apex.ze', monitorar: false }];
  const pl = mlPlacarLinhas(porUsu, eqP, ML_METAS_PADRAO);
  eq(pl.map(x => x.nome), ['Caio', 'Luria'], 'placar: só os monitorados');
  eq(pl[0], { nome: 'Caio', usuario: 'apex.caiocosta', ligHoje: 30, atendidasHoje: 12, leadsHoje: 9, minHoje: 10, pctMeta: 0.375, ultima: '2026-10-03T15:00:00Z' }, 'placar do Caio (30 de 80 = 37,5%)');
  eq(pl[1], { nome: 'Luria', usuario: 'Apex.luria', ligHoje: 0, atendidasHoje: 0, leadsHoje: 0, minHoje: 0, pctMeta: 0, ultima: null }, 'quem não aparece no relatório fica zerado');
  assert(mlPlacarLinhas(porUsu, eqP, { meta_ligacoes_dia: 0 })[0].pctMeta === null, 'meta 0 não divide por zero');
  const ql = mlQualidadeLinhas(porUsu, eqP);
  eq(ql[0], { nome: 'Caio', ligLeads: 40, taxaAtend: 0.5, mediaSeg: 90, boas: 5, atendSemContato: 3 }, 'qualidade do Caio: 50% atendidas, 90 s médios');
  eq(ql[1], { nome: 'Luria', ligLeads: 0, taxaAtend: 0, mediaSeg: 0, boas: 0, atendSemContato: 0 }, 'qualidade sem ligações: zeros, sem NaN');
  const tq = mlTabelaLinhas(porUsu, eqP, 'equipe');
  eq(tq.map(x => x.nome), ['Caio', 'Luria'], 'tabela "os 4": só os monitorados');
  eq(tq[0], { usuario: 'apex.caiocosta', nome: 'Caio', total: 100, ligLeads: 40, pctTotal: 0.4, atendidas: 20, leadsDistintos: 10, tentativasPorLead: 4, hoje: 30, ontem: 25, d7: 150, d30: 300 }, 'linha do Caio (40% do total, 4 tentativas por lead)');
  const tt = mlTabelaLinhas(porUsu, eqP, 'todos');
  eq(tt.map(x => x.nome), ['Caio', 'apex.outro'], 'tabela "todos": todo usuário do relatório, ordem por ligações para lead; sem perfil mostra o login');
  assert(tt[1].pctTotal === 0 && tt[1].tentativasPorLead === 0, 'usuário sem ligação para lead: 0% e 0 tentativas, sem NaN');

  // tela: carga, período padrão, abas, placar, qualidade
  window.__tabelas.leads_equipe = equipeBanco;
  window.__rpcRespostas.monitor_leads_leads = { data: leadsOut, error: null };
  window.__rpcRespostas.monitor_ligacoes_resumo = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: porUsu, error: null };
  mlEstado.de = undefined; mlEstado.ate = undefined; mlEstado.tabela = 'equipe'; mlEstado.filtro = '';
  window.__rpcCalls.length = 0;
  await mlCarregar();
  const cu = window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop();
  const hojeT = hojeSP();
  assert(cu && cu.args.p_ref === hojeT && cu.args.p_de === hojeT.slice(0, 8) + '01' && cu.args.p_ate === hojeT, 'padrão: 1º dia do mês até hoje, ref = hoje');
  assert(document.getElementById('mlPeriodoDe').value === hojeT.slice(0, 8) + '01', 'campos de data refletem o período');
  assert(document.querySelector('#mlPlacarTbody tr td').textContent.trim() === 'Caio' && document.getElementById('mlPlacarTbody').textContent.includes('37,5%'), 'placar na tela (37,5%)');
  assert(document.getElementById('mlQualidadeTbody').textContent.includes('90 s'), 'qualidade na tela (90 s médios)');
  eq([...document.querySelectorAll('#mlTabelaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Caio', 'Luria'], 'tabela: os consultores de leads');
  document.querySelector('#mlTabelaPills [data-ml-tabela="todos"]').click();
  eq([...document.querySelectorAll('#mlTabelaTbody tr')].map(tr => tr.children[0].textContent.trim()), ['Caio', 'apex.outro'], 'tabela: todos os consultores');
  assert(document.querySelector('#mlTabelaPills [data-ml-tabela="todos"]').classList.contains('active'), 'pílula ativa');

  // mudar o período refaz a consulta
  const campoDe = document.getElementById('mlPeriodoDe'); campoDe.value = '2026-10-02';
  campoDe.dispatchEvent(new window.Event('change'));
  await espera(60);
  assert(window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop().args.p_de === '2026-10-02', 'mudar "De" consulta de novo com a data nova');
  // limpar os dois campos = sem limite (null)
  campoDe.value = ''; document.getElementById('mlPeriodoAte').value = '';
  campoDe.dispatchEvent(new window.Event('change'));
  await espera(60);
  const semLimite = window.__rpcCalls.filter(c => c.nome === 'monitor_ligacoes_por_usuario').pop().args;
  assert(semLimite.p_de === null && semLimite.p_ate === null, 'campos vazios = sem limite de datas');

  // sem relatório: tudo zerado, sem NaN
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: [], error: null };
  await mlCarregar();
  assert(!/NaN|undefined/.test(document.getElementById('digitalSubMonitor').textContent), 'sem ligações guardadas: sem NaN/undefined');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHA: ReferenceError: mlPlacarLinhas is not defined`

- [ ] **Step 3: Implementar**

(a) No literal `mlEstado` (Task 3), trocar `tabela: 'equipe', de: null, ate: null,` por `tabela: 'equipe', de: undefined, ate: undefined,` (undefined = "ainda não escolhido": `mlCarregarPorUsuario` aplica o padrão do mês; `null` = escolhido sem limite).

(b) Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: ligações por consultor (placar do dia, qualidade, tabela) ---- */
const mlNum = v => Number(v) || 0;
const mlMesmoUsuario = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
function mlLinhaDoUsuario(porUsuario, usuario){ return (porUsuario || []).find(r => mlMesmoUsuario(r.usuario, usuario)) || {}; }

function mlPlacarLinhas(porUsuario, equipe, metas){
  const meta = mlNum(metas && metas.meta_ligacoes_dia);
  return (equipe || []).filter(e => e.monitorar).map(e => {
    const r = mlLinhaDoUsuario(porUsuario, e.usuario_telefonia);
    const lig = mlNum(r.h_hoje);
    return { nome: e.nome_planilha, usuario: e.usuario_telefonia, ligHoje: lig, atendidasHoje: mlNum(r.hoje_atend), leadsHoje: mlNum(r.hoje_leads),
      minHoje: Math.round(mlNum(r.hoje_seg) / 60), pctMeta: meta ? lig / meta : null, ultima: r.hoje_ultima || null };
  });
}
function mlQualidadeLinhas(porUsuario, equipe){
  return (equipe || []).filter(e => e.monitorar).map(e => {
    const r = mlLinhaDoUsuario(porUsuario, e.usuario_telefonia);
    const lig = mlNum(r.lig_leads), at = mlNum(r.atend_leads);
    return { nome: e.nome_planilha, ligLeads: lig, taxaAtend: lig ? at / lig : 0, mediaSeg: at ? Math.round(mlNum(r.seg_leads) / at) : 0,
      boas: mlNum(r.boas_leads), atendSemContato: mlNum(r.atend_sem_contato) };
  });
}
function mlTabelaLinhas(porUsuario, equipe, modo){
  const linha = (usuario, nome) => {
    const r = mlLinhaDoUsuario(porUsuario, usuario), lig = mlNum(r.lig_leads), tot = mlNum(r.total), dist = mlNum(r.leads_distintos);
    return { usuario, nome, total: tot, ligLeads: lig, pctTotal: tot ? lig / tot : 0, atendidas: mlNum(r.atend_leads), leadsDistintos: dist,
      tentativasPorLead: dist ? lig / dist : 0, hoje: mlNum(r.h_hoje), ontem: mlNum(r.h_ontem), d7: mlNum(r.h_7), d30: mlNum(r.h_30) };
  };
  if(modo === 'equipe') return (equipe || []).filter(e => e.monitorar).map(e => linha(e.usuario_telefonia, e.nome_planilha));
  return (porUsuario || []).map(r => {
    const e = (equipe || []).find(x => mlMesmoUsuario(x.usuario_telefonia, r.usuario));
    return linha(r.usuario, e ? e.nome_planilha : r.usuario);
  }).sort((a, b) => b.ligLeads - a.ligLeads);
}

async function mlCarregarPorUsuario(){
  if(mlEstado.de === undefined && mlEstado.ate === undefined){ const h = hojeSP(); mlEstado.de = h.slice(0, 8) + '01'; mlEstado.ate = h; }
  const r = await ppSeguro(() => sb.rpc('monitor_ligacoes_por_usuario', { p_ref: hojeSP(), p_de: mlEstado.de || null, p_ate: mlEstado.ate || null }));
  if(r && r.error){ console.error(r.error); mlEstado.erro = true; }
  mlEstado.porUsuario = (r && Array.isArray(r.data)) ? r.data : [];
}

const mlFmtMin = seg => seg ? (seg < 60 ? seg + ' s' : Math.floor(seg / 60) + ' min ' + String(seg % 60).padStart(2, '0') + ' s') : '—';
function mlRenderPlacar(){
  const l = mlPlacarLinhas(mlEstado.porUsuario, mlEstado.equipe, mlEstado.metas);
  document.getElementById('mlPlacarTbody').innerHTML = l.length ? l.map(x => `<tr><td>${escapeHtml(x.nome)}</td><td>${x.ligHoje}</td>
      <td>${x.pctMeta === null ? '—' : miniBarHtml(x.pctMeta)}</td><td>${x.atendidasHoje}</td><td>${x.leadsHoje}</td><td>${x.minHoje}</td>
      <td>${x.ultima ? escapeHtml(mlFmtDiaHora(x.ultima)) : 'nenhuma hoje'}</td></tr>`).join('') : mlLinhaVazia(7, 'Nenhum consultor de leads cadastrado.');
}
function mlRenderQualidade(){
  const l = mlQualidadeLinhas(mlEstado.porUsuario, mlEstado.equipe);
  document.getElementById('mlQualidadeTbody').innerHTML = l.length ? l.map(x => `<tr><td>${escapeHtml(x.nome)}</td><td>${x.ligLeads}</td>
      <td>${fmtPctConversao(x.taxaAtend)}</td><td>${mlFmtMin(x.mediaSeg)}</td><td>${x.boas}</td><td>${x.atendSemContato}</td></tr>`).join('') : mlLinhaVazia(6, 'Nenhum consultor de leads cadastrado.');
}
function mlRenderTabela(){
  document.querySelectorAll('#mlTabelaPills [data-ml-tabela]').forEach(b => b.classList.toggle('active', b.dataset.mlTabela === mlEstado.tabela));
  document.getElementById('mlPeriodoDe').value = mlEstado.de || '';
  document.getElementById('mlPeriodoAte').value = mlEstado.ate || '';
  const l = mlTabelaLinhas(mlEstado.porUsuario, mlEstado.equipe, mlEstado.tabela);
  document.getElementById('mlTabelaTbody').innerHTML = l.length ? l.map(x => `<tr><td>${escapeHtml(x.nome)}</td><td>${x.total}</td><td>${x.ligLeads}</td>
      <td>${fmtPctConversao(x.pctTotal)}</td><td>${x.atendidas}</td><td>${x.leadsDistintos}</td><td>${x.tentativasPorLead.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
      <td>${x.hoje}</td><td>${x.ontem}</td><td>${x.d7}</td><td>${x.d30}</td></tr>`).join('') : mlLinhaVazia(11, 'Nenhuma ligação guardada neste período.');
}

document.getElementById('digitalSubMonitor').addEventListener('click', function(ev){
  const t = ev.target.closest('[data-ml-tabela]');
  if(!t) return;
  mlEstado.tabela = t.dataset.mlTabela;
  mlRenderTabela();
});
['mlPeriodoDe', 'mlPeriodoAte'].forEach(function(id){
  document.getElementById(id).addEventListener('change', async function(){
    mlEstado.de = document.getElementById('mlPeriodoDe').value || null;
    mlEstado.ate = document.getElementById('mlPeriodoAte').value || null;
    await mlCarregarPorUsuario();
    mlRenderTudo();
  });
});

```

(c) Em `mlCarregar`, trocar `  // ==== mais cargas entram aqui ====` por:
```js
  await mlCarregarPorUsuario();
  // ==== mais cargas entram aqui ====
```
(d) Em `mlRenderTudo`, trocar `  // ==== mais renders entram aqui ====` por:
```js
  mlRenderPlacar();
  mlRenderQualidade();
  mlRenderTabela();
  // ==== mais renders entram aqui ====
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): placar do dia, qualidade e tabela de ligações por consultor (Todos / Os 4)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Editor da equipe de leads e das metas (só admin)

**Files:**
- Modify: `_template.html`
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes: tabelas `leads_equipe` (escrita só admin, RLS), `profiles` (`id,nome,username,role`), `config` (chave `monitor_leads_metas`, escrita só admin), `mlEstado`, `mlCarregar()`, `mlMetas`, `ML_METAS_PADRAO`.
- Produces: `mlRenderEquipeEditor()` (chamado ao fim de `mlCarregar`), `mlSalvarEquipe()`, `mlSalvarMetas()`; `mlEstado.perfis` = `[{id,nome,username,role}]`.

- [ ] **Step 1: Escrever os testes que falham**

Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 7: editor da equipe e das metas ====
  window.__tabelas.profiles = [{ id: 'p1', nome: 'Caio Costa', username: 'caio', role: 'consultor' }, { id: 'p2', nome: 'Luria Teste', username: 'luria', role: 'consultor' }];
  window.__tabelas.leads_equipe = JSON.parse(JSON.stringify(equipeBanco));
  window.__tabelas.config = [];
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: [], error: null };
  mlEstado.filtro = '';
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'supervisor' };
  await mlCarregar();
  assert(document.getElementById('mlEquipeCard').style.display === 'none', 'supervisor não vê o editor da equipe');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  await mlCarregar();
  assert(document.getElementById('mlEquipeCard').style.display !== 'none', 'admin vê o editor');
  const trs = () => [...document.querySelectorAll('#mlEquipeTbody tr[data-ml-eq-id]')];
  eq(trs().length, 3, 'uma linha por pessoa da equipe');
  eq([...trs()[0].querySelectorAll('.mlEqPerfil option')].map(o => o.value), ['', 'p1', 'p2'], 'opções: sem perfil + perfis do painel');
  eq(trs()[0].querySelector('.mlEqNome').value, 'Caio', 'nome na planilha preenchido');
  assert(trs()[0].querySelector('.mlEqMonitorar').checked === true && trs()[2].querySelector('.mlEqMonitorar').checked === false, 'monitorar reflete o banco');

  // ligar perfis e salvar
  trs()[0].querySelector('.mlEqPerfil').value = 'p1';
  trs()[1].querySelector('.mlEqPerfil').value = 'p2';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  const upEq = window.__escritas.find(e => e.tabela === 'leads_equipe' && e.op === 'upsert');
  assert(upEq && upEq.opts.onConflict === 'id' && upEq.rows.length === 3, 'salva as 3 linhas existentes por id');
  assert(upEq.rows.find(r => r.id === 1).profile_id === 'p1' && upEq.rows.find(r => r.id === 2).profile_id === 'p2' && upEq.rows.find(r => r.id === 3).profile_id === null, 'perfis gravados (vazio = null)');
  assert(upEq.rows.find(r => r.id === 1).monitorar === true && upEq.rows.find(r => r.id === 3).monitorar === false, 'monitorar gravado');

  // o mesmo perfil em duas pessoas: recusa sem gravar
  await mlCarregar();
  trs()[0].querySelector('.mlEqPerfil').value = 'p1';
  trs()[1].querySelector('.mlEqPerfil').value = 'p1';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'perfil repetido não grava nada');

  // adicionar pessoa nova (sem id) -> insert; nome vazio é ignorado
  await mlCarregar();
  document.getElementById('btnMlEquipeAdd').click();
  eq(trs().length, 4, 'adicionar cria uma linha em branco');
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  assert(!window.__escritas.some(e => e.op === 'insert'), 'linha nova sem nome não é gravada');
  const nova = trs()[3];
  nova.querySelector('.mlEqNome').value = '  Novo Consultor ';
  nova.querySelector('.mlEqUsuario').value = 'apex.novo';
  window.__escritas.length = 0;
  document.getElementById('btnMlEquipeSalvar').click();
  await espera(60);
  const ins = window.__escritas.find(e => e.tabela === 'leads_equipe' && e.op === 'insert');
  assert(ins && ins.rows.length === 1 && ins.rows[0].nome_planilha === 'Novo Consultor' && ins.rows[0].usuario_telefonia === 'apex.novo' && ins.rows[0].id === undefined, 'insert da pessoa nova, nome sem espaços sobrando');

  // remover pessoa já gravada
  await mlCarregar();
  window.__escritas.length = 0;
  trs()[2].querySelector('[data-ml-eq-del]').click();
  await espera(60);
  assert(window.__escritas.some(e => e.tabela === 'leads_equipe' && e.op === 'delete' && e.filtro.id === 3), 'remover apaga a pessoa certa (id 3)');

  // metas
  const meta = k => document.querySelector('#mlMetasCampos [data-ml-meta="' + k + '"]');
  eq([meta('min_tentativas').value, meta('max_tentativas').value, meta('meta_ligacoes_dia').value, meta('conversa_boa_seg').value, meta('sla_primeira_ligacao_h').value], ['3', '10', '80', '60', '24'], 'metas padrão nos campos');
  meta('min_tentativas').value = '12';
  window.__escritas.length = 0;
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'mínimo maior que o teto: recusa sem gravar');
  meta('min_tentativas').value = '4'; meta('max_tentativas').value = '12';
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  const upM = window.__escritas.find(e => e.tabela === 'config' && e.op === 'upsert');
  assert(upM && upM.opts.onConflict === 'chave' && upM.rows.chave === 'monitor_leads_metas', 'grava em config.monitor_leads_metas');
  const gravadas = JSON.parse(upM.rows.valor);
  assert(gravadas.min_tentativas === 4 && gravadas.max_tentativas === 12 && gravadas.meta_ligacoes_dia === 80, 'metas gravadas como JSON completo');
  meta('meta_ligacoes_dia').value = 'abc';
  window.__escritas.length = 0;
  document.getElementById('btnMlMetasSalvar').click();
  await espera(60);
  assert(window.__escritas.length === 0, 'valor que não é número não grava');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHOU: admin vê o editor`

- [ ] **Step 3: Implementar**

(a) Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: editor da equipe de leads e das metas (só admin) ---- */
const ML_META_ROTULOS = { min_tentativas: 'Mínimo de tentativas por lead', max_tentativas: 'Teto de tentativas', meta_ligacoes_dia: 'Meta de ligações por dia',
  conversa_boa_seg: 'Conversa boa (segundos falados)', sla_primeira_ligacao_h: 'SLA da 1ª ligação (horas)' };

function mlLinhaEquipeHtml(e){
  const perfis = mlEstado.perfis || [];
  const opcoes = '<option value="">(sem perfil)</option>' + perfis.map(p => `<option value="${escapeHtml(p.id)}"${p.id === e.profile_id ? ' selected' : ''}>${escapeHtml(p.nome)} (${escapeHtml(p.username)})</option>`).join('');
  return `<tr data-ml-eq-id="${e.id == null ? '' : escapeHtml(String(e.id))}">
    <td><input type="text" class="mlEqNome" value="${escapeHtml(e.nome_planilha || '')}"></td>
    <td><input type="text" class="mlEqUsuario" value="${escapeHtml(e.usuario_telefonia || '')}"></td>
    <td><select class="mlEqPerfil">${opcoes}</select></td>
    <td><input type="checkbox" class="mlEqMonitorar"${e.monitorar ? ' checked' : ''}></td>
    <td><button type="button" class="btn btn-sm btn-outline" data-ml-eq-del="${e.id == null ? '' : escapeHtml(String(e.id))}" style="width:auto">Remover</button></td></tr>`;
}
function mlRenderEquipeEditor(){
  const card = document.getElementById('mlEquipeCard');
  const adm = !!currentUser && currentUser.role === 'admin';
  card.style.display = adm ? '' : 'none';
  if(!adm) return;
  document.getElementById('mlEquipeTbody').innerHTML = mlEstado.equipe.map(mlLinhaEquipeHtml).join('');
  document.getElementById('mlMetasCampos').innerHTML = Object.keys(ML_META_ROTULOS).map(k =>
    `<div class="field" style="margin:0;width:200px"><label>${ML_META_ROTULOS[k]}</label><input type="number" min="0" data-ml-meta="${k}" value="${mlEstado.metas[k]}"></div>`).join('');
}

async function mlSalvarEquipe(){
  const linhas = [...document.querySelectorAll('#mlEquipeTbody tr[data-ml-eq-id]')].map(tr => ({
    id: tr.dataset.mlEqId ? Number(tr.dataset.mlEqId) : null,
    nome_planilha: tr.querySelector('.mlEqNome').value.trim(),
    usuario_telefonia: tr.querySelector('.mlEqUsuario').value.trim() || null,
    profile_id: tr.querySelector('.mlEqPerfil').value || null,
    monitorar: tr.querySelector('.mlEqMonitorar').checked,
  })).filter(l => l.nome_planilha);
  const perfis = linhas.map(l => l.profile_id).filter(Boolean);
  if(new Set(perfis).size !== perfis.length){ mostrarAviso('O mesmo perfil do painel não pode estar em duas pessoas.', 'erro'); return; }
  const agora = new Date().toISOString();
  const existentes = linhas.filter(l => l.id !== null).map(l => Object.assign({}, l, { atualizado_em: agora }));
  const novas = linhas.filter(l => l.id === null).map(l => ({ nome_planilha: l.nome_planilha, usuario_telefonia: l.usuario_telefonia, profile_id: l.profile_id, monitorar: l.monitorar }));
  if(existentes.length){
    const { error } = await sb.from('leads_equipe').upsert(existentes, { onConflict: 'id' });
    if(error){ mostrarAviso('Não foi possível salvar a equipe: ' + error.message, 'erro'); return; }
  }
  if(novas.length){
    const { error } = await sb.from('leads_equipe').insert(novas);
    if(error){ mostrarAviso('Não foi possível adicionar a pessoa nova: ' + error.message, 'erro'); return; }
  }
  mostrarAviso('Equipe de leads salva.', 'ok');
  await mlCarregar();
}
async function mlSalvarMetas(){
  const m = {};
  for(const k of Object.keys(ML_META_ROTULOS)){
    const v = document.querySelector('#mlMetasCampos [data-ml-meta="' + k + '"]').value;
    const n = Number(v);
    if(v === '' || !Number.isFinite(n) || n < 0){ mostrarAviso('Confira as metas: "' + ML_META_ROTULOS[k] + '" precisa ser um número.', 'erro'); return; }
    m[k] = n;
  }
  if(m.min_tentativas > m.max_tentativas){ mostrarAviso('O mínimo de tentativas não pode ser maior que o teto.', 'erro'); return; }
  const { error } = await sb.from('config').upsert({ chave: 'monitor_leads_metas', valor: JSON.stringify(m), atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if(error){ mostrarAviso('Não foi possível salvar as metas: ' + error.message, 'erro'); return; }
  mostrarAviso('Metas salvas.', 'ok');
  await mlCarregar();
}

document.getElementById('btnMlEquipeAdd').addEventListener('click', function(){
  document.getElementById('mlEquipeTbody').insertAdjacentHTML('beforeend', mlLinhaEquipeHtml({ id: null, nome_planilha: '', usuario_telefonia: '', profile_id: null, monitorar: true }));
});
document.getElementById('btnMlEquipeSalvar').addEventListener('click', mlSalvarEquipe);
document.getElementById('btnMlMetasSalvar').addEventListener('click', mlSalvarMetas);
document.getElementById('mlEquipeTbody').addEventListener('click', async function(ev){
  const b = ev.target.closest('[data-ml-eq-del]');
  if(!b) return;
  if(!b.dataset.mlEqDel){ b.closest('tr').remove(); return; }   // linha ainda não gravada: só tira da tela
  if(!confirm('Remover esta pessoa da equipe de leads? Os leads dela na planilha não mudam.')) return;
  const { error } = await sb.from('leads_equipe').delete().eq('id', Number(b.dataset.mlEqDel));
  if(error){ mostrarAviso('Não foi possível remover: ' + error.message, 'erro'); return; }
  await mlCarregar();
});

```

(b) Em `mlCarregar`, trocar
```js
  // ==== mais cargas entram aqui ====
  if(geracao !== mlEstado.geracao) return;
  mlRenderTudo();
}
```
por
```js
  if(currentUser.role === 'admin'){
    const pf = await ppSeguro(() => sb.from('profiles').select('id,nome,username,role').order('nome'));
    mlEstado.perfis = (pf && pf.data) || [];
  }
  // ==== mais cargas entram aqui ====
  if(geracao !== mlEstado.geracao) return;
  mlRenderTudo();
  mlRenderEquipeEditor();   // fora do mlRenderTudo de propósito: filtrar por card não pode apagar o que o admin está digitando
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): editor da equipe de leads (nome, telefonia, perfil) e das metas" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Exportar para Excel (fila/cadência e tabela por consultor)

**Files:**
- Modify: `_template.html`
- Modify: `test_monitoramento_leads.js`

**Interfaces:**
- Consumes: `mlEstado.classificado` (Task 5), `mlTabelaLinhas`, `mlEstado.tabela/de/ate/aba`, `XLSX` (SheetJS global do painel), `hojeSP()`.
- Produces: `mlBaixarXlsx(nomeArquivo, abas:[{nome, linhas:[objetos]}])`, `mlLinhasExportFila(cl)`, `mlLinhasExportCadencia(lista)`, `mlLinhasExportInconsistencias(cl)`, `mlLinhasExportTabela(linhas)`.

Observação: o SheetJS gratuito do painel não grava cor de célula; este Excel é simples (sem cores). Se um dia quiserem colorido, usar a ExcelJS como na seção 48.4 do REGRAS_NEGOCIO.md.

- [ ] **Step 1: Escrever os testes que falham**

Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 8: exportar Excel ====
  window.__rpcRespostas.monitor_leads_leads = { data: leadsFila, error: null };
  window.__rpcRespostas.monitor_ligacoes_por_usuario = { data: porUsu, error: null };
  window.__tabelas.leads_equipe = JSON.parse(JSON.stringify(equipeBanco));
  mlEstado.de = undefined; mlEstado.ate = undefined; mlEstado.tabela = 'equipe';
  conversaoAbaAtual = 'OUTUBRO';
  await mlCarregar();
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportFila').click();
  assert(window.__xlsx.length === 1 && /^LeadsSemLigacao_OUTUBRO_\d{4}-\d{2}-\d{2}\.xlsx$/.test(window.__xlsx[0].nome), 'exporta a fila com nome da aba e data');
  const wbF = window.__xlsx[0].wb;
  eq(wbF.SheetNames, ['Sem ligação', 'Abaixo do mínimo', 'Acima do teto', 'Inconsistências'], 'abas do arquivo da fila');
  const linhasF = XLSX.utils.sheet_to_json(wbF.Sheets['Sem ligação']);
  eq(linhasF.map(l => l.Lead), ['Fila Antigo', 'Fila Novo'], 'linhas da fila, mais antigo primeiro');
  assert(linhasF[0].Telefone === '+5519900000011' && linhasF[0]['Acima do SLA'] === 'Sim' && linhasF[1]['Acima do SLA'] === 'Não', 'telefone sem "p:" e SLA como Sim/Não');
  const incF = XLSX.utils.sheet_to_json(wbF.Sheets['Inconsistências']);
  assert(incF.some(l => l.Tipo === 'Planilha desatualizada' && l.Lead === 'Desatualizado Um'), 'inconsistências exportadas com o tipo');
  // lista vazia vira uma linha de aviso (planilha sem linhas confunde o Excel)
  window.__rpcRespostas.monitor_leads_leads = { data: [], error: null };
  await mlCarregar();
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportFila').click();
  eq(XLSX.utils.sheet_to_json(window.__xlsx[0].wb.Sheets['Sem ligação']), [{ Aviso: 'Nada para exportar' }], 'sem linhas: aviso em vez de aba vazia');

  // tabela por consultor
  window.__xlsx.length = 0;
  document.getElementById('btnMlExportTabela').click();
  assert(window.__xlsx.length === 1 && /^LigacoesPorConsultor_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/.test(window.__xlsx[0].nome), 'exporta a tabela com o período no nome');
  const linhasT = XLSX.utils.sheet_to_json(window.__xlsx[0].wb.Sheets['Ligações por consultor']);
  eq(linhasT.map(l => l.Consultor), ['Caio', 'Luria'], 'tabela exportada = a que está na tela (os consultores de leads)');
  assert(linhasT[0]['Ligações para leads'] === 40 && linhasT[0]['Tentativas por lead'] === 4 && linhasT[0]['% do total'] === '40,0%', 'colunas e valores do Caio');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHOU: exporta a fila com nome da aba e data`

- [ ] **Step 3: Implementar**

Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Monitoramento Leads: exportar para Excel (SheetJS, sem cores) ---- */
function mlBaixarXlsx(nomeArquivo, abas){
  const wb = XLSX.utils.book_new();
  abas.forEach(a => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.linhas.length ? a.linhas : [{ Aviso: 'Nada para exportar' }]), a.nome));
  XLSX.writeFile(wb, nomeArquivo);
}
const mlTelLimpo = t => String(t || '').replace(/^p:/, '');
function mlLinhasExportFila(cl){
  return cl.semLigacao.map(x => ({ Lead: x.nome || '', Telefone: mlTelLimpo(x.telefone), Consultor: x.consultor || '', 'Status na planilha': (x.status || '').trim(),
    'Entrou há (horas)': x.horasDesdeEntrada == null ? '' : Math.round(x.horasDesdeEntrada), 'Acima do SLA': x.atrasadoSla ? 'Sim' : 'Não' }));
}
function mlLinhasExportCadencia(lista){
  return lista.map(x => ({ Lead: x.nome || '', Telefone: mlTelLimpo(x.telefone), Consultor: x.consultor || '', Status: (x.status || '').trim(), Tentativas: x.tentativas,
    'Última ligação': x.ultima_ligacao ? mlFmtDiaHora(x.ultima_ligacao) : '' }));
}
function mlLinhasExportInconsistencias(cl){
  const i = cl.inconsistencias, out = [];
  [['Planilha desatualizada', i.planilhaDesatualizada], ['Perdido cedo demais', i.perdidoCedo], ['Venda sem ligação', i.vendaSemLigacao]].forEach(g =>
    g[1].forEach(x => out.push({ Tipo: g[0], Lead: x.nome || '', Consultor: x.consultor || '', Telefone: mlTelLimpo(x.telefone), Status: (x.status || '').trim(), Tentativas: x.tentativas })));
  return out;
}
function mlLinhasExportTabela(linhas){
  return linhas.map(x => ({ Consultor: x.nome, 'Ligações manuais': x.total, 'Ligações para leads': x.ligLeads, '% do total': fmtPctConversao(x.pctTotal), Atendidas: x.atendidas,
    'Leads diferentes': x.leadsDistintos, 'Tentativas por lead': Math.round(x.tentativasPorLead * 10) / 10, Hoje: x.hoje, Ontem: x.ontem, '7 dias': x.d7, '30 dias': x.d30 }));
}

document.getElementById('btnMlExportFila').addEventListener('click', function(){
  const cl = mlEstado.classificado || mlClassificarLeads([], mlEstado.metas, Date.now());
  mlBaixarXlsx(`LeadsSemLigacao_${mlEstado.aba || 'SEM-ABA'}_${hojeSP()}.xlsx`, [
    { nome: 'Sem ligação', linhas: mlLinhasExportFila(cl) },
    { nome: 'Abaixo do mínimo', linhas: mlLinhasExportCadencia(cl.abaixoMin) },
    { nome: 'Acima do teto', linhas: mlLinhasExportCadencia(cl.acimaTeto) },
    { nome: 'Inconsistências', linhas: mlLinhasExportInconsistencias(cl) },
  ]);
});
document.getElementById('btnMlExportTabela').addEventListener('click', function(){
  const linhas = mlTabelaLinhas(mlEstado.porUsuario, mlEstado.equipe, mlEstado.tabela);
  mlBaixarXlsx(`LigacoesPorConsultor_${mlEstado.de || 'inicio'}_${mlEstado.ate || 'hoje'}.xlsx`, [{ nome: 'Ligações por consultor', linhas: mlLinhasExportTabela(linhas) }]);
});

```

Observação para o teste de nome de arquivo: com período padrão (1º dia do mês até hoje) o nome sai `LigacoesPorConsultor_AAAA-MM-01_AAAA-MM-DD.xlsx`, que casa com a expressão do teste.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_monitoramento_leads.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): exportar fila/cadência e tabela por consultor para Excel" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: "Meus leads para tratar" na aba Pedidos Parados (consultor)

**Files:**
- Modify: `_template.html` (HTML no topo de `#panel-pedidosparados`; JS; duas linhas em funções existentes)
- Modify: `test_monitoramento_leads.js` (harness: registrar tabelas lidas e suportar `update`; asserts novos)

**Interfaces:**
- Consumes: RPC `meus_leads_para_tratar()` (colunas `aba, lead_id, nome, telefone, status, categoria, criado_em_lead, tentativas, atendidas, ultima_ligacao`), tabela `leads_equipe` (a própria linha do consultor, por RLS), tabela `leads_followups` (`id, lead_id, consultor_id, data_prevista, tipo, feito`; RLS: o consultor só vê/edita os próprios), `canSeePedidosParados()`, `ppSeguro`, `fetchAllRows`, `FOLLOWUP_TIPO_LABEL`, `LEAD_ESFRIANDO_DIAS` (5), `conversaoAbaRotulo`, `mlFmtDiaHora`, `hojeSP()`, o clique `data-copiar` já tratado no painel Pedidos Parados.
- Produces: `plClassificar(leads, followups, hoje, agoraMs) → [{ lead, tentativas, pendente|null, diasParado|null, situacao:'semLigacao'|'atrasado'|'esfriando'|'hoje'|'ok' }]` (já ordenado por urgência, depois o mais antigo primeiro), `plCarregar()`, `plRender()`, `plResetar()`; `plEstado = { geracao, vinculado, erro, leads, followups }`.

Decisão (desvio da spec, mais seguro para quem não recebe lead): consultor **sem** linha em `leads_equipe` não vê a seção (nem aviso, nem erro) — quase todos os consultores não recebem lead e um aviso seria ruído. Se a consulta do vínculo falhar (migration ainda não aplicada), a seção também some em silêncio.

- [ ] **Step 1: Ajustar o harness e escrever os testes que falham**

(a) No topo do `test_monitoramento_leads.js`, depois de `window.__xlsx = [];`, acrescentar `window.__lidas = [];   // tabelas lidas pelo painel (prova de que o consultor nunca lê ligacoes_manuais)`. No `builder`, dentro do objeto `b`, acrescentar depois de `insert:`:

```js
    update: (patch) => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
```
e trocar `from: (t) => builder(t),` por `from: (t) => { window.__lidas.push(t); return builder(t); },`.

(b) Antes da linha `console.log('--- RESULTADO`:

```js
  // ==== TASK 9: Meus leads para tratar (consultor) ====
  const diaIso = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const hojeP = hojeSP(), ontemP = somaDiasStr(hojeP, -1);
  const lp = (id, tent, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Lead ' + id, telefone: 'p:+5519900000099', status: 'EM NEGOCIAÇÃO', categoria: 'andamento',
    criado_em_lead: diaIso(2), tentativas: tent, atendidas: 0, ultima_ligacao: null }, extra || {});

  // função pura: ordem de urgência e fronteira de "esfriando"
  const cls = plClassificar([
    lp('ok1', 2, { ultima_ligacao: diaIso(1) }),
    lp('hoje1', 2, { ultima_ligacao: diaIso(1) }),
    lp('esf1', 4, { ultima_ligacao: diaIso(10) }),
    lp('atr1', 3, { ultima_ligacao: diaIso(1) }),
    lp('sem1', 0, { criado_em_lead: diaIso(5) }),
    lp('lim1', 2, { ultima_ligacao: diaIso(5) }),   // exatamente 5 dias = esfriando (fronteira)
    lp('lim2', 2, { ultima_ligacao: diaIso(4) }),   // 4 dias = ainda não
  ], [{ id: 'f1', lead_id: 'atr1', data_prevista: ontemP, feito: false }, { id: 'f2', lead_id: 'hoje1', data_prevista: hojeP, feito: false }, { id: 'f3', lead_id: 'ok1', data_prevista: ontemP, feito: true }], hojeP, Date.now());
  eq(cls.map(x => x.lead.lead_id + ':' + x.situacao), ['sem1:semLigacao', 'atr1:atrasado', 'esf1:esfriando', 'lim1:esfriando', 'hoje1:hoje', 'ok1:ok', 'lim2:ok'], 'ordem de urgência: sem ligação, retorno atrasado, esfriando, retorno hoje, resto; retorno já feito não conta');
  assert(plClassificar(null, null, hojeP, Date.now()).length === 0, 'null não quebra');

  // tela
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__lidas.length = 0; window.__rpcCalls.length = 0; window.__escritas.length = 0;
  window.__tabelas.leads_equipe = [{ id: 1, nome_planilha: 'Caio', profile_id: 'c1', monitorar: true }];
  window.__tabelas.leads_followups = [{ id: 'f1', lead_id: 'atr1', consultor_id: 'c1', data_prevista: ontemP, tipo: 'retorno', feito: false }];
  window.__rpcRespostas.meus_leads_para_tratar = { data: [lp('ok1', 2, { ultima_ligacao: diaIso(1) }), lp('atr1', 3, { ultima_ligacao: diaIso(1) }), lp('sem1', 0, { criado_em_lead: diaIso(5) })], error: null };
  await plCarregar();
  assert(document.getElementById('plWrap').style.display !== 'none' && document.getElementById('plCard').style.display !== 'none', 'consultor vinculado vê a seção');
  eq([...document.querySelectorAll('#plLista .retornoLeadRow')].map(r => r.dataset.leadId), ['sem1', 'atr1', 'ok1'], 'linhas na ordem de urgência');
  const chips = document.getElementById('plResumo').textContent;
  assert(chips.includes('1 sem ligação') && chips.includes('1 retorno atrasado') && chips.includes('0 esfriando'), 'chips de resumo');
  const linhaSem = document.querySelector('#plLista [data-lead-id="sem1"]').textContent;
  assert(linhaSem.includes('Nenhuma ligação') && linhaSem.includes('Outubro'), 'lead sem ligação diz isso e mostra a aba');
  assert(document.querySelector('#plLista [data-lead-id="atr1"]').textContent.includes('3 tentativas'), 'mostra o número de tentativas');
  assert(document.querySelector('#plLista [data-lead-id="sem1"] [data-copiar="+5519900000099"]'), 'telefone copiável (sem o prefixo p:)');
  assert(window.__rpcCalls.some(c => c.nome === 'meus_leads_para_tratar') && !window.__lidas.includes('ligacoes_manuais'), 'só usa a RPC do consultor; nunca lê ligacoes_manuais');
  assert(!window.__rpcCalls.some(c => /^monitor_/.test(c.nome)), 'consultor nunca chama as RPCs do monitoramento');

  // marcar retorno como feito
  document.querySelector('#plLista [data-followup-id="f1"]').click();
  await espera(60);
  const upd = window.__escritas.find(e => e.tabela === 'leads_followups' && e.op === 'update');
  assert(upd && upd.filtro.id === 'f1' && upd.patch.feito === true, 'marca o retorno certo como feito');

  // agendar retorno
  const formSel = '#plLista [data-lead-id="ok1"]';
  document.querySelector(formSel + ' .btnPlAgendar').click();
  const form = document.getElementById('plForm_ok1');
  assert(form.style.display !== 'none', 'o botão abre o formulário de retorno');
  form.querySelector('.retornoFormData').value = hojeP;
  form.querySelector('.retornoFormObs').value = 'ligar de manhã';
  window.__escritas.length = 0;
  document.querySelector(formSel + ' .btnPlSalvar').click();
  await espera(60);
  const ins9 = window.__escritas.find(e => e.tabela === 'leads_followups' && e.op === 'insert');
  assert(ins9 && ins9.rows.lead_id === 'ok1' && ins9.rows.consultor_id === 'c1' && ins9.rows.data_prevista === hojeP && ins9.rows.observacao === 'ligar de manhã', 'agenda o retorno do lead certo, no nome do consultor');
  document.querySelector(formSel + ' .btnPlAgendar').click();
  form.querySelector('.retornoFormData').value = '';
  window.__escritas.length = 0;
  document.querySelector(formSel + ' .btnPlSalvar').click();
  await espera(40);
  assert(window.__escritas.length === 0, 'sem data não grava');

  // vindo pela aba: loadPedidosParados chama a seção
  window.__rpcCalls.length = 0;
  await loadPedidosParados();
  await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'meus_leads_para_tratar'), 'abrir Pedidos Parados carrega os leads do consultor');

  // lista vazia
  window.__rpcRespostas.meus_leads_para_tratar = { data: [], error: null };
  await plCarregar();
  assert(document.getElementById('plLista').textContent.includes('Nenhum lead em aberto') && !/NaN|undefined/.test(document.getElementById('plWrap').textContent), 'sem leads em aberto: mensagem, sem NaN');

  // erro ao buscar os leads (com vínculo): aviso na seção
  window.__rpcRespostas.meus_leads_para_tratar = { data: null, error: { message: 'boom' } };
  await plCarregar();
  assert(document.getElementById('plErro').style.display !== 'none' && document.getElementById('plCard').style.display === 'none', 'erro dos leads mostra o aviso');
  window.__rpcRespostas.meus_leads_para_tratar = { data: [lp('ok1', 2)], error: null };

  // sem vínculo: a seção some, sem aviso e sem erro
  window.__tabelas.leads_equipe = [{ id: 2, nome_planilha: 'Outro', profile_id: 'outro', monitorar: true }];
  await plCarregar();
  assert(document.getElementById('plWrap').style.display === 'none', 'consultor sem vínculo não vê a seção');
  window.__tabelas.leads_equipe = [{ id: 1, nome_planilha: 'Caio', profile_id: 'c1', monitorar: true }];

  // admin não vê a seção
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  window.__rpcCalls.length = 0;
  await plCarregar();
  assert(!window.__rpcCalls.some(c => c.nome === 'meus_leads_para_tratar'), 'admin não carrega a seção do consultor');
  plResetar();
  assert(document.getElementById('plWrap').style.display === 'none' && document.getElementById('plLista').innerHTML === '', 'reset limpa a tela (troca de login)');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_monitoramento_leads.js`
Expected: `FALHA: ReferenceError: plClassificar is not defined`

- [ ] **Step 3: HTML**

Trocar
```html
    <section class="panel" id="panel-pedidosparados">
      <div class="card" id="ppSemVinculo" style="display:none">
```
por
```html
    <section class="panel" id="panel-pedidosparados">
      <!-- 01/10/2026: leads do consultor para tratar (só quem está em leads_equipe) — seção 59 do REGRAS_NEGOCIO.md -->
      <div id="plWrap" style="display:none">
        <div class="card" id="plErro" style="display:none">
          <h3>Meus leads para tratar</h3>
          <p class="desc">Não foi possível carregar os seus leads agora. Tente de novo em instantes.</p>
        </div>
        <div class="card" id="plCard" style="display:none">
          <h3>Meus leads para tratar</h3>
          <p class="desc">Seus leads que ainda estão em aberto, de todas as abas da planilha. O que precisa de ação primeiro aparece no topo.</p>
          <div id="plResumo" style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0 4px"></div>
          <div id="plLista"></div>
        </div>
      </div>
      <div class="card" id="ppSemVinculo" style="display:none">
```

- [ ] **Step 4: JS**

Inserir antes de `/* ==== FIM MONITORAMENTO LEADS ==== */`:

```js
/* ---- Pedidos Parados: "Meus leads para tratar" (consultor) — 01/10/2026, REGRAS_NEGOCIO.md seção 59 ---- */
const plEstado = { geracao: 0, vinculado: false, erro: false, leads: [], followups: [] };
const PL_ORDEM = { semLigacao: 0, atrasado: 1, esfriando: 2, hoje: 3, ok: 4 };

function plClassificar(leads, followups, hoje, agoraMs){
  const pend = {};   // próximo retorno pendente de cada lead
  (followups || []).forEach(f => { if(!f.feito && (!pend[f.lead_id] || f.data_prevista < pend[f.lead_id].data_prevista)) pend[f.lead_id] = f; });
  return (leads || []).map(l => {
    const t = Number(l.tentativas) || 0, p = pend[l.lead_id] || null;
    const ms = new Date(l.ultima_ligacao || l.criado_em_lead).getTime();
    const dias = isNaN(ms) ? null : Math.floor((agoraMs - ms) / 86400000);
    let situacao = 'ok';
    if(t === 0) situacao = 'semLigacao';
    else if(p && p.data_prevista < hoje) situacao = 'atrasado';
    else if(dias !== null && dias >= LEAD_ESFRIANDO_DIAS) situacao = 'esfriando';
    else if(p && p.data_prevista === hoje) situacao = 'hoje';
    return { lead: l, tentativas: t, pendente: p, diasParado: dias, situacao };
  }).sort((a, b) => (PL_ORDEM[a.situacao] - PL_ORDEM[b.situacao]) || String(a.lead.criado_em_lead).localeCompare(String(b.lead.criado_em_lead)));
}

function plRender(){
  const wrap = document.getElementById('plWrap'), card = document.getElementById('plCard'), erro = document.getElementById('plErro');
  wrap.style.display = plEstado.vinculado ? '' : 'none';
  erro.style.display = plEstado.vinculado && plEstado.erro ? '' : 'none';
  card.style.display = plEstado.vinculado && !plEstado.erro ? '' : 'none';
  if(!plEstado.vinculado || plEstado.erro) return;
  const hoje = hojeSP();
  const linhas = plClassificar(plEstado.leads, plEstado.followups, hoje, Date.now());
  const n = s => linhas.filter(x => x.situacao === s).length;
  document.getElementById('plResumo').innerHTML = [['atrasado', n('semLigacao') + ' sem ligação'], ['atrasado', n('atrasado') + ' retorno atrasado'],
    ['hoje', n('esfriando') + ' esfriando'], ['hoje', n('hoje') + ' para hoje']].map(c => `<span class="retornoResumoChip ${c[0]}">${c[1]}</span>`).join('');
  const classeBadge = { semLigacao: 'atrasado', atrasado: 'atrasado', esfriando: 'hoje', hoje: 'hoje', ok: 'futuro' };
  const rotulo = x => {
    if(x.situacao === 'semLigacao') return 'Nenhuma ligação ainda' + (x.diasParado !== null ? ' · entrou há ' + x.diasParado + ' d' : '');
    if(x.situacao === 'atrasado') return 'Retorno atrasado desde ' + ppFmtDia(x.pendente.data_prevista);
    if(x.situacao === 'esfriando') return 'Esfriando · sem ligação há ' + x.diasParado + ' d';
    if(x.situacao === 'hoje') return 'Retorno hoje';
    return x.pendente ? 'Retorno em ' + ppFmtDia(x.pendente.data_prevista) : 'Em dia';
  };
  document.getElementById('plLista').innerHTML = linhas.length ? linhas.map(x => {
    const l = x.lead, id = escapeHtml(l.lead_id), tel = String(l.telefone || '').replace(/^p:/, '');
    return `<div class="retornoLeadRow" data-lead-id="${id}">
      <div class="retornoLeadInfo"><strong>${escapeHtml(l.nome || '(sem nome)')}</strong>
        <span class="retornoLeadSub">${escapeHtml((l.status || '').trim() || 'sem status')} · ${escapeHtml(conversaoAbaRotulo(l.aba))} · ${x.tentativas} ${x.tentativas === 1 ? 'tentativa' : 'tentativas'}${l.ultima_ligacao ? ' · última ligação ' + escapeHtml(mlFmtDiaHora(l.ultima_ligacao)) : ''}</span></div>
      <div class="retornoLeadAcoes">
        <span class="retornoBadge ${classeBadge[x.situacao]}">${escapeHtml(rotulo(x))}</span>
        ${x.pendente ? `<button type="button" class="btn btn-sm btn-outline btnPlFeito" data-followup-id="${escapeHtml(x.pendente.id)}">Marcar feito</button>` : ''}
        ${tel ? `<button type="button" class="btn btn-sm btn-outline" data-copiar="${escapeHtml(tel)}" style="width:auto">${escapeHtml(tel)}</button>` : ''}
        <button type="button" class="btn btn-sm btn-ghost btnPlAgendar" data-lead-id="${id}">Agendar retorno</button>
      </div>
      <div class="retornoAgendarForm" id="plForm_${id}" style="display:none">
        <input type="date" class="retornoFormData" value="${hoje}">
        <select class="retornoFormTipo">${Object.keys(FOLLOWUP_TIPO_LABEL).map(t => `<option value="${t}">${FOLLOWUP_TIPO_LABEL[t]}</option>`).join('')}</select>
        <input type="text" class="retornoFormObs" placeholder="Observação (opcional)">
        <button type="button" class="btn btn-sm btnPlSalvar" data-lead-id="${id}">Salvar</button>
      </div></div>`;
  }).join('') : '<p class="desc">Nenhum lead em aberto. 🎉</p>';
}

async function plCarregar(){
  if(!canSeePedidosParados()) return;
  const geracao = ++plEstado.geracao;
  const [vinc, lds, fu] = await Promise.all([
    ppSeguro(() => sb.from('leads_equipe').select('nome_planilha').eq('profile_id', currentUser.id).maybeSingle()),
    ppSeguro(() => fetchAllRows(() => sb.rpc('meus_leads_para_tratar'))),
    ppSeguro(() => sb.from('leads_followups').select('id,lead_id,consultor_id,data_prevista,tipo,feito').eq('consultor_id', currentUser.id).eq('feito', false)),
  ]);
  if(geracao !== plEstado.geracao) return;   // trocou de usuário/recarregou no meio
  plEstado.vinculado = !!(vinc && !vinc.error && vinc.data && vinc.data.nome_planilha);
  plEstado.erro = !!((lds && lds.error) || (fu && fu.error));
  if(plEstado.erro) console.error((lds && lds.error) || (fu && fu.error));
  plEstado.leads = (lds && lds.data) || [];
  plEstado.followups = (fu && fu.data) || [];
  plRender();
}
function plResetar(){
  plEstado.geracao++;
  Object.assign(plEstado, { vinculado: false, erro: false, leads: [], followups: [] });
  ['plResumo', 'plLista'].forEach(id => { document.getElementById(id).innerHTML = ''; });
  ['plWrap', 'plCard', 'plErro'].forEach(id => { document.getElementById(id).style.display = 'none'; });
}

document.getElementById('plLista').addEventListener('click', async function(ev){
  const ag = ev.target.closest('.btnPlAgendar');
  if(ag){ const f = document.getElementById('plForm_' + ag.dataset.leadId); if(f) f.style.display = f.style.display === 'none' ? 'flex' : 'none'; return; }
  const sv = ev.target.closest('.btnPlSalvar');
  if(sv){
    const f = document.getElementById('plForm_' + sv.dataset.leadId);
    const data = f.querySelector('.retornoFormData').value;
    if(!data){ mostrarAviso('Escolha uma data para o retorno.', 'erro'); return; }
    sv.disabled = true;
    const { error } = await sb.from('leads_followups').insert({ lead_id: sv.dataset.leadId, consultor_id: currentUser.id, data_prevista: data,
      tipo: f.querySelector('.retornoFormTipo').value, observacao: f.querySelector('.retornoFormObs').value.trim() || null });
    sv.disabled = false;
    if(error){ mostrarAviso('Não foi possível salvar o retorno: ' + error.message, 'erro'); return; }
    mostrarAviso('Retorno agendado.', 'ok');
    await plCarregar();
    return;
  }
  const fe = ev.target.closest('.btnPlFeito');
  if(fe){
    fe.disabled = true;
    const { error } = await sb.from('leads_followups').update({ feito: true, feito_em: new Date().toISOString() }).eq('id', fe.dataset.followupId);
    fe.disabled = false;
    if(error){ mostrarAviso('Não foi possível marcar como feito: ' + error.message, 'erro'); return; }
    await plCarregar();
  }
});

```

- [ ] **Step 5: Ligar à aba Pedidos Parados**

(a) Trocar
```js
async function loadPedidosParados(){
  if(!canSeePedidosParados()) return;
```
por
```js
async function loadPedidosParados(){
  if(!canSeePedidosParados()) return;
  plCarregar().catch(err => console.error(err));   // leads do consultor (seção 59); roda em paralelo com os pedidos
```
(b) Em `ppResetar`, trocar
```js
  ['ppConteudo', 'ppSemVinculo', 'ppErro', 'ppCarregando', 'meuDiaCard'].forEach(id => { document.getElementById(id).style.display = 'none'; });
}
```
por
```js
  ['ppConteudo', 'ppSemVinculo', 'ppErro', 'ppCarregando', 'meuDiaCard'].forEach(id => { document.getElementById(id).style.display = 'none'; });
  plResetar();
}
```

- [ ] **Step 6: Rodar e ver passar (e a regressão de Pedidos Parados)**

Run: `node test_monitoramento_leads.js && node test_pedidos_parados.js`
Expected: `0 falharam` nos dois.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_monitoramento_leads.js
git commit -m "feat(monitoramento-leads): seção Meus leads para tratar na aba Pedidos Parados do consultor" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Documentação, regressão completa, banco e publicação (sob autorização)

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (seção nova)
- Modify: `painel_clientes_apex.html` (gerado por `python build_painel.py`)

**Interfaces:** Consumes tudo das tarefas 1–9.

- [ ] **Step 1: Atualizar o `oficial/main` e conferir conflitos**

```bash
git fetch oficial
git log --oneline HEAD..oficial/main | head
```
Se houver commits novos, trazer para a branch (`git merge oficial/main`; conflito na linha base64 do `_template.html` é conhecido: resolver juntando as duas versões, nunca descartando a do outro) e rodar de novo `node test_monitoramento_leads.js`.

- [ ] **Step 2: Escolher o número da seção e documentar**

```bash
grep -n "^## " REGRAS_NEGOCIO.md | tail -3
```
Usar o próximo número livre (esperado: 59; ajustar o texto abaixo se for outro) e acrescentar no fim do `REGRAS_NEGOCIO.md`:

```markdown
## 59. Monitoramento Leads — ligações manuais x leads (01/10/2026)

Pedido do usuário: a partir de outubro/2026 os leads ficam com 4 pessoas (Caio, Gabriel Macedo, Luria, Mariana) e é preciso acompanhar de perto se elas ligam, tratam e vendem. A telefonia não tem API; o relatório de chamadas manuais chega em Excel. Spec: `docs/superpowers/specs/2026-10-01-monitoramento-leads-design.md`; plano: `docs/superpowers/plans/2026-10-01-monitoramento-leads.md`.

### 59.1 Onde fica e quem vê
- **Digital → "Monitoramento Leads"** (sub-aba ao lado de "Leads"): só **admin e supervisor**. O consultor não vê a barra de sub-abas. A sub-aba só é escondida na tela; a proteção real é do banco (as RPCs recusam quem não é admin/supervisor e a tabela `ligacoes_manuais` tem RLS).
- **Pedidos Parados → "Meus leads para tratar"**: só o **consultor** que tem linha em `leads_equipe` com `profile_id` = login dele. Vê apenas os próprios leads em aberto (de todas as abas), com tentativas e última ligação. Nunca lê `ligacoes_manuais`. Consultor sem vínculo não vê a seção.
- Mês do monitoramento = a aba da planilha escolhida (mesmas pílulas da Digital, seção 54).

### 59.2 Telefone e "número de lead"
`chave_tel` = DDD + 8 últimos dígitos (tira o `55` quando há 12+ dígitos; ignora o 9º dígito), igual em SQL (`public.chave_tel`) e em JS (`chaveTel`). "Número de lead" = telefone presente em qualquer aba de `leads`. Telefone com menos de 10 dígitos não casa com ninguém.

### 59.3 Upload do relatório
Botão "Escolher arquivo" (Excel/CSV da telefonia). Colunas obrigatórias: `ID`, `Usuario`, `Telefone`, `Status`, `DataHora_Geracao` (o resto é opcional; o nome da coluna ignora acento, caixa e espaços). Grava em `ligacoes_manuais` por `upsert` no `id`, em lotes de 500: reenviar o mês inteiro não duplica. Mostra lidas / novas / já existiam / inválidas e quem da equipe não aparece no arquivo. Horário do relatório = São Paulo (`-03:00`). Linha com ID vazio ou data fora do formato é contada como inválida e não é enviada.

### 59.4 O que a página mostra (nesta ordem)
1. Cards dos consultores monitorados (leads, vendas, conversão, perdidos, em andamento, sem contato, receita, sem ligação). Clicar filtra os blocos abaixo.
2. Upload.
3. **Fila de leads sem ligação** (em aberto, mais antigo primeiro; vermelho acima do SLA de 24 h).
4. **Cadência**: abaixo do mínimo (1 a 2 tentativas) e acima do teto (mais de 10) — padrões 3 e 10.
5. **Placar do dia**: ligações para lead hoje contra a meta (padrão 80), atendidas, leads tocados, minutos, hora da última.
6. **Qualidade**: taxa de atendimento, duração média falada, conversas boas (≥ 60 s) e atendidas tabuladas "SEM CONTATO".
7. **Inconsistências**: "sem contato" com 3+ ligações; "cliente não responde" com menos de 3 tentativas; venda sem nenhuma ligação.
8. **Tabela por consultor**, com "Os consultores de leads" e "Todos os consultores": ligações manuais, para leads, % do total, atendidas, leads diferentes, tentativas por lead e as janelas hoje/ontem/7 dias/30 dias (sempre relativas a hoje); o período (padrão = mês corrente) vale para os totais.
9. **Equipe de leads e metas** (só admin): nome na planilha, usuário na telefonia, perfil do painel, monitorar; metas `min_tentativas`, `max_tentativas`, `meta_ligacoes_dia`, `conversa_boa_seg`, `sla_primeira_ligacao_h`.
- Excel (SheetJS, sem cores): fila + cadência + inconsistências, e a tabela por consultor.

### 59.5 Banco (migration `supabase/migrations/20261001000000_monitoramento_leads.sql`, rollback em `supabase/rollback/`)
Aditiva. Cria `chave_tel`, `norm_nome`, `ligacoes_manuais` (RLS admin/supervisor), `leads_equipe` (leitura: o próprio perfil e admin/supervisor; escrita: admin), as RPCs `monitor_leads_leads`, `monitor_ligacoes_por_usuario`, `monitor_ligacoes_resumo` (admin/supervisor) e `meus_leads_para_tratar` (consultor vinculado), e semeia `leads_equipe` com Caio / Gabriel / Luria / Mariana (`profile_id` vazio: o admin liga cada um no editor). Metas em `config.monitor_leads_metas`. Verificação: `supabase/tests/monitoramento_leads_check.sql` (transação com rollback). **Ordem de entrada no ar:** migration primeiro, depois o painel (sem a migration as telas novas mostram "não foi possível carregar" e o resto não quebra).

### 59.6 Decisões e limites
- "Gabriel" na planilha de leads é o Gabriel Macedo (`apex.gabrielM`); o outro Gabriel (`apex.gabriels`) não recebe lead.
- Fora do escopo: API da telefonia, aviso por Slack/WhatsApp, o consultor ver o próprio placar de ligações, ajustar "Meus leads e retornos" da Digital para usar `leads_equipe`.
- Testes: `test_monitoramento_leads.js` (dados fictícios).
```

- [ ] **Step 3: Rodar a suíte completa**

Run: `bash run_tests.sh`
Expected: resumo com 0 falharam (testes que dependem de planilha real aparecem como PULADO; isso é aceitável). Se algum teste antigo falhar por causa das mudanças (por exemplo `test_reorganizacao_abas.js`), corrigir a causa no código novo, não o teste.

- [ ] **Step 4: Commit do código, da documentação e do painel gerado**

```bash
git add REGRAS_NEGOCIO.md painel_clientes_apex.html _template.html
git commit -m "docs(monitoramento-leads): seção 59 do REGRAS_NEGOCIO e painel regenerado" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: PARAR e pedir autorização ao Rafael — banco**

Mostrar o resultado da suíte e perguntar: "Posso aplicar a migration `20261001000000_monitoramento_leads` no Supabase `apex` (produção)?" Só continuar com um "sim" explícito. Se for sim:
1. Achar o projeto: ferramenta `mcp__63c7393c-...__list_projects` (projeto `apex`).
2. Aplicar: `apply_migration` com `name: monitoramento_leads` e o conteúdo do arquivo da migration.
3. Rodar `supabase/tests/monitoramento_leads_check.sql` por `execute_sql` (o arquivo termina em `rollback`); esperado: sem exceção. Qualquer `assert` que falhe = parar, investigar e (se preciso) rodar o rollback.
4. Conferir: `list_tables` mostra `ligacoes_manuais` e `leads_equipe`; `select count(*) from leads_equipe` = 4.

- [ ] **Step 6: PARAR e pedir autorização ao Rafael — publicação**

Perguntar: "Posso publicar o painel no ar?" Só com "sim" explícito, seguir a receita das seções 48.8 / 54.4 do REGRAS_NEGOCIO:
1. Baixar o painel que está no ar e comparar com o `oficial/main`; se o do ar tiver algo que o repositório não tem, juntar (nunca sobrescrever).
2. Backup no servidor (`~/deploy_backups/painel_clientes_apex_<data>_antes_monitoramento_leads.html`).
3. Enviar por SSH (atalho `hostinger`) para arquivo temporário e trocar pelo definitivo só depois de o MD5 bater; conferir também pelo site público.
4. Pedir ao Rafael para abrir **Digital → Monitoramento Leads → Equipe de leads e metas**, ligar cada pessoa ao perfil do painel, e enviar o primeiro relatório de ligações.
5. Registrar no fim da seção 59 um subtópico "59.7 Publicado" (data/hora, MD5, backup, como reverter), commitar e `git fetch oficial` + `git push oficial feat/monitoramento-leads:main` (sem `--force`), e atualizar a memória do projeto (`official-repo-atmizuta`).

Como reverter: painel → copiar o backup de volta; banco → `supabase/rollback/20261001000000_monitoramento_leads_rollback.sql` (só depois de reverter o painel).
