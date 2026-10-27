# Meus leads: Hoje / Quadro / Equipe, pesquisa, linha do tempo, retorno na Agenda e alertas — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a aba "Meus leads" ganha:
- três abas: Hoje (com o botão "Próximo lead"), Quadro e Equipe;
- pesquisa por CNPJ, nome ou telefone;
- linha do tempo na ficha;
- retorno com hora na Agenda;
- alertas com notificação.

**Architecture:**
- Funções `security definer` no Postgres calculam o contato de cada lead (ligação manual por telefone, discador por CNPJ, cliques no painel), os alertas, o resumo da equipe, a fila do dia e os eventos da ficha.
- O painel (`_template.html`) só exibe. As funções puras `kb*` são testadas no jsdom.
- Funções que mudariam assinatura ou tipo de retorno viram funções **novas**, porque o conector do Supabase trava em DROP:
  - `leads_ficha_detalhes` devolve jsonb e substitui a `leads_linha_tempo` da spec;
  - a hora do retorno vai por `leads_agendar_retorno`.

**Tech Stack:** Postgres (Supabase `apex`), plpgsql; HTML/JS único com testes jsdom (`run_tests.sh`).

**Spec:** `docs/superpowers/specs/2026-10-27-meus-leads-hoje-equipe-design.md` (base: `2026-10-26-leads-kanban-planilha-design.md`)

## Global Constraints

- Worktree `.worktrees/leads-kanban`, branch `feat/leads-kanban`. Fazer `git fetch oficial` antes de push. Push sem force.
- Banco de produção: aplicar só com ok. SQL pelo conector com `execute_sql` em partes de no máximo ~8 KB, **sem `drop`**: policy e função se criam "se não existir" ou com `create or replace` na mesma assinatura.
- Repositório público: testes só com dados fictícios (`zz`, `@teste.invalid`, `00000000000101`).
- Design "Sinal de Ápice":
  - CSS só no `<style id="kbStyles">` e só com `var(--…)`;
  - avisos com `mostrarAviso`;
  - não mexer no estilo base, no menu nem no cabeçalho.
- Limites padrão: `{"sem_contato_min":15,"parado_dias":3,"esfriando_dias":2}` em `config.leads_alertas`.
- Contato conta desde `criado_em_lead − 1 h`. Ligação manual pelo `chave_tel(phone_number)`; discador pelo CNPJ com 14 dígitos.
- Alertas recarregam a cada 60 s com a aba visível e a cada 2 min para o contador. A notificação é **uma vez por lead por sessão**, só para `sem_contato`.
- Retorno padrão às **10:00** (horário de SP).
- Pesquisa a partir de 3 caracteres, com 300 ms de espera, no máximo 20 resultados.
- A exceção do "Próximo lead" dura **2 min**.

## Review Focus

1. **Lead sem telefone nem CNPJ**: a linha do tempo, os alertas e a fila não podem quebrar, e o contato fica só pelos cliques. Teste no banco (Task 1).
2. **Fora do expediente** (noite, fim de semana): o alerta `sem_contato` não aparece. Teste no banco com o expediente desligado pela config (Task 2).
3. **Lead aparece em dois motivos da fila** (retorno vencido e esfriando ao mesmo tempo): aparece só uma vez, com o motivo de maior prioridade. Teste no banco (Task 2).
4. **Busca de consultor por CNPJ de lead de outro consultor**: não pode achar. Teste no banco (Task 1).
5. **Reclassificar um AGENDADO RETORNO para outro status** fecha o retorno da Agenda, para o alarme não tocar à toa. Teste no banco (Task 2).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261027100000_leads_hoje_base.sql` | Colunas de lead na `agenda_retornos`, `config.leads_alertas`, `leads_contato_info`, `leads_ficha_detalhes`, `leads_buscar` |
| `supabase/migrations/20261027100100_leads_hoje_alertas.sql` | `leads_expediente_hoje`, `leads_alertas`, `leads_equipe_resumo`, `leads_hoje`, `leads_agenda_lead` (interna), `leads_agendar_retorno`, `leads_classificar`/`leads_redistribuir` mexendo na Agenda |
| `supabase/tests/leads_hoje_check.sql` | Verificação do banco (rollback) |
| `_template.html` | Abas, pesquisa, Hoje, Equipe, ficha com detalhes, hora do retorno, alertas, clique do alerta da Agenda |
| `test_leads_hoje.js` | Testes jsdom das partes novas |

---

### Task 1: Banco — contato do lead, ficha detalhada e pesquisa

**Files:**
- Create: `supabase/migrations/20261027100000_leads_hoje_base.sql`
- Create: `supabase/tests/leads_hoje_check.sql`

**Interfaces:**
- Produces:
  - `leads_contato_info(p_aba text, p_id text, p_tel text, p_cnpj text, p_criado timestamptz) → table(ligacoes int, atendidas int, cliques int, primeiro timestamptz, ultimo timestamptz)` (sem execute para authenticated);
  - `leads_ficha_detalhes(p_aba, p_id) → jsonb {anuncio:{campanha,conjunto,anuncio,formulario,plataforma,organico}, resumo:{ligacoes,atendidas,cliques,ultimo}|null, eventos:[{em,tipo,titulo,detalhe,quem}]}`;
  - `leads_buscar(p_texto text) → table(aba, lead_id, nome, cidade, uf, status, categoria, dono_nome, livre, cnpj, telefone)`;
  - `agenda_retornos.lead_aba`, `agenda_retornos.lead_id`.

- [ ] **Step 1: Teste de banco** (`supabase/tests/leads_hoje_check.sql`, bloco Task 1)

```sql
-- Verificação das migrations 20261027100000/100100 (§118). Rodar depois delas; SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hsup@teste.invalid'),
('00000000-0000-0000-0000-00000000e403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hcon@teste.invalid'),
('00000000-0000-0000-0000-00000000e404', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hout@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e402', 'Zzhsup Teste', 'zz.hsup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e403', 'Zzhcon Teste', 'zz.hcon', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e404', 'Zzhout Teste', 'zz.hout', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZHCON', '00000000-0000-0000-0000-00000000e403', false), ('ZZHOUT', '00000000-0000-0000-0000-00000000e404', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, email, cnpj, campaign_name, adset_name, ad_name, form_name, platform, categoria, status, converteu, receita, dono_id, pego_em) values
('JUNHO', 'zh:meu',   now() - interval '3 hours', 'Zz Padaria Meu', '11900000031', 'a@teste.invalid', '00000000000131', 'Zz Camp', 'Zz Conj', 'Zz Anuncio', 'Zz Form', 'fb', 'sem_contato', null, false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours'),
('JUNHO', 'zh:outro', now() - interval '3 hours', 'Zz Oficina Outro', '11900000032', 'b@teste.invalid', '00000000000132', 'Zz Camp', null, null, null, null, 'sem_contato', null, false, 0, '00000000-0000-0000-0000-00000000e404', now() - interval '2 hours'),
('JUNHO', 'zh:livre', now() - interval '1 hour', 'Zz Livre Busca', '11900000033', 'c@teste.invalid', '00000000000133', 'Zz Camp', null, null, null, null, 'sem_contato', null, false, 0, null, null),
('JUNHO', 'zh:semtel', now() - interval '3 hours', 'Zz Sem Telefone', null, null, null, null, null, null, null, null, 'andamento', 'EM NEGOCIAÇÂO', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '5 days');
insert into public.ligacoes_manuais (usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
('zz.usuario', '11900000031', public.chave_tel('11900000031'), now() - interval '90 minutes', true, 125, 'ZZ TAB');
insert into public.leads_contatos (lead_aba, lead_id, profile_id, canal, em) values ('JUNHO', 'zh:meu', '00000000-0000-0000-0000-00000000e403', 'whatsapp', now() - interval '100 minutes');

do $$
declare j jsonb; n int;
begin
  -- ===== Task 1 =====
  assert (select ligacoes = 1 and atendidas = 1 and cliques = 1 and ultimo is not null from public.leads_contato_info('JUNHO', 'zh:meu', '11900000031', '00000000000131', now() - interval '3 hours')), 'contato: 1 ligação atendida + 1 clique';
  assert (select ligacoes = 0 and cliques = 0 and ultimo is null from public.leads_contato_info('JUNHO', 'zh:semtel', null, null, now() - interval '3 hours')), 'lead sem telefone e sem CNPJ não quebra (Review Focus 1)';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  j := public.leads_ficha_detalhes('JUNHO', 'zh:meu');
  assert (j->'resumo'->>'ligacoes')::int = 1 and (j->'resumo'->>'atendidas')::int = 1, 'ficha: resumo de contato';
  assert jsonb_array_length(j->'eventos') >= 3, 'ficha: chegou + ligação + clique';
  assert (select count(*) from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'ligacao' and e->>'detalhe' like '2 min 5 s%') = 1, 'ficha: duração da ligação';
  assert j->'anuncio'->>'conjunto' = 'Zz Conj' and j->'anuncio'->>'formulario' = 'Zz Form', 'ficha: detalhes do anúncio';
  j := public.leads_ficha_detalhes('JUNHO', 'zh:livre');
  assert j->'resumo' = 'null'::jsonb and jsonb_array_length(j->'eventos') = 1, 'ficha de Livre para consultor: só "chegou"';
  begin
    perform public.leads_ficha_detalhes('JUNHO', 'zh:outro');
    assert false, 'consultor abriu detalhes do lead de outro';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.leads_buscar('Zz Padaria')) = 1, 'busca por nome acha o meu';
  assert (select count(*) from public.leads_buscar('00000000000132')) = 0, 'busca por CNPJ não acha lead de outro consultor (Review Focus 4)';
  assert (select livre and cnpj is null and telefone is null from public.leads_buscar('00000000000133')), 'busca por CNPJ acha Livre sem mostrar o número';
  assert (select count(*) from public.leads_buscar('zz')) = 0, 'menos de 3 caracteres não busca';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e402', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e402', true);
  assert (select count(*) from public.leads_buscar('00000000000132')) = 1, 'supervisor acha qualquer lead';
  assert jsonb_array_length(public.leads_ficha_detalhes('JUNHO', 'zh:outro')->'eventos') >= 1, 'supervisor abre detalhes de qualquer lead';
  execute 'reset role';
  -- ===== mais testes entram aqui =====
end $$;
select 'CHECK OK' r;
rollback;
```

- [ ] **Step 2: Rodar o check antes da migration (precisa falhar)**

Rodar o arquivo pelo conector. Esperado: ERRO "function public.leads_contato_info(...) does not exist".

- [ ] **Step 3: Migration `supabase/migrations/20261027100000_leads_hoje_base.sql`**

```sql
-- §118 Meus leads: Hoje / Quadro / Equipe — parte 1: contato do lead, ficha detalhada e pesquisa.
-- Spec: docs/superpowers/specs/2026-10-27-meus-leads-hoje-equipe-design.md
begin;
alter table public.agenda_retornos add column if not exists lead_aba text, add column if not exists lead_id text;
create index if not exists agenda_retornos_lead_idx on public.agenda_retornos (lead_aba, lead_id) where status = 'pendente';
insert into public.config (chave, valor) values ('leads_alertas', '{"sem_contato_min":15,"parado_dias":3,"esfriando_dias":2}')
on conflict (chave) do nothing;

-- Contato do lead desde 1 h antes de chegar: ligação manual (ProContact, pelo telefone), discador (pelo CNPJ) e cliques
-- de Ligar/WhatsApp no painel. Uso interno (alertas, equipe, hoje, ficha).
create or replace function public.leads_contato_info(p_aba text, p_id text, p_tel text, p_cnpj text, p_criado timestamptz)
returns table(ligacoes int, atendidas int, cliques int, primeiro timestamptz, ultimo timestamptz)
language sql stable security definer set search_path = public as $$
  with m as (
    select count(*)::int n, (count(*) filter (where atendida))::int a, min(gerada_em) p, max(gerada_em) u
      from public.ligacoes_manuais
     where public.chave_tel(p_tel) is not null and chave_tel = public.chave_tel(p_tel)
       and gerada_em >= coalesce(p_criado, now()) - interval '1 hour'
  ), d as (
    select count(*)::int n, (count(*) filter (where status = 'ANSWERED'))::int a, min(gerada_em) p, max(gerada_em) u
      from public.discador_chamadas
     where length(regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g')) = 14
       and cnpj = regexp_replace(p_cnpj, '[^0-9]', '', 'g')
       and gerada_em >= coalesce(p_criado, now()) - interval '1 hour'
  ), c as (
    select count(*)::int n, min(em) p, max(em) u from public.leads_contatos where lead_aba = p_aba and lead_id = p_id
  )
  select m.n + d.n, m.a + d.a, c.n, least(m.p, d.p, c.p), greatest(m.u, d.u, c.u) from m, d, c;
$$;
revoke all on function public.leads_contato_info(text, text, text, text, timestamptz) from public, anon, authenticated;

-- Ficha detalhada: detalhes do anúncio, resumo de contato e linha do tempo (mesma permissão da leads_ficha).
create or replace function public.leads_ficha_detalhes(p_aba text, p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        l public.leads%rowtype; v_livre boolean; i record; v_anuncio jsonb; v_ev jsonb;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  v_livre := l.dono_id is null and l.categoria = 'sem_contato';
  if not v_gestor then
    if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
    if not v_livre and l.dono_id is distinct from auth.uid() then
      raise exception 'sem permissão' using errcode = '42501';
    end if;
  end if;
  v_anuncio := jsonb_build_object('campanha', l.campaign_name, 'conjunto', l.adset_name, 'anuncio', l.ad_name,
                                  'formulario', l.form_name, 'plataforma', l.platform, 'organico', l.is_organic);
  if v_livre and not v_gestor then
    return jsonb_build_object('anuncio', v_anuncio, 'resumo', null, 'eventos',
      jsonb_build_array(jsonb_build_object('em', l.criado_em_lead, 'tipo', 'chegou', 'titulo', 'Lead chegou', 'detalhe', l.campaign_name, 'quem', null)));
  end if;
  select * into i from public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead);
  select coalesce(jsonb_agg(to_jsonb(e) order by e.em desc), '[]'::jsonb) into v_ev from (
    select l.criado_em_lead as em, 'chegou'::text as tipo, 'Lead chegou'::text as titulo, l.campaign_name as detalhe, null::text as quem
    union all
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then 'Passou para ' || coalesce(h.depois ->> 'consultor', '') else 'Devolveu aos Livres' end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '') end, p.nome
      from public.leads_historico h left join public.profiles p on p.id = h.por
     where h.lead_aba = l.aba and h.lead_id = l.id
    union all
    select c.em, 'clique', case c.canal when 'whatsapp' then 'Abriu o WhatsApp' when 'ligar' then 'Clicou em Ligar' else 'Contato registrado' end, null, p.nome
      from public.leads_contatos c left join public.profiles p on p.id = c.profile_id
     where c.lead_aba = l.aba and c.lead_id = l.id
    union all
    select m.gerada_em, 'ligacao', case when m.atendida then 'Ligação atendida' else 'Ligação não atendida' end,
           nullif(concat_ws(' · ', case when coalesce(m.seg_falados, 0) > 0 then (m.seg_falados / 60) || ' min ' || (m.seg_falados % 60) || ' s' end, nullif(m.tabulacao, '')), ''),
           m.usuario
      from public.ligacoes_manuais m
     where public.chave_tel(l.phone_number) is not null and m.chave_tel = public.chave_tel(l.phone_number)
       and m.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select d.gerada_em, 'discador', case when d.status = 'ANSWERED' then 'Discador: atendida' else 'Discador: ' || lower(coalesce(d.status, '')) end,
           case when coalesce(d.seg_falados, 0) > 0 then (d.seg_falados / 60) || ' min ' || (d.seg_falados % 60) || ' s' end, null
      from public.discador_chamadas d
     where length(regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g')) = 14
       and d.cnpj = regexp_replace(l.cnpj, '[^0-9]', '', 'g') and d.gerada_em >= l.criado_em_lead - interval '1 hour'
    union all
    select a.criado_em, 'retorno', case a.status when 'pendente' then 'Retorno agendado' when 'feito' then 'Retorno feito' else 'Retorno cancelado' end,
           to_char(a.quando at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), null
      from public.agenda_retornos a where a.lead_aba = l.aba and a.lead_id = l.id
  ) e where e.em is not null;
  return jsonb_build_object('anuncio', v_anuncio,
    'resumo', jsonb_build_object('ligacoes', i.ligacoes, 'atendidas', i.atendidas, 'cliques', i.cliques, 'ultimo', i.ultimo),
    'eventos', v_ev);
end $$;

-- Pesquisa: dígitos (8+) procuram CNPJ e telefone; texto procura no nome. Consultor: os dele e os Livres (Livre sem número).
create or replace function public.leads_buscar(p_texto text)
returns table(aba text, lead_id text, nome text, cidade text, uf text, status text, categoria text, dono_nome text,
              livre boolean, cnpj text, telefone text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor');
        v_dig text := regexp_replace(coalesce(p_texto, ''), '[^0-9]', '', 'g');
        v_txt text := public.norm_nome(p_texto);
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_texto, ''))) < 3 then return; end if;
  return query
  select l.aba, l.id, l.full_name, l.city, l.state, l.status, l.categoria, p.nome,
         (l.dono_id is null and l.categoria = 'sem_contato'),
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.cnpj end,
         case when l.dono_id is null and l.categoria = 'sem_contato' and not v_gestor then null else l.phone_number end
    from public.leads l left join public.profiles p on p.id = l.dono_id
   where coalesce(l.aba, '') <> 'REPIQUE'
     and (v_gestor or l.dono_id = auth.uid() or (l.dono_id is null and l.categoria = 'sem_contato'))
     and case when length(v_dig) >= 8
              then regexp_replace(coalesce(l.cnpj, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
                or regexp_replace(coalesce(l.phone_number, ''), '[^0-9]', '', 'g') like '%' || v_dig || '%'
              else public.norm_nome(l.full_name) like '%' || v_txt || '%' end
   order by l.criado_em_lead desc nulls last
   limit 20;
end $$;
revoke execute on function public.leads_ficha_detalhes(text, text) from public, anon;
revoke execute on function public.leads_buscar(text) from public, anon;
grant execute on function public.leads_ficha_detalhes(text, text) to authenticated;
grant execute on function public.leads_buscar(text) to authenticated;
commit;
```

- [ ] **Step 4: Com o ok do Rafael, aplicar a migration e rodar o check.** Esperado: `CHECK OK`, depois ROLLBACK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261027100000_leads_hoje_base.sql supabase/tests/leads_hoje_check.sql
git commit -m "feat(leads): contato do lead, ficha detalhada e pesquisa (secao 118)"
```

---

### Task 2: Banco — alertas, equipe, hoje e retorno na Agenda

**Files:**
- Create: `supabase/migrations/20261027100100_leads_hoje_alertas.sql`
- Modify: `supabase/tests/leads_hoje_check.sql` (bloco Task 2)

**Interfaces:**
- Consumes: `leads_contato_info` (Task 1), `agenda_retornos.lead_aba/lead_id`.
- Produces:
  - `leads_expediente_hoje() → table(aberto boolean, inicio timestamptz)` (interna);
  - `leads_alertas(p_dono uuid default null) → table(tipo, aba, lead_id, nome, dono_id, dono_nome, desde)`;
  - `leads_equipe_resumo() → table(dono_id, nome, em_aberto, sem_contato, retornos_vencidos, parados, perdas_suspeitas, pegos_mes, convertidos_mes, receita_mes, tempo_medio_1o_contato_min)`;
  - `leads_hoje(p_dono uuid default null) → jsonb {fila:[{aba,lead_id,nome,motivo,desde}], retornos:[{aba,lead_id,nome,quando,vencido}], livres:int}`;
  - `leads_agendar_retorno(p_aba, p_id, p_quando timestamptz) → void`;
  - `leads_classificar` e `leads_redistribuir` com a mesma assinatura, agora mexendo na Agenda.

- [ ] **Step 1: Teste de banco** (no `do $$` do check, antes de `-- ===== mais testes entram aqui =====`)

```sql
  -- ===== Task 2 =====
  update public.config set valor = '{"seg_sex":["00:00","23:59"],"sabado":null}' where chave = 'velocidade_lead';
  -- expediente "o dia inteiro" só em dia útil; no fim de semana o alerta sem_contato não existe por regra
  insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, categoria, converteu, receita, dono_id, pego_em, status, classificado_em) values
  ('JUNHO', 'zh:novo',  now() - interval '1 hour', 'Zz Novo Sem Contato', '11900000041', null, 'sem_contato', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '40 minutes', null, null),
  ('JUNHO', 'zh:perd',  now() - interval '2 hours', 'Zz Perdido Sem Ligacao', '11900000042', null, 'perdido', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours', 'CNPJ INAPTO', now()),
  ('JUNHO', 'zh:conv',  now() - interval '2 hours', 'Zz Convertido', '11900000043', null, 'convertido', true, 500, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours', 'PEDIDO CONCLUIDO (VENDA)', now());
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  if extract(isodow from now() at time zone 'America/Sao_Paulo') between 1 and 5 then
    assert exists (select 1 from public.leads_alertas() where tipo = 'sem_contato' and lead_id = 'zh:novo'), 'alerta: pego sem contato há 40 min';
  end if;
  assert exists (select 1 from public.leads_alertas() where tipo = 'parado' and lead_id = 'zh:semtel'), 'alerta: em andamento parado há 5 dias (lead sem telefone)';
  assert not exists (select 1 from public.leads_alertas() where tipo = 'perda_suspeita'), 'perda suspeita é só do gestor';
  assert not exists (select 1 from public.leads_alertas() where lead_id = 'zh:outro'), 'consultor não vê alerta de outro';
  -- retorno: agendar, vencer, aparecer na fila e no alerta; reclassificar fecha
  perform public.leads_agendar_retorno('JUNHO', 'zh:semtel', now() - interval '10 minutes');
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 1, 'agendar cria 1 retorno pendente';
  perform public.leads_agendar_retorno('JUNHO', 'zh:semtel', now() - interval '5 minutes');
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 1, 'agendar de novo atualiza (não duplica)';
  assert exists (select 1 from public.leads_alertas() where tipo = 'retorno_vencido' and lead_id = 'zh:semtel'), 'alerta: retorno vencido';
  assert (select count(*) from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'zh:semtel') = 1, 'lead em dois motivos aparece 1 vez na fila (Review Focus 3)';
  assert (select f->>'motivo' from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'zh:semtel') = 'Retorno vencido', 'fica o motivo de maior prioridade';
  assert ((public.leads_hoje() -> 'fila') -> 0 ->> 'lead_id') = 'zh:novo', 'novo sem contato vem primeiro';
  assert jsonb_array_length(public.leads_hoje() -> 'retornos') = 1, 'retornos de hoje';
  perform public.leads_classificar('JUNHO', 'zh:semtel', 'CNPJ INAPTO', null, false, null, null);
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 0, 'reclassificar fecha o retorno (Review Focus 5)';
  perform public.leads_classificar('JUNHO', 'zh:meu', 'AGENDADO RETORNO', null, false, null, (now() at time zone 'America/Sao_Paulo')::date + 1);
  assert (select to_char(quando at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' from public.agenda_retornos where lead_id = 'zh:meu' and status = 'pendente'), 'AGENDADO RETORNO cria retorno às 10:00';
  -- gestor: perda suspeita, resumo da equipe, redistribuir leva o retorno
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e402', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e402', true);
  assert exists (select 1 from public.leads_alertas(null) where tipo = 'perda_suspeita' and lead_id = 'zh:perd'), 'gestor vê perda suspeita';
  assert (select convertidos_mes = 1 and receita_mes = 500 and em_aberto >= 2 from public.leads_equipe_resumo() where dono_id = '00000000-0000-0000-0000-00000000e403'), 'resumo da equipe';
  perform public.leads_redistribuir('JUNHO', 'zh:meu', '00000000-0000-0000-0000-00000000e404');
  assert (select consultor_id = '00000000-0000-0000-0000-00000000e404' from public.agenda_retornos where lead_id = 'zh:meu' and status = 'pendente'), 'redistribuir leva o retorno';
  execute 'reset role';
  -- fora do expediente: sem alerta sem_contato (Review Focus 2)
  update public.config set valor = '{"seg_sex":["00:00","00:01"],"sabado":null}' where chave = 'velocidade_lead';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  assert not exists (select 1 from public.leads_alertas() where tipo = 'sem_contato'), 'fora do expediente não alerta sem contato';
  execute 'reset role';
```

- [ ] **Step 2: Rodar o check (precisa falhar).** Esperado: ERRO "function public.leads_alertas() does not exist".

- [ ] **Step 3: Migration `supabase/migrations/20261027100100_leads_hoje_alertas.sql`**

```sql
-- §118 Meus leads: Hoje / Quadro / Equipe — parte 2: expediente, alertas, resumo da equipe, fila do dia e retorno na Agenda.
begin;
-- Expediente de hoje (seg–sex de config.velocidade_lead, horário de SP): está aberto agora? e a hora em que abriu hoje.
create or replace function public.leads_expediente_hoje() returns table(aberto boolean, inicio timestamptz)
language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce((select valor::jsonb from public.config where chave = 'velocidade_lead'), '{}'::jsonb) j),
       h as (select (now() at time zone 'America/Sao_Paulo') agora,
                    coalesce(j -> 'seg_sex' ->> 0, '11:00')::time ini, coalesce(j -> 'seg_sex' ->> 1, '21:00')::time fim from cfg)
  select extract(isodow from agora) between 1 and 5 and agora::time >= ini and agora::time < fim,
         (agora::date + ini) at time zone 'America/Sao_Paulo'
    from h;
$$;
revoke all on function public.leads_expediente_hoje() from public, anon, authenticated;

-- Alertas (§118, 5.4). Consultor: os dele (sem perda suspeita). Gestor: do dono pedido ou de todos.
create or replace function public.leads_alertas(p_dono uuid default null)
returns table(tipo text, aba text, lead_id text, nome text, dono_id uuid, dono_nome text, desde timestamptz)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_cfg jsonb;
        v_min int; v_parado int; v_ini_mes timestamptz; v_aberto boolean; v_inicio timestamptz;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
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
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE'
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
    union all
    select 'perda_suspeita', b.l_aba, b.l_id, b.l_nome, b.l_dono, coalesce(b.l_class, b.l_criado) from base b
     where v_gestor and b.l_cat = 'perdido' and b.l_lig = 0
    union all
    select 'retorno_vencido', b.l_aba, b.l_id, b.l_nome, b.l_dono, a.quando from base b
      join public.agenda_retornos a on a.lead_aba = b.l_aba and a.lead_id = b.l_id and a.status = 'pendente'
     where a.quando < now() and (b.l_ult is null or b.l_ult < a.quando)
  )
  select al.a_tipo, al.l_aba, al.l_id, al.l_nome, al.l_dono, p.nome, al.a_desde
    from al left join public.profiles p on p.id = al.l_dono
   order by al.a_desde;
end $$;

-- Resumo da equipe (aba Equipe) — só gestor.
create or replace function public.leads_equipe_resumo()
returns table(dono_id uuid, nome text, em_aberto int, sem_contato int, retornos_vencidos int, parados int, perdas_suspeitas int,
              pegos_mes int, convertidos_mes int, receita_mes numeric, tempo_medio_1o_contato_min numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_ini_mes timestamptz; v_ini_dia timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with a as (select x.tipo as a_tipo, x.dono_id as a_dono from public.leads_alertas(null) x),
       eq as (select e.profile_id as e_id, p.nome as e_nome from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null),
       ls as (select l.dono_id as s_dono, l.categoria as s_cat, l.pego_em as s_pego, coalesce(l.classificado_em, l.criado_em_lead) as s_quando, l.receita as s_rec
                from public.leads l where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE'),
       hoje as (select l.dono_id as h_dono, extract(epoch from (i.primeiro - l.pego_em)) / 60 as h_min
                  from public.leads l
                  cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
                 where l.pego_em >= v_ini_dia and i.primeiro is not null and i.primeiro >= l.pego_em)
  select eq.e_id, eq.e_nome,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_cat in ('sem_contato', 'andamento'))::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'sem_contato')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'retorno_vencido')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'parado')::int,
         (select count(*) from a where a.a_dono = eq.e_id and a.a_tipo = 'perda_suspeita')::int,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_pego >= v_ini_mes)::int,
         (select count(*) from ls where ls.s_dono = eq.e_id and ls.s_cat = 'convertido' and ls.s_quando >= v_ini_mes)::int,
         (select coalesce(sum(ls.s_rec), 0) from ls where ls.s_dono = eq.e_id and ls.s_cat = 'convertido' and ls.s_quando >= v_ini_mes),
         (select round(avg(hoje.h_min)::numeric, 1) from hoje where hoje.h_dono = eq.e_id)
    from eq order by eq.e_nome;
end $$;

-- Retorno na Agenda ligado ao lead (interna): atualiza o pendente do lead ou cria um, para o dono.
create or replace function public.leads_agenda_lead(p_aba text, p_id text, p_quando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where aba = p_aba and id = p_id;
  if not found or l.dono_id is null then return; end if;
  update public.agenda_retornos set quando = p_quando, consultor_id = l.dono_id, atualizado_em = now()
   where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  if not found then
    insert into public.agenda_retornos (consultor_id, nome, telefone, chave_tel, quando, tipo, observacao, origem, status, lead_aba, lead_id)
    values (l.dono_id, l.full_name, l.phone_number, public.chave_tel(l.phone_number), p_quando, 'ligacao', l.obs, 'lead', 'pendente', p_aba, p_id);
  end if;
  update public.leads set retorno_em = (p_quando at time zone 'America/Sao_Paulo')::date where aba = p_aba and id = p_id;
end $$;
revoke all on function public.leads_agenda_lead(text, text, timestamptz) from public, anon, authenticated;

create or replace function public.leads_agendar_retorno(p_aba text, p_id text, p_quando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_dono uuid;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select dono_id into v_dono from public.leads where aba = p_aba and id = p_id;
  if not found then raise exception 'lead não encontrado' using errcode = 'P0002'; end if;
  if v_dono is null then raise exception 'pegue o lead antes de agendar' using errcode = '22023'; end if;
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') and v_dono is distinct from auth.uid() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_quando is null then raise exception 'informe a data e a hora' using errcode = '22023'; end if;
  perform public.leads_agenda_lead(p_aba, p_id, p_quando);
end $$;
revoke execute on function public.leads_agendar_retorno(text, text, timestamptz) from public, anon;
grant execute on function public.leads_agendar_retorno(text, text, timestamptz) to authenticated;
commit;
```

Parte 2 da mesma migration (enviar separada, por causa do tamanho):

```sql
begin;
-- Fila do dia + retornos de hoje (aba Hoje). Consultor: os dele; gestor: o dono pedido ou todos.
create or replace function public.leads_hoje(p_dono uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestor boolean := coalesce(public.get_my_role(), '') in ('admin', 'supervisor'); v_alvo uuid; v_esf int;
        v_ini_mes timestamptz; v_fim_dia timestamptz; v_out jsonb;
begin
  if not v_gestor and not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_alvo := case when v_gestor then p_dono else auth.uid() end;
  v_esf := coalesce(((select valor::jsonb from public.config where chave = 'leads_alertas') ->> 'esfriando_dias')::int, 2);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_fim_dia := (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo';
  with base as (
    select l.aba as b_aba, l.id as b_id, l.full_name as b_nome, l.categoria as b_cat, l.pego_em as b_pego, l.criado_em_lead as b_criado,
           l.classificado_em as b_class, l.status as b_status, i.ultimo as b_ult
      from public.leads l
      cross join lateral public.leads_contato_info(l.aba, l.id, l.phone_number, l.cnpj, l.criado_em_lead) i
     where l.dono_id is not null and coalesce(l.aba, '') <> 'REPIQUE' and (v_alvo is null or l.dono_id = v_alvo)
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
    union all
    select 4, b.b_aba, b.b_id, b.b_nome, 'Para resgatar', coalesce(b.b_ult, b.b_class, b.b_criado) from base b
     where b.b_cat = 'perdido' and coalesce(b.b_ult, b.b_class, b.b_criado) < now() - make_interval(days => v_esf)
  ), unica as (
    select distinct on (f.b_aba, f.b_id) f.* from fila f order by f.b_aba, f.b_id, f.prio
  )
  select jsonb_build_object(
    'fila', coalesce((select jsonb_agg(jsonb_build_object('aba', u.b_aba, 'lead_id', u.b_id, 'nome', u.b_nome, 'motivo', u.motivo, 'desde', u.desde)
                                       order by u.prio, u.desde) from unica u), '[]'::jsonb),
    'retornos', coalesce((select jsonb_agg(jsonb_build_object('aba', r.r_aba, 'lead_id', r.r_id, 'nome', l.full_name, 'quando', r.r_quando,
                                                             'vencido', r.r_quando <= now()) order by r.r_quando)
                            from ret r join public.leads l on l.aba = r.r_aba and l.id = r.r_id where r.r_quando < v_fim_dia), '[]'::jsonb),
    'livres', (select count(*) from public.leads l where l.dono_id is null and l.categoria = 'sem_contato'
                 and coalesce(l.aba, '') <> 'REPIQUE' and l.criado_em_lead >= now() - interval '60 days'))
  into v_out;
  return v_out;
end $$;
revoke execute on function public.leads_alertas(uuid) from public, anon;
revoke execute on function public.leads_equipe_resumo() from public, anon;
revoke execute on function public.leads_hoje(uuid) from public, anon;
grant execute on function public.leads_alertas(uuid) to authenticated;
grant execute on function public.leads_equipe_resumo() to authenticated;
grant execute on function public.leads_hoje(uuid) to authenticated;
commit;
```

Parte 3: `leads_classificar` e `leads_redistribuir` com a mesma assinatura e o corpo da migration `20261026120100`, mais a Agenda. Aplicar com `create or replace`:
- **`leads_classificar`**, logo antes de `perform public.leads_espelho_enfileirar(p_aba, p_id);`:
```sql
  if p_status = 'AGENDADO RETORNO' then
    perform public.leads_agenda_lead(p_aba, p_id, (p_retorno + time '10:00') at time zone 'America/Sao_Paulo');
  else
    update public.agenda_retornos set status = 'feito', feito_em = now(), atualizado_em = now()
     where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  end if;
```
- **`leads_redistribuir`**, logo antes de `perform public.leads_espelho_enfileirar(p_aba, p_id);`:
```sql
  if p_novo is null then
    update public.agenda_retornos set status = 'cancelado', atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  else
    update public.agenda_retornos set consultor_id = p_novo, atualizado_em = now() where lead_aba = p_aba and lead_id = p_id and status = 'pendente';
  end if;
```
O arquivo `20261027100100_leads_hoje_alertas.sql` leva as três partes, e as duas funções inteiras já com as linhas novas.

- [ ] **Step 4: Com o ok do Rafael, aplicar as três partes e rodar o check.** Esperado: `CHECK OK`, depois ROLLBACK.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261027100100_leads_hoje_alertas.sql supabase/tests/leads_hoje_check.sql
git commit -m "feat(leads): alertas, equipe, fila do dia e retorno na Agenda (secao 118)"
```

---

### Task 3: Painel — funções puras das abas novas

**Files:**
- Modify: `_template.html` (bloco `kb*`, depois de `kbResumoMes`)
- Create: `test_leads_hoje.js`

**Interfaces:**
- Produces:
  ```js
  KB_ABAS = ['hoje', 'quadro', 'equipe']
  kbAbasDoPerfil(gestor) → ['hoje','quadro'] | ['hoje','quadro','equipe']
  kbAbaPadrao(gestor) → 'equipe' | 'hoje'
  kbProximoDaFila(fila, excecoes /* {chave: ms} */, agoraMs) → item | null   // pula exceção < 2 min
  kbSemaforo(linha) → 'vermelho' | 'amarelo' | 'verde'
  kbConversao(linha) → '—' | 'NN%'
  kbResumoContatoTexto(resumo, agoraMs) → string
  kbLinhaTempoHtml(eventos, limite) → string
  kbBuscaValida(texto) → boolean
  kbAlertaTexto(a) → string
  kbAlertasParaNotificar(alertas, jaNotificados /* Set */) → alertas[]
  kbQuandoSP(dataIso, hora) → ISO '-03:00'
  ```

- [ ] **Step 1: Criar `test_leads_hoje.js`** (harness igual ao do `test_leads_kanban.js`, mais estes casos)

```js
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro'], 'consultor: Hoje e Quadro');
  eq(kbAbasDoPerfil(true), ['hoje', 'quadro', 'equipe'], 'gestor: + Equipe');
  eq([kbAbaPadrao(false), kbAbaPadrao(true)], ['hoje', 'equipe'], 'aba padrão por perfil');
  const fila = [{ aba: 'OUTUBRO', lead_id: 'a', motivo: 'Novo sem contato' }, { aba: 'OUTUBRO', lead_id: 'b', motivo: 'Esfriando' }];
  const agora = Date.parse('2026-10-27T15:00:00Z');
  eq(kbProximoDaFila(fila, {}, agora).lead_id, 'a', 'próximo = primeiro da fila');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 60000 }, agora).lead_id, 'b', 'aberto há 1 min é pulado');
  eq(kbProximoDaFila(fila, { 'OUTUBRO|a': agora - 180000 }, agora).lead_id, 'a', 'exceção vence em 2 min');
  eq(kbProximoDaFila([], {}, agora), null, 'fila vazia');
  eq(kbSemaforo({ sem_contato: 1, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: novo sem contato');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 2, parados: 0, perdas_suspeitas: 0 }), 'vermelho', 'semáforo vermelho: retorno vencido');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 1, perdas_suspeitas: 0 }), 'amarelo', 'semáforo amarelo: parado');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 3 }), 'amarelo', 'semáforo amarelo: perda suspeita');
  eq(kbSemaforo({ sem_contato: 0, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0 }), 'verde', 'semáforo verde');
  eq([kbConversao({ pegos_mes: 0, convertidos_mes: 0 }), kbConversao({ pegos_mes: 40, convertidos_mes: 10 })], ['—', '25%'], 'conversão');
  eq(kbResumoContatoTexto({ ligacoes: 5, atendidas: 2, cliques: 1, ultimo: '2026-10-27T12:00:00Z' }, agora), '5 tentativas · 2 atendidas · última há 3 h', 'resumo de contato');
  eq(kbResumoContatoTexto({ ligacoes: 1, atendidas: 0, cliques: 0, ultimo: '2026-10-27T14:58:00Z' }, agora), '1 tentativa · 0 atendidas · última há 2 min', 'singular');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 2, ultimo: '2026-10-27T14:00:00Z' }, agora), 'Nenhuma ligação ainda · 2 cliques no painel', 'só cliques');
  eq(kbResumoContatoTexto({ ligacoes: 0, atendidas: 0, cliques: 0, ultimo: null }, agora), 'Nenhuma ligação ainda', 'nada');
  eq(kbResumoContatoTexto(null, agora), '', 'sem resumo (Livre)');
  const ev = Array.from({ length: 35 }, (_, i) => ({ em: new Date(agora - i * 60000).toISOString(), tipo: i % 2 ? 'ligacao' : 'clique', titulo: 'Evento ' + i, detalhe: i === 0 ? '<b>x</b>' : null, quem: 'Zz' }));
  const lt = kbLinhaTempoHtml(ev, 30);
  assert((lt.match(/class="kbEv /g) || []).length === 30 && lt.includes('data-kb-ver-tudo'), 'linha do tempo: 30 eventos e "ver tudo"');
  assert(!lt.includes('<b>x</b>') && lt.includes('&lt;b&gt;'), 'linha do tempo escapa HTML');
  assert(!kbLinhaTempoHtml(ev.slice(0, 3), 30).includes('data-kb-ver-tudo'), 'sem "ver tudo" com poucos eventos');
  eq([kbBuscaValida('ab'), kbBuscaValida(' abc '), kbBuscaValida('')], [false, true, false], 'busca a partir de 3 caracteres');
  eq(kbAlertaTexto({ tipo: 'sem_contato' }), 'Pego e sem contato', 'texto do alerta');
  const al = [{ tipo: 'sem_contato', aba: 'O', lead_id: '1' }, { tipo: 'parado', aba: 'O', lead_id: '2' }, { tipo: 'sem_contato', aba: 'O', lead_id: '3' }];
  eq(kbAlertasParaNotificar(al, new Set(['O|3'])).map(a => a.lead_id), ['1'], 'notifica só sem_contato ainda não notificado');
  eq(kbQuandoSP('2026-10-28', '14:30'), '2026-10-28T14:30:00-03:00', 'data + hora em SP');
  eq(kbQuandoSP('2026-10-28', ''), '2026-10-28T10:00:00-03:00', 'hora padrão 10:00');
```

- [ ] **Step 2: Rodar.** `python build_painel.py >/dev/null && node test_leads_hoje.js`. Esperado: `FALHA: ReferenceError: kbAbasDoPerfil is not defined`.

- [ ] **Step 3: Implementar** (no `_template.html`, depois de `kbResumoMes`)

```js
// §118 (27/10): abas Hoje / Quadro / Equipe, próximo lead, semáforo, linha do tempo e alertas — funções puras.
const KB_ABAS = ['hoje', 'quadro', 'equipe'];
const KB_ABA_TITULOS = { hoje: 'Hoje', quadro: 'Quadro', equipe: 'Equipe' };
function kbAbasDoPerfil(gestor){ return gestor ? KB_ABAS.slice() : ['hoje', 'quadro']; }
function kbAbaPadrao(gestor){ return gestor ? 'equipe' : 'hoje'; }
const KB_EXCECAO_MS = 2 * 60000;
function kbProximoDaFila(fila, excecoes, agoraMs){
  return (fila || []).find(f => { const t = (excecoes || {})[f.aba + '|' + f.lead_id]; return !t || agoraMs - t >= KB_EXCECAO_MS; }) || null;
}
function kbSemaforo(l){
  if((l.sem_contato || 0) > 0 || (l.retornos_vencidos || 0) > 0) return 'vermelho';
  if((l.parados || 0) > 0 || (l.perdas_suspeitas || 0) > 0) return 'amarelo';
  return 'verde';
}
function kbConversao(l){ return l.pegos_mes ? Math.round(100 * (l.convertidos_mes || 0) / l.pegos_mes) + '%' : '—'; }
function kbResumoContatoTexto(r, agoraMs){
  if(!r) return '';
  if(!r.ligacoes) return r.cliques ? `Nenhuma ligação ainda · ${r.cliques} clique${r.cliques === 1 ? '' : 's'} no painel` : 'Nenhuma ligação ainda';
  return `${r.ligacoes} tentativa${r.ligacoes === 1 ? '' : 's'} · ${r.atendidas} atendida${r.atendidas === 1 ? '' : 's'} · última ${kbTempoDesde(r.ultimo, agoraMs)}`;
}
const KB_EV_ICONE = { chegou: '●', pegar: '✋', classificar: '✎', redistribuir: '⇄', devolver: '↩', clique: '☝', ligacao: '☎', discador: '☎', retorno: '⏰' };
function kbLinhaTempoHtml(eventos, limite){
  const lista = (eventos || []).slice(0, limite || 30);
  const itens = lista.map(e => `<li class="kbEv kbEv-${escapeHtml(e.tipo || '')}"><span class="kbEvIco">${KB_EV_ICONE[e.tipo] || '•'}</span><div><strong>${escapeHtml(e.titulo || '')}</strong>${e.detalhe ? `<span> · ${escapeHtml(e.detalhe)}</span>` : ''}<div class="kbMeta">${escapeHtml(kbDataHoraBR(e.em))}${e.quem ? ' · ' + escapeHtml(e.quem) : ''}</div></div></li>`).join('');
  const mais = (eventos || []).length > lista.length ? `<button type="button" class="kbLink" data-kb-ver-tudo>Ver tudo (${eventos.length})</button>` : '';
  return `<ul class="kbLinhaTempo">${itens}</ul>${mais}`;
}
function kbBuscaValida(t){ return String(t || '').trim().length >= 3; }
const KB_ALERTA_TEXTO = { sem_contato: 'Pego e sem contato', retorno_vencido: 'Retorno vencido', parado: 'Parado em andamento', perda_suspeita: 'Perdido sem nenhuma ligação' };
function kbAlertaTexto(a){ return KB_ALERTA_TEXTO[a.tipo] || a.tipo; }
function kbAlertasParaNotificar(alertas, ja){ return (alertas || []).filter(a => a.tipo === 'sem_contato' && !ja.has(a.aba + '|' + a.lead_id)); }
function kbQuandoSP(dataIso, hora){ return `${dataIso}T${/^\d{2}:\d{2}$/.test(hora || '') ? hora : '10:00'}:00-03:00`; }
```

- [ ] **Step 4: Rodar e ver passar**, depois `bash run_tests.sh`.

- [ ] **Step 5: Commit** `feat(meus-leads): funcoes puras de Hoje, Equipe, linha do tempo e alertas (secao 118)`

---

### Task 4: Painel — abas, pesquisa, Hoje, Equipe, ficha detalhada, retorno com hora e alertas

**Files:**
- Modify: `_template.html`:
  - painel `#panel-meusleads`: pesquisa, pílulas das abas e seções `#kbHoje`/`#kbEquipe`;
  - modal Classificar: campo de hora;
  - ficha: `#kbFichaDetalhes`;
  - JS `kb*`;
  - `kbStyles`;
  - Agenda: `alCarregarProximos` passa a trazer `lead_aba`/`lead_id`, e `alAoClicar` abre a ficha do lead.
- Modify: `test_leads_hoje.js` (fluxos de tela)

**Interfaces:**
- Consumes: as RPCs das Tasks 1 e 2 e as funções puras da Task 3.
- Produces:
  - `kbEstado.aba`, `kbEstado.excecoes`, `kbEstado.notificados`;
  - `kbTrocarAba(aba)`, `kbCarregarHoje()`, `kbCarregarEquipe()`, `kbCarregarAlertas(notificar)`, `kbBuscar(texto)`, `kbProximo()`, `kbCarregarDetalhes(aba, id)`.

- [ ] **Step 1: Testes de tela** (em `test_leads_hoje.js`)

```js
  // consultor: abas, Hoje com fila e retornos, próximo lead abre ficha e entra na exceção
  currentUser = { id: 'u-zz', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-zz', nome_planilha: 'ZZKCON' }];
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_status_opcoes = [{ status: 'AGENDADO RETORNO', grupo: 'andamento', ordem: 2 }, { status: 'CNPJ INAPTO', grupo: 'perdido', ordem: 24 }];
  window.__rpcRespostas.leads_kanban = { data: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'sem_contato', livre: false, criado_em_lead: new Date().toISOString() }], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', motivo: 'Novo sem contato', desde: new Date().toISOString() }],
    retornos: [{ aba: 'OUTUBRO', lead_id: 'h2', nome: 'Zz Retorno', quando: new Date(Date.now() - 600000).toISOString(), vencido: true }], livres: 3 }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', dono_nome: 'Zzkcon Teste', desde: new Date().toISOString() }], error: null };
  window.__rpcRespostas.leads_ficha = { data: [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', livre: false, categoria: 'sem_contato', telefone: '11900000001' }], error: null };
  window.__rpcRespostas.leads_ficha_detalhes = { data: { anuncio: { campanha: 'Zz Camp', conjunto: 'Zz Conj', anuncio: null, formulario: 'Zz Form', plataforma: 'fb', organico: false },
    resumo: { ligacoes: 2, atendidas: 1, cliques: 0, ultimo: new Date(Date.now() - 3600000).toISOString() },
    eventos: [{ em: new Date().toISOString(), tipo: 'ligacao', titulo: 'Ligação atendida', detalhe: '2 min 5 s', quem: 'zz.usuario' }] }, error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);   // Hoje e alertas carregam em segundo plano
  eq([...document.querySelectorAll('#kbAbas [data-kb-aba]')].filter(b => b.style.display !== 'none').map(b => b.dataset.kbAba), ['hoje', 'quadro'], 'consultor vê Hoje e Quadro');
  assert(document.getElementById('kbHoje').style.display !== 'none' && document.getElementById('kbBoard').style.display === 'none', 'consultor abre na aba Hoje');
  assert(document.getElementById('kbHoje').textContent.includes('Zz Retorno') && document.getElementById('kbHoje').textContent.includes('Pego e sem contato'), 'Hoje mostra retornos e alertas');
  document.querySelector('#kbHoje [data-kb-proximo]').click();
  await espera(60);
  assert(window.__rpcCalls.some(c => c.nome === 'leads_ficha' && c.args.p_id === 'h1'), 'Próximo lead abre a ficha do primeiro da fila');
  assert(kbEstado.excecoes['OUTUBRO|h1'] > 0, 'lead aberto entra na exceção de 2 min');
  assert(document.getElementById('kbFichaDetalhes').textContent.includes('2 tentativas') && document.getElementById('kbFichaDetalhes').textContent.includes('Zz Conj'), 'ficha mostra resumo, linha do tempo e anúncio');
  kbFecharFicha();
  // notificação uma vez por lead
  const antesNot = (window.__alertas || []).length;
  await kbCarregarAlertas(true); await kbCarregarAlertas(true);
  assert(kbEstado.notificados.has('OUTUBRO|h1') && document.getElementById('tabBtnMeusLeads').textContent.includes('1'), 'alerta urgente notificado e contador no menu');
  // pesquisa com espera de 300 ms
  window.__rpcRespostas.leads_buscar = { data: [{ aba: 'OUTUBRO', lead_id: 'b1', nome: 'Zz Achado', cidade: 'Campinas', uf: 'SP', status: null, categoria: 'sem_contato', dono_nome: null, livre: true }], error: null };
  const campo = document.getElementById('kbBusca');
  campo.value = 'zz'; campo.dispatchEvent(new window.Event('input'));
  await espera(350);
  assert(!window.__rpcCalls.some(c => c.nome === 'leads_buscar'), 'menos de 3 letras não busca');
  campo.value = 'zz ach'; campo.dispatchEvent(new window.Event('input'));
  await espera(350);
  assert(window.__rpcCalls.filter(c => c.nome === 'leads_buscar').length === 1 && document.getElementById('kbBuscaRes').textContent.includes('Zz Achado'), 'busca mostra resultado');
  // classificar AGENDADO RETORNO com hora chama leads_agendar_retorno
  window.__rpcRespostas.leads_classificar = { data: null, error: null };
  window.__rpcRespostas.leads_agendar_retorno = { data: null, error: null };
  kbEstado.leads = [{ aba: 'OUTUBRO', lead_id: 'h1', nome: 'Zz Hoje Um', categoria: 'sem_contato' }];
  kbAbrirClassificar('OUTUBRO', 'h1', null);
  document.getElementById('kbClassStatus').value = 'AGENDADO RETORNO';
  document.getElementById('kbClassStatus').dispatchEvent(new window.Event('change'));
  document.getElementById('kbClassRetorno').value = '2099-01-02';
  document.getElementById('kbClassHora').value = '14:30';
  await kbSalvarClassificacao();
  const ag = window.__rpcCalls.filter(c => c.nome === 'leads_agendar_retorno').pop();
  eq(ag && ag.args.p_quando, '2099-01-02T14:30:00-03:00', 'retorno com data e hora vai para a Agenda');
  // gestor: Equipe com semáforo; clicar na linha filtra o Quadro
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__rpcRespostas.leads_equipe_resumo = { data: [{ dono_id: 'u-zz', nome: 'Zzkcon Teste', em_aberto: 5, sem_contato: 1, retornos_vencidos: 0, parados: 0, perdas_suspeitas: 0, pegos_mes: 20, convertidos_mes: 5, receita_mes: 899.9, tempo_medio_1o_contato_min: 4.5 }], error: null };
  await kbAplicarPermissao();
  await kbCarregar();
  await espera(80);   // Equipe carrega em segundo plano
  assert(document.getElementById('kbEquipe').style.display !== 'none', 'gestor abre na aba Equipe');
  const linhaEq = document.querySelector('#kbEquipe tr[data-kb-dono="u-zz"]');
  assert(linhaEq && linhaEq.classList.contains('kbSem-vermelho') && linhaEq.textContent.includes('25%'), 'Equipe: semáforo e conversão');
  linhaEq.click();
  await espera(60);
  assert(kbEstado.aba === 'quadro' && kbEstado.dono === 'u-zz', 'clicar no consultor abre o Quadro filtrado');
```

- [ ] **Step 2: Rodar e ver falhar** (`ReferenceError`, ou falta de elementos).

- [ ] **Step 3: HTML**

  1. Dentro do `.kbTopo` de `#panel-meusleads`, logo depois do `<div class="kbResumo" id="kbResumo"></div>`, acrescentar:
```html
            <div class="kbBuscaBox"><input type="search" id="kbBusca" class="kbBusca" placeholder="Pesquisar por CNPJ, nome ou telefone…" autocomplete="off"><div class="kbBuscaRes" id="kbBuscaRes"></div></div>
```
  2. Logo depois do `</div>` que fecha o `.kbTopo`, e antes do `<div class="kbAviso"…>`:
```html
        <div class="filterPills kbAbas" id="kbAbas">
          <button type="button" class="filterPill" data-kb-aba="hoje">Hoje <span class="kbBadge" id="kbBadgeHoje"></span></button>
          <button type="button" class="filterPill" data-kb-aba="quadro">Quadro</button>
          <button type="button" class="filterPill" data-kb-aba="equipe">Equipe <span class="kbBadge" id="kbBadgeEquipe"></span></button>
        </div>
```
  3. Antes de `<div class="kbBoard" id="kbBoard"></div>`:
```html
      <div id="kbHoje" class="kbHoje" style="display:none"></div>
      <div id="kbEquipe" class="kbEquipe" style="display:none"></div>
```
  4. No modal Classificar, trocar o `<label class="field" id="kbClassRetornoBox" …>…</label>` por:
```html
        <div class="kbRetornoCampos" id="kbClassRetornoBox" style="display:none"><label class="field"><span>Data do retorno</span><input type="date" id="kbClassRetorno"></label><label class="field"><span>Hora</span><input type="time" id="kbClassHora" value="10:00"></label></div>
```
  5. No `kbFichaHtml`, logo antes de `<div class="kbFichaBotoes kbFichaAcoes">`, inserir `<div id="kbFichaDetalhes"></div>`.

- [ ] **Step 4: JS** (no bloco `kb*`, depois de `kbFecharFicha` e dos ouvintes da ficha)

```js
// ===== §118: abas, Hoje, Equipe, pesquisa, detalhes da ficha, alertas =====
kbEstado.aba = null; kbEstado.excecoes = {}; kbEstado.notificados = new Set(); kbEstado.alertas = []; kbEstado.hoje = null; kbEstado.equipe = [];
function kbTrocarAba(aba){
  const abas = kbAbasDoPerfil(kbGestor());
  kbEstado.aba = abas.includes(aba) ? aba : kbAbaPadrao(kbGestor());
  document.querySelectorAll('#kbAbas [data-kb-aba]').forEach(b => {
    b.style.display = abas.includes(b.dataset.kbAba) ? '' : 'none';
    b.classList.toggle('active', b.dataset.kbAba === kbEstado.aba);
  });
  document.getElementById('kbHoje').style.display = kbEstado.aba === 'hoje' ? '' : 'none';
  document.getElementById('kbBoard').style.display = kbEstado.aba === 'quadro' ? '' : 'none';
  document.getElementById('kbEquipe').style.display = kbEstado.aba === 'equipe' ? '' : 'none';
  if(kbEstado.aba === 'hoje') kbCarregarHoje();
  if(kbEstado.aba === 'equipe') kbCarregarEquipe();
}
async function kbCarregarHoje(){
  const r = await ppSeguro(() => sb.rpc('leads_hoje', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null }));
  kbEstado.hoje = r && !r.error ? r.data : null;
  kbRenderHoje();
}
function kbRenderHoje(){
  const h = kbEstado.hoje || { fila: [], retornos: [], livres: 0 };
  const prox = kbProximoDaFila(h.fila, kbEstado.excecoes, Date.now());
  const botao = prox
    ? `<button type="button" class="btn kbProximo" data-kb-proximo>Próximo lead ›</button><span class="kbMeta">${escapeHtml(prox.motivo)} · ${escapeHtml(prox.nome || '')} · ${h.fila.length} na fila</span>`
    : (h.livres ? `<button type="button" class="btn kbProximo" data-kb-pegar-proximo>Pegar o próximo livre ›</button><span class="kbMeta">${h.livres} livre(s) esperando</span>`
                : `<span class="kbMeta">Tudo em dia — nenhum lead esperando por você.</span>`);
  const hora = (iso) => kbDataHoraBR(iso).split(', ')[1] || kbDataHoraBR(iso);
  const retornos = (h.retornos || []).map(r => `<li class="${r.vencido ? 'kbVencido' : ''}"><span>${escapeHtml(hora(r.quando))}</span><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(r.aba)}|${escapeHtml(r.lead_id)}">${escapeHtml(r.nome || '')}</button>${r.vencido ? '<span class="kbMeta">vencido</span>' : ''}</li>`).join('') || '<li class="kbMeta">Nenhum retorno para hoje.</li>';
  const alertas = kbEstado.alertas.map(a => `<li><span class="kbAlertaTipo kbAl-${escapeHtml(a.tipo)}">${escapeHtml(kbAlertaTexto(a))}</span><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(a.aba)}|${escapeHtml(a.lead_id)}">${escapeHtml(a.nome || '')}</button>${kbGestor() && a.dono_nome ? `<span class="kbMeta">${escapeHtml(a.dono_nome)}</span>` : ''}</li>`).join('') || '<li class="kbMeta">Nenhum alerta.</li>';
  document.getElementById('kbHoje').innerHTML = `<div class="card kbProximoBox">${botao}</div>
    <div class="kbHojeGrade"><div class="card"><h4>Retornos de hoje</h4><ul class="kbLista">${retornos}</ul></div>
    <div class="card"><h4>Alertas</h4><ul class="kbLista">${alertas}</ul></div></div>`;
}
async function kbProximo(){
  const prox = kbProximoDaFila((kbEstado.hoje || {}).fila, kbEstado.excecoes, Date.now());
  if(!prox) return;
  kbEstado.excecoes[prox.aba + '|' + prox.lead_id] = Date.now();
  await kbAbrirFicha(prox.aba, prox.lead_id);
  kbRenderHoje();
}
async function kbPegarProximoLivre(){
  const livre = kbMontar(kbEstado.leads).livres.slice().sort((a, b) => (kbMs(a.criado_em_lead) || 0) - (kbMs(b.criado_em_lead) || 0))[0];
  if(!livre){ mostrarAviso('Nenhum lead livre agora.', 'info'); return; }
  await kbPegar(livre.aba, livre.lead_id);
  await kbAbrirFicha(livre.aba, livre.lead_id);
}
async function kbCarregarEquipe(){
  if(!kbGestor()) return;
  const [r] = await Promise.all([ppSeguro(() => sb.rpc('leads_equipe_resumo')), kbCarregarAlertas(false)]);
  kbEstado.equipe = r && !r.error ? r.data || [] : [];
  const linhas = kbEstado.equipe.map(l => `<tr class="kbSem-${kbSemaforo(l)}" data-kb-dono="${escapeHtml(l.dono_id)}">
      <td><span class="kbSemaforo"></span>${escapeHtml(l.nome)}</td><td>${l.em_aberto}</td><td>${l.sem_contato}</td><td>${l.retornos_vencidos}</td>
      <td>${l.parados}</td><td>${l.perdas_suspeitas}</td><td>${l.pegos_mes}</td><td>${l.convertidos_mes} · ${kbConversao(l)}</td>
      <td>${escapeHtml(kbMoeda(l.receita_mes) || 'R$ 0,00')}</td><td>${l.tempo_medio_1o_contato_min == null ? '—' : escapeHtml(String(l.tempo_medio_1o_contato_min).replace('.', ',')) + ' min'}</td></tr>`).join('');
  const alertas = kbEstado.alertas.map(a => `<li><span class="kbAlertaTipo kbAl-${escapeHtml(a.tipo)}">${escapeHtml(kbAlertaTexto(a))}</span><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(a.aba)}|${escapeHtml(a.lead_id)}">${escapeHtml(a.nome || '')}</button><span class="kbMeta">${escapeHtml(a.dono_nome || '')} · ${escapeHtml(kbTempoDesde(a.desde, Date.now()))}</span></li>`).join('') || '<li class="kbMeta">Nenhum alerta na equipe.</li>';
  document.getElementById('kbEquipe').innerHTML = `<div class="card"><table class="tbl kbTabelaEquipe"><thead><tr><th>Consultor</th><th>Em aberto</th><th>Sem contato +15 min</th><th>Retornos vencidos</th><th>Parados</th><th>Perdidos sem ligação</th><th>Pegos no mês</th><th>Vendas · conversão</th><th>Receita</th><th>1º contato (média hoje)</th></tr></thead><tbody>${linhas || '<tr><td colspan="10" class="kbMeta">Sem consultores na equipe de leads.</td></tr>'}</tbody></table></div>
    <div class="card"><h4>Alertas da equipe</h4><ul class="kbLista">${alertas}</ul></div>`;
}
async function kbCarregarAlertas(notificar){
  if(!kbPodeVer()) return;
  const r = await ppSeguro(() => sb.rpc('leads_alertas', { p_dono: kbGestor() && kbEstado.dono ? kbEstado.dono : null }));
  kbEstado.alertas = r && !r.error ? r.data || [] : [];
  const n = kbEstado.alertas.length;
  document.getElementById('kbBadgeHoje').textContent = n ? String(n) : '';
  document.getElementById('kbBadgeEquipe').textContent = kbGestor() && n ? String(n) : '';
  const lab = document.querySelector('#tabBtnMeusLeads .sbLabel');
  if(lab) lab.textContent = n ? `Meus leads (${n})` : 'Meus leads';
  if(notificar) kbAlertasParaNotificar(kbEstado.alertas, kbEstado.notificados).forEach(a => {
    kbEstado.notificados.add(a.aba + '|' + a.lead_id);
    const texto = `${kbAlertaTexto(a)}: ${a.nome || 'lead'}${kbGestor() && a.dono_nome ? ' (' + a.dono_nome + ')' : ''}`;
    mostrarAviso(texto, 'info');
    if('Notification' in window && Notification.permission === 'granted'){ try { const nt = new Notification('Meus leads', { body: texto, tag: 'lead-' + a.lead_id }); nt.onclick = () => { window.focus(); kbAbrirFicha(a.aba, a.lead_id); }; } catch(_e) {} }
    if(typeof alBip === 'function') try { alBip(); } catch(_e) {}
  });
  if(kbEstado.aba === 'hoje' && document.getElementById('kbHoje').innerHTML) kbRenderHoje();
}
async function kbCarregarDetalhes(aba, id){
  const el = document.getElementById('kbFichaDetalhes');
  if(!el) return;
  const r = await ppSeguro(() => sb.rpc('leads_ficha_detalhes', { p_aba: aba, p_id: id }));
  if(!kbEstado.fichaAlvo || kbEstado.fichaAlvo.id !== id) return;
  const d = r && !r.error ? r.data : null;
  if(!d){ el.innerHTML = ''; return; }
  kbEstado.fichaEventos = d.eventos || [];
  const an = d.anuncio || {};
  const linhaAn = (rot, v) => `<div class="kbFichaLinha"><span>${rot}</span><strong>${escapeHtml(v == null || v === '' ? '—' : String(v))}</strong><i></i></div>`;
  el.innerHTML = `<div class="kbFichaSecao"><h5>Contato e histórico</h5>${d.resumo ? `<p class="kbResumoContato">${escapeHtml(kbResumoContatoTexto(d.resumo, Date.now()))}</p>` : ''}<div id="kbLinhaTempo">${kbLinhaTempoHtml(kbEstado.fichaEventos, 30)}</div></div>
    <div class="kbFichaSecao"><h5>Detalhes do anúncio</h5>${linhaAn('Campanha', an.campanha)}${linhaAn('Conjunto', an.conjunto)}${linhaAn('Anúncio', an.anuncio)}${linhaAn('Formulário', an.formulario)}${linhaAn('Plataforma', an.plataforma)}${linhaAn('Orgânico', an.organico ? 'sim' : 'não')}</div>`;
}
let kbBuscaTimer = null;
async function kbBuscar(texto){
  const caixa = document.getElementById('kbBuscaRes');
  if(!kbBuscaValida(texto)){ caixa.innerHTML = ''; caixa.style.display = 'none'; return; }
  const r = await ppSeguro(() => sb.rpc('leads_buscar', { p_texto: texto.trim() }));
  const res = r && !r.error ? r.data || [] : [];
  caixa.style.display = '';
  caixa.innerHTML = res.length ? res.map(x => `<button type="button" class="kbBuscaItem" data-kb-abrir="${escapeHtml(x.aba)}|${escapeHtml(x.lead_id)}"><strong>${escapeHtml(x.nome || '(sem nome)')}</strong><span class="kbMeta">${escapeHtml([x.cidade, x.uf].filter(Boolean).join('/'))} · ${escapeHtml(x.status || (x.livre ? 'Livre' : 'Sem status'))}${x.dono_nome ? ' · ' + escapeHtml(x.dono_nome) : ''}</span></button>`).join('')
    : '<div class="kbMeta" style="padding:var(--space-2)">Nenhum lead encontrado.</div>';
}
document.getElementById('kbBusca').addEventListener('input', (e) => {
  clearTimeout(kbBuscaTimer);
  const v = e.target.value;
  kbBuscaTimer = setTimeout(() => kbBuscar(v), 300);
});
document.getElementById('kbAbas').addEventListener('click', (e) => { const b = e.target.closest('[data-kb-aba]'); if(b) kbTrocarAba(b.dataset.kbAba); });
document.getElementById('panel-meusleads').addEventListener('click', (e) => {
  const ab = e.target.closest('[data-kb-abrir]');
  if(ab){ const [aba, id] = ab.dataset.kbAbrir.split('|'); document.getElementById('kbBuscaRes').style.display = 'none'; kbAbrirFicha(aba, id); return; }
  if(e.target.closest('[data-kb-proximo]')){ kbProximo(); return; }
  if(e.target.closest('[data-kb-pegar-proximo]')){ kbPegarProximoLivre(); return; }
  const tr = e.target.closest('#kbEquipe tr[data-kb-dono]');
  if(tr){ kbEstado.dono = tr.dataset.kbDono; const sel = document.getElementById('kbDono'); if(sel) sel.value = kbEstado.dono; kbTrocarAba('quadro'); kbCarregar(); }
});
document.getElementById('kbFicha').addEventListener('click', (e) => {
  if(e.target.closest('[data-kb-ver-tudo]')){ const el = document.getElementById('kbLinhaTempo'); if(el) el.innerHTML = kbLinhaTempoHtml(kbEstado.fichaEventos, 1000); }
});
```

- [ ] **Step 5: Ligações nas funções existentes**
  - `kbAbrirFicha`: depois de `corpo.innerHTML = f ? kbFichaHtml(...)`, acrescentar `if(f) kbCarregarDetalhes(aba, id);`.
  - `kbCarregar`: depois de `kbRender();`, acrescentar `if(!kbEstado.aba) kbTrocarAba(kbAbaPadrao(kbGestor())); else if(kbEstado.aba !== 'quadro') kbTrocarAba(kbEstado.aba); kbCarregarAlertas(false);`.
  - `kbAplicarPermissao`: no começo, `kbEstado.aba = null;`.
  - `kbAgendar`: no `setInterval` de 10 s, um contador que a cada 6 voltas (60 s) chama `kbCarregarAlertas(true)`; e um `setInterval` separado de 120 s para `kbCarregarAlertas(true)` quando a aba não está ativa.
  - `kbClassAjustar`: mostrar `#kbClassRetornoBox` quando o status for AGENDADO RETORNO (o elemento agora é um `div`).
  - `kbSalvarClassificacao`: depois do `leads_classificar` dar certo e com status AGENDADO RETORNO, chamar `sb.rpc('leads_agendar_retorno', { p_aba, p_id, p_quando: kbQuandoSP(form.retorno, document.getElementById('kbClassHora').value) })`.
  - `kbRetornoRapido(id, dias)` passa a ser `kbRetornoRapido(aba, id, dias)`:
    - continua o `insert` em `leads_followups`;
    - acrescenta `leads_agendar_retorno` às 10:00 do dia;
    - quem chama (os ouvintes da ficha) passa a aba.
  - Agenda:
    - em `alCarregarProximos`, acrescentar `,lead_aba,lead_id` ao `select`;
    - em `alAoClicar(r)`, se `r.lead_id`: `document.querySelector('#tabsNav button[data-tab="meusleads"]').click(); kbAbrirFicha(r.lead_aba, r.lead_id); return;`.

- [ ] **Step 6: CSS** (no `kbStyles`, antes do `@media`)

```css
  .kbBuscaBox{position:relative;flex:1 1 320px;max-width:520px;}
  .kbBusca{width:100%;padding:10px 14px;border:1px solid var(--c-linha-forte);border-radius:var(--radius-lg);font:inherit;font-size:var(--fs-base);background:var(--c-branco);}
  .kbBusca:focus{outline:2px solid var(--c-sinal);outline-offset:1px;}
  .kbBuscaRes{display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--c-branco);border:1px solid var(--c-linha);border-radius:var(--radius-lg);box-shadow:var(--shadow-md);z-index:30;max-height:360px;overflow-y:auto;}
  .kbBuscaItem{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;padding:var(--space-2) var(--space-3);border:0;border-bottom:1px solid var(--c-linha);background:none;cursor:pointer;font:inherit;}
  .kbBuscaItem:hover{background:var(--c-papel);}
  .kbAbas{margin-top:var(--space-3);}
  .kbBadge{display:inline-block;min-width:18px;margin-left:4px;padding:0 6px;border-radius:999px;background:var(--c-sinal);color:var(--c-branco);font-size:var(--fs-xs);font-weight:700;text-align:center;}
  .kbBadge:empty{display:none;}
  .kbProximoBox{display:flex;align-items:center;gap:var(--space-4);flex-wrap:wrap;}
  .kbProximo{font-size:var(--fs-md);padding:12px 22px;}
  .kbHojeGrade{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--space-4);}
  .kbHojeGrade h4,.kbEquipe h4{margin:0 0 var(--space-3);font-family:var(--font-head);text-transform:uppercase;letter-spacing:.05em;font-size:var(--fs-md);}
  .kbLista{list-style:none;margin:0;padding:0;}
  .kbLista li{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--c-linha);font-size:var(--fs-sm);}
  .kbLista li.kbVencido > span:first-child{color:var(--c-sinal);font-weight:700;}
  .kbAlertaTipo{font-size:var(--fs-xs);font-weight:700;padding:2px 8px;border-radius:var(--radius-sm);background:var(--st-andamento-bg);color:var(--st-andamento);}
  .kbAlertaTipo.kbAl-sem_contato,.kbAlertaTipo.kbAl-retorno_vencido{background:var(--st-perdido-bg);color:var(--st-perdido);}
  .kbTabelaEquipe td,.kbTabelaEquipe th{white-space:nowrap;}
  .kbTabelaEquipe tbody tr{cursor:pointer;}
  .kbSemaforo{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:middle;background:var(--st-ganho);}
  .kbSem-amarelo .kbSemaforo{background:var(--st-andamento);}
  .kbSem-vermelho .kbSemaforo{background:var(--c-sinal);}
  .kbRetornoCampos{display:grid;grid-template-columns:1fr 120px;gap:var(--space-2);}
  .kbResumoContato{font-weight:700;margin:0 0 var(--space-2);}
  .kbLinhaTempo{list-style:none;margin:0;padding:0;border-left:2px solid var(--c-linha);}
  .kbEv{display:flex;gap:var(--space-2);padding:6px 0 6px var(--space-3);position:relative;font-size:var(--fs-sm);}
  .kbEvIco{position:absolute;left:-9px;top:6px;width:16px;height:16px;border-radius:50%;background:var(--c-branco);border:1px solid var(--c-linha-forte);font-size:9px;display:flex;align-items:center;justify-content:center;}
  .kbEv > div{margin-left:var(--space-2);}
  .kbEv-ligacao .kbEvIco,.kbEv-discador .kbEvIco{border-color:var(--c-sinal);color:var(--c-sinal);}
```

- [ ] **Step 7: Rodar e ver passar** (`node test_leads_hoje.js`, `node test_leads_kanban.js`, `bash run_tests.sh`). Ajustar algum teste antigo do Kanban só se ele dependia de o Quadro aparecer sem aba, e registrar como ruling.

- [ ] **Step 8: Print visual** (mesmo script de render do Kanban, com dados fictícios): conferir as abas Hoje e Equipe e a ficha com a linha do tempo.

- [ ] **Step 9: Commit** `feat(meus-leads): abas Hoje/Quadro/Equipe, pesquisa, linha do tempo, retorno com hora e alertas (secao 118)`

---

### Task 5: Publicação (com ok) e REGRAS §118

- [ ] Aplicar as migrations (Tasks 1 e 2) e rodar o `leads_hoje_check.sql`, já com ok.
- [ ] Publicar o painel, com MD5 no mesmo comando, backup e vigia.
- [ ] Escrever a §118 no REGRAS, commit, `git fetch oficial` e rebase, push.
- [ ] Nenhuma mudança na virada: a aba continua só para o admin até ela.
