-- Verificação do Monitoramento Leads. Roda SOMENTE depois de a migration estar aplicada e SEMPRE termina em ROLLBACK
-- (os dados fictícios nunca ficam no banco). Falha = exceção com a mensagem do assert.
-- Usa 1 admin e 1 consultor reais APENAS pelo id (não lê nem grava nada neles).
begin;

insert into public.leads (id, aba, consultor, full_name, phone_number, categoria, status, criado_em_lead) values
  ('zz:1', 'ZZTESTE', 'Caio Teste', 'Lead Um',   'p:+5519900000001', 'sem_contato', '',                         now() - interval '2 days'),
  ('zz:2', 'ZZTESTE', 'Caio Teste', 'Lead Dois', 'p:+5511900000002', 'convertido',  'PEDIDO CONCLUIDO (VENDA)', now()),
  ('zz:3', 'ZZTESTE', 'Outro',      'Lead Tres', 'p:+5518900000003', 'andamento',   'EM NEGOCIACAO',            now());
insert into public.leads_equipe (nome_planilha, usuario_telefonia, monitorar, profile_id)
  values ('Caio Teste', 'apex.teste', true, (select id from public.profiles where role = 'consultor' limit 1));
insert into public.ligacoes_manuais (id, usuario, telefone, chave_tel, gerada_em, atendida, seg_falados, tabulacao) values
  (-1, 'apex.teste', '19900000001',        public.chave_tel('19900000001'),        now(),                      true,  90, 'SEM CONTATO'),
  (-2, 'apex.teste', '(19) 90000-0001',    public.chave_tel('(19) 90000-0001'),    now() - interval '1 day',   false, 0,  null),
  (-3, 'apex.outro', '11900000002',        public.chave_tel('11900000002'),        now(),                      true,  10, null);

do $$
declare
  adm uuid := (select id from public.profiles where role = 'admin' limit 1);
  con uuid := (select profile_id from public.leads_equipe where nome_planilha = 'Caio Teste');
  n int; r record; ok boolean;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- 1) chave_tel: formatos diferentes, mesma chave; curto/vazio = null
  assert public.chave_tel('p:+5519900000001') = '1900000001', 'chave_tel com 55 e 9';
  assert public.chave_tel('(19) 90000-0001') = '1900000001', 'chave_tel formatado';
  assert public.chave_tel('1900000001') = '1900000001', 'chave_tel sem 9';
  assert public.chave_tel('123') is null and public.chave_tel(null) is null and public.chave_tel('') is null, 'chave_tel curto/vazio';
  assert public.norm_nome('  JOÃO   Álvaro ') = 'joao alvaro', 'norm_nome';

  -- 2) admin
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', adm::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.monitor_leads_leads('ZZTESTE');
  assert n = 2, 'admin vê só os 2 leads do consultor monitorado, veio ' || n;
  select * into r from public.monitor_leads_leads('ZZTESTE') where lead_id = 'zz:1';
  assert r.tentativas = 2 and r.atendidas = 1, 'zz:1 tem 2 tentativas e 1 atendida';
  select * into r from public.monitor_ligacoes_por_usuario(hoje, null, null) where usuario = 'apex.teste';
  assert r.lig_leads = 2 and r.leads_distintos = 1 and r.h_hoje = 1 and r.h_ontem = 1 and r.h_7 = 2, 'janelas do apex.teste';
  assert r.atend_sem_contato = 1 and r.boas_leads = 1, 'qualidade do apex.teste';
  select * into r from public.monitor_ligacoes_por_usuario(hoje, hoje, hoje) where usuario = 'apex.teste';
  assert r.lig_leads = 1, 'período de um dia só conta as de hoje';
  select total into n from public.monitor_ligacoes_resumo();
  assert n >= 3, 'resumo conta as ligações';
  execute 'reset role';

  -- 3) consultor vinculado: não chama RPC de admin, não lê ligações, vê só os leads dele em aberto
  perform set_config('request.jwt.claims', json_build_object('sub', con, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', con::text, true);
  execute 'set local role authenticated';
  ok := false;
  begin perform * from public.monitor_leads_leads('ZZTESTE'); exception when others then ok := true; end;
  assert ok, 'consultor não pode chamar monitor_leads_leads';
  select count(*) into n from public.ligacoes_manuais;
  assert n = 0, 'consultor não lê ligacoes_manuais (RLS)';
  select count(*) into n from public.meus_leads_para_tratar();
  assert n = 1, 'consultor vê só zz:1 (zz:2 é venda), veio ' || n;
  select * into r from public.meus_leads_para_tratar() limit 1;
  assert r.lead_id = 'zz:1' and r.tentativas = 2, 'tentativas do lead dele';
  execute 'reset role';

  -- 4) anônimo: sem acesso às funções
  execute 'set local role anon';
  ok := false;
  begin perform * from public.meus_leads_para_tratar(); exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não executa meus_leads_para_tratar';
  execute 'reset role';
end $$;

rollback;
