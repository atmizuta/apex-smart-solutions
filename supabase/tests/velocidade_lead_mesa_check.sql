-- Verificação de 20261002100000_velocidade_lead_mesa.sql. Rodar SOMENTE depois da migration; SEMPRE termina em
-- ROLLBACK (nada fictício fica). Falha = exceção com a mensagem do assert. Perfis/leads fictícios (zz*).
begin;

-- 6) (antes de inserir qualquer lead fictício) as linhas antigas NÃO ganharam a hora da migration
do $$ begin
  assert not exists (select 1 from public.leads where primeira_sync_em is not null and criado_em_lead < now() - interval '1 day'
                      and primeira_sync_em between now() - interval '10 minutes' and now()),
    'linhas antigas não podem ter primeira_sync_em = hora da migration';
end $$;

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlcons@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlsup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vloutro@teste.invalid'),
  ('00000000-0000-0000-0000-00000000bb04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.vlsemperfil@teste.invalid');
insert into public.profiles (id, nome, username, role) values
  ('00000000-0000-0000-0000-00000000bb01', 'Zzvlcons Teste', 'zz.vlcons', 'consultor'),
  ('00000000-0000-0000-0000-00000000bb02', 'Zzvlsup Teste',  'zz.vlsup',  'supervisor'),
  ('00000000-0000-0000-0000-00000000bb03', 'Zzvloutro Teste','zz.vloutro','consultor')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role;
-- bb04 propositalmente SEM profile (get_my_role() nulo)

insert into public.leads (id, aba, consultor, full_name, phone_number, categoria, status, criado_em_lead) values
  ('zz:v1', 'ZZMES', 'Zzvlcons', 'Lead Teste V1', 'p:+5519900000201', 'andamento', 'EM NEGOCIACAO', now() - interval '2 hours'),
  ('zz:v2', 'ZZMES', 'Zzvloutro','Lead Teste V2', 'p:+5519900000202', 'andamento', 'EM NEGOCIACAO', now() - interval '2 hours'),
  ('zz:v3', 'ZZMES', 'Zzvlcons', 'Lead Teste V3', 'p:+5519900000203', 'andamento', 'EM NEGOCIACAO', now() - interval '10 days');

do $$
declare n int; t timestamptz;
begin
  -- 7) primeira_sync_em preenchida no insert e NÃO muda num upsert
  select primeira_sync_em into t from public.leads where aba = 'ZZMES' and id = 'zz:v1';
  assert t is not null, 'insert preenche primeira_sync_em';
  insert into public.leads (id, aba, consultor, full_name, status, categoria)
       values ('zz:v1', 'ZZMES', 'Zzvlcons', 'Lead Teste V1', 'PEDIDO CONCLUIDO (VENDA)', 'convertido')
  on conflict (aba, id) do update set status = excluded.status, categoria = excluded.categoria;
  assert (select primeira_sync_em from public.leads where aba = 'ZZMES' and id = 'zz:v1') = t, 'upsert não altera primeira_sync_em';
  update public.leads set categoria = 'andamento', status = 'EM NEGOCIACAO' where aba = 'ZZMES' and id = 'zz:v1';

  execute 'set local role authenticated';

  -- 1) consultor registra contato no PRÓPRIO lead; clique duplo em < 2 min não duplica
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb01', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb01', true);
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'whatsapp');
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'whatsapp');
  perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'manual');
  -- 2) meus_leads_relogio: só os leads dele, dentro da janela (v3 tem 10 dias, fora dos 7)
  select count(*) into n from public.meus_leads_relogio() where lead_id like 'zz:%';
  assert n = 1, 'meus_leads_relogio: só o v1 (dele, na janela), veio ' || n;
  assert (select primeiro_clique from public.meus_leads_relogio() where lead_id = 'zz:v1') is not null, 'v1 tem primeiro_clique';
  -- 3) consultor NÃO registra no lead de outro e NÃO chama a Mesa
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v2', 'whatsapp');
    assert false, 'consultor registrou contato no lead de outro';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_pendencias(current_date);
    assert false, 'consultor chamou mesa_pendencias';
  exception when insufficient_privilege then null; end;
  begin
    perform public.mesa_leads_relogio(now() - interval '1 day');
    assert false, 'consultor chamou mesa_leads_relogio';
  exception when insufficient_privilege then null; end;
  -- canal inválido
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'email');
    assert false, 'aceitou canal inválido';
  exception when invalid_parameter_value then null; end;
  -- consultor não lê leads_contatos direto
  begin
    perform 1 from public.leads_contatos limit 1;
    assert false, 'consultor leu leads_contatos direto';
  exception when insufficient_privilege then null; end;

  -- 4) supervisor: registra em qualquer lead e vê a Mesa
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb02', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb02', true);
  perform public.registrar_contato_lead('ZZMES', 'zz:v2', 'ligar');
  select count(*) into n from public.mesa_leads_relogio(now() - interval '1 day') where lead_id like 'zz:%';
  assert n = 2, 'mesa_leads_relogio: v1 e v2 (v3 é antigo), veio ' || n;
  assert (select canal_clique from public.mesa_leads_relogio(now() - interval '1 day') where lead_id = 'zz:v1') = 'whatsapp', 'canal do 1º clique';
  assert exists (select 1 from public.mesa_pendencias(current_date) where tipo = 'consultor' and profile_id = '00000000-0000-0000-0000-00000000bb03'),
    'mesa_pendencias traz a linha base de cada consultor';
  perform public.mesa_ligacoes_hoje(current_date);
  perform public.mesa_vendas_mes(current_date);

  -- 5) usuário SEM perfil (get_my_role nulo) não passa
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000bb04', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000bb04', true);
  begin
    perform public.mesa_pendencias(current_date);
    assert false, 'sem perfil chamou mesa_pendencias';
  exception when insufficient_privilege then null; end;
  begin
    perform public.registrar_contato_lead('ZZMES', 'zz:v1', 'manual');
    assert false, 'sem perfil registrou contato';
  exception when insufficient_privilege then null; end;
end $$;

-- contagem dos cliques gravados (como postgres): 2 do consultor (whatsapp 1x + manual) + 1 do supervisor
reset role;
do $$ begin
  assert (select count(*) from public.leads_contatos where lead_aba = 'ZZMES') = 3, 'clique duplo não duplicou (3 registros)';
end $$;

-- anon não executa nada
set local role anon;
do $$ begin
  begin perform public.meus_leads_relogio(); assert false, 'anon executou meus_leads_relogio';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
