# Meus leads §122 (quem pega, Hoje em painel, Equipe com atividade, filtros, Todos, lead novo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Só Luria/Lucas/Caio/Mariana pegam lead; a aba Hoje vira um painel (cartões por etapa, Faça agora, placar); a Equipe do supervisor ganha contagens clicáveis e o semáforo de ligação/OBS; o Quadro ganha filtros; nasce a aba Todos; os 4 recebem aviso de lead novo; o Copiar do telefone sai sem `p:+55`.

**Architecture:** Duas migrations aditivas no Supabase (sem `drop`): `leads_equipe.pode_pegar` + trava em `leads_pegar` + `placar` em `leads_hoje` + alerta `lead_novo` em `leads_alertas`; e `leads_kanban3(p_dono, p_todos)` + `leads_atividade_equipe()`. No painel (`_template.html`, bloco "Meus leads"), funções puras novas (testáveis no jsdom) fazem as contas de cartões, Faça agora, filtros, semáforo, ordenação e página; as telas só montam HTML com elas.

**Tech Stack:** HTML/JS puro em `_template.html` (gerado para `painel_clientes_apex.html` por `build_painel.py`), Supabase Postgres (plpgsql, RPC `security definer`), testes jsdom (`test_*.js`) e checks SQL com `rollback` (`supabase/tests/*.sql`).

**Spec:** `docs/superpowers/specs/2026-10-28-meus-leads-painel-hoje-design.md`

## Global Constraints

- Editar só `_template.html`; o painel é gerado por `python build_painel.py`. Nunca editar `painel_clientes_apex.html` à mão.
- Design "Sinal de Ápice": cor só por variável (`var(--c-sinal)`, `var(--muted)`, `var(--st-ganho)`, `var(--st-andamento)`, `var(--c-linha)`, `var(--c-papel)`…), nunca hex; reaproveitar `.card`, `.kpiGrid`, `table.tbl`, `.btn`, `.btn-sm`, `.btn-outline`, `.field`, `.filterPill`, `.kbLink`, `.kbMeta`, `.kbLista`. CSS novo vai no `<style id="kbStyles">`.
- Avisos com `mostrarAviso(msg, 'ok'|'erro'|'info')`.
- Repo público: testes só com dados fictícios (prefixo `Zz`, telefones `119000000xx`, e-mails `@teste.invalid`).
- Banco é produção (`mdgfboijyqfkggcrhptn`). Ensaios das migrations rodam numa transação que termina em `rollback`, e mesmo assim **só com ok do Rafael** (um ok cobre os ensaios desta feature). Aplicar de verdade só na Task 9, com ok. Nada de `drop` (o conector falha); `create or replace` e `add column if not exists`.
- Expediente do semáforo: **13h–21h, segunda a sexta, São Paulo** (UTC−3, sem horário de verão). Limites: **amarelo ≥ 30 min, vermelho ≥ 60 min**.
- Pegam lead: **Luria, Lucas, Caio, Mariana** (`leads_equipe.nome_planilha`). Quem já tem lead fica com ele; `leads_redistribuir` não muda.
- Telefone copiado: só dígitos, sem `55` inicial quando sobram 10 ou 11 dígitos (`p:+5511999998888` → `11999998888`).
- Rodar testes: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node <arquivo>` dentro do worktree `.worktrees/leads-painel-hoje`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Consultor fora dos 4 que acha um lead Livre pela pesquisa** → a ficha não oferece "Pegar"; mostra "Você não está liberado para pegar leads." (teste na Task 3).
2. **Painel aberto com 10 leads novos já esperando** → nada apita no primeiro carregamento; só o lead que chegar depois apita, uma vez (teste na Task 8).
3. **Supervisor às 12:59, às 21:00 e no sábado** → semáforo cinza "fora do expediente"; às 13:10 quem não fez nada desde ontem fica verde (10 min), não vermelho (teste na Task 6).
4. **Consultor sem usuário de telefonia (Gabriel, Vitoria)** → Equipe mostra "sem usuário de telefonia" e o semáforo usa só a OBS, sem quebrar (teste na Task 6 e no check SQL da Task 2).
5. **Filtro que zera o Quadro** (ex.: "5+ dias" sem nenhum lead) → colunas mostram o vazio normal, contagens 0, "Limpar" volta tudo; filtros guardados no navegador sobrevivem a recarregar, e `localStorage` bloqueado não quebra a tela (teste na Task 4).

---

### Task 1: Banco — pode_pegar, trava no pegar, placar da Hoje, alerta de lead novo

**Files:**
- Create: `supabase/migrations/20261028100000_leads_pode_pegar.sql`
- Create: `supabase/tests/leads_painel_hoje_check.sql`

**Interfaces:**
- Produces: coluna `leads_equipe.pode_pegar boolean not null default false`; `leads_pegar(p_aba text, p_id text)` lança `42501` "você não está liberado para pegar leads" para membro sem `pode_pegar`; `leads_hoje(p_dono uuid)` devolve também `placar: {classificacoes int, retornos_hoje int, retornos_cumpridos int}`; `leads_alertas(p_dono uuid)` devolve também linhas `tipo = 'lead_novo'` (`dono_id`/`dono_nome` nulos) para quem tem `pode_pegar` e não é gestor.

- [ ] **Step 1: Escrever o check (vai falhar antes da migration)**

Criar `supabase/tests/leads_painel_hoje_check.sql`:

```sql
-- Verificação das migrations 20261028100000/100100 (§122). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.psup@teste.invalid'),
('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ppode@teste.invalid'),
('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.pnao@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e501', 'Zzpsup Teste', 'zz.psup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e502', 'Zzppode Teste', 'zz.ppode', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e503', 'Zzpnao Teste', 'zz.pnao', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar, pode_pegar, usuario_telefonia) values
('ZZPPODE', '00000000-0000-0000-0000-00000000e502', false, true, 'zz.ppode.tel'),
('ZZPNAO', '00000000-0000-0000-0000-00000000e503', false, false, null);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, campaign_name, form_name, categoria, status, obs, converteu, receita, dono_id, pego_em, classificado_em) values
('JUNHO', 'zp:livre',  now() - interval '30 minutes', 'Zz Livre Novo',  '11900000051', '00000000000151', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, null, null, null),
('JUNHO', 'zp:velho',  now() - interval '5 hours',    'Zz Livre Velho', '11900000052', '00000000000152', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, null, null, null),
('JUNHO', 'zp:dele',   now() - interval '3 hours',    'Zz Do Nao',      '11900000053', '00000000000153', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, '00000000-0000-0000-0000-00000000e503', now() - interval '2 hours', null),
('JUNHO', 'zp:antigo', now() - interval '80 days',    'Zz Perdido Velho','11900000054', '00000000000154', 'Zz Camp', 'Zz Form', 'perdido', 'CNPJ INAPTO', null, false, 0, '00000000-0000-0000-0000-00000000e502', now() - interval '79 days', now() - interval '70 days');
insert into public.leads_historico (lead_aba, lead_id, acao, por, em, antes, depois) values
('JUNHO', 'zp:dele', 'classificar', '00000000-0000-0000-0000-00000000e502', now() - interval '20 minutes', '{"obs": ""}'::jsonb, '{"obs": "Zz falou com o dono"}'::jsonb),
('JUNHO', 'zp:dele', 'classificar', '00000000-0000-0000-0000-00000000e502', now() - interval '10 minutes', '{"obs": "Zz falou com o dono"}'::jsonb, '{"obs": "Zz falou com o dono"}'::jsonb);
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999600001, 'zz.ppode.tel', '11900000053', public.chave_tel('11900000053'), now() - interval '15 minutes', false, 0, 'ZZ TAB');

do $$
declare j jsonb; n int;
begin
  execute 'set local role authenticated';
  -- ===== Task 1 =====
  -- quem não pode pegar recebe erro; quem pode pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e503', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e503', true);
  begin
    perform public.leads_pegar('JUNHO', 'zp:livre');
    assert false, 'consultor sem pode_pegar pegou lead';
  exception when insufficient_privilege then
    assert sqlerrm like '%não está liberado%', 'mensagem da trava: ' || sqlerrm;
  end;
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo'), 'sem pode_pegar não recebe lead_novo';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  assert exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:livre' and a.dono_id is null), 'pode_pegar recebe lead_novo do livre recente';
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:velho'), 'livre de mais de 2 h não é lead_novo';
  j := public.leads_hoje(null);
  assert (j->'placar'->>'classificacoes')::int = 2, 'placar: 2 classificações hoje, veio ' || coalesce(j->'placar'->>'classificacoes', 'null');
  assert j->'placar' ? 'retornos_hoje' and j->'placar' ? 'retornos_cumpridos', 'placar tem retornos';
  j := public.leads_pegar('JUNHO', 'zp:livre');
  assert (j->>'ok')::boolean, 'consultor com pode_pegar pega o lead';
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:livre'), 'lead pego some do lead_novo';
  -- supervisor: não recebe lead_novo e continua redistribuindo para quem não pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e501', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e501', true);
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo'), 'gestor não recebe lead_novo';
  perform public.leads_redistribuir('JUNHO', 'zp:livre', '00000000-0000-0000-0000-00000000e503');
  assert (select dono_id from public.leads where aba = 'JUNHO' and id = 'zp:livre') = '00000000-0000-0000-0000-00000000e503', 'redistribuir para quem não pega continua valendo';
  -- ===== Task 2 =====
  raise notice 'CHECK OK';
end $$;
rollback;
```

- [ ] **Step 2: Rodar o ensaio só do check e ver falhar**

Pedir ao Rafael o ok para os ensaios com `rollback` (um ok vale para os ensaios desta feature). Montar o arquivo e rodar pelo `execute_sql` do Supabase (projeto `mdgfboijyqfkggcrhptn`) com o conteúdo de `$SCRATCH/ensaio.sql`:

```bash
SCRATCH="$(mktemp -d)"; cp supabase/tests/leads_painel_hoje_check.sql "$SCRATCH/ensaio.sql"; echo "$SCRATCH/ensaio.sql"
```

Esperado: erro `column "pode_pegar" of relation "leads_equipe" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261028100000_leads_pode_pegar.sql`:

```sql
-- §122 (28/10, Rafael): só Luria, Lucas, Caio e Mariana pegam lead (quem já tem lead fica com ele; o gestor
-- continua redistribuindo para qualquer um). Hoje ganha o placar do dia. Quem pode pegar recebe o alerta lead_novo.
alter table public.leads_equipe add column if not exists pode_pegar boolean not null default false;
update public.leads_equipe set pode_pegar = true where nome_planilha in ('Luria', 'Lucas', 'Caio', 'Mariana');

create or replace function public.leads_pegar(p_aba text, p_id text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nome text; v_pode boolean; v_dono text; n int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select e.nome_planilha, e.pode_pegar into v_nome, v_pode from public.leads_equipe e where e.profile_id = auth.uid() order by e.id limit 1;
  if v_nome is null then raise exception 'só a equipe de leads pode pegar lead' using errcode = '42501'; end if;
  if not coalesce(v_pode, false) then raise exception 'você não está liberado para pegar leads' using errcode = '42501'; end if;
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
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor', v_nome);
end $function$;

create or replace function public.leads_hoje(p_dono uuid default null::uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_esf int;
        v_ini_mes timestamptz; v_ini_dia timestamptz; v_fim_dia timestamptz; v_out jsonb;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_esf := coalesce(((select valor::jsonb from public.config where chave = 'leads_alertas') ->> 'esfriando_dias')::int, 2);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_fim_dia := (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo';
  with base as (
    select l.aba as b_aba, l.id as b_id, l.full_name as b_nome, l.categoria as b_cat, l.pego_em as b_pego, l.criado_em_lead as b_criado,
           l.classificado_em as b_class, l.status as b_status, i.ultimo as b_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null and (v_alvo is null or l.dono_id = v_alvo)
       and (l.categoria in ('sem_contato', 'andamento')
            or (l.categoria = 'perdido' and coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes
                and public.norm_nome(l.status) = 'cliente nao responde'))
  ), ret as (
    select a.lead_aba as r_aba, a.lead_id as r_id, a.quando as r_quando from public.agenda_retornos a
     where a.status = 'pendente' and a.lead_id is not null and (v_alvo is null or a.consultor_id = v_alvo)
  ), fila as (
    select 1 as prio, b.b_aba, b.b_id, b.b_nome, 'Novo sem contato'::text as motivo, coalesce(b.b_pego, b.b_criado) as desde from base b
     where b.b_cat = 'sem_contato' and b.b_ult is null
    union all
    select 2, b.b_aba, b.b_id, b.b_nome, 'Retorno vencido', r.r_quando from base b join ret r on r.r_aba = b.b_aba and r.r_id = b.b_id
     where r.r_quando <= now()
    union all
    select 3, b.b_aba, b.b_id, b.b_nome, 'Esfriando', coalesce(b.b_ult, b.b_pego, b.b_criado) from base b
     where b.b_cat = 'andamento' and coalesce(b.b_ult, b.b_pego, b.b_criado) < now() - make_interval(days => v_esf)
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())
    union all
    select 4, b.b_aba, b.b_id, b.b_nome, 'Para resgatar', coalesce(b.b_ult, b.b_class, b.b_criado) from base b
     where b.b_cat = 'perdido' and coalesce(b.b_ult, b.b_class, b.b_criado) < now() - make_interval(days => v_esf)
       and not exists (select 1 from ret r where r.r_aba = b.b_aba and r.r_id = b.b_id and r.r_quando > now())
  ), unica as (
    select distinct on (f.b_aba, f.b_id) f.* from fila f order by f.b_aba, f.b_id, f.prio
  ), rh as (   -- §122: retornos marcados para hoje (não cancelados)
    select a.lead_aba as h_aba, a.lead_id as h_id, a.status as h_status from public.agenda_retornos a
     where a.lead_id is not null and a.status <> 'cancelado' and a.quando >= v_ini_dia and a.quando < v_fim_dia
       and (v_alvo is null or a.consultor_id = v_alvo)
  )
  select jsonb_build_object(
    'fila', coalesce((select jsonb_agg(jsonb_build_object('aba', u.b_aba, 'lead_id', u.b_id, 'nome', u.b_nome, 'motivo', u.motivo, 'desde', u.desde)
                                       order by u.prio, u.desde) from unica u), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('aba', r.r_aba, 'lead_id', r.r_id, 'nome', l.full_name, 'quando', r.r_quando,
                                                             'vencido', r.r_quando <= now()) order by r.r_quando)
                            from ret r join public.leads l on l.aba = r.r_aba and l.id = r.r_id where r.r_quando < v_fim_dia), '[]'::jsonb),
    'livres', (select count(*) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
                 and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null and l.criado_em_lead >= now() - interval '60 days'),
    'placar', jsonb_build_object(
      'classificacoes', (select count(*) from public.leads_historico h
                          where h.acao = 'classificar' and h.em >= v_ini_dia and (v_alvo is null or h.por = v_alvo)),
      'retornos_hoje', (select count(*) from rh),
      'retornos_cumpridos', (select count(*) from rh
                               join public.leads l on l.aba = rh.h_aba and l.id = rh.h_id
                               cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
                              where rh.h_status = 'feito' or i.ultimo >= v_ini_dia
                                 or exists (select 1 from public.leads_historico h where h.lead_aba = rh.h_aba and h.lead_id = rh.h_id
                                               and h.acao = 'classificar' and h.em >= v_ini_dia))))
  into v_out;
  return v_out;
end $function$;

create or replace function public.leads_alertas(p_dono uuid default null::uuid)
 returns table(tipo text, aba text, lead_id text, nome text, dono_id uuid, dono_nome text, desde timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_cfg jsonb;
        v_min int; v_parado int; v_ini_mes timestamptz; v_aberto boolean; v_inicio timestamptz; v_pode boolean;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_pode := not v_gestor and exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid() and e.pode_pegar);
  v_cfg := coalesce((select valor::jsonb from public.config where chave = 'leads_alertas'), '{}'::jsonb);
  v_min := coalesce((v_cfg ->> 'sem_contato_min')::int, 15);
  v_parado := coalesce((v_cfg ->> 'parado_dias')::int, 3);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select x.aberto, x.inicio into v_aberto, v_inicio from public.leads_expediente_hoje() x;
  return query
  with base as (
    select l.aba as l_aba, l.id as l_id, l.full_name as l_nome, l.dono_id as l_dono, l.categoria as l_cat,
           l.pego_em as l_pego, l.criado_em_lead as l_criado, l.classificado_em as l_class, i.ligacoes as l_lig, i.ultimo as l_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (v_alvo is null or l.dono_id = v_alvo)
       and (l.categoria in ('sem_contato', 'andamento')
            or (l.categoria = 'perdido' and coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
  ), al as (
    select 'sem_contato'::text as a_tipo, b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_pego, b.l_criado) as a_desde from base b
     where b.l_cat = 'sem_contato' and b.l_ult is null and v_aberto
       and now() - greatest(coalesce(b.l_pego, b.l_criado), v_inicio) >= make_interval(mins => v_min)
    union all
    select 'parado', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_ult, b.l_pego, b.l_criado) from base b
     where b.l_cat = 'andamento' and coalesce(b.l_ult, b.l_pego, b.l_criado) < now() - make_interval(days => v_parado)
       and not exists (select 1 from public.agenda_retornos a where a.lead_aba = b.l_aba and a.lead_id = b.l_id
                          and a.status = 'pendente' and a.quando > now())
    union all
    select 'perda_suspeita', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_class, b.l_criado) from base b
     where v_gestor and b.l_cat = 'perdido' and b.l_lig = 0
    union all
    select 'retorno_vencido', b.l_aba, b.l_id, b.l_nome, b.l_dono, a.quando from base b
      join public.agenda_retornos a on a.lead_aba = b.l_aba and a.lead_id = b.l_id and a.status = 'pendente'
     where a.quando < now() and (b.l_ult is null or b.l_ult < a.quando)
    union all   -- §122: lead livre que chegou há menos de 2 h, só para quem pode pegar
    select 'lead_novo', l.aba, l.id, l.full_name, null::uuid, l.criado_em_lead from public.leads l
     where v_pode and l.dono_id is null and l.categoria = 'sem_contato' and coalesce(l.aba, '') <> 'REPIQUE'
       and l.apagado_em is null and l.criado_em_lead >= now() - interval '2 hours'
  )
  select al.a_tipo, al.l_aba, al.l_id, al.l_nome, al.l_dono, p.nome, al.a_desde
    from al left join public.profiles p on p.id = al.l_dono
   order by al.a_desde;
end $function$;
```

- [ ] **Step 4: Rodar o ensaio migration + check e ver passar**

```bash
{ echo 'begin;'; cat supabase/migrations/20261028100000_leads_pode_pegar.sql; sed '1,/^begin;$/d;$d' supabase/tests/leads_painel_hoje_check.sql; echo 'rollback;'; } > "$SCRATCH/ensaio.sql"; wc -c "$SCRATCH/ensaio.sql"
```

Rodar o conteúdo pelo `execute_sql`. Esperado: termina sem erro (o `raise notice 'CHECK OK'` não aparece no conector; sem erro = passou). Se o conector recusar ("Invalid or expired requestState"), conferir que não há `drop` no texto e tentar de novo; persistindo, anotar no ledger e seguir com o check só na Task 9.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028100000_leads_pode_pegar.sql supabase/tests/leads_painel_hoje_check.sql
git commit -m "feat(meus-leads): so quem tem pode_pegar pega lead, placar na Hoje e alerta lead_novo (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Banco — leads_kanban3 (campanha, formulário, modo Todos) e leads_atividade_equipe

**Files:**
- Create: `supabase/migrations/20261028100100_leads_kanban3_atividade.sql`
- Modify: `supabase/tests/leads_painel_hoje_check.sql` (bloco `-- ===== Task 2 =====`)

**Interfaces:**
- Consumes: `leads_equipe.pode_pegar` (Task 1, só nos dados de teste).
- Produces: `leads_kanban3(p_dono uuid default null, p_todos boolean default false)` → mesmas colunas de `leads_kanban2` + `campanha text, formulario text`; com `p_todos = true` traz todas as etapas de todos os meses e **nenhum** livre. `leads_atividade_equipe()` (só admin/supervisor) → `dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamptz, lig_hoje int, ultima_obs timestamptz, obs_hoje int`.

- [ ] **Step 1: Acrescentar ao check (antes de `raise notice 'CHECK OK'`)**

Substituir a linha `  -- ===== Task 2 =====` por:

```sql
  -- ===== Task 2 =====
  -- consultor: Quadro só do mês; Todos traz o perdido de 70 dias atrás, sem livres, com campanha/formulário
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  assert not exists (select 1 from public.leads_kanban3(null, false) k where k.lead_id = 'zp:antigo'), 'Quadro não traz perdido de meses atrás';
  assert exists (select 1 from public.leads_kanban3(null, true) k where k.lead_id = 'zp:antigo' and k.campanha = 'Zz Camp' and k.formulario = 'Zz Form'), 'Todos traz o perdido antigo com campanha e formulário';
  assert not exists (select 1 from public.leads_kanban3(null, true) k where k.livre), 'Todos não traz livres';
  assert exists (select 1 from public.leads_kanban3(null, false) k where k.lead_id = 'zp:velho' and k.livre and k.telefone is null), 'Quadro continua com livres (sem telefone para consultor)';
  begin
    perform * from public.leads_atividade_equipe();
    assert false, 'consultor viu a atividade da equipe';
  exception when insufficient_privilege then null;
  end;
  -- supervisor: OBS igual à anterior não conta; quem não tem usuário de telefonia não quebra
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e501', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e501', true);
  assert (select obs_hoje = 1 and ultima_obs is not null and tem_telefonia and lig_hoje = 1 and ultima_ligacao is not null
            from public.leads_atividade_equipe() a where a.dono_id = '00000000-0000-0000-0000-00000000e502'), 'atividade: 1 OBS nova e 1 ligação hoje';
  assert (select not tem_telefonia and lig_hoje = 0 and ultima_ligacao is null and obs_hoje = 0
            from public.leads_atividade_equipe() a where a.dono_id = '00000000-0000-0000-0000-00000000e503'), 'atividade: sem usuário de telefonia';
```

- [ ] **Step 2: Ensaio (só Task 1 aplicada) e ver falhar**

```bash
{ echo 'begin;'; cat supabase/migrations/20261028100000_leads_pode_pegar.sql; sed '1,/^begin;$/d;$d' supabase/tests/leads_painel_hoje_check.sql; echo 'rollback;'; } > "$SCRATCH/ensaio.sql"
```

Rodar pelo `execute_sql`. Esperado: `function public.leads_kanban3(unknown, boolean) does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261028100100_leads_kanban3_atividade.sql`:

```sql
-- §122 (28/10): leads_kanban3 = leads_kanban2 + campanha/formulário (filtro de origem) + modo Todos (todas as etapas e
-- meses, sem livres). Nome novo porque mudar o retorno exige drop, e o conector do Supabase falha com drop.
-- leads_atividade_equipe: semáforo do supervisor (ligações pela regra da mesa_ligacoes_hoje + OBS escritas).
create or replace function public.leads_kanban3(p_dono uuid default null::uuid, p_todos boolean default false)
 returns table(aba text, lead_id text, nome text, cidade text, uf text, qtd_linhas text, tipo_empresa text, telefone text, email text, cnpj text,
               status text, categoria text, obs text, converteu boolean, receita numeric, retorno_em date, dono_id uuid, dono_nome text,
               pego_em timestamp with time zone, classificado_em timestamp with time zone, criado_em_lead timestamp with time zone,
               primeiro_clique timestamp with time zone, primeira_ligacao timestamp with time zone, venda_neo boolean, receita_neo numeric,
               livre boolean, ligacoes integer, ultima_ligacao timestamp with time zone, ultima_atendida boolean, ultima_seg integer,
               ultima_tabulacao text, campanha text, formulario text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_gestor boolean; v_alvo uuid; v_ini_mes timestamptz;
begin
  v_gestor := v_role in ('admin', 'supervisor');
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with base as (
    select l.*, (l.dono_id is null and l.categoria = 'sem_contato') as e_livre,
           nullif(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g'), '') as doc,
           public.chave_tel(l.phone_number) as chave
      from public.leads l
     where coalesce(l.aba, '') <> 'REPIQUE' and l.apagado_em is null
       and (
         (not coalesce(p_todos, false) and l.dono_id is null and l.categoria = 'sem_contato' and l.criado_em_lead >= now() - interval '60 days')
         or (l.dono_id is not null and (v_alvo is null or l.dono_id = v_alvo)
             and (coalesce(p_todos, false) or l.categoria in ('sem_contato', 'andamento')
                  or coalesce(l.classificado_em, l.criado_em_lead) >= v_ini_mes))
       )
  ), neo as (
    select regexp_replace(p.cnpj, '[^0-9]', '', 'g') as doc, sum(coalesce(p.valor, 0)) as valor
      from public.producao_pedidos p
     where p.cnpj is not null and coalesce(p.etapa, '') !~* '(PERDID|DEVOLVID|CANCELAD)'
       and regexp_replace(p.cnpj, '[^0-9]', '', 'g') in (select b.doc from base b where length(b.doc) >= 11)
     group by 1
  )
  select b.aba, b.id, b.full_name, b.city, b.state, b.qtd_linhas, b.tipo_empresa,
         case when b.e_livre and not v_gestor then null else b.phone_number end,
         case when b.e_livre and not v_gestor then null else b.email end,
         case when b.e_livre and not v_gestor then null else b.cnpj end,
         b.status, b.categoria, b.obs, b.converteu, b.receita, b.retorno_em, b.dono_id, pr.nome, b.pego_em,
         b.classificado_em, b.criado_em_lead,
         (select min(c.em) from public.leads_contatos c where c.lead_aba = b.aba and c.lead_id = b.id),
         lg.primeira,
         (n.doc is not null), n.valor, b.e_livre,
         coalesce(lg.n, 0), ul.em, ul.atendida, ul.seg, ul.tab,
         b.campaign_name, b.form_name
    from base b
    left join public.profiles pr on pr.id = b.dono_id
    left join neo n on length(b.doc) >= 11 and n.doc = b.doc
    left join lateral (
      select count(*)::int as n, min(x.em) as primeira from (
        select m.gerada_em as em from public.ligacoes_manuais m
         where b.chave is not null and m.chave_tel = b.chave and m.gerada_em >= b.criado_em_lead - interval '1 hour'
        union all
        select d.gerada_em from public.discador_chamadas d
         where length(b.doc) = 14 and d.cnpj = b.doc and d.gerada_em >= b.criado_em_lead - interval '1 hour'
      ) x
    ) lg on true
    left join lateral (
      select y.em, y.atendida, y.seg, y.tab from (
        select m.gerada_em as em, coalesce(m.atendida, false) as atendida, m.seg_falados as seg, m.tabulacao as tab from public.ligacoes_manuais m
         where b.chave is not null and m.chave_tel = b.chave and m.gerada_em >= b.criado_em_lead - interval '1 hour'
        union all
        select d.gerada_em, d.status = 'ANSWERED', d.seg_falados, d.tabulacao from public.discador_chamadas d
         where length(b.doc) = 14 and d.cnpj = b.doc and d.gerada_em >= b.criado_em_lead - interval '1 hour'
      ) y order by y.em desc limit 1
    ) ul on true
   order by b.criado_em_lead desc;
end $function$;

create or replace function public.leads_atividade_equipe()
 returns table(dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamp with time zone, lig_hoje integer,
               ultima_obs timestamp with time zone, obs_hoje integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini_dia timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with eq as (
    select e.profile_id as e_id, p.nome as e_nome, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null
  ), obs as (   -- OBS escrita = classificação que mudou a OBS para um texto não vazio
    select h.por as o_por, h.em as o_em from public.leads_historico h
     where h.acao = 'classificar' and h.em >= now() - interval '7 days'
       and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
       and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), '')
  )
  select eq.e_id, eq.e_nome, eq.e_u is not null,
         (select max(m.gerada_em) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= now() - interval '7 days'),
         (select count(*) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= v_ini_dia)::int,
         (select max(o.o_em) from obs o where o.o_por = eq.e_id),
         (select count(*) from obs o where o.o_por = eq.e_id and o.o_em >= v_ini_dia)::int
    from eq order by eq.e_nome;
end $function$;
```

- [ ] **Step 4: Ensaio com as duas migrations e ver passar**

```bash
{ echo 'begin;'; cat supabase/migrations/20261028100000_leads_pode_pegar.sql supabase/migrations/20261028100100_leads_kanban3_atividade.sql; sed '1,/^begin;$/d;$d' supabase/tests/leads_painel_hoje_check.sql; echo 'rollback;'; } > "$SCRATCH/ensaio.sql"; wc -c "$SCRATCH/ensaio.sql"
```

Rodar pelo `execute_sql`. Esperado: sem erro. (O tempo do modo Todos para o gestor é conferido na Task 9, depois de aplicar; anotar no ledger se passar de 3 s.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261028100100_leads_kanban3_atividade.sql supabase/tests/leads_painel_hoje_check.sql
git commit -m "feat(meus-leads): leads_kanban3 (campanha, formulario, modo Todos) e leads_atividade_equipe (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Painel — base §122, telefone sem p:+55, quem pode pegar, Quadro no kanban3

**Files:**
- Modify: `_template.html` (bloco de funções puras perto de `function kbQuandoSP`, `kbLigar`, `kbFichaHtml`, `kbCard`, `kbAplicarPermissao`, `kbCarregar`, `kbRender`, listener `dragstart` do `kbBoard`, `kbAbrirFicha`)
- Create: `test_leads_painel_hoje.js`
- Modify: `test_leads_hoje.js`, `test_leads_kanban.js` (troca `leads_kanban2` → `leads_kanban3` nos mocks)

**Interfaces:**
- Consumes: `leads_kanban3` (Task 2), `leads_equipe.pode_pegar` (Task 1).
- Produces (usadas pelas Tasks 4–8):
  - `kbPartesSP(ms) → { dia: 'AAAA-MM-DD', hora: 'HH:MM', min: minutosDoDia, dow: 0..6 (0 = domingo) }`
  - `kbDiaSP(isoOuMs) → 'AAAA-MM-DD' | null`, `kbSomaDias(dia, n) → 'AAAA-MM-DD'`, `kbDiasEntre(diaA, diaB) → int`
  - `kbTelCopiar(v) → string` (só dígitos, sem 55)
  - `kbUltimaAcao(l) → ms | null` (maior entre `ultima_ligacao`, `classificado_em`, `pego_em`), `kbDiasParado(l, agoraMs) → int | null`
  - `kbAbertoCol(col) → bool` (`novos`, `semlig`, `andamento`)
  - `kbPodePegar() → bool`; `kbEstado.podePegar`
  - `kbEstado.leads` vem de `leads_kanban3(p_dono, false)` e tem `campanha`, `formulario`

- [ ] **Step 1: Criar o arquivo de teste com o cabeçalho e o rodapé do teste da Hoje**

```bash
head -53 test_leads_hoje.js | sed '1s#.*#// Testa o §122 de "Meus leads": quem pega, Hoje em painel, filtros, Todos, Equipe com atividade, lead novo. Spec: docs/superpowers/specs/2026-10-28-meus-leads-painel-hoje-design.md#' > test_leads_painel_hoje.js
cat >> test_leads_painel_hoje.js <<'EOF'
  const SP = (s) => Date.parse(s + '-03:00');   // horário de São Paulo
  // ==== Task 3 ====
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
EOF
```

- [ ] **Step 2: Escrever os testes da Task 3**

Substituir a linha `  // ==== Task 3 ====` por:

```js
  // ==== Task 3 ====
  eq(kbPartesSP(SP('2026-10-28T13:05:00')), { dia: '2026-10-28', hora: '13:05', min: 785, dow: 3 }, 'partes em SP (quarta 13:05)');
  eq(kbDiaSP('2026-10-29T02:30:00Z'), '2026-10-28', 'dia SP de madrugada UTC');
  eq([kbSomaDias('2026-10-31', 1), kbDiasEntre('2026-10-28', '2026-11-02')], ['2026-11-01', 5], 'somar dias e diferença');
  eq([kbTelCopiar('p:+5511999998888'), kbTelCopiar('p:+551199998888'), kbTelCopiar('(11) 90000-0001'), kbTelCopiar('p:11999998888'), kbTelCopiar(null)],
     ['11999998888', '1199998888', '11900000001', '11999998888', ''], 'telefone copiado começa no DDD');
  const agoraT3 = SP('2026-10-28T15:00:00');
  eq(kbDiasParado({ pego_em: '2026-10-25T12:00:00-03:00', classificado_em: '2026-10-26T23:30:00-03:00', ultima_ligacao: null }, agoraT3), 2, 'parado conta da última ação em dias corridos SP');
  eq(kbDiasParado({}, agoraT3), null, 'sem nenhuma ação: null');
  // Copiar da ficha usa o número normalizado
  const fichaT3 = kbFichaHtml({ aba: 'O', lead_id: 'f1', nome: 'Zz Ficha', livre: false, categoria: 'andamento', telefone: 'p:+5511900000061' }, { gestor: false, agoraMs: agoraT3, podePegar: true });
  assert(fichaT3.includes('data-kb-ficha-copiar="11900000061"') && !fichaT3.includes('data-kb-ficha-copiar="p:'), 'Copiar do celular sem p:+55');
  // consultor sem pode_pegar: sem Livres, sem Pegar, ficha avisa
  currentUser = { id: 'u-nao', nome: 'Zznao Teste', role: 'consultor' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 2, pode_pegar: false }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0 }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_kanban3 = { data: [
    { aba: 'OUTUBRO', lead_id: 'l1', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, criado_em_lead: new Date().toISOString(), ligacoes: 0 },
    { aba: 'OUTUBRO', lead_id: 'm1', nome: 'Zz Meu', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, dono_id: 'u-nao', pego_em: new Date().toISOString(), criado_em_lead: new Date().toISOString(), ligacoes: 1 },
  ], error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban3' && c.args.p_todos === false), 'Quadro carrega pelo leads_kanban3');
  eq(kbPodePegar(), false, 'consultor sem pode_pegar');
  assert(document.querySelector('#kbBoard .kbCol[data-kb-col="livres"]').style.display === 'none', 'coluna Livres some para quem não pega');
  assert(document.querySelector('#kbNavQuadro [data-kb-ir="livres"]').style.display === 'none', 'atalho Livres some');
  assert(!kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, Date.now()).includes('data-kb-pegar'), 'cartão livre sem botão Pegar');
  const fichaNao = kbFichaHtml({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, { gestor: false, agoraMs: Date.now(), podePegar: false });
  assert(!fichaNao.includes('data-kb-ficha-pegar') && fichaNao.includes('não está liberado para pegar leads'), 'ficha de livre avisa quem não pode pegar (Review Focus 1)');
  // consultor com pode_pegar: tudo como antes
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, pode_pegar: true }];
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);
  eq(kbPodePegar(), true, 'consultor com pode_pegar');
  assert(document.querySelector('#kbBoard .kbCol[data-kb-col="livres"]').style.display !== 'none', 'Livres aparece para quem pega');
  assert(kbCard({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, Date.now()).includes('data-kb-pegar'), 'cartão livre com Pegar');
  const fichaPode = kbFichaHtml({ aba: 'O', lead_id: 'l1', nome: 'Zz Livre', livre: true, categoria: 'sem_contato' }, { gestor: false, agoraMs: Date.now(), podePegar: true });
  assert(fichaPode.includes('data-kb-ficha-pegar'), 'ficha de livre com Pegar para quem pode');
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHA: ReferenceError: kbPartesSP is not defined`

- [ ] **Step 4: Implementar**

4a. Logo depois da linha `function kbQuandoSP(dataIso, hora){ … }`, acrescentar:

```js
// ===== §122 (28/10): quem pega, Hoje em painel, filtros, Todos, atividade, lead novo — funções puras =====
// São Paulo é UTC−3 o ano todo (sem horário de verão desde 2019).
function kbPartesSP(ms){
  const d = new Date(ms - 3 * 3600000), s = d.toISOString();
  return { dia: s.slice(0, 10), hora: s.slice(11, 16), min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
}
function kbDiaSP(v){ const t = typeof v === 'number' ? v : kbMs(v); return t === null ? null : kbPartesSP(t).dia; }
function kbSomaDias(dia, n){ return new Date(Date.parse(dia + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
function kbDiasEntre(a, b){ return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function kbTelCopiar(v){ return String(v || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); }
function kbUltimaAcao(l){ const t = [l.ultima_ligacao, l.classificado_em, l.pego_em].map(kbMs).filter(x => x !== null); return t.length ? Math.max(...t) : null; }
function kbDiasParado(l, agoraMs){ const u = kbUltimaAcao(l); return u === null ? null : kbDiasEntre(kbDiaSP(u), kbDiaSP(agoraMs)); }
function kbAbertoCol(col){ return col === 'novos' || col === 'semlig' || col === 'andamento'; }
```

4b. `kbLigar`: trocar a primeira linha do corpo por `const num = kbTelCopiar(telefone);`.

4c. `kbFichaHtml`: na linha do celular trocar `linha('Celular', f.telefone, true, kbFoneBR(f.telefone))` por `linha('Celular', kbTelCopiar(f.telefone), true, kbFoneBR(f.telefone))`. No ramo `semContato`, trocar o bloco do contato por:

```js
  const contato = semContato
    ? (op && op.podePegar === false
        ? `<p class="kbFichaAviso">Você não está liberado para pegar leads.</p>`
        : `<p class="kbFichaAviso">Pegue o lead para ver celular, e-mail e CNPJ.</p><button type="button" class="btn" data-kb-ficha-pegar>Pegar este lead</button>`)
```

(o `:` seguinte, do caso com contato, fica como está). Em `kbAbrirFicha`, na chamada `kbFichaHtml(f, { gestor: kbGestor(), agoraMs: Date.now(), flutuando: … })`, acrescentar `podePegar: kbGestor() || kbPodePegar()`.

4d. Depois de `function kbPodeVer(){ … }`:

```js
// §122: só quem tem leads_equipe.pode_pegar pega lead (Luria, Lucas, Caio e Mariana). O gestor não pega, mas vê os Livres para redistribuir.
function kbPodePegar(){ return !kbGestor() && !!kbEstado.podePegar; }
function kbVeLivres(){ return kbGestor() || kbPodePegar(); }
```

Em `kbAplicarPermissao`: trocar `kbEstado.naEquipe = false;` por `kbEstado.naEquipe = false; kbEstado.podePegar = false;` e o bloco do consultor por:

```js
  if(currentUser && currentUser.role === 'consultor'){
    const r = await ppSeguro(() => sb.from('leads_equipe').select('id,pode_pegar').eq('profile_id', currentUser.id));
    const linhas = r && !r.error ? r.data || [] : [];
    kbEstado.naEquipe = !!linhas.length;
    kbEstado.podePegar = linhas.some(x => x.pode_pegar === true);
  }
```

4e. `kbCarregar`: trocar `sb.rpc('leads_kanban2', { p_dono: … })` por `sb.rpc('leads_kanban3', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null, p_todos: false })`.

4f. `kbRender`: dentro do `KB_COLUNAS.forEach`, logo depois de `const el = …`, acrescentar `el.style.display = col === 'livres' && !kbVeLivres() ? 'none' : '';`, e depois de `const nav = …`, `if(nav && nav.parentElement) nav.parentElement.style.display = col === 'livres' && !kbVeLivres() ? 'none' : '';`.

4g. `kbCard`: trocar `const acao = col === 'livres' ? \`<button type="button" class="btn btn-sm" data-kb-pegar>Pegar</button>\`` por `const acao = col === 'livres' ? (kbVeLivres() ? \`<button type="button" class="btn btn-sm" data-kb-pegar>Pegar</button>\` : '')`.

4h. Listener `dragstart` do `kbBoard`: logo depois de `if(!card) return;` acrescentar `if(card.dataset.col === 'livres' && !kbPodePegar() && !kbGestor()){ e.preventDefault(); return; }`.

4i. Trocar os mocks antigos: `sed -i 's/leads_kanban2/leads_kanban3/g' test_leads_hoje.js test_leads_kanban.js`.

- [ ] **Step 5: Rodar e ver passar (novo + antigos)**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três linhas `--- RESULTADO: N passaram, 0 falharam ---`. Se um teste antigo do Kanban esperar `Pegar` num livre para consultor, acrescentar `window.__tabelas.leads_equipe = [{ id: 1, profile_id: …, pode_pegar: true }]` naquele trecho (o consultor de teste passa a ser um dos que pegam) — não mudar a asserção.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js
git commit -m "feat(meus-leads): so quem pode pegar ve Livres e Pegar; Copiar telefone sem p:+55; Quadro no leads_kanban3 (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Filtros no Quadro

**Files:**
- Modify: `_template.html` (funções puras §122, markup do painel `#kbFiltroBarra`, `kbRender`, `kbTrocarAba`, CSS em `#kbStyles`)
- Modify: `test_leads_painel_hoje.js`

**Interfaces:**
- Consumes: `kbPartesSP`, `kbDiaSP`, `kbSomaDias`, `kbDiasParado`, `kbColunaDoLead` (Task 3).
- Produces: `KB_FILTROS` (grupos `parado`, `ligacao`, `retorno`, `linhas`, `tipo`, `cidade`, `campanha`, `formulario`, `mes`); `kbFiltrar(leads, filtros, agoraMs) → leads[]`; `kbOpcoesFiltro(leads, grupo, filtros, agoraMs) → [{ valor, rotulo, n }]`; `kbFiltroBarraHtml(leads, filtros, agoraMs) → html`; `kbEstado.filtros` (objeto `{grupo: valor}`); `kbSalvarFiltros()`/`kbLerFiltros()`; `kbRenderFiltroBarra()`; a tela Todos (Task 7) reaproveita tudo.

- [ ] **Step 1: Testes**

Substituir `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 4 ====
  const ag4 = SP('2026-10-28T15:00:00');   // quarta
  const L4 = [
    { aba: 'OUTUBRO', lead_id: 'a', nome: 'Zz A', categoria: 'andamento', livre: false, ligacoes: 0, pego_em: '2026-10-28T10:00:00-03:00', retorno_em: '2026-10-27', cidade: 'Campinas', qtd_linhas: '1 a 5', tipo_empresa: 'MEI', campanha: 'Zz C1', formulario: 'Zz F1' },
    { aba: 'OUTUBRO', lead_id: 'b', nome: 'Zz B', categoria: 'andamento', livre: false, ligacoes: 2, ultima_ligacao: '2026-10-25T10:00:00-03:00', retorno_em: '2026-10-28', cidade: 'Santos', qtd_linhas: '6 a 10', tipo_empresa: 'LTDA', campanha: 'Zz C2', formulario: 'Zz F1' },
    { aba: 'SETEMBRO', lead_id: 'c', nome: 'Zz C', categoria: 'sem_contato', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-20T10:00:00-03:00', retorno_em: '2026-11-01', cidade: 'Campinas', qtd_linhas: '1 a 5', tipo_empresa: 'MEI', campanha: 'Zz C1', formulario: 'Zz F2' },
    { aba: 'OUTUBRO', lead_id: 'l', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, ligacoes: 0, cidade: 'Campinas', qtd_linhas: '1 a 5', campanha: 'Zz C1', formulario: 'Zz F1' },
  ];
  const ids = (ls) => ls.map(l => l.lead_id).join(',');
  eq(ids(kbFiltrar(L4, { parado: 'hoje' }, ag4)), 'a,l', 'parado hoje (livre não é filtrado por parado)');
  eq(ids(kbFiltrar(L4, { parado: '3-4' }, ag4)), 'b,l', 'parado 3–4 dias');
  eq(ids(kbFiltrar(L4, { parado: '5+' }, ag4)), 'c,l', 'parado 5+ dias');
  eq(ids(kbFiltrar(L4, { ligacao: 'nunca' }, ag4)), 'a,l', 'nunca ligado');
  eq(ids(kbFiltrar(L4, { retorno: 'atrasado' }, ag4)), 'a,l', 'retorno atrasado');
  eq(ids(kbFiltrar(L4, { retorno: 'hoje' }, ag4)), 'b,l', 'retorno hoje');
  eq(ids(kbFiltrar(L4, { retorno: 'semana' }, ag4)), 'b,c,l', 'retorno esta semana (hoje até domingo 01/11)');
  eq(ids(kbFiltrar(L4, { cidade: 'Campinas', linhas: '1 a 5' }, ag4)), 'a,c,l', 'filtros se somam');
  eq(ids(kbFiltrar(L4, { cidade: 'Campinas', mes: 'OUTUBRO', campanha: 'Zz C1', formulario: 'Zz F1', tipo: 'MEI' }, ag4)), 'a', 'origem, mês e tipo');
  eq(kbOpcoesFiltro(L4, 'parado', {}, ag4).map(o => o.valor + ':' + o.n).join(' '), 'hoje:1 1-2:0 3-4:1 5+:1', 'contagem por opção (sem livres)');
  eq(kbOpcoesFiltro(L4, 'cidade', { linhas: '6 a 10' }, ag4).map(o => o.valor + ':' + o.n).join(' '), 'Santos:1', 'contagem respeita os outros filtros');
  eq(kbFiltrar(L4, { parado: '1-2' }, ag4).filter(l => !l.livre).length, 0, 'filtro que zera (Review Focus 5)');
  // tela: barra aparece no Quadro, filtra as colunas, Limpar volta, guarda no navegador
  kbEstado.leads = L4.map(l => Object.assign({}, l, { criado_em_lead: '2026-10-20T10:00:00-03:00' }));
  kbTrocarAba('quadro');
  kbRender();
  const barra = document.getElementById('kbFiltroBarra');
  assert(barra.style.display !== 'none' && barra.querySelector('[data-kb-filtro="parado"][data-valor="5+"]'), 'barra de filtros no Quadro');
  barra.querySelector('[data-kb-filtro="parado"][data-valor="5+"]').click();
  eq(kbEstado.filtros.parado, '5+', 'clicar no botão liga o filtro');
  eq(document.querySelector('#kbBoard .kbCol[data-kb-col="novos"] .kbConta').textContent, '1', 'coluna filtrada');
  eq(document.querySelector('#kbBoard .kbCol[data-kb-col="andamento"] .kbConta').textContent, '0', 'coluna zerada mostra 0');
  const cidadeSel = barra.querySelector('select[data-kb-filtro="cidade"]');
  cidadeSel.value = 'Campinas'; cidadeSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(kbEstado.filtros.cidade, 'Campinas', 'select liga o filtro');
  assert(String(window.localStorage.getItem('kbFiltros')).includes('Campinas'), 'filtros guardados no navegador');
  barra.querySelector('[data-kb-filtro-limpar]').click();
  eq(Object.keys(kbEstado.filtros).length, 0, 'Limpar zera os filtros');
  window.localStorage.setItem('kbFiltros', '{"cidade":"Santos"}');
  eq(kbLerFiltros(), { cidade: 'Santos' }, 'lê os filtros guardados');
  Object.defineProperty(window, 'localStorage', { get(){ throw new Error('bloqueado'); }, configurable: true });
  eq(kbLerFiltros(), {}, 'localStorage bloqueado não quebra (Review Focus 5)');
  kbSalvarFiltros();
  delete window.localStorage;   // volta para o localStorage do jsdom (getter do protótipo)
  kbEstado.filtros = {};
  kbTrocarAba('hoje');
  assert(document.getElementById('kbFiltroBarra').style.display === 'none', 'barra some fora do Quadro/Todos');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHA: ReferenceError: kbFiltrar is not defined`

- [ ] **Step 3: Implementar**

3a. Funções puras, depois de `function kbAbertoCol…`:

```js
function kbRetornoNaFaixa(l, v, agoraMs){
  if(!l.retorno_em) return false;
  const r = String(l.retorno_em).slice(0, 10), hoje = kbDiaSP(agoraMs);
  if(v === 'atrasado') return r < hoje;
  if(v === 'hoje') return r === hoje;
  if(v === 'semana') return r >= hoje && r <= kbSomaDias(hoje, (7 - kbPartesSP(agoraMs).dow) % 7);   // até domingo
  return false;
}
function kbFaixaParado(l, agoraMs){ const d = kbDiasParado(l, agoraMs); return d === null ? null : d <= 0 ? 'hoje' : d <= 2 ? '1-2' : d <= 4 ? '3-4' : '5+'; }
// Grupos fixos têm opções; os dinâmicos montam as opções a partir dos leads carregados. Parado/ligação/retorno não se aplicam a Livres.
const KB_FILTROS = {
  parado: { rotulo: 'Parado há', opcoes: [['hoje', 'Hoje'], ['1-2', '1–2 dias'], ['3-4', '3–4 dias'], ['5+', '5+ dias']], testa: (l, v, ag) => kbFaixaParado(l, ag) === v, soDono: true },
  ligacao: { rotulo: 'Ligação', opcoes: [['nunca', 'Nunca ligado']], testa: (l) => Number(l.ligacoes || 0) === 0, soDono: true },
  retorno: { rotulo: 'Retorno', opcoes: [['atrasado', 'Atrasado'], ['hoje', 'Hoje'], ['semana', 'Esta semana']], testa: kbRetornoNaFaixa, soDono: true },
  linhas: { rotulo: 'Linhas', campo: l => l.qtd_linhas },
  tipo: { rotulo: 'Tipo de empresa', campo: l => l.tipo_empresa },
  cidade: { rotulo: 'Cidade', campo: l => l.cidade },
  campanha: { rotulo: 'Campanha', campo: l => l.campanha },
  formulario: { rotulo: 'Formulário', campo: l => l.formulario },
  mes: { rotulo: 'Mês', campo: l => l.aba },
};
function kbPassaFiltros(l, filtros, agoraMs, ignorar){
  return Object.keys(filtros || {}).every(g => {
    const def = KB_FILTROS[g], v = filtros[g];
    if(g === ignorar || !def || !v) return true;
    if(def.soDono) return l.livre ? true : def.testa(l, v, agoraMs);
    return String(def.campo(l) || '').trim() === v;
  });
}
function kbFiltrar(leads, filtros, agoraMs){ return (leads || []).filter(l => kbPassaFiltros(l, filtros, agoraMs)); }
function kbOpcoesFiltro(leads, grupo, filtros, agoraMs){
  const def = KB_FILTROS[grupo];
  const base = (leads || []).filter(l => kbPassaFiltros(l, filtros, agoraMs, grupo) && !(def.soDono && l.livre));
  if(def.soDono) return def.opcoes.map(([v, r]) => ({ valor: v, rotulo: r, n: base.filter(l => def.testa(l, v, agoraMs)).length }));
  const m = new Map();
  base.forEach(l => { const v = String(def.campo(l) || '').trim(); if(v) m.set(v, (m.get(v) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]) => ({ valor: v, rotulo: v, n }));
}
function kbFiltroBarraHtml(leads, filtros, agoraMs){
  const f = filtros || {};
  const grupos = Object.keys(KB_FILTROS).map(g => {
    const def = KB_FILTROS[g], ops = kbOpcoesFiltro(leads, g, f, agoraMs);
    if(def.soDono) return `<div class="kbFiltroGrupo"><span class="kbMeta">${def.rotulo}</span>${ops.map(o =>
      `<button type="button" class="filterPill${f[g] === o.valor ? ' active' : ''}" data-kb-filtro="${g}" data-valor="${escapeHtml(o.valor)}">${escapeHtml(o.rotulo)} <b>${o.n}</b></button>`).join('')}</div>`;
    if(!ops.length && !f[g]) return '';
    return `<label class="field kbFiltroCampo"><span>${def.rotulo}</span><select data-kb-filtro="${g}"><option value="">Todos</option>${ops.map(o =>
      `<option value="${escapeHtml(o.valor)}"${f[g] === o.valor ? ' selected' : ''}>${escapeHtml(o.rotulo)} (${o.n})</option>`).join('')}</select></label>`;
  }).join('');
  const ativos = Object.keys(f).filter(g => f[g]).length;
  return grupos + (ativos ? `<button type="button" class="btn btn-sm btn-outline" data-kb-filtro-limpar>Limpar filtros (${ativos})</button>` : '');
}
function kbLerFiltros(){ try { const v = JSON.parse(window.localStorage.getItem('kbFiltros') || '{}'); return v && typeof v === 'object' ? v : {}; } catch(_e) { return {}; } }
function kbSalvarFiltros(){ try { window.localStorage.setItem('kbFiltros', JSON.stringify(kbEstado.filtros || {})); } catch(_e) {} }
```

3b. Markup: logo depois de `<div id="kbEquipe" class="kbEquipe" style="display:none"></div>` acrescentar `<div id="kbFiltroBarra" class="kbFiltroBarra card" style="display:none"></div>`.

3c. CSS (no fim do `#kbStyles`, antes de `</style>`):

```css
  /* §122: filtros do Quadro e da aba Todos */
  .kbFiltroBarra{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:flex-end;margin-bottom:var(--space-3);}
  .kbFiltroGrupo{display:flex;flex-wrap:wrap;gap:var(--space-1);align-items:center;}
  .kbFiltroGrupo .kbMeta{margin-right:var(--space-1);}
  .kbFiltroCampo{margin:0;min-width:150px;}
  .kbFiltroBarra .filterPill b{margin-left:4px;font-weight:700;}
```

3d. Estado e tela. Depois de `kbEstado.aba = null; kbEstado.excecoes = {}; …` (linha do bloco §118) acrescentar `kbEstado.filtros = kbLerFiltros();`. E as funções (no bloco §118, depois de `kbTrocarAba`):

```js
function kbFonteFiltros(){ return kbEstado.aba === 'todos' ? (kbEstado.todos || []) : kbEstado.leads; }
function kbRenderFiltroBarra(){
  const el = document.getElementById('kbFiltroBarra');
  const html = kbFiltroBarraHtml(kbFonteFiltros(), kbEstado.filtros, Date.now());
  if(el.dataset.html !== html){ el.innerHTML = html; el.dataset.html = html; }
}
function kbAoMudarFiltros(){
  kbSalvarFiltros();
  if(kbEstado.aba === 'todos'){ (kbEstado.todosEstado || {}).pagina = 1; if(typeof kbRenderTodos === 'function') kbRenderTodos(); }
  else kbRender();
  kbRenderFiltroBarra();
}
document.getElementById('kbFiltroBarra').addEventListener('click', (e) => {
  if(e.target.closest('[data-kb-filtro-limpar]')){ kbEstado.filtros = {}; kbAoMudarFiltros(); return; }
  const b = e.target.closest('button[data-kb-filtro]');
  if(!b) return;
  const g = b.dataset.kbFiltro, v = b.dataset.valor;
  if(kbEstado.filtros[g] === v) delete kbEstado.filtros[g]; else kbEstado.filtros[g] = v;
  kbAoMudarFiltros();
});
document.getElementById('kbFiltroBarra').addEventListener('change', (e) => {
  const s = e.target.closest('select[data-kb-filtro]');
  if(!s) return;
  if(s.value) kbEstado.filtros[s.dataset.kbFiltro] = s.value; else delete kbEstado.filtros[s.dataset.kbFiltro];
  kbAoMudarFiltros();
});
```

Em `kbTrocarAba`, depois da linha do `kbNavQuadro`, acrescentar:

```js
  document.getElementById('kbFiltroBarra').style.display = kbEstado.aba === 'quadro' || kbEstado.aba === 'todos' ? '' : 'none';
  if(kbEstado.aba === 'quadro' || kbEstado.aba === 'todos') kbRenderFiltroBarra();
```

Em `kbRender`, trocar `if(kbEstado.soDivergencias) leads = leads.filter(l => kbDivergencia(l));\n  const c = kbMontar(leads);` por:

```js
  if(kbEstado.soDivergencias) leads = leads.filter(l => kbDivergencia(l));
  const c = kbMontar(kbFiltrar(leads, kbEstado.filtros, agoraMs));
```

e no fim de `kbRender` acrescentar `if(kbEstado.aba === 'quadro') kbRenderFiltroBarra();`. (O resumo do mês continua sobre `leads` sem os filtros.)

- [ ] **Step 4: Rodar e ver passar**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_painel_hoje.js
git commit -m "feat(meus-leads): filtros no Quadro (parado, nunca ligado, retorno, perfil, origem, mes) (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Hoje do consultor — cartões, Faça agora, placar

**Files:**
- Modify: `_template.html` (`kbRenderHoje`, `kbCarregarHoje`, listener do `panel-meusleads`, CSS)
- Modify: `test_leads_painel_hoje.js`, `test_leads_hoje.js` (asserções da Hoje antiga)

**Interfaces:**
- Consumes: `kbDiasParado`, `kbUltimaAcao`, `kbAbertoCol`, `kbPartesSP`, `kbPodePegar` (Task 3); `leads_hoje.placar` (Task 1); `meu_placar_ligacoes` (existente: linhas com `lig_hoje`, `meta_ligacoes_dia`, `tem_telefonia`).
- Produces: `kbCartoesHoje(leads, retornos) → [{ chave, rotulo, n, extra? }]` com chaves `sem_contato`, `andamento`, `retorno_hoje`, `retorno_atrasado`, `convertido`; `kbListaDoCartao(chave, leads, retornos, agoraMs) → [{ aba, lead_id, nome, detalhe }]` (aceita também a chave `parados3`); `kbListaCartaoHtml(itens, max) → html`; `kbFacaAgora(leads, retornos, agoraMs, max) → [{ aba, lead_id, nome, motivo }]`. A Equipe (Task 6) usa `kbListaDoCartao` e `kbListaCartaoHtml`.

- [ ] **Step 1: Testes**

Substituir `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 5 ====
  const ag5 = SP('2026-10-28T15:00:00');
  const L5 = [
    { aba: 'O', lead_id: 'n1', nome: 'Zz Novo Ligado', categoria: 'sem_contato', livre: false, ligacoes: 1, pego_em: '2026-10-28T09:00:00-03:00', ultima_ligacao: '2026-10-28T09:10:00-03:00' },
    { aba: 'O', lead_id: 'n2', nome: 'Zz Nunca Ligado', categoria: 'sem_contato', livre: false, ligacoes: 0, pego_em: '2026-10-28T08:00:00-03:00' },
    { aba: 'O', lead_id: 'a1', nome: 'Zz Parado', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 3, ultima_ligacao: '2026-10-22T10:00:00-03:00' },
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando', categoria: 'andamento', status: 'PROPOSTA ENVIADA', livre: false, ligacoes: 2, ultima_ligacao: '2026-10-28T11:00:00-03:00' },
    { aba: 'O', lead_id: 'c1', nome: 'Zz Venda', categoria: 'convertido', livre: false, receita: 199.9, classificado_em: '2026-10-10T10:00:00-03:00' },
    { aba: 'O', lead_id: 'l1', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, ligacoes: 0 },
  ];
  const R5 = [
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando', quando: '2026-10-28T10:00:00-03:00', vencido: true },
    { aba: 'O', lead_id: 'n1', nome: 'Zz Novo Ligado', quando: '2026-10-28T17:30:00-03:00', vencido: false },
  ];
  eq(kbCartoesHoje(L5, R5).map(c => c.chave + ':' + c.n).join(' '), 'sem_contato:2 andamento:2 retorno_hoje:1 retorno_atrasado:1 convertido:1', 'cartões por etapa (livre fora)');
  eq(kbCartoesHoje(L5, R5)[4].extra.replace(/\s/g, ' '), 'R$ 199,90', 'convertidos com receita do mês (Intl usa espaço fixo)');
  eq(kbListaDoCartao('andamento', L5, R5, ag5).map(i => i.lead_id), ['a1', 'a2'], 'lista do cartão Em andamento');
  eq(kbListaDoCartao('retorno_atrasado', L5, R5, ag5).map(i => i.lead_id), ['a2'], 'lista dos retornos atrasados');
  eq(kbListaDoCartao('parados3', L5, R5, ag5).map(i => i.lead_id), ['a1'], 'lista dos parados 3+ dias');
  const fz = kbFacaAgora(L5, R5, ag5, 5);
  eq(fz.map(i => i.lead_id), ['a2', 'n1', 'n2', 'a1'], 'Faça agora: atrasado → hoje → nunca ligado → parado');
  eq(fz.map(i => i.motivo), ['Retorno atrasado 5 h', 'Retorno hoje às 17:30', 'Nunca ligado', 'Parado há 6 dias'], 'motivos do Faça agora');
  eq(kbFacaAgora(L5, R5, ag5, 2).length, 2, 'Faça agora respeita o máximo');
  const muitos = Array.from({ length: 30 }, (_, i) => ({ aba: 'O', lead_id: 'x' + i, nome: 'Zz ' + i }));
  const lh = kbListaCartaoHtml(muitos, 20);
  assert((lh.match(/data-kb-abrir=/g) || []).length === 20 && lh.includes('data-kb-cartao-mais'), 'lista do cartão mostra 20 e "ver mais"');
  // tela
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  kbEstado.leads = L5;
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: R5, livres: 4, placar: { classificacoes: 7, retornos_hoje: 2, retornos_cumpridos: 1 } }, error: null };
  window.__rpcRespostas.meu_placar_ligacoes = { data: [{ lig_hoje: 23, meta_ligacoes_dia: 80, tem_telefonia: true, tem_dados: true }], error: null };
  kbEstado.alertas = [{ tipo: 'parado', aba: 'O', lead_id: 'a1', nome: 'Zz Parado' }];
  kbTrocarAba('hoje');
  await espera(80);
  const hoje = document.getElementById('kbHoje');
  eq(hoje.querySelectorAll('[data-kb-cartao]').length, 5, 'Hoje mostra 5 cartões');
  assert(!hoje.textContent.includes('Zz Venda'), 'Hoje não despeja a lista de leads de uma vez');
  hoje.querySelector('[data-kb-cartao="andamento"]').click();
  assert(hoje.querySelector('[data-kb-cartao="andamento"]').classList.contains('active') && hoje.textContent.includes('Zz Parado'), 'clicar no cartão abre só aquela lista');
  hoje.querySelector('[data-kb-cartao="andamento"]').click();
  assert(!hoje.querySelector('.kbCartaoLista'), 'clicar de novo fecha a lista');
  eq(hoje.querySelectorAll('.kbFaca [data-kb-abrir]').length, 4, 'Faça agora na tela');
  assert(hoje.textContent.includes('23') && hoje.textContent.includes('/ 80') && hoje.textContent.includes('7') && hoje.textContent.includes('1 de 2'), 'placar: ligações/meta, classificações, retornos cumpridos');
  assert(hoje.querySelector('[data-kb-ver-alertas]') && !hoje.querySelector('.kbAlertasLista'), 'alertas recolhidos numa linha');
  hoje.querySelector('[data-kb-ver-alertas]').click();
  assert(hoje.querySelector('.kbAlertasLista') && hoje.textContent.includes('Parado em andamento'), 'ver alertas abre a lista');
  assert(hoje.querySelector('[data-kb-pegar-proximo]') && hoje.textContent.includes('4'), 'quem pega vê "Pegar o próximo livre" com quantos esperam');
  kbEstado.podePegar = false;
  kbRenderHoje();
  assert(!document.querySelector('#kbHoje [data-kb-pegar-proximo]'), 'quem não pega não vê o botão de pegar');
  kbEstado.podePegar = true;
  // ==== mais testes entram aqui ====
```

Em `test_leads_hoje.js`, trocar as linhas 106–107:

```js
  assert(document.getElementById('kbHoje').textContent.includes('Zz Retorno') && document.getElementById('kbHoje').textContent.includes('Pego e sem contato'), 'Hoje mostra retornos e alertas');
  document.querySelector('#kbHoje [data-kb-proximo]').click();
```

por:

```js
  assert(document.getElementById('kbHoje').textContent.includes('Zz Retorno') && document.querySelector('#kbHoje [data-kb-ver-alertas]'), 'Hoje mostra retornos (Faça agora) e a linha de alertas');
  kbProximo();
```

(o "Próximo lead" segue existindo como função; a tela agora mostra o Faça agora).

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHA: ReferenceError: kbCartoesHoje is not defined`

- [ ] **Step 3: Implementar**

3a. Funções puras (depois de `kbSalvarFiltros`):

```js
function kbCartoesHoje(leads, retornos){
  const meus = (leads || []).filter(l => !l.livre), col = (l) => kbColunaDoLead(l), r = retornos || [], rm = kbResumoMes(meus);
  return [
    { chave: 'sem_contato', rotulo: 'Sem contato', n: meus.filter(l => col(l) === 'novos').length },
    { chave: 'andamento', rotulo: 'Em andamento', n: meus.filter(l => col(l) === 'andamento' || col(l) === 'semlig').length },
    { chave: 'retorno_hoje', rotulo: 'Retornos de hoje', n: r.filter(x => !x.vencido).length },
    { chave: 'retorno_atrasado', rotulo: 'Retornos atrasados', n: r.filter(x => x.vencido).length },
    { chave: 'convertido', rotulo: 'Convertidos no mês', n: rm.vendas, extra: kbMoeda(rm.receita) || 'R$ 0,00' },
  ];
}
function kbListaDoCartao(chave, leads, retornos, agoraMs){
  const meus = (leads || []).filter(l => !l.livre), col = (l) => kbColunaDoLead(l);
  const deLead = (l, detalhe) => ({ aba: l.aba, lead_id: l.lead_id, nome: l.nome, detalhe });
  const deRet = (x) => ({ aba: x.aba, lead_id: x.lead_id, nome: x.nome, detalhe: (x.vencido ? 'era às ' : 'às ') + kbPartesSP(kbMs(x.quando)).hora });
  if(chave === 'sem_contato') return meus.filter(l => col(l) === 'novos').map(l => deLead(l, 'pego ' + kbTempoDesde(l.pego_em, agoraMs)));
  if(chave === 'andamento') return meus.filter(l => col(l) === 'andamento' || col(l) === 'semlig').map(l => deLead(l, l.status || ''));
  if(chave === 'parados3') return meus.filter(l => kbAbertoCol(col(l)) && (kbDiasParado(l, agoraMs) || 0) >= 3).map(l => deLead(l, 'parado há ' + kbDiasParado(l, agoraMs) + ' dias'));
  if(chave === 'convertido') return meus.filter(l => col(l) === 'convertido').map(l => deLead(l, kbMoeda(l.receita) || ''));
  if(chave === 'retorno_hoje') return (retornos || []).filter(x => !x.vencido).map(deRet);
  if(chave === 'retorno_atrasado') return (retornos || []).filter(x => x.vencido).map(deRet);
  return [];
}
function kbListaCartaoHtml(itens, max){
  const lista = (itens || []).slice(0, max);
  const li = lista.map(i => `<li><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(i.aba)}|${escapeHtml(i.lead_id)}">${escapeHtml(i.nome || '(sem nome)')}</button>${i.detalhe ? `<span class="kbMeta">${escapeHtml(i.detalhe)}</span>` : ''}</li>`).join('');
  const mais = itens.length > lista.length ? `<li><button type="button" class="kbLink" data-kb-cartao-mais>Ver mais (${itens.length - lista.length})</button></li>` : '';
  return `<ul class="kbLista kbCartaoLista">${li || '<li class="kbMeta">Nada aqui.</li>'}${mais}</ul>`;
}
function kbFacaAgora(leads, retornos, agoraMs, max){
  const itens = [], vistos = new Set(), lim = max || 5;
  const add = (aba, id, nome, motivo) => { const k = aba + '|' + id; if(vistos.has(k) || itens.length >= lim) return; vistos.add(k); itens.push({ aba, lead_id: id, nome, motivo }); };
  const r = (retornos || []).slice().sort((a, b) => (kbMs(a.quando) || 0) - (kbMs(b.quando) || 0));
  r.filter(x => x.vencido).forEach(x => add(x.aba, x.lead_id, x.nome, 'Retorno atrasado ' + kbTempoDesde(x.quando, agoraMs).replace(/^há /, '')));
  r.filter(x => !x.vencido).forEach(x => add(x.aba, x.lead_id, x.nome, 'Retorno hoje às ' + kbPartesSP(kbMs(x.quando)).hora));
  const abertos = (leads || []).filter(l => !l.livre && kbAbertoCol(kbColunaDoLead(l)));
  abertos.filter(l => Number(l.ligacoes || 0) === 0)
    .sort((a, b) => (kbMs(a.pego_em || a.criado_em_lead) || 0) - (kbMs(b.pego_em || b.criado_em_lead) || 0))
    .forEach(l => add(l.aba, l.lead_id, l.nome, 'Nunca ligado'));
  abertos.filter(l => (kbDiasParado(l, agoraMs) || 0) >= 1)
    .sort((a, b) => (kbUltimaAcao(a) || 0) - (kbUltimaAcao(b) || 0))
    .forEach(l => { const d = kbDiasParado(l, agoraMs); add(l.aba, l.lead_id, l.nome, `Parado há ${d} dia${d === 1 ? '' : 's'}`); });
  return itens;
}
```

3b. Tela: substituir `kbCarregarHoje` e `kbRenderHoje` por:

```js
async function kbCarregarHoje(){
  const [r, pl] = await Promise.all([
    ppSeguro(() => sb.rpc('leads_hoje', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null })),
    kbGestor() ? Promise.resolve(null) : ppSeguro(() => sb.rpc('meu_placar_ligacoes')),
  ]);
  kbEstado.hoje = r && !r.error ? r.data : null;
  kbEstado.placarLig = pl && !pl.error && pl.data ? (Array.isArray(pl.data) ? pl.data[0] : pl.data) : null;
  kbRenderHoje();
}
// §122: Hoje em painel — cartões por etapa (a lista só abre no clique), Faça agora (até 5), placar do dia e alertas recolhidos.
function kbRenderHoje(){
  const h = kbEstado.hoje || { fila: [], retornos: [], livres: 0, placar: null };
  const agoraMs = Date.now(), aberto = kbEstado.cartaoAberto;
  const cartoes = kbCartoesHoje(kbEstado.leads, h.retornos).map(c => `<button type="button" class="kbCartao${aberto === c.chave ? ' active' : ''}" data-kb-cartao="${c.chave}">
      <span class="kbCartaoN">${c.n}</span><span class="kbCartaoRot">${escapeHtml(c.rotulo)}</span>${c.extra ? `<span class="kbMeta">${escapeHtml(c.extra)}</span>` : ''}</button>`).join('');
  const lista = aberto ? kbListaCartaoHtml(kbListaDoCartao(aberto, kbEstado.leads, h.retornos, agoraMs), kbEstado.cartaoMax || 20) : '';
  const faca = kbFacaAgora(kbEstado.leads, h.retornos, agoraMs, 5);
  const facaHtml = faca.length
    ? `<ol class="kbLista kbFaca">${faca.map(i => `<li><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(i.aba)}|${escapeHtml(i.lead_id)}">${escapeHtml(i.nome || '(sem nome)')}</button><span class="kbMeta">${escapeHtml(i.motivo)}</span></li>`).join('')}</ol>`
    : `<p class="kbMeta">Tudo em dia — nada urgente agora.</p>`;
  const pegar = kbPodePegar() && h.livres ? `<button type="button" class="btn kbProximo" data-kb-pegar-proximo>Pegar o próximo livre ›</button><span class="kbMeta">${h.livres} livre(s) esperando</span>` : '';
  const p = h.placar || {}, lg = kbEstado.placarLig;
  const ligTxt = lg && lg.tem_telefonia !== false ? `${lg.lig_hoje || 0}${lg.meta_ligacoes_dia ? ' / ' + lg.meta_ligacoes_dia : ''}` : '—';
  const placar = `<div class="kbPlacar"><span><strong>${escapeHtml(ligTxt)}</strong>ligações hoje</span><span><strong>${p.classificacoes || 0}</strong>classificações hoje</span><span><strong>${p.retornos_cumpridos || 0} de ${p.retornos_hoje || 0}</strong>retornos cumpridos</span></div>`;
  const n = kbEstado.alertas.length;
  const alertas = n ? `<button type="button" class="kbLink" data-kb-ver-alertas>${n} alerta${n === 1 ? '' : 's'} · ${kbEstado.alertasAbertos ? 'esconder' : 'ver'}</button>` +
    (kbEstado.alertasAbertos ? `<ul class="kbLista kbAlertasLista">${kbEstado.alertas.map(a => `<li><span class="kbAlertaTipo kbAl-${escapeHtml(a.tipo)}">${escapeHtml(kbAlertaTexto(a))}</span><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(a.aba)}|${escapeHtml(a.lead_id)}">${escapeHtml(a.nome || '')}</button>${kbGestor() && a.dono_nome ? `<span class="kbMeta">${escapeHtml(a.dono_nome)}</span>` : ''}</li>`).join('')}</ul>` : '')
    : '<span class="kbMeta">Nenhum alerta.</span>';
  document.getElementById('kbHoje').innerHTML = `<div class="kbCartoes">${cartoes}</div>${lista}
    <div class="kbHojeGrade"><div class="card"><h4>Faça agora</h4>${facaHtml}${pegar ? `<div class="kbProximoBox">${pegar}</div>` : ''}</div>
    <div class="card"><h4>Seu dia</h4>${placar}<div class="kbAlertasLinha">${alertas}</div></div></div>`;
}
```

3c. No listener `document.getElementById('panel-meusleads').addEventListener('click', …)`, logo no começo (antes do `data-kb-abrir`), acrescentar:

```js
  const ct = e.target.closest('[data-kb-cartao]');
  if(ct){ kbEstado.cartaoAberto = kbEstado.cartaoAberto === ct.dataset.kbCartao ? null : ct.dataset.kbCartao; kbEstado.cartaoMax = 20; kbRenderHoje(); return; }
  if(e.target.closest('#kbHoje [data-kb-cartao-mais]')){ kbEstado.cartaoMax = (kbEstado.cartaoMax || 20) + 20; kbRenderHoje(); return; }
  if(e.target.closest('[data-kb-ver-alertas]')){ kbEstado.alertasAbertos = !kbEstado.alertasAbertos; kbRenderHoje(); return; }
```

3d. CSS (fim do `#kbStyles`):

```css
  /* §122: Hoje em painel */
  .kbCartoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-4);}
  .kbCartao{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:var(--space-3) var(--space-4);border:1.5px solid var(--c-grafite);background:var(--c-papel);cursor:pointer;font:inherit;text-align:left;}
  .kbCartao.active{border-color:var(--c-sinal);box-shadow:inset 0 -3px 0 var(--c-sinal);}
  .kbCartaoN{font-family:var(--font-head);font-size:var(--fs-xl);font-weight:700;line-height:1;}
  .kbCartaoRot{font-size:var(--fs-sm);text-transform:uppercase;letter-spacing:.04em;}
  .kbCartaoLista{margin-bottom:var(--space-4);}
  .kbFaca{counter-reset:faca;}
  .kbPlacar{display:flex;flex-wrap:wrap;gap:var(--space-5);margin-bottom:var(--space-3);font-size:var(--fs-sm);color:var(--muted);}
  .kbPlacar strong{display:block;font-family:var(--font-head);font-size:var(--fs-lg);color:var(--c-grafite);}
  .kbAlertasLinha{border-top:1px solid var(--c-linha);padding-top:var(--space-2);}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_painel_hoje.js test_leads_hoje.js
git commit -m "feat(meus-leads): Hoje em painel - cartoes por etapa, Faca agora e placar do dia (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Equipe do supervisor — contagens clicáveis e semáforo de ligação/OBS

**Files:**
- Modify: `_template.html` (`kbCarregarEquipe`, nova `kbRenderEquipe`, listener do `panel-meusleads`, CSS)
- Modify: `test_leads_painel_hoje.js`, `test_leads_hoje.js` (bloco do gestor, linhas 143–153)

**Interfaces:**
- Consumes: `leads_kanban3(null, false)`, `leads_atividade_equipe()` (Task 2); `kbListaDoCartao`, `kbListaCartaoHtml` (Task 5); `kbDiasParado`, `kbAbertoCol`, `kbPartesSP`, `kbDiaSP` (Task 3); `kbConversao` (existente).
- Produces: `KB_EXPEDIENTE = { ini: 780, fim: 1260 }` (minutos SP), `KB_ATIV_LIMITES = { amarelo: 30, vermelho: 60 }`; `kbAtividade(ultLig, ultObs, agoraMs) → { cor: 'verde'|'amarelo'|'vermelho'|'cinza', min: int|null }`; `kbContagemEquipe(leads, alertas, agoraMs) → { [dono_id]: { sem_contato, andamento, parados3, retornos_atrasados, convertidos, receita, pegos_mes } }`; `kbAtividadeTexto(a, agoraMs) → { lig: string, obs: string }`.

- [ ] **Step 1: Testes**

Substituir `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 6 ====
  eq(kbAtividade(null, null, SP('2026-10-28T12:59:00')), { cor: 'cinza', min: null }, 'antes das 13h: fora do expediente (Review Focus 3)');
  eq(kbAtividade(null, null, SP('2026-10-28T21:00:00')), { cor: 'cinza', min: null }, '21:00: fora do expediente');
  eq(kbAtividade(null, null, SP('2026-10-31T15:00:00')), { cor: 'cinza', min: null }, 'sábado: fora do expediente');
  eq(kbAtividade('2026-10-27T20:50:00-03:00', null, SP('2026-10-28T13:10:00')), { cor: 'verde', min: 10 }, '13:10 conta a partir das 13:00, não de ontem');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', '2026-10-28T14:20:00-03:00', SP('2026-10-28T14:49:00')), { cor: 'verde', min: 29 }, 'vale a ação mais recente (OBS)');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', null, SP('2026-10-28T14:30:00')), { cor: 'amarelo', min: 30 }, '30 min: amarelo');
  eq(kbAtividade('2026-10-28T14:00:00-03:00', null, SP('2026-10-28T15:00:00')), { cor: 'vermelho', min: 60 }, '60 min: vermelho');
  const ag6 = SP('2026-10-28T15:00:00');
  eq(kbAtividadeTexto({ tem_telefonia: true, ultima_ligacao: '2026-10-28T14:48:00-03:00', lig_hoje: 34, ultima_obs: null, obs_hoje: 0 }, ag6),
     { lig: 'ligou há 12 min · 34 hoje', obs: 'nenhuma OBS recente · 0 hoje' }, 'texto da atividade');
  eq(kbAtividadeTexto({ tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: '2026-10-28T14:20:00-03:00', obs_hoje: 9 }, ag6),
     { lig: 'sem usuário de telefonia', obs: 'OBS há 40 min · 9 hoje' }, 'sem usuário de telefonia (Review Focus 4)');
  const L6 = [
    { aba: 'O', lead_id: 'p1', nome: 'Zz P1', dono_id: 'u-zz', categoria: 'sem_contato', livre: false, ligacoes: 0, pego_em: '2026-10-28T09:00:00-03:00' },
    { aba: 'O', lead_id: 'p2', nome: 'Zz P2', dono_id: 'u-zz', categoria: 'andamento', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-20T10:00:00-03:00', pego_em: '2026-10-15T09:00:00-03:00' },
    { aba: 'O', lead_id: 'p3', nome: 'Zz P3', dono_id: 'u-zz', categoria: 'convertido', livre: false, receita: 100, pego_em: '2026-10-02T09:00:00-03:00', classificado_em: '2026-10-05T10:00:00-03:00' },
    { aba: 'O', lead_id: 'p4', nome: 'Zz P4', dono_id: 'u-zz', categoria: 'perdido', livre: false, pego_em: '2026-09-25T09:00:00-03:00', classificado_em: '2026-10-03T10:00:00-03:00' },
    { aba: 'O', lead_id: 'q1', nome: 'Zz Q1', dono_id: 'u-yy', categoria: 'andamento', livre: false, ligacoes: 1, ultima_ligacao: '2026-10-28T10:00:00-03:00', pego_em: '2026-10-28T09:00:00-03:00' },
    { aba: 'O', lead_id: 'l9', nome: 'Zz Livre', categoria: 'sem_contato', livre: true },
  ];
  const A6 = [{ tipo: 'retorno_vencido', aba: 'O', lead_id: 'p2', nome: 'Zz P2', dono_id: 'u-zz', dono_nome: 'Zzkcon Teste', desde: '2026-10-28T10:00:00-03:00' }];
  eq(kbContagemEquipe(L6, A6, ag6)['u-zz'], { sem_contato: 1, andamento: 1, parados3: 1, retornos_atrasados: 1, convertidos: 1, receita: 100, pegos_mes: 3 }, 'contagens por consultor');
  eq(kbContagemEquipe(L6, A6, ag6)['u-yy'].parados3, 0, 'quem ligou hoje não está parado');
  // tela do gestor
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__rpcRespostas.leads_kanban3 = { data: L6, error: null };
  window.__rpcRespostas.leads_alertas = { data: A6, error: null };
  window.__rpcRespostas.leads_atividade_equipe = { data: [
    { dono_id: 'u-zz', nome: 'Zzkcon Teste', tem_telefonia: true, ultima_ligacao: new Date(Date.now() - 5 * 60000).toISOString(), lig_hoje: 34, ultima_obs: null, obs_hoje: 0 },
    { dono_id: 'u-yy', nome: 'Zzyy Teste', tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 },
  ], error: null };
  await kbAplicarPermissao();
  kbEstado.aba = null;
  await kbCarregar();
  await espera(100);
  const eqEl = document.getElementById('kbEquipe');
  assert(eqEl.style.display !== 'none' && eqEl.querySelector('tr[data-kb-dono="u-zz"]') && eqEl.querySelector('tr[data-kb-dono="u-yy"]'), 'Equipe lista os consultores da atividade');
  assert(eqEl.textContent.includes('34 hoje') && eqEl.textContent.includes('sem usuário de telefonia'), 'Equipe mostra a atividade');
  assert(eqEl.querySelector('tr[data-kb-dono="u-zz"] .kbSemaforo'), 'bolinha do semáforo na linha');
  assert(eqEl.textContent.includes('Ligações chegam do ProContact de hora em hora'), 'rodapé avisa do atraso das ligações');
  eqEl.querySelector('[data-kb-eq="u-zz|parados3"]').click();
  await espera(20);
  assert(document.querySelector('#kbEquipe .kbCartaoLista') && document.getElementById('kbEquipe').textContent.includes('Zz P2'), 'número abre a lista do consultor naquela etapa');
  assert(kbEstado.aba === 'equipe', 'clicar no número não troca de aba');
  // ==== mais testes entram aqui ====
```

Em `test_leads_hoje.js`, no bloco do gestor (linha `window.__rpcRespostas.leads_equipe_resumo = …`), acrescentar logo abaixo:

```js
  window.__rpcRespostas.leads_atividade_equipe = { data: [{ dono_id: 'u-zz', nome: 'Zzkcon Teste', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 }], error: null };
  window.__rpcRespostas.leads_kanban3 = { data: [{ aba: 'OUTUBRO', lead_id: 'h9', nome: 'Zz Venda', dono_id: 'u-zz', categoria: 'convertido', livre: false, receita: 10, pego_em: new Date().toISOString(), classificado_em: new Date().toISOString() },
    { aba: 'OUTUBRO', lead_id: 'h8', nome: 'Zz Aberto', dono_id: 'u-zz', categoria: 'andamento', livre: false, ligacoes: 1, pego_em: new Date().toISOString() },
    { aba: 'OUTUBRO', lead_id: 'h7', nome: 'Zz Aberto 2', dono_id: 'u-zz', categoria: 'andamento', livre: false, ligacoes: 1, pego_em: new Date().toISOString() },
    { aba: 'OUTUBRO', lead_id: 'h6', nome: 'Zz Aberto 3', dono_id: 'u-zz', categoria: 'andamento', livre: false, ligacoes: 1, pego_em: new Date().toISOString() }], error: null };
```

e trocar a asserção `assert(linhaEq && linhaEq.classList.contains('kbSem-vermelho') && linhaEq.textContent.includes('25%'), 'Equipe: semáforo e conversão');` por `assert(linhaEq && linhaEq.querySelector('.kbSemaforo') && linhaEq.textContent.includes('25%'), 'Equipe: semáforo e conversão');`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHA: ReferenceError: kbAtividade is not defined`

- [ ] **Step 3: Implementar**

3a. Funções puras (depois de `kbFacaAgora`):

```js
const KB_EXPEDIENTE = { ini: 13 * 60, fim: 21 * 60 };   // §122: semáforo só de 13h às 21h, segunda a sexta (SP)
const KB_ATIV_LIMITES = { amarelo: 30, vermelho: 60 };
function kbAtividade(ultLig, ultObs, agoraMs){
  const p = kbPartesSP(agoraMs);
  if(p.dow === 0 || p.dow === 6 || p.min < KB_EXPEDIENTE.ini || p.min >= KB_EXPEDIENTE.fim) return { cor: 'cinza', min: null };
  const inicio = Date.parse(p.dia + 'T00:00:00-03:00') + KB_EXPEDIENTE.ini * 60000;
  const ult = Math.max(inicio, kbMs(ultLig) || 0, kbMs(ultObs) || 0);
  const min = Math.max(0, Math.floor((agoraMs - ult) / 60000));
  return { cor: min >= KB_ATIV_LIMITES.vermelho ? 'vermelho' : min >= KB_ATIV_LIMITES.amarelo ? 'amarelo' : 'verde', min };
}
function kbAtividadeTexto(a, agoraMs){
  const lig = !a.tem_telefonia ? 'sem usuário de telefonia'
    : (a.ultima_ligacao ? 'ligou ' + kbTempoDesde(a.ultima_ligacao, agoraMs) : 'nenhuma ligação recente') + ` · ${a.lig_hoje || 0} hoje`;
  const obs = (a.ultima_obs ? 'OBS ' + kbTempoDesde(a.ultima_obs, agoraMs) : 'nenhuma OBS recente') + ` · ${a.obs_hoje || 0} hoje`;
  return { lig, obs };
}
function kbContagemEquipe(leads, alertas, agoraMs){
  const m = {}, mes = kbDiaSP(agoraMs).slice(0, 7);
  const de = (id) => m[id] || (m[id] = { sem_contato: 0, andamento: 0, parados3: 0, retornos_atrasados: 0, convertidos: 0, receita: 0, pegos_mes: 0 });
  (leads || []).filter(l => !l.livre && l.dono_id).forEach(l => {
    const d = de(l.dono_id), c = kbColunaDoLead(l);
    if(c === 'novos') d.sem_contato++;
    if(c === 'andamento' || c === 'semlig') d.andamento++;
    if(kbAbertoCol(c) && (kbDiasParado(l, agoraMs) || 0) >= 3) d.parados3++;
    if(c === 'convertido'){ d.convertidos++; d.receita = Math.round((d.receita + (Number(l.receita) || 0)) * 100) / 100; }
    if(kbMs(l.pego_em) !== null && kbDiaSP(l.pego_em).slice(0, 7) === mes) d.pegos_mes++;
  });
  (alertas || []).filter(a => a.tipo === 'retorno_vencido' && a.dono_id).forEach(a => { de(a.dono_id).retornos_atrasados++; });
  return m;
}
```

3b. Tela: substituir `kbCarregarEquipe` por:

```js
async function kbCarregarEquipe(notificar){
  if(!kbGestor()) return;
  const [lds, at] = await Promise.all([
    ppSeguro(() => sb.rpc('leads_kanban3', { p_dono: null, p_todos: false })),
    ppSeguro(() => sb.rpc('leads_atividade_equipe')),
    kbCarregarAlertas(!!notificar),
  ]);
  if(lds && !lds.error) kbEstado.leadsEquipe = lds.data || [];
  if(at && !at.error) kbEstado.atividade = at.data || [];
  kbRenderEquipe();
}
// §122: uma linha por consultor — atividade (semáforo de ligação/OBS, só no expediente) e contagens que abrem a lista.
function kbRenderEquipe(){
  const agoraMs = Date.now(), cont = kbContagemEquipe(kbEstado.leadsEquipe, kbEstado.alertas, agoraMs);
  const num = (dono, chave, n) => n ? `<button type="button" class="kbLink" data-kb-eq="${escapeHtml(dono)}|${chave}">${n}</button>` : '0';
  const linhas = (kbEstado.atividade || []).map(a => {
    const c = cont[a.dono_id] || { sem_contato: 0, andamento: 0, parados3: 0, retornos_atrasados: 0, convertidos: 0, receita: 0, pegos_mes: 0 };
    const s = kbAtividade(a.ultima_ligacao, a.ultima_obs, agoraMs), t = kbAtividadeTexto(a, agoraMs);
    return `<tr class="kbSem-${s.cor}" data-kb-dono="${escapeHtml(a.dono_id)}">
      <td><span class="kbSemaforo"></span>${escapeHtml(a.nome || '')}</td>
      <td class="kbAtiv"><span>${escapeHtml(t.lig)}</span><span>${escapeHtml(t.obs)}</span>${s.cor === 'cinza' ? '<span class="kbMeta">fora do expediente</span>' : ''}</td>
      <td>${num(a.dono_id, 'sem_contato', c.sem_contato)}</td><td>${num(a.dono_id, 'andamento', c.andamento)}</td>
      <td>${num(a.dono_id, 'parados3', c.parados3)}</td><td>${num(a.dono_id, 'retorno_atrasado', c.retornos_atrasados)}</td>
      <td>${num(a.dono_id, 'convertido', c.convertidos)}</td><td>${kbConversao({ pegos_mes: c.pegos_mes, convertidos_mes: c.convertidos })}</td>
      <td>${escapeHtml(kbMoeda(c.receita) || 'R$ 0,00')}</td></tr>`;
  }).join('');
  const sel = kbEstado.equipeLista;
  let lista = '';
  if(sel){
    const leadsDono = (kbEstado.leadsEquipe || []).filter(l => l.dono_id === sel.dono);
    const ret = (kbEstado.alertas || []).filter(a => a.tipo === 'retorno_vencido' && a.dono_id === sel.dono).map(a => ({ aba: a.aba, lead_id: a.lead_id, nome: a.nome, quando: a.desde, vencido: true }));
    const nome = ((kbEstado.atividade || []).find(a => a.dono_id === sel.dono) || {}).nome || '';
    lista = `<div class="card"><h4>${escapeHtml(nome)} · ${escapeHtml(KB_EQ_TITULOS[sel.chave] || '')} <button type="button" class="kbLink" data-kb-eq-fechar>fechar</button></h4>${kbListaCartaoHtml(kbListaDoCartao(sel.chave, leadsDono, ret, agoraMs), 50)}</div>`;
  }
  const alertas = kbEstado.alertas.map(a => `<li><span class="kbAlertaTipo kbAl-${escapeHtml(a.tipo)}">${escapeHtml(kbAlertaTexto(a))}</span><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(a.aba)}|${escapeHtml(a.lead_id)}">${escapeHtml(a.nome || '')}</button><span class="kbMeta">${escapeHtml(a.dono_nome || '')} · ${escapeHtml(kbTempoDesde(a.desde, agoraMs))}</span></li>`).join('') || '<li class="kbMeta">Nenhum alerta na equipe.</li>';
  document.getElementById('kbEquipe').innerHTML = `<div class="card kbTabelaRolagem"><table class="tbl kbTabelaEquipe"><thead><tr><th>Consultor</th><th>Atividade</th><th>Sem contato</th><th>Andamento</th><th>Parados 3+ dias</th><th>Retornos atrasados</th><th>Convertidos no mês</th><th>Conversão</th><th>Receita</th></tr></thead><tbody>${linhas || '<tr><td colspan="9" class="kbMeta">Sem consultores na equipe de leads.</td></tr>'}</tbody></table>
    <p class="kbMeta">Semáforo: sem ligar nem escrever OBS há 30 min = amarelo, 1 h = vermelho (13h–21h, seg–sex). Ligações chegam do ProContact de hora em hora; a última ligação pode estar até 1 h atrasada.</p></div>
    ${lista}<div class="card"><h4>Alertas da equipe</h4><ul class="kbLista">${alertas}</ul></div>`;
}
const KB_EQ_TITULOS = { sem_contato: 'Sem contato', andamento: 'Em andamento', parados3: 'Parados 3+ dias', retorno_atrasado: 'Retornos atrasados', convertido: 'Convertidos no mês' };
```

3c. No listener do `panel-meusleads`, logo no começo:

```js
  const eqn = e.target.closest('[data-kb-eq]');
  if(eqn){ const [dono, chave] = eqn.dataset.kbEq.split('|'); kbEstado.equipeLista = { dono, chave }; kbRenderEquipe(); return; }
  if(e.target.closest('[data-kb-eq-fechar]')){ kbEstado.equipeLista = null; kbRenderEquipe(); return; }
```

(o clique no resto da linha continua abrindo o Quadro filtrado.) Em `kbCarregarAlertas`, depois de atualizar os badges, acrescentar `if(kbEstado.aba === 'equipe' && document.getElementById('kbEquipe').innerHTML) kbRenderEquipe();`.

3d. CSS (fim do `#kbStyles`):

```css
  /* §122: atividade na Equipe */
  .kbSem-cinza .kbSemaforo{background:var(--muted);}
  .kbAtiv span{display:block;font-size:var(--fs-xs);}
  .kbTabelaEquipe .kbAtiv{white-space:normal;min-width:190px;}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_painel_hoje.js test_leads_hoje.js
git commit -m "feat(meus-leads): Equipe com semaforo de ligacao/OBS e contagens que abrem a lista (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Aba Todos

**Files:**
- Modify: `_template.html` (`KB_ABAS`, `KB_ABA_TITULOS`, `kbAbasDoPerfil`, markup `#kbAbas` e `#kbTodos`, `kbTrocarAba`, `kbAgendar`, listener `kbDono`, CSS)
- Modify: `test_leads_painel_hoje.js`, `test_leads_hoje.js` (linhas 56–57 e a das abas do consultor)

**Interfaces:**
- Consumes: `leads_kanban3(p_dono, true)` (Task 2); `kbFiltrar`, `kbRenderFiltroBarra`, `kbFonteFiltros`, `kbEstado.filtros` (Task 4); `kbStChip`, `kbFoneBR`, `kbTempoDesde`, `KB_TITULOS` (existentes).
- Produces: `kbOrdenar(leads, col, desc)`, `kbPagina(lista, pagina, porPagina) → { itens, pagina, total }`, `kbBuscaLocal(l, texto) → bool`, `KB_TODOS_POR_PAGINA = 50`, `kbCarregarTodos()`, `kbRenderTodos()`, `kbEstado.todos`, `kbEstado.todosEstado = { busca, col, desc, pagina }`.

- [ ] **Step 1: Testes**

Substituir `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 7 ====
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro', 'todos'], 'consultor: Hoje, Quadro e Todos');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'todos', 'equipe'], 'gestor: + Equipe');
  const L7 = Array.from({ length: 120 }, (_, i) => ({ aba: 'OUTUBRO', lead_id: 't' + i, nome: 'Zz Todos ' + String(i).padStart(3, '0'), categoria: i % 3 ? 'perdido' : 'andamento', status: i % 3 ? 'CNPJ INAPTO' : 'EM NEGOCIAÇÂO',
    livre: false, dono_id: 'u-pode', ligacoes: i % 2, ultima_ligacao: i % 2 ? '2026-10-2' + (i % 8) + 'T10:00:00-03:00' : null, pego_em: '2026-10-01T10:00:00-03:00', qtd_linhas: (i % 10 + 1) + ' linhas', cidade: i % 2 ? 'Campinas' : 'Santos', telefone: '119000' + String(i).padStart(5, '0'), cnpj: '000000000' + String(i).padStart(5, '0') }));
  eq(kbOrdenar(L7, 'nome', true)[0].lead_id, 't119', 'ordena por nome (desc)');
  eq(kbOrdenar(L7, 'linhas', false)[0].qtd_linhas, '1 linhas', 'ordena por linhas pelo número');
  eq(kbPagina(L7, 3, 50), { itens: L7.slice(100, 120), pagina: 3, total: 3 }, 'página 3 de 3');
  eq(kbPagina(L7, 9, 50).pagina, 3, 'página além do fim volta para a última');
  eq(kbPagina([], 1, 50), { itens: [], pagina: 1, total: 1 }, 'lista vazia');
  eq([kbBuscaLocal(L7[5], 'todos 005'), kbBuscaLocal(L7[5], '11900000005'), kbBuscaLocal(L7[5], '00000000000005'), kbBuscaLocal(L7[5], 'zz x'), kbBuscaLocal(L7[5], 'zz')], [true, true, true, false, true], 'busca por nome (com letras) ou telefone/CNPJ (só dígitos); menos de 3 caracteres não filtra');
  eq(kbBuscaLocal(L7[70], 'todos 007'), false, 'texto com letras não casa por dígitos do telefone');
  // tela
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, pode_pegar: true }];
  await kbAplicarPermissao();
  window.__rpcRespostas.leads_kanban3 = (args) => ({ data: args.p_todos ? L7 : [], error: null });
  kbEstado.filtros = {};
  kbTrocarAba('todos');
  await espera(80);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_kanban3' && c.args.p_todos === true), 'Todos carrega com p_todos');
  const td = document.getElementById('kbTodos');
  assert(td.style.display !== 'none' && document.getElementById('kbBoard').style.display === 'none', 'aba Todos aparece');
  eq(td.querySelectorAll('tbody tr').length, 50, '50 por página');
  assert(td.textContent.includes('Página 1 de 3') && td.textContent.includes('120 leads'), 'paginação');
  td.querySelector('[data-kb-pag="2"]').click();
  assert(document.getElementById('kbTodos').textContent.includes('Página 2 de 3'), 'próxima página');
  document.querySelector('#kbTodos th[data-kb-ord="nome"]').click();
  document.querySelector('#kbTodos th[data-kb-ord="nome"]').click();
  eq(document.querySelector('#kbTodos tbody tr').dataset.kbAbrir, 'OUTUBRO|t119', 'clicar duas vezes no cabeçalho inverte a ordem');
  const busca = document.getElementById('kbTodosBusca');
  busca.value = 'todos 007'; busca.dispatchEvent(new window.Event('input'));
  await espera(350);
  eq(document.querySelectorAll('#kbTodos tbody tr').length, 1, 'busca na aba Todos');
  busca.value = ''; busca.dispatchEvent(new window.Event('input'));
  await espera(350);
  kbEstado.filtros = { cidade: 'Santos' }; kbAoMudarFiltros();
  assert(document.getElementById('kbTodos').textContent.includes('60 leads'), 'filtros valem na aba Todos');
  assert(document.getElementById('kbFiltroBarra').style.display !== 'none', 'barra de filtros na aba Todos');
  document.querySelector('#kbTodos tbody tr').click();
  await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha'), 'clicar na linha abre a ficha');
  kbFecharFicha();
  kbEstado.filtros = {};
  // ==== mais testes entram aqui ====
```

Em `test_leads_hoje.js`: trocar as linhas 56–57 por

```js
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro', 'todos'], 'consultor: Hoje, Quadro e Todos');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'todos', 'equipe'], 'gestor: + Todos e Equipe');
```

e, na asserção `'consultor vê Hoje e Quadro'`, trocar `['hoje', 'quadro']` por `['hoje', 'quadro', 'todos']`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHOU: consultor: Hoje, Quadro e Todos …` e depois `ReferenceError: kbOrdenar is not defined`.

- [ ] **Step 3: Implementar**

3a. Abas: trocar

```js
const KB_ABAS = ['hoje', 'quadro', 'equipe'];
const KB_ABA_TITULOS = { hoje: 'Hoje', quadro: 'Quadro', equipe: 'Equipe' };
function kbAbasDoPerfil(gestor){ return gestor ? KB_ABAS.slice() : ['hoje', 'quadro']; }
```

por

```js
const KB_ABAS = ['hoje', 'quadro', 'todos', 'equipe'];
const KB_ABA_TITULOS = { hoje: 'Hoje', quadro: 'Quadro', todos: 'Todos', equipe: 'Equipe' };
function kbAbasDoPerfil(gestor){ return gestor ? KB_ABAS.slice() : ['hoje', 'quadro', 'todos']; }
```

Markup: depois de `<button type="button" class="filterPill" data-kb-aba="quadro">Quadro</button>` acrescentar `<button type="button" class="filterPill" data-kb-aba="todos">Todos</button>`. Depois de `<div id="kbFiltroBarra" …></div>` acrescentar:

```html
      <div id="kbTodos" class="kbTodos" style="display:none">
        <div class="card"><input type="search" id="kbTodosBusca" class="kbBusca" placeholder="Buscar nos seus leads por nome, telefone ou CNPJ…" autocomplete="off"><div id="kbTodosTabela"></div></div>
      </div>
```

3b. Funções puras (depois de `kbContagemEquipe`):

```js
const KB_TODOS_POR_PAGINA = 50;
const KB_TODOS_COLUNAS = [['nome', 'Nome'], ['etapa', 'Etapa'], ['status', 'STATUS'], ['contato', 'Último contato'], ['retorno', 'Retorno'], ['linhas', 'Linhas'], ['cidade', 'Cidade'], ['pego', 'Pego em']];
function kbValorOrdem(l, col){
  if(col === 'nome') return String(l.nome || '').toLowerCase();
  if(col === 'etapa') return KB_COLUNAS.indexOf(kbColunaDoLead(l));
  if(col === 'status') return String(l.status || '');
  if(col === 'contato') return kbMs(l.ultima_ligacao) || 0;
  if(col === 'retorno') return String(l.retorno_em || '');
  if(col === 'linhas') return Number((String(l.qtd_linhas || '').match(/\d+/) || [0])[0]);
  if(col === 'cidade') return String(l.cidade || '').toLowerCase();
  if(col === 'pego') return kbMs(l.pego_em) || 0;
  return '';
}
function kbOrdenar(leads, col, desc){ return (leads || []).slice().sort((a, b) => { const x = kbValorOrdem(a, col), y = kbValorOrdem(b, col); const c = x < y ? -1 : x > y ? 1 : 0; return desc ? -c : c; }); }
function kbPagina(lista, pagina, porPagina){
  const total = Math.max(1, Math.ceil((lista || []).length / porPagina)), p = Math.min(Math.max(1, pagina || 1), total);
  return { itens: (lista || []).slice((p - 1) * porPagina, p * porPagina), pagina: p, total };
}
function kbBuscaLocal(l, texto){
  const t = String(texto || '').trim().toLowerCase();
  if(t.length < 3) return true;
  if(!/^[\d\s().\/-]+$/.test(t)) return String(l.nome || '').toLowerCase().includes(t);   // com letras: só pelo nome
  const dig = t.replace(/\D/g, '');
  return dig.length >= 3 && (String(l.telefone || '').replace(/\D/g, '').includes(dig) || String(l.cnpj || '').replace(/\D/g, '').includes(dig));
}
```

3c. Tela (no bloco §118, depois de `kbRenderEquipe`):

```js
async function kbCarregarTodos(){
  const r = await ppSeguro(() => sb.rpc('leads_kanban3', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null, p_todos: true }));
  if(r && !r.error) kbEstado.todos = r.data || [];
  kbRenderTodos();
  kbRenderFiltroBarra();
}
function kbRenderTodos(){
  const st = kbEstado.todosEstado || (kbEstado.todosEstado = { busca: '', col: 'pego', desc: true, pagina: 1 }), agoraMs = Date.now();
  const lista = kbOrdenar(kbFiltrar(kbEstado.todos || [], kbEstado.filtros, agoraMs).filter(l => kbBuscaLocal(l, st.busca)), st.col, st.desc);
  const pg = kbPagina(lista, st.pagina, KB_TODOS_POR_PAGINA);
  st.pagina = pg.pagina;
  const cab = KB_TODOS_COLUNAS.map(([c, r]) => `<th data-kb-ord="${c}" class="kbOrdenavel">${r}${st.col === c ? (st.desc ? ' ▼' : ' ▲') : ''}</th>`).join('');
  const linhas = pg.itens.map(l => `<tr data-kb-abrir="${escapeHtml(l.aba)}|${escapeHtml(l.lead_id)}">
      <td>${escapeHtml(l.nome || '(sem nome)')}${kbGestor() && l.dono_nome ? `<span class="kbMeta"> · ${escapeHtml(l.dono_nome)}</span>` : ''}</td>
      <td>${escapeHtml(KB_TITULOS[kbColunaDoLead(l)] || '')}</td><td>${l.status ? kbStChip(l.status) : '—'}</td>
      <td>${l.ultima_ligacao ? escapeHtml(kbTempoDesde(l.ultima_ligacao, agoraMs)) : 'nunca ligado'}</td>
      <td>${l.retorno_em ? escapeHtml(String(l.retorno_em).split('-').reverse().join('/')) : '—'}</td>
      <td>${escapeHtml(l.qtd_linhas || '—')}</td><td>${escapeHtml(l.cidade || '—')}</td><td>${l.pego_em ? escapeHtml(kbDataHoraBR(l.pego_em)) : '—'}</td></tr>`).join('');
  const botoes = Array.from({ length: pg.total }, (_, i) => i + 1).filter(p => p === 1 || p === pg.total || Math.abs(p - pg.pagina) <= 2)
    .map(p => `<button type="button" class="filterPill${p === pg.pagina ? ' active' : ''}" data-kb-pag="${p}">${p}</button>`).join('');
  document.getElementById('kbTodosTabela').innerHTML = `<div class="kbTabelaRolagem"><table class="tbl kbTabelaTodos"><thead><tr>${cab}</tr></thead><tbody>${linhas || `<tr><td colspan="8" class="kbMeta">Nenhum lead com esses filtros.</td></tr>`}</tbody></table></div>
    <div class="kbPaginacao"><span class="kbMeta">${lista.length} leads · Página ${pg.pagina} de ${pg.total}</span>${pg.total > 1 ? botoes : ''}</div>`;
}
document.getElementById('kbTodos').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-kb-ord]');
  const st = kbEstado.todosEstado || (kbEstado.todosEstado = { busca: '', col: 'pego', desc: true, pagina: 1 });
  if(th){ const c = th.dataset.kbOrd; if(st.col === c) st.desc = !st.desc; else { st.col = c; st.desc = false; } st.pagina = 1; kbRenderTodos(); return; }
  const pb = e.target.closest('[data-kb-pag]');
  if(pb){ st.pagina = Number(pb.dataset.kbPag); kbRenderTodos(); }
});
let kbTodosBuscaTimer = null;
document.getElementById('kbTodosBusca').addEventListener('input', (e) => {
  clearTimeout(kbTodosBuscaTimer);
  kbTodosBuscaTimer = setTimeout(() => { const st = kbEstado.todosEstado || (kbEstado.todosEstado = { busca: '', col: 'pego', desc: true, pagina: 1 }); st.busca = e.target.value; st.pagina = 1; kbRenderTodos(); }, 300);
});
```

3d. `kbTrocarAba`: depois da linha do `kbEquipe` acrescentar `document.getElementById('kbTodos').style.display = kbEstado.aba === 'todos' ? '' : 'none';` e, no fim, `if(kbEstado.aba === 'todos') kbCarregarTodos();`.

3e. `kbAgendar`, dentro do `if(++voltas % 6 === 0){ … }`, acrescentar `if(kbEstado.aba === 'todos') kbCarregarTodos();`.

3f. Listener do `kbDono` (change): depois de `kbCarregar();` acrescentar `if(kbEstado.aba === 'todos') kbCarregarTodos();`.

3g. CSS (fim do `#kbStyles`):

```css
  /* §122: aba Todos */
  .kbTodos .kbBusca{margin-bottom:var(--space-3);}
  .kbTabelaTodos tbody tr{cursor:pointer;}
  .kbTabelaTodos td,.kbTabelaTodos th{white-space:nowrap;}
  .kbOrdenavel{cursor:pointer;user-select:none;}
  .kbPaginacao{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center;margin-top:var(--space-3);}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_painel_hoje.js test_leads_hoje.js
git commit -m "feat(meus-leads): aba Todos com busca, ordenacao, filtros e 50 por pagina (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Aviso de lead novo para quem pega

**Files:**
- Modify: `_template.html` (`KB_ALERTA_TEXTO`, `kbAlertasParaNotificar`, `kbCarregarAlertas`, `kbParar`, `alAtualizarTitulo`)
- Modify: `test_leads_painel_hoje.js`

**Interfaces:**
- Consumes: `leads_alertas` com `tipo = 'lead_novo'` (Task 1); `kbEstado.leads` (para as linhas); `alBip`, `alAtualizarTitulo`, `agAgora`, `alEstado` (existentes).
- Produces: `kbTextoLeadNovo(a, leads) → string`; `kbPrefixoTitulo() → '' | '[N novo(s)] '`; `kbEstado.leadNovoIniciado`.

- [ ] **Step 1: Testes**

Substituir `  // ==== mais testes entram aqui ====` por:

```js
  // ==== Task 8 ====
  eq(kbAlertaTexto({ tipo: 'lead_novo' }), 'Lead novo', 'texto do alerta lead_novo');
  const al8 = [{ tipo: 'lead_novo', aba: 'O', lead_id: 'n1' }, { tipo: 'parado', aba: 'O', lead_id: 'p1' }, { tipo: 'sem_contato', aba: 'O', lead_id: 's1' }];
  eq(kbAlertasParaNotificar(al8, new Set()).map(a => a.lead_id), ['n1', 's1'], 'notifica lead_novo e sem_contato');
  eq(kbTextoLeadNovo({ nome: 'Zz Padaria' }, [{ aba: 'O', lead_id: 'n1', qtd_linhas: '6 a 10' }]), 'Lead novo: Zz Padaria', 'texto sem linhas quando não acha o lead');
  eq(kbTextoLeadNovo({ aba: 'O', lead_id: 'n1', nome: 'Zz Padaria' }, [{ aba: 'O', lead_id: 'n1', qtd_linhas: '6 a 10' }]), 'Lead novo: Zz Padaria · 6 a 10 linhas', 'texto com as linhas');
  // primeiro carregamento não apita; o lead que chega depois apita uma vez; título ganha o contador
  currentUser = { id: 'u-pode', nome: 'Zzpode Teste', role: 'consultor' };
  kbParar();
  const bips = []; const bipOrig = alBip; alBip = () => bips.push(1);
  const antes8 = (window.__alertas || []).length;
  window.__rpcRespostas.leads_alertas = { data: Array.from({ length: 10 }, (_, i) => ({ tipo: 'lead_novo', aba: 'O', lead_id: 'v' + i, nome: 'Zz Velho ' + i, desde: new Date().toISOString() })), error: null };
  await kbCarregarAlertas(true);
  eq(bips.length, 0, 'primeiro carregamento com 10 leads novos não apita (Review Focus 2)');
  assert(/^\[10 novos\] /.test(document.title), 'título com o contador de leads novos: ' + document.title);
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'lead_novo', aba: 'O', lead_id: 'v0', nome: 'Zz Velho 0', desde: new Date().toISOString() }, { tipo: 'lead_novo', aba: 'O', lead_id: 'z1', nome: 'Zz Chegou Agora', desde: new Date().toISOString() }], error: null };
  await kbCarregarAlertas(true);
  await kbCarregarAlertas(true);
  eq(bips.length, 1, 'lead que chegou depois apita uma vez');
  assert((window.__alertas || []).slice(antes8).some(m => m.includes('Lead novo: Zz Chegou Agora')), 'aviso com o nome do lead');
  assert(/^\[2 novos\] /.test(document.title), 'título atualiza para 2');
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  await kbCarregarAlertas(true);
  assert(!/^\[/.test(document.title), 'sem lead novo, título volta ao normal');
  alBip = bipOrig;
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node test_leads_painel_hoje.js`
Expected: `FALHOU: texto do alerta lead_novo` e `ReferenceError: kbTextoLeadNovo is not defined`.

- [ ] **Step 3: Implementar**

3a. `KB_ALERTA_TEXTO`: acrescentar `lead_novo: 'Lead novo'`. `kbAlertasParaNotificar`: trocar `a.tipo === 'sem_contato'` por `(a.tipo === 'sem_contato' || a.tipo === 'lead_novo')`.

3b. Funções puras (depois de `kbBuscaLocal`):

```js
function kbTextoLeadNovo(a, leads){
  const l = (leads || []).find(x => x.aba === a.aba && x.lead_id === a.lead_id);
  return `Lead novo: ${a.nome || 'lead'}${l && l.qtd_linhas ? ' · ' + l.qtd_linhas + ' linhas' : ''}`;
}
// Título da aba do navegador: "[3 novos] " antes do "(n)" dos retornos da Agenda (alAtualizarTitulo monta os dois).
function kbPrefixoTitulo(){ const n = (kbEstado.alertas || []).filter(a => a.tipo === 'lead_novo').length; return n ? `[${n} novo${n === 1 ? '' : 's'}] ` : ''; }
```

3c. `alAtualizarTitulo`: trocar o corpo por:

```js
function alAtualizarTitulo(agora){
  if(!alEstado.tituloBase) alEstado.tituloBase = document.title.replace(/^(\[\d+ novos?\]\s*)?(\(\d+\)\s*)?/, '');
  const n = (alEstado.proximos || []).filter(r => r.status === 'pendente' && new Date(r.quando).getTime() - AL_ANTES_MS <= agora).length;
  document.title = (typeof kbPrefixoTitulo === 'function' ? kbPrefixoTitulo() : '') + (n ? '(' + n + ') ' : '') + alEstado.tituloBase;
}
```

3d. `kbCarregarAlertas`: substituir o bloco `if(notificar) kbAlertasParaNotificar(…).forEach(a => { … });` por:

```js
  // §122: no primeiro carregamento os leads novos que já estavam lá ficam como vistos (não apita tudo de uma vez)
  if(!kbEstado.leadNovoIniciado){ kbEstado.alertas.filter(a => a.tipo === 'lead_novo').forEach(a => kbEstado.notificados.add(a.aba + '|' + a.lead_id)); kbEstado.leadNovoIniciado = true; }
  if(notificar) kbAlertasParaNotificar(kbEstado.alertas, kbEstado.notificados).forEach(a => {
    kbEstado.notificados.add(a.aba + '|' + a.lead_id);
    const texto = a.tipo === 'lead_novo' ? kbTextoLeadNovo(a, kbEstado.leads) : `${kbAlertaTexto(a)}: ${a.nome || 'lead'}${kbGestor() && a.dono_nome ? ' (' + a.dono_nome + ')' : ''}`;
    mostrarAviso(texto, 'info');
    if('Notification' in window && Notification.permission === 'granted'){ try { const nt = new Notification('Meus leads', { body: texto, tag: 'lead-' + a.lead_id }); nt.onclick = () => { window.focus(); kbAbrirFicha(a.aba, a.lead_id); }; } catch(_e) {} }
    if(typeof alBip === 'function') try { alBip(); } catch(_e) {}
  });
  try { alAtualizarTitulo(agAgora()); } catch(_e) {}
```

3e. `kbParar`: acrescentar `kbEstado.leadNovoIniciado = false;` e, no fim, `try { alAtualizarTitulo(agAgora()); } catch(_e) {}`.

- [ ] **Step 4: Rodar e ver passar**

Run: `for f in test_leads_painel_hoje.js test_leads_hoje.js test_leads_kanban.js; do NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" node $f 2>&1 | tail -1; done`
Expected: três `0 falharam`. (O teste antigo "notifica uma vez só por lead" do `sem_contato` continua valendo: o marcador inicial só marca `lead_novo`.)

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_painel_hoje.js
git commit -m "feat(meus-leads): aviso de lead novo (som, Windows e titulo) para quem pega lead (secao 122)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Fechamento — testes completos, regras, revisão e publicação

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (seção nova `## 122.`)
- Generated: `painel_clientes_apex.html` (por `build_painel.py`)

- [ ] **Step 1: Suíte completa**

Run: `NODE_PATH="$(cd ../leads-kanban/node_modules && pwd -W)" bash run_tests.sh`
Expected: `TOTAL: N passaram, 0 falharam` (pulados só os de planilha real; `test_conversao_vendas.js` é instável — se falhar, rodar sozinho de novo e anotar).

- [ ] **Step 2: Divs balanceadas e outras abas**

```bash
python - <<'EOF'
import re
s=open('_template.html',encoding='utf-8').read()
html=re.sub(r'<script>[\s\S]*?</script>','',s)
print('abre', len(re.findall(r'<div\b',html)), 'fecha', len(re.findall(r'</div>',html)))
EOF
git diff oficial/main -- _template.html | grep -E '^[-+][^-+].*</?div' | head -20
```

Expected: `abre` = `fecha` (mesma diferença que na `oficial/main`, conferir rodando o mesmo script em `git show oficial/main:_template.html`). Abrir o painel gerado num navegador (servidor estático + `demo_local.js`, `?papel=consultor` e `?papel=supervisor`) e conferir que as outras abas (Clientes, Agenda, Fechamento) continuam no lugar.

- [ ] **Step 3: Regras de negócio**

Acrescentar ao fim de `REGRAS_NEGOCIO.md` a seção `## 122. Meus leads: só 4 pegam lead, Hoje em painel, Equipe com atividade, filtros, aba Todos e aviso de lead novo (28/10/2026)` com: quem pega (`pode_pegar`, Luria/Lucas/Caio/Mariana, quem já tem fica, redistribuir livre); Hoje (cartões, Faça agora até 5 e a ordem, placar e de onde vem cada número, alertas recolhidos); Equipe (colunas, semáforo 30/60 min, 13h–21h seg–sex, ligações de hora em hora); filtros (lista e regra do "parado" = dias corridos desde a última ligação/classificação/pego); Todos (todas as etapas e meses, 50 por página); lead novo (só os 4, até 2 h, sem rajada no primeiro carregamento, título `[N novos]`); Copiar telefone sem `p:+55`; funções novas (`leads_kanban3`, `leads_atividade_equipe`) e que `leads_kanban2`/`leads_equipe_resumo` ficam no banco até a próxima limpeza. Commit:

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): secao 122 - Meus leads em painel, filtros, Todos, atividade e lead novo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Revisão única do branch inteiro** (superpowers:requesting-code-review), corrigir o que for Critical/Important e rodar a suíte de novo.

- [ ] **Step 5: Publicar — só com ok do Rafael naquele momento**

1. `git fetch oficial && git merge oficial/main` (resolver junto, nunca sobrescrever); `python build_painel.py`; suíte de novo.
2. Pedir o ok. Com o ok: aplicar as migrations no banco, na ordem, cada uma com `execute_sql` em `begin; … commit;` (sem `drop`): `20261028100000_leads_pode_pegar.sql`, depois `20261028100100_leads_kanban3_atividade.sql`. Rodar `supabase/tests/leads_painel_hoje_check.sql` (termina em `rollback`) → sem erro. Conferir: `select nome_planilha from leads_equipe where pode_pegar` = os 4.
3. Num só comando: `ssh hostinger md5sum` do painel no ar → comparar com o último MD5 conhecido do ar (se diferente, baixar e juntar antes) → backup em `~/deploy_backups/painel_clientes_apex_<data>_antes_meus_leads_painel_hoje.html` → `scp` → `md5sum` remoto = local.
4. Registrar MD5/backup na §122, commit, `git fetch oficial` e push sem force na `oficial/main`; `vigia/vigia_painel.ps1 -Aceitar`.
5. Avisar o Rafael: o time precisa recarregar a página (o HTML não tem cache-control; aba aberta roda o código velho), e os 4 precisam permitir notificações do navegador para receber o aviso do Windows.
