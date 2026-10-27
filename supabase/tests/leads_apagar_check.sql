-- Verificação da migration 20261027190000 (§120: apagar lead e versão por dono). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.asup@teste.invalid'),
('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.acon@teste.invalid'),
('00000000-0000-0000-0000-00000000e504', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.aout@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e502', 'Zzasup Teste', 'zz.asup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e503', 'Zzacon Teste', 'zz.acon', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e504', 'Zzaout Teste', 'zz.aout', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZACON', '00000000-0000-0000-0000-00000000e503', false), ('ZZAOUT', '00000000-0000-0000-0000-00000000e504', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, categoria, status, converteu, receita, dono_id, pego_em) values
('JUNHO', 'za:meu',   now() - interval '3 days', 'Zz Apagar Meu', '11900000061', '00000000000161', 'andamento', 'EM NEGOCIAÇÂO', false, 0, '00000000-0000-0000-0000-00000000e503', now() - interval '5 days'),
('JUNHO', 'za:outro', now() - interval '3 days', 'Zz Apagar Outro', '11900000062', null, 'andamento', 'EM NEGOCIAÇÂO', false, 0, '00000000-0000-0000-0000-00000000e504', now() - interval '5 days'),
('JUNHO', 'za:livre', now() - interval '1 hour', 'Zz Apagar Livre', '11900000063', null, 'sem_contato', null, false, 0, null, null);
do $$
declare v1 text; v2 text; n int;
begin
  execute 'set local role authenticated';
  -- consultor: não apaga
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e503', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e503', true);
  begin
    perform public.leads_apagar('JUNHO', 'za:meu', 'teste');
    assert false, 'consultor apagou lead';
  exception when insufficient_privilege then null;
  end;
  perform public.leads_agendar_retorno('JUNHO', 'za:meu', now() + interval '1 day');
  -- versão por dono: mudança no lead de outro consultor não muda a minha
  v1 := public.leads_kanban_versao_dono(null);
  execute 'reset role';
  update public.leads set classificado_em = now() where id = 'za:outro';
  execute 'set local role authenticated';
  v2 := public.leads_kanban_versao_dono(null);
  assert v1 = v2, 'classificação de outro consultor não muda a minha versão';
  -- supervisor apaga o meu lead e o livre
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  select count(*) into n from public.leads_espelho where lead_id in ('za:meu', 'za:livre');
  perform public.leads_apagar('JUNHO', 'za:meu', 'duplicado');
  perform public.leads_apagar('JUNHO', 'za:livre', null);
  assert (select count(*) from public.leads_espelho where lead_id in ('za:meu', 'za:livre')) = n, 'apagar não mexe na planilha (sem fila do espelho)';
  assert (select count(*) from public.agenda_retornos where lead_id = 'za:meu' and status = 'pendente') = 0, 'apagar cancela o retorno da Agenda';
  assert not exists (select 1 from public.leads_kanban(null) where lead_id in ('za:meu', 'za:livre')), 'apagado some do Quadro do gestor';
  assert not exists (select 1 from public.leads_buscar('Zz Apagar Meu')), 'apagado some da busca';
  -- consultor: some do Quadro, da busca, dos alertas e da fila; versão mudou
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e503', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e503', true);
  assert public.leads_kanban_versao_dono(null) <> v2, 'apagar muda a versão do dono';
  assert not exists (select 1 from public.leads_kanban(null) where lead_id in ('za:meu', 'za:livre')), 'apagado some do Quadro do consultor';
  assert not exists (select 1 from public.leads_alertas() where lead_id = 'za:meu'), 'apagado sem alerta';
  assert not exists (select 1 from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'za:meu'), 'apagado fora da fila';
  assert (public.leads_pegar('JUNHO', 'za:livre') ->> 'ok') = 'false', 'livre apagado não pode ser pego';
  -- supervisor restaura
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  perform public.leads_restaurar('JUNHO', 'za:meu');
  assert exists (select 1 from public.leads_kanban(null) where lead_id = 'za:meu'), 'restaurar devolve o lead';
  execute 'reset role';
  assert (select apagado_por is null and apagado_em is null from public.leads where id = 'za:meu'), 'restaurar limpa os campos';
  assert (select apagado_motivo is null from public.leads where id = 'za:livre') and (select apagado_em is not null from public.leads where id = 'za:livre'), 'livre segue apagado';
end $$;
select 'CHECK OK' r;
rollback;
