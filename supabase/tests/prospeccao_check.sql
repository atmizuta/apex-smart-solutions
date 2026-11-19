-- Verificação da §161 no banco. Tudo em transação desfeita no fim. Saída: só 'OK' ou a exceção com o caso.
-- DADOS FICTÍCIOS (repo público).
begin;
do $prep$
declare v_a uuid; v_b uuid; v_fora uuid; v_adm uuid;
begin
  select profile_id into v_a from public.prospec_acesso order by profile_id limit 1;
  select profile_id into v_b from public.prospec_acesso where profile_id <> v_a order by profile_id limit 1;
  select id into v_fora from public.profiles where role = 'consultor' and id not in (select profile_id from public.prospec_acesso) order by id limit 1;
  select id into v_adm from public.profiles where role = 'admin' order by id limit 1;
  if v_a is null or v_b is null or v_fora is null or v_adm is null then raise exception 'PREP: faltam atores'; end if;
  if exists (select 1 from public.prospec_clientes where cnpj in ('11222333000181','11444777000161')) then raise exception 'PREP: CNPJ de teste já existe'; end if;
  insert into public.prospec_clientes (cnpj, aba_origem, razao_social, nv_status) values
    ('11222333000181', 'LURIA', 'Zz Teste Um', 'pendente'),
    ('11444777000161', 'CAIO', 'Zz Teste Dois', 'nao_precisa');
  perform set_config('t.a', v_a::text, true); perform set_config('t.b', v_b::text, true);
  perform set_config('t.fora', v_fora::text, true); perform set_config('t.adm', v_adm::text, true);
end $prep$;

do $t$
declare r jsonb; n int; como text := '{"role":"authenticated","sub":"%s"}';
  v_um bigint := (select id from public.prospec_clientes where cnpj = '11222333000181');
  v_dois bigint := (select id from public.prospec_clientes where cnpj = '11444777000161');
begin
  -- 1. fora do acesso: 42501 em listar, pegar e mover
  perform set_config('request.jwt.claims', format(como, current_setting('t.fora')), true);
  if public.prospec_pode() then raise exception 'CASO 1: pode() deveria ser falso'; end if;
  begin perform public.prospec_listar(); raise exception 'CASO 1a: listar passou'; exception when insufficient_privilege then null; end;
  begin perform public.prospec_pegar(v_um); raise exception 'CASO 1b: pegar passou'; exception when insufficient_privilege then null; end;
  begin perform public.prospec_mover(v_um, 'contato', null, null); raise exception 'CASO 1c: mover passou'; exception when insufficient_privilege then null; end;
  -- 2. A pega (vira contato), B recebe ja_tem_dono com o nome de A
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  if not public.prospec_pode() then raise exception 'CASO 2: A sem acesso'; end if;
  r := public.prospec_pegar(v_um);
  if (r->>'ok')::boolean is not true then raise exception 'CASO 2a: %', r; end if;
  if (select etapa from public.prospec_clientes where id = v_um) <> 'contato' then raise exception 'CASO 2b: etapa'; end if;
  perform set_config('request.jwt.claims', format(como, current_setting('t.b')), true);
  r := public.prospec_pegar(v_um);
  if r->>'motivo' is distinct from 'ja_tem_dono' or r->>'dono' is distinct from (select nome from public.profiles where id = current_setting('t.a')::uuid) then raise exception 'CASO 2c: %', r; end if;
  -- 3. B não move o de A; admin move
  begin perform public.prospec_mover(v_um, 'venda', null, null); raise exception 'CASO 3a: B moveu'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', format(como, current_setting('t.adm')), true);
  r := public.prospec_mover(v_um, 'sem_interesse', null, 'Zz motivo');
  if (select etapa || '|' || obs from public.prospec_clientes where id = v_um) <> 'sem_interesse|Zz motivo' then raise exception 'CASO 3b: admin não moveu'; end if;
  -- 4. retornar sem data recusa; com data grava; sair de retornar limpa a data; obs nula mantém
  perform set_config('request.jwt.claims', format(como, current_setting('t.a')), true);
  begin perform public.prospec_mover(v_um, 'retornar', null, null); raise exception 'CASO 4a: retornar sem data passou'; exception when invalid_parameter_value then null; end;
  perform public.prospec_mover(v_um, 'retornar', now() + interval '1 day', null);
  if (select retorno_em is null or obs <> 'Zz motivo' from public.prospec_clientes where id = v_um) then raise exception 'CASO 4b'; end if;
  perform public.prospec_mover(v_um, 'contato', now(), '');
  if (select retorno_em is not null or obs is not null from public.prospec_clientes where id = v_um) then raise exception 'CASO 4c: retorno/obs não limparam'; end if;
  begin perform public.prospec_mover(v_um, 'xyz', null, null); raise exception 'CASO 4d: etapa inválida passou'; exception when invalid_parameter_value then null; end;
  -- 5. soltar (livre) limpa dono; cliente livre não se move sem pegar
  perform public.prospec_mover(v_um, 'livre', null, null);
  if (select dono_id is not null or etapa <> 'livre' from public.prospec_clientes where id = v_um) then raise exception 'CASO 5a'; end if;
  begin perform public.prospec_mover(v_dois, 'venda', null, null); raise exception 'CASO 5b: livre moveu sem pegar'; exception when invalid_parameter_value then null; end;
  -- 5c. listar traz os dois com telefone efetivo e dono_nome
  r := public.prospec_listar();
  if (select count(*) from jsonb_array_elements(r) e where e->>'cnpj' in ('11222333000181','11444777000161')) <> 2 then raise exception 'CASO 5c'; end if;
  -- 6. escolha do número
  r := public.prospec_escolher_numero('{"socios":[
      {"nome":"ZZ MENOR","participacao":10,"telefones":[{"tipo":"celular","numero":"11900000001","whatsapp":true}]},
      {"nome":"ZZ MAIOR","participacao":90,"telefones":[{"tipo":"fixo","numero":"1130000002","whatsapp":false},{"tipo":"celular","numero":"(11) 90000-0003","whatsapp":false},{"tipo":"celular","numero":"5511900000004","whatsapp":true}]}]}');
  if r is distinct from '{"numero":"11900000004","whatsapp":true,"socio_nome":"ZZ MAIOR"}'::jsonb then raise exception 'CASO 6a: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ A","participacao":50,"telefones":[{"tipo":"fixo","numero":"1130000005","whatsapp":false},{"tipo":"celular","numero":"11900000006","whatsapp":false}]}]}');
  if r is distinct from '{"numero":"11900000006","whatsapp":false,"socio_nome":"ZZ A"}'::jsonb then raise exception 'CASO 6b: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ SEM","participacao":100,"telefones":[]},{"nome":"ZZ FIXO","participacao":0,"telefones":[{"tipo":"fixo","numero":"1130000007","whatsapp":false}]}]}');
  if r is distinct from '{"numero":"1130000007","whatsapp":false,"socio_nome":"ZZ FIXO"}'::jsonb then raise exception 'CASO 6c: %', r; end if;
  r := public.prospec_escolher_numero('{"socios":[{"nome":"ZZ E1","participacao":50,"telefones":[{"tipo":"celular","numero":"11900000008","whatsapp":true}]},{"nome":"ZZ E2","participacao":50,"telefones":[{"tipo":"celular","numero":"11900000009","whatsapp":true}]}]}');
  if r->>'socio_nome' <> 'ZZ E1' then raise exception 'CASO 6d: empate deveria ficar com o primeiro: %', r; end if;
  if public.prospec_escolher_numero('{"socios":[{"nome":"ZZ","participacao":"x","telefones":[]}]}') is not null
     or public.prospec_escolher_numero('{}') is not null then raise exception 'CASO 6e: sem telefone deveria ser null'; end if;
end $t$;

-- 7. aplicar Nova Vida: mapeia status e é idempotente (como SQL direto, sem usuário)
do $t7$
declare r jsonb; v_c bigint; v_um bigint := (select id from public.prospec_clientes where cnpj = '11222333000181');
begin
  perform set_config('request.jwt.claims', '', true);
  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, concluido_em, resultado)
  values ('11222333000181', 'prospeccao', current_setting('t.adm')::uuid, 'pronto', now(),
          '{"socios":[{"nome":"ZZ SOCIO","participacao":100,"telefones":[{"tipo":"celular","numero":"11900000010","whatsapp":true}]}]}')
  returning id into v_c;
  update public.prospec_clientes set nv_consulta_id = v_c where id = v_um;
  r := public.prospec_aplicar_nv();
  if (r->>'aplicados')::int <> 1 then raise exception 'CASO 7a: %', r; end if;
  if (select nv_status || '|' || telefone_nv || '|' || whatsapp::text || '|' || socio_nome from public.prospec_clientes where id = v_um) <> 'ok|11900000010|true|ZZ SOCIO' then raise exception 'CASO 7b'; end if;
  r := public.prospec_aplicar_nv();
  if (r->>'aplicados')::int <> 0 then raise exception 'CASO 7c: não é idempotente'; end if;
  update public.prospec_clientes set nv_status = 'pendente', telefone_nv = null where id = v_um;
  update public.socios_consultas set resultado = '{"socios":[{"nome":"ZZ","participacao":100,"telefones":[]}]}' where id = v_c;
  perform public.prospec_aplicar_nv();
  if (select nv_status from public.prospec_clientes where id = v_um) <> 'sem_telefone' then raise exception 'CASO 7d'; end if;
  update public.prospec_clientes set nv_status = 'pendente' where id = v_um;
  update public.socios_consultas set status = 'erro', resultado = null where id = v_c;
  perform public.prospec_aplicar_nv();
  if (select nv_status from public.prospec_clientes where id = v_um) <> 'erro' then raise exception 'CASO 7e'; end if;
  -- 8. consultor não roda aplicar_nv
  perform set_config('request.jwt.claims', format('{"role":"authenticated","sub":"%s"}', current_setting('t.a')), true);
  begin perform public.prospec_aplicar_nv(); raise exception 'CASO 8: consultor aplicou'; exception when insufficient_privilege then null; end;
end $t7$;
select 'OK' as resultado;
rollback;
