-- §143.1 (07/11, Rafael): aba Renovação — a carteira do time de renovação sai da planilha do Google e vem para o painel.
-- Spec: docs/superpowers/specs/2026-11-07-renovacao-aba-design.md. Plano: docs/superpowers/plans/2026-11-07-renovacao-fase1.md
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_check.sql (desfaz tudo).
begin;

-- Quem é do time de renovação. Só admin muda (a policy profiles_update deixa cada um editar a própria linha).
alter table public.profiles add column if not exists equipe text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_equipe_check') then
    alter table public.profiles add constraint profiles_equipe_check check (equipe is null or equipe = 'renovacao');
  end if;
end $$;
create or replace function public.profiles_trava_equipe()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.equipe is distinct from old.equipe and auth.uid() is not null and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador muda a equipe' using errcode = '42501';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_trava_equipe' and tgrelid = 'public.profiles'::regclass) then
    create trigger profiles_trava_equipe before update on public.profiles for each row execute function public.profiles_trava_equipe();
  end if;
end $$;

create table if not exists public.renovacao_carteira (
  id bigint generated always as identity primary key,
  cnpj_digits text not null unique check (cnpj_digits ~ '^[0-9]{14}$'),
  razao_social text, telefone text, nome_adm text, linhas_voz int, apto text, cidade text, ddd text,
  tempo_contrato_voz int, classificacao text, desconto_claro text,
  dados_claro jsonb not null default '{}'::jsonb,
  consultor_id uuid references public.profiles(id) on delete set null,
  origem text,
  status smallint not null default 1 check (status between 1 and 7),
  data_contato date,
  prox_retorno date,
  canal text check (canal is null or canal in ('WhatsApp', 'Ligação', 'E-mail', 'Visita')),
  linhas_renovadas int check (linhas_renovadas is null or linhas_renovadas >= 0),
  bl_vendida int check (bl_vendida is null or bl_vendida >= 0),
  sol_digitais numeric(12,2) check (sol_digitais is null or sol_digitais >= 0),
  motivo_perda text check (motivo_perda is null or motivo_perda in ('Preço', 'Foi p/ concorrente', 'Sem interesse',
    'Insatisfeito c/ Claro', 'Empresa fechada/baixada', 'Contato inválido', 'Outro')),
  observacoes text,
  na_base boolean not null default true,
  a_completar boolean not null default false,
  importado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
create index if not exists renovacao_carteira_consultor_idx on public.renovacao_carteira (consultor_id) where na_base;

create table if not exists public.renovacao_historico (
  id bigint generated always as identity primary key,
  carteira_id bigint not null references public.renovacao_carteira(id) on delete cascade,
  user_id uuid,
  campo text not null check (campo in ('status', 'consultor')),
  de text, para text, nota text,
  criado_em timestamptz not null default now()
);
create index if not exists renovacao_historico_carteira_idx on public.renovacao_historico (carteira_id, criado_em desc);

-- Regras (spec 4.2). Perdido exige motivo; Renovado exige linhas; ao sair do 1 grava a data do contato.
-- Legado da planilha (a_completar) passa até a próxima mudança de status; quando fica válido, a pendência some.
-- Consultor só mexe no atendimento. a_completar nunca é ligado por UPDATE (só a importação liga, no INSERT).
create or replace function public.renovacao_carteira_validar()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_role text := coalesce(public.get_my_role(), ''); v_mudou boolean := false; v_falha text;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and v_role not in ('admin', 'supervisor') and (
         new.consultor_id is distinct from old.consultor_id or new.cnpj_digits is distinct from old.cnpj_digits
      or new.dados_claro is distinct from old.dados_claro or new.na_base is distinct from old.na_base
      or new.razao_social is distinct from old.razao_social or new.telefone is distinct from old.telefone
      or new.nome_adm is distinct from old.nome_adm or new.linhas_voz is distinct from old.linhas_voz
      or new.apto is distinct from old.apto or new.cidade is distinct from old.cidade or new.ddd is distinct from old.ddd
      or new.tempo_contrato_voz is distinct from old.tempo_contrato_voz or new.classificacao is distinct from old.classificacao
      or new.desconto_claro is distinct from old.desconto_claro or new.origem is distinct from old.origem
      or new.importado_em is distinct from old.importado_em) then
      raise exception 'consultor só altera o atendimento' using errcode = '42501';
    end if;
    new.a_completar := old.a_completar;
    v_mudou := new.status is distinct from old.status;
    if v_mudou and new.status >= 2 and new.data_contato is null then
      new.data_contato := (now() at time zone 'America/Sao_Paulo')::date;
    end if;
    new.atualizado_em := now();
    new.atualizado_por := auth.uid();
  end if;
  new.observacoes := nullif(trim(coalesce(new.observacoes, '')), '');
  v_falha := case
    when new.status = 7 and new.motivo_perda is null then 'Perdido precisa do motivo'
    when new.status = 6 and coalesce(new.linhas_renovadas, 0) < 1 then 'Renovado precisa das linhas renovadas'
  end;
  if v_falha is null then
    new.a_completar := false;
  elsif not (new.a_completar and not v_mudou) then
    raise exception '%', v_falha using errcode = '23514';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_validar' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_validar before insert or update on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_validar();
  end if;
end $$;

create or replace function public.renovacao_carteira_historico()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.status is distinct from old.status then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'status', old.status::text, new.status::text);
  end if;
  if new.consultor_id is distinct from old.consultor_id then
    insert into public.renovacao_historico (carteira_id, user_id, campo, de, para) values (new.id, auth.uid(), 'consultor', old.consultor_id::text, new.consultor_id::text);
  end if;
  return null;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_carteira_historico' and tgrelid = 'public.renovacao_carteira'::regclass) then
    create trigger renovacao_carteira_historico after update on public.renovacao_carteira
      for each row execute function public.renovacao_carteira_historico();
  end if;
end $$;

-- RLS (spec 4.3). Inserir/excluir: ninguém pela API (importação é pela RPC da migration 150100).
alter table public.renovacao_carteira enable row level security;
alter table public.renovacao_historico enable row level security;
revoke insert, delete on table public.renovacao_carteira from anon, authenticated;
revoke insert, update, delete on table public.renovacao_historico from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_carteira' and policyname = 'renovacao_carteira_select') then
    create policy renovacao_carteira_select on public.renovacao_carteira for select to authenticated
      using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_carteira' and policyname = 'renovacao_carteira_update') then
    create policy renovacao_carteira_update on public.renovacao_carteira for update to authenticated
      using (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'))
      with check (consultor_id = auth.uid() or public.get_my_role() in ('admin', 'supervisor'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'renovacao_historico' and policyname = 'renovacao_historico_select') then
    create policy renovacao_historico_select on public.renovacao_historico for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
  end if;
end $$;

-- Resumo (spec 5.3). security_invoker: cada um vê só o que a RLS da carteira deixa.
create or replace view public.renovacao_resumo with (security_invoker = true) as
select c.consultor_id, p.nome as consultor_nome,
       count(*)::int                                                    as carteira,
       count(*) filter (where c.status >= 2)::int                       as contatados,
       count(*) filter (where c.status between 3 and 6)::int            as efetivo_mais,
       count(*) filter (where c.status between 4 and 6)::int            as propostas_mais,
       count(*) filter (where c.status = 6)::int                        as renovados,
       count(*) filter (where c.status = 7)::int                        as perdidos,
       coalesce(sum(c.linhas_renovadas), 0)::int                        as linhas_renovadas,
       coalesce(sum(c.bl_vendida), 0)::int                              as bl_vendida,
       coalesce(sum(c.sol_digitais), 0)::numeric(12,2)                  as sol_digitais,
       count(*) filter (where c.prox_retorno < (now() at time zone 'America/Sao_Paulo')::date and c.status not in (6, 7))::int as retornos_atrasados,
       count(*) filter (where c.a_completar)::int                       as a_completar
  from public.renovacao_carteira c
  left join public.profiles p on p.id = c.consultor_id
 where c.na_base
 group by c.consultor_id, p.nome;
grant select on public.renovacao_resumo to authenticated;

commit;
