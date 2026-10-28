-- Verificação das migrations 20261028100000/100100 (§122). SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.psup@teste.invalid'),
('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ppode@teste.invalid'),
('00000000-0000-0000-0000-00000000e503', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.pnao@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e501', 'Zzpsup Teste', 'zz.psup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e502', 'Zzppode Teste', 'zz.ppode', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e503', 'Zzpnao Teste', 'zz.pnao', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar, pode_pegar, usuario_telefonia) values
('ZZPPODE', '00000000-0000-0000-0000-00000000e502', false, true, 'zz.ppode.tel'),
('ZZPNAO', '00000000-0000-0000-0000-00000000e503', false, false, null);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, campaign_name, form_name, categoria, status, obs, converteu, receita, dono_id, pego_em, classificado_em) values
('JUNHO', 'zp:livre',  now() - interval '30 minutes', 'Zz Livre Novo',  '11900000051', '00000000000151', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, null, null, null),
('JUNHO', 'zp:velho',  now() - interval '5 hours',    'Zz Livre Velho', '11900000052', '00000000000152', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, null, null, null),
('JUNHO', 'zp:dele',   now() - interval '3 hours',    'Zz Do Nao',      '11900000053', '00000000000153', 'Zz Camp', 'Zz Form', 'sem_contato', null, null, false, 0, '00000000-0000-0000-0000-00000000e503', now() - interval '2 hours', null),
('JUNHO', 'zp:antigo', now() - interval '80 days',    'Zz Perdido Velho','11900000054', '00000000000154', 'Zz Camp', 'Zz Form', 'perdido', 'CNPJ INAPTO', null, false, 0, '00000000-0000-0000-0000-00000000e502', now() - interval '79 days', now() - interval '70 days');
insert into public.leads_historico (lead_aba, lead_id, acao, por, em, antes, depois) values
('JUNHO', 'zp:dele', 'classificar', '00000000-0000-0000-0000-00000000e502', now() - interval '20 minutes', '{"obs": ""}'::jsonb, '{"obs": "Zz falou com o dono"}'::jsonb),
('JUNHO', 'zp:dele', 'classificar', '00000000-0000-0000-0000-00000000e502', now() - interval '10 minutes', '{"obs": "Zz falou com o dono"}'::jsonb, '{"obs": "Zz falou com o dono"}'::jsonb);
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999600001, 'zz.ppode.tel', '11900000053', public.chave_tel('11900000053'), now() - interval '15 minutes', false, 0, 'ZZ TAB');

do $$
declare j jsonb; n int;
begin
  execute 'set local role authenticated';
  -- ===== Task 1 =====
  -- quem não pode pegar recebe erro; quem pode pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e503', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e503', true);
  begin
    perform public.leads_pegar('JUNHO', 'zp:livre');
    assert false, 'consultor sem pode_pegar pegou lead';
  exception when insufficient_privilege then
    assert sqlerrm like '%não está liberado%', 'mensagem da trava: ' || sqlerrm;
  end;
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo'), 'sem pode_pegar não recebe lead_novo';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  assert exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:livre' and a.dono_id is null), 'pode_pegar recebe lead_novo do livre recente';
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:velho'), 'livre de mais de 2 h não é lead_novo';
  j := public.leads_hoje(null);
  assert (j->'placar'->>'classificacoes')::int = 2, 'placar: 2 classificações hoje, veio ' || coalesce(j->'placar'->>'classificacoes', 'null');
  assert j->'placar' ? 'retornos_hoje' and j->'placar' ? 'retornos_cumpridos', 'placar tem retornos';
  j := public.leads_pegar('JUNHO', 'zp:livre');
  assert (j->>'ok')::boolean, 'consultor com pode_pegar pega o lead';
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo' and a.lead_id = 'zp:livre'), 'lead pego some do lead_novo';
  -- supervisor: não recebe lead_novo e continua redistribuindo para quem não pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e501', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e501', true);
  assert not exists (select 1 from public.leads_alertas(null) a where a.tipo = 'lead_novo'), 'gestor não recebe lead_novo';
  perform public.leads_redistribuir('JUNHO', 'zp:livre', '00000000-0000-0000-0000-00000000e503');
  assert (select dono_id from public.leads where aba = 'JUNHO' and id = 'zp:livre') = '00000000-0000-0000-0000-00000000e503', 'redistribuir para quem não pega continua valendo';
  -- ===== Task 2 =====
  -- consultor: Quadro só do mês; Todos traz o perdido de 70 dias atrás, sem livres, com campanha/formulário
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e502', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e502', true);
  assert not exists (select 1 from public.leads_kanban3(null, false) k where k.lead_id = 'zp:antigo'), 'Quadro não traz perdido de meses atrás';
  assert exists (select 1 from public.leads_kanban3(null, true) k where k.lead_id = 'zp:antigo' and k.campanha = 'Zz Camp' and k.formulario = 'Zz Form'), 'Todos traz o perdido antigo com campanha e formulário';
  assert not exists (select 1 from public.leads_kanban3(null, true) k where k.livre), 'Todos não traz livres';
  assert exists (select 1 from public.leads_kanban3(null, false) k where k.lead_id = 'zp:velho' and k.livre and k.telefone is null), 'Quadro continua com livres (sem telefone para consultor)';
  begin
    perform * from public.leads_atividade_equipe();
    assert false, 'consultor viu a atividade da equipe';
  exception when insufficient_privilege then null;
  end;
  -- supervisor: OBS igual à anterior não conta; quem não tem usuário de telefonia não quebra
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e501', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e501', true);
  assert (select obs_hoje = 1 and ultima_obs is not null and tem_telefonia and lig_hoje = 1 and ultima_ligacao is not null
            from public.leads_atividade_equipe() a where a.dono_id = '00000000-0000-0000-0000-00000000e502'), 'atividade: 1 OBS nova e 1 ligação hoje';
  assert (select not tem_telefonia and lig_hoje = 0 and ultima_ligacao is null and obs_hoje = 0
            from public.leads_atividade_equipe() a where a.dono_id = '00000000-0000-0000-0000-00000000e503'), 'atividade: sem usuário de telefonia';
  raise notice 'CHECK OK';
end $$;
rollback;
