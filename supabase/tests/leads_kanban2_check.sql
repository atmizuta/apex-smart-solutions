-- Verificação da migration 20261027203000 (§121: leads_kanban2 com ligações). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e603', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kcon@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values ('00000000-0000-0000-0000-00000000e603', 'Zzkcon Teste', 'zz.kcon', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZKCON2', '00000000-0000-0000-0000-00000000e603', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, categoria, status, obs, converteu, receita, dono_id, pego_em) values
('JUNHO', 'zk:semlig', now() - interval '2 hours', 'Zz Sem Ligacao', '11900000071', null, 'sem_contato', null, null, false, 0, '00000000-0000-0000-0000-00000000e603', now() - interval '1 hour'),
('JUNHO', 'zk:manual', now() - interval '2 days', 'Zz Ligou Manual', '11900000072', null, 'andamento', 'EM NEGOCIAÇÂO', 'zz pediu proposta', false, 0, '00000000-0000-0000-0000-00000000e603', now() - interval '2 days'),
('JUNHO', 'zk:disc', now() - interval '2 days', 'Zz Discador', null, '00000000000173', 'sem_contato', null, null, false, 0, '00000000-0000-0000-0000-00000000e603', now() - interval '2 days');
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999600001, 'zz.usuario', '11900000072', public.chave_tel('11900000072'), now() - interval '5 hours', false, 0, 'ZZ NAO ATENDEU'),
(999600002, 'zz.usuario', '11900000072', public.chave_tel('11900000072'), now() - interval '1 hour', true, 95, 'ZZ FALOU');
insert into public.discador_chamadas (id, gerada_em, status, seg_falados, tabulacao, cnpj) values
(999600003, now() - interval '30 minutes', 'ANSWERED', 40, 'ZZ DISC', '00000000000173');
do $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e603', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e603', true);
  assert (select ligacoes = 0 and ultima_ligacao is null from public.leads_kanban2(null) where lead_id = 'zk:semlig'), 'lead sem ligação: 0';
  assert (select ligacoes = 2 and ultima_atendida and ultima_seg = 95 and ultima_tabulacao = 'ZZ FALOU' and obs = 'zz pediu proposta'
            from public.leads_kanban2(null) where lead_id = 'zk:manual'), 'manual: 2 ligações, última atendida de 95 s, OBS junto';
  assert (select ligacoes = 1 and ultima_atendida and ultima_seg = 40 from public.leads_kanban2(null) where lead_id = 'zk:disc'), 'discador conta pelo CNPJ';
  assert (select count(*) from public.leads_kanban2(null) where lead_id like 'zk:%') = 3, 'traz os 3 leads do consultor';
  execute 'reset role';
end $$;
select 'CHECK OK' r;
rollback;
