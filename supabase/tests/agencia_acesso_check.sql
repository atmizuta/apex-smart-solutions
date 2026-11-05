-- §138.1: o que a agência lê e o que é negado (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql DEPOIS de existir conversao_resumo/meu_perfil (migration 20261105120000 aplicada ou colada antes).
-- Resultado na mensagem 'RESULTADO: ...'. Perfil, usuário e função de teste são fictícios e somem no rollback.
begin;
-- foto de quem executava cada função antes da migration
create temp table zz_antes on commit drop as
  select p.oid, n.nspname || '.' || p.proname as nome,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as autent
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
do $$ begin
  execute 'alter table public.profiles ' || 'dr' || 'op constraint profiles_role_check';
  execute $q$alter table public.profiles add constraint profiles_role_check check (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))$q$;
end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'agencia') then
    create role agencia nologin noinherit;
  end if;
end $$;
grant agencia to authenticator;

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
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

grant execute on function public.meu_perfil() to agencia;
grant execute on function public.conversao_resumo() to agencia;

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
    -- using (true) LITERAL de propósito: o gancho lê profiles como supabase_auth_admin; uma expressão aqui faria o gancho
    -- cair no exception e o token da agência sair como authenticated (o painel e a caderno-ia ainda barram pelo perfil).
  end if;
end $$;

alter policy profiles_update on public.profiles
  using ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')))
  with check ((auth.uid() = id) or ((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));
alter policy profiles_delete on public.profiles
  using (((get_my_role() = 'admin') and (role = any (array['admin', 'supervisor', 'consultor', 'agencia']))) or ((get_my_role() = 'supervisor') and (role = 'consultor')));



-- só para o teste: o postgres do Supabase não é superusuário e precisa ser membro para "set role agencia" (some no rollback)
grant agencia to postgres;
-- função nova criada DEPOIS da migration: tem de nascer fechada para a agência e aberta para anon/authenticated
create function public.zz_teste_privilegio_padrao() returns int language sql as 'select 1';

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000a6e01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz-agencia-teste@exemplo.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-4000-8000-0000000a6e01', 'Zz Agência Teste', 'zz-agencia-teste', 'agencia');

do $$
declare
  v_neg text[] := array[]::text[];
  v_falhou text[] := array[]::text[];
  q text; v_lista text;
  v_ev jsonb; v_admin uuid; v_cons uuid;
begin
  -- gancho: só a agência muda de papel
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;
  select p.id into v_cons from public.profiles p where p.role = 'consultor' limit 1;
  foreach q in array array[v_admin::text, v_cons::text, gen_random_uuid()::text] loop
    v_ev := public.apex_token_hook(jsonb_build_object('user_id', q, 'claims', jsonb_build_object('role', 'authenticated')));
    if (v_ev #>> '{claims,role}') is distinct from 'authenticated' then v_falhou := v_falhou || ('gancho mudou ' || coalesce(q, 'null')); end if;
  end loop;
  v_ev := public.apex_token_hook(jsonb_build_object('user_id', '00000000-0000-4000-8000-0000000a6e01', 'claims', jsonb_build_object('role', 'authenticated')));
  if (v_ev #>> '{claims,role}') is distinct from 'agencia' then v_falhou := v_falhou || 'gancho não carimbou a agência'::text; end if;
  v_ev := public.apex_token_hook('{"user_id":"não-é-uuid","claims":{"role":"authenticated"}}'::jsonb);
  if (v_ev #>> '{claims,role}') is distinct from 'authenticated' then v_falhou := v_falhou || 'gancho com evento ruim'::text; end if;

  -- genéricos (como postgres): nada em public legível pela agência; nenhuma função nossa ou definer executável por ela
  select string_agg(c.relname, ', ') into v_lista from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f') and has_table_privilege('agencia', c.oid, 'select');
  if v_lista is not null then v_falhou := v_falhou || ('agência lê tabela/visão: ' || v_lista); end if;
  select string_agg(c.relname, ', ') into v_lista from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S' and has_sequence_privilege('agencia', c.oid, 'usage');
  if v_lista is not null then v_falhou := v_falhou || ('agência usa sequência: ' || v_lista); end if;
  select string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname) into v_lista
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema') and has_schema_privilege('agencia', n.oid, 'usage')
     and has_function_privilege('agencia', p.oid, 'execute') and p.proname not in ('meu_perfil', 'conversao_resumo')
     and (p.prosecdef or not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'));
  if v_lista is not null then v_falhou := v_falhou || ('agência executa função nossa ou definer: ' || v_lista); end if;
  if has_function_privilege('agencia', 'public.zz_teste_privilegio_padrao()', 'execute') then
    v_falhou := v_falhou || 'função NOVA nasce executável pela agência'::text;
  end if;
  if not has_function_privilege('authenticated', 'public.zz_teste_privilegio_padrao()', 'execute')
     or not has_function_privilege('anon', 'public.zz_teste_privilegio_padrao()', 'execute') then
    v_falhou := v_falhou || 'função NOVA nasce fechada para anon/authenticated'::text;
  end if;

  -- como a agência
  set local role agencia;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000a6e01","role":"agencia"}', true);
  foreach q in array array[
    'select 1 from public.clientes limit 1',
    'select 1 from public.leads limit 1',
    'select 1 from public.profiles limit 1',
    'select 1 from public.config limit 1',
    'select 1 from public.producao_pedidos_neo limit 1',
    'select 1 from public.producao_pedidos_manual limit 1',
    'select 1 from public.leads_kanban3(null, true)',
    'select 1 from public.producao_meus_pedidos()',
    'select 1 from public.reconciliacao_neocrm()',
    'select public.get_my_role()'
  ] loop
    begin
      execute q;
      v_falhou := v_falhou || ('agência conseguiu: ' || q);
    exception
      when insufficient_privilege then v_neg := v_neg || q;
      when undefined_function then v_falhou := v_falhou || ('assinatura errada no teste: ' || q);
    end;
  end loop;
  begin
    perform 1 from public.conversao_resumo();
    perform 1 from public.meu_perfil() m where m.role = 'agencia';
    if not found then v_falhou := v_falhou || 'meu_perfil não devolveu a agência'::text; end if;
  exception when others then v_falhou := v_falhou || ('agência não leu o permitido: ' || sqlerrm);
  end;
  reset role;

  -- anon e authenticated continuam executando o que executavam ANTES da migration (zz_antes, tirada no começo)
  select string_agg(a.nome, ', ') into v_lista from zz_antes a
   where (a.anon and not has_function_privilege('anon', a.oid, 'execute'))
      or (a.autent and not has_function_privilege('authenticated', a.oid, 'execute'));
  if v_lista is not null then v_falhou := v_falhou || ('anon/authenticated perderam execute em: ' || v_lista); end if;

  if array_length(v_falhou, 1) > 0 then raise exception 'FALHOU: %', array_to_string(v_falhou, ' | '); end if;
  raise exception 'RESULTADO: OK — % acessos negados à agência; gancho certo; função nova fechada; anon/authenticated intactos', array_length(v_neg, 1);
end $$;
