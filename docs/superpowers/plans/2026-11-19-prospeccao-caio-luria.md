# Subaba Prospecção (Caio e Lúria) — Plano de implementação (§161)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a subaba "Prospecção" no Meus leads, visível só para Caio, Lúria e o admin, com os 179 clientes da planilha num mini Kanban de 6 colunas (Pegar, etapas, retorno, observação, WhatsApp com texto pronto e Ligar). Quem estiver sem telefone recebe o número principal com WhatsApp consultado na Nova Vida.

**Architecture:**
- **Banco:** duas tabelas novas (`prospec_clientes` e `prospec_acesso`), com RLS sem policy. O acesso é só por RPC `security definer` (`prospec_pode`, `prospec_listar`, `prospec_pegar`, `prospec_mover`). A escolha do número é uma função SQL pura sobre o JSON que o robô da §156 já grava em `socios_consultas`.
- **Painel:** botão novo em `#kbAbas`, ligado a `kbAbasVisiveis` e `kbTrocarAba`. Quadro próprio (`#kbProspec`) com as classes visuais do Kanban, e ficha em `.overlay/.modal`.
- **Carga e Nova Vida:** operações únicas, fora do repo, cada uma com ok do Rafael.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), HTML+JS puro em `_template.html` (gerado por `build_painel.py`), testes node+jsdom (`test_*.js`), checagem SQL em `supabase/tests/*.sql` rodada pelo conector `execute_sql`, Python 3.12 local para a carga.

**Spec:** `docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md` (commit c627aae)

## Global Constraints

- O repositório é público: nenhum CNPJ real, razão social, nome de sócio, telefone, uuid de usuário ou id da planilha em código, teste, migration, log ou commit. Testes usam dados fictícios (prefixo "Zz", CNPJ `11222333000181` / `11444777000161`, telefones `119000000xx`).
- O Supabase `mdgfboijyqfkggcrhptn` é produção. Leitura é livre. Escrita, DDL e até ensaio com `rollback` só com ok do Rafael naquele momento.
- Migration sem `DROP` (o conector falha). Arquivo com `begin;` na 3ª linha e `commit;` como última linha. Aplicar com `execute_sql` (o `apply_migration` falha).
- Editar só o `_template.html`. O painel gerado sai de `python build_painel.py`. Manter LF.
- Design "Sinal de Ápice": sem cor fixa em hex. Cores só por variável, e o único verde é `var(--st-ganho)`. Reaproveitar `.kbCol*`, `.kbCard`, `.kbBtn*`, `.kbTag`, `.kbCartDono`, `.filterPill`, `.overlay/.modal/.mHead/.mBody`, `.field`, `.btn`.
- Avisos com `mostrarAviso(msg, 'ok'|'erro'|'info')`, nunca `alert()`. Fechar modal com `fecharOverlay(el)`.
- Etapas (valor → rótulo): `livre` Livres, `contato` Em contato, `retornar` Retornar, `venda` Venda, `sem_interesse` Sem interesse, `sem_contato` Sem contato.
- Texto do WhatsApp (exato): `Olá, {sócio}! Aqui é {consultor}, da Claro Empresas. Estou entrando em contato sobre a {razão social}: temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?`
- Seção do REGRAS: §161 (conferir de novo depois de `git fetch oficial`, antes de escrever).
- Push na oficial sem force, e quem roda é o Rafael com `!` (o classificador bloqueia o push do Claude).

## Review Focus

1. **Dois consultores clicam em Pegar no mesmo cliente quase ao mesmo tempo:** um ganha e o outro vê "Esse cliente já foi pego por {nome}", sem erro vermelho. Duplo clique do mesmo usuário não dispara duas RPCs. → Task 1 caso 2 e Task 3 (botão desabilita durante a chamada).
2. **Telefone em formatos variados** (`(11) 90000-0001`, `5511900000001`, fixo de 10 dígitos): o número sai sempre só em dígitos, sem 55; fixo não mostra o botão WhatsApp. → Task 2 (`prospecTelInfo`, `prospecWhatsLink`) e Task 1 caso 6.
3. **Razão social ou nome com HTML ou aspas** (`<img src=x>`, `"`): aparecem escapados no cartão e na ficha, e codificados na URL do wa.me. → Task 2.
4. **Usuário perde o acesso com o painel aberto** (linha apagada de `prospec_acesso`): a recarga recebe 42501, o quadro mostra "Você não tem acesso à Prospecção" e o timer para. → Task 3.
5. **O timer de 60 s recarrega com a ficha aberta e observação digitada:** o texto não some. A ficha só se refaz ao abrir outro cliente ou ao salvar. → Task 3.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20261119180000_prospeccao.sql` (novo) | Tabelas, acesso, RPCs, escolha do número, aplicar Nova Vida |
| `supabase/tests/prospeccao_check.sql` (novo) | Verificação no banco, em transação desfeita |
| `_template.html` (modificar) | Botão da subaba, contêiner `#kbProspec`, overlay `#prospecOverlay`, CSS `.prospec*`, funções `prospec*`, ganchos em `kbAbasVisiveis`, `kbAplicarPermissao`, `kbTrocarAba`, `kbParar` |
| `test_prospeccao.js` (novo) | Funções puras e fluxo da subaba no jsdom |
| `REGRAS_NEGOCIO.md` (modificar) | §161 |
| Fora do repo: `<scratchpad>/prospeccao/carga.py` | Lê os CSVs e gera o SQL de carga (nunca entra no git) |

---

### Task 1: Banco — tabelas, RPCs e verificação

**Files:**
- Create: `supabase/migrations/20261119180000_prospeccao.sql`
- Create: `supabase/tests/prospeccao_check.sql`

**Interfaces:**
- Produces (usado pelas Tasks 3, 4 e 5):
  - `prospec_pode() → boolean`
  - `prospec_listar() → jsonb` (array de objetos com as chaves `id, cnpj, aba_origem, razao_social, cidade, uf, segmento, porte, obs_planilha, dados, telefone, tel_fonte, whatsapp, socio_nome, nv_status, etapa, retorno_em, obs, dono_id, dono_nome, dono_em, atualizado_em`). Fora do acesso, erro `42501`.
  - `prospec_pegar(p_id bigint) → jsonb`: `{ok:true}` ou `{ok:false, motivo:'ja_tem_dono', dono:text}`.
  - `prospec_mover(p_id bigint, p_etapa text, p_retorno_em timestamptz, p_obs text) → jsonb`: `{ok:true}`. Recusa com 22023 (mensagem para o usuário) ou 42501. `p_obs` nulo mantém a obs; `''` apaga.
  - `prospec_escolher_numero(p_resultado jsonb) → jsonb`: `{numero, whatsapp, socio_nome}` ou `null`.
  - `prospec_aplicar_nv() → jsonb`: `{aplicados:int, resumo:{nv_status:n}}`. Só admin ou SQL direto.

- [ ] **Step 1: Escrever a verificação (teste que falha)**

Criar `supabase/tests/prospeccao_check.sql`:

```sql
-- Verificação da §161 no banco. Tudo em transação desfeita no fim. Saída: só 'OK' ou a exceção com o caso.
-- DADOS FICTÍCIOS (repo público).
begin;
do $prep$
declare v_a uuid; v_b uuid; v_fora uuid; v_adm uuid;
begin
  select profile_id into v_a from public.prospec_acesso order by profile_id limit 1;
  select profile_id into v_b from public.prospec_acesso where profile_id <> v_a order by profile_id limit 1;
  select id into v_fora from public.profiles where role = 'consultor' and id not in (select profile_id from public.prospec_acesso) order by id limit 1;
  select id into v_adm from public.profiles where role = 'admin' order by id limit 1;
  if v_a is null or v_b is null or v_fora is null or v_adm is null then raise exception 'PREP: faltam atores'; end if;
  if exists (select 1 from public.prospec_clientes where cnpj in ('11222333000181','11444777000161')) then raise exception 'PREP: CNPJ de teste já existe'; end if;
  insert into public.prospec_clientes (cnpj, aba_origem, razao_social, nv_status) values
    ('11222333000181', 'LURIA', 'Zz Teste Um', 'pendente'),
    ('11444777000161', 'CAIO', 'Zz Teste Dois', 'nao_precisa');
  perform set_config('t.a', v_a::text, true); perform set_config('t.b', v_b::text, true);
  perform set_config('t.fora', v_fora::text, true); perform set_config('t.adm', v_adm::text, true);
end $prep$;

do $t$
declare r jsonb; n int; como text := '{"role":"authenticated","sub":"%s"}';
  v_um bigint := (select id from public.prospec_clientes where cnpj = '11222333000181');
  v_dois bigint := (select id from public.prospec_clientes where cnpj = '11444777000161');
begin
  -- 1. fora do acesso: 42501 em listar, pegar e mover
  perform set_config('request.jwt.claims', format(como, current_setting('t.fora')), true);
  if public.prospec_pode() then raise exception 'CASO 1: pode() deveria ser falso'; end if;
  begin perform public.prospec_listar(); raise exception 'CASO 1a: listar passou'; exception when insufficient_privilege then null; end;
  begin perform public.prospec_pegar(v_um); raise exception 'CASO 1b: pegar passou'; exception when insufficient_privilege then null; end;
  begin perform public.prospec_mover(v_um, 'contato', null, null); raise exception 'CASO 1c: mover passou'; exception when insufficient_privilege then null; end;
  -- 2. A pega (vira contato), B recebe ja_tem_dono com o nome de A
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  if not public.prospec_pode() then raise exception 'CASO 2: A sem acesso'; end if;
  r := public.prospec_pegar(v_um);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 2a: %', r; end if;
  if (select etapa from public.prospec_clientes where id = v_um) <> 'contato' then raise exception 'CASO 2b: etapa'; end if;
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.prospec_pegar(v_um);
  if r->>'motivo' is distinct from 'ja_tem_dono' or r->>'dono' is distinct from (select nome from public.profiles where id = current_setting('t.a')::uuid) then raise exception 'CASO 2c: %', r; end if;
  -- 3. B não move o de A; admin move
  begin perform public.prospec_mover(v_um, 'venda', null, null); raise exception 'CASO 3a: B moveu'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', format(como, current_setting('t.adm')), true);
  r := public.prospec_mover(v_um, 'sem_interesse', null, 'Zz motivo');
  if (select etapa || '|' || obs from public.prospec_clientes where id = v_um) <> 'sem_interesse|Zz motivo' then raise exception 'CASO 3b: admin não moveu'; end if;
  -- 4. retornar sem data recusa; com data grava; sair de retornar limpa a data; obs nula mantém
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  begin perform public.prospec_mover(v_um, 'retornar', null, null); raise exception 'CASO 4a: retornar sem data passou'; exception when invalid_parameter_value then null; end;
  perform public.prospec_mover(v_um, 'retornar', now() + interval '1 day', null);
  if (select retorno_em is null or obs <> 'Zz motivo' from public.prospec_clientes where id = v_um) then raise exception 'CASO 4b'; end if;
  perform public.prospec_mover(v_um, 'contato', now(), '');
  if (select retorno_em is not null or obs is not null from public.prospec_clientes where id = v_um) then raise exception 'CASO 4c: retorno/obs não limparam'; end if;
  begin perform public.prospec_mover(v_um, 'xyz', null, null); raise exception 'CASO 4d: etapa inválida passou'; exception when invalid_parameter_value then null; end;
  -- 5. soltar (livre) limpa dono; cliente livre não se move sem pegar
  perform public.prospec_mover(v_um, 'livre', null, null);
  if (select dono_id is not null or etapa <> 'livre' from public.prospec_clientes where id = v_um) then raise exception 'CASO 5a'; end if;
  begin perform public.prospec_mover(v_dois, 'venda', null, null); raise exception 'CASO 5b: livre moveu sem pegar'; exception when invalid_parameter_value then null; end;
  -- 5c. listar traz os dois com telefone efetivo e dono_nome
  r := public.prospec_listar();
  if (select count(*) from jsonb_array_elements(r) e where e->>'cnpj' in ('11222333000181','11444777000161')) <> 2 then raise exception 'CASO 5c'; end if;
  -- 6. escolha do número
  r := public.prospec_escolher_numero('{"socios":[
      {"nome":"ZZ MENOR","participacao":10,"telefones":[{"tipo":"celular","numero":"11900000001","whatsapp":true}]},
      {"nome":"ZZ MAIOR","participacao":90,"telefones":[{"tipo":"fixo","numero":"1130000002","whatsapp":false},{"tipo":"celular","numero":"(11) 90000-0003","whatsapp":false},{"tipo":"celular","numero":"5511900000004","whatsapp":true}]}]}');
  if r is distinct from '{"numero":"11900000004","whatsapp":true,"socio_nome":"ZZ MAIOR"}'::jsonb then raise exception 'CASO 6a: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ A","participacao":50,"telefones":[{"tipo":"fixo","numero":"1130000005","whatsapp":false},{"tipo":"celular","numero":"11900000006","whatsapp":false}]}]}');
  if r is distinct from '{"numero":"11900000006","whatsapp":false,"socio_nome":"ZZ A"}'::jsonb then raise exception 'CASO 6b: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ SEM","participacao":100,"telefones":[]},{"nome":"ZZ FIXO","participacao":0,"telefones":[{"tipo":"fixo","numero":"1130000007","whatsapp":false}]}]}');
  if r is distinct from '{"numero":"1130000007","whatsapp":false,"socio_nome":"ZZ FIXO"}'::jsonb then raise exception 'CASO 6c: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ E1","participacao":50,"telefones":[{"tipo":"celular","numero":"11900000008","whatsapp":true}]},{"nome":"ZZ E2","participacao":50,"telefones":[{"tipo":"celular","numero":"11900000009","whatsapp":true}]}]}');
  if r->>'socio_nome' <> 'ZZ E1' then raise exception 'CASO 6d: empate deveria ficar com o primeiro: %', r; end if;
  if public.prospec_escolher_numero('{"socios":[{"nome":"ZZ","participacao":"x","telefones":[]}]}') is not null
     or public.prospec_escolher_numero('{}') is not null then raise exception 'CASO 6e: sem telefone deveria ser null'; end if;
end $t$;

-- 7. aplicar Nova Vida: mapeia status e é idempotente (como SQL direto, sem usuário)
do $t7$
declare r jsonb; v_c bigint; v_um bigint := (select id from public.prospec_clientes where cnpj = '11222333000181');
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, concluido_em, resultado)
  values ('11222333000181', 'prospeccao', current_setting('t.adm')::uuid, 'pronto', now(),
          '{"socios":[{"nome":"ZZ SOCIO","participacao":100,"telefones":[{"tipo":"celular","numero":"11900000010","whatsapp":true}]}]}')
  returning id into v_c;
  update public.prospec_clientes set nv_consulta_id = v_c where id = v_um;
  r := public.prospec_aplicar_nv();
  if (r->>'aplicados')::int <> 1 then raise exception 'CASO 7a: %', r; end if;
  if (select nv_status || '|' || telefone_nv || '|' || whatsapp::text || '|' || socio_nome from public.prospec_clientes where id = v_um) <> 'ok|11900000010|true|ZZ SOCIO' then raise exception 'CASO 7b'; end if;
  r := public.prospec_aplicar_nv();
  if (r->>'aplicados')::int <> 0 then raise exception 'CASO 7c: não é idempotente'; end if;
  update public.prospec_clientes set nv_status = 'pendente', telefone_nv = null where id = v_um;
  update public.socios_consultas set resultado = '{"socios":[{"nome":"ZZ","participacao":100,"telefones":[]}]}' where id = v_c;
  perform public.prospec_aplicar_nv();
  if (select nv_status from public.prospec_clientes where id = v_um) <> 'sem_telefone' then raise exception 'CASO 7d'; end if;
  update public.prospec_clientes set nv_status = 'pendente' where id = v_um;
  update public.socios_consultas set status = 'erro', resultado = null where id = v_c;
  perform public.prospec_aplicar_nv();
  if (select nv_status from public.prospec_clientes where id = v_um) <> 'erro' then raise exception 'CASO 7e'; end if;
  -- 8. consultor não roda aplicar_nv
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('t.a')), true);
  begin perform public.prospec_aplicar_nv(); raise exception 'CASO 8: consultor aplicou'; exception when insufficient_privilege then null; end;
end $t7$;
select 'OK' as resultado;
rollback;
```

- [ ] **Step 2: Confirmar que a verificação falha sem a migration**

É uma leitura, então não precisa de ok: rodar com `execute_sql` só a consulta `select to_regclass('public.prospec_clientes') as t, to_regprocedure('public.prospec_pode()') as f;`.
Esperado: `t = null, f = null`. O check acima falharia no PREP com `relation "public.prospec_acesso" does not exist`.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261119180000_prospeccao.sql`:

```sql
-- §161 (19/11/2026, pedido do Rafael): subaba "Prospecção" em Meus leads, só Caio e Lúria (+ admin). Temporária.
-- Spec: docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md (seção 4). Sem DROP (conector). Só estrutura:
begin;
-- os dados (CNPJ, razão, telefone) entram por SQL de carga fora do repo (repo público).

create table if not exists public.prospec_acesso (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);

create table if not exists public.prospec_clientes (
  id bigserial primary key,
  cnpj text not null unique check (cnpj ~ '^[0-9]{14}$'),
  aba_origem text not null check (aba_origem in ('CAIO', 'LURIA')),
  razao_social text, cidade text, uf text, segmento text, porte text, obs_planilha text,
  dados jsonb not null default '{}'::jsonb,
  telefone_planilha text,
  telefone_nv text,
  whatsapp boolean,
  socio_nome text,
  nv_status text not null default 'nao_precisa' check (nv_status in ('nao_precisa', 'pendente', 'ok', 'sem_socios', 'sem_telefone', 'erro')),
  nv_consulta_id bigint references public.socios_consultas(id) on delete set null,
  etapa text not null default 'livre' check (etapa in ('livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato')),
  retorno_em timestamptz,
  obs text,
  dono_id uuid references public.profiles(id),
  dono_em timestamptz,
  atualizado_por uuid,
  atualizado_em timestamptz not null default now(),
  constraint prospec_livre_sem_dono check ((etapa = 'livre') = (dono_id is null)),
  constraint prospec_retornar_com_data check (etapa <> 'retornar' or retorno_em is not null)
);

alter table public.prospec_acesso enable row level security;
alter table public.prospec_clientes enable row level security;
revoke all on public.prospec_acesso, public.prospec_clientes from anon, authenticated;
revoke all on sequence public.prospec_clientes_id_seq from anon, authenticated;

-- Caio (leads_equipe.id 1) e Lúria (leads_equipe.id 3): por subselect, sem uuid no repo.
insert into public.prospec_acesso (profile_id)
  select e.profile_id from public.leads_equipe e where e.id in (1, 3) and e.profile_id is not null
  on conflict do nothing;

create or replace function public.prospec_pode() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.get_my_role(), '') = 'admin'
      or exists (select 1 from public.prospec_acesso a where a.profile_id = auth.uid());
$$;

-- Número principal: sócio de maior participação (empate: ordem do array) que tenha telefone;
-- dele, 1º celular com WhatsApp → 1º celular → 1º fixo. Só dígitos, sem 55. Sem telefone: null.
create or replace function public.prospec_escolher_numero(p_resultado jsonb) returns jsonb
language sql immutable set search_path = public as $$
  with s as (
    select e.val as socio, e.ord,
           case when jsonb_typeof(e.val->'participacao') = 'number' then (e.val->>'participacao')::numeric else 0 end as part
      from jsonb_array_elements(coalesce(p_resultado->'socios', '[]'::jsonb)) with ordinality e(val, ord)
  ), t as (
    select s.socio, s.ord, s.part, tel.val as tel, tel.ord as tord,
           regexp_replace(regexp_replace(coalesce(tel.val->>'numero', ''), '\D', '', 'g'), '^55(?=\d{10,11}$)', '') as num
      from s cross join lateral jsonb_array_elements(coalesce(s.socio->'telefones', '[]'::jsonb)) with ordinality tel(val, ord)
  ), validos as (
    select * from t where length(num) in (10, 11)
  ), dono as (
    select ord from validos order by part desc, ord limit 1
  )
  select jsonb_build_object('numero', v.num,
                            'whatsapp', v.tel->>'tipo' = 'celular' and coalesce((v.tel->>'whatsapp')::boolean, false),
                            'socio_nome', v.socio->>'nome')
    from validos v join dono d on d.ord = v.ord
   order by case when v.tel->>'tipo' = 'celular' and coalesce((v.tel->>'whatsapp')::boolean, false) then 0
                 when v.tel->>'tipo' = 'celular' then 1 else 2 end, v.tord
   limit 1;
$$;

create or replace function public.prospec_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'cnpj', p.cnpj, 'aba_origem', p.aba_origem, 'razao_social', p.razao_social,
      'cidade', p.cidade, 'uf', p.uf, 'segmento', p.segmento, 'porte', p.porte, 'obs_planilha', p.obs_planilha, 'dados', p.dados,
      'telefone', coalesce(p.telefone_planilha, p.telefone_nv),
      'tel_fonte', case when p.telefone_planilha is not null then 'planilha' when p.telefone_nv is not null then 'nova_vida' end,
      'whatsapp', p.whatsapp, 'socio_nome', p.socio_nome, 'nv_status', p.nv_status,
      'etapa', p.etapa, 'retorno_em', p.retorno_em, 'obs', p.obs,
      'dono_id', p.dono_id, 'dono_nome', pr.nome, 'dono_em', p.dono_em, 'atualizado_em', p.atualizado_em) order by p.id)
      from public.prospec_clientes p left join public.profiles pr on pr.id = p.dono_id), '[]'::jsonb);
end $$;

create or replace function public.prospec_pegar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dono text;
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  update public.prospec_clientes
     set dono_id = auth.uid(), dono_em = now(), etapa = 'contato', atualizado_por = auth.uid(), atualizado_em = now()
   where id = p_id and dono_id is null;
  if found then return jsonb_build_object('ok', true); end if;
  select pr.nome into v_dono from public.prospec_clientes p left join public.profiles pr on pr.id = p.dono_id where p.id = p_id;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', false, 'motivo', 'ja_tem_dono', 'dono', v_dono);
end $$;

create or replace function public.prospec_mover(p_id bigint, p_etapa text, p_retorno_em timestamptz, p_obs text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dono uuid;
begin
  if not public.prospec_pode() then raise exception 'sem permissão' using errcode = '42501'; end if;
  if p_etapa is null or p_etapa not in ('livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato') then
    raise exception 'etapa inválida' using errcode = '22023';
  end if;
  if p_etapa = 'retornar' and p_retorno_em is null then raise exception 'escolha a data e a hora do retorno' using errcode = '22023'; end if;
  select dono_id into v_dono from public.prospec_clientes where id = p_id for update;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  if v_dono is null then raise exception 'pegue o cliente antes de mudar a etapa' using errcode = '22023'; end if;
  if v_dono <> auth.uid() and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'este cliente é de outro consultor' using errcode = '42501';
  end if;
  update public.prospec_clientes set
    etapa = p_etapa,
    dono_id = case when p_etapa = 'livre' then null else dono_id end,
    dono_em = case when p_etapa = 'livre' then null else dono_em end,
    retorno_em = case when p_etapa = 'retornar' then p_retorno_em end,
    obs = case when p_obs is null then obs else nullif(btrim(p_obs), '') end,
    atualizado_por = auth.uid(), atualizado_em = now()
  where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- Grava o número escolhido nas linhas 'pendente' cuja consulta terminou. Idempotente (só toca 'pendente').
create or replace function public.prospec_aplicar_nv() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if auth.uid() is not null and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  with c as (
    select p.id, s.status, public.prospec_escolher_numero(s.resultado) as e
      from public.prospec_clientes p join public.socios_consultas s on s.id = p.nv_consulta_id
     where p.nv_status = 'pendente' and s.status in ('pronto', 'sem_socios', 'erro')
  ), u as (
    update public.prospec_clientes p set
      nv_status = case c.status when 'pronto' then case when c.e is null then 'sem_telefone' else 'ok' end
                                when 'sem_socios' then 'sem_socios' else 'erro' end,
      telefone_nv = c.e->>'numero',
      whatsapp = case when c.e is null then null else (c.e->>'whatsapp')::boolean end,
      socio_nome = c.e->>'socio_nome',
      atualizado_em = now()
    from c where p.id = c.id
    returning 1
  )
  select count(*) into v_n from u;
  return jsonb_build_object('aplicados', v_n,
    'resumo', (select jsonb_object_agg(nv_status, n) from (select nv_status, count(*) n from public.prospec_clientes group by 1) x));
end $$;

revoke all on function public.prospec_pode(), public.prospec_listar(), public.prospec_pegar(bigint),
  public.prospec_mover(bigint, text, timestamptz, text) from public, anon;
grant execute on function public.prospec_pode(), public.prospec_listar(), public.prospec_pegar(bigint),
  public.prospec_mover(bigint, text, timestamptz, text) to authenticated;
revoke all on function public.prospec_escolher_numero(jsonb), public.prospec_aplicar_nv() from public, anon, authenticated;
commit;
```

- [ ] **Step 4: Ensaio no banco com rollback (PEDIR OK AO RAFAEL ANTES)**

Montar o ensaio (a migration sem o `commit;`, mais o check sem o `begin;`, que já termina em `rollback;`):

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/prospeccao
{ sed '$d' supabase/migrations/20261119180000_prospeccao.sql; sed '1,3d' supabase/tests/prospeccao_check.sql; } > "$TEMP/prospec_ensaio.sql"
tail -3 "$TEMP/prospec_ensaio.sql"   # tem que terminar em: select 'OK' as resultado; / rollback;
```

Atenção: `sed '1,3d'` tira as 2 linhas de comentário e o `begin;` do check. Conferir que a 4ª linha original é `do $prep$`.
Com o ok do Rafael, rodar o conteúdo do arquivo com `execute_sql`.
Esperado: `[{"resultado":"OK"}]`. Confirmar em seguida que nada ficou: `select to_regclass('public.prospec_clientes');` deve dar `null`.
Se falhar, corrigir a migration e repetir este passo.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261119180000_prospeccao.sql supabase/tests/prospeccao_check.sql
git commit -m "feat(banco): §161 prospecção — tabelas, RPCs e verificação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Painel — funções puras `prospec*`

**Files:**
- Modify: `_template.html` (bloco novo de JS logo depois de `function kbLigar(telefone){…}`, por volta da linha 6898)
- Create: `test_prospeccao.js`

**Interfaces:**
- Consumes: `kbTelCopiar(v)`, `kbFoneBR(v)`, `escapeHtml(s)`, `kbIniciais(nome)`, `KB_ICO.tel`, `KB_ICO.wa`, `KB_ICO.mao` (já existem).
- Produces (usado pela Task 3):
  - `PROSPEC_ETAPAS`: array de `[valor, rótulo]` na ordem das colunas.
  - `prospecTelInfo(c) → {numero:string, celular:boolean, rotulo:string, selo:''|'whats'|'semwhats'}`
  - `prospecPrimeiroNome(nome) → string` ("ZZKSOCIO FULANO" → "Zzksocio")
  - `prospecWhatsTexto(c, consultor) → string`
  - `prospecWhatsLink(c, consultor) → string` (`''` se não for celular de 11 dígitos)
  - `prospecFiltrar(lista, {meus:boolean, uid:string, busca:string}) → array`
  - `prospecAgrupar(lista) → {livre:[], contato:[], retornar:[], venda:[], sem_interesse:[], sem_contato:[]}`
  - `prospecCardHtml(c, ctx:{uid, agoraMs, pegando:Set}) → string`
  - `prospecFichaHtml(c, ctx:{uid, admin:boolean, agoraMs}) → string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `test_prospeccao.js` com o mesmo cabeçalho de mocks do `test_alterar_cnpj.js` (linhas 1–47 daquele arquivo, copiadas igual) e este `testScript`:

```js
// Testa a §161 (subaba Prospecção em Meus leads). Spec: docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md.
// DADOS FICTÍCIOS (repo público).
// [linhas 3–47 idênticas às de test_alterar_cnpj.js: fs, JSDOM, comRange, builder, window.supabase, XLSX, alert, confirm, Chart…]
window.__abertos = [];
window.open = (url, alvo) => { window.__abertos.push({ url, alvo }); return null; };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const AG = Date.parse('2026-11-20T15:00:00-03:00');
  const C = (o) => Object.assign({ id: 1, cnpj: '11222333000181', aba_origem: 'LURIA', razao_social: 'Zz Oficina Ltda', cidade: 'Campinas', uf: 'SP',
    segmento: 'Zz Segmento', porte: 'MEI', obs_planilha: null, dados: { linha: '2', resultado: 'Encontrado' }, telefone: '11900000001', tel_fonte: 'nova_vida',
    whatsapp: true, socio_nome: 'ZZKSOCIO FULANO DE TAL', nv_status: 'ok', etapa: 'livre', retorno_em: null, obs: null, dono_id: null, dono_nome: null,
    dono_em: null, atualizado_em: '2026-11-20T10:00:00-03:00' }, o || {});

  // ==== etapas ====
  eq(PROSPEC_ETAPAS.map(e => e[0]), ['livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato'], 'ordem das colunas');
  eq(PROSPEC_ETAPAS.map(e => e[1]), ['Livres', 'Em contato', 'Retornar', 'Venda', 'Sem interesse', 'Sem contato'], 'rótulos');

  // ==== telefone ====
  eq(prospecTelInfo(C()), { numero: '11900000001', celular: true, rotulo: '(11) 90000-0001', selo: 'whats' }, 'celular com WhatsApp');
  eq(prospecTelInfo(C({ telefone: '(16) 98111-0000', whatsapp: null })).numero, '16981110000', 'formatado vira dígitos');
  eq(prospecTelInfo(C({ telefone: '5516981110000', whatsapp: false })), { numero: '16981110000', celular: true, rotulo: '(16) 98111-0000', selo: 'semwhats' }, '55 na frente sai; sem WhatsApp');
  eq(prospecTelInfo(C({ telefone: '1930000000', whatsapp: false })), { numero: '1930000000', celular: false, rotulo: '(19) 3000-0000', selo: '' }, 'fixo: sem selo');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'pendente' })).rotulo, 'Consultando telefone…', 'pendente');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'erro' })).rotulo, 'Consulta com erro', 'erro');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'sem_socios' })).rotulo, 'Sem sócio na Nova Vida', 'sem sócios');
  eq(prospecTelInfo(C({ telefone: null, nv_status: 'sem_telefone' })).rotulo, 'Sem telefone', 'sem telefone');

  // ==== WhatsApp ====
  eq(prospecPrimeiroNome('ZZKSOCIO FULANO'), 'Zzksocio', 'primeiro nome capitalizado');
  eq(prospecPrimeiroNome('  '), '', 'nome vazio');
  eq(prospecWhatsTexto(C(), 'Zzkcon Teste'),
     'Olá, Zzksocio! Aqui é Zzkcon, da Claro Empresas. Estou entrando em contato sobre a Zz Oficina Ltda: temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?', 'texto completo');
  eq(prospecWhatsTexto(C({ socio_nome: null, razao_social: null }), 'Zzkcon'),
     'Olá! Aqui é Zzkcon, da Claro Empresas. Temos condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?', 'sem sócio e sem razão');
  const link = prospecWhatsLink(C({ razao_social: 'Zz & "Filhos" <b>' }), 'Zzkcon');
  assert(link.startsWith('https://wa.me/5511900000001?text=') && link.includes(encodeURIComponent('Zz & "Filhos" <b>')), 'link codificado');
  eq(prospecWhatsLink(C({ telefone: '1930000000' }), 'Zzkcon'), '', 'fixo: sem link');
  eq(prospecWhatsLink(C({ telefone: null }), 'Zzkcon'), '', 'sem número: sem link');

  // ==== filtrar e agrupar ====
  const L = [C({ id: 1 }), C({ id: 2, etapa: 'contato', dono_id: 'u-a', dono_nome: 'Zz A', razao_social: 'Zz Padaria', telefone: '11900000002' }),
    C({ id: 3, etapa: 'retornar', dono_id: 'u-b', retorno_em: '2026-11-21T10:00:00-03:00', cnpj: '11444777000161' }),
    C({ id: 4, etapa: 'retornar', dono_id: 'u-a', retorno_em: '2026-11-20T09:00:00-03:00', socio_nome: 'ZZ JOSÉ' })];
  eq(prospecFiltrar(L, { meus: true, uid: 'u-a', busca: '' }).map(c => c.id), [2, 4], 'Meus');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: 'padaria' }).map(c => c.id), [2], 'busca pela razão, sem maiúscula');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: '11.444.777' }).map(c => c.id), [3], 'busca pelo CNPJ com pontuação');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: '90000-0002' }).map(c => c.id), [2], 'busca pelo telefone');
  eq(prospecFiltrar(L, { meus: false, uid: 'u-a', busca: 'jose' }).map(c => c.id), [4], 'busca pelo sócio, sem acento');
  const g = prospecAgrupar(L);
  eq(Object.keys(g), ['livre', 'contato', 'retornar', 'venda', 'sem_interesse', 'sem_contato'], 'grupos');
  eq(g.retornar.map(c => c.id), [4, 3], 'Retornar pela data, mais cedo primeiro');

  // ==== cartão ====
  const livre = prospecCardHtml(C(), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(livre.includes('data-prospec-pegar="1"') && livre.includes('data-prospec-id="1"'), 'livre: botão Pegar');
  assert(livre.includes('data-prospec-whats="1"') && livre.includes('data-prospec-ligar="1"'), 'livre: WhatsApp e Ligar');
  assert(prospecCardHtml(C(), { uid: 'u-a', agoraMs: AG, pegando: new Set([1]) }).includes('disabled'), 'Pegar em andamento: desabilitado');
  const dono = prospecCardHtml(L[1], { uid: 'u-x', agoraMs: AG, pegando: new Set() });
  assert(!dono.includes('data-prospec-pegar') && dono.includes('kbCartDono') && dono.includes('Zz'), 'com dono: chip, sem Pegar');
  const fixo = prospecCardHtml(C({ telefone: '1930000000' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(!fixo.includes('data-prospec-whats') && fixo.includes('data-prospec-ligar'), 'fixo: só Ligar');
  assert(!prospecCardHtml(C({ telefone: null, nv_status: 'pendente' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() }).includes('data-prospec-ligar'), 'sem número: sem botões');
  const atras = prospecCardHtml(L[3], { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(atras.includes('kbTag late'), 'retorno vencido: tag late');
  const xss = prospecCardHtml(C({ razao_social: '<img src=x>', socio_nome: '<b>z' }), { uid: 'u-a', agoraMs: AG, pegando: new Set() });
  assert(!xss.includes('<img') && !xss.includes('<b>z'), 'cartão escapa HTML');
  assert(prospecCardHtml(C({ razao_social: null }), { uid: 'u-a', agoraMs: AG, pegando: new Set() }).includes('11.222.333/0001-81'), 'sem razão: CNPJ formatado');

  // ==== ficha ====
  const fDono = prospecFichaHtml(L[1], { uid: 'u-a', admin: false, agoraMs: AG });
  assert(fDono.includes('data-prospec-etapa="venda"') && fDono.includes('id="prospecObs"') && fDono.includes('data-prospec-salvar') && fDono.includes('data-prospec-soltar'), 'dono: edita');
  assert(fDono.includes('linha') && fDono.includes('Encontrado'), 'ficha mostra as colunas originais');
  const fOutro = prospecFichaHtml(L[1], { uid: 'u-x', admin: false, agoraMs: AG });
  assert(!fOutro.includes('data-prospec-salvar') && fOutro.includes('Com Zz A'), 'outro: só leitura');
  assert(prospecFichaHtml(L[1], { uid: 'u-x', admin: true, agoraMs: AG }).includes('data-prospec-salvar'), 'admin edita');
  assert(prospecFichaHtml(C(), { uid: 'u-a', admin: false, agoraMs: AG }).includes('data-prospec-pegar="1"'), 'livre: Pegar na ficha');
  assert(!prospecFichaHtml(C({ dados: { '<x>': '<img src=y>' } }), { uid: 'u-a', admin: false, agoraMs: AG }).includes('<img'), 'ficha escapa dados');

  // __FLUXO__ (Task 3 acrescenta aqui)

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

Run: `bash run_tests.sh test_prospeccao.js` e depois `cat "${TMPDIR:-/tmp}/apex_tests/test_prospeccao.js.log"`.
Esperado: FAIL com `PROSPEC_ETAPAS is not defined`.

- [ ] **Step 3: Implementar as funções puras**

Inserir no `_template.html` logo depois do fecho de `async function kbLigar(telefone){…}`:

```js
// ===== §161: subaba Prospecção (Caio e Lúria, temporária). Spec: docs/superpowers/specs/2026-11-19-prospeccao-caio-luria-design.md =====
const PROSPEC_ETAPAS = [['livre', 'Livres'], ['contato', 'Em contato'], ['retornar', 'Retornar'], ['venda', 'Venda'], ['sem_interesse', 'Sem interesse'], ['sem_contato', 'Sem contato']];
const PROSPEC_SEM_NUMERO = { pendente: 'Consultando telefone…', erro: 'Consulta com erro', sem_socios: 'Sem sócio na Nova Vida' };
function prospecTelInfo(c){
  const numero = kbTelCopiar(c && c.telefone);
  if(numero.length !== 10 && numero.length !== 11) return { numero: '', celular: false, rotulo: PROSPEC_SEM_NUMERO[c && c.nv_status] || 'Sem telefone', selo: '' };
  const celular = numero.length === 11;
  return { numero, celular, rotulo: kbFoneBR(numero), selo: !celular ? '' : c.whatsapp === true ? 'whats' : c.whatsapp === false ? 'semwhats' : '' };
}
function prospecPrimeiroNome(nome){
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
}
function prospecWhatsTexto(c, consultor){
  const socio = prospecPrimeiroNome(c && c.socio_nome), eu = prospecPrimeiroNome(consultor) || 'seu consultor';
  const razao = String((c && c.razao_social) || '').trim();
  return `Olá${socio ? ', ' + socio : ''}! Aqui é ${eu}, da Claro Empresas. `
    + (razao ? `Estou entrando em contato sobre a ${razao}: temos` : 'Temos')
    + ' condições especiais de internet e móvel para empresas. Posso te explicar rapidinho?';
}
function prospecWhatsLink(c, consultor){
  const t = prospecTelInfo(c);
  return t.celular ? `https://wa.me/55${t.numero}?text=${encodeURIComponent(prospecWhatsTexto(c, consultor))}` : '';
}
function prospecNorm(s){ return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function prospecFiltrar(lista, f){
  const q = prospecNorm(f && f.busca).trim(), dig = q.replace(/\D/g, '');
  return (lista || []).filter(c => {
    if(f && f.meus && c.dono_id !== f.uid) return false;
    if(!q) return true;
    if(prospecNorm([c.razao_social, c.socio_nome, c.cidade, c.dono_nome].join(' ')).includes(q)) return true;
    return dig.length >= 4 && (String(c.cnpj || '').includes(dig) || kbTelCopiar(c.telefone).includes(dig));
  });
}
function prospecAgrupar(lista){
  const g = {};
  PROSPEC_ETAPAS.forEach(([v]) => { g[v] = []; });
  (lista || []).forEach(c => { (g[c.etapa] || g.livre).push(c); });
  g.retornar.sort((a, b) => String(a.retorno_em || '').localeCompare(String(b.retorno_em || '')));
  ['contato', 'venda', 'sem_interesse', 'sem_contato'].forEach(k => g[k].sort((a, b) => String(b.atualizado_em || '').localeCompare(String(a.atualizado_em || ''))));
  return g;
}
function prospecCnpjFmt(d){ d = String(d || ''); return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d; }
function prospecNome(c){ return c.razao_social || prospecCnpjFmt(c.cnpj); }
function prospecRetornoTag(c, agoraMs){
  if(c.etapa !== 'retornar' || !c.retorno_em) return '';
  const vencido = Date.parse(c.retorno_em) < agoraMs;
  return `<span class="kbTag${vencido ? ' late' : ''}">Retornar ${escapeHtml(kbDataHoraBR(c.retorno_em))}</span>`;
}
function prospecSeloHtml(t){
  if(t.selo === 'whats') return '<span class="prospecSelo prospecSeloWhats">WhatsApp</span>';
  if(t.selo === 'semwhats') return '<span class="prospecSelo">sem WhatsApp</span>';
  return '';
}
function prospecBotoesHtml(c, t){
  if(!t.numero) return '';
  return `<div class="kbCartAcoes"><a class="kbBtn kbBtnP kbBtnIco" href="#" title="Ligar pelo ProContact (copia o número)" data-prospec-ligar="${c.id}">${KB_ICO.tel}</a>`
    + (t.celular ? `<a class="kbBtn kbBtnQ kbBtnIco" href="#" title="WhatsApp com mensagem pronta" data-prospec-whats="${c.id}">${KB_ICO.wa}</a>` : '') + '</div>';
}
function prospecCardHtml(c, ctx){
  const t = prospecTelInfo(c);
  const meta = [[c.cidade, c.uf].filter(Boolean).join('/'), c.segmento].filter(Boolean).join(' · ');
  const socio = c.socio_nome ? `<div class="kbCartMeta">${escapeHtml(c.socio_nome)}</div>` : '';
  const tel = `<div class="prospecTel">${escapeHtml(t.rotulo)}${prospecSeloHtml(t)}</div>`;
  const pegar = !c.dono_id ? `<button type="button" class="kbBtn kbBtnQ kbBtnSm" data-prospec-pegar="${c.id}"${ctx.pegando && ctx.pegando.has(c.id) ? ' disabled' : ''}>Pegar</button>` : '';
  const dono = c.dono_id && c.dono_nome ? `<span class="kbCartDono" title="Com ${escapeHtml(c.dono_nome)}"><b>${escapeHtml(kbIniciais(c.dono_nome))}</b>${escapeHtml(String(c.dono_nome).trim().split(/\s+/)[0])}</span>` : '';
  const obs = c.obs ? `<div class="kbObs" title="${escapeHtml(c.obs)}">${escapeHtml(c.obs)}</div>` : '';
  return `<div class="kbCard${c.dono_id === ctx.uid ? ' prospecMeu' : ''}" data-prospec-id="${c.id}" tabindex="0">
    <div class="kbNome">${escapeHtml(prospecNome(c))}</div>${meta ? `<div class="kbCartMeta">${escapeHtml(meta)}</div>` : ''}${socio}${tel}${obs}
    <div class="kbCartRodape">${prospecRetornoTag(c, ctx.agoraMs)}${dono}${pegar}</div>${prospecBotoesHtml(c, t)}
  </div>`;
}
function prospecFichaHtml(c, ctx){
  const t = prospecTelInfo(c);
  const pode = !!c.dono_id && (c.dono_id === ctx.uid || ctx.admin);
  const linhas = Object.entries(c.dados || {}).filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join('');
  const topo = `<div class="prospecFichaTel"><b>${escapeHtml(t.rotulo)}</b>${prospecSeloHtml(t)}${c.socio_nome ? ` · ${escapeHtml(c.socio_nome)}` : ''}${c.tel_fonte === 'nova_vida' ? ' · <span class="kbMuted">Nova Vida</span>' : ''}</div>${prospecBotoesHtml(c, t)}`;
  let acao;
  if(!c.dono_id) acao = `<button type="button" class="btn btn-sm" data-prospec-pegar="${c.id}">Pegar este cliente</button>`;
  else if(!pode) acao = `<p class="kbMuted">Com ${escapeHtml(c.dono_nome || 'outro consultor')}${c.obs ? ' · ' + escapeHtml(c.obs) : ''}</p>`;
  else {
    const local = c.retorno_em ? new Date(Date.parse(c.retorno_em) - new Date(Date.parse(c.retorno_em)).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
    acao = `<div class="prospecEtapas">${PROSPEC_ETAPAS.filter(([v]) => v !== 'livre').map(([v, r]) => `<button type="button" class="filterPill${c.etapa === v ? ' active' : ''}" data-prospec-etapa="${v}">${r}</button>`).join('')}</div>
      <div class="field" id="prospecRetornoCampo"${c.etapa === 'retornar' ? '' : ' hidden'}><label>Retornar em</label><input type="datetime-local" id="prospecRetorno" value="${local}"></div>
      <div class="field"><label>Observação</label><textarea id="prospecObs" rows="3">${escapeHtml(c.obs || '')}</textarea></div>
      <div class="prospecErro" id="prospecErro"></div>
      <div class="prospecFichaAcoes"><button type="button" class="btn btn-sm" data-prospec-salvar="${c.id}">Salvar</button><button type="button" class="btn btn-sm btn-outline" data-prospec-soltar="${c.id}">Soltar (volta para Livres)</button></div>`;
  }
  return `${topo}${acao}<details class="prospecDados"><summary>Dados da planilha (${escapeHtml(c.aba_origem || '')})</summary><table class="tbl"><tbody>${linhas || '<tr><td>—</td></tr>'}</tbody></table></details>`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `bash run_tests.sh test_prospeccao.js`
Esperado: `TOTAL: 1 passaram, 0 falharam`.

- [ ] **Step 5: Commit**

```bash
git add _template.html test_prospeccao.js
git commit -m "feat(painel): §161 funções puras da Prospecção (telefone, WhatsApp, filtro, cartão, ficha)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Painel — subaba, quadro, ações e ficha

**Files:**
- Modify: `_template.html`:
  - HTML do `#kbAbas` (~linha 2332);
  - contêiner antes de `<div class="kbBoard" id="kbBoard">` (~linha 2369);
  - overlay depois de `#profileOverlay` (~linha 2936);
  - CSS perto de `.kbVisao` (~linha 1378);
  - `kbAbasVisiveis` (~7599), `kbAplicarPermissao` (~6716), `kbTrocarAba` (~7866), `kbParar` (~7148);
  - JS novo depois do bloco da Task 2.
- Modify: `test_prospeccao.js` (no marcador `// __FLUXO__`)

**Interfaces:**
- Consumes: as funções da Task 2; as RPCs da Task 1; e do painel `kbEstado`, `currentUser`, `sb`, `ppSeguro`, `mostrarAviso`, `fecharOverlay`, `kbLigar`, `kbAbasVisiveis`, `kbTrocarAba`, `kbParar`.
- Produces: `kbEstado.prospecPode:boolean`, `prospecCarregar():Promise`, `prospecRender()`, `prospecAbrirFicha(id)`, `prospecParar()`. Estado em `prospecEstado = {lista, meus, busca, pegando:Set, fichaId, timer, semAcesso}`.

- [ ] **Step 1: Escrever o teste do fluxo (que falha)**

No `test_prospeccao.js`, trocar a linha `// __FLUXO__ (Task 3 acrescenta aqui)` por:

```js
  // ==== fluxo no painel ====
  const chamadas = (n) => window.__rpcCalls.filter(c => c.nome === n);
  window.__tabelas.config = [{ valor: 'painel' }];
  window.__tabelas.leads_equipe = [{ id: 1, profile_id: 'u-a', nome_planilha: 'ZZA', pode_pegar: true }];
  window.__rpcRespostas.leads_kanban3 = { data: [], error: null };
  window.__rpcRespostas.leads_hoje = { data: { fila: [], retornos: [], livres: 0, placar: {} }, error: null };
  window.__rpcRespostas.leads_alertas = { data: [], error: null };
  // sem acesso: botão escondido
  currentUser = { id: 'u-fora', nome: 'Zz Fora', role: 'consultor' };
  window.__rpcRespostas.prospec_pode = { data: false, error: null };
  await kbAplicarPermissao(); kbTrocarAba('prospec'); await espera(30);
  assert(document.querySelector('#kbAbas [data-kb-aba="prospec"]').style.display === 'none', 'sem acesso: botão escondido');
  eq(chamadas('prospec_listar').length, 0, 'sem acesso: não lista');
  // com acesso
  currentUser = { id: 'u-a', nome: 'Zzkcon Teste', role: 'consultor' };
  window.__rpcRespostas.prospec_pode = { data: true, error: null };
  let lista = [C({ id: 1 }), C({ id: 2, etapa: 'contato', dono_id: 'u-a', dono_nome: 'Zzkcon Teste' }), C({ id: 3, etapa: 'contato', dono_id: 'u-b', dono_nome: 'Zz Outra' })];
  window.__rpcRespostas.prospec_listar = () => ({ data: JSON.parse(JSON.stringify(lista)), error: null });
  await kbAplicarPermissao(); kbTrocarAba('prospec'); await espera(40);
  assert(document.querySelector('#kbAbas [data-kb-aba="prospec"]').style.display === '', 'com acesso: botão aparece');
  assert(document.getElementById('kbProspec').style.display === '' && document.getElementById('kbBoard').style.display === 'none', 'só a Prospecção visível');
  const col = (v) => document.querySelector('#prospecBoard .kbCol[data-prospec-col="' + v + '"]');
  eq(col('livre').querySelectorAll('.kbCard').length, 1, '1 livre');
  eq(col('contato').querySelectorAll('.kbCard').length, 2, '2 em contato');
  eq(col('contato').querySelector('.kbConta').textContent, '2', 'contador');
  // Meus
  document.querySelector('[data-prospec-filtro="meus"]').click(); await espera(10);
  eq(col('contato').querySelectorAll('.kbCard').length, 1, 'Meus: só os meus');
  document.querySelector('[data-prospec-filtro="todos"]').click(); await espera(10);
  // Pegar: desabilita durante a chamada; ja_tem_dono vira aviso info
  let soltar; window.__rpcRespostas.prospec_pegar = () => new Promise(r => { soltar = () => r({ data: { ok: false, motivo: 'ja_tem_dono', dono: 'Zz Outra' }, error: null }); });
  col('livre').querySelector('[data-prospec-pegar="1"]').click(); await espera(5);
  assert(col('livre').querySelector('[data-prospec-pegar="1"]').disabled, 'Pegar desabilitado durante a chamada');
  col('livre').querySelector('[data-prospec-pegar="1"]').click(); await espera(5);
  eq(chamadas('prospec_pegar').length, 1, 'duplo clique: uma chamada só');
  soltar(); await espera(30);
  eq(chamadas('prospec_pegar')[0].args, { p_id: 1 }, 'args do pegar');
  assert(window.__alertas.includes('Esse cliente já foi pego por Zz Outra'), 'aviso ja_tem_dono');
  // WhatsApp e Ligar
  col('livre').querySelector('[data-prospec-whats="1"]').click(); await espera(5);
  assert(window.__abertos.length === 1 && window.__abertos[0].url.startsWith('https://wa.me/5511900000001?text=Ol%C3%A1%2C%20Zzksocio!%20Aqui%20%C3%A9%20Zzkcon'), 'WhatsApp abre wa.me com texto');
  // Ficha: abre, valida retorno sem data, salva, e o timer não apaga o texto
  col('contato').querySelector('[data-prospec-id="2"]').click(); await espera(10);
  const ov = document.getElementById('prospecOverlay');
  assert(ov.classList.contains('active') && ov.querySelector('[data-prospec-salvar="2"]'), 'ficha do meu cliente abre editável');
  ov.querySelector('[data-prospec-etapa="retornar"]').click();
  assert(!ov.querySelector('#prospecRetornoCampo').hidden, 'Retornar mostra o campo de data');
  ov.querySelector('#prospecObs').value = 'Zz digitando';
  await prospecCarregar(); await espera(10);
  eq(ov.querySelector('#prospecObs').value, 'Zz digitando', 'recarga não apaga o que foi digitado');
  ov.querySelector('[data-prospec-salvar="2"]').click(); await espera(10);
  eq(ov.querySelector('#prospecErro').textContent, 'Escolha a data e a hora do retorno.', 'retornar sem data: erro local');
  eq(chamadas('prospec_mover').length, 0, 'sem chamada ao banco');
  ov.querySelector('#prospecRetorno').value = '2026-11-21T10:30';
  window.__rpcRespostas.prospec_mover = { data: { ok: true }, error: null };
  ov.querySelector('[data-prospec-salvar="2"]').click(); await espera(200);   // fecharOverlay anima 150 ms
  const mv = chamadas('prospec_mover')[0].args;
  assert(mv.p_id === 2 && mv.p_etapa === 'retornar' && mv.p_obs === 'Zz digitando' && mv.p_retorno_em === new Date('2026-11-21T10:30').toISOString(), 'args do mover');
  assert(!ov.classList.contains('active'), 'salvar fecha a ficha');
  // ficha de outro: só leitura
  col('contato').querySelector('[data-prospec-id="3"]').click(); await espera(10);
  assert(!ov.querySelector('[data-prospec-salvar]') && ov.textContent.includes('Com Zz Outra'), 'outro: só leitura');
  fecharOverlay(ov);
  // perde o acesso com o painel aberto
  window.__rpcRespostas.prospec_listar = { data: null, error: { code: '42501', message: 'sem permissão' } };
  await prospecCarregar(); await espera(10);
  assert(document.getElementById('prospecBoard').textContent.includes('Você não tem acesso à Prospecção'), 'sem acesso: mensagem');
  eq(prospecEstado.timer, null, 'sem acesso: timer parado');
  // sair para
  kbParar();
  eq(prospecEstado.lista.length, 0, 'logout limpa a lista');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `bash run_tests.sh test_prospeccao.js`
Esperado: FAIL com `Cannot read properties of null (reading 'style')` (o botão `data-kb-aba="prospec"` ainda não existe).

- [ ] **Step 3: HTML e CSS**

(a) No `#kbAbas`, depois de `<button type="button" data-kb-aba="conversao">Conversão</button>`:

```html
          <button type="button" data-kb-aba="prospec" style="display:none">Prospecção</button>
```

(b) Imediatamente antes de `<div class="kbBoard" id="kbBoard"></div>`:

```html
      <!-- §161: Prospecção (Caio e Lúria, temporária) -->
      <div id="kbProspec" class="prospec" style="display:none">
        <div class="prospecTopo">
          <button type="button" class="filterPill active" data-prospec-filtro="todos">Todos</button>
          <button type="button" class="filterPill" data-prospec-filtro="meus">Meus</button>
          <input type="search" id="prospecBusca" class="kbBusca kbListaBusca" placeholder="Buscar por empresa, sócio, CNPJ ou telefone" autocomplete="off" aria-label="Buscar na Prospecção">
          <span class="kbStatusLinha" id="prospecStatus"></span>
        </div>
        <div class="prospecBoard" id="prospecBoard"></div>
      </div>
```

(c) Depois do fecho do `#profileOverlay` (`</div>` que fecha a `.overlay`):

```html
<div class="overlay" id="prospecOverlay">
  <div class="modal" style="max-width:620px">
    <div class="mHead">
      <button class="mClose" data-prospec-fechar>&times;</button>
      <h2 id="prospecFichaTitulo"></h2>
      <div class="mCnpj" id="prospecFichaSub"></div>
    </div>
    <div class="mBody" id="prospecFichaCorpo"></div>
  </div>
</div>
```

(d) CSS, depois da regra `.kbVisao.active span{…}`:

```css
  /* §161 Prospecção */
  .prospecTopo{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 var(--space-3);}
  .prospecTopo .kbBusca{flex:1 1 240px;max-width:420px;}
  .prospecBoard{display:flex;gap:14px;overflow-x:auto;padding:2px 2px var(--space-3);align-items:stretch;height:calc(100vh - 250px);min-height:420px;}
  .prospecTel{font-size:var(--fs-sm);font-weight:600;color:var(--ml-ink);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}
  .prospecSelo{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--ml-line);color:var(--ml-ink-3);}
  .prospecSeloWhats{border-color:var(--st-ganho);color:var(--st-ganho);}
  .kbCard.prospecMeu{box-shadow:inset 3px 0 0 var(--c-sinal);}
  .prospecFichaTel{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
  .prospecEtapas{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0;}
  .prospecFichaAcoes{display:flex;gap:8px;flex-wrap:wrap;}
  .prospecErro{color:var(--red);font-size:var(--fs-sm);min-height:1em;margin:4px 0;}
  .prospecDados{margin-top:14px;}
  .prospecDados .tbl th{text-align:left;white-space:nowrap;}
  @media (max-width: 720px){ .prospecBoard{height:auto;} }
```

Antes de usar, conferir com `grep -n "\-\-ml-line\|\-\-ml-ink-3\|\-\-fs-sm\|\-\-red:" _template.html | head`. Se `--ml-line` não existir, usar a variável de borda que `.kbCard` usa (copiar da regra `.kbCard{`).

- [ ] **Step 4: Ganchos no código existente**

(a) Em `kbAbasVisiveis`, trocar a última linha `return cvPodeVer() ? abas.concat('conversao') : abas;` por:

```js
  return (cvPodeVer() ? abas.concat('conversao') : abas).concat(kbEstado.prospecPode ? ['prospec'] : []);   // §161
```

(b) Em `kbAplicarPermissao`, logo depois de `if(kbPodeVer()) await kbCarregarBloqueio();`:

```js
  kbEstado.prospecPode = false;   // §161: Prospecção só para quem está em prospec_acesso (e admin)
  if(kbPodeVer()){ const p = await ppSeguro(() => sb.rpc('prospec_pode')); kbEstado.prospecPode = !!(p && !p.error && p.data === true); }
```

(c) Em `kbTrocarAba`:
- trocar `document.getElementById('kbResumo').style.display = kbEstado.aba === 'hoje' ? 'none' : '';` por `document.getElementById('kbResumo').style.display = kbEstado.aba === 'hoje' || kbEstado.aba === 'prospec' ? 'none' : '';`;
- depois da linha do `cvConversao`, acrescentar `document.getElementById('kbProspec').style.display = kbEstado.aba === 'prospec' ? '' : 'none';   // §161`;
- no fim da função, depois de `if(kbEstado.aba === 'conversao') cvCarregar();`, acrescentar `if(kbEstado.aba === 'prospec') prospecCarregar(); else prospecPararTimer();`.

(d) Em `kbParar`, como primeira linha do corpo: `prospecParar();   // §161`.

- [ ] **Step 5: JS do quadro, das ações e da ficha**

Depois do bloco da Task 2:

```js
const prospecEstado = { lista: [], meus: false, busca: '', pegando: new Set(), fichaId: null, timer: null, semAcesso: false };
function prospecPararTimer(){ clearInterval(prospecEstado.timer); prospecEstado.timer = null; }
function prospecParar(){
  prospecPararTimer();
  prospecEstado.lista = []; prospecEstado.pegando = new Set(); prospecEstado.fichaId = null; prospecEstado.semAcesso = false;
  const b = document.getElementById('prospecBoard'); if(b) b.innerHTML = '';
  const ov = document.getElementById('prospecOverlay'); if(ov) ov.classList.remove('active');
}
async function prospecCarregar(){
  if(!kbEstado.prospecPode) return;
  const r = await ppSeguro(() => sb.rpc('prospec_listar'));
  if(r && r.error && (r.error.code === '42501' || /permiss/.test(r.error.message || ''))){
    prospecEstado.semAcesso = true; prospecPararTimer(); prospecRender(); return;
  }
  if(!r || r.error){ document.getElementById('prospecStatus').textContent = 'Não foi possível atualizar agora. Tenta de novo em 1 min.'; }
  else { prospecEstado.semAcesso = false; prospecEstado.lista = Array.isArray(r.data) ? r.data : []; }
  prospecRender();
  if(!prospecEstado.timer && !prospecEstado.semAcesso){
    prospecEstado.timer = setInterval(() => {
      if(kbEstado.aba === 'prospec' && document.visibilityState === 'visible' && document.getElementById('panel-meusleads').classList.contains('active')) prospecCarregar();
    }, 60000);
  }
}
function prospecRender(){
  const board = document.getElementById('prospecBoard');
  if(prospecEstado.semAcesso){ board.innerHTML = '<div class="kbVazio">Você não tem acesso à Prospecção.</div>'; return; }
  const uid = currentUser && currentUser.id, agoraMs = Date.now();
  const g = prospecAgrupar(prospecFiltrar(prospecEstado.lista, { meus: prospecEstado.meus, uid, busca: prospecEstado.busca }));
  board.innerHTML = PROSPEC_ETAPAS.map(([v, rot]) => `<div class="kbCol" data-prospec-col="${v}"><div class="kbColTopo"><i class="kbColCor"></i><h4>${rot}</h4><span class="kbConta">${g[v].length}</span></div><div class="kbColLista">${g[v].map(c => prospecCardHtml(c, { uid, agoraMs, pegando: prospecEstado.pegando })).join('') || '<div class="kbVazio">Nada aqui</div>'}</div></div>`).join('');
  const meus = prospecEstado.lista.filter(c => c.dono_id === uid).length, livres = prospecEstado.lista.filter(c => !c.dono_id).length;
  document.getElementById('prospecStatus').textContent = `${livres} livre(s) · ${meus} seu(s) · atualiza a cada 1 min`;
  document.querySelectorAll('[data-prospec-filtro]').forEach(b => b.classList.toggle('active', (b.dataset.prospecFiltro === 'meus') === prospecEstado.meus));
}
function prospecPorId(id){ return prospecEstado.lista.find(c => String(c.id) === String(id)) || null; }
async function prospecPegar(id){
  id = Number(id);
  if(prospecEstado.pegando.has(id)) return;
  prospecEstado.pegando.add(id); prospecRender();
  const r = await ppSeguro(() => sb.rpc('prospec_pegar', { p_id: id }));
  prospecEstado.pegando.delete(id);
  if(!r || r.error) mostrarAviso('Não foi possível pegar o cliente agora.', 'erro');
  else if(r.data && r.data.ok === false) mostrarAviso(`Esse cliente já foi pego por ${r.data.dono || 'outro consultor'}`, 'info');
  else mostrarAviso('Cliente é seu agora.', 'ok');
  await prospecCarregar();
  if(prospecEstado.fichaId === id) prospecAbrirFicha(id);
}
function prospecAbrirFicha(id){
  const c = prospecPorId(id); if(!c) return;
  prospecEstado.fichaId = c.id;
  document.getElementById('prospecFichaTitulo').textContent = prospecNome(c);
  document.getElementById('prospecFichaSub').textContent = [prospecCnpjFmt(c.cnpj), [c.cidade, c.uf].filter(Boolean).join('/'), c.segmento, c.porte].filter(Boolean).join(' · ');
  document.getElementById('prospecFichaCorpo').innerHTML = prospecFichaHtml(c, { uid: currentUser && currentUser.id, admin: !!currentUser && currentUser.role === 'admin', agoraMs: Date.now() });
  document.getElementById('prospecOverlay').classList.add('active');
}
async function prospecSalvar(id, etapa){
  const ov = document.getElementById('prospecOverlay'), erro = ov.querySelector('#prospecErro');
  const sel = ov.querySelector('[data-prospec-etapa].active');
  const p_etapa = etapa || (sel ? sel.dataset.prospecEtapa : (prospecPorId(id) || {}).etapa);
  const ret = ov.querySelector('#prospecRetorno'), obs = ov.querySelector('#prospecObs');
  const p_retorno_em = p_etapa === 'retornar' && ret && ret.value ? new Date(ret.value).toISOString() : null;
  if(p_etapa === 'retornar' && !p_retorno_em){ if(erro) erro.textContent = 'Escolha a data e a hora do retorno.'; return; }
  const r = await ppSeguro(() => sb.rpc('prospec_mover', { p_id: Number(id), p_etapa, p_retorno_em, p_obs: obs ? obs.value : null }));
  if(!r || r.error){ if(erro) erro.textContent = (r && r.error && r.error.message) || 'Não foi possível salvar agora.'; return; }
  prospecEstado.fichaId = null; fecharOverlay(ov);
  mostrarAviso(p_etapa === 'livre' ? 'Cliente voltou para Livres.' : 'Salvo.', 'ok');
  await prospecCarregar();
}
document.getElementById('kbProspec').addEventListener('click', (e) => {
  const f = e.target.closest('[data-prospec-filtro]');
  if(f){ prospecEstado.meus = f.dataset.prospecFiltro === 'meus'; prospecRender(); return; }
  const pg = e.target.closest('[data-prospec-pegar]');
  if(pg){ e.preventDefault(); prospecPegar(pg.dataset.prospecPegar); return; }
  if(prospecContato(e)) return;
  const card = e.target.closest('[data-prospec-id]');
  if(card) prospecAbrirFicha(card.dataset.prospecId);
});
document.getElementById('prospecBusca').addEventListener('input', (e) => { prospecEstado.busca = e.target.value; prospecRender(); });
function prospecContato(e){
  const w = e.target.closest('[data-prospec-whats]'), l = e.target.closest('[data-prospec-ligar]');
  if(!w && !l) return false;
  e.preventDefault();
  const c = prospecPorId((w || l).dataset[w ? 'prospecWhats' : 'prospecLigar']);
  if(!c) return true;
  if(w){ const link = prospecWhatsLink(c, currentUser && currentUser.nome); if(link) window.open(link, '_blank', 'noopener'); }
  else kbLigar(prospecTelInfo(c).numero);
  return true;
}
document.getElementById('prospecOverlay').addEventListener('click', (e) => {
  const ov = document.getElementById('prospecOverlay');
  if(e.target === ov || e.target.closest('[data-prospec-fechar]')){ prospecEstado.fichaId = null; fecharOverlay(ov); return; }
  const et = e.target.closest('[data-prospec-etapa]');
  if(et){
    ov.querySelectorAll('[data-prospec-etapa]').forEach(b => b.classList.toggle('active', b === et));
    const campo = ov.querySelector('#prospecRetornoCampo'); if(campo) campo.hidden = et.dataset.prospecEtapa !== 'retornar';
    const erro = ov.querySelector('#prospecErro'); if(erro) erro.textContent = '';
    return;
  }
  const pg = e.target.closest('[data-prospec-pegar]'); if(pg){ prospecPegar(pg.dataset.prospecPegar); return; }
  const sv = e.target.closest('[data-prospec-salvar]'); if(sv){ prospecSalvar(sv.dataset.prospecSalvar); return; }
  const so = e.target.closest('[data-prospec-soltar]'); if(so){ prospecSalvar(so.dataset.prospecSoltar, 'livre'); return; }
  prospecContato(e);
});
```

A ficha não é refeita pela recarga: `prospecRender` só mexe no `#prospecBoard`, então o texto digitado fica. Isso cobre o item 5 do Review Focus.

- [ ] **Step 6: Gerar e rodar o teste**

Run: `bash run_tests.sh test_prospeccao.js`
Esperado: `TOTAL: 1 passaram, 0 falharam`. Se falhar, ler o log em `${TMPDIR:-/tmp}/apex_tests/test_prospeccao.js.log`.

- [ ] **Step 7: Rodar os testes vizinhos do Meus leads**

Run: `bash run_tests.sh "test_leads_kanban.js test_meus_leads_redesign.js test_meus_leads_fase2.js test_meus_leads_fase3.js test_leads_painel_hoje.js test_agencia_lista.js test_conversao_leads.js test_alterar_cnpj.js test_socios_aba.js"`
Esperado: nenhuma falha nova. Se algum teste contar chamadas de RPC e quebrar por causa do `prospec_pode`, ajustar só o gancho (por exemplo, chamar `prospec_pode` apenas quando `currentUser.role` for `consultor` ou `admin`), nunca o teste antigo.

- [ ] **Step 8: Commit**

```bash
git add _template.html test_prospeccao.js
git commit -m "feat(painel): §161 subaba Prospecção — quadro, Pegar, WhatsApp, Ligar e ficha

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Aplicar no banco e carregar a planilha (com ok do Rafael)

**Files:**
- Fora do repo: `C:\Users\acer1\AppData\Local\Temp\claude\9b94acc3705bfe6b\4ed26745-c011-48d0-9fa1-74760c8bc07f\scratchpad\prospeccao\carga.py` e os CSVs (nunca entram no git).

**Interfaces:**
- Consumes: as tabelas e funções da Task 1, já aplicadas.
- Produces: 179 linhas em `prospec_clientes`, das quais ~156 `pendente` para a Task 5.

- [ ] **Step 1: Pedir ok e aplicar a migration**

Com o ok do Rafael, rodar o conteúdo de `supabase/migrations/20261119180000_prospeccao.sql` com `execute_sql`. Ele já tem `begin;` e `commit;`.
Conferir com `select count(*) from prospec_acesso;` (esperado 2) e rodando o arquivo `supabase/tests/prospeccao_check.sql` inteiro (ele já abre com `begin;` e termina em `rollback;`; esperado `OK`, nada fica).

- [ ] **Step 2: Baixar as duas guias**

```bash
D="/c/Users/acer1/AppData/Local/Temp/claude/9b94acc3705bfe6b/4ed26745-c011-48d0-9fa1-74760c8bc07f/scratchpad/prospeccao"; mkdir -p "$D/dados"
U="https://docs.google.com/spreadsheets/d/<ID_DA_PLANILHA: link enviado pelo Rafael, fora do repo>/export?format=csv"
curl -sL -o "$D/dados/caio.csv" "$U&gid=0"; curl -sL -o "$D/dados/luria.csv" "$U&gid=<GID_DA_GUIA_LURIA>"
wc -l "$D/dados/"*.csv   # esperado: caio 19 linhas, luria 162
```

- [ ] **Step 3: Escrever o gerador do SQL**

Criar `$D/carga.py`:

```python
import csv, json, re, sys
D = sys.argv[1]
def dig(s): return re.sub(r'\D', '', s or '')
def limpo(v):
    v = (v or '').strip()
    return None if v == '' or v.startswith('#') else v
def tel(v):
    d = dig(v)
    if len(d) in (12, 13) and d.startswith('55'): d = d[2:]
    return d if len(d) in (10, 11) else None
def q(v): return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"
linhas = []
with open(f'{D}/dados/caio.csv', encoding='utf-8') as f:
    r = list(csv.reader(f)); h = r[0]
    for row in r[1:]:
        d = dict(zip(h, row)); cnpj = dig(d['NR_CPF_CNPJ_ASSINANTE']).zfill(14)
        w, cel, fixo = tel(d.get('whatsapp')), tel(d.get('celular')), tel(d.get('telefone'))
        numero = w or cel or fixo
        wpp = True if w else None
        dados = {k: limpo(v) for k, v in d.items() if k and limpo(v) is not None and k != 'cnpj'}
        linhas.append(dict(cnpj=cnpj, aba='CAIO', razao=limpo(d['razao_social']), cidade=limpo(d['cidade']) or limpo(d['NM_CIDADE']),
                           uf=limpo(d['estado']), seg=limpo(d['segmento']), porte=limpo(d['porte']), obs=limpo(d['campanha_obs']),
                           dados=dados, tel=numero, wpp=wpp))
with open(f'{D}/dados/luria.csv', encoding='utf-8') as f:
    r = list(csv.reader(f)); h = r[0][:8] + ['', '', 'telefone']
    for row in r[1:]:
        d = dict(zip(h, row)); cnpj = dig(d['cnpj_normalizado']).zfill(14)
        dados = {k: limpo(v) for k, v in d.items() if k and limpo(v) is not None}
        linhas.append(dict(cnpj=cnpj, aba='LURIA', razao=limpo(d['razao_social']), cidade=None, uf=None, seg=None, porte=None, obs=None,
                           dados=dados, tel=tel(d['telefone']), wpp=None))
assert len(linhas) == 179 and len({l['cnpj'] for l in linhas}) == 179 and all(len(l['cnpj']) == 14 for l in linhas), 'conferir CNPJs'
vals = ',\n'.join(
    f"({q(l['cnpj'])},{q(l['aba'])},{q(l['razao'])},{q(l['cidade'])},{q(l['uf'])},{q(l['seg'])},{q(l['porte'])},{q(l['obs'])},"
    f"{q(json.dumps(l['dados'], ensure_ascii=False))}::jsonb,{q(l['tel'])},{'true' if l['wpp'] else 'null'},{q('nao_precisa' if l['tel'] else 'pendente')})"
    for l in linhas)
sql = ("insert into public.prospec_clientes (cnpj, aba_origem, razao_social, cidade, uf, segmento, porte, obs_planilha, dados, telefone_planilha, whatsapp, nv_status) values\n"
       + vals + "\non conflict (cnpj) do nothing;")
open(f'{D}/carga.sql', 'w', encoding='utf-8').write(sql)
print('linhas', len(linhas), 'com telefone', sum(1 for l in linhas if l['tel']), 'pendentes', sum(1 for l in linhas if not l['tel']))
```

Run: `python -I "$D/carga.py" "$D"`
Esperado: `linhas 179 com telefone 23 pendentes 156`. Esses números saem da conferência de 19/11; se mudarem, a planilha mudou e é preciso avisar o Rafael. Se o CSV vier com `�` no lugar de acento, baixar de novo com `python -I -c "import urllib.request,sys; open(sys.argv[2],'wb').write(urllib.request.urlopen(sys.argv[1]).read())" "<url>" "<arquivo>"` e repetir.

- [ ] **Step 4: Pedir ok e rodar a carga**

Com o ok do Rafael, rodar o conteúdo de `$D/carga.sql` com `execute_sql`.
Conferir:
```sql
select aba_origem, nv_status, count(*) from public.prospec_clientes group by 1, 2 order by 1, 2;
```
Esperado: CAIO com 15 `nao_precisa` e 3 `pendente`; LURIA com 8 `nao_precisa` e 153 `pendente`; total 179.

---

### Task 5: Nova Vida — consultar os pendentes (com ok do Rafael, depois das 21h)

**Files:** nenhum no repo.

**Interfaces:**
- Consumes: `socios_consultas`, `socios_disparar_robo()`, o workflow `socios.yml` do robô (sem mudança), e `prospec_aplicar_nv()` da Task 1.

- [ ] **Step 1: Confirmar o horário e o usuário**

Hora de SP pelo banco: `select now() at time zone 'America/Sao_Paulo';` (o relógio do Git Bash está em UTC). Tem que ser ≥ 21:00.
Achar o profile do Rafael: `select id, nome from public.profiles where role = 'admin' order by nome;` e confirmar o nome com ele.
Pedir o ok. Lembrar o Rafael de avisar o time que a Nova Vida vai ficar em uso pelo robô.

- [ ] **Step 2: Reaproveitar o que já foi consultado e enfileirar o resto**

Trocar `:RAFAEL` pelo uuid confirmado no Step 1 antes de rodar:

```sql
begin;
update public.prospec_clientes p set nv_consulta_id = x.id
  from (select distinct on (cnpj_digits) id, cnpj_digits from public.socios_consultas
         where status in ('pronto', 'sem_socios') and concluido_em > now() - interval '30 days'
         order by cnpj_digits, concluido_em desc) x
 where p.cnpj = x.cnpj_digits and p.nv_status = 'pendente' and p.nv_consulta_id is null;
with novos as (
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, razao_social, disparado_em)
  select p.cnpj, 'prospeccao', ':RAFAEL'::uuid, 'pendente', p.razao_social, now()
    from public.prospec_clientes p where p.nv_status = 'pendente' and p.nv_consulta_id is null
  returning id, cnpj_digits)
update public.prospec_clientes p set nv_consulta_id = n.id from novos n where p.cnpj = n.cnpj_digits;
commit;
select public.socios_disparar_robo();
select count(*) filter (where nv_consulta_id is not null) as vinculados, count(*) filter (where nv_status = 'pendente') as pendentes from public.prospec_clientes;
```

Esperado: `vinculados = pendentes` (~156).

- [ ] **Step 3: Acompanhar as rodadas**

A cada ~8 min:
```sql
select status, count(*) from public.socios_consultas where origem = 'prospeccao' group by 1;
```
Quando não houver `consultando` e ainda houver `pendente`, a rodada acabou: rodar `select public.socios_disparar_robo();` de novo. Repetir até `pendente = 0`, umas 4 a 6 rodadas.
Se uma rodada terminar com muitos `erro` e o texto `Falha no login da Nova Vida.`, parar e avisar o Rafael, sem insistir: pode ser sessão derrubada ou reCAPTCHA.

- [ ] **Step 4: Gravar os números escolhidos**

```sql
select public.prospec_aplicar_nv();
select nv_status, whatsapp, count(*) from public.prospec_clientes where nv_status <> 'nao_precisa' group by 1, 2 order by 1, 2;
```
Relatar ao Rafael quantos ficaram `ok` com WhatsApp, `ok` sem WhatsApp, `sem_telefone`, `sem_socios` e `erro`.
Para dar uma segunda chance aos de erro (só com ok):
```sql
update public.prospec_clientes set nv_status = 'pendente', nv_consulta_id = null where nv_status = 'erro';
```
e repetir os Steps 2 a 4.

---

### Task 6: Publicar, REGRAS §161 e push (com ok do Rafael)

**Files:**
- Modify: `REGRAS_NEGOCIO.md`

- [ ] **Step 1: Juntar com a oficial e rodar a suíte**

```bash
cd /c/Users/acer1/Downloads/apex-smart-solutions/.worktrees/prospeccao
git fetch oficial && git merge oficial/main   # conflito no _template.html: seguir a receita do CLAUDE.md (base64 do dashboard)
NODE_PATH=C:/Users/acer1/Downloads/apex-smart-solutions/crm/node_modules bash run_tests.sh
```
Esperado: só as falhas conhecidas na `oficial/main` (`test_pedidos_alerta` por causa do exceljs, `test_conversao_vendas` instável e `test_redesign_shell`, se ainda falhar lá). Qualquer outra falha bloqueia: corrigir.

- [ ] **Step 2: Comparar com o ar e publicar**

Seguir o fluxo da memória `apex-publicacao-painel`:
- baixar o painel do ar e comparar com o `painel_clientes_apex.html` gerado (se o ar tiver algo a mais, juntar);
- contar `<div` / `</div>` do template contra a `oficial/main` (a diferença tem que bater com o HTML novo: +5 aberturas e +5 fechamentos);
- pedir ok ao Rafael;
- fazer o backup em `~/deploy_backups/`;
- no mesmo comando, conferir o MD5 do ar e só então rodar o `scp`;
- conferir o MD5 depois;
- rodar `vigia/vigia_painel.ps1 -Aceitar`.

- [ ] **Step 3: REGRAS §161**

Depois de `git fetch oficial`, conferir que §161 ainda está livre. Acrescentar a seção §161 no `REGRAS_NEGOCIO.md`, no formato das §157 e §158:
- o que é (subaba temporária);
- quem vê;
- colunas e regra do Pegar;
- regra do número;
- texto do WhatsApp;
- tabelas e RPCs;
- carga e Nova Vida, com data e contagens finais;
- como retirar.

Atualizar também a linha "Próxima livre: §162".

```bash
git add REGRAS_NEGOCIO.md && git commit -m "docs(regras): §161 Prospecção no ar (painel <md5>)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push**

Pedir ao Rafael que rode `! git -C C:/Users/acer1/Downloads/apex-smart-solutions/.worktrees/prospeccao push oficial HEAD:main` (sem force; antes, `git fetch oficial` e merge, se a main andou).

- [ ] **Step 5: Avisar como retirar**

Mandar ao Rafael:
- para esconder a subaba sem publicar: `delete from public.prospec_acesso;`
- a remoção completa (botão, código e tabelas) é uma seção nova quando ele pedir.
