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
  -- ===== Task 2 =====
  update public.config set valor = '{"seg_sex":["00:00","23:59"],"sabado":null}' where chave = 'velocidade_lead';
  -- expediente "o dia inteiro" só em dia útil; no fim de semana o alerta sem_contato não existe por regra
  insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, categoria, converteu, receita, dono_id, pego_em, status, classificado_em) values
  ('JUNHO', 'zh:novo',  now() - interval '1 hour', 'Zz Novo Sem Contato', '11900000041', null, 'sem_contato', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '40 minutes', null, null),
  ('JUNHO', 'zh:perd',  now() - interval '2 hours', 'Zz Perdido Sem Ligacao', '11900000042', null, 'perdido', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours', 'CNPJ INAPTO', now()),
  ('JUNHO', 'zh:conv',  now() - interval '2 hours', 'Zz Convertido', '11900000043', null, 'convertido', true, 500, '00000000-0000-0000-0000-00000000e403', now() - interval '2 hours', 'PEDIDO CONCLUIDO (VENDA)', now());
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  if extract(isodow from now() at time zone 'America/Sao_Paulo') between 1 and 5 then
    assert exists (select 1 from public.leads_alertas() where tipo = 'sem_contato' and lead_id = 'zh:novo'), 'alerta: pego sem contato há 40 min';
  end if;
  assert exists (select 1 from public.leads_alertas() where tipo = 'parado' and lead_id = 'zh:semtel'), 'alerta: em andamento parado há 5 dias (lead sem telefone)';
  assert not exists (select 1 from public.leads_alertas() where tipo = 'perda_suspeita'), 'perda suspeita é só do gestor';
  assert not exists (select 1 from public.leads_alertas() where lead_id = 'zh:outro'), 'consultor não vê alerta de outro';
  -- retorno: agendar, vencer, aparecer na fila e no alerta; reclassificar fecha
  perform public.leads_agendar_retorno('JUNHO', 'zh:semtel', now() - interval '10 minutes');
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 1, 'agendar cria 1 retorno pendente';
  perform public.leads_agendar_retorno('JUNHO', 'zh:semtel', now() - interval '5 minutes');
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 1, 'agendar de novo atualiza (não duplica)';
  assert exists (select 1 from public.leads_alertas() where tipo = 'retorno_vencido' and lead_id = 'zh:semtel'), 'alerta: retorno vencido';
  assert (select count(*) from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'zh:semtel') = 1, 'lead em dois motivos aparece 1 vez na fila (Review Focus 3)';
  assert (select f->>'motivo' from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'zh:semtel') = 'Retorno vencido', 'fica o motivo de maior prioridade';
  assert ((public.leads_hoje() -> 'fila') -> 0 ->> 'lead_id') = 'zh:novo', 'novo sem contato vem primeiro';
  assert jsonb_array_length(public.leads_hoje() -> 'retornos') = 1, 'retornos de hoje';
  perform public.leads_classificar('JUNHO', 'zh:semtel', 'CNPJ INAPTO', null, false, null, null);
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:semtel' and status = 'pendente') = 0, 'reclassificar fecha o retorno (Review Focus 5)';
  perform public.leads_classificar('JUNHO', 'zh:meu', 'AGENDADO RETORNO', null, false, null, (now() at time zone 'America/Sao_Paulo')::date + 1);
  assert (select to_char(quando at time zone 'America/Sao_Paulo', 'HH24:MI') = '10:00' from public.agenda_retornos where lead_id = 'zh:meu' and status = 'pendente'), 'AGENDADO RETORNO cria retorno às 10:00';
  -- gestor: perda suspeita, resumo da equipe, redistribuir leva o retorno
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e402', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e402', true);
  assert exists (select 1 from public.leads_alertas(null) where tipo = 'perda_suspeita' and lead_id = 'zh:perd'), 'gestor vê perda suspeita';
  assert (select convertidos_mes = 1 and receita_mes = 500 and em_aberto >= 2 from public.leads_equipe_resumo() where dono_id = '00000000-0000-0000-0000-00000000e403'), 'resumo da equipe';
  perform public.leads_redistribuir('JUNHO', 'zh:meu', '00000000-0000-0000-0000-00000000e404');
  execute 'reset role';
  -- o gatilho da Agenda trava consultor_id no UPDATE: o do dono antigo é cancelado e o novo dono ganha um pendente
  assert (select count(*) = 1 and bool_and(consultor_id = '00000000-0000-0000-0000-00000000e404') from public.agenda_retornos where lead_id = 'zh:meu' and status = 'pendente'), 'redistribuir leva o retorno';
  assert (select count(*) = 1 from public.agenda_retornos where lead_id = 'zh:meu' and status = 'cancelado' and consultor_id = '00000000-0000-0000-0000-00000000e403'), 'retorno do dono antigo cancelado';
  execute 'reset role';
  -- fora do expediente: sem alerta sem_contato (Review Focus 2)
  update public.config set valor = '{"seg_sex":["00:00","00:01"],"sabado":null}' where chave = 'velocidade_lead';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  assert not exists (select 1 from public.leads_alertas() where tipo = 'sem_contato'), 'fora do expediente não alerta sem contato';
  execute 'reset role';
  -- ===== Ajustes da revisão final (migration 20261027100200) =====
  insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, cnpj, categoria, status, converteu, receita, dono_id, pego_em) values
  ('JUNHO', 'zh:fut', now() - interval '6 days', 'Zz Retorno Futuro', '11900000051', null, 'andamento', 'EM NEGOCIAÇÂO', false, 0, '00000000-0000-0000-0000-00000000e403', now() - interval '5 days');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e403', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e403', true);
  assert (select count(*) from public.leads_buscar('00000133')) = 0, 'Livre não aparece por pedaço do CNPJ (só inteiro)';
  assert (select count(*) from public.leads_buscar('00000051')) = 1, 'lead meu aparece por pedaço do telefone';
  perform public.leads_agendar_retorno('JUNHO', 'zh:fut', now() + interval '1 day');
  assert not exists (select 1 from public.leads_alertas() where tipo = 'parado' and lead_id = 'zh:fut'), 'retorno marcado para frente: não é parado';
  assert not exists (select 1 from jsonb_array_elements(public.leads_hoje() -> 'fila') f where f->>'lead_id' = 'zh:fut'), 'retorno marcado para frente: não esfria na fila';
  perform public.leads_classificar('JUNHO', 'zh:fut', 'EM NEGOCIAÇÂO', 'zz obs nova', false, null, null);
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:fut' and status = 'pendente') = 1, 'reclassificar em andamento mantém o retorno futuro';
  assert (select retorno_em is not null from public.leads where id = 'zh:fut'), 'e mantém a data do retorno no lead';
  perform public.leads_classificar('JUNHO', 'zh:fut', 'CNPJ INAPTO', null, false, null, null);
  assert (select count(*) from public.agenda_retornos where lead_id = 'zh:fut' and status = 'pendente') = 0, 'sair do andamento fecha o retorno';
  execute 'reset role';
  -- ===== mais testes entram aqui =====
end $$;
select 'CHECK OK' r;
rollback;
