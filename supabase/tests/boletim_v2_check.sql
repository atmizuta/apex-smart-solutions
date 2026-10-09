-- Verificação de 20261009100000_boletim_v2.sql (§77). Rodar SOMENTE depois da migration; SEMPRE termina em ROLLBACK.
-- Perfis fictícios (zz*). Falha = exceção com a mensagem do assert.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000b201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.bm2sup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000b202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.bm2cons@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000b201', 'Zzbm2sup Teste',  'zz.bm2sup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000b202', 'Zzbm2cons Teste', 'zz.bm2cons', 'consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;
do $$
declare j jsonb; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  assert to_regclass('public.boletim_acoes') is null, 'boletim_acoes removida';
  assert not exists (select 1 from pg_proc where proname in ('boletim_marcar_acao', 'boletim_resolver_acoes')), 'RPCs de ação removidas';
  assert exists (select 1 from pg_proc where proname = 'boletim_gravar' and pronargs = 4), 'boletim_gravar com 4 argumentos';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b202', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b202', true);
  begin perform public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":2}'); assert false, 'consultor gravou';
  exception when sqlstate '42501' then null; end;
  begin perform public.boletim_obter(null, null); assert false, 'consultor leu';
  exception when sqlstate '42501' then null; end;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000b201', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b201', true);
  begin perform public.boletim_gravar(v_hoje - 1, v_hoje - 2, v_hoje - 2, '{"versao":2}'); assert false, 'gravou dia diferente de hoje';
  exception when sqlstate '22023' then null; end;
  if public.boletim_dia_util(v_hoje) and not exists (select 1 from public.boletim_retratos where dia = v_hoje) then
    execute 'reset role';
    update public.config set valor = (coalesce(valor::jsonb, '{}'::jsonb) || '{"hora":"00:00"}')::text where chave = 'boletim';
    execute 'set local role authenticated';
    j := public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":2,"marca":"primeiro"}');
    assert (j ->> 'gravou')::boolean and j -> 'retrato' ->> 'marca' = 'primeiro' and not (j ? 'acoes'), 'grava sem ações';
    j := public.boletim_gravar(v_hoje, v_hoje - 1, v_hoje - 1, '{"versao":2,"marca":"segundo"}');
    assert not (j ->> 'gravou')::boolean and j -> 'retrato' ->> 'marca' = 'primeiro', 'primeiro ganha';
    assert j ->> 'gerado_por_nome' = 'Zzbm2sup Teste', 'nome de quem gerou';
  end if;
end $$;
select 'BOLETIM V2 OK' as resultado;
rollback;
