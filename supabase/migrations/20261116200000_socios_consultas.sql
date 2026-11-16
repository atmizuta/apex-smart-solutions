-- §156 (16/11/2026, pedido do Rafael): consulta de sócios na ficha da Renovação.
-- Spec: docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md (seção 4)
begin;

create table if not exists public.socios_consultas (
  id            bigserial primary key,
  cnpj_digits   text not null check (cnpj_digits ~ '^[0-9]{14}$'),
  carteira_id   bigint references public.renovacao_carteira(id) on delete set null,
  origem        text not null default 'renovacao',
  pedido_por    uuid not null,
  pedido_em     timestamptz not null default now(),
  status        text not null default 'pendente'
                check (status in ('pendente','consultando','pronto','sem_socios','erro')),
  iniciado_em   timestamptz,
  concluido_em  timestamptz,
  disparado_em  timestamptz,
  resultado     jsonb,
  erro          text
);
create index if not exists socios_consultas_cnpj on public.socios_consultas (cnpj_digits, pedido_em desc);
create index if not exists socios_consultas_quem on public.socios_consultas (pedido_por, pedido_em);
create index if not exists socios_consultas_fila on public.socios_consultas (status) where status in ('pendente','consultando');

alter table public.socios_consultas enable row level security;
revoke all on public.socios_consultas from anon, authenticated;
grant select on public.socios_consultas to authenticated;
revoke all on sequence public.socios_consultas_id_seq from anon, authenticated;

do $pol$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'socios_consultas' and policyname = 'socios_consultas_select') then
    create policy socios_consultas_select on public.socios_consultas for select to authenticated
      using (exists (select 1 from public.renovacao_carteira c
                      where c.cnpj_digits = socios_consultas.cnpj_digits
                        and (c.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'))));
  end if;
end $pol$;

-- CNPJ do cliente se quem chama pode ver a ficha (mesma regra da renovacao_carteira_select); null se não pode.
create or replace function public.socios_cnpj_visivel(p_carteira_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select c.cnpj_digits from public.renovacao_carteira c
   where c.id = p_carteira_id and c.cnpj_digits ~ '^[0-9]{14}$'
     and (c.consultor_id = auth.uid() or public.get_my_role() in ('admin','supervisor'));
$$;

-- Dispara o workflow socios.yml do robô (mesmo token do Vault dos jobs robo-procontact-*).
create or replace function public.socios_disparar_robo() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://api.github.com/repos/rafaangelao/apex-robo-procontact/actions/workflows/socios.yml/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_robo_token'),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'apex-supabase-socios',
      'Content-Type', 'application/json'),
    body := '{"ref":"main"}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

create or replace function public.socios_da_base(p_carteira_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cnpj text;
begin
  v_cnpj := public.socios_cnpj_visivel(p_carteira_id);
  if v_cnpj is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  return jsonb_build_object(
    'ok', true,
    'receita_mes', (select k.receita_mes from mailing.carga k order by k.carregado_em desc limit 1),
    'socios', coalesce((
      select jsonb_agg(jsonb_build_object('nome', s.nome, 'cpf', s.cpf,
                                          'principal', coalesce(s.principal, false), 'obito', coalesce(s.obito, false))
                       order by coalesce(s.principal, false) desc, s.nome)
        from mailing.socio s where s.cnpj = v_cnpj), '[]'::jsonb));
end $$;

create or replace function public.socios_pedir(p_carteira_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cnpj text; v_ped public.socios_consultas; v_hoje int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  v_cnpj := public.socios_cnpj_visivel(p_carteira_id);
  if v_cnpj is null then return jsonb_build_object('ok', false, 'motivo', 'sem_permissao'); end if;
  -- dois cliques quase juntos no mesmo CNPJ: um espera o outro (não duplica pedido nem limite)
  perform pg_advisory_xact_lock(hashtext('socios:' || v_cnpj));

  update public.socios_consultas set status = 'erro', erro = 'A consulta não terminou.', concluido_em = now()
   where cnpj_digits = v_cnpj and status = 'consultando' and iniciado_em < now() - interval '10 minutes';

  select * into v_ped from public.socios_consultas
   where cnpj_digits = v_cnpj and status in ('pendente','consultando')
   order by pedido_em desc limit 1;
  if found then
    if v_ped.status = 'pendente' and (v_ped.disparado_em is null or v_ped.disparado_em < now() - interval '3 minutes') then
      perform public.socios_disparar_robo();
      update public.socios_consultas set disparado_em = now() where id = v_ped.id;
    end if;
    return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status);
  end if;

  select count(*) into v_hoje from public.socios_consultas
   where pedido_por = auth.uid()
     and pedido_em >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo');
  if v_hoje >= 20 then return jsonb_build_object('ok', false, 'motivo', 'limite'); end if;

  insert into public.socios_consultas (cnpj_digits, carteira_id, pedido_por, disparado_em)
       values (v_cnpj, p_carteira_id, auth.uid(), now())
    returning * into v_ped;
  perform public.socios_disparar_robo();
  return jsonb_build_object('ok', true, 'id', v_ped.id, 'status', v_ped.status);
end $$;

-- Só o robô (via Edge Function ingest-socios, service_role): pega até p_max pendentes e marca consultando.
create or replace function public.socios_robo_pegar(p_max int) returns table(id bigint, cnpj text)
language sql security definer set search_path = public as $$
  update public.socios_consultas s set status = 'consultando', iniciado_em = now()
   where s.id in (select q.id from public.socios_consultas q where q.status = 'pendente'
                   order by q.pedido_em limit greatest(1, least(coalesce(p_max, 10), 20))
                   for update skip locked)
  returning s.id, s.cnpj_digits;
$$;

revoke all on function public.socios_cnpj_visivel(bigint), public.socios_disparar_robo(), public.socios_robo_pegar(int)
  from public, anon, authenticated;
grant execute on function public.socios_robo_pegar(int) to service_role;
revoke all on function public.socios_pedir(bigint), public.socios_da_base(bigint) from public, anon;
grant execute on function public.socios_pedir(bigint), public.socios_da_base(bigint) to authenticated;

commit;
