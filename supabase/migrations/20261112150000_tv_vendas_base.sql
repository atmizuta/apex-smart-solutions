-- §149 TV Vendas (12/11, Rafael) — parte 1: a venda nasce quando o consultor marca ("Vendi!") e a meta do dia.
-- Discador e Renovação marcam pelo vendi(); lead entra pelo gatilho da parte 3. A NEO só confere depois (parte 4).
-- Spec: docs/superpowers/specs/2026-11-12-tv-vendas-design.md. Sem DROP. Aplicar com execute_sql (begin/commit).
-- Conferência: supabase/tests/tv_vendas_base_check.sql (desfaz tudo).
begin;

create table if not exists public.vendas_marcadas (
  id                bigint generated always as identity primary key,
  consultor_id      uuid not null references public.profiles(id) on delete restrict,
  operacao          text not null default 'apex',
  origem            text not null check (origem in ('discador', 'renovacao', 'lead')),
  cnpj              text check (cnpj is null or cnpj ~ '^[0-9]{14}$'),   -- nulo só em venda de lead com CNPJ ruim
  itens             jsonb not null default '[]'::jsonb,                   -- [{plano_id, gb, valor_linha, linhas}]
  linhas            int not null default 0 check (linhas between 0 and 300),
  receita           numeric(12,2) not null check (receita >= 0),
  lead_aba          text,
  lead_id           text,
  dia               date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  marcada_em        timestamptz not null default now(),
  marcada_por       uuid references public.profiles(id) on delete set null,
  cancelada_em      timestamptz,
  cancelada_por     uuid references public.profiles(id) on delete set null,
  motivo_cancel     text,
  neo_status        text not null default 'pendente' check (neo_status in ('pendente', 'confirmada', 'nao_encontrada', 'ok_gestor')),
  neo_pedido        text,
  neo_receita       numeric(12,2),
  neo_usuario       text,
  neo_conferida_em  timestamptz,
  neo_obs           text
);
create unique index if not exists vendas_marcadas_lead_ativa on public.vendas_marcadas (lead_aba, lead_id)
  where cancelada_em is null and lead_id is not null;
create index if not exists vendas_marcadas_op_dia on public.vendas_marcadas (operacao, dia);
create index if not exists vendas_marcadas_pendentes on public.vendas_marcadas (dia)
  where neo_status = 'pendente' and cancelada_em is null;
alter table public.vendas_marcadas enable row level security;   -- sem policy: só pelas funções
revoke all on table public.vendas_marcadas from public, anon, authenticated;

create table if not exists public.tv_meta_dia (
  dia            date primary key,
  meta           int not null check (meta > 0),
  definida_por   uuid references public.profiles(id) on delete set null,
  definida_em    timestamptz not null default now(),
  comemorada_em  timestamptz                       -- META BATIDA! uma vez por dia (tv_meta_comemorar)
);
alter table public.tv_meta_dia enable row level security;
revoke all on table public.tv_meta_dia from public, anon, authenticated;

create or replace function public.tv_hoje()
 returns date language sql stable set search_path to 'public'
as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Quem vê a TV e a conferência: admin, ou supervisor da operação Apex.
create or replace function public.tv_eh_gestor()
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
                  and (p.role = 'admin' or (p.role = 'supervisor' and coalesce(p.operacao, 'apex') = 'apex')))
$$;

-- Itens do pedido: confere e soma (receita = Σ linhas × valor_linha). O valor vem do painel (OFFERS_MOBILE);
-- aqui só a faixa de sanidade.
create or replace function public.vendas_itens_normalizar(p_itens jsonb, out itens jsonb, out linhas int, out receita numeric)
 language plpgsql immutable set search_path to 'public'
as $function$
declare i jsonb; v_l int; v_v numeric; v_gb numeric; v_n int := 0;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Escolha pelo menos um plano.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_itens) > 10 then raise exception 'No máximo 10 planos por pedido.' using errcode = '22023'; end if;
  itens := '[]'::jsonb; linhas := 0; receita := 0;
  for i in select e from jsonb_array_elements(p_itens) e loop
    v_n := v_n + 1;
    begin
      v_l := (i ->> 'linhas')::int;
      v_v := round((i ->> 'valor_linha')::numeric, 2);
      v_gb := nullif(i ->> 'gb', '')::numeric;
    exception when others then
      raise exception 'Plano %: linhas ou valor inválido.', v_n using errcode = '22023';
    end;
    if coalesce(i ->> 'plano_id', '') = '' then raise exception 'Plano %: escolha o plano.', v_n using errcode = '22023'; end if;
    if v_l is null or v_l < 1 or v_l > 300 then raise exception 'Plano %: linhas de 1 a 300.', v_n using errcode = '22023'; end if;
    if v_v is null or v_v < 20 or v_v > 400 then
      raise exception 'Plano %: valor por linha fora da faixa (R$ 20 a R$ 400).', v_n using errcode = '22023';
    end if;
    linhas := linhas + v_l;
    receita := receita + v_l * v_v;
    itens := itens || jsonb_build_array(jsonb_build_object('plano_id', i ->> 'plano_id', 'gb', v_gb, 'valor_linha', v_v, 'linhas', v_l));
  end loop;
  if linhas > 300 then raise exception 'No máximo 300 linhas por pedido.' using errcode = '22023'; end if;
  receita := round(receita, 2);
end $function$;

create or replace function public.vendi(p_cnpj text, p_itens jsonb, p_origem text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_eu record; v_dig text; v_n record; v_id bigint; v_aviso text; v_hora timestamptz;
begin
  select p.id, p.role, coalesce(p.operacao, 'apex') as operacao into v_eu from public.profiles p where p.id = auth.uid();
  if v_eu.id is null then raise exception 'sem login' using errcode = '42501'; end if;
  if v_eu.role not in ('consultor', 'supervisor', 'admin') or (v_eu.role <> 'admin' and v_eu.operacao <> 'apex') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  if p_origem is null or p_origem not in ('discador', 'renovacao') then raise exception 'origem inválida' using errcode = '22023'; end if;
  v_dig := regexp_replace(coalesce(p_cnpj, ''), '[^0-9]', '', 'g');
  if not public.leads_cnpj_valido(v_dig) then raise exception 'CNPJ inválido: confira os 14 números.' using errcode = '22023'; end if;
  select * into v_n from public.vendas_itens_normalizar(p_itens);
  select min(v.marcada_em) into v_hora from public.vendas_marcadas v
   where v.consultor_id = v_eu.id and v.cnpj = v_dig and v.dia = public.tv_hoje() and v.cancelada_em is null;
  if v_hora is not null then
    v_aviso := 'Você já marcou este CNPJ hoje às ' || to_char(v_hora at time zone 'America/Sao_Paulo', 'HH24:MI') || '. Se foi engano, use Desfazer.';
  elsif exists (select 1 from public.vendas_marcadas v where v.cnpj = v_dig and v.origem = 'lead'
                  and v.dia = public.tv_hoje() and v.cancelada_em is null) then
    v_aviso := 'Este CNPJ já virou venda por um lead hoje. Se foi engano, use Desfazer.';
  end if;
  insert into public.vendas_marcadas (consultor_id, operacao, origem, cnpj, itens, linhas, receita, marcada_por)
  values (v_eu.id, 'apex', p_origem, v_dig, v_n.itens, v_n.linhas, v_n.receita, v_eu.id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'receita', v_n.receita, 'linhas', v_n.linhas, 'aviso', v_aviso);
end $function$;

create or replace function public.vendi_cancelar(p_id bigint, p_motivo text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v record; v_gestor boolean := public.tv_eh_gestor();
begin
  if auth.uid() is null then raise exception 'sem login' using errcode = '42501'; end if;
  select * into v from public.vendas_marcadas where id = p_id for update;
  if not found then raise exception 'venda não encontrada' using errcode = 'P0002'; end if;
  if v.cancelada_em is not null then raise exception 'Esta venda já foi cancelada.' using errcode = '22023'; end if;
  if v.origem = 'lead' then raise exception 'Venda de lead: mude o status do lead para tirar a venda.' using errcode = '22023'; end if;
  if v_gestor then
    if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Escreva o motivo (pelo menos 3 letras).' using errcode = '22023'; end if;
  elsif v.consultor_id = auth.uid() then
    if now() - v.marcada_em > interval '10 minutes' then
      raise exception 'Passou de 10 minutos: peça ao gestor para cancelar.' using errcode = '42501';
    end if;
  else
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update public.vendas_marcadas
     set cancelada_em = now(), cancelada_por = auth.uid(),
         motivo_cancel = coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'desfeito pelo consultor')
   where id = p_id;
end $function$;

revoke all on function public.vendas_itens_normalizar(jsonb) from public, anon, authenticated;
revoke all on function public.tv_eh_gestor() from public, anon;
revoke all on function public.vendi(text, jsonb, text) from public, anon;
revoke all on function public.vendi_cancelar(bigint, text) from public, anon;
grant execute on function public.tv_eh_gestor() to authenticated;
grant execute on function public.vendi(text, jsonb, text) to authenticated;
grant execute on function public.vendi_cancelar(bigint, text) to authenticated;

commit;
