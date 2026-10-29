# Meus leads, redesign Fase 3 (Equipe): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** refazer a aba Equipe do supervisor no visual aprovado.
- **Topo:**
  - cinco números clicáveis;
  - faixa de "precisa de atenção" para quem está parado.
- **Tabela:**
  - semáforo escrito;
  - ligações por hora das 13h às 21h;
  - ligações de hoje contra a meta.
- **Alertas** em três blocos.
- **Redistribuir** vários leads de uma vez ou um só, pelo menu "Passar para", que substitui a janela Redistribuir.

**Architecture:**
- **Banco:** uma função nova, `leads_atividade_equipe2()`.
  - Devolve o mesmo que `leads_atividade_equipe()` e mais:
    - `lig_por_hora int[8]` (13h a 20h, SP);
    - `meta_dia int`;
    - `pode_pegar boolean`.
  - Sem DROP: a antiga continua.
- **Painel:**
  - tenta a função nova; se ela não existir, cai para a antiga, sem o mapa por hora. Assim a ordem entre aplicar no banco e publicar não quebra nada;
  - a tela é montada por funções puras testadas;
  - o redistribuir chama `leads_redistribuir` lead a lead, em sequência.

**Tech Stack:**
- `_template.html`: HTML/CSS/JS sem framework.
- Testes jsdom: `node test_*.js` e `bash run_tests.sh`.
- Postgres/Supabase: projeto `mdgfboijyqfkggcrhptn`, que é produção.

**Spec:** `docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md`, seções 2, 5 (5.1 a 5.4), 6, 7 e 8. As Fases 1 e 2 já estão no ar (oficial 3d3bc6e).

**Mockup (local):** `.superpowers/brainstorm/395-1793217071/content/04-equipe.html`.

**Decisões deste plano onde a spec não fixa:**
- **Colunas a mais:** a função nova também devolve `meta_dia` e `pode_pegar`. A spec pede a meta e o "pega leads / só os que já tem" na tela, e assim vem tudo numa chamada só.
- **"Leads livres" no topo** abre o Quadro da equipe toda, onde está a coluna Livres. A lista da Equipe só mostra leads com dono.
- **"Ligações da equipe"** não abre lista: é só o medidor.
- **Consultor sem telefonia:**
  - o semáforo vale pela OBS;
  - sem OBS desde as 13h de hoje, fica cinza "sem telefonia" e não entra na faixa de atenção;
  - assim, quem não tem como ser medido não aparece como parado.
- **"Devolver aos livres" na barra do lote** abre o menu já com essa opção marcada. O lote nunca volta sem confirmar.
- **Falha no meio do lote:**
  - o menu continua aberto só com os que falharam e o motivo de cada um;
  - "tentar de novo" não repete os que já passaram.

## Global Constraints

- **Ponto de partida:**
  - Worktree `.worktrees/meus-leads-redesign` (branch `feat/meus-leads-redesign`).
  - Antes da Task 1: `git fetch oficial && git merge --ff-only oficial/main`.
  - Se não der fast-forward, parar e avisar.
- **Edição:**
  - No painel só se edita o `_template.html`. O `painel_clientes_apex.html` não é commitado.
  - Manter LF. Gravar com a ferramenta de escrita ou com Python `newline=''`.
- **Banco (produção):**
  - **Leitura livre. Criar a função e rodar a conferência, só com o ok do Rafael naquele momento.**
  - Usar `execute_sql` com `begin; … commit;`. O `apply_migration` do conector falha.
  - Nada de DROP.
  - A conferência roda com `begin; … rollback;`.
- **O que não muda:**
  - o shell;
  - a ficha da Fase 1 e a Hoje B;
  - o Quadro e a Lista da Fase 2;
  - `leads_redistribuir`, com a mesma assinatura e as mesmas regras:
    - só o gestor;
    - "Devolver aos livres" só para lead sem status (`categoria = 'sem_contato'`);
    - o consultor precisa estar na `leads_equipe`.
- **Cores:**
  - só por `var(--…)`: tokens `--ml-*`, `--st-*` e `--c-*`. **Nenhum hex novo**;
  - o mapa por hora usa `--c-rosa`, `--st-perdido`, `--c-sinal` e `--c-carmim`.
- **Cantos:** `var(--radius-lg)` ou 6 px. Nada de 10, 12 ou 14 px: o `test_redesign_shell` reprova.
- **Texto:**
  - rótulos em frase normal;
  - números com `tabular-nums`;
  - todo texto do banco passa por `escapeHtml`;
  - avisos por `mostrarAviso`.
- **Testes:**
  - Dados fictícios: "Zz…", `119000000xx` e e-mail `@teste.invalid`.
  - O código de teste fica dentro de um template literal: barra invertida dobrada (`'\\d'`) e nada de `${`.
  - Teste que depende da hora fixa o relógio com `Date.now = () => SP('2026-10-28T15:00:00')` e o devolve no fim.
- **Commits** terminam com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Banco, publicação e push** só com o ok do Rafael na hora (Task 5).

## Review Focus

1. **Painel publicado antes de a função nova existir no banco.** A Equipe abre com a antiga. Tabela, semáforo e contagens funcionam, e o mapa por hora mostra "—". Teste "RF1", Task 3.
2. **Lote com falha parcial.** Um lead ganhou status no meio e não pode "voltar aos livres", ou a rede caiu num deles.
   - Os outros são passados.
   - Aparece a lista de falhas, com o motivo de cada uma.
   - "Tentar de novo" só refaz os que falharam.

   Teste "RF2", Task 4.
3. **Dois cliques em "Passar para…".** Só uma execução. Teste "RF3", Task 4.
4. **Consultor sem telefonia, fora do expediente, no fim de semana ou no começo do expediente sem nenhuma ação.** O semáforo escrito sai correto e a barra de "Hoje" fica neutra. Testes "RF4", Task 2.
5. **Lead cujo dono é o único consultor da equipe.** O menu diz "Nenhum outro consultor na equipe de leads." e não deixa confirmar. Teste "RF5", Task 4.

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `supabase/migrations/20261028200000_leads_atividade_equipe2.sql` (novo) | função `leads_atividade_equipe2()` |
| `supabase/tests/leads_atividade_equipe2_check.sql` (novo) | conferência com ROLLBACK |
| `_template.html`, JS | funções puras da Equipe; `kbCarregarEquipe`, que usa a função nova e cai para a antiga; `kbRenderEquipe`, reescrita; `kbListaCartaoHtml`, que ganha seleção; menu "Passar para" (`kbPassar*`), chamado também por `kbAbrirRedistribuir` e `kbSalvarRedistribuicao`; `kbParar`, que fecha o menu |
| `_template.html`, markup | sai `#kbRedOverlay`; entra `#kbPassar` no mesmo lugar |
| `_template.html`, CSS | entram a Equipe nova, o menu e a barra do lote; `#kbPassar` entra no seletor dos tokens `--ml-*`; sai o CSS da tabela antiga e da janela |
| `test_meus_leads_fase3.js` (novo) | testes da Fase 3 |
| `test_leads_painel_hoje.js`, `test_leads_hoje.js`, `test_leads_kanban.js` | ajustes onde a janela Redistribuir e a tabela antiga eram usadas |
| `REGRAS_NEGOCIO.md` | §126.3, depois de publicar |

---

### Task 1: Função nova no banco (arquivo, conferência e prova só de leitura)

**Files:**
- Create: `supabase/migrations/20261028200000_leads_atividade_equipe2.sql`
- Create: `supabase/tests/leads_atividade_equipe2_check.sql`

**Interfaces:**
- Produces: `public.leads_atividade_equipe2()`, que devolve:

  ```
  table(dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamptz,
        lig_hoje integer, ultima_obs timestamptz, obs_hoje integer,
        lig_por_hora integer[], meta_dia integer, pode_pegar boolean)
  ```

  - `lig_por_hora[1]` = 13h … `[8]` = 20h (SP).
  - `meta_dia` = `config.monitor_leads_metas → meta_ligacoes_dia`, com 80 como padrão.
  - Só admin ou supervisor.

- [ ] **Step 1: Escrever a migration**

Criar `supabase/migrations/20261028200000_leads_atividade_equipe2.sql`. As sete primeiras colunas seguem a mesma conta da `leads_atividade_equipe()` (migration `20261028100100`):

```sql
-- §126.3 (redesign de Meus leads, Fase 3): atividade da equipe + ligações por hora (13h–20h, SP) + meta diária + pode_pegar.
-- Função NOVA (sem DROP): a leads_atividade_equipe() continua no banco para abas abertas com o painel antigo.
-- Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/leads_atividade_equipe2_check.sql (ROLLBACK).
begin;
create or replace function public.leads_atividade_equipe2()
 returns table(dono_id uuid, nome text, tem_telefonia boolean, ultima_ligacao timestamp with time zone, lig_hoje integer,
               ultima_obs timestamp with time zone, obs_hoje integer, lig_por_hora integer[], meta_dia integer, pode_pegar boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_ini_dia timestamptz; v_meta int;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  v_ini_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  select nullif(cfg.valor::jsonb ->> 'meta_ligacoes_dia', '')::int into v_meta from public.config cfg where cfg.chave = 'monitor_leads_metas';
  v_meta := coalesce(v_meta, 80);
  return query
  with eq as (
    select e.profile_id as e_id, p.nome as e_nome, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u, coalesce(e.pode_pegar, false) as e_pode
      from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null
  ), obs as (   -- OBS escrita = classificação que mudou a OBS para um texto não vazio (igual à leads_atividade_equipe)
    select h.por as o_por, h.em as o_em from public.leads_historico h
     where h.acao = 'classificar' and h.em >= now() - interval '7 days'
       and coalesce(btrim(h.depois ->> 'obs'), '') <> ''
       and coalesce(btrim(h.depois ->> 'obs'), '') <> coalesce(btrim(h.antes ->> 'obs'), '')
  ), lig as (   -- ligações de hoje (SP), pela mesma regra de usuário da leads_atividade_equipe
    select lower(btrim(m.usuario)) as l_u, m.gerada_em as l_em from public.ligacoes_manuais m where m.gerada_em >= v_ini_dia
  )
  select eq.e_id, eq.e_nome, eq.e_u is not null,
         (select max(m.gerada_em) from public.ligacoes_manuais m
           where eq.e_u is not null and lower(btrim(m.usuario)) = eq.e_u and m.gerada_em >= now() - interval '7 days'),
         (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u)::int,
         (select max(o.o_em) from obs o where o.o_por = eq.e_id),
         (select count(*) from obs o where o.o_por = eq.e_id and o.o_em >= v_ini_dia)::int,
         array(select (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u
                         and extract(hour from lig.l_em at time zone 'America/Sao_Paulo') = h.h)::int
                 from generate_series(13, 20) as h(h) order by h.h),
         v_meta, eq.e_pode
    from eq order by eq.e_nome;
end $function$;
revoke execute on function public.leads_atividade_equipe2() from public, anon;
grant execute on function public.leads_atividade_equipe2() to authenticated;
commit;
```

- [ ] **Step 2: Escrever a conferência (sempre ROLLBACK)**

Criar `supabase/tests/leads_atividade_equipe2_check.sql`, no mesmo padrão de `supabase/tests/leads_painel_hoje_check.sql`:

```sql
-- Verificação da migration 20261028200000 (§126.3). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esup@teste.invalid'),
('00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.etel@teste.invalid'),
('00000000-0000-0000-0000-00000000e603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esem@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e601', 'Zzesup Teste', 'zz.esup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e602', 'Zzetel Teste', 'zz.etel', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e603', 'Zzesem Teste', 'zz.esem', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar, pode_pegar, usuario_telefonia) values
('ZZETEL', '00000000-0000-0000-0000-00000000e602', false, true, 'zz.etel.tel'),
('ZZESEM', '00000000-0000-0000-0000-00000000e603', false, false, null);
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999700001, 'zz.etel.tel', '11900000061', public.chave_tel('11900000061'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '14 hours 10 minutes') at time zone 'America/Sao_Paulo', false, 0, 'ZZ TAB'),
(999700002, 'zz.etel.tel', '11900000062', public.chave_tel('11900000062'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '15 hours 20 minutes') at time zone 'America/Sao_Paulo', true, 60, 'ZZ TAB'),
(999700003, 'ZZ.ETEL.TEL ', '11900000063', public.chave_tel('11900000063'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '15 hours 40 minutes') at time zone 'America/Sao_Paulo', false, 0, 'ZZ TAB');
do $$
declare r record;
begin
  execute 'set local role authenticated';
  -- consultor não pode chamar
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e602', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e602', true);
  begin
    perform * from public.leads_atividade_equipe2();
    assert false, 'consultor chamou leads_atividade_equipe2';
  exception when insufficient_privilege then
    assert sqlerrm like '%sem permissão%', 'mensagem: ' || sqlerrm;
  end;
  -- supervisor vê a equipe com ligações por hora
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e601', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e601', true);
  select * into r from public.leads_atividade_equipe2() a where a.dono_id = '00000000-0000-0000-0000-00000000e602';
  assert r.tem_telefonia and r.pode_pegar, 'consultor com telefonia e pode_pegar';
  assert array_length(r.lig_por_hora, 1) = 8, 'oito horas (13h a 20h): ' || array_length(r.lig_por_hora, 1);
  assert r.lig_por_hora[2] = 1 and r.lig_por_hora[3] = 2, 'uma às 14h e duas às 15h (usuário com caixa e espaço diferentes): ' || r.lig_por_hora::text;
  assert r.lig_hoje = 3, 'lig_hoje conta as três: ' || r.lig_hoje;
  assert (select sum(x) from unnest(r.lig_por_hora) x) <= r.lig_hoje, 'soma das horas não passa de lig_hoje';
  assert r.meta_dia > 0, 'meta diária positiva';
  select * into r from public.leads_atividade_equipe2() a where a.dono_id = '00000000-0000-0000-0000-00000000e603';
  assert not r.tem_telefonia and not r.pode_pegar and r.lig_por_hora = array[0,0,0,0,0,0,0,0], 'sem telefonia: zero em todas as horas';
  raise notice 'leads_atividade_equipe2_check OK';
end $$;
rollback;
```

- [ ] **Step 3: Provar a consulta só lendo (sem criar nada)**

Rodar no Supabase, com `execute_sql`, a consulta abaixo. Ela é o corpo da função sem a checagem de papel e **só lê**:

```sql
with eq as (
  select e.profile_id as e_id, p.nome as e_nome, nullif(lower(btrim(coalesce(e.usuario_telefonia, ''))), '') as e_u
    from public.leads_equipe e join public.profiles p on p.id = e.profile_id where e.profile_id is not null
), lig as (
  select lower(btrim(m.usuario)) as l_u, m.gerada_em as l_em from public.ligacoes_manuais m
   where m.gerada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'
)
select eq.e_nome, eq.e_u is not null as tel,
       (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u)::int as lig_hoje,
       array(select (select count(*) from lig where eq.e_u is not null and lig.l_u = eq.e_u and extract(hour from lig.l_em at time zone 'America/Sao_Paulo') = h.h)::int
               from generate_series(13, 20) as h(h) order by h.h) as por_hora,
       (select nullif(cfg.valor::jsonb ->> 'meta_ligacoes_dia', '')::int from public.config cfg where cfg.chave = 'monitor_leads_metas') as meta_cfg
  from eq order by 1;
```

Expected:
- uma linha por pessoa da `leads_equipe`;
- `por_hora` com 8 números, somando no máximo `lig_hoje` (as ligações antes das 13h não entram nas horas);
- `meta_cfg` com um número ou nulo (nulo vira 80).

Anotar no ledger um resumo: nome de consultor pode, **dado de cliente não**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261028200000_leads_atividade_equipe2.sql supabase/tests/leads_atividade_equipe2_check.sql
git commit -m "feat(meus-leads): funcao leads_atividade_equipe2 com ligacoes por hora e meta (secao 126.3, ainda nao aplicada)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Funções puras da Equipe e do "Passar para"

**Files:**
- Create: `test_meus_leads_fase3.js`, com o mesmo esqueleto de `test_meus_leads_fase2.js`:
  1. copiar as linhas 1 a 54, que terminam em `  const SP = (s) => Date.parse(s + '-03:00');`;
  2. logo depois, a linha `  // ==== mais testes entram aqui ====`;
  3. em seguida, o fechamento do mesmo arquivo, de `  console.log('--- RESULTADO` até o fim;
  4. trocar a primeira linha do comentário por `// Testa o §126.3 (redesign de Meus leads, Fase 3: Equipe).`.
- Modify: `_template.html`, com um bloco novo logo depois do `}` que fecha `function kbSalvarDensidade(`.

**Interfaces:**
- Consumes, já existentes:
  - `kbPartesSP(ms) → {dia, hora, min, dow}`;
  - `kbAtividade(ultLig, ultObs, agoraMs) → {cor:'verde'|'amarelo'|'vermelho'|'cinza', min}`;
  - `KB_EXPEDIENTE = {ini: 780, fim: 1260}`;
  - `kbMs`;
  - `kbTempoDesde(iso, agoraMs) → 'há N min'`.
- Produces:
  - `kbDuracaoMin(min) → string`;
  - `kbAgoraEquipe(a, agoraMs) → {cor, texto}`;
  - `kbNivelHora(n) → 0..4`;
  - `kbHoraAtualIdx(agoraMs) → -1..8`;
  - `kbCorBarraLig(lig, meta, agoraMs) → 'red'|'green'|''`;
  - `kbFaixasAtencao(atividade, cont, agoraMs) → [{dono_id, nome, min, sem_contato}]`;
  - `kbKpisEquipe(atividade, leads, cont, agoraMs) → {lig, meta, livres, livreAntigo, semContato, retornosAtras, vendas, receita}`;
  - `kbMenosCarga(pessoas:[{id,nome}], carga:{id:n}) → id|null`;
  - `kbDividirIgual(chaves, pessoas, carga) → [{chave, para}]`.

- [ ] **Step 1: Escrever os testes**

No `test_meus_leads_fase3.js`, no lugar do `// ==== mais testes entram aqui ====`:

```js
  // ==== Task 2: funções puras ====
  eq([kbDuracaoMin(5), kbDuracaoMin(38), kbDuracaoMin(60), kbDuracaoMin(72), kbDuracaoMin(null)], ['5 min', '38 min', '1 h', '1 h 12 min', ''], 'duração em minutos');
  const ag = SP('2026-10-28T15:00:00');   // quarta
  const at = (o) => Object.assign({ dono_id: 'u1', nome: 'Zz Um', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 }, o);
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:56:00-03:00' }), ag), { cor: 'verde', texto: 'ligou há 4 min' }, 'verde: ligou há pouco');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:00:00-03:00', ultima_obs: '2026-10-28T14:51:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 9 min' }, 'verde: a ação mais recente é a OBS');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T14:22:00-03:00' }), ag), { cor: 'amarelo', texto: 'parado 38 min' }, 'amarelo: parado 38 min');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-28T13:48:00-03:00' }), ag), { cor: 'vermelho', texto: 'parado 1 h 12 min' }, 'vermelho: parado 1 h 12 min');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-28T14:55:00-03:00' }), ag), { cor: 'verde', texto: 'OBS há 5 min' }, 'sem telefonia, com OBS recente: vale a OBS');
  eq(kbAgoraEquipe(at({ tem_telefonia: false }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: sem telefonia e sem OBS hoje');
  eq(kbAgoraEquipe(at({ tem_telefonia: false, ultima_obs: '2026-10-27T20:00:00-03:00' }), ag), { cor: 'cinza', texto: 'sem telefonia' }, 'RF4: OBS de ontem não conta');
  eq(kbAgoraEquipe(at({ ultima_ligacao: '2026-10-27T20:50:00-03:00' }), SP('2026-10-28T13:10:00')), { cor: 'verde', texto: 'nenhuma ação ainda' }, 'RF4: 13:10 sem nada hoje (a ligação de ontem não conta)');
  eq(kbAgoraEquipe(at({}), SP('2026-10-31T15:00:00')), { cor: 'cinza', texto: 'fora do expediente' }, 'RF4: sábado');
  eq(kbAgoraEquipe(at({}), SP('2026-10-28T12:30:00')).cor, 'cinza', 'RF4: antes das 13h');
  eq([0, 1, 4, 5, 9, 10, 14, 15, 40].map(kbNivelHora), [0, 1, 1, 2, 2, 3, 3, 4, 4], 'nível da hora no mapa');
  eq([kbHoraAtualIdx(SP('2026-10-28T12:59:00')), kbHoraAtualIdx(SP('2026-10-28T13:00:00')), kbHoraAtualIdx(ag), kbHoraAtualIdx(SP('2026-10-28T20:59:00')), kbHoraAtualIdx(SP('2026-10-28T21:30:00'))], [-1, 0, 2, 7, 8], 'hora atual no mapa (13h = 0)');
  eq([kbCorBarraLig(5, 80, ag), kbCorBarraLig(30, 80, ag), kbCorBarraLig(10, 80, ag), kbCorBarraLig(0, 80, SP('2026-10-28T12:00:00')), kbCorBarraLig(0, 80, SP('2026-10-31T15:00:00')), kbCorBarraLig(5, 0, ag)],
     ['red', 'green', '', '', '', ''], 'RF4: barra vermelha < 30% da meta proporcional, verde > 70%, neutra antes das 13h, no fim de semana e sem meta');
  const cont = { u1: { sem_contato: 4, andamento: 11, parados3: 3, retornos_atrasados: 2, convertidos: 3, receita: 300, pegos_mes: 30 }, u2: { sem_contato: 0, andamento: 5, parados3: 0, retornos_atrasados: 0, convertidos: 1, receita: 50.5, pegos_mes: 8 } };
  const ativ = [at({ dono_id: 'u1', nome: 'Zz Lucas', ultima_ligacao: '2026-10-28T13:48:00-03:00', lig_hoje: 19, meta_dia: 80 }), at({ dono_id: 'u2', nome: 'Zz Luria', ultima_ligacao: '2026-10-28T14:55:00-03:00', lig_hoje: 57, meta_dia: 80 }), at({ dono_id: 'u3', nome: 'Zz Vitoria', tem_telefonia: false })];
  eq(kbFaixasAtencao(ativ, cont, ag), [{ dono_id: 'u1', nome: 'Zz Lucas', min: 72, sem_contato: 4 }], 'faixa de atenção: só quem está vermelho (sem telefonia sem OBS não entra)');
  const LE = [{ livre: true, criado_em_lead: '2026-10-28T14:35:00-03:00' }, { livre: true, criado_em_lead: '2026-10-28T14:50:00-03:00' }, { livre: false, dono_id: 'u1' }];
  eq(kbKpisEquipe(ativ, LE, cont, ag), { lig: 76, meta: 160, livres: 2, livreAntigo: '2026-10-28T14:35:00-03:00', semContato: 4, retornosAtras: 2, vendas: 4, receita: 350.5 }, 'números do topo: meta × consultores com telefonia');
  const pes = [{ id: 'a', nome: 'Zz Caio' }, { id: 'b', nome: 'Zz Ana' }, { id: 'c', nome: 'Zz Bia' }];
  eq(kbMenosCarga(pes, { a: 5, b: 9, c: 5 }), 'c', 'menos carga; empate pelo nome (Zz Bia antes de Zz Caio)');
  eq(kbMenosCarga(pes, {}), 'b', 'sem carga conhecida: o primeiro em ordem alfabética');
  eq(kbMenosCarga([], {}), null, 'ninguém');
  eq(kbDividirIgual(['k1', 'k2', 'k3', 'k4'], pes, { a: 1, b: 0, c: 3 }).map(x => x.para), ['b', 'b', 'a', 'b'], 'dividir igual: cada lead vai para quem está com menos (somando o que já recebeu; empate pelo nome)');
  eq(kbDividirIgual(['k1'], [], {}), [], 'dividir sem ninguém: nada');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase3.js 2>&1 | head -3`
Expected: uma linha com `kbDuracaoMin is not defined`.

- [ ] **Step 3: Implementar**

Inserir em `_template.html`, logo depois do `}` que fecha `function kbSalvarDensidade(`:

```js
// ===== §126.3 (Fase 3): Equipe e "Passar para" — funções puras =====
function kbDuracaoMin(min){
  if(min === null || min === undefined || isNaN(min)) return '';
  const m = Math.max(0, Math.round(min)), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ' ' + r + ' min' : ''}` : `${m} min`;
}
// Semáforo escrito da Equipe (spec 5.1): verde diz a última ação de hoje; amarelo/vermelho dizem há quanto tempo está parado.
// Sem telefonia vale só a OBS; sem OBS hoje fica cinza ("sem telefonia"), porque não há como medir.
function kbAgoraEquipe(a, agoraMs){
  const s = kbAtividade(a.ultima_ligacao, a.ultima_obs, agoraMs);
  if(s.cor === 'cinza') return { cor: 'cinza', texto: 'fora do expediente' };
  const ini = Date.parse(kbPartesSP(agoraMs).dia + 'T00:00:00-03:00') + KB_EXPEDIENTE.ini * 60000;
  const deHoje = (v) => { const t = kbMs(v); return t !== null && t >= ini ? t : null; };
  const tl = a.tem_telefonia ? deHoje(a.ultima_ligacao) : null, to = deHoje(a.ultima_obs);
  if(!a.tem_telefonia && to === null) return { cor: 'cinza', texto: 'sem telefonia' };
  if(s.cor !== 'verde') return { cor: s.cor, texto: 'parado ' + kbDuracaoMin(s.min) };
  if(tl === null && to === null) return { cor: 'verde', texto: 'nenhuma ação ainda' };
  return to !== null && (tl === null || to > tl) ? { cor: 'verde', texto: 'OBS ' + kbTempoDesde(a.ultima_obs, agoraMs) } : { cor: 'verde', texto: 'ligou ' + kbTempoDesde(a.ultima_ligacao, agoraMs) };
}
// Mapa de ligações por hora: 0, 1–4, 5–9, 10–14, 15+ (a meta de 80/dia dá 10 por hora).
function kbNivelHora(n){ const x = Number(n) || 0; return x <= 0 ? 0 : x < 5 ? 1 : x < 10 ? 2 : x < 15 ? 3 : 4; }
// Hora atual no mapa: -1 antes das 13h, 0 = 13h … 7 = 20h, 8 depois das 21h.
function kbHoraAtualIdx(agoraMs){ const h = Math.floor(kbPartesSP(agoraMs).min / 60); return h < 13 ? -1 : h > 20 ? 8 : h - 13; }
// Barra de "Hoje": vermelha abaixo de 30% da meta proporcional à hora do expediente (13h–21h, seg–sex), verde acima de 70%.
function kbCorBarraLig(lig, meta, agoraMs){
  const p = kbPartesSP(agoraMs);
  if(!meta || p.dow === 0 || p.dow === 6) return '';
  const f = Math.min(1, Math.max(0, (p.min - KB_EXPEDIENTE.ini) / (KB_EXPEDIENTE.fim - KB_EXPEDIENTE.ini)));
  if(f <= 0) return '';
  const r = (Number(lig) || 0) / (meta * f);
  return r < 0.3 ? 'red' : r > 0.7 ? 'green' : '';
}
function kbFaixasAtencao(atividade, cont, agoraMs){
  return (atividade || []).filter(a => kbAgoraEquipe(a, agoraMs).cor === 'vermelho')
    .map(a => ({ dono_id: a.dono_id, nome: a.nome || '', min: kbAtividade(a.ultima_ligacao, a.ultima_obs, agoraMs).min, sem_contato: ((cont || {})[a.dono_id] || {}).sem_contato || 0 }));
}
function kbKpisEquipe(atividade, leads, cont, agoraMs){
  const comTel = (atividade || []).filter(a => a.tem_telefonia), c = Object.values(cont || {});
  const livres = (leads || []).filter(l => l.livre), datas = livres.map(l => l.criado_em_lead).filter(Boolean).sort((x, y) => (kbMs(x) || 0) - (kbMs(y) || 0));
  return { lig: comTel.reduce((s, a) => s + (Number(a.lig_hoje) || 0), 0), meta: comTel.reduce((s, a) => s + (Number(a.meta_dia) || 80), 0),
    livres: livres.length, livreAntigo: datas[0] || null,
    semContato: c.reduce((s, x) => s + (x.sem_contato || 0), 0), retornosAtras: c.reduce((s, x) => s + (x.retornos_atrasados || 0), 0),
    vendas: c.reduce((s, x) => s + (x.convertidos || 0), 0), receita: Math.round(c.reduce((s, x) => s + (Number(x.receita) || 0), 0) * 100) / 100 };
}
// "Passar para": quem está com menos carga (empate pelo nome) e a divisão igual (cada lead vai para quem estiver com menos naquele momento).
function kbMenosCarga(pessoas, carga){
  const cg = carga || {};
  const lista = (pessoas || []).slice().sort((x, y) => (cg[x.id] || 0) - (cg[y.id] || 0) || String(x.nome).localeCompare(String(y.nome)));
  return lista.length ? lista[0].id : null;
}
function kbDividirIgual(chaves, pessoas, carga){
  if(!(pessoas || []).length) return [];
  const atual = {}; pessoas.forEach(p => { atual[p.id] = (carga || {})[p.id] || 0; });
  return (chaves || []).map(chave => { const para = kbMenosCarga(pessoas, atual); atual[para] += 1; return { chave, para }; });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_meus_leads_fase3.js`
Expected: `--- RESULTADO: N passaram, 0 falharam ---`

- [ ] **Step 5: Commit**

```bash
git add _template.html test_meus_leads_fase3.js
git commit -m "feat(meus-leads): funcoes puras da Equipe (semaforo escrito, mapa por hora, meta, menos carga) (secao 126.3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tela da Equipe

**Files:**
- Modify `_template.html`:
  - **JS:** `kbEstado` (estado inicial), `kbCarregarEquipe`, `kbRenderEquipe`, `kbListaCartaoHtml` e os cliques da Equipe no listener do `#panel-meusleads`;
  - **CSS:** entra a Equipe nova e sai o CSS da tabela antiga.
- Modify: `test_leads_painel_hoje.js` e `test_leads_hoje.js` (tabela antiga).
- Test: `test_meus_leads_fase3.js`

**Interfaces:**
- Consumes:
  - da Task 2: `kbAgoraEquipe`, `kbNivelHora`, `kbHoraAtualIdx`, `kbCorBarraLig`, `kbFaixasAtencao`, `kbKpisEquipe` e `kbDuracaoMin`;
  - já existentes: `kbContagemEquipe`, `kbListaDoCartao(chave, leads, retornos, agoraMs)`, `kbAtividadeTexto`, `kbConversao`, `kbMoeda`, `kbIniciais`, `kbColunaDoLead` e `KB_EQ_TITULOS`.
- Produces:
  - **Estado:**
    - `kbEstado.atividadeV2`: true quando veio da função nova;
    - `kbEstado.equipeLista = {dono, chave}`, com `dono = ''` para a equipe toda;
    - `kbEstado.loteSel`: `Set` de `'aba|id'`.
  - **Atributos:**
    - `[data-kb-eqk]` (números do topo);
    - `[data-kb-eq-redist="dono"]` (faixa);
    - `[data-kb-lote="aba|id"]` e `[data-kb-lote-todos]`;
    - `#kbLoteBarra`, com `[data-kb-lote-limpar]`, `[data-kb-lote-livres]` e `[data-kb-lote-passar]`;
    - `[data-kb-passar-um="aba|id"]`.
    - As ações do menu ficam para a Task 4.
  - `kbListaCartaoHtml(itens, max, opc?: {lote:boolean, sel:Set})`.

- [ ] **Step 1: Escrever os testes**

No `test_meus_leads_fase3.js`, no lugar do `// ==== mais testes entram aqui ====`:

```js
  // ==== Task 3: tela da Equipe (relógio fixo: quarta 15:00) ====
  const dnReal = Date.now, agE = SP('2026-10-28T15:00:00');
  Date.now = () => agE;
  const isoE = (min) => new Date(agE + min * 60000).toISOString();
  currentUser = { id: 'u-sup', nome: 'Zzksup Teste', role: 'supervisor', operacao: 'apex' };
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u1', nome_planilha: 'ZZLUCAS', pode_pegar: true }, { id: 2, profile_id: 'u2', nome_planilha: 'ZZLURIA', pode_pegar: true }];
  window.__tabelas.leads_status_opcoes = [{ status: 'EM NEGOCIAÇÂO', grupo: 'andamento', ordem: 1 }];
  const LQ = [
    { aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: isoE(-100) },
    { aba: 'O', lead_id: 's2', nome: 'Zz Sem Dois', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'sem_contato', livre: false, pego_em: isoE(-90) },
    { aba: 'O', lead_id: 'a1', nome: 'Zz Andando', dono_id: 'u1', dono_nome: 'Zz Lucas', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 1, ultima_ligacao: isoE(-60), pego_em: isoE(-600) },
    { aba: 'O', lead_id: 'a2', nome: 'Zz Andando Dois', dono_id: 'u2', dono_nome: 'Zz Luria', categoria: 'andamento', status: 'EM NEGOCIAÇÂO', livre: false, ligacoes: 1, ultima_ligacao: isoE(-30), pego_em: isoE(-600) },
    { aba: 'O', lead_id: 'lv', nome: 'Zz Livre', categoria: 'sem_contato', livre: true, criado_em_lead: isoE(-25) },
  ];
  const ATV = [
    { dono_id: 'u1', nome: 'Zz Lucas', tem_telefonia: true, ultima_ligacao: isoE(-75), lig_hoje: 19, ultima_obs: null, obs_hoje: 0, lig_por_hora: [6, 3, 0, 0, 0, 0, 0, 0], meta_dia: 80, pode_pegar: true },
    { dono_id: 'u2', nome: 'Zz Luria', tem_telefonia: true, ultima_ligacao: isoE(-3), lig_hoje: 57, ultima_obs: isoE(-9), obs_hoje: 4, lig_por_hora: [20, 15, 12, 0, 0, 0, 0, 0], meta_dia: 80, pode_pegar: true },
  ];
  window.__rpcRespostas.leads_kanban3 = { data: LQ, error: null };
  window.__rpcRespostas.leads_alertas = { data: [{ tipo: 'sem_contato', aba: 'O', lead_id: 's1', nome: 'Zz Sem Um', dono_id: 'u1', dono_nome: 'Zz Lucas', desde: isoE(-100) },
    { tipo: 'retorno_vencido', aba: 'O', lead_id: 'a1', nome: 'Zz Andando', dono_id: 'u1', dono_nome: 'Zz Lucas', desde: isoE(-50) },
    { tipo: 'perda_suspeita', aba: 'O', lead_id: 'pz', nome: 'Zz Perdido', dono_id: 'u2', dono_nome: 'Zz Luria', desde: isoE(-500) }], error: null };
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV, error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 1, placar: {} }, error: null };
  await kbAplicarPermissao();
  kbEstado.aba = null; await kbCarregar(); await espera(120);
  const EQ = document.getElementById('kbEquipe');
  assert(kbEstado.aba === 'equipe' && window.__rpcCalls.some(c => c.nome === 'leads_atividade_equipe2') && kbEstado.atividadeV2, 'Equipe usa a função nova');
  eq([...EQ.querySelectorAll('[data-kb-eqk]')].map(b => b.dataset.kbEqk), ['ligacoes', 'livres', 'sem_contato', 'retorno_atrasado', 'convertido'], 'cinco números no topo');
  eq(EQ.querySelector('[data-kb-eqk="ligacoes"] .kbNumGrande').textContent.replace(/\\s+/g, ' ').trim(), '76 / 160', 'ligações da equipe / meta × consultores com telefonia');
  assert(EQ.querySelector('[data-kb-eqk="livres"] .kbNumGrande').textContent === '1' && EQ.querySelector('[data-kb-eqk="livres"]').textContent.includes('mais antigo há 25 min'), 'livres com o mais antigo');
  eq(EQ.querySelector('[data-kb-eqk="sem_contato"] .kbNumGrande').textContent, '2', 'pegos e sem contato');
  const faixa = EQ.querySelector('.kbEqAtencao');
  assert(faixa && faixa.textContent.includes('Zz Lucas está há 1 h 15 min sem ligar nem escrever OBS') && faixa.textContent.includes('2 leads sem contato'), 'faixa de atenção com o texto da spec');
  assert(faixa.querySelector('[data-kb-eq="u1|sem_contato"]').textContent.includes('Ver os leads dele') && faixa.querySelector('[data-kb-eq-redist="u1"]').textContent.includes('Redistribuir 2'), 'faixa com Ver os leads dele e Redistribuir N');
  assert(EQ.querySelectorAll('.kbEqAtencao').length === 1, 'só uma faixa (Luria está verde)');
  const linha1 = EQ.querySelector('tr[data-kb-dono="u1"]');
  assert(linha1.querySelector('.kbEqSem.r .kbSemaforo') && linha1.textContent.includes('parado 1 h 15 min'), 'semáforo escrito vermelho, com a bolinha');
  eq([...linha1.querySelectorAll('.kbCalor i')].map(i => i.className), ['l2', 'l1', 'l0', 'fut', 'fut', 'fut', 'fut', 'fut'], 'mapa por hora: 6 → l2, 3 → l1, a hora atual conta, as futuras vazadas');
  assert(linha1.querySelector('.kbEqHoje').textContent.includes('19') && linha1.querySelector('.kbEqHoje').textContent.includes('/ 80') && linha1.textContent.includes('19 hoje') && linha1.textContent.includes('pega leads'), 'Hoje: ligações / meta; atividade em texto pequeno; pega leads');
  assert(EQ.querySelector('tr[data-kb-dono="u2"] .kbEqSem.v').textContent.includes('ligou há 3 min'), 'verde: ligou há 3 min');
  assert(linha1.querySelector('[data-kb-eq="u1|sem_contato"].ruim') && !EQ.querySelector('tr[data-kb-dono="u2"] [data-kb-eq="u2|sem_contato"]'), 'número com problema em vermelho; zero não é botão');
  eq([...EQ.querySelectorAll('.kbEqAlertas .kbEqBloco h3')].map(h => h.firstChild.textContent.trim()), ['Pegos e sem contato', 'Retornos atrasados', 'Perdidos sem nenhuma ligação'], 'alertas em três blocos');
  assert(EQ.querySelector('.kbEqAlertas [data-kb-passar-um="O|s1"]') && EQ.querySelectorAll('.kbEqAlertas .kbEqBloco')[1].querySelector('[data-kb-abrir="O|a1"]'), 'Passar no bloco sem contato; Abrir nos outros');
  // números e faixa abrem a lista com seleção
  faixa.querySelector('[data-kb-eq-redist="u1"]').click();
  const barra = () => document.getElementById('kbLoteBarra');
  assert(kbEstado.equipeLista.dono === 'u1' && kbEstado.equipeLista.chave === 'sem_contato' && kbEstado.loteSel.size === 2 && !barra().hidden && barra().textContent.includes('2 leads selecionados'), 'Redistribuir N abre a lista com os sem contato dele já selecionados');
  assert(barra().querySelector('[data-kb-lote-livres]') && barra().querySelector('[data-kb-lote-passar]'), 'barra escura com Devolver aos livres e Passar para…');
  EQ.querySelector('[data-kb-lote="O|s2"]').click();
  assert(kbEstado.loteSel.size === 1 && barra().textContent.includes('1 lead selecionado') && !EQ.querySelector('[data-kb-lote="O|s2"]').checked, 'desmarcar tira da seleção');
  EQ.querySelector('[data-kb-lote-todos]').click();
  eq(kbEstado.loteSel.size, 2, 'Selecionar todos');
  EQ.querySelector('[data-kb-lote-limpar]').click();
  assert(kbEstado.loteSel.size === 0 && barra().hidden, 'Limpar seleção esconde a barra');
  EQ.querySelector('[data-kb-eqk="sem_contato"]').click();
  assert(kbEstado.equipeLista.dono === '' && EQ.querySelector('.kbEqLista h3').textContent === 'Equipe · Sem contato' && EQ.querySelector('.kbEqLista').textContent.includes('Zz · pego'), 'número do topo abre a lista da equipe toda, com o primeiro nome do dono');
  EQ.querySelector('[data-kb-eq-fechar]').click();
  assert(!EQ.querySelector('.kbEqLista') && kbEstado.loteSel.size === 0, 'Fechar tira a lista e a seleção');
  // RF1: sem a função nova, cai para a antiga (sem mapa por hora)
  window.__rpcRespostas.leads_atividade_equipe2 = { data: null, error: { message: 'function public.leads_atividade_equipe2() does not exist' } };
  window.__rpcRespostas.leads_atividade_equipe = { data: ATV.map(a => { const b = Object.assign({}, a); delete b.lig_por_hora; delete b.meta_dia; delete b.pode_pegar; return b; }), error: null };
  await kbCarregarEquipe();
  assert(!kbEstado.atividadeV2 && EQ.querySelector('tr[data-kb-dono="u1"] .kbCalorSem') && EQ.querySelector('[data-kb-eqk="ligacoes"]').textContent.includes('160') && EQ.querySelector('tr[data-kb-dono="u1"] .kbEqSem.r'), 'RF1: sem a função nova a Equipe abre com a antiga (mapa "—", meta padrão 80, semáforo igual)');
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV, error: null };
  await kbCarregarEquipe();
  // ==== mais testes entram aqui ====
```

E logo antes da linha `  console.log('--- RESULTADO`, inserir `  Date.now = dnReal;`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase3.js 2>&1 | grep -E "FALHOU|RESULTADO|FALHA" | head`
Expected: entre as falhas, `FALHOU: Equipe usa a função nova`.

- [ ] **Step 3: JS**

1. No `const kbEstado = { … consultores: [] };`, trocar o final `consultores: [] };` por `consultores: [], loteSel: new Set(), passar: null };`.

2. Trocar `kbCarregarEquipe` inteira, de `async function kbCarregarEquipe(notificar){` até o `}` antes do comentário `// §122: uma linha por consultor`, por:

```js
async function kbCarregarEquipe(notificar){
  if(!kbGestor()) return;
  const [lds, at, ale] = await Promise.all([
    ppSeguro(() => sb.rpc('leads_kanban3', { p_dono: null, p_todos: false })),
    ppSeguro(() => sb.rpc('leads_atividade_equipe2')),   // §126.3: com ligações por hora, meta e pode_pegar
    ppSeguro(() => sb.rpc('leads_alertas', { p_dono: null })),   // a Equipe é sempre da equipe toda, mesmo com consultor no seletor
    kbCarregarAlertas(!!notificar),
  ]);
  let atv = at;
  kbEstado.atividadeV2 = !!(at && !at.error);
  if(!kbEstado.atividadeV2) atv = await ppSeguro(() => sb.rpc('leads_atividade_equipe'));   // banco ainda sem a função nova: abre sem o mapa por hora
  if(lds && !lds.error) kbEstado.leadsEquipe = lds.data || [];
  if(ale && !ale.error) kbEstado.alertasEquipe = ale.data || [];
  if(atv && !atv.error) kbEstado.atividade = atv.data || [];
  kbRenderEquipe();
}
```

3. Trocar `kbListaCartaoHtml` inteira por:

```js
function kbListaCartaoHtml(itens, max, opc){
  const o = opc || {}, sel = o.sel || new Set();
  const lista = (itens || []).slice(0, max);
  const li = lista.map(i => {
    const k = escapeHtml(i.aba + '|' + i.lead_id);
    const caixa = o.lote ? `<label class="kbLoteCheck"><input type="checkbox" data-kb-lote="${k}"${sel.has(i.aba + '|' + i.lead_id) ? ' checked' : ''} aria-label="Selecionar ${escapeHtml(i.nome || 'lead')}"></label>` : '';
    const passar = o.lote ? `<button type="button" class="kbBtn kbBtnQ kbBtnSm kbLiPassar" data-kb-passar-um="${k}">Passar</button>` : '';
    return `<li>${caixa}<button type="button" class="kbLink" data-kb-abrir="${escapeHtml(i.aba)}|${escapeHtml(i.lead_id)}">${escapeHtml(i.nome || '(sem nome)')}</button>${i.detalhe ? `<span class="kbMeta">${escapeHtml(i.detalhe)}</span>` : ''}${passar}</li>`;
  }).join('');
  const mais = itens.length > lista.length ? `<li><button type="button" class="kbLink" data-kb-cartao-mais>Ver mais (${itens.length - lista.length})</button></li>` : '';
  return `<ul class="kbLista kbCartaoLista">${li || '<li class="kbMeta">Nada aqui.</li>'}${mais}</ul>`;
}
```

4. Trocar `kbRenderEquipe` inteira, do comentário `// §122: uma linha por consultor …` até o `}` antes de `const KB_EQ_TITULOS`, por:

```js
// §126.3: Equipe — números do topo, faixa de atenção, tabela com semáforo escrito e mapa por hora, lista com seleção em lote, alertas em três blocos.
function kbRenderEquipe(){
  const alEq = kbEstado.alertasEquipe || kbEstado.alertas || [];   // alertas da equipe toda (não os do consultor escolhido no seletor)
  const agoraMs = Date.now(), ativ = kbEstado.atividade || [], cont = kbContagemEquipe(kbEstado.leadsEquipe, alEq, agoraMs);
  const k = kbKpisEquipe(ativ, kbEstado.leadsEquipe, cont, agoraMs);
  const kpi = (chave, n, rot, extra, cls) => `<button type="button" class="kbEqKpi${cls ? ' ' + cls : ''}" data-kb-eqk="${chave}"><strong class="kbNumGrande">${n}</strong><span>${rot}</span>${extra || ''}</button>`;
  const pct = k.meta ? Math.min(100, Math.round(100 * k.lig / k.meta)) : 0;
  const topo = '<div class="kbEqTopo">'
    + kpi('ligacoes', `${k.lig}<span class="kbMetaN"> / ${k.meta}</span>`, 'ligações da equipe hoje', `<span class="kbMedidor"><i style="width:${pct}%"></i></span>`)
    + kpi('livres', k.livres, 'leads livres', k.livreAntigo ? `<small>mais antigo ${escapeHtml(kbTempoDesde(k.livreAntigo, agoraMs))}</small>` : '', k.livres ? 'alerta' : '')
    + kpi('sem_contato', k.semContato, 'pegos e sem contato', '', k.semContato ? 'alerta' : '')
    + kpi('retorno_atrasado', k.retornosAtras, 'retornos atrasados', '', k.retornosAtras ? 'alerta' : '')
    + kpi('convertido', k.vendas, 'vendas no mês', `<small>${escapeHtml(kbMoeda(k.receita) || 'R$ 0,00')}</small>`) + '</div>';
  const faixas = kbFaixasAtencao(ativ, cont, agoraMs).map(f => `<div class="kbEqAtencao"><span class="kbEqAv">${escapeHtml(kbIniciais(f.nome))}</span>
      <span><b>${escapeHtml(f.nome)} está há ${escapeHtml(kbDuracaoMin(f.min))} sem ligar nem escrever OBS</b>${f.sem_contato ? ` e tem ${f.sem_contato} lead${f.sem_contato === 1 ? '' : 's'} sem contato` : ''}.</span>
      <span class="kbEqAtencaoAcoes"><button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-eq="${escapeHtml(f.dono_id)}|sem_contato">Ver os leads dele</button>${f.sem_contato ? `<button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-eq-redist="${escapeHtml(f.dono_id)}">Redistribuir ${f.sem_contato}</button>` : ''}</span></div>`).join('');
  const atual = kbHoraAtualIdx(agoraMs);
  const num = (dono, chave, n, ruim) => n ? `<button type="button" class="kbEqNum${ruim ? ' ruim' : ''}" data-kb-eq="${escapeHtml(dono)}|${chave}">${n}</button>` : '<span class="kbEqNum zero">0</span>';
  const linhas = ativ.map(a => {
    const c = cont[a.dono_id] || { sem_contato: 0, andamento: 0, parados3: 0, retornos_atrasados: 0, convertidos: 0, receita: 0, pegos_mes: 0 };
    const s = kbAgoraEquipe(a, agoraMs), t = kbAtividadeTexto(a, agoraMs), meta = Number(a.meta_dia) || 80, lig = Number(a.lig_hoje) || 0;
    const corCls = { verde: 'v', amarelo: 'a', vermelho: 'r' }[s.cor] || 'c';
    const calor = Array.isArray(a.lig_por_hora)
      ? `<span class="kbCalor" title="Ligações por hora, das 13h às 21h">${a.lig_por_hora.slice(0, 8).map((n, i) => `<i class="${i > atual ? 'fut' : 'l' + kbNivelHora(n)}" title="${13 + i}h: ${Number(n) || 0}"></i>`).join('')}</span>`
      : '<span class="kbCalorSem kbMuted">—</span>';
    const hoje = a.tem_telefonia
      ? `<b>${lig}</b><span class="kbMuted"> / ${meta}</span><span class="kbMedidor kbMed-${kbCorBarraLig(lig, meta, agoraMs) || 'neutro'}"><i style="width:${Math.min(100, Math.round(100 * lig / meta))}%"></i></span>`
      : '<span class="kbMuted">—</span>';
    const pega = a.pode_pegar === true ? 'pega leads' : a.pode_pegar === false ? 'só os que já tem' : '';
    return `<tr data-kb-dono="${escapeHtml(a.dono_id)}"><td><span class="kbEqPessoa"><span class="kbEqAv">${escapeHtml(kbIniciais(a.nome))}</span><span><b>${escapeHtml(a.nome || '')}</b>${pega ? `<small>${pega}</small>` : ''}</span></span></td>
      <td><span class="kbEqSem ${corCls}"><span class="kbSemaforo"></span>${escapeHtml(s.texto)}</span><small class="kbEqAtivTxt">${escapeHtml(t.lig)} · ${escapeHtml(t.obs)}</small></td>
      <td>${calor}</td><td class="kbEqHoje">${hoje}</td>
      <td class="r">${num(a.dono_id, 'sem_contato', c.sem_contato, true)}</td><td class="r">${num(a.dono_id, 'andamento', c.andamento)}</td>
      <td class="r">${num(a.dono_id, 'parados3', c.parados3, true)}</td><td class="r">${num(a.dono_id, 'retorno_atrasado', c.retornos_atrasados, true)}</td>
      <td class="r">${num(a.dono_id, 'convertido', c.convertidos)}</td><td class="r kbEqConv">${kbConversao({ pegos_mes: c.pegos_mes, convertidos_mes: c.convertidos })}</td></tr>`;
  }).join('');
  const tabela = `<div class="kbEqTabela"><table><thead><tr><th>Consultor</th><th>Agora</th><th>Ligações por hora (13h–21h)</th><th>Hoje</th><th class="r">Sem contato</th><th class="r">Em andamento</th><th class="r">Parados 3+ d</th><th class="r">Retornos atras.</th><th class="r">Vendas mês</th><th class="r">Conversão</th></tr></thead>
    <tbody>${linhas || '<tr><td colspan="10" class="kbMuted">Sem consultores na equipe de leads.</td></tr>'}</tbody></table>
    <p class="kbEqLegenda">Verde: ligou ou escreveu OBS há menos de 30 min · amarelo: 30 min · vermelho: 1 h. Conta de 13h às 21h, seg–sex. Ligações chegam do ProContact de hora em hora; a última ligação pode estar até 1 h atrasada. Clique num número para ver os leads e selecionar para redistribuir.</p></div>`;
  const sel = kbEstado.equipeLista;
  let lista = '';
  if(sel){
    const leadsDono = (kbEstado.leadsEquipe || []).filter(l => !l.livre && (!sel.dono || l.dono_id === sel.dono));
    const ret = alEq.filter(a => a.tipo === 'retorno_vencido' && (!sel.dono || a.dono_id === sel.dono)).map(a => ({ aba: a.aba, lead_id: a.lead_id, nome: a.nome, quando: a.desde, vencido: true, dono_nome: a.dono_nome }));
    const quem = sel.dono ? ((ativ.find(a => a.dono_id === sel.dono) || {}).nome || '') : 'Equipe';
    const primeiro = (n) => String(n || '').split(/\s+/)[0];
    const itens = kbListaDoCartao(sel.chave, leadsDono, ret, agoraMs).map(i => {
      if(sel.dono) return i;
      const l = leadsDono.find(x => x.aba === i.aba && x.lead_id === i.lead_id) || ret.find(x => x.aba === i.aba && x.lead_id === i.lead_id) || {};
      return Object.assign({}, i, { detalhe: [primeiro(l.dono_nome), i.detalhe].filter(Boolean).join(' · ') });
    });
    lista = `<div class="kbEqLista"><div class="kbEqListaTopo"><h3>${escapeHtml(quem)} · ${escapeHtml(KB_EQ_TITULOS[sel.chave] || '')}</h3><button type="button" class="kbLink" data-kb-lote-todos>Selecionar todos</button><button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-eq-fechar>Fechar</button></div>${kbListaCartaoHtml(itens, kbEstado.equipeMax || 50, { lote: true, sel: kbEstado.loteSel })}</div>`;
  }
  const n = kbEstado.loteSel.size;
  const todosSemStatus = n > 0 && [...kbEstado.loteSel].every(ch => { const l = (kbEstado.leadsEquipe || []).find(x => x.aba + '|' + x.lead_id === ch); return !!l && l.categoria === 'sem_contato'; });
  const lote = `<div class="kbLoteBarra" id="kbLoteBarra"${n ? '' : ' hidden'}><b>${n} lead${n === 1 ? '' : 's'} selecionado${n === 1 ? '' : 's'}</b><span class="kbLoteAcoes"><button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-lote-limpar>Limpar seleção</button>${todosSemStatus ? '<button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-lote-livres>Devolver aos livres</button>' : ''}<button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-lote-passar>Passar para…</button></span></div>`;
  const bloco = (tipo, titulo, comPassar) => {
    const it = alEq.filter(a => a.tipo === tipo);
    const linhasAl = it.slice(0, 5).map(a => {
      const ch = escapeHtml(a.aba) + '|' + escapeHtml(a.lead_id);
      return `<div class="kbEqAlerta"><span><button type="button" class="kbLink" data-kb-abrir="${ch}">${escapeHtml(a.nome || '')}</button><small>${escapeHtml(String(a.dono_nome || '').split(/\s+/)[0])} · ${escapeHtml(kbTempoDesde(a.desde, agoraMs))}</small></span>${comPassar ? `<button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-passar-um="${ch}">Passar</button>` : `<button type="button" class="kbBtn kbBtnQ kbBtnSm" data-kb-abrir="${ch}">Abrir</button>`}</div>`;
    }).join('');
    const verTodos = it.length > 5 && tipo !== 'perda_suspeita' ? `<button type="button" class="kbLink" data-kb-eq="|${tipo === 'retorno_vencido' ? 'retorno_atrasado' : 'sem_contato'}">Ver os ${it.length}</button>` : '';
    return `<div class="kbEqBloco"><h3>${titulo} <span>${it.length}</span></h3>${linhasAl || '<p class="kbMuted">Nada aqui.</p>'}${verTodos}</div>`;
  };
  const alertas = `<div class="kbEqAlertas">${bloco('sem_contato', 'Pegos e sem contato', true)}${bloco('retorno_vencido', 'Retornos atrasados', false)}${bloco('perda_suspeita', 'Perdidos sem nenhuma ligação', false)}</div>`;
  document.getElementById('kbEquipe').innerHTML = topo + faixas + tabela + lista + lote + alertas;
}
```

5. No listener de clique do `#panel-meusleads`, trocar as três linhas atuais:

```js
  if(eqn){ const [dono, chave] = eqn.dataset.kbEq.split('|'); kbEstado.equipeLista = { dono, chave }; kbEstado.equipeMax = 50; kbRenderEquipe(); return; }
  if(e.target.closest('[data-kb-eq-fechar]')){ kbEstado.equipeLista = null; kbRenderEquipe(); return; }
  if(e.target.closest('#kbEquipe [data-kb-cartao-mais]')){ kbEstado.equipeMax = (kbEstado.equipeMax || 50) + 50; kbRenderEquipe(); return; }
```

por:

```js
  if(eqn){ const [dono, chave] = eqn.dataset.kbEq.split('|'); kbEstado.equipeLista = { dono, chave }; kbEstado.equipeMax = 50; kbEstado.loteSel = new Set(); kbRenderEquipe(); return; }
  if(e.target.closest('[data-kb-eq-fechar]')){ kbEstado.equipeLista = null; kbEstado.loteSel = new Set(); kbRenderEquipe(); return; }
  if(e.target.closest('#kbEquipe [data-kb-cartao-mais]')){ kbEstado.equipeMax = (kbEstado.equipeMax || 50) + 50; kbRenderEquipe(); return; }
  // §126.3: números do topo, faixa de atenção e seleção em lote
  const kq = e.target.closest('[data-kb-eqk]');
  if(kq){
    const c = kq.dataset.kbEqk;
    if(c === 'livres'){ kbEstado.dono = ''; const s = document.getElementById('kbDono'); if(s) s.value = ''; kbTrocarAba('quadro'); kbCarregar(); }
    else if(c !== 'ligacoes'){ kbEstado.equipeLista = { dono: '', chave: c }; kbEstado.equipeMax = 50; kbEstado.loteSel = new Set(); kbRenderEquipe(); }
    return;
  }
  const rd = e.target.closest('[data-kb-eq-redist]');
  if(rd){
    const dono = rd.dataset.kbEqRedist;
    kbEstado.equipeLista = { dono, chave: 'sem_contato' }; kbEstado.equipeMax = 50;
    kbEstado.loteSel = new Set((kbEstado.leadsEquipe || []).filter(l => !l.livre && l.dono_id === dono && kbColunaDoLead(l) === 'novos').map(l => l.aba + '|' + l.lead_id));
    kbRenderEquipe(); return;
  }
  const lt = e.target.closest('[data-kb-lote]');
  if(lt){ const k = lt.dataset.kbLote; if(kbEstado.loteSel.has(k)) kbEstado.loteSel.delete(k); else kbEstado.loteSel.add(k); kbRenderEquipe(); return; }
  if(e.target.closest('[data-kb-lote-todos]')){ document.querySelectorAll('#kbEquipe [data-kb-lote]').forEach(x => kbEstado.loteSel.add(x.dataset.kbLote)); kbRenderEquipe(); return; }
  if(e.target.closest('[data-kb-lote-limpar]')){ kbEstado.loteSel = new Set(); kbRenderEquipe(); return; }
```

Sobre a caixa de seleção e a ordem dos ramos:
- A caixa não chama `preventDefault`: o navegador marca e desmarca sozinho, e o redesenho em seguida põe o `checked` certo pelo `kbEstado.loteSel`.
- Todos os ramos novos vêm antes do ramo `#kbEquipe tr[data-kb-dono]`, que leva ao Quadro. A lista e a barra ficam fora da tabela, então não há conflito.

- [ ] **Step 4: CSS**

1. Apagar estas regras:
   - `.kbEquipe h4{…}`;
   - `.kbTabelaEquipe td,.kbTabelaEquipe th{…}`;
   - `.kbTabelaEquipe tbody tr{…}` e o hover dela, se existir;
   - `.kbSemaforo{…}`, `.kbSem-amarelo .kbSemaforo{…}`, `.kbSem-vermelho .kbSemaforo{…}` e `.kbSem-cinza .kbSemaforo{…}`;
   - `.kbAtiv span{…}` e `.kbTabelaEquipe .kbAtiv{…}`.

   Conferir com `grep -n "kbTabelaEquipe\|kbSem-\|\.kbAtiv" _template.html`: o resultado tem que vir vazio, porque o HTML novo não usa mais esses nomes.

2. Inserir no lugar da antiga `.kbEquipe h4{…}`:

```css
  /* §126.3: Equipe — números do topo, faixa de atenção, tabela com semáforo escrito e mapa por hora, lote, alertas em três blocos */
  .kbEqTopo{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:var(--space-3) 0 var(--space-4);}
  .kbEqKpi{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:14px 16px;border:0;border-radius:var(--radius-lg);background:var(--ml-surface);font:inherit;text-align:left;color:var(--ml-ink-2);font-size:var(--fs-sm);cursor:pointer;transition:background var(--dur-fast);}
  .kbEqKpi:hover{background:var(--ml-surface-2);}
  .kbEqKpi[data-kb-eqk="ligacoes"]{cursor:default;}
  .kbEqKpi[data-kb-eqk="ligacoes"]:hover{background:var(--ml-surface);}
  .kbEqKpi.alerta .kbNumGrande{color:var(--ml-late);}
  .kbEqKpi small{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .kbEqKpi .kbMedidor{width:100%;margin-top:6px;}
  .kbEqAtencao{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:12px 16px;margin-bottom:var(--space-3);border-radius:var(--radius-lg);background:var(--ml-late-soft);color:var(--ml-ink);}
  .kbEqAtencaoAcoes{margin-left:auto;display:flex;gap:6px;}
  .kbEqAtencao .kbBtnQ{background:var(--ml-surface);}
  .kbEqAv{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:var(--radius-lg);background:var(--c-bordo);color:var(--c-branco);font-size:12px;font-weight:700;flex:none;}
  .kbEqTabela{background:var(--ml-surface);border-radius:var(--radius-lg);overflow-x:auto;margin-bottom:var(--space-4);}
  .kbEqTabela table{width:100%;border-collapse:collapse;}
  .kbEqTabela th{background:var(--ml-surface-2);text-align:left;font-size:var(--fs-xs);font-weight:600;color:var(--ml-ink-2);padding:10px 12px;white-space:nowrap;text-transform:none;letter-spacing:0;}
  .kbEqTabela td{padding:10px 12px;border-top:1px solid var(--ml-surface-3);vertical-align:middle;white-space:nowrap;font-size:var(--fs-base);}
  .kbEqTabela .r{text-align:right;}
  .kbEqTabela tbody tr{cursor:pointer;transition:background var(--dur-fast);}
  .kbEqTabela tbody tr:hover{background:var(--ml-surface-2);}
  .kbEqPessoa{display:flex;align-items:center;gap:10px;}
  .kbEqPessoa b{display:block;font-weight:600;}
  .kbEqPessoa small,.kbEqAtivTxt{display:block;font-size:var(--fs-xs);color:var(--ml-ink-3);}
  .kbEqAtivTxt{margin-top:4px;white-space:normal;max-width:240px;}
  .kbEqSem{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:var(--fs-sm);font-weight:600;}
  .kbSemaforo{width:8px;height:8px;border-radius:50%;background:currentColor;flex:none;}
  .kbEqSem.v{background:var(--ml-ok-soft);color:var(--ml-ok);}
  .kbEqSem.a{background:var(--ml-soon-soft);color:var(--ml-soon);}
  .kbEqSem.r{background:var(--ml-late-soft);color:var(--ml-late);}
  .kbEqSem.c{background:var(--ml-surface-2);color:var(--ml-ink-3);}
  .kbCalor{display:inline-grid;grid-template-columns:repeat(8,14px);gap:3px;vertical-align:middle;}
  .kbCalor i{height:14px;border-radius:3px;background:var(--ml-surface-3);}
  .kbCalor i.l1{background:var(--c-rosa);}
  .kbCalor i.l2{background:var(--st-perdido);opacity:.55;}
  .kbCalor i.l3{background:var(--c-sinal);}
  .kbCalor i.l4{background:var(--c-carmim);}
  .kbCalor i.fut{background:none;box-shadow:inset 0 0 0 1px var(--ml-surface-3);}
  .kbEqHoje{min-width:120px;font-variant-numeric:tabular-nums;}
  .kbEqHoje .kbMedidor{display:block;width:90px;margin-top:5px;}
  .kbMed-red i{background:var(--ml-late);}
  .kbMed-green i{background:var(--ml-ok);}
  .kbEqNum{border:0;background:none;padding:2px 6px;border-radius:6px;font:inherit;font-weight:600;font-variant-numeric:tabular-nums;color:var(--ml-ink);cursor:pointer;}
  .kbEqNum:hover{background:var(--ml-surface-3);}
  .kbEqNum.ruim{color:var(--ml-late);}
  .kbEqNum.zero{color:var(--ml-ink-3);font-weight:500;cursor:default;}
  .kbEqConv{font-variant-numeric:tabular-nums;}
  .kbEqLegenda{margin:0;padding:10px 14px;background:var(--ml-surface-2);color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .kbEqLista{background:var(--ml-surface);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:var(--space-3);}
  .kbEqListaTopo{display:flex;align-items:center;gap:12px;margin-bottom:6px;}
  .kbEqListaTopo h3{margin:0;margin-right:auto;font:600 var(--fs-md)/1.2 var(--font-body);text-transform:none;}
  .kbEqLista .kbCartaoLista li{display:flex;align-items:center;gap:10px;}
  .kbLoteCheck{display:inline-flex;align-items:center;}
  .kbLoteCheck input{width:16px;height:16px;accent-color:var(--c-sinal);}
  .kbLiPassar{margin-left:auto;}
  .kbLoteBarra{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;gap:10px;margin-bottom:var(--space-3);padding:12px 14px;border-radius:var(--radius-lg);background:var(--ml-ink);color:var(--c-branco);box-shadow:var(--ml-float);}
  .kbLoteBarra[hidden]{display:none;}
  .kbLoteAcoes{margin-left:auto;display:flex;gap:6px;}
  .kbLoteBarra .kbBtnG{color:var(--c-branco);}
  .kbLoteBarra .kbBtnQ{background:var(--c-branco);color:var(--ml-ink);}
  .kbEqAlertas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;}
  .kbEqBloco{background:var(--ml-surface);border-radius:var(--radius-lg);padding:14px 16px;}
  .kbEqBloco h3{display:flex;justify-content:space-between;margin:0 0 6px;font:600 var(--fs-md)/1.2 var(--font-body);text-transform:none;}
  .kbEqBloco h3 span{color:var(--ml-ink-3);font-weight:500;}
  .kbEqAlerta{display:flex;align-items:center;gap:8px;padding:8px 0;}
  .kbEqAlerta + .kbEqAlerta{border-top:1px solid var(--ml-surface-3);}
  .kbEqAlerta > span{flex:1;min-width:0;}
  .kbEqAlerta small{display:block;color:var(--ml-ink-3);font-size:var(--fs-xs);}
  @media (max-width: 1100px){ .kbEqTopo{grid-template-columns:repeat(2,minmax(0,1fr));} .kbEqAlertas{grid-template-columns:1fr;} }
```

- [ ] **Step 5: Ajustar os testes antigos da Equipe**

1. **`test_leads_painel_hoje.js`, bloco `// tela do gestor` da Task 6:**
   - Trocar `  window.__rpcRespostas.leads_atividade_equipe = { data: [` por `  window.__rpcRespostas.leads_atividade_equipe2 = { data: [`.
   - Trocar `  assert(eqEl.querySelector('tr[data-kb-dono="u-zz"] .kbSemaforo'), 'bolinha do semáforo na linha');` por `  assert(eqEl.querySelector('tr[data-kb-dono="u-zz"] .kbEqSem .kbSemaforo'), 'semáforo escrito com a bolinha na linha');`.
   - As outras asserções continuam valendo:
     - "34 hoje" e "sem usuário de telefonia" aparecem no texto pequeno;
     - o rodapé "Ligações chegam do ProContact de hora em hora" continua;
     - `[data-kb-eq="u-zz|parados3"]` abre a `.kbCartaoLista` com "Zz P2".
2. **`test_leads_painel_hoje.js`, teste de Ver mais da Equipe:** trocar `  window.__rpcRespostas.leads_atividade_equipe = { data: kbEstado.atividade, error: null };` por `  window.__rpcRespostas.leads_atividade_equipe2 = { data: kbEstado.atividade, error: null };`.
3. **`test_leads_hoje.js`:**
   - Trocar a linha

     ```js
       window.__rpcRespostas.leads_atividade_equipe = { data: [{ dono_id: 'u-zz', nome: 'Zzkcon Teste', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0 }], error: null };
     ```

     por

     ```js
       window.__rpcRespostas.leads_atividade_equipe2 = { data: [{ dono_id: 'u-zz', nome: 'Zzkcon Teste', tem_telefonia: true, ultima_ligacao: null, lig_hoje: 0, ultima_obs: null, obs_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true }], error: null };
     ```

   - As asserções `.kbSemaforo` e `25%` e o clique na linha → Quadro continuam valendo.

- [ ] **Step 6: Rodar**

Run: `node test_meus_leads_fase3.js && node test_leads_painel_hoje.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_meus_leads_redesign.js && node test_meus_leads_fase2.js`
Expected: os seis com `0 falharam`.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_meus_leads_fase3.js test_leads_painel_hoje.js test_leads_hoje.js
git commit -m "feat(meus-leads): Equipe nova (numeros, faixa de atencao, semaforo escrito, mapa por hora, lote, alertas em blocos) (secao 126.3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Menu "Passar para" (um lead ou vários), no lugar da janela Redistribuir

**Files:**
- Modify `_template.html`:
  - **markup:** sai `#kbRedOverlay` e entra `#kbPassar` no mesmo lugar;
  - **JS:**
    - `kbAbrirRedistribuir`, `kbRedEscolher` e `kbSalvarRedistribuicao` dão lugar às `kbPassar*`;
    - saem os 5 listeners `kbRed*`;
    - entram os cliques do menu, do lote e de `[data-kb-passar-um]`;
    - a ficha e o `kbParar` mudam;
  - **CSS:** entra o menu; `#kbPassar` vai para o seletor dos tokens; sai `#kbRedOverlay{…}`.
- Modify: `test_leads_kanban.js`, `test_leads_hoje.js` e `test_leads_painel_hoje.js` (só onde usam a janela).
- Test: `test_meus_leads_fase3.js`

**Interfaces:**
- Consumes:
  - da Task 2: `kbMenosCarga` e `kbDividirIgual`;
  - da Task 3: `kbEstado.loteSel`, `#kbLoteBarra`, `[data-kb-lote-livres]`, `[data-kb-lote-passar]` e `[data-kb-passar-um]`;
  - já existentes: `kbContagemEquipe`, `kbAcharLead`, `kbEstado.atividade`, `kbEstado.consultores` (`[{profile_id, nome_planilha}]`), `kbFichaNo`, `kbFecharFicha`, `agAvisarMudou` e `mostrarAviso`.
- Produces:
  - `kbPassarAbrir(chaves: string[], ancora?: Element, escolha?: string)`;
  - `kbPassarEscolher(valor)`, com `valor` = `profile_id`, `'__igual'` ou `'__livres'`;
  - `kbPassarExecutar() → Promise<{ok:number, falhas:[{chave, nome, motivo}]}>`;
  - `kbPassarFechar()`;
  - `kbEstado.passar = {alvos, pessoas, carga, menos, escolha, executando, falhas, progresso}`.
  - `kbAbrirRedistribuir(aba, id)` e `kbSalvarRedistribuicao()` continuam existindo e passam a chamar o menu.

- [ ] **Step 1: Escrever os testes**

No `test_meus_leads_fase3.js`, no lugar do `// ==== mais testes entram aqui ====`:

```js
  // ==== Task 4: menu Passar para (relógio ainda fixo) ====
  kbEstado.equipeLista = { dono: 'u1', chave: 'sem_contato' }; kbEstado.loteSel = new Set(['O|s1', 'O|s2']); kbRenderEquipe();
  document.querySelector('#kbLoteBarra [data-kb-lote-passar]').click();
  const PM = document.getElementById('kbPassar');
  assert(!PM.hidden && PM.textContent.includes('Passar 2 leads para'), 'menu abre para o lote');
  eq([...PM.querySelectorAll('[data-kb-passar-para]')].map(b => b.dataset.kbPassarPara), ['u2', '__livres'], 'sem o dono atual; Devolver aos livres (todos sem status); sem Dividir com uma pessoa só');
  const opU2 = PM.querySelector('[data-kb-passar-para="u2"]');
  assert(opU2.textContent.includes('menos carga') && opU2.textContent.includes('1 em andamento') && opU2.classList.contains('ativo'), 'quem tem menos carga vem marcado, com o selo e a carga');
  eq(PM.querySelector('[data-kb-passar-ok]').textContent, 'Passar para Zz Luria', 'botão diz para quem vai');
  // escolher não fecha o menu (o clique redesenha o menu por dentro)
  PM.querySelector('[data-kb-passar-para="__livres"]').click();
  assert(!PM.hidden && kbEstado.passar.escolha === '__livres' && PM.querySelector('[data-kb-passar-ok]').textContent === 'Devolver aos livres', 'escolher troca a opção e o menu continua aberto');
  PM.querySelector('[data-kb-passar-para="u2"]').click();
  // RF3 e execução em sequência
  const chamadas = []; window.__rpcRespostas.leads_redistribuir = (a) => { chamadas.push(a.p_id + '>' + a.p_novo); return { data: null, error: null }; };
  let mud = 0; document.addEventListener('agenda:mudou', () => mud++);
  PM.querySelector('[data-kb-passar-ok]').click(); PM.querySelector('[data-kb-passar-ok]').click();
  await espera(150);
  eq(chamadas, ['s1>u2', 's2>u2'], 'RF3: dois cliques = uma execução, lead a lead');
  assert(PM.hidden && kbEstado.loteSel.size === 0 && mud >= 1 && window.__alertas.some(m => m.includes('2 de 2 passados')), 'fecha, limpa a seleção, avisa a Agenda e mostra o resultado');
  // clicar fora fecha; Esc fecha
  kbPassarAbrir(['O|s1']); document.body.click();
  assert(PM.hidden, 'clicar fora fecha o menu');
  kbPassarAbrir(['O|s1']); document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert(PM.hidden, 'Esc fecha o menu');
  // Devolver aos livres pela barra abre o menu já marcado
  kbEstado.loteSel = new Set(['O|s1']); kbRenderEquipe();
  document.querySelector('#kbLoteBarra [data-kb-lote-livres]').click();
  assert(!PM.hidden && kbEstado.passar.escolha === '__livres', 'Devolver aos livres da barra abre o menu com a opção marcada (confirma antes)');
  kbPassarFechar(); kbEstado.loteSel = new Set();
  // Dividir igual entre os que pegam
  window.__rpcRespostas.leads_atividade_equipe2 = { data: ATV.concat([{ dono_id: 'u3', nome: 'Zz Mariana', tem_telefonia: true, lig_hoje: 0, lig_por_hora: [0,0,0,0,0,0,0,0], meta_dia: 80, pode_pegar: true }]), error: null };
  await kbCarregarEquipe();
  chamadas.length = 0;
  kbPassarAbrir(['O|s1', 'O|s2']);
  assert(PM.querySelector('[data-kb-passar-para="__igual"]'), 'Dividir igual aparece com dois ou mais que pegam');
  kbPassarEscolher('__igual');
  eq(PM.querySelector('[data-kb-passar-ok]').textContent, 'Dividir 2 leads', 'botão de dividir');
  await kbPassarExecutar();
  eq(chamadas.slice().sort(), ['s1>u3', 's2>u2'], 'dividir igual: cada um para quem está com menos carga (u3 com 0, depois empate pelo nome)');
  // RF2: falha parcial
  chamadas.length = 0;
  window.__rpcRespostas.leads_redistribuir = (a) => { chamadas.push(a.p_id); return a.p_id === 's2' ? { data: null, error: { message: 'lead com status não volta aos Livres; passe para outro consultor' } } : { data: null, error: null }; };
  kbPassarAbrir(['O|s1', 'O|s2']); kbPassarEscolher('__livres');
  const res = await kbPassarExecutar();
  assert(res.ok === 1 && res.falhas.length === 1 && !PM.hidden && PM.querySelector('.kbPassarFalhas').textContent.includes('Zz Sem Dois') && PM.textContent.includes('não volta aos Livres'), 'RF2: falha parcial lista o lead e o motivo, e o menu fica aberto');
  assert(window.__alertas.some(m => m.includes('1 de 2 passados')), 'RF2: aviso com o resultado parcial');
  chamadas.length = 0; kbPassarEscolher('u2'); await kbPassarExecutar();
  eq(chamadas, ['s2'], 'RF2: tentar de novo só refaz o que falhou');
  // um lead só (alerta Passar) usa o mesmo menu
  window.__rpcRespostas.leads_redistribuir = { data: null, error: null };
  kbRenderEquipe();
  document.querySelector('#kbEquipe .kbEqAlertas [data-kb-passar-um="O|s1"]').click();
  assert(!PM.hidden && PM.textContent.includes('Passar "Zz Sem Um" para'), 'Passar no alerta abre o menu para um lead');
  kbPassarFechar();
  // RF5: único consultor
  kbEstado.atividade = [ATV[0]];
  kbPassarAbrir(['O|a1']);
  assert(PM.textContent.includes('Nenhum outro consultor na equipe de leads.') && PM.querySelector('[data-kb-passar-ok]').disabled, 'RF5: sem outro consultor não dá para confirmar');
  kbPassarFechar();
  assert(!document.getElementById('kbRedOverlay'), 'a janela Redistribuir saiu');
  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_meus_leads_fase3.js 2>&1 | grep -E "FALHOU|RESULTADO|FALHA" | head`
Expected: a primeira falha é `menu abre para o lote` (ou `kbPassarAbrir is not defined`).

- [ ] **Step 3: Markup**

1. Antes de editar, contar `<div` e `</div>` no `<body>` e anotar os dois números.
2. Trocar o overlay inteiro por uma linha. O trecho vai da linha `    <div class="overlay" id="kbRedOverlay">` até a linha com `id="kbRedSalvar">Salvar</button></div></div>`, mais o `</div>` que fecha o overlay logo depois. A linha nova:

```html
    <div class="kbPassar" id="kbPassar" role="dialog" aria-label="Passar leads para outro consultor" hidden></div>
```

3. Contar de novo: os dois números têm que ter caído na mesma quantidade.

- [ ] **Step 4: JS**

1. Trocar as funções `kbAbrirRedistribuir`, `kbRedEscolher` e `kbSalvarRedistribuicao` inteiras, de `function kbAbrirRedistribuir(aba, id){` até o `}` antes de `async function kbMesaCard(){`, por:

```js
// §126.3: "Passar para" — um menu só para um lead ou vários (sai a janela Redistribuir). Executa leads_redistribuir lead a lead.
function kbPassarPessoas(){
  const at = kbEstado.atividade || [];
  if(at.length) return at.map(a => ({ id: a.dono_id, nome: a.nome || '', pode: a.pode_pegar === true }));
  return (kbEstado.consultores || []).map(c => ({ id: c.profile_id, nome: c.nome_planilha || '', pode: c.pode_pegar === true }));
}
function kbPassarLead(chave){
  const i = chave.indexOf('|'), aba = chave.slice(0, i), id = chave.slice(i + 1);
  return (kbEstado.leadsEquipe || []).find(l => l.aba === aba && l.lead_id === id) || kbAcharLead(aba, id) || { aba, lead_id: id, nome: '', categoria: '' };
}
function kbPassarCarga(){
  const base = kbEstado.leadsEquipe && kbEstado.leadsEquipe.length ? kbEstado.leadsEquipe : kbEstado.leads;
  const c = kbContagemEquipe(base, [], Date.now()), carga = {};
  Object.keys(c).forEach(k => { carga[k] = c[k].andamento || 0; });
  return carga;
}
function kbPassarAbrir(chaves, ancora, escolha){
  if(!kbGestor() || !(chaves || []).length) return;
  const alvos = chaves.map(kbPassarLead);
  const donos = new Set(alvos.map(l => l.dono_id).filter(Boolean));
  const pessoas = kbPassarPessoas().filter(p => !(donos.size === 1 && donos.has(p.id)));
  const carga = kbPassarCarga(), menos = kbMenosCarga(pessoas, carga);
  kbEstado.passar = { alvos, pessoas, carga, menos, escolha: escolha || menos || '', executando: false, falhas: [], progresso: '' };
  kbPassarDesenhar();
  const m = document.getElementById('kbPassar');
  m.hidden = false;
  if(ancora && ancora.getBoundingClientRect){
    const r = ancora.getBoundingClientRect();
    m.style.top = Math.max(8, Math.min(window.innerHeight - 320, r.bottom + 6)) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - 308, r.right - 300)) + 'px';
  } else { m.style.top = ''; m.style.left = ''; }
  const foco = m.querySelector('.kbPassarOp.ativo') || m.querySelector('[data-kb-passar-cancelar]');
  if(foco) foco.focus();
}
function kbPassarDesenhar(){
  const p = kbEstado.passar, m = document.getElementById('kbPassar');
  if(!p) return;
  const n = p.alvos.length, semStatus = p.alvos.every(l => l.categoria === 'sem_contato');
  const titulo = n === 1 ? `Passar "${escapeHtml(p.alvos[0].nome || 'lead')}" para` : `Passar ${n} leads para`;
  const op = (v, nome, info, av) => `<button type="button" class="kbPassarOp${p.escolha === v ? ' ativo' : ''}" data-kb-passar-para="${escapeHtml(v)}"${p.executando ? ' disabled' : ''}>${av ? `<span class="kbEqAv">${escapeHtml(av)}</span>` : ''}<span class="kbPassarNome">${escapeHtml(nome)}</span>${info}</button>`;
  const pessoas = p.pessoas.map(x => op(x.id, x.nome, `<small>${p.carga[x.id] || 0} em andamento</small>${x.id === p.menos ? '<span class="kbSelo">menos carga</span>' : ''}`, kbIniciais(x.nome))).join('');
  const podem = p.pessoas.filter(x => x.pode);
  const extra = (n > 1 && podem.length > 1 ? op('__igual', 'Dividir igual entre os que pegam', '') : '') + (semStatus ? op('__livres', 'Devolver aos livres', '') : '');
  const escolhido = p.escolha === '__igual' ? `Dividir ${n} leads` : p.escolha === '__livres' ? 'Devolver aos livres' : ('Passar para ' + ((p.pessoas.find(x => x.id === p.escolha) || {}).nome || ''));
  const falhas = p.falhas.length ? `<div class="kbPassarFalhas"><b>Não foi possível passar:</b>${p.falhas.map(f => `<span>${escapeHtml(f.nome)}: ${escapeHtml(f.motivo)}</span>`).join('')}</div>` : '';
  m.innerHTML = `<h4>${titulo}</h4>${pessoas || '<p class="kbMuted">Nenhum outro consultor na equipe de leads.</p>'}${extra}${falhas}
    <div class="kbPassarRodape"><button type="button" class="kbBtn kbBtnG kbBtnSm" data-kb-passar-cancelar${p.executando ? ' disabled' : ''}>Cancelar</button><button type="button" class="kbBtn kbBtnP kbBtnSm" data-kb-passar-ok${p.escolha && !p.executando ? '' : ' disabled'}>${escapeHtml(p.executando ? (p.progresso || 'Passando…') : escolhido)}</button></div>`;
}
function kbPassarEscolher(v){ const p = kbEstado.passar; if(p && !p.executando){ p.escolha = v; kbPassarDesenhar(); } }
function kbPassarFechar(){ kbEstado.passar = null; const m = document.getElementById('kbPassar'); m.hidden = true; m.innerHTML = ''; }
async function kbPassarExecutar(){
  const p = kbEstado.passar;
  if(!p || p.executando || !p.escolha) return { ok: 0, falhas: [] };
  p.executando = true; p.falhas = [];
  const chaves = p.alvos.map(l => l.aba + '|' + l.lead_id);
  const plano = p.escolha === '__igual' ? kbDividirIgual(chaves, p.pessoas.filter(x => x.pode), p.carga)
    : chaves.map(chave => ({ chave, para: p.escolha === '__livres' ? null : p.escolha }));
  let ok = 0;
  for(let i = 0; i < plano.length; i++){
    p.progresso = `Passando ${i + 1} de ${plano.length}…`; kbPassarDesenhar();
    const l = kbPassarLead(plano[i].chave);
    const r = await ppSeguro(() => sb.rpc('leads_redistribuir', { p_aba: l.aba, p_id: l.lead_id, p_novo: plano[i].para }));
    if(r && !r.error) ok++;
    else p.falhas.push({ chave: plano[i].chave, nome: l.nome || l.lead_id, motivo: (r && r.error && r.error.message) || 'sem resposta do servidor' });
  }
  p.executando = false; p.progresso = '';
  const res = { ok, falhas: p.falhas.slice() };
  mostrarAviso(`${ok} de ${plano.length} passado${plano.length === 1 ? '' : 's'}.`, p.falhas.length ? 'info' : 'ok');
  if(ok) agAvisarMudou();
  kbEstado.loteSel = new Set();
  if(p.falhas.length){
    const falhou = new Set(p.falhas.map(f => f.chave));
    p.alvos = p.alvos.filter(l => falhou.has(l.aba + '|' + l.lead_id));   // tentar de novo só refaz o que falhou
    kbPassarDesenhar();
  } else kbPassarFechar();
  await kbCarregar();   // na aba Equipe, o kbCarregar também recarrega a Equipe
  return res;
}
// Nomes antigos (ficha e testes): um lead só abre o mesmo menu.
function kbAbrirRedistribuir(aba, id){ kbPassarAbrir([aba + '|' + id]); }
async function kbSalvarRedistribuicao(){ return kbPassarExecutar(); }
```

2. Apagar as 5 linhas de listeners da janela antiga. São as que começam por:
   - `document.getElementById('kbRedSalvar').addEventListener(`;
   - `document.getElementById('kbRedCancelar').addEventListener(`;
   - `document.getElementById('kbRedFechar').addEventListener(`;
   - `document.getElementById('kbRedGrupos').addEventListener(`;
   - `document.getElementById('kbRedOverlay').addEventListener('keydown',`.

   No lugar delas, inserir:

```js
document.getElementById('kbPassar').addEventListener('click', (e) => {
  const pp = e.target.closest('[data-kb-passar-para]');
  if(pp){ kbPassarEscolher(pp.dataset.kbPassarPara); return; }
  if(e.target.closest('[data-kb-passar-ok]')){ kbPassarExecutar(); return; }
  if(e.target.closest('[data-kb-passar-cancelar]')) kbPassarFechar();
});
// Clicar fora ou Esc fecha. composedPath: o clique que redesenha o menu por dentro tira o alvo do DOM, mas o caminho guardado continua valendo.
document.addEventListener('click', (e) => {
  if(!kbEstado.passar || kbEstado.passar.executando) return;
  const dentro = e.composedPath().some(n => n.nodeType === 1 && (n.id === 'kbPassar' || n.hasAttribute('data-kb-passar-um') || n.hasAttribute('data-kb-lote-passar') || n.hasAttribute('data-kb-lote-livres') || n.hasAttribute('data-kb-ficha-redistribuir')));
  if(!dentro) kbPassarFechar();
});
document.addEventListener('keydown', (e) => { if(e.key === 'Escape' && kbEstado.passar && !kbEstado.passar.executando) kbPassarFechar(); });
```

3. No listener de clique do `#panel-meusleads`, logo depois da linha do ramo `[data-kb-lote-limpar]` (Task 3), inserir:

```js
  const pu = e.target.closest('[data-kb-passar-um]');
  if(pu){ kbPassarAbrir([pu.dataset.kbPassarUm], pu); return; }
  const lp = e.target.closest('[data-kb-lote-passar]');
  if(lp){ kbPassarAbrir([...kbEstado.loteSel], lp); return; }
  const ll = e.target.closest('[data-kb-lote-livres]');
  if(ll){ kbPassarAbrir([...kbEstado.loteSel], ll, '__livres'); return; }
```

4. Na ficha, trocar a linha `  if(e.target.closest('[data-kb-ficha-redistribuir]')){ if(!kbFichaNo().classList.contains('noPainel')) kbFecharFicha(); kbAbrirRedistribuir(alvo.aba, alvo.id); return; }` por:

```js
  if(e.target.closest('[data-kb-ficha-redistribuir]')){
    const casa = kbFichaNo().classList.contains('noPainel');   // na Hoje a ficha fica e o menu abre ao lado do botão; na gaveta, a gaveta fecha como antes
    if(!casa) kbFecharFicha();
    kbPassarAbrir([alvo.aba + '|' + alvo.id], casa ? e.target.closest('[data-kb-ficha-redistribuir]') : null);
    return;
  }
```

5. Em `kbParar`, logo depois da linha `  kbEstado.leadNovoIniciado = false;`, inserir `  if(kbEstado.passar) kbPassarFechar(); kbEstado.loteSel = new Set(); kbEstado.equipeLista = null;`.

- [ ] **Step 5: CSS**

1. Na linha dos tokens, trocar `  #panel-meusleads,#kbFicha{--ml-ink:` por `  #panel-meusleads,#kbFicha,#kbPassar{--ml-ink:`. Só muda o seletor; os valores ficam iguais.
2. Trocar `  #kbRedOverlay{backdrop-filter:none;}` por:

```css
  /* §126.3: menu "Passar para" (um lead ou vários) */
  .kbPassar{position:fixed;top:30%;left:calc(50% - 150px);width:300px;max-height:70vh;overflow-y:auto;z-index:60;padding:12px;border-radius:var(--radius-lg);background:var(--ml-surface);color:var(--ml-ink);box-shadow:var(--ml-float);}
  .kbPassar[hidden]{display:none;}
  .kbPassar h4{margin:0 0 8px;font:600 var(--fs-sm)/1.3 var(--font-body);color:var(--ml-ink-2);text-transform:none;letter-spacing:0;}
  .kbPassarOp{display:flex;align-items:center;gap:10px;width:100%;padding:7px 8px;border:0;border-radius:6px;background:none;font:inherit;text-align:left;cursor:pointer;color:var(--ml-ink);}
  .kbPassarOp:hover,.kbPassarOp.ativo{background:var(--ml-surface-2);}
  .kbPassarOp.ativo{box-shadow:inset 3px 0 0 var(--c-sinal);}
  .kbPassarOp:focus-visible{outline:2px solid var(--c-sinal);outline-offset:-2px;}
  .kbPassarOp .kbEqAv{width:26px;height:26px;font-size:11px;}
  .kbPassarNome{flex:1;font-weight:600;}
  .kbPassarOp small{color:var(--ml-ink-3);font-size:var(--fs-xs);}
  .kbSelo{font-size:11px;font-weight:700;color:var(--st-ganho);background:var(--st-ganho-bg);border-radius:5px;padding:1px 6px;}
  .kbPassarFalhas{margin:8px 0;padding:8px 10px;border-radius:6px;background:var(--st-perdido-bg);color:var(--st-perdido);font-size:var(--fs-sm);display:flex;flex-direction:column;gap:2px;}
  .kbPassarRodape{display:flex;justify-content:flex-end;gap:6px;margin-top:10px;}
```

- [ ] **Step 6: Ajustar os testes antigos**

**`test_leads_kanban.js`**

1. Trocar
```js
  kbAbrirRedistribuir('OUTUBRO', 'm1');
  document.getElementById('kbRedNovo').value = 'u-zz2';
  await kbSalvarRedistribuicao();
```
por
```js
  kbAbrirRedistribuir('OUTUBRO', 'm1');
  kbPassarEscolher('u-zz2');
  await kbSalvarRedistribuicao();
```
2. Trocar as 5 linhas que vão de `  kbAbrirRedistribuir('OUTUBRO', 'm9');` até `  assert(!aberto('kbRedOverlay'), 'Redistribuir fecha no Cancelar');` por:
```js
  kbAbrirRedistribuir('OUTUBRO', 'm9');
  assert(!document.getElementById('kbPassar').hidden, 'Passar para abre');
  document.querySelector('#kbPassar [data-kb-passar-cancelar]').click();
  assert(document.getElementById('kbPassar').hidden, 'Passar para fecha no Cancelar');
```

**`test_leads_hoje.js`**

1. Trocar a linha `  kbAbrirRedistribuir('OUTUBRO', 'h1');` pelas duas linhas abaixo. Assim o menu marca sozinho o `u-out`, o único que não é o dono.
```js
  kbEstado.atividade = []; kbEstado.leadsEquipe = [];   // sem a Equipe carregada, o menu usa os consultores
  kbAbrirRedistribuir('OUTUBRO', 'h1');
```
2. Trocar `  assert(document.getElementById('kbFichaCasa').parentElement === document.getElementById('kbRedOverlay').parentElement, 'ficha e Redistribuir no mesmo lugar');` por `  assert(document.getElementById('kbFichaCasa').parentElement === document.getElementById('kbPassar').parentElement, 'ficha e Passar para no mesmo lugar');`.

**`test_leads_painel_hoje.js`**

Trocar o bloco que vai de `  kbAbrirRedistribuir('OUTUBRO', 'rd1');` até `  fecharOverlay(red);` (inclusive) por:
```js
  kbEstado.atividade = []; kbEstado.leadsEquipe = [];   // sem a Equipe carregada, o menu usa os consultores
  kbAbrirRedistribuir('OUTUBRO', 'rd1');
  const red = document.getElementById('kbPassar');
  assert(!red.hidden && red.textContent.includes('Passar "Zz Redistribuir" para'), 'Passar para com o nome do lead');
  eq([...red.querySelectorAll('[data-kb-passar-para]')].map(b => b.dataset.kbPassarPara), ['u-b', 'u-c', '__livres'], 'consultores (sem o dono atual) + Devolver aos livres');
  red.querySelector('[data-kb-passar-para="u-c"]').click();
  assert(kbEstado.passar.escolha === 'u-c' && red.querySelector('[data-kb-passar-para="u-c"]').classList.contains('ativo'), 'clicar escolhe o consultor');
  red.querySelector('[data-kb-passar-para="__livres"]').click();
  assert(kbEstado.passar.escolha === '__livres' && !red.querySelector('[data-kb-passar-para="u-c"]').classList.contains('ativo'), 'escolher Livres troca a seleção');
  kbPassarFechar();
```

- [ ] **Step 7: Rodar**

Run: `node test_meus_leads_fase3.js && node test_leads_painel_hoje.js && node test_leads_hoje.js && node test_leads_kanban.js && node test_meus_leads_redesign.js && node test_meus_leads_fase2.js`

Expected:
- os seis com `0 falharam`;
- `grep -c "kbRedOverlay\|kbRedNovo\|kbRedGrupos\|kbRedEscolher\|redAlvo" _template.html` → `0`;
- a contagem de `<div` e `</div>` no `<body>` sai igual.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_meus_leads_fase3.js test_leads_kanban.js test_leads_hoje.js test_leads_painel_hoje.js
git commit -m "feat(meus-leads): menu Passar para (um lead ou varios, menos carga, dividir igual) no lugar da janela Redistribuir (secao 126.3)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verificação, revisão, prévia, banco e publicação

- [ ] **Step 1: Suíte e conferências**
  - Rodar `bash run_tests.sh`. Só podem falhar os 6 que já falhavam antes: `test_pedidos_alerta`, `test_producao_filtro_pessoas`, `test_redesign_shell`, `test_projecao_ganho`, `test_proposta_manual_docs` e `test_proposta_timbrada`.
  - Contar `<div` e `</div>` no `<body>`: os dois números têm que ser iguais.
- [ ] **Step 2: Revisão independente**
  - Revisor de contexto novo, no modelo mais capaz, com o plano, a spec e o Review Focus.
  - Corrigir os itens Critical e Important, cada um com um teste que falha antes da correção.
- [ ] **Step 3: Prévia**
  - Montar a prévia com o `previa_mock.js`, entrando como **supervisor**.
  - Acrescentar ao mock:
    - `leads_atividade_equipe2` com `lig_por_hora`;
    - um consultor em vermelho com leads sem contato;
    - um consultor sem telefonia.
  - Tirar prints da Equipe em 1440 e em 1366 de largura: a tela inteira, a lista aberta com seleção e o menu "Passar para" aberto.
- [ ] **Step 4: Pedir ao Rafael UM ok** para as três coisas:
  1. criar a função no banco;
  2. rodar a conferência, que termina em ROLLBACK;
  3. publicar o painel.
- [ ] **Step 5: Banco (só com o ok)**
  1. Rodar o conteúdo da migration com `execute_sql`, num bloco único `begin … commit`.
  2. Rodar o `leads_atividade_equipe2_check.sql`. Esperado: termina sem erro (ROLLBACK).
  3. Conferir com `select proname from pg_proc where proname = 'leads_atividade_equipe2'`.
- [ ] **Step 6: Publicar (só com o ok).** Mesmo roteiro das Fases 1 e 2:
  1. `fetch`.
  2. Conferir que o do ar é igual ao build da oficial.
  3. Num comando só: MD5 do ar, backup `~/deploy_backups/..._antes_meus_leads_redesign_fase3.html`, `scp` e MD5 depois.
  4. Vigia `-Aceitar`.
  5. No navegador, conferir que o painel no ar tem `kbPassarAbrir` e que a Equipe chama `leads_atividade_equipe2` sem erro.
- [ ] **Step 7: REGRAS, commit e push**
  - Escrever a §126.3:
    - a Equipe nova, a função nova e o "Passar para";
    - a publicação;
    - como voltar atrás:
      - **Painel:** republicar o backup.
      - **Banco:** a função nova pode ficar; ela é só leitura e o painel antigo não a usa.
  - Push sem force.
  - Atualizar a memória `apex-meus-leads-redesign`.
