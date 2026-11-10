# Distribuição automática de leads — §146.2 (tela do consultor + liberar o Automático) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O consultor passa a ver a distribuição: aviso quando um lead cai para ele, faixa "Sua vez" com Pausa, cronômetro de 5 min e os próprios números. O gestor vê na linha do tempo o "por que foi para ele", e o botão Automático fica liberado na Equipe.

**Architecture:**
- **Banco:** uma migration nova acrescenta `leads_dist_entrega_aberta`, `leads_dist_meu`, `leads_dist_motivo_texto` e a versão nova de `leads_presenca_ping`, que passa a devolver a entrega aberta e o modo. Ela também traz versões novas de três funções:
  - `leads_distribuir`: não entrega nos últimos 15 min do expediente;
  - `leads_dist_tick`: devolução só no expediente;
  - `leads_ficha_detalhes`: textos da distribuição automática.
- **Painel:** a presença passa a ser enviada a cada 20 s e serve de aviso de lead recebido em qualquer aba. A faixa fica no topo da aba Hoje.

**Tech Stack:** PL/pgSQL (Supabase), painel HTML/JS único (`_template.html` → `python build_painel.py`), testes Node + jsdom (`painel_teste_base.js`), conferência SQL em transação desfeita.

**Spec:** `docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md` (§11 Consultor, §12 fase §146.2). Plano anterior: `docs/superpowers/plans/2026-11-09-leads-distribuicao-automatica.md` (§146.1, no ar).

## Global Constraints

- **Banco de produção:** a §146.1 já está aplicada, com modo `sombra` e o cron `leads-dist-tick` ativo.
  - Os checks rodam com `execute_sql` em `begin` + um DO que termina em `raise exception 'RESULTADO: …'`, para desfazer tudo.
  - Montar com `python supabase/tests/leads_dist_montar.py SAIDA [migration] -- CHECK`. A fixture `supabase/tests/leads_dist_fixture.sql` já existe.
- **Migrations sem DROP.** Aplicar com `execute_sql` (`begin; … commit;`). Nada de `DELETE` nem de `UPDATE` sem `WHERE` nos checks, porque o conector pede confirmação.
- **Arquivos em LF.** No Windows, gravar com `write_bytes` / `newline='\n'`, nunca com `write_text` puro.
- **Visual "Sinal de Ápice":** reaproveitar `.kbEqPegar`, `.kbBtn`, `.kbSeg`, `.kbMuted` e as variáveis `--ml-ok`, `--ml-soon`, `--ml-late`. Cor só por variável.
- **Repo público:** nada de dado real de cliente. Testes usam "Lead Teste" e `(11) 90000-00NN`.
- **O consultor vê só os números dele** (decisão do Rafael): nada de ranking nem nome de colega na faixa.
- **O Automático é ligado pelo Rafael**, só depois de conferir a Sombra. Este plano libera o botão, mas não liga o modo.
- **Valores da configuração:** `prazo_atender_min` 5 e `prazo_devolver_min` 15, lidos de `leads_dist_cfg()`, nunca fixos no código.

### Decisões tomadas ao ler o código (valem para todas as tasks)

1. **`leads_dia` não muda.**
   - Entrega automática aparece como "recebeu", com origem nula.
   - Devolução automática aparece em "perdidos" para Livres, que é o que de fato aconteceu.
   - Isso fecha a pendência M-4 da revisão como "comportamento certo". O texto da linha do tempo vem da `leads_ficha_detalhes`, e é ela que muda.
2. **"Por que foi para ele" fica na linha do tempo da ficha**, só para o gestor: o detalhe do evento "Distribuído automaticamente para X", via `leads_dist_motivo_texto`. Não há RPC nem bloco novo na ficha.
3. **O cronômetro fica na faixa "Sua vez"** (aba Hoje), com botão "Abrir". Não vai para os cartões de Quadro, Lista e Hoje.
4. **O aviso de lead recebido vem da presença** (a cada 20 s, em qualquer aba), não do `leads_alertas`. O tipo `lead_novo` continua sendo só dos Livres.
5. **Faixa por modo:**
   - Modo Automático: estado, Pausa, cronômetro e "Hoje n de ~m".
   - Manual e Sombra: só "Rápidos" e "Conversão 14 dias". Na Sombra, os recebidos incluem as escolhas fictícias do motor e enganariam o consultor.
6. **M-1 (lead entregue perto das 21h):** o motor não entrega nos últimos `prazo_devolver_min` do expediente (o lead fica na fila para o dia seguinte), e a devolução só roda dentro do expediente.

## Review Focus

- **Lead cai para o consultor que está em outra aba do painel:** o aviso tem que aparecer em até 20 s, com som, notificação e toast. → Task 2, teste "aviso de lead recebido".
- **O mesmo lead não pode avisar duas vezes** (pings seguidos devolvem a mesma entrega). → Task 2, mesmo teste.
- **Faixa de quem não está no grupo** (Lucas, por exemplo): não aparece, e nada quebra. → Task 2, `kbSuaVezHtml({grupo:false})`.
- **Consultor que liga logo depois do aviso:** a entrega some da faixa no ping seguinte, sem aviso de "voltou aos Livres". → Task 2, teste de troca de entrega.
- **Lead que perde o prazo de 15 min enquanto o consultor está na tela:** aviso "voltou aos Livres". → Task 2, mesmo teste.

---

## Mapa de arquivos

| Arquivo | O que muda |
|---|---|
| `supabase/migrations/20261110120000_leads_dist_consultor.sql` | `leads_dist_entrega_aberta`, `leads_presenca_ping` (v2), `leads_dist_meu`, `leads_dist_motivo_texto`; `leads_distribuir` e `leads_dist_tick` (M-1); `leads_ficha_detalhes` (textos da distribuição) |
| `supabase/tests/leads_dist_consultor_check.sql` | Conferência da migration |
| `_template.html` | Presença a cada 20 s + aviso de lead recebido; faixa "Sua vez" (Pausa, cronômetro, números); botão Automático liberado com confirmação; `escapeHtml` no modo (M-7) |
| `test_leads_dist_consultor.js` | Testes do painel |
| `REGRAS_NEGOCIO.md` | §146.2 |

---

### Task 1: Banco — entrega aberta, "meu", motivo, M-1 e linha do tempo

**Files:**
- Create: `supabase/migrations/20261110120000_leads_dist_consultor.sql`
- Create: `supabase/tests/leads_dist_consultor_check.sql`

**Interfaces:**
- Consumes (no ar): `leads_dist_cfg()`, `leads_dist_no_expediente(timestamptz)`, `leads_dist_notas()`, `leads_dist_escolher(uuid[])`, `leads_distribuicao`, `leads_presenca`, `leads_dist_aviso`, `leads_pegar_bloqueado()`, `leads_espelho_enfileirar`, `leads_contato_info`.
- Produces:
  - `leads_dist_entrega_aberta(p_uid uuid) returns jsonb`: devolve `null` ou `{aba, lead_id, nome, tipo, recebido_em, prazo_atender_min, prazo_devolver_min}`. Só considera entrega `auto` aberta e sem atendimento.
  - `leads_presenca_ping(p_acao text default null) returns jsonb`: devolve `{equipe, pausa_ate, modo, entrega}`.
  - `leads_dist_meu() returns jsonb`: devolve `{grupo:false, modo}` ou `{grupo:true, modo, estado, pausa_ate, rapidos_ok, rapidos_n, conv, fatia, recebidos_hoje, alvo_hoje, entrega}`. O `estado` é um de `na_vez`, `pendente`, `pausa`, `offline`, `fora`.
  - `leads_dist_motivo_texto(p_aba text, p_id text, p_em timestamptz) returns text`.
  - `leads_ficha_detalhes`: o evento `redistribuir` com `por` nulo e `depois.auto` mostra o título "Distribuído automaticamente para X"; para o gestor, o detalhe é o motivo. O evento `devolver` automático mostra "Voltou aos Livres (sem contato no prazo)".

- [ ] **Step 1: Escrever o check**

`supabase/tests/leads_dist_consultor_check.sql`:

```sql
-- §146.2 Task 1: conferência de 20261110120000_leads_dist_consultor.sql (tudo desfeito no fim).
do $$
declare v_a uuid := pg_temp.ld_c(1); v_b uuid := pg_temp.ld_c(2); v_out text := ''; r jsonb; d1 uuid; ev jsonb; v_fim text;
begin
  perform pg_temp.ld_presente(v_a); perform pg_temp.ld_presente(v_b);
  -- 1. ping sem entrega devolve modo e entrega nula
  perform pg_temp.ld_como(v_a);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r ->> 'modo' = 'automatico' and r -> 'entrega' = 'null'::jsonb and (r ->> 'equipe')::boolean then '1 ok; ' else '1 FALHOU ' || r::text || '; ' end;
  -- 2. lead distribuído aparece no ping do dono, com o nome
  perform pg_temp.ld_lead('lc-1', 1);
  r := public.leads_distribuir('TESTE DIST', 'lc-1');
  d1 := (r ->> 'consultor_id')::uuid;
  perform pg_temp.ld_como(d1);
  r := public.leads_presenca_ping(null);
  v_out := v_out || case when r -> 'entrega' ->> 'lead_id' = 'lc-1' and r -> 'entrega' ->> 'nome' = 'Lead Teste'
                          and (r -> 'entrega' ->> 'prazo_atender_min')::int = 5 then '2 ok; ' else '2 FALHOU ' || r::text || '; ' end;
  -- 3. meu: grupo, estado pendente, fatia e entrega
  r := public.leads_dist_meu();
  v_out := v_out || case when (r ->> 'grupo')::boolean and r ->> 'estado' = 'pendente' and r ->> 'fatia' is not null
                          and r -> 'entrega' ->> 'lead_id' = 'lc-1' and (r ->> 'recebidos_hoje')::int >= 1 then '3 ok; ' else '3 FALHOU ' || r::text || '; ' end;
  -- 4. clicou em Ligar: a entrega sai do ping e o estado volta para na_vez
  update public.leads_distribuicao set atendido_em = now(), sinal = 'clique' where lead_id = 'lc-1' and fechado_em is null;
  r := public.leads_dist_meu();
  v_out := v_out || case when r -> 'entrega' = 'null'::jsonb and r ->> 'estado' = 'na_vez' then '4 ok; ' else '4 FALHOU ' || r::text || '; ' end;
  -- 5. fora do grupo: grupo false
  perform pg_temp.ld_como(pg_temp.ld_admin());
  r := public.leads_dist_meu();
  v_out := v_out || case when not (r ->> 'grupo')::boolean then '5 ok; ' else '5 FALHOU ' || r::text || '; ' end;
  -- 6. linha do tempo: gestor vê "Distribuído automaticamente" com o motivo; o dono vê sem motivo
  r := public.leads_ficha_detalhes('TESTE DIST', 'lc-1');
  select e into ev from jsonb_array_elements(r -> 'eventos') e where e ->> 'tipo' = 'redistribuir';
  v_out := v_out || case when ev ->> 'titulo' like 'Distribuído automaticamente para Teste Dist %' and ev ->> 'detalhe' like 'fatia %' then '6 ok; ' else '6 FALHOU ' || coalesce(ev::text, 'null') || '; ' end;
  perform pg_temp.ld_como(d1);
  r := public.leads_ficha_detalhes('TESTE DIST', 'lc-1');
  select e into ev from jsonb_array_elements(r -> 'eventos') e where e ->> 'tipo' = 'redistribuir';
  v_out := v_out || case when ev ->> 'titulo' like 'Distribuído automaticamente%' and ev ->> 'detalhe' is null then '6b ok; ' else '6b FALHOU ' || coalesce(ev::text, 'null') || '; ' end;
  -- 7. M-1: a menos de 15 min do fim do expediente o motor não entrega (o lead fica na fila)
  v_fim := to_char((now() at time zone 'America/Sao_Paulo') + interval '10 minutes', 'HH24:MI');
  perform pg_temp.ld_cfg(jsonb_build_object('expediente', jsonb_build_object('dias', '[1,2,3,4,5,6,7]'::jsonb, 'inicio', '00:00', 'fim', v_fim)));
  perform pg_temp.ld_lead('lc-2', 2);
  r := public.leads_distribuir('TESTE DIST', 'lc-2');
  v_out := v_out || case when r ->> 'motivo' = 'fora_do_expediente'
                          and exists (select 1 from public.leads_distribuicao where lead_id = 'lc-2' and consultor_id is null and fechado_em is null) then '7 ok; ' else '7 FALHOU ' || r::text || '; ' end;
  -- 8. M-1: fora do expediente o tick não devolve
  perform pg_temp.ld_cfg('{"expediente":{"dias":[],"inicio":"00:00","fim":"24:00"}}');
  perform pg_temp.ld_lead('lc-3', 3);
  update public.leads set dono_id = v_b where id = 'lc-3';
  perform pg_temp.ld_entrega('lc-3', v_b, 'auto', now() - interval '20 minutes');
  r := public.leads_dist_tick();
  v_out := v_out || case when (r ->> 'devolvidos')::int = 0 and (select dono_id from public.leads where id = 'lc-3') = v_b then '8 ok' else '8 FALHOU ' || r::text end;
  raise exception 'RESULTADO: %', v_out;
end $$;
```

(Item 7 falha por engano se o check rodar entre 23:50 e 23:59, porque o "fim" vira o dia seguinte. Rodar em outro horário.)

- [ ] **Step 2: Rodar contra o banco atual (vermelho)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/c1.sql" -- supabase/tests/leads_dist_consultor_check.sql
```

Passar o conteúdo para o `execute_sql`. Esperado: o erro `function public.leads_dist_meu() does not exist` (o item 3 chama a função nova), ou um `RESULTADO` com `1 FALHOU` (o ping antigo não tem `modo`).

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261110120000_leads_dist_consultor.sql`:

```sql
-- §146.2 (10/11, Rafael): lado do consultor da distribuição automática + ajustes da revisão (M-1) + textos na linha do tempo.
-- Spec: docs/superpowers/specs/2026-11-09-leads-distribuicao-automatica-design.md §11–§12. Plano: docs/superpowers/plans/2026-11-10-leads-distribuicao-consultor.md
-- Sem DROP. Check: supabase/tests/leads_dist_consultor_check.sql.
begin;

-- Lead que caiu automaticamente para o consultor e ainda espera o primeiro contato.
create or replace function public.leads_dist_entrega_aberta(p_uid uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object('aba', d.lead_aba, 'lead_id', d.lead_id, 'nome', l.full_name, 'tipo', d.tipo, 'recebido_em', d.recebido_em,
                            'prazo_atender_min', (public.leads_dist_cfg() ->> 'prazo_atender_min')::int,
                            'prazo_devolver_min', (public.leads_dist_cfg() ->> 'prazo_devolver_min')::int)
    from public.leads_distribuicao d join public.leads l on l.aba = d.lead_aba and l.id = d.lead_id
   where d.consultor_id = p_uid and d.tipo = 'auto' and d.fechado_em is null and d.atendido_em is null
   order by d.recebido_em desc
   limit 1
$function$;

-- Presença (v2): também devolve o modo e a entrega aberta (o painel avisa "lead novo para você" em qualquer aba).
create or replace function public.leads_presenca_ping(p_acao text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_pausa timestamptz; v_min int := (public.leads_dist_cfg() ->> 'pausa_min')::int;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  if coalesce(p_acao, '') not in ('', 'pausa', 'voltar') then raise exception 'ação inválida: %', p_acao using errcode = '22023'; end if;
  if not exists (select 1 from public.leads_equipe e where e.profile_id = auth.uid()) then
    return jsonb_build_object('equipe', false, 'pausa_ate', null, 'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', null);
  end if;
  insert into public.leads_presenca as p (profile_id, visto_em, pausa_ate)
  values (auth.uid(), now(), case when p_acao = 'pausa' then now() + make_interval(mins => v_min) end)
  on conflict (profile_id) do update set visto_em = now(),
    pausa_ate = case when p_acao = 'pausa' then now() + make_interval(mins => v_min)
                     when p_acao = 'voltar' then null else p.pausa_ate end
  returning p.pausa_ate into v_pausa;
  return jsonb_build_object('equipe', true, 'pausa_ate', case when v_pausa > now() then v_pausa end,
                            'modo', public.leads_dist_cfg() ->> 'modo', 'entrega', public.leads_dist_entrega_aberta(auth.uid()));
end $function$;

-- O que o consultor vê da distribuição (só os números dele).
create or replace function public.leads_dist_meu()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare c jsonb := public.leads_dist_cfg(); n record; p public.leads_presenca;
  v_dev interval := make_interval(mins => (c ->> 'prazo_devolver_min')::int);
  v_pres interval := make_interval(mins => (c ->> 'presenca_min')::int);
  v_total int; v_estado text;
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into n from public.leads_dist_notas() x where x.consultor_id = auth.uid();
  if not found then return jsonb_build_object('grupo', false, 'modo', c ->> 'modo'); end if;
  select * into p from public.leads_presenca where profile_id = auth.uid();
  select coalesce(sum(x.recebidos_hoje), 0) into v_total from public.leads_dist_notas() x where x.ativo;
  v_estado := case when not public.leads_dist_no_expediente(now()) then 'fora'
                   when p.pausa_ate > now() then 'pausa'
                   when exists (select 1 from public.leads_distribuicao d
                                 where d.consultor_id = auth.uid() and d.tipo in ('auto', 'pegou') and d.fechado_em is null
                                   and d.atendido_em is null and d.recebido_em > now() - v_dev) then 'pendente'
                   when p.visto_em is null or p.visto_em < now() - v_pres then 'offline'
                   else 'na_vez' end;
  return jsonb_build_object('grupo', true, 'modo', c ->> 'modo', 'estado', v_estado,
    'pausa_ate', case when p.pausa_ate > now() then p.pausa_ate end,
    'rapidos_ok', n.vel_ok, 'rapidos_n', n.vel_n, 'conv', n.conv, 'fatia', n.fatia, 'recebidos_hoje', n.recebidos_hoje,
    'alvo_hoje', case when n.fatia is null then null else round(n.fatia * greatest(v_total, n.recebidos_hoje))::int end,
    'entrega', public.leads_dist_entrega_aberta(auth.uid()));
end $function$;

-- "Por que foi para ele" (gestor, linha do tempo): fatia de quem recebeu e quem estava fora da vez.
create or replace function public.leads_dist_motivo_texto(p_aba text, p_id text, p_em timestamptz)
 returns text language sql stable security definer set search_path to 'public'
as $function$
  select nullif(concat_ws('; ',
           (select 'fatia ' || round((e ->> 'fatia')::numeric * 100) || '%, ' || (e ->> 'recebidos_hoje') || ' recebido(s) hoje antes deste'
              from jsonb_array_elements(d.motivo -> 'consultores') e where (e ->> 'consultor_id')::uuid = d.consultor_id),
           (select 'fora da vez: ' || string_agg((e ->> 'nome') || ' (' || case e ->> 'estado'
                      when 'pendente' then 'com lead sem contato' when 'pausa' then 'em pausa' when 'offline' then 'fora do painel'
                      when 'perdeu_este' then 'já perdeu este lead' else e ->> 'estado' end || ')', ', ')
              from jsonb_array_elements(d.motivo -> 'consultores') e where e ->> 'estado' <> 'na_vez')), '')
    from public.leads_distribuicao d
   where d.lead_aba = p_aba and d.lead_id = p_id and d.tipo = 'auto' and d.recebido_em = p_em
   order by d.id desc
   limit 1
$function$;

-- Motor: igual ao da §146.1 + não entrega nos últimos prazo_devolver_min do expediente (M-1: o lead fica para o dia seguinte).
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
      update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel');
  end if;
  if v_fila.id is null then
    insert into public.leads_distribuicao (lead_aba, lead_id) values (p_aba, p_id) returning * into v_fila;
  end if;
  if not public.leads_dist_no_expediente(now())
     or not public.leads_dist_no_expediente(now() + make_interval(mins => (c ->> 'prazo_devolver_min')::int)) then
    return jsonb_build_object('ok', false, 'motivo', 'fora_do_expediente');
  end if;
  if public.leads_pegar_bloqueado() then return jsonb_build_object('ok', false, 'motivo', 'bloqueado'); end if;
  v_esc := public.leads_dist_escolher(v_fila.excluidos);
  v_id := (v_esc ->> 'escolhido')::uuid;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'ninguem_na_vez'); end if;
  if v_modo = 'sombra' then
    insert into public.leads_dist_sombra (lead_aba, lead_id, escolhido, motivo) values (p_aba, p_id, v_id, v_esc)
    on conflict (lead_aba, lead_id) do nothing;
    update public.leads_distribuicao set fechado_em = now() where id = v_fila.id;
    return jsonb_build_object('ok', true, 'sombra', true, 'consultor_id', v_id);
  end if;
  v_nome := v_esc ->> 'nome';
  update public.leads set dono_id = v_id, consultor = v_nome, pego_em = now()
   where aba = p_aba and id = p_id and dono_id is null;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'motivo', 'lead_indisponivel'); end if;
  update public.leads_distribuicao set consultor_id = v_id, tipo = 'auto', recebido_em = now(), motivo = v_esc where id = v_fila.id;
  insert into public.leads_historico (lead_aba, lead_id, acao, por, depois)
    values (p_aba, p_id, 'redistribuir', null, jsonb_build_object('consultor', v_nome, 'dono_id', v_id, 'auto', true));
  perform public.leads_espelho_enfileirar(p_aba, p_id);
  return jsonb_build_object('ok', true, 'consultor_id', v_id, 'consultor', v_nome);
end $function$;
```

A `leads_dist_tick` vai inteira, igual à do ar (`supabase/migrations/20261109120300_leads_dist_tick.sql`, versão com as correções da revisão) com **uma única mudança**: a linha `  if v_modo = 'automatico' then` (a que abre o passo 2, devolução) vira `  if v_modo = 'automatico' and v_exp then   -- M-1: devolução só no expediente`. O executor copia a função desse arquivo para a migration nova e troca só essa linha. As outras três funções do arquivo antigo (`leads_entrada2`, `leads_pegar`, `leads_redistribuir`) **não** entram.

Depois vem a `leads_ficha_detalhes`, inteira e igual à do ar, com duas trocas no `select h.em, h.acao, …` do histórico. O texto atual no banco é:

```sql
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then 'Passou para ' || coalesce(h.depois ->> 'consultor', '') else 'Devolveu aos Livres' end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '') end, p.nome
```

Ele passa a ser:

```sql
    select h.em, h.acao,
           case h.acao when 'pegar' then 'Pegou o lead' when 'classificar' then 'Classificou: ' || coalesce(h.depois ->> 'status', '')
                       when 'redistribuir' then case when h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                                                     then 'Distribuído automaticamente para ' else 'Passou para ' end || coalesce(h.depois ->> 'consultor', '')
                       else case when h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                                 then 'Voltou aos Livres (sem contato no prazo)' else 'Devolveu aos Livres' end end,
           case when h.acao = 'classificar' then nullif(h.depois ->> 'obs', '')
                when v_gestor and h.acao = 'redistribuir' and h.por is null and coalesce((h.depois ->> 'auto')::boolean, false)
                  then public.leads_dist_motivo_texto(h.lead_aba, h.lead_id, h.em) end, p.nome
```

(O executor pega o corpo atual com `select pg_get_functiondef('public.leads_ficha_detalhes(text,text)'::regprocedure)`, confere que o trecho acima está igual e aplica as duas trocas. Se o trecho estiver diferente, alguém mudou a função: juntar as mudanças e registrar a decisão no ledger.)

No fim da migration:

```sql
revoke execute on function public.leads_dist_entrega_aberta(uuid) from public, anon, authenticated;
revoke execute on function public.leads_dist_motivo_texto(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.leads_dist_meu() from public, anon;
grant execute on function public.leads_dist_meu() to authenticated;

commit;
```

- [ ] **Step 4: Rodar o check com a migration (verde)**

```bash
python supabase/tests/leads_dist_montar.py "$SCRATCH/c1.sql" supabase/migrations/20261110120000_leads_dist_consultor.sql -- supabase/tests/leads_dist_consultor_check.sql
```

Esperado: `RESULTADO: 1 ok; 2 ok; 3 ok; 4 ok; 5 ok; 6 ok; 6b ok; 7 ok; 8 ok`. Rodar também `leads_dist_motor_check.sql` e `leads_dist_tick_check.sql` com a migration nova antes, para ver que nada da §146.1 quebrou.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261110120000_leads_dist_consultor.sql supabase/tests/leads_dist_consultor_check.sql
git commit -m "feat(leads): §146.2 banco do consultor (entrega aberta, meu, motivo) + M-1 + textos na linha do tempo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Painel — aviso de lead recebido, faixa "Sua vez", Pausa e cronômetro

**Files:**
- Modify: `_template.html` (HTML estático depois de `id="kbHojeTopo"` em ~2035; `kbEstado` em ~5194; `kbPresencaPing` em ~5400; intervalo da presença em ~5518; `kbParar`; `kbCarregarHoje` em ~6010; fim de `kbRenderHoje`; clique delegado do `panel-meusleads`; CSS perto de `.kbEqPegar`)
- Create: `test_leads_dist_consultor.js`

**Interfaces:**
- Consumes: `leads_presenca_ping(p_acao)` → `{equipe, pausa_ate, modo, entrega}`; `leads_dist_meu()` (Task 1).
- Produces (JS):
  - `KB_SUAVEZ_ESTADO = { na_vez: 'Na vez', pendente: 'Aguardando você ligar', pausa: 'Em pausa', offline: 'Fora do painel', fora: 'Fora do horário' }`
  - `kbCronometro(entrega, agoraMs)` → `{ texto, classe }`, com `classe` ∈ `ok`, `soon` ou `late`.
  - `kbSuaVezHtml(meu, entrega, agoraMs)` → string, vazia quando `meu` é nulo ou `grupo` é falso.
  - `kbDistAvisoEntrega(entrega, agoraMs)`: avisa a entrega nova uma vez só, e avisa "voltou aos Livres" quando a anterior some depois do prazo.
  - `kbCarregarDistMeu()` → `kbEstado.distMeu`.
  - `kbRenderSuaVez()` e `kbSuaVezPausa()`.

- [ ] **Step 1: Escrever o teste**

`test_leads_dist_consultor.js`:

```js
// Testa a §146.2 (consultor: aviso de lead recebido, faixa Sua vez, Pausa, cronômetro). DADOS FICTÍCIOS (repo público).
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  const chamadas = (nome) => window.__rpcCalls.filter(c => c.nome === nome);
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  kbEstado.naEquipe = true;
  const T0 = Date.parse('2026-11-12T15:00:00-03:00');
  const ENT = { aba: 'NOVEMBRO', lead_id: 'L1', nome: 'Lead Teste', tipo: 'auto', recebido_em: new Date(T0).toISOString(), prazo_atender_min: 5, prazo_devolver_min: 15 };

  // ==== cronômetro ====
  eq(kbCronometro(ENT, T0 + 72000), { texto: '3:48 para ligar', classe: 'ok' }, '1 min 12 s depois');
  eq(kbCronometro(ENT, T0 + 4 * 60000).classe, 'soon', 'último minuto fica âmbar');
  eq(kbCronometro(ENT, T0 + 7 * 60000), { texto: 'atrasado 2 min · volta aos Livres em 8 min', classe: 'late' }, 'atrasado');

  // ==== faixa ====
  eq(kbSuaVezHtml(null, null, T0), '', 'sem dados: nada');
  eq(kbSuaVezHtml({ grupo: false, modo: 'automatico' }, null, T0), '', 'fora do grupo: nada');
  const MEU = { grupo: true, modo: 'automatico', estado: 'pendente', pausa_ate: null, rapidos_ok: 7, rapidos_n: 10, conv: 0.172, fatia: 0.26, recebidos_hoje: 3, alvo_hoje: 5, entrega: ENT };
  let h = kbSuaVezHtml(MEU, ENT, T0 + 72000);
  assert(h.includes('Aguardando você ligar') && h.includes('Rápidos: 7 de 10') && h.includes('Conversão 14 dias: 17%') && h.includes('Hoje: 3 de ~5'), 'automático: estado e números');
  assert(h.includes('Lead Teste') && h.includes('3:48 para ligar') && h.includes('data-kb-suavez-abrir'), 'lead recebido com cronômetro e Abrir');
  assert(h.includes('data-kb-suavez-pausa') && h.includes('>Pausa<'), 'botão Pausa');
  h = kbSuaVezHtml(Object.assign({}, MEU, { estado: 'pausa', pausa_ate: '2026-11-12T16:00:00-03:00', entrega: null }), null, T0);
  assert(h.includes('Em pausa') && h.includes('Voltar') && h.includes('16:00'), 'em pausa mostra Voltar e até quando');
  h = kbSuaVezHtml(Object.assign({}, MEU, { modo: 'sombra' }), ENT, T0);
  assert(h.includes('Rápidos: 7 de 10') && !h.includes('Hoje:') && !h.includes('data-kb-suavez-pausa') && !h.includes('para ligar'), 'sombra: só os números');
  const ENT_X = Object.assign({}, ENT, { nome: '<img src=x>' });
  assert(!kbSuaVezHtml(MEU, ENT_X, T0).includes('<img'), 'nome do lead escapado');

  // ==== aviso de lead recebido (uma vez só) e "voltou aos Livres" ====
  const avisosAntes = window.__alertas.length;
  window.__rpcCalls.length = 0;
  kbDistAvisoEntrega(ENT, T0 + 5000);
  kbDistAvisoEntrega(ENT, T0 + 25000);
  await espera();
  assert(avisos().includes('Lead novo para você: Lead Teste'), 'toast do lead recebido');
  eq(window.__notificacoes.filter(n => /Lead Teste/.test(n.opts && n.opts.body || '')).length, 1, 'notifica uma vez só');
  kbDistAvisoEntrega(null, T0 + 2 * 60000);   // ligou logo: some sem aviso de devolução
  assert(!avisos().includes('voltou aos Livres'), 'atendido não avisa devolução');
  const ENT2 = Object.assign({}, ENT, { lead_id: 'L2', nome: 'Outro Teste' });
  kbDistAvisoEntrega(ENT2, T0);
  kbDistAvisoEntrega(null, T0 + 16 * 60000);   // sumiu depois do prazo de devolução
  assert(avisos().includes('Outro Teste voltou aos Livres'), 'avisa devolução');

  // ==== presença a cada 20 s alimenta o aviso ====
  window.__rpcRespostas.leads_presenca_ping = { data: { equipe: true, pausa_ate: null, modo: 'automatico', entrega: Object.assign({}, ENT, { lead_id: 'L3', nome: 'Terceiro Teste' }) }, error: null };
  await kbPresencaPing();
  assert(avisos().includes('Terceiro Teste'), 'ping com entrega nova avisa');
  kbAgendar();
  assert(kbEstado.timerPresencaMs === 20000, 'presença a cada 20 s');
  kbParar();

  // ==== Pausa / Voltar ====
  window.__rpcCalls.length = 0;
  kbEstado.distMeu = Object.assign({}, MEU, { estado: 'na_vez', entrega: null });
  window.__rpcRespostas.leads_dist_meu = { data: Object.assign({}, MEU, { estado: 'pausa', pausa_ate: '2026-11-12T16:00:00-03:00' }), error: null };
  kbEstado.naEquipe = true;
  await kbSuaVezPausa();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: 'pausa' }], 'na vez → pausa');
  window.__rpcCalls.length = 0;
  await kbSuaVezPausa();
  eq(chamadas('leads_presenca_ping').map(c => c.args), [{ p_acao: 'voltar' }], 'em pausa → voltar');
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules node test_leads_dist_consultor.js
```

Esperado: `FALHA: ReferenceError: kbCronometro is not defined`.

- [ ] **Step 3: Implementar**

3a. HTML: logo depois de `<div class="kbHojeTopo" id="kbHojeTopo"></div>`, acrescentar `<div class="kbEqPegar kbSuaVez" id="kbSuaVez" hidden></div>` (mesma indentação).

3b. `kbEstado`: acrescentar `, distMeu: null, distEntrega: null, distAvisadas: new Set(), timerSuaVez: null, timerPresencaMs: 0` ao fim do objeto.

3c. Substituir a função `kbPresencaPing` por:

```js
async function kbPresencaPing(acao){
  if(!kbEstado.naEquipe) return null;
  const r = await ppSeguro(() => sb.rpc('leads_presenca_ping', { p_acao: acao || null }));
  if(r && !r.error && r.data){
    kbEstado.presenca = r.data;
    if(Object.prototype.hasOwnProperty.call(r.data, 'entrega')) kbDistAvisoEntrega(r.data.entrega, Date.now());   // §146.2
  }
  return r && !r.error ? r.data : null;
}
// §146.2: cronômetro do lead recebido (prazo para ligar e, passado, quanto falta para voltar aos Livres).
function kbCronometro(ent, agoraMs){
  const rec = kbMs(ent && ent.recebido_em);
  if(rec === null) return { texto: '', classe: 'ok' };
  const atender = (Number(ent.prazo_atender_min) || 5) * 60000, devolver = (Number(ent.prazo_devolver_min) || 15) * 60000;
  const resta = rec + atender - agoraMs;
  if(resta > 0){
    const s = Math.ceil(resta / 1000);
    return { texto: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} para ligar`, classe: resta <= 60000 ? 'soon' : 'ok' };
  }
  const atraso = Math.floor((agoraMs - rec - atender) / 60000), volta = Math.max(0, Math.ceil((rec + devolver - agoraMs) / 60000));
  return { texto: `atrasado ${atraso} min · volta aos Livres em ${volta} min`, classe: 'late' };
}
// §146.2: aviso de lead que caiu para o consultor (uma vez por lead) e de lead que voltou aos Livres por falta de contato.
function kbDistAvisoEntrega(ent, agoraMs){
  const ant = kbEstado.distEntrega;
  if(ant && (!ent || ent.lead_id !== ant.lead_id)){
    const rec = kbMs(ant.recebido_em), prazo = (Number(ant.prazo_devolver_min) || 15) * 60000;
    if(rec !== null && agoraMs - rec >= prazo) mostrarAviso(`${ant.nome || 'O lead'} voltou aos Livres: passou o prazo sem contato.`, 'erro');
  }
  kbEstado.distEntrega = ent || null;
  if(ent && !kbEstado.distAvisadas.has(ent.aba + '|' + ent.lead_id)){
    kbEstado.distAvisadas.add(ent.aba + '|' + ent.lead_id);
    const texto = `Lead novo para você: ${ent.nome || 'lead'}. Ligue em até ${Number(ent.prazo_atender_min) || 5} min.`;
    mostrarAviso(texto, 'info');
    if('Notification' in window && Notification.permission === 'granted'){ try { const nt = new Notification('Meus leads', { body: texto, tag: 'dist-' + ent.lead_id }); nt.onclick = () => { window.focus(); const bt = document.querySelector('#tabsNav button[data-tab="meusleads"]'); if(bt) bt.click(); kbAbrirFicha(ent.aba, ent.lead_id); }; } catch(_e) {} }
    if(typeof alBip === 'function') try { alBip(); } catch(_e) {}
    kbCarregar();
  }
  kbRenderSuaVez();
}
const KB_SUAVEZ_ESTADO = { na_vez: 'Na vez', pendente: 'Aguardando você ligar', pausa: 'Em pausa', offline: 'Fora do painel', fora: 'Fora do horário' };
// §146.2: faixa "Sua vez" (só os números do próprio consultor). Fora do Automático, só Rápidos e Conversão.
function kbSuaVezHtml(meu, ent, agoraMs){
  if(!meu || !meu.grupo) return '';
  const auto = meu.modo === 'automatico';
  const nums = [`Rápidos: ${Number(meu.rapidos_ok) || 0} de ${Number(meu.rapidos_n) || 0}`, `Conversão 14 dias: ${kbPct(meu.conv)}`];
  if(auto && meu.alvo_hoje !== null && meu.alvo_hoje !== undefined) nums.push(`Hoje: ${Number(meu.recebidos_hoje) || 0} de ~${Number(meu.alvo_hoje) || 0}`);
  let topo = '', lead = '', botao = '';
  if(auto){
    const est = KB_SUAVEZ_ESTADO[meu.estado] || '';
    const ate = meu.estado === 'pausa' && meu.pausa_ate ? ` até ${kbPartesSP(kbMs(meu.pausa_ate)).hora}` : '';
    topo = `<b>Sua vez: ${escapeHtml(est)}${escapeHtml(ate)}</b>`;
    botao = `<button type="button" class="kbBtn kbBtnSm ${meu.estado === 'pausa' ? 'kbBtnP' : 'kbBtnG'}" data-kb-suavez-pausa>${meu.estado === 'pausa' ? 'Voltar' : 'Pausa'}</button>`;
    if(ent){
      const cr = kbCronometro(ent, agoraMs);
      lead = `<span class="kbSuaVezLead"><b>${escapeHtml(ent.nome || '(sem nome)')}</b> <span class="kbCrono ${cr.classe}">${escapeHtml(cr.texto)}</span> `
        + `<button type="button" class="kbBtn kbBtnSm kbBtnP" data-kb-suavez-abrir data-aba="${escapeHtml(ent.aba)}" data-id="${escapeHtml(ent.lead_id)}">Abrir</button></span>`;
    }
  } else {
    topo = '<b>Seus números</b>';
  }
  return `<span>${topo}<small>${escapeHtml(nums.join(' · '))}</small></span>${lead}${botao}`;
}
async function kbCarregarDistMeu(){
  if(!kbEstado.naEquipe) { kbEstado.distMeu = null; return; }
  const r = await ppSeguro(() => sb.rpc('leads_dist_meu'));
  kbEstado.distMeu = r && !r.error ? r.data : null;   // banco sem a função: faixa some
  if(kbEstado.distMeu && Object.prototype.hasOwnProperty.call(kbEstado.distMeu, 'entrega')) kbEstado.distEntrega = kbEstado.distMeu.entrega || kbEstado.distEntrega;
}
function kbRenderSuaVez(){
  const el = document.getElementById('kbSuaVez');
  if(!el) return;
  const ent = kbEstado.distEntrega;
  const html = kbGestor() ? '' : kbSuaVezHtml(kbEstado.distMeu, ent, Date.now());
  el.innerHTML = html; el.hidden = !html;
  clearInterval(kbEstado.timerSuaVez); kbEstado.timerSuaVez = null;
  if(html && ent && kbEstado.distMeu && kbEstado.distMeu.modo === 'automatico'){
    kbEstado.timerSuaVez = setInterval(() => {
      const c = el.querySelector('.kbCrono');
      if(!c || !kbEstado.distEntrega){ clearInterval(kbEstado.timerSuaVez); kbEstado.timerSuaVez = null; return; }
      const cr = kbCronometro(kbEstado.distEntrega, Date.now());
      c.textContent = cr.texto; c.className = 'kbCrono ' + cr.classe;
    }, 1000);
  }
}
async function kbSuaVezPausa(){
  const acao = kbEstado.distMeu && kbEstado.distMeu.estado === 'pausa' ? 'voltar' : 'pausa';
  await kbPresencaPing(acao);
  await kbCarregarDistMeu();
  kbRenderSuaVez();
}
```

3d. Em `kbAgendar`, trocar `kbEstado.timerPresenca = setInterval(() => kbPresencaPing(), 60000);   // §146: presença para a distribuição (qualquer aba)` por:

```js
  kbEstado.timerPresencaMs = 20000;   // §146.2: 20 s — também é o aviso de lead recebido em qualquer aba
  kbEstado.timerPresenca = setInterval(() => kbPresencaPing(), kbEstado.timerPresencaMs);
```

3e. Em `kbParar`, junto de `clearInterval(kbEstado.timerPresenca);`, acrescentar `clearInterval(kbEstado.timerSuaVez); kbEstado.timerSuaVez = null; kbEstado.distMeu = null; kbEstado.distEntrega = null;`.

3f. Em `kbCarregarHoje`, depois de `kbEstado.placarLig = …;` e antes de `kbRenderHoje();`, acrescentar `if(!kbGestor()) await kbCarregarDistMeu();`. No fim de `kbRenderHoje()`, acrescentar `kbRenderSuaVez();`.

3g. No clique delegado do `panel-meusleads` (onde estão `data-kb-dist-modo` e `data-kb-pegar-bloquear`), acrescentar no começo:

```js
  if(e.target.closest('[data-kb-suavez-pausa]')){ kbSuaVezPausa(); return; }
  const sv = e.target.closest('[data-kb-suavez-abrir]');
  if(sv){ kbAbrirFicha(sv.dataset.aba, sv.dataset.id); return; }
```

3h. CSS, depois da regra `.kbDistCfg input{…}`:

```css
  .kbSuaVez{margin-bottom:var(--space-3);}
  .kbSuaVezLead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
  .kbCrono{font-weight:600;padding:2px 8px;border-radius:var(--radius-lg);}
  .kbCrono.ok{color:var(--ml-ok);background:var(--ml-ok-soft);}
  .kbCrono.soon{color:var(--ml-soon);background:var(--ml-soon-soft);}
  .kbCrono.late{color:var(--ml-late);background:var(--ml-late-soft);}
```

Antes de usar `kbPct`, `kbPartesSP` e `kbMs`, conferir que existem (`grep -n "function kbPct\|function kbPartesSP\|function kbMs" _template.html`).

- [ ] **Step 4: Rodar o teste e os vizinhos**

```bash
export NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules
python build_painel.py
for f in test_leads_dist_consultor.js test_leads_distribuicao.js test_leads_bloqueio.js test_leads_hoje.js test_meus_leads_fase3.js test_leads_painel_hoje.js; do node $f 2>&1 | grep RESULTADO; done
```

Esperado: 0 falhas em todos, exceto `test_leads_painel_hoje.js`, que já tem 1 falha de antes ("coluna zerada").

- [ ] **Step 5: Commit**

```bash
git add _template.html painel_clientes_apex.html test_leads_dist_consultor.js
git commit -m "feat(painel): §146.2 Sua vez — aviso de lead recebido, Pausa, cronômetro e números do consultor

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Equipe — liberar o Automático (com confirmação) e escapar o modo (M-7)

**Files:**
- Modify: `_template.html` (`kbFaixaDistribHtml` e `kbDistModo`, perto da linha 6276)
- Modify: `test_leads_distribuicao.js`

**Interfaces:**
- Consumes: `leads_dist_config(p)` (§146.1).
- Produces: `kbDistModo('automatico')` chama `leads_dist_config({p:{modo:'automatico'}})` só depois de `window.confirm`. O botão Automático deixa de ser `disabled`.

- [ ] **Step 1: Ajustar o teste (vermelho)**

Em `test_leads_distribuicao.js`, troque o trecho:

```js
  assert(/data-kb-dist-modo="automatico"[^>]*disabled/.test(h), 'Automático desabilitado na §146.1');
```

por:

```js
  assert(/data-kb-dist-modo="automatico"/.test(h) && !/data-kb-dist-modo="automatico"[^>]*disabled/.test(h), 'Automático liberado (§146.2)');
  assert(kbFaixaDistribHtml(Object.assign({}, D, { cfg: Object.assign({}, D.cfg, { modo: '<x>' }) })).includes('&lt;x&gt;'), 'modo desconhecido escapado (M-7)');
```

E troque:

```js
  await kbDistModo('automatico');
  eq(chamadas('leads_dist_config').length, 1, 'automático não é enviado na §146.1');
```

por:

```js
  window.confirm = () => false;
  await kbDistModo('automatico');
  eq(chamadas('leads_dist_config').length, 1, 'automático cancelado na confirmação não é enviado');
  window.confirm = () => true;
  await kbDistModo('automatico');
  eq(chamadas('leads_dist_config').map(c => c.args).slice(-1), [{ p: { modo: 'automatico' } }], 'automático confirmado é enviado');
```

Rodar `node test_leads_distribuicao.js`. Esperado: FALHOU em 'Automático liberado (§146.2)' e em 'automático confirmado é enviado'.

- [ ] **Step 2: Implementar**

Em `kbFaixaDistribHtml`:
- O botão perde `${m === 'automatico' ? ' disabled title="Liberado na próxima etapa (§146.2)"' : ''}` e vira `data-kb-dist-modo="${m}">${KB_DIST_MODO[m]}</button>`.
- `${KB_DIST_MODO[modo] || modo}` vira `${escapeHtml(KB_DIST_MODO[modo] || modo)}`.

Em `kbDistModo`, a primeira linha passa a ser:

```js
  if(kbEstado.distMudando || !KB_DIST_MODO[modo]) return;
  if(modo === 'automatico' && !window.confirm('Ligar a distribuição automática? Cada lead novo vai cair direto para um consultor; quem não ligar em 5 min perde o lead para o próximo. O time precisa estar com o painel aberto.')) return;
```

- [ ] **Step 3: Rodar o teste**

`node test_leads_distribuicao.js`. Esperado: 0 falhas.

- [ ] **Step 4: Commit**

```bash
git add _template.html painel_clientes_apex.html test_leads_distribuicao.js
git commit -m "feat(painel): §146.2 Automático liberado na Equipe (com confirmação) e modo escapado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: REGRAS, banco, publicação (só com ok do Rafael)

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (subseção `### 146.2`)

- [ ] **Step 1: REGRAS.** Acrescentar `### 146.2 Consultor + Automático liberado` depois da `### 146.1`. O texto deve cobrir:
  - faixa "Sua vez" (estado, Pausa, cronômetro, números, e o que aparece fora do Automático);
  - aviso de lead recebido pela presença, a cada 20 s;
  - "Distribuído automaticamente" e "Voltou aos Livres" na linha do tempo, com o motivo para o gestor;
  - M-1 (não entrega nos últimos 15 min; devolução só no expediente);
  - `leads_dia` sem mudança (decisão 1 deste plano);
  - Automático liberado na Equipe com confirmação. O modo continua o que o Rafael escolher.

  Commit.
- [ ] **Step 2: Pedir ok ao Rafael** (banco + publicação). PARAR até a resposta.
- [ ] **Step 3: Banco.**
  - `execute_sql` com a migration inteira, antes conferindo que a `leads_ficha_detalhes` do ar continua igual à do Step 3 da Task 1.
  - Depois rodar, sem migration, os checks `leads_dist_consultor_check.sql`, `leads_dist_motor_check.sql` e `leads_dist_tick_check.sql`. Todos devem dar `ok`.
- [ ] **Step 4: Publicar** seguindo a memória de publicação:
  - `git fetch oficial`, merge, `bash run_tests.sh` e `python build_painel.py`;
  - conferir que o MD5 do ar é o da `oficial/main`, fazer o backup `…_antes_distribuicao_consultor.html` e enviar, tudo no mesmo comando;
  - conferir o MD5 novo, registrar no REGRAS, `git push oficial feat/leads-dist-consultor:main`, rodar o `vigia -Aceitar`.
- [ ] **Step 5: Avisar o Rafael:**
  - o time precisa dar F5;
  - o Automático só deve ser ligado depois de conferir o "teria × recebeu" da Sombra;
  - no primeiro dia de Automático, deixar a Equipe aberta para acompanhar.
