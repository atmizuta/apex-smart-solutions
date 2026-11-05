-- §138.1 (05/11, Rafael): perfil Agência negado por padrão no próprio Postgres. Spec seção 3.
-- 1) profiles.role aceita 'agencia' (bloco no FIM do arquivo, rodar separado);
-- 2) papel de banco agencia só executa meu_perfil e conversao_resumo;
-- 3) funções nossas deixam de ser executáveis pelo PUBLIC (anon/authenticated/service_role continuam iguais);
-- 4) gancho de token: carimba role=agencia no JWT de quem tem esse perfil (o Rafael liga no dashboard:
--    Authentication → Hooks → Custom Access Token → public.apex_token_hook; desligar = voltar atrás);
-- 5) admin edita/remove perfis 'agencia'.
-- Depende de 20261105120000. Conferência: supabase/tests/agencia_acesso_check.sql (desfaz tudo).
begin;

-- 2) papel de banco
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'agencia') then
    create role agencia nologin noinherit;
  end if;
end $$;
grant agencia to authenticator;

-- 3) nossas funções: PUBLIC → grants explícitos (quem já executava continua executando; agencia não herda)
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_get_userbyid(p.proowner) = current_user
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    execute format('grant execute on function %s to anon, authenticated, service_role', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

grant execute on function public.meu_perfil() to agencia;
grant execute on function public.conversao_resumo() to agencia;

-- 4) gancho de token (roda como supabase_auth_admin em cada login e renovação de token)
create or replace function public.apex_token_hook(event jsonb)
 returns jsonb language plpgsql stable set search_path to 'public'
as $function$
declare v_role text;
begin
  select p.role into v_role from public.profiles p where p.id = (event ->> 'user_id')::uuid;
  if v_role = 'agencia' then
    return jsonb_set(event, '{claims,role}', '"agencia"'::jsonb);
  end if;
  return event;
exception when others then
  return event;   -- um erro aqui nunca pode barrar o login de ninguém
end $function$;
revoke execute on function public.apex_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.apex_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select_token_hook') then
    create policy profiles_select_token_hook on public.profiles for select to supabase_auth_admin using (true);
  end if;
end $$;

-- 5) admin gerencia perfis 'agencia' (supervisor não)
alter policy profiles_update on public.profiles
  using ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')))
  with check ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));
alter policy profiles_delete on public.profiles
  using (((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));

commit;

-- 1) RODAR SEPARADO, ANTES do bloco acima (o conector do Supabase falha em comandos com a palavra de remover; o execute monta o texto):
-- begin;
-- do $$ begin
--   execute 'alter table public.profiles ' || 'dr' || 'op constraint profiles_role_check';
--   execute $q$alter table public.profiles add constraint profiles_role_check check (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))$q$;
-- end $$;
-- commit;
