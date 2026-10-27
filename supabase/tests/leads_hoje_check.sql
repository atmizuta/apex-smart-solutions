-- Verificação das migrations 20261027100000/100100 (§118). Rodar depois delas; SEMPRE termina em ROLLBACK. Dados fictícios.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
('00000000-0000-0000-0000-00000000e402', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hsup@teste.invalid'),
('00000000-0000-0000-0000-00000000e403', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hcon@teste.invalid'),
('00000000-0000-0000-0000-00000000e404', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.hout@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
('00000000-0000-0000-0000-00000000e402', 'Zzhsup Teste', 'zz.hsup', 'supervisor', 'apex'),
('00000000-0000-0000-0000-00000000e403', 'Zzhcon Teste', 'zz.hcon', 'consultor', 'apex'),
('00000000-0000-0000-0000-00000000e404', 'Zzhout Teste', 'zz.hout', 'consultor', 'apex')
on conflict (id) do update set nome = excluded.nome, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZHCON', '00000000-0000-0000-0000-00000000e403', false), ('ZZHOUT', '00000000-0000-0000-0000-00000000e404', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, email, cnpj, campaign_name, adset_name, ad_name, form_name, platform, categoria, status, converteu, receita, dono_id, pego_em) values
('JUNHO', 'zh:meu',   now() - interval '3 hours', 'Zz Padaria Meu', '11900000031', 'a@teste.invalid', '00000000000131', 'Zz Camp', 'Zz Conj', 'Zz Anuncio', 'Zz Form', 'fb', 'sem_contato', null, false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours'),
('JUNHO', 'zh:outro', now() - interval '3 hours', 'Zz Oficina Outro', '11900000032', 'b@teste.invalid', '00000000000132', 'Zz Camp', null, null, null, null, 'sem_contato', null, false, 0, '00000000-0000-0000-0000-00000000e404', now() - interval '2 hours'),
('JUNHO', 'zh:livre', now() - interval '1 hour', 'Zz Livre Busca', '11900000033', 'c@teste.invalid', '00000000000133', 'Zz Camp', null, null, null, null, 'sem_contato', null, false, 0, null, null),
('JUNHO', 'zh:semtel', now() - interval '3 hours', 'Zz Sem Telefone', null, null, null, null, null, null, null, null, 'andamento', 'EM NEGOCIAÇÂO', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '5 days');
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
(999500001, 'zz.usuario', '11900000031', public.chave_tel('11900000031'), now() - interval '90 minutes', true, 125, 'ZZ TAB');
insert into public.leads_contatos (lead_aba, lead_id, profile_id, canal, em) values ('JUNHO', 'zh:meu', '00000000-0000-0000-0000-00000000e403', 'whatsapp', now() - interval '100 minutes');

do $$
declare j jsonb; n int;
begin
  -- ===== Task 1 =====
  assert (select ligacoes = 1 and atendidas = 1 and cliques = 1 and ultimo is not null from public.leads_contato_info('JUNHO', 'zh:meu', '11900000031', '00000000000131', now() - interval '3 hours')), 'contato: 1 ligação atendida + 1 clique';
  assert (select ligacoes = 0 and cliques = 0 and ultimo is null from public.leads_contato_info('JUNHO', 'zh:semtel', null, null, now() - interval '3 hours')), 'lead sem telefone e sem CNPJ não quebra (Review Focus 1)';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  j := public.leads_ficha_detalhes('JUNHO', 'zh:meu');
  assert (j->'resumo'->>'ligacoes')::int = 1 and (j->'resumo'->>'atendidas')::int = 1, 'ficha: resumo de contato';
  assert jsonb_array_length(j->'eventos') >= 3, 'ficha: chegou + ligação + clique';
  assert (select count(*) from jsonb_array_elements(j->'eventos') e where e->>'tipo' = 'ligacao' and e->>'detalhe' like '2 min 5 s%') = 1, 'ficha: duração da ligação';
  assert j->'anuncio'->>'conjunto' = 'Zz Conj' and j->'anuncio'->>'formulario' = 'Zz Form', 'ficha: detalhes do anúncio';
  j := public.leads_ficha_detalhes('JUNHO', 'zh:livre');
  assert j->'resumo' = 'null'::jsonb and jsonb_array_length(j->'eventos') = 1, 'ficha de Livre para consultor: só "chegou"';
  begin
    perform public.leads_ficha_detalhes('JUNHO', 'zh:outro');
    assert false, 'consultor abriu detalhes do lead de outro';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.leads_buscar('Zz Padaria')) = 1, 'busca por nome acha o meu';
  assert (select count(*) from public.leads_buscar('00000000000132')) = 0, 'busca por CNPJ não acha lead de outro consultor (Review Focus 4)';
  assert (select livre and cnpj is null and telefone is null from public.leads_buscar('00000000000133')), 'busca por CNPJ acha Livre sem mostrar o número';
  assert (select count(*) from public.leads_buscar('zz')) = 0, 'menos de 3 caracteres não busca';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e402', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e402', true);
  assert (select count(*) from public.leads_buscar('00000000000132')) = 1, 'supervisor acha qualquer lead';
  assert jsonb_array_length(public.leads_ficha_detalhes('JUNHO', 'zh:outro')->'eventos') >= 1, 'supervisor abre detalhes de qualquer lead';
  execute 'reset role';
  -- ===== mais testes entram aqui =====
end $$;
select 'CHECK OK' r;
rollback;
