# Caderno de Ligação + Agenda + Objeções com IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao consultor da discadora um Caderno que nunca perde a anotação, uma Agenda em calendário de mês com alertas e respostas de objeção em 1 clique (biblioteca instantânea + versão da IA para aquele cliente).

**Architecture:** Banco: 5 tabelas novas no Supabase `apex` com RLS por consultor e uma RPC da Mesa. IA: Edge Function `caderno-ia` (lógica pura em `ia.ts`, testada com `node --test`) que mascara dado pessoal e chama o Gemini. Painel: JS puro no `_template.html`, com funções `ag*` (Agenda), `cd*` (Caderno), `obj*` (Objeções) e `al*` (Alertas) testáveis no jsdom, e uma base comum de teste em `painel_teste_base.js`.

**Tech Stack:** Supabase (Postgres 15, RLS, Edge Functions Deno), Gemini `gemini-3.1-flash-lite` (REST), Node 24 (`node --test` com type-stripping), HTML/JS único `_template.html`, jsdom.

**Spec:** `docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md`

## Global Constraints
- Worktree `.worktrees/caderno-agenda`, branch `feat/caderno-agenda` (base `oficial/main` 4d8dfdb). Nunca trocar branch na pasta principal. Sem stash, sem push.
- **Painel:**
  - editar só o `_template.html`; o `painel_clientes_apex.html` é gerado por `python build_painel.py`;
  - o código novo entra no `<script>` principal, logo antes do `</script>` final (linha ~11040);
  - o HTML novo entra no `<main id="appMain">` antes do `</main>`, e o que fica fora das abas vai logo depois do `#apexMindBubble`;
  - o CSS novo vai num bloco `<style id="cadernoStyles">` novo, logo depois do `</style>` do `#ppStyles`.
- **Design "Sinal de Ápice":**
  - não mexer no `<style>` principal, no `aside.sidebar`, no `nav#tabsNav` (além do botão novo no formato existente), no `#pageHead`, no `ApexMotion`, no `mostrarAviso` nem no `fecharOverlay`;
  - **nenhuma cor em hex** no código novo;
  - reaproveitar `.card`, `.btn` (`.btn-sm`, `.btn-outline`, `.btn-ghost`), `.field`, `.badge`, `.filterPill`, `.overlay`/`.modal`/`.mHead`/`.mBody`/`.mClose`, `.retornoBadge`, `.ppNivel`, `table.tbl`, `.kpiGrid`/`.kpiCard`.
- Aviso ao usuário com `mostrarAviso(msg, 'ok'|'erro'|'info')`, nunca `alert()`. Modal fecha com `fecharOverlay(el)` e abre com `el.classList.add('active')`.
- **Horário de São Paulo = UTC−3 fixo.** As datas no banco são `timestamptz`, e o painel monta `YYYY-MM-DDTHH:MM:00-03:00`.
- Telefone → `chaveTel(v)` no painel (já existe) e `public.chave_tel(text)` no banco (já existe). As duas usam a mesma regra.
- **Repositório público:**
  - testes só com dados fictícios (nomes "Teste", telefones `1990000xxxx`, CPF/CNPJ gerados válidos de exemplo);
  - `GEMINI_API_KEY` nunca em arquivo, log, resposta ou mensagem.
- **IA nunca recebe:** nome, CPF, CNPJ, CEP, telefone, e-mail. O painel não envia esses dados, e a função ainda mascara o texto.
- **Supabase `apex` é produção:** aplicar migration, criar secret, fazer deploy e publicar são passos do controlador, cada um **com ok explícito do Rafael na hora** (seção "Entrada no ar" no fim). Nenhuma task de implementação toca produção.
- Falhas antigas conhecidas de `run_tests.sh` (não são regressão): `test_conversao_vendas.js` e `test_pedidos_alerta.js`.
- REGRAS_NEGOCIO.md: seção **§72**.

## Review Focus
1. **CPF de 11 dígitos sem pontuação × celular com DDD (também 11 dígitos):** "11987654321" é telefone, não CPF. Um reconhecimento errado preenche o campo errado. Teste na Task 5 (`cdReconhecer`).
2. **Rascunho que não chegou ao banco (sem rede ou aba fechada no meio):** ao reabrir, a anotação volta e é reenviada, e não duplica, porque o upsert é pelo mesmo `id`. Teste na Task 7.
3. **IA que trava ou demora:** a resposta da biblioteca já está na tela, e depois de 6 s aparece "IA indisponível agora". Nada fica girando para sempre. Teste na Task 8, com uma promessa que nunca resolve.
4. **Retorno lançado à noite, depois das 21h (UTC já é o dia seguinte):** precisa cair no dia certo do calendário. Teste na Task 4 (`agPorDia` com `2026-10-06T22:30-03:00`).
5. **Duas abas do painel abertas:** o alerta do mesmo retorno toca uma vez só. Teste na Task 10.

---

## Parte A — Banco e IA

### Task 1: Migration (tabelas, RLS, gatilhos, biblioteca inicial, RPC da Mesa) + rollback + verificação SQL

**Files:**
- Create: `supabase/migrations/20261006100000_caderno_agenda_objecoes.sql`
- Create: `supabase/rollback/20261006100000_caderno_agenda_objecoes_rollback.sql`
- Create: `supabase/tests/caderno_agenda_check.sql`

**Interfaces — Produces:**
- **Tabelas:**
  - `caderno_notas(id uuid pk, consultor_id, telefone, chave_tel, nome, cpf, cnpj, cep, email, operadora_atual, decisor, qtd_linhas int, valor_plano numeric, fidelidade_vence date, interesse text[], objecoes text[], texto, resultado, criado_em, atualizado_em)`;
  - `agenda_retornos(id uuid pk, consultor_id, nota_id, nome, telefone, chave_tel, quando timestamptz, tipo, qtd_linhas, valor_plano, observacao, origem, status, feito_em, criado_em, atualizado_em)`;
  - `objecoes_respostas(chave pk, rotulo, fala, pergunta, alternativa, ordem, ativo, atualizado_em)`;
  - `objecoes_uso(id, consultor_id, objecao, fonte, util, nota_id, criado_em)`;
  - `caderno_ia_chamadas(id, consultor_id, objecao, status, ms, criado_em)`.
- **RPC:** `mesa_retornos_objecoes(p_ref date) → jsonb`, com o formato `{ "consultores": [{profile_id, nome, hoje, atrasados, feitos7, total7}], "objecoes": [{objecao, usos, uteis}] }`.

- [ ] **Step 1: Migration** — `supabase/migrations/20261006100000_caderno_agenda_objecoes.sql`:

```sql
-- 06/10/2026 — Caderno de Ligação + Agenda + Objeções com IA. REGRAS_NEGOCIO.md §72. Aditiva.
-- Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md

-- 1) Anotações do Caderno (uma por atendimento; id gerado no navegador para o upsert não duplicar)
create table if not exists public.caderno_notas (
  id uuid primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  telefone text, chave_tel text,
  nome text, cpf text, cnpj text, cep text, email text, operadora_atual text, decisor text,
  qtd_linhas int check (qtd_linhas is null or qtd_linhas between 0 and 100000),
  valor_plano numeric(10,2) check (valor_plano is null or valor_plano >= 0),
  fidelidade_vence date,
  interesse text[] not null default '{}',
  objecoes text[] not null default '{}',
  texto text not null default '',
  resultado text check (resultado in ('atendeu','nao_atendeu','caixa_postal','sem_interesse','fechou')),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists caderno_notas_tel_idx on public.caderno_notas (consultor_id, chave_tel);
create index if not exists caderno_notas_cnpj_idx on public.caderno_notas (consultor_id, cnpj);
create index if not exists caderno_notas_recentes_idx on public.caderno_notas (consultor_id, atualizado_em desc);

-- 2) Retornos da Agenda (data E hora)
create table if not exists public.agenda_retornos (
  id uuid primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  nota_id uuid references public.caderno_notas(id) on delete set null,
  nome text not null check (btrim(nome) <> ''),
  telefone text not null,
  chave_tel text,
  quando timestamptz not null,
  tipo text not null default 'ligacao' check (tipo in ('ligacao','whatsapp','reuniao','proposta')),
  qtd_linhas int check (qtd_linhas is null or qtd_linhas between 0 and 100000),
  valor_plano numeric(10,2) check (valor_plano is null or valor_plano >= 0),
  observacao text,
  origem text not null default 'manual' check (origem in ('manual','nao_atendeu','fidelidade')),
  status text not null default 'pendente' check (status in ('pendente','feito','cancelado')),
  feito_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists agenda_retornos_quando_idx on public.agenda_retornos (consultor_id, quando);
create index if not exists agenda_retornos_tel_idx on public.agenda_retornos (consultor_id, chave_tel) where status = 'pendente';

-- 3) Gatilhos: chave_tel, atualizado_em, dono imutável, feito_em
create or replace function public.caderno_agenda_preenche() returns trigger
language plpgsql set search_path = public as $$
begin
  new.chave_tel := public.chave_tel(new.telefone);
  new.atualizado_em := now();
  if tg_op = 'UPDATE' then
    new.consultor_id := old.consultor_id;
    new.criado_em := old.criado_em;
  end if;
  if tg_table_name = 'agenda_retornos' then
    if new.status = 'feito' and (tg_op = 'INSERT' or old.status <> 'feito') then new.feito_em := now(); end if;
    if new.status <> 'feito' then new.feito_em := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists caderno_notas_preenche on public.caderno_notas;
create trigger caderno_notas_preenche before insert or update on public.caderno_notas
  for each row execute function public.caderno_agenda_preenche();
drop trigger if exists agenda_retornos_preenche on public.agenda_retornos;
create trigger agenda_retornos_preenche before insert or update on public.agenda_retornos
  for each row execute function public.caderno_agenda_preenche();

-- 4) RLS: consultor só o que é dele; admin/supervisor leem tudo; ninguém apaga (retorno se cancela por status)
alter table public.caderno_notas enable row level security;
alter table public.agenda_retornos enable row level security;
do $$
declare t text;
begin
  foreach t in array array['caderno_notas', 'agenda_retornos'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (consultor_id = auth.uid() or public.get_my_role() in (''admin'', ''supervisor''))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (consultor_id = auth.uid())', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (consultor_id = auth.uid()) with check (consultor_id = auth.uid())', t);
    execute format('revoke delete on public.%1$s from anon, authenticated', t);
  end loop;
end $$;

-- 5) Biblioteca de objeções (texto de RASCUNHO: o Rafael aprova antes de publicar; sem preço em R$)
create table if not exists public.objecoes_respostas (
  chave text primary key check (chave ~ '^[a-z0-9_]{2,40}$'),
  rotulo text not null,
  fala text not null,
  pergunta text not null default '',
  alternativa text not null default '',
  ordem int not null default 100,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now()
);
alter table public.objecoes_respostas enable row level security;
drop policy if exists objecoes_respostas_select on public.objecoes_respostas;
create policy objecoes_respostas_select on public.objecoes_respostas for select to authenticated using (true);
drop policy if exists objecoes_respostas_escrita on public.objecoes_respostas;
create policy objecoes_respostas_escrita on public.objecoes_respostas for all to authenticated
  using (public.get_my_role() in ('admin', 'supervisor')) with check (public.get_my_role() in ('admin', 'supervisor'));
insert into public.objecoes_respostas (chave, rotulo, fala, pergunta, alternativa, ordem) values
  ('caro', 'Tá caro',
   'Entendo. Pra eu comparar certo: hoje são quantas linhas e quanto de internet em cada uma? Muitas vezes, olhando por linha, a conta fica parecida e com mais franquia.',
   'Se o valor ficasse dentro do que o senhor paga hoje, faria sentido trocar?',
   'Desça um degrau mantendo as linhas: de 100GB para 70GB, ou de 70GB para 40GB.', 1),
  ('fidelidade', 'Tenho fidelidade/multa',
   'Faz sentido não querer pagar multa. Quando vence a sua fidelidade? Eu deixo tudo pronto e te ligo antes, pra trocar sem custo.',
   'Qual o mês de vencimento do contrato atual?',
   'Anote o vencimento no Caderno: o painel sugere o retorno 45 dias antes.', 2),
  ('pensar', 'Vou pensar',
   'Claro, é uma decisão importante. Pra eu te ajudar: o que ficou de dúvida, o valor, a franquia ou a troca em si?',
   'Se eu resolver essa dúvida agora, a gente consegue seguir hoje?',
   'Agende o retorno para amanhã com hora combinada com o cliente.', 3),
  ('socio', 'Preciso falar com o sócio',
   'Perfeito, é bom decidir junto. Vamos marcar um horário rápido com vocês dois? Assim eu explico direto e ninguém fica no telefone sem fio.',
   'Qual o melhor horário para falar com o senhor e o sócio juntos?',
   'Envie a proposta pelo WhatsApp e agende o retorno com o decisor.', 4),
  ('satisfeito', 'Já tenho operadora e estou satisfeito',
   'Que bom que está bem atendido. Não quero te tirar de algo que funciona: só me deixa ver se dá pra ter o mesmo pagando menos ou com mais internet. Leva dois minutos.',
   'O que o senhor mais gosta no plano de hoje?',
   'Pergunte linhas e franquia atuais e compare com 70GB e 100GB.', 5),
  ('manda', 'Me manda por WhatsApp/e-mail',
   'Mando sim, agora mesmo. Só pra proposta ir certinha: são quantas linhas e quanto de internet vocês usam hoje?',
   'Posso te ligar amanhã de manhã pra tirar as dúvidas da proposta?',
   'Mande a proposta e agende o retorno para o dia seguinte.', 6),
  ('sinal', 'Sinal da Claro é ruim aqui',
   'Obrigado por avisar, isso é importante. Me passa o CEP da empresa que eu confiro a cobertura agora; se não atender bem, eu mesmo te falo.',
   'O sinal ruim é dentro da empresa ou na região toda?',
   'Confira a cobertura pelo CEP antes de seguir.', 7),
  ('ocupado', 'Agora não posso falar',
   'Sem problema, não vou tomar seu tempo. Qual o melhor horário pra eu te ligar? É coisa de cinco minutos.',
   'Prefere de manhã ou à tarde?',
   'Agende o retorno no horário que o cliente disser.', 8),
  ('sem_interesse', 'Não tenho interesse',
   'Entendo. Só uma pergunta rápida pra eu não te ligar à toa: hoje a empresa usa quantas linhas de celular?',
   'Se eu mostrasse uma economia na conta de celular da empresa, valeria cinco minutos?',
   'Se o cliente insistir, marque "Sem interesse" e encerre com educação.', 9)
on conflict (chave) do nothing;

-- 6) Uso das respostas (para a Mesa saber o que aparece e o que funciona)
create table if not exists public.objecoes_uso (
  id bigint generated always as identity primary key,
  consultor_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  objecao text not null,
  fonte text not null check (fonte in ('biblioteca','ia')),
  util boolean,
  nota_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists objecoes_uso_criado_idx on public.objecoes_uso (criado_em desc);
alter table public.objecoes_uso enable row level security;
drop policy if exists objecoes_uso_select on public.objecoes_uso;
create policy objecoes_uso_select on public.objecoes_uso for select to authenticated
  using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
drop policy if exists objecoes_uso_insert on public.objecoes_uso;
create policy objecoes_uso_insert on public.objecoes_uso for insert to authenticated with check (consultor_id = auth.uid());
revoke update, delete on public.objecoes_uso from anon, authenticated;

-- 7) Chamadas à IA (limite por consultor + log; escrita só pela Edge Function com service role; sem texto do cliente)
create table if not exists public.caderno_ia_chamadas (
  id bigint generated always as identity primary key,
  consultor_id uuid not null,
  objecao text,
  status text not null,
  ms int,
  criado_em timestamptz not null default now()
);
create index if not exists caderno_ia_chamadas_idx on public.caderno_ia_chamadas (consultor_id, criado_em desc);
alter table public.caderno_ia_chamadas enable row level security;
drop policy if exists caderno_ia_chamadas_select on public.caderno_ia_chamadas;
create policy caderno_ia_chamadas_select on public.caderno_ia_chamadas for select to authenticated
  using (public.get_my_role() in ('admin', 'supervisor'));
revoke insert, update, delete on public.caderno_ia_chamadas from anon, authenticated;

-- 8) Bloco "Retornos e objeções" da Mesa do Supervisor
create or replace function public.mesa_retornos_objecoes(p_ref date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cons jsonb; v_obj jsonb;
begin
  if coalesce(public.get_my_role(), '') not in ('admin', 'supervisor') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x.atrasados desc, x.hoje desc, x.nome), '[]'::jsonb) into v_cons from (
    select p.id as profile_id, p.nome,
      count(*) filter (where r.status = 'pendente' and (r.quando at time zone 'America/Sao_Paulo')::date = p_ref) as hoje,
      count(*) filter (where r.status = 'pendente' and r.quando < now()) as atrasados,
      count(*) filter (where r.status = 'feito' and (r.quando at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref
                         and (r.feito_em at time zone 'America/Sao_Paulo')::date = (r.quando at time zone 'America/Sao_Paulo')::date) as feitos7,
      count(*) filter (where r.status <> 'cancelado' and (r.quando at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref) as total7
    from public.profiles p
    left join public.agenda_retornos r on r.consultor_id = p.id
    where p.role = 'consultor'
    group by p.id, p.nome
  ) x;
  select coalesce(jsonb_agg(y order by y.usos desc, y.objecao), '[]'::jsonb) into v_obj from (
    select u.objecao, count(*) as usos, count(*) filter (where u.util) as uteis
    from public.objecoes_uso u
    where (u.criado_em at time zone 'America/Sao_Paulo')::date between p_ref - 6 and p_ref
    group by u.objecao order by count(*) desc, u.objecao limit 5
  ) y;
  return jsonb_build_object('consultores', v_cons, 'objecoes', v_obj);
end $$;
revoke all on function public.mesa_retornos_objecoes(date) from public, anon;
grant execute on function public.mesa_retornos_objecoes(date) to authenticated;
```

- [ ] **Step 2: Rollback** — `supabase/rollback/20261006100000_caderno_agenda_objecoes_rollback.sql`:

```sql
-- Desfaz 20261006100000_caderno_agenda_objecoes.sql (§72). APAGA as anotações e retornos: só usar antes de ter dados reais
-- ou depois de exportar as tabelas.
drop function if exists public.mesa_retornos_objecoes(date);
drop table if exists public.caderno_ia_chamadas;
drop table if exists public.objecoes_uso;
drop table if exists public.objecoes_respostas;
drop table if exists public.agenda_retornos;
drop table if exists public.caderno_notas;
drop function if exists public.caderno_agenda_preenche();
```

- [ ] **Step 3: Verificação SQL** — `supabase/tests/caderno_agenda_check.sql` (mesmo estilo de `velocidade_lead_mesa_check.sql`; sempre ROLLBACK):

```sql
-- Verificação de 20261006100000_caderno_agenda_objecoes.sql. Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis fictícios (zz*).
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000cc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.cdoutro@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000cc01', 'Zzcdcons Teste', 'zz.cdcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000cc02', 'Zzcdsup Teste',  'zz.cdsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000cc03', 'Zzcdoutro Teste','zz.cdoutro','consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;

do $$
declare n int; j jsonb;
begin
  execute 'set local role authenticated';
  -- consultor cc01
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc01', true);
  insert into public.caderno_notas (id, telefone, nome, texto) values ('00000000-0000-0000-0000-0000000000a1', '(19) 90000-0001', 'Empresa Teste', 'nota 1');
  -- upsert pelo mesmo id não duplica e mantém o dono
  insert into public.caderno_notas (id, telefone, nome, texto) values ('00000000-0000-0000-0000-0000000000a1', '(19) 90000-0001', 'Empresa Teste', 'nota 1 editada')
    on conflict (id) do update set texto = excluded.texto;
  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1';
  assert n = 1, 'upsert duplicou a nota';
  assert (select chave_tel from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1') = public.chave_tel('(19) 90000-0001'), 'chave_tel preenchida';
  insert into public.agenda_retornos (id, nome, telefone, quando) values
    ('00000000-0000-0000-0000-0000000000b1', 'Empresa Teste', '19900000001', now() - interval '1 hour'),
    ('00000000-0000-0000-0000-0000000000b2', 'Empresa Teste', '19900000001', now() + interval '1 day');
  update public.agenda_retornos set status = 'feito' where id = '00000000-0000-0000-0000-0000000000b1';
  assert (select feito_em from public.agenda_retornos where id = '00000000-0000-0000-0000-0000000000b1') is not null, 'feito_em preenchido';
  begin
    insert into public.agenda_retornos (id, nome, telefone, quando, status) values ('00000000-0000-0000-0000-0000000000b3', 'X', '1', now(), 'sumiu');
    assert false, 'status inválido aceito';
  exception when check_violation then null; end;
  begin
    insert into public.caderno_notas (id, consultor_id, texto) values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-00000000cc03', 'x');
    assert false, 'consultor gravou nota em nome de outro';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_retornos_objecoes(current_date);
    assert false, 'consultor chamou a RPC da Mesa';
  exception when insufficient_privilege then null; end;
  insert into public.objecoes_uso (objecao, fonte, util) values ('caro', 'ia', true);
  begin
    update public.objecoes_respostas set fala = 'x' where chave = 'caro';
    get diagnostics n = row_count;
    assert n = 0, 'consultor editou a biblioteca';
  end;
  -- outro consultor cc03 não vê nem altera o do cc01
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc03', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc03', true);
  select count(*) into n from public.caderno_notas where id = '00000000-0000-0000-0000-0000000000a1';
  assert n = 0, 'outro consultor leu a nota';
  update public.agenda_retornos set status = 'cancelado' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count;
  assert n = 0, 'outro consultor alterou o retorno';
  select count(*) into n from public.objecoes_respostas where ativo;
  assert n >= 9, 'biblioteca semeada e legível';
  -- supervisor lê tudo e chama a RPC
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000cc02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000cc02', true);
  select count(*) into n from public.agenda_retornos where consultor_id = '00000000-0000-0000-0000-00000000cc01';
  assert n = 2, 'supervisor lê os retornos do consultor';
  j := public.mesa_retornos_objecoes((now() at time zone 'America/Sao_Paulo')::date);
  assert exists (select 1 from jsonb_array_elements(j->'consultores') e where e->>'nome' = 'Zzcdcons Teste' and (e->>'feitos7')::int = 1), 'RPC: feitos7 do consultor';
  assert exists (select 1 from jsonb_array_elements(j->'objecoes') e where e->>'objecao' = 'caro' and (e->>'uteis')::int >= 1), 'RPC: top objeções';
  -- anônimo não lê nada
  execute 'set local role anon';
  select count(*) into n from public.caderno_notas;
  assert n = 0, 'anônimo leu notas';
end $$;
rollback;
```

- [ ] **Step 4: Conferir sem tocar produção.** Não há Postgres local. A revisão é por leitura: o rollback espelha cada objeto criado, e toda `create policy` tem um `drop policy if exists` antes.

```bash
grep -c "create policy" supabase/migrations/20261006100000_caderno_agenda_objecoes.sql
grep -c "drop policy if exists" supabase/migrations/20261006100000_caderno_agenda_objecoes.sql
```
Esperado: `8` e `8` (3 dentro do `format()` do loop + 2 de `objecoes_respostas` + 2 de `objecoes_uso` + 1 de `caderno_ia_chamadas`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261006100000_caderno_agenda_objecoes.sql supabase/rollback/20261006100000_caderno_agenda_objecoes_rollback.sql supabase/tests/caderno_agenda_check.sql
git commit -m "feat(caderno): migration de notas, retornos, objecoes e RPC da Mesa (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Edge Function `caderno-ia` — lógica pura (mascarar, validar, prompt, resposta, limite)

**Files:**
- Create: `supabase/functions/caderno-ia/ia.ts`
- Test: `supabase/functions/caderno-ia/ia.test.ts`

**Interfaces — Produces** (`ia.ts`):
- `mascarar(texto: string): string`
- `validarEntrada(corpo: unknown): { ok: true; dados: Entrada } | { ok: false; erro: string }`, com `Entrada = { objecao_chave: string | null; objecao_livre: string | null; contexto: Contexto }` e `Contexto = { qtd_linhas: number | null; valor_plano: number | null; operadora_atual: string; fidelidade_vence: string; interesse: string[]; texto: string }`
- `montarPrompt(dados: Entrada, base: Objecao | null, todas: Objecao[]): string`, com `Objecao = { chave: string; rotulo: string; fala: string; pergunta: string; alternativa: string }`
- `lerRespostaIA(bruto: string): { fala: string; pergunta: string } | null`
- `LIMITE_CHAMADAS = 20`, `JANELA_MIN = 10`
- `responder(corpo: unknown, uid: string, deps: DepsIA): Promise<{ status: number; body: Record<string, unknown> }>`, com `DepsIA = { buscarObjecao(chave): Promise<Objecao|null>; listarObjecoes(): Promise<Objecao[]>; contarChamadas(uid, desdeIso): Promise<number>; registrarChamada(r: { consultor_id: string; objecao: string | null; status: string; ms: number }): Promise<void>; chamarGemini(prompt: string): Promise<string>; agora(): number }`

- [ ] **Step 1: Teste (falha)** — `supabase/functions/caderno-ia/ia.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mascarar, validarEntrada, montarPrompt, lerRespostaIA, responder, LIMITE_CHAMADAS } from "./ia.ts";
import type { DepsIA } from "./ia.ts";

test("mascarar: CPF, CNPJ, telefone, CEP e e-mail viram marcadores; texto comercial fica", () => {
  const t = "cnpj 11.222.333/0001-81, cpf 123.456.789-09, tel (19) 99000-0001, cep 13010-000, a@b.com.br. 12 linhas na Vivo";
  const m = mascarar(t);
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(m) && m.includes("[CPF]"));
  assert.ok(m.includes("[CNPJ]") && m.includes("[TELEFONE]") && m.includes("[CEP]") && m.includes("[EMAIL]"));
  assert.ok(m.includes("12 linhas na Vivo"));
  assert.equal(mascarar("11987654321 e 12345678909"), "[TELEFONE] e [CPF]");
  assert.equal(mascarar(""), "");
});

test("validarEntrada: exige chave OU texto livre; limita tamanhos; contexto só com campos permitidos", () => {
  assert.equal(validarEntrada(null).ok, false);
  assert.equal(validarEntrada({ contexto: {} }).ok, false);
  const r = validarEntrada({ objecao_chave: "caro", contexto: { qtd_linhas: "12", nome: "Fulano", cpf: "123", texto: "x".repeat(5000) } });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.dados.contexto.qtd_linhas, 12);
    assert.equal(r.dados.contexto.texto.length, 2000);
    assert.ok(!("nome" in r.dados.contexto) && !("cpf" in r.dados.contexto));
  }
  assert.equal(validarEntrada({ objecao_chave: "CARO!", contexto: {} }).ok, false);
  const livre = validarEntrada({ objecao_livre: "  meu contador cuida disso  ", contexto: {} });
  assert.ok(livre.ok && livre.dados.objecao_livre === "meu contador cuida disso");
});

test("montarPrompt: traz a base, as franquias, proíbe preço e já vem mascarado", () => {
  const base = { chave: "caro", rotulo: "Tá caro", fala: "Fala base", pergunta: "Pergunta base", alternativa: "Alt base" };
  const r = validarEntrada({ objecao_chave: "caro", contexto: { qtd_linhas: 12, operadora_atual: "Vivo", texto: "tel 19990000001" } });
  assert.ok(r.ok);
  if (!r.ok) return;
  const p = montarPrompt(r.dados, base, [base]);
  assert.ok(p.includes("Fala base") && p.includes("12GB, 40GB, 70GB, 100GB e 150GB"));
  assert.ok(/nunca cite preço em R\$/i.test(p));
  assert.ok(p.includes("[TELEFONE]") && !p.includes("19990000001"));
  assert.ok(p.includes('{"fala"'));
});

test("lerRespostaIA: JSON puro, dentro de ```json```, inválido e corta em 3 frases", () => {
  assert.deepEqual(lerRespostaIA('{"fala":"A.","pergunta":"B?"}'), { fala: "A.", pergunta: "B?" });
  assert.deepEqual(lerRespostaIA('```json\n{"fala":"A.","pergunta":""}\n```'), { fala: "A.", pergunta: "" });
  assert.equal(lerRespostaIA("não é json"), null);
  assert.equal(lerRespostaIA('{"pergunta":"só"}'), null);
  const longa = lerRespostaIA('{"fala":"Um. Dois. Três. Quatro. Cinco.","pergunta":"P?"}');
  assert.equal(longa?.fala, "Um. Dois. Três.");
});

function deps(extra: Partial<DepsIA> = {}): DepsIA & { log: unknown[]; prompts: string[] } {
  const log: unknown[] = []; const prompts: string[] = [];
  return Object.assign({
    log, prompts,
    buscarObjecao: async (c: string) => (c === "caro" ? { chave: "caro", rotulo: "Tá caro", fala: "F", pergunta: "P", alternativa: "A" } : null),
    listarObjecoes: async () => [],
    contarChamadas: async () => 0,
    registrarChamada: async (r: unknown) => { log.push(r); },
    chamarGemini: async (p: string) => { prompts.push(p); return '{"fala":"Resposta.","pergunta":"Pergunta?"}'; },
    agora: () => 1_000_000,
  }, extra);
}

test("responder: caminho feliz grava log sem texto e devolve fala/pergunta", async () => {
  const d = deps();
  const r = await responder({ objecao_chave: "caro", contexto: { texto: "cpf 123.456.789-09" } }, "u1", d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { fala: "Resposta.", pergunta: "Pergunta?" });
  assert.equal((d.log[0] as { status: string }).status, "ok");
  assert.ok(!JSON.stringify(d.log).includes("123.456"));
  assert.ok(!d.prompts[0].includes("123.456.789-09"));
});

test("responder: entrada inválida 400, objeção inexistente 404, limite 429, IA quebrada 503", async () => {
  assert.equal((await responder({}, "u1", deps())).status, 400);
  assert.equal((await responder({ objecao_chave: "nao_existe", contexto: {} }, "u1", deps())).status, 404);
  const cheio = deps({ contarChamadas: async () => LIMITE_CHAMADAS });
  const r429 = await responder({ objecao_chave: "caro", contexto: {} }, "u1", cheio);
  assert.equal(r429.status, 429);
  assert.equal(cheio.prompts.length, 0);
  const quebrada = deps({ chamarGemini: async () => { throw new Error("503 high demand"); } });
  const r503 = await responder({ objecao_chave: "caro", contexto: {} }, "u1", quebrada);
  assert.equal(r503.status, 503);
  assert.equal((quebrada.log[0] as { status: string }).status, "erro_ia");
  const lixo = deps({ chamarGemini: async () => "sem json" });
  assert.equal((await responder({ objecao_chave: "caro", contexto: {} }, "u1", lixo)).status, 503);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test supabase/functions/caderno-ia/ia.test.ts`
Expected: FAIL com `Cannot find module './ia.ts'`.

- [ ] **Step 3: Implementação** — `supabase/functions/caderno-ia/ia.ts`:

```ts
// Lógica pura da Edge Function caderno-ia (06/10/2026, REGRAS_NEGOCIO.md §72). Sem Deno/rede/Supabase: testável com
// `node --test`. Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md (seções 6.3 e 10).

export type Contexto = { qtd_linhas: number | null; valor_plano: number | null; operadora_atual: string; fidelidade_vence: string; interesse: string[]; texto: string };
export type Entrada = { objecao_chave: string | null; objecao_livre: string | null; contexto: Contexto };
export type Objecao = { chave: string; rotulo: string; fala: string; pergunta: string; alternativa: string };
export type DepsIA = {
  buscarObjecao(chave: string): Promise<Objecao | null>;
  listarObjecoes(): Promise<Objecao[]>;
  contarChamadas(uid: string, desdeIso: string): Promise<number>;
  registrarChamada(r: { consultor_id: string; objecao: string | null; status: string; ms: number }): Promise<void>;
  chamarGemini(prompt: string): Promise<string>;
  agora(): number;
};

export const LIMITE_CHAMADAS = 20;
export const JANELA_MIN = 10;

// Segunda barreira: o painel já não manda esses campos, mas o texto livre pode conter qualquer coisa.
export function mascarar(texto: string): string {
  return String(texto ?? "")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[EMAIL]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, (m) => {
      const d = m.replace(/\D/g, "");
      // 11 dígitos com 3º dígito diferente de 9 não é celular com DDD: trata como CPF
      if (d.length === 11 && d[2] !== "9") return "[CPF]";
      return "[TELEFONE]";
    })
    .replace(/\b\d{11}\b/g, "[CPF]")
    .replace(/\b\d{5}-\d{3}\b/g, "[CEP]");
}

const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function validarEntrada(corpo: unknown): { ok: true; dados: Entrada } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object") return { ok: false, erro: "corpo inválido" };
  const c = corpo as Record<string, unknown>;
  const chave = c.objecao_chave == null ? null : String(c.objecao_chave);
  const livre = c.objecao_livre == null ? null : txt(c.objecao_livre, 300);
  if (chave !== null && !/^[a-z0-9_]{2,40}$/.test(chave)) return { ok: false, erro: "objeção inválida" };
  if (!chave && !livre) return { ok: false, erro: "informe a objeção" };
  const ctx = (c.contexto && typeof c.contexto === "object" ? c.contexto : {}) as Record<string, unknown>;
  return {
    ok: true,
    dados: {
      objecao_chave: chave, objecao_livre: livre || null,
      contexto: {
        qtd_linhas: num(ctx.qtd_linhas), valor_plano: num(ctx.valor_plano),
        operadora_atual: txt(ctx.operadora_atual, 40), fidelidade_vence: txt(ctx.fidelidade_vence, 10),
        interesse: Array.isArray(ctx.interesse) ? ctx.interesse.map((x) => txt(x, 20)).slice(0, 5) : [],
        texto: txt(ctx.texto, 2000),
      },
    },
  };
}

export function montarPrompt(dados: Entrada, base: Objecao | null, todas: Objecao[]): string {
  const c = dados.contexto;
  const linhas = [
    "Você é um consultor experiente da Claro Empresas (B2B, telefonia móvel e fibra para CNPJ), em uma ligação AGORA.",
    "Escreva o que o consultor deve FALAR ao cliente, em português do Brasil, tom direto e cordial, como fala ao telefone.",
    "Regras: no máximo 3 frases na fala; nunca cite preço em R$, promoção, desconto, prazo ou condição que não esteja abaixo;",
    "franquias que podem ser citadas: 12GB, 40GB, 70GB, 100GB e 150GB (ancoragem: começar em 100GB ou 70GB).",
    "Termine com UMA pergunta de contorno para entender o motivo real.",
    "",
    "Dados do atendimento (dados pessoais já removidos):",
    `- linhas: ${c.qtd_linhas ?? "não informado"}; valor que paga hoje: ${c.valor_plano ?? "não informado"}`,
    `- operadora atual: ${c.operadora_atual || "não informada"}; fidelidade vence: ${c.fidelidade_vence || "não informado"}`,
    `- interesse: ${c.interesse.join(", ") || "não informado"}`,
    `- anotação do consultor: ${mascarar(c.texto) || "(vazia)"}`,
    "",
  ];
  if (base) {
    linhas.push(`Objeção do cliente: "${base.rotulo}".`, `Resposta aprovada pela empresa (use como base e adapte ao cliente): ${base.fala}`,
      `Pergunta aprovada: ${base.pergunta}`, `Alternativa de oferta: ${base.alternativa}`);
  } else {
    linhas.push(`O cliente disse: "${mascarar(dados.objecao_livre ?? "")}".`, "Respostas aprovadas pela empresa para outras objeções (siga o mesmo estilo):",
      ...todas.slice(0, 9).map((o) => `- ${o.rotulo}: ${o.fala}`));
  }
  linhas.push("", 'Responda SOMENTE com JSON: {"fala": "...", "pergunta": "..."}');
  return linhas.join("\n");
}

function tresFrases(s: string): string {
  const partes = s.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return partes.slice(0, 3).map((p) => p.trim()).join(" ");
}

export function lerRespostaIA(bruto: string): { fala: string; pergunta: string } | null {
  const limpo = String(bruto ?? "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const j = JSON.parse(limpo);
    if (!j || typeof j.fala !== "string" || !j.fala.trim()) return null;
    return { fala: tresFrases(j.fala), pergunta: typeof j.pergunta === "string" ? j.pergunta.trim() : "" };
  } catch {
    return null;
  }
}

export async function responder(corpo: unknown, uid: string, deps: DepsIA): Promise<{ status: number; body: Record<string, unknown> }> {
  const v = validarEntrada(corpo);
  if (!v.ok) return { status: 400, body: { error: v.erro } };
  const inicio = deps.agora();
  const desde = new Date(inicio - JANELA_MIN * 60000).toISOString();
  if ((await deps.contarChamadas(uid, desde)) >= LIMITE_CHAMADAS) return { status: 429, body: { error: "limite" } };
  let base: Objecao | null = null;
  let todas: Objecao[] = [];
  if (v.dados.objecao_chave) {
    base = await deps.buscarObjecao(v.dados.objecao_chave);
    if (!base) return { status: 404, body: { error: "objeção não encontrada" } };
  } else {
    todas = await deps.listarObjecoes();
  }
  const objecao = v.dados.objecao_chave ?? "livre";
  try {
    const bruto = await deps.chamarGemini(montarPrompt(v.dados, base, todas));
    const r = lerRespostaIA(bruto);
    if (!r) {
      await deps.registrarChamada({ consultor_id: uid, objecao, status: "resposta_invalida", ms: deps.agora() - inicio });
      return { status: 503, body: { error: "ia_indisponivel" } };
    }
    await deps.registrarChamada({ consultor_id: uid, objecao, status: "ok", ms: deps.agora() - inicio });
    return { status: 200, body: r };
  } catch {
    await deps.registrarChamada({ consultor_id: uid, objecao, status: "erro_ia", ms: deps.agora() - inicio });
    return { status: 503, body: { error: "ia_indisponivel" } };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test supabase/functions/caderno-ia/ia.test.ts`
Expected: PASS, 6 testes. Se `mascarar("11987654321 e 12345678909")` falhar, confira a ordem dos `replace`: o de telefone precisa rodar antes do `\b\d{11}\b`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/caderno-ia/ia.ts supabase/functions/caderno-ia/ia.test.ts
git commit -m "feat(caderno-ia): logica pura de mascaramento, prompt e limite (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Edge Function `caderno-ia` — HTTP, login, Supabase e Gemini

**Files:**
- Create: `supabase/functions/caderno-ia/index.ts`

**Interfaces — Consumes:** `responder`, `DepsIA` e `Objecao` da Task 2. **Produces:** o endpoint `POST /functions/v1/caderno-ia`, chamado pelo painel com `sb.functions.invoke('caderno-ia', { body })` e que devolve `{fala, pergunta}`, ou `{error}` com status 400, 401, 404, 429 ou 503.

O `index.ts` só liga peças já testadas e não tem teste unitário. Ele é conferido na entrada no ar (passo 3 do fim do plano) com uma chamada real.

- [ ] **Step 1: Implementação** — `supabase/functions/caderno-ia/index.ts`:

```ts
// Edge Function: caderno-ia (06/10/2026, REGRAS_NEGOCIO.md §72) — resposta de objeção adaptada ao cliente, via Gemini.
// Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md (seção 10).
// Publicar com verify_jwt = true (só usuário logado). Secret: GEMINI_API_KEY (o Rafael cria pelo CLI; nunca no repo).
// Log: só objeção, status e tempo — nunca o texto do cliente.
import { createClient } from "npm:@supabase/supabase-js@2";
import { responder } from "./ia.ts";
import type { DepsIA, Objecao } from "./ia.ts";

const MODELO = "gemini-3.1-flash-lite";
const TIMEOUT_MS = 6000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
}

async function gemini(prompt: string, chave: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 300 },
        }),
      });
      if (r.status === 503 && tentativa === 0) continue; // o gratuito devolve 503 "high demand" com frequência
      if (!r.ok) throw new Error(`gemini http ${r.status}`);
      const j = await r.json();
      const texto = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      if (!texto) throw new Error("gemini sem texto");
      return texto;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("gemini indisponível");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);
    const url = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY"), chave = env("GEMINI_API_KEY");
    const caller = createClient(url, service, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: u, error: ue } = await caller.auth.getUser();
    if (ue || !u?.user) return json({ error: "Sessão inválida." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const campos = "chave,rotulo,fala,pergunta,alternativa";
    const deps: DepsIA = {
      async buscarObjecao(c) {
        const { data } = await admin.from("objecoes_respostas").select(campos).eq("chave", c).eq("ativo", true).maybeSingle();
        return (data as Objecao | null) ?? null;
      },
      async listarObjecoes() {
        const { data } = await admin.from("objecoes_respostas").select(campos).eq("ativo", true).order("ordem");
        return (data as Objecao[] | null) ?? [];
      },
      async contarChamadas(uid, desde) {
        const { count } = await admin.from("caderno_ia_chamadas").select("id", { count: "exact", head: true })
          .eq("consultor_id", uid).gte("criado_em", desde);
        return count ?? 0;
      },
      async registrarChamada(r) {
        const { error } = await admin.from("caderno_ia_chamadas").insert(r);
        if (error) console.error("caderno-ia: falha ao registrar chamada", error.code ?? "?");
      },
      chamarGemini: (p) => gemini(p, chave),
      agora: () => Date.now(),
    };
    let corpo: unknown;
    try { corpo = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const r = await responder(corpo, u.user.id, deps);
    console.log(`caderno-ia status=${r.status}`);
    return json(r.body, r.status);
  } catch (e) {
    console.error("caderno-ia: erro", e instanceof Error ? e.message.slice(0, 80) : "?");
    return json({ error: "ia_indisponivel" }, 503);
  }
});
```

- [ ] **Step 2: Conferência estática.** Rode `node --test supabase/functions/caderno-ia/ia.test.ts` de novo (deve continuar PASS). Depois confirme que `index.ts` não loga o corpo:

Run: `grep -n "console\." supabase/functions/caderno-ia/index.ts`
Expected: só as 3 linhas acima, nenhuma imprimindo `corpo`, `prompt` ou `u.user.email`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/caderno-ia/index.ts
git commit -m "feat(caderno-ia): endpoint HTTP com login, limite e Gemini (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Parte B — Painel

### Task 4: Base de teste comum + funções puras da Agenda (`ag*`)

**Files:**
- Create: `painel_teste_base.js` (o nome não começa com `test_`, para o `run_tests.sh` não rodar como teste)
- Modify: `_template.html` (o bloco novo de JS vai antes do `</script>` final)
- Test: `test_agenda.js`

**Interfaces — Produces:**
- `painel_teste_base.js`: `montarPainel() → { window, rodar(corpo: string) }`. A janela vem com o Supabase falso (`window.__tabelas`, `__escritas`, `__rpcCalls`, `__rpcRespostas`, `__invocacoes`, `__invokeResposta`, `__falharEscrita`, `__notificacoes`, `__abertos`, `__copiados`).
  - `rodar` executa o script do painel + `corpo`, com `assert`, `eq`, `espera`, `sp` e `avisos()` (texto de todos os `mostrarAviso`).
  - O corpo termina chamando `fim()`.
- `_template.html` (globais):
  - `AG_TZ_MS`, `agAgora() → number`
  - `agPartesSP(isoOuMs) → {dia, hora}`, `agIsoSP(dia, hora) → string`
  - `agMesVizinho(ym, delta) → 'YYYY-MM'`, `agRotuloMes(ym) → 'OUTUBRO 2026'`, `agGradeMes(ym) → [{dia, doMes}]`
  - `agSituacao(r, agora) → 'feito'|'cancelado'|'atrasado'|'pendente'`
  - `agPorDia(retornos, pedidos) → Map<dia, {retornos, pedidos}>`
  - `agResumoDia(entrada, agora) → {visiveis, mais, atrasados}`
  - `agAtalhos(agora) → [{rotulo, dia, hora}]`
  - `agRemarcarMesmoHorario(quandoIso, novoDia) → iso`
  - `agValidarRetorno(f, agora) → {erro, aviso}`
  - `agPedidosItens(calc) → [{dia, numero, cliente, tipoData}]`
  - `AG_TIPOS`

- [ ] **Step 1: Base de teste** — `painel_teste_base.js`:

```js
// Base comum dos testes do Caderno / Agenda / Objeções (06/10/2026, REGRAS_NEGOCIO.md §72).
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

function montarPainel(){
  const html = fs.readFileSync('_template.html', 'utf8');
  const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
  const m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  if(!m) throw new Error('script nao encontrado');
  const jsCode = m[1];
  const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(window, { __tabelas: {}, __escritas: [], __rpcCalls: [], __rpcRespostas: {}, __invocacoes: [], __invokeResposta: null,
    __falharEscrita: null, __alertas: [], __notificacoes: [], __abertos: [], __copiados: [] });

  function builder(tabela){
    const f = { eq: {}, neq: {}, gte: [], lte: [], ou: null, ordem: null, lim: null };
    const linhas = () => {
      let ls = (window.__tabelas[tabela] || []).filter(l => Object.keys(f.eq).every(c => l[c] === f.eq[c]) && Object.keys(f.neq).every(c => l[c] !== f.neq[c]));
      ls = ls.filter(l => f.gte.every(([c, v]) => String(l[c]) >= String(v)) && f.lte.every(([c, v]) => String(l[c]) <= String(v)));
      if(f.ou) ls = ls.filter(l => f.ou.some(([c, v]) => String(l[c]) === v));
      if(f.ordem) ls = ls.slice().sort((a, b) => String(a[f.ordem[0]]).localeCompare(String(b[f.ordem[0]])) * (f.ordem[1] ? 1 : -1));
      if(f.lim) ls = ls.slice(0, f.lim);
      return ls;
    };
    const escrita = (op, extra) => {
      window.__escritas.push(Object.assign({ tabela, op }, extra));
      const erro = window.__falharEscrita ? window.__falharEscrita(tabela, op) : null;
      if(!erro && (op === 'upsert' || op === 'insert')){
        const t = window.__tabelas[tabela] = window.__tabelas[tabela] || [];
        [].concat(extra.rows).forEach(r => { const i = t.findIndex(x => r.id && x.id === r.id); if(i >= 0) t[i] = Object.assign({}, t[i], r); else t.push(Object.assign({}, r)); });
      }
      return Promise.resolve({ error: erro || null });
    };
    const b = {
      select: () => b, in: () => b, is: () => b, range: () => b,
      eq: (c, v) => { f.eq[c] = v; return b; }, neq: (c, v) => { f.neq[c] = v; return b; },
      gte: (c, v) => { f.gte.push([c, v]); return b; }, lte: (c, v) => { f.lte.push([c, v]); return b; },
      or: (s) => { f.ou = String(s).split(',').map(p => { const [c, , ...v] = p.split('.'); return [c, v.join('.')]; }); return b; },
      order: (c, o) => { f.ordem = [c, !o || o.ascending !== false]; return b; }, limit: (n) => { f.lim = n; return b; },
      upsert: (rows, opts) => escrita('upsert', { rows, opts }),
      insert: (rows) => escrita('insert', { rows }),
      update: (patch) => ({ eq: (c, v) => {
        const erro = window.__falharEscrita ? window.__falharEscrita(tabela, 'update') : null;
        window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } });
        if(!erro) (window.__tabelas[tabela] || []).forEach(l => { if(l[c] === v) Object.assign(l, patch); });
        return Promise.resolve({ error: erro || null });
      } }),
      maybeSingle: async () => ({ data: linhas()[0] || null, error: null }),
      then: (ok, ko) => Promise.resolve({ data: linhas(), error: null }).then(ok, ko),
    };
    return b;
  }
  window.supabase = { createClient: comRange(() => ({
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
    from: (t) => builder(t),
    functions: { invoke: (nome, opts) => {
      window.__invocacoes.push({ nome, body: opts && opts.body });
      const r = window.__invokeResposta;
      return typeof r === 'function' ? r(nome, opts) : Promise.resolve(r || { data: {}, error: null });
    } },
    rpc: (nome, args) => {
      window.__rpcCalls.push({ nome, args });
      const r = window.__rpcRespostas[nome];
      const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
      return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
    },
  })) };
  window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
  window.alert = (msg) => window.__alertas.push(String(msg));
  window.confirm = () => true;
  window.Chart = function(){ this.destroy = function(){}; return this; };
  window.TextDecoder = TextDecoder;
  window.process = process;
  window.open = (u) => { window.__abertos.push(u); return null; };
  window.Notification = function(titulo, opts){ window.__notificacoes.push({ titulo, opts }); this.close = () => {}; };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = async () => 'granted';
  if(!window.crypto || !window.crypto.randomUUID){
    Object.defineProperty(window, 'crypto', { value: { randomUUID: () => require('crypto').randomUUID(), getRandomValues: (a) => require('crypto').webcrypto.getRandomValues(a) }, configurable: true });
  }
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: (t) => { window.__copiados.push(t); return Promise.resolve(); } }, configurable: true });

  function rodar(corpo){
    const teste = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const sp = (s) => Date.parse(s + '-03:00');
  function fim(){ console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---'); process.exit(fail > 0 ? 1 : 0); }
  // mostrarAviso cai em alert() sem animação e em #apexToasts com animação: o teste olha os dois
  const avisos = () => window.__alertas.join(' | ') + ' | ' + ((document.getElementById('apexToasts') || {}).textContent || '');
  ${corpo}
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();`;
    window.eval(jsCode + teste);
  }
  return { window, rodar };
}

module.exports = { montarPainel };
```

- [ ] **Step 2: Teste (falha)** — `test_agenda.js`:

```js
// Testa a Agenda (06/10/2026) — REGRAS_NEGOCIO.md §72. Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md
// DADOS FICTÍCIOS — o repositório é público.
const { montarPainel } = require('./painel_teste_base.js');
const { rodar } = montarPainel();
rodar(`
  // ==== TASK 4: funções puras ====
  eq(agPartesSP('2026-10-07T01:30:00Z'), { dia: '2026-10-06', hora: '22:30' }, 'UTC da madrugada = noite anterior em SP');
  eq(agIsoSP('2026-10-06', '14:30'), '2026-10-06T14:30:00-03:00', 'ISO com -03:00');
  eq([agMesVizinho('2026-12', 1), agMesVizinho('2026-01', -1)], ['2027-01', '2025-12'], 'virada de ano');
  eq(agRotuloMes('2026-10'), 'OUTUBRO 2026', 'rótulo do mês');
  const out = agGradeMes('2026-10');
  eq([out.length, out[0].dia, out[0].doMes, out[34].dia], [35, '2026-09-27', false, '2026-10-31'], 'outubro/2026: 35 dias, começa no domingo 27/09');
  eq(agGradeMes('2026-02').length, 28, 'fevereiro/2026 cabe em 4 semanas');
  const fev24 = agGradeMes('2024-02');
  eq([fev24.length, fev24.filter(d => d.doMes).length, fev24[34].dia], [35, 29, '2024-03-02'], 'fevereiro bissexto');

  const AGORA = sp('2026-10-06T10:00:00');
  eq(agSituacao({ status: 'pendente', quando: '2026-10-06T09:00:00-03:00' }, AGORA), 'atrasado', 'passou da hora = atrasado');
  eq(agSituacao({ status: 'pendente', quando: '2026-10-06T11:00:00-03:00' }, AGORA), 'pendente', 'futuro = pendente');
  eq(agSituacao({ status: 'feito', quando: '2026-10-06T09:00:00-03:00' }, AGORA), 'feito', 'feito');
  const rets = [
    { id: 'r1', status: 'pendente', quando: '2026-10-06T16:00:00-03:00', nome: 'B Teste' },
    { id: 'r2', status: 'pendente', quando: '2026-10-06T09:00:00-03:00', nome: 'A Teste' },
    { id: 'r3', status: 'cancelado', quando: '2026-10-06T08:00:00-03:00', nome: 'C Teste' },
    { id: 'r4', status: 'pendente', quando: '2026-10-07T01:30:00Z', nome: 'Noite Teste' },
    { id: 'r5', status: 'pendente', quando: '2026-10-06T17:00:00-03:00', nome: 'D Teste' },
    { id: 'r6', status: 'feito', quando: '2026-10-06T18:00:00-03:00', nome: 'E Teste' },
  ];
  const pd = agPorDia(rets, [{ dia: '2026-10-06', numero: 'N1', cliente: 'Cliente Teste', tipoData: 'portabilidade' }]);
  eq(pd.get('2026-10-06').retornos.map(r => r.id), ['r2', 'r1', 'r5', 'r4', 'r6'], 'ordem por hora, cancelado fora, 22:30 SP no mesmo dia');
  eq(pd.get('2026-10-06').pedidos.length, 1, 'pedido no dia');
  const res = agResumoDia(pd.get('2026-10-06'), AGORA);
  eq([res.visiveis.length, res.mais, res.atrasados], [3, 3, 1], 'até 3 visíveis, +3, 1 atrasado (09:00)');

  const at = agAtalhos(sp('2026-10-06T10:02:00'));
  eq(at.map(a => a.rotulo), ['Em 2h', 'Amanhã 9h', 'Amanhã 14h', 'Seg 9h'], 'rótulos dos atalhos');
  eq([at[0].dia, at[0].hora], ['2026-10-06', '12:05'], 'em 2h arredonda para 5 min');
  eq([at[1].dia, at[3].dia], ['2026-10-07', '2026-10-12'], 'amanhã e próxima segunda (06/10 é terça)');
  eq(agAtalhos(sp('2026-10-12T10:00:00'))[3].dia, '2026-10-19', 'numa segunda, "Seg" é a da semana seguinte');
  eq(agRemarcarMesmoHorario('2026-10-06T14:30:00-03:00', '2026-10-09'), '2026-10-09T14:30:00-03:00', 'remarcar mantém a hora');

  eq(agValidarRetorno({ nome: ' ', telefone: '19990000001', dia: '2026-10-07', hora: '09:00' }, AGORA).erro, 'Informe o nome do cliente.', 'nome obrigatório');
  eq(agValidarRetorno({ nome: 'X Teste', telefone: '123', dia: '2026-10-07', hora: '09:00' }, AGORA).erro, 'Telefone inválido: use DDD + número.', 'telefone válido');
  eq(agValidarRetorno({ nome: 'X Teste', telefone: '19990000001', dia: '', hora: '09:00' }, AGORA).erro, 'Escolha dia e hora.', 'dia obrigatório');
  const passado = agValidarRetorno({ nome: 'X Teste', telefone: '19990000001', dia: '2026-10-06', hora: '08:00' }, AGORA);
  eq([passado.erro, passado.aviso], [null, 'Esse horário já passou.'], 'passado pode, com aviso');

  const calc = { agenda: { atrasados: [{ diaAlvo: '2026-10-01', numero: 'N9', cliente: 'Cli Teste', tipoData: 'instalação' }], hoje: [], amanha: [], proximos7: [], depois: [], semData: [{ diaAlvo: null }] } };
  eq(agPedidosItens(calc), [{ dia: '2026-10-01', numero: 'N9', cliente: 'Cli Teste', tipoData: 'instalação' }], 'pedidos: sem data fica fora');
  eq(agPedidosItens(null), [], 'sem cálculo de pedidos');

  // ==== mais testes entram aqui ====
  fim();
`);
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node test_agenda.js`
Expected: FAIL com `FALHA: ReferenceError: agPartesSP is not defined`.

- [ ] **Step 4: Implementação** — no `_template.html`, logo antes do `</script>` final, abrir o bloco:

```js
/* ============ CADERNO + AGENDA + OBJEÇÕES — 06/10/2026, REGRAS_NEGOCIO.md seção 72 ============
   Para o consultor da discadora (fora do lead). Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md.
   Prefixos: ag* (Agenda), cd* (Caderno), obj* (Objeções), al* (Alertas). Funções puras primeiro (testadas em
   test_agenda.js / test_caderno.js / test_objecoes.js), depois dados, telas e ações. Horário de SP = UTC−3 fixo. */
const AG_TZ_MS = 3 * 3600000;
const AG_TIPOS = { ligacao: 'Ligação', whatsapp: 'WhatsApp', reuniao: 'Reunião', proposta: 'Enviar proposta' };
const AG_MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
function agAgora(){ return Date.now(); }
function agPartesSP(v){
  const ms = typeof v === 'number' ? v : new Date(v).getTime();
  const s = new Date(ms - AG_TZ_MS).toISOString();
  return { dia: s.slice(0, 10), hora: s.slice(11, 16) };
}
function agIsoSP(dia, hora){ return dia + 'T' + hora + ':00-03:00'; }
function agMesVizinho(ym, delta){
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function agRotuloMes(ym){ return AG_MESES[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
function agDiaSemana(dia){ return new Date(dia + 'T00:00:00Z').getUTCDay(); }
// Grade de domingo a sábado cobrindo o mês inteiro (4 a 6 semanas).
function agGradeMes(ym){
  const primeiro = ym + '-01';
  const inicio = somaDiasStr(primeiro, -agDiaSemana(primeiro));
  const ultimo = somaDiasStr(agMesVizinho(ym, 1) + '-01', -1);
  const fim = somaDiasStr(ultimo, 6 - agDiaSemana(ultimo));
  const dias = [];
  for(let d = inicio; d <= fim; d = somaDiasStr(d, 1)) dias.push({ dia: d, doMes: d.slice(0, 7) === ym });
  return dias;
}
function agSituacao(r, agora){
  if(r.status === 'feito') return 'feito';
  if(r.status === 'cancelado') return 'cancelado';
  return new Date(r.quando).getTime() < agora ? 'atrasado' : 'pendente';
}
function agPorDia(retornos, pedidos){
  const m = new Map();
  const slot = d => { if(!m.has(d)) m.set(d, { retornos: [], pedidos: [] }); return m.get(d); };
  (retornos || []).filter(r => r.status !== 'cancelado').forEach(r => slot(agPartesSP(r.quando).dia).retornos.push(r));
  (pedidos || []).forEach(p => { if(p.dia) slot(p.dia).pedidos.push(p); });
  m.forEach(v => v.retornos.sort((a, b) => new Date(a.quando) - new Date(b.quando)));
  return m;
}
function agResumoDia(entrada, agora){
  const itens = entrada.retornos.map(r => ({ tipo: 'retorno', r })).concat(entrada.pedidos.map(p => ({ tipo: 'pedido', p })));
  return { visiveis: itens.slice(0, 3), mais: Math.max(0, itens.length - 3), atrasados: entrada.retornos.filter(r => agSituacao(r, agora) === 'atrasado').length };
}
function agAtalhos(agora){
  const p = agPartesSP(agora);
  const em2 = agPartesSP(Math.ceil((agora + 2 * 3600000) / 300000) * 300000);
  const amanha = somaDiasStr(p.dia, 1);
  const seg = somaDiasStr(p.dia, ((8 - agDiaSemana(p.dia)) % 7) || 7);
  return [{ rotulo: 'Em 2h', dia: em2.dia, hora: em2.hora }, { rotulo: 'Amanhã 9h', dia: amanha, hora: '09:00' },
    { rotulo: 'Amanhã 14h', dia: amanha, hora: '14:00' }, { rotulo: 'Seg 9h', dia: seg, hora: '09:00' }];
}
function agRemarcarMesmoHorario(quando, novoDia){ return agIsoSP(novoDia, agPartesSP(quando).hora); }
function agValidarRetorno(f, agora){
  if(!String(f.nome || '').trim()) return { erro: 'Informe o nome do cliente.', aviso: null };
  if(!chaveTel(f.telefone)) return { erro: 'Telefone inválido: use DDD + número.', aviso: null };
  if(!/^\d{4}-\d{2}-\d{2}$/.test(f.dia || '') || !/^\d{2}:\d{2}$/.test(f.hora || '')) return { erro: 'Escolha dia e hora.', aviso: null };
  return { erro: null, aviso: new Date(agIsoSP(f.dia, f.hora)).getTime() < agora ? 'Esse horário já passou.' : null };
}
function agPedidosItens(calc){
  if(!calc || !calc.agenda) return [];
  return ['atrasados', 'hoje', 'amanha', 'proximos7', 'depois'].flatMap(k => calc.agenda[k] || [])
    .filter(p => p.diaAlvo).map(p => ({ dia: p.diaAlvo, numero: p.numero, cliente: p.cliente || '', tipoData: p.tipoData }));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node test_agenda.js`
Expected: `--- RESULTADO: 25 passaram, 0 falharam ---` (o número exato pode variar ±2 conforme as asserções; 0 falhas é o que importa).

- [ ] **Step 6: Commit**

```bash
git add painel_teste_base.js test_agenda.js _template.html
git commit -m "feat(agenda): funcoes puras do calendario e base comum de teste (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Funções puras do Caderno (`cd*`)

**Files:**
- Modify: `_template.html` (continua o bloco §72)
- Test: `test_caderno.js`

**Interfaces — Produces:**
- `CD_CAMPOS` (lista dos campos de texto), `CD_RESULTADOS`, `CD_INTERESSES`
- `cdUuid() → string`, `cdNovaNota() → Nota`
  - `Nota = { id, telefone, nome, cpf, cnpj, cep, email, operadora_atual, decisor, qtd_linhas, valor_plano, fidelidade_vence, interesse[], objecoes[], texto, resultado, atualizado_em }`
  - os números (`qtd_linhas`, `valor_plano`) ficam como texto digitado; `fidelidade_vence` = `'YYYY-MM'` ou `''`
- `cdDigitos(s)`, `cdCpfValido(s) → bool`, `cdCnpjValido(s) → bool`
- `cdReconhecer(texto) → {telefone?, cpf?, cnpj?, cep?, email?}`
- `cdSugestoesPreencher(nota) → [{campo, valor}]` (só os campos vazios)
- `cdNum(v) → number|null`, `cdNotaVazia(nota) → bool`
- `cdPayload(nota) → linha do banco`: dígitos em cpf/cnpj/cep, números convertidos, `fidelidade_vence` como `'YYYY-MM-01'` ou null
- `cdRetornoDaNota(nota, quandoIso, origem) → linha de agenda_retornos` (sem `consultor_id`; o banco usa o default)
- `cdSugestaoFidelidade(ym, hoje) → {dia, rotulo} | null`
- `cdContextoIA(nota) → {qtd_linhas, valor_plano, operadora_atual, fidelidade_vence, interesse, texto}` (texto já mascarado por `cdMascarar`)
- `cdMascarar(texto)`, com a mesma regra do `mascarar` da Edge Function
- `cdTemContexto(nota) → bool`

- [ ] **Step 1: Teste (falha)** — `test_caderno.js`:

```js
// Testa o Caderno de Ligação (06/10/2026) — REGRAS_NEGOCIO.md §72. DADOS FICTÍCIOS (CPF/CNPJ de exemplo, válidos só no dígito).
const { montarPainel } = require('./painel_teste_base.js');
const { window, rodar } = montarPainel();
window.__JSDOM = require('jsdom').JSDOM;
rodar(`
  // ==== TASK 5: funções puras ====
  assert(cdCpfValido('123.456.789-09') && !cdCpfValido('123.456.789-00') && !cdCpfValido('111.111.111-11'), 'CPF: dígito e repetidos');
  assert(cdCnpjValido('11.222.333/0001-81') && !cdCnpjValido('11.222.333/0001-80') && !cdCnpjValido('00000000000000'), 'CNPJ: dígito e repetidos');
  eq(cdReconhecer('cnpj 11.222.333/0001-81 cpf 123.456.789-09 tel (19) 99000-0001 cep 13010-000 x@teste.com'),
     { email: 'x@teste.com', cnpj: '11222333000181', cpf: '12345678909', telefone: '19990000001', cep: '13010000' }, 'reconhece os 5');
  eq(cdReconhecer('ligar 11987654321'), { telefone: '11987654321' }, '11 dígitos com 9 na 3ª posição = celular, não CPF');
  eq(cdReconhecer('doc 12345678909'), { cpf: '12345678909' }, '11 dígitos com CPF válido e 3º dígito ≠ 9 = CPF');
  eq(cdReconhecer('fixo 1932541000'), { telefone: '1932541000' }, 'fixo com DDD');
  eq(cdReconhecer('12 linhas, paga 900'), {}, 'texto comercial não vira dado');
  const n0 = cdNovaNota();
  assert(/^[0-9a-f-]{36}$/.test(n0.id) && n0.texto === '' && Array.isArray(n0.objecoes), 'nota nova com uuid');
  assert(cdNotaVazia(n0), 'nota nova é vazia');
  const n1 = Object.assign(cdNovaNota(), { telefone: '19990000001', texto: 'cpf 123.456.789-09, cnpj 11.222.333/0001-81' });
  eq(cdSugestoesPreencher(n1), [{ campo: 'cpf', valor: '12345678909' }, { campo: 'cnpj', valor: '11222333000181' }], 'só sugere campo vazio (telefone já preenchido)');
  eq([cdNum('1.234,56'), cdNum('12'), cdNum(''), cdNum('abc')], [1234.56, 12, null, null], 'números em formato BR');
  const n2 = Object.assign(cdNovaNota(), { telefone: '(19) 99000-0001', nome: ' Empresa Teste ', cnpj: '11.222.333/0001-81', cep: '13010-000', qtd_linhas: '12', valor_plano: '899,90', fidelidade_vence: '2027-03', texto: 'linha 1\\nlinha 2' });
  const p2 = cdPayload(n2);
  eq([p2.cnpj, p2.cep, p2.qtd_linhas, p2.valor_plano, p2.fidelidade_vence, p2.nome], ['11222333000181', '13010000', 12, 899.9, '2027-03-01', 'Empresa Teste'], 'payload normalizado');
  assert(!('atualizado_em' in p2) && p2.id === n2.id, 'payload sem atualizado_em (o banco preenche)');
  const r2 = cdRetornoDaNota(n2, '2026-10-07T09:00:00-03:00', 'manual');
  eq([r2.nome, r2.telefone, r2.qtd_linhas, r2.valor_plano, r2.observacao, r2.nota_id, r2.origem, r2.tipo], ['Empresa Teste', '(19) 99000-0001', 12, 899.9, 'linha 1', n2.id, 'manual', 'ligacao'], 'retorno nasce da nota');
  assert(/^[0-9a-f-]{36}$/.test(r2.id), 'retorno com uuid');
  eq(cdRetornoDaNota(Object.assign(cdNovaNota(), { telefone: '19990000001', cnpj: '11222333000181' }), '2026-10-07T09:00:00-03:00', 'manual').nome, 'CNPJ 11.222.333/0001-81', 'sem nome usa o CNPJ');
  eq(cdSugestaoFidelidade('2027-03', '2026-10-06'), { dia: '2027-01-15', rotulo: 'Agendar retorno 45 dias antes do vencimento (15/01)' }, 'fidelidade: 45 dias antes do dia 1º');
  eq(cdSugestaoFidelidade('2026-11', '2026-10-06').dia, '2026-10-07', 'já dentro da janela: amanhã');
  eq(cdSugestaoFidelidade('', '2026-10-06'), null, 'sem vencimento');
  const ctx = cdContextoIA(Object.assign(cdNovaNota(), { nome: 'Fulano Teste', cpf: '12345678909', telefone: '19990000001', qtd_linhas: '12', operadora_atual: 'Vivo', texto: 'falar com 19 99000-0001 ou x@teste.com' }));
  eq(Object.keys(ctx).sort(), ['fidelidade_vence', 'interesse', 'operadora_atual', 'qtd_linhas', 'texto', 'valor_plano'], 'contexto só com campos permitidos');
  assert(!/99000|teste\\.com/.test(ctx.texto) && ctx.texto.includes('[TELEFONE]'), 'texto mascarado no navegador');
  assert(!cdTemContexto(cdNovaNota()) && cdTemContexto(Object.assign(cdNovaNota(), { operadora_atual: 'Vivo' })), 'tem contexto');

  // ==== mais testes entram aqui ====
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_caderno.js`
Expected: FAIL com `ReferenceError: cdCpfValido is not defined`.

- [ ] **Step 3: Implementação** — no `_template.html`, depois das funções `ag*`:

```js
const CD_CAMPOS = ['telefone', 'nome', 'cpf', 'cnpj', 'cep', 'qtd_linhas', 'valor_plano', 'email', 'operadora_atual', 'decisor', 'fidelidade_vence'];
const CD_RESULTADOS = { atendeu: 'Atendeu', nao_atendeu: 'Não atendeu', caixa_postal: 'Caixa postal', sem_interesse: 'Sem interesse', fechou: 'Fechou' };
const CD_INTERESSES = { movel: 'Móvel', fibra: 'Fibra', portabilidade: 'Portabilidade' };
function cdUuid(){
  if(window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
function cdNovaNota(){
  const n = { id: cdUuid(), interesse: [], objecoes: [], texto: '', resultado: null, atualizado_em: null };
  CD_CAMPOS.forEach(c => { n[c] = ''; });
  return n;
}
function cdDigitos(s){ return String(s == null ? '' : s).replace(/\D/g, ''); }
function cdCpfValido(s){
  const d = cdDigitos(s);
  if(d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => { let soma = 0; for(let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i); const r = (soma * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function cdCnpjValido(s){
  const d = cdDigitos(s);
  if(d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n) => { const pesos = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let soma = 0; for(let i = 0; i < n; i++) soma += Number(d[i]) * pesos[i]; const r = soma % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}
// Reconhece dados colados na anotação (sem IA). Ordem: e-mail, CNPJ, CPF formatado, telefones/11 dígitos, CEP.
function cdReconhecer(texto){
  let t = String(texto || '');
  const r = {};
  const tira = (re, fn) => { t = t.replace(re, m => { const v = fn(m); return v ? ' ' : m; }); };
  tira(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, m => (r.email ? null : (r.email = m)));
  tira(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, m => (!r.cnpj && cdCnpjValido(m) ? (r.cnpj = cdDigitos(m)) : null));
  tira(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, m => (!r.cpf && cdCpfValido(m) ? (r.cpf = cdDigitos(m)) : null));
  tira(/\(?\b\d{2}\)?\s?\d{4,5}[-\s]?\d{4}\b/g, m => {
    const d = cdDigitos(m);
    if(d.length === 11 && d[2] !== '9'){ return !r.cpf && cdCpfValido(d) ? (r.cpf = d) : null; }
    if((d.length === 10 || d.length === 11) && !r.telefone && chaveTel(d)) return (r.telefone = d);
    return null;
  });
  tira(/\b\d{5}-\d{3}\b/g, m => (r.cep ? null : (r.cep = cdDigitos(m))));
  return r;
}
function cdSugestoesPreencher(nota){
  const achado = cdReconhecer(nota.texto);
  return ['telefone', 'cpf', 'cnpj', 'cep', 'email'].filter(c => achado[c] && !String(nota[c] || '').trim()).map(c => ({ campo: c, valor: achado[c] }));
}
function cdNum(v){
  const s = String(v == null ? '' : v).trim();
  if(!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}
function cdNotaVazia(n){
  return !String(n.texto || '').trim() && !n.resultado && !(n.objecoes || []).length && !(n.interesse || []).length
    && CD_CAMPOS.every(c => !String(n[c] || '').trim());
}
function cdPayload(n){
  const txt = v => { const s = String(v == null ? '' : v).trim(); return s || null; };
  const dig = v => cdDigitos(v) || null;
  const q = cdNum(n.qtd_linhas);
  return {
    id: n.id, telefone: txt(n.telefone), nome: txt(n.nome), cpf: dig(n.cpf), cnpj: dig(n.cnpj), cep: dig(n.cep), email: txt(n.email),
    operadora_atual: txt(n.operadora_atual), decisor: txt(n.decisor),
    qtd_linhas: q === null ? null : Math.round(q), valor_plano: cdNum(n.valor_plano),
    fidelidade_vence: /^\d{4}-\d{2}$/.test(n.fidelidade_vence || '') ? n.fidelidade_vence + '-01' : null,
    interesse: (n.interesse || []).slice(), objecoes: (n.objecoes || []).slice(), texto: String(n.texto || ''), resultado: n.resultado || null,
  };
}
function cdFmtCnpj(d){ return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d; }
function cdRetornoDaNota(n, quando, origem){
  const p = cdPayload(n);
  const primeira = String(n.texto || '').split('\n').map(s => s.trim()).find(Boolean) || '';
  return {
    id: cdUuid(), nota_id: n.id, nome: p.nome || (p.cnpj ? 'CNPJ ' + cdFmtCnpj(p.cnpj) : 'Cliente'), telefone: p.telefone || '',
    quando, tipo: 'ligacao', qtd_linhas: p.qtd_linhas, valor_plano: p.valor_plano, observacao: primeira.slice(0, 140) || null, origem,
  };
}
function cdSugestaoFidelidade(ym, hoje){
  if(!/^\d{4}-\d{2}$/.test(ym || '')) return null;
  let dia = somaDiasStr(ym + '-01', -45);
  const amanha = somaDiasStr(hoje, 1);
  if(dia < amanha) dia = amanha;
  return { dia, rotulo: 'Agendar retorno 45 dias antes do vencimento (' + ppFmtDia(dia).slice(0, 5) + ')' };
}
// Mesma regra do mascarar() da Edge Function caderno-ia (supabase/functions/caderno-ia/ia.ts).
function cdMascarar(texto){
  return String(texto == null ? '' : texto)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[CPF]')
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, m => { const d = cdDigitos(m); return d.length === 11 && d[2] !== '9' ? '[CPF]' : '[TELEFONE]'; })
    .replace(/\b\d{11}\b/g, '[CPF]')
    .replace(/\b\d{5}-\d{3}\b/g, '[CEP]');
}
function cdContextoIA(n){
  return { qtd_linhas: cdNum(n.qtd_linhas), valor_plano: cdNum(n.valor_plano), operadora_atual: String(n.operadora_atual || '').trim(),
    fidelidade_vence: n.fidelidade_vence || '', interesse: (n.interesse || []).slice(), texto: cdMascarar(n.texto).slice(0, 2000) };
}
function cdTemContexto(n){
  const c = cdContextoIA(n);
  return c.qtd_linhas !== null || c.valor_plano !== null || !!c.operadora_atual || !!c.fidelidade_vence || c.interesse.length > 0 || !!c.texto.trim();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_caderno.js`
Expected: `0 falharam`. Conta da fidelidade de `'2027-03'`: 01/03/2027 − 45 dias = 15/01/2027 (fevereiro/2027 tem 28 dias: 28 dias até 01/02 + 17 dias até 15/01).

- [ ] **Step 5: Commit**

```bash
git add test_caderno.js _template.html
git commit -m "feat(caderno): funcoes puras de reconhecimento, payload e retorno (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Aba Agenda — calendário, painel do dia, criar, feito, remarcar, cancelar, arrastar, camada de pedidos

**Files:**
- Modify: `_template.html`:
  - botão no `nav#tabsNav`, logo depois do botão `pedidosparados`;
  - `<section id="panel-agenda">` antes do `</main>`;
  - overlay `#agDiaOverlay` depois do `#profileOverlay`;
  - CSS `#cadernoStyles`;
  - `if(btn.dataset.tab === 'agenda') loadAgenda();` no listener das abas;
  - funções `ag*` de tela.
- Test: `test_agenda.js` (substituir `// ==== mais testes entram aqui ====`)

**Interfaces:**
- **Consumes:** as funções da Task 4, além de `ppEstado`, `ppCarregarDados`, `canSeePedidosParados`, `currentUser`, `sb`, `escapeHtml`, `mostrarAviso` e `fecharOverlay`.
- **Produces:**
  - `agEstado = { ym, retornos, pedidos, carregando, erro, diaAberto, geracao }`
  - `loadAgenda()`, `agCarregarMes()`, `agRenderMes()`, `agAbrirDia(dia)`
  - `agSalvarNovo(f) → Promise<boolean>`, com `f = {nome, telefone, dia, hora, tipo, qtd_linhas, valor_plano, observacao, nota_id?, origem?}`
  - `agMarcarFeito(id)`, `agRemarcar(id, dia, hora)`, `agCancelar(id)`
  - `agCriarRetorno(linha) → Promise<boolean>`: grava ou põe na fila local; usado pelo Caderno
  - `agFilaEnviar()`, `agResetar()`
  - **Eventos:** `document.dispatchEvent(new CustomEvent('agenda:mudou'))` depois de toda escrita. Alertas e Caderno escutam esse evento.

- [ ] **Step 1: Teste (falha)** — em `test_agenda.js`, trocar `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 6: aba, calendário, painel do dia ====
  const nowReal = Date.now;
  Date.now = () => AGORA;
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  window.__tabelas.agenda_retornos = rets.map(r => Object.assign({ consultor_id: 'c1', telefone: '19990000001', tipo: 'ligacao' }, r));
  ppEstado.calc = calc;
  const btnAg = document.querySelector('#tabsNav button[data-tab="agenda"]');
  assert(btnAg && btnAg.querySelector('.sbLabel').textContent === 'Agenda', 'botão Agenda no menu');
  btnAg.click();
  await espera(60);
  assert(document.getElementById('panel-agenda').classList.contains('active'), 'abre a aba');
  eq(document.getElementById('agTituloMes').textContent, 'OUTUBRO 2026', 'mês atual');
  const celulas = document.querySelectorAll('#agGrade .agDia');
  eq(celulas.length, 35, 'grade com 35 dias');
  const hoje = document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]');
  assert(hoje.classList.contains('hoje') && hoje.classList.contains('temAtraso'), 'hoje destacado e com atraso');
  eq([...hoje.querySelectorAll('.agItem')].map(i => i.textContent.trim().slice(0, 5)), ['09:00', '16:00', '17:00'], '3 itens visíveis em ordem de hora');
  assert(hoje.querySelector('.agMais').textContent.includes('+2'), '+2 (5 retornos no dia; o pedido do teste é do dia 01)');
  const dia1 = document.querySelector('#agGrade .agDia[data-dia="2026-10-01"]');
  assert(dia1.querySelector('.agItem.pedido') && dia1.textContent.includes('Pedido'), 'camada de pedidos no dia 01');
  assert(document.querySelector('#agGrade .agDia[data-dia="2026-09-27"]').classList.contains('fora'), 'dia de fora do mês apagado');
  assert(!/NaN|undefined/.test(document.getElementById('panel-agenda').textContent), 'sem NaN/undefined');
  // lista do celular: atrasados no topo
  assert(document.querySelector('#agLista .agListaDia') && document.getElementById('agLista').textContent.indexOf('A Teste') < document.getElementById('agLista').textContent.indexOf('B Teste'), 'lista do celular em ordem');

  // navegar
  document.getElementById('agMesProx').click(); await espera(30);
  eq(document.getElementById('agTituloMes').textContent, 'NOVEMBRO 2026', 'próximo mês');
  document.getElementById('agHoje').click(); await espera(30);
  eq(document.getElementById('agTituloMes').textContent, 'OUTUBRO 2026', 'volta para hoje');

  // painel do dia (a grade foi redesenhada ao navegar: buscar a célula de novo)
  document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]').click(); await espera(30);
  const ov = document.getElementById('agDiaOverlay');
  assert(ov.classList.contains('active'), 'clicar no dia abre o painel');
  eq(document.getElementById('agDiaTitulo').textContent, 'Terça, 06/10', 'título do dia');
  eq(document.querySelectorAll('#agDiaLista .agLinha').length, 5, '5 retornos no painel (cancelado fora)');
  assert(document.querySelector('#agDiaLista .agLinha[data-id="r6"]').classList.contains('feito'), 'feito riscado');
  eq(document.getElementById('agFDia').value, '2026-10-06', 'formulário com o dia clicado');

  // criar
  document.getElementById('agFNome').value = 'Nova Empresa Teste';
  document.getElementById('agFTel').value = '(19) 99000-0002';
  document.querySelector('#agFHoras [data-hora="14:00"]').click();
  document.getElementById('agFTipo').value = 'whatsapp';
  document.getElementById('agFLinhas').value = '5';
  document.getElementById('agFValor').value = '450,00';
  document.getElementById('agFObs').value = 'mandar proposta';
  let mudou = 0; document.addEventListener('agenda:mudou', () => mudou++);
  document.getElementById('agForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await espera(40);
  const ins = window.__escritas.find(e => e.tabela === 'agenda_retornos' && e.op === 'insert');
  assert(ins, 'insert em agenda_retornos');
  eq([ins.rows.nome, ins.rows.quando, ins.rows.tipo, ins.rows.qtd_linhas, ins.rows.valor_plano, ins.rows.origem], ['Nova Empresa Teste', '2026-10-06T14:00:00-03:00', 'whatsapp', 5, 450, 'manual'], 'linha gravada');
  assert(!('consultor_id' in ins.rows), 'consultor_id fica com o default do banco');
  assert(mudou >= 1, 'evento agenda:mudou');
  assert(document.querySelector('#agGrade .agDia[data-dia="2026-10-06"]').textContent.includes('+3'), 'calendário atualizado sem recarregar (6 retornos)');
  // validação
  document.getElementById('agFNome').value = '';
  document.getElementById('agForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await espera(20);
  eq(document.getElementById('agFErro').textContent, 'Informe o nome do cliente.', 'erro de validação na tela');

  // feito / cancelar / remarcar
  document.querySelector('#agDiaLista .agLinha[data-id="r1"] [data-ag="feito"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'agenda_retornos' && e.op === 'update' && e.patch.status === 'feito' && e.filtro.id === 'r1'), 'marcar feito');
  document.querySelector('#agDiaLista .agLinha[data-id="r5"] [data-ag="cancelar"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.status === 'cancelado' && e.filtro.id === 'r5'), 'cancelar');
  document.querySelector('#agDiaLista .agLinha[data-id="r2"] [data-ag="remarcar"]').click(); await espera(20);
  const linhaR2 = document.querySelector('#agDiaLista .agLinha[data-id="r2"]');
  linhaR2.querySelector('input[type=date]').value = '2026-10-08';
  linhaR2.querySelector('input[type=time]').value = '10:30';
  linhaR2.querySelector('[data-ag="salvarRemarcar"]').click(); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.quando === '2026-10-08T10:30:00-03:00' && e.filtro.id === 'r2'), 'remarcar para outro dia e hora');
  fecharOverlay(ov);

  // arrastar para outro dia mantém a hora
  agSoltarEm('r4', '2026-10-09'); await espera(30);
  assert(window.__escritas.some(e => e.op === 'update' && e.patch.quando === '2026-10-09T22:30:00-03:00' && e.filtro.id === 'r4'), 'arrastar mantém a hora');

  // falha ao carregar não quebra
  const sbFromOriginal = sb.from;
  sb.from = (t) => t === 'agenda_retornos' ? { select: () => ({ gte: () => ({ lte: () => ({ neq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) }) }) } : sbFromOriginal(t);
  await agCarregarMes(); agRenderMes();
  assert(document.getElementById('agStatus').textContent.includes('Não foi possível carregar'), 'aviso de falha');
  sb.from = sbFromOriginal;
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_agenda.js`
Expected: FAIL em `botão Agenda no menu`.

- [ ] **Step 3: HTML** — no `nav#tabsNav`, logo depois do botão `data-tab="pedidosparados"`:

```html
      <button data-tab="agenda" id="tabBtnAgenda" data-sub="Seus retornos do mês"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg><span class="sbLabel">Agenda</span></button>
```

Antes do `</main>`:

```html
    <!-- AGENDA (06/10/2026, seção 72): calendário do mês com os retornos do consultor + datas dos pedidos -->
    <section class="panel" id="panel-agenda">
      <div class="card">
        <div class="agTopo">
          <div class="agNav">
            <button type="button" class="btn btn-sm btn-outline" id="agMesAnt" aria-label="Mês anterior" style="width:auto">‹</button>
            <h3 id="agTituloMes"></h3>
            <button type="button" class="btn btn-sm btn-outline" id="agMesProx" aria-label="Próximo mês" style="width:auto">›</button>
          </div>
          <div class="agAcoes">
            <button type="button" class="btn btn-sm btn-outline" id="agHoje" style="width:auto">Hoje</button>
            <button type="button" class="btn btn-sm" id="agNovo" style="width:auto">+ Novo retorno</button>
            <button type="button" class="btn btn-sm btn-ghost" id="agEditarObj" style="width:auto;display:none">Objeções</button>
          </div>
        </div>
        <p class="desc" id="agStatus"></p>
        <div class="agAlertasAviso" id="agAlertasAviso" style="display:none">
          <span>Ative os alertas para ser avisado 5 minutos antes de cada retorno (só tocam com o painel aberto em alguma aba).</span>
          <button type="button" class="btn btn-sm" id="agAtivarAlertas" style="width:auto">Ativar alertas</button>
        </div>
        <div class="agSemana"><span>DOM</span><span>SEG</span><span>TER</span><span>QUA</span><span>QUI</span><span>SEX</span><span>SÁB</span></div>
        <div class="agGrade" id="agGrade"></div>
        <div class="agLista" id="agLista"></div>
      </div>
    </section>
```

Depois do `#profileOverlay`:

```html
<!-- Painel do dia da Agenda (seção 72) -->
<div class="overlay" id="agDiaOverlay">
  <div class="modal agDiaModal">
    <div class="mHead">
      <button class="mClose" id="agDiaFechar" type="button">&times;</button>
      <h2 id="agDiaTitulo"></h2>
      <div class="mCnpj">Retornos do dia</div>
    </div>
    <div class="mBody">
      <div id="agDiaLista"></div>
      <form id="agForm" class="agForm" autocomplete="off">
        <h4>Novo retorno</h4>
        <div class="field"><label>Cliente / nome</label><input type="text" id="agFNome" maxlength="120"></div>
        <div class="field"><label>Telefone</label><input type="tel" id="agFTel" maxlength="20"></div>
        <div class="agFLinha">
          <div class="field"><label>Dia</label><input type="date" id="agFDia"></div>
          <div class="field"><label>Hora</label><input type="time" id="agFHora" step="300"></div>
        </div>
        <div class="agFHoras" id="agFHoras"><button type="button" class="filterPill" data-hora="09:00">09:00</button><button type="button" class="filterPill" data-hora="11:00">11:00</button><button type="button" class="filterPill" data-hora="14:00">14:00</button><button type="button" class="filterPill" data-hora="16:00">16:00</button></div>
        <div class="agFLinha">
          <div class="field"><label>Tipo</label><select id="agFTipo"><option value="ligacao">Ligação</option><option value="whatsapp">WhatsApp</option><option value="reuniao">Reunião</option><option value="proposta">Enviar proposta</option></select></div>
          <div class="field"><label>Linhas</label><input type="text" id="agFLinhas" inputmode="numeric" maxlength="6"></div>
          <div class="field"><label>Valor do plano (R$)</label><input type="text" id="agFValor" inputmode="decimal" maxlength="12"></div>
        </div>
        <div class="field"><label>Observação</label><input type="text" id="agFObs" maxlength="200"></div>
        <div class="agFErro" id="agFErro"></div>
        <button type="submit" class="btn">Salvar retorno</button>
      </form>
    </div>
  </div>
</div>
```

- [ ] **Step 4: CSS** — novo bloco logo depois do `</style>` do `#ppStyles`:

```html
<style id="cadernoStyles">
  /* Caderno + Agenda + Objeções (06/10/2026, seção 72) — só tokens do design */
  .agTopo{display:flex;justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap;}
  .agNav{display:flex;align-items:center;gap:var(--space-3);}
  .agNav h3{margin:0;min-width:180px;text-align:center;letter-spacing:.08em;}
  .agAcoes{display:flex;gap:var(--space-2);flex-wrap:wrap;}
  .agAlertasAviso{display:flex;gap:var(--space-3);align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--st-andamento-bg);color:var(--st-andamento);padding:var(--space-3);margin:var(--space-3) 0;font-size:var(--fs-sm);}
  .agSemana,.agGrade{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
  .agSemana{margin-top:var(--space-4);font-size:var(--fs-xs);font-weight:700;letter-spacing:.08em;color:var(--muted);text-align:center;}
  .agDia{min-height:96px;border:1px solid var(--c-linha);background:var(--c-branco);padding:6px;cursor:pointer;display:flex;flex-direction:column;gap:3px;overflow:hidden;}
  .agDia:hover{border-color:var(--c-sinal);}
  .agDia.fora{opacity:.45;}
  .agDia.hoje{outline:2px solid var(--c-sinal);outline-offset:-2px;}
  .agDia.temAtraso{border-color:var(--st-perdido);}
  .agDia.soltar{background:var(--c-rosa);}
  .agNum{font-size:var(--fs-xs);font-weight:700;display:flex;justify-content:space-between;}
  .agNum .agAtr{color:var(--st-perdido);}
  .agItem{font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 4px;background:var(--c-papel);}
  .agItem.atrasado{background:var(--st-perdido-bg);color:var(--st-perdido);}
  .agItem.feito{text-decoration:line-through;opacity:.6;}
  .agItem.pedido{background:var(--st-andamento-bg);color:var(--st-andamento);}
  .agMais{font-size:var(--fs-xs);color:var(--muted);}
  .agLista{display:none;}
  .agListaDia h4{margin:var(--space-4) 0 var(--space-2);font-size:var(--fs-sm);}
  .agLinha{display:flex;gap:var(--space-3);align-items:center;justify-content:space-between;flex-wrap:wrap;padding:var(--space-2) 0;border-bottom:1px solid var(--c-linha);}
  .agLinha.feito .agLinhaTxt{text-decoration:line-through;opacity:.6;}
  .agLinha.atrasado .agLinhaHora{color:var(--st-perdido);font-weight:700;}
  .agLinhaHora{font-variant-numeric:tabular-nums;font-weight:600;margin-right:var(--space-2);}
  .agLinhaSub{display:block;font-size:var(--fs-xs);color:var(--muted);}
  .agLinhaAcoes{display:flex;gap:4px;flex-wrap:wrap;}
  .agRemarcar{display:flex;gap:var(--space-2);width:100%;flex-wrap:wrap;}
  .agForm{margin-top:var(--space-5);padding-top:var(--space-4);border-top:1px dashed var(--c-linha);}
  .agForm h4{margin:0 0 var(--space-3);}
  .agFLinha{display:flex;gap:var(--space-3);flex-wrap:wrap;}
  .agFLinha .field{flex:1;min-width:120px;}
  .agFHoras{display:flex;gap:var(--space-2);margin:0 0 var(--space-3);flex-wrap:wrap;}
  .agFErro{color:var(--st-perdido);font-size:var(--fs-sm);min-height:1em;margin-bottom:var(--space-2);}
  .agDiaModal{max-width:620px;}
  @media (max-width:720px){ .agSemana,.agGrade{display:none;} .agLista{display:block;} }
</style>
```

- [ ] **Step 5: JS** — no bloco §72, depois das funções `cd*` puras:

```js
const agEstado = { ym: '', retornos: [], pedidos: [], carregando: false, erro: false, diaAberto: null, geracao: 0, arrastando: null };
function agUid(){ return currentUser ? currentUser.id : 'anon'; }
function agAvisarMudou(){ document.dispatchEvent(new CustomEvent('agenda:mudou')); }
function agResetar(){
  agEstado.geracao++;
  Object.assign(agEstado, { ym: '', retornos: [], pedidos: [], carregando: false, erro: false, diaAberto: null });
  ['agGrade', 'agLista', 'agDiaLista'].forEach(id => { document.getElementById(id).innerHTML = ''; });
}
async function loadAgenda(){
  if(!currentUser) return;
  if(!agEstado.ym) agEstado.ym = agPartesSP(agAgora()).dia.slice(0, 7);
  alAtualizarAvisoPermissao();
  objAplicarPermissaoEditor();
  await agCarregarMes();
  agRenderMes();
}
async function agCarregarMes(){
  const geracao = agEstado.geracao;
  const grade = agGradeMes(agEstado.ym);
  const de = agIsoSP(grade[0].dia, '00:00'), ate = agIsoSP(grade[grade.length - 1].dia, '23:59');
  agEstado.carregando = true;
  document.getElementById('agStatus').textContent = 'Carregando…';
  const r = await ppSeguro(() => sb.from('agenda_retornos')
    .select('id,nota_id,nome,telefone,chave_tel,quando,tipo,qtd_linhas,valor_plano,observacao,origem,status,feito_em')
    .gte('quando', de).lte('quando', ate).neq('status', 'cancelado').order('quando', { ascending: true }));
  if(geracao !== agEstado.geracao) return;
  agEstado.carregando = false;
  agEstado.erro = !r || !!r.error;
  agEstado.retornos = agEstado.erro ? [] : (r.data || []);
  if(canSeePedidosParados()){
    if(!ppEstado.calc) await ppSeguro(() => ppCarregarDados(false));
    agEstado.pedidos = agPedidosItens(ppEstado.calc);
  } else agEstado.pedidos = [];
}
function agFmtDiaLongo(dia){
  const nomes = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  return nomes[agDiaSemana(dia)] + ', ' + ppFmtDia(dia).slice(0, 5);
}
function agItemHtml(it, agora){
  if(it.tipo === 'pedido') return `<div class="agItem pedido" title="${escapeHtml(it.p.tipoData)}">Pedido ${escapeHtml(it.p.cliente || it.p.numero)}</div>`;
  const r = it.r, s = agSituacao(r, agora);
  return `<div class="agItem ${s}" draggable="${s === 'feito' ? 'false' : 'true'}" data-id="${escapeHtml(r.id)}">${agPartesSP(r.quando).hora} ${escapeHtml(r.nome)}</div>`;
}
function agRenderMes(){
  if(!agEstado.ym) return; // Agenda ainda não aberta (ex.: retorno criado pelo Caderno): nada a desenhar
  const agora = agAgora(), hoje = agPartesSP(agora).dia;
  document.getElementById('agTituloMes').textContent = agRotuloMes(agEstado.ym);
  document.getElementById('agStatus').textContent = agEstado.erro ? 'Não foi possível carregar seus retornos agora. Tente de novo em instantes.' : '';
  const porDia = agPorDia(agEstado.retornos, agEstado.pedidos);
  document.getElementById('agGrade').innerHTML = agGradeMes(agEstado.ym).map(d => {
    const e = porDia.get(d.dia);
    const res = e ? agResumoDia(e, agora) : { visiveis: [], mais: 0, atrasados: 0 };
    const cls = ['agDia', d.doMes ? '' : 'fora', d.dia === hoje ? 'hoje' : '', res.atrasados ? 'temAtraso' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-dia="${d.dia}"><div class="agNum"><span>${Number(d.dia.slice(8))}</span>${res.atrasados ? `<span class="agAtr">${res.atrasados} atrasado${res.atrasados > 1 ? 's' : ''}</span>` : ''}</div>`
      + res.visiveis.map(it => agItemHtml(it, agora)).join('') + (res.mais ? `<div class="agMais">+${res.mais}</div>` : '') + '</div>';
  }).join('');
  // lista do celular: atrasados primeiro, depois de hoje em diante
  const pend = agEstado.retornos.filter(r => r.status === 'pendente');
  const atrasados = pend.filter(r => agSituacao(r, agora) === 'atrasado');
  const dias = [...porDia.keys()].filter(d => d >= hoje && d.slice(0, 7) === agEstado.ym).sort();
  const linha = r => `<div class="agLinha ${agSituacao(r, agora)}" data-id="${escapeHtml(r.id)}"><span class="agLinhaTxt"><span class="agLinhaHora">${agPartesSP(r.quando).hora}</span>${escapeHtml(r.nome)}</span></div>`;
  document.getElementById('agLista').innerHTML = (atrasados.length ? `<div class="agListaDia"><h4>Atrasados (${atrasados.length})</h4>${atrasados.map(linha).join('')}</div>` : '')
    + dias.map(d => { const rs = porDia.get(d).retornos.filter(r => agSituacao(r, agora) !== 'atrasado'); return rs.length ? `<div class="agListaDia" data-dia="${d}"><h4>${agFmtDiaLongo(d)}</h4>${rs.map(linha).join('')}</div>` : ''; }).join('')
    || '<p class="ppVazio">Nenhum retorno neste mês. Toque em "+ Novo retorno" para agendar.</p>';
  if(agEstado.diaAberto) agRenderDia();
}
function agAbrirDia(dia){
  agEstado.diaAberto = dia;
  agRenderDia();
  const f = id => document.getElementById(id);
  ['agFNome', 'agFTel', 'agFLinhas', 'agFValor', 'agFObs', 'agFHora'].forEach(id => { f(id).value = ''; });
  f('agFDia').value = dia; f('agFTipo').value = 'ligacao'; f('agFErro').textContent = '';
  document.getElementById('agDiaOverlay').classList.add('active');
}
function agRenderDia(){
  const dia = agEstado.diaAberto, agora = agAgora();
  document.getElementById('agDiaTitulo').textContent = agFmtDiaLongo(dia);
  const e = agPorDia(agEstado.retornos, agEstado.pedidos).get(dia) || { retornos: [], pedidos: [] };
  const btn = (acao, rotulo, id) => `<button type="button" class="btn btn-sm btn-ghost" data-ag="${acao}" data-id="${escapeHtml(id)}" style="width:auto">${rotulo}</button>`;
  document.getElementById('agDiaLista').innerHTML = e.retornos.map(r => {
    const s = agSituacao(r, agora), p = agPartesSP(r.quando);
    const sub = [AG_TIPOS[r.tipo] || '', r.telefone, r.qtd_linhas != null ? r.qtd_linhas + ' linha(s)' : '', r.valor_plano != null ? fmtBRL(Number(r.valor_plano)) : '', r.observacao || ''].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="agLinha ${s}" data-id="${escapeHtml(r.id)}"><div class="agLinhaTxt"><span class="agLinhaHora">${p.hora}</span>${escapeHtml(r.nome)}<span class="agLinhaSub">${sub}</span></div>`
      + `<div class="agLinhaAcoes">${s === 'feito' ? '' : btn('feito', 'Feito', r.id) + btn('remarcar', 'Remarcar', r.id) + btn('cancelar', 'Cancelar', r.id)}${btn('caderno', 'Abrir no Caderno', r.id)}</div></div>`;
  }).join('') + e.pedidos.map(p => `<div class="agLinha"><div class="agLinhaTxt">Pedido ${escapeHtml(p.numero)} · ${escapeHtml(p.cliente)}<span class="agLinhaSub">${escapeHtml(p.tipoData)} prevista (veja em Pedidos Parados)</span></div></div>`).join('')
    || '<p class="ppVazio">Nenhum retorno neste dia.</p>';
}
// Grava um retorno; sem rede vai para a fila local (enviada quando a rede volta). Usado pela Agenda e pelo Caderno.
async function agCriarRetorno(linha){
  const r = await ppSeguro(() => sb.from('agenda_retornos').insert(linha));
  if(r && r.error){
    if(agErroDeRede(r.error)){ agFilaGuardar(linha); mostrarAviso('Sem internet: retorno guardado neste computador, será enviado quando a rede voltar.', 'info'); }
    else { mostrarAviso('Não foi possível salvar o retorno: ' + r.error.message, 'erro'); return false; }
  }
  agEstado.retornos.push(Object.assign({ status: 'pendente' }, linha));
  agRenderMes(); agAvisarMudou();
  return true;
}
function agErroDeRede(error){ return navigator.onLine === false || /fetch|network|Failed to fetch|NetworkError/i.test(String(error && error.message)); }
function agFilaChave(){ return 'agenda_fila_' + agUid(); }
function agFilaLer(){ try{ return JSON.parse(localStorage.getItem(agFilaChave()) || '[]'); }catch(_e){ return []; } }
function agFilaGuardar(linha){ try{ const f = agFilaLer(); f.push(linha); localStorage.setItem(agFilaChave(), JSON.stringify(f)); }catch(_e){ /* sem localStorage: segue sem fila */ } }
async function agFilaEnviar(){
  const fila = agFilaLer();
  if(!fila.length) return;
  const resto = [];
  for(const linha of fila){
    const r = await ppSeguro(() => sb.from('agenda_retornos').upsert(linha, { onConflict: 'id' }));
    if(r && r.error) resto.push(linha);
  }
  try{ localStorage.setItem(agFilaChave(), JSON.stringify(resto)); }catch(_e){ /* idem */ }
  if(resto.length < fila.length){ mostrarAviso('Retornos guardados sem internet foram enviados.', 'ok'); agAvisarMudou(); }
}
async function agSalvarNovo(f){
  const v = agValidarRetorno(f, agAgora());
  document.getElementById('agFErro').textContent = v.erro || '';
  if(v.erro) return false;
  const linha = { id: cdUuid(), nota_id: f.nota_id || null, nome: f.nome.trim(), telefone: f.telefone.trim(), quando: agIsoSP(f.dia, f.hora),
    tipo: f.tipo || 'ligacao', qtd_linhas: cdNum(f.qtd_linhas) === null ? null : Math.round(cdNum(f.qtd_linhas)), valor_plano: cdNum(f.valor_plano),
    observacao: String(f.observacao || '').trim() || null, origem: f.origem || 'manual' };
  const ok = await agCriarRetorno(linha);
  if(ok) mostrarAviso(v.aviso ? 'Retorno salvo. Atenção: ' + v.aviso : 'Retorno agendado para ' + ppFmtDia(f.dia) + ' às ' + f.hora + '.', v.aviso ? 'info' : 'ok');
  return ok;
}
async function agAtualizar(id, patch, msgOk){
  const r = await ppSeguro(() => sb.from('agenda_retornos').update(patch).eq('id', id));
  if(r && r.error){ mostrarAviso('Não foi possível atualizar o retorno: ' + r.error.message, 'erro'); return false; }
  const item = agEstado.retornos.find(x => x.id === id);
  if(item) Object.assign(item, patch);
  if(patch.status === 'cancelado') agEstado.retornos = agEstado.retornos.filter(x => x.id !== id);
  agRenderMes(); agAvisarMudou();
  if(msgOk) mostrarAviso(msgOk, 'ok');
  return true;
}
function agMarcarFeito(id){ return agAtualizar(id, { status: 'feito' }, 'Retorno marcado como feito.'); }
function agCancelar(id){ return agAtualizar(id, { status: 'cancelado' }, 'Retorno cancelado.'); }
function agRemarcar(id, dia, hora){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dia || '') || !/^\d{2}:\d{2}$/.test(hora || '')){ mostrarAviso('Escolha dia e hora.', 'erro'); return Promise.resolve(false); }
  return agAtualizar(id, { quando: agIsoSP(dia, hora), status: 'pendente' }, 'Retorno remarcado para ' + ppFmtDia(dia) + ' às ' + hora + '.');
}
function agSoltarEm(id, dia){
  const r = agEstado.retornos.find(x => x.id === id);
  if(!r || agPartesSP(r.quando).dia === dia) return Promise.resolve(false);
  const p = agPartesSP(agRemarcarMesmoHorario(r.quando, dia));
  return agRemarcar(id, p.dia, p.hora);
}

document.getElementById('agMesAnt').addEventListener('click', async () => { agEstado.ym = agMesVizinho(agEstado.ym, -1); await agCarregarMes(); agRenderMes(); });
document.getElementById('agMesProx').addEventListener('click', async () => { agEstado.ym = agMesVizinho(agEstado.ym, 1); await agCarregarMes(); agRenderMes(); });
document.getElementById('agHoje').addEventListener('click', async () => { agEstado.ym = agPartesSP(agAgora()).dia.slice(0, 7); await agCarregarMes(); agRenderMes(); });
document.getElementById('agNovo').addEventListener('click', () => agAbrirDia(agPartesSP(agAgora()).dia));
document.getElementById('agGrade').addEventListener('click', (ev) => { const d = ev.target.closest('.agDia'); if(d) agAbrirDia(d.dataset.dia); });
document.getElementById('agLista').addEventListener('click', (ev) => { const l = ev.target.closest('.agListaDia[data-dia]'); if(l) agAbrirDia(l.dataset.dia); });
document.getElementById('agGrade').addEventListener('dragstart', (ev) => { const it = ev.target.closest('.agItem[data-id]'); if(it){ agEstado.arrastando = it.dataset.id; if(ev.dataTransfer) ev.dataTransfer.setData('text/plain', it.dataset.id); } });
document.getElementById('agGrade').addEventListener('dragover', (ev) => { const d = ev.target.closest('.agDia'); if(d && agEstado.arrastando){ ev.preventDefault(); d.classList.add('soltar'); } });
document.getElementById('agGrade').addEventListener('dragleave', (ev) => { const d = ev.target.closest('.agDia'); if(d) d.classList.remove('soltar'); });
document.getElementById('agGrade').addEventListener('drop', (ev) => { const d = ev.target.closest('.agDia'); if(!d || !agEstado.arrastando) return; ev.preventDefault(); const id = agEstado.arrastando; agEstado.arrastando = null; agSoltarEm(id, d.dataset.dia); });
document.getElementById('agDiaFechar').addEventListener('click', () => { agEstado.diaAberto = null; fecharOverlay(document.getElementById('agDiaOverlay')); });
document.getElementById('agFHoras').addEventListener('click', (ev) => { const b = ev.target.closest('[data-hora]'); if(b) document.getElementById('agFHora').value = b.dataset.hora; });
document.getElementById('agForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const v = id => document.getElementById(id).value;
  const ok = await agSalvarNovo({ nome: v('agFNome'), telefone: v('agFTel'), dia: v('agFDia'), hora: v('agFHora'), tipo: v('agFTipo'), qtd_linhas: v('agFLinhas'), valor_plano: v('agFValor'), observacao: v('agFObs') });
  if(ok) ['agFNome', 'agFTel', 'agFLinhas', 'agFValor', 'agFObs', 'agFHora'].forEach(id => { document.getElementById(id).value = ''; });
});
document.getElementById('agDiaLista').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ag]');
  if(!b) return;
  const id = b.dataset.id, acao = b.dataset.ag;
  if(acao === 'feito') agMarcarFeito(id);
  else if(acao === 'cancelar') agCancelar(id);
  else if(acao === 'caderno'){ const r = agEstado.retornos.find(x => x.id === id); if(r) cdAbrirDoRetorno(r); }
  else if(acao === 'remarcar'){
    const linha = b.closest('.agLinha');
    if(linha.querySelector('.agRemarcar')) return;
    const r = agEstado.retornos.find(x => x.id === id), p = agPartesSP(r.quando);
    linha.insertAdjacentHTML('beforeend', `<div class="agRemarcar"><input type="date" value="${p.dia}"><input type="time" step="300" value="${p.hora}"><button type="button" class="btn btn-sm" data-ag="salvarRemarcar" data-id="${escapeHtml(id)}" style="width:auto">Salvar</button></div>`);
  } else if(acao === 'salvarRemarcar'){
    const box = b.closest('.agRemarcar');
    agRemarcar(id, box.querySelector('input[type=date]').value, box.querySelector('input[type=time]').value);
  }
});
window.addEventListener('online', () => { if(currentUser){ agFilaEnviar(); } });
```

Nessa Task, `cdAbrirDoRetorno`, `alAtualizarAvisoPermissao` e `objAplicarPermissaoEditor` ainda não existem: são criados nas Tasks 7, 10 e 9. Para a Task 6 rodar sozinha, crie agora as três como esboço, logo depois de `agResetar`. As tasks seguintes **substituem** esses esboços:

```js
function cdAbrirDoRetorno(_r){ /* Task 7 */ }
function alAtualizarAvisoPermissao(){ /* Task 10 */ }
function objAplicarPermissaoEditor(){ /* Task 9 */ }
```

No listener de abas (linha ~2229, depois de `if(btn.dataset.tab === 'mesa') loadMesa(true);`):

```js
  if(btn.dataset.tab === 'agenda') loadAgenda();
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node test_agenda.js`
Expected: `0 falharam`.

- [ ] **Step 7: Rodar a suíte para ver se o resto continua igual**

Run: `bash run_tests.sh`
Expected: só as 2 falhas antigas conhecidas (`test_conversao_vendas.js`, `test_pedidos_alerta.js`). Se `test_sidebar_nav.js` ou `test_reorganizacao_abas.js` falharem por contar botões, ajuste o número esperado nesses testes para incluir "Agenda" e registre o motivo no commit.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_agenda.js
git commit -m "feat(agenda): aba Agenda com calendario do mes, painel do dia e remarcar (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: Caderno — gaveta, campos, salvamento que nunca perde, histórico e agendar retorno

**Files:**
- Modify: `_template.html`:
  - `#cdBotao` + `#cdGaveta` logo depois do `#apexMindBubble`;
  - CSS no `#cadernoStyles`;
  - funções `cd*` de tela, que substituem o esboço `cdAbrirDoRetorno`;
  - `cadernoAoEntrar()` em `enterApp` e `cadernoResetar()` no logout.
- Test: `test_caderno.js`

**Interfaces:**
- **Consumes:** Task 5 (`cd*` puras), Task 6 (`agCriarRetorno`, `agAtalhos`, `agIsoSP`, `agAvisarMudou`).
- **Produces:**
  - `cdEstado = { nota, aberto, salvando, timer, retryTimer, debounceMs, status, historico, retornoPendente, doc }`
  - `cdAbrir()`, `cdFechar()`, `cdNovo()`, `cdAbrirDoRetorno(r)`
  - `cdAgendarSalvar()`, `cdSalvarAgora() → Promise<boolean>`
  - `cdRestaurar()`, `cdAgendarRetorno(dia, hora, origem)`
  - `cadernoAoEntrar()`, `cadernoResetar()`
  - `cdStatus(txt)`: o texto do indicador `#cdStatus`

- [ ] **Step 1: Teste (falha)** — em `test_caderno.js`, trocar `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 7: gaveta, salvamento, histórico, retorno ====
  const nowReal = Date.now;
  const AGORA = sp('2026-10-06T10:00:00');
  Date.now = () => AGORA;
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cdEstado.debounceMs = 0;
  try{ localStorage.clear(); }catch(_e){}
  cadernoAoEntrar();
  assert(document.getElementById('cdBotao').style.display !== 'none', 'botão do Caderno aparece logado');
  document.getElementById('cdBotao').click();
  assert(document.getElementById('cdGaveta').classList.contains('aberta'), 'abre a gaveta');
  assert(document.activeElement === document.getElementById('cdF_telefone'), 'cursor no telefone');
  // Alt+N fecha e abre
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', altKey: true }));
  assert(!document.getElementById('cdGaveta').classList.contains('aberta'), 'Alt+N fecha');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', altKey: true }));
  assert(document.getElementById('cdGaveta').classList.contains('aberta'), 'Alt+N abre');

  // digitar salva (local + banco), sem duplicar
  const idNota = cdEstado.nota.id;
  window.__tabelas.caderno_notas = [{ id: 'antiga', consultor_id: 'c1', chave_tel: '1990000001', nome: 'Empresa Teste', texto: 'ligou ontem\\nqueria 70GB', resultado: 'nao_atendeu', atualizado_em: '2026-10-05T15:00:00Z' }];
  window.__tabelas.agenda_retornos = [{ id: 'rp', consultor_id: 'c1', chave_tel: '1990000001', status: 'pendente', quando: '2026-10-08T14:30:00-03:00', nome: 'Empresa Teste' }];
  const digita = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  digita('cdF_telefone', '(19) 99000-0001');
  digita('cdF_nome', 'Empresa Teste');
  digita('cdTexto', 'cnpj 11.222.333/0001-81, 12 linhas na Vivo');
  await espera(40);
  const ups = window.__escritas.filter(e => e.tabela === 'caderno_notas' && e.op === 'upsert');
  assert(ups.length >= 1 && ups.every(u => u.rows.id === idNota && u.opts.onConflict === 'id'), 'upsert pelo mesmo id');
  eq(document.getElementById('cdStatus').textContent, 'Salvo ✓', 'indicador salvo');
  const ls = JSON.parse(localStorage.getItem('caderno_rascunho_c1'));
  assert(ls && ls.nota.id === idNota && ls.pendente === false, 'rascunho local marcado como enviado');
  // sugestão de preencher (CNPJ reconhecido)
  const sug = document.querySelector('#cdSugestoes [data-cd-preencher="cnpj"]');
  assert(sug, 'sugere preencher CNPJ');
  sug.click(); await espera(10);
  eq(document.getElementById('cdF_cnpj').value, '11.222.333/0001-81', 'preencheu formatado');
  // histórico e retorno pendente do mesmo telefone
  await espera(40);
  assert(document.getElementById('cdHistorico').textContent.includes('ligou ontem') && document.getElementById('cdHistorico').textContent.includes('Não atendeu'), 'histórico do cliente');
  assert(document.getElementById('cdRetornoPendente').textContent.includes('qui 08/10 14:30'), 'retorno pendente mostrado');
  // CPF inválido: aviso discreto
  digita('cdF_cpf', '123.456.789-00');
  assert(document.getElementById('cdF_cpf').closest('.field').classList.contains('cdAviso'), 'aviso de CPF inválido');

  // sem rede: guarda local, tenta de novo; nada se perde
  window.__falharEscrita = (t, op) => (t === 'caderno_notas' ? { message: 'Failed to fetch' } : null);
  digita('cdTexto', 'cnpj 11.222.333/0001-81, 12 linhas na Vivo. Volta amanhã');
  await espera(40);
  eq(document.getElementById('cdStatus').textContent, 'Sem internet: guardado neste computador', 'indicador offline');
  assert(JSON.parse(localStorage.getItem('caderno_rascunho_c1')).pendente === true, 'rascunho pendente');
  // recarregar a página (novo estado) restaura e reenvia
  window.__falharEscrita = null;
  cdEstado.nota = null;
  await cdRestaurar(); await espera(30);
  eq(cdEstado.nota.id, idNota, 'restaurou a mesma nota');
  assert(document.getElementById('cdTexto').value.includes('Volta amanhã'), 'texto restaurado');
  eq(document.getElementById('cdStatus').textContent, 'Salvo ✓', 'reenviado depois de restaurar');

  // agendar retorno do próprio Caderno
  const btnAmanha = [...document.querySelectorAll('#cdAtalhos [data-cd-dia]')].find(b => b.textContent === 'Amanhã 9h');
  btnAmanha.click(); await espera(40);
  const ret = window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop();
  eq([ret.rows.quando, ret.rows.nome, ret.rows.nota_id, ret.rows.origem], ['2026-10-07T09:00:00-03:00', 'Empresa Teste', idNota, 'manual'], 'retorno nasce do Caderno');
  // "Não atendeu" oferece tentar em 2h
  document.querySelector('#cdResultado [data-cd-res="nao_atendeu"]').click(); await espera(10);
  const tentar = document.querySelector('#cdSugestaoRetorno [data-cd-dia]');
  assert(tentar && tentar.textContent.includes('Tentar de novo em 2h'), 'sugestão após não atendeu');
  tentar.click(); await espera(40);
  eq(window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop().rows.origem, 'nao_atendeu', 'origem nao_atendeu');
  // fidelidade sugere 45 dias antes
  digita('cdF_fidelidade_vence', '2027-03');
  const fid = document.querySelector('#cdSugestaoRetorno [data-cd-origem="fidelidade"]');
  assert(fid && fid.textContent.includes('15/01'), 'sugestão de fidelidade');
  fid.click(); await espera(40);
  eq(window.__escritas.filter(e => e.tabela === 'agenda_retornos' && e.op === 'insert').pop().rows.quando, '2027-01-15T09:00:00-03:00', 'retorno da fidelidade às 9h');

  // novo atendimento: nova nota, a anterior já salva
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(30); // cdNovo salva a nota atual antes de trocar
  assert(cdEstado.nota.id !== idNota && document.getElementById('cdF_telefone').value === '', 'novo atendimento em branco');
  // nota vazia não é gravada
  const antes = window.__escritas.length;
  cdAgendarSalvar(); await espera(20);
  eq(window.__escritas.length, antes, 'nota vazia não grava');

  // abrir a partir de um retorno da Agenda
  window.__tabelas.caderno_notas.push({ id: 'n-ret', consultor_id: 'c1', telefone: '19990000003', nome: 'Retorno Teste', texto: 'detalhes', interesse: [], objecoes: [] });
  await cdAbrirDoRetorno({ id: 'r9', nota_id: 'n-ret', nome: 'Retorno Teste', telefone: '19990000003' }); await espera(20);
  eq([cdEstado.nota.id, document.getElementById('cdF_nome').value], ['n-ret', 'Retorno Teste'], 'abre a nota de origem');
  await cdAbrirDoRetorno({ id: 'r10', nota_id: null, nome: 'Sem Nota Teste', telefone: '19990000004' }); await espera(20);
  eq([document.getElementById('cdF_nome').value, document.getElementById('cdF_telefone').value], ['Sem Nota Teste', '19990000004'], 'sem nota: Caderno novo já com nome e telefone');

  // logout limpa
  cadernoResetar();
  assert(document.getElementById('cdBotao').style.display === 'none' && !document.getElementById('cdGaveta').classList.contains('aberta'), 'logout esconde o Caderno');
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_caderno.js`
Expected: FAIL com `ReferenceError: cdEstado is not defined`.

- [ ] **Step 3: HTML** — logo depois do `</button>` do `#apexMindBubble`:

```html
  <!-- Caderno de Ligação (06/10/2026, seção 72): botão fixo + gaveta; Alt+N abre/fecha, Alt+Shift+N novo atendimento -->
  <button id="cdBotao" type="button" class="btn" style="display:none" title="Caderno de Ligação (Alt+N)" aria-label="Abrir Caderno de Ligação">Caderno</button>
  <aside id="cdGaveta" aria-label="Caderno de Ligação">
    <div class="cdTopo">
      <strong>Caderno</strong>
      <span id="cdStatus" class="cdStatus"></span>
      <div class="cdTopoAcoes">
        <button type="button" class="btn btn-sm btn-ghost" id="cdNovo" title="Novo atendimento (Alt+Shift+N)" style="width:auto">Novo</button>
        <button type="button" class="btn btn-sm btn-ghost" id="cdDestacar" title="Janela flutuante sobre o ProContact" style="width:auto">Flutuar</button>
        <button type="button" class="mClose" id="cdFechar" aria-label="Fechar">&times;</button>
      </div>
    </div>
    <div class="cdCorpo">
      <div id="cdRetornoPendente" class="cdRetornoPendente"></div>
      <div class="cdGrid">
        <div class="field"><label>Telefone</label><input type="tel" id="cdF_telefone" data-cd-campo="telefone" maxlength="20"></div>
        <div class="field"><label>Nome</label><input type="text" id="cdF_nome" data-cd-campo="nome" maxlength="120"></div>
        <div class="field"><label>CPF</label><input type="text" id="cdF_cpf" data-cd-campo="cpf" inputmode="numeric" maxlength="14"></div>
        <div class="field"><label>CNPJ</label><input type="text" id="cdF_cnpj" data-cd-campo="cnpj" inputmode="numeric" maxlength="18"></div>
        <div class="field"><label>CEP</label><input type="text" id="cdF_cep" data-cd-campo="cep" inputmode="numeric" maxlength="9"></div>
        <div class="field"><label>Linhas</label><input type="text" id="cdF_qtd_linhas" data-cd-campo="qtd_linhas" inputmode="numeric" maxlength="6"></div>
        <div class="field"><label>Valor do plano (R$)</label><input type="text" id="cdF_valor_plano" data-cd-campo="valor_plano" inputmode="decimal" maxlength="12"></div>
      </div>
      <details class="cdMais">
        <summary>Mais dados</summary>
        <div class="cdGrid">
          <div class="field"><label>E-mail</label><input type="email" id="cdF_email" data-cd-campo="email" maxlength="120"></div>
          <div class="field"><label>Operadora atual</label><input type="text" id="cdF_operadora_atual" data-cd-campo="operadora_atual" maxlength="40"></div>
          <div class="field"><label>Decisor</label><input type="text" id="cdF_decisor" data-cd-campo="decisor" maxlength="80"></div>
          <div class="field"><label>Fidelidade vence</label><input type="month" id="cdF_fidelidade_vence" data-cd-campo="fidelidade_vence"></div>
        </div>
        <div class="cdInteresse" id="cdInteresse"><button type="button" class="filterPill" data-cd-int="movel">Móvel</button><button type="button" class="filterPill" data-cd-int="fibra">Fibra</button><button type="button" class="filterPill" data-cd-int="portabilidade">Portabilidade</button></div>
      </details>
      <div id="cdObjecoes" class="cdObjecoes"></div>
      <div class="field"><label>Anotação</label><textarea id="cdTexto" rows="6" placeholder="Escreva como no Bloco de Notas: o que o cliente disse, o que ficou combinado…"></textarea></div>
      <div id="cdSugestoes" class="cdSugestoes"></div>
      <div class="cdResultado" id="cdResultado"><button type="button" class="filterPill" data-cd-res="atendeu">Atendeu</button><button type="button" class="filterPill" data-cd-res="nao_atendeu">Não atendeu</button><button type="button" class="filterPill" data-cd-res="caixa_postal">Caixa postal</button><button type="button" class="filterPill" data-cd-res="sem_interesse">Sem interesse</button><button type="button" class="filterPill" data-cd-res="fechou">Fechou</button></div>
      <div class="cdAgendar">
        <h4>Agendar retorno</h4>
        <div id="cdAtalhos" class="cdAtalhos"></div>
        <div class="cdEscolher"><input type="date" id="cdRetDia"><input type="time" id="cdRetHora" step="300"><button type="button" class="btn btn-sm" id="cdRetSalvar" style="width:auto">Agendar</button></div>
        <div id="cdSugestaoRetorno" class="cdSugestaoRetorno"></div>
      </div>
      <div id="cdHistorico" class="cdHistorico"></div>
    </div>
  </aside>
```

- [ ] **Step 4: CSS** — adicionar ao `#cadernoStyles` (antes do `@media`):

```css
  #cdBotao{position:fixed;right:var(--space-6);bottom:100px;z-index:95;width:auto;box-shadow:var(--shadow-lg);}
  #cdGaveta{position:fixed;top:0;right:0;bottom:0;width:min(440px,100vw);background:var(--c-branco);border-left:1px solid var(--c-linha);box-shadow:var(--shadow-lg);z-index:96;display:none;flex-direction:column;}
  #cdGaveta.aberta{display:flex;}
  #cdGaveta.flutuante{position:static;width:100%;height:100vh;border:0;box-shadow:none;display:flex;}
  .cdTopo{display:flex;align-items:center;gap:var(--space-2);padding:var(--space-3) var(--space-4);border-bottom:1px solid var(--c-linha);}
  .cdTopo .mClose{position:static;}
  .cdTopoAcoes{margin-left:auto;display:flex;gap:4px;align-items:center;}
  .cdStatus{font-size:var(--fs-xs);color:var(--muted);}
  .cdStatus.offline{color:var(--st-andamento);font-weight:600;}
  .cdCorpo{overflow-y:auto;padding:var(--space-4);flex:1;}
  .cdGrid{display:grid;grid-template-columns:1fr 1fr;gap:0 var(--space-3);}
  .cdGrid .field{margin-bottom:var(--space-2);}
  .field.cdAviso input{border-color:var(--st-andamento);}
  .field.cdAviso label::after{content:" — confira";color:var(--st-andamento);font-weight:400;}
  .cdMais{margin:var(--space-2) 0 var(--space-3);}
  .cdMais summary{cursor:pointer;font-size:var(--fs-sm);color:var(--muted);}
  .cdInteresse,.cdResultado,.cdAtalhos,.cdSugestoes{display:flex;gap:var(--space-2);flex-wrap:wrap;margin:var(--space-2) 0;}
  .cdEscolher{display:flex;gap:var(--space-2);flex-wrap:wrap;}
  .cdAgendar{border-top:1px dashed var(--c-linha);margin-top:var(--space-3);padding-top:var(--space-3);}
  .cdAgendar h4,.cdHistorico h4{margin:0 0 var(--space-2);font-size:var(--fs-sm);}
  .cdSugestaoRetorno{display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-2);}
  .cdRetornoPendente:not(:empty){background:var(--st-andamento-bg);color:var(--st-andamento);padding:var(--space-2) var(--space-3);margin-bottom:var(--space-3);font-size:var(--fs-sm);display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap;}
  .cdHistorico{margin-top:var(--space-4);}
  .cdHistItem{padding:var(--space-2) 0;border-bottom:1px solid var(--c-linha);font-size:var(--fs-sm);cursor:pointer;}
  .cdHistItem small{display:block;color:var(--muted);}
```

- [ ] **Step 5: JS** — no bloco §72, **substituindo** o esboço `function cdAbrirDoRetorno(_r){ /* Task 7 */ }`:

```js
const cdEstado = { nota: null, aberto: false, timer: null, retryTimer: null, debounceMs: 800, salvando: null, status: '', historico: [], retornoPendente: null, doc: document };
function cdEl(id){ return cdEstado.doc.getElementById(id) || document.getElementById(id); }
function cdLsChave(){ return 'caderno_rascunho_' + agUid(); }
function cdLsGravar(pendente){ try{ localStorage.setItem(cdLsChave(), JSON.stringify({ nota: cdEstado.nota, pendente })); }catch(_e){ /* sem localStorage: segue só com o banco */ } }
function cdLsLer(){ try{ return JSON.parse(localStorage.getItem(cdLsChave()) || 'null'); }catch(_e){ return null; } }
function cdStatus(txt, offline){
  cdEstado.status = txt;
  const el = cdEl('cdStatus');
  el.textContent = txt;
  el.classList.toggle('offline', !!offline);
}
function cdFmtCampo(c, v){
  const d = cdDigitos(v);
  if(c === 'cnpj' && d.length === 14) return cdFmtCnpj(d);
  if(c === 'cpf' && d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if(c === 'cep' && d.length === 8) return d.replace(/^(\d{5})(\d{3})$/, '$1-$2');
  return v == null ? '' : String(v);
}
// Preenche a tela a partir de cdEstado.nota (ao abrir, restaurar ou trocar de nota).
function cdPreencherTela(){
  const n = cdEstado.nota;
  CD_CAMPOS.forEach(c => { const el = cdEl('cdF_' + c); if(el) el.value = cdFmtCampo(c, n[c]); });
  cdEl('cdTexto').value = n.texto || '';
  cdEstado.doc.querySelectorAll('#cdInteresse [data-cd-int]').forEach(b => b.classList.toggle('active', n.interesse.includes(b.dataset.cdInt)));
  cdEstado.doc.querySelectorAll('#cdResultado [data-cd-res]').forEach(b => b.classList.toggle('active', n.resultado === b.dataset.cdRes));
  cdValidarDocs(); cdRenderSugestoes(); cdRenderAtalhos(); cdRenderSugestaoRetorno();
  if(typeof objRenderChips === 'function') objRenderChips();
}
function cdValidarDocs(){
  const marca = (c, valido) => { const el = cdEl('cdF_' + c); el.closest('.field').classList.toggle('cdAviso', !!cdDigitos(el.value) && !valido(el.value)); };
  marca('cpf', cdCpfValido); marca('cnpj', cdCnpjValido);
}
function cdRenderSugestoes(){
  cdEl('cdSugestoes').innerHTML = cdSugestoesPreencher(cdEstado.nota).map(s => `<button type="button" class="filterPill" data-cd-preencher="${s.campo}" data-valor="${escapeHtml(s.valor)}">Preencher ${s.campo.toUpperCase()}: ${escapeHtml(cdFmtCampo(s.campo, s.valor))}</button>`).join('');
}
function cdRenderAtalhos(){
  cdEl('cdAtalhos').innerHTML = agAtalhos(agAgora()).map(a => `<button type="button" class="filterPill" data-cd-dia="${a.dia}" data-cd-hora="${a.hora}" data-cd-origem="manual">${a.rotulo}</button>`).join('');
}
function cdRenderSugestaoRetorno(){
  const n = cdEstado.nota, partes = [];
  if(n.resultado === 'nao_atendeu'){ const a = agAtalhos(agAgora())[0]; partes.push(`<button type="button" class="btn btn-sm btn-outline" data-cd-dia="${a.dia}" data-cd-hora="${a.hora}" data-cd-origem="nao_atendeu" style="width:auto">Tentar de novo em 2h (${a.hora})</button>`); }
  const f = cdSugestaoFidelidade(n.fidelidade_vence, agPartesSP(agAgora()).dia);
  if(f) partes.push(`<button type="button" class="btn btn-sm btn-outline" data-cd-dia="${f.dia}" data-cd-hora="09:00" data-cd-origem="fidelidade" style="width:auto">${escapeHtml(f.rotulo)}</button>`);
  cdEl('cdSugestaoRetorno').innerHTML = partes.join('');
}
function cdAgendarSalvar(){
  clearTimeout(cdEstado.timer);
  if(!cdEstado.nota || cdNotaVazia(cdEstado.nota)) return;
  cdLsGravar(true);
  cdStatus('Salvando…');
  cdEstado.timer = setTimeout(() => { cdSalvarAgora(); }, cdEstado.debounceMs);
}
async function cdSalvarAgora(){
  const n = cdEstado.nota;
  if(!n || cdNotaVazia(n) || !currentUser) return false;
  clearTimeout(cdEstado.retryTimer);
  cdLsGravar(true);
  const r = await ppSeguro(() => sb.from('caderno_notas').upsert(cdPayload(n), { onConflict: 'id' }));
  if(cdEstado.nota !== n){ return !(r && r.error); } // trocou de nota no meio: a outra segue o próprio fluxo
  if(r && r.error){
    if(agErroDeRede(r.error)){
      cdStatus('Sem internet: guardado neste computador', true);
      cdEstado.retryTimer = setTimeout(() => { cdSalvarAgora(); }, 15000);
    } else cdStatus('Não salvou no servidor: guardado neste computador', true);
    return false;
  }
  n.atualizado_em = new Date().toISOString();
  cdLsGravar(false);
  cdStatus('Salvo ✓');
  return true;
}
async function cdCarregarContexto(){
  const n = cdEstado.nota, k = chaveTel(n.telefone), cnpj = cdDigitos(n.cnpj);
  if(!k && cnpj.length !== 14){ cdEstado.historico = []; cdEstado.retornoPendente = null; cdRenderContexto(); return; }
  const filtro = [k ? 'chave_tel.eq.' + k : null, cnpj.length === 14 ? 'cnpj.eq.' + cnpj : null].filter(Boolean).join(',');
  const [h, rp] = await Promise.all([
    ppSeguro(() => sb.from('caderno_notas').select('id,nome,texto,resultado,atualizado_em').eq('consultor_id', currentUser.id).or(filtro).neq('id', n.id).order('atualizado_em', { ascending: false }).limit(5)),
    k ? ppSeguro(() => sb.from('agenda_retornos').select('id,quando,nome,status').eq('consultor_id', currentUser.id).eq('chave_tel', k).eq('status', 'pendente').order('quando', { ascending: true }).limit(1)) : Promise.resolve({ data: [] }),
  ]);
  if(cdEstado.nota !== n) return;
  cdEstado.historico = h && !h.error ? (h.data || []) : [];
  cdEstado.retornoPendente = rp && !rp.error && rp.data && rp.data[0] ? rp.data[0] : null;
  cdRenderContexto();
}
function cdRenderContexto(){
  const rp = cdEstado.retornoPendente;
  if(rp){
    const p = agPartesSP(rp.quando), sem = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][agDiaSemana(p.dia)];
    cdEl('cdRetornoPendente').innerHTML = `<span>Retorno marcado: ${sem} ${ppFmtDia(p.dia).slice(0, 5)} ${p.hora}</span><button type="button" class="btn btn-sm btn-ghost" data-cd-ret-feito="${escapeHtml(rp.id)}" style="width:auto">Feito</button><button type="button" class="btn btn-sm btn-ghost" data-cd-ret-remarcar="${escapeHtml(rp.id)}" style="width:auto">Remarcar</button>`;
  } else cdEl('cdRetornoPendente').innerHTML = '';
  const hs = cdEstado.historico;
  cdEl('cdHistorico').innerHTML = hs.length ? '<h4>Anotações anteriores deste cliente</h4>' + hs.map(x => {
    const resumo = String(x.texto || '').split('\n').slice(0, 2).join(' · ');
    return `<div class="cdHistItem" data-cd-hist="${escapeHtml(x.id)}">${escapeHtml(resumo || '(sem anotação)')}<small>${escapeHtml(ppFmtDia(leadDateSP(x.atualizado_em)))}${x.resultado ? ' · ' + escapeHtml(CD_RESULTADOS[x.resultado] || x.resultado) : ''}</small></div>`;
  }).join('') : '';
}
function cdAbrir(){
  if(!currentUser) return;
  if(!cdEstado.nota) cdEstado.nota = cdNovaNota();
  cdEstado.aberto = true;
  cdEl('cdGaveta').classList.add('aberta');
  cdPreencherTela();
  cdEl('cdF_telefone').focus();
}
function cdFechar(){
  cdEstado.aberto = false;
  cdEl('cdGaveta').classList.remove('aberta');
}
async function cdNovo(){
  if(cdEstado.nota && !cdNotaVazia(cdEstado.nota)) await cdSalvarAgora();
  cdEstado.nota = cdNovaNota();
  cdEstado.historico = []; cdEstado.retornoPendente = null;
  try{ localStorage.removeItem(cdLsChave()); }catch(_e){ /* idem */ }
  cdStatus('');
  cdAbrir(); cdRenderContexto();
}
async function cdAbrirDoRetorno(r){
  if(cdEstado.nota && !cdNotaVazia(cdEstado.nota)) await cdSalvarAgora();
  let nota = null;
  if(r.nota_id){
    const q = await ppSeguro(() => sb.from('caderno_notas').select('*').eq('id', r.nota_id).maybeSingle());
    if(q && !q.error && q.data) nota = Object.assign(cdNovaNota(), q.data, {
      fidelidade_vence: q.data.fidelidade_vence ? String(q.data.fidelidade_vence).slice(0, 7) : '',
      qtd_linhas: q.data.qtd_linhas == null ? '' : String(q.data.qtd_linhas),
      valor_plano: q.data.valor_plano == null ? '' : String(q.data.valor_plano).replace('.', ','),
      interesse: q.data.interesse || [], objecoes: q.data.objecoes || [],
    });
  }
  cdEstado.nota = nota || Object.assign(cdNovaNota(), { nome: r.nome || '', telefone: r.telefone || '' });
  CD_CAMPOS.forEach(c => { if(cdEstado.nota[c] == null) cdEstado.nota[c] = ''; });
  cdStatus(nota ? 'Salvo ✓' : '');
  cdAbrir();
  cdCarregarContexto();
}
async function cdRestaurar(){
  const ls = cdLsLer();
  if(!ls || !ls.nota || !ls.nota.id) return;
  cdEstado.nota = Object.assign(cdNovaNota(), ls.nota);
  cdPreencherTela();
  if(ls.pendente){ cdStatus('Salvando…'); await cdSalvarAgora(); }
  else cdStatus('Salvo ✓');
}
async function cdAgendarRetorno(dia, hora, origem){
  const n = cdEstado.nota;
  if(!chaveTel(n.telefone)){ mostrarAviso('Preencha o telefone do cliente para agendar o retorno.', 'erro'); cdEl('cdF_telefone').focus(); return false; }
  await cdSalvarAgora();
  const ok = await agCriarRetorno(cdRetornoDaNota(n, agIsoSP(dia, hora), origem));
  if(ok){ mostrarAviso('Retorno agendado para ' + ppFmtDia(dia) + ' às ' + hora + '.', 'ok'); cdCarregarContexto(); }
  return ok;
}
function cadernoAoEntrar(){
  cdEstado.nota = null;
  document.getElementById('cdBotao').style.display = 'inline-block';
  cdRestaurar();
  if(typeof objCarregar === 'function') objCarregar();
  if(typeof alIniciar === 'function') alIniciar();
  agFilaEnviar();
}
function cadernoResetar(){
  clearTimeout(cdEstado.timer); clearTimeout(cdEstado.retryTimer);
  cdFechar();
  Object.assign(cdEstado, { nota: null, historico: [], retornoPendente: null, status: '' });
  document.getElementById('cdBotao').style.display = 'none';
  agResetar();
  if(typeof alParar === 'function') alParar();
}
// Os listeners ficam presos ao elemento da gaveta (não ao document), para funcionarem também na janela flutuante.
function cdLigarEventos(gaveta){
  gaveta.addEventListener('input', (ev) => {
    const el = ev.target;
    if(!cdEstado.nota) return;
    if(el.dataset && el.dataset.cdCampo){
      cdEstado.nota[el.dataset.cdCampo] = el.value;
      if(el.dataset.cdCampo === 'cpf' || el.dataset.cdCampo === 'cnpj') cdValidarDocs();
      if(el.dataset.cdCampo === 'telefone' || el.dataset.cdCampo === 'cnpj') cdCarregarContexto();
      if(el.dataset.cdCampo === 'fidelidade_vence') cdRenderSugestaoRetorno();
    } else if(el.id === 'cdTexto'){
      cdEstado.nota.texto = el.value;
      cdRenderSugestoes();
    } else return;
    cdAgendarSalvar();
  });
  gaveta.addEventListener('click', (ev) => {
    const t = ev.target;
    const pre = t.closest('[data-cd-preencher]');
    if(pre){ const c = pre.dataset.cdPreencher; cdEstado.nota[c] = pre.dataset.valor; cdEl('cdF_' + c).value = cdFmtCampo(c, pre.dataset.valor); cdValidarDocs(); cdRenderSugestoes(); cdAgendarSalvar(); if(c === 'telefone' || c === 'cnpj') cdCarregarContexto(); return; }
    const res = t.closest('[data-cd-res]');
    if(res){ const v = res.dataset.cdRes; cdEstado.nota.resultado = cdEstado.nota.resultado === v ? null : v; cdPreencherTela(); cdAgendarSalvar(); return; }
    const int = t.closest('[data-cd-int]');
    if(int){ const v = int.dataset.cdInt, l = cdEstado.nota.interesse; const i = l.indexOf(v); if(i >= 0) l.splice(i, 1); else l.push(v); int.classList.toggle('active', i < 0); cdAgendarSalvar(); return; }
    const ag = t.closest('[data-cd-dia]');
    if(ag){ cdAgendarRetorno(ag.dataset.cdDia, ag.dataset.cdHora, ag.dataset.cdOrigem || 'manual'); return; }
    const hist = t.closest('[data-cd-hist]');
    if(hist){ cdAbrirDoRetorno({ nota_id: hist.dataset.cdHist }); return; }
    const feito = t.closest('[data-cd-ret-feito]');
    if(feito){ agMarcarFeito(feito.dataset.cdRetFeito).then(() => cdCarregarContexto()); return; }
    const rem = t.closest('[data-cd-ret-remarcar]');
    if(rem){ const p = agPartesSP(cdEstado.retornoPendente.quando); cdEl('cdRetDia').value = p.dia; cdEl('cdRetHora').value = p.hora; cdEstado.remarcando = rem.dataset.cdRetRemarcar; cdEl('cdRetDia').focus(); return; }
    if(t.id === 'cdRetSalvar'){
      const dia = cdEl('cdRetDia').value, hora = cdEl('cdRetHora').value;
      if(cdEstado.remarcando){ const id = cdEstado.remarcando; cdEstado.remarcando = null; agRemarcar(id, dia, hora).then(() => cdCarregarContexto()); }
      else if(/^\d{4}-\d{2}-\d{2}$/.test(dia) && /^\d{2}:\d{2}$/.test(hora)) cdAgendarRetorno(dia, hora, 'manual');
      else mostrarAviso('Escolha dia e hora.', 'erro');
      return;
    }
    if(t.id === 'cdNovo') cdNovo();
    else if(t.id === 'cdFechar') cdFechar();
    else if(t.id === 'cdDestacar' && typeof cdDestacar === 'function') cdDestacar();
  });
}
function cdTeclas(ev){
  if(!currentUser || !ev.altKey) return;
  const k = String(ev.key || '').toLowerCase();
  if(k === 'n' && ev.shiftKey){ ev.preventDefault(); cdNovo(); }
  else if(k === 'n'){ ev.preventDefault(); if(cdEstado.aberto) cdFechar(); else cdAbrir(); }
  else if(/^[1-9]$/.test(k) && cdEstado.aberto && typeof objClicarPorIndice === 'function'){ ev.preventDefault(); objClicarPorIndice(Number(k) - 1); }
}
cdLigarEventos(document.getElementById('cdGaveta'));
document.addEventListener('keydown', cdTeclas);
document.getElementById('cdBotao').addEventListener('click', () => { if(cdEstado.aberto) cdFechar(); else cdAbrir(); });
window.addEventListener('online', () => { if(currentUser && cdLsLer() && cdLsLer().pendente) cdSalvarAgora(); });
```

Em `enterApp`, logo depois de `mesaAplicarPermissao();` (linha ~1989):

```js
    // 06/10/2026 (seção 72): Caderno + Agenda + Objeções — botão do Caderno, rascunho, biblioteca e alertas
    cadernoAoEntrar();
```

No listener de `btnLogout`, logo depois de `currentUser = null;`:

```js
  cadernoResetar(); // seção 72: some o Caderno e para os alertas
```

- [ ] **Step 6: Rodar e ver passar**

Run: `node test_caderno.js && node test_agenda.js`
Expected: os dois com `0 falharam`.

- [ ] **Step 7: Commit**

```bash
git add _template.html test_caderno.js
git commit -m "feat(caderno): gaveta com salvamento que nunca perde, historico e agendar retorno (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 8: Objeções — chips, resposta instantânea, IA para este cliente, "O cliente disse…", Usei e 👍/👎

**Files:**
- Modify: `_template.html` (funções `obj*`; o `#cdObjecoes` já existe na gaveta)
- Create: `test_objecoes.js`

**Interfaces:**
- **Consumes:** `cdEstado`, `cdContextoIA`, `cdTemContexto`, `cdAgendarSalvar`, `cdEl`, `sb`, `mensagemErroFuncao`.
- **Produces:**
  - `objEstado = { lista, cache: Map, aberta, timeoutMs, cacheMs, pedido }`
  - `objCarregar() → Promise`, `objRenderChips()`
  - `objMostrar(chave)`, `objClicarPorIndice(i)`
  - `objPedirIA(body) → Promise<{fala, pergunta}|null>`
  - `objPerguntarLivre(texto)`, `objRegistrarUso(objecao, fonte, util)`
  - `objCacheChave(chaveOuLivre, ctx) → string`

- [ ] **Step 1: Teste (falha)** — `test_objecoes.js`:

```js
// Testa as Objeções com IA (06/10/2026) — REGRAS_NEGOCIO.md §72. DADOS FICTÍCIOS.
const { montarPainel } = require('./painel_teste_base.js');
const { window, rodar } = montarPainel();
window.__tabelas.objecoes_respostas = [
  { chave: 'caro', rotulo: 'Tá caro', fala: 'Fala caro.', pergunta: 'Pergunta caro?', alternativa: 'Alt caro.', ordem: 1, ativo: true },
  { chave: 'pensar', rotulo: 'Vou pensar', fala: 'Fala pensar.', pergunta: 'Pergunta pensar?', alternativa: 'Alt pensar.', ordem: 2, ativo: true },
  { chave: 'velha', rotulo: 'Desativada', fala: 'x', pergunta: '', alternativa: '', ordem: 3, ativo: false },
];
rodar(`
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cdEstado.debounceMs = 0;
  objEstado.timeoutMs = 80;
  await objCarregar();
  cdAbrir();
  const chips = [...document.querySelectorAll('#cdObjecoes [data-obj]')];
  eq(chips.map(c => c.dataset.obj), ['caro', 'pensar'], 'chips ativos na ordem');
  assert(chips[0].title.includes('Alt+1'), 'atalho no título');

  // sem contexto: resposta da biblioteca na hora, sem chamar a IA
  chips[0].click();
  const resp = document.getElementById('objResposta');
  assert(resp.textContent.includes('Fala caro.') && resp.textContent.includes('Pergunta caro?') && resp.textContent.includes('Alt caro.'), 'biblioteca na hora');
  eq(window.__invocacoes.length, 0, 'sem contexto não chama a IA');
  assert(cdEstado.nota.objecoes.includes('caro'), 'objeção entra na nota');
  // copiar e usei
  document.querySelector('#objResposta [data-obj-copiar]').click(); await espera(10);
  eq(window.__copiados[0], 'Fala caro. Pergunta caro?', 'copiar fala + pergunta');
  document.querySelector('#objResposta [data-obj-usei]').click(); await espera(10);
  const uso = window.__escritas.find(e => e.tabela === 'objecoes_uso');
  eq([uso.rows.objecao, uso.rows.fonte, uso.rows.nota_id], ['caro', 'biblioteca', cdEstado.nota.id], 'Usei registra');

  // com contexto: chama a IA em segundo plano, nunca com dado pessoal
  Object.assign(cdEstado.nota, { nome: 'Fulano Teste', cpf: '12345678909', telefone: '19990000001', qtd_linhas: '12', operadora_atual: 'Vivo', texto: 'ligar 19 99000-0001' });
  window.__invokeResposta = () => Promise.resolve({ data: { fala: 'Para 12 linhas na Vivo...', pergunta: 'Posso simular?' }, error: null });
  document.querySelector('#cdObjecoes [data-obj="caro"]').click();
  assert(document.getElementById('objResposta').textContent.includes('Fala caro.'), 'biblioteca aparece antes da IA');
  assert(document.getElementById('objIA').textContent.includes('Adaptando'), 'IA carregando');
  await espera(30);
  const inv = window.__invocacoes[0];
  eq(inv.nome, 'caderno-ia', 'chama caderno-ia');
  const corpo = JSON.stringify(inv.body);
  assert(!/Fulano|12345678909|19990000001|99000-0001/.test(corpo) && corpo.includes('[TELEFONE]') && inv.body.objecao_chave === 'caro', 'corpo sem dado pessoal');
  assert(document.getElementById('objIA').textContent.includes('Para este cliente') && document.getElementById('objIA').textContent.includes('Para 12 linhas na Vivo'), 'resposta da IA');
  // cache: mesmo clique não chama de novo
  document.querySelector('#cdObjecoes [data-obj="caro"]').click(); await espera(20);
  eq(window.__invocacoes.length, 1, 'cache de 10 min');
  // 👍
  document.querySelector('#objIA [data-obj-util="1"]').click(); await espera(10);
  const u2 = window.__escritas.filter(e => e.tabela === 'objecoes_uso').pop();
  eq([u2.rows.fonte, u2.rows.util], ['ia', true], 'útil registrado');

  // IA que nunca responde: depois do tempo, aviso — biblioteca continua
  window.__invokeResposta = () => new Promise(() => {});
  document.querySelector('#cdObjecoes [data-obj="pensar"]').click();
  await espera(150);
  assert(document.getElementById('objIA').textContent.includes('IA indisponível agora'), 'timeout vira aviso');
  assert(document.getElementById('objResposta').textContent.includes('Fala pensar.'), 'biblioteca segue na tela');
  // IA com erro (429)
  window.__invokeResposta = () => Promise.resolve({ data: null, error: { message: 'limite', context: { json: async () => ({ error: 'limite' }) } } });
  objEstado.cache.clear();
  document.querySelector('#cdObjecoes [data-obj="pensar"]').click(); await espera(30);
  assert(document.getElementById('objIA').textContent.includes('IA indisponível agora'), 'erro vira aviso');

  // "O cliente disse…"
  window.__invokeResposta = () => Promise.resolve({ data: { fala: 'Resposta livre.', pergunta: 'E aí?' }, error: null });
  const livre = document.getElementById('objLivre');
  livre.value = 'meu contador cuida disso';
  livre.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await espera(30);
  const invL = window.__invocacoes.pop();
  eq([invL.body.objecao_livre, invL.body.objecao_chave], ['meu contador cuida disso', undefined], 'pergunta livre');
  assert(document.getElementById('objIA').textContent.includes('Resposta livre.'), 'resposta livre na tela');

  // Alt+2 dispara o 2º chip
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '2', altKey: true }));
  assert(document.getElementById('objResposta').textContent.includes('Fala pensar.'), 'Alt+2');

  // treinar no Apex Mind usa o SSO
  window.__invokeResposta = (nome) => Promise.resolve(nome === 'sso-pratica-vendas' ? { data: { url: 'https://mind.teste/api/auth/sso?token=x' }, error: null } : { data: {}, error: null });
  document.querySelector('#objResposta [data-obj-treinar]').click(); await espera(20);
  assert(window.__abertos.includes('https://mind.teste/api/auth/sso?token=x'), 'abre o Apex Mind por SSO');

  // biblioteca que falha ao carregar: aviso no bloco, Caderno segue
  window.__tabelas.objecoes_respostas = null;
  const sbFrom = sb.from;
  sb.from = (t) => t === 'objecoes_respostas' ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }) } : sbFrom(t);
  await objCarregar();
  assert(document.getElementById('cdObjecoes').textContent.includes('Não foi possível carregar as objeções'), 'aviso de falha');
  sb.from = sbFrom;

  // ==== mais testes entram aqui ====
  fim();
`);
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_objecoes.js`
Expected: FAIL com `ReferenceError: objEstado is not defined`.

- [ ] **Step 3: Implementação** — no bloco §72, depois das funções de tela do Caderno:

```js
const objEstado = { lista: [], erro: false, cache: new Map(), aberta: null, timeoutMs: 6000, cacheMs: 600000, pedido: 0 };
async function objCarregar(){
  const r = await ppSeguro(() => sb.from('objecoes_respostas').select('chave,rotulo,fala,pergunta,alternativa,ordem,ativo').eq('ativo', true).order('ordem', { ascending: true }));
  objEstado.erro = !r || !!r.error;
  objEstado.lista = objEstado.erro ? [] : (r.data || []).filter(o => o.ativo !== false);
  objRenderChips();
}
function objRenderChips(){
  const box = cdEl('cdObjecoes');
  if(!box) return;
  if(objEstado.erro){ box.innerHTML = '<p class="ppVazio">Não foi possível carregar as objeções agora.</p>'; return; }
  const usadas = cdEstado.nota ? cdEstado.nota.objecoes : [];
  box.innerHTML = '<h4>Objeções</h4><div class="objChips">' + objEstado.lista.map((o, i) => `<button type="button" class="filterPill${usadas.includes(o.chave) ? ' active' : ''}" data-obj="${escapeHtml(o.chave)}" title="${i < 9 ? 'Alt+' + (i + 1) : ''}">${escapeHtml(o.rotulo)}</button>`).join('') + '</div>'
    + '<div class="field objLivreCampo"><input type="text" id="objLivre" maxlength="300" placeholder="O cliente disse… (Enter)"></div>'
    + '<div id="objResposta" class="objResposta"></div><div id="objIA" class="objIA"></div>';
  if(objEstado.aberta) objRenderBiblioteca(objEstado.aberta);
}
function objRenderBiblioteca(chave){
  const o = objEstado.lista.find(x => x.chave === chave);
  const el = cdEl('objResposta');
  if(!o || !el){ if(el) el.innerHTML = ''; return; }
  el.innerHTML = `<div class="objFala">${escapeHtml(o.fala)}</div>${o.pergunta ? `<div class="objPergunta">${escapeHtml(o.pergunta)}</div>` : ''}${o.alternativa ? `<div class="objAlt">Alternativa: ${escapeHtml(o.alternativa)}</div>` : ''}`
    + `<div class="objAcoes"><button type="button" class="btn btn-sm btn-outline" data-obj-copiar="${escapeHtml(chave)}" style="width:auto">Copiar</button><button type="button" class="btn btn-sm btn-ghost" data-obj-usei="${escapeHtml(chave)}" style="width:auto">Usei</button><button type="button" class="btn btn-sm btn-ghost" data-obj-treinar="1" style="width:auto">Treinar no Apex Mind</button></div>`;
}
function objCacheChave(chave, ctx){ return chave + '|' + JSON.stringify(ctx); }
function objMostrar(chave){
  if(!cdEstado.nota) return;
  objEstado.aberta = chave;
  if(!cdEstado.nota.objecoes.includes(chave)){ cdEstado.nota.objecoes.push(chave); cdAgendarSalvar(); }
  cdEstado.doc.querySelectorAll('#cdObjecoes [data-obj]').forEach(b => b.classList.toggle('active', cdEstado.nota.objecoes.includes(b.dataset.obj)));
  objRenderBiblioteca(chave);
  if(!cdTemContexto(cdEstado.nota)){ cdEl('objIA').innerHTML = ''; return; }
  objBuscarIA({ objecao_chave: chave, contexto: cdContextoIA(cdEstado.nota) }, chave);
}
function objClicarPorIndice(i){ const o = objEstado.lista[i]; if(o) objMostrar(o.chave); }
async function objPedirIA(body){
  let timer;
  const tempo = new Promise(res => { timer = setTimeout(() => res({ timeout: true }), objEstado.timeoutMs); });
  try{
    const r = await Promise.race([ppSeguro(() => sb.functions.invoke('caderno-ia', { body })), tempo]);
    if(!r || r.timeout || r.error || !r.data || !r.data.fala) return null;
    return { fala: String(r.data.fala), pergunta: String(r.data.pergunta || '') };
  } finally { clearTimeout(timer); }
}
async function objBuscarIA(body, rotuloUso){
  const ia = cdEl('objIA');
  const ck = objCacheChave(body.objecao_chave || ('livre:' + body.objecao_livre), body.contexto);
  const emCache = objEstado.cache.get(ck);
  if(emCache && agAgora() - emCache.em < objEstado.cacheMs){ objRenderIA(emCache.r, rotuloUso); return; }
  const pedido = ++objEstado.pedido;
  ia.innerHTML = '<p class="objCarregando">Adaptando para este cliente…</p>';
  const r = await objPedirIA(body);
  if(pedido !== objEstado.pedido) return; // outro clique mais novo
  if(!r){ cdEl('objIA').innerHTML = '<p class="ppVazio">IA indisponível agora: use a resposta acima.</p>'; return; }
  objEstado.cache.set(ck, { r, em: agAgora() });
  objRenderIA(r, rotuloUso);
}
function objRenderIA(r, rotuloUso){
  cdEl('objIA').innerHTML = `<div class="objIATitulo">Para este cliente</div><div class="objFala">${escapeHtml(r.fala)}</div>${r.pergunta ? `<div class="objPergunta">${escapeHtml(r.pergunta)}</div>` : ''}`
    + `<div class="objAcoes"><button type="button" class="btn btn-sm btn-outline" data-obj-copiar-ia="1" style="width:auto">Copiar</button><button type="button" class="btn btn-sm btn-ghost" data-obj-util="1" data-obj-rotulo="${escapeHtml(rotuloUso)}" style="width:auto" aria-label="Ajudou">👍</button><button type="button" class="btn btn-sm btn-ghost" data-obj-util="0" data-obj-rotulo="${escapeHtml(rotuloUso)}" style="width:auto" aria-label="Não ajudou">👎</button></div>`;
  objEstado.ultimaIA = r;
}
function objPerguntarLivre(texto){
  const t = String(texto || '').trim();
  if(!t || !cdEstado.nota) return;
  objEstado.aberta = null;
  cdEl('objResposta').innerHTML = '';
  objBuscarIA({ objecao_livre: t, contexto: cdContextoIA(cdEstado.nota) }, 'livre');
}
async function objRegistrarUso(objecao, fonte, util){
  const r = await ppSeguro(() => sb.from('objecoes_uso').insert({ objecao, fonte, util: util === undefined ? null : util, nota_id: cdEstado.nota ? cdEstado.nota.id : null }));
  if(r && r.error) console.error('objecoes_uso: falha ao registrar');
  else mostrarAviso(fonte === 'ia' ? 'Obrigado pelo retorno.' : 'Registrado.', 'ok');
}
async function objAbrirApexMind(){
  const { data, error } = await sb.functions.invoke('sso-pratica-vendas');
  if(error || !data || !data.url){ mostrarAviso(await mensagemErroFuncao(error, data), 'erro'); return; }
  window.open(data.url, '_blank');
}
function objLigarEventos(gaveta){
  gaveta.addEventListener('click', (ev) => {
    const t = ev.target;
    const chip = t.closest('[data-obj]');
    if(chip){ objMostrar(chip.dataset.obj); return; }
    const cp = t.closest('[data-obj-copiar]');
    if(cp){ const o = objEstado.lista.find(x => x.chave === cp.dataset.objCopiar); if(o && navigator.clipboard) navigator.clipboard.writeText((o.fala + ' ' + (o.pergunta || '')).trim()); mostrarAviso('Copiado.', 'ok'); return; }
    if(t.closest('[data-obj-copiar-ia]') && objEstado.ultimaIA){ if(navigator.clipboard) navigator.clipboard.writeText((objEstado.ultimaIA.fala + ' ' + objEstado.ultimaIA.pergunta).trim()); mostrarAviso('Copiado.', 'ok'); return; }
    const us = t.closest('[data-obj-usei]');
    if(us){ objRegistrarUso(us.dataset.objUsei, 'biblioteca'); return; }
    const ut = t.closest('[data-obj-util]');
    if(ut){ objRegistrarUso(ut.dataset.objRotulo, 'ia', ut.dataset.objUtil === '1'); return; }
    if(t.closest('[data-obj-treinar]')) objAbrirApexMind();
  });
  gaveta.addEventListener('keydown', (ev) => {
    if(ev.target && ev.target.id === 'objLivre' && ev.key === 'Enter'){ ev.preventDefault(); objPerguntarLivre(ev.target.value); }
  });
}
objLigarEventos(document.getElementById('cdGaveta'));
```

CSS, adicionar ao `#cadernoStyles`:

```css
  .cdObjecoes h4{margin:var(--space-3) 0 var(--space-2);font-size:var(--fs-sm);}
  .objChips{display:flex;gap:var(--space-2);flex-wrap:wrap;}
  .objLivreCampo{margin:var(--space-2) 0;}
  .objResposta:not(:empty),.objIA:not(:empty){border-left:3px solid var(--c-sinal);background:var(--c-papel);padding:var(--space-3);margin:var(--space-2) 0;}
  .objIA:not(:empty){border-left-color:var(--c-bordo);}
  .objFala{font-size:var(--fs-md);font-weight:600;line-height:1.4;}
  .objPergunta{margin-top:var(--space-2);}
  .objAlt{margin-top:var(--space-2);font-size:var(--fs-sm);color:var(--muted);}
  .objIATitulo{font-size:var(--fs-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--c-bordo);margin-bottom:var(--space-1);}
  .objAcoes{display:flex;gap:4px;flex-wrap:wrap;margin-top:var(--space-2);}
  .objCarregando{font-size:var(--fs-sm);color:var(--muted);margin:0;}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_objecoes.js && node test_caderno.js`
Expected: os dois com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_objecoes.js
git commit -m "feat(objecoes): resposta em 1 clique + versao da IA para o cliente (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 9: Editor da biblioteca de objeções (admin/supervisor)

**Files:**
- Modify: `_template.html` (overlay `#objEditorOverlay` depois do `#agDiaOverlay`; funções que substituem o esboço `objAplicarPermissaoEditor`)
- Test: `test_objecoes.js`

**Interfaces — Produces:** `objAplicarPermissaoEditor()`, `objAbrirEditor()`, `objSalvarLinha(chave) → Promise<boolean>`, `objNovaChave(rotulo, existentes) → string`.

- [ ] **Step 1: Teste (falha)** — em `test_objecoes.js`, trocar `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 9: editor (admin/supervisor) ====
  window.__tabelas.objecoes_respostas = [{ chave: 'caro', rotulo: 'Tá caro', fala: 'Fala caro.', pergunta: 'P?', alternativa: 'A.', ordem: 1, ativo: true }];
  eq(objNovaChave('Já tenho fidelidade!', ['caro']), 'ja_tenho_fidelidade', 'chave a partir do rótulo');
  eq(objNovaChave('Tá caro', ['ta_caro']), 'ta_caro_2', 'chave sem colidir');
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  objAplicarPermissaoEditor();
  assert(document.getElementById('agEditarObj').style.display === 'none', 'consultor não vê o editor');
  currentUser = { id: 's1', nome: 'Supervisor Teste', username: 'sup', role: 'supervisor' };
  objAplicarPermissaoEditor();
  assert(document.getElementById('agEditarObj').style.display !== 'none', 'supervisor vê o editor');
  document.getElementById('agEditarObj').click(); await espera(30);
  assert(document.getElementById('objEditorOverlay').classList.contains('active'), 'abre o editor');
  const linha = document.querySelector('#objEditorLista [data-obj-ed="caro"]');
  linha.querySelector('[data-campo="fala"]').value = 'Fala nova.';
  linha.querySelector('[data-obj-salvar]').click(); await espera(30);
  const up = window.__escritas.filter(e => e.tabela === 'objecoes_respostas' && e.op === 'upsert').pop();
  eq([up.rows.chave, up.rows.fala, up.opts.onConflict], ['caro', 'Fala nova.', 'chave'], 'salva a linha');
  document.getElementById('objEdNovaRotulo').value = 'Já tenho fidelidade';
  document.getElementById('objEdNova').click(); await espera(30);
  const nova = window.__escritas.filter(e => e.tabela === 'objecoes_respostas' && e.op === 'upsert').pop();
  eq([nova.rows.chave, nova.rows.rotulo, nova.rows.ativo, nova.rows.ordem], ['ja_tenho_fidelidade', 'Já tenho fidelidade', true, 2], 'nova objeção no fim');
  // fala vazia não salva
  const l2 = document.querySelector('#objEditorLista [data-obj-ed="caro"]');
  l2.querySelector('[data-campo="fala"]').value = '  ';
  const n0 = window.__escritas.length;
  l2.querySelector('[data-obj-salvar]').click(); await espera(20);
  eq(window.__escritas.length, n0, 'fala vazia não grava');

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_objecoes.js`
Expected: FAIL com `objNovaChave is not defined`.

- [ ] **Step 3: HTML** — depois do `#agDiaOverlay`:

```html
<!-- Editor da biblioteca de objeções (seção 72) — só admin/supervisor -->
<div class="overlay" id="objEditorOverlay">
  <div class="modal" style="max-width:760px">
    <div class="mHead">
      <button class="mClose" id="objEditorFechar" type="button">&times;</button>
      <h2>Respostas de objeção</h2>
      <div class="mCnpj">O que o consultor vê ao clicar no chip. Sem preço em R$ (preço muda); fale de franquia.</div>
    </div>
    <div class="mBody">
      <div id="objEditorLista"></div>
      <div class="agFLinha"><div class="field"><label>Nova objeção (rótulo do chip)</label><input type="text" id="objEdNovaRotulo" maxlength="60"></div></div>
      <button type="button" class="btn btn-sm btn-outline" id="objEdNova" style="width:auto">Adicionar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: JS** — **substituir** o esboço `function objAplicarPermissaoEditor(){ /* Task 9 */ }` por:

```js
function objPodeEditar(){ return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'supervisor'); }
function objAplicarPermissaoEditor(){ document.getElementById('agEditarObj').style.display = objPodeEditar() ? 'inline-block' : 'none'; }
function objNovaChave(rotulo, existentes){
  const base = String(rotulo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 36) || 'objecao';
  let c = base, i = 2;
  while(existentes.includes(c)) c = base + '_' + (i++);
  return c;
}
let objEditorLinhas = [];
async function objAbrirEditor(){
  if(!objPodeEditar()) return;
  const r = await ppSeguro(() => sb.from('objecoes_respostas').select('chave,rotulo,fala,pergunta,alternativa,ordem,ativo').order('ordem', { ascending: true }));
  if(r && r.error){ mostrarAviso('Não foi possível carregar as objeções.', 'erro'); return; }
  objEditorLinhas = (r && r.data) || [];
  objRenderEditor();
  document.getElementById('objEditorOverlay').classList.add('active');
}
function objRenderEditor(){
  const campo = (o, c, rot, area) => `<div class="field"><label>${rot}</label>${area ? `<textarea rows="2" data-campo="${c}">${escapeHtml(o[c] || '')}</textarea>` : `<input type="text" data-campo="${c}" value="${escapeHtml(o[c] == null ? '' : String(o[c]))}">`}</div>`;
  document.getElementById('objEditorLista').innerHTML = objEditorLinhas.map(o => `<div class="card objEdLinha" data-obj-ed="${escapeHtml(o.chave)}">
      <div class="agFLinha">${campo(o, 'rotulo', 'Rótulo')}${campo(o, 'ordem', 'Ordem')}<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-campo="ativo"${o.ativo ? ' checked' : ''}> Ativa</label></div>
      ${campo(o, 'fala', 'Fala (o que dizer)', true)}${campo(o, 'pergunta', 'Pergunta de contorno', true)}${campo(o, 'alternativa', 'Alternativa de oferta', true)}
      <button type="button" class="btn btn-sm" data-obj-salvar="${escapeHtml(o.chave)}" style="width:auto">Salvar</button></div>`).join('');
}
async function objSalvarLinha(chave){
  const box = document.querySelector(`#objEditorLista [data-obj-ed="${chave}"]`);
  const v = c => box.querySelector(`[data-campo="${c}"]`);
  const linha = { chave, rotulo: v('rotulo').value.trim(), fala: v('fala').value.trim(), pergunta: v('pergunta').value.trim(), alternativa: v('alternativa').value.trim(),
    ordem: Math.round(cdNum(v('ordem').value) || 100), ativo: v('ativo').checked, atualizado_em: new Date().toISOString() };
  if(!linha.rotulo || !linha.fala){ mostrarAviso('Rótulo e fala são obrigatórios.', 'erro'); return false; }
  const r = await ppSeguro(() => sb.from('objecoes_respostas').upsert(linha, { onConflict: 'chave' }));
  if(r && r.error){ mostrarAviso('Não foi possível salvar: ' + r.error.message, 'erro'); return false; }
  mostrarAviso('Objeção salva.', 'ok');
  objCarregar();
  return true;
}
document.getElementById('agEditarObj').addEventListener('click', objAbrirEditor);
document.getElementById('objEditorFechar').addEventListener('click', () => fecharOverlay(document.getElementById('objEditorOverlay')));
document.getElementById('objEditorLista').addEventListener('click', (ev) => { const b = ev.target.closest('[data-obj-salvar]'); if(b) objSalvarLinha(b.dataset.objSalvar); });
document.getElementById('objEdNova').addEventListener('click', async () => {
  const rot = document.getElementById('objEdNovaRotulo').value.trim();
  if(!rot){ mostrarAviso('Escreva o rótulo da objeção.', 'erro'); return; }
  const chave = objNovaChave(rot, objEditorLinhas.map(o => o.chave));
  const ordem = objEditorLinhas.reduce((m, o) => Math.max(m, o.ordem || 0), 0) + 1;
  const linha = { chave, rotulo: rot, fala: 'Escreva aqui a resposta.', pergunta: '', alternativa: '', ordem, ativo: true, atualizado_em: new Date().toISOString() };
  const r = await ppSeguro(() => sb.from('objecoes_respostas').upsert(linha, { onConflict: 'chave' }));
  if(r && r.error){ mostrarAviso('Não foi possível criar: ' + r.error.message, 'erro'); return; }
  document.getElementById('objEdNovaRotulo').value = '';
  objEditorLinhas.push(linha); objRenderEditor();
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node test_objecoes.js`
Expected: `0 falharam`.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_objecoes.js
git commit -m "feat(objecoes): editor da biblioteca para admin e supervisor (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: Alertas — 5 min antes, sem repetir entre abas, contador no título e resumo ao entrar

**Files:**
- Modify: `_template.html` (funções `al*`, que substituem o esboço `alAtualizarAvisoPermissao`)
- Test: `test_agenda.js`

**Interfaces:**
- **Consumes:** `agPartesSP`, `agSituacao`, `cdAbrirDoRetorno`, o evento `agenda:mudou`.
- **Produces:**
  - `alEstado = { proximos, timer, recarga, canal, alertados: Set, tituloBase }`
  - `alDevemAlertar(retornos, agora, jaAlertados) → [retorno]` (pura)
  - `alIniciar()`, `alParar()`, `alVerificar()`, `alCarregarProximos()`
  - `alAtualizarAvisoPermissao()`, `alPedirPermissao()`

- [ ] **Step 1: Teste (falha)** — em `test_agenda.js`, trocar `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 10: alertas ====
  const A0 = sp('2026-10-06T13:56:00');
  const prox = [
    { id: 'a1', status: 'pendente', quando: '2026-10-06T14:00:00-03:00', nome: 'Alerta Teste', telefone: '19990000001' },
    { id: 'a2', status: 'pendente', quando: '2026-10-06T14:10:00-03:00', nome: 'Depois Teste' },
    { id: 'a3', status: 'feito', quando: '2026-10-06T13:58:00-03:00', nome: 'Feito Teste' },
    { id: 'a4', status: 'pendente', quando: '2026-10-06T11:00:00-03:00', nome: 'Velho Teste' },
  ];
  eq(alDevemAlertar(prox, A0, new Set()).map(r => r.id), ['a1'], 'só o que vence em até 5 min (não feito, não velho de 1h+)');
  eq(alDevemAlertar(prox, A0, new Set(['a1'])).length, 0, 'já alertado não repete');
  Date.now = () => A0;
  window.__tabelas.agenda_retornos = prox.map(r => Object.assign({ consultor_id: 'c1' }, r));
  try{ localStorage.removeItem('agenda_alertados_c1'); }catch(_e){}
  document.title = 'Painel Apex';
  await alCarregarProximos();
  alVerificar();
  eq(window.__notificacoes.length, 1, 'uma notificação');
  assert(window.__notificacoes[0].titulo.includes('14:00') && window.__notificacoes[0].titulo.includes('Alerta Teste'), 'texto da notificação');
  assert(document.title.startsWith('(2) '), 'contador no título (a1 em 4 min + a4 atrasado)');
  alVerificar();
  eq(window.__notificacoes.length, 1, 'não repete na mesma aba');
  // outra aba já alertou a2 (mensagem do BroadcastChannel)
  alReceber({ data: { alertado: 'a2' } });
  Date.now = () => sp('2026-10-06T14:06:00');
  alVerificar();
  eq(window.__notificacoes.length, 1, 'a2 alertado em outra aba: não toca aqui');
  // clicar na notificação abre o Caderno
  let aberto = null;
  const cdAbrirOriginal = cdAbrirDoRetorno;
  cdAbrirDoRetorno = (r) => { aberto = r.id; };
  alAoClicar(prox[0]);
  eq(aberto, 'a1', 'clique abre o Caderno do cliente');
  cdAbrirDoRetorno = cdAbrirOriginal;
  // resumo ao entrar
  Date.now = () => sp('2026-10-06T08:00:00');
  window.__tabelas.agenda_retornos = [{ id: 'h1', consultor_id: 'c1', status: 'pendente', quando: '2026-10-06T09:00:00-03:00', nome: 'H Teste' }, { id: 'h2', consultor_id: 'c1', status: 'pendente', quando: '2026-10-05T16:00:00-03:00', nome: 'Atr Teste' }];
  await alResumoAoEntrar();
  assert(avisos().includes('Hoje: 1 retorno · 1 atrasado'), 'resumo ao entrar');
  // permissão: aviso aparece quando ainda não foi dada
  window.Notification.permission = 'default';
  alAtualizarAvisoPermissao();
  assert(document.getElementById('agAlertasAviso').style.display !== 'none', 'pede para ativar alertas');
  window.Notification.permission = 'granted';
  alAtualizarAvisoPermissao();
  assert(document.getElementById('agAlertasAviso').style.display === 'none', 'some depois de ativar');
  alParar();
  Date.now = nowReal;

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_agenda.js`
Expected: FAIL com `alDevemAlertar is not defined`.

- [ ] **Step 3: Implementação** — **substituir** o esboço `function alAtualizarAvisoPermissao(){ /* Task 10 */ }` por:

```js
const alEstado = { proximos: [], timer: null, recarga: null, canal: null, alertados: new Set(), tituloBase: '' };
const AL_ANTES_MS = 5 * 60000, AL_VALIDADE_MS = 60 * 60000;
function alChave(){ return 'agenda_alertados_' + agUid(); }
function alCarregarAlertados(){ try{ alEstado.alertados = new Set(JSON.parse(localStorage.getItem(alChave()) || '[]')); }catch(_e){ alEstado.alertados = new Set(); } }
function alGuardarAlertados(){ try{ localStorage.setItem(alChave(), JSON.stringify([...alEstado.alertados].slice(-300))); }catch(_e){ /* sem localStorage: vale só a memória */ } }
// Pendentes que vencem em até 5 min (ou venceram há menos de 1 h) e ainda não alertaram.
function alDevemAlertar(retornos, agora, ja){
  return (retornos || []).filter(r => {
    if(r.status !== 'pendente' || ja.has(r.id)) return false;
    const t = new Date(r.quando).getTime();
    return t - AL_ANTES_MS <= agora && agora < t + AL_VALIDADE_MS;
  });
}
async function alCarregarProximos(){
  if(!currentUser) return;
  const hoje = agPartesSP(agAgora()).dia;
  const r = await ppSeguro(() => sb.from('agenda_retornos').select('id,nota_id,nome,telefone,quando,status')
    .gte('quando', agIsoSP(somaDiasStr(hoje, -1), '00:00')).lte('quando', agIsoSP(somaDiasStr(hoje, 1), '23:59')).neq('status', 'cancelado').order('quando', { ascending: true }));
  if(r && !r.error) alEstado.proximos = r.data || [];
}
function alBip(){
  try{
    const C = window.AudioContext || window.webkitAudioContext;
    if(!C) return;
    const ctx = new C(), o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  }catch(_e){ /* sem áudio: segue com a notificação */ }
}
function alAoClicar(r){
  try{ window.focus(); }catch(_e){ /* ok */ }
  cdAbrirDoRetorno(r);
}
function alNotificar(r){
  const p = agPartesSP(r.quando);
  const titulo = 'Retorno às ' + p.hora + ' — ' + r.nome;
  if('Notification' in window && Notification.permission === 'granted'){
    try{ const n = new Notification(titulo, { body: (r.telefone ? r.telefone + ' · ' : '') + 'Clique para abrir o Caderno', tag: 'retorno-' + r.id }); n.onclick = () => alAoClicar(r); }catch(_e){ /* alguns navegadores só aceitam via service worker */ }
  }
  mostrarAviso(titulo, 'info');
  alBip();
}
function alAtualizarTitulo(agora){
  if(!alEstado.tituloBase) alEstado.tituloBase = document.title.replace(/^\(\d+\)\s*/, '');
  const n = alEstado.proximos.filter(r => r.status === 'pendente' && new Date(r.quando).getTime() - AL_ANTES_MS <= agora).length;
  document.title = (n ? '(' + n + ') ' : '') + alEstado.tituloBase;
}
function alVerificar(){
  if(!currentUser) return;
  const agora = agAgora();
  alDevemAlertar(alEstado.proximos, agora, alEstado.alertados).forEach(r => {
    alEstado.alertados.add(r.id);
    alGuardarAlertados();
    if(alEstado.canal) try{ alEstado.canal.postMessage({ alertado: r.id }); }catch(_e){ /* ok */ }
    alNotificar(r);
  });
  alAtualizarTitulo(agora);
}
function alReceber(ev){ if(ev && ev.data && ev.data.alertado){ alEstado.alertados.add(ev.data.alertado); alGuardarAlertados(); } }
async function alResumoAoEntrar(){
  await alCarregarProximos();
  const agora = agAgora(), hoje = agPartesSP(agora).dia;
  const pend = alEstado.proximos.filter(r => r.status === 'pendente');
  const nHoje = pend.filter(r => agPartesSP(r.quando).dia === hoje).length;
  const nAtr = pend.filter(r => new Date(r.quando).getTime() < agora).length;
  if(nHoje || nAtr) mostrarAviso('Hoje: ' + nHoje + ' retorno' + (nHoje === 1 ? '' : 's') + (nAtr ? ' · ' + nAtr + ' atrasado' + (nAtr === 1 ? '' : 's') : ''), nAtr ? 'erro' : 'info');
}
function alAtualizarAvisoPermissao(){
  const precisa = 'Notification' in window && Notification.permission === 'default';
  document.getElementById('agAlertasAviso').style.display = precisa ? 'flex' : 'none';
}
async function alPedirPermissao(){
  if(!('Notification' in window)) return;
  try{ await Notification.requestPermission(); }catch(_e){ /* ok */ }
  alAtualizarAvisoPermissao();
}
function alIniciar(){
  alParar();
  alCarregarAlertados();
  try{ if('BroadcastChannel' in window){ alEstado.canal = new BroadcastChannel('apex-agenda'); alEstado.canal.onmessage = alReceber; } }catch(_e){ alEstado.canal = null; }
  alResumoAoEntrar().then(alVerificar);
  alEstado.timer = setInterval(alVerificar, 30000);
  alEstado.recarga = setInterval(() => { alCarregarProximos().then(alVerificar); }, 300000);
}
function alParar(){
  clearInterval(alEstado.timer); clearInterval(alEstado.recarga);
  if(alEstado.canal) try{ alEstado.canal.close(); }catch(_e){ /* ok */ }
  alEstado.canal = null; alEstado.proximos = [];
  if(alEstado.tituloBase) document.title = alEstado.tituloBase;
}
document.addEventListener('agenda:mudou', () => { if(currentUser) alCarregarProximos().then(alVerificar); });
document.getElementById('agAtivarAlertas').addEventListener('click', alPedirPermissao);
```

Atenção: em `test_agenda.js`, a variável `cdAbrirDoRetorno` é reatribuída no teste. Por isso ela precisa ser declarada com `function` (já é). A chamada dentro de `alAoClicar` usa o nome global e pega a versão nova.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_agenda.js && node test_caderno.js && node test_objecoes.js`
Expected: os três com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_agenda.js
git commit -m "feat(agenda): alertas 5 min antes, sem repetir entre abas, resumo ao entrar (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: Janela flutuante do Caderno (Picture-in-Picture do Chrome, com janela comum como reserva)

**Files:**
- Modify: `_template.html` (função `cdDestacar`)
- Test: `test_caderno.js`

**Interfaces:**
- **Consumes:** `cdLigarEventos`, `objLigarEventos`, `cdTeclas`, `cdEstado.doc`.
- **Produces:** `cdDestacar() → Promise<boolean>`, `cdRecolher()`.

- [ ] **Step 1: Teste (falha)** — em `test_caderno.js`, trocar `// ==== mais testes entram aqui ====` por:

```js
  // ==== TASK 11: janela flutuante ====
  currentUser = { id: 'c1', nome: 'Consultor Teste', username: 'cons', role: 'consultor' };
  cadernoAoEntrar(); cdAbrir();
  const pip = new window.__JSDOM('<!doctype html><html><head></head><body></body></html>').window;
  window.documentPictureInPicture = { requestWindow: async (o) => { window.__pipOpts = o; return pip; } };
  await cdDestacar();
  eq(window.__pipOpts, { width: 420, height: 720 }, 'tamanho da janela');
  assert(pip.document.getElementById('cdGaveta') && pip.document.getElementById('cdGaveta').classList.contains('flutuante'), 'gaveta foi para a janela flutuante');
  assert(!document.getElementById('cdGaveta'), 'saiu da página principal');
  assert(pip.document.head.querySelectorAll('style').length >= 1, 'estilos copiados');
  // digitar na janela flutuante continua salvando
  const tel = pip.document.getElementById('cdF_telefone');
  tel.value = '19990000009'; tel.dispatchEvent(new pip.Event('input', { bubbles: true }));
  await espera(30);
  assert(window.__escritas.some(e => e.tabela === 'caderno_notas' && e.rows.telefone === '19990000009'), 'salva a partir da janela flutuante');
  // Alt+N na janela flutuante funciona
  pip.document.dispatchEvent(new pip.KeyboardEvent('keydown', { key: 'N', altKey: true, shiftKey: true }));
  await espera(30);
  eq(pip.document.getElementById('cdF_telefone').value, '', 'Alt+Shift+N na flutuante');
  // fechar a janela devolve a gaveta
  pip.dispatchEvent(new pip.Event('pagehide'));
  assert(document.getElementById('cdGaveta') && !document.getElementById('cdGaveta').classList.contains('flutuante'), 'volta para a página');
  // sem PiP: usa janela comum
  delete window.documentPictureInPicture;
  const pop = new window.__JSDOM('<!doctype html><html><head></head><body></body></html>').window;
  window.open = (u, nome, feat) => { window.__popup = { u, nome, feat }; return pop; };
  await cdDestacar();
  eq([window.__popup.nome, window.__popup.feat], ['cadernoApex', 'width=420,height=720'], 'reserva com window.open');
  assert(pop.document.getElementById('cdGaveta'), 'gaveta na janela comum');
  pop.dispatchEvent(new pop.Event('pagehide'));
  // janela bloqueada: avisa e não perde a gaveta
  window.open = () => null;
  const ok = await cdDestacar();
  assert(!ok && document.getElementById('cdGaveta') && avisos().includes('janela flutuante'), 'popup bloqueado: aviso');

  // ==== mais testes entram aqui ====
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_caderno.js`
Expected: FAIL. O botão `cdDestacar` não faz nada, porque `typeof cdDestacar` é `undefined`, e a chamada direta lança `ReferenceError`.

- [ ] **Step 3: Implementação** — no bloco §72, depois das funções `al*`:

```js
// Janela flutuante (seção 72): a gaveta muda de documento — os listeners ficam no próprio elemento (cdLigarEventos /
// objLigarEventos), então continuam valendo; cdEl() procura primeiro no documento onde a gaveta está.
async function cdDestacar(){
  if(cdEstado.doc !== document) return true;
  let win = null;
  try{
    if(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function') win = await window.documentPictureInPicture.requestWindow({ width: 420, height: 720 });
    else win = window.open('', 'cadernoApex', 'width=420,height=720');
  }catch(_e){ win = null; }
  if(!win || !win.document){ mostrarAviso('O navegador bloqueou a janela flutuante. Permita pop-ups para o painel e tente de novo.', 'erro'); return false; }
  const d = win.document;
  d.title = 'Caderno — Apex';
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(s => d.head.appendChild(s.cloneNode(true)));
  const gaveta = document.getElementById('cdGaveta');
  gaveta.classList.add('flutuante', 'aberta');
  d.body.appendChild(d.adoptNode(gaveta));
  cdEstado.doc = d;
  d.addEventListener('keydown', cdTeclas);
  win.addEventListener('pagehide', cdRecolher, { once: true });
  cdEstado.janela = win;
  return true;
}
function cdRecolher(){
  if(cdEstado.doc === document) return;
  const gaveta = cdEstado.doc.getElementById('cdGaveta');
  cdEstado.doc = document;
  cdEstado.janela = null;
  if(gaveta){
    gaveta.classList.remove('flutuante');
    document.getElementById('app').appendChild(document.adoptNode(gaveta));
    gaveta.classList.toggle('aberta', cdEstado.aberto);
  }
}
```

Também é preciso trocar, nas funções `cdAbrir`, `cdFechar`, `cdPreencherTela`, `cdValidarDocs` e `objMostrar`, os acessos `document.getElementById('cdGaveta')` / `cdEl(...)`. A Task 7 já usa `cdEl()` e `cdEstado.doc.querySelectorAll`. Confira que não sobrou nenhum `document.getElementById('cdF_` nem `document.querySelectorAll('#cd`:

Run: `grep -n "document.getElementById('cdF_\|document.querySelectorAll('#cd\|document.getElementById('obj[A-Z]" _template.html`
Expected: nenhuma linha dentro das funções `cd*` e `obj*`. Os listeners de inicialização da Task 7, que rodam uma vez com a gaveta ainda na página, podem ficar.

- [ ] **Step 4: Rodar e ver passar**

Run: `node test_caderno.js && node test_objecoes.js`
Expected: os dois com `0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_caderno.js
git commit -m "feat(caderno): janela flutuante sobre o ProContact (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 12: Mesa do Supervisor — bloco "Retornos e objeções"

**Files:**
- Modify: `_template.html` (card novo no fim do `#panel-mesa`; `mesaCarregarRetObj(hoje)` chamada no fim de `loadMesa`; limpeza em `mesaResetar`)
- Test: `test_mesa_supervisor.js` (acrescentar no fim, antes de `// ==== mais testes entram aqui ====`)

**Interfaces:**
- **Consumes:** RPC `mesa_retornos_objecoes(p_ref)` (Task 1), `mesaEstado`, `canSeeMesa`.
- **Produces:** `mesaCarregarRetObj(hoje)`, `mesaRetObjHtml(dados) → {tabela, top}` (pura).

- [ ] **Step 1: Teste (falha)** — em `test_mesa_supervisor.js`, antes de `// ==== mais testes entram aqui ====`:

```js
  // ==== §72: Retornos e objeções ====
  const ro = { consultores: [{ profile_id: 'p-caio', nome: 'Caio Teste', hoje: 3, atrasados: 2, feitos7: 4, total7: 5 }, { profile_id: 'p-zeca', nome: 'Zeca Teste', hoje: 0, atrasados: 0, feitos7: 0, total7: 0 }],
               objecoes: [{ objecao: 'caro', usos: 7, uteis: 5 }, { objecao: 'livre', usos: 2, uteis: 0 }] };
  const h = mesaRetObjHtml(ro);
  assert(h.tabela.includes('Caio Teste') && h.tabela.includes('80,0%') && h.tabela.includes('retornoBadge atrasado'), 'tabela: % no dia e atrasados em destaque');
  assert(h.tabela.includes('—'), 'sem retornos na semana: traço');
  assert(h.top.includes('caro') && h.top.includes('7') && h.top.includes('5 útil') && h.top.includes('Pergunta livre'), 'top objeções');
  Date.now = () => AGORA;
  window.__rpcRespostas.mesa_retornos_objecoes = { data: ro, error: null };
  await loadMesa(true); await espera(40);
  eq((window.__rpcCalls.find(c => c.nome === 'mesa_retornos_objecoes') || {}).args, { p_ref: HOJE }, 'RPC com a data de hoje');
  assert(document.getElementById('mesaRetObj').textContent.includes('Caio Teste'), 'bloco renderizado');
  window.__rpcRespostas.mesa_retornos_objecoes = { data: null, error: { message: 'x' } };
  await loadMesa(true); await espera(40);
  assert(document.getElementById('mesaRetObj').textContent.includes('Não foi possível carregar'), 'falha isolada');
  assert(document.querySelectorAll('#mesaFila .vlRow').length === 3, 'resto da Mesa continua');
  Date.now = nowReal;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node test_mesa_supervisor.js`
Expected: FAIL com `mesaRetObjHtml is not defined`.

- [ ] **Step 3: HTML** — último card dentro do `#panel-mesa`, antes do `</section>`:

```html
      <div class="card">
        <h3>Retornos e objeções</h3>
        <p class="desc">Retornos da Agenda por consultor (seção 72) e as objeções que mais apareceram nos últimos 7 dias.</p>
        <div id="mesaRetObj"></div>
      </div>
```

- [ ] **Step 4: JS** — depois de `mesaRender` (perto da linha 10932):

```js
// §72: bloco "Retornos e objeções" (RPC mesa_retornos_objecoes). Falha isolada: não derruba o resto da Mesa.
function mesaRetObjHtml(d){
  const cons = (d && d.consultores) || [], obj = (d && d.objecoes) || [];
  const pct = c => (c.total7 ? fmtPctConversao(c.feitos7 / c.total7) : '—');
  const tabela = `<div class="mlTabelaWrap"><table class="tbl"><thead><tr><th>Consultor</th><th>Hoje</th><th>Atrasados</th><th>Feitos no dia (7 d)</th></tr></thead><tbody>`
    + cons.map(c => `<tr><td>${escapeHtml(c.nome)}</td><td>${c.hoje}</td><td>${c.atrasados ? `<span class="retornoBadge atrasado">${c.atrasados}</span>` : '0'}</td><td>${pct(c)}</td></tr>`).join('')
    + '</tbody></table></div>';
  const nome = o => (o === 'livre' ? 'Pergunta livre' : o);
  const top = obj.length ? '<h4>Top objeções (7 dias)</h4><ul>' + obj.map(o => `<li><b>${escapeHtml(nome(o.objecao))}</b>: ${o.usos} vez(es) · ${o.uteis} útil(eis)</li>`).join('') + '</ul>' : '<p class="ppVazio">Nenhuma objeção registrada nos últimos 7 dias.</p>';
  return { tabela, top };
}
async function mesaCarregarRetObj(hoje){
  const el = document.getElementById('mesaRetObj');
  const r = await ppSeguro(() => sb.rpc('mesa_retornos_objecoes', { p_ref: hoje }));
  if(!canSeeMesa()) return;
  if(!r || r.error){ el.innerHTML = '<p class="ppVazio">Não foi possível carregar os retornos agora.</p>'; return; }
  const h = mesaRetObjHtml(r.data);
  el.innerHTML = h.tabela + h.top;
}
```

No fim de `loadMesa`, logo depois de `mesaRender();`:

```js
  mesaCarregarRetObj(hoje); // §72 — não bloqueia o resto
```

Em `mesaResetar()`, acrescente `document.getElementById('mesaRetObj').innerHTML = '';`.

- [ ] **Step 5: Rodar e ver passar**

Run: `node test_mesa_supervisor.js`
Expected: `0 falharam`.

- [ ] **Step 6: Commit**

```bash
git add _template.html test_mesa_supervisor.js
git commit -m "feat(mesa): bloco Retornos e objecoes na Mesa do Supervisor (§72)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: Fechamento — suíte inteira, design, build e REGRAS_NEGOCIO §72

**Files:**
- Modify: `REGRAS_NEGOCIO.md` (nova `## 72.`)
- Test: suíte inteira

- [ ] **Step 1: Verificar se entrou cor fixa nova no código.** O `<style id="cadernoStyles">` não pode ter `#` seguido de hexadecimal.

Run: `python - <<'EOF'
import re
s=open('_template.html',encoding='utf-8').read()
b=re.search(r'<style id="cadernoStyles">([\s\S]*?)</style>',s).group(1)
print(re.findall(r'#[0-9a-fA-F]{3,8}\b',b))
EOF`
Expected: `[]`.

- [ ] **Step 2: Suíte inteira + build**

Run: `bash run_tests.sh && node --test supabase/functions/caderno-ia/ia.test.ts`
Expected:
- `run_tests.sh`: só as 2 falhas antigas conhecidas (`test_conversao_vendas.js`, `test_pedidos_alerta.js`), com `test_agenda.js`, `test_caderno.js`, `test_objecoes.js` e `test_mesa_supervisor.js` passando;
- `ia.test.ts`: 6 ok;
- o build gera `painel_clientes_apex.html` sem placeholder pendente.

- [ ] **Step 3: REGRAS_NEGOCIO.md** — acrescentar no fim:

```markdown
## 72. Caderno de Ligação, Agenda e Objeções com IA (06/10/2026)

- **Para quem:** consultores da discadora (ProContact), fora do lead. Antes anotavam no Bloco de Notas, que se perde ao fechar, e não tinham agenda de retorno.
- **Caderno** (botão fixo "Caderno" em todas as abas, `Alt+N`; `Alt+Shift+N` = novo atendimento):
  - campos telefone, nome, CPF, CNPJ, CEP, linhas e valor do plano; "Mais dados" com e-mail, operadora, decisor, vencimento da fidelidade e interesse; anotação livre; resultado em 1 clique;
  - salva a cada pausa de digitação no navegador (`caderno_rascunho_<usuário>`) e no banco (`caderno_notas`, upsert pelo `id` gerado no navegador, sem duplicar);
  - sem internet, mostra "guardado neste computador" e reenvia a cada 15 s e quando a rede volta; ao reabrir o painel, o rascunho volta;
  - reconhece CPF, CNPJ, telefone, CEP e e-mail colados na anotação e oferece "Preencher", sem IA. Celular de 11 dígitos com 9 na 3ª posição é telefone, não CPF;
  - mostra as anotações anteriores do mesmo telefone ou CNPJ (só do próprio consultor) e o retorno pendente;
  - "Janela flutuante" usa a Document Picture-in-Picture do Chrome, ou `window.open` como reserva, para ficar sobre o ProContact.
- **Agenda** (aba nova, todos os perfis):
  - calendário do mês (domingo a sábado), até 3 retornos por dia + "+N", hoje destacado, dia com atrasado em vermelho;
  - clicar no dia abre o painel do dia (Feito / Remarcar / Cancelar / Abrir no Caderno) e o formulário "Novo retorno" (nome, telefone, dia, hora, tipo, linhas, valor, observação);
  - arrastar um retorno para outro dia mantém a hora;
  - no celular a grade vira lista;
  - as datas de portabilidade e instalação dos pedidos do consultor (as mesmas da Agenda de Pedidos Parados) aparecem só para leitura;
  - tabela `agenda_retornos` (data e hora, `timestamptz`). Retorno não se apaga, se cancela.
- **Retorno pelo Caderno:**
  - atalhos Em 2h / Amanhã 9h / Amanhã 14h / Seg 9h e escolha livre;
  - "Não atendeu" oferece "Tentar de novo em 2h";
  - vencimento da fidelidade oferece o retorno 45 dias antes, às 9h (nunca cria sozinho).
- **Alertas:**
  - 5 min antes: notificação do Windows (permissão pedida na aba Agenda), som curto, aviso na tela e contador no título;
  - cada retorno alerta uma vez (`localStorage` + `BroadcastChannel` entre abas);
  - ao entrar, aviso "Hoje: N retornos · M atrasados";
  - só funciona com o painel aberto em alguma aba.
- **Objeções:**
  - chips no Caderno (`Alt+1`…`Alt+9`); a resposta da biblioteca (`objecoes_respostas`: fala, pergunta, alternativa) aparece na hora, sem rede;
  - se a anotação tem contexto, a Edge Function `caderno-ia` (Gemini `gemini-3.1-flash-lite`, nível gratuito) devolve a versão "Para este cliente" em até 6 s. Se não devolver, "IA indisponível agora", e a biblioteca segue na tela;
  - campo "O cliente disse…" para objeção fora dos chips;
  - "Usei" e 👍/👎 gravam em `objecoes_uso`; "Treinar no Apex Mind" abre o Apex Mind por SSO;
  - admin/supervisor editam a biblioteca pelo botão "Objeções" da aba Agenda.
- **Dado pessoal e IA:**
  - o painel nunca envia nome, CPF, CNPJ, CEP, telefone ou e-mail;
  - o texto livre é mascarado no navegador (`cdMascarar`) e de novo na função (`mascarar`);
  - a função não loga texto, e o limite é de 20 chamadas por consultor a cada 10 min (`caderno_ia_chamadas`);
  - secret `GEMINI_API_KEY` no projeto `apex`.
- **Mesa do Supervisor:** bloco "Retornos e objeções", com a RPC `mesa_retornos_objecoes(p_ref)`: hoje, atrasados, % feitos no dia marcado (7 dias) e top 5 objeções.
- **Banco:** migration `supabase/migrations/20261006100000_caderno_agenda_objecoes.sql`, rollback em `supabase/rollback/`, verificação `supabase/tests/caderno_agenda_check.sql` (transação com rollback). RLS: o consultor lê e escreve só o que é dele; admin/supervisor leem tudo; ninguém apaga.
- **Spec e plano:** `docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md`, `docs/superpowers/plans/2026-10-06-caderno-agenda-objecoes.md`.
- **Fases seguintes** (fora desta entrega):
  - ligar ao relatório do ProContact (retorno cumprido sozinho, "já ligaram para esse número?");
  - consulta de CNPJ e cobertura pelo CEP;
  - ficha para colar no pedido e calculadora;
  - IA que organiza a anotação inteira.
```

(Os itens "Entrada no ar" com data, hora e MD5 são acrescentados pelo controlador depois da publicação.)

- [ ] **Step 4: Commit**

```bash
git add REGRAS_NEGOCIO.md
git commit -m "docs(regras): §72 Caderno, Agenda e Objecoes com IA

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Entrada no ar (controlador; cada passo só com ok explícito do Rafael na hora)

1. **Migration:** `apply_migration` no `apex` (`mdgfboijyqfkggcrhptn`) com o conteúdo da Task 1. Depois `execute_sql` com `supabase/tests/caderno_agenda_check.sql`. Esperado: termina sem exceção (rollback). Conferir que `objecoes_respostas` tem 9 linhas.
2. **Secret:** o Rafael roda no terminal dele `npx supabase secrets set GEMINI_API_KEY=... --project-ref mdgfboijyqfkggcrhptn`. A chave nunca passa pelo chat.
3. **Função:** `deploy_edge_function` `caderno-ia` (arquivos `index.ts` + `ia.ts`, `verify_jwt: true`). Teste real logado no painel: abrir o Caderno, preencher "12 linhas, Vivo" e clicar em "Tá caro". A versão "Para este cliente" deve aparecer e `caderno_ia_chamadas` deve ganhar uma linha `ok`.
4. **Textos:** o Rafael lê as 9 respostas da biblioteca (podem ser editadas depois pelo próprio painel).
5. **Painel:** `python build_painel.py`, baixar o painel que está no ar e comparar com o gerado (juntar, nunca sobrescrever). Publicar pelo fluxo de sempre (backup, MD5, vigia).
6. **Registro:** data, hora e MD5 na §72, depois commit e push na `oficial/main`.
