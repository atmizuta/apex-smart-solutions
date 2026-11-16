-- Verificação da §156 no banco. Roda tudo em transação e desfaz no fim (rollback). Sem dados pessoais na saída:
-- só 'OK' ou a exceção com o nome do caso. Pré-requisito: a migration 20261116200000 aplicada.
begin;
-- atores reais escolhidos pelo banco (só ids em GUCs locais; nada é impresso)
do $prep$
declare v_c bigint; v_dono uuid; v_outro uuid; v_sup uuid; v_cnpj text;
begin
  select c.id, c.consultor_id, c.cnpj_digits into v_c, v_dono, v_cnpj
    from public.renovacao_carteira c
   where c.consultor_id is not null and c.cnpj_digits ~ '^[0-9]{14}$' order by c.id limit 1;
  select p.id into v_outro from public.profiles p where p.role = 'consultor' and p.id <> v_dono order by p.id limit 1;
  select p.id into v_sup from public.profiles p where p.role in ('admin','supervisor') order by p.id limit 1;
  if v_c is null or v_outro is null or v_sup is null then raise exception 'PREP: faltam atores para o teste'; end if;
  perform set_config('teste.carteira', v_c::text, true);
  perform set_config('teste.cnpj', v_cnpj, true);
  perform set_config('teste.dono', v_dono::text, true);
  perform set_config('teste.outro', v_outro::text, true);
  perform set_config('teste.sup', v_sup::text, true);
end $prep$;

do $t$
declare r jsonb; r2 jsonb; n int; c bigint := current_setting('teste.carteira')::bigint;
  como text := '{"role":"authenticated","sub":"%s"}';
begin
  -- 1. outro consultor: sem permissão nas duas RPCs
  perform set_config('request.jwt.claims', format(como, current_setting('teste.outro')), true);
  r := public.socios_pedir(c);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1a: outro consultor pediu: %', r; end if;
  r := public.socios_da_base(c);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1b: outro consultor leu a base'; end if;

  -- 2. dono: base devolve ok com lista (pode ser vazia) e não grava nada
  perform set_config('request.jwt.claims', format(como, current_setting('teste.dono')), true);
  r := public.socios_da_base(c);
  if (r->>'ok')::boolean is not true or jsonb_typeof(r->'socios') <> 'array' then raise exception 'CASO 2: base do dono'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 0 then raise exception 'CASO 2b: socios_da_base gravou pedido'; end if;

  -- 3. dono pede: cria pendente com disparado_em
  r := public.socios_pedir(c);
  if (r->>'ok')::boolean is not true or r->>'status' <> 'pendente' then raise exception 'CASO 3: pedido do dono: %', r; end if;
  if not exists (select 1 from public.socios_consultas where id = (r->>'id')::bigint and disparado_em is not null and pedido_por = current_setting('teste.dono')::uuid)
    then raise exception 'CASO 3b: pedido sem disparado_em/pedido_por'; end if;

  -- 4. pedir de novo com pedido em andamento: devolve o mesmo, não cria outro
  r2 := public.socios_pedir(c);
  if r2->>'id' <> r->>'id' then raise exception 'CASO 4: criou pedido duplicado'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 1 then raise exception 'CASO 4b: % pedidos para o CNPJ', n; end if;

  -- 5. pendente há mais de 3 min: redispara e atualiza disparado_em
  update public.socios_consultas set disparado_em = now() - interval '4 minutes' where id = (r->>'id')::bigint;
  perform public.socios_pedir(c);
  if (select disparado_em from public.socios_consultas where id = (r->>'id')::bigint) < now() - interval '1 minute'
    then raise exception 'CASO 5: não redisparou'; end if;

  -- 6. consultando há mais de 10 min vira erro e libera novo pedido
  update public.socios_consultas set status = 'consultando', iniciado_em = now() - interval '11 minutes' where id = (r->>'id')::bigint;
  r2 := public.socios_pedir(c);
  if (select status from public.socios_consultas where id = (r->>'id')::bigint) <> 'erro' then raise exception 'CASO 6: abandonado não virou erro'; end if;
  if r2->>'id' = r->>'id' or r2->>'status' <> 'pendente' then raise exception 'CASO 6b: não criou novo pedido'; end if;

  -- 7. limite: com 20 pedidos hoje, o 21º é barrado (os de cima já contam 2)
  update public.socios_consultas set status = 'pronto' where cnpj_digits = current_setting('teste.cnpj') and status = 'pendente';
  insert into public.socios_consultas (cnpj_digits, pedido_por, status)
    select '00000000000191', current_setting('teste.dono')::uuid, 'pronto' from generate_series(1, 18);
  r := public.socios_pedir(c);
  if r->>'motivo' is distinct from 'limite' then raise exception 'CASO 7: 21º pedido não foi barrado: %', r; end if;

  -- 8. supervisor pode pedir (não tem limite estourado)
  perform set_config('request.jwt.claims', format(como, current_setting('teste.sup')), true);
  r := public.socios_pedir(c);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 8: supervisor barrado: %', r; end if;

  -- 9. robô pega: marca consultando e devolve só id+cnpj
  select count(*) into n from public.socios_robo_pegar(10);
  if n < 1 then raise exception 'CASO 9: robô não pegou'; end if;
  if exists (select 1 from public.socios_consultas where status = 'pendente' and cnpj_digits = current_setting('teste.cnpj'))
    then raise exception 'CASO 9b: ficou pendente'; end if;
end $t$;

-- 10. RLS: como authenticated, o outro consultor não vê; o dono vê
set local role authenticated;
do $rls$
declare n int;
begin
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('teste.outro')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n <> 0 then raise exception 'CASO 10a: outro consultor vê % pedidos', n; end if;
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('teste.dono')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = current_setting('teste.cnpj');
  if n < 1 then raise exception 'CASO 10b: dono não vê os pedidos'; end if;
  begin
    insert into public.socios_consultas (cnpj_digits, pedido_por) values (current_setting('teste.cnpj'), auth.uid());
    raise exception 'CASO 10c: authenticated conseguiu inserir';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from mailing.socio limit 1;
    raise exception 'CASO 10d: authenticated lê mailing.socio direto';
  exception when insufficient_privilege then null;
  end;
end $rls$;
reset role;
select 'OK' as verificacao;
rollback;
