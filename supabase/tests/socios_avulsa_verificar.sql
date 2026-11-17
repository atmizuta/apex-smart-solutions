-- Verificação da §157 no banco. Tudo em transação desfeita no fim. Saída: só 'OK' ou a exceção com o caso.
begin;
do $prep$
declare v_a uuid; v_b uuid; v_c uuid; v_sup uuid;
begin
  select id into v_a from public.profiles where role = 'consultor' and operacao = 'apex' order by id limit 1;
  select id into v_b from public.profiles where role = 'consultor' and operacao = 'apex' and id <> v_a order by id limit 1;
  select id into v_c from public.profiles where operacao = 'campinas' and role = 'consultor' order by id limit 1;
  select id into v_sup from public.profiles where role in ('admin','supervisor') order by id limit 1;
  if v_a is null or v_b is null or v_c is null or v_sup is null then raise exception 'PREP: faltam atores'; end if;
  if exists (select 1 from public.renovacao_carteira where cnpj_digits in ('11222333000181','11444777000161')) then raise exception 'PREP: CNPJ de teste está na carteira'; end if;
  perform set_config('t.a', v_a::text, true); perform set_config('t.b', v_b::text, true);
  perform set_config('t.c', v_c::text, true); perform set_config('t.sup', v_sup::text, true);
end $prep$;

do $t$
declare r jsonb; r2 jsonb; n int; x text := '11222333000181'; y text := '11444777000161';
  como text := '{"role":"authenticated","sub":"%s"}'; v_id bigint; v_outro bigint;
begin
  -- 1. Campinas barrado
  perform set_config('request.jwt.claims', format(como, current_setting('t.c')), true);
  r := public.socios_pedir_cnpj(x);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 1: campinas: %', r; end if;
  -- 2. DV errado
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  r := public.socios_pedir_cnpj('11.222.333/0001-82');
  if r->>'motivo' is distinct from 'cnpj_invalido' then raise exception 'CASO 2: DV: %', r; end if;
  -- 3. A pede X (com pontuação): pendente, disparado, base é objeto
  r := public.socios_pedir_cnpj('11.222.333/0001-81');
  if (r->>'ok')::boolean is not true or r->>'status' <> 'pendente' or jsonb_typeof(r->'base'->'socios') <> 'array' then raise exception 'CASO 3: %', r; end if;
  v_id := (r->>'id')::bigint;
  if not exists (select 1 from public.socios_consultas where id = v_id and origem = 'avulsa' and disparado_em is not null) then raise exception 'CASO 3b'; end if;
  -- 4. A pede X de novo: mesmo pedido, nenhuma linha nova
  r2 := public.socios_pedir_cnpj(x);
  if (r2->>'id')::bigint <> v_id then raise exception 'CASO 4: criou outra linha'; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = x;
  if n <> 1 then raise exception 'CASO 4b: % linhas', n; end if;
  -- 5. B pede X: linha nova pendente
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.socios_pedir_cnpj(x);
  v_outro := (r->>'id')::bigint;
  if v_outro = v_id or r->>'status' <> 'pendente' then raise exception 'CASO 5: %', r; end if;
  -- 6. robô pega: um por CNPJ, os dois viram consultando
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 1 then raise exception 'CASO 6: pegou % do mesmo CNPJ', n; end if;
  if (select count(*) from public.socios_consultas where cnpj_digits = x and status = 'consultando') <> 2 then raise exception 'CASO 6b'; end if;
  -- 6c. pedido novo de X com consulta em andamento não é pego de novo
  perform set_config('request.jwt.claims', format(como, current_setting('t.sup')), true);
  perform public.socios_pedir_cnpj(x);
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 0 then raise exception 'CASO 6c: pegou CNPJ que já está em consulta'; end if;
  -- 7. resultado de um vale para todos (gatilho)
  update public.socios_consultas set status = 'pronto', concluido_em = now(),
         resultado = '{"socios":[{"nome":"ZZ SOCIO","cpf":"12345678909","participacao":100,"telefones_consultados":false,"telefones":[]}]}'
   where id = (select min(id) from public.socios_consultas where cnpj_digits = x and status = 'consultando');
  if (select count(*) from public.socios_consultas where cnpj_digits = x and status = 'pronto' and resultado is not null) <> 3 then raise exception 'CASO 7: gatilho não copiou'; end if;
  -- 8. guardado: B pede X de novo → linha nova pronta, copiado_de, sem disparo
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.socios_pedir_cnpj(x);
  if (r->>'guardado')::boolean is not true or r->>'status' <> 'pronto' then raise exception 'CASO 8: %', r; end if;
  if not exists (select 1 from public.socios_consultas where id = (r->>'id')::bigint and copiado_de is not null and disparado_em is null) then raise exception 'CASO 8b'; end if;
  -- 9. atualizar ignora o guardado
  r := public.socios_pedir_cnpj(x, true);
  if r ? 'guardado' or r->>'status' <> 'pendente' then raise exception 'CASO 9: %', r; end if;
  -- 10. guardado de 31 dias não vale
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, resultado, concluido_em, pedido_em)
    values (y, 'avulsa', current_setting('t.b')::uuid, 'pronto', '{"socios":[]}', now() - interval '31 days', now() - interval '31 days');
  r := public.socios_pedir_cnpj(y);
  if r ? 'guardado' or r->>'status' <> 'pendente' then raise exception 'CASO 10: %', r; end if;
  -- 11. limite somando origens: A com 20 no dia → barrado (guardado também conta)
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  select count(*) into n from public.socios_consultas where pedido_por = current_setting('t.a')::uuid
     and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status)
    select '00000000000191', 'renovacao', current_setting('t.a')::uuid, 'pronto' from generate_series(1, 20 - n);
  r := public.socios_pedir_cnpj(x);
  if r->>'motivo' is distinct from 'limite' then raise exception 'CASO 11: guardado passou do limite: %', r; end if;
  -- 12. base do pedido: alheio barrado, próprio ok
  r := public.socios_base_do_pedido(v_outro);
  if r->>'motivo' is distinct from 'sem_permissao' then raise exception 'CASO 12a'; end if;
  r := public.socios_base_do_pedido(v_id);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 12b'; end if;
end $t$;

-- 13/14. como authenticated: vê só as próprias avulsas; não chama socios_base_json
set local role authenticated;
do $rls$
declare n int;
begin
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('t.a')), true);
  select count(*) into n from public.socios_consultas where cnpj_digits = '11222333000181' and pedido_por <> auth.uid();
  if n <> 0 then raise exception 'CASO 13a: A vê % pedidos alheios', n; end if;
  select count(*) into n from public.socios_consultas where cnpj_digits = '11222333000181' and pedido_por = auth.uid();
  if n < 1 then raise exception 'CASO 13b: A não vê os próprios'; end if;
  begin
    perform public.socios_base_json('11222333000181');
    raise exception 'CASO 14: authenticated chamou socios_base_json';
  exception when insufficient_privilege then null;
  end;
end $rls$;
reset role;
select 'OK' as verificacao;
rollback;
