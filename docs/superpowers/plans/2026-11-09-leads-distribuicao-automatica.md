# Distribuição automática de leads — §146.1 (banco + sombra + Equipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no banco o motor de distribuição automática de leads (nota = conversão + velocidade, rodízio ponderado com piso/teto, trava de pendência, devolução em 15 min, confirmação pelo ProContact), com modos Manual/Sombra/Automático, presença dos consultores e a faixa "Distribuição" na aba Equipe, e ligar em **Sombra**.

**Architecture:** Tudo mora no Postgres (Supabase `mdgfboijyqfkggcrhptn`). `leads_entrada2` (ponto único de entrada: webhook da Meta e planilha-espelho) chama `leads_distribuir` para cada lead novo; um pg_cron de 1 min roda `leads_dist_tick` (confirmação, devolução, fila). O painel só manda presença, registra o clique no telefone pela RPC que já existe (`registrar_contato_lead`) e mostra/configura na Equipe. Com `modo = manual` (padrão) tudo é inerte, exceto juntar dados de velocidade das entregas "pegou".

**Tech Stack:** PL/pgSQL (Supabase, pg_cron), painel em HTML/JS único (`_template.html` → `python build_painel.py` → `painel_clientes_apex.html`), testes de painel em Node + jsdom (`painel_teste_base.js`), conferência de banco em SQL dentro de transação desfeita.

**Spec:** `docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md` (ler inteira antes de começar).

## Global Constraints

- Banco é **produção**. Os checks rodam com `execute_sql` dentro de `begin` + DO que termina em `raise exception 'RESULTADO: …'` (tudo desfeito). **Nenhum `commit` no banco antes da Task 7, e a Task 7 só com ok do Rafael naquela hora.**
- Migrations **sem DROP** (o conector do Supabase falha com DROP). Aplicar com `execute_sql` (`begin; … commit;`), nunca `apply_migration`.
- Toda função nova: `security definer set search_path to 'public'`; `revoke execute … from public, anon` e `grant … to authenticated` só nas chamadas pelo painel (`leads_presenca_ping`, `leads_dist_equipe`, `leads_dist_config`); internas com `revoke … from public, anon, authenticated`.
- Horário de São Paulo sempre pelo Postgres: `now() at time zone 'America/Sao_Paulo'` (o relógio do Git Bash é UTC).
- Repo é **público**: nada de telefone, CNPJ, e-mail ou nome real de cliente em teste, migration ou log. Dados de teste fictícios ("Lead Teste", telefones `(11) 90000-00NN`).
- Padrões de configuração (spec §9), copiados literalmente: `modo manual`, `peso_conversao 0.5`, `piso 0.15`, `teto 0.40`, `prazo_atender_min 5`, `prazo_devolver_min 15`, `confirmar_min 20`, `janela_dias 14`, `maturacao_dias 2`, `pausa_min 60`, `presenca_min 3`, `max_devolucoes 2`, `suav_conv 10`, `suav_vel 3`, `vel_ultimas 10`, `robo_parado_min 30`, expediente `dias [1,2,3,4,5]`, `13:00`–`21:00`.
- Visual "Sinal de Ápice": nada de CSS novo além do mínimo; reaproveitar `.kbEqPegar`, `.kbEqTabela`, `.kbBtn kbBtnSm kbBtnP/kbBtnG/kbBtnQ`, `.kbSeg`, `.kbMuted`, `.kbEqLegenda`.
- `_template.html` em LF; editar só o template e regenerar com `python build_painel.py`. Contar `<div>`/`</div>` antes de publicar.
- Trabalhar na worktree `C:\Users\acer1\Downloads\apex-smart-solutions\.worktrees\leads-distribuicao` (branch `feat/leads-distribuicao`). Nada de push até a Task 7.

### Refinamentos sobre a spec (decididos ao ler o código, valem para todas as tasks)

1. **Clique no telefone** reaproveita a RPC existente `registrar_contato_lead(p_aba, p_lead_id, 'ligar')` (grava em `leads_contatos`, que já alimenta o "primeiro clique" do Quadro). Um gatilho em `leads_contatos` marca o atendimento. **Não** existe `leads_contato_registrar`.
2. Entrega "aguardando" = linha de `leads_distribuicao` com `consultor_id` nulo e `fechado_em` nulo (não há `tipo = 'aguardando'`; `tipo` ∈ `auto`, `pegou`, `redistribuido`). Uma só linha aberta por lead (índice único parcial).
3. **Pendência** (trava) = entrega `auto`/`pegou` aberta, sem atendimento, recebida há menos de `prazo_devolver_min` (15 min). Assim um "pegou" esquecido não trava o consultor para sempre.
4. "Devolver" é só do gestor (`leads_redistribuir` com `p_novo` nulo): fecha a entrega e **não** volta ao motor (decisão do gestor).
5. `leads_dist_motivo`, `leads_dist_meu`, a parte do consultor e os textos da linha do tempo para as ações novas (`distribuir`, `devolver_auto`, que só aparecem no Automático) ficam para o plano da §146.2. O relatório da sombra vem dentro de `leads_dist_equipe(p_dias)` (campos `teria` × `recebeu`).
6. Índice novo `ligacoes_manuais (importado_em)` para o tick saber, barato, quando o robô importou pela última vez (o `id` da tabela não é sequencial de importação).

## Review Focus

- **Lead entrando com o motor quebrado** (config inválida, função com erro): o lead TEM que entrar e ficar nos Livres; o erro vai para `leads_distribuicao_aviso.motor_erro`. → Task 4, check item 9.
- **Dois leads chegando juntos** (webhook + planilha no mesmo segundo): nunca os dois para a mesma pessoa pendente, nunca o mesmo lead para dois. → Task 3 itens 2–3 (sequencial com trava) e índice único parcial (Task 1 item 9).
- **Robô do ProContact parado**: ninguém pode perder crédito; confirmação fica suspensa e aparece aviso. → Task 4 item 8.
- **Consultor que pegou lead nos Livres e esqueceu**: depois de 15 min não pode continuar travado para o automático. → Task 3 item 13.
- **Sombra ligada por dias**: a fila não pode crescer sem fim nem sombrear o mesmo lead toda volta do tick; ao pegar nos Livres a linha da fila fecha. → Task 4 itens 3 e 10.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261109120000_leads_dist_base.sql` | Tabelas, índices, config, `leads_dist_cfg`, `leads_dist_no_expediente`, `leads_dist_aviso`, `leads_presenca_ping`, gatilhos de atendimento (tabulação e clique) |
| `supabase/migrations/20261109120100_leads_dist_notas.sql` | `leads_dist_fatias` (piso/teto), `leads_dist_notas_base`, `leads_dist_notas` |
| `supabase/migrations/20261109120200_leads_dist_motor.sql` | `leads_dist_escolher`, `leads_distribuir` (motor + sombra) |
| `supabase/migrations/20261109120300_leads_dist_tick.sql` | `leads_dist_tick`; novas versões de `leads_entrada2`, `leads_pegar`, `leads_redistribuir` com os ganchos |
| `supabase/migrations/20261109120400_leads_dist_painel.sql` | `leads_dist_equipe`, `leads_dist_validar`, `leads_dist_config` |
| `supabase/migrations/20261109120500_leads_dist_cron.sql` | `cron.schedule('leads-dist-tick', …)` (só na Task 7) |
| `supabase/tests/leads_dist_montar.py` | Junta `begin` + migrations + fixture + check num arquivo para o `execute_sql` |
| `supabase/tests/leads_dist_fixture.sql` | 3 consultores fictícios, config de teste, helpers `pg_temp.*` |
| `supabase/tests/leads_dist_{base,notas,motor,tick,painel}_check.sql` | Conferência de cada migration |
| `test_leads_distribuicao.js` | Testes do painel (presença, clique, faixa Distribuição) |
| `_template.html` | Presença, clique → `registrar_contato_lead`, faixa e tabela da Distribuição na Equipe |
| `REGRAS_NEGOCIO.md` | §146 / §146.1 |

### Como rodar um check (vale para todas as tasks de banco)

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/leads-distribuicao
python supabase/tests/leads_dist_montar.py <saida.sql> [<migration1.sql> <migration2.sql> …] -- <check.sql>
```

O script escreve em `<saida.sql>` (use o scratchpad da sessão) e imprime o tamanho. Ler o arquivo e passar o conteúdo inteiro para `mcp__supabase__execute_sql` (project_id `mdgfboijyqfkggcrhptn`). O resultado esperado é **um erro** com a mensagem `RESULTADO: 1 ok; 2 ok; …`. Qualquer item `FALHOU` reprova. Se o conector responder `Invalid or expired requestState` (tamanho), **parar e avisar o Rafael**: a saída é aplicar de verdade as migrations anteriores (inertes com `modo = manual`) e rodar o check só com a migration da task, e isso exige o ok dele.

---

### Task 1: Base — tabelas, configuração, presença e gatilhos de atendimento

**Files:**
- Create: `supabase/tests/leads_dist_montar.py`
- Create: `supabase/tests/leads_dist_fixture.sql`
- Create: `supabase/tests/leads_dist_base_check.sql`
- Create: `supabase/migrations/20261109120000_leads_dist_base.sql`

**Interfaces:**
- Consumes: `public.config(chave text, valor text, atualizado_em)`, `public.leads_equipe`, `public.leads`, `public.leads_contatos(lead_aba, lead_id, profile_id, canal, em)`, `public.registrar_contato_lead(text, text, text)`, `public.get_my_role()`.
- Produces:
  - tabelas `leads_distribuicao`, `leads_presenca`, `leads_dist_sombra` (colunas abaixo);
  - `leads_dist_cfg() returns jsonb` (padrões || gravado);
  - `leads_dist_no_expediente(p_ts timestamptz default now()) returns boolean`;
  - `leads_dist_aviso(p_chave text, p_valor jsonb) returns void` (`p_valor` nulo apaga a chave);
  - `leads_presenca_ping(p_acao text default null) returns jsonb` → `{equipe bool, pausa_ate timestamptz|null}`; `p_acao` ∈ `null`, `'pausa'`, `'voltar'`;
  - gatilhos `leads_dist_tabulou` (em `leads`) e `leads_dist_clicou` (em `leads_contatos`).

- [ ] **Step 1: Escrever o montador**

`supabase/tests/leads_dist_montar.py`:

```python
# §146.1: monta o SQL de conferência: begin + migrations (sem begin/commit) + fixture + check.
# O check termina com raise exception 'RESULTADO: ...' -> tudo é desfeito. Uso:
#   python supabase/tests/leads_dist_montar.py SAIDA.sql [MIG1.sql MIG2.sql ...] -- CHECK.sql   (sem migration = banco como está)
import pathlib, sys

def corpo(p):
    linhas = pathlib.Path(p).read_text(encoding='utf-8').splitlines()
    return '\n'.join(l for l in linhas if l.strip().lower() not in ('begin;', 'commit;'))

args = sys.argv[1:]
if len(args) < 3 or '--' not in args:
    sys.exit('uso: leads_dist_montar.py SAIDA.sql [MIG1.sql ...] -- CHECK.sql')
saida, resto = args[0], args[1:]
i = resto.index('--')
migs, check = resto[:i], resto[i + 1]
aqui = pathlib.Path(__file__).parent
partes = ['begin;'] + [corpo(m) for m in migs] + [corpo(aqui / 'leads_dist_fixture.sql'), corpo(check)]
texto = '\n\n'.join(partes) + '\n'
pathlib.Path(saida).write_text(texto, encoding='utf-8')
print(f'{saida}: {len(texto.encode("utf-8"))} bytes')
```

- [ ] **Step 2: Escrever a fixture**

`supabase/tests/leads_dist_fixture.sql`:

```sql
-- §146.1: fixture comum dos checks (dados FICTÍCIOS; o DO do check termina em exceção e desfaz tudo).
-- 3 consultores de teste usando perfis que não têm lead nem estão na equipe; o resto da equipe deixa de pegar.
update public.leads_equipe set pode_pegar = false where pode_pegar;
create temp table ld_cons on commit drop as
  select p.id, row_number() over (order by p.id)::int n
    from public.profiles p
   where p.id not in (select dono_id from public.leads where dono_id is not null)
     and p.id not in (select profile_id from public.leads_equipe where profile_id is not null)
     and coalesce(p.role, '') not in ('admin', 'supervisor')
   order by p.id limit 3;
insert into public.leads_equipe (nome_planilha, usuario_telefonia, profile_id, monitorar, desde, pode_pegar)
  select 'Teste Dist ' || chr(64 + n), 'teste.dist.' || lower(chr(64 + n)), id, false, current_date, true from ld_cons;
insert into public.config (chave, valor) select 'leads_distribuicao', '{}' where not exists (select 1 from public.config where chave = 'leads_distribuicao');
update public.config set valor = '{"modo":"automatico","expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}' where chave = 'leads_distribuicao';
insert into public.config (chave, valor) select 'leads_pegar_bloqueado', '{"bloqueado":false}' where not exists (select 1 from public.config where chave = 'leads_pegar_bloqueado');
update public.config set valor = '{"bloqueado":false}' where chave = 'leads_pegar_bloqueado';
create function pg_temp.ld_c(p_n int) returns uuid language sql as $$ select id from ld_cons where n = p_n $$;
create function pg_temp.ld_admin() returns uuid language sql as $$ select id from public.profiles where role = 'admin' order by created_at limit 1 $$;
create function pg_temp.ld_como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create function pg_temp.ld_cfg(p jsonb) returns void language sql as $$
  update public.config set valor = (coalesce(valor::jsonb, '{}') || p)::text where chave = 'leads_distribuicao' $$;
create function pg_temp.ld_presente(p_uid uuid) returns void language sql as $$
  insert into public.leads_presenca (profile_id, visto_em, pausa_ate) values (p_uid, now(), null)
  on conflict (profile_id) do update set visto_em = now(), pausa_ate = null $$;
-- lead fictício sem dono (n = 1..99 → telefone (11) 90000-00NN)
create function pg_temp.ld_lead(p_id text, p_n int) returns void language sql as $$
  insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, categoria, converteu, receita, atualizado_em, primeira_sync_em, origem_entrada)
  values ('TESTE DIST', p_id, now(), 'Lead Teste', '(11) 90000-00' || lpad(p_n::text, 2, '0'), 'sem_contato', false, 0, now(), now(), 'planilha') $$;
-- entrega aberta fictícia
create function pg_temp.ld_entrega(p_id text, p_uid uuid, p_tipo text, p_recebido timestamptz) returns bigint language sql as $$
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em)
  values ('TESTE DIST', p_id, p_uid, p_tipo, p_recebido) returning id $$;
```

- [ ] **Step 3: Escrever o check (falha antes da migration)**

`supabase/tests/leads_dist_base_check.sql`:

```sql
-- §146.1 Task 1: conferência de 20261109120000_leads_dist_base.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; v_id bigint; n int;
begin
  -- 1. padrões
  v_out := v_out || case when (public.leads_dist_cfg() ->> 'piso')::numeric = 0.15 and (public.leads_dist_cfg() ->> 'prazo_devolver_min')::int = 15
                          and public.leads_dist_cfg() ->> 'modo' = 'automatico' then '1 ok; ' else '1 FALHOU ' || public.leads_dist_cfg()::text || '; ' end;
  -- 2. expediente
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5],"inicio":"13:00","fim":"21:00"}}');
  v_out := v_out || case when public.leads_dist_no_expediente('2026-11-09 15:00-03') and not public.leads_dist_no_expediente('2026-11-09 22:00-03')
                          and not public.leads_dist_no_expediente('2026-11-08 15:00-03') and not public.leads_dist_no_expediente('2026-11-09 12:59-03')
                     then '2 ok; ' else '2 FALHOU; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  v_out := v_out || case when not public.leads_dist_no_expediente(now()) then '2b ok; ' else '2b FALHOU; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  v_out := v_out || case when public.leads_dist_no_expediente(now()) then '2c ok; ' else '2c FALHOU; ' end;
  -- 3. presença e pausa
  perform pg_temp.ld_como(v_a);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when (r ->> 'equipe')::boolean and r ->> 'pausa_ate' is null
                          and exists (select 1 from public.leads_presenca where profile_id = v_a and visto_em > now() - interval '1 second') then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  r := public.leads_presenca_ping('pausa');
  v_out := v_out || case when (r ->> 'pausa_ate')::timestamptz between now() + interval '59 minutes' and now() + interval '61 minutes' then '3b ok; ' else '3b FALHOU ' || r::text || '; ' end;
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r ->> 'pausa_ate' is not null then '3c ok; ' else '3c FALHOU (ping comum tirou a pausa); ' end;
  r := public.leads_presenca_ping('voltar');
  v_out := v_out || case when r ->> 'pausa_ate' is null then '3d ok; ' else '3d FALHOU; ' end;
  -- 4. fora da equipe: não grava
  perform pg_temp.ld_como(gen_random_uuid());
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when not (r ->> 'equipe')::boolean then '4 ok; ' else '4 FALHOU; ' end;
  -- 5. ação inválida
  perform pg_temp.ld_como(v_a);
  begin perform public.leads_presenca_ping('dormir'); v_out := v_out || '5 FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '5 ok; ' else '5 FALHOU ' || sqlerrm || '; ' end; end;
  -- 6. clique no telefone (registrar_contato_lead 'ligar') marca a entrega aberta do dono
  perform pg_temp.ld_lead('ld-1', 1);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-1';
  v_id := pg_temp.ld_entrega('ld-1', v_a, 'auto', now() - interval '2 minutes');
  perform public.registrar_contato_lead('TESTE DIST', 'ld-1', 'ligar');
  v_out := v_out || case when (select sinal = 'clique' and atendido_em is not null from public.leads_distribuicao where id = v_id) then '6 ok; ' else '6 FALHOU; ' end;
  -- 6b. WhatsApp não conta como atendimento
  perform pg_temp.ld_lead('ld-1b', 11);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-1b';
  v_id := pg_temp.ld_entrega('ld-1b', v_a, 'auto', now());
  perform public.registrar_contato_lead('TESTE DIST', 'ld-1b', 'whatsapp');
  v_out := v_out || case when (select atendido_em is null from public.leads_distribuicao where id = v_id) then '6b ok; ' else '6b FALHOU; ' end;
  -- 7. clique de outra pessoa (gestor) não marca a entrega do dono
  perform pg_temp.ld_lead('ld-2', 2);
  update public.leads set dono_id = v_a, consultor = 'Teste Dist A', pego_em = now() where aba = 'TESTE DIST' and id = 'ld-2';
  v_id := pg_temp.ld_entrega('ld-2', v_a, 'auto', now());
  perform pg_temp.ld_como(pg_temp.ld_admin());
  perform public.registrar_contato_lead('TESTE DIST', 'ld-2', 'ligar');
  v_out := v_out || case when (select atendido_em is null from public.leads_distribuicao where id = v_id) then '7 ok; ' else '7 FALHOU; ' end;
  -- 8. tabulação marca a entrega aberta do dono (sinal tabulacao)
  update public.leads set classificado_em = now() where aba = 'TESTE DIST' and id = 'ld-2';
  v_out := v_out || case when (select sinal = 'tabulacao' and atendido_em is not null from public.leads_distribuicao where id = v_id) then '8 ok; ' else '8 FALHOU; ' end;
  -- 9. só uma entrega aberta por lead
  begin perform pg_temp.ld_entrega('ld-2', v_b, 'auto', now()); v_out := v_out || '9 FALHOU; ';
  exception when unique_violation then v_out := v_out || '9 ok; '; end;
  -- 10. aviso grava e apaga
  perform public.leads_dist_aviso('teste', '"x"');
  perform public.leads_dist_aviso('teste', null);
  v_out := v_out || case when not ((select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'teste') then '10 ok; ' else '10 FALHOU; ' end;
  -- 11. RLS: authenticated não lê as tabelas novas direto
  execute 'set local role authenticated';
  begin
    select count(*) into n from public.leads_distribuicao;
    v_out := v_out || case when n = 0 then '11 ok' else '11 FALHOU' end;
  exception when insufficient_privilege then v_out := v_out || '11 ok';
  end;
  execute 'reset role';
  raise exception 'RESULTADO: %', v_out;
end $$;
```

- [ ] **Step 4: Rodar o check sem a migration (deve falhar)**

Montar só fixture + check (sem migration):

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t1.sql" -- supabase/tests/leads_dist_base_check.sql
```

Executar no `execute_sql`. Esperado: erro `relation "public.leads_presenca" does not exist` (a fixture já cria funções que usam as tabelas novas). Isso NÃO é o `RESULTADO`.

- [ ] **Step 5: Escrever a migration**

`supabase/migrations/20261109120000_leads_dist_base.sql`:

```sql
-- §146.1 (09/11, Rafael): base da distribuição automática de leads.
-- Spec: docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md · Plano: docs/superpowers/plans/2026-11-09-leads-distribuicao-automatica.md
-- Entregas (leads_distribuicao), presença (leads_presenca), sombra (leads_dist_sombra), configuração e sinais de atendimento.
-- Inerte com modo = manual (padrão). Sem DROP. Aplicar com execute_sql (begin/commit). Check: supabase/tests/leads_dist_base_check.sql.
begin;

-- Uma linha por entrega de lead. consultor_id nulo + fechado_em nulo = aguardando o motor.
create table if not exists public.leads_distribuicao (
  id bigserial primary key,
  lead_aba text not null,
  lead_id text not null,
  consultor_id uuid,
  tipo text not null default 'auto' check (tipo in ('auto', 'pegou', 'redistribuido')),
  criado_em timestamptz not null default now(),
  recebido_em timestamptz,
  atendido_em timestamptz,
  sinal text check (sinal in ('clique', 'tabulacao')),
  confirmado boolean,
  confirmado_em timestamptz,
  devolvido_em timestamptz,
  fechado_em timestamptz,
  devolucoes int not null default 0,
  excluidos uuid[] not null default '{}',
  motivo jsonb
);
create unique index if not exists leads_distribuicao_lead_aberta on public.leads_distribuicao (lead_aba, lead_id) where fechado_em is null;
create index if not exists leads_distribuicao_consultor on public.leads_distribuicao (consultor_id, recebido_em desc);
create index if not exists leads_distribuicao_confirmar on public.leads_distribuicao (atendido_em) where atendido_em is not null and confirmado is null;
alter table public.leads_distribuicao enable row level security;

create table if not exists public.leads_presenca (
  profile_id uuid primary key,
  visto_em timestamptz not null default now(),
  pausa_ate timestamptz
);
alter table public.leads_presenca enable row level security;

create table if not exists public.leads_dist_sombra (
  id bigserial primary key,
  lead_aba text not null,
  lead_id text not null,
  em timestamptz not null default now(),
  escolhido uuid,
  motivo jsonb
);
create unique index if not exists leads_dist_sombra_lead on public.leads_dist_sombra (lead_aba, lead_id);
create index if not exists leads_dist_sombra_em on public.leads_dist_sombra (em);
alter table public.leads_dist_sombra enable row level security;
-- sem policies: ninguém lê nem grava direto; só pelas funções abaixo (security definer)
revoke all on public.leads_distribuicao, public.leads_presenca, public.leads_dist_sombra from anon, authenticated;

-- o tick pergunta "quando o robô importou pela última vez" a cada minuto
create index if not exists idx_ligacoes_importado on public.ligacoes_manuais (importado_em);

insert into public.config (chave, valor) select 'leads_distribuicao', '{"modo":"manual"}'
 where not exists (select 1 from public.config where chave = 'leads_distribuicao');
insert into public.config (chave, valor) select 'leads_distribuicao_aviso', '{}'
 where not exists (select 1 from public.config where chave = 'leads_distribuicao_aviso');

-- Padrões + o gravado (o gravado ganha). Chaves: spec §9.
create or replace function public.leads_dist_cfg()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select '{"modo":"manual","peso_conversao":0.5,"piso":0.15,"teto":0.40,"prazo_atender_min":5,"prazo_devolver_min":15,
           "confirmar_min":20,"janela_dias":14,"maturacao_dias":2,"pausa_min":60,"presenca_min":3,"max_devolucoes":2,
           "suav_conv":10,"suav_vel":3,"vel_ultimas":10,"robo_parado_min":30,
           "expediente":{"dias":[1,2,3,4,5],"inicio":"13:00","fim":"21:00"}}'::jsonb
         || coalesce((select c.valor::jsonb from public.config c where c.chave = 'leads_distribuicao'), '{}'::jsonb)
$function$;

-- Expediente em São Paulo (isodow: 1 = segunda … 7 = domingo). fim '24:00' = até o fim do dia.
create or replace function public.leads_dist_no_expediente(p_ts timestamptz default now())
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $function$
declare e jsonb := public.leads_dist_cfg() -> 'expediente'; l timestamp := p_ts at time zone 'America/Sao_Paulo';
begin
  if not exists (select 1 from jsonb_array_elements_text(coalesce(e -> 'dias', '[]'::jsonb)) d where d::int = extract(isodow from l)::int) then
    return false;
  end if;
  return l::time >= (e ->> 'inicio')::time and l::time < (e ->> 'fim')::time;
end $function$;

-- Avisos para a Equipe (motor_erro, robo_parado, parados). p_valor nulo apaga a chave.
create or replace function public.leads_dist_aviso(p_chave text, p_valor jsonb)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  select coalesce(c.valor::jsonb, '{}'::jsonb) into v from public.config c where c.chave = 'leads_distribuicao_aviso';
  v := coalesce(v, '{}'::jsonb);
  v := case when p_valor is null then v - p_chave else jsonb_set(v, array[p_chave], p_valor, true) end;
  update public.config set valor = v::text, atualizado_em = now() where chave = 'leads_distribuicao_aviso';
  if not found then insert into public.config (chave, valor) values ('leads_distribuicao_aviso', v::text); end if;
end $function$;

-- Painel aberto avisa a cada 1 min. 'pausa' = fora da vez por pausa_min; 'voltar' = tira a pausa.
create or replace function public.leads_presenca_ping(p_acao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pausa timestamptz; v_min int := (public.leads_dist_cfg() ->> 'pausa_min')::int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if coalesce(p_acao, '') not in ('', 'pausa', 'voltar') then raise exception 'ação inválida: %', p_acao using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    return jsonb_build_object('equipe', false, 'pausa_ate', null);
  end if;
  insert into public.leads_presenca as p (profile_id, visto_em, pausa_ate)
  values (auth.uid(), now(), case when p_acao = 'pausa' then now() + make_interval(mins => v_min) end)
  on conflict (profile_id) do update set visto_em = now(),
    pausa_ate = case when p_acao = 'pausa' then now() + make_interval(mins => v_min)
                     when p_acao = 'voltar' then null else p.pausa_ate end
  returning p.pausa_ate into v_pausa;
  return jsonb_build_object('equipe', true, 'pausa_ate', case when v_pausa > now() then v_pausa end);
end $function$;

-- Tabulação (leads.classificado_em) conta como atendimento da entrega aberta do dono.
create or replace function public.leads_dist_tabulou()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.classificado_em is not null and new.classificado_em is distinct from old.classificado_em and new.dono_id is not null then
    update public.leads_distribuicao set atendido_em = new.classificado_em, sinal = 'tabulacao'
     where lead_aba = new.aba and lead_id = new.id and consultor_id = new.dono_id and fechado_em is null and atendido_em is null;
  end if;
  return new;
end $function$;

-- Clique "ligar" (registrar_contato_lead → leads_contatos) conta como atendimento, se for do dono da entrega.
create or replace function public.leads_dist_clicou()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.canal = 'ligar' then
    update public.leads_distribuicao set atendido_em = new.em, sinal = 'clique'
     where lead_aba = new.lead_aba and lead_id = new.lead_id and consultor_id = new.profile_id and fechado_em is null and atendido_em is null;
  end if;
  return new;
end $function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'leads_dist_tabulou' and tgrelid = 'public.leads'::regclass) then
    create trigger leads_dist_tabulou after update of classificado_em on public.leads
      for each row execute function public.leads_dist_tabulou();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'leads_dist_clicou' and tgrelid = 'public.leads_contatos'::regclass) then
    create trigger leads_dist_clicou after insert on public.leads_contatos
      for each row execute function public.leads_dist_clicou();
  end if;
end $$;

revoke execute on function public.leads_dist_cfg() from public, anon, authenticated;
revoke execute on function public.leads_dist_no_expediente(timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_aviso(text, jsonb) from public, anon, authenticated;
revoke execute on function public.leads_dist_tabulou() from public, anon, authenticated;
revoke execute on function public.leads_dist_clicou() from public, anon, authenticated;
revoke execute on function public.leads_presenca_ping(text) from public, anon;
grant execute on function public.leads_presenca_ping(text) to authenticated;

commit;
```

- [ ] **Step 6: Rodar o check com a migration**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t1.sql" supabase/migrations/20261109120000_leads_dist_base.sql -- supabase/tests/leads_dist_base_check.sql
```

Executar no `execute_sql`. Esperado: `RESULTADO: 1 ok; 2 ok; 2b ok; 2c ok; 3 ok; 3b ok; 3c ok; 3d ok; 4 ok; 5 ok; 6 ok; 6b ok; 7 ok; 8 ok; 9 ok; 10 ok; 11 ok`. Se o item 6 falhar com `sem permissão`, conferir que a fixture grava `leads.consultor = 'Teste Dist A'` (a RPC antiga confere pelo nome).

- [ ] **Step 7: Commit**

```bash
git add supabase/tests/leads_dist_montar.py supabase/tests/leads_dist_fixture.sql supabase/tests/leads_dist_base_check.sql supabase/migrations/20261109120000_leads_dist_base.sql
git commit -m "feat(leads): §146.1 base da distribuição (entregas, presença, sinais de atendimento)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Nota e fatia de cada consultor

**Files:**
- Create: `supabase/migrations/20261109120100_leads_dist_notas.sql`
- Create: `supabase/tests/leads_dist_notas_check.sql`

**Interfaces:**
- Consumes (Task 1): `leads_dist_cfg()`, `leads_distribuicao`, `leads_presenca`.
- Produces:
  - `leads_dist_fatias(p_notas numeric[], p_piso numeric, p_teto numeric) returns numeric[]` (soma 1; cada valor entre piso e teto; com limite impossível divide igual);
  - `leads_dist_notas_base(p_agora timestamptz default now()) returns table (consultor_id uuid, nome text, ativo boolean, conv numeric, vel numeric, nota numeric, recebidos_hoje int, ultimo_recebido timestamptz, vel_n int, vel_ok int)`;
  - `leads_dist_notas(p_agora timestamptz default now())` → mesmas colunas + `fatia numeric` (nula para quem não está ativo hoje), nesta ordem: `consultor_id, nome, ativo, conv, vel, nota, fatia, recebidos_hoje, ultimo_recebido, vel_n, vel_ok`.

- [ ] **Step 1: Escrever o check**

`supabase/tests/leads_dist_notas_check.sql`:

```sql
-- §146.1 Task 2: conferência de 20261109120100_leads_dist_notas.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; f numeric[]; ra record; rb record; rc record; i int; s numeric;
begin
  -- 1. fatias: teto prende o maior e o resto divide
  f := public.leads_dist_fatias(array[3,1,1,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.40,0.20,0.20,0.20]::numeric[] then '1 ok; ' else '1 FALHOU ' || f::text || '; ' end;
  -- 2. nota zero recebe o piso, nunca zero
  f := public.leads_dist_fatias(array[1,1,1,1,0]::numeric[], 0.15, 0.40);
  v_out := v_out || case when round(f[5], 4) = 0.15 and round(f[1], 4) = 0.2125 then '2 ok; ' else '2 FALHOU ' || f::text || '; ' end;
  -- 3. dois no teto, terceiro com o resto
  f := public.leads_dist_fatias(array[5,5,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.40,0.40,0.20]::numeric[] then '3 ok; ' else '3 FALHOU ' || f::text || '; ' end;
  -- 4. limite impossível (2 pessoas, teto 40%) divide igual; vazio devolve vazio
  f := public.leads_dist_fatias(array[9,1]::numeric[], 0.15, 0.40);
  v_out := v_out || case when f = array[0.5,0.5]::numeric[] and public.leads_dist_fatias('{}'::numeric[], 0.15, 0.40) = '{}'::numeric[] then '4 ok; ' else '4 FALHOU ' || f::text || '; ' end;
  -- 5. soma sempre 1 e limites respeitados (notas variadas)
  f := public.leads_dist_fatias(array[0.3,2.5,1.1,0.9,0.05,1.7]::numeric[], 0.10, 0.30);
  s := 0; for i in 1..6 loop s := s + f[i]; end loop;
  v_out := v_out || case when round(s, 6) = 1 and (select bool_and(x between 0.10 - 1e-9 and 0.30 + 1e-9) from unnest(f) x) then '5 ok; ' else '5 FALHOU ' || f::text || '; ' end;

  -- Velocidade: A atendeu 10 de 10 em 2 min; B atendeu 10 de 10 em 30 min; C sem histórico.
  for i in 1..10 loop
    perform pg_temp.ld_lead('lv-a' || i, i);
    perform pg_temp.ld_lead('lv-b' || i, 20 + i);
    insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em)
    values ('TESTE DIST', 'lv-a' || i, v_a, 'auto', now() - make_interval(hours => i), now() - make_interval(hours => i) + interval '2 minutes', now()),
           ('TESTE DIST', 'lv-b' || i, v_b, 'pegou', now() - make_interval(hours => i), now() - make_interval(hours => i) + interval '30 minutes', now());
  end loop;
  -- Conversão: A 4 vendas em 10 leads de 5 dias atrás; B 1 em 10; um lead de A pego ONTEM e vendido não conta (maturação).
  for i in 1..10 loop
    perform pg_temp.ld_lead('lc-a' || i, 40 + i);
    perform pg_temp.ld_lead('lc-b' || i, 60 + i);
    update public.leads set dono_id = v_a, pego_em = now() - interval '5 days', converteu = (i <= 4) where aba = 'TESTE DIST' and id = 'lc-a' || i;
    update public.leads set dono_id = v_b, pego_em = now() - interval '5 days', converteu = (i <= 1) where aba = 'TESTE DIST' and id = 'lc-b' || i;
  end loop;
  perform pg_temp.ld_lead('lc-a-ontem', 90);
  update public.leads set dono_id = v_a, pego_em = now() - interval '1 day', converteu = true where aba = 'TESTE DIST' and id = 'lc-a-ontem';
  -- A e B abriram o painel hoje; C não.
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);

  select * into ra from public.leads_dist_notas() where consultor_id = v_a;
  select * into rb from public.leads_dist_notas() where consultor_id = v_b;
  select * into rc from public.leads_dist_notas() where consultor_id = v_c;
  -- 6. velocidade: A 10/10 a tempo, B 0/10
  v_out := v_out || case when ra.vel_ok = 10 and ra.vel_n = 10 and rb.vel_ok = 0 and rb.vel_n = 10 and ra.vel > rb.vel then '6 ok; ' else '6 FALHOU A=' || ra.vel_ok || '/' || ra.vel_n || ' B=' || rb.vel_ok || '/' || rb.vel_n || '; ' end;
  -- 7. conversão: A > B, suavizada (A abaixo de 40%, B acima de 10%), lead de ontem fora
  v_out := v_out || case when ra.conv > rb.conv and ra.conv < 0.40 and rb.conv > 0.10 then '7 ok; ' else '7 FALHOU A=' || ra.conv || ' B=' || rb.conv || '; ' end;
  -- 8. ativo e fatia: A e B ativos, C inativo sem fatia; com 2 ativos o teto de 40% é impossível → meio a meio; nota A > B
  v_out := v_out || case when ra.ativo and rb.ativo and not rc.ativo and rc.fatia is null and ra.fatia = 0.5 and rb.fatia = 0.5 and ra.nota > rb.nota
                     then '8 ok; ' else '8 FALHOU fatias ' || coalesce(ra.fatia::text, 'null') || '/' || coalesce(rb.fatia::text, 'null') || '; ' end;
  -- 9. consultor sem histórico fica na média do time (conv entre B e A)
  v_out := v_out || case when rc.conv between rb.conv and ra.conv and rc.vel between rb.vel and ra.vel then '9 ok; ' else '9 FALHOU C=' || rc.conv || '/' || rc.vel || '; ' end;
  -- 10. clique sem ligação (confirmado = false) não conta como a tempo
  update public.leads_distribuicao set confirmado = false where consultor_id = v_a and lead_id in ('lv-a1', 'lv-a2');
  select * into ra from public.leads_dist_notas() where consultor_id = v_a;
  v_out := v_out || case when ra.vel_ok = 8 then '10 ok; ' else '10 FALHOU ' || ra.vel_ok || '; ' end;
  -- 11. entrega com menos de 5 min e sem atendimento ainda não entra na velocidade
  perform pg_temp.ld_lead('lv-novo', 99);
  perform pg_temp.ld_entrega('lv-novo', v_b, 'auto', now() - interval '1 minute');
  select * into rb from public.leads_dist_notas() where consultor_id = v_b;
  v_out := v_out || case when rb.vel_n = 10 then '11 ok; ' else '11 FALHOU ' || rb.vel_n || '; ' end;
  -- 12. recebidos hoje conta auto e pegou de hoje (B: a entrega de agora)
  v_out := v_out || case when rb.recebidos_hoje >= 1 and rb.ultimo_recebido > now() - interval '2 minutes' then '12 ok' else '12 FALHOU ' || rb.recebidos_hoje end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

- [ ] **Step 2: Rodar o check sem a migration da task (deve falhar)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t2.sql" supabase/migrations/20261109120000_leads_dist_base.sql -- supabase/tests/leads_dist_notas_check.sql
```

Esperado: erro `function public.leads_dist_fatias(numeric[], numeric, numeric) does not exist`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261109120100_leads_dist_notas.sql`:

```sql
-- §146.1: nota (conversão 14 dias + velocidade últimos 10) e fatia (piso/teto) de cada consultor que pega lead.
-- Spec §4. Sem DROP. Check: supabase/tests/leads_dist_notas_check.sql.
begin;

-- Fatias proporcionais às notas, presas entre piso e teto ("enchimento": prende quem passou do teto, depois quem ficou abaixo
-- do piso, e redistribui o resto entre os livres até estabilizar). Limite impossível → divide igual.
create or replace function public.leads_dist_fatias(p_notas numeric[], p_piso numeric, p_teto numeric)
 returns numeric[] language plpgsql immutable set search_path to 'public'
as $function$
declare n int := coalesce(array_length(p_notas, 1), 0); f numeric[]; fixo boolean[]; resto numeric; soma numeric;
  livres int; mudou boolean; i int; volta int := 0;
begin
  if n = 0 then return '{}'::numeric[]; end if;
  if n * p_piso > 1 or n * p_teto < 1 then return array_fill(round(1.0 / n, 6), array[n]); end if;
  fixo := array_fill(false, array[n]); f := array_fill(0::numeric, array[n]);
  loop
    volta := volta + 1;
    resto := 1; soma := 0; livres := 0;
    for i in 1..n loop
      if fixo[i] then resto := resto - f[i];
      else soma := soma + greatest(coalesce(p_notas[i], 0), 0); livres := livres + 1; end if;
    end loop;
    exit when livres = 0;
    for i in 1..n loop
      if not fixo[i] then
        f[i] := case when soma > 0 then resto * greatest(coalesce(p_notas[i], 0), 0) / soma else resto / livres end;
      end if;
    end loop;
    mudou := false;
    for i in 1..n loop
      if not fixo[i] and f[i] > p_teto then f[i] := p_teto; fixo[i] := true; mudou := true; end if;
    end loop;
    if not mudou then
      for i in 1..n loop
        if not fixo[i] and f[i] < p_piso then f[i] := p_piso; fixo[i] := true; mudou := true; end if;
      end loop;
    end if;
    exit when not mudou or volta > 2 * n;
  end loop;
  for i in 1..n loop f[i] := round(f[i], 6); end loop;
  return f;
end $function$;

-- Componentes da nota (sem a fatia). Grupo = leads_equipe.pode_pegar. Ativo hoje = abriu o painel hoje (SP).
create or replace function public.leads_dist_notas_base(p_agora timestamptz default now())
 returns table (consultor_id uuid, nome text, ativo boolean, conv numeric, vel numeric, nota numeric,
                recebidos_hoje int, ultimo_recebido timestamptz, vel_n int, vel_ok int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  c jsonb := public.leads_dist_cfg();
  v_mat numeric := (c ->> 'maturacao_dias')::numeric; v_jan numeric := (c ->> 'janela_dias')::numeric;
  v_kc numeric := (c ->> 'suav_conv')::numeric; v_kv numeric := (c ->> 'suav_vel')::numeric;
  v_prazo interval := make_interval(mins => (c ->> 'prazo_atender_min')::int);
  v_ult int := (c ->> 'vel_ultimas')::int; v_peso numeric := (c ->> 'peso_conversao')::numeric;
  v_hoje date := (p_agora at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with eq as (
    select distinct on (e.profile_id) e.profile_id, e.nome_planilha
      from public.leads_equipe e where e.pode_pegar and e.profile_id is not null order by e.profile_id, e.id
  ), cv as (   -- conversão: peso 1,0 (maturação) até 0,5 (maturação + janela)
    select x.dono_id, sum(x.w) sw, sum(x.w * x.conv01) sc
      from (select l.dono_id, case when l.converteu then 1 else 0 end conv01,
                   1.0 - 0.5 * least(1.0, greatest(0.0, (extract(epoch from p_agora - l.pego_em) / 86400.0 - v_mat) / v_jan)) w
              from public.leads l
             where l.dono_id in (select profile_id from eq) and l.apagado_em is null
               and l.pego_em >= p_agora - make_interval(days => (v_mat + v_jan)::int)
               and l.pego_em <  p_agora - make_interval(days => v_mat::int)) x
     group by x.dono_id
  ), ent as (   -- velocidade: só entregas já decididas (atendidas ou com o prazo passado)
    select d.consultor_id cid, d.recebido_em, d.atendido_em, d.confirmado,
           row_number() over (partition by d.consultor_id order by d.recebido_em desc) rn
      from public.leads_distribuicao d
     where d.tipo in ('auto', 'pegou') and d.recebido_em is not null and d.consultor_id in (select profile_id from eq)
       and (d.atendido_em is not null or d.recebido_em <= p_agora - v_prazo)
  ), vl as (
    select ent.cid, count(*)::int vn,
           count(*) filter (where ent.atendido_em is not null and ent.atendido_em - ent.recebido_em <= v_prazo
                              and ent.confirmado is distinct from false)::int vok
      from ent where ent.rn <= v_ult group by ent.cid
  ), rh as (
    select d.consultor_id cid,
           count(*) filter (where (d.recebido_em at time zone 'America/Sao_Paulo')::date = v_hoje)::int n,
           max(d.recebido_em) ult
      from public.leads_distribuicao d where d.tipo in ('auto', 'pegou') and d.recebido_em is not null group by d.consultor_id
  ), base as (
    select eq.profile_id, eq.nome_planilha,
           coalesce((pr.visto_em at time zone 'America/Sao_Paulo')::date = v_hoje, false) ativo,
           coalesce(cv.sw, 0) sw, coalesce(cv.sc, 0) sc, coalesce(vl.vn, 0) vn, coalesce(vl.vok, 0) vok,
           coalesce(rh.n, 0) rn, rh.ult
      from eq
      left join cv on cv.dono_id = eq.profile_id
      left join vl on vl.cid = eq.profile_id
      left join rh on rh.cid = eq.profile_id
      left join public.leads_presenca pr on pr.profile_id = eq.profile_id
  ), med as (
    select case when sum(sw) > 0 then sum(sc) / sum(sw) else 0 end mc,
           case when sum(vn) > 0 then sum(vok)::numeric / sum(vn) else 0 end mv
      from base
  ), cvv as (
    select b.*, (b.sc + v_kc * m.mc) / (b.sw + v_kc) c_, (b.vok + v_kv * m.mv) / (b.vn + v_kv) v_ from base b, med m
  ), ma as (
    select avg(c_) filter (where ativo) mac, avg(v_) filter (where ativo) mav from cvv
  )
  select cvv.profile_id, cvv.nome_planilha, cvv.ativo, round(cvv.c_, 4), round(cvv.v_, 4),
         round(v_peso * (case when coalesce(ma.mac, 0) > 0 then cvv.c_ / ma.mac else 1 end)
             + (1 - v_peso) * (case when coalesce(ma.mav, 0) > 0 then cvv.v_ / ma.mav else 1 end), 4),
         cvv.rn, cvv.ult, cvv.vn, cvv.vok
    from cvv, ma;
end $function$;

-- Nota + fatia (fatia só entre os ativos hoje).
create or replace function public.leads_dist_notas(p_agora timestamptz default now())
 returns table (consultor_id uuid, nome text, ativo boolean, conv numeric, vel numeric, nota numeric, fatia numeric,
                recebidos_hoje int, ultimo_recebido timestamptz, vel_n int, vel_ok int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare c jsonb := public.leads_dist_cfg(); v_ids uuid[]; v_notas numeric[]; v_f numeric[];
begin
  select array_agg(b.consultor_id order by b.consultor_id), array_agg(b.nota order by b.consultor_id)
    into v_ids, v_notas from public.leads_dist_notas_base(p_agora) b where b.ativo;
  v_f := public.leads_dist_fatias(coalesce(v_notas, '{}'::numeric[]), (c ->> 'piso')::numeric, (c ->> 'teto')::numeric);
  return query
  select b.consultor_id, b.nome, b.ativo, b.conv, b.vel, b.nota,
         case when b.ativo then v_f[array_position(v_ids, b.consultor_id)] end,
         b.recebidos_hoje, b.ultimo_recebido, b.vel_n, b.vel_ok
    from public.leads_dist_notas_base(p_agora) b order by b.nome;
end $function$;

revoke execute on function public.leads_dist_fatias(numeric[], numeric, numeric) from public, anon, authenticated;
revoke execute on function public.leads_dist_notas_base(timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_notas(timestamptz) from public, anon, authenticated;

commit;
```

- [ ] **Step 4: Rodar o check com a migration**

Comando do Step 2 acrescentando `supabase/migrations/20261109120100_leads_dist_notas.sql` depois da base. Esperado: `RESULTADO: 1 ok; 2 ok; 3 ok; 4 ok; 5 ok; 6 ok; 7 ok; 8 ok; 9 ok; 10 ok; 11 ok; 12 ok`. Rodar também o check da Task 1 com as duas migrations, para ver que nada quebrou.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109120100_leads_dist_notas.sql supabase/tests/leads_dist_notas_check.sql
git commit -m "feat(leads): §146.1 nota (conversão + velocidade) e fatia com piso/teto

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Motor — quem está na vez e quem recebe

**Files:**
- Create: `supabase/migrations/20261109120200_leads_dist_motor.sql`
- Create: `supabase/tests/leads_dist_motor_check.sql`

**Interfaces:**
- Consumes: Task 1 (`leads_dist_cfg`, `leads_dist_no_expediente`, tabelas), Task 2 (`leads_dist_notas`), existentes `leads_pegar_bloqueado()`, `leads_espelho_enfileirar(text, text)`.
- Produces:
  - `leads_dist_escolher(p_excluir uuid[], p_agora timestamptz default now()) returns jsonb` → `{escolhido uuid|null, nome, total_hoje int, consultores: [{consultor_id, nome, estado, fatia, recebidos_hoje, deficit}]}`; `estado` ∈ `na_vez`, `offline`, `pausa`, `pendente`, `perdeu_este`;
  - `leads_distribuir(p_aba text, p_id text) returns jsonb` → `{ok bool, motivo?}` com `motivo` ∈ `manual`, `lead_indisponivel`, `fora_do_expediente`, `bloqueado`, `ninguem_na_vez`; em sucesso `{ok:true, consultor_id, consultor}` ou `{ok:true, sombra:true, consultor_id}`.

- [ ] **Step 1: Escrever o check**

`supabase/tests/leads_dist_motor_check.sql`:

```sql
-- §146.1 Task 3: conferência de 20261109120200_leads_dist_motor.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; r jsonb; d1 uuid; d2 uuid; n int;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);   -- C fica offline
  -- 1. modo manual não faz nada (nem fila)
  perform pg_temp.ld_cfg('{"modo":"manual"}');
  perform pg_temp.ld_lead('lm-0', 1);
  r := public.leads_distribuir('TESTE DIST', 'lm-0');
  v_out := v_out || case when r ->> 'motivo' = 'manual' and not exists (select 1 from public.leads_distribuicao where lead_id = 'lm-0') then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  -- 2. primeiro lead vai para A ou B (C offline), grava dono, entrega, histórico
  perform pg_temp.ld_lead('lm-1', 2);
  r := public.leads_distribuir('TESTE DIST', 'lm-1');
  d1 := (r ->> 'consultor_id')::uuid;
  v_out := v_out || case when (r ->> 'ok')::boolean and d1 in (v_a, v_b)
                          and (select dono_id from public.leads where aba = 'TESTE DIST' and id = 'lm-1') = d1
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-1' and consultor_id = d1 and recebido_em is not null and motivo ? 'consultores')
                          and exists (select 1 from public.leads_historico where lead_id = 'lm-1' and acao = 'distribuir')
                     then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. segundo lead vai para o outro (o primeiro está pendente)
  perform pg_temp.ld_lead('lm-2', 3);
  r := public.leads_distribuir('TESTE DIST', 'lm-2');
  d2 := (r ->> 'consultor_id')::uuid;
  v_out := v_out || case when d2 in (v_a, v_b) and d2 <> d1 then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. terceiro: ninguém na vez → fila aberta, lead sem dono
  perform pg_temp.ld_lead('lm-3', 4);
  r := public.leads_distribuir('TESTE DIST', 'lm-3');
  v_out := v_out || case when r ->> 'motivo' = 'ninguem_na_vez' and (select dono_id from public.leads where id = 'lm-3') is null
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-3' and consultor_id is null and fechado_em is null)
                     then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. d1 atende → d1 volta para a vez e recebe o lead da fila (mesma linha)
  update public.leads_distribuicao set atendido_em = now(), sinal = 'clique' where lead_id = 'lm-1';
  r := public.leads_distribuir('TESTE DIST', 'lm-3');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = d1
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lm-3') = 1 then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. quem perdeu este lead (excluidos) não recebe de novo
  update public.leads_distribuicao set atendido_em = now() where consultor_id in (v_a, v_b) and atendido_em is null;
  perform pg_temp.ld_lead('lm-4', 5);
  insert into public.leads_distribuicao (lead_aba, lead_id, devolucoes, excluidos) values ('TESTE DIST', 'lm-4', 1, array[v_a]);
  r := public.leads_distribuir('TESTE DIST', 'lm-4');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_b then '6 ok; ' else '6 FALHOU ' || r::text || '; ' end;
  -- 7. pausa tira da vez
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  update public.leads_presenca set pausa_ate = now() + interval '30 minutes' where profile_id = v_b;
  perform pg_temp.ld_lead('lm-5', 6);
  r := public.leads_distribuir('TESTE DIST', 'lm-5');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_a then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  update public.leads_presenca set pausa_ate = null where profile_id = v_b;
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  -- 8. fora do expediente: guarda (fila) e não distribui
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  perform pg_temp.ld_lead('lm-6', 7);
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when r ->> 'motivo' = 'fora_do_expediente' and (select dono_id from public.leads where id = 'lm-6') is null
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lm-6' and consultor_id is null and fechado_em is null)
                     then '8 ok; ' else '8 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  -- 9. "Bloquear todos" (§132) também para o motor
  update public.config set valor = '{"bloqueado":true}' where chave = 'leads_pegar_bloqueado';
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when r ->> 'motivo' = 'bloqueado' then '9 ok; ' else '9 FALHOU ' || r::text || '; ' end;
  update public.config set valor = '{"bloqueado":false}' where chave = 'leads_pegar_bloqueado';
  -- 10. sombra: grava para quem iria, não muda dono, uma vez só por lead
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  r := public.leads_distribuir('TESTE DIST', 'lm-6');
  perform public.leads_distribuir('TESTE DIST', 'lm-6');
  v_out := v_out || case when (r ->> 'sombra')::boolean and (select dono_id from public.leads where id = 'lm-6') is null
                          and (select count(*) from public.leads_dist_sombra where lead_id = 'lm-6') = 1
                     then '10 ok; ' else '10 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  -- 11. déficit: com fatias iguais, quem recebeu menos hoje leva (B tem 1, A tem 4 recebidos hoje)
  update public.leads_distribuicao set fechado_em = now() where fechado_em is null;
  delete from public.leads_distribuicao where consultor_id in (v_a, v_b);
  for n in 1..4 loop perform pg_temp.ld_lead('ld-a' || n, 10 + n); insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em) values ('TESTE DIST', 'ld-a' || n, v_a, 'auto', now() - interval '1 minute', now(), now()); end loop;
  perform pg_temp.ld_lead('ld-b1', 20);
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em, atendido_em, fechado_em) values ('TESTE DIST', 'ld-b1', v_b, 'auto', now() - interval '1 minute', now(), now());
  perform pg_temp.ld_lead('lm-7', 21);
  r := public.leads_distribuir('TESTE DIST', 'lm-7');
  v_out := v_out || case when (r ->> 'consultor_id')::uuid = v_b then '11 ok; ' else '11 FALHOU ' || r::text || '; ' end;
  -- 12. lead já com dono ou apagado: não mexe e fecha a fila
  perform pg_temp.ld_lead('lm-8', 22);
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lm-8');
  update public.leads set apagado_em = now() where id = 'lm-8';
  r := public.leads_distribuir('TESTE DIST', 'lm-8');
  v_out := v_out || case when r ->> 'motivo' = 'lead_indisponivel' and not exists (select 1 from public.leads_distribuicao where lead_id = 'lm-8' and fechado_em is null)
                     then '12 ok; ' else '12 FALHOU ' || r::text || '; ' end;
  -- 13. "pegou" esquecido há mais de 15 min não trava; há 3 min trava
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  perform pg_temp.ld_lead('lm-9', 23);
  perform pg_temp.ld_entrega('lm-9', v_a, 'pegou', now() - interval '3 minutes');
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'pendente' then '13 ok; ' else '13 FALHOU ' || r::text || '; ' end;
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lm-9';
  r := public.leads_dist_escolher('{}'::uuid[]);
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a) = 'na_vez' then '13b ok; ' else '13b FALHOU ' || r::text || '; ' end;
  -- 14. offline aparece com estado offline e nunca é escolhido
  v_out := v_out || case when (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_c) is null
                          or (select e ->> 'estado' from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_c) = 'offline'
                     then '14 ok' else '14 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

(Item 14: C não abriu o painel hoje, então não é "ativo hoje" e não aparece na lista de `leads_dist_escolher`, que só inclui os ativos. Se aparecer, tem que ser como `offline`.)

- [ ] **Step 2: Rodar sem a migration da task (deve falhar)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t3.sql" supabase/migrations/20261109120000_leads_dist_base.sql supabase/migrations/20261109120100_leads_dist_notas.sql -- supabase/tests/leads_dist_motor_check.sql
```

Esperado: erro `function public.leads_distribuir(unknown, unknown) does not exist`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261109120200_leads_dist_motor.sql`:

```sql
-- §146.1: motor da distribuição (rodízio ponderado com trava de pendência) e modo sombra. Spec §5.
-- Sem DROP. Check: supabase/tests/leads_dist_motor_check.sql.
begin;

-- Quem está na vez e quem recebe: maior déficit = fatia × (recebidos de hoje + 1) − recebidos dele hoje.
-- Empate: quem recebeu o último há mais tempo. Só entre os ativos hoje (abriram o painel hoje).
create or replace function public.leads_dist_escolher(p_excluir uuid[], p_agora timestamptz default now())
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare c jsonb := public.leads_dist_cfg();
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_total int; v_lista jsonb; v_id uuid; v_nome text;
begin
  select coalesce(sum(n.recebidos_hoje), 0) into v_total from public.leads_dist_notas(p_agora) n where n.ativo;
  with n as (select * from public.leads_dist_notas(p_agora) x where x.ativo),
  est as (
    select n.consultor_id, n.nome, n.fatia, n.recebidos_hoje, n.ultimo_recebido,
      case
        when n.consultor_id = any(coalesce(p_excluir, '{}'::uuid[])) then 'perdeu_este'
        when p.visto_em is null or p.visto_em < p_agora - v_pres then 'offline'
        when p.pausa_ate > p_agora then 'pausa'
        when exists (select 1 from public.leads_distribuicao d
                      where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                        and d.atendido_em is null and d.recebido_em > p_agora - v_dev) then 'pendente'
        else 'na_vez' end estado,
      n.fatia * (v_total + 1) - n.recebidos_hoje deficit
    from n left join public.leads_presenca p on p.profile_id = n.consultor_id)
  select jsonb_agg(jsonb_build_object('consultor_id', est.consultor_id, 'nome', est.nome, 'estado', est.estado, 'fatia', est.fatia,
                     'recebidos_hoje', est.recebidos_hoje, 'deficit', round(est.deficit, 3)) order by est.deficit desc),
         (array_agg(est.consultor_id order by est.deficit desc, est.ultimo_recebido asc nulls first) filter (where est.estado = 'na_vez'))[1]
    into v_lista, v_id from est;
  if v_id is not null then select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = v_id order by e.id limit 1; end if;
  return jsonb_build_object('escolhido', v_id, 'nome', v_nome, 'total_hoje', v_total, 'consultores', coalesce(v_lista, '[]'::jsonb));
end $function$;

-- Motor: chamado por leads_entrada2 (lead novo) e pelo tick (fila). Um lead por vez (trava de transação).
create or replace function public.leads_distribuir(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := c ->> 'modo';
  v_fila public.leads_distribuicao; v_esc jsonb; v_id uuid; v_nome text; n int;
begin
  if coalesce(v_modo, 'manual') not in ('sombra', 'automatico') then return jsonb_build_object('ok', false, 'motivo', 'manual'); end if;
  perform pg_advisory_xact_lock(hashtext('leads_distribuir'));
  select * into v_fila from public.leads_distribuicao d where d.lead_aba = p_aba and d.lead_id = p_id and d.fechado_em is null;
  if not exists (select 1 from public.leads l where l.aba = p_aba and l.id = p_id and l.dono_id is null
                    and l.apagado_em is null and l.categoria = 'sem_contato') then
    if v_fila.id is not null and v_fila.consultor_id is null then
      update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;   -- pego/apagado por fora: sai da fila
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel');
  end if;
  if v_fila.id is null then
    insert into public.leads_distribuicao (lead_aba, lead_id) values (p_aba, p_id) returning * into v_fila;
  end if;
  if not public.leads_dist_no_expediente(now()) then return jsonb_build_object('ok', false, 'motivo', 'fora_do_expediente'); end if;
  if public.leads_pegar_bloqueado() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  v_esc := public.leads_dist_escolher(v_fila.excluidos);
  v_id := (v_esc ->> 'escolhido')::uuid;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'ninguem_na_vez'); end if;
  if v_modo = 'sombra' then
    insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido, motivo) values (p_aba, p_id, v_id, v_esc)
    on conflict (lead_aba, lead_id) do nothing;
    return jsonb_build_object('ok', true, 'sombra', true, 'consultor_id', v_id);
  end if;
  v_nome := v_esc ->> 'nome';
  update public.leads set dono_id = v_id, consultor = v_nome, pego_em = now()
   where aba = p_aba and id = p_id and dono_id is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel'); end if;
  update public.leads_distribuicao set consultor_id = v_id, tipo = 'auto', recebido_em = now(), motivo = v_esc where id = v_fila.id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'distribuir', null, jsonb_build_object('consultor', v_nome, 'dono_id', v_id));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor_id', v_id, 'consultor', v_nome);
end $function$;

revoke execute on function public.leads_dist_escolher(uuid[], timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_distribuir(text, text) from public, anon, authenticated;

commit;
```

- [ ] **Step 4: Rodar o check com a migration**

Comando do Step 2 acrescentando `supabase/migrations/20261109120200_leads_dist_motor.sql` no fim da lista de migrations. Esperado: `RESULTADO: 1 ok; … 13 ok; 13b ok; 14 ok` (todos `ok`). Rodar também os checks das Tasks 1 e 2 com as três migrations.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109120200_leads_dist_motor.sql supabase/tests/leads_dist_motor_check.sql
git commit -m "feat(leads): §146.1 motor de distribuição (rodízio ponderado, trava, sombra)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tick (confirmação, devolução, fila) e ganchos nas funções existentes

**Files:**
- Create: `supabase/migrations/20261109120300_leads_dist_tick.sql`
- Create: `supabase/tests/leads_dist_tick_check.sql`

**Interfaces:**
- Consumes: Tasks 1–3; existentes `leads_entrada2`, `leads_pegar`, `leads_redistribuir`, `chave_tel(text)`, `ligacoes_manuais(id, usuario, chave_tel, gerada_em, importado_em, …)`, `agenda_retornos`, `leads_agenda_lead`, `leads_mes_aba`, `leads_espelho_enfileirar`.
- Produces:
  - `leads_dist_tick() returns jsonb` → `{modo, confirmados, devolvidos, distribuidos}`;
  - `leads_entrada2` chama `leads_distribuir` para cada lead inserido (protegido por `exception`);
  - `leads_pegar` fecha a linha aberta do lead e grava entrega `pegou`;
  - `leads_redistribuir` fecha a linha aberta e, com `p_novo`, grava entrega `redistribuido`.

- [ ] **Step 1: Escrever o check**

`supabase/tests/leads_dist_tick_check.sql`:

```sql
-- §146.1 Task 4: conferência de 20261109120300_leads_dist_tick.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_c uuid := pg_temp.ld_c(3);
  v_out text := ''; r jsonb; d1 uuid; v_id bigint; v_idok bigint; v_idno bigint; v_lig bigint;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. modo manual: leads_entrada2 não distribui nem cria fila
  perform pg_temp.ld_cfg('{"modo":"manual"}');
  r := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-0', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0030')), false, 'planilha');
  v_out := v_out || case when (r ->> 'inseridos')::int = 1 and (select dono_id from public.leads where id = 'lt-0') is null
                          and not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-0') then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. automático: dois leads na mesma chamada vão para pessoas diferentes
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  perform public.leads_entrada2(jsonb_build_array(
    jsonb_build_object('id', 'lt-1', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0031'),
    jsonb_build_object('id', 'lt-2', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0032')), false, 'meta');
  v_out := v_out || case when (select count(distinct dono_id) from public.leads where id in ('lt-1', 'lt-2') and dono_id in (v_a, v_b)) = 2 then '2 ok; ' else '2 FALHOU; ' end;
  -- 3. pegar nos Livres fecha a fila e grava "pegou"
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  perform public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-3', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0033')), false, 'planilha');
  perform pg_temp.ld_como(v_c);
  r := public.leads_pegar((select aba from public.leads where id = 'lt-3'), 'lt-3');
  v_out := v_out || case when (r ->> 'ok')::boolean
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and tipo = 'pegou' and consultor_id = v_c and fechado_em is null)
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) = 1
                     then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. redistribuir pelo gestor: fecha a aberta e grava "redistribuido"; devolver aos Livres só fecha
  perform pg_temp.ld_como(pg_temp.ld_admin());
  perform public.leads_redistribuir((select aba from public.leads where id = 'lt-3'), 'lt-3', v_b);
  v_out := v_out || case when exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and tipo = 'redistribuido' and consultor_id = v_b and fechado_em is null)
                          and (select count(*) from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) = 1 then '4 ok; ' else '4 FALHOU; ' end;
  perform public.leads_redistribuir((select aba from public.leads where id = 'lt-3'), 'lt-3', null);
  v_out := v_out || case when not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-3' and fechado_em is null) then '4b ok; ' else '4b FALHOU; ' end;
  -- 5. devolução aos 15 min: volta, vai para o outro, nunca para quem perdeu
  perform pg_temp.ld_cfg('{"modo":"automatico"}');
  update public.leads_distribuicao set atendido_em = now() where lead_id = 'lt-2';
  select dono_id into d1 from public.leads where id = 'lt-1';
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lt-1' and fechado_em is null;
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'devolvidos')::int = 1
                          and (select dono_id from public.leads where id = 'lt-1') is distinct from d1
                          and (select dono_id from public.leads where id = 'lt-1') in (v_a, v_b)
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lt-1' and devolvido_em is not null and consultor_id = d1)
                          and exists (select 1 from public.leads_historico where lead_id = 'lt-1' and acao = 'devolver_auto')
                     then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. segunda devolução: para de circular, fica nos Livres e vira aviso "parados"
  update public.leads_distribuicao set recebido_em = now() - interval '16 minutes' where lead_id = 'lt-1' and fechado_em is null;
  r := public.leads_dist_tick();
  v_out := v_out || case when (select dono_id from public.leads where id = 'lt-1') is null
                          and not exists (select 1 from public.leads_distribuicao where lead_id = 'lt-1' and fechado_em is null)
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') -> 'parados' @> '[{"id":"lt-1"}]'
                     then '6 ok; ' else '6 FALHOU ' || r::text || '; ' end;
  -- 7. confirmação: clique com ligação real → true; clique sem ligação → false (robô importou depois)
  perform pg_temp.ld_lead('lt-ok', 40); perform pg_temp.ld_lead('lt-no', 41);
  update public.leads set dono_id = v_a where id in ('lt-ok', 'lt-no');
  v_idok := pg_temp.ld_entrega('lt-ok', v_a, 'auto', now() - interval '30 minutes');
  v_idno := pg_temp.ld_entrega('lt-no', v_a, 'auto', now() - interval '30 minutes');
  update public.leads_distribuicao set atendido_em = now() - interval '28 minutes', sinal = 'clique' where id in (v_idok, v_idno);
  select coalesce(max(id), 0) + 1 into v_lig from public.ligacoes_manuais;
  insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, importado_em)
  values (v_lig, 'Teste.Dist.A', '11900000040', public.chave_tel('(11) 90000-0040'), now() - interval '27 minutes', true, now());
  -- (se ligacoes_manuais tiver outra coluna obrigatória, preencher com valor fictício: seg_falados 30, tabulacao 'Teste')
  r := public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_idok) is true
                          and (select confirmado from public.leads_distribuicao where id = v_idno) is false then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  -- 8. robô parado (última importação há 40 min): não decide e avisa
  perform pg_temp.ld_lead('lt-par', 42);
  update public.leads set dono_id = v_b where id = 'lt-par';
  v_id := pg_temp.ld_entrega('lt-par', v_b, 'auto', now() - interval '30 minutes');
  update public.leads_distribuicao set atendido_em = now() - interval '28 minutes', sinal = 'clique' where id = v_id;
  update public.ligacoes_manuais set importado_em = least(importado_em, now() - interval '40 minutes') where importado_em > now() - interval '40 minutes';
  r := public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_id) is null
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'robo_parado' then '8 ok; ' else '8 FALHOU ' || r::text || '; ' end;
  -- 8b. mais de 24 h sem decisão vira true (benefício da dúvida)
  update public.leads_distribuicao set atendido_em = now() - interval '25 hours' where id = v_id;
  perform public.leads_dist_tick();
  v_out := v_out || case when (select confirmado from public.leads_distribuicao where id = v_id) is true then '8b ok; ' else '8b FALHOU; ' end;
  -- 9. motor quebrado não derruba a entrada: lead entra, fica nos Livres, aviso motor_erro
  perform pg_temp.ld_cfg('{"piso":"x"}');
  r := public.leads_entrada2(jsonb_build_array(jsonb_build_object('id', 'lt-9', 'criado_em_lead', now(), 'full_name', 'Lead Teste', 'phone_number', '(11) 90000-0039')), false, 'planilha');
  v_out := v_out || case when (r ->> 'inseridos')::int = 1 and (select dono_id from public.leads where id = 'lt-9') is null
                          and (select valor::jsonb from public.config where chave = 'leads_distribuicao_aviso') ? 'motor_erro' then '9 ok; ' else '9 FALHOU ' || r::text || '; ' end;
  perform pg_temp.ld_cfg('{"piso":0.15}');
  -- 10. sombra: tick não sombreia de novo o mesmo lead nem atribui
  perform pg_temp.ld_cfg('{"modo":"sombra"}');
  update public.leads_distribuicao set atendido_em = now() where atendido_em is null and consultor_id is not null;
  perform pg_temp.ld_lead('lt-10', 43);
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lt-10');
  perform public.leads_dist_tick(); perform public.leads_dist_tick();
  v_out := v_out || case when (select count(*) from public.leads_dist_sombra where lead_id = 'lt-10') = 1
                          and (select dono_id from public.leads where id = 'lt-10') is null then '10 ok; ' else '10 FALHOU; ' end;
  -- 11. fora do expediente: tick não distribui a fila
  perform pg_temp.ld_cfg('{"modo":"automatico","expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'distribuidos')::int = 0 and (select dono_id from public.leads where id = 'lt-10') is null then '11 ok; ' else '11 FALHOU ' || r::text || '; ' end;
  -- 12. de volta ao expediente: tick distribui a fila (mais recente primeiro)
  perform pg_temp.ld_cfg('{"expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}');
  r := public.leads_dist_tick();
  v_out := v_out || case when (select dono_id from public.leads where id = 'lt-10') in (v_a, v_b) then '12 ok' else '12 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

- [ ] **Step 2: Rodar sem a migration da task (deve falhar)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t4.sql" supabase/migrations/20261109120000_leads_dist_base.sql supabase/migrations/20261109120100_leads_dist_notas.sql supabase/migrations/20261109120200_leads_dist_motor.sql -- supabase/tests/leads_dist_tick_check.sql
```

Esperado: `RESULTADO` com `1 ok; 2 FALHOU; …` (sem o gancho a entrada não distribui) ou erro `function public.leads_dist_tick() does not exist`.

- [ ] **Step 3: Conferir as definições atuais no banco antes de reescrever**

As três funções abaixo serão substituídas inteiras. Antes, comparar com o que está no ar (outra frente pode ter mudado depois deste plano):

```sql
select proname, md5(pg_get_functiondef(oid)) from pg_proc where proname in ('leads_entrada2', 'leads_pegar', 'leads_redistribuir');
select pg_get_functiondef('public.leads_entrada2(jsonb,boolean,text)'::regprocedure);
select pg_get_functiondef('public.leads_pegar(text,text)'::regprocedure);
select pg_get_functiondef('public.leads_redistribuir(text,text,uuid)'::regprocedure);
```

Se alguma estiver diferente do corpo abaixo, **juntar** a diferença com o gancho em vez de sobrescrever.

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20261109120300_leads_dist_tick.sql`:

```sql
-- §146.1: tick de 1 min (confirmação ProContact, devolução 15 min, fila) e ganchos em leads_entrada2 / leads_pegar / leads_redistribuir.
-- Spec §6–§8. Sem DROP. Check: supabase/tests/leads_dist_tick_check.sql. O cron fica em 20261109120500_leads_dist_cron.sql.
begin;

create or replace function public.leads_dist_tick()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); v_modo text := coalesce(c ->> 'modo', 'manual');
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_conf interval := make_interval(mins => (c ->> 'confirmar_min')::int);
  v_max int := (c ->> 'max_devolucoes')::int;
  v_exp boolean := public.leads_dist_no_expediente(now());
  v_robo timestamptz; r record; v_res jsonb; n_dev int := 0; n_dist int := 0; n_conf int := 0; v_parados jsonb;
begin
  -- 1. Confirmação pelo ProContact (todos os modos: "pegou" já junta velocidade). Só decide o que o robô já cobriu.
  select max(m.importado_em) into v_robo from public.ligacoes_manuais m;
  if v_exp and (v_robo is null or v_robo < now() - make_interval(mins => (c ->> 'robo_parado_min')::int)) then
    perform public.leads_dist_aviso('robo_parado', to_jsonb(v_robo));
  else
    perform public.leads_dist_aviso('robo_parado', null);
    update public.leads_distribuicao d set confirmado = x.ok, confirmado_em = now()
      from (select d2.id,
                   (eq.usuario_telefonia is null or exists (
                      select 1 from public.ligacoes_manuais m
                       where m.chave_tel = public.chave_tel(l.phone_number)
                         and lower(m.usuario) = lower(eq.usuario_telefonia)
                         and m.gerada_em between d2.recebido_em - interval '5 minutes' and d2.atendido_em + v_conf)) ok
              from public.leads_distribuicao d2
              join public.leads l on l.aba = d2.lead_aba and l.id = d2.lead_id
              left join lateral (select e.usuario_telefonia from public.leads_equipe e
                                  where e.profile_id = d2.consultor_id order by e.id limit 1) eq on true
             where d2.atendido_em is not null and d2.confirmado is null
               and d2.atendido_em <= now() - v_conf and v_robo >= d2.atendido_em + v_conf) x
     where d.id = x.id;
    get diagnostics n_conf = row_count;
  end if;
  update public.leads_distribuicao set confirmado = true, confirmado_em = now()   -- 24 h sem decisão: benefício da dúvida
   where atendido_em is not null and confirmado is null and atendido_em < now() - interval '24 hours';

  if v_modo = 'manual' then return jsonb_build_object('modo', v_modo, 'confirmados', n_conf, 'devolvidos', 0, 'distribuidos', 0); end if;

  -- 2. Devolução (só no automático e só entregas automáticas)
  if v_modo = 'automatico' then
    for r in select d.* from public.leads_distribuicao d
              where d.tipo = 'auto' and d.consultor_id is not null and d.fechado_em is null and d.atendido_em is null
                and d.recebido_em <= now() - v_dev
              order by d.recebido_em
              for update skip locked loop
      update public.leads set dono_id = null, consultor = null, pego_em = null
       where aba = r.lead_aba and id = r.lead_id and dono_id = r.consultor_id and categoria = 'sem_contato' and apagado_em is null;
      if not found then   -- lead já mudou por fora (tabulado, redistribuído, apagado): só fecha
        update public.leads_distribuicao set fechado_em = now() where id = r.id;
        continue;
      end if;
      update public.leads_distribuicao set devolvido_em = now(), fechado_em = now() where id = r.id;
      insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
        values (r.lead_aba, r.lead_id, 'devolver_auto', null, jsonb_build_object('dono_id', r.consultor_id), jsonb_build_object('dono_id', null));
      update public.agenda_retornos set status = 'cancelado', atualizado_em = now()
       where lead_aba = r.lead_aba and lead_id = r.lead_id and status = 'pendente';
      perform public.leads_espelho_enfileirar(r.lead_aba, r.lead_id);
      if r.devolucoes + 1 < v_max then
        insert into public.leads_distribuicao (lead_aba, lead_id, devolucoes, excluidos)
        values (r.lead_aba, r.lead_id, r.devolucoes + 1, array_append(r.excluidos, r.consultor_id));
      else
        select coalesce(cf.valor::jsonb -> 'parados', '[]'::jsonb) into v_parados from public.config cf where cf.chave = 'leads_distribuicao_aviso';
        perform public.leads_dist_aviso('parados', coalesce(v_parados, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('aba', r.lead_aba, 'id', r.lead_id, 'em', now())));
      end if;
      n_dev := n_dev + 1;
    end loop;
  end if;

  -- 3. Fila (sombra e automático), lead mais recente primeiro; para quando ninguém está na vez
  if v_exp and not public.leads_pegar_bloqueado() then
    for r in select d.lead_aba, d.lead_id from public.leads_distribuicao d
               join public.leads l on l.aba = d.lead_aba and l.id = d.lead_id
              where d.consultor_id is null and d.fechado_em is null
                and (v_modo = 'automatico' or not exists (select 1 from public.leads_dist_sombra s where s.lead_aba = d.lead_aba and s.lead_id = d.lead_id))
              order by l.criado_em_lead desc nulls last
              limit 50 loop
      begin
        v_res := public.leads_distribuir(r.lead_aba, r.lead_id);
      exception when others then
        perform public.leads_dist_aviso('motor_erro', jsonb_build_object('em', now(), 'erro', sqlerrm));
        exit;
      end;
      exit when v_res ->> 'motivo' = 'ninguem_na_vez';
      if coalesce((v_res ->> 'ok')::boolean, false) then n_dist := n_dist + 1; end if;
    end loop;
  end if;
  return jsonb_build_object('modo', v_modo, 'confirmados', n_conf, 'devolvidos', n_dev, 'distribuidos', n_dist);
end $function$;

-- leads_entrada2: igual à versão do §137 + chamada do motor para cada lead inserido (falha nunca derruba a entrada).
create or replace function public.leads_entrada2(p_leads jsonb, p_espelho boolean, p_origem text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare r jsonb; v_ins int := 0; v_vis int := 0; n int; v_aba text; v_ts timestamptz;
begin
  if coalesce(p_origem, '') not in ('planilha', 'meta') then
    raise exception 'origem inválida: %', p_origem using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_leads, '[]'::jsonb)) loop
    continue when coalesce(r ->> 'id', '') = '';
    if exists (select 1 from public.leads l where l.id = r ->> 'id') then
      -- §137: a Meta também viu um lead que já entrou (pela planilha ou por rodada anterior)
      if p_origem = 'meta' then
        update public.leads set meta_visto_em = now() where id = r ->> 'id' and meta_visto_em is null;
        get diagnostics n = row_count;
        v_vis := v_vis + n;
      end if;
      continue;
    end if;
    v_ts := nullif(r ->> 'criado_em_lead', '')::timestamptz;
    v_aba := public.leads_mes_aba(v_ts);
    -- planilha (cron de 10 s) e webhook da agência podem trazer o mesmo lead ao mesmo tempo
    insert into public.leads (aba, id, criado_em_lead, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name,
                              form_id, form_name, is_organic, platform, tipo_empresa, qtd_linhas, cnpj, email, full_name,
                              city, state, phone_number, lead_status, categoria, converteu, receita, atualizado_em, primeira_sync_em,
                              origem_entrada, meta_visto_em)
    values (v_aba, r ->> 'id', v_ts, r ->> 'ad_id', r ->> 'ad_name', r ->> 'adset_id', r ->> 'adset_name',
            r ->> 'campaign_id', r ->> 'campaign_name', r ->> 'form_id', r ->> 'form_name',
            coalesce((r ->> 'is_organic')::boolean, false), r ->> 'platform', r ->> 'tipo_empresa', r ->> 'qtd_linhas',
            r ->> 'cnpj', r ->> 'email', r ->> 'full_name', r ->> 'city', r ->> 'state', r ->> 'phone_number',
            r ->> 'lead_status', 'sem_contato', false, 0, now(), now(),
            p_origem, case when p_origem = 'meta' then now() end)
    on conflict (aba, id) do nothing;
    get diagnostics n = row_count;
    if n > 0 then
      if p_espelho then perform public.leads_espelho_enfileirar(v_aba, r ->> 'id'); end if;
      v_ins := v_ins + 1;
      -- §146: distribuição automática (manual = sai na hora). Erro vira aviso; o lead fica nos Livres.
      begin
        perform public.leads_distribuir(v_aba, r ->> 'id');
      exception when others then
        perform public.leads_dist_aviso('motor_erro', jsonb_build_object('em', now(), 'erro', sqlerrm));
      end;
    end if;
  end loop;
  return jsonb_build_object('inseridos', v_ins, 'atualizados', 0, 'vistos', v_vis);
end $function$;

-- leads_pegar: igual à do §132 + entrega "pegou" (fecha a fila do lead, se houver).
create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_pode boolean; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha, e.pode_pegar into v_nome, v_pode from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  if not coalesce(v_pode, false) then raise exception 'você não está liberado para pegar leads' using errcode = '42501'; end if;
  if public.leads_pegar_bloqueado() then raise exception 'pegar leads está pausado pelo supervisor' using errcode = '42501'; end if;
  update public.leads l set dono_id = auth.uid(), consultor = v_nome, pego_em = now()
   where l.aba = p_aba and l.id = p_id and l.dono_id is null and l.categoria = 'sem_contato' and l.apagado_em is null;
  get diagnostics n = row_count;
  if n = 0 then
    select coalesce(p.nome, l.consultor) into v_dono
      from public.leads l left join public.profiles p on p.id = l.dono_id
     where l.aba = p_aba and l.id = p_id;
    if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
    return jsonb_build_object('ok', false, 'dono', coalesce(v_dono, 'outra pessoa'));
  end if;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'pegar', auth.uid(), jsonb_build_object('consultor', v_nome));
  -- §146: entrega "pegou" (conta na velocidade e nos recebidos)
  update public.leads_distribuicao set fechado_em = now() where lead_aba = p_aba and lead_id = p_id and fechado_em is null;
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em) values (p_aba, p_id, auth.uid(), 'pegou', now());
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor', v_nome);
end $function$;

-- leads_redistribuir: igual à atual + entrega "redistribuido" (fora da nota). Devolver aos Livres só fecha.
create or replace function public.leads_redistribuir(p_aba text, p_id text, p_novo uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_antes jsonb; v_cat text; v_quando timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select jsonb_build_object('dono_id', l.dono_id, 'consultor', l.consultor), l.categoria into v_antes, v_cat
    from public.leads l where l.aba = p_aba and l.id = p_id for update;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if p_novo is null then
    if v_cat <> 'sem_contato' then raise exception 'lead com status não volta aos Livres; passe para outro consultor' using errcode = '22023'; end if;
  else
    select e.nome_planilha into v_nome from public.leads_equipe e where e.profile_id = p_novo order by e.id limit 1;
    if v_nome is null then raise exception 'consultor fora da equipe de leads' using errcode = '22023'; end if;
  end if;
  update public.leads set dono_id = p_novo, consultor = v_nome, pego_em = case when p_novo is null then null else now() end
   where aba = p_aba and id = p_id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, antes, depois)
    values (p_aba, p_id, case when p_novo is null then 'devolver' else 'redistribuir' end, auth.uid(), v_antes,
            jsonb_build_object('dono_id', p_novo, 'consultor', v_nome));
  -- §146: decisão do gestor fecha a entrega aberta; passar para alguém grava "redistribuido" (não conta na nota nem nos recebidos)
  update public.leads_distribuicao set fechado_em = now() where lead_aba = p_aba and lead_id = p_id and fechado_em is null;
  if p_novo is not null then
    insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em) values (p_aba, p_id, p_novo, 'redistribuido', now());
  end if;
  if p_novo is null then
    update public.agenda_retornos set status = 'cancelado', atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  else
    -- o retorno pendente vai junto (cancelado no dono antigo, recriado no novo — ver leads_agenda_lead)
    select a.quando into v_quando from public.agenda_retornos a
     where a.lead_aba = p_aba and a.lead_id = p_id and a.status = 'pendente' order by a.quando limit 1;
    if v_quando is not null then perform public.leads_agenda_lead(p_aba, p_id, v_quando); end if;
  end if;
  perform public.leads_espelho_enfileirar(p_aba, p_id);
end $function$;

revoke execute on function public.leads_dist_tick() from public, anon, authenticated;

commit;
```

- [ ] **Step 5: Rodar o check com a migration**

Comando do Step 2 acrescentando `supabase/migrations/20261109120300_leads_dist_tick.sql` no fim da lista. Esperado: `RESULTADO: 1 ok; 2 ok; 3 ok; 4 ok; 4b ok; 5 ok; 6 ok; 7 ok; 8 ok; 8b ok; 9 ok; 10 ok; 11 ok; 12 ok`. Rodar de novo os checks das Tasks 1–3 com as quatro migrations, e também `supabase/tests/leads_pegar_bloqueio_check.sql` sozinho com as quatro migrations antes dele (as funções de pegar/redistribuir mudaram). Para esse arquivo antigo o montador não serve (ele traz `begin` e a própria definição): rodar à parte com as 4 migrations coladas antes do `do $$` dele, num arquivo montado à mão no scratchpad, e conferir `1 ok … 7 ok`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261109120300_leads_dist_tick.sql supabase/tests/leads_dist_tick_check.sql
git commit -m "feat(leads): §146.1 tick (confirmação, devolução, fila) e ganchos na entrada/pegar/redistribuir

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: RPCs da Equipe (ver e configurar)

**Files:**
- Create: `supabase/migrations/20261109120400_leads_dist_painel.sql`
- Create: `supabase/tests/leads_dist_painel_check.sql`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `leads_dist_equipe(p_dias int default 1) returns jsonb` (admin/supervisor) → `{cfg, aviso, no_expediente bool, fila int, consultores: [{consultor_id, nome, ativo, estado, pausa_ate, conv, vel, nota, fatia, recebidos_hoje, vel_n, vel_ok, devolvidos_hoje, clicou_nao_ligou, teria, recebeu}]}`; `estado` ∈ `fora`, `offline`, `pausa`, `pendente`, `na_vez`; `teria`/`recebeu` contam desde o início do dia de `p_dias − 1` dias atrás (SP);
  - `leads_dist_validar(p jsonb) returns void` (erro `22023` com a mensagem do campo);
  - `leads_dist_config(p jsonb) returns jsonb` (admin/supervisor; só chaves permitidas; devolve `leads_dist_cfg()`).

- [ ] **Step 1: Escrever o check**

`supabase/tests/leads_dist_painel_check.sql`:

```sql
-- §146.1 Task 5: conferência de 20261109120400_leads_dist_painel.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; ca jsonb;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. consultor não vê nem configura
  perform pg_temp.ld_como(v_a);
  begin perform public.leads_dist_equipe(1); v_out := v_out || '1 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1 ok; ' else '1 FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"modo":"sombra"}'); v_out := v_out || '1b FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '1b ok; ' else '1b FALHOU ' || sqlerrm || '; ' end; end;
  -- 2. gestor configura modo e parâmetros válidos
  perform pg_temp.ld_como(pg_temp.ld_admin());
  r := public.leads_dist_config('{"modo":"sombra","piso":0.10,"teto":0.45}');
  v_out := v_out || case when r ->> 'modo' = 'sombra' and (r ->> 'piso')::numeric = 0.10 and (r ->> 'teto')::numeric = 0.45 and r ? 'alterado_por'
                     then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. inválidos recusados (22023)
  begin perform public.leads_dist_config('{"modo":"turbo"}'); v_out := v_out || '3a FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3a ok; ' else '3a FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"piso":0.5,"teto":0.4}'); v_out := v_out || '3b FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3b ok; ' else '3b FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"prazo_devolver_min":3}'); v_out := v_out || '3c FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3c ok; ' else '3c FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"suav_conv":1}'); v_out := v_out || '3d FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3d ok; ' else '3d FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dist_config('{"expediente":{"dias":[8],"inicio":"13:00","fim":"21:00"}}'); v_out := v_out || '3e FALHOU; ';
  exception when others then v_out := v_out || case when sqlstate = '22023' then '3e ok; ' else '3e FALHOU ' || sqlerrm || '; ' end; end;
  v_out := v_out || case when (public.leads_dist_cfg() ->> 'piso')::numeric = 0.10 then '3f ok; ' else '3f FALHOU (inválido gravou); ' end;
  -- 4. sombra e entregas aparecem em teria × recebeu; estados
  perform pg_temp.ld_lead('lp-1', 1); perform pg_temp.ld_lead('lp-2', 2);
  insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido) values ('TESTE DIST', 'lp-1', v_a), ('TESTE DIST', 'lp-2', v_a);
  perform pg_temp.ld_entrega('lp-1', v_b, 'pegou', now());
  update public.leads_presenca set pausa_ate = now() + interval '20 minutes' where profile_id = v_a;
  r := public.leads_dist_equipe(1);
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_a;
  v_out := v_out || case when (ca ->> 'teria')::int = 2 and (ca ->> 'recebeu')::int = 0 and ca ->> 'estado' = 'pausa' and ca ->> 'pausa_ate' is not null
                     then '4 ok; ' else '4 FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_b;
  v_out := v_out || case when (ca ->> 'recebeu')::int = 1 and ca ->> 'estado' = 'pendente' then '4b ok; ' else '4b FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  -- 5. clicou e não ligou (14 dias) e devolvidos hoje
  update public.leads_distribuicao set atendido_em = now(), confirmado = false, devolvido_em = now() where lead_id = 'lp-1';
  r := public.leads_dist_equipe(1);
  select e into ca from jsonb_array_elements(r -> 'consultores') e where (e ->> 'consultor_id')::uuid = v_b;
  v_out := v_out || case when (ca ->> 'clicou_nao_ligou')::int = 1 and (ca ->> 'devolvidos_hoje')::int = 1 then '5 ok; ' else '5 FALHOU ' || coalesce(ca::text, 'null') || '; ' end;
  -- 6. cabeçalho: cfg, aviso, fila
  insert into public.leads_distribuicao (lead_aba, lead_id) values ('TESTE DIST', 'lp-2');
  r := public.leads_dist_equipe(1);
  v_out := v_out || case when r -> 'cfg' ->> 'modo' = 'sombra' and (r ->> 'fila')::int >= 1 and r ? 'aviso' and r ? 'no_expediente' then '6 ok' else '6 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

- [ ] **Step 2: Rodar sem a migration da task (deve falhar)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/t5.sql" supabase/migrations/20261109120000_leads_dist_base.sql supabase/migrations/20261109120100_leads_dist_notas.sql supabase/migrations/20261109120200_leads_dist_motor.sql supabase/migrations/20261109120300_leads_dist_tick.sql -- supabase/tests/leads_dist_painel_check.sql
```

Esperado: `RESULTADO: 1 FALHOU …` (erro de função inexistente capturado nos blocos) ou erro `function public.leads_dist_config(unknown) does not exist`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261109120400_leads_dist_painel.sql`:

```sql
-- §146.1: Equipe — leitura (leads_dist_equipe) e configuração (leads_dist_config) da distribuição. Só admin e supervisor.
-- Spec §10–§11. Sem DROP. Check: supabase/tests/leads_dist_painel_check.sql.
begin;

-- Recusa configuração impossível (22023, mensagem curta para o painel mostrar).
create or replace function public.leads_dist_validar(p jsonb)
 returns void language plpgsql immutable set search_path to 'public'
as $function$
declare d jsonb := p -> 'expediente'; x text;
begin
  if coalesce(p ->> 'modo', '') not in ('manual', 'sombra', 'automatico') then raise exception 'modo inválido' using errcode = '22023'; end if;
  if (p ->> 'peso_conversao')::numeric not between 0 and 1 then raise exception 'peso da conversão entre 0 e 100%%' using errcode = '22023'; end if;
  if (p ->> 'piso')::numeric not between 0 and 0.30 then raise exception 'piso entre 0 e 30%%' using errcode = '22023'; end if;
  if (p ->> 'teto')::numeric not between 0.20 and 1 then raise exception 'teto entre 20%% e 100%%' using errcode = '22023'; end if;
  if (p ->> 'piso')::numeric >= (p ->> 'teto')::numeric then raise exception 'piso precisa ser menor que o teto' using errcode = '22023'; end if;
  if (p ->> 'prazo_atender_min')::int not between 1 and 60 then raise exception 'prazo para atender entre 1 e 60 min' using errcode = '22023'; end if;
  if (p ->> 'prazo_devolver_min')::int <= (p ->> 'prazo_atender_min')::int or (p ->> 'prazo_devolver_min')::int > 120 then
    raise exception 'prazo para devolver maior que o de atender e até 120 min' using errcode = '22023'; end if;
  if (p ->> 'confirmar_min')::int not between 5 and 120 then raise exception 'confirmação entre 5 e 120 min' using errcode = '22023'; end if;
  if (p ->> 'janela_dias')::int not between 3 and 60 then raise exception 'janela entre 3 e 60 dias' using errcode = '22023'; end if;
  if (p ->> 'maturacao_dias')::int not between 0 and 7 then raise exception 'maturação entre 0 e 7 dias' using errcode = '22023'; end if;
  if (p ->> 'pausa_min')::int not between 5 and 240 then raise exception 'pausa entre 5 e 240 min' using errcode = '22023'; end if;
  if (p ->> 'presenca_min')::int not between 2 and 30 then raise exception 'presença entre 2 e 30 min' using errcode = '22023'; end if;
  if (p ->> 'max_devolucoes')::int not between 1 and 5 then raise exception 'devoluções entre 1 e 5' using errcode = '22023'; end if;
  if jsonb_typeof(d -> 'dias') <> 'array' then raise exception 'dias do expediente inválidos' using errcode = '22023'; end if;
  for x in select jsonb_array_elements_text(d -> 'dias') loop
    if x !~ '^[1-7]$' then raise exception 'dias do expediente vão de 1 (seg) a 7 (dom)' using errcode = '22023'; end if;
  end loop;
  if (d ->> 'inicio')::time >= (d ->> 'fim')::time and d ->> 'fim' <> '24:00' then raise exception 'início do expediente antes do fim' using errcode = '22023'; end if;
exception
  when invalid_text_representation or invalid_datetime_format or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'valor inválido na configuração' using errcode = '22023';
end $function$;

create or replace function public.leads_dist_config(p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare k text; v jsonb;
  permitidas text[] := array['modo', 'peso_conversao', 'piso', 'teto', 'prazo_atender_min', 'prazo_devolver_min', 'confirmar_min',
                             'janela_dias', 'maturacao_dias', 'pausa_min', 'presenca_min', 'max_devolucoes', 'expediente'];
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then raise exception 'sem permissão' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then raise exception 'configuração inválida' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if not (k = any(permitidas)) then raise exception 'parâmetro desconhecido: %', k using errcode = '22023'; end if;
  end loop;
  perform public.leads_dist_validar(public.leads_dist_cfg() || p);
  select coalesce(c.valor::jsonb, '{}'::jsonb) into v from public.config c where c.chave = 'leads_distribuicao';
  v := coalesce(v, '{}'::jsonb) || p || jsonb_build_object('alterado_por', (select pr.nome from public.profiles pr where pr.id = auth.uid()), 'alterado_em', now());
  update public.config set valor = v::text, atualizado_em = now() where chave = 'leads_distribuicao';
  if not found then insert into public.config (chave, valor) values ('leads_distribuicao', v::text); end if;
  return public.leads_dist_cfg();
end $function$;

create or replace function public.leads_dist_equipe(p_dias int default 1)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg();
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini_hoje timestamptz := v_hoje::timestamp at time zone 'America/Sao_Paulo';
  v_desde timestamptz := (v_hoje - (greatest(coalesce(p_dias, 1), 1) - 1))::timestamp at time zone 'America/Sao_Paulo';
  v_exp boolean := public.leads_dist_no_expediente(now());
  v_cons jsonb; v_aviso jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(cf.valor::jsonb, '{}'::jsonb) into v_aviso from public.config cf where cf.chave = 'leads_distribuicao_aviso';
  select jsonb_agg(jsonb_build_object(
      'consultor_id', n.consultor_id, 'nome', n.nome, 'ativo', n.ativo,
      'estado', case when not v_exp then 'fora'
                     when p.visto_em is null or p.visto_em < now() - v_pres then 'offline'
                     when p.pausa_ate > now() then 'pausa'
                     when exists (select 1 from public.leads_distribuicao d
                                   where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                                     and d.atendido_em is null and d.recebido_em > now() - v_dev) then 'pendente'
                     else 'na_vez' end,
      'pausa_ate', case when p.pausa_ate > now() then p.pausa_ate end,
      'conv', n.conv, 'vel', n.vel, 'nota', n.nota, 'fatia', n.fatia, 'recebidos_hoje', n.recebidos_hoje,
      'vel_n', n.vel_n, 'vel_ok', n.vel_ok,
      'devolvidos_hoje', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.devolvido_em >= v_ini_hoje),
      'clicou_nao_ligou', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.confirmado = false
                             and d.atendido_em >= now() - interval '14 days'),
      'teria', (select count(*) from public.leads_dist_sombra s where s.escolhido = n.consultor_id and s.em >= v_desde),
      'recebeu', (select count(*) from public.leads_distribuicao d where d.consultor_id = n.consultor_id and d.tipo in ('auto', 'pegou')
                    and d.recebido_em >= v_desde)
    ) order by n.nome) into v_cons
    from public.leads_dist_notas() n left join public.leads_presenca p on p.profile_id = n.consultor_id;
  return jsonb_build_object('cfg', c, 'aviso', coalesce(v_aviso, '{}'::jsonb), 'no_expediente', v_exp,
    'fila', (select count(*) from public.leads_distribuicao d where d.consultor_id is null and d.fechado_em is null),
    'consultores', coalesce(v_cons, '[]'::jsonb));
end $function$;

revoke execute on function public.leads_dist_validar(jsonb) from public, anon, authenticated;
revoke execute on function public.leads_dist_config(jsonb) from public, anon;
revoke execute on function public.leads_dist_equipe(int) from public, anon;
grant execute on function public.leads_dist_config(jsonb) to authenticated;
grant execute on function public.leads_dist_equipe(int) to authenticated;

commit;
```


- [ ] **Step 4: Rodar o check com a migration**

Comando do Step 2 acrescentando `supabase/migrations/20261109120400_leads_dist_painel.sql` no fim da lista. Esperado: `RESULTADO: 1 ok; 1b ok; 2 ok; 3a ok; 3b ok; 3c ok; 3d ok; 3e ok; 3f ok; 4 ok; 4b ok; 5 ok; 6 ok`. (O 3d recusa `suav_conv` por estar fora das chaves permitidas.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261109120400_leads_dist_painel.sql supabase/tests/leads_dist_painel_check.sql
git commit -m "feat(leads): §146.1 RPCs da Equipe (ver e configurar a distribuição)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Painel — presença, clique no telefone e faixa "Distribuição" na Equipe

**Files:**
- Modify: `_template.html` (estado `kbEstado` em ~5053; `kbLigar` em ~5250 e as 3 chamadas em ~5416, ~5583, ~6284; `kbAgendar`/`kbParar` em ~5365–5395; `kbCarregarEquipe` em ~6051; faixa ao lado de `kbFaixaPegarHtml` em ~6074; `kbRenderEquipe` em ~6190; clique delegado em ~6383; CSS perto de `.kbEqPegar` em ~1087)
- Create: `test_leads_distribuicao.js`

**Interfaces:**
- Consumes (banco): `leads_presenca_ping(p_acao)`, `registrar_contato_lead(p_aba, p_lead_id, p_canal)`, `leads_dist_equipe(p_dias)`, `leads_dist_config(p)`.
- Produces (JS, usados pelo plano da §146.2):
  - `kbPresencaPing(acao)` → `Promise<{equipe, pausa_ate}|null>`, guarda em `kbEstado.presenca`;
  - `kbRegistrarLigar(lead)` → chama `registrar_contato_lead(lead.aba, lead.lead_id, 'ligar')` só se `lead.dono_id === currentUser.id`;
  - `kbLigar(telefone, lead)` (2º parâmetro novo, opcional);
  - `kbCarregarDistrib()` → `kbEstado.distrib` (`null` se o banco não tiver a função);
  - `kbFaixaDistribHtml(d)` → string HTML (vazia se `d` nulo);
  - `kbDistModo(modo)`, `kbDistSalvarCfg(form)`;
  - `KB_DIST_ESTADO` = `{ na_vez: 'Na vez', pendente: 'Aguardando ligar', pausa: 'Em pausa', offline: 'Fora do painel', fora: 'Fora do horário' }`.

- [ ] **Step 1: Escrever o teste (falha)**

`test_leads_distribuicao.js`:

```js
// Testa a §146.1 (distribuição automática de leads: presença, clique no telefone, faixa Distribuição na Equipe).
// DADOS FICTÍCIOS — o repositório é público.
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  const chamadas = (nome) => window.__rpcCalls.filter(c => c.nome === nome);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };

  // ==== presença ====
  kbEstado.naEquipe = false;
  window.__rpcCalls.length = 0;
  eq(await kbPresencaPing(), null, 'fora da equipe não manda presença');
  eq(chamadas('leads_presenca_ping').length, 0, 'nenhuma chamada fora da equipe');
  kbEstado.naEquipe = true;
  window.__rpcRespostas.leads_presenca_ping = { data: { equipe: true, pausa_ate: null }, error: null };
  await kbPresencaPing();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: null }], 'ping comum manda p_acao nulo');
  eq(kbEstado.presenca, { equipe: true, pausa_ate: null }, 'guarda a presença');
  window.__rpcRespostas.leads_presenca_ping = { data: null, error: { message: 'function does not exist' } };
  await kbPresencaPing();
  eq(kbEstado.presenca, { equipe: true, pausa_ate: null }, 'erro do banco (função ainda não existe) não apaga nem quebra');
  kbAgendar();
  assert(kbEstado.timerPresenca, 'kbAgendar liga o timer de presença');
  kbParar();
  eq(kbEstado.timerPresenca, null, 'kbParar desliga o timer de presença');

  // ==== clique no telefone registra "ligar" só no lead do próprio consultor ====
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.registrar_contato_lead = { data: null, error: null };
  await kbLigar('(11) 90000-0001', { aba: 'NOVEMBRO', lead_id: 'L1', dono_id: 'c1', telefone: '(11) 90000-0001' });
  await espera();
  eq(chamadas('registrar_contato_lead').map(c => c.args), [{ p_aba: 'NOVEMBRO', p_lead_id: 'L1', p_canal: 'ligar' }], 'lead meu: registra ligar');
  await kbLigar('(11) 90000-0002', { aba: 'NOVEMBRO', lead_id: 'L2', dono_id: 'outro', telefone: '(11) 90000-0002' });
  await kbLigar('(11) 90000-0003');
  await espera();
  eq(chamadas('registrar_contato_lead').length, 1, 'lead de outro ou sem lead: não registra');

  // ==== faixa Distribuição ====
  eq(kbFaixaDistribHtml(null), '', 'sem dados (banco sem a função): faixa some');
  const D = { cfg: { modo: 'sombra', peso_conversao: 0.5, piso: 0.15, teto: 0.4, prazo_atender_min: 5, prazo_devolver_min: 15 },
    aviso: { robo_parado: '2026-11-10T16:00:00Z', parados: [{ aba: 'NOVEMBRO', id: 'L9', em: new Date().toISOString() }] },
    no_expediente: true, fila: 2,
    consultores: [
      { consultor_id: 'c1', nome: 'Zz Ana Teste', ativo: true, estado: 'na_vez', conv: 0.18, vel: 0.62, nota: 1.12, fatia: 0.32, recebidos_hoje: 5, vel_n: 10, vel_ok: 7, devolvidos_hoje: 0, clicou_nao_ligou: 0, teria: 6, recebeu: 4 },
      { consultor_id: 'c2', nome: 'Zz Beto Teste', ativo: false, estado: 'offline', conv: 0.15, vel: 0.2, nota: 0.8, fatia: null, recebidos_hoje: 0, vel_n: 3, vel_ok: 0, devolvidos_hoje: 1, clicou_nao_ligou: 2, teria: 0, recebeu: 1 },
    ] };
  const h = kbFaixaDistribHtml(D);
  assert(h.includes('Distribuição: Sombra'), 'mostra o modo');
  assert(h.includes('data-kb-dist-modo="manual"') && h.includes('data-kb-dist-modo="sombra"'), 'botões Manual e Sombra');
  assert(/data-kb-dist-modo="automatico"[^>]*disabled/.test(h), 'Automático desabilitado na §146.1');
  assert(h.includes('32%') && h.includes('7 de 10'), 'fatia e rápidos na tabela');
  assert(h.includes('Na vez') && h.includes('Fora do painel'), 'estados escritos');
  assert(h.includes('kbDistAlerta') && h.includes('>2<'), 'clicou e não ligou em destaque');
  assert(h.includes('6') && h.includes('teria'), 'sombra: teria × recebeu');
  assert(h.includes('ProContact') && h.includes('L9') === false, 'aviso do robô parado; id do lead não aparece');
  assert(h.includes('1 lead parou') || h.includes('1 leads pararam') || h.includes('parou de circular'), 'aviso de lead parado');
  assert(!h.includes('<script'), 'sem script');
  const hEsc = kbFaixaDistribHtml(Object.assign({}, D, { consultores: [Object.assign({}, D.consultores[0], { nome: '<b>X</b>' })] }));
  assert(hEsc.includes('&lt;b&gt;X&lt;/b&gt;'), 'nome escapado');

  // ==== mudar modo e salvar parâmetros ====
  currentUser = { id: 'g1', nome: 'Gestor Teste', username: 'gest', role: 'admin' };
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.leads_dist_config = (a) => ({ data: Object.assign({}, D.cfg, a.p), error: null });
  window.__rpcRespostas.leads_dist_equipe = { data: D, error: null };
  await kbDistModo('manual');
  eq(chamadas('leads_dist_config').map(c => c.args), [{ p: { modo: 'manual' } }], 'muda o modo');
  await kbDistModo('automatico');
  eq(chamadas('leads_dist_config').length, 1, 'automático não é enviado na §146.1');
  window.__rpcCalls.length = 0;
  await kbDistSalvarCfg({ peso: '60', piso: '10', teto: '45', atender: '5', devolver: '20' });
  eq(chamadas('leads_dist_config').map(c => c.args), [{ p: { peso_conversao: 0.6, piso: 0.1, teto: 0.45, prazo_atender_min: 5, prazo_devolver_min: 20 } }], 'parâmetros em fração e minutos');
  window.__rpcCalls.length = 0;
  window.__rpcRespostas.leads_dist_config = { data: null, error: { message: 'piso precisa ser menor que o teto', code: '22023' } };
  await kbDistSalvarCfg({ peso: '50', piso: '50', teto: '40', atender: '5', devolver: '15' });
  assert(avisos().includes('piso precisa ser menor que o teto'), 'mostra o motivo da recusa');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/leads-distribuicao
NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_distribuicao.js
```

Esperado: `FALHA: ReferenceError: kbPresencaPing is not defined`.

- [ ] **Step 3: Presença e clique em `_template.html`**

3a. Em `kbEstado` (linha ~5053), acrescentar ao final do objeto: `, timerPresenca: null, presenca: null, distrib: null, distCfgAberta: false, distMudando: false`.

3b. Substituir a função `async function kbLigar(telefone){ … }` (linha ~5250) inteira por:

```js
async function kbLigar(telefone, lead){
  const num = kbTelCopiar(telefone);
  if(!num) return;
  let copiou = false;   // copia antes de abrir a aba: depois o painel perde o foco e o navegador recusa a cópia
  try { await (kbFichaNo().ownerDocument.defaultView || window).navigator.clipboard.writeText(num); copiou = true; } catch(_e) {}
  kbAbrirProContact();
  mostrarAviso(copiou ? `Número ${kbFoneBR(num)} copiado. Cole no ProContact para ligar.` : `Ligue para ${kbFoneBR(num)} no ProContact.`, copiou ? 'ok' : 'info');
  kbRegistrarLigar(lead);
}
// §146: o clique no telefone do próprio lead conta como "atendeu" na distribuição (registrar_contato_lead → leads_contatos;
// o gatilho leads_dist_clicou marca a entrega). Gestor olhando lead de outro não registra. Não bloqueia nem avisa erro.
function kbRegistrarLigar(lead){
  if(!lead || !lead.aba || !lead.lead_id || !currentUser || lead.dono_id !== currentUser.id) return;
  ppSeguro(() => sb.rpc('registrar_contato_lead', { p_aba: lead.aba, p_lead_id: lead.lead_id, p_canal: 'ligar' }));
}
// §146: presença no painel (a cada 1 min com o painel aberto, em qualquer aba). Só quem é da equipe de leads.
async function kbPresencaPing(acao){
  if(!kbEstado.naEquipe) return null;
  const r = await ppSeguro(() => sb.rpc('leads_presenca_ping', { p_acao: acao || null }));
  if(r && !r.error && r.data) kbEstado.presenca = r.data;
  return r && !r.error ? r.data : null;
}
```

Se `kbFichaNo` não existir no momento do clique em teste, manter o `try` como está (já protegido).

3c. Nas três chamadas de `kbLigar`, passar o lead:
- linha ~5416: `kbLigar(l.telefone)` → `kbLigar(l.telefone, l)`
- linha ~5583: `kbLigar(kbEstado.fichaLead.telefone)` → `kbLigar(kbEstado.fichaLead.telefone, kbEstado.fichaLead)`
- linha ~6284: `kbLigar(l.telefone)` → `kbLigar(l.telefone, l)`

Conferir com `grep -n "kbLigar(" _template.html` que não sobrou chamada sem o lead (exceto a definição).

3d. Em `kbAgendar()`, logo após `clearInterval(kbEstado.timerAlertas);`, acrescentar:

```js
  clearInterval(kbEstado.timerPresenca);
  kbPresencaPing();
  kbEstado.timerPresenca = setInterval(() => kbPresencaPing(), 60000);   // §146: presença para a distribuição (qualquer aba)
```

3e. Em `kbParar()`, na linha `clearInterval(kbEstado.timer); clearInterval(kbEstado.timerAlertas);`, acrescentar `clearInterval(kbEstado.timerPresenca);` e na linha seguinte `kbEstado.timerPresenca = null; kbEstado.presenca = null; kbEstado.distrib = null;`.

- [ ] **Step 4: Faixa "Distribuição" na Equipe**

4a. Logo depois de `kbDefinirPodePegar` (linha ~6110), inserir:

```js
// §146.1: faixa "Distribuição" (Manual / Sombra; Automático chega na §146.2), avisos e tabela por consultor.
const KB_DIST_ESTADO = { na_vez: 'Na vez', pendente: 'Aguardando ligar', pausa: 'Em pausa', offline: 'Fora do painel', fora: 'Fora do horário' };
const KB_DIST_MODO = { manual: 'Manual', sombra: 'Sombra', automatico: 'Automático' };
async function kbCarregarDistrib(){
  const r = await ppSeguro(() => sb.rpc('leads_dist_equipe', { p_dias: 1 }));
  kbEstado.distrib = r && !r.error ? r.data : null;   // banco sem a função: a faixa some
}
function kbPct(x){ return x === null || x === undefined ? '—' : `${Math.round(Number(x) * 100)}%`; }
function kbFaixaDistribHtml(d){
  if(!d || !d.cfg) return '';
  const modo = d.cfg.modo || 'manual', av = d.aviso || {}, cons = Array.isArray(d.consultores) ? d.consultores : [];
  const det = modo === 'manual' ? 'Cada consultor pega nos Livres, como hoje. Os números abaixo já medem a velocidade de quem pega.'
    : modo === 'sombra' ? 'Ninguém recebe sozinho: o sistema só anota para quem mandaria cada lead (coluna "teria").'
    : 'O lead vai sozinho para quem está na vez.';
  const btn = (m) => `<button type="button" class="kbBtn kbBtnSm ${m === modo ? 'kbBtnP' : 'kbBtnQ'}" data-kb-dist-modo="${m}"${m === 'automatico' ? ' disabled title="Liberado na próxima etapa (§146.2)"' : ''}>${KB_DIST_MODO[m]}</button>`;
  const alertas = [];
  if(av.robo_parado !== undefined) alertas.push('Robô do ProContact sem importar há mais de 30 min: confirmação das ligações suspensa (ninguém perde ponto).');
  if(av.motor_erro && av.motor_erro.em && Date.now() - kbMs(av.motor_erro.em) < 86400000) alertas.push('A distribuição deu erro há pouco; os leads ficaram nos Livres.');
  const parados = (Array.isArray(av.parados) ? av.parados : []).filter(p => p && p.em && Date.now() - kbMs(p.em) < 86400000).length;
  if(parados) alertas.push(parados === 1 ? '1 lead parou de circular (devolvido 2 vezes) e está nos Livres.' : `${parados} leads pararam de circular (devolvidos 2 vezes) e estão nos Livres.`);
  const linhas = cons.map(c => `<tr><td>${escapeHtml(c.nome || '')}</td><td>${escapeHtml(KB_DIST_ESTADO[c.estado] || c.estado || '')}</td>`
    + `<td class="r">${kbPct(c.fatia)}</td><td class="r">${Number(c.recebidos_hoje) || 0}</td>`
    + `<td class="r">${Number(c.vel_ok) || 0} de ${Number(c.vel_n) || 0}</td><td class="r">${kbPct(c.conv)}</td>`
    + `<td class="r">${Number(c.devolvidos_hoje) || 0}</td><td class="r">${Number(c.clicou_nao_ligou) ? `<b class="kbDistAlerta">${Number(c.clicou_nao_ligou)}</b>` : '0'}</td>`
    + `<td class="r">${Number(c.teria) || 0} teria · ${Number(c.recebeu) || 0} recebeu</td></tr>`).join('');
  const cfgForm = kbEstado.distCfgAberta ? `<form class="kbDistCfg" data-kb-dist-form>`
    + `<label>Peso da conversão (%) <input name="peso" type="number" min="0" max="100" value="${Math.round((Number(d.cfg.peso_conversao) || 0) * 100)}"></label>`
    + `<label>Piso (%) <input name="piso" type="number" min="0" max="30" value="${Math.round((Number(d.cfg.piso) || 0) * 100)}"></label>`
    + `<label>Teto (%) <input name="teto" type="number" min="20" max="100" value="${Math.round((Number(d.cfg.teto) || 0) * 100)}"></label>`
    + `<label>Atender em (min) <input name="atender" type="number" min="1" max="60" value="${Number(d.cfg.prazo_atender_min) || 5}"></label>`
    + `<label>Devolver em (min) <input name="devolver" type="number" min="2" max="120" value="${Number(d.cfg.prazo_devolver_min) || 15}"></label>`
    + `<button type="submit" class="kbBtn kbBtnSm kbBtnP">Salvar</button></form>` : '';
  return `<div class="kbEqPegar kbEqDist"><span><b>Distribuição: ${KB_DIST_MODO[modo] || modo}</b><small>${det}${d.fila ? ` ${Number(d.fila)} na fila.` : ''}</small></span>`
    + `<span class="kbSeg">${btn('manual')}${btn('sombra')}${btn('automatico')}</span>`
    + `<button type="button" class="kbBtn kbBtnSm kbBtnG" data-kb-dist-cfg>${kbEstado.distCfgAberta ? 'Fechar ajustes' : 'Ajustes'}</button></div>`
    + cfgForm
    + (alertas.length ? `<div class="kbEqAlertas">${alertas.map(t => `<p class="kbEqAlerta">${escapeHtml(t)}</p>`).join('')}</div>` : '')
    + `<div class="kbEqTabela"><table><thead><tr><th>Consultor</th><th>Agora</th><th class="r">Fatia hoje</th><th class="r">Recebidos hoje</th>`
    + `<th class="r">Rápidos (5 min)</th><th class="r">Conversão 14 d</th><th class="r">Devolvidos hoje</th><th class="r">Clicou e não ligou (14 d)</th><th class="r">Sombra hoje</th></tr></thead>`
    + `<tbody>${linhas || '<tr><td colspan="9" class="kbMuted">Ninguém pega leads agora.</td></tr>'}</tbody></table>`
    + `<p class="kbEqLegenda">Fatia: parte dos leads do dia que cabe a cada um (nota = metade conversão, metade velocidade; mínimo ${kbPct(d.cfg.piso)}, máximo ${kbPct(d.cfg.teto)}). Rápidos: dos últimos 10 leads, quantos ligou ou tabulou em até ${Number(d.cfg.prazo_atender_min) || 5} min. Clicou e não ligou: clique no telefone sem ligação no ProContact.</p></div>`;
}
async function kbDistModo(modo){
  if(modo === 'automatico' || kbEstado.distMudando || !KB_DIST_MODO[modo]) return;   // §146.1: automático só na §146.2
  kbEstado.distMudando = true;
  const r = await ppSeguro(() => sb.rpc('leads_dist_config', { p: { modo } }));
  kbEstado.distMudando = false;
  if(!r || r.error){ mostrarAviso((r && r.error && r.error.message) || 'Não foi possível mudar a distribuição agora.', 'erro'); return; }
  mostrarAviso(`Distribuição em ${KB_DIST_MODO[modo]}.`, 'ok');
  await kbCarregarDistrib();
  if(kbEstado.aba === 'equipe') kbRenderEquipe();
}
async function kbDistSalvarCfg(f){
  const n = (v) => Number(String(v).replace(',', '.'));
  const p = { peso_conversao: n(f.peso) / 100, piso: n(f.piso) / 100, teto: n(f.teto) / 100, prazo_atender_min: Math.round(n(f.atender)), prazo_devolver_min: Math.round(n(f.devolver)) };
  if(Object.values(p).some(v => !isFinite(v))){ mostrarAviso('Preencha todos os ajustes com números.', 'erro'); return; }
  const r = await ppSeguro(() => sb.rpc('leads_dist_config', { p }));
  if(!r || r.error){ mostrarAviso((r && r.error && r.error.message) || 'Não foi possível salvar os ajustes.', 'erro'); return; }
  mostrarAviso('Ajustes da distribuição salvos.', 'ok');
  kbEstado.distCfgAberta = false;
  await kbCarregarDistrib();
  if(kbEstado.aba === 'equipe') kbRenderEquipe();
}
```

Antes de usar `kbMs`, conferir que ela existe (`grep -n "function kbMs" _template.html`); ela é usada em `kbDiaSP`. Se o teste do Step 1 esperar `'1 lead parou'` e o texto acima disser `'1 lead parou de circular'`, o teste passa (usa `includes`).

4b. Em `kbCarregarEquipe`, acrescentar `kbCarregarDistrib(),` dentro do `Promise.all([...])`, depois de `kbCarregarBloqueio(),`.

4c. Em `kbRenderEquipe`, linha `document.getElementById('kbEquipe').innerHTML = kbFaixaPegarHtml(…) + topo + …`, trocar o começo por `kbFaixaPegarHtml(kbEstado.pegarBloqueio, ativ, agoraMs) + kbFaixaDistribHtml(kbEstado.distrib) + topo + …`.

4d. No clique delegado da Equipe (linha ~6383, onde está `const pb = e.target.closest('[data-kb-pegar-bloquear]');`), acrescentar antes dela:

```js
  const dm = e.target.closest('[data-kb-dist-modo]');
  if(dm){ if(!dm.disabled) kbDistModo(dm.dataset.kbDistModo); return; }
  if(e.target.closest('[data-kb-dist-cfg]')){ kbEstado.distCfgAberta = !kbEstado.distCfgAberta; kbRenderEquipe(); return; }
```

E um ouvinte de `submit` no mesmo contêiner (`#kbEquipe`), registrado uma única vez onde os outros ouvintes da Equipe são registrados:

```js
document.getElementById('kbEquipe').addEventListener('submit', function(e){
  const f = e.target.closest('[data-kb-dist-form]');
  if(!f) return;
  e.preventDefault();
  const v = (n) => (f.elements[n] || {}).value;
  kbDistSalvarCfg({ peso: v('peso'), piso: v('piso'), teto: v('teto'), atender: v('atender'), devolver: v('devolver') });
});
```

4e. CSS, logo depois da linha `.kbEqPegar b{…}` (~1089):

```css
  .kbEqDist .kbSeg{margin-left:auto;}
  .kbDistAlerta{color:var(--ml-late);}
  .kbDistCfg{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:flex-end;padding:12px 16px;background:var(--ml-surface);border-radius:var(--radius-lg);margin-top:var(--space-2);}
  .kbDistCfg label{display:flex;flex-direction:column;font-size:var(--fs-xs);color:var(--ml-ink-2);gap:4px;}
  .kbDistCfg input{width:90px;}
```

- [ ] **Step 5: Rodar o teste novo e a suíte**

```bash
NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_distribuicao.js
NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules bash run_tests.sh
```

Esperado: `--- RESULTADO: N passaram, 0 falharam ---` no teste novo. Na suíte, nenhuma falha nova (as conhecidas e instáveis — `test_conversao_vendas.js`, `test_pedidos_alerta` — estão na memória de publicação; comparar com uma rodada na `oficial/main` se houver dúvida). Rodar de novo `test_leads_bloqueio.js`, `test_leads_painel_hoje.js`, `test_meus_leads_fase3.js` isolados e conferir 0 falhas.

- [ ] **Step 6: Conferir HTML**

```bash
python build_painel.py
python - <<'EOF'
import re
t = open('_template.html', encoding='utf-8').read()
print('div abre', len(re.findall(r'<div\b', t)), 'fecha', len(re.findall(r'</div>', t)))
EOF
```

Comparar com a contagem na `oficial/main` (`git show oficial/main:_template.html | python -c "…"`): a diferença de aberturas e fechamentos deve ser igual (as divs novas estão dentro de strings JS e abrem/fecham em par).

- [ ] **Step 7: Commit**

```bash
git add _template.html painel_clientes_apex.html test_leads_distribuicao.js
git commit -m "feat(painel): §146.1 presença, clique no telefone conta como ligar e faixa Distribuição na Equipe

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: REGRAS §146, banco, cron, publicação e Sombra ligada (só com ok do Rafael)

**Files:**
- Create: `supabase/migrations/20261109120500_leads_dist_cron.sql`
- Modify: `REGRAS_NEGOCIO.md` (nova §146 + §146.1; "Próxima livre" → §147)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: banco com as 5 migrations + cron `leads-dist-tick`; painel no ar; `config.leads_distribuicao.modo = 'sombra'`.

- [ ] **Step 1: Cron**

`supabase/migrations/20261109120500_leads_dist_cron.sql`:

```sql
-- §146.1: tick da distribuição a cada 1 min (o próprio tick sai cedo em manual e fora do expediente).
-- Voltar atrás: select cron.unschedule('leads-dist-tick');
select cron.schedule('leads-dist-tick', '* * * * *', $job$select public.leads_dist_tick()$job$);
```

- [ ] **Step 2: REGRAS_NEGOCIO.md**

Antes, `git fetch oficial` e conferir que a §146 continua livre (`grep -n "Próxima livre" REGRAS_NEGOCIO.md` na `oficial/main`). Acrescentar no fim, no padrão das seções anteriores, uma **§146 Distribuição automática de leads (09/11/2026)** com: o pedido; as decisões da spec §2 (tabela curta); as regras (spec §3–§8, resumidas em tópicos); a lista de funções e tabelas; os modos e como voltar atrás (Manual na Equipe; `cron.unschedule('leads-dist-tick')`); e a **§146.1** com o que foi ao ar (banco + Sombra + Equipe; consultor sem mudança visível) e a pendência da §146.2. Trocar a linha "Próxima livre: §146 …" por "Próxima livre: §147 (§138.2, §138.3 e §143.2 reservadas)."

```bash
git add supabase/migrations/20261109120500_leads_dist_cron.sql REGRAS_NEGOCIO.md
git commit -m "docs(regras): §146 distribuição automática de leads (§146.1)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: Pedir ok ao Rafael (PARAR aqui até a resposta)**

Mostrar: resumo do que vai para o banco (5 migrations, 3 funções existentes reescritas com gancho, 1 cron) e para o painel (faixa nova na Equipe; presença; clique). Dizer que o modo fica **Manual** ao aplicar e que a Sombra é ligada no fim pela própria faixa.

- [ ] **Step 4: Banco (com ok)**

Na ordem, cada uma em um `execute_sql` com o conteúdo inteiro do arquivo (já tem `begin`/`commit`): `…120000_leads_dist_base.sql`, `…120100_leads_dist_notas.sql`, `…120200_leads_dist_motor.sql`, `…120300_leads_dist_tick.sql` (antes, repetir o Step 3 da Task 4: as 3 funções não mudaram no ar), `…120400_leads_dist_painel.sql`, `…120500_leads_dist_cron.sql`. Depois:

```sql
select public.leads_dist_cfg() ->> 'modo';                                    -- manual
select jobname, schedule from cron.job where jobname = 'leads-dist-tick';     -- * * * * *
select public.leads_dist_tick();                                              -- {"modo":"manual",…}
```

E rodar de novo os 5 checks contra o banco já aplicado, sem migrations: `python supabase/tests/leads_dist_montar.py "$SCRATCH/f.sql" -- supabase/tests/leads_dist_<nome>_check.sql`. Esperado: todos `ok` (tudo desfeito; o modo continua manual).

- [ ] **Step 5: Publicar o painel (com ok, seguindo a memória de publicação)**

`git fetch oficial`; juntar `oficial/main` na branch (`git merge oficial/main`, resolver conflito de `_template.html` sem perder nada); `bash run_tests.sh`; `python build_painel.py`; baixar o painel do ar e comparar; backup no servidor `~/deploy_backups/painel_clientes_apex_<data>_antes_distribuicao.html`; no **mesmo comando**: `ssh hostinger md5sum …` → conferir que é o MD5 esperado do ar → `scp`; conferir o MD5 novo; `git push oficial feat/leads-distribuicao:main` (sem force, fast-forward); `vigia/vigia_painel.ps1 -Aceitar`.

- [ ] **Step 6: Ligar a Sombra e conferir**

No painel (Equipe), clicar **Sombra**, ou por SQL com ok: `select public.leads_dist_config('{"modo":"sombra"}')` (precisa de login de gestor; pelo conector, fazer `update public.config set valor = (valor::jsonb || '{"modo":"sombra"}')::text where chave = 'leads_distribuicao';`). Depois de alguns minutos com lead entrando:

```sql
select count(*) from public.leads_dist_sombra;
select consultor_id, tipo, recebido_em, atendido_em, sinal from public.leads_distribuicao order by id desc limit 10;
select valor from public.config where chave = 'leads_distribuicao_aviso';
```

Registrar na memória (`apex-leads-distribuicao.md`): MD5 do painel, commit da oficial, hora em que a Sombra ligou. Combinar com o Rafael o dia de olhar o relatório "teria × recebeu" antes de escrever o plano da §146.2.
