-- §138.1: conferência da migration 20261105120000 (tudo desfeito no fim: o DO termina com exceção de propósito).
-- Rodar no execute_sql. O resultado vem na mensagem 'RESULTADO: ...'.
begin;

create or replace function public.conversao_resumo()
 returns table(aba text, ordem timestamptz, consultor text, leads int, convertidos int, receita numeric, conv_sem_receita int)
 language plpgsql stable security definer set search_path to 'public'
as $function$
#variable_conflict use_column
declare v_role text; v_op text;
begin
  select p.role, coalesce(p.operacao, 'apex') into v_role, v_op from public.profiles p where p.id = auth.uid();
  if v_role is null or not (v_role in ('admin', 'agencia') or (v_role in ('supervisor', 'consultor') and v_op = 'apex')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
  with base as (
    select l.aba as b_aba, l.criado_em_lead as b_criado,
           coalesce(nullif(trim(l.consultor), ''), nullif(trim(pr.nome), '')) as b_consultor,
           coalesce(l.converteu, false) as b_conv, l.receita as b_receita
      from public.leads l
      left join public.profiles pr on pr.id = l.dono_id
     where l.apagado_em is null and nullif(trim(l.aba), '') is not null
  ), ordens as (
    select b.b_aba as o_aba, min(b.b_criado) as o_ordem from base b group by b.b_aba
  )
  select b.b_aba, o.o_ordem, b.b_consultor,
         count(*)::int,
         (count(*) filter (where b.b_conv))::int,
         coalesce(sum(b.b_receita) filter (where b.b_conv), 0)::numeric,
         (count(*) filter (where b.b_conv and coalesce(b.b_receita, 0) = 0))::int
    from base b join ordens o on o.o_aba = b.b_aba
   group by b.b_aba, o.o_ordem, b.b_consultor
   order by o.o_ordem, b.b_aba, b.b_consultor;
end $function$;

create or replace function public.meu_perfil()
 returns table(id uuid, nome text, username text, role text, operacao text)
 language sql stable security definer set search_path to 'public'
as $function$
  select p.id, p.nome, p.username, p.role, coalesce(p.operacao, 'apex') from public.profiles p where p.id = auth.uid()
$function$;

revoke all on function public.conversao_resumo() from public, anon;
revoke all on function public.meu_perfil() from public, anon;
grant execute on function public.conversao_resumo() to authenticated, service_role;
grant execute on function public.meu_perfil() to authenticated, service_role;

do $$
declare v_admin uuid; v_dif int; v_abas int; v_ok boolean := false; v_eu uuid;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' order by p.created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select count(*) into v_dif from (
    (select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba
     except
     select l.aba, count(*), count(*) filter (where l.converteu), coalesce(sum(l.receita) filter (where l.converteu), 0)
       from public.leads l where l.apagado_em is null and nullif(trim(l.aba), '') is not null group by l.aba)
    union all
    (select l.aba, count(*), count(*) filter (where l.converteu), coalesce(sum(l.receita) filter (where l.converteu), 0)
       from public.leads l where l.apagado_em is null and nullif(trim(l.aba), '') is not null group by l.aba
     except
     select r.aba, sum(r.leads)::bigint, sum(r.convertidos)::bigint, sum(r.receita) from public.conversao_resumo() r group by r.aba)
  ) x;
  if v_dif <> 0 then raise exception 'FALHOU: % guia(s) com total diferente entre conversao_resumo e leads', v_dif; end if;
  select count(distinct r.aba) into v_abas from public.conversao_resumo() r;

  select m.id into v_eu from public.meu_perfil() m;
  if v_eu is distinct from v_admin then raise exception 'FALHOU: meu_perfil não devolveu o próprio usuário'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin
    perform 1 from public.conversao_resumo();
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'FALHOU: usuário sem perfil leu a conversão'; end if;

  raise exception 'RESULTADO: OK — % guias conferidas, meu_perfil certo, sem perfil recusado', v_abas;
end $$;
