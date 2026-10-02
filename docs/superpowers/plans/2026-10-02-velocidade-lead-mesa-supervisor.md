# Velocidade do lead ("Atender agora") + Mesa do Supervisor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao consultor um relógio de minutos úteis para cada lead novo, com o 1º contato registrado em 1 clique, e dar ao supervisor uma aba "Mesa do Supervisor" com o semáforo da equipe e a cobrança em 1 clique.

**Architecture:**
- **Banco:** uma tabela de eventos `leads_contatos`, uma coluna `leads.primeira_sync_em` e seis RPCs `security definer` no Supabase `apex`, que devolvem só timestamps crus.
- **Painel:** toda a regra de tempo (expediente, feriados, cores, faixas) fica numa função pura em JS no `_template.html` (`vlMinutosUteis`), reaproveitando `ppFeriados`. O card do consultor fica em Digital → "Meus leads para tratar", e a Mesa é uma aba nova no grupo "Visão geral".
- **Sync:** o `sync-leads` passa a rodar a cada 10 min.

**Tech Stack:**
- HTML/JS puro num arquivo só (`_template.html` → `build_painel.py` → `painel_clientes_apex.html`);
- Supabase (Postgres 15, PostgREST, pg_cron);
- testes Node + jsdom (`bash run_tests.sh`);
- SheetJS para Excel.

**Spec:** `docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md`

## Global Constraints

- Trabalhe **só** no worktree `.worktrees/velocidade-mesa` (branch `feat/velocidade-lead-mesa-supervisor`, base `oficial/main`). Nunca troque de branch na pasta principal. Rode `git fetch oficial` antes de qualquer merge e faça push sem force.
- Edite só `_template.html`. O `painel_clientes_apex.html` é gerado por `python build_painel.py`.
- Design "Sinal de Ápice":
  - não mexa no bloco `<style>` ("SISTEMA VISUAL SINAL DE ÁPICE"), no `aside.sidebar`/`nav#tabsNav` (além do botão novo no formato existente), em `#pageHead`, no `ApexMotion`, no `mostrarAviso` nem no `fecharOverlay`;
  - **nenhuma cor em hex** no código novo;
  - reaproveite `.card`, `.kpiGrid`/`.kpiCard`/`.kpiLabel`/`.kpiValue`/`.kpiSub`, `table.tbl`, `.btn`/`.btn-sm`/`.btn-outline`/`.btn-ghost`, `.badge`, `.filterPill`, `.retornoLeadRow`/`.retornoLeadInfo`/`.retornoLeadSub`/`.retornoLeadAcoes`, `.retornoBadge` (`atrasado`/`hoje`/`futuro`), `.mlTabelaWrap`.
- Avisos ao usuário só com `mostrarAviso(msg, 'ok'|'erro'|'info')`, nunca `alert()` direto.
- O repositório é **público**:
  - testes só com dados **fictícios** (nomes "Lead Teste", telefones `p:+55199000000NN`);
  - nenhum segredo, telefone, CNPJ ou nome real.
- Supabase `apex` (`mdgfboijyqfkggcrhptn`) é **produção**:
  - aplicar migration, mudar o cron ou fazer deploy **só com ok explícito do Rafael**;
  - a leitura é livre.
- Publicar o painel **só com ok do Rafael naquele momento**:
  - antes, baixar o painel no ar e comparar;
  - fazer backup e conferir o MD5;
  - atualizar o vigia.

  Isso **não** faz parte deste plano.
- Horário de São Paulo = UTC−3 fixo (`FUSO_SAO_PAULO = '-03:00'`).
- Padrões de `config.velocidade_lead`: `{"seg_sex":["08:00","18:00"], "sabado":["08:00","12:00"], "verde_min":5, "amarelo_min":15, "janela_dias":7}`.
- Cores do relógio:
  - verde: `min <= verde_min`;
  - amarelo: `min <= amarelo_min`;
  - vermelho: acima disso;
  - "aguardando abertura": 0 min corridos e fora do expediente agora.
- **O status da planilha NÃO é contato.** Contato = clique em `leads_contatos` ou ligação manual com `gerada_em >= criado_em_lead - 1 h`.
- **"Esperando":** sem contato registrado e `categoria` em `sem_contato`/`andamento`.
- Registre a mudança em `REGRAS_NEGOCIO.md` como **§68**. Confira o próximo número livre com `git fetch oficial && git show oficial/main:REGRAS_NEGOCIO.md | grep -E '^## [0-9]+\.' | tail -3`.
- Falhas antigas e conhecidas de `run_tests.sh`, que não são regressão: `test_conversao_vendas.js` (relógio) e `test_pedidos_alerta.js` (`exceljs`).

## Review Focus

1. **Coluna nova com `default now()` em tabela cheia:** o `alter table … add column … default now()` preencheria as ~1.500 linhas antigas com a hora da migration e falsificaria o atraso da planilha. Elas precisam ficar **nulas**. O teste está no Task 1, Step 3, verificação 6.
2. **Usuário sem perfil ou papel nulo:** `get_my_role()` nulo não pode passar pela checagem `not in ('admin','supervisor')`, porque `NULL not in (…)` é NULL e o `if` não dispara. Todas as checagens usam `coalesce(get_my_role(), '')`. O teste está no Task 1, Step 3, verificação 5.
3. **Lead que chega à noite ou no fim de semana:** um lead das 21h atendido às 08:05 tem que dar 5 min, não 11 h. E com o painel aberto às 07h de domingo, o lead aparece como "aguardando abertura", não vermelho. O teste está no Task 3, Step 1 (casos de `vlMinutosUteis` e `vlPendentes`).
4. **Troca de login no mesmo navegador (consultor → admin ou o contrário):** os timers do relógio têm que parar, o card tem que sumir e a Mesa precisa voltar a funcionar sem recarregar a página. O teste está no Task 4, Step 1 (`vlResetar`) e no Task 7, Step 1 (consultor → admin).
5. **Mensagem do WhatsApp para lead novo:** o texto "resgatar" ("nossa conversa ficou em aberto") seria errado para quem nunca foi contatado. O card usa `vlMensagemPrimeiroContato`. O teste está no Task 4, Step 1.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261002100000_velocidade_lead_mesa.sql` (novo) | Tabela, coluna, config padrão, RPCs |
| `supabase/rollback/20261002100000_velocidade_lead_mesa_rollback.sql` (novo) | Desfaz o anterior |
| `supabase/migrations/20261002100100_sync_leads_10min.sql` (novo) | Cron `sync-leads-auto` a cada 10 min |
| `supabase/rollback/20261002100100_sync_leads_10min_rollback.sql` (novo) | Volta para `22,52` |
| `supabase/tests/velocidade_lead_mesa_check.sql` (novo) | Simula papéis em transação com rollback |
| `_template.html` | Funções `vl*` (relógio), card "Atender agora", registro no `plWhats`, aba e funções `mesa*` |
| `test_velocidade_lead.js` (novo) | Relógio + card do consultor |
| `test_mesa_supervisor.js` (novo) | Mesa do Supervisor |
| `test_monitoramento_leads.js` | Só a frase "a cada 30 min" → "a cada 10 min" |
| `REGRAS_NEGOCIO.md` | §68 |

---

## Parte A — Banco

### Task 1: Migration `velocidade_lead_mesa` + rollback + verificação SQL

**Files:**
- Create: `supabase/migrations/20261002100000_velocidade_lead_mesa.sql`
- Create: `supabase/rollback/20261002100000_velocidade_lead_mesa_rollback.sql`
- Create: `supabase/tests/velocidade_lead_mesa_check.sql`

**Interfaces:**
- Consumes (já existem no banco): `public.chave_tel(text)`, `public.norm_nome(text)`, `public.meus_leads_nomes()`, `public.get_my_role()`, as tabelas `leads`, `ligacoes_manuais`, `leads_equipe`, `leads_followups`, `propostas`, `producao_pedidos_neo`, `producao_etapa_historico`, `consultor_neo`, `profiles` e `config(chave text, valor text)`.
- Produces (RPCs que o painel chama; nomes e colunas exatos):
  - `registrar_contato_lead(p_aba text, p_lead_id text, p_canal text) → void`
  - `meus_leads_relogio() → (aba, lead_id, nome, telefone, cidade, qtd_linhas, status, categoria, criado_em_lead, primeiro_clique, primeira_ligacao)`
  - `mesa_leads_relogio(p_desde timestamptz) → (aba, lead_id, consultor, profile_id, criado_em_lead, primeira_sync_em, categoria, converteu, primeiro_clique, canal_clique, primeira_ligacao)`
  - `mesa_pendencias(p_ref date) → (profile_id, nome, tipo, ref, titulo, desde, extra)`, com `tipo` em `consultor | retorno_atrasado | lead_esfriando | proposta_parada | pedido_risco`
  - `mesa_ligacoes_hoje(p_ref date) → (profile_id, lig_lead, lig_total, ultima)`
  - `mesa_vendas_mes(p_mes date) → (profile_id, pedidos, receita)`

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20261002100000_velocidade_lead_mesa.sql`:

```sql
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
```

- [ ] **Step 2: Escrever o rollback**

Crie `supabase/rollback/20261002100000_velocidade_lead_mesa_rollback.sql`:

```sql
-- Rollback de 20261002100000_velocidade_lead_mesa.sql. Reverter o PAINEL antes (sem as funções, o card e a Mesa
-- só mostram "não foi possível carregar"; nada mais quebra). Apaga os cliques registrados (leads_contatos).
drop function if exists public.mesa_vendas_mes(date);
drop function if exists public.mesa_ligacoes_hoje(date);
drop function if exists public.mesa_pendencias(date);
drop function if exists public.mesa_leads_relogio(timestamptz);
drop function if exists public.meus_leads_relogio();
drop function if exists public.registrar_contato_lead(text, text, text);
drop table if exists public.leads_contatos;
alter table public.leads drop column if exists primeira_sync_em;
delete from public.config where chave = 'velocidade_lead';
```

- [ ] **Step 3: Escrever o script de verificação (sempre termina em ROLLBACK)**

Crie `supabase/tests/velocidade_lead_mesa_check.sql`:

```sql
-- Verificação de 20261002100000_velocidade_lead_mesa.sql. Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis/leads fictícios (zz*).
begin;

-- 6) (antes de inserir qualquer lead fictício) as linhas antigas NÃO ganharam a hora da migration
do $$ begin
  assert not exists (select 1 from public.leads where primeira_sync_em is not null and criado_em_lead < now() - interval '1 day'
                      and primeira_sync_em between now() - interval '10 minutes' and now()),
    'linhas antigas não podem ter primeira_sync_em = hora da migration';
end $$;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vloutro@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlsemperfil@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000bb01', 'Zzvlcons Teste', 'zz.vlcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000bb02', 'Zzvlsup Teste',  'zz.vlsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000bb03', 'Zzvloutro Teste','zz.vloutro','consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;
-- bb04 propositalmente SEM profile (get_my_role() nulo)

insert into public.leads (id, aba, consultor, full_name, phone_number, categoria, status, criado_em_lead) values
  ('zz:v1', 'ZZMES', 'Zzvlcons', 'Lead Teste V1', 'p:+5519900000201', 'andamento', 'EM NEGOCIACAO', now() - interval '2 hours'),
  ('zz:v2', 'ZZMES', 'Zzvloutro','Lead Teste V2', 'p:+5519900000202', 'andamento', 'EM NEGOCIACAO', now() - interval '2 hours'),
  ('zz:v3', 'ZZMES', 'Zzvlcons', 'Lead Teste V3', 'p:+5519900000203', 'andamento', 'EM NEGOCIACAO', now() - interval '10 days');

do $$
declare n int; t timestamptz;
begin
  -- 7) primeira_sync_em preenchida no insert e NÃO muda num upsert
  select primeira_sync_em into t from public.leads where aba = 'ZZMES' and id = 'zz:v1';
  assert t is not null, 'insert preenche primeira_sync_em';
  insert into public.leads (id, aba, consultor, full_name, status, categoria)
       values ('zz:v1', 'ZZMES', 'Zzvlcons', 'Lead Teste V1', 'PEDIDO CONCLUIDO (VENDA)', 'convertido')
  on conflict (aba, id) do update set status = excluded.status, categoria = excluded.categoria;
  assert (select primeira_sync_em from public.leads where aba = 'ZZMES' and id = 'zz:v1') = t, 'upsert não altera primeira_sync_em';
  update public.leads set categoria = 'andamento', status = 'EM NEGOCIACAO' where aba = 'ZZMES' and id = 'zz:v1';

  execute 'set local role authenticated';

  -- 1) consultor registra contato no PRÓPRIO lead; clique duplo em < 2 min não duplica
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb01', true);
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'whatsapp');
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'whatsapp');
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'manual');
  -- 2) meus_leads_relogio: só os leads dele, dentro da janela (v3 tem 10 dias, fora dos 7)
  select count(*) into n from public.meus_leads_relogio() where lead_id like 'zz:%';
  assert n = 1, 'meus_leads_relogio: só o v1 (dele, na janela), veio ' || n;
  assert (select primeiro_clique from public.meus_leads_relogio() where lead_id = 'zz:v1') is not null, 'v1 tem primeiro_clique';
  -- 3) consultor NÃO registra no lead de outro e NÃO chama a Mesa
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v2', 'whatsapp');
    assert false, 'consultor registrou contato no lead de outro';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_pendencias(current_date);
    assert false, 'consultor chamou mesa_pendencias';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_leads_relogio(now() - interval '1 day');
    assert false, 'consultor chamou mesa_leads_relogio';
  exception when insufficient_privilege then null; end;
  -- canal inválido
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'email');
    assert false, 'aceitou canal inválido';
  exception when invalid_parameter_value then null; end;
  -- consultor não lê leads_contatos direto
  begin
    perform 1 from public.leads_contatos limit 1;
    assert false, 'consultor leu leads_contatos direto';
  exception when insufficient_privilege then null; end;

  -- 4) supervisor: registra em qualquer lead e vê a Mesa
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb02', true);
  perform public.registrar_contato_lead('ZZMES', 'zz:v2', 'ligar');
  select count(*) into n from public.mesa_leads_relogio(now() - interval '1 day') where lead_id like 'zz:%';
  assert n = 2, 'mesa_leads_relogio: v1 e v2 (v3 é antigo), veio ' || n;
  assert (select canal_clique from public.mesa_leads_relogio(now() - interval '1 day') where lead_id = 'zz:v1') = 'whatsapp', 'canal do 1º clique';
  assert exists (select 1 from public.mesa_pendencias(current_date) where tipo = 'consultor' and profile_id = '00000000-0000-0000-0000-00000000bb03'),
    'mesa_pendencias traz a linha base de cada consultor';
  perform public.mesa_ligacoes_hoje(current_date);
  perform public.mesa_vendas_mes(current_date);

  -- 5) usuário SEM perfil (get_my_role nulo) não passa
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb04', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb04', true);
  begin
    perform public.mesa_pendencias(current_date);
    assert false, 'sem perfil chamou mesa_pendencias';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'manual');
    assert false, 'sem perfil registrou contato';
  exception when insufficient_privilege then null; end;
end $$;

-- contagem dos cliques gravados (como postgres): 2 do consultor (whatsapp 1x + manual) + 1 do supervisor
reset role;
do $$ begin
  assert (select count(*) from public.leads_contatos where lead_aba = 'ZZMES') = 3, 'clique duplo não duplicou (3 registros)';
end $$;

-- anon não executa nada
set local role anon;
do $$ begin
  begin perform public.meus_leads_relogio(); assert false, 'anon executou meus_leads_relogio';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
```

- [ ] **Step 4: Revisão estática (sem tocar no banco)**

Confira:
- todas as funções têm `security definer set search_path = public`;
- todas as da Mesa usam `coalesce(public.get_my_role(), '')`;
- existe `revoke … from public, anon` + `grant … to authenticated` para cada função.

Run:
```bash
grep -c "security definer set search_path = public" supabase/migrations/20261002100000_velocidade_lead_mesa.sql
grep -c "coalesce(public.get_my_role(), '')" supabase/migrations/20261002100000_velocidade_lead_mesa.sql
grep -c "^grant execute" supabase/migrations/20261002100000_velocidade_lead_mesa.sql
```
Expected: `6`, `5`, `6`.

- [ ] **Step 5: Aplicar e verificar (SÓ com ok explícito do Rafael)**

Pergunte ao Rafael: "Posso aplicar a migration `velocidade_lead_mesa` no Supabase apex (produção)? É aditiva: uma tabela nova, uma coluna nova e funções; o rollback está em `supabase/rollback/`."

Com o ok, faça o seguinte:
1. Aplique pelo conector, com `apply_migration` e nome `velocidade_lead_mesa`, usando o conteúdo do Step 1.
2. Rode `supabase/tests/velocidade_lead_mesa_check.sql` com `execute_sql`.

Expected: sem exceção, e o resultado final `ROLLBACK`.

Se uma verificação falhar, **não siga**. Rode o rollback do Step 2 com ok e corrija.

Sem ok: marque este step como pendente no relatório e siga para o Task 2. Os testes do painel usam mocks.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261002100000_velocidade_lead_mesa.sql supabase/rollback/20261002100000_velocidade_lead_mesa_rollback.sql supabase/tests/velocidade_lead_mesa_check.sql
git commit -m "feat(banco): leads_contatos, primeira_sync_em e RPCs da velocidade do lead e da Mesa (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Cron `sync-leads-auto` a cada 10 min

**Files:**
- Create: `supabase/migrations/20261002100100_sync_leads_10min.sql`
- Create: `supabase/rollback/20261002100100_sync_leads_10min_rollback.sql`

**Interfaces:**
- Consumes: a Edge Function `sync-leads` (já implantada, com autenticação `x-cron-secret` pelo Vault `sync_producao_cron_secret`).
- Produces: o job `sync-leads-auto` no schedule `2-59/10 * * * *`.

- [ ] **Step 1: Escrever a migration**

```sql
-- 02/10/2026 — sync-leads a cada 10 min (era 22,52). REGRAS_NEGOCIO.md §68 (velocidade do lead).
-- Minutos 2,12,22,32,42,52: fora dos múltiplos de 15 do alerta e do minuto 59 da produção. pg_cron em UTC.
-- Mesmo corpo da seção 62 (20261001400000_sync_leads_cron.sql); o segredo continua no Vault.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';

select cron.schedule('sync-leads-auto', '2-59/10 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-leads',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
```

- [ ] **Step 2: Escrever o rollback**

```sql
-- Rollback de 20261002100100_sync_leads_10min.sql: volta aos minutos 22 e 52 (seção 62).
select cron.unschedule(jobid) from cron.job where jobname = 'sync-leads-auto';

select cron.schedule('sync-leads-auto', '22,52 * * * *', $job$
  select net.http_post(
    url := 'https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/sync-leads',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_producao_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);
```

- [ ] **Step 3: Aplicar (SÓ com ok explícito do Rafael) e conferir**

Com o ok:
1. Aplique com `apply_migration` e nome `sync_leads_10min`.
2. Rode `select jobname, schedule, active from cron.job where jobname = 'sync-leads-auto';`.

Expected: `2-59/10 * * * *` e `true`.

Depois de 15 min, rode `select valor from config where chave = 'leads_atualizado_em';`. A hora tem que ser de no máximo 10 min atrás.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261002100100_sync_leads_10min.sql supabase/rollback/20261002100100_sync_leads_10min_rollback.sql
git commit -m "feat(banco): sync-leads a cada 10 min (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Parte B — "Atender agora" (consultor)

### Task 3: Funções puras do relógio (`vl*`) + texto "a cada 10 min"

**Files:**
- Modify: `_template.html`. Inserir o bloco novo **logo depois** do listener `document.getElementById('plAbaPills').addEventListener('click', …);` (procure `data-pl-aba]');`) e trocar o texto `automática a cada 30 min` (procure `automática a cada 30 min`).
- Create: `test_velocidade_lead.js`
- Modify: `test_monitoramento_leads.js` (a asserção `automática a cada 30 min`)

**Interfaces:**
- Consumes: `ppFeriados(ano) → Set<'YYYY-MM-DD'>`, `somaDiasStr(dia, delta) → 'YYYY-MM-DD'`, `plNormStatus(s)`.
- Produces (usados nos Tasks 4–8):
  - `VL_CFG_PADRAO`
  - `vlCfg(valor:string|object|null) → cfg`
  - `vlPartesSP(ms) → {dia, min}`
  - `vlExpediente(dia, cfg) → [ini,fim]|null`
  - `vlMinutosUteis(iniMs, fimMs, cfg) → number`
  - `vlDentroExpediente(ms, cfg) → bool`
  - `vlCor(min, cfg) → 'verde'|'amarelo'|'vermelho'`
  - `vlFmtMin(min) → string`
  - `vlMs(v) → number|null`
  - `vlPrimeiroContatoMs(lead) → number|null`
  - `vlEsperando(lead) → bool`
  - `vlPendentes(leads, agoraMs, cfg) → [{lead, min, cor}]`, com `cor` em `vermelho|amarelo|verde|aguardando`, ordenado
  - `VL_FAIXAS`
  - `vlFaixa(lead, cfg) → 'ate5'|'5a15'|'15a60'|'1a4h'|'mais4h'|'sem'`

- [ ] **Step 1: Escrever o teste (falha)**

Crie `test_velocidade_lead.js`:

```js
// Testa a velocidade do lead ("Atender agora", 02/10/2026) — REGRAS_NEGOCIO.md §68.
// Spec: docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md
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
window.__rpcRespostas = {};
window.__tabelas = {};
window.__escritas = [];
window.__lidas = [];
window.__alertas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    update: (patch) => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => { window.__lidas.push(t); return builder(t); },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = (m) => window.__alertas.push(String(m));
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
  const sp = (s) => Date.parse(s + '-03:00');   // '2026-10-05T09:00:00' em São Paulo -> ms
  const cfg = vlCfg(null);

  // ==== TASK 3: funções puras ====
  eq(cfg.amarelo_min, 15, 'padrão amarelo 15');
  eq(vlCfg('{"amarelo_min":20}').amarelo_min, 20, 'config sobrescreve amarelo');
  eq(vlCfg('{"amarelo_min":20}').verde_min, 5, 'config mantém o resto do padrão');
  eq(vlCfg('lixo').amarelo_min, 15, 'config inválida = padrão');
  eq(vlPartesSP(sp('2026-10-05T08:30:00')), { dia: '2026-10-05', min: 510 }, 'partes em SP');
  eq(vlExpediente('2026-10-05', cfg), [480, 1080], 'segunda 08–18');
  eq(vlExpediente('2026-10-10', cfg), [480, 720], 'sábado 08–12');
  eq(vlExpediente('2026-10-04', cfg), null, 'domingo não tem expediente');
  eq(vlExpediente('2026-10-12', cfg), null, 'feriado (12/10) não tem expediente');
  eq(vlExpediente('2026-10-10', vlCfg('{"sabado":null}')), null, 'sábado desligado na config');

  eq(vlMinutosUteis(sp('2026-10-05T09:00:00'), sp('2026-10-05T09:12:00'), cfg), 12, 'dentro do expediente');
  eq(vlMinutosUteis(sp('2026-10-05T21:00:00'), sp('2026-10-06T08:05:00'), cfg), 5, 'chegou 21h, atendido 08:05 = 5 min');
  eq(vlMinutosUteis(sp('2026-10-05T21:00:00'), sp('2026-10-05T22:00:00'), cfg), 0, 'atendido antes da abertura = 0');
  eq(vlMinutosUteis(sp('2026-10-05T17:50:00'), sp('2026-10-06T08:10:00'), cfg), 20, 'atravessa o fechamento das 18h');
  eq(vlMinutosUteis(sp('2026-10-10T11:50:00'), sp('2026-10-13T08:03:00'), cfg), 13, 'sábado até 12h + domingo + feriado + terça');
  eq(vlMinutosUteis(sp('2026-10-05T10:00:00'), sp('2026-10-05T09:00:00'), cfg), 0, 'fim antes do início = 0');

  assert(vlDentroExpediente(sp('2026-10-05T08:00:00'), cfg) && !vlDentroExpediente(sp('2026-10-05T18:00:00'), cfg), 'expediente fechado no fim');
  eq([vlCor(5, cfg), vlCor(5.5, cfg), vlCor(15, cfg), vlCor(15.5, cfg)], ['verde', 'amarelo', 'amarelo', 'vermelho'], 'fronteiras das cores');
  eq([vlFmtMin(0.4), vlFmtMin(12), vlFmtMin(75)], ['< 1 min', '12 min', '1h 15min'], 'formato do relógio');

  const L = (id, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, nome: 'Lead Teste ' + id, telefone: 'p:+5519900000001', categoria: 'andamento', status: 'EM NEGOCIACAO', criado_em_lead: new Date(sp('2026-10-05T09:00:00')).toISOString(), primeiro_clique: null, primeira_ligacao: null }, extra || {});
  assert(vlEsperando(L('a')), 'andamento sem contato = esperando');
  assert(!vlEsperando(L('b', { primeiro_clique: '2026-10-05T12:05:00Z' })), 'com clique não espera');
  assert(!vlEsperando(L('c', { primeira_ligacao: '2026-10-05T12:05:00Z' })), 'com ligação não espera');
  assert(!vlEsperando(L('d', { categoria: 'convertido' })), 'convertido sem contato sai da lista');
  assert(!vlEsperando(L('e', { categoria: 'perdido' })), 'perdido sem contato sai da lista');
  eq(vlPrimeiroContatoMs(L('f', { primeiro_clique: '2026-10-05T12:10:00Z', primeira_ligacao: '2026-10-05T12:05:00Z' })), Date.parse('2026-10-05T12:05:00Z'), '1º contato = o mais antigo');

  const agora = sp('2026-10-05T10:00:00');
  const pend = vlPendentes([
    L('verde', { criado_em_lead: new Date(sp('2026-10-05T09:58:00')).toISOString() }),
    L('amar', { criado_em_lead: new Date(sp('2026-10-05T09:50:00')).toISOString() }),
    L('verm', { criado_em_lead: new Date(sp('2026-10-05T09:00:00')).toISOString() }),
    L('feito', { primeiro_clique: '2026-10-05T12:30:00Z' }),
  ], agora, cfg);
  eq(pend.map(x => x.lead.lead_id), ['verm', 'amar', 'verde'], 'ordem vermelho → amarelo → verde, sem o contatado');
  eq(pend.map(x => x.cor), ['vermelho', 'amarelo', 'verde'], 'cores na lista');
  const dom7 = vlPendentes([L('noite', { criado_em_lead: new Date(sp('2026-10-04T20:00:00')).toISOString() })], sp('2026-10-04T23:00:00'), cfg);
  eq(dom7[0].cor, 'aguardando', 'domingo à noite: aguardando abertura, não vermelho');
  eq(vlPendentes(null, agora, cfg), [], 'null não quebra');

  eq(vlFaixa(L('g', { primeiro_clique: new Date(sp('2026-10-05T09:04:00')).toISOString() }), cfg), 'ate5', 'faixa até 5');
  eq(vlFaixa(L('h', { primeiro_clique: new Date(sp('2026-10-05T09:10:00')).toISOString() }), cfg), '5a15', 'faixa 5–15');
  eq(vlFaixa(L('i', { primeiro_clique: new Date(sp('2026-10-05T09:40:00')).toISOString() }), cfg), '15a60', 'faixa 15–60');
  eq(vlFaixa(L('j', { primeiro_clique: new Date(sp('2026-10-05T11:00:00')).toISOString() }), cfg), '1a4h', 'faixa 1–4 h');
  eq(vlFaixa(L('k', { primeiro_clique: new Date(sp('2026-10-05T15:00:00')).toISOString() }), cfg), 'mais4h', 'faixa > 4 h');
  eq(vlFaixa(L('l'), cfg), 'sem', 'sem contato registrado');

  // ==== mais testes entram aqui ====

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

Run: `node test_velocidade_lead.js`
Expected: `FALHA: ReferenceError: vlCfg is not defined`

- [ ] **Step 3: Implementar as funções puras**

No `_template.html`, logo depois do bloco do listener `#plAbaPills`, insira:

```js
/* ---- Velocidade do lead ("Atender agora") — 02/10/2026, REGRAS_NEGOCIO.md §68 ----
   Relógio em MINUTOS ÚTEIS desde a entrada do lead até o 1º contato (clique no painel ou ligação manual).
   O status da planilha não conta como contato: os leads já chegam com status (verificado em 02/10). */
const VL_CFG_PADRAO = { seg_sex: ['08:00', '18:00'], sabado: ['08:00', '12:00'], verde_min: 5, amarelo_min: 15, janela_dias: 7 };
function vlCfg(valor){
  let o = null;
  try{ o = typeof valor === 'string' ? JSON.parse(valor) : valor; }catch(e){ o = null; }
  return Object.assign({}, VL_CFG_PADRAO, (o && typeof o === 'object') ? o : {});
}
function vlHoraMin(hhmm){ const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
// Dia e minuto do dia em São Paulo (UTC-3 fixo — FUSO_SAO_PAULO; sem horário de verão desde 2019).
function vlPartesSP(ms){
  const d = new Date(ms - 3 * 3600000);
  return { dia: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 };
}
// Expediente do dia em minutos [início, fim]; null em domingo, feriado nacional (ppFeriados) ou config inválida.
function vlExpediente(dia, cfg){
  const wd = new Date(dia + 'T00:00:00Z').getUTCDay();
  if(wd === 0 || ppFeriados(Number(dia.slice(0, 4))).has(dia)) return null;
  const par = wd === 6 ? cfg.sabado : cfg.seg_sex;
  if(!Array.isArray(par)) return null;
  const a = vlHoraMin(par[0]), b = vlHoraMin(par[1]);
  return (a === null || b === null || b <= a) ? null : [a, b];
}
// Minutos de expediente entre dois instantes (ms). Fora do expediente não conta.
function vlMinutosUteis(iniMs, fimMs, cfg){
  if(!(fimMs > iniMs)) return 0;
  const a = vlPartesSP(iniMs), b = vlPartesSP(fimMs);
  let total = 0, dia = a.dia;
  for(let guard = 0; guard < 400 && dia <= b.dia; guard++){
    const j = vlExpediente(dia, cfg);
    if(j){
      const de = Math.max(j[0], dia === a.dia ? a.min : 0), ate = Math.min(j[1], dia === b.dia ? b.min : 1440);
      if(ate > de) total += ate - de;
    }
    dia = somaDiasStr(dia, 1);
  }
  return Math.round(total * 100) / 100;
}
function vlDentroExpediente(ms, cfg){ const p = vlPartesSP(ms), j = vlExpediente(p.dia, cfg); return !!j && p.min >= j[0] && p.min < j[1]; }
function vlCor(min, cfg){ return min <= cfg.verde_min ? 'verde' : (min <= cfg.amarelo_min ? 'amarelo' : 'vermelho'); }
function vlFmtMin(min){
  const m = Math.floor(min);
  if(m < 1) return '< 1 min';
  if(m < 60) return m + ' min';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'min';
}
function vlMs(v){ const t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; }
function vlPrimeiroContatoMs(l){ const a = vlMs(l.primeiro_clique), b = vlMs(l.primeira_ligacao); return a === null ? b : (b === null ? a : Math.min(a, b)); }
// "Esperando" = sem contato registrado e ainda em aberto na planilha.
function vlEsperando(l){ return vlPrimeiroContatoMs(l) === null && (l.categoria === 'sem_contato' || l.categoria === 'andamento'); }
const VL_ORDEM_COR = { vermelho: 0, amarelo: 1, verde: 2, aguardando: 3 };
function vlPendentes(leads, agoraMs, cfg){
  return (leads || []).filter(vlEsperando).map(l => {
    const ini = vlMs(l.criado_em_lead);
    const min = ini === null ? 0 : vlMinutosUteis(ini, agoraMs, cfg);
    const aguardando = min === 0 && !vlDentroExpediente(agoraMs, cfg);
    return { lead: l, min, cor: aguardando ? 'aguardando' : vlCor(min, cfg) };
  }).sort((x, y) => (VL_ORDEM_COR[x.cor] - VL_ORDEM_COR[y.cor]) || (y.min - x.min) || String(x.lead.criado_em_lead).localeCompare(String(y.lead.criado_em_lead)));
}
// Faixas de tempo até o 1º contato (Mesa → Velocidade × conversão).
const VL_FAIXAS = [['ate5', 'até 5 min', 5], ['5a15', '5 a 15 min', 15], ['15a60', '15 a 60 min', 60], ['1a4h', '1 a 4 h', 240], ['mais4h', 'mais de 4 h', Infinity]];
function vlFaixa(l, cfg){
  const c = vlPrimeiroContatoMs(l), i = vlMs(l.criado_em_lead);
  if(c === null || i === null) return 'sem';
  const m = vlMinutosUteis(i, c, cfg);
  return VL_FAIXAS.find(f => m <= f[2])[0];
}
```

E troque, na função que mostra o status da Digital, `(automática a cada 30 min)` por `(automática a cada 10 min)`. No comentário da linha anterior, troque "a cada 30 min" por "a cada 10 min (seção 68; antes 30 min, seção 62)".

Em `test_monitoramento_leads.js`, troque `includes('automática a cada 30 min')` por `includes('automática a cada 10 min')`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_velocidade_lead.js && node test_monitoramento_leads.js`
Expected: `test_velocidade_lead.js` termina com `--- RESULTADO: N passaram, 0 falharam ---` e o monitoramento também com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_velocidade_lead.js test_monitoramento_leads.js
git commit -m "feat(painel): relógio de minutos úteis do lead (vlMinutosUteis e cia.) e sync a cada 10 min no texto (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Card "Atender agora" (carga, tela, registro do contato, reset)

**Files:**
- Modify: `_template.html`:
  - HTML: dentro de `<div id="plWrap" …>`, **antes** de `<div class="card" id="plErro"`;
  - JS: logo depois das funções do Task 3;
  - `plResetar()` e `ppIniciar()`.
- Test: `test_velocidade_lead.js` (no lugar de `// ==== mais testes entram aqui ====`)

**Interfaces:**
- Consumes: as funções do Task 3; `plEstado.vinculado`; `plCarregar()`; `ppSeguro(fn)`; `ppEscolherTelefone([tel]) → '55…'|null`; `ppPrimeiroNome()`; `escapeHtml`; `mostrarAviso`; `canSeePedidosParados()`; `digitalSubBarra()`; as RPCs `meus_leads_relogio` e `registrar_contato_lead`; a tabela `config` (`chave = 'velocidade_lead'`).
- Produces:
  - `vlEstado`
  - `vlChave(lead) → 'aba|id'`
  - `vlMensagemPrimeiroContato(lead, consultor) → string`
  - `vlCarregar(avisar:boolean) → Promise`
  - `vlRender()`
  - `vlRegistrar(aba, leadId, canal) → Promise<boolean>` (usado no Task 5)
  - `vlIniciar()`
  - `vlResetar()`

- [ ] **Step 1: Escrever o teste (falha)**

Em `test_velocidade_lead.js`, troque `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 4: card "Atender agora" ====
  const nowReal = Date.now;
  Date.now = () => sp('2026-10-05T10:00:00');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__tabelas.config = [{ chave: 'velocidade_lead', valor: '{"amarelo_min":15}' }];
  window.__rpcRespostas.meus_leads_vinculado = { data: true, error: null };
  window.__rpcRespostas.meus_leads_para_tratar = { data: [], error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [], error: null };
  window.__tabelas.leads_followups = [];
  const iso = (s) => new Date(sp(s)).toISOString();
  window.__rpcRespostas.meus_leads_relogio = { data: [
    L('verde', { criado_em_lead: iso('2026-10-05T09:58:00'), cidade: 'Cidade Teste', qtd_linhas: '3' }),
    L('verm', { criado_em_lead: iso('2026-10-05T09:00:00') }),
    L('feito', { primeiro_clique: iso('2026-10-05T09:01:00') }),
  ], error: null };
  await plCarregar();
  await vlCarregar(false);
  const card = document.getElementById('vlCard');
  assert(card && card.style.display !== 'none', 'consultor vinculado vê o card');
  eq([...document.querySelectorAll('#vlLista .vlRow')].map(r => r.dataset.leadId), ['verm', 'verde'], 'só quem espera, vermelho primeiro');
  assert(document.querySelector('#vlLista [data-lead-id="verm"] .vlRelogio').textContent.trim() === '1h 00min', 'relógio do vermelho');
  assert(document.querySelector('#vlLista [data-lead-id="verm"] .vlRelogio').classList.contains('atrasado'), 'vermelho usa a classe atrasado');
  assert(document.querySelector('#vlLista [data-lead-id="verde"]').textContent.includes('Cidade Teste'), 'mostra a cidade');
  const wa = document.querySelector('#vlLista [data-lead-id="verde"] a[data-vl-canal="whatsapp"]');
  assert(wa && wa.href.startsWith('https://wa.me/55'), 'botão WhatsApp com número');
  const txtWa = decodeURIComponent(wa.href.split('text=')[1]);
  assert(txtWa.includes('Claro Empresas') && !txtWa.includes('ficou em aberto'), 'mensagem de 1º contato (não a de resgatar)');
  assert(document.querySelector('#vlLista [data-lead-id="verde"] a[data-vl-canal="ligar"]').getAttribute('href').startsWith('tel:'), 'botão Ligar com tel:');

  // "Já falei com ele": registra 'manual' e o lead sai na hora
  window.__rpcCalls.length = 0;
  document.querySelector('#vlLista [data-lead-id="verde"] [data-vl-canal="manual"]').click();
  await espera(30);
  const reg = window.__rpcCalls.find(c => c.nome === 'registrar_contato_lead');
  eq(reg && reg.args, { p_aba: 'OUTUBRO', p_lead_id: 'verde', p_canal: 'manual' }, 'registra o contato manual');
  assert(!document.querySelector('#vlLista [data-lead-id="verde"]'), 'lead contatado sai da lista na hora');

  // erro ao registrar: o lead volta e aparece aviso de erro
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: { message: 'falhou' } };
  window.__alertas.length = 0;
  document.querySelector('#vlLista [data-lead-id="verm"] [data-vl-canal="whatsapp"]').click();
  await espera(30);
  assert(document.querySelector('#vlLista [data-lead-id="verm"]'), 'erro: o lead volta para a lista');
  const avisosTxt = window.__alertas.join(' ') + ' ' + (document.getElementById('apexToasts') ? document.getElementById('apexToasts').textContent : '');
  assert(avisosTxt.includes('Não foi possível registrar o contato'), 'erro: aviso para tentar de novo');
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: null };

  // vazio e erro de carga
  window.__rpcRespostas.meus_leads_relogio = { data: [L('x', { categoria: 'convertido' })], error: null };
  await vlCarregar(false);
  assert(document.getElementById('vlLista').textContent.includes('Nenhum lead esperando'), 'vazio: mensagem positiva');
  window.__rpcRespostas.meus_leads_relogio = { data: null, error: { message: 'x' } };
  await vlCarregar(false);
  assert(document.getElementById('vlLista').textContent.includes('Não foi possível carregar'), 'erro de carga no card');
  assert(!/NaN|undefined/.test(document.getElementById('vlCard').textContent), 'nada de NaN/undefined');

  // privacidade e troca de login
  assert(!window.__lidas.includes('ligacoes_manuais') && !window.__lidas.includes('leads_contatos'), 'consultor nunca lê ligacoes_manuais/leads_contatos');
  assert(!window.__rpcCalls.some(c => /^mesa_/.test(c.nome)), 'consultor nunca chama RPC da Mesa');
  vlIniciar();
  assert(vlEstado.timerPoll !== null, 'vlIniciar liga a recarga');
  vlResetar();
  assert(vlEstado.timerPoll === null && vlEstado.timerRender === null, 'vlResetar desliga os timers');
  assert(document.getElementById('vlCard').style.display === 'none' && document.getElementById('vlLista').innerHTML === '', 'vlResetar esconde e limpa o card');
  currentUser = { id: 'a1', nome: 'Admin Teste', username: 'adm', role: 'admin' };
  window.__rpcCalls.length = 0;
  await vlCarregar(false);
  assert(!window.__rpcCalls.some(c => c.nome === 'meus_leads_relogio'), 'admin não carrega o card do consultor');
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_velocidade_lead.js`
Expected: `FALHA: ReferenceError: vlCarregar is not defined` (ou `card && …` falhando).

- [ ] **Step 3: Implementar**

**HTML.** Dentro de `<div id="plWrap" style="display:none">`, antes de `<div class="card" id="plErro" style="display:none">`:

```html
        <!-- 02/10/2026 (seção 68): leads novos esperando o 1º contato, com relógio em minutos úteis -->
        <div class="card" id="vlCard" style="display:none">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <h3 style="margin:0">Atender agora</h3>
            <button type="button" class="btn btn-sm btn-outline" id="btnVlNotificar" style="width:auto;display:none">Avisar no navegador</button>
          </div>
          <p class="desc">Leads novos que ainda não receberam o 1º contato. O relógio conta só o horário de trabalho: até 5 min é o ideal; depois de 15 min a chance de venda cai. Use os botões abaixo — é assim que o contato fica registrado.</p>
          <div id="vlLista"></div>
        </div>
```

**JS.** Logo depois das funções do Task 3:

```js
const vlEstado = { geracao: 0, leads: [], erro: false, cfg: vlCfg(null), vistos: null, registrados: new Set(), timerRender: null, timerPoll: null };
function vlChave(l){ return l.aba + '|' + l.lead_id; }
// 1º contato: o lead acabou de pedir informação (não usar a mensagem de "resgatar" do plMensagemWhats).
function vlMensagemPrimeiroContato(l, consultor){
  const nome = String(l.nome || '').trim().split(/\s+/)[0] || '';
  const eu = consultor ? `Aqui é ${consultor}, da Claro Empresas.` : 'Aqui é a equipe da Claro Empresas.';
  return `${nome ? `Olá, ${nome}!` : 'Olá!'} ${eu} Recebi agora o seu pedido de informações sobre os planos para empresas. Posso te ajudar por aqui ou prefere que eu te ligue?`;
}
async function vlCarregar(avisar){
  if(!canSeePedidosParados()) return;
  const geracao = vlEstado.geracao;
  const [lds, cfg] = await Promise.all([
    ppSeguro(() => sb.rpc('meus_leads_relogio')),
    ppSeguro(() => sb.from('config').select('chave,valor').eq('chave', 'velocidade_lead').maybeSingle()),
  ]);
  if(geracao !== vlEstado.geracao) return;   // trocou de usuário no meio
  vlEstado.cfg = vlCfg(cfg && !cfg.error && cfg.data ? cfg.data.valor : null);
  vlEstado.erro = !!(lds && lds.error);
  if(vlEstado.erro){ console.error(lds.error); vlRender(); return; }
  vlEstado.leads = (lds && lds.data) || [];
  if(avisar && vlEstado.vistos) vlEstado.leads.filter(l => vlEsperando(l) && !vlEstado.vistos.has(vlChave(l))).forEach(vlAvisarNovo);
  vlEstado.vistos = new Set(vlEstado.leads.map(vlChave));
  vlRender();
}
function vlAvisarNovo(l){
  const nome = String(l.nome || '').trim().split(/\s+/)[0] || 'sem nome';
  mostrarAviso('Lead novo: ' + nome + ' — atenda agora', 'info');
  try{
    if('Notification' in window && Notification.permission === 'granted') new Notification('Lead novo: ' + nome, { body: 'Atenda agora — o relógio já está correndo.' });
  }catch(e){ /* navegador sem suporte: o aviso na tela basta */ }
}
function vlRender(){
  const card = document.getElementById('vlCard'), lista = document.getElementById('vlLista');
  if(!canSeePedidosParados() || !plEstado.vinculado){ card.style.display = 'none'; return; }
  card.style.display = '';
  document.getElementById('btnVlNotificar').style.display = ('Notification' in window && Notification.permission === 'default') ? '' : 'none';
  if(vlEstado.erro){ lista.innerHTML = '<p class="desc">Não foi possível carregar agora. Tente de novo em instantes.</p>'; return; }
  const pend = vlPendentes(vlEstado.leads.filter(l => !vlEstado.registrados.has(vlChave(l))), Date.now(), vlEstado.cfg);
  if(!pend.length){ lista.innerHTML = '<p class="desc">Nenhum lead esperando. Bom trabalho.</p>'; return; }
  const consultor = ppPrimeiroNome();
  const classe = { vermelho: 'retornoBadge atrasado', amarelo: 'retornoBadge hoje', verde: 'retornoBadge futuro', aguardando: 'badge' };
  lista.innerHTML = pend.map(x => {
    const l = x.lead, wa = ppEscolherTelefone([l.telefone]), tel = String(l.telefone || '').replace(/^p:/, '').replace(/[^\d+]/g, '');
    const attrs = `data-aba="${escapeHtml(l.aba)}" data-lead-id="${escapeHtml(l.lead_id)}"`;
    const sub = [l.cidade, l.qtd_linhas ? 'Linhas: ' + l.qtd_linhas : ''].filter(Boolean).join(' · ');
    const rel = x.cor === 'aguardando' ? 'aguardando abertura' : vlFmtMin(x.min);
    return `<div class="retornoLeadRow vlRow" ${attrs} data-vl-cor="${x.cor}">
      <div class="retornoLeadInfo"><strong>${escapeHtml(l.nome || '(sem nome)')}</strong>${sub ? `<span class="retornoLeadSub">${escapeHtml(sub)}</span>` : ''}</div>
      <div class="retornoLeadAcoes">
        <span class="${classe[x.cor]} vlRelogio">${escapeHtml(rel)}</span>
        ${wa ? `<a class="btn btn-sm" target="_blank" rel="noopener" data-vl-canal="whatsapp" ${attrs} href="https://wa.me/${wa}?text=${encodeURIComponent(vlMensagemPrimeiroContato(l, consultor))}" style="width:auto">WhatsApp</a>` : ''}
        ${tel ? `<a class="btn btn-sm btn-outline" data-vl-canal="ligar" ${attrs} href="tel:${escapeHtml(tel)}" style="width:auto">Ligar</a>` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-vl-canal="manual" ${attrs}>Já falei com ele</button>
      </div></div>`;
  }).join('');
}
// Registra o contato (otimista: some da lista na hora; se o banco recusar, volta e avisa).
async function vlRegistrar(aba, leadId, canal){
  const k = aba + '|' + leadId;
  vlEstado.registrados.add(k);
  vlRender();
  const res = await ppSeguro(() => sb.rpc('registrar_contato_lead', { p_aba: aba, p_lead_id: leadId, p_canal: canal }));
  if(res && res.error){
    console.error(res.error);
    vlEstado.registrados.delete(k);
    vlRender();
    mostrarAviso('Não foi possível registrar o contato — tente de novo', 'erro');
    return false;
  }
  return true;
}
document.getElementById('vlLista').addEventListener('click', function(ev){
  const el = ev.target.closest('[data-vl-canal]');
  if(el) vlRegistrar(el.dataset.aba, el.dataset.leadId, el.dataset.vlCanal);   // não bloqueia: o link (WhatsApp/tel:) abre normalmente
});
document.getElementById('btnVlNotificar').addEventListener('click', function(){
  if(!('Notification' in window)) return;
  Promise.resolve(Notification.requestPermission()).then(vlRender).catch(() => {});
});
function vlPararTimers(){
  clearInterval(vlEstado.timerRender); clearInterval(vlEstado.timerPoll);
  vlEstado.timerRender = null; vlEstado.timerPoll = null;
}
// Liga o card e a recarga (2 min, só com a aba do navegador visível) — roda mesmo fora da Digital, para o aviso de lead novo.
function vlIniciar(){
  vlPararTimers();
  if(!canSeePedidosParados() || !plEstado.vinculado) return;
  vlCarregar(false).catch(err => console.error(err));
  vlEstado.timerRender = setInterval(() => { if(document.getElementById('vlCard').style.display !== 'none') vlRender(); }, 30000);
  vlEstado.timerPoll = setInterval(() => { if(document.visibilityState === 'visible') vlCarregar(true).catch(err => console.error(err)); }, 120000);
}
function vlResetar(){
  vlEstado.geracao++;
  vlPararTimers();
  Object.assign(vlEstado, { leads: [], erro: false, cfg: vlCfg(null), vistos: null, registrados: new Set() });
  document.getElementById('vlLista').innerHTML = '';
  document.getElementById('vlCard').style.display = 'none';
}
```

**Ligações:**
1. Em `plResetar()`, na primeira linha do corpo (antes de `plEstado.geracao++;`), acrescente `vlResetar();`.
2. Em `ppIniciar()`, troque `  await ppCarregarDados(true);\n  ppRenderMeuDia();` por:

```js
  await ppCarregarDados(true);
  ppRenderMeuDia();
  // 02/10/2026 (seção 68): relógio do lead novo + aviso, desde o login (não só quando abre a Digital)
  plCarregar().then(() => { digitalSubBarra(); vlIniciar(); }).catch(err => console.error(err));
```

3. Em `plCarregar()`, depois de `plRender();` (última linha), acrescente `vlRender();`. Assim o card acompanha o vínculo quando a sub-aba é aberta.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_velocidade_lead.js && node test_monitoramento_leads.js && node test_pedidos_parados.js`
Expected: os três com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_velocidade_lead.js
git commit -m "feat(painel): card Atender agora com relógio, registro do 1º contato e reset na troca de login (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Registro no WhatsApp da lista de baixo + aviso de lead novo

**Files:**
- Modify: `_template.html`:
  - em `plRender()`, o `<a class="btn btn-sm plWhats" …>`;
  - o listener de `#plLista` (procure `document.getElementById('plLista').addEventListener('click', async function(ev){`).
- Test: `test_velocidade_lead.js`

**Interfaces:**
- Consumes: `vlRegistrar(aba, leadId, canal)` e `vlCarregar(avisar)` do Task 4.
- Produces: o atributo `data-aba` + `data-lead-id` no `.plWhats`.

- [ ] **Step 1: Escrever o teste (falha)**

Troque `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 5: WhatsApp da lista de baixo registra contato; aviso de lead novo ====
  Date.now = () => sp('2026-10-05T10:00:00');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__rpcRespostas.meus_leads_para_tratar = { data: [{ aba: 'OUTUBRO', lead_id: 'pl1', nome: 'Lead Teste PL', telefone: 'p:+5519900000011', status: 'EM NEGOCIACAO', categoria: 'andamento', criado_em_lead: '2026-10-04T12:00:00Z', tentativas: 0, atendidas: 0, ultima_ligacao: null, obs: '' }], error: null };
  window.__rpcRespostas.meus_leads_relogio = { data: [], error: null };
  await plCarregar();
  const plw = document.querySelector('#plLista .plWhats');
  assert(plw && plw.dataset.aba === 'OUTUBRO' && plw.dataset.leadId === 'pl1', 'plWhats leva aba e id');
  window.__rpcCalls.length = 0;
  plw.click();
  await espera(30);
  eq((window.__rpcCalls.find(c => c.nome === 'registrar_contato_lead') || {}).args, { p_aba: 'OUTUBRO', p_lead_id: 'pl1', p_canal: 'whatsapp' }, 'WhatsApp da lista registra contato');

  // aviso de lead novo: a 1ª carga só memoriza; a recarga com lead novo avisa
  window.__rpcRespostas.meus_leads_relogio = { data: [L('n1', { criado_em_lead: iso('2026-10-05T09:55:00') })], error: null };
  vlResetar();
  await vlCarregar(true);
  window.__alertas.length = 0;
  const toasts = () => window.__alertas.join(' ') + ' ' + (document.getElementById('apexToasts') ? document.getElementById('apexToasts').textContent : '');
  const antes = toasts();
  window.__rpcRespostas.meus_leads_relogio = { data: [L('n1', { criado_em_lead: iso('2026-10-05T09:55:00') }), L('n2', { nome: 'Fulano Teste', criado_em_lead: iso('2026-10-05T09:59:00') })], error: null };
  await vlCarregar(true);
  const depois = toasts().replace(antes, '');
  assert(depois.includes('Lead novo: Fulano'), 'recarga avisa o lead novo');
  assert(!depois.includes('Lead Teste n1'.split(' ')[0] + ' — '), 'não avisa de novo o que já tinha visto');
  window.__alertas.length = 0;
  const antes2 = toasts();
  await vlCarregar(true);
  assert(!toasts().replace(antes2, '').includes('Lead novo'), 'sem lead novo, sem aviso');
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_velocidade_lead.js`
Expected: `FALHOU: plWhats leva aba e id`

- [ ] **Step 3: Implementar**

Em `plRender()`, troque o trecho do link WhatsApp:

```js
        ${wa ? `<a class="btn btn-sm plWhats" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(plMensagemWhats(l, consultor))}" style="width:auto">WhatsApp</a>` : ''}
```
por:
```js
        ${wa ? `<a class="btn btn-sm plWhats" target="_blank" rel="noopener" data-aba="${escapeHtml(l.aba)}" data-lead-id="${id}" href="https://wa.me/${wa}?text=${encodeURIComponent(plMensagemWhats(l, consultor))}" style="width:auto">WhatsApp</a>` : ''}
```

No listener de `#plLista`, como **primeiras linhas** do corpo da função:

```js
  // 02/10/2026 (seção 68): todo WhatsApp enviado daqui também conta como contato (o 1º contato é o mais antigo)
  const pw = ev.target.closest('.plWhats');
  if(pw){ vlRegistrar(pw.dataset.aba, pw.dataset.leadId, 'whatsapp'); return; }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_velocidade_lead.js && node test_monitoramento_leads.js`
Expected: `0 falharam` nos dois.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_velocidade_lead.js
git commit -m "feat(painel): WhatsApp de Meus leads registra contato e aviso de lead novo (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Parte C — Mesa do Supervisor

### Task 6: Funções puras da Mesa (`mesa*`)

**Files:**
- Modify: `_template.html`. Bloco novo no **fim do último `<script>`**, logo antes do `</script>` que precede `</body>`.
- Create: `test_mesa_supervisor.js`

**Interfaces:**
- Consumes: as funções `vl*` do Task 3; `ppNivel(dias)`, `ppDiasUteisDesde(ini, ref)`, `PP_FAIXAS`, `plNormStatus`.
- Produces:
  - `canSeeMesa() → bool`
  - `mesaDiaSP(v) → 'YYYY-MM-DD'|null`
  - `mesaMediana(nums) → number|null`
  - `mesaNoPrazo(leads, agoraMs, cfg) → number|null` (0..1)
  - `mesaNivelPedido(item, hoje) → 'minimo'|'medio'|'maximo'|null`
  - `mesaKpis(leads, pend, agoraMs, cfg, hoje) → {novosHoje, noPrazoHoje, noPrazo7, medianaMin, esperando, semDono, retornosAtrasados, pedidosVermelhos}`
  - `mesaSemaforo(dados:{leads,pend,lig,vendas,metas}, agoraMs, cfg, hoje) → [linha]`, onde `linha = {chave, profileId, nome, semLogin, leads, esperando, retornos, esfriando, propostas, pedidos, lig, mediaLig, vendas, meta, noPrazo7, cor, nPend}`
  - `mesaTextoCobranca(linha) → string`
  - `mesaVelocidadeConversao(leads, aba, cfg) → [{faixa, rotulo, leads, vendas, conversao}]`
  - `mesaAtrasoPlanilhaMin(leads, agoraMs) → number|null`

- [ ] **Step 1: Escrever o teste (falha)**

Crie `test_mesa_supervisor.js` com o mesmo cabeçalho do `test_velocidade_lead.js` do Task 3: tudo até `const testScript = \`` inclusive, trocando só as duas linhas de comentário iniciais por:

```js
// Testa a Mesa do Supervisor (02/10/2026) — REGRAS_NEGOCIO.md §68.
// Spec: docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md
```

Em seguida, o corpo:

```js
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const sp = (s) => Date.parse(s + '-03:00');
  const iso = (s) => new Date(sp(s)).toISOString();
  const cfg = vlCfg(null);
  const AGORA = sp('2026-10-05T10:00:00'), HOJE = '2026-10-05';
  const LD = (id, extra) => Object.assign({ aba: 'OUTUBRO', lead_id: id, consultor: 'Caio', profile_id: 'p-caio', criado_em_lead: iso('2026-10-05T09:00:00'), primeira_sync_em: iso('2026-10-05T09:06:00'), categoria: 'andamento', converteu: false, primeiro_clique: null, canal_clique: null, primeira_ligacao: null }, extra || {});

  // ==== TASK 6: funções puras ====
  eq(mesaMediana([3, 1, 2]), 2, 'mediana ímpar');
  eq(mesaMediana([1, 2, 3, 4]), 2.5, 'mediana par');
  eq(mesaMediana([]), null, 'mediana vazia');
  eq(mesaDiaSP('2026-10-05T02:00:00Z'), '2026-10-04', 'dia em SP (madrugada UTC = véspera)');
  eq(mesaNivelPedido({ desde: iso('2026-09-30T10:00:00') }, HOJE), 'minimo', 'pedido: 3 dias úteis = mínimo');
  eq(mesaNivelPedido({ desde: iso('2026-10-02T10:00:00') }, HOJE), null, 'pedido: 1 dia útil = fora');

  const leads = [
    LD('rapido', { primeiro_clique: iso('2026-10-05T09:04:00') }),          // 4 min: no prazo
    LD('lento', { primeira_ligacao: iso('2026-10-05T09:40:00') }),          // 40 min: fora
    LD('esperandoVerm', { criado_em_lead: iso('2026-10-05T09:30:00') }),    // 30 min sem contato: conta como fora
    LD('esperandoVerde', { criado_em_lead: iso('2026-10-05T09:58:00') }),   // 2 min: ainda não entra no prazo
    LD('semDono', { consultor: null, profile_id: null, criado_em_lead: iso('2026-10-05T09:50:00') }),
    LD('antigo', { criado_em_lead: iso('2026-09-20T09:00:00'), categoria: 'convertido', primeiro_clique: iso('2026-09-21T09:00:00') }),
  ];
  eq(mesaNoPrazo(leads.slice(0, 4), AGORA, cfg), 1 / 3, 'no prazo: 1 de 3 (rápido; lento e esperando vermelho fora; verde ainda não conta)');
  eq(mesaNoPrazo([], AGORA, cfg), null, 'sem base: null');

  const pend = [
    { profile_id: 'p-caio', nome: 'Caio Teste', tipo: 'consultor' },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'consultor' },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'consultor' },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'retorno_atrasado', ref: 'l9', titulo: 'Lead Teste 9', desde: iso('2026-10-04T00:00:00') },
    { profile_id: 'p-luria', nome: 'Luria Teste', tipo: 'proposta_parada', ref: 'pr1', titulo: 'Empresa Teste', desde: iso('2026-09-20T10:00:00') },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'pedido_risco', ref: 'N1', titulo: 'Cliente Teste', desde: iso('2026-09-15T10:00:00'), extra: { etapa: 'ENTREGA (NEOCRM)' } },
    { profile_id: 'p-zeca', nome: 'Zeca Teste', tipo: 'pedido_risco', ref: 'N2', titulo: 'Cliente Teste 2', desde: iso('2026-10-02T10:00:00'), extra: { etapa: 'ENTREGA (NEOCRM)' } },
  ];
  const k = mesaKpis(leads, pend, AGORA, cfg, HOJE);
  eq(k.novosHoje, 5, 'KPI: leads novos hoje');
  eq(k.esperando, 3, 'KPI: esperando agora (verm, verde e sem dono)');
  eq(k.semDono, 1, 'KPI: sem dono');
  eq(k.retornosAtrasados, 1, 'KPI: retornos atrasados');
  eq(k.pedidosVermelhos, 1, 'KPI: pedidos 🔴 (N1 com 10+ dias úteis)');
  eq(k.medianaMin, 22, 'KPI: mediana até o 1º contato (4 e 40 min)');

  const lig = [{ profile_id: 'p-caio', lig_lead: 30, lig_total: 40, ultima: iso('2026-10-05T09:59:00') }, { profile_id: 'p-luria', lig_lead: 10, lig_total: 12, ultima: iso('2026-10-05T09:00:00') }];
  const vendas = [{ profile_id: 'p-caio', pedidos: 3, receita: 900 }, { profile_id: 'p-admin', pedidos: 1, receita: 100 }];
  const metas = [{ profile_id: 'p-caio', meta_receita: 3000 }];
  const sem = mesaSemaforo({ leads, pend, lig, vendas, metas }, AGORA, cfg, HOJE);
  eq(sem.map(r => r.nome), ['Caio Teste', 'Zeca Teste', 'Luria Teste'], 'ordem: vermelhos (Caio por lead 30 min; Zeca por pedido 🔴) por nº de pendências, depois amarelo');
  eq(sem.map(r => r.cor), ['vermelho', 'vermelho', 'amarelo'], 'cores das linhas');
  const caio = sem[0];
  eq(caio.esperando.length, 2, 'Caio: 2 esperando');
  eq(caio.lig.lig_lead, 30, 'Caio: ligações para lead hoje');
  eq(caio.mediaLig, 20, 'média de ligações da equipe (30 e 10)');
  eq([caio.vendas.receita, caio.meta], [900, 3000], 'Caio: vendas e meta do mês');
  assert(!sem.some(r => r.profileId === 'p-admin'), 'vendas de quem não é consultor não cria linha');
  eq(sem.find(r => r.nome === 'Zeca Teste').pedidos.map(p => p.ref), ['N1'], 'pedido com 1 dia útil não entra');
  const luria = sem.find(r => r.nome === 'Luria Teste');
  eq(luria.cor, 'amarelo', 'retorno atrasado de ontem (1 dia) = amarelo');
  const verdeSem = mesaSemaforo({ leads: [], pend: [{ profile_id: 'p-x', nome: 'Xis Teste', tipo: 'consultor' }], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  eq([verdeSem[0].cor, verdeSem[0].nPend], ['verde', 0], 'consultor sem pendência aparece verde');
  const semLogin = mesaSemaforo({ leads: [LD('s1', { consultor: 'Beltrano', profile_id: null, criado_em_lead: iso('2026-10-05T09:00:00') })], pend: [], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  assert(semLogin[0].semLogin && semLogin[0].nome === 'Beltrano', 'nome da planilha sem perfil vira linha "sem login"');
  const retVelho = mesaSemaforo({ leads: [], pend: [{ profile_id: 'p-y', nome: 'Ypsilon Teste', tipo: 'retorno_atrasado', desde: iso('2026-10-02T00:00:00') }], lig: [], vendas: [], metas: [] }, AGORA, cfg, HOJE);
  eq(retVelho[0].cor, 'vermelho', 'retorno atrasado há 2+ dias = vermelho');

  const txt = mesaTextoCobranca(caio);
  assert(txt.startsWith('Oi, Caio!') && txt.includes('2 leads esperando') && txt.includes('30 min'), 'texto de cobrança com o pior relógio (lead das 09:30): ' + txt);
  eq(mesaTextoCobranca(verdeSem[0]), '', 'linha verde não tem cobrança');

  const vc = mesaVelocidadeConversao([
    LD('a', { primeiro_clique: iso('2026-10-05T09:03:00'), categoria: 'convertido' }),
    LD('b', { primeiro_clique: iso('2026-10-05T09:03:00') }),
    LD('c', { categoria: 'perdido' }),
    LD('d', { aba: 'SETEMBRO', primeiro_clique: iso('2026-10-05T09:03:00') }),
  ], 'OUTUBRO', cfg);
  eq(vc.map(r => r.faixa), ['ate5', '5a15', '15a60', '1a4h', 'mais4h', 'sem'], 'todas as faixas, na ordem');
  eq([vc[0].leads, vc[0].vendas, vc[0].conversao], [2, 1, 0.5], 'faixa até 5: 2 leads, 1 venda, 50%');
  eq([vc[5].leads, vc[1].conversao], [1, null], 'sem contato registrado: 1; faixa vazia: conversão null');

  eq(mesaAtrasoPlanilhaMin(leads, AGORA), 6, 'atraso da planilha: mediana de primeira_sync_em - criado_em_lead');
  eq(mesaAtrasoPlanilhaMin([LD('z', { primeira_sync_em: null })], AGORA), null, 'sem primeira_sync_em: null');

  // ==== mais testes entram aqui ====

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

Run: `node test_mesa_supervisor.js`
Expected: `FALHA: ReferenceError: mesaMediana is not defined`

- [ ] **Step 3: Implementar**

No fim do último `<script>`:

```js
/* ============ MESA DO SUPERVISOR — 02/10/2026, REGRAS_NEGOCIO.md §68 ============
   Admin/supervisor: pendências da equipe numa tela só (leads esperando, retornos, propostas, pedidos,
   ligações e vendas) e cobrança em 1 clique. Regras de tempo: funções vl* (minutos úteis). */
function canSeeMesa(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function mesaDiaSP(v){ const ms = vlMs(v); return ms === null ? null : vlPartesSP(ms).dia; }
function mesaMediana(nums){
  if(!nums || !nums.length) return null;
  const s = nums.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// "No prazo" = atendidos em até amarelo_min minutos úteis. Base: quem já teve contato + quem ainda espera e já estourou.
function mesaNoPrazo(leads, agoraMs, cfg){
  let dentro = 0, base = 0;
  (leads || []).forEach(l => {
    const ini = vlMs(l.criado_em_lead);
    if(ini === null) return;
    const c = vlPrimeiroContatoMs(l);
    if(c !== null){ base++; if(vlMinutosUteis(ini, c, cfg) <= cfg.amarelo_min) dentro++; return; }
    if(vlEsperando(l) && vlMinutosUteis(ini, agoraMs, cfg) > cfg.amarelo_min) base++;
  });
  return base ? dentro / base : null;
}
// Nível do pedido igual ao Pedidos Parados (dias úteis desde a entrada na etapa; < 3 = fora).
function mesaNivelPedido(item, hoje){ const d = mesaDiaSP(item.desde); return d ? ppNivel(ppDiasUteisDesde(d, hoje)) : null; }
function mesaDesde(leads, agoraMs, dias){ return (leads || []).filter(l => (vlMs(l.criado_em_lead) || 0) >= agoraMs - dias * 86400000); }
function mesaKpis(leads, pend, agoraMs, cfg, hoje){
  const de7 = mesaDesde(leads, agoraMs, 7);
  const deHoje = (leads || []).filter(l => mesaDiaSP(l.criado_em_lead) === hoje);
  const tempos = de7.map(l => { const i = vlMs(l.criado_em_lead), c = vlPrimeiroContatoMs(l); return i !== null && c !== null ? vlMinutosUteis(i, c, cfg) : null; }).filter(v => v !== null);
  const esperando = vlPendentes(mesaDesde(leads, agoraMs, cfg.janela_dias), agoraMs, cfg).filter(x => x.cor !== 'aguardando');
  const p = pend || [];
  return {
    novosHoje: deHoje.length,
    noPrazoHoje: mesaNoPrazo(deHoje, agoraMs, cfg),
    noPrazo7: mesaNoPrazo(de7, agoraMs, cfg),
    medianaMin: mesaMediana(tempos),
    esperando: esperando.length,
    semDono: esperando.filter(x => !x.lead.consultor).length,
    retornosAtrasados: p.filter(x => x.tipo === 'retorno_atrasado').length,
    pedidosVermelhos: p.filter(x => x.tipo === 'pedido_risco' && mesaNivelPedido(x, hoje) === 'maximo').length,
  };
}
const MESA_ORDEM_COR = { vermelho: 0, amarelo: 1, verde: 2 };
function mesaSemaforo(dados, agoraMs, cfg, hoje){
  const linhas = new Map();
  const linha = (profileId, nome) => {
    const k = profileId ? 'p:' + profileId : 'n:' + plNormStatus(nome);
    if(!linhas.has(k)) linhas.set(k, { chave: k, profileId: profileId || null, nome: nome || '(sem nome)', semLogin: !profileId,
      leads: [], esperando: [], retornos: [], esfriando: [], propostas: [], pedidos: [], lig: null, mediaLig: null, vendas: null, meta: null });
    return linhas.get(k);
  };
  (dados.pend || []).forEach(x => {
    const r = linha(x.profile_id, x.nome);
    if(x.tipo === 'retorno_atrasado') r.retornos.push(x);
    else if(x.tipo === 'lead_esfriando') r.esfriando.push(x);
    else if(x.tipo === 'proposta_parada') r.propostas.push(x);
    else if(x.tipo === 'pedido_risco'){ const nivel = mesaNivelPedido(x, hoje); if(nivel) r.pedidos.push(Object.assign({}, x, { nivel })); }
  });
  (dados.leads || []).forEach(l => { if(l.consultor) linha(l.profile_id, l.consultor).leads.push(l); });   // sem dono fica só na fila da equipe
  const ligPor = new Map((dados.lig || []).map(x => [x.profile_id, x]));
  const comLig = (dados.lig || []).filter(x => Number(x.lig_lead) > 0);
  const mediaLig = comLig.length ? comLig.reduce((s, x) => s + Number(x.lig_lead), 0) / comLig.length : null;
  const vendasPor = new Map((dados.vendas || []).map(x => [x.profile_id, x]));
  const metaPor = new Map((dados.metas || []).map(x => [x.profile_id, Number(x.meta_receita) || 0]));
  const diaMs = (d) => Date.parse(d + 'T00:00:00Z');
  return [...linhas.values()].map(r => {
    r.esperando = vlPendentes(mesaDesde(r.leads, agoraMs, cfg.janela_dias), agoraMs, cfg).filter(x => x.cor !== 'aguardando');
    const de7 = mesaDesde(r.leads, agoraMs, 7);
    r.noPrazo7 = de7.length >= 5 ? mesaNoPrazo(de7, agoraMs, cfg) : null;
    if(r.profileId){ r.lig = ligPor.get(r.profileId) || null; r.vendas = vendasPor.get(r.profileId) || null; r.meta = metaPor.has(r.profileId) ? metaPor.get(r.profileId) : null; }
    r.mediaLig = mediaLig;
    r.nPend = r.esperando.length + r.retornos.length + r.esfriando.length + r.propostas.length + r.pedidos.length;
    const retornoVelho = r.retornos.some(x => { const d = mesaDiaSP(x.desde); return d && (diaMs(hoje) - diaMs(d)) / 86400000 >= 2; });
    r.cor = (r.esperando.some(x => x.cor === 'vermelho') || r.pedidos.some(p => p.nivel === 'maximo') || retornoVelho) ? 'vermelho' : (r.nPend ? 'amarelo' : 'verde');
    return r;
  }).sort((a, b) => (MESA_ORDEM_COR[a.cor] - MESA_ORDEM_COR[b.cor]) || (b.nPend - a.nPend) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
function mesaTextoCobranca(r){
  const pl = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
  const partes = [];
  if(r.esperando.length) partes.push(pl(r.esperando.length, 'lead esperando', 'leads esperando') + ' (o mais antigo há ' + vlFmtMin(Math.max(...r.esperando.map(x => x.min))) + ')');
  if(r.retornos.length) partes.push(pl(r.retornos.length, 'retorno atrasado', 'retornos atrasados'));
  if(r.esfriando.length) partes.push(pl(r.esfriando.length, 'lead esfriando', 'leads esfriando') + ' (5+ dias sem contato)');
  if(r.propostas.length) partes.push(pl(r.propostas.length, 'proposta sem retorno', 'propostas sem retorno') + ' há mais de 7 dias');
  if(r.pedidos.length) partes.push(pl(r.pedidos.length, 'pedido parado', 'pedidos parados'));
  if(!partes.length) return '';
  const nome = String(r.nome || '').trim().split(/\s+/)[0] || '';
  return `Oi${nome ? ', ' + nome : ''}! Pendências de hoje: ${partes.join(', ')}. Bora zerar?`;
}
function mesaVelocidadeConversao(leads, aba, cfg){
  const linhas = VL_FAIXAS.map(f => ({ faixa: f[0], rotulo: f[1], leads: 0, vendas: 0 })).concat([{ faixa: 'sem', rotulo: 'sem contato registrado', leads: 0, vendas: 0 }]);
  (leads || []).filter(l => !aba || l.aba === aba).forEach(l => {
    const r = linhas.find(x => x.faixa === vlFaixa(l, cfg));
    r.leads++;
    if(l.categoria === 'convertido') r.vendas++;
  });
  return linhas.map(r => Object.assign(r, { conversao: r.leads ? r.vendas / r.leads : null }));
}
function mesaAtrasoPlanilhaMin(leads, agoraMs){
  const v = mesaDesde(leads, agoraMs, 7).map(l => { const a = vlMs(l.primeira_sync_em), b = vlMs(l.criado_em_lead); return a !== null && b !== null && a >= b ? (a - b) / 60000 : null; }).filter(x => x !== null);
  return mesaMediana(v);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_mesa_supervisor.js`
Expected: `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_mesa_supervisor.js
git commit -m "feat(painel): regras da Mesa do Supervisor (KPIs, semáforo, cobrança, velocidade x conversão) (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Aba "Mesa do Supervisor" — botão, painel, carga, KPIs, fila e permissões

**Files:**
- Modify: `_template.html`:
  - botão em `nav#tabsNav`, logo depois do botão `data-tab="producao"`;
  - `<section id="panel-mesa">` logo antes de `<section class="panel" id="panel-producao">`;
  - `enterApp()`;
  - o listener de `#tabsNav`;
  - o JS depois das funções do Task 6.
- Test: `test_mesa_supervisor.js`

**Interfaces:**
- Consumes: as funções do Task 6, `ppSeguro`, `fetchAllRows`, `escapeHtml` e as RPCs `mesa_leads_relogio`, `mesa_pendencias`, `mesa_ligacoes_hoje`, `mesa_vendas_mes`, mais as tabelas `metas_consultor` e `config`.
- Produces:
  - `mesaEstado`
  - `mesaAgora() → ms`
  - `loadMesa(forcar) → Promise`
  - `mesaRender()`
  - `mesaResetar()`
  - `mesaAplicarPermissao()`

- [ ] **Step 1: Escrever o teste (falha)**

Troque `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 7: aba, carga, KPIs, fila, permissões ====
  const nowReal = Date.now;
  Date.now = () => AGORA;
  window.__rpcRespostas.mesa_leads_relogio = { data: leads, error: null };
  window.__rpcRespostas.mesa_pendencias = { data: pend, error: null };
  window.__rpcRespostas.mesa_ligacoes_hoje = { data: lig, error: null };
  window.__rpcRespostas.mesa_vendas_mes = { data: vendas, error: null };
  window.__tabelas.metas_consultor = [{ profile_id: 'p-caio', mes: '2026-10-01', meta_receita: 3000 }];
  window.__tabelas.config = [];

  // consultor: sem botão, painel vazio, nenhuma RPC da Mesa
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  mesaAplicarPermissao();
  assert(document.getElementById('tabBtnMesa').style.display === 'none', 'consultor não vê o botão da Mesa');
  window.__rpcCalls.length = 0;
  await loadMesa(true);
  assert(!window.__rpcCalls.some(c => /^mesa_/.test(c.nome)), 'consultor não dispara RPC da Mesa');
  assert(document.getElementById('mesaSemaforoTbody').innerHTML === '', 'painel vazio para o consultor');

  // supervisor (troca de login sem recarregar): botão aparece e a carga funciona
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  mesaAplicarPermissao();
  assert(document.getElementById('tabBtnMesa').style.display !== 'none', 'supervisor vê o botão da Mesa');
  document.querySelector('#tabsNav button[data-tab="mesa"]').click();
  await espera(60);
  assert(document.getElementById('panel-mesa').classList.contains('active'), 'clique abre o painel da Mesa');
  const cDesde = window.__rpcCalls.find(c => c.nome === 'mesa_leads_relogio');
  eq(cDesde && cDesde.args.p_desde, '2026-09-01T00:00:00-03:00', 'busca desde o 1º dia do mês anterior (SP)');
  eq((window.__rpcCalls.find(c => c.nome === 'mesa_pendencias') || {}).args, { p_ref: HOJE }, 'pendências de hoje (SP)');
  eq((window.__rpcCalls.find(c => c.nome === 'mesa_vendas_mes') || {}).args, { p_mes: '2026-10-01' }, 'vendas do mês');
  const kTxt = document.getElementById('mesaKpis').textContent;
  assert(kTxt.includes('Leads novos hoje') && kTxt.includes('5'), 'KPI de leads novos');
  assert(kTxt.includes('33,3%'), 'KPI no prazo 7 d');
  assert(kTxt.includes('22 min'), 'KPI mediana');
  eq([...document.querySelectorAll('#mesaFila .vlRow')].map(r => r.dataset.leadId), ['esperandoVerm', 'semDono', 'esperandoVerde'], 'fila da equipe: vermelho, amarelo, verde');
  assert(document.querySelector('#mesaFila [data-lead-id="semDono"]').textContent.includes('sem dono'), 'sem dono sinalizado');
  assert(!document.getElementById('mesaFila').innerHTML.includes('5519900'), 'Mesa não mostra telefone');
  assert(document.getElementById('mesaAtraso').textContent.includes('6 min'), 'atraso da planilha');
  assert(!/NaN|undefined/.test(document.getElementById('panel-mesa').textContent), 'nada de NaN/undefined');

  // um bloco que falha não derruba os outros
  window.__rpcRespostas.mesa_pendencias = { data: null, error: { message: 'x' } };
  await loadMesa(true);
  assert(document.getElementById('mesaSemaforoTbody').textContent.includes('Não foi possível carregar'), 'semáforo avisa a falha');
  assert(document.querySelectorAll('#mesaFila .vlRow').length === 3, 'fila continua aparecendo');
  window.__rpcRespostas.mesa_pendencias = { data: pend, error: null };

  // reset ao trocar para consultor
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  mesaAplicarPermissao();
  assert(document.getElementById('mesaFila').innerHTML === '' && document.getElementById('mesaKpis').innerHTML === '', 'troca para consultor limpa a Mesa');
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  mesaAplicarPermissao();
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_mesa_supervisor.js`
Expected: `FALHA: ReferenceError: mesaAplicarPermissao is not defined`

- [ ] **Step 3: Implementar**

**Botão** (logo depois do botão `data-tab="producao"`, ainda no grupo "Visão geral"):

```html
      <button data-tab="mesa" id="tabBtnMesa" style="display:none" data-sub="Pendências da equipe e cobrança em 1 clique"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 13h6"/><circle cx="17" cy="15" r="2"/></svg><span class="sbLabel">Mesa do Supervisor</span></button>
```

**Painel** (logo antes de `<section class="panel" id="panel-producao">`):

```html
    <!-- MESA DO SUPERVISOR (02/10/2026, seção 68) — admin/supervisor: pendências da equipe e cobrança em 1 clique.
         Para o consultor o botão some e o painel fica vazio (mesaResetar); a proteção real são as RPCs. -->
    <section class="panel" id="panel-mesa">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Mesa do Supervisor</h3>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span id="mesaStatus" style="font-size:12px;color:var(--muted)"></span>
            <button type="button" class="btn btn-sm btn-outline" id="btnMesaAtualizar" style="width:auto">Atualizar</button>
          </div>
        </div>
        <p class="desc" id="mesaAtraso"></p>
        <div class="kpiGrid" id="mesaKpis"></div>
      </div>
      <div class="card">
        <h3>Atender agora — equipe</h3>
        <p class="desc">Leads que ainda não receberam o 1º contato (relógio em minutos úteis). Lead sem dono precisa ser atribuído na planilha.</p>
        <div id="mesaFila"></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h3 style="margin:0">Semáforo por consultor</h3>
          <button type="button" class="btn btn-sm btn-outline" id="btnMesaExportar" style="width:auto">Exportar Excel</button>
        </div>
        <p class="desc">Clique numa linha para ver os itens. "Cobrar" copia a mensagem e abre o WhatsApp para você escolher o contato.</p>
        <div class="mlTabelaWrap"><table class="tbl">
          <thead><tr><th></th><th>Consultor</th><th>Esperando agora</th><th>No prazo 7 d</th><th>Retornos atrasados</th><th>Leads esfriando</th><th>Propostas paradas</th><th>Pedidos em risco</th><th>Ligações hoje</th><th>Vendas no mês / meta</th><th></th></tr></thead>
          <tbody id="mesaSemaforoTbody"></tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Velocidade × conversão</h3>
        <p class="desc">Conversão dos leads do mês pelo tempo até o 1º contato registrado (clique no painel ou ligação).</p>
        <div class="filterPills" id="mesaVelPills" style="margin:10px 0"></div>
        <div id="mesaVelTabela"></div>
        <p class="desc">Amostra pequena: só leia diferenças com 30+ leads por faixa.</p>
      </div>
    </section>
```

**`enterApp()`**: depois da linha `document.getElementById('tabBtnFechamento').style.display = …;`, acrescente:

```js
    // 02/10/2026 (seção 68): Mesa do Supervisor — só admin/supervisor
    mesaAplicarPermissao();
```

**Listener de `#tabsNav`**: depois de `if(btn.dataset.tab === 'config') carregarEmailConfigStatus();`, acrescente:

```js
  if(btn.dataset.tab === 'mesa') loadMesa(true);
```

**JS** (depois das funções do Task 6):

```js
const mesaEstado = { geracao: 0, cfg: vlCfg(null), dados: null, erros: {}, aba: null, aberto: null, timer: null, agora: 0, hoje: '' };
function mesaAgora(){ return Date.now(); }
function mesaResetar(){
  mesaEstado.geracao++;
  clearInterval(mesaEstado.timer); mesaEstado.timer = null;
  Object.assign(mesaEstado, { dados: null, erros: {}, aba: null, aberto: null });
  ['mesaKpis', 'mesaFila', 'mesaSemaforoTbody', 'mesaVelPills', 'mesaVelTabela', 'mesaAtraso', 'mesaStatus'].forEach(id => { document.getElementById(id).innerHTML = ''; });
}
function mesaAplicarPermissao(){
  const vis = canSeeMesa();
  document.getElementById('tabBtnMesa').style.display = vis ? 'inline-block' : 'none';
  if(!vis) mesaResetar();
}
async function loadMesa(forcar){
  if(!canSeeMesa()) return;
  const geracao = ++mesaEstado.geracao;
  const agora = mesaAgora(), hoje = vlPartesSP(agora).dia, ym = hoje.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const mesAnterior = (m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0')) + '-01';
  document.getElementById('mesaStatus').textContent = 'Carregando…';
  const [lds, pend, lig, ven, met, cfg] = await Promise.all([
    ppSeguro(() => fetchAllRows(() => sb.rpc('mesa_leads_relogio', { p_desde: mesAnterior + 'T00:00:00-03:00' }))),
    ppSeguro(() => fetchAllRows(() => sb.rpc('mesa_pendencias', { p_ref: hoje }))),
    ppSeguro(() => sb.rpc('mesa_ligacoes_hoje', { p_ref: hoje })),
    ppSeguro(() => sb.rpc('mesa_vendas_mes', { p_mes: ym + '-01' })),
    ppSeguro(() => sb.from('metas_consultor').select('profile_id,mes,meta_receita').eq('mes', ym + '-01')),
    ppSeguro(() => sb.from('config').select('chave,valor').eq('chave', 'velocidade_lead').maybeSingle()),
  ]);
  if(geracao !== mesaEstado.geracao || !canSeeMesa()) return;
  const ok = r => r && !r.error;
  mesaEstado.cfg = vlCfg(ok(cfg) && cfg.data ? cfg.data.valor : null);
  mesaEstado.erros = { leads: !ok(lds), pend: !ok(pend), lig: !ok(lig), vendas: !ok(ven), metas: !ok(met) };
  Object.keys(mesaEstado.erros).forEach(k => { if(mesaEstado.erros[k]) console.error('Mesa: falha em ' + k); });
  mesaEstado.dados = {
    leads: ok(lds) ? (lds.data || []) : [], pend: ok(pend) ? (pend.data || []) : [],
    lig: ok(lig) ? (lig.data || []) : [], vendas: ok(ven) ? (ven.data || []) : [], metas: ok(met) ? (met.data || []) : [],
  };
  mesaEstado.agora = agora; mesaEstado.hoje = hoje;
  document.getElementById('mesaStatus').textContent = 'Atualizado às ' + new Date(agora - 3 * 3600000).toISOString().slice(11, 16);
  mesaRender();
  clearInterval(mesaEstado.timer);
  mesaEstado.timer = setInterval(() => {
    const ativo = document.getElementById('panel-mesa').classList.contains('active');
    if(ativo && document.visibilityState === 'visible') loadMesa(false).catch(err => console.error(err));
  }, 120000);
}
function mesaFmtPct(v){ return v === null || v === undefined ? '—' : fmtPctConversao(v); }
function mesaKpiHtml(rotulo, valor, sub){
  return `<div class="kpiCard"><div class="kpiLabel">${escapeHtml(rotulo)}</div><div class="kpiValue">${escapeHtml(String(valor))}</div>${sub ? `<div class="kpiSub">${escapeHtml(sub)}</div>` : ''}</div>`;
}
function mesaRender(){
  const d = mesaEstado.dados;
  if(!d) return;
  const cfg = mesaEstado.cfg, agora = mesaEstado.agora, hoje = mesaEstado.hoje;
  // atraso da planilha
  const atraso = mesaAtrasoPlanilhaMin(d.leads, agora);
  const elA = document.getElementById('mesaAtraso');
  elA.textContent = atraso === null ? '' : 'Leads chegam ao painel em ~' + vlFmtMin(atraso) + ' depois de entrar (mediana de 7 dias).' + (atraso > 15 ? ' O atraso está antes do consultor (planilha/integração).' : '');
  elA.style.color = atraso !== null && atraso > 15 ? 'var(--c-sinal)' : '';
  // KPIs
  const k = mesaKpis(d.leads, d.pend, agora, cfg, hoje);
  document.getElementById('mesaKpis').innerHTML = mesaEstado.erros.leads ? '<p class="desc">Não foi possível carregar os leads agora.</p>' : [
    mesaKpiHtml('Leads novos hoje', k.novosHoje),
    mesaKpiHtml('No prazo (até ' + cfg.amarelo_min + ' min)', mesaFmtPct(k.noPrazo7), 'hoje: ' + mesaFmtPct(k.noPrazoHoje) + ' · 7 dias acima'),
    mesaKpiHtml('Mediana até o 1º contato', k.medianaMin === null ? '—' : vlFmtMin(k.medianaMin), '7 dias, minutos úteis'),
    mesaKpiHtml('Esperando agora', k.esperando, k.semDono ? k.semDono + ' sem dono' : ''),
    mesaKpiHtml('Retornos atrasados', mesaEstado.erros.pend ? '—' : k.retornosAtrasados),
    mesaKpiHtml('Pedidos em risco 🔴', mesaEstado.erros.pend ? '—' : k.pedidosVermelhos),
  ].join('');
  // fila da equipe (sem telefone)
  const fila = vlPendentes(mesaDesde(d.leads, agora, cfg.janela_dias), agora, cfg).filter(x => x.cor !== 'aguardando');
  const classe = { vermelho: 'retornoBadge atrasado', amarelo: 'retornoBadge hoje', verde: 'retornoBadge futuro' };
  document.getElementById('mesaFila').innerHTML = mesaEstado.erros.leads ? '<p class="desc">Não foi possível carregar agora.</p>'
    : (fila.length ? fila.map(x => `<div class="retornoLeadRow vlRow" data-lead-id="${escapeHtml(x.lead.lead_id)}">
        <div class="retornoLeadInfo"><strong>${escapeHtml(x.lead.consultor || 'Sem dono')}</strong>
          <span class="retornoLeadSub">${escapeHtml(conversaoAbaRotulo(x.lead.aba))} · entrou ${escapeHtml(mlFmtDiaHora(x.lead.criado_em_lead))}</span></div>
        <div class="retornoLeadAcoes">${x.lead.consultor ? '' : '<span class="badge">sem dono — atribua na planilha</span>'}
          <span class="${classe[x.cor]} vlRelogio">${escapeHtml(vlFmtMin(x.min))}</span></div></div>`).join('')
      : '<p class="desc">Nenhum lead esperando agora.</p>');
  mesaRenderSemaforo();
  mesaRenderVelocidade();
}
// Semáforo e Velocidade × conversão: implementados no Task 8; aqui só o mínimo para a carga.
function mesaRenderSemaforo(){
  const tb = document.getElementById('mesaSemaforoTbody');
  if(mesaEstado.erros.pend){ tb.innerHTML = '<tr><td colspan="11">Não foi possível carregar as pendências agora.</td></tr>'; return; }
  tb.innerHTML = '';
}
function mesaRenderVelocidade(){ document.getElementById('mesaVelTabela').innerHTML = ''; }
document.getElementById('btnMesaAtualizar').addEventListener('click', () => loadMesa(true).catch(err => console.error(err)));
```

Confira antes de usar: `mlFmtDiaHora` e `conversaoAbaRotulo` já existem no template (`grep -n "function mlFmtDiaHora\|function conversaoAbaRotulo" _template.html`). Se algum não existir, pare e avise.

- [ ] **Step 4: Rodar e ver passar**

Em `test_reorganizacao_abas.js`, a lista `ordemEsperada` (seção "8) ordem e rótulos das abas") precisa da aba nova. Troque:
```js
  const ordemEsperada = ['producao','conversao','busca','proposta','funil','pedidosparados','biometria','config','basedados','movimentacao','consultores','fechamento'];
```
por:
```js
  // NOTA (02/10/2026): incluída "mesa" (Mesa do Supervisor, só admin/supervisor), no grupo Visão geral logo depois de "producao" (seção 68).
  const ordemEsperada = ['producao','mesa','conversao','busca','proposta','funil','pedidosparados','biometria','config','basedados','movimentacao','consultores','fechamento'];
```

Run: `node test_mesa_supervisor.js && node test_reorganizacao_abas.js`
Expected: `0 falharam` nos dois.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_mesa_supervisor.js test_reorganizacao_abas.js
git commit -m "feat(painel): aba Mesa do Supervisor — carga, KPIs, fila da equipe e permissões (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: Semáforo (linhas, expandir, Cobrar, Excel) + Velocidade × conversão

**Files:**
- Modify: `_template.html`. Substituir as funções provisórias `mesaRenderSemaforo` e `mesaRenderVelocidade` do Task 7 e acrescentar os listeners.
- Test: `test_mesa_supervisor.js`

**Interfaces:**
- Consumes: `mesaSemaforo`, `mesaTextoCobranca`, `mesaVelocidadeConversao`, `mesaEstado`, `conversaoAbasDisponiveis(leads) → [{aba, n}]`, `conversaoAbaRotulo(aba)`, `mlBaixarXlsx(nome, [{nome, linhas}])`, `fmtBRL`, `ppFmtDia`, `PP_NIVEL_ROTULO`.
- Produces: `mesaLinhasAtuais() → [linha]`; o clique em `[data-mesa-linha]` alterna a linha expandida; o clique em `[data-mesa-cobrar]` copia o texto e abre `wa.me`; `#btnMesaExportar` gera `MesaSupervisor_<hoje>.xlsx`.

- [ ] **Step 1: Escrever o teste (falha)**

Troque `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 8: semáforo, expandir, cobrar, Excel, velocidade × conversão ====
  Date.now = () => AGORA;
  window.__abertos = [];
  window.open = (u) => { window.__abertos.push(u); return null; };
  window.__copiados = [];
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copiados.push(t); return Promise.resolve(); } }, configurable: true });
  window.__xlsx = [];
  window.XLSX.writeFile = (wb, nome) => window.__xlsx.push({ wb, nome });
  await loadMesa(true);
  const trs = [...document.querySelectorAll('#mesaSemaforoTbody tr[data-mesa-linha]')];
  eq(trs.map(t => t.querySelector('.mesaNome').textContent.trim()), ['Caio Teste', 'Zeca Teste', 'Luria Teste'], 'linhas na ordem do semáforo');
  assert(trs[0].textContent.includes('2') && trs[0].textContent.includes('30 min'), 'Caio: 2 esperando e o pior relógio (30 min)');
  assert(trs[0].textContent.includes('30') && trs[0].textContent.includes('média 20'), 'Caio: ligações hoje x média');
  assert(trs[0].textContent.includes('R$') && trs[0].textContent.includes('30,0%'), 'Caio: vendas x meta (900/3000 = 30%)');
  assert(trs[2].textContent.includes('sem meta'), 'Luria: sem meta');
  assert(document.querySelector('#mesaSemaforoTbody tr[data-mesa-linha] .retornoBadge.atrasado'), 'linha vermelha com selo atrasado');

  // expandir
  trs[1].click();
  await espera(20);
  const det = document.querySelector('#mesaSemaforoTbody tr.mesaDetalhe');
  assert(det && det.textContent.includes('Cliente Teste') && det.textContent.includes('MÁXIMO'), 'expandir mostra o pedido e o nível');
  // a tabela é redesenhada a cada clique: buscar a linha de novo (a referência antiga ficou fora do DOM)
  document.querySelector('#mesaSemaforoTbody tr[data-mesa-linha="p:p-zeca"]').click();
  await espera(20);
  assert(!document.querySelector('#mesaSemaforoTbody tr.mesaDetalhe'), 'clicar de novo recolhe');

  // cobrar
  document.querySelector('#mesaSemaforoTbody [data-mesa-cobrar="p:p-caio"]').click();
  await espera(20);
  assert(window.__copiados[0] && window.__copiados[0].startsWith('Oi, Caio!'), 'cobrar copia o texto');
  assert(window.__abertos[0] && window.__abertos[0].startsWith('https://wa.me/?text=Oi%2C%20Caio'), 'cobrar abre wa.me sem número');
  assert(!document.querySelector('#mesaSemaforoTbody [data-mesa-cobrar]:not([data-mesa-cobrar^="p:"])'), 'só linhas com chave válida têm Cobrar');

  // Excel
  document.getElementById('btnMesaExportar').click();
  await espera(20);
  const x = window.__xlsx.pop();
  assert(x && x.nome === 'MesaSupervisor_' + HOJE + '.xlsx', 'nome do Excel');
  eq(x.wb.SheetNames, ['Semáforo', 'Itens'], 'abas do Excel');

  // velocidade × conversão: pílulas por mês e tabela
  const pills = [...document.querySelectorAll('#mesaVelPills [data-mesa-aba]')].map(b => b.dataset.mesaAba);
  assert(pills.length >= 1 && pills[0] === 'OUTUBRO', 'pílulas por mês (mais recente primeiro)');
  assert(document.getElementById('mesaVelTabela').textContent.includes('até 5 min') && document.getElementById('mesaVelTabela').textContent.includes('sem contato registrado'), 'tabela com as faixas');
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

Neste ponto, `nowReal` já foi declarado no Task 7. Não declare de novo.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_mesa_supervisor.js`
Expected: `FALHOU: linhas na ordem do semáforo`

- [ ] **Step 3: Implementar**

Substitua as duas funções provisórias do Task 7 por:

```js
function mesaLinhasAtuais(){ return mesaEstado.dados ? mesaSemaforo(mesaEstado.dados, mesaEstado.agora, mesaEstado.cfg, mesaEstado.hoje) : []; }
const MESA_SELO = { vermelho: ['retornoBadge atrasado', 'Agir agora'], amarelo: ['retornoBadge hoje', 'Atenção'], verde: ['retornoBadge futuro', 'Em dia'] };
function mesaRenderSemaforo(){
  const tb = document.getElementById('mesaSemaforoTbody');
  if(mesaEstado.erros.pend){ tb.innerHTML = '<tr><td colspan="11">Não foi possível carregar as pendências agora.</td></tr>'; return; }
  const linhas = mesaLinhasAtuais();
  if(!linhas.length){ tb.innerHTML = '<tr><td colspan="11">Nenhum consultor encontrado.</td></tr>'; return; }
  const n = v => v ? String(v) : '0';
  tb.innerHTML = linhas.map(r => {
    const pior = r.esperando.length ? ' · ' + vlFmtMin(Math.max(...r.esperando.map(x => x.min))) : '';
    const ped = r.pedidos.length ? ['maximo', 'medio', 'minimo'].map(nv => { const q = r.pedidos.filter(p => p.nivel === nv).length; return q ? q + ' ' + PP_NIVEL_ROTULO[nv] : ''; }).filter(Boolean).join(' · ') : '0';
    const lig = r.lig ? n(r.lig.lig_lead) + (r.mediaLig ? ' (média ' + Math.round(r.mediaLig) + ')' : '') : '—';
    const vend = r.vendas ? fmtBRL(Number(r.vendas.receita) || 0) + (r.meta ? ' / ' + fmtBRL(r.meta) + ' · ' + fmtPctConversao((Number(r.vendas.receita) || 0) / r.meta) : ' · sem meta') : (r.meta ? 'R$ 0 / ' + fmtBRL(r.meta) : 'sem meta');
    const selo = MESA_SELO[r.cor];
    const linhaHtml = `<tr data-mesa-linha="${escapeHtml(r.chave)}" style="cursor:pointer">
      <td><span class="${selo[0]}">${selo[1]}</span></td>
      <td><span class="mesaNome">${escapeHtml(r.nome)}</span>${r.semLogin ? ' <span class="badge">sem login</span>' : ''}</td>
      <td>${n(r.esperando.length)}${escapeHtml(pior)}</td><td>${mesaFmtPct(r.noPrazo7)}</td>
      <td>${n(r.retornos.length)}</td><td>${n(r.esfriando.length)}</td><td>${n(r.propostas.length)}</td><td>${escapeHtml(ped)}</td>
      <td>${escapeHtml(lig)}</td><td>${escapeHtml(vend)}</td>
      <td>${r.nPend && r.profileId ? `<button type="button" class="btn btn-sm btn-outline" data-mesa-cobrar="${escapeHtml(r.chave)}" style="width:auto">Cobrar</button>` : ''}</td></tr>`;
    return linhaHtml + (mesaEstado.aberto === r.chave ? mesaDetalheHtml(r) : '');
  }).join('');
}
function mesaDetalheHtml(r){
  const itens = []
    .concat(r.esperando.map(x => ['Lead esperando', x.lead.aba ? conversaoAbaRotulo(x.lead.aba) : '', vlFmtMin(x.min)]))
    .concat(r.retornos.map(x => ['Retorno atrasado', x.titulo, 'desde ' + ppFmtDia(mesaDiaSP(x.desde))]))
    .concat(r.esfriando.map(x => ['Lead esfriando', x.titulo, 'último contato ' + ppFmtDia(mesaDiaSP(x.desde))]))
    .concat(r.propostas.map(x => ['Proposta parada', x.titulo, 'desde ' + ppFmtDia(mesaDiaSP(x.desde))]))
    .concat(r.pedidos.map(x => ['Pedido ' + PP_NIVEL_ROTULO[x.nivel], x.titulo + (x.extra && x.extra.etapa ? ' · ' + x.extra.etapa : ''), 'na etapa desde ' + ppFmtDia(mesaDiaSP(x.desde))]));
  const corpo = itens.length ? itens.map(i => `<div class="retornoLeadSub"><b>${escapeHtml(i[0])}</b> — ${escapeHtml(i[1])} · ${escapeHtml(i[2])}</div>`).join('') : '<div class="retornoLeadSub">Nenhuma pendência.</div>';
  return `<tr class="mesaDetalhe"><td></td><td colspan="10">${corpo}</td></tr>`;
}
function mesaRenderVelocidade(){
  const d = mesaEstado.dados, el = document.getElementById('mesaVelTabela'), pills = document.getElementById('mesaVelPills');
  if(mesaEstado.erros.leads){ el.innerHTML = '<p class="desc">Não foi possível carregar agora.</p>'; pills.innerHTML = ''; return; }
  const abas = conversaoAbasDisponiveis(d.leads);
  if(!abas.some(a => a.aba === mesaEstado.aba)) mesaEstado.aba = abas.length ? abas[0].aba : null;
  pills.innerHTML = abas.map(a => `<button type="button" class="filterPill${a.aba === mesaEstado.aba ? ' active' : ''}" data-mesa-aba="${escapeHtml(a.aba)}">${escapeHtml(conversaoAbaRotulo(a.aba))} (${a.n})</button>`).join('');
  const linhas = mesaVelocidadeConversao(d.leads, mesaEstado.aba, mesaEstado.cfg);
  el.innerHTML = `<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Tempo até o 1º contato</th><th>Leads</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>${
    linhas.map(r => `<tr><td>${escapeHtml(r.rotulo)}</td><td>${r.leads}</td><td>${r.vendas}</td><td>${mesaFmtPct(r.conversao)}</td></tr>`).join('')}</tbody></table></div>`;
}
document.getElementById('panel-mesa').addEventListener('click', function(ev){
  const cob = ev.target.closest('[data-mesa-cobrar]');
  if(cob){
    ev.stopPropagation();
    const r = mesaLinhasAtuais().find(x => x.chave === cob.dataset.mesaCobrar);
    const txt = r ? mesaTextoCobranca(r) : '';
    if(!txt) return;
    try{ navigator.clipboard.writeText(txt); }catch(e){ /* sem área de transferência: o WhatsApp abre com o texto mesmo assim */ }
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
    mostrarAviso('Mensagem copiada', 'ok');
    return;
  }
  const pill = ev.target.closest('[data-mesa-aba]');
  if(pill){ mesaEstado.aba = pill.dataset.mesaAba; mesaRenderVelocidade(); return; }
  const tr = ev.target.closest('tr[data-mesa-linha]');
  if(tr){ mesaEstado.aberto = mesaEstado.aberto === tr.dataset.mesaLinha ? null : tr.dataset.mesaLinha; mesaRenderSemaforo(); }
});
document.getElementById('btnMesaExportar').addEventListener('click', function(){
  const linhas = mesaLinhasAtuais();
  const sem = linhas.map(r => ({ Situação: MESA_SELO[r.cor][1], Consultor: r.nome, 'Esperando agora': r.esperando.length, 'No prazo 7 d': r.noPrazo7 === null ? '' : Math.round(r.noPrazo7 * 1000) / 10,
    'Retornos atrasados': r.retornos.length, 'Leads esfriando': r.esfriando.length, 'Propostas paradas': r.propostas.length, 'Pedidos em risco': r.pedidos.length,
    'Ligações hoje': r.lig ? Number(r.lig.lig_lead) || 0 : '', 'Vendas no mês (R$)': r.vendas ? Number(r.vendas.receita) || 0 : 0, 'Meta (R$)': r.meta || '' }));
  const itens = [];
  linhas.forEach(r => {
    r.retornos.forEach(x => itens.push({ Consultor: r.nome, Tipo: 'Retorno atrasado', Item: x.titulo, Desde: mesaDiaSP(x.desde) || '' }));
    r.esfriando.forEach(x => itens.push({ Consultor: r.nome, Tipo: 'Lead esfriando', Item: x.titulo, Desde: mesaDiaSP(x.desde) || '' }));
    r.propostas.forEach(x => itens.push({ Consultor: r.nome, Tipo: 'Proposta parada', Item: x.titulo, Desde: mesaDiaSP(x.desde) || '' }));
    r.pedidos.forEach(x => itens.push({ Consultor: r.nome, Tipo: 'Pedido ' + PP_NIVEL_ROTULO[x.nivel], Item: x.titulo, Desde: mesaDiaSP(x.desde) || '' }));
  });
  mlBaixarXlsx('MesaSupervisor_' + mesaEstado.hoje + '.xlsx', [{ nome: 'Semáforo', linhas: sem }, { nome: 'Itens', linhas: itens }]);
});
```

Confira que existem (`grep -n`): `function conversaoAbasDisponiveis`, `function ppFmtDia`, `const PP_NIVEL_ROTULO`, `function mlBaixarXlsx`. O `mlBaixarXlsx` chama `XLSX.writeFile`, que o teste captura. Se a assinatura dele for diferente de `(nomeArquivo, [{nome, linhas}])`, adapte a chamada e anote no commit.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_mesa_supervisor.js && node test_velocidade_lead.js`
Expected: `0 falharam` nos dois.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_mesa_supervisor.js
git commit -m "feat(painel): semáforo por consultor com detalhes, Cobrar, Excel e velocidade x conversão (seção 68)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Regras de negócio §68, build e bateria completa

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (seção nova no fim)
- Generated: `painel_clientes_apex.html` (`python build_painel.py`)

**Interfaces:**
- Consumes: tudo o que foi feito antes.
- Produces: §68 registrada e a bateria completa verde.

- [ ] **Step 1: Conferir o próximo número livre**

Run: `git fetch oficial && git show oficial/main:REGRAS_NEGOCIO.md | grep -E '^## [0-9]+\.' | tail -2`
Expected: a última é `## 67.` Se já existir uma `## 68.`, use o próximo número livre em todo o texto e nos comentários `seção 68` do código. Para achá-los: `grep -n "seção 68\|§68" _template.html supabase -r`.

- [ ] **Step 2: Escrever a §68 no fim do `REGRAS_NEGOCIO.md`**

```markdown
## 68. Velocidade do lead ("Atender agora") e Mesa do Supervisor (02/10/2026)

Pedido do usuário (02/10): aumentar a conversão dos consultores e dar praticidade aos supervisores (ideias 1 e 5 do brainstorming). Spec: `docs/superpowers/specs/2026-10-02-velocidade-lead-mesa-supervisor-design.md`; plano: `docs/superpowers/plans/2026-10-02-velocidade-lead-mesa-supervisor.md`. **Status: implementado no branch `feat/velocidade-lead-mesa-supervisor`; banco e publicação aguardando ok.**

### 68.1 Por quê
- Set+Out/2026: lead com 1ª ligação em menos de 15 min converteu 31,7%, contra 13–15% nos mais lentos. Em horário comercial: 36% (n=25) contra 12,8% (n=39). É um indício e não uma prova (amostra pequena). A Mesa mede de novo a cada mês (68.4).
- ~40% dos leads chegam fora do horário (pico às 21h) → o relógio conta **minutos úteis**.
- Muitos leads são atendidos pelo WhatsApp (sem ligação no ProContact) → o clique no painel registra o contato.

### 68.2 Regra do relógio
- Expediente em `config.velocidade_lead`: padrão seg–sex 08–18, sáb 08–12, sem domingo e sem feriados nacionais (os do `ppFeriados`). Cores: verde até 5 min, amarelo até 15, vermelho acima disso, "aguardando abertura" fora do expediente.
- **Contato:** é o primeiro clique em WhatsApp / Ligar / "Já falei com ele" (tabela `leads_contatos`) ou a primeira ligação manual a partir de 1 h antes da entrada do lead.
- **O status da planilha não conta**, porque os leads já chegam com status (verificado em 02/10).
- **"Esperando":** sem contato registrado e categoria `sem_contato`/`andamento`, dentro dos últimos 7 dias (`janela_dias`).
- Funções `vl*` no `_template.html`; o banco só devolve timestamps.

### 68.3 Consultor
Card **"Atender agora"** no topo de Digital → "Meus leads para tratar":
- botões WhatsApp (mensagem de 1º contato), Ligar (`tel:`) e "Já falei com ele";
- o lead sai na hora; se o banco recusar, volta e avisa.

Além disso:
- o WhatsApp da lista de baixo também registra contato;
- a recarga roda a cada 2 min desde o login, e o lead novo gera um aviso na tela (e notificação do navegador, se permitida).

### 68.4 Mesa do Supervisor (admin/supervisor)
Aba nova em "Visão geral". Mostra:
- KPIs: novos hoje, % no prazo, mediana até o 1º contato, esperando, sem dono, retornos atrasados e pedidos 🔴;
- a fila da equipe (sem telefone);
- o semáforo por consultor: esperando, no prazo, retornos, leads esfriando 5+ dias, propostas paradas 7+ dias, pedidos com o nível do Pedidos Parados, ligações hoje x média, vendas x meta (cadastro no mês, sem perdidos e devolvidos);
- o detalhe ao clicar, "Cobrar" (copia o texto e abre o WhatsApp sem número) e o Excel;
- a tabela Velocidade × conversão por mês;
- o atraso da planilha (mediana de `primeira_sync_em − criado_em_lead`).

Para o consultor o botão some e o painel fica vazio. A proteção é feita pelas RPCs.

### 68.5 Banco
- Migration `20261002100000_velocidade_lead_mesa.sql`:
  - `leads_contatos` (RLS sem policy: só via RPC);
  - `leads.primeira_sync_em` (nula nas linhas antigas);
  - `config.velocidade_lead`;
  - RPCs `registrar_contato_lead`, `meus_leads_relogio`, `mesa_leads_relogio`, `mesa_pendencias`, `mesa_ligacoes_hoje`, `mesa_vendas_mes`.
- Migration `20261002100100_sync_leads_10min.sql`: `sync-leads-auto` passa a `2-59/10 * * * *`.
- Os rollbacks estão em `supabase/rollback/`. A verificação de papéis está em `supabase/tests/velocidade_lead_mesa_check.sql`.

### 68.6 Pendências
- Rafael: quem põe o lead na planilha, e se ele já entra com consultor e status.
- Fase 2: alerta por Telegram/Slack quando um lead passa de 15 min (depende do token do bot).
```

- [ ] **Step 3: Build e bateria completa**

Run: `bash run_tests.sh`
Expected: `TOTAL: N passaram, F falharam, 0 pulados`. As falhas, se houver, só podem ser `test_conversao_vendas.js` e/ou `test_pedidos_alerta.js` (antigas e conhecidas). Qualquer outra falha precisa ser corrigida antes do commit.

Run: `grep -c "__[A-Z_]*__" painel_clientes_apex.html`. O build já falha sozinho se sobrar placeholder fora do `RUNTIME_PLACEHOLDERS`. Confira só que ele rodou sem erro.

Run: `grep -nE "#[0-9A-Fa-f]{3,6}\b" <(git diff oficial/main -- _template.html | grep '^+')`
Expected: nenhuma linha. Nenhuma cor hex no código novo.

- [ ] **Step 4: Commit**

```bash
git add REGRAS_NEGOCIO.md painel_clientes_apex.html
git commit -m "docs(regras): seção 68 — velocidade do lead e Mesa do Supervisor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Parar e relatar (sem publicar)**

Relate ao Rafael:
- commits e testes;
- o que falta: aplicar as migrations dos Tasks 1 e 2 (com ok) **antes** de publicar o painel;
- depois, o roteiro de publicação: `git fetch oficial` + merge, baixar o painel no ar e comparar, backup, MD5 e vigia;
- a pergunta em aberto (68.6).

**Não publique nem dê push sem ok.**
