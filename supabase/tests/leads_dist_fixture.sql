-- §146.1: fixture comum dos checks (dados FICTÍCIOS; o DO do check termina em exceção e desfaz tudo).
-- 3 consultores de teste usando perfis que não têm lead nem estão na equipe; o resto da equipe deixa de pegar.
update public.leads_equipe set pode_pegar = false where pode_pegar;
create temp table ld_cons on commit drop as
  select p.id, row_number() over (order by p.id)::int n
    from public.profiles p
   where p.id not in (select dono_id from public.leads where dono_id is not null)
     and p.id not in (select profile_id from public.leads_equipe where profile_id is not null)
     and coalesce(p.role, '') not in ('admin', 'supervisor')
   order by p.id limit 3;
insert into public.leads_equipe (nome_planilha, usuario_telefonia, profile_id, monitorar, desde, pode_pegar)
  select 'Teste Dist ' || chr(64 + n), 'teste.dist.' || lower(chr(64 + n)), id, false, current_date, true from ld_cons;
insert into public.config (chave, valor) select 'leads_distribuicao', '{}' where not exists (select 1 from public.config where chave = 'leads_distribuicao');
update public.config set valor = '{"modo":"automatico","expediente":{"dias":[1,2,3,4,5,6,7],"inicio":"00:00","fim":"24:00"}}' where chave = 'leads_distribuicao';
insert into public.config (chave, valor) select 'leads_pegar_bloqueado', '{"bloqueado":false}' where not exists (select 1 from public.config where chave = 'leads_pegar_bloqueado');
update public.config set valor = '{"bloqueado":false}' where chave = 'leads_pegar_bloqueado';
create function pg_temp.ld_c(p_n int) returns uuid language sql as $$ select id from ld_cons where n = p_n $$;
create function pg_temp.ld_admin() returns uuid language sql as $$ select id from public.profiles where role = 'admin' order by created_at limit 1 $$;
create function pg_temp.ld_como(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
create function pg_temp.ld_cfg(p jsonb) returns void language sql as $$
  update public.config set valor = (coalesce(valor::jsonb, '{}') || p)::text where chave = 'leads_distribuicao' $$;
create function pg_temp.ld_presente(p_uid uuid) returns void language sql as $$
  insert into public.leads_presenca (profile_id, visto_em, pausa_ate) values (p_uid, now(), null)
  on conflict (profile_id) do update set visto_em = now(), pausa_ate = null $$;
-- lead fictício sem dono (n = 1..99 → telefone (11) 90000-00NN)
create function pg_temp.ld_lead(p_id text, p_n int) returns void language sql as $$
  insert into public.leads (aba, id, criado_em_lead, full_name, phone_number, categoria, converteu, receita, atualizado_em, primeira_sync_em, origem_entrada)
  values ('TESTE DIST', p_id, now(), 'Lead Teste', '(11) 90000-00' || lpad(p_n::text, 2, '0'), 'sem_contato', false, 0, now(), now(), 'planilha') $$;
-- entrega aberta fictícia
create function pg_temp.ld_entrega(p_id text, p_uid uuid, p_tipo text, p_recebido timestamptz) returns bigint language sql as $$
  insert into public.leads_distribuicao (lead_aba, lead_id, consultor_id, tipo, recebido_em)
  values ('TESTE DIST', p_id, p_uid, p_tipo, p_recebido) returning id $$;
