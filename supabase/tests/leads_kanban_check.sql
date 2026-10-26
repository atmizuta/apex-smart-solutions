-- Verificação das migrations 20261026120000..120300 (§112). Rodar SOMENTE depois delas; SEMPRE termina em ROLLBACK.
-- Dados fictícios (zz*), aba 'JUNHO'. zz:1/zz:2 são criados "1 hora atrás" porque os Livres só mostram os últimos 60 dias.
-- Usuários: e201 admin, e202 supervisor, e203 consultor da equipe, e204 consultor fora da equipe.
begin;
insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-00000000e201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kadm@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.ksup@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e203', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kcon@teste.invalid'),
  ('00000000-0000-0000-0000-00000000e204', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'zz.kfora@teste.invalid');
insert into public.profiles (id, nome, username, role, operacao) values
  ('00000000-0000-0000-0000-00000000e201', 'Zzkadm Teste',  'zz.kadm',  'admin',      'apex'),
  ('00000000-0000-0000-0000-00000000e202', 'Zzksup Teste',  'zz.ksup',  'supervisor', 'apex'),
  ('00000000-0000-0000-0000-00000000e203', 'Zzkcon Teste',  'zz.kcon',  'consultor',  'apex'),
  ('00000000-0000-0000-0000-00000000e204', 'Zzkfora Teste', 'zz.kfora', 'consultor',  'apex')
on conflict (id) do update set nome = excluded.nome, username = excluded.username, role = excluded.role, operacao = excluded.operacao;
insert into public.leads_equipe (nome_planilha, profile_id, monitorar) values ('ZZKCON', '00000000-0000-0000-0000-00000000e203', false);
insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, email, cnpj, categoria, converteu, receita) values
  ('JUNHO', 'zz:1', now() - interval '1 hour', 'Zz Empresa Um',   '11900000001', 'zz1@teste.invalid', '00000000000101', 'sem_contato', false, 0),
  ('JUNHO', 'zz:2', now() - interval '1 hour', 'Zz Empresa Dois', '11900000002', 'zz2@teste.invalid', '00000000000202', 'sem_contato', false, 0);

do $$
declare n int;
begin
  -- ===== Task 1: estrutura =====
  select count(*) into n from public.leads_status_opcoes where ativo;
  assert n = 20, 'tabulações ativas: esperado 20 (18 do código + PROPOSTA ENVIADA + PROBLEMA SISTÊMICO), veio ' || n;
  select count(*) into n from public.leads_status_opcoes where grupo = 'convertido';
  assert n = 1, 'só 1 status de venda';
  assert public.leads_mes_aba('2000-06-30 23:30-03') = 'JUNHO', 'mês em SP (23:30 de 30/06 ainda é junho)';
  assert public.leads_mes_aba('2000-07-01 02:30+00') = 'JUNHO', '02:30 UTC de 01/07 = 23:30 de 30/06 em SP';
  assert public.leads_mes_aba('2000-03-10 12:00-03') = 'MARCO', 'março sem cedilha, igual às abas';
  perform public.leads_espelho_enfileirar('JUNHO', 'zz:1');
  perform public.leads_espelho_enfileirar('JUNHO', 'zz:1');
  select count(*) into n from public.leads_espelho where lead_aba = 'JUNHO' and lead_id = 'zz:1' and feito_em is null;
  assert n = 1, 'enfileirar 2x o mesmo lead = 1 item pendente';
  assert (select valor from public.config where chave = 'leads_modo') = 'planilha', 'modo começa em planilha';
  -- ===== Task 2: RPCs =====
  execute 'set local role authenticated';
  -- consultor fora da equipe não pega
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e204', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e204', true);
  begin
    perform public.leads_pegar('JUNHO', 'zz:1');
    assert false, 'consultor fora da equipe conseguiu pegar';
  exception when insufficient_privilege then null;
  end;
  -- consultor da equipe pega; segundo "pegar" (mesmo de outra pessoa) perde
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e203', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e203', true);
  assert (public.leads_pegar('JUNHO', 'zz:1') ->> 'ok')::boolean, 'pegar lead livre';
  assert not (public.leads_pegar('JUNHO', 'zz:1') ->> 'ok')::boolean, 'pegar de novo o mesmo lead perde';
  execute 'reset role';
  assert (select consultor from public.leads where aba = 'JUNHO' and id = 'zz:1') = 'ZZKCON', 'consultor = nome_planilha';
  assert (select count(*) from public.leads_historico where lead_id = 'zz:1' and acao = 'pegar') = 1, 'histórico do pegar';
  execute 'set local role authenticated';
  -- nos Livres o consultor não recebe telefone/e-mail/CNPJ; no próprio lead recebe
  assert (select telefone is null and email is null and cnpj is null from public.leads_kanban(null) where lead_id = 'zz:2'), 'Livre sem dado sensível para consultor';
  assert (select telefone = '11900000001' from public.leads_kanban(null) where lead_id = 'zz:1'), 'meu lead com telefone';
  assert (select livre from public.leads_kanban(null) where lead_id = 'zz:2'), 'zz:2 é livre';
  -- classificar: status inválido recusa; válido grava categoria/converteu e enfileira
  begin
    perform public.leads_classificar('JUNHO', 'zz:1', 'STATUS INVENTADO', null, false, null, null);
    assert false, 'status inválido aceito';
  exception when invalid_parameter_value then null;
  end;
  perform public.leads_classificar('JUNHO', 'zz:1', 'PEDIDO CONCLUIDO (VENDA)', 'zz obs', false, 1234.5, null);
  -- quem não é dono não classifica
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e204', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e204', true);
  begin
    perform public.leads_classificar('JUNHO', 'zz:1', 'CNPJ INAPTO', null, false, null, null);
    assert false, 'quem não é dono classificou';
  exception when insufficient_privilege then null;
  end;
  -- supervisor vê dado sensível nos Livres e redistribui
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e202', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e202', true);
  assert (select telefone = '11900000002' from public.leads_kanban(null) where lead_id = 'zz:2'), 'supervisor vê telefone nos Livres';
  perform public.leads_redistribuir('JUNHO', 'zz:2', '00000000-0000-0000-0000-00000000e203');
  begin
    perform public.leads_redistribuir('JUNHO', 'zz:1', null);   -- zz:1 já tem status
    assert false, 'devolveu aos Livres lead com status';
  exception when invalid_parameter_value then null;
  end;
  execute 'reset role';
  assert (select categoria = 'convertido' and converteu and receita = 1234.5 and obs = 'zz obs' from public.leads where id = 'zz:1'), 'classificar gravou';
  assert (select dono_id = '00000000-0000-0000-0000-00000000e203' and consultor = 'ZZKCON' from public.leads where id = 'zz:2'), 'redistribuir trocou o dono';
  assert (select count(*) from public.leads_espelho where lead_aba = 'JUNHO' and feito_em is null) = 2, 'zz:1 e zz:2 na fila';
  -- entrada: insere novo (aba pelo mês) e só atualiza dado do formulário do existente
  perform public.leads_entrada(jsonb_build_array(
    jsonb_build_object('id', 'zz:3', 'criado_em_lead', '2000-06-20T09:00:00-03:00', 'full_name', 'Zz Empresa Tres', 'phone_number', '11900000003'),
    jsonb_build_object('id', 'zz:1', 'criado_em_lead', (select criado_em_lead from public.leads where id = 'zz:1')::text, 'full_name', 'Zz Empresa Um Novo', 'phone_number', '11900000001')));
  assert (select aba = 'JUNHO' and categoria = 'sem_contato' and dono_id is null from public.leads where id = 'zz:3'), 'entrada inseriu zz:3 livre';
  assert (select full_name = 'Zz Empresa Um' and status = 'PEDIDO CONCLUIDO (VENDA)' and consultor = 'ZZKCON' from public.leads where id = 'zz:1'), 'entrada não toca lead que já existe (nem nome, nem trabalho do consultor)';
  assert exists (select 1 from public.leads_espelho where lead_id = 'zz:3' and feito_em is null), 'lead novo vai para a fila';
  assert (public.leads_entrada(jsonb_build_array(jsonb_build_object('id', 'zz:3', 'criado_em_lead', '2000-06-20T09:00:00-03:00', 'full_name', 'Zz Empresa Tres', 'phone_number', '11900000003'))) ->> 'inseridos')::int = 0, 'entrada repetida não insere de novo';
  -- ===== Task 3: colunas sensíveis =====
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e203', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e203', true);
  begin
    perform phone_number from public.leads limit 1;
    assert false, 'consultor leu phone_number direto da tabela';
  exception when insufficient_privilege then null;
  end;
  begin
    perform cnpj from public.leads limit 1;
    assert false, 'consultor leu cnpj direto da tabela';
  exception when insufficient_privilege then null;
  end;
  perform status, categoria, consultor from public.leads limit 1;   -- colunas da Digital continuam liberadas
  begin
    perform * from public.leads_digital_admin();
    assert false, 'consultor chamou leads_digital_admin';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000e202', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e202', true);
  assert (select count(*) from public.leads_digital_admin() where id like 'zz:%') = 3, 'supervisor recebe cnpj pela RPC';
  execute 'reset role';
  -- ===== Task 6: fila ===== (os itens de zz:1/zz:2/zz:3 estão pendentes desde o bloco da Task 2)
  update public.leads_espelho set proxima_em = now() - interval '1 second' where lead_aba = 'JUNHO';
  assert (select count(*) from public.leads_espelho_pegar(100) where lead_aba = 'JUNHO') = 3, 'pegar reserva os 3 itens';
  assert (select count(*) from public.leads_espelho_pegar(100) where lead_aba = 'JUNHO') = 0, 'reservados não voltam na rodada seguinte';
  -- feito com pedido_em velho não marca (consultor reclassificou no meio)
  perform public.leads_espelho_feito(jsonb_build_array(jsonb_build_object('lead_aba', 'JUNHO', 'lead_id', 'zz:1', 'pedido_em', '2000-01-01T00:00:00Z', 'guia', 'G')));
  assert (select feito_em is null from public.leads_espelho where lead_id = 'zz:1'), 'pedido_em diferente não marca feito';
  perform public.leads_espelho_feito((select jsonb_agg(jsonb_build_object('lead_aba', lead_aba, 'lead_id', lead_id, 'pedido_em', pedido_em, 'guia', 'ZZ GUIA'))
                                        from public.leads_espelho where lead_id = 'zz:2'));
  assert (select feito_em is not null from public.leads_espelho where lead_id = 'zz:2'), 'feito com pedido_em igual';
  assert (select aba_planilha = 'ZZ GUIA' from public.leads where id = 'zz:2'), 'aba_planilha gravada';
  perform public.leads_espelho_falha(jsonb_build_array(jsonb_build_object('lead_aba', 'JUNHO', 'lead_id', 'zz:3')), 'Sheets 503');
  assert (select tentativas = 1 and proxima_em > now() + interval '50 seconds' and ultimo_erro = 'Sheets 503' from public.leads_espelho where lead_id = 'zz:3'), 'falha conta tentativa e espera 1 min';
  -- ===== mais testes entram aqui =====
end $$;
rollback;
