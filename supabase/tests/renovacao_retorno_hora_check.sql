-- Verificação da migration 20261113150000 (§151). SEMPRE termina em ROLLBACK. Dados fictícios.
-- Antes de aplicar: execute_sql com  begin; <migration sem begin/commit>; <este arquivo sem o primeiro begin>
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000f641', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.r5a@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao, equipe) values
('00000000-0000-0000-0000-00000000f641', 'Zzr5a Teste', 'zz.r5a', 'consultor', 'apex', 'renovacao')
on conflict (id) do update set role = excluded.role, equipe = excluded.equipe;
insert into public.renovacao_carteira (cnpj_digits, razao_social, consultor_id, status, prox_retorno) values
('00000000000401', 'Zz Quatro Um',   '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date),
('00000000000402', 'Zz Quatro Dois', '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date),
('00000000000403', 'Zz Quatro Tres', '00000000-0000-0000-0000-00000000f641', 3, (now() at time zone 'America/Sao_Paulo')::date - 1);

do $$
declare n int;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000f641', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f641', true);
  -- consultor grava a hora (é campo de atendimento)
  update public.renovacao_carteira set retorno_hora = '00:00' where cnpj_digits = '00000000000401';
  update public.renovacao_carteira set retorno_hora = '23:59:59' where cnpj_digits = '00000000000402';
  get diagnostics n = row_count;
  assert n = 1, 'consultor grava retorno_hora';
  -- hoje 00:00 já passou → atrasado; hoje 23:59:59 ainda não; ontem sem hora → atrasado
  select retornos_atrasados into n from public.renovacao_resumo where consultor_id = '00000000-0000-0000-0000-00000000f641';
  assert n = 2, 'atrasados com hora: 401 (00:00) e 403 (ontem), veio ' || n;
  execute 'reset role';
end $$;

rollback;
