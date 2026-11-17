-- §157 (17/11/2026, pedido do Rafael): aba "Consultar sócios" (campo livre) para o time da Apex.
-- Spec: docs/superpowers/specs/2026-11-17-consultar-socios-aba-design.md (seção 4). Sem DROP (conector).
begin;

alter table public.socios_consultas add column if not exists razao_social text;
alter table public.socios_consultas add column if not exists copiado_de bigint references public.socios_consultas(id) on delete set null;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'socios_consultas' and policyname = 'socios_consultas_select_proprio') then
    create policy socios_consultas_select_proprio on public.socios_consultas for select to authenticated using (pedido_por = auth.uid());
  end if;
end $pol$;

create or replace function public.socios_cnpj_valido(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if d !~ '^[0-9]{14}$' or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
  r := s % 11; if (case when r < 2 then 0 else 11 - r end) <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
  r := s % 11; return (case when r < 2 then 0 else 11 - r end) = substr(d, 14, 1)::int;
end $$;

create or replace function public.socios_pode_avulsa() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
                  and (p.role in ('admin','supervisor') or (p.role = 'consultor' and p.operacao = 'apex')));
$$;

-- base da Receita de um CNPJ (mesmo formato da socios_da_base, §156). Interna: nunca chamável pelo navegador.
create or replace function public.socios_base_json(p_cnpj text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'receita_mes', (select k.receita_mes from mailing.carga k order by k.carregado_em desc limit 1),
    'socios', coalesce((select jsonb_agg(jsonb_build_object('nome', s.nome, 'cpf', s.cpf,
                          'principal', coalesce(s.principal, false), 'obito', coalesce(s.obito, false))
                          order by coalesce(s.principal, false) desc, s.nome)
                        from mailing.socio s where s.cnpj = p_cnpj), '[]'::jsonb));
$$;

create or replace function public.socios_pedir_cnpj(p_cnpj text, p_atualizar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'); v_eu uuid := auth.uid();
  v_ped public.socios_consultas; v_ref public.socios_consultas; v_hoje int; v_razao text; v_extra jsonb;
begin
  if v_eu is null or not public.socios_pode_avulsa() then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  if not public.socios_cnpj_valido(v_cnpj) then return jsonb_build_object('ok', false, 'motivo', 'cnpj_invalido'); end if;
  perform pg_advisory_xact_lock(hashtext('socios:' || v_cnpj));
  select e.razao_social into v_razao from mailing.empresa e where e.cnpj = v_cnpj;
  v_extra := jsonb_build_object('razao_social', v_razao, 'base', public.socios_base_json(v_cnpj));

  update public.socios_consultas set status = 'erro', erro = 'A consulta não terminou.', concluido_em = now()
   where cnpj_digits = v_cnpj and status = 'consultando' and iniciado_em < now() - interval '10 minutes';

  -- meu pedido ainda em andamento (Tentar de novo / duplo clique): devolve o mesmo, sem linha nova nem limite
  select * into v_ped from public.socios_consultas
   where cnpj_digits = v_cnpj and pedido_por = v_eu and status in ('pendente','consultando') order by pedido_em desc limit 1;
  if found then
    if v_ped.status = 'pendente' and (v_ped.disparado_em is null or v_ped.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where cnpj_digits = v_cnpj and status = 'pendente';
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status) || v_extra;
  end if;

  select count(*) into v_hoje from public.socios_consultas
   where pedido_por = v_eu and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_hoje >= 20 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;

  if not coalesce(p_atualizar, false) then
    select * into v_ref from public.socios_consultas
     where cnpj_digits = v_cnpj and status in ('pronto','sem_socios') and concluido_em > now() - interval '30 days'
     order by concluido_em desc limit 1;
    if found then
      insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, resultado, concluido_em, copiado_de, razao_social)
           values (v_cnpj, 'avulsa', v_eu, v_ref.status, v_ref.resultado, v_ref.concluido_em, coalesce(v_ref.copiado_de, v_ref.id), v_razao)
        returning * into v_ped;
      return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status, 'guardado', true) || v_extra;
    end if;
  end if;

  -- outro consultor já pediu este CNPJ: entra junto (o gatilho entrega o resultado para todos)
  select * into v_ref from public.socios_consultas
   where cnpj_digits = v_cnpj and status in ('pendente','consultando') order by pedido_em limit 1;
  if found then
    insert into public.socios_consultas (cnpj_digits, origem, pedido_por, status, disparado_em, razao_social)
         values (v_cnpj, 'avulsa', v_eu, 'pendente', v_ref.disparado_em, v_razao) returning * into v_ped;
    if v_ref.status = 'pendente' and (v_ref.disparado_em is null or v_ref.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where cnpj_digits = v_cnpj and status = 'pendente';
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', 'pendente') || v_extra;
  end if;

  insert into public.socios_consultas (cnpj_digits, origem, pedido_por, disparado_em, razao_social)
       values (v_cnpj, 'avulsa', v_eu, now(), v_razao) returning * into v_ped;
  perform public.socios_disparar_robo();
  return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', 'pendente') || v_extra;
end $$;

create or replace function public.socios_base_do_pedido(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v public.socios_consultas;
begin
  select * into v from public.socios_consultas where id = p_id;
  if not found or auth.uid() is null or not (v.pedido_por = auth.uid() or public.get_my_role() in ('admin','supervisor')) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'razao_social', v.razao_social, 'base', public.socios_base_json(v.cnpj_digits));
end $$;

-- §157: um pedido por CNPJ; marca todos os pendentes do CNPJ; ignora CNPJ que já está em consulta
create or replace function public.socios_robo_pegar(p_max int) returns table(id bigint, cnpj text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_cnpjs text[];
begin
  select array_agg(x.cnpj_digits) into v_cnpjs from (
    select q.cnpj_digits, min(q.pedido_em) as m from public.socios_consultas q
     where q.status = 'pendente'
       and not exists (select 1 from public.socios_consultas c where c.cnpj_digits = q.cnpj_digits and c.status = 'consultando')
     group by q.cnpj_digits order by m limit greatest(1, least(coalesce(p_max, 10), 20))) x;
  if v_cnpjs is null then return; end if;
  update public.socios_consultas s set status = 'consultando', iniciado_em = now()
   where s.status = 'pendente' and s.cnpj_digits = any(v_cnpjs);
  return query select distinct on (s.cnpj_digits) s.id, s.cnpj_digits from public.socios_consultas s
    where s.cnpj_digits = any(v_cnpjs) and s.status = 'consultando' order by s.cnpj_digits, s.pedido_em;
end $$;

-- gatilho: o resultado de um pedido vale para os outros do mesmo CNPJ em andamento
create or replace function public.socios_propagar_resultado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  update public.socios_consultas o
     set status = new.status, resultado = new.resultado, erro = new.erro, concluido_em = new.concluido_em
   where o.cnpj_digits = new.cnpj_digits and o.id <> new.id and o.status in ('pendente','consultando');
  return null;
end $$;
do $trg$
begin
  if not exists (select 1 from pg_trigger where tgname = 'socios_propagar' and tgrelid = 'public.socios_consultas'::regclass) then
    create trigger socios_propagar after update of status on public.socios_consultas for each row
      when (old.status = 'consultando' and new.status in ('pronto','sem_socios','erro'))
      execute function public.socios_propagar_resultado();
  end if;
end $trg$;

revoke all on function public.socios_cnpj_valido(text), public.socios_pode_avulsa(), public.socios_base_json(text),
  public.socios_propagar_resultado(), public.socios_robo_pegar(int) from public, anon, authenticated;
grant execute on function public.socios_robo_pegar(int) to service_role;
revoke all on function public.socios_pedir_cnpj(text, boolean), public.socios_base_do_pedido(bigint) from public, anon;
grant execute on function public.socios_pedir_cnpj(text, boolean), public.socios_base_do_pedido(bigint) to authenticated;

commit;
