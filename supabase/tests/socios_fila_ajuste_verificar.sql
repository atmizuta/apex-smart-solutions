-- Verificação do ajuste da fila de sócios (§157.1). Tudo em transação desfeita no fim. Saída: só 'OK' ou o caso.
-- CNPJs fictícios com DV válido que não estão na carteira.
begin;
do $prep$
declare v_a uuid; v_b uuid;
begin
  select id into v_a from public.profiles where role = 'consultor' and operacao = 'apex' order by id limit 1;
  select id into v_b from public.profiles where role = 'consultor' and operacao = 'apex' and id <> v_a order by id limit 1;
  if v_a is null or v_b is null then raise exception 'PREP: faltam atores'; end if;
  perform set_config('t.a', v_a::text, true); perform set_config('t.b', v_b::text, true);
end $prep$;

do $t$
declare r jsonb; n int; x text := '11222333000181'; y text := '11444777000161'; v_id bigint; v_hoje int;
  como text := '{"role":"authenticated","sub":"%s"}';
begin
  -- 1. consulta presa (robô morreu) volta para a fila e é pega de novo; conta a tentativa
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, iniciado_em, tentativas)
    values (x, 'avulsa', current_setting('t.a')::uuid, 'consultando', now() - interval '11 minutes', 1) returning id into v_id;
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 1 then raise exception 'CASO 1: presa não voltou para a fila (%)', n; end if;
  if (select tentativas from public.socios_consultas where id = v_id) <> 2 then raise exception 'CASO 1b: tentativa não contou'; end if;

  -- 2. na 3ª tentativa vira erro (CNPJ problemático não fica em looping) e não é pego
  update public.socios_consultas set iniciado_em = now() - interval '11 minutes', tentativas = 3 where id = v_id;
  select count(*) into n from public.socios_robo_pegar(10) p where p.cnpj = x;
  if n <> 0 then raise exception 'CASO 2: pegou de novo na 3ª tentativa'; end if;
  if (select status from public.socios_consultas where id = v_id) <> 'erro' then raise exception 'CASO 2b: não virou erro'; end if;

  -- 3. "Tentar de novo" numa consulta presa do próprio consultor: mesmo pedido, sem linha nova e sem limite
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, iniciado_em, tentativas, disparado_em)
    values (y, 'avulsa', current_setting('t.b')::uuid, 'consultando', now() - interval '11 minutes', 1, now() - interval '12 minutes') returning id into v_id;
  select count(*) into v_hoje from public.socios_consultas where pedido_por = current_setting('t.b')::uuid;
  r := public.socios_pedir_cnpj(y);
  if (r->>'id')::bigint <> v_id or r->>'status' <> 'pendente' then raise exception 'CASO 3: %', r; end if;
  select count(*) into n from public.socios_consultas where pedido_por = current_setting('t.b')::uuid;
  if n <> v_hoje then raise exception 'CASO 3b: gravou linha nova (%→%)', v_hoje, n; end if;
  if (select disparado_em from public.socios_consultas where id = v_id) < now() - interval '1 minute' then raise exception 'CASO 3c: não redisparou'; end if;

  -- 4. o gatilho continua entregando o resultado aos outros pedidos do CNPJ
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  perform public.socios_pedir_cnpj(y);
  perform public.socios_robo_pegar(10);
  update public.socios_consultas set status = 'pronto', concluido_em = now(), resultado = '{"socios":[]}'
   where id = v_id and status = 'consultando';
  if (select count(*) from public.socios_consultas where cnpj_digits = y and status = 'pronto') <> 2 then raise exception 'CASO 4: gatilho não entregou'; end if;
end $t$;
-- 5. a função de liberar presas é interna (o navegador não chama)
set local role authenticated;
do $rls$
begin
  begin
    perform public.socios_liberar_presos(null);
    raise exception 'CASO 5: authenticated chamou socios_liberar_presos';
  exception when insufficient_privilege then null;
  end;
end $rls$;
reset role;
select 'OK' as verificacao;
rollback;
