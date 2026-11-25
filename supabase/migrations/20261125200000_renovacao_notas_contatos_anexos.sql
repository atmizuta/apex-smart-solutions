-- §165 (25/11, Anderson): ficha do cliente na Renovação — anotações com data e autor, contatos atualizados pelo consultor
-- (os dados oficiais da Claro ficam intactos em dados_claro), anexos (fatura, proposta, documento) e extras (melhor horário, etiquetas).
-- Apagar anotação/contato/anexo: só quem criou e o admin. Anexos em bucket privado; acesso pela RLS da carteira (dono do cliente e gestor).
-- Sem DROP. Aplicar com execute_sql (begin/commit). Conferência: supabase/tests/renovacao_notas_check.sql (desfaz tudo).
begin;

alter table public.renovacao_carteira
  add column if not exists melhor_horario text check (melhor_horario is null or melhor_horario in ('Manhã', 'Tarde', 'Noite', 'Horário comercial')),
  add column if not exists etiquetas text[] not null default '{}' check (coalesce(array_length(etiquetas, 1), 0) <= 10);

-- ===== anotações =====
create table if not exists public.renovacao_notas (
  id bigint generated always as identity primary key,
  carteira_id bigint not null references public.renovacao_carteira(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  texto text not null check (length(btrim(texto)) between 1 and 2000),
  fixada boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists renovacao_notas_carteira_idx on public.renovacao_notas (carteira_id, criado_em desc);

-- ===== contatos =====
create table if not exists public.renovacao_contatos (
  id bigint generated always as identity primary key,
  carteira_id bigint not null references public.renovacao_carteira(id) on delete cascade,
  nome text check (nome is null or length(nome) <= 120),
  cargo text check (cargo is null or length(cargo) <= 80),
  telefone text check (telefone is null or telefone ~ '^[0-9]{10,13}$'),
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  decisor boolean not null default false,
  principal boolean not null default false,
  criado_por uuid not null default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  check (coalesce(nome, telefone, email) is not null)
);
create index if not exists renovacao_contatos_carteira_idx on public.renovacao_contatos (carteira_id);
create unique index if not exists renovacao_contatos_principal_uk on public.renovacao_contatos (carteira_id) where principal;

-- ===== anexos (metadados; o arquivo fica no bucket privado renovacao-anexos, em <carteira_id>/<arquivo>) =====
create table if not exists public.renovacao_anexos (
  id bigint generated always as identity primary key,
  carteira_id bigint not null references public.renovacao_carteira(id) on delete cascade,
  tipo text not null check (tipo in ('fatura', 'proposta', 'documento', 'outro')),
  nome text not null check (length(nome) between 1 and 200),
  caminho text not null unique check (caminho ~ '^[0-9]+/[^/]+$'),
  mime text,
  tamanho integer check (tamanho is null or tamanho between 0 and 10485760),
  user_id uuid not null default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists renovacao_anexos_carteira_idx on public.renovacao_anexos (carteira_id, criado_em desc);

-- ===== gatilhos =====
create or replace function public.renovacao_notas_trava()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.carteira_id is distinct from old.carteira_id or new.user_id is distinct from old.user_id or new.criado_em is distinct from old.criado_em then
      raise exception 'anotação: só o texto e o "fixada" mudam' using errcode = '42501';
    end if;
  elsif auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_notas_trava' and tgrelid = 'public.renovacao_notas'::regclass) then
    create trigger renovacao_notas_trava before insert or update on public.renovacao_notas for each row execute function public.renovacao_notas_trava();
  end if;
end $$;

create or replace function public.renovacao_contatos_trava()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.carteira_id is distinct from old.carteira_id or new.criado_por is distinct from old.criado_por or new.criado_em is distinct from old.criado_em then
      raise exception 'contato: carteira e autor não mudam' using errcode = '42501';
    end if;
  elsif auth.uid() is not null then
    new.criado_por := auth.uid();
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  new.telefone := nullif(regexp_replace(coalesce(new.telefone, ''), '[^0-9]', '', 'g'), '');
  new.nome := nullif(btrim(coalesce(new.nome, '')), '');
  new.cargo := nullif(btrim(coalesce(new.cargo, '')), '');
  new.email := nullif(btrim(coalesce(new.email, '')), '');
  if new.principal then   -- só um principal por cliente: o novo tira o anterior
    update public.renovacao_contatos set principal = false where carteira_id = new.carteira_id and principal and id is distinct from new.id;
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_contatos_trava' and tgrelid = 'public.renovacao_contatos'::regclass) then
    create trigger renovacao_contatos_trava before insert or update on public.renovacao_contatos for each row execute function public.renovacao_contatos_trava();
  end if;
end $$;

create or replace function public.renovacao_anexos_trava()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'anexo não se altera: apague e envie de novo' using errcode = '42501';
  end if;
  if auth.uid() is not null then new.user_id := auth.uid(); end if;
  if split_part(new.caminho, '/', 1) <> new.carteira_id::text then
    raise exception 'anexo: o caminho precisa começar pelo id do cliente' using errcode = '23514';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'renovacao_anexos_trava' and tgrelid = 'public.renovacao_anexos'::regclass) then
    create trigger renovacao_anexos_trava before insert or update on public.renovacao_anexos for each row execute function public.renovacao_anexos_trava();
  end if;
end $$;

-- ===== RLS =====
alter table public.renovacao_notas enable row level security;
alter table public.renovacao_contatos enable row level security;
alter table public.renovacao_anexos enable row level security;
revoke all on table public.renovacao_notas, public.renovacao_contatos, public.renovacao_anexos from anon;
do $$ begin
  -- quem enxerga o cliente (dono, supervisor, admin: RLS da carteira) enxerga e cria
  if not exists (select 1 from pg_policies where tablename = 'renovacao_notas' and policyname = 'renovacao_notas_select') then
    create policy renovacao_notas_select on public.renovacao_notas for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_notas_insert on public.renovacao_notas for insert to authenticated
      with check (user_id = auth.uid() and exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_notas_update on public.renovacao_notas for update to authenticated
      using (user_id = auth.uid() or coalesce(public.get_my_role(), '') = 'admin')
      with check (user_id = auth.uid() or coalesce(public.get_my_role(), '') = 'admin');
    create policy renovacao_notas_delete on public.renovacao_notas for delete to authenticated
      using (user_id = auth.uid() or coalesce(public.get_my_role(), '') = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'renovacao_contatos' and policyname = 'renovacao_contatos_select') then
    create policy renovacao_contatos_select on public.renovacao_contatos for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_contatos_insert on public.renovacao_contatos for insert to authenticated
      with check (criado_por = auth.uid() and exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_contatos_update on public.renovacao_contatos for update to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id))
      with check (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_contatos_delete on public.renovacao_contatos for delete to authenticated
      using (criado_por = auth.uid() or coalesce(public.get_my_role(), '') = 'admin');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'renovacao_anexos' and policyname = 'renovacao_anexos_select') then
    create policy renovacao_anexos_select on public.renovacao_anexos for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_anexos_insert on public.renovacao_anexos for insert to authenticated
      with check (user_id = auth.uid() and exists (select 1 from public.renovacao_carteira c where c.id = carteira_id));
    create policy renovacao_anexos_delete on public.renovacao_anexos for delete to authenticated
      using (user_id = auth.uid() or coalesce(public.get_my_role(), '') = 'admin');
  end if;
end $$;

-- ===== bucket privado + políticas do Storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('renovacao-anexos', 'renovacao-anexos', false, 10485760, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'renovacao_anexos_ler') then
    create policy renovacao_anexos_ler on storage.objects for select to authenticated
      using (bucket_id = 'renovacao-anexos' and (storage.foldername(name))[1] ~ '^[0-9]+$'
             and exists (select 1 from public.renovacao_carteira c where c.id::text = (storage.foldername(name))[1]));
    create policy renovacao_anexos_enviar on storage.objects for insert to authenticated
      with check (bucket_id = 'renovacao-anexos' and (storage.foldername(name))[1] ~ '^[0-9]+$'
             and exists (select 1 from public.renovacao_carteira c where c.id::text = (storage.foldername(name))[1]));
    create policy renovacao_anexos_remover on storage.objects for delete to authenticated
      using (bucket_id = 'renovacao-anexos' and (owner = auth.uid() or coalesce(public.get_my_role(), '') = 'admin'));
  end if;
end $$;

revoke all on function public.renovacao_notas_trava() from public, anon, authenticated;
revoke all on function public.renovacao_contatos_trava() from public, anon, authenticated;
revoke all on function public.renovacao_anexos_trava() from public, anon, authenticated;

commit;
