-- Verificação da migration 20261028200000 (§126.3). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e601', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esup@teste.invalid'),
('00000000-0000-0000-0000-00000000e602', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.etel@teste.invalid'),
('00000000-0000-0000-0000-00000000e603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.esem@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e601', 'Zzesup Teste', 'zz.esup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e602', 'Zzetel Teste', 'zz.etel', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e603', 'Zzesem Teste', 'zz.esem', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar, pode_pegar, usuario_telefonia) values
('ZZETEL', '00000000-0000-0000-0000-00000000e602', false, true, 'zz.etel.tel'),
('ZZESEM', '00000000-0000-0000-0000-00000000e603', false, false, null);
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999700001, 'zz.etel.tel', '11900000061', public.chave_tel('11900000061'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '14 hours 10 minutes') at time zone 'America/Sao_Paulo', false, 0, 'ZZ TAB'),
(999700002, 'zz.etel.tel', '11900000062', public.chave_tel('11900000062'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '15 hours 20 minutes') at time zone 'America/Sao_Paulo', true, 60, 'ZZ TAB'),
(999700003, 'ZZ.ETEL.TEL ', '11900000063', public.chave_tel('11900000063'), (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '15 hours 40 minutes') at time zone 'America/Sao_Paulo', false, 0, 'ZZ TAB');
do $$
declare r record;
begin
  execute 'set local role authenticated';
  -- consultor não pode chamar
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e602', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e602', true);
  begin
    perform * from public.leads_atividade_equipe2();
    assert false, 'consultor chamou leads_atividade_equipe2';
  exception when insufficient_privilege then
    assert sqlerrm like '%sem permissão%', 'mensagem: ' || sqlerrm;
  end;
  -- supervisor vê a equipe com ligações por hora
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e601', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e601', true);
  select * into r from public.leads_atividade_equipe2() a where a.dono_id = '00000000-0000-0000-0000-00000000e602';
  assert r.tem_telefonia and r.pode_pegar, 'consultor com telefonia e pode_pegar';
  assert array_length(r.lig_por_hora, 1) = 8, 'oito horas (13h a 20h): ' || array_length(r.lig_por_hora, 1);
  assert r.lig_por_hora[2] = 1 and r.lig_por_hora[3] = 2, 'uma às 14h e duas às 15h (usuário com caixa e espaço diferentes): ' || r.lig_por_hora::text;
  assert r.lig_hoje = 3, 'lig_hoje conta as três: ' || r.lig_hoje;
  assert (select sum(x) from unnest(r.lig_por_hora) x) <= r.lig_hoje, 'soma das horas não passa de lig_hoje';
  assert r.meta_dia > 0, 'meta diária positiva';
  select * into r from public.leads_atividade_equipe2() a where a.dono_id = '00000000-0000-0000-0000-00000000e603';
  assert not r.tem_telefonia and not r.pode_pegar and r.lig_por_hora = array[0,0,0,0,0,0,0,0], 'sem telefonia: zero em todas as horas';
  raise notice 'leads_atividade_equipe2_check OK';
end $$;
rollback;
