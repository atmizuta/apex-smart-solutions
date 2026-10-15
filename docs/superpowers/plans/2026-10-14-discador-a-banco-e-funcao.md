# Discador — Plano A: banco, função e carga inicial — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar no Supabase `apex` as tabelas, funções de métricas e a Edge Function `ingest-discador`, e carregar o relatório do discador de outubro, deixando os dados prontos para a aba "Discador" (Plano C) e para o robô (Plano B).

**Architecture:** Duas migrations: uma de estrutura (tabelas, RLS, config, cron de limpeza) e uma de funções SQL `security definer` que checam admin/supervisor. A Edge Function `ingest-discador` segue o padrão da `ingest-ligacoes`: a lógica pura fica em `ingest.ts`, testada com `node --test`, e a casca `index.ts` grava com a service role, autorizada pelo header `x-robo-token`. O leitor do Excel do discador (`parseDiscador.js`) nasce no repositório privado do robô, porque o Plano B vai reaproveitá-lo; um script local usa esse leitor para a carga inicial.

**Tech Stack:** Postgres (Supabase, pg_cron), Deno Edge Functions (TypeScript, testadas em Node 24 com `node --test`), Node 24 + SheetJS `xlsx@0.18.5` no robô.

**Spec:** `docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md`

## Global Constraints

- Projeto Supabase `apex` = `mdgfboijyqfkggcrhptn` é **produção**: aplicar migration, publicar função, cadastrar secret e gravar dados só com ok explícito do Rafael **naquele momento** (Task 7).
- Repositório `atmizuta/apex-smart-solutions` é **público**: nenhum CNPJ, CPF, telefone, nome de cliente, número de agente associado a nome, token ou amostra do Excel. Fixtures e testes usam valores falsos (CNPJ `00000000000101` etc., telefone `11900000001`, prefixo `zz`).
- Nome (`Nome/Desc`) e CPF (`Documento 1`) nunca são enviados nem gravados.
- Horário: tudo em São Paulo (`America/Sao_Paulo`). Datas do Excel `dd/mm/aaaa hh:mm:ss` → ISO `aaaa-mm-ddThh:mm:ss-03:00`. As colunas `Dt/Hr Início`, `Data/Hora Atendida`, `Data/Hora Atendimento` e `Data/Hora Fim` estão em UTC e **não** são usadas.
- Definições de métrica (spec §7): contato = `status in ('ANSWERED','ABANDONED')`; abandono = ABANDONED ÷ contato; atendida = `ANSWERED` com `agente_id`; venda do discador = pedido de `producao_pedidos_neo` (etapa fora de `VENDA PERDIDA (NEOCRM)` e `DEVOLVIDO (NEOCRM)`, contado uma vez por `numero_pedido`) cujo CNPJ teve chamada atendida entre `dia do cadastro − janela_venda_dias` e o fim do dia do cadastro; atribuída à última chamada atendida.
- **Ajustes já registrados na spec** (commit junto com este plano):
  - o dia do pedido é `cadastro`, a mesma data da matriz do Cadastro Diário (§66). Essa data vem sem hora (meia-noite de SP), então uma chamada no mesmo dia conta;
  - o token do robô vai no header `x-robo-token`, como na `ingest-ligacoes`.
- Configuração: `config` (`chave text`, `valor text` com JSON) com a chave `discador` = `{"abandono_alerta":0.15,"janela_venda_dias":30}`.
- Retenção: 90 dias (`discador-limpeza`, diário 07:30 UTC = 04:30 SP).
- Lote máximo: 500 linhas e 1 MB por requisição.
- Worktree do painel: `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\discador-supervisao` (branch `feat/discador-supervisao`). Robô: `C:\Users\acer1\Downloads\apex-robo-procontact` (branch `main`, privado). Nenhum push nesta fase.

## Review Focus

1. **Colunas homônimas no Excel:** `Data/Hora Fim` (UTC) × `DataHora_Fim` (SP), `Tempo Total` (segundos) × `Tempo_Total` (hh:mm:ss) e duas `Região`. Esperado: o leitor pega as colunas com `_`, e para a região a primeira não vazia. Testado na Task 5.
2. **Linha final sem `Status`** (rodapé do relatório). Esperado: é contada como inválida e não é enviada. Testado na Task 5.
3. **CNPJ em formatos diferentes:** número no Excel (perde zero à esquerda) e texto pontuado no NEO. Esperado: os dois viram 14 dígitos e casam. Testado nas Tasks 2 e 5.
4. **Consultor chamando as funções.** Esperado: erro `42501` em todas as funções de leitura, e só o admin consegue vincular agente. Testado na Task 2.
5. **Reenvio do mesmo período pelo robô** (ontem + hoje a cada hora). Esperado: upsert sem duplicar e sem perder tabulação nova. Testado nas Tasks 3 e 7.

---

## File Structure

Repositório do painel (worktree `discador-supervisao`):
- Create `supabase/migrations/20261014100000_discador_chamadas.sql`: tabelas, RLS, config, cron de limpeza.
- Create `supabase/rollback/20261014100000_discador_chamadas_rollback.sql`
- Create `supabase/tests/discador_chamadas_check.sql`: estrutura e RLS; termina em ROLLBACK.
- Create `supabase/migrations/20261014100100_discador_metricas.sql`: funções de leitura, atribuição de venda e vínculo.
- Create `supabase/rollback/20261014100100_discador_metricas_rollback.sql`
- Create `supabase/tests/discador_metricas_check.sql`: cenário fictício; termina em ROLLBACK.
- Create `supabase/functions/ingest-discador/ingest.ts`: lógica pura.
- Create `supabase/functions/ingest-discador/ingest.test.ts`
- Create `supabase/functions/ingest-discador/index.ts`: casca HTTP e Supabase.

Repositório do robô (`apex-robo-procontact`, privado):
- Create `src/parseDiscador.js`: Excel do discador → linhas no formato da função.
- Create `test/fixtureDiscador.js`: planilha falsa com o layout real de 50 colunas.
- Create `test/parseDiscador.test.js`
- Create `scripts/carga-discador.js`: carga inicial a partir de um Excel local (`--dry` só conta).

---

### Task 1: Migration de estrutura (tabelas, RLS, config, limpeza)

**Files:**
- Create: `supabase/migrations/20261014100000_discador_chamadas.sql`
- Create: `supabase/rollback/20261014100000_discador_chamadas_rollback.sql`
- Create: `supabase/tests/discador_chamadas_check.sql`

**Interfaces:**
- Produces:
  - tabela `public.discador_chamadas` (colunas da spec §4.1);
  - tabela `public.discador_agente (agente_id int pk, profile_id uuid, apelido text, atualizado_em timestamptz)`;
  - tabela `public.discador_sync_log (id, execucao_id uuid unique, iniciou_em, terminou_em, ok, lidas, enviadas, invalidas, periodo_de, periodo_ate, erro)`;
  - `config.discador`;
  - cron `discador-limpeza`.

Todos os comandos rodam do worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\discador-supervisao`.

- [ ] **Step 1: Escrever o teste de estrutura** (`supabase/tests/discador_chamadas_check.sql`)

```sql
-- Verificação de 20261014100000_discador_chamadas.sql (§87). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
begin;
do $$
declare n int;
begin
  assert to_regclass('public.discador_chamadas') is not null, 'tabela discador_chamadas existe';
  assert to_regclass('public.discador_agente') is not null, 'tabela discador_agente existe';
  assert to_regclass('public.discador_sync_log') is not null, 'tabela discador_sync_log existe';

  -- nome e CPF não têm coluna
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'discador_chamadas' and column_name in ('nome', 'cpf', 'documento_1', 'nome_desc');
  assert n = 0, 'discador_chamadas não tem coluna de nome/CPF';

  -- upsert por id não duplica
  insert into public.discador_chamadas (id, gerada_em, status) values (999000001, '2000-01-03 10:00-03', 'BUSY');
  insert into public.discador_chamadas (id, gerada_em, status, tabulacao) values (999000001, '2000-01-03 10:00-03', 'ANSWERED', 'RETORNO')
    on conflict (id) do update set status = excluded.status, tabulacao = excluded.tabulacao;
  select count(*) into n from public.discador_chamadas where id = 999000001 and status = 'ANSWERED' and tabulacao = 'RETORNO';
  assert n = 1, 'upsert por id atualiza a linha';

  -- execucao_id único no log
  insert into public.discador_sync_log (execucao_id, iniciou_em, ok) values ('00000000-0000-0000-0000-00000000d001', now(), true);
  begin
    insert into public.discador_sync_log (execucao_id, iniciou_em, ok) values ('00000000-0000-0000-0000-00000000d001', now(), true);
    assert false, 'execucao_id repetido deveria falhar';
  exception when unique_violation then null;
  end;

  -- RLS ligada, só leitura por política, nenhuma política de escrita
  select count(*) into n from pg_class where oid in ('public.discador_chamadas'::regclass, 'public.discador_agente'::regclass, 'public.discador_sync_log'::regclass) and relrowsecurity;
  assert n = 3, 'RLS ligada nas 3 tabelas';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('discador_chamadas', 'discador_agente', 'discador_sync_log') and cmd <> 'SELECT';
  assert n = 0, 'nenhuma política de escrita';
  select count(*) into n from pg_policies where schemaname = 'public' and tablename in ('discador_chamadas', 'discador_agente', 'discador_sync_log') and cmd = 'SELECT';
  assert n = 3, 'uma política de leitura por tabela';

  -- configuração e cron
  assert (select (valor::jsonb ->> 'abandono_alerta')::numeric from public.config where chave = 'discador') = 0.15, 'config.discador.abandono_alerta = 0.15';
  assert (select (valor::jsonb ->> 'janela_venda_dias')::int from public.config where chave = 'discador') = 30, 'config.discador.janela_venda_dias = 30';
  select count(*) into n from cron.job where jobname = 'discador-limpeza' and schedule = '30 7 * * *';
  assert n = 1, 'cron discador-limpeza às 07:30 UTC';
end $$;
rollback;
```

- [ ] **Step 2: Conferir que o teste falha antes da migration**

Rodar o conteúdo do arquivo no Supabase (`mcp__supabase__execute_sql`, projeto `mdgfboijyqfkggcrhptn`). É leitura com ROLLBACK, então é seguro em produção.
Expected: FAIL com `assertion failed: tabela discador_chamadas existe`.

- [ ] **Step 3: Escrever a migration** (`supabase/migrations/20261014100000_discador_chamadas.sql`)

```sql
-- 14/10/2026 — Discador automático do ProContact: uma linha por tentativa de discagem (REGRAS_NEGOCIO.md §87).
-- Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
-- Nome e CPF do cliente NUNCA chegam aqui: o robô descarta antes e a função ingest-discador só aceita as colunas abaixo.
-- Quem grava é só a Edge Function ingest-discador (service role). Leitura: admin/supervisor.
create table if not exists public.discador_chamadas (
  id bigint primary key,                   -- ID do relatório; upsert por ele (o robô reenvia ontem + hoje a cada hora)
  gerada_em timestamptz not null,          -- DataHora_Geracao (São Paulo)
  conectada_em timestamptz,                -- DataHora_Conectado
  atendida_em timestamptz,                 -- DataHora_Atendimento
  fim_em timestamptz,                      -- DataHora_Fim
  status text not null,                    -- ANSWERED, BUSY, NOANSWER, CHANUNAVAIL, ABANDONED, CONGESTION...
  agente_id int,                           -- "ID do Usuário" (número do agente); nulo = nenhum consultor atendeu
  seg_espera int,                          -- Tempo_Espera
  seg_falados int,                         -- Tempo_Chamada
  seg_total int,                           -- Tempo_Total
  tabulacao text,                          -- Última Tabulação (nulo se vazia)
  carga_id int,                            -- Cód. Carga
  carga text,                              -- Carga (nome do mailing)
  campanha text,
  cnpj text,                               -- Documento 2, 14 dígitos
  telefone text,
  chave_tel text,                          -- DDD + 8 últimos dígitos (mesma regra de ligacoes_manuais)
  operadora_base text,                     -- Campo 1 (operadora de origem da linha)
  cidade text,                             -- Campo 3
  regiao text,
  gravacao text,
  importado_em timestamptz not null default now()
);
create index if not exists idx_discador_gerada on public.discador_chamadas (gerada_em);
create index if not exists idx_discador_agente on public.discador_chamadas (agente_id, gerada_em);
create index if not exists idx_discador_carga on public.discador_chamadas (carga_id, gerada_em);
create index if not exists idx_discador_cnpj on public.discador_chamadas (cnpj, gerada_em);

alter table public.discador_chamadas enable row level security;
drop policy if exists discador_chamadas_select on public.discador_chamadas;
create policy discador_chamadas_select on public.discador_chamadas for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_chamadas from anon, authenticated;

-- Vínculo número do agente no discador → consultor do painel. Escrita só pela RPC discador_vincular_agente (admin).
create table if not exists public.discador_agente (
  agente_id int primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  apelido text,
  atualizado_em timestamptz not null default now()
);
alter table public.discador_agente enable row level security;
drop policy if exists discador_agente_select on public.discador_agente;
create policy discador_agente_select on public.discador_agente for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_agente from anon, authenticated;

-- Uma linha por execução do robô (mesmo formato de ligacoes_sync_log, sem a contagem eagle).
create table if not exists public.discador_sync_log (
  id bigint generated always as identity primary key,
  execucao_id uuid not null unique,
  iniciou_em timestamptz not null,
  terminou_em timestamptz not null default now(),
  ok boolean not null,
  lidas int not null default 0,
  enviadas int not null default 0,
  invalidas int not null default 0,
  periodo_de timestamptz,
  periodo_ate timestamptz,
  erro text                                -- mensagem curta, nunca dados de chamada
);
create index if not exists idx_discador_sync_log_ok on public.discador_sync_log (ok, terminou_em desc);
alter table public.discador_sync_log enable row level security;
drop policy if exists discador_sync_log_select on public.discador_sync_log;
create policy discador_sync_log_select on public.discador_sync_log for select
  using ( public.get_my_role() in ('admin', 'supervisor') );
revoke insert, update, delete on public.discador_sync_log from anon, authenticated;

insert into public.config (chave, valor, atualizado_em)
values ('discador', '{"abandono_alerta":0.15,"janela_venda_dias":30}', now())
on conflict (chave) do nothing;

-- Retenção de 90 dias, todo dia 04:30 de São Paulo. Idempotente.
select cron.unschedule(jobid) from cron.job where jobname = 'discador-limpeza';
select cron.schedule('discador-limpeza', '30 7 * * *',
  $job$ delete from public.discador_chamadas where gerada_em < now() - interval '90 days' $job$);
```

- [ ] **Step 4: Escrever o rollback** (`supabase/rollback/20261014100000_discador_chamadas_rollback.sql`)

```sql
select cron.unschedule(jobid) from cron.job where jobname = 'discador-limpeza';
delete from public.config where chave = 'discador';
drop table if exists public.discador_sync_log;
drop table if exists public.discador_agente;
drop table if exists public.discador_chamadas;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014100000_discador_chamadas.sql supabase/rollback/20261014100000_discador_chamadas_rollback.sql supabase/tests/discador_chamadas_check.sql
git commit -m "feat(discador): tabelas, RLS, config e limpeza de 90 dias (secao 87)"
```

A migration **não** é aplicada aqui: isso acontece na Task 7, com ok do Rafael. O teste do Step 1 roda depois de aplicada.

---

### Task 2: Funções de métricas, atribuição de venda e vínculo

**Files:**
- Create: `supabase/migrations/20261014100100_discador_metricas.sql`
- Create: `supabase/rollback/20261014100100_discador_metricas_rollback.sql`
- Create: `supabase/tests/discador_metricas_check.sql`

**Interfaces:**
- Consumes: tabelas da Task 1; `public.get_my_role()`; `public.producao_pedidos_neo (numero_pedido, etapa, cadastro, cnpj)`; `public.profiles (id, nome)`.
- Produces (todas com `p_de date, p_ate date` em datas de SP, ambas inclusive; período máximo de 120 dias; consultor recebe `42501`):
  - `discador_resumo(p_de, p_ate)` → `(tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, sem_tabulacao bigint, seg_falados_medio int, vendas bigint, abandono_alerta numeric, ultima_sync timestamptz)`
  - `discador_por_hora(p_de, p_ate)` → `(hora int, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, media_atendidas numeric, media_abandonadas numeric)`, horas 9 a 21. As médias só vêm quando `p_de = p_ate`; caso contrário são nulas.
  - `discador_mapa_calor(p_de, p_ate)` → `(dia_semana int /*0=dom*/, hora int, tentativas bigint, contato bigint)`
  - `discador_consultores(p_de, p_ate)` → `(agente_id int, profile_id uuid, nome text, atendidas bigint, seg_falados_total bigint, seg_falados_medio int, sem_avanco bigint, retornos bigint, ganhos bigint, sem_tabulacao bigint, vendas bigint)`
  - `discador_consultor_dias(p_agente int, p_de, p_ate)` → `(dia date, atendidas bigint, seg_falados_total bigint, sem_avanco bigint, ganhos bigint, vendas bigint)`
  - `discador_mailing(p_de, p_ate, p_dim text /*'carga'|'operadora'|'cidade'*/)` → `(chave text, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, ganhos bigint, vendas bigint)`. Para `cidade`: só chaves com 300 ou mais tentativas, as 15 maiores em vendas por 1.000 tentativas.
  - `discador_agentes_sem_vinculo()` → `(agente_id int, atendidas_30d bigint, ultima_chamada timestamptz)`
  - `discador_vincular_agente(p_agente int, p_profile uuid, p_apelido text default null)` → `void` (só admin)
  - internas, sem grant para `authenticated`: `discador_exige_supervisao(p_de date, p_ate date)`, `discador_periodo(p_de, p_ate)`, `discador_vendas_atribuidas(p_de, p_ate)` → `(numero_pedido text, dia date, chamada_id bigint, agente_id int, carga text, operadora_base text, cidade text)`.

- [ ] **Step 1: Escrever o teste do cenário** (`supabase/tests/discador_metricas_check.sql`)

Cenário fictício em janeiro de 2000. 03/01/2000 é segunda-feira; as semanas de referência são 27/12/1999 e 20/12/1999. CNPJs falsos: A = `00000000000101`, B = `00000000000202`, C = `00000000000303`.

```sql
-- Verificação de 20261014100100_discador_metricas.sql (§87). Rodar SOMENTE depois das duas migrations; SEMPRE termina
-- em ROLLBACK. Dados fictícios em 2000 (zz*), CNPJs falsos.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000d102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000d103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.dadm@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000d101', 'Zzdsup Teste',  'zz.dsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000d102', 'Zzdcons Teste', 'zz.dcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000d103', 'Zzdadm Teste',  'zz.dadm',  'admin')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

insert into public.discador_agente (agente_id, profile_id) values (900001, '00000000-0000-0000-0000-00000000d102');

insert into public.discador_chamadas (id, gerada_em, status, agente_id, seg_falados, tabulacao, carga_id, carga, operadora_base, cidade, cnpj) values
  (999100001, '2000-01-03 10:05-03', 'ANSWERED',  900001, 60,   'SEM AVANÇO',        1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000101'),
  (999100002, '2000-01-03 10:10-03', 'ANSWERED',  900001, 120,  null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000202'),
  (999100003, '2000-01-03 10:20-03', 'ABANDONED', null,   null, null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000303'),
  (999100004, '2000-01-03 11:00-03', 'BUSY',      null,   null, null,                2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000404'),
  (999100005, '2000-01-03 11:05-03', 'NOANSWER',  null,   null, null,                2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000505'),
  (999100006, '2000-01-03 11:30-03', 'ANSWERED',  900002, 30,   'AQUISIÇÃO - GANHO', 2, 'ZZ-CARGA-2', 'ZZ-VIVO', 'ZZCIDADE', '00000000000202'),
  (999100007, '1999-12-27 10:00-03', 'ANSWERED',  900001, 10,   'RETORNO',           1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000606'),
  (999100008, '1999-12-20 10:00-03', 'ABANDONED', null,   null, null,                1, 'ZZ-CARGA-1', 'ZZ-TIM',  'ZZCIDADE', '00000000000707');

-- pedidos: ZZP1 (2 itens, CNPJ B pontuado) conta 1 venda, atribuída à ÚLTIMA atendida (999100006, agente 900002, ZZ-CARGA-2);
-- ZZP2 perdido não conta; ZZP3 (CNPJ C só abandonado) não conta; ZZP4 (CNPJ A, 43 dias depois) fora da janela de 30.
insert into public.producao_pedidos_neo (item_id, numero_pedido, etapa, cadastro, cnpj) values
  (999200001, 'ZZP1', 'PEDIDO CADASTRADO',       '2000-01-03 00:00-03', '00.000.000/0002-02'),
  (999200002, 'ZZP1', 'PEDIDO CADASTRADO',       '2000-01-03 00:00-03', '00.000.000/0002-02'),
  (999200003, 'ZZP2', 'VENDA PERDIDA (NEOCRM)',  '2000-01-03 00:00-03', '00.000.000/0001-01'),
  (999200004, 'ZZP3', 'PEDIDO CADASTRADO',       '2000-01-03 00:00-03', '00.000.000/0003-03'),
  (999200005, 'ZZP4', 'PEDIDO CADASTRADO',       '2000-02-15 00:00-03', '00.000.000/0001-01');

do $$
declare r record; n int; v_ok boolean;
begin
  execute 'set local role authenticated';

  -- consultor: tudo recusado com 42501
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d102', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d102', true);
  begin perform public.discador_resumo('2000-01-03', '2000-01-03'); assert false, 'consultor não pode ler resumo';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_consultores('2000-01-03', '2000-01-03'); assert false, 'consultor não pode ler consultores';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_mailing('2000-01-03', '2000-01-03', 'carga'); assert false, 'consultor não pode ler mailing';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d102'); assert false, 'consultor não vincula';
  exception when insufficient_privilege then null; end;
  begin perform public.discador_vendas_atribuidas('2000-01-03', '2000-01-03'); assert false, 'função interna fechada para authenticated';
  exception when insufficient_privilege then null; end;

  -- supervisor
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d101', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d101', true);

  select * into r from public.discador_resumo('2000-01-03', '2000-01-03');
  assert r.tentativas = 6, 'tentativas 6, veio ' || r.tentativas;
  assert r.contato = 4, 'contato 4 (3 ANSWERED + 1 ABANDONED), veio ' || r.contato;
  assert r.atendidas = 3, 'atendidas 3, veio ' || r.atendidas;
  assert r.abandonadas = 1, 'abandonadas 1';
  assert r.sem_tabulacao = 1, 'sem tabulação 1';
  assert r.seg_falados_medio = 70, 'média falada (60+120+30)/3 = 70, veio ' || r.seg_falados_medio;
  assert r.vendas = 1, 'uma venda (ZZP1 uma vez; perdido, só-abandonado e fora da janela não contam), veio ' || r.vendas;
  assert r.abandono_alerta = 0.15, 'abandono_alerta da config';

  select * into r from public.discador_por_hora('2000-01-03', '2000-01-03') where hora = 10;
  assert r.tentativas = 3 and r.atendidas = 2 and r.abandonadas = 1, '10h: 3 tentativas, 2 atendidas, 1 abandonada';
  assert r.media_atendidas = 0.5 and r.media_abandonadas = 0.5, '10h: média de 2 segundas de referência = 0,5 e 0,5';
  select count(*) into n from public.discador_por_hora('2000-01-03', '2000-01-03');
  assert n = 13, 'horas 9 a 21 = 13 linhas';
  select count(*) into n from public.discador_por_hora('2000-01-03', '2000-01-04') where media_atendidas is not null;
  assert n = 0, 'sem média quando o período tem mais de um dia';

  select count(*) into n from public.discador_mapa_calor('2000-01-03', '2000-01-03') where dia_semana = 1 and hora = 11 and tentativas = 3 and contato = 1;
  assert n = 1, 'mapa de calor: segunda 11h com 3 tentativas e 1 contato';

  select * into r from public.discador_consultores('2000-01-03', '2000-01-03') where agente_id = 900001;
  assert r.nome = 'Zzdcons Teste', 'agente vinculado mostra o nome do consultor';
  assert r.atendidas = 2 and r.seg_falados_total = 180 and r.sem_avanco = 1 and r.sem_tabulacao = 1 and r.vendas = 0, 'linha do agente 900001';
  select * into r from public.discador_consultores('2000-01-03', '2000-01-03') where agente_id = 900002;
  assert r.nome = 'Agente 900002' and r.ganhos = 1 and r.vendas = 1, 'agente sem vínculo aparece como "Agente N" e leva a venda';

  select count(*) into n from public.discador_consultor_dias(900002, '2000-01-03', '2000-01-03') where dia = '2000-01-03' and atendidas = 1 and vendas = 1;
  assert n = 1, 'detalhe por dia do agente 900002';

  select * into r from public.discador_mailing('2000-01-03', '2000-01-03', 'carga') where chave = 'ZZ-CARGA-2';
  assert r.tentativas = 3 and r.contato = 1 and r.ganhos = 1 and r.vendas = 1, 'mailing por carga ZZ-CARGA-2';
  select * into r from public.discador_mailing('2000-01-03', '2000-01-03', 'carga') where chave = 'ZZ-CARGA-1';
  assert r.tentativas = 3 and r.abandonadas = 1 and r.vendas = 0, 'mailing por carga ZZ-CARGA-1';
  select count(*) into n from public.discador_mailing('2000-01-03', '2000-01-03', 'cidade');
  assert n = 0, 'cidade com menos de 300 tentativas não aparece';
  begin perform public.discador_mailing('2000-01-03', '2000-01-03', 'x'); assert false, 'dimensão inválida';
  exception when invalid_parameter_value then null; end;
  begin perform public.discador_resumo('2000-01-03', '1999-12-01'); assert false, 'período invertido';
  exception when invalid_parameter_value then null; end;
  begin perform public.discador_resumo('2000-01-01', '2000-06-30'); assert false, 'período acima de 120 dias';
  exception when invalid_parameter_value then null; end;

  select count(*) into n from public.discador_resumo('2000-02-15', '2000-02-15') where vendas = 0;
  assert n = 1, 'ZZP4 (43 dias depois da chamada) fica fora da janela de 30 dias';

  -- supervisor também não vincula (só admin)
  begin perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d102'); assert false, 'supervisor não vincula';
  exception when insufficient_privilege then null; end;

  -- admin vincula; nome passa a aparecer
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000d103', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d103', true);
  perform public.discador_vincular_agente(900002, '00000000-0000-0000-0000-00000000d101', '  ');
  select nome = 'Zzdsup Teste' into v_ok from public.discador_consultores('2000-01-03', '2000-01-03') where agente_id = 900002;
  assert v_ok, 'depois do vínculo o agente 900002 mostra o nome';
  begin perform public.discador_vincular_agente(0, null); assert false, 'agente inválido';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
```

O teste não verifica `discador_agentes_sem_vinculo()` com contagem exata, porque ela olha os últimos 30 dias reais. A Task 7 confere essa função contra os dados de outubro.

- [ ] **Step 2: Conferir que falha antes da migration**

Mesmo modo da Task 1, Step 2. Se a Task 1 ainda não estiver aplicada, a falha é `relation "public.discador_agente" does not exist`; se estiver, `function public.discador_resumo(...) does not exist`. Os dois casos confirmam que o teste não passa sozinho.

- [ ] **Step 3: Escrever a migration** (`supabase/migrations/20261014100100_discador_metricas.sql`)

```sql
-- 14/10/2026 — Funções de leitura da aba "Discador" (REGRAS_NEGOCIO.md §87). Todas checam admin/supervisor.
-- Datas p_de/p_ate em São Paulo, ambas inclusive, no máximo 120 dias.
-- Contato = ANSWERED + ABANDONED; abandono = ABANDONED ÷ contato; atendida = ANSWERED com agente.
-- Venda do discador: pedido do NEO (sem perdido/devolvido; GROSS já não entra, §49) cujo CNPJ teve chamada atendida entre
-- (dia do cadastro − janela_venda_dias) e o fim do dia do cadastro; vai para a ÚLTIMA chamada atendida. Um pedido conta uma vez.

create or replace function public.discador_exige_supervisao(p_de date, p_ate date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 120 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
end $$;

create or replace function public.discador_periodo(p_de date, p_ate date)
returns setof public.discador_chamadas language sql stable security definer set search_path = public as $$
  select * from public.discador_chamadas
   where gerada_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and gerada_em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo');
$$;

create or replace function public.discador_vendas_atribuidas(p_de date, p_ate date)
returns table (numero_pedido text, dia date, chamada_id bigint, agente_id int, carga text, operadora_base text, cidade text)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select (c.valor::jsonb ->> 'janela_venda_dias')::int from public.config c where c.chave = 'discador'), 30) as dias
  ), pedidos as (
    select n.numero_pedido,
           min((n.cadastro at time zone 'America/Sao_Paulo')::date) as dia,
           min(lpad(regexp_replace(n.cnpj, '\D', '', 'g'), 14, '0')) as cnpj
      from public.producao_pedidos_neo n
     where n.cadastro >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and n.cadastro <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and n.etapa not in ('VENDA PERDIDA (NEOCRM)', 'DEVOLVIDO (NEOCRM)')
       and n.numero_pedido is not null
       and regexp_replace(coalesce(n.cnpj, ''), '\D', '', 'g') <> ''
     group by n.numero_pedido
  )
  select p.numero_pedido, p.dia, c.id, c.agente_id, c.carga, c.operadora_base, c.cidade
    from pedidos p
    cross join cfg
    cross join lateral (
      select d.id, d.agente_id, d.carga, d.operadora_base, d.cidade
        from public.discador_chamadas d
       where d.cnpj = p.cnpj and d.status = 'ANSWERED' and d.agente_id is not null
         and d.gerada_em >= ((p.dia - cfg.dias)::timestamp at time zone 'America/Sao_Paulo')
         and d.gerada_em <  ((p.dia + 1)::timestamp at time zone 'America/Sao_Paulo')
       order by d.gerada_em desc, d.id desc
       limit 1
    ) c;
$$;

create or replace function public.discador_resumo(p_de date, p_ate date)
returns table (tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, sem_tabulacao bigint,
               seg_falados_medio int, vendas bigint, abandono_alerta numeric, ultima_sync timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  select count(*),
         count(*) filter (where c.status in ('ANSWERED', 'ABANDONED')),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null),
         count(*) filter (where c.status = 'ABANDONED'),
         count(*) filter (where c.status = 'ANSWERED' and c.agente_id is not null and c.tabulacao is null),
         round(avg(c.seg_falados) filter (where c.status = 'ANSWERED' and c.agente_id is not null))::int,
         (select count(*) from public.discador_vendas_atribuidas(p_de, p_ate)),
         coalesce((select (g.valor::jsonb ->> 'abandono_alerta')::numeric from public.config g where g.chave = 'discador'), 0.15),
         (select max(l.terminou_em) from public.discador_sync_log l where l.ok)
    from public.discador_periodo(p_de, p_ate) c;
end $$;

create or replace function public.discador_por_hora(p_de date, p_ate date)
returns table (hora int, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint,
               media_atendidas numeric, media_abandonadas numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with per as (
    select extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de, p_ate) c
  ), ref as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as dia,
           extract(hour from c.gerada_em at time zone 'America/Sao_Paulo')::int as h, c.status, c.agente_id
      from public.discador_periodo(p_de - 28, p_de - 7) c
     where p_de = p_ate
       and (c.gerada_em at time zone 'America/Sao_Paulo')::date in (p_de - 7, p_de - 14, p_de - 21, p_de - 28)
  ), nd as (
    select count(distinct ref.dia) as n from ref
  ), a as (
    select per.h, count(*) as t,
           count(*) filter (where per.status in ('ANSWERED', 'ABANDONED')) as ct,
           count(*) filter (where per.status = 'ANSWERED' and per.agente_id is not null) as atd,
           count(*) filter (where per.status = 'ABANDONED') as abd
      from per group by per.h
  ), r as (
    select ref.h,
           count(*) filter (where ref.status = 'ANSWERED' and ref.agente_id is not null) as atd,
           count(*) filter (where ref.status = 'ABANDONED') as abd
      from ref group by ref.h
  )
  select g.h, coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0),
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.atd, 0)::numeric / nd.n, 1) end,
         case when p_de = p_ate and nd.n > 0 then round(coalesce(r.abd, 0)::numeric / nd.n, 1) end
    from generate_series(9, 21) as g(h)
    cross join nd
    left join a on a.h = g.h
    left join r on r.h = g.h
   order by g.h;
end $$;

create or replace function public.discador_mapa_calor(p_de date, p_ate date)
returns table (dia_semana int, hora int, tentativas bigint, contato bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  select extract(dow from s.x)::int, extract(hour from s.x)::int, count(*),
         count(*) filter (where s.status in ('ANSWERED', 'ABANDONED'))
    from (select c.gerada_em at time zone 'America/Sao_Paulo' as x, c.status from public.discador_periodo(p_de, p_ate) c) s
   group by 1, 2
   order by 1, 2;
end $$;

create or replace function public.discador_consultores(p_de date, p_ate date)
returns table (agente_id int, profile_id uuid, nome text, atendidas bigint, seg_falados_total bigint, seg_falados_medio int,
               sem_avanco bigint, retornos bigint, ganhos bigint, sem_tabulacao bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with ch as (
    select c.agente_id as ag, coalesce(c.seg_falados, 0) as seg, upper(coalesce(c.tabulacao, '')) as tab, c.tabulacao is null as semtab
      from public.discador_periodo(p_de, p_ate) c
     where c.status = 'ANSWERED' and c.agente_id is not null
  ), a as (
    select ch.ag, count(*) as n, sum(ch.seg)::bigint as seg,
           count(*) filter (where ch.tab like 'SEM AVAN%') as sa,
           count(*) filter (where ch.tab = 'RETORNO') as ret,
           count(*) filter (where ch.tab like '%GANHO') as gan,
           count(*) filter (where ch.semtab) as st
      from ch group by ch.ag
  ), v as (
    select va.agente_id as ag, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate) va group by va.agente_id
  )
  select coalesce(a.ag, v.ag), da.profile_id,
         coalesce(p.nome, nullif(btrim(da.apelido), ''), 'Agente ' || coalesce(a.ag, v.ag)),
         coalesce(a.n, 0), coalesce(a.seg, 0),
         case when coalesce(a.n, 0) > 0 then round(a.seg::numeric / a.n)::int end,
         coalesce(a.sa, 0), coalesce(a.ret, 0), coalesce(a.gan, 0), coalesce(a.st, 0), coalesce(v.n, 0)
    from a
    full join v on v.ag = a.ag
    left join public.discador_agente da on da.agente_id = coalesce(a.ag, v.ag)
    left join public.profiles p on p.id = da.profile_id
   order by coalesce(a.n, 0) desc, 1;
end $$;

create or replace function public.discador_consultor_dias(p_agente int, p_de date, p_ate date)
returns table (dia date, atendidas bigint, seg_falados_total bigint, sem_avanco bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  return query
  with a as (
    select (c.gerada_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n, sum(coalesce(c.seg_falados, 0))::bigint as seg,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like 'SEM AVAN%') as sa,
           count(*) filter (where upper(coalesce(c.tabulacao, '')) like '%GANHO') as gan
      from public.discador_periodo(p_de, p_ate) c
     where c.status = 'ANSWERED' and c.agente_id = p_agente
     group by 1
  ), v as (
    select va.dia as d, count(*) as n from public.discador_vendas_atribuidas(p_de, p_ate) va where va.agente_id = p_agente group by 1
  )
  select coalesce(a.d, v.d), coalesce(a.n, 0), coalesce(a.seg, 0), coalesce(a.sa, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.d = a.d
   order by 1;
end $$;

create or replace function public.discador_mailing(p_de date, p_ate date, p_dim text)
returns table (chave text, tentativas bigint, contato bigint, atendidas bigint, abandonadas bigint, ganhos bigint, vendas bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(p_de, p_ate);
  if p_dim is null or p_dim not in ('carga', 'operadora', 'cidade') then
    raise exception 'dimensão inválida' using errcode = '22023';
  end if;
  return query
  with ch as (
    select case p_dim when 'carga' then coalesce(c.carga, '(sem carga)')
                      when 'operadora' then coalesce(c.operadora_base, '(sem operadora)')
                      else coalesce(c.cidade, '(sem cidade)') end as k,
           c.status, c.agente_id, upper(coalesce(c.tabulacao, '')) as tab
      from public.discador_periodo(p_de, p_ate) c
  ), a as (
    select ch.k, count(*) as t,
           count(*) filter (where ch.status in ('ANSWERED', 'ABANDONED')) as ct,
           count(*) filter (where ch.status = 'ANSWERED' and ch.agente_id is not null) as atd,
           count(*) filter (where ch.status = 'ABANDONED') as abd,
           count(*) filter (where ch.status = 'ANSWERED' and ch.tab like '%GANHO') as gan
      from ch group by ch.k
  ), v as (
    select case p_dim when 'carga' then coalesce(va.carga, '(sem carga)')
                      when 'operadora' then coalesce(va.operadora_base, '(sem operadora)')
                      else coalesce(va.cidade, '(sem cidade)') end as k,
           count(*) as n
      from public.discador_vendas_atribuidas(p_de, p_ate) va group by 1
  )
  select coalesce(a.k, v.k), coalesce(a.t, 0), coalesce(a.ct, 0), coalesce(a.atd, 0), coalesce(a.abd, 0), coalesce(a.gan, 0), coalesce(v.n, 0)
    from a full join v on v.k = a.k
   where p_dim <> 'cidade' or coalesce(a.t, 0) >= 300
   order by case when p_dim = 'cidade' then coalesce(v.n, 0)::numeric * 1000 / nullif(a.t, 0) end desc nulls last,
            coalesce(a.t, 0) desc
   limit case when p_dim = 'cidade' then 15 end;
end $$;

create or replace function public.discador_agentes_sem_vinculo()
returns table (agente_id int, atendidas_30d bigint, ultima_chamada timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.discador_exige_supervisao(current_date, current_date);
  return query
  select c.agente_id, count(*) filter (where c.status = 'ANSWERED'), max(c.gerada_em)
    from public.discador_chamadas c
    left join public.discador_agente da on da.agente_id = c.agente_id
   where c.agente_id is not null and c.gerada_em >= now() - interval '30 days' and da.profile_id is null
   group by c.agente_id
   order by 2 desc;
end $$;

create or replace function public.discador_vincular_agente(p_agente int, p_profile uuid, p_apelido text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_agente is null or p_agente <= 0 then
    raise exception 'agente inválido' using errcode = '22023';
  end if;
  if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile) then
    raise exception 'consultor não encontrado' using errcode = '22023';
  end if;
  insert into public.discador_agente (agente_id, profile_id, apelido, atualizado_em)
  values (p_agente, p_profile, nullif(btrim(p_apelido), ''), now())
  on conflict (agente_id) do update
    set profile_id = excluded.profile_id, apelido = excluded.apelido, atualizado_em = now();
end $$;

-- Permissões: as internas ficam fechadas; as de leitura abertas a logados (a checagem de perfil é dentro).
revoke all on function public.discador_exige_supervisao(date, date) from public, anon, authenticated;
revoke all on function public.discador_periodo(date, date) from public, anon, authenticated;
revoke all on function public.discador_vendas_atribuidas(date, date) from public, anon, authenticated;
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.discador_resumo(date, date)', 'public.discador_por_hora(date, date)', 'public.discador_mapa_calor(date, date)',
    'public.discador_consultores(date, date)', 'public.discador_consultor_dias(int, date, date)',
    'public.discador_mailing(date, date, text)', 'public.discador_agentes_sem_vinculo()',
    'public.discador_vincular_agente(int, uuid, text)'
  ] loop
    execute 'revoke all on function ' || fn || ' from public, anon';
    execute 'grant execute on function ' || fn || ' to authenticated';
  end loop;
end $$;
```

- [ ] **Step 4: Escrever o rollback** (`supabase/rollback/20261014100100_discador_metricas_rollback.sql`)

```sql
drop function if exists public.discador_vincular_agente(int, uuid, text);
drop function if exists public.discador_agentes_sem_vinculo();
drop function if exists public.discador_mailing(date, date, text);
drop function if exists public.discador_consultor_dias(int, date, date);
drop function if exists public.discador_consultores(date, date);
drop function if exists public.discador_mapa_calor(date, date);
drop function if exists public.discador_por_hora(date, date);
drop function if exists public.discador_resumo(date, date);
drop function if exists public.discador_vendas_atribuidas(date, date);
drop function if exists public.discador_periodo(date, date);
drop function if exists public.discador_exige_supervisao(date, date);
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261014100100_discador_metricas.sql supabase/rollback/20261014100100_discador_metricas_rollback.sql supabase/tests/discador_metricas_check.sql
git commit -m "feat(discador): funcoes de metricas, atribuicao de venda e vinculo de agente (secao 87)"
```

A aplicação e o teste rodam na Task 7.

---

### Task 3: Edge Function `ingest-discador`, lógica pura

**Files:**
- Create: `supabase/functions/ingest-discador/ingest.ts`
- Test: `supabase/functions/ingest-discador/ingest.test.ts`

**Interfaces:**
- Produces:
  - `MAX_LOTE = 500`;
  - `type LinhaDiscador` (colunas da `discador_chamadas`, menos `importado_em`);
  - `validarLote(lote: unknown): { linhas: LinhaDiscador[]; invalidas: number }`;
  - `type DepsIngest = { gravarChamadas(l: LinhaDiscador[]): Promise<void>; gravarLog(l: LogExecucao): Promise<void>; contarPeriodo(de: string, ate: string): Promise<number> }`;
  - `processar(corpo: unknown, deps: DepsIngest): Promise<{ status: number; corpo: Record<string, unknown> }>`.
- **Contrato com o robô:** o corpo é `{acao:'lote', execucao_id, lote:[...]}`, `{acao:'final', execucao_id, iniciou_em, ok, lidas, enviadas, invalidas, periodo_de, periodo_ate, erro}` ou `{acao:'contar', de, ate}`. Datas ISO com `-03:00`.

Comandos rodam de `supabase/functions/ingest-discador/`.

- [ ] **Step 1: Escrever os testes** (`ingest.test.ts`)

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarLote, processar, MAX_LOTE } from "./ingest.ts";
import type { DepsIngest, LinhaDiscador } from "./ingest.ts";

const base = {
  id: 244000001, gerada_em: "2026-10-02T15:14:20-03:00", conectada_em: "2026-10-02T15:14:30-03:00",
  atendida_em: "2026-10-02T15:14:32-03:00", fim_em: "2026-10-02T15:16:00-03:00", status: "ANSWERED", agente_id: 189,
  seg_espera: 2, seg_falados: 88, seg_total: 100, tabulacao: "SEM AVANÇO", carga_id: 14162, carga: "ZZ-CARGA",
  campanha: "ZZ-CAMPANHA", cnpj: "00000000000101", telefone: "11900000001", operadora_base: "ZZ-OPERADORA",
  cidade: "ZZCIDADE", regiao: "SUDESTE", gravacao: "1003/2026/10/02/DIALER-1",
};

function depsFalsas() {
  const gravadas: LinhaDiscador[][] = [];
  const logs: unknown[] = [];
  const deps: DepsIngest = {
    async gravarChamadas(l) { gravadas.push(l); },
    async gravarLog(l) { logs.push(l); },
    async contarPeriodo() { return 42; },
  };
  return { deps, gravadas, logs };
}

test("validarLote: linha completa vira LinhaDiscador com chave_tel", () => {
  const r = validarLote([base]);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas[0], { ...base, chave_tel: "1100000001" });
});
test("validarLote: linha mínima (só id, gerada_em, status) é válida; resto vira null", () => {
  const r = validarLote([{ id: 5, gerada_em: base.gerada_em, status: "BUSY" }]);
  assert.equal(r.invalidas, 0);
  const l = r.linhas[0];
  assert.equal(l.agente_id, null);
  assert.equal(l.seg_falados, null);
  assert.equal(l.cnpj, null);
  assert.equal(l.chave_tel, null);
});
test("validarLote: campos fora da lista (nome, cpf) nunca passam", () => {
  const r = validarLote([{ ...base, nome: "FULANO", cpf: "00000000000", documento_1: "x" }]);
  assert.equal(r.invalidas, 0);
  assert.equal("nome" in r.linhas[0], false);
  assert.equal("cpf" in r.linhas[0], false);
  assert.equal("documento_1" in r.linhas[0], false);
});
test("validarLote: inválidas são contadas e ignoradas", () => {
  const ruins = [
    { ...base, id: 0 }, { ...base, id: "12" }, { ...base, id: 1.5 },
    { ...base, id: 11, gerada_em: "02/10/2026 15:14:20" },
    { ...base, id: 12, gerada_em: "2026-02-30T10:00:00-03:00" },
    { ...base, id: 13, status: "" }, { ...base, id: 14, status: "answered; drop" },
    { ...base, id: 15, agente_id: -1 }, { ...base, id: 16, seg_falados: 90000 },
    { ...base, id: 17, cnpj: "123" }, { ...base, id: 18, telefone: "abc" },
    { ...base, id: 19, fim_em: "ontem" }, { ...base, id: 20, tabulacao: "x".repeat(201) },
    null, [1], "texto",
  ];
  const r = validarLote(ruins);
  assert.equal(r.linhas.length, 0);
  assert.equal(r.invalidas, ruins.length);
});
test("validarLote: id repetido no lote entra uma vez", () => {
  const r = validarLote([base, { ...base, tabulacao: "RETORNO" }]);
  assert.equal(r.linhas.length, 1);
});
test("validarLote: mais de 500 → erro; não-lista → erro", () => {
  assert.throws(() => validarLote(Array.from({ length: MAX_LOTE + 1 }, (_, i) => ({ ...base, id: i + 1 }))), /lote/);
  assert.throws(() => validarLote({}), /lote/);
});
test("processar lote: grava e devolve só contagens", async () => {
  const { deps, gravadas } = depsFalsas();
  const r = await processar({ acao: "lote", execucao_id: "00000000-0000-0000-0000-000000000001", lote: [base, { id: 0 }] }, deps);
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo, { recebidas: 2, gravadas: 1, invalidas: 1 });
  assert.equal(gravadas.length, 1);
  assert.equal(JSON.stringify(r.corpo).includes("11900000001"), false);
});
test("processar lote vazio: não chama o banco", async () => {
  const { deps, gravadas } = depsFalsas();
  const r = await processar({ acao: "lote", lote: [] }, deps);
  assert.equal(r.status, 200);
  assert.equal(gravadas.length, 0);
});
test("processar final: grava log validado; resumo ruim → 400", async () => {
  const { deps, logs } = depsFalsas();
  const ok = await processar({
    acao: "final", execucao_id: "00000000-0000-0000-0000-000000000001", iniciou_em: "2026-10-14T19:00:00Z", ok: true,
    lidas: 10, enviadas: 9, invalidas: 1, periodo_de: "2026-10-13T00:00:00-03:00", periodo_ate: "2026-10-14T23:59:59-03:00", erro: null,
  }, deps);
  assert.equal(ok.status, 200);
  assert.equal(logs.length, 1);
  const ruim = await processar({ acao: "final", execucao_id: "x", iniciou_em: "agora", ok: true, lidas: 1, enviadas: 1, invalidas: 0 }, deps);
  assert.equal(ruim.status, 400);
});
test("processar contar e ação desconhecida", async () => {
  const { deps } = depsFalsas();
  const c = await processar({ acao: "contar", de: "2026-10-13T00:00:00-03:00", ate: "2026-10-14T23:59:59-03:00" }, deps);
  assert.deepEqual(c, { status: 200, corpo: { total: 42 } });
  assert.equal((await processar({ acao: "apagar" }, deps)).status, 400);
  assert.equal((await processar(null, deps)).status, 400);
});
test("processar: erro do banco vira 500 sem ecoar dados", async () => {
  const deps: DepsIngest = {
    async gravarChamadas() { throw new Error("falhou 11900000001"); },
    async gravarLog() {}, async contarPeriodo() { return 0; },
  };
  const r = await processar({ acao: "lote", lote: [base] }, deps);
  assert.deepEqual(r, { status: 500, corpo: { error: "erro interno" } });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd supabase/functions/ingest-discador && node --test ingest.test.ts`
Expected: FAIL com `Cannot find module './ingest.ts'`.

- [ ] **Step 3: Implementar** (`ingest.ts`)

```ts
// Lógica pura da Edge Function ingest-discador (sem rede, testada com node --test). Spec:
// docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md (§87). Mesmo padrão da ingest-ligacoes:
// a função valida de novo o que o robô enviou e só monta as colunas permitidas (nome e CPF nunca passam).
export const MAX_LOTE = 500;

export type LinhaDiscador = {
  id: number;
  gerada_em: string;
  conectada_em: string | null;
  atendida_em: string | null;
  fim_em: string | null;
  status: string;
  agente_id: number | null;
  seg_espera: number | null;
  seg_falados: number | null;
  seg_total: number | null;
  tabulacao: string | null;
  carga_id: number | null;
  carga: string | null;
  campanha: string | null;
  cnpj: string | null;
  telefone: string | null;
  chave_tel: string | null;
  operadora_base: string | null;
  cidade: string | null;
  regiao: string | null;
  gravacao: string | null;
};
export type LoteValidado = { linhas: LinhaDiscador[]; invalidas: number };

// Igual a chaveTel() da ingest-ligacoes e a public.chave_tel: DDD + 8 últimos dígitos.
export function chaveTel(v: unknown): string | null {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})-03:00$/;
function dataValida(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || se > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Cada helper devolve undefined quando o valor é inválido (a linha toda é descartada).
const INVALIDO = undefined;
function dataOuNulo(v: unknown): string | null | undefined {
  if (v == null) return null;
  return dataValida(v) ? v : INVALIDO;
}
function inteiroOuNulo(v: unknown, min: number, max: number): number | null | undefined {
  if (v == null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : INVALIDO;
}
function textoOuNulo(v: unknown, max: number): string | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "string" && v.length <= max ? v : INVALIDO;
}
function padraoOuNulo(v: unknown, re: RegExp): string | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "string" && re.test(v) ? v : INVALIDO;
}

function validarLinha(r: unknown): LinhaDiscador | undefined {
  if (r === null || typeof r !== "object" || Array.isArray(r)) return INVALIDO;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== "number" || !Number.isSafeInteger(o.id) || o.id <= 0) return INVALIDO;
  if (!dataValida(o.gerada_em)) return INVALIDO;
  if (typeof o.status !== "string" || !/^[A-Z_]{1,30}$/.test(o.status)) return INVALIDO;
  const l = {
    id: o.id,
    gerada_em: o.gerada_em,
    conectada_em: dataOuNulo(o.conectada_em),
    atendida_em: dataOuNulo(o.atendida_em),
    fim_em: dataOuNulo(o.fim_em),
    status: o.status,
    agente_id: inteiroOuNulo(o.agente_id, 1, 10_000_000),
    seg_espera: inteiroOuNulo(o.seg_espera, 0, 86_400),
    seg_falados: inteiroOuNulo(o.seg_falados, 0, 86_400),
    seg_total: inteiroOuNulo(o.seg_total, 0, 86_400),
    tabulacao: textoOuNulo(o.tabulacao, 200),
    carga_id: inteiroOuNulo(o.carga_id, 1, 2_000_000_000),
    carga: textoOuNulo(o.carga, 200),
    campanha: textoOuNulo(o.campanha, 200),
    cnpj: padraoOuNulo(o.cnpj, /^\d{14}$/),
    telefone: padraoOuNulo(o.telefone, /^\d{1,20}$/),
    chave_tel: null as string | null,
    operadora_base: textoOuNulo(o.operadora_base, 100),
    cidade: textoOuNulo(o.cidade, 100),
    regiao: textoOuNulo(o.regiao, 50),
    gravacao: textoOuNulo(o.gravacao, 400),
  };
  if (Object.values(l).some((v) => v === INVALIDO)) return INVALIDO;
  l.chave_tel = chaveTel(l.telefone);
  return l as LinhaDiscador;
}

export function validarLote(lote: unknown): LoteValidado {
  if (!Array.isArray(lote)) throw new Error("lote inválido: esperado uma lista");
  if (lote.length > MAX_LOTE) throw new Error(`lote inválido: no máximo ${MAX_LOTE} linhas`);
  const out: LoteValidado = { linhas: [], invalidas: 0 };
  const vistos = new Set<number>();
  for (const r of lote) {
    const l = validarLinha(r);
    if (!l) { out.invalidas++; continue; }
    if (vistos.has(l.id)) continue;
    vistos.add(l.id);
    out.linhas.push(l);
  }
  return out;
}

export type LogExecucao = {
  execucao_id: string;
  iniciou_em: string;
  ok: boolean;
  lidas: number;
  enviadas: number;
  invalidas: number;
  periodo_de: string | null;
  periodo_ate: string | null;
  erro: string | null;
};
export type DepsIngest = {
  gravarChamadas(linhas: LinhaDiscador[]): Promise<void>;
  gravarLog(l: LogExecucao): Promise<void>;
  contarPeriodo(de: string, ate: string): Promise<number>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ruim = (msg: string): Resposta => ({ status: 400, corpo: { error: msg } });
const contagem = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isoUtcOuSP = (v: unknown): v is string =>
  typeof v === "string" && (dataValida(v) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))));

function validarFinal(c: Record<string, unknown>): LogExecucao | null {
  if (typeof c.execucao_id !== "string" || !RE_UUID.test(c.execucao_id)) return null;
  if (!isoUtcOuSP(c.iniciou_em) || typeof c.ok !== "boolean") return null;
  if (![c.lidas, c.enviadas, c.invalidas].every(contagem)) return null;
  for (const k of ["periodo_de", "periodo_ate"] as const) {
    if (c[k] != null && !isoUtcOuSP(c[k])) return null;
  }
  const erro = c.erro == null ? null : typeof c.erro === "string" ? c.erro.slice(0, 300) : undefined;
  if (erro === undefined) return null;
  return {
    execucao_id: c.execucao_id, iniciou_em: c.iniciou_em, ok: c.ok,
    lidas: c.lidas as number, enviadas: c.enviadas as number, invalidas: c.invalidas as number,
    periodo_de: (c.periodo_de as string | null | undefined) ?? null,
    periodo_ate: (c.periodo_ate as string | null | undefined) ?? null,
    erro,
  };
}

export async function processar(corpo: unknown, deps: DepsIngest): Promise<Resposta> {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) return ruim("corpo inválido");
  const c = corpo as Record<string, unknown>;
  try {
    if (c.acao === "lote") {
      let v: LoteValidado;
      try { v = validarLote(c.lote); } catch (e) { return ruim((e as Error).message); }
      if (v.linhas.length) await deps.gravarChamadas(v.linhas);
      return { status: 200, corpo: { recebidas: (c.lote as unknown[]).length, gravadas: v.linhas.length, invalidas: v.invalidas } };
    }
    if (c.acao === "final") {
      const log = validarFinal(c);
      if (!log) return ruim("resumo inválido");
      await deps.gravarLog(log);
      return { status: 200, corpo: { ok: true } };
    }
    if (c.acao === "contar") {
      if (!dataValida(c.de) || !dataValida(c.ate)) return ruim("período inválido");
      return { status: 200, corpo: { total: await deps.contarPeriodo(c.de, c.ate) } };
    }
    return ruim("ação desconhecida");
  } catch (e) {
    console.error("ingest-discador:", (e as Error).message.replace(/\d{8,}/g, "#").slice(0, 200));
    return { status: 500, corpo: { error: "erro interno" } };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd supabase/functions/ingest-discador && node --test ingest.test.ts`
Expected: todos os testes PASS (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/ingest-discador/ingest.ts supabase/functions/ingest-discador/ingest.test.ts
git commit -m "feat(discador): logica pura da ingest-discador com validacao e testes (secao 87)"
```

---

### Task 4: Edge Function `ingest-discador`, casca HTTP

**Files:**
- Create: `supabase/functions/ingest-discador/index.ts`

**Interfaces:**
- Consumes: `processar`, `DepsIngest` (Task 3); tabelas `discador_chamadas` e `discador_sync_log` (Task 1); secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (automáticos) e `INGEST_DISCADOR_TOKEN`.
- Produces: `POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-discador` com o header `x-robo-token`. Sem token válido → 401; corpo maior que 1 MB → 413; método diferente de POST → 405.

- [ ] **Step 1: Escrever a casca** (`index.ts`)

```ts
// Edge Function: ingest-discador — recebe do robô ProContact as linhas do relatório do DISCADOR automático e grava em
// discador_chamadas (upsert por id) e discador_sync_log. Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
// Chamada só pelo robô (header x-robo-token = secret INGEST_DISCADOR_TOKEN, separado do das chamadas manuais); sem JWT.
// Publicar: npx supabase functions deploy ingest-discador --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./ingest.ts";
import type { DepsIngest } from "./ingest.ts";

const MAX_BYTES = 1_000_000;

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
}
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function criarDeps(): DepsIngest {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // a mensagem do PostgREST pode citar valores da linha; guardamos só o código e o contexto
  const falha = (ctx: string, error: { code?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  return {
    async gravarChamadas(linhas) {
      const { error } = await sb.from("discador_chamadas").upsert(linhas, { onConflict: "id" });
      falha("gravar chamadas do discador", error);
    },
    async gravarLog(l) {
      const { error } = await sb.from("discador_sync_log").upsert(l, { onConflict: "execucao_id" });
      falha("gravar log da execução", error);
    },
    async contarPeriodo(de, ate) {
      const { count, error } = await sb.from("discador_chamadas").select("id", { count: "exact", head: true })
        .gte("gerada_em", de).lte("gerada_em", ate);
      falha("contar chamadas do discador", error);
      return count ?? 0;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let esperado: string;
  try { esperado = env("INGEST_DISCADOR_TOKEN"); } catch { return json({ error: "Não autorizado" }, 401); }
  const recebido = req.headers.get("x-robo-token") ?? "";
  if (!recebido || !iguais(recebido, esperado)) return json({ error: "Não autorizado" }, 401);

  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  const texto = await req.text();
  if (texto.length > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  let corpo: unknown;
  try { corpo = JSON.parse(texto); } catch { return json({ error: "JSON inválido" }, 400); }

  const r = await processar(corpo, criarDeps());
  return json(r.corpo, r.status);
});
```

- [ ] **Step 2: Conferir o tamanho de um lote real**

Um lote de 500 linhas completas, no formato do teste `base`, tem por volta de 250 KB de JSON. Isso fica abaixo de 1 MB, então não há ajuste a fazer. Conferir com:

Run: `cd supabase/functions/ingest-discador && node -e "const b={id:244000001,gerada_em:'2026-10-02T15:14:20-03:00',conectada_em:'2026-10-02T15:14:30-03:00',atendida_em:'2026-10-02T15:14:32-03:00',fim_em:'2026-10-02T15:16:00-03:00',status:'ANSWERED',agente_id:189,seg_espera:2,seg_falados:88,seg_total:100,tabulacao:'SEM AVANÇO',carga_id:14162,carga:'ICP-D-MEI-VIVO-APEX (3)',campanha:'DISCADOR-APEX-AQUISICAO-CLARO-ABORDAGEM-',cnpj:'00000000000101',telefone:'11900000001',operadora_base:'TELEFONICA BRASIL S.A.',cidade:'SAO JOSE DOS CAMPOS',regiao:'SUDESTE',gravacao:'1003/2026/10/14/DIALER-20261014-194948-1'};console.log(JSON.stringify({acao:'lote',lote:Array(500).fill(b)}).length)"`
Expected: um número menor que 1000000.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/ingest-discador/index.ts
git commit -m "feat(discador): casca HTTP da ingest-discador (token proprio, limite 1 MB)"
```

---

### Task 5: Leitor do Excel do discador (repositório do robô)

**Files** (no repositório `C:\Users\acer1\Downloads\apex-robo-procontact`):
- Create: `src/parseDiscador.js`
- Create: `test/fixtureDiscador.js`
- Test: `test/parseDiscador.test.js`

**Interfaces:**
- Consumes: `lerPlanilha(buffer)`, `segundos(t)`, `dataHora(v)` e `normCol` de `src/parse.js` (já existem).
- Produces:
  - `parseDiscador(rows) → { linhas: object[], lidas: number, invalidas: number, faltando: string[] }`. Cada item de `linhas` tem exatamente as chaves de `LinhaDiscador` da Task 3, **sem** `chave_tel` (a função calcula).
  - `normExata(s)`: igual a `normCol`, mas mantém `_`, para separar `DataHora_Fim` de `Data/Hora Fim`.

- [ ] **Step 1: Escrever a fixture** (`test/fixtureDiscador.js`)

```js
// test/fixtureDiscador.js — planilha FALSA com o layout real do dialer_calls_report (50 colunas, nomes repetidos).
// Nenhum dado real: telefones 119000000xx, CNPJ 000000000001xx, nomes ZZ.
import XLSX from 'xlsx';

export const CABECALHO_DISCADOR = [
  'ID', 'Cód. Campanha', 'Cód. Carga', 'Cód. Dado Carga', 'Cód.Contato', 'Telefone', 'Tentativa', 'Posição', 'Região',
  'Status', 'Status Discagem', 'Fila', 'Gravacao', 'Opção URA', 'Dt/Hr Início', 'Data/Hora Atendida',
  'Data/Hora Atendimento', 'Data/Hora Fim', 'Tempo_Espera', 'Tempo_Total', 'Tempo_Chamada', 'Tempo Total',
  'ID do Usuário', 'Canal', 'Canal Agente', 'UniqueID', 'Cód. Fila', 'Cod Empresa', 'Nome Fila', 'DataHora_Geracao',
  'DataHora_Atendimento', 'DataHora_Conectado', 'DataHora_Fim', 'UniqueID', 'Campanha', 'Carga', 'URA', 'Nome/Desc',
  'Tranferida', 'Dest. Transf.', 'Última Tabulação', 'Agent Records', 'Documento 1', 'Documento 2', 'Integração 1',
  'Integração 2', 'Campo 1', 'Campo 2', 'Campo 3', 'Região',
];

// Linha atendida completa; `extra` sobrescreve por ÍNDICE de coluna (os nomes se repetem).
export function linhaDiscador(extra = {}) {
  const v = Array(CABECALHO_DISCADOR.length).fill(null);
  const set = (nome, val, ocorrencia = 0) => {
    let idx = -1;
    for (let i = 0, n = 0; i < CABECALHO_DISCADOR.length; i++) {
      if (CABECALHO_DISCADOR[i] === nome) { if (n === ocorrencia) { idx = i; break; } n++; }
    }
    v[idx] = val;
  };
  set('ID', 244000001); set('Cód. Campanha', 270); set('Cód. Carga', 14162); set('Telefone', 11900000001);
  set('Status', 'ANSWERED'); set('Gravacao', '1003/2026/10/02/DIALER-1');
  set('Dt/Hr Início', '2026-10-02 18:14:20'); set('Data/Hora Fim', '2026-10-02 18:16:00');
  set('Tempo_Espera', '00:00:02'); set('Tempo_Total', '00:01:40'); set('Tempo_Chamada', '00:01:28'); set('Tempo Total', '100');
  set('ID do Usuário', 189); set('Canal', 'Local/11900000001@campaign'); set('UniqueID', '1.1', 0);
  set('DataHora_Geracao', '02/10/2026 15:14:20'); set('DataHora_Conectado', '02/10/2026 15:14:30');
  set('DataHora_Atendimento', '02/10/2026 15:14:32'); set('DataHora_Fim', '02/10/2026 15:16:00');
  set('Campanha', 'ZZ-CAMPANHA'); set('Carga', 'ZZ-CARGA'); set('Nome/Desc', 'ZZ FULANO DE TAL');
  set('Última Tabulação', 'SEM AVANÇO'); set('Documento 1', 11122233344); set('Documento 2', 101);
  set('Campo 1', 'ZZ-OPERADORA'); set('Campo 2', 'MEI'); set('Campo 3', 'ZZCIDADE');
  set('Região', null, 0); set('Região', 'SUDESTE', 1);
  for (const [k, val] of Object.entries(extra)) v[Number(k)] = val;
  return v;
}
export const COL = Object.fromEntries(CABECALHO_DISCADOR.map((n, i) => [n, i]).reverse()); // primeira ocorrência vence
COL['Região#2'] = CABECALHO_DISCADOR.lastIndexOf('Região');

export function planilhaDiscador(linhas) {
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO_DISCADOR, ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Worksheet');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
```

- [ ] **Step 2: Escrever os testes** (`test/parseDiscador.test.js`)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPlanilha } from '../src/parse.js';
import { parseDiscador, normExata } from '../src/parseDiscador.js';
import { linhaDiscador, planilhaDiscador, COL } from './fixtureDiscador.js';

const ler = (linhas) => parseDiscador(lerPlanilha(planilhaDiscador(linhas)));

test('normExata separa DataHora_Fim de Data/Hora Fim e Tempo_Total de Tempo Total', () => {
  assert.equal(normExata('DataHora_Fim'), 'datahora_fim');
  assert.equal(normExata('Data/Hora Fim'), 'datahorafim');
  assert.equal(normExata('Tempo_Total'), 'tempo_total');
  assert.equal(normExata('Tempo Total'), 'tempototal');
  assert.equal(normExata('Última Tabulação'), 'ultimatabulacao');
});
test('linha atendida: colunas de SP, segundos, CNPJ com 14 dígitos, região da 2ª coluna', () => {
  const r = ler([linhaDiscador()]);
  assert.equal(r.lidas, 1);
  assert.equal(r.invalidas, 0);
  assert.deepEqual(r.linhas[0], {
    id: 244000001, gerada_em: '2026-10-02T15:14:20-03:00', conectada_em: '2026-10-02T15:14:30-03:00',
    atendida_em: '2026-10-02T15:14:32-03:00', fim_em: '2026-10-02T15:16:00-03:00', status: 'ANSWERED', agente_id: 189,
    seg_espera: 2, seg_falados: 88, seg_total: 100, tabulacao: 'SEM AVANÇO', carga_id: 14162, carga: 'ZZ-CARGA',
    campanha: 'ZZ-CAMPANHA', cnpj: '00000000000101', telefone: '11900000001', operadora_base: 'ZZ-OPERADORA',
    cidade: 'ZZCIDADE', regiao: 'SUDESTE', gravacao: '1003/2026/10/02/DIALER-1',
  });
});
test('nome e CPF nunca saem do leitor', () => {
  const l = ler([linhaDiscador()]).linhas[0];
  const s = JSON.stringify(l);
  assert.equal(s.includes('FULANO'), false);
  assert.equal(s.includes('11122233344'), false);
});
test('chamada não atendida: agente, tempos e tabulação vazios viram null', () => {
  const r = ler([linhaDiscador({
    [COL['Status']]: 'BUSY', [COL['ID do Usuário']]: null, [COL['Tempo_Espera']]: null, [COL['Tempo_Chamada']]: null,
    [COL['DataHora_Conectado']]: null, [COL['DataHora_Atendimento']]: null, [COL['Última Tabulação']]: null,
  })]);
  const l = r.linhas[0];
  assert.equal(l.status, 'BUSY');
  assert.equal(l.agente_id, null);
  assert.equal(l.seg_falados, null);
  assert.equal(l.seg_espera, null);
  assert.equal(l.tabulacao, null);
  assert.equal(l.conectada_em, null);
});
test('linha de rodapé (tem ID, sem Status) é inválida e não entra', () => {
  const rodape = Array(50).fill(null);
  rodape[COL['ID']] = 244000099;
  const r = ler([linhaDiscador(), rodape]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.invalidas, 1);
});
test('id repetido entra uma vez; ID inválido é contado', () => {
  const r = ler([linhaDiscador(), linhaDiscador(), linhaDiscador({ [COL['ID']]: 'abc' })]);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.invalidas, 1);
});
test('CNPJ como texto pontuado também vira 14 dígitos; telefone formatado vira só dígitos', () => {
  const l = ler([linhaDiscador({ [COL['Documento 2']]: '00.000.000/0001-01', [COL['Telefone']]: '(11) 90000-0001' })]).linhas[0];
  assert.equal(l.cnpj, '00000000000101');
  assert.equal(l.telefone, '11900000001');
});
test('outro relatório (sem DataHora_Geracao) → faltando = [gerada] e nenhuma linha', () => {
  const r = parseDiscador(Object.assign([{ ID: 1, Status: 'ANSWERED' }], { cabecalho: ['ID', 'Status'] }));
  assert.deepEqual(r.faltando, ['gerada']);
  assert.equal(r.lidas, 0);
  assert.equal(r.linhas.length, 0);
});
test('planilha vazia com cabeçalho certo → 0 linhas, sem faltando', () => {
  const r = ler([]);
  assert.deepEqual(r, { linhas: [], lidas: 0, invalidas: 0, faltando: [] });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd /c/Users/acer1/Downloads/apex-robo-procontact && node --test test/parseDiscador.test.js`
Expected: FAIL com `Cannot find module '../src/parseDiscador.js'`.

- [ ] **Step 4: Implementar** (`src/parseDiscador.js`)

```js
// src/parseDiscador.js
// Leitor do relatório do DISCADOR automático (Relatório → Call Center → Discador → Exportar; dialer_calls_report_*.xlsx).
// Spec: apex-smart-solutions docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md (§87).
// O layout tem colunas quase homônimas: "Data/Hora Fim" (UTC) × "DataHora_Fim" (São Paulo), "Tempo Total" (segundos) ×
// "Tempo_Total" (hh:mm:ss) e duas "Região". Por isso o casamento usa normExata, que mantém o "_".
// Nome (Nome/Desc) e CPF (Documento 1) NUNCA são lidos.
import { dataHora, segundos } from './parse.js';

export const normExata = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9_]/g, '');

// campo → nomes aceitos (já em normExata). SheetJS renomeia a 2ª "Região" para "Região_1".
const COLUNAS = {
  id: ['id'], gerada: ['datahora_geracao'], conectada: ['datahora_conectado'], atendida: ['datahora_atendimento'],
  fim: ['datahora_fim'], status: ['status'], agente: ['iddousuario'], espera: ['tempo_espera'], falados: ['tempo_chamada'],
  total: ['tempo_total'], tab: ['ultimatabulacao'], cargaId: ['codcarga'], carga: ['carga'], campanha: ['campanha'],
  cnpj: ['documento2'], telefone: ['telefone'], operadora: ['campo1'], cidade: ['campo3'], regiao: ['regiao', 'regiao_1'],
  grav: ['gravacao'],
};
const OBRIGATORIAS = ['id', 'gerada', 'status'];

export function parseDiscador(rows) {
  const out = { linhas: [], lidas: 0, invalidas: 0, faltando: [] };
  const colunas = rows && rows.length ? Object.keys(rows[0]) : (rows && Array.isArray(rows.cabecalho) ? rows.cabecalho : null);
  if (colunas === null) return out;
  const mapa = {}; // campo → lista de cabeçalhos originais, na ordem dos nomes aceitos
  Object.entries(COLUNAS).forEach(([campo, aceitos]) => {
    const achados = aceitos.map((a) => colunas.find((k) => normExata(k) === a)).filter(Boolean);
    if (achados.length) mapa[campo] = achados;
  });
  out.faltando = OBRIGATORIAS.filter((c) => !(c in mapa));
  if (out.faltando.length) return out;
  out.lidas = rows.length;

  const txt = (r, campo) => {
    for (const k of mapa[campo] || []) {
      const v = r[k];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const inteiro = (r, campo) => { const t = txt(r, campo); const n = Number(t); return t != null && Number.isInteger(n) ? n : null; };
  const seg = (r, campo) => (txt(r, campo) == null ? null : segundos(txt(r, campo)));
  const digitos = (r, campo) => { const d = (txt(r, campo) || '').replace(/\D/g, ''); return d || null; };

  const vistos = new Set();
  rows.forEach((r) => {
    const id = Number(txt(r, 'id'));
    const gerada = dataHora(txt(r, 'gerada'));
    const status = (txt(r, 'status') || '').toUpperCase();
    if (!Number.isSafeInteger(id) || id <= 0 || !gerada || !/^[A-Z_]{1,30}$/.test(status)) { out.invalidas++; return; }
    if (vistos.has(id)) return;
    vistos.add(id);
    const cnpj = digitos(r, 'cnpj');
    out.linhas.push({
      id, gerada_em: gerada,
      conectada_em: dataHora(txt(r, 'conectada')), atendida_em: dataHora(txt(r, 'atendida')), fim_em: dataHora(txt(r, 'fim')),
      status, agente_id: inteiro(r, 'agente'),
      seg_espera: seg(r, 'espera'), seg_falados: seg(r, 'falados'), seg_total: seg(r, 'total'),
      tabulacao: txt(r, 'tab'), carga_id: inteiro(r, 'cargaId'), carga: txt(r, 'carga'), campanha: txt(r, 'campanha'),
      cnpj: cnpj && cnpj.length <= 14 ? cnpj.padStart(14, '0') : null,
      telefone: digitos(r, 'telefone'),
      operadora_base: txt(r, 'operadora'), cidade: txt(r, 'cidade'), regiao: txt(r, 'regiao'), gravacao: txt(r, 'grav'),
    });
  });
  return out;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/parseDiscador.test.js`
Expected: PASS em todos. Se o teste "linha atendida" falhar só em `seg_total` porque `Tempo_Total` ficou mapeado para `Tempo Total`, o problema está em `normExata`, não no teste: corrigir o leitor.

Depois rodar a suíte inteira do robô para garantir que nada antigo quebrou:
Run: `npm test`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add src/parseDiscador.js test/fixtureDiscador.js test/parseDiscador.test.js
git commit -m "feat(discador): leitor do relatorio do discador (colunas homonimas, sem nome/CPF)"
```

---

### Task 6: Script da carga inicial (repositório do robô)

**Files:**
- Create: `scripts/carga-discador.js`

**Interfaces:**
- Consumes: `lerPlanilha` (`src/parse.js`), `parseDiscador` (Task 5), `chamar` e `enviarLotes` (`src/enviar.js`, já aceitam `url`/`token`); função `ingest-discador` (Task 4).
- Uso:
  - `node scripts/carga-discador.js <arquivo.xlsx> --dry` → imprime só contagens: lidas, válidas, inválidas, total por status, total por carga, primeira e última data.
  - `INGEST_DISCADOR_URL=... INGEST_DISCADOR_TOKEN=... node scripts/carga-discador.js <arquivo.xlsx>` → envia em lotes de 500, grava o log `final` e confere com `contar`.

- [ ] **Step 1: Escrever o script**

```js
// scripts/carga-discador.js — CARGA INICIAL do discador a partir de um Excel baixado à mão (uma vez).
// Usa o MESMO leitor do robô (parseDiscador) e a MESMA função (ingest-discador). Imprime só contagens: nada de telefone,
// CNPJ ou nome no terminal. O arquivo fica onde está (fora de qualquer repositório).
// Uso: node scripts/carga-discador.js <arquivo.xlsx> --dry
//      INGEST_DISCADOR_URL=... INGEST_DISCADOR_TOKEN=... node scripts/carga-discador.js <arquivo.xlsx>
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lerPlanilha } from '../src/parse.js';
import { parseDiscador } from '../src/parseDiscador.js';
import { chamar, enviarLotes } from '../src/enviar.js';

const [arquivo, flag] = process.argv.slice(2);
if (!arquivo || !fs.existsSync(arquivo)) { console.error('Uso: node scripts/carga-discador.js <arquivo.xlsx> [--dry]'); process.exit(2); }
const dry = flag === '--dry';

const iniciou = new Date().toISOString();
const p = parseDiscador(lerPlanilha(fs.readFileSync(arquivo)));
if (p.faltando.length) { console.error('Relatório em outro formato; faltam:', p.faltando.join(', ')); process.exit(1); }
const conta = (f) => p.linhas.reduce((m, l) => (m[f(l)] = (m[f(l)] || 0) + 1, m), {});
const datas = p.linhas.map((l) => l.gerada_em).sort();
const de = datas[0];
const ate = datas[datas.length - 1];
console.log({
  lidas: p.lidas, validas: p.linhas.length, invalidas: p.invalidas, primeira: de, ultima: ate,
  porStatus: conta((l) => l.status), porCarga: conta((l) => l.carga || '(sem carga)'),
  atendidasComAgente: p.linhas.filter((l) => l.status === 'ANSWERED' && l.agente_id != null).length,
});
if (dry) process.exit(0);

const url = process.env.INGEST_DISCADOR_URL;
const token = process.env.INGEST_DISCADOR_TOKEN;
if (!url || !token) { console.error('Defina INGEST_DISCADOR_URL e INGEST_DISCADOR_TOKEN.'); process.exit(2); }
const execucaoId = randomUUID();
let ok = false;
let erro = null;
let gravadas = 0;
try {
  ({ gravadas } = await enviarLotes({ url, token, linhas: p.linhas, execucaoId }));
  ok = true;
} catch (e) {
  erro = String(e.message || e).slice(0, 200);
}
await chamar({ url, token, corpo: {
  acao: 'final', execucao_id: execucaoId, iniciou_em: iniciou, ok, lidas: p.lidas, enviadas: p.linhas.length,
  invalidas: p.invalidas, periodo_de: de || null, periodo_ate: ate || null, erro,
} });
const { total } = await chamar({ url, token, corpo: { acao: 'contar', de, ate } });
console.log({ ok, gravadas, noBancoNoPeriodo: total, erro });
process.exit(ok && total >= p.linhas.length ? 0 : 1);
```

- [ ] **Step 2: Ensaio em seco com o Excel real** (só leitura, nada é enviado)

Run: `node scripts/carga-discador.js "C:/Users/acer1/Downloads/dialer_calls_report_20261014_164952.xlsx" --dry`
Expected (referência da spec §10.3):
- `lidas` = 139926; `invalidas` = 1 (a linha com ID e sem Status/Carga).
- `validas` = 139925.
- `porStatus.ANSWERED` = 5932; `porStatus.ABANDONED` = 2619; `porStatus.BUSY` = 76548.
- `porCarga` = `TIM-APEX-1` 45570, `ICP-D-MEI-VIVO-APEX (3)` 35830, `TIM-APEX-1 (2)` 31040, `ICP-D-MEI-VIVO-APEX (2)` 27485.
- `primeira` começa com `2026-10-01`; `ultima` começa com `2026-10-14`.

Se alguma contagem divergir, **parar** e investigar o leitor antes de seguir (superpowers:systematic-debugging).

- [ ] **Step 3: Commit**

```bash
git add scripts/carga-discador.js
git commit -m "feat(discador): script de carga inicial a partir do Excel (dry imprime so contagens)"
```

---

### Task 7: Entrada em produção (cada passo com ok explícito do Rafael)

**Files:** nenhum novo. Atualizar esta lista de checagem.

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces:
  - banco com as tabelas, as funções e outubro carregado;
  - `INGEST_DISCADOR_TOKEN` cadastrado no Supabase e guardado com o Rafael (para o Plano B virar secret do GitHub);
  - função `ingest-discador` no ar.

Antes de **cada** passo abaixo, mostrar ao Rafael o que vai rodar e esperar o "ok". Um ok não vale para o passo seguinte.

- [ ] **Step 1: Aplicar a migration de estrutura**

`mcp__supabase__apply_migration` com o nome `discador_chamadas` e o conteúdo de `supabase/migrations/20261014100000_discador_chamadas.sql`. Depois rodar `supabase/tests/discador_chamadas_check.sql` com `mcp__supabase__execute_sql`.
Expected: o check termina sem exceção (ROLLBACK).

- [ ] **Step 2: Aplicar a migration de métricas**

`mcp__supabase__apply_migration` com o nome `discador_metricas` e o conteúdo de `20261014100100_discador_metricas.sql`. Depois rodar `supabase/tests/discador_metricas_check.sql`.
Expected: sem exceção. Se o arquivo passar de ~20 KB e der `Invalid or expired requestState`, dividir em duas chamadas: as funções em uma e o bloco de grants em outra.

- [ ] **Step 3: Gerar o token e publicar a função**

Gerar o token localmente, sem imprimir no chat:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))" > "$TMPDIR/discador_token.txt"
```

O Rafael cadastra o token: `npx supabase secrets set INGEST_DISCADOR_TOKEN=$(cat "$TMPDIR/discador_token.txt") --project-ref mdgfboijyqfkggcrhptn`.

Publicar, do worktree: `npx supabase functions deploy ingest-discador --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api`.

Testar a recusa sem token: `curl -s -o /dev/null -w "%{http_code}" -X POST https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-discador -d '{}'`
Expected: `401`.

- [ ] **Step 4: Carga inicial de outubro**

Do repositório do robô:

```bash
INGEST_DISCADOR_URL=https://mdgfboijyqfkggcrhptn.supabase.co/functions/v1/ingest-discador INGEST_DISCADOR_TOKEN=$(cat "$TMPDIR/discador_token.txt") node scripts/carga-discador.js "C:/Users/acer1/Downloads/dialer_calls_report_20261014_164952.xlsx"
```

Expected: `ok: true`, `gravadas: 139925`, `noBancoNoPeriodo` ≥ 139925. São ~280 lotes, alguns minutos.

- [ ] **Step 5: Conferir os totais no banco (leitura)**

```sql
select count(*) total,
       count(*) filter (where status = 'ANSWERED') answered,
       count(*) filter (where status = 'ABANDONED') abandoned,
       count(*) filter (where cnpj is null) sem_cnpj,
       count(distinct agente_id) agentes
  from public.discador_chamadas;
select carga, count(*) from public.discador_chamadas group by 1 order by 2 desc;
select count(*) from public.discador_sync_log where ok;
```

Expected: total 139925, answered 5932, abandoned 2619, sem_cnpj perto de 0, agentes 14; as cargas batem com a Task 6, Step 2; um log ok.

- [ ] **Step 6: Reenvio idempotente**

Rodar o Step 4 de novo. Expected: `count(*)` continua 139925 e aparece um segundo log ok.

- [ ] **Step 7: Conferir as funções com dado real** (como postgres, simulando o supervisor dentro de uma transação)

```sql
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where role = 'supervisor' limit 1), true);
select * from public.discador_resumo('2026-10-01', '2026-10-14');
select * from public.discador_mailing('2026-10-01', '2026-10-14', 'carga');
select count(*) from public.discador_agentes_sem_vinculo();
rollback;
```

Expected:
- resumo: tentativas 139925, contato 8551, atendidas por volta de 5932, abandonadas 2619;
- `vendas` maior ou igual a 0. Anotar o número para comparar com a planilha da operação;
- mailing: 4 cargas;
- sem vínculo: 14 (o Rafael ainda não vinculou ninguém).

- [ ] **Step 8: Registrar o estado**

Atualizar a memória da frente (`apex-frentes-estado`). Nenhum push ainda: o push no oficial e a REGRAS §87 acontecem na publicação do Plano C.

```bash
git -C "C:/Users/acer1/Downloads/apex-smart-solutions/.worktrees/discador-supervisao" log --oneline -5
git -C "C:/Users/acer1/Downloads/apex-robo-procontact" log --oneline -3
```

---

## Self-Review (feito ao escrever)

- **Cobertura da spec:**
  - §4.1/4.2/4.3 → Task 1;
  - §5 → Tasks 3 e 4;
  - §7 → Task 2;
  - §9 (nome/CPF, repositório público, token próprio) → Tasks 3, 5 e 6;
  - §10.1/10.2/10.3 → Tasks 3, 2 e 7;
  - §11 passos 1–2 → Task 7.
  - Ficam para os Planos B e C: §6 (robô no ar), §8 (painel) e §11 passos 3–5.
- **Nomes consistentes:** `LinhaDiscador` (Task 3) = chaves do `parseDiscador` (Task 5) + `chave_tel`; `discador_vendas_atribuidas` devolve `agente_id`, `carga`, `operadora_base` e `cidade`, que é o que consultores e mailing usam; `INGEST_DISCADOR_TOKEN` e `x-robo-token` aparecem iguais nas Tasks 4, 6 e 7.
- **Review Focus:**
  - item 1 → Task 5 (normExata e região);
  - item 2 → Task 5 (rodapé);
  - item 3 → Tasks 2 (CNPJ pontuado no NEO) e 5 (CNPJ numérico);
  - item 4 → Task 2;
  - item 5 → Task 3 (id repetido) e Task 7, Step 6.
