-- Operação Campinas (09/10/2026) — REGRAS_NEGOCIO.md seção 78.
-- Spec: docs/superpowers/specs/2026-10-09-operacao-campinas-design.md
-- Fase 1 = separação NA TELA: cada login tem uma operação; cada venda é da operação do vendedor (vínculo consultor_neo).
-- O painel filtra por isso. O RLS da produção NÃO muda aqui (fase 2).
-- Aditiva e sem DROP (roda uma vez). Desfazer: supabase/rollback/20261009200000_operacao_campinas_rollback.sql

-- ---------------------------------------------------------------- 1) operação de cada login
-- 'apex' = padrão: todo mundo que já existe continua na Apex.
alter table public.profiles add column if not exists operacao text not null default 'apex';
alter table public.profiles add constraint profiles_operacao_check check (operacao in ('apex', 'campinas'));

-- O usuário consegue editar a própria linha de profiles (nome/usuário, policy profiles_update): só admin muda a operação.
-- auth.uid() nulo = service_role / SQL do dono (migrations, Edge Functions).
create or replace function public.profiles_trava_operacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.operacao is distinct from old.operacao
     and auth.uid() is not null
     and coalesce(public.get_my_role(), '') <> 'admin' then
    raise exception 'só administrador muda a operação' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_profiles_trava_operacao before update of operacao on public.profiles
  for each row execute function public.profiles_trava_operacao();

-- ---------------------------------------------------------------- 2) operação de cada vendedor do NeoCRM
-- Nome = o que o dashboard usa (producao_pedidos.usuario, maiúsculo): todos os nomes já usados pelo ID do NeoCRM vinculado,
-- mais o nome do perfil (quem ainda não vendeu aparece no "quem zerou" com ele — mesma regra de equipe_vendedores).
-- Vendedor sem vínculo não aparece: o painel trata como Apex.
-- security definer porque o consultor só enxerga a própria linha de consultor_neo/profiles; devolve só nome + operação.
create or replace function public.vendedores_operacao()
returns table (nome text, operacao text)
language sql stable security definer set search_path = public as $$
  select upper(btrim(n.usuario)), p.operacao
    from public.consultor_neo c
    join public.profiles p on p.id = c.profile_id
    join public.producao_pedidos_neo n on n.usuario_id = c.neo_usuario_id
   where coalesce(btrim(n.usuario), '') <> ''
  union
  select upper(btrim(p.nome)), p.operacao
    from public.consultor_neo c
    join public.profiles p on p.id = c.profile_id
   where coalesce(btrim(p.nome), '') <> '';
$$;
revoke all on function public.vendedores_operacao() from public, anon;
grant execute on function public.vendedores_operacao() to authenticated;

-- ---------------------------------------------------------------- 3) dados da Operação Campinas (pedido do Rafael, 09/10/2026)
-- Supervisor de Campinas: era admin (veria as duas operações); vira supervisor.
update public.profiles set role = 'supervisor' where username = 'Jaime' and role = 'admin';
update public.profiles set operacao = 'campinas' where username in ('Jaime', 'VitoriaP', 'Beatriz', 'Ranniele', 'Juan');
-- Vínculo login x ID do NeoCRM dos 4 consultores (IDs vistos em producao_pedidos_neo.usuario_id).
insert into public.consultor_neo (profile_id, neo_usuario_id)
select p.id, v.neo
  from (values ('VitoriaP', 103626::bigint), ('Beatriz', 103627::bigint), ('Ranniele', 103628::bigint), ('Juan', 103629::bigint)) as v(username, neo)
  join public.profiles p on p.username = v.username
on conflict do nothing;
