# Equipe: placar do dia e relatório do consultor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba Equipe de Meus leads, um placar do dia por consultor (Dia/Mês + data) e, ao clicar no nome, o relatório daquele consultor naquele dia.

**Architecture:**
- **Banco:** três funções novas no Postgres (Supabase de produção), só leitura e sem tabela nova.
  - `leads_dia_leads` (interna): leads pegos ou recebidos no dia e o primeiro contato de cada um.
  - `leads_dia_equipe`: o placar.
  - `leads_dia_consultor`: o relatório, em jsonb.
- **Painel:** `_template.html` ganha funções puras de HTML (`kbTabelaDiaHtml`, `kbRelatorioHtml` e auxiliares) e a ligação com o estado e os cliques da Equipe que já existem (`kbCarregarEquipe`, `kbRenderEquipe`, handler de `#panel-meusleads`).

**Tech Stack:** PostgreSQL/plpgsql (Supabase), JavaScript puro num HTML único, testes Node + JSDOM.

**Spec:** `docs/superpowers/specs/2026-11-03-equipe-placar-relatorio-dia-design.md`

## Global Constraints

- **Repositório:** é público. Nada de dado real de cliente ou lead em teste, spec, plano ou commit; use só nomes fictícios "Zz…".
- **Painel:** editar só `_template.html`. O `painel_clientes_apex.html` é gerado com `python build_painel.py` e nunca é editado à mão.
- **Design "Sinal de Ápice":** não mexer no bloco `<style>` "SISTEMA VISUAL SINAL DE ÁPICE". CSS novo vai junto do CSS `.kbEq*` (antes do `@media (max-width: 1100px)` da Equipe), só com variáveis (`var(--…)`), sem cor em hex. `--radius-md` não existe, então usar `var(--radius-lg)`.
- **Avisos:** `mostrarAviso(msg, 'ok'|'erro'|'info')`, nunca `alert()`.
- **Permissão:** só admin e supervisor (`get_my_role()`). Erro `42501` "sem permissão".
- **Data no futuro:** erro `22023` "data no futuro".
- **Dia:** 00:00 a 23:59 em `America/Sao_Paulo`. "Hoje" no painel vem de `kbPartesSP(Date.now()).dia`.
- **Histórico dos leads:** começa em **2026-10-27**. As ligações existem desde 01/09.
- **Banco de produção** `mdgfboijyqfkggcrhptn`:
  - qualquer DDL, inclusive a conferência que cria função dentro de transação desfeita, **só com ok do Rafael naquele momento**;
  - usar `execute_sql` com `begin; … commit;`, porque `apply_migration` falha nesse conector;
  - sem `DROP`.
- **Testes:** rodar Node com `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules`.
- **Falhas que já existem no `oficial/main`** e não devem ser tratadas como regressão: `test_conversao_vendas`, `test_leads_painel_hoje` ("coluna zerada mostra 0"), `test_pedidos_alerta`, `test_producao_filtro_pessoas`, `test_projecao_ganho`, `test_proposta_manual_docs`, `test_proposta_timbrada` e `test_redesign_shell`.
- **Commits:** terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Nada de push antes da publicação (Task 5).

## Review Focus

1. **Cliques rápidos em dois consultores:** o relatório tem que mostrar o último clicado e não ser sobrescrito pela resposta atrasada do primeiro. Teste na Task 4.
2. **Data apagada ou digitada no futuro no campo de data:** volta para hoje, sem chamar o banco com data inválida. Teste na Task 4.
3. **Consultor sem usuário de telefonia ou sem nenhuma atividade no dia:**
   - a linha aparece com "—" nas ligações e zeros;
   - o relatório diz "Sem atividade registrada neste dia";
   - nada quebra com `numeros` nulo.

   Teste na Task 3 (`kbRelatorioHtml` com `numeros: null`).
4. **Chave "Pega leads" e números da linha no modo Mês:** continuam como antes. A chave não abre relatório, e o número abre a lista. Teste na Task 4.
5. **Dia passado com o modo Dia aberto e o timer da Equipe rodando:** o placar não pula de volta para hoje sozinho. Teste na Task 4.

---

### Task 1: Funções do banco + conferência

**Files:**
- Create: `supabase/migrations/20261103210000_leads_dia.sql`
- Create: `supabase/tests/leads_dia_check.sql`

**Interfaces:**
- Produces:
  - `public.leads_dia_leads(p_dia date)` → `table(dono_id uuid, lead_aba text, lead_id text, como text, de_dono uuid, em timestamptz, primeiro_contato timestamptz, ligacoes int)`. É interna: só as outras duas funções chamam.
  - `public.leads_dia_equipe(p_dia date default hoje SP)` → `table(dono_id uuid, nome text, tem_telefonia boolean, pegos int, recebidos int, perdidos int, ligacoes int, atendidas int, min_falados int, whatsapp int, primeiro_contato_mediana_min numeric, sem_ligar int, classificados int, obs int, retornos_feitos int, retornos_atrasados int, vendas int, receita numeric, jornada_inicio timestamptz, jornada_fim timestamptz, posicao int)`, já ordenada.
  - `public.leads_dia_consultor(p_dono uuid, p_dia date)` → `jsonb` com:
    - `{dia, historico_desde, numeros, media_equipe, por_hora, parados, leads, perdidos, pendencias}`;
    - `por_hora`: `[{h, ligacoes, atendidas}]`, h de 13 a 20;
    - `parados`: `[{de, ate, min}]`;
    - `leads`: `[{aba, lead_id, nome, como, de_nome, em, primeiro_contato_min, ligacoes, status, vendeu, receita}]`;
    - `perdidos`: `[{aba, lead_id, nome, em, para_nome}]`;
    - `pendencias`: `{retornos_atrasados:[{aba, lead_id, nome, quando}], sem_contato:[{aba, lead_id, nome, pego_em}]}`;
    - `media_equipe`: as mesmas chaves numéricas do placar, onde `pegos` é a média de pegos + recebidos.

- [ ] **Step 1: Escrever a migration** `supabase/migrations/20261103210000_leads_dia.sql`

```sql
-- §134: placar do dia (leads_dia_equipe) e relatório do consultor (leads_dia_consultor) na aba Equipe.
-- Só leitura, sem tabela nova, sem DROP. Spec: docs/superpowers/specs/2026-11-03-equipe-placar-relatorio-dia-design.md

-- Interna: um item por (consultor, lead) que ele pegou ou recebeu no dia, com o primeiro contato depois disso
-- (ligação dele para o telefone do lead, mesma regra chave_tel da ficha, ou clique dele no lead) e as ligações do dia.
create or replace function public.leads_dia_leads(p_dia date)
 returns table(dono_id uuid, lead_aba text, lead_id text, como text, de_dono uuid, em timestamptz, primeiro_contato timestamptz, ligacoes int)
 language sql stable security definer set search_path to 'public'
as $function$
  with lim as (
    select (p_dia::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((p_dia + 1)::timestamp at time zone 'America/Sao_Paulo') as fim
  ), ent as (
    select h.por as d, h.lead_aba, h.lead_id, 'pegou'::text as como, null::uuid as de, h.em
      from public.leads_historico h, lim
     where h.acao = 'pegar' and h.por is not null and h.em >= lim.ini and h.em < lim.fim
    union all
    select (h.depois ->> 'dono_id')::uuid, h.lead_aba, h.lead_id, 'recebeu', nullif(h.antes ->> 'dono_id', '')::uuid, h.em
      from public.leads_historico h, lim
     where h.acao = 'redistribuir' and nullif(h.depois ->> 'dono_id', '') is not null and h.em >= lim.ini and h.em < lim.fim
  ), pri as (   -- o mesmo lead para a mesma pessoa duas vezes no dia: vale a primeira entrada
    select distinct on (ent.d, ent.lead_aba, ent.lead_id) ent.* from ent order by ent.d, ent.lead_aba, ent.lead_id, ent.em
  )
  select p.d, p.lead_aba, p.lead_id, p.como, p.de, p.em,
         least(
           (select min(m.gerada_em) from public.ligacoes_manuais m, lim
             where eq.usu is not null and lower(btrim(m.usuario)) = eq.usu and public.chave_tel(l.phone_number) is not null
               and m.chave_tel = public.chave_tel(l.phone_number) and m.gerada_em >= p.em and m.gerada_em < lim.fim),
           (select min(c.em) from public.leads_contatos c, lim
             where c.lead_aba = p.lead_aba and c.lead_id = p.lead_id and c.profile_id = p.d and c.em >= p.em and c.em < lim.fim)),
         (select count(*) from public.ligacoes_manuais m, lim
           where eq.usu is not null and lower(btrim(m.usuario)) = eq.usu and public.chave_tel(l.phone_number) is not null
             and m.chave_tel = public.chave_tel(l.phone_number) and m.gerada_em >= lim.ini and m.gerada_em < lim.fim)::int
    from pri p
    join public.leads l on l.aba = p.lead_aba and l.id = p.lead_id
    left join lateral (select nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as usu
                         from public.leads_equipe e where e.profile_id = p.d order by e.id limit 1) eq on true
$function$;

create or replace function public.leads_dia_equipe(p_dia date default ((now() at time zone 'America/Sao_Paulo')::date))
 returns table(dono_id uuid, nome text, tem_telefonia boolean, pegos int, recebidos int, perdidos int, ligacoes int, atendidas int,
               min_falados int, whatsapp int, primeiro_contato_mediana_min numeric, sem_ligar int, classificados int, obs int,
               retornos_feitos int, retornos_atrasados int, vendas int, receita numeric, jornada_inicio timestamptz,
               jornada_fim timestamptz, posicao int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini timestamptz; v_fim timestamptz; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'data no futuro' using errcode = '22023'; end if;
  v_ini := p_dia::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
  with eq as (
    select distinct on (e.profile_id) e.profile_id as e_id, p.nome as e_nome,
           nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id
     where e.profile_id is not null order by e.profile_id, e.id
  ), h as (
    select x.* from public.leads_historico x where x.em >= v_ini and x.em < v_fim
  ), lig as (
    select lower(btrim(m.usuario)) as u, m.gerada_em as t, m.atendida as at, m.seg_falados as seg
      from public.ligacoes_manuais m where m.gerada_em >= v_ini and m.gerada_em < v_fim
  ), ctt as (
    select c.profile_id as pid, c.em as t, c.canal from public.leads_contatos c where c.em >= v_ini and c.em < v_fim
  ), ld as (
    select * from public.leads_dia_leads(p_dia)
  ), vend as (   -- venda: o dia começou sem venda (antes da 1ª classificação) e terminou com venda (depois da última)
    select v.por as v_por, count(*)::int as n, coalesce(sum(v.rec), 0) as rec from (
      select distinct on (x.por, x.lead_aba, x.lead_id) x.por,
             coalesce((x.depois ->> 'converteu')::boolean, false) as fim_conv,
             nullif(x.depois ->> 'receita', '')::numeric as rec,
             (select coalesce((y.antes ->> 'converteu')::boolean, false) from h y
               where y.acao = 'classificar' and y.por = x.por and y.lead_aba = x.lead_aba and y.lead_id = x.lead_id
               order by y.em limit 1) as ini_conv
        from h x where x.acao = 'classificar' and x.por is not null
       order by x.por, x.lead_aba, x.lead_id, x.em desc) v
     where v.fim_conv and not v.ini_conv group by v.por
  ), ativ as (
    select a.d, min(a.t) as ini, max(a.t) as fim from (
      select eq.e_id as d, lig.t from eq join lig on lig.u = eq.e_u
      union all select ctt.pid, ctt.t from ctt
      union all select h.por, h.em from h where h.acao in ('pegar', 'classificar')
    ) a group by a.d
  ), base as (
    select eq.e_id, eq.e_nome, eq.e_u is not null as b_tel,
      (select count(*) from h where h.acao = 'pegar' and h.por = eq.e_id)::int as b_pegos,
      (select count(*) from h where h.acao = 'redistribuir' and h.depois ->> 'dono_id' = eq.e_id::text)::int as b_receb,
      (select count(*) from h where h.acao in ('redistribuir', 'devolver') and h.antes ->> 'dono_id' = eq.e_id::text
                                 and coalesce(h.depois ->> 'dono_id', '') <> eq.e_id::text)::int as b_perd,
      (select count(*) from lig where eq.e_u is not null and lig.u = eq.e_u)::int as b_lig,
      (select count(*) from lig where eq.e_u is not null and lig.u = eq.e_u and lig.at)::int as b_at,
      round(coalesce((select sum(lig.seg) from lig where eq.e_u is not null and lig.u = eq.e_u), 0) / 60.0)::int as b_min,
      (select count(*) from ctt where ctt.pid = eq.e_id and ctt.canal = 'whatsapp')::int as b_wpp,
      (select round((percentile_cont(0.5) within group (order by extract(epoch from ld.primeiro_contato - ld.em) / 60))::numeric, 1)
         from ld where ld.dono_id = eq.e_id and ld.primeiro_contato is not null) as b_med,
      (select count(*) from ld where ld.dono_id = eq.e_id and ld.primeiro_contato is null)::int as b_sem,
      (select count(*) from h where h.acao = 'classificar' and h.por = eq.e_id)::int as b_cla,
      (select count(*) from h where h.acao = 'classificar' and h.por = eq.e_id
          and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
          and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), ''))::int as b_obs,
      (select count(*) from public.agenda_retornos a
        where a.consultor_id = eq.e_id and a.quando >= v_ini and a.quando < v_fim and a.status = 'feito')::int as b_rf,
      (select count(*) from public.agenda_retornos a
        where a.consultor_id = eq.e_id and a.quando >= v_ini and a.quando < v_fim and a.status = 'pendente' and a.quando < now())::int as b_ra,
      coalesce((select vend.n from vend where vend.v_por = eq.e_id), 0) as b_vend,
      coalesce((select vend.rec from vend where vend.v_por = eq.e_id), 0) as b_rec,
      (select ativ.ini from ativ where ativ.d = eq.e_id) as b_ji,
      (select ativ.fim from ativ where ativ.d = eq.e_id) as b_jf
    from eq
  )
  select b.e_id, b.e_nome, b.b_tel, b.b_pegos, b.b_receb, b.b_perd, b.b_lig, b.b_at, b.b_min, b.b_wpp, b.b_med, b.b_sem,
         b.b_cla, b.b_obs, b.b_rf, b.b_ra, b.b_vend, b.b_rec, b.b_ji, b.b_jf,
         (row_number() over (order by b.b_vend desc, b.b_at desc, b.e_nome))::int
    from base b
   order by b.b_vend desc, b.b_at desc, b.e_nome;
end $function$;

create or replace function public.leads_dia_consultor(p_dono uuid, p_dia date)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_ini timestamptz; v_fim timestamptz; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_u text; v_num jsonb; v_media jsonb; v_hora jsonb; v_par jsonb := '[]'::jsonb; v_leads jsonb; v_perd jsonb; v_pend jsonb;
        v_exp timestamptz; v_corte timestamptz;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > v_hoje then raise exception 'data no futuro' using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = p_dono) then
    raise exception 'consultor fora da equipe de leads' using errcode = '22023';
  end if;
  v_ini := p_dia::timestamp at time zone 'America/Sao_Paulo';
  v_fim := (p_dia + 1)::timestamp at time zone 'America/Sao_Paulo';
  select nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') into v_u
    from public.leads_equipe e where e.profile_id = p_dono order by e.id limit 1;

  select to_jsonb(d) into v_num from public.leads_dia_equipe(p_dia) d where d.dono_id = p_dono;
  select jsonb_build_object(
           'pegos', round(avg(d.pegos + d.recebidos)::numeric, 1), 'ligacoes', round(avg(d.ligacoes)::numeric, 1),
           'atendidas', round(avg(d.atendidas)::numeric, 1), 'min_falados', round(avg(d.min_falados)::numeric, 1),
           'whatsapp', round(avg(d.whatsapp)::numeric, 1), 'sem_ligar', round(avg(d.sem_ligar)::numeric, 1),
           'classificados', round(avg(d.classificados)::numeric, 1), 'obs', round(avg(d.obs)::numeric, 1),
           'retornos_feitos', round(avg(d.retornos_feitos)::numeric, 1), 'retornos_atrasados', round(avg(d.retornos_atrasados)::numeric, 1),
           'vendas', round(avg(d.vendas)::numeric, 1), 'receita', round(avg(d.receita)::numeric, 2),
           'primeiro_contato_mediana_min', (select round((percentile_cont(0.5) within group (order by extract(epoch from l.primeiro_contato - l.em) / 60))::numeric, 1)
                                              from public.leads_dia_leads(p_dia) l where l.primeiro_contato is not null))
    into v_media
    from public.leads_dia_equipe(p_dia) d where d.jornada_inicio is not null or d.pegos + d.recebidos > 0;

  select jsonb_agg(jsonb_build_object('h', g.h, 'ligacoes', coalesce(x.n, 0), 'atendidas', coalesce(x.a, 0)) order by g.h) into v_hora
    from generate_series(13, 20) as g(h)
    left join (select extract(hour from m.gerada_em at time zone 'America/Sao_Paulo')::int as hh, count(*)::int as n,
                      (count(*) filter (where m.atendida))::int as a
                 from public.ligacoes_manuais m
                where v_u is not null and lower(btrim(m.usuario)) = v_u and m.gerada_em >= v_ini and m.gerada_em < v_fim
                group by 1) x on x.hh = g.h;

  -- parados: expediente 13h–21h, seg–sex; intervalos > 30 min sem ligação, clique, pegar ou classificar
  v_exp := v_ini + interval '13 hours';
  v_corte := least(v_ini + interval '21 hours', now());
  if extract(isodow from p_dia) < 6 and v_corte > v_exp then
    with t as (
      select v_exp as em
      union all select m.gerada_em from public.ligacoes_manuais m
                 where v_u is not null and lower(btrim(m.usuario)) = v_u and m.gerada_em > v_exp and m.gerada_em < v_corte
      union all select c.em from public.leads_contatos c where c.profile_id = p_dono and c.em > v_exp and c.em < v_corte
      union all select h.em from public.leads_historico h
                 where h.por = p_dono and h.acao in ('pegar', 'classificar') and h.em > v_exp and h.em < v_corte
      union all select v_corte
    ), g as (select t.em as de, lead(t.em) over (order by t.em) as ate from t)
    select coalesce(jsonb_agg(jsonb_build_object('de', g.de, 'ate', g.ate, 'min', floor(extract(epoch from g.ate - g.de) / 60)::int) order by g.de), '[]'::jsonb)
      into v_par from g where g.ate is not null and g.ate - g.de > interval '30 minutes';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'aba', l.lead_aba, 'lead_id', l.lead_id, 'nome', ld.full_name, 'como', l.como, 'de_nome', pd.nome, 'em', l.em,
           'primeiro_contato_min', case when l.primeiro_contato is not null then round((extract(epoch from l.primeiro_contato - l.em) / 60)::numeric, 1) end,
           'ligacoes', l.ligacoes, 'status', st.status, 'vendeu', coalesce(st.conv, false), 'receita', st.rec) order by l.em), '[]'::jsonb)
    into v_leads
    from public.leads_dia_leads(p_dia) l
    join public.leads ld on ld.aba = l.lead_aba and ld.id = l.lead_id
    left join public.profiles pd on pd.id = l.de_dono
    left join lateral (select x.depois ->> 'status' as status, (x.depois ->> 'converteu')::boolean as conv,
                              nullif(x.depois ->> 'receita', '')::numeric as rec
                         from public.leads_historico x
                        where x.lead_aba = l.lead_aba and x.lead_id = l.lead_id and x.acao = 'classificar' and x.em < v_fim
                        order by x.em desc limit 1) st on true
   where l.dono_id = p_dono;

  select coalesce(jsonb_agg(jsonb_build_object('aba', h.lead_aba, 'lead_id', h.lead_id, 'nome', ld.full_name, 'em', h.em,
                                               'para_nome', coalesce(nullif(h.depois ->> 'consultor', ''), 'Livres')) order by h.em), '[]'::jsonb)
    into v_perd
    from public.leads_historico h join public.leads ld on ld.aba = h.lead_aba and ld.id = h.lead_id
   where h.acao in ('redistribuir', 'devolver') and h.em >= v_ini and h.em < v_fim
     and h.antes ->> 'dono_id' = p_dono::text and coalesce(h.depois ->> 'dono_id', '') <> p_dono::text;

  v_pend := jsonb_build_object(
    'retornos_atrasados', (select coalesce(jsonb_agg(jsonb_build_object('aba', a.lead_aba, 'lead_id', a.lead_id, 'nome', a.nome, 'quando', a.quando) order by a.quando), '[]'::jsonb)
                             from public.agenda_retornos a where a.consultor_id = p_dono and a.status = 'pendente' and a.quando < now()),
    'sem_contato', (select coalesce(jsonb_agg(jsonb_build_object('aba', l.aba, 'lead_id', l.id, 'nome', l.full_name, 'pego_em', l.pego_em) order by l.pego_em), '[]'::jsonb)
                      from public.leads l where l.dono_id = p_dono and l.categoria = 'sem_contato' and l.apagado_em is null));

  return jsonb_build_object('dia', p_dia, 'historico_desde', '2026-10-27', 'numeros', v_num, 'media_equipe', v_media,
                            'por_hora', coalesce(v_hora, '[]'::jsonb), 'parados', v_par, 'leads', v_leads, 'perdidos', v_perd, 'pendencias', v_pend);
end $function$;

revoke execute on function public.leads_dia_leads(date) from public, anon, authenticated;
revoke execute on function public.leads_dia_equipe(date) from public, anon;
revoke execute on function public.leads_dia_consultor(uuid, date) from public, anon;
grant execute on function public.leads_dia_equipe(date) to authenticated;
grant execute on function public.leads_dia_consultor(uuid, date) to authenticated;
```

- [ ] **Step 2: Escrever a conferência** `supabase/tests/leads_dia_check.sql`

Montagem:
- Cole o conteúdo inteiro da migration depois do `begin;` (igual ao `leads_pegar_bloqueio_check.sql`) e, em seguida, o bloco abaixo.
- O DO termina com exceção de propósito, então tudo é desfeito.
- Dia de teste: **2026-10-05 (segunda)**, anterior ao histórico. Só os dados fictícios entram nos números de histórico, contatos e retornos.
- O "consultor" é o primeiro admin, colocado na equipe dentro da transação com o usuário de telefonia fictício `zz.teste.dia`.

```sql
do $$
declare
  v_adm uuid := (select id from public.profiles where role = 'admin' order by created_at limit 1);
  v_cons uuid := (select profile_id from public.leads_equipe where profile_id is not null order by id limit 1);
  v_outro uuid := gen_random_uuid();
  d date := '2026-10-05'; t timestamptz := '2026-10-05 00:00:00-03';
  r record; j jsonb; v_out text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated')::text, true);
  insert into public.leads_equipe (nome_planilha, usuario_telefonia, profile_id, pode_pegar) values ('ZZTESTE', 'zz.teste.dia', v_adm, false);
  insert into public.leads (aba, id, full_name, phone_number, criado_em_lead, categoria) values
    ('ZZTESTE', 'zz1', 'Zz Lead Um', '+5511900000001', t + interval '12 hours', 'sem_contato'),
    ('ZZTESTE', 'zz2', 'Zz Lead Dois', '+5511900000002', t + interval '12 hours', 'sem_contato'),
    ('ZZTESTE', 'zz3', 'Zz Lead Tres', '+5511900000003', t + interval '12 hours', 'sem_contato');
  insert into public.leads_historico (lead_aba, lead_id, acao, por, em, antes, depois) values
    ('ZZTESTE', 'zz1', 'pegar', v_adm, t + interval '13 hours', null, '{"consultor":"ZZTESTE"}'),
    ('ZZTESTE', 'zz1', 'classificar', v_adm, t + interval '13 hours 10 minutes', '{"obs":null,"converteu":false}', '{"obs":"ok","converteu":true,"receita":"100","status":"FECHADO"}'),
    ('ZZTESTE', 'zz2', 'redistribuir', v_cons, t + interval '14 hours', json_build_object('dono_id', v_outro)::jsonb, json_build_object('dono_id', v_adm, 'consultor', 'ZZTESTE')::jsonb),
    ('ZZTESTE', 'zz2', 'classificar', v_adm, t + interval '14 hours 30 minutes', '{"converteu":false}', '{"converteu":true,"receita":"50"}'),
    ('ZZTESTE', 'zz2', 'classificar', v_adm, t + interval '14 hours 40 minutes', '{"converteu":true}', '{"converteu":false,"status":"EM NEGOCIAÇÂO"}'),
    ('ZZTESTE', 'zz3', 'pegar', v_adm, t + interval '15 hours', null, '{"consultor":"ZZTESTE"}'),
    ('ZZTESTE', 'zz3', 'redistribuir', v_cons, t + interval '16 hours', json_build_object('dono_id', v_adm)::jsonb, json_build_object('dono_id', v_outro, 'consultor', 'ZZOUTRO')::jsonb);
  insert into public.ligacoes_manuais (usuario, telefone, chave_tel, gerada_em, atendida, seg_falados) values
    ('zz.teste.dia', '11900000001', public.chave_tel('+5511900000001'), t + interval '13 hours 6 minutes', true, 120),
    ('zz.teste.dia', '11900000099', public.chave_tel('11900000099'), t + interval '17 hours', false, 0);
  insert into public.leads_contatos (lead_aba, lead_id, profile_id, canal, em) values ('ZZTESTE', 'zz2', v_adm, 'whatsapp', t + interval '14 hours 20 minutes');
  insert into public.agenda_retornos (consultor_id, nome, telefone, chave_tel, quando, tipo, status, origem, lead_aba, lead_id) values
    (v_adm, 'Zz Lead Um', '11900000001', public.chave_tel('11900000001'), t + interval '18 hours', 'retorno', 'feito', 'teste', 'ZZTESTE', 'zz1'),
    (v_adm, 'Zz Lead Dois', '11900000002', public.chave_tel('11900000002'), t + interval '19 hours', 'retorno', 'pendente', 'teste', 'ZZTESTE', 'zz2');

  select * into r from public.leads_dia_equipe(d) x where x.dono_id = v_adm;
  v_out := v_out || case when r.pegos = 2 and r.recebidos = 1 and r.perdidos = 1 then '1 ok; ' else format('1 FALHOU %s/%s/%s; ', r.pegos, r.recebidos, r.perdidos) end;
  v_out := v_out || case when r.ligacoes = 2 and r.atendidas = 1 and r.min_falados = 2 and r.whatsapp = 1 then '2 ok; ' else format('2 FALHOU %s/%s/%s/%s; ', r.ligacoes, r.atendidas, r.min_falados, r.whatsapp) end;
  v_out := v_out || case when r.primeiro_contato_mediana_min = 13.0 and r.sem_ligar = 1 then '3 ok; ' else format('3 FALHOU %s/%s; ', r.primeiro_contato_mediana_min, r.sem_ligar) end;
  v_out := v_out || case when r.classificados = 3 and r.obs = 1 then '4 ok; ' else format('4 FALHOU %s/%s; ', r.classificados, r.obs) end;
  v_out := v_out || case when r.retornos_feitos = 1 and r.retornos_atrasados = 1 then '5 ok; ' else format('5 FALHOU %s/%s; ', r.retornos_feitos, r.retornos_atrasados) end;
  v_out := v_out || case when r.vendas = 1 and r.receita = 100 then '6 ok; ' else format('6 FALHOU %s/%s; ', r.vendas, r.receita) end;
  v_out := v_out || case when r.jornada_inicio = t + interval '13 hours' and r.jornada_fim = t + interval '17 hours' and r.posicao = 1 then '7 ok; ' else format('7 FALHOU %s/%s/%s; ', r.jornada_inicio, r.jornada_fim, r.posicao) end;

  j := public.leads_dia_consultor(v_adm, d);
  v_out := v_out || case when jsonb_array_length(j -> 'leads') = 3 and (select count(*) from jsonb_array_elements(j -> 'leads') e where e ->> 'como' = 'recebeu') = 1
                          and jsonb_array_length(j -> 'perdidos') = 1 then '8 ok; ' else '8 FALHOU ' || (j -> 'leads')::text || '; ' end;
  v_out := v_out || case when jsonb_array_length(j -> 'parados') = 3 and (j -> 'parados' -> 0 ->> 'min')::int = 70 then '9 ok; ' else '9 FALHOU ' || (j -> 'parados')::text || '; ' end;
  v_out := v_out || case when (j -> 'por_hora' -> 0 ->> 'ligacoes')::int = 1 and (j -> 'por_hora' -> 0 ->> 'atendidas')::int = 1
                          and (j -> 'por_hora' -> 4 ->> 'ligacoes')::int = 1 and j ->> 'historico_desde' = '2026-10-27' then '10 ok; ' else '10 FALHOU ' || (j -> 'por_hora')::text || '; ' end;
  v_out := v_out || case when (j -> 'numeros' ->> 'vendas')::int = 1 and j -> 'media_equipe' ? 'vendas' then '11 ok; ' else '11 FALHOU; ' end;

  begin perform public.leads_dia_equipe(current_date + 2); v_out := v_out || '12 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'data no futuro' then '12 ok; ' else '12 FALHOU ' || sqlerrm || '; ' end; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
  begin perform public.leads_dia_equipe(d); v_out := v_out || '13 FALHOU; ';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '13 ok; ' else '13 FALHOU ' || sqlerrm || '; ' end; end;
  begin perform public.leads_dia_consultor(v_adm, d); v_out := v_out || '13b FALHOU';
  exception when others then v_out := v_out || case when sqlerrm = 'sem permissão' then '13b ok' else '13b FALHOU ' || sqlerrm end; end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

- **Valores esperados**, para quem for conferir:
  - **Mediana:** é de 6 min (zz1) e 20 min (zz2), ou seja, 13.0.
  - **Parados:** 13:10–14:20 (70 min), 15:00–17:00 (120 min) e 17:00–21:00 (240 min).
  - **Venda:** a do zz2 foi desmarcada no mesmo dia e não conta.
- **Se alguma tabela recusar o insert** (coluna `not null` sem valor):
  - completar o insert com um valor fictício e anotar a coluna no commit;
  - **não** mudar as funções para acomodar o teste.

- [ ] **Step 3: Pedir ok ao Rafael e rodar a conferência**

- Dizer ao Rafael: "Vou rodar a conferência das funções do placar no banco de produção. Ela cria as funções e dados fictícios numa transação que é desfeita no fim, então nada fica gravado. Posso?"
- **Só com o ok:** rodar o arquivo inteiro com `execute_sql`.
- **Esperado:** erro com `RESULTADO: 1 ok; 2 ok; … 13b ok`.
- **Se aparecer qualquer "FALHOU":** corrigir a migration (e a cópia no check) e rodar de novo (mesmo ok da sessão).
- **Se o conector der `Invalid or expired requestState`:** rodar em 2 partes:
  1. as três funções;
  2. só o DO, ainda dentro de `begin`, terminando com `rollback`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261103210000_leads_dia.sql supabase/tests/leads_dia_check.sql
git commit -m "feat(leads): funcoes do placar e relatorio do dia (secao 134)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Teste do painel (JSDOM) — arquivo e base

**Files:**
- Create: `test_leads_dia.js`

**Interfaces:**
- Consumes: o harness de `test_meus_leads_fase3.js` (linhas 1–46: JSDOM, `window.__rpcRespostas`, `window.__rpcCalls`, `window.__tabelas`, `comRange`).
- Produces: `test_leads_dia.js` com o marcador `// ==== mais testes entram aqui ====`. As Tasks 3 e 4 acrescentam testes antes dele.

- [ ] **Step 1: Criar `test_leads_dia.js`**

Copie as linhas 1–46 de `test_meus_leads_fase3.js` sem mudar nada, trocando só a 1ª linha de comentário por:

```js
// Testa o §134 (Equipe: placar do dia e relatório do consultor). DADOS FICTÍCIOS (repo público).
```

Depois do ``const testScript = ` `` copiado, cole:

```js

(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const SP = (s) => Date.parse(s + '-03:00');
  const dnReal = Date.now, ag = SP('2026-11-03T18:00:00');   // terça 18:00
  Date.now = () => ag;
  // ==== mais testes entram aqui ====

  Date.now = dnReal;
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

- [ ] **Step 2: Rodar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_dia.js`
Expected: `--- RESULTADO: 0 passaram, 0 falharam ---`

- [ ] **Step 3: Commit**

```bash
git add test_leads_dia.js
git commit -m "test(leads): base do teste do placar do dia

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Funções puras do placar e do relatório

**Files:**
- Modify: `_template.html`, logo depois de `function kbDuracaoMin(min){…}` (por volta da linha 3914).
- Modify: `_template.html`, CSS da Equipe, antes de `@media (max-width: 1100px){ .kbEqTopo{…} .kbEqAlertas{…} }` (por volta da linha 1122).
- Test: `test_leads_dia.js`

**Interfaces:**
- Consumes: `kbDuracaoMin(min)`, `kbPartesSP(ms)`, `kbMs(iso)`, `kbMoeda(n)` e `escapeHtml(s)`, que já existem.
- Produces:
  - `kbFmtMin(v) → string`: `'—'` para nulo; senão `kbDuracaoMin`.
  - `kbHoraSP(iso) → 'HH:MM'` ou `''`.
  - `kbDiaBR('AAAA-MM-DD') → 'dd/mm'`.
  - `kbSetaMedia(valor, media, maiorMelhor) → {txt:'▲'|'▼'|'', cls:'melhor'|'pior'|''}`.
  - `kbAvisoDiaHtml(dia, hoje) → string`.
  - `kbTabelaDiaHtml(linhas) → '<table>…</table>'`: cada `<tr data-kb-relatorio="<dono_id>">` e o nome num `button.kbLink[data-kb-relatorio]`.
  - `kbRelatorioHtml(rel, nome) → string`: `rel` é `{dados, erro, carregando}`. O contêiner é `.kbRel`, o botão `[data-kb-relatorio-fechar]`, e cada lead é `[data-kb-abrir="aba|id"]`.

- [ ] **Step 1: Escrever os testes que falham** (antes do marcador)

```js
  // ==== Task 3: funções puras ====
  eq([kbFmtMin(null), kbFmtMin(6), kbFmtMin(13.4), kbFmtMin(72), kbFmtMin(0)], ['—', '6 min', '13 min', '1 h 12 min', '0 min'], 'formata minutos');
  eq([kbHoraSP('2026-11-03T16:04:00Z'), kbHoraSP(null)], ['13:04', ''], 'hora de SP');
  eq(kbDiaBR('2026-11-03'), '03/11', 'dia dd/mm');
  eq(kbSetaMedia(5, 3, true), { txt: '▲', cls: 'melhor' }, 'acima da média, maior é melhor');
  eq(kbSetaMedia(5, 3, false), { txt: '▲', cls: 'pior' }, 'acima da média, menor é melhor');
  eq(kbSetaMedia(2, 3, true), { txt: '▼', cls: 'pior' }, 'abaixo da média');
  eq(kbSetaMedia(3, 3, true), { txt: '', cls: '' }, 'igual à média');
  eq(kbSetaMedia(3, null, true), { txt: '', cls: '' }, 'sem média');
  assert(kbAvisoDiaHtml('2026-11-03', '2026-11-03').includes('até 1 h atrasadas'), 'aviso de hoje');
  assert(kbAvisoDiaHtml('2026-10-20', '2026-11-03').includes('a partir de 27/10/2026'), 'aviso antes do histórico');
  eq(kbAvisoDiaHtml('2026-10-30', '2026-11-03'), '', 'dia passado depois do histórico: sem aviso');
  const L1 = { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, pegos: 8, recebidos: 3, perdidos: 1, ligacoes: 70, atendidas: 21, min_falados: 95, whatsapp: 4,
    primeiro_contato_mediana_min: 6, sem_ligar: 2, classificados: 12, obs: 9, retornos_feitos: 3, retornos_atrasados: 1, vendas: 2, receita: 180.5,
    jornada_inicio: '2026-11-03T16:04:00Z', jornada_fim: '2026-11-03T23:51:00Z', posicao: 1 };
  const L2 = { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: false, pegos: 0, recebidos: 0, perdidos: 0, ligacoes: 0, atendidas: 0, min_falados: 0, whatsapp: 0,
    primeiro_contato_mediana_min: null, sem_ligar: 0, classificados: 0, obs: 0, retornos_feitos: 0, retornos_atrasados: 0, vendas: 0, receita: 0,
    jornada_inicio: null, jornada_fim: null, posicao: 2 };
  const TD = document.createElement('div'); TD.innerHTML = kbTabelaDiaHtml([L1, L2]);
  const tr1 = TD.querySelector('tr[data-kb-relatorio="u1"]');
  assert(tr1 && tr1.querySelector('button.kbLink[data-kb-relatorio="u1"]').textContent.includes('Zz Lucas'), 'linha com o nome clicável');
  const cel = [...tr1.querySelectorAll('td')].map(t => t.textContent.replace(/\\s+/g, ' ').trim());
  eq(cel, ['1º', 'Zz Lucas', '8 + 3', '70 / 21 atend. 4 WhatsApp', '95', '6 min', '2', '12 / 9', '3 / 1', '2', 'R$ 180,50', '13:04–20:51'], 'colunas do dia');
  assert(tr1.querySelector('.kbEqNum.ruim'), 'sem ligar > 0 em vermelho');
  const cel2 = [...TD.querySelectorAll('tr[data-kb-relatorio="u2"] td')].map(t => t.textContent.replace(/\\s+/g, ' ').trim());
  eq([cel2[2], cel2[3], cel2[5], cel2[10], cel2[11]], ['0', '—', '—', 'R$ 0,00', '—'], 'sem telefonia e sem atividade: traços e zeros');
  eq(TD.querySelectorAll('thead th').length, 12, '12 colunas');
  const R = { dia: '2026-11-03', historico_desde: '2026-10-27', numeros: L1,
    media_equipe: { pegos: 6, ligacoes: 50, atendidas: 15, min_falados: 60, whatsapp: 2, sem_ligar: 1, classificados: 10, obs: 7, retornos_feitos: 2, retornos_atrasados: 2, vendas: 1, receita: 90, primeiro_contato_mediana_min: 9 },
    por_hora: [13, 14, 15, 16, 17, 18, 19, 20].map((h, i) => ({ h, ligacoes: i === 0 ? 10 : 5, atendidas: i === 0 ? 4 : 1 })),
    parados: [{ de: '2026-11-03T18:10:00Z', ate: '2026-11-03T19:02:00Z', min: 52 }],
    leads: [{ aba: 'NOVEMBRO', lead_id: 'l:1', nome: 'Zz Lead A', como: 'pegou', de_nome: null, em: '2026-11-03T16:05:00Z', primeiro_contato_min: 6, ligacoes: 2, status: 'FECHADO', vendeu: true, receita: 100 },
            { aba: 'NOVEMBRO', lead_id: 'l:2', nome: 'Zz Lead B', como: 'recebeu', de_nome: 'Zz Caio', em: '2026-11-03T17:00:00Z', primeiro_contato_min: null, ligacoes: 0, status: null, vendeu: false, receita: null }],
    perdidos: [{ aba: 'NOVEMBRO', lead_id: 'l:3', nome: 'Zz Lead C', em: '2026-11-03T19:00:00Z', para_nome: 'ZZCAIO' }],
    pendencias: { retornos_atrasados: [{ aba: 'NOVEMBRO', lead_id: 'l:4', nome: 'Zz Lead D', quando: '2026-11-03T17:00:00Z' }], sem_contato: [] } };
  const RD = document.createElement('div'); RD.innerHTML = kbRelatorioHtml({ dados: R, erro: false, carregando: false }, 'Zz Lucas');
  assert(RD.querySelector('.kbRel h3').textContent.includes('Zz Lucas · dia 03/11') && RD.querySelector('[data-kb-relatorio-fechar]'), 'título e Fechar');
  const cv = RD.querySelector('[data-kb-rel-cartao="vendas"]');
  assert(cv && cv.textContent.includes('2') && cv.textContent.includes('equipe 1') && cv.querySelector('.kbRelSeta.melhor').textContent === '▲', 'cartão de vendas com média e seta');
  assert(RD.querySelector('[data-kb-rel-cartao="primeiro_contato"] .kbRelSeta.melhor').textContent === '▼', '1ª ligação abaixo da média é melhor');
  eq(RD.querySelectorAll('.kbRelHora').length, 8, '8 barras de hora');
  assert(RD.querySelector('.kbRelParados').textContent.includes('15:10–16:02 (52 min)'), 'parado com horário e duração');
  const RDtxt = RD.textContent.replace(/\\s+/g, ' ');   // kbMoeda usa espaço inquebrável depois do R$
  assert(RD.querySelector('[data-kb-abrir="NOVEMBRO|l:1"]') && RDtxt.includes('venda R$ 100,00') && RD.textContent.includes('recebeu de Zz Caio') && RD.textContent.includes('sem contato'), 'leads do dia');
  assert(RD.querySelector('.kbRelPerdidos').textContent.includes('ZZCAIO') && RD.querySelector('.kbRelPendencias [data-kb-abrir="NOVEMBRO|l:4"]'), 'perdidos e pendências');
  const vazio = document.createElement('div'); vazio.innerHTML = kbRelatorioHtml({ dados: Object.assign({}, R, { numeros: null, leads: [], perdidos: [], parados: [] }), erro: false, carregando: false }, 'Zz Luria');
  assert(vazio.textContent.includes('Sem atividade registrada neste dia') && vazio.querySelector('[data-kb-relatorio-fechar]'), 'sem atividade (numeros nulo) não quebra');
  const er = document.createElement('div'); er.innerHTML = kbRelatorioHtml({ dados: null, erro: true, carregando: false }, 'Zz Lucas');
  assert(er.textContent.includes('Não foi possível carregar o relatório') && er.querySelector('[data-kb-relatorio-fechar]'), 'erro no relatório com Fechar');
  const ca = document.createElement('div'); ca.innerHTML = kbRelatorioHtml({ dados: null, erro: false, carregando: true }, 'Zz Lucas');
  assert(ca.textContent.includes('Carregando'), 'carregando');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_dia.js`
Expected: `FALHA: ReferenceError: kbFmtMin is not defined`

- [ ] **Step 3: Implementar.** Logo depois de `function kbDuracaoMin(min){…}` em `_template.html`:

```js
// ===== §134: placar do dia e relatório do consultor (Equipe) — funções puras =====
function kbFmtMin(v){ return (v === null || v === undefined || v === '' || isNaN(Number(v))) ? '—' : kbDuracaoMin(Number(v)); }
function kbHoraSP(iso){ const t = kbMs(iso); return t === null ? '' : kbPartesSP(t).hora; }
function kbDiaBR(dia){ const p = String(dia || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] : ''; }
function kbSetaMedia(valor, media, maiorMelhor){
  if(media === null || media === undefined || valor === null || valor === undefined || Number(valor) === Number(media)) return { txt: '', cls: '' };
  const acima = Number(valor) > Number(media);
  return { txt: acima ? '▲' : '▼', cls: acima === !!maiorMelhor ? 'melhor' : 'pior' };
}
function kbAvisoDiaHtml(dia, hoje){
  if(dia && dia < '2026-10-27') return 'Pegos, classificados e vendas só existem a partir de 27/10/2026.';
  if(dia === hoje) return 'Ligações chegam do ProContact de hora em hora; podem estar até 1 h atrasadas.';
  return '';
}
function kbTabelaDiaHtml(linhas){
  const n = (v) => Number(v) || 0;
  const tr = (linhas || []).map(d => {
    const dono = escapeHtml(d.dono_id);
    const cont = d.tem_telefonia ? `<b>${n(d.ligacoes)}</b><span class="kbMuted"> / ${n(d.atendidas)} atend.</span>` : '<span class="kbMuted">—</span>';
    const wpp = n(d.whatsapp) ? ` <small class="kbEqAtivTxt">${n(d.whatsapp)} WhatsApp</small>` : '';
    const jorn = d.jornada_inicio ? `${kbHoraSP(d.jornada_inicio)}–${kbHoraSP(d.jornada_fim)}` : '—';
    return `<tr data-kb-relatorio="${dono}"><td class="kbDiaPos">${n(d.posicao)}º</td>`
      + `<td><button type="button" class="kbLink" data-kb-relatorio="${dono}"><b>${escapeHtml(d.nome || '')}</b></button></td>`
      + `<td class="r">${n(d.pegos)}${n(d.recebidos) ? ' + ' + n(d.recebidos) : ''}</td><td>${cont}${wpp}</td><td class="r">${n(d.min_falados)}</td>`
      + `<td class="r">${kbFmtMin(d.primeiro_contato_mediana_min)}</td>`
      + `<td class="r">${n(d.sem_ligar) ? `<span class="kbEqNum ruim">${n(d.sem_ligar)}</span>` : '0'}</td>`
      + `<td class="r">${n(d.classificados)} / ${n(d.obs)}</td><td class="r">${n(d.retornos_feitos)} / ${n(d.retornos_atrasados)}</td>`
      + `<td class="r"><b>${n(d.vendas)}</b></td><td class="r">${escapeHtml(kbMoeda(d.receita) || 'R$ 0,00')}</td><td>${jorn}</td></tr>`;
  }).join('');
  return '<table><thead><tr><th>#</th><th>Consultor</th><th class="r">Pegos</th><th>Contatos</th><th class="r">Min falados</th><th class="r">1ª ligação</th>'
    + '<th class="r">Sem ligar</th><th class="r">Classif. / OBS</th><th class="r">Retornos feitos / atras.</th><th class="r">Vendas</th><th class="r">Receita</th><th>Jornada</th></tr></thead>'
    + `<tbody>${tr || '<tr><td colspan="12" class="kbMuted">Sem consultores na equipe de leads.</td></tr>'}</tbody></table>`;
}
function kbRelatorioHtml(rel, nome){
  if(!rel) return '';
  const fechar = '<button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-relatorio-fechar>Fechar</button>';
  const r = rel.dados;
  const topo = (dia) => `<div class="kbEqListaTopo"><h3>${escapeHtml(nome || '')}${dia ? ' · dia ' + escapeHtml(kbDiaBR(dia)) : ''}</h3>${fechar}</div>`;
  if(rel.carregando) return `<div class="kbRel">${topo('')}<p class="kbMuted">Carregando…</p></div>`;
  if(rel.erro || !r) return `<div class="kbRel">${topo('')}<p class="kbMuted">Não foi possível carregar o relatório agora.</p></div>`;
  const d = r.numeros, m = r.media_equipe || {}, n = (v) => Number(v) || 0;
  if(!d || (!d.jornada_inicio && !n(d.pegos) && !n(d.recebidos))) return `<div class="kbRel">${topo(r.dia)}<p class="kbMuted">Sem atividade registrada neste dia.</p></div>`;
  const cart = (chave, rot, val, med, maior, fmt) => {
    const f = fmt || ((x) => String(n(x))), s = kbSetaMedia(val, med, maior);
    return `<div class="kbEqKpi kbRelCartao" data-kb-rel-cartao="${chave}"><strong class="kbNumGrande">${escapeHtml(f(val))}</strong><span>${rot}</span>`
      + `<small>equipe ${med === null || med === undefined ? '—' : escapeHtml(f(med))}${s.txt ? ` <b class="kbRelSeta ${s.cls}">${s.txt}</b>` : ''}</small></div>`;
  };
  const moeda = (x) => kbMoeda(x) || 'R$ 0,00', um = (x) => String(Math.round(Number(x) * 10) / 10 || 0);
  const cartoes = '<div class="kbRelCartoes">'
    + cart('pegos', 'pegos + recebidos', n(d.pegos) + n(d.recebidos), m.pegos, true, um)
    + cart('ligacoes', 'ligações', d.ligacoes, m.ligacoes, true, um) + cart('atendidas', 'atendidas', d.atendidas, m.atendidas, true, um)
    + cart('min_falados', 'min falados', d.min_falados, m.min_falados, true, um) + cart('whatsapp', 'WhatsApp', d.whatsapp, m.whatsapp, true, um)
    + cart('primeiro_contato', '1ª ligação (mediana)', d.primeiro_contato_mediana_min, m.primeiro_contato_mediana_min, false, kbFmtMin)
    + cart('sem_ligar', 'sem ligar', d.sem_ligar, m.sem_ligar, false, um) + cart('classificados', 'classificados', d.classificados, m.classificados, true, um)
    + cart('obs', 'OBS escritas', d.obs, m.obs, true, um) + cart('retornos', 'retornos feitos', d.retornos_feitos, m.retornos_feitos, true, um)
    + cart('vendas', 'vendas', d.vendas, m.vendas, true, um) + cart('receita', 'receita', d.receita, m.receita, true, moeda) + '</div>';
  const horas = r.por_hora || [], maxH = Math.max(1, ...horas.map(h => n(h.ligacoes)));
  const ritmo = `<h4>Ritmo</h4><div class="kbRelHoras">${horas.map(h => `<span class="kbRelHora" title="${n(h.h)}h: ${n(h.ligacoes)} ligações, ${n(h.atendidas)} atendidas"><b>${n(h.ligacoes)}</b><i style="height:${Math.round(100 * n(h.ligacoes) / maxH)}%"></i><small>${n(h.h)}h</small></span>`).join('')}</div>`
    + `<div class="kbRelParados">${(r.parados || []).length ? 'Parado: ' + r.parados.map(p => `${kbHoraSP(p.de)}–${kbHoraSP(p.ate)} (${n(p.min)} min)`).join(' · ') : 'Sem intervalos parados de mais de 30 min.'}</div>`;
  const li = (aba, id, nomeL, meta) => `<li><button type="button" class="kbLink" data-kb-abrir="${escapeHtml(aba)}|${escapeHtml(id)}">${escapeHtml(nomeL || '(sem nome)')}</button><span class="kbMeta">${escapeHtml(meta)}</span></li>`;
  const leads = (r.leads || []).map(l => li(l.aba, l.lead_id, l.nome, [
    (l.como === 'recebeu' ? 'recebeu' + (l.de_nome ? ' de ' + l.de_nome : '') : 'pegou') + ' ' + kbHoraSP(l.em),
    l.primeiro_contato_min === null || l.primeiro_contato_min === undefined ? 'sem contato' : '1º contato ' + kbFmtMin(l.primeiro_contato_min),
    n(l.ligacoes) + (n(l.ligacoes) === 1 ? ' ligação' : ' ligações'), l.status || 'sem status', l.vendeu ? 'venda ' + moeda(l.receita) : ''
  ].filter(Boolean).join(' · '))).join('');
  const perd = (r.perdidos || []).map(p => li(p.aba, p.lead_id, p.nome, kbHoraSP(p.em) + ' → ' + (p.para_nome || ''))).join('');
  const pend = r.pendencias || {};
  const pendLi = (pend.retornos_atrasados || []).map(x => li(x.aba, x.lead_id, x.nome, 'retorno era ' + kbHoraSP(x.quando)))
    .concat((pend.sem_contato || []).map(x => li(x.aba, x.lead_id, x.nome, 'pego ' + kbTempoDesde(x.pego_em, Date.now()) + ', sem contato'))).join('');
  return `<div class="kbRel">${topo(r.dia)}${cartoes}${ritmo}<div class="kbRelGrid">`
    + `<div><h4>Leads do dia (${(r.leads || []).length})</h4><ul class="kbLista kbCartaoLista">${leads || '<li class="kbMeta">Nenhum lead pego ou recebido.</li>'}</ul></div>`
    + `<div><h4>Perdidos no dia (${(r.perdidos || []).length})</h4><ul class="kbLista kbCartaoLista kbRelPerdidos">${perd || '<li class="kbMeta">Nenhum.</li>'}</ul>`
    + `<h4>Ficou para trás (agora)</h4><ul class="kbLista kbCartaoLista kbRelPendencias">${pendLi || '<li class="kbMeta">Nada pendente.</li>'}</ul></div></div></div>`;
}
```

CSS, antes de `@media (max-width: 1100px){ .kbEqTopo{…} .kbEqAlertas{…} }`:

```css
  .kbDiaControles{display:flex;align-items:center;gap:10px;margin-bottom:var(--space-2);}
  .kbDiaData{font:inherit;padding:6px 10px;border:1px solid var(--ml-surface-3);border-radius:var(--radius-lg);background:var(--ml-surface);color:var(--ml-ink);}
  .kbDiaPos{font-weight:700;color:var(--ml-ink-3);width:36px;}
  .kbRel{background:var(--ml-surface);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:var(--space-3);}
  .kbRel h4{margin:14px 0 6px;font:600 var(--fs-base)/1.2 var(--font-body);text-transform:none;}
  .kbRelCartoes{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin:8px 0 6px;}
  .kbRelCartao{cursor:default;background:var(--ml-surface-2);}
  .kbRelCartao small{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .kbRelSeta.melhor{color:var(--st-ganho);}
  .kbRelSeta.pior{color:var(--c-bordo);}
  .kbRelHoras{display:flex;align-items:flex-end;gap:8px;height:120px;}
  .kbRelHora{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:2px;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbRelHora i{display:block;width:100%;max-width:36px;min-height:2px;background:var(--c-sinal);border-radius:4px 4px 0 0;}
  .kbRelParados{margin-top:6px;font-size:var(--fs-sm);color:var(--ml-ink-2);}
  .kbRelGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;}
  @media (max-width: 1100px){ .kbRelCartoes{grid-template-columns:repeat(2,minmax(0,1fr));} .kbRelGrid{grid-template-columns:1fr;} }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_dia.js`
Expected: `--- RESULTADO: 34 passaram, 0 falharam ---`. O número exato pode variar; o que importa é `0 falharam`.

- **Se "colunas do dia" falhar:**
  - Só pelo espaço entre "atend." e "WhatsApp": ajustar o `textContent` esperado, nunca o HTML.
  - Pela hora: o ISO `16:04Z` é 13:04 em SP.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_leads_dia.js
git commit -m "feat(leads): tabela do dia e relatorio do consultor (funcoes puras, secao 134)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Ligação na Equipe (estado, carga, cliques, data)

**Files:**
- Modify: `_template.html`:
  - `const kbEstado = {…}` (por volta da linha 4140);
  - `async function kbCarregarEquipe` (por volta da linha 4879);
  - `function kbRenderEquipe` (por volta da linha 4931);
  - handler de `#panel-meusleads` (por volta da linha 5146).
- Test: `test_leads_dia.js`

**Interfaces:**
- Consumes: `kbTabelaDiaHtml`, `kbRelatorioHtml`, `kbAvisoDiaHtml` e `kbPartesSP` (Task 3); RPCs `leads_dia_equipe({p_dia})` e `leads_dia_consultor({p_dono, p_dia})` (Task 1).
- Produces:
  - estado: `kbEstado.equipeModo`, `equipeDia`, `diaEquipe`, `diaDisponivel`, `relatorio`;
  - funções: `kbHojeSP()`, `kbCarregarDia()`, `kbEquipeModo(m)`, `kbEquipeTrocarDia(dia)`, `kbAbrirRelatorio(dono)`, `kbCarregarRelatorio(dono)`.

- [ ] **Step 1: Escrever os testes que falham** (antes do marcador)

```js
  // ==== Task 4: Equipe com Dia/Mês e relatório ====
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u1', nome_planilha: 'ZZLUCAS', pode_pegar: true }, { id: 2, profile_id: 'u2', nome_planilha: 'ZZLURIA', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  window.__rpcRespostas.leads_kanban3 = { data: [{ aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: new Date(ag - 6e6).toISOString() }], error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  window.__rpcRespostas.leads_atividade_equipe2 = { data: [
    { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true },
    { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: false, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true }], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_dia_equipe = (a) => ({ data: [Object.assign({}, L1, { dia: a.p_dia }), L2], error: null });
  window.__rpcRespostas.leads_dia_consultor = (a) => ({ data: Object.assign({}, R, { dia: a.p_dia }), error: null });
  try { window.localStorage.removeItem('kbEqModo'); } catch(_e) {}
  await kbAplicarPermissao();
  kbEstado.aba = null; await kbCarregar(); await espera(120);
  const EQ = document.getElementById('kbEquipe');
  assert(kbEstado.aba === 'equipe' && kbEstado.equipeModo === 'mes' && EQ.querySelector('tr[data-kb-dono="u1"]'), 'abre no Mês, tabela de sempre');
  assert(EQ.querySelector('[data-kb-eq-modo="dia"]') && EQ.querySelector('[data-kb-eq-modo="mes"].active') && !EQ.querySelector('#kbEqDia'), 'seletor Dia/Mês, sem data no Mês');
  EQ.querySelector('[data-kb-eq-modo="dia"]').click(); await espera(60);
  const cDia = window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop();
  assert(kbEstado.equipeModo === 'dia' && cDia && cDia.args.p_dia === '2026-11-03', 'Dia chama leads_dia_equipe com hoje');
  assert(EQ.querySelector('#kbEqDia').value === '2026-11-03' && EQ.querySelector('#kbEqDia').max === '2026-11-03', 'campo de data com hoje e sem futuro');
  assert(EQ.querySelector('tr[data-kb-relatorio="u1"] .kbDiaPos').textContent === '1º' && !EQ.querySelector('tr[data-kb-dono]'), 'tabela do dia no lugar da do mês');
  assert(EQ.textContent.includes('até 1 h atrasadas'), 'aviso de hoje');
  let lsModo = null; try { lsModo = window.localStorage.getItem('kbEqModo'); } catch(_e) {}
  assert(lsModo === null || lsModo === 'dia', 'lembra o modo (quando o navegador deixa)');
  // relatório
  EQ.querySelector('button[data-kb-relatorio="u1"]').click(); await espera(60);
  const cRel = window.__rpcCalls.filter(c => c.nome === 'leads_dia_consultor').pop();
  assert(cRel && cRel.args.p_dono === 'u1' && cRel.args.p_dia === '2026-11-03' && EQ.querySelector('.kbRel h3').textContent.includes('Zz Lucas · dia 03/11'), 'clicar no nome abre o relatório do dia');
  EQ.querySelector('[data-kb-relatorio-fechar]').click();
  assert(!EQ.querySelector('.kbRel') && !kbEstado.relatorio, 'Fechar');
  // corrida: dois cliques rápidos, a resposta do primeiro chega depois
  let soltaU1;
  window.__rpcRespostas.leads_dia_consultor = (a) => a.p_dono === 'u1'
    ? new Promise(res => { soltaU1 = () => res({ data: Object.assign({}, R, { dia: a.p_dia }), error: null }); })
    : { data: Object.assign({}, R, { dia: a.p_dia, numeros: Object.assign({}, L2, { pegos: 1, jornada_inicio: '2026-11-03T16:00:00Z', jornada_fim: '2026-11-03T17:00:00Z' }) }), error: null };
  const p1 = kbAbrirRelatorio('u1'); await espera(10);
  await kbAbrirRelatorio('u2'); soltaU1(); await p1; await espera(20);
  assert(kbEstado.relatorio && kbEstado.relatorio.dono === 'u2' && EQ.querySelector('.kbRel h3').textContent.includes('Zz Luria'), 'dois cliques rápidos: fica o último');
  window.__rpcRespostas.leads_dia_consultor = (a) => ({ data: Object.assign({}, R, { dia: a.p_dia }), error: null });
  // trocar a data (inclusive futura ou vazia) e o relatório acompanha
  const inp = EQ.querySelector('#kbEqDia'); inp.value = '2026-10-20'; inp.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-10-20' && window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop().args.p_dia === '2026-10-20'
    && window.__rpcCalls.filter(c => c.nome === 'leads_dia_consultor').pop().args.p_dia === '2026-10-20' && EQ.textContent.includes('a partir de 27/10/2026'), 'trocar a data recarrega placar e relatório; aviso antes do histórico');
  const nAntes = window.__rpcCalls.length;
  const inp2 = EQ.querySelector('#kbEqDia'); inp2.value = '2026-12-01'; inp2.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-11-03' && !window.__rpcCalls.slice(nAntes).some(c => c.args && c.args.p_dia === '2026-12-01'), 'data no futuro volta para hoje sem chamar o banco com ela');
  const inp3 = EQ.querySelector('#kbEqDia'); inp3.value = ''; inp3.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  assert(kbEstado.equipeDia === '2026-11-03', 'data vazia volta para hoje');
  // dia passado não pula para hoje com o timer da Equipe
  const inp4 = EQ.querySelector('#kbEqDia'); inp4.value = '2026-10-30'; inp4.dispatchEvent(new window.Event('change', { bubbles: true })); await espera(60);
  await kbCarregarEquipe(); await espera(30);
  assert(kbEstado.equipeDia === '2026-10-30' && window.__rpcCalls.filter(c => c.nome === 'leads_dia_equipe').pop().args.p_dia === '2026-10-30', 'atualização da Equipe mantém o dia escolhido');
  // lista e relatório não aparecem juntos
  kbEstado.relatorio = null; await kbAbrirRelatorio('u1'); await espera(20);
  kbEquipeModo('mes'); await espera(30);
  assert(!kbEstado.relatorio && EQ.querySelector('tr[data-kb-dono="u1"]'), 'voltar ao Mês fecha o relatório e mostra a tabela de sempre');
  EQ.querySelector('[data-kb-eq="u1|sem_contato"]').click();
  assert(kbEstado.equipeLista && !kbEstado.relatorio && EQ.querySelector('.kbEqLista'), 'número da linha (Mês) abre a lista, como antes');
  const pegaAntes = window.__rpcCalls.length;
  EQ.querySelector('[data-kb-pode-pegar="u1"]').click(); await espera(30);
  assert(window.__rpcCalls.slice(pegaAntes).some(c => c.nome === 'leads_definir_pode_pegar') && !kbEstado.relatorio, 'chave Pega leads não abre relatório');
  // erro e função ausente
  window.__rpcRespostas.leads_dia_equipe = { data: null, error: { code: '500', message: 'falhou' } };
  window.__avisos = []; const mAv = mostrarAviso; mostrarAviso = (m, t) => window.__avisos.push(t + ':' + m);
  await kbEquipeModo('dia'); await espera(30);
  assert(window.__avisos.some(a => a.includes('Não foi possível carregar o dia agora.')) && EQ.querySelector('tr[data-kb-dono="u1"]') && EQ.querySelector('[data-kb-eq-modo]'), 'erro na carga do dia: aviso e a tabela do Mês continua');
  window.__rpcRespostas.leads_dia_equipe = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.leads_dia_equipe' } };
  await kbEquipeModo('dia'); await espera(30);
  assert(kbEstado.diaDisponivel === false && kbEstado.equipeModo === 'mes' && !EQ.querySelector('[data-kb-eq-modo]') && EQ.querySelector('tr[data-kb-dono="u1"]'), 'sem a função no banco: some o seletor e a Equipe fica como antes');
  mostrarAviso = mAv;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_dia.js`
Expected: "FALHOU: abre no Mês…" e outras, ou `ReferenceError: kbAbrirRelatorio is not defined`.

- [ ] **Step 3: Estado.** Em `const kbEstado = { … passar: null };`, acrescentar antes do `}` final:

```js
, equipeModo: null, equipeDia: null, diaEquipe: null, diaDisponivel: null, relatorio: null
```

O resultado fica `… loteSel: new Set(), passar: null, equipeModo: null, equipeDia: null, diaEquipe: null, diaDisponivel: null, relatorio: null };`.

- [ ] **Step 4: Carga.** Logo antes de `async function kbCarregarEquipe(notificar){`, colar:

```js
// §134: placar do dia (Dia/Mês) e relatório do consultor
function kbHojeSP(){ return kbPartesSP(Date.now()).dia; }
function kbLerModoEquipe(){ try { return window.localStorage.getItem('kbEqModo') === 'dia' ? 'dia' : 'mes'; } catch(_e) { return 'mes'; } }
async function kbCarregarDia(){
  const dia = kbEstado.equipeDia || kbHojeSP();
  const r = await ppSeguro(() => sb.rpc('leads_dia_equipe', { p_dia: dia }));
  if(!r || r.error){
    const faltou = !!(r && r.error && (r.error.code === 'PGRST202' || r.error.code === '42883'));
    if(faltou){ kbEstado.diaDisponivel = false; kbEstado.equipeModo = 'mes'; kbEstado.relatorio = null; }
    else if(kbEstado.equipeModo === 'dia') mostrarAviso('Não foi possível carregar o dia agora.', 'erro');
    kbEstado.diaEquipe = null;
    return false;
  }
  kbEstado.diaDisponivel = true; kbEstado.diaEquipe = r.data || [];
  return true;
}
async function kbEquipeModo(m){
  kbEstado.equipeModo = m === 'dia' ? 'dia' : 'mes';
  try { window.localStorage.setItem('kbEqModo', kbEstado.equipeModo); } catch(_e) {}
  if(kbEstado.equipeModo === 'dia'){ kbEstado.equipeDia = kbEstado.equipeDia || kbHojeSP(); await kbCarregarDia(); }
  else kbEstado.relatorio = null;
  kbRenderEquipe();
}
async function kbEquipeTrocarDia(dia){
  const hoje = kbHojeSP();
  kbEstado.equipeDia = /^\d{4}-\d{2}-\d{2}$/.test(dia || '') && dia <= hoje ? dia : hoje;
  await kbCarregarDia();
  if(kbEstado.relatorio) await kbCarregarRelatorio(kbEstado.relatorio.dono);
  kbRenderEquipe();
}
async function kbCarregarRelatorio(dono){
  const dia = kbEstado.equipeDia || kbHojeSP();
  const r = await ppSeguro(() => sb.rpc('leads_dia_consultor', { p_dono: dono, p_dia: dia }));
  if(!kbEstado.relatorio || kbEstado.relatorio.dono !== dono) return;   // clicou em outro (ou fechou) no meio: descarta
  kbEstado.relatorio = { dono, dados: r && !r.error ? r.data : null, erro: !r || !!r.error, carregando: false };
}
async function kbAbrirRelatorio(dono){
  kbEstado.equipeLista = null; kbEstado.loteSel = new Set();
  kbEstado.relatorio = { dono, dados: null, erro: false, carregando: true };
  kbRenderEquipe();
  await kbCarregarRelatorio(dono);
  kbRenderEquipe();
}
```

Dentro de `kbCarregarEquipe`, logo depois de `if(atv && !atv.error) kbEstado.atividade = atv.data || [];` e antes de `kbRenderEquipe();`, colar:

```js
  if(kbEstado.equipeModo === null) kbEstado.equipeModo = kbLerModoEquipe();
  if(kbEstado.equipeModo === 'dia' || kbEstado.diaDisponivel === null){   // §134: no 1º carregamento descobre se o banco tem a função
    await kbCarregarDia();
    if(kbEstado.equipeModo === 'dia' && kbEstado.relatorio && (kbEstado.equipeDia || kbHojeSP()) === kbHojeSP()) await kbCarregarRelatorio(kbEstado.relatorio.dono);
  }
```

- [ ] **Step 5: Render.** Em `kbRenderEquipe`:

(a) Logo antes de `const sel = kbEstado.equipeLista;`, colar:

```js
  const modoDia = kbEstado.equipeModo === 'dia' && kbEstado.diaDisponivel !== false && Array.isArray(kbEstado.diaEquipe);
  const hojeSP = kbHojeSP(), diaSel = kbEstado.equipeDia || hojeSP;
  const controles = kbEstado.diaDisponivel ? `<div class="kbDiaControles"><nav class="kbSeg" aria-label="Período da tabela">`
      + `<button type="button" data-kb-eq-modo="dia"${kbEstado.equipeModo === 'dia' ? ' class="active"' : ''}>Dia</button>`
      + `<button type="button" data-kb-eq-modo="mes"${kbEstado.equipeModo !== 'dia' ? ' class="active"' : ''}>Mês</button></nav>`
      + (kbEstado.equipeModo === 'dia' ? `<input type="date" class="kbDiaData" id="kbEqDia" value="${escapeHtml(diaSel)}" max="${escapeHtml(hojeSP)}" aria-label="Dia do placar">` : '') + '</div>' : '';
  const avisoDia = modoDia ? kbAvisoDiaHtml(diaSel, hojeSP) : '';
  const tabelaUsada = modoDia ? `<div class="kbEqTabela">${kbTabelaDiaHtml(kbEstado.diaEquipe)}${avisoDia ? `<p class="kbEqLegenda">${escapeHtml(avisoDia)}</p>` : ''}</div>` : tabela;
```

(b) Logo depois do bloco `if(sel){ … }` e antes de `if(!sel) kbEstado.loteSel = new Set();`, colar:

```js
  if(kbEstado.relatorio){
    const rnome = ((kbEstado.diaEquipe || []).find(x => x.dono_id === kbEstado.relatorio.dono) || (kbEstado.atividade || []).find(x => x.dono_id === kbEstado.relatorio.dono) || {}).nome || '';
    lista = kbRelatorioHtml(kbEstado.relatorio, rnome);
  }
```

(c) Na linha final, trocar:

```js
  document.getElementById('kbEquipe').innerHTML = kbFaixaPegarHtml(kbEstado.pegarBloqueio, ativ, agoraMs) + topo + faixas + tabela + lista + lote + alertas;
```

por:

```js
  document.getElementById('kbEquipe').innerHTML = kbFaixaPegarHtml(kbEstado.pegarBloqueio, ativ, agoraMs) + topo + faixas + controles + tabelaUsada + lista + lote + alertas;
```

- [ ] **Step 6: Cliques e data.**

(a) No handler `document.getElementById('panel-meusleads').addEventListener('click', (e) => {`, logo depois da linha `if(pc){ kbDefinirPodePegar(pc.dataset.kbPodePegar); return; }   // antes do clique na linha …`, colar:

```js
  const md = e.target.closest('[data-kb-eq-modo]');
  if(md){ kbEquipeModo(md.dataset.kbEqModo); return; }   // §134
  if(e.target.closest('[data-kb-relatorio-fechar]')){ kbEstado.relatorio = null; kbRenderEquipe(); return; }
  const rl = e.target.closest('#kbEquipe [data-kb-relatorio]');
  if(rl){ kbAbrirRelatorio(rl.dataset.kbRelatorio); return; }
```

(b) Nas linhas que abrem a lista (`if(eqn){ … kbEstado.equipeLista = { dono, chave }; …`, `else if(c !== 'ligacoes'){ kbEstado.equipeLista = …` e o bloco `if(rd){ … kbEstado.equipeLista = { dono, chave: 'sem_contato' }; …`), acrescentar `kbEstado.relatorio = null;` logo depois de cada atribuição a `kbEstado.equipeLista`.

(c) Depois do fechamento `});` desse handler de clique, colar:

```js
document.getElementById('kbEquipe').addEventListener('change', (e) => { if(e.target.id === 'kbEqDia') kbEquipeTrocarDia(e.target.value); });   // §134
```

- [ ] **Step 7: Rodar o teste do dia e o da Equipe**

Run:
```bash
export NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules
node test_leads_dia.js && node test_meus_leads_fase3.js && node test_leads_bloqueio.js
```
Expected: os três com `0 falharam`.

- **Se `test_meus_leads_fase3.js` falhar por causa da chamada nova `leads_dia_equipe`:** o mock padrão devolve `{data: [], error: null}`, então não deveria falhar. Ler a mensagem e corrigir o código, não o teste antigo.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_leads_dia.js
git commit -m "feat(leads): Dia/Mes na Equipe, data e relatorio do consultor (secao 134)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Build, suíte, comparação com o ar, banco, publicação e registro

**Files:**
- Modify: `painel_clientes_apex.html` (gerado), `REGRAS_NEGOCIO.md`

- [ ] **Step 1: Build e suíte inteira**

Run:
```bash
python build_painel.py && NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules bash run_tests.sh 2>&1 | tail -3
```
- **Esperado:** "Falharam:" só com as 8 conhecidas (Global Constraints).
- **Se aparecer outra:** comparar rodando a mesma no `oficial/main` (worktree detached temporário) antes de concluir que é regressão. A falha conhecida do `test_leads_painel_hoje` tem que ser a mesma ("coluna zerada mostra 0").

- [ ] **Step 2: Conferir divs e comparar com o ar**

```bash
python - <<'EOF'
import re; s=open('_template.html',encoding='utf-8').read()
print('div abre', len(re.findall(r'<div[\s>]', s)), 'fecha', s.count('</div>'))
EOF
git fetch -q oficial && git log --oneline HEAD..oficial/main
ssh hostinger "md5sum domains/apexsmart.com.br/public_html/painel_clientes_apex.html"
```
- **Divs:** a diferença abre/fecha tem que ser igual à do `oficial/main` (rodar o mesmo script lá).
- **`HEAD..oficial/main` vazio.** Se não estiver, fazer merge do `oficial/main`, refazer o build e voltar ao Step 1.
- **MD5 do ar tem que ser o último publicado** (`78c640b1…`, §133). Se for outro, baixar, comparar (`diff`) e juntar antes de seguir.

- [ ] **Step 3: Pedir ok e aplicar o banco**

- Dizer ao Rafael: "Posso criar as 3 funções do placar no banco de produção? São só de leitura, não mudam nenhuma função existente, e o painel no ar não as usa até a publicação."
- **Com o ok:** rodar o conteúdo de `supabase/migrations/20261103210000_leads_dia.sql` em `execute_sql`, entre `begin;` e `commit;`.
- **Conferir:**

```sql
select proname from pg_proc where proname in ('leads_dia_leads','leads_dia_equipe','leads_dia_consultor');
```

  Deve devolver 3 linhas.
- **Rodar de novo a conferência** `supabase/tests/leads_dia_check.sql`, agora sem precisar recriar, para ver o `RESULTADO` todo ok.

- [ ] **Step 4: Pedir ok e publicar o painel**

Dizer ao Rafael: "Posso publicar o painel com o placar do dia? Antes confiro que o ar continua `78c640b1`." Com o ok:

```bash
R=domains/apexsmart.com.br/public_html/painel_clientes_apex.html; TS=$(ssh hostinger 'TZ=America/Sao_Paulo date +%Y%m%d_%H%M%S')
AR=$(ssh hostinger "md5sum $R | cut -d' ' -f1"); echo "ar=$AR ts=$TS"
if [ "$AR" = "78c640b1c7a8f680df751c0fe3aa0def" ]; then
  ssh hostinger "cp $R ~/deploy_backups/painel_clientes_apex_${TS}_antes_134_placar_dia.html" && scp -q painel_clientes_apex.html hostinger:$R && ssh hostinger "md5sum $R"
else echo "AR MUDOU - NAO ENVIADO"; fi
md5sum painel_clientes_apex.html
for u in https://apexsmart.com.br/painel_clientes_apex.html https://www.apexsmart.com.br/painel_clientes_apex.html; do curl -s "$u?nc=$RANDOM" | md5sum; done
```

O MD5 tem que ser o mesmo nos quatro lugares: gerado, servidor e site com e sem www.

- [ ] **Step 5: Registrar a §134, fazer o push e aceitar no vigia**

Acrescentar ao fim de `REGRAS_NEGOCIO.md`:
- a seção `## 134. Meus leads: placar do dia e relatório do consultor na Equipe (03/11/2026)`, no formato das §132/§133, com pedido, o que mudou, regras dos números (resumo da spec), banco, código, testes, publicação (MD5, backup, horário SP) e como reverter;
- a linha "Próxima livre: §135".

```bash
git add painel_clientes_apex.html REGRAS_NEGOCIO.md docs/superpowers/plans/2026-11-03-equipe-placar-relatorio-dia.md
git commit -m "docs(regras): placar do dia e relatorio do consultor, publicado (secao 134)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git fetch -q oficial && git log --oneline HEAD..oficial/main   # vazio
git push oficial HEAD:main
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\acer1\Downloads\apex-smart-solutions\vigia\vigia_painel.ps1" -Aceitar
```

Expected: push aceito, sem force, e o vigia respondendo "Referência atualizada: <md5 novo>".
